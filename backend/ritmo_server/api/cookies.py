"""Cookies da conta do YouTube enviados pelo app (ficam só na memória do servidor)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..services import Services
from .deps import require_key, services

router = APIRouter(dependencies=[Depends(require_key)])


class CookiesBody(BaseModel):
    # Sem max_length no Pydantic: o erro não deve repetir o conteúdo dos cookies.
    cookies: str = ""


@router.get("/cookies")
def cookie_status(svc: Services = Depends(services)) -> dict[str, Any]:
    """Só diz se há cookies e quando foram enviados; nunca devolve o conteúdo."""
    return svc.cookies.status()


@router.post("/cookies")
def cookie_save(body: CookiesBody, svc: Services = Depends(services)) -> dict[str, Any]:
    return svc.cookies.save(body.cookies)


@router.delete("/cookies")
def cookie_remove(svc: Services = Depends(services)) -> dict[str, bool]:
    svc.cookies.clear()
    return {"ok": True}
