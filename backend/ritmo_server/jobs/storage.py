"""
Arquivos temporários. Tudo vive numa pasta própria dentro do temp do sistema, que é apagada
ao subir e ao desligar o servidor. Cada download tem a sua subpasta, apagada assim que o
celular termina de baixar (ou quando expira).
"""

from __future__ import annotations

import logging
import re
import shutil
import time
from pathlib import Path

log = logging.getLogger("ritmo.storage")

# Restos do yt-dlp que nunca são o arquivo final.
TEMP_SUFFIXES = {".part", ".ytdl", ".temp", ".tmp", ".jpg", ".jpeg", ".webp", ".png", ".vtt", ".srt", ".ass", ".json"}


_ID = re.compile(r"[0-9a-f]{32}")


def valid_id(value: str) -> bool:
    """IDs de download e de leitura são sempre 32 caracteres hex (uuid4().hex)."""
    return isinstance(value, str) and _ID.fullmatch(value) is not None


def remove_tree(path: Path, attempts: int = 5) -> bool:
    """Apaga a pasta; no Windows um arquivo recém-fechado pode ficar preso por instantes."""
    for attempt in range(attempts):
        try:
            shutil.rmtree(path)
            return True
        except FileNotFoundError:
            return True
        except OSError:
            time.sleep(0.2 * (attempt + 1))
    return not path.exists()


class TempStorage:
    def __init__(self, base: Path) -> None:
        if base.name != "ritmo-downloader":
            # Proteção: a limpeza só age na pasta do próprio servidor.
            base = base / "ritmo-downloader"
        self.base = base
        self.jobs = base / "jobs"
        self.infos = base / "info"
        self.cache = base / "cache"

    def reset(self) -> None:
        """Começa (ou termina) do zero: nada de uma execução anterior fica no disco."""
        remove_tree(self.base)
        for path in (self.jobs, self.infos, self.cache):
            path.mkdir(parents=True, exist_ok=True)

    def _inside(self, parent: Path, name: str) -> Path | None:
        """Caminho de um ID dentro da pasta do servidor; None se o ID não é válido ou escaparia dela."""
        if not valid_id(name):
            return None
        path = (parent / name).resolve()
        return path if path.parent == parent.resolve() else None

    def job_dir(self, job_id: str) -> Path:
        path = self._inside(self.jobs, job_id)
        if path is None:
            raise ValueError(f"ID de download inválido: {job_id!r}")
        path.mkdir(parents=True, exist_ok=True)
        return path

    def info_file(self, token: str) -> Path:
        self.infos.mkdir(parents=True, exist_ok=True)
        if not valid_id(token):
            raise ValueError(f"Token inválido: {token!r}")
        return self.infos / f"{token}.json"

    def clear_dir(self, path: Path) -> None:
        """Apaga o que ficou de uma tentativa que falhou, mantendo a pasta."""
        if not path.exists():
            return
        for child in path.iterdir():
            if child.is_dir():
                remove_tree(child)
            else:
                child.unlink(missing_ok=True)

    def remove_job(self, job_id: str) -> bool:
        path = self._inside(self.jobs, job_id)
        if path is None:
            log.warning("Pedido para apagar uma pasta fora do servidor recusado: %r", job_id)
            return True  # nada a apagar
        return remove_tree(path)

    def remove_info(self, token: str) -> None:
        if not valid_id(token):
            return
        try:
            (self.infos / f"{token}.json").unlink(missing_ok=True)
        except OSError:
            pass  # aberto pelo yt-dlp no Windows: sai na limpeza ao desligar

    @staticmethod
    def pick_output(directory: Path) -> Path | None:
        """O maior arquivo que não é resto (quando o yt-dlp não disse qual é o final)."""
        if not directory.exists():
            return None
        files = [p for p in directory.iterdir() if p.is_file() and p.suffix.lower() not in TEMP_SUFFIXES and ".part" not in p.name]
        return max(files, key=lambda p: p.stat().st_size, default=None)

    def keep_only(self, directory: Path, keep: Path) -> None:
        for child in directory.iterdir():
            if child != keep:
                if child.is_dir():
                    remove_tree(child)
                else:
                    child.unlink(missing_ok=True)
