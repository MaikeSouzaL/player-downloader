"""Configuração do servidor, lida das variáveis de ambiente."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "sim", "on"}


@dataclass(frozen=True)
class Settings:
    # Chave que o app manda em X-Ritmo-Key. Vazia = qualquer aparelho da rede pode usar.
    api_key: str = ""
    port: int = 8787
    # Pasta só de temporários: apagada ao subir e ao desligar. Nada fica guardado.
    temp_dir: Path = Path(tempfile.gettempdir()) / "ritmo-downloader"
    # Relatórios de erro do app (a única coisa que o servidor guarda de propósito).
    log_dir: Path = Path(__file__).resolve().parent.parent / "logs"
    workers: int = 2
    # Leituras de link (/resolve, /search) ao mesmo tempo; as outras esperam a vez.
    max_reads: int = 4

    resolve_ttl: int = 20 * 60  # uma leitura de link vale 20 min
    ready_ttl: int = 60 * 60  # arquivo pronto que ninguém baixou some em 1 h
    delivered_grace: int = 60  # depois de entregue ao celular, apaga em 60 s
    finished_ttl: int = 10 * 60  # erro/cancelado sai da lista em 10 min
    max_queue: int = 200
    max_batch: int = 100
    playlist_limit: int = 200
    resolve_timeout: int = 150
    job_timeout: int = 3 * 60 * 60

    auto_update: bool = True
    # stable: versões normais; nightly: sempre a de teste (corrige o YouTube antes).
    update_channel: str = "stable"
    # Se a estável não resolver o erro, tenta a nightly.
    nightly_fallback: bool = True
    update_cooldown: int = 15 * 60
    update_interval: int = 24 * 60 * 60

    # Links para o próprio PC/rede local (localhost, 192.168…) ficam bloqueados por padrão.
    allow_private_hosts: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        base = os.environ.get("RITMO_TMP") or tempfile.gettempdir()
        channel = os.environ.get("RITMO_YTDLP_CHANNEL", "stable").strip().lower()
        return cls(
            api_key=os.environ.get("RITMO_KEY", "").strip(),
            port=_int("PORT", 8787),
            # Sempre numa subpasta própria: a limpeza nunca apaga a pasta que o usuário indicou.
            temp_dir=Path(base).resolve() / "ritmo-downloader",
            log_dir=Path(os.environ["RITMO_LOGS"]).resolve() if os.environ.get("RITMO_LOGS") else cls.log_dir,
            workers=max(1, min(8, _int("RITMO_WORKERS", 2))),
            auto_update=_bool("RITMO_AUTO_UPDATE", True),
            update_channel=channel if channel in {"stable", "nightly"} else "stable",
            nightly_fallback=_bool("RITMO_NIGHTLY_FALLBACK", True),
            allow_private_hosts=_bool("RITMO_ALLOW_PRIVATE", False),
        )
