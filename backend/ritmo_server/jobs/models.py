"""Modelos em memória: o link lido (Resolved) e cada download (Job)."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..ytdlp.formats import Plan

# Estados que o app conhece.
QUEUED = "queued"
DOWNLOADING = "downloading"
CONVERTING = "converting"
READY = "ready"
ERROR = "error"
CANCELLED = "cancelled"
ACTIVE = {QUEUED, DOWNLOADING, CONVERTING}
FINISHED = {ERROR, CANCELLED}


@dataclass
class Resolved:
    """Um link lido no /resolve. Vale `resolve_ttl` segundos."""

    token: str
    kind: str  # "video" | "playlist"
    url: str
    title: str
    payload: dict[str, Any]  # o que o app recebe
    options: dict[str, dict[str, Any]] = field(default_factory=dict)  # opções de vídeo, com o format_id real
    entries: dict[str, dict[str, Any]] = field(default_factory=dict)  # playlist: id → vídeo
    info_file: Path | None = None  # metadados completos, para baixar sem ler o site de novo
    created: float = field(default_factory=time.time)


@dataclass
class Job:
    id: str
    token: str
    format_id: str
    plan: Plan
    source_url: str
    title: str
    subtitles: str | None = None
    info_file: Path | None = None
    entry_id: str | None = None
    batch_id: str | None = None

    status: str = QUEUED
    progress: float = 0.0
    stage: str = "Na fila"
    error: str | None = None
    code: str | None = None
    created: float = field(default_factory=time.time)
    updated: float = field(default_factory=time.time)
    finished_at: float | None = None
    file: dict[str, Any] | None = None
    path: Path | None = None
    delivered_at: float | None = None
    # Até que byte o celular já recebeu em sequência (retomadas somam) e o último acesso ao arquivo.
    sent_upto: int = 0
    last_access: float | None = None
    cancel: threading.Event = field(default_factory=threading.Event, repr=False)

    def public(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "id": self.id,
            "status": self.status,
            "progress": round(self.progress, 3),
            "stage": self.stage,
            "title": self.title,
        }
        if self.entry_id:
            data["entryId"] = self.entry_id
        if self.batch_id:
            data["batchId"] = self.batch_id
        if self.error:
            data["error"] = self.error
            data["code"] = self.code
        if self.file:
            data["file"] = self.file
        return data
