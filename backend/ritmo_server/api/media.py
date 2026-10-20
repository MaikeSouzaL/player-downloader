"""Ler um link (qualidades, playlist, legendas) e buscar no YouTube."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from ..core.errors import UserError
from ..core.net import validate_url
from ..services import Services
from ..ytdlp.media import build_resolved, search_items
from .deps import require_key, services, with_update
from .schemas import ResolveBody

router = APIRouter(dependencies=[Depends(require_key)])


@router.post("/resolve")
def resolve(body: ResolveBody, svc: Services = Depends(services)) -> dict[str, Any]:
    url = validate_url(body.url, allow_private=svc.settings.allow_private_hosts)
    info = with_update(svc, lambda: svc.runner.extract(url, playlist=body.playlist))
    resolved = build_resolved(info, url, svc.storage)
    svc.registry.add_resolved(resolved)
    return resolved.payload


@router.get("/search")
def search(q: str = Query(..., max_length=200), limit: int = Query(15, ge=1, le=30), svc: Services = Depends(services)) -> dict[str, Any]:
    query = q.strip()
    if len(query) < 2:
        raise UserError("Digite pelo menos 2 letras.", code="invalid", status=400)
    info = with_update(svc, lambda: svc.runner.search(query, limit), "buscar")
    return {"items": search_items(info)}
