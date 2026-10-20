"""
Relatórios de erro: o app manda os erros que acontecem no celular e o servidor guarda, para a
gente corrigir. É a única coisa que o servidor guarda de propósito (os vídeos são temporários).

Formato: uma linha JSON por erro em `logs/app-errors.jsonl`, com rodízio por tamanho
(app-errors.1.jsonl, .2 …). Os erros inesperados do próprio servidor entram no mesmo arquivo.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from pathlib import Path
from typing import Any, Iterator

MAX_MESSAGE = 2_000
MAX_STACK = 8_000
MAX_EXTRA = 4_000
MAX_FIELD = 200

_NOISE = re.compile(r"https?://\S+|[0-9a-f]{8,}|\d+")


def _text(value: Any, limit: int) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return text[:limit]


def fingerprint(source: str, message: str) -> str:
    """Mesmo erro com números/links diferentes cai no mesmo grupo."""
    normalized = _NOISE.sub("#", f"{source}|{message}".lower())[:500]
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]


def _clean_device(device: dict[str, Any] | None) -> dict[str, str]:
    allowed = ("app", "version", "build", "platform", "os", "model", "language", "install")
    device = device or {}
    return {key: _text(device[key], MAX_FIELD) for key in allowed if device.get(key) not in (None, "")}


def _clean_entry(entry: dict[str, Any]) -> dict[str, Any] | None:
    message = _text(entry.get("message") or "", MAX_MESSAGE).strip()
    if not message:
        return None
    source = _text(entry.get("source") or "Erro", MAX_FIELD)
    out: dict[str, Any] = {
        "at": _text(entry.get("at") or "", 40),
        "source": source,
        "message": message,
        "fp": fingerprint(source, message),
    }
    if entry.get("stack"):
        out["stack"] = _text(entry["stack"], MAX_STACK)
    if entry.get("extra"):
        out["extra"] = _text(entry["extra"], MAX_EXTRA)
    if entry.get("fatal"):
        out["fatal"] = True
    try:
        count = int(entry.get("count") or 1)
    except (TypeError, ValueError, OverflowError):
        count = 1
    out["count"] = max(1, min(count, 10_000))
    if entry.get("screen"):
        out["screen"] = _text(entry["screen"], MAX_FIELD)
    return out


class ErrorReports:
    def __init__(self, directory: Path, *, max_bytes: int = 5_000_000, backups: int = 5) -> None:
        self.directory = directory
        self.max_bytes = max_bytes
        self.backups = backups
        self._lock = threading.Lock()

    @property
    def file(self) -> Path:
        return self.directory / "app-errors.jsonl"

    def _rotate(self) -> None:
        if not self.file.exists() or self.file.stat().st_size < self.max_bytes:
            return
        oldest = self.directory / f"app-errors.{self.backups}.jsonl"
        oldest.unlink(missing_ok=True)
        for index in range(self.backups - 1, 0, -1):
            source = self.directory / f"app-errors.{index}.jsonl"
            if source.exists():
                source.replace(self.directory / f"app-errors.{index + 1}.jsonl")
        self.file.replace(self.directory / "app-errors.1.jsonl")

    def append(self, device: dict[str, Any] | None, entries: list[dict[str, Any]], *, client: str | None = None) -> int:
        clean_device = _clean_device(device)
        received = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        lines: list[str] = []
        for raw in entries:
            if not isinstance(raw, dict):
                continue
            entry = _clean_entry(raw)
            if entry is None:
                continue
            entry["received"] = received
            entry["device"] = clean_device
            if client:
                entry["client"] = client
            lines.append(json.dumps(entry, ensure_ascii=False))
        if not lines:
            return 0
        with self._lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            self._rotate()
            with self.file.open("a", encoding="utf-8") as handle:
                handle.write("\n".join(lines) + "\n")
        return len(lines)

    def server_error(self, message: str, *, source: str = "Servidor", extra: dict[str, Any] | None = None) -> None:
        """Erros inesperados do próprio servidor (falhas de download sem explicação, exceções)."""
        from . import __version__

        self.append(
            {"app": "ritmo-server", "version": __version__, "platform": "server"},
            [{"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "source": source, "message": message, "extra": extra or None}],
        )

    def _files(self) -> list[Path]:
        backups = [self.directory / f"app-errors.{index}.jsonl" for index in range(1, self.backups + 1)]
        return [path for path in [self.file, *backups] if path.exists()]

    def iter_entries(self) -> Iterator[dict[str, Any]]:
        """Do mais novo para o mais antigo."""
        with self._lock:
            files = self._files()
            contents = [path.read_text(encoding="utf-8", errors="replace").splitlines() for path in files]
        for lines in contents:
            for line in reversed(lines):
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(entry, dict):
                    yield entry

    def recent(self, *, limit: int = 100, query: str = "", platform: str = "") -> list[dict[str, Any]]:
        query = query.lower().strip()
        out: list[dict[str, Any]] = []
        for entry in self.iter_entries():
            if platform and entry.get("device", {}).get("platform") != platform:
                continue
            if query and query not in f"{entry.get('source', '')} {entry.get('message', '')}".lower():
                continue
            out.append(entry)
            if len(out) >= limit:
                break
        return out

    def summary(self, *, limit: int = 50) -> list[dict[str, Any]]:
        """Erros agrupados (mesma origem e mensagem), os mais frequentes primeiro."""
        groups: dict[str, dict[str, Any]] = {}
        for entry in self.iter_entries():
            fp = entry.get("fp") or fingerprint(entry.get("source", ""), entry.get("message", ""))
            device = entry.get("device") or {}
            group = groups.get(fp)
            if group is None:
                group = groups[fp] = {
                    "fp": fp,
                    "source": entry.get("source"),
                    "message": entry.get("message"),
                    "stack": entry.get("stack"),
                    "count": 0,
                    "lastAt": entry.get("received") or entry.get("at"),
                    "firstAt": entry.get("received") or entry.get("at"),
                    "platforms": set(),
                    "versions": set(),
                    "installs": set(),
                }
            group["count"] += int(entry.get("count") or 1)
            group["firstAt"] = entry.get("received") or entry.get("at") or group["firstAt"]
            if device.get("platform"):
                group["platforms"].add(device["platform"])
            if device.get("version"):
                group["versions"].add(device["version"])
            if device.get("install"):
                group["installs"].add(device["install"])
        out = []
        for group in sorted(groups.values(), key=lambda g: g["count"], reverse=True)[:limit]:
            out.append({
                **group,
                "platforms": sorted(group["platforms"]),
                "versions": sorted(group["versions"]),
                "devices": len(group.pop("installs")),
            })
        return out

    def clear(self) -> None:
        with self._lock:
            for path in self._files():
                path.unlink(missing_ok=True)
