"""
Execução do yt-dlp num processo separado (`python -m yt_dlp`).

Por que processo e não a biblioteca:
  - uma versão nova instalada pelo atualizador vale no próximo pedido, sem reiniciar o servidor;
  - cancelar mata o download de verdade (inclusive o FFmpeg que ele abriu);
  - se o yt-dlp travar ou quebrar, o servidor continua de pé.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ..config import Settings
from ..core.errors import Cancelled, YtDlpError, last_error
from .formats import Plan
from .updater import Updater

log = logging.getLogger("ritmo.ytdlp")

DL_PREFIX = "RITMO-DL "
PP_PREFIX = "RITMO-PP "
FILE_PREFIX = "RITMO-FILE "
DL_TEMPLATE = DL_PREFIX + "%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s"
PP_TEMPLATE = PP_PREFIX + "%(progress.status)s|%(progress.postprocessor)s"


@dataclass
class Progress:
    kind: str  # "download" | "postprocess"
    status: str
    downloaded: int = 0
    total: int = 0
    postprocessor: str = ""


def _number(value: str) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def parse_progress(line: str) -> Progress | None:
    """Lê as linhas que o próprio servidor pediu ao yt-dlp (--progress-template)."""
    if line.startswith(DL_PREFIX):
        parts = line[len(DL_PREFIX):].split("|")
        if len(parts) < 4:
            return None
        status, done, total, estimate = parts[:4]
        return Progress("download", status.strip(), _number(done), _number(total) or _number(estimate))
    if line.startswith(PP_PREFIX):
        parts = line[len(PP_PREFIX):].split("|")
        return Progress("postprocess", parts[0].strip(), postprocessor=parts[1].strip() if len(parts) > 1 else "")
    return None


def kill_tree(proc: subprocess.Popen) -> None:
    """Mata o yt-dlp e os filhos dele (FFmpeg), senão o arquivo fica preso no Windows."""
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW, timeout=15)
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        proc.kill()


class YtDlpRunner:
    def __init__(self, settings: Settings, updater: Updater, cache_dir: Path, *, python: str = sys.executable) -> None:
        self.settings = settings
        self.updater = updater
        self.cache_dir = cache_dir
        self.python = python
        self._flags: set[str] = set()
        self._flags_generation = -1
        self._flags_lock = threading.Lock()
        # Processos vivos: ao desligar o servidor, todos são encerrados (com o FFmpeg junto).
        self._procs: set[subprocess.Popen] = set()
        self._procs_lock = threading.Lock()

    def _track(self, proc: subprocess.Popen) -> None:
        with self._procs_lock:
            self._procs.add(proc)

    def _untrack(self, proc: subprocess.Popen) -> None:
        with self._procs_lock:
            self._procs.discard(proc)

    def kill_all(self) -> None:
        with self._procs_lock:
            procs = list(self._procs)
        for proc in procs:
            kill_tree(proc)

    # ------------------------------------------------------------------ processo

    def _env(self) -> dict[str, str]:
        return {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}

    def _process_kwargs(self) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"env": self._env(), "stdin": subprocess.DEVNULL, "text": True, "encoding": "utf-8", "errors": "replace"}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        return kwargs

    def supported_flags(self) -> set[str]:
        """Opções que esta versão do yt-dlp entende (relido depois de cada atualização)."""
        with self._flags_lock:
            if self._flags_generation != self.updater.generation:
                try:
                    result = subprocess.run([self.python, "-m", "yt_dlp", "--help"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                            timeout=60, **{k: v for k, v in self._process_kwargs().items() if k != "stdin"})
                    self._flags = {token.rstrip(",") for token in result.stdout.split() if token.startswith("--")}
                except (OSError, subprocess.SubprocessError):
                    self._flags = set()
                self._flags_generation = self.updater.generation
            return self._flags

    def base_command(self) -> list[str]:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cmd = [
            self.python, "-m", "yt_dlp",
            "--ignore-config", "--no-warnings", "--color", "never",
            "--socket-timeout", "25", "--retries", "3",
            "--cache-dir", str(self.cache_dir),
        ]
        # O YouTube (2025+) exige um runtime JavaScript para os desafios; o Node é o mais fácil de ter no PC.
        if shutil.which("node") and "--js-runtimes" in self.supported_flags():
            cmd += ["--js-runtimes", "node"]
        return cmd + list(self.settings.ytdlp_args)

    def _json(self, args: list[str], timeout: int) -> dict[str, Any]:
        with self.updater.running():
            cmd = self.base_command() + args
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **self._process_kwargs())
            self._track(proc)
            try:
                stdout, stderr = proc.communicate(timeout=timeout)
            except subprocess.TimeoutExpired as exc:
                kill_tree(proc)
                proc.communicate()
                raise YtDlpError("ERROR: timed out") from exc
            finally:
                self._untrack(proc)
        result = subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)
        if result.returncode != 0:
            output = (result.stderr or "")[-6000:]
            raise YtDlpError(last_error(output) or "ERROR: falha ao ler o link", output)
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise YtDlpError("ERROR: resposta inválida do yt-dlp", (result.stderr or "")[-6000:]) from exc
        if not isinstance(data, dict):
            raise YtDlpError("ERROR: resposta inválida do yt-dlp")
        return data

    # ------------------------------------------------------------------ leitura

    def extract(self, url: str, *, playlist: bool = False) -> dict[str, Any]:
        """
        Metadados. Sem `playlist`, um link de vídeo dentro de playlist (watch?v=…&list=…) devolve só o
        vídeo; um link que é só playlist devolve a lista "rasa" (rápida, sem os formatos de cada vídeo).
        """
        args = ["-J", "--flat-playlist", "--playlist-items", f"1:{self.settings.playlist_limit}"]
        args.append("--yes-playlist" if playlist else "--no-playlist")
        return self._json(args + ["--", url], self.settings.resolve_timeout)

    def search(self, query: str, limit: int) -> dict[str, Any]:
        return self._json(["-J", "--flat-playlist", "--", f"ytsearch{limit}:{query}"], self.settings.resolve_timeout)

    # ------------------------------------------------------------------ download

    def download(
        self,
        *,
        source: str,
        from_info: bool,
        plan: Plan,
        out_dir: Path,
        on_progress: Callable[[Progress], None],
        cancel: threading.Event,
        with_thumbnail: bool = True,
    ) -> Path | None:
        """Baixa (e junta/converte) para `out_dir`. Devolve o arquivo final, se o yt-dlp informou."""
        with self.updater.running():
            return self._download(source, from_info, plan, out_dir, on_progress, cancel, with_thumbnail)

    def _download(
        self,
        source: str,
        from_info: bool,
        plan: Plan,
        out_dir: Path,
        on_progress: Callable[[Progress], None],
        cancel: threading.Event,
        with_thumbnail: bool,
    ) -> Path | None:
        out_dir.mkdir(parents=True, exist_ok=True)
        args = [
            "--no-playlist", "--no-mtime", "--windows-filenames",
            "--concurrent-fragments", "4",
            "--newline", "--progress",
            "--progress-template", f"download:{DL_TEMPLATE}",
            "--progress-template", f"postprocess:{PP_TEMPLATE}",
            "--print", f"after_move:{FILE_PREFIX}%(filepath)s",
            "--no-simulate",
            "-o", str(out_dir / "media.%(ext)s"),
            *plan.command_args(with_thumbnail=with_thumbnail),
        ]
        args += ["--load-info-json", source] if from_info else ["--", source]
        cmd = self.base_command() + args

        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=1, **self._process_kwargs())
        self._track(proc)
        deadline = time.monotonic() + self.settings.job_timeout
        finished = threading.Event()
        timed_out = threading.Event()

        def watch() -> None:
            while not finished.wait(0.5):
                if cancel.is_set():
                    kill_tree(proc)
                    return
                if time.monotonic() > deadline:
                    timed_out.set()
                    kill_tree(proc)
                    return

        threading.Thread(target=watch, name="ritmo-watch", daemon=True).start()
        final: Path | None = None
        tail: deque[str] = deque(maxlen=80)
        try:
            assert proc.stdout is not None
            for raw in proc.stdout:
                line = raw.rstrip("\r\n")
                if not line:
                    continue
                if line.startswith(FILE_PREFIX):
                    final = Path(line[len(FILE_PREFIX):].strip())
                    continue
                progress = parse_progress(line)
                if progress is not None:
                    on_progress(progress)
                    continue
                tail.append(line)
            code = proc.wait()
        finally:
            finished.set()
            if proc.poll() is None:
                kill_tree(proc)
            self._untrack(proc)
        if cancel.is_set():
            raise Cancelled()
        output = "\n".join(tail)
        if timed_out.is_set():
            raise YtDlpError("ERROR: timed out (download demorou demais)", output)
        if code != 0:
            raise YtDlpError(last_error(output) or f"ERROR: yt-dlp terminou com código {code}", output)
        return final
