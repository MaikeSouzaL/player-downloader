"""Transforma o JSON do yt-dlp no que o app mostra (vídeo, playlist, resultados de busca)."""

from __future__ import annotations

import json
import uuid
from typing import Any
from urllib.parse import parse_qs, urlsplit

from ..core.errors import UserError
from ..jobs.models import Resolved
from ..jobs.storage import TempStorage
from .formats import audio_options, playlist_subtitle_options, playlist_video_options, subtitle_options, video_options


def _thumbnail(item: dict[str, Any]) -> str | None:
    if item.get("thumbnail"):
        return item["thumbnail"]
    thumbs = [t for t in item.get("thumbnails") or [] if t.get("url")]
    if not thumbs:
        return None
    # Uma do tamanho de lista (~320–480 px) carrega rápido no celular.
    sized = [t for t in thumbs if 240 <= (t.get("width") or 0) <= 720]
    return (sized or thumbs)[-1]["url"]


def _uploader(item: dict[str, Any]) -> str | None:
    return item.get("uploader") or item.get("channel") or item.get("creator") or item.get("artist")


def _duration(item: dict[str, Any]) -> float:
    try:
        return float(item.get("duration") or 0)
    except (TypeError, ValueError):
        return 0.0


def entry_item(entry: dict[str, Any]) -> dict[str, Any] | None:
    """Um vídeo de playlist ou da busca. Sem link http não dá para baixar: fica de fora."""
    url = entry.get("webpage_url") or entry.get("url") or ""
    if not url.startswith(("http://", "https://")):
        if entry.get("ie_key") == "Youtube" and entry.get("id"):
            url = f"https://www.youtube.com/watch?v={entry['id']}"
        else:
            return None
    return {
        "id": str(entry.get("id") or url),
        "url": url,
        "title": (entry.get("title") or "Sem título").strip(),
        "uploader": _uploader(entry),
        "duration": _duration(entry),
        "thumbnail": _thumbnail(entry),
    }


def youtube_playlist_url(url: str) -> str | None:
    """watch?v=…&list=… → link da playlist inteira (para oferecer "baixar todos")."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if not (host.endswith("youtube.com") or host == "youtu.be"):
        return None
    playlist = parse_qs(parts.query).get("list", [None])[0]
    if not playlist or playlist.startswith(("RD", "UL", "LL", "WL")):
        return None  # mixes automáticos, "curtidos" e "assistir depois" não são playlists públicas
    return f"https://www.youtube.com/playlist?list={playlist}"


def build_resolved(info: dict[str, Any], url: str, storage: TempStorage) -> Resolved:
    if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
        raise UserError("Transmissões ao vivo e estreias não podem ser baixadas.", code="live")
    token = uuid.uuid4().hex
    base = {
        "token": token,
        "url": info.get("webpage_url") or url,
        "title": (info.get("title") or "Sem título").strip(),
        "uploader": _uploader(info),
        "thumbnail": _thumbnail(info),
        "extractor": info.get("extractor_key") or info.get("extractor"),
    }

    if info.get("_type") in {"playlist", "multi_video"}:
        items = [item for item in (entry_item(e) for e in info.get("entries") or [] if e) if item]
        if not items:
            raise UserError("A playlist está vazia ou é privada.", code="empty")
        payload = {
            **base,
            "kind": "playlist",
            "thumbnail": base["thumbnail"] or items[0]["thumbnail"],
            "duration": sum(item["duration"] for item in items),
            "playlist": {"title": base["title"], "count": int(info.get("playlist_count") or len(items)), "entries": items},
            "playlistUrl": None,
            "formats": playlist_video_options(),
            "audio": audio_options(None),
            "subtitles": playlist_subtitle_options(),
        }
        return Resolved(
            token=token, kind="playlist", url=payload["url"], title=base["title"], payload=payload,
            entries={item["id"]: item for item in items},
        )

    options = video_options(info)
    info_file = storage.info_file(token)
    # Os metadados completos ficam no temporário: o download usa sem consultar o site de novo.
    info_file.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
    payload = {
        **base,
        "kind": "video",
        "duration": _duration(info),
        "playlist": None,
        "playlistUrl": youtube_playlist_url(url),
        "formats": [{k: v for k, v in option.items() if not k.startswith("_")} for option in options],
        "audio": audio_options(info),
        "subtitles": subtitle_options(info),
    }
    return Resolved(
        token=token, kind="video", url=payload["url"], title=base["title"], payload=payload,
        options={option["id"]: option for option in options}, info_file=info_file,
    )


def search_items(info: dict[str, Any]) -> list[dict[str, Any]]:
    return [item for item in (entry_item(e) for e in info.get("entries") or [] if e) if item]
