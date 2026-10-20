"""Corpos dos pedidos."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ResolveBody(BaseModel):
    url: str
    # True: lê a playlist inteira (lista rasa) mesmo num link de vídeo com &list=…
    playlist: bool = False
    # Cookies do YouTube do aparelho; usados só nesta chamada e apagados no fim.
    cookies: str | None = None


class SearchBody(BaseModel):
    q: str
    limit: int = Field(15, ge=1, le=30)
    # Cookies do YouTube do aparelho; usados só nesta busca.
    cookies: str | None = None


class DownloadBody(BaseModel):
    token: str
    formatId: str
    # "s:pt" (legenda escrita) ou "as:pt" (automática); só para vídeo.
    subtitles: str | None = None
    # Playlist: IDs dos vídeos escolhidos (vazio = todos).
    entries: list[str] | None = Field(default=None, max_length=500)
    # Cookies do YouTube do aparelho; ficam no job em memória até ele terminar.
    cookies: str | None = None
