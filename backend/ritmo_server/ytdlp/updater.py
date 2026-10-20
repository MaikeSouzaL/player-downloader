"""
Atualização automática do yt-dlp.

Quando um site muda a proteção (o YouTube muda quase toda semana), o yt-dlp quebra até sair
uma versão nova. O servidor então:
  1. percebe pelo texto do erro que é o extrator (não vídeo privado, rede caída etc.);
  2. roda `pip install -U yt-dlp[default]`; se nada mudar, tenta a versão nightly;
  3. repete o pedido uma vez com a versão nova.
Como o yt-dlp roda num processo separado a cada pedido, a versão nova vale na hora, sem reiniciar.
Também confere uma vez por dia, sem esperar dar erro.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
from collections import deque
from contextlib import contextmanager
from typing import Any, Callable, Iterator

from ..config import Settings
from ..core.errors import needs_update

log = logging.getLogger("ritmo.update")

Command = Callable[[list[str], int], subprocess.CompletedProcess]


def _run(cmd: list[str], timeout: int) -> subprocess.CompletedProcess:
    kwargs: dict[str, Any] = {}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PIP_DISABLE_PIP_VERSION_CHECK": "1"}
    return subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        text=True, encoding="utf-8", errors="replace", timeout=timeout, env=env, **kwargs,
    )


class Updater:
    def __init__(self, settings: Settings, *, python: str = sys.executable, run: Command = _run) -> None:
        self.settings = settings
        self.python = python
        self._run = run
        self._lock = threading.Lock()
        # Portão entre os processos do yt-dlp (vários ao mesmo tempo) e o pip (sozinho).
        self._gate = threading.Condition()
        self._active = 0
        self._updating = False
        self.version: str | None = None
        self.last_attempt = 0.0
        self.last_change = 0.0
        self.last_check = 0.0
        # Sobe a cada troca de versão: quem guarda informações da versão antiga sabe que precisa reler.
        self.generation = 0
        self.history: deque[dict[str, Any]] = deque(maxlen=20)

    # ------------------------------------------------------------------ estado

    @property
    def updating(self) -> bool:
        return self._updating

    @property
    def active(self) -> int:
        """Processos do yt-dlp rodando agora (leituras e downloads)."""
        return self._active

    @contextmanager
    def running(self) -> Iterator[None]:
        """
        Cada processo do yt-dlp roda dentro disto: espera uma atualização em andamento terminar e,
        enquanto roda, a próxima atualização espera por ele (por um tempo curto).
        """
        with self._gate:
            self._gate.wait_for(lambda: not self._updating, timeout=900)
            self._active += 1
        try:
            yield
        finally:
            with self._gate:
                self._active -= 1
                self._gate.notify_all()

    def _begin_update(self, drain_timeout: float = 20) -> None:
        """Fecha o portão para processos novos e dá um tempo para os que estão rodando terminarem."""
        with self._gate:
            self._updating = True
            if not self._gate.wait_for(lambda: self._active == 0, timeout=drain_timeout):
                # Downloads longos não seguram a correção: o pip só troca o yt-dlp (Python puro).
                log.info("Atualizando com %s processo(s) do yt-dlp ainda rodando", self._active)

    def _end_update(self) -> None:
        with self._gate:
            self._updating = False
            self._gate.notify_all()

    def current_version(self) -> str:
        try:
            result = self._run([self.python, "-m", "yt_dlp", "--version"], 60)
        except (OSError, subprocess.SubprocessError) as exc:
            log.warning("yt-dlp --version falhou: %s", exc)
            return self.version or "?"
        text = (result.stdout or "").strip().splitlines()
        if result.returncode == 0 and text:
            self.version = text[-1].strip()
        return self.version or "?"

    def info(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "autoUpdate": self.settings.auto_update,
            "channel": self.settings.update_channel,
            "updating": self.updating,
            "running": self.active,
            "lastUpdate": self.last_change or None,
            "history": list(self.history),
        }

    # ------------------------------------------------------------------ atualizar

    def _pip(self, *, pre: bool) -> tuple[bool, str]:
        """
        1) Troca só o yt-dlp (`--no-deps`): é Python puro, então funciona mesmo com outros processos
           usando as bibliotecas compiladas (no Windows, .pyd em uso não podem ser trocados).
           Nightly: a versão "dev" é liberada só para o yt-dlp, não para as dependências.
        2) Instala o que a versão nova exigir das dependências (ex.: yt-dlp-ejs), sem forçar o resto.
        """
        base = [self.python, "-m", "pip", "install", "--no-input", "--disable-pip-version-check"]
        target = "yt-dlp>=0.0.0.dev0" if pre else "yt-dlp"
        outputs: list[str] = []
        try:
            first = self._run([*base, "-U", "--no-deps", target], 600)
            outputs.append(first.stdout or "")
            if first.returncode != 0:
                return False, "".join(outputs)[-2000:]
            second = self._run([*base, "yt-dlp[default]"], 600)
            outputs.append(second.stdout or "")
            return second.returncode == 0, "".join(outputs)[-2000:]
        except (OSError, subprocess.SubprocessError) as exc:
            return False, str(exc)

    def _update_locked(self, reason: str, *, allow_nightly: bool) -> bool:
        self._begin_update()
        try:
            before = self.current_version()
            nightly_first = self.settings.update_channel == "nightly"
            ok, output = self._pip(pre=nightly_first)
            after = self.current_version()
            channel = "nightly" if nightly_first else "stable"
            if after == before and allow_nightly and not nightly_first:
                ok, output = self._pip(pre=True)
                after = self.current_version()
                channel = "nightly"
            changed = after != before
            entry = {"at": time.time(), "reason": reason[:200], "from": before, "to": after, "channel": channel, "ok": ok}
            self.history.appendleft(entry)
            if changed:
                self.generation += 1
                self.last_change = time.time()
                log.info("yt-dlp atualizado %s → %s (%s; %s)", before, after, channel, reason)
            elif not ok:
                log.warning("Falha ao atualizar o yt-dlp: %s", output.strip().splitlines()[-1:] or output)
            else:
                log.info("yt-dlp já está na versão mais nova (%s)", after)
            return changed
        finally:
            self.last_attempt = time.time()
            self._end_update()

    def update(self, reason: str = "manual", *, allow_nightly: bool | None = None) -> bool:
        """Atualiza agora. Devolve True se a versão mudou."""
        nightly = self.settings.nightly_fallback if allow_nightly is None else allow_nightly
        with self._lock:
            return self._update_locked(reason, allow_nightly=nightly)

    def maybe_update_for(self, error_text: str, started_at: float) -> bool:
        """
        Chamado quando um pedido falhou. Devolve True se vale repetir o pedido: a versão mudou agora
        ou já tinha mudado depois que o pedido começou (outro pedido atualizou antes).
        """
        if not self.settings.auto_update or not needs_update(error_text):
            return False
        with self._lock:
            if self.last_change > started_at:
                return True
            if time.time() - self.last_attempt < self.settings.update_cooldown:
                return False
            return self._update_locked(f"erro: {error_text.strip().splitlines()[-1][:160] if error_text.strip() else '?'}",
                                       allow_nightly=self.settings.nightly_fallback)

    def scheduled(self, busy: Callable[[], bool]) -> None:
        """Conferência diária (só quando não há download rodando)."""
        if not self.settings.auto_update or busy():
            return
        if time.time() - self.last_check < self.settings.update_interval:
            return
        self.last_check = time.time()
        with self._lock:
            self._update_locked("conferência diária", allow_nightly=False)
