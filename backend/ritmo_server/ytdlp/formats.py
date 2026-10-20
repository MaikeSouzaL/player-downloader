"""
Opções que o app mostra (qualidades de vídeo, formatos de áudio, legendas) e o plano de
download do yt-dlp para cada uma.

IDs públicos:
  v:<format_id>   vídeo de um formato exato (link de um vídeo só)
  h:<altura>      melhor vídeo até essa altura (playlists, onde cada vídeo tem formatos diferentes)
  a:mp3:<kbps>    MP3 nessa qualidade;  a:m4a:0  M4A/AAC sem recodificar quando possível
  s:<idioma>      legenda escrita;      as:<idioma>  legenda automática
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from ..core.errors import UserError

# Do melhor para o pior: o M4A é o áudio original do site, sem recodificar; MP3 sempre recodifica.
AUDIO_PRESETS: list[dict[str, Any]] = [
    {"id": "a:m4a:0", "label": "M4A · AAC", "ext": "m4a", "bitrate": 0},
    {"id": "a:mp3:320", "label": "MP3 320 kbps", "ext": "mp3", "bitrate": 320},
    {"id": "a:mp3:192", "label": "MP3 192 kbps", "ext": "mp3", "bitrate": 192},
    {"id": "a:mp3:128", "label": "MP3 128 kbps", "ext": "mp3", "bitrate": 128},
]

PLAYLIST_HEIGHTS = [1080, 720, 480, 360]
PLAYLIST_SUBTITLES = ["pt", "en", "es"]

LANG_NAMES = {
    "pt": "Português",
    "pt-BR": "Português (Brasil)",
    "pt-PT": "Português (Portugal)",
    "en": "English",
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "es": "Español",
    "es-419": "Español (Latinoamérica)",
    "fr": "Français",
    "de": "Deutsch",
    "it": "Italiano",
    "ja": "日本語",
    "ko": "한국어",
    "zh-Hans": "中文 (简体)",
    "zh-Hant": "中文 (繁體)",
    "ru": "Русский",
    "ar": "العربية",
    "hi": "हिन्दी",
}


@dataclass(frozen=True)
class Plan:
    """Como baixar uma opção: seletor `-f`, argumentos extras e o que esperar no fim."""

    media: str  # "video" | "audio"
    format: str
    args: tuple[str, ...]
    streams: int  # quantos arquivos o yt-dlp baixa (vídeo + áudio = 2), para o progresso
    embed_thumbnail: bool = False

    def command_args(self, *, with_thumbnail: bool = True) -> list[str]:
        args = ["-f", self.format, *self.args]
        if self.embed_thumbnail and with_thumbnail:
            args += ["--embed-thumbnail", "--convert-thumbnails", "jpg"]
        return args


def _size(fmt: dict[str, Any]) -> int:
    try:
        return int(fmt.get("filesize") or fmt.get("filesize_approx") or 0)
    except (TypeError, ValueError):
        return 0


def codec_label(vcodec: str | None) -> str:
    value = (vcodec or "").lower()
    if value.startswith(("avc", "h264")):
        return "H.264"
    if value.startswith(("hev", "hvc", "h265")):
        return "H.265"
    if value.startswith(("vp9", "vp09")):
        return "VP9"
    if value.startswith("av01"):
        return "AV1"
    if value.startswith("vp8"):
        return "VP8"
    if not value or value == "none":
        return ""
    return value.split(".")[0].upper()


def _has_video(fmt: dict[str, Any]) -> bool:
    return fmt.get("vcodec") not in (None, "none") and (fmt.get("height") or 0) > 0


def _has_audio(fmt: dict[str, Any]) -> bool:
    return fmt.get("acodec") not in (None, "none")


def best_audio_size(info: dict[str, Any]) -> int:
    """Tamanho do melhor áudio separado (prefere M4A, que é o que juntamos no MP4)."""
    audios = [f for f in info.get("formats") or [] if _has_audio(f) and not _has_video(f)]
    m4a = [f for f in audios if (f.get("ext") or "") == "m4a"]
    pool = m4a or audios
    return max((_size(f) for f in pool), default=0)


def video_options(info: dict[str, Any]) -> list[dict[str, Any]]:
    """Uma opção por altura, preferindo MP4/H.264 (toca em qualquer aparelho, inclusive iPhone)."""
    audio_size = best_audio_size(info)
    best: dict[int, tuple[tuple, dict[str, Any]]] = {}
    for fmt in info.get("formats") or []:
        if not _has_video(fmt) or not fmt.get("format_id"):
            continue
        if (fmt.get("protocol") or "").startswith(("mhtml",)):
            continue  # "storyboard" (miniaturas), não é vídeo
        height = int(fmt.get("height") or 0)
        has_audio = _has_audio(fmt)
        ext = (fmt.get("ext") or "").lower()
        codec = codec_label(fmt.get("vcodec"))
        fps = fmt.get("fps") or 0
        score = (
            1 if codec == "H.264" else 0,
            1 if ext == "mp4" else 0,
            1 if has_audio else 0,
            float(fps or 0),
            float(fmt.get("tbr") or 0),
        )
        current = best.get(height)
        if current is not None and current[0] >= score:
            continue
        size = _size(fmt)
        best[height] = (
            score,
            {
                "id": f"v:{fmt['format_id']}",
                "label": f"{height}p{int(fps) if fps and fps >= 50 else ''}",
                "ext": "mp4" if not has_audio or ext == "mp4" else ext,
                "height": height,
                "fps": fps or None,
                "codec": codec or None,
                # H.264 toca em tudo; VP9/AV1 (2K/4K do YouTube) podem não tocar em iPhones mais antigos.
                "compatible": codec == "H.264",
                "filesize": size + (0 if has_audio or not size else audio_size),
                "hasAudio": has_audio,
                "_format_id": str(fmt["format_id"]),
            },
        )
    return [option for _, option in sorted(best.values(), key=lambda item: item[1]["height"], reverse=True)]


def audio_options(info: dict[str, Any] | None) -> list[dict[str, Any]]:
    size = best_audio_size(info) if info else 0
    return [{**preset, "filesize": size if preset["bitrate"] == 0 else 0} for preset in AUDIO_PRESETS]


def playlist_video_options() -> list[dict[str, Any]]:
    return [
        {"id": f"h:{height}", "label": f"≤ {height}p", "ext": "mp4", "height": height, "codec": "H.264", "compatible": True, "hasAudio": True, "filesize": 0}
        for height in PLAYLIST_HEIGHTS
    ]


def _lang_name(lang: str, tracks: list[dict[str, Any]] | None) -> str:
    base = lang.removesuffix("-orig")
    name = LANG_NAMES.get(base) or LANG_NAMES.get(base.split("-")[0])
    if not name and tracks:
        name = next((t.get("name") for t in tracks if t.get("name")), None)
    return name or base


def subtitle_options(info: dict[str, Any]) -> list[dict[str, Any]]:
    """Legendas escritas do vídeo + as automáticas mais úteis (idioma original, pt, en, es)."""
    out: list[dict[str, Any]] = []
    manual = info.get("subtitles") or {}
    for lang, tracks in manual.items():
        if lang == "live_chat" or not tracks:
            continue
        out.append({"id": f"s:{lang}", "lang": lang, "name": _lang_name(lang, tracks), "auto": False})
    have = {item["lang"].split("-")[0] for item in out}
    auto = info.get("automatic_captions") or {}
    wanted = [lang for lang in auto if lang.endswith("-orig")] + ["pt", "pt-BR", "en", "es"]
    for lang in wanted:
        tracks = auto.get(lang)
        base = lang.removesuffix("-orig")
        if not tracks or base.split("-")[0] in have:
            continue
        have.add(base.split("-")[0])
        out.append({"id": f"as:{lang}", "lang": base, "name": _lang_name(lang, tracks), "auto": True})
    return out[:25]


def playlist_subtitle_options() -> list[dict[str, Any]]:
    """Em playlist cada vídeo tem as suas: oferece os idiomas comuns, usados quando existirem."""
    return [{"id": f"as:{lang}", "lang": lang, "name": LANG_NAMES[lang], "auto": True} for lang in PLAYLIST_SUBTITLES]


def subtitle_args(sub_id: str | None, *, playlist: bool) -> list[str]:
    if not sub_id:
        return []
    kind, _, lang = sub_id.partition(":")
    if kind not in {"s", "as"} or not re.fullmatch(r"[A-Za-z0-9-]{2,20}", lang):
        raise UserError("Legenda inválida. Leia o link de novo.", code="subtitle", status=400)
    if playlist:
        # Escrita se existir, senão a automática; qualquer variante do idioma (pt, pt-BR…).
        return ["--embed-subs", "--write-subs", "--write-auto-subs", "--sub-langs", f"{re.escape(lang)}(-.*)?"]
    args = ["--embed-subs", "--sub-langs", re.escape(lang)]
    if kind == "as":
        args.insert(1, "--write-auto-subs")
    return args


VIDEO_ARGS = ("--merge-output-format", "mp4", "--embed-metadata")


def plan_for(public_id: str, *, options: dict[str, dict[str, Any]] | None, subtitles: str | None, playlist: bool) -> Plan:
    """Plano do yt-dlp para a opção escolhida no app."""
    kind, _, rest = public_id.partition(":")
    if kind == "a":
        preset = next((p for p in AUDIO_PRESETS if p["id"] == public_id), None)
        if preset is None:
            raise UserError("Formato não encontrado. Leia o link de novo.", code="format", status=400)
        if preset["ext"] == "m4a":
            # Áudio AAC original: só troca o recipiente, sem perder qualidade.
            return Plan("audio", "bestaudio[ext=m4a]/bestaudio/best", ("-x", "--audio-format", "m4a", "--audio-quality", "0", "--embed-metadata"), 1, True)
        return Plan(
            "audio",
            "bestaudio/best",
            ("-x", "--audio-format", "mp3", "--audio-quality", f"{preset['bitrate']}K", "--embed-metadata"),
            1,
            True,
        )

    subs = tuple(subtitle_args(subtitles, playlist=playlist))
    if kind == "h":
        if not re.fullmatch(r"[0-9]{2,4}", rest):
            raise UserError("Qualidade inválida.", code="format", status=400)
        height = int(rest)
        selector = (
            f"bv*[height<={height}][vcodec^=avc1]+ba[ext=m4a]/"
            f"bv*[height<={height}]+ba[ext=m4a]/bv*[height<={height}]+ba/"
            f"b[height<={height}]/b"
        )
        return Plan("video", selector, (*VIDEO_ARGS, *subs), 2)

    if kind == "v":
        option = (options or {}).get(public_id)
        if option is None:
            raise UserError("Qualidade não encontrada. Leia o link de novo.", code="format", status=400)
        raw = option["_format_id"]
        if option["hasAudio"]:
            return Plan("video", raw, (*VIDEO_ARGS, *subs), 1)
        return Plan("video", f"{raw}+bestaudio[ext=m4a]/{raw}+bestaudio/{raw}", (*VIDEO_ARGS, *subs), 2)

    raise UserError("Formato não encontrado. Leia o link de novo.", code="format", status=400)
