"""Status do servidor e atualização manual do yt-dlp."""

from __future__ import annotations

import shutil
from typing import Any

from fastapi import APIRouter, Depends

from .. import __version__
from ..core.net import lan_ip
from ..services import Services
from .deps import require_key, services

router = APIRouter()


def _ytdlp_version(svc: Services) -> str:
    return svc.updater.version or svc.updater.current_version()


@router.get("/")
def index(svc: Services = Depends(services)) -> dict[str, Any]:
    return {
        "app": "Player Downloader",
        "ok": True,
        "version": __version__,
        "ytdlp": _ytdlp_version(svc),
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "auth": bool(svc.settings.api_key),
    }


@router.get("/health", dependencies=[Depends(require_key)])
def health(svc: Services = Depends(services)) -> dict[str, Any]:
    """O que o botão "Testar conexão" do app usa."""
    return {
        "ok": True,
        "version": __version__,
        "ytdlp": _ytdlp_version(svc),
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "node": bool(shutil.which("node")),
        "url": f"http://{lan_ip()}:{svc.settings.port}",
        "auth": bool(svc.settings.api_key),
        "cookies": svc.cookies.status(),
        "update": svc.updater.info(),
        "queue": svc.registry.snapshot(),
    }


@router.post("/update", dependencies=[Depends(require_key)])
def update(svc: Services = Depends(services)) -> dict[str, Any]:
    """Atualiza o yt-dlp agora (botão "Atualizar" do app)."""
    changed = svc.updater.update("pedido pelo app")
    return {"updated": changed, "ytdlp": svc.updater.version}
