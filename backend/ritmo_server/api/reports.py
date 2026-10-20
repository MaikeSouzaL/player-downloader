"""Relatórios de erro do app: receber, listar, agrupar e uma página para ler no navegador do PC."""

from __future__ import annotations

import html
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from ..core.errors import UserError
from ..services import Services
from .deps import require_key, require_key_or_local, services

router = APIRouter()


class ReportBody(BaseModel):
    device: dict[str, Any] | None = None
    entries: list[dict[str, Any]] = Field(default_factory=list, max_length=100)


@router.post("/logs", dependencies=[Depends(require_key)])
def receive(body: ReportBody, request: Request, svc: Services = Depends(services)) -> dict[str, Any]:
    if not body.entries:
        raise UserError("Nenhum erro enviado.", code="empty", status=400)
    client = request.client.host if request.client else None
    saved = svc.reports.append(body.device, body.entries, client=client)
    return {"ok": True, "saved": saved}


@router.get("/logs", dependencies=[Depends(require_key)])
def recent(
    limit: int = Query(100, ge=1, le=1000),
    q: str = Query("", max_length=200),
    platform: str = Query("", max_length=20),
    svc: Services = Depends(services),
) -> dict[str, Any]:
    return {"entries": svc.reports.recent(limit=limit, query=q, platform=platform)}


@router.get("/logs/summary", dependencies=[Depends(require_key)])
def summary(limit: int = Query(50, ge=1, le=500), svc: Services = Depends(services)) -> dict[str, Any]:
    return {"groups": svc.reports.summary(limit=limit)}


@router.delete("/logs", dependencies=[Depends(require_key)])
def clear(svc: Services = Depends(services)) -> dict[str, Any]:
    svc.reports.clear()
    return {"ok": True}


@router.get("/logs/view", response_class=HTMLResponse, dependencies=[Depends(require_key_or_local)])
def view(svc: Services = Depends(services)) -> HTMLResponse:
    """Abra no navegador do próprio PC: http://localhost:8787/logs/view (de outro aparelho, só com a chave)."""
    groups = svc.reports.summary(limit=200)
    rows = []
    for group in groups:
        stack = html.escape(group.get("stack") or "")
        rows.append(
            "<details><summary>"
            f"<b>{group['count']}×</b> <code>{html.escape(str(group.get('source') or ''))}</code> "
            f"{html.escape(str(group.get('message') or ''))}"
            f"<span class=meta>{html.escape(', '.join(group['platforms']))} · v{html.escape(', '.join(group['versions']) or '?')}"
            f" · {group['devices']} aparelho(s) · último {html.escape(str(group.get('lastAt') or ''))}</span>"
            f"</summary><pre>{stack or 'sem stack'}</pre></details>"
        )
    body = "\n".join(rows) or "<p>Nenhum erro recebido. 🎉</p>"
    page = f"""<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Player Downloader · erros</title>
<style>
body{{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:960px;padding:0 16px;color:#1d1d1f;background:#fafafa}}
h1{{font-size:20px}} details{{background:#fff;border:1px solid #e3e3e8;border-radius:10px;margin:8px 0;padding:10px 14px}}
summary{{cursor:pointer}} code{{background:#eef;padding:1px 5px;border-radius:5px}}
.meta{{display:block;color:#6e6e73;font-size:12px;margin-top:4px}} pre{{white-space:pre-wrap;font-size:12px;color:#444}}
@media (prefers-color-scheme:dark){{body{{background:#111;color:#eee}}details{{background:#1c1c1e;border-color:#333}}code{{background:#2c2c44}}pre{{color:#bbb}}}}
</style>
<h1>Erros do Player Downloader ({sum(g['count'] for g in groups)})</h1>
<p class=meta>Agrupados pela mensagem, os mais frequentes primeiro. Arquivo: {html.escape(str(svc.reports.file))}</p>
{body}
</html>"""
    return HTMLResponse(page)
