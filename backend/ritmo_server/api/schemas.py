"""Corpos dos pedidos."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ResolveBody(BaseModel):
    url: str
    # True: lê a playlist inteira (lista rasa) mesmo num link de vídeo com &list=…
    playlist: bool = False


class DownloadBody(BaseModel):
    token: str
    formatId: str
    # "s:pt" (legenda escrita) ou "as:pt" (automática); só para vídeo.
    subtitles: str | None = None
    # Playlist: IDs dos vídeos escolhidos (vazio = todos).
    entries: list[str] | None = Field(default=None, max_length=500)
