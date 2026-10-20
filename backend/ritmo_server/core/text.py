"""Nomes de arquivo e tipos MIME."""

from __future__ import annotations

import mimetypes
import re

_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')
_SPACES = re.compile(r"\s+")

MIME = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
}


def sanitize_name(name: str, *, limit: int = 120) -> str:
    """Nome seguro em Android, iPhone e Windows (sem barras, sem pontos nas pontas)."""
    clean = _SPACES.sub(" ", _BAD.sub("_", name or "")).strip().strip(".").strip()
    return clean[:limit].strip() or "arquivo"


def output_name(title: str, suffix: str) -> str:
    """"Título do vídeo.mp3" (sem o [id] que o yt-dlp põe no nome)."""
    suffix = suffix if suffix.startswith(".") else f".{suffix}"
    return f"{sanitize_name(title)}{suffix.lower()}"


def mime_for(name: str) -> str:
    lower = name.lower()
    for ext, mime in MIME.items():
        if lower.endswith(ext):
            return mime
    return mimetypes.guess_type(name)[0] or "application/octet-stream"
