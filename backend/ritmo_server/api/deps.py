"""Dependências das rotas: os serviços, a chave do servidor e a leitura com autoatualização."""

from __future__ import annotations

import hmac
import time
from typing import Any, Callable

from fastapi import Request

from ..core.errors import UserError, YtDlpError, friendly
from ..services import Services

# IDs de download: 32 caracteres hex. Qualquer outra coisa nem chega ao disco.
JOB_ID = r"^[0-9a-f]{32}$"

# Quanto tempo uma leitura espera na fila antes de responder "servidor ocupado".
READ_WAIT = 90


def services(request: Request) -> Services:
    return request.app.state.services


def _key_ok(request: Request) -> bool:
    key = request.app.state.services.settings.api_key
    if not key:
        return True
    given = request.headers.get("x-ritmo-key") or request.query_params.get("k") or ""
    return hmac.compare_digest(given.encode(), key.encode())


def require_key(request: Request) -> None:
    """X-Ritmo-Key (ou ?k= para chamadas antigas) igual à RITMO_KEY, quando ela existe."""
    if not _key_ok(request):
        raise UserError("Chave do servidor inválida.", code="auth", status=401)


# Cabeçalhos que túneis e proxies (Tailscale Funnel, Cloudflare Tunnel, nginx) põem no pedido: quem
# chega por eles vem da internet, mesmo que a conexão saia do próprio PC.
_PROXY_HEADERS = ("forwarded", "x-forwarded-for", "x-real-ip", "cf-connecting-ip", "tailscale-funnel-request")


def require_key_or_local(request: Request) -> None:
    """Páginas para abrir no navegador do próprio PC (sem pôr a chave no endereço)."""
    host = request.client.host if request.client else ""
    proxied = any(name in request.headers for name in _PROXY_HEADERS)
    if not request.app.state.services.settings.public and not proxied and host in {"127.0.0.1", "::1", "localhost"}:
        return
    require_key(request)


def _fail(svc: Services, exc: YtDlpError, what: str) -> UserError:
    code, message = friendly(exc.output)
    if code == "failed":
        # Erro sem explicação conhecida: vai para o relatório, para a gente investigar.
        try:
            svc.reports.server_error(message, source=f"Servidor: {what}", extra={"ytdlp": svc.updater.version, "output": exc.output[-3000:]})
        except OSError:
            pass
    return UserError(message, code=code)


def with_update(svc: Services, call: Callable[[], dict[str, Any]], what: str = "ler link") -> dict[str, Any]:
    """
    Roda uma leitura no yt-dlp (no máximo algumas ao mesmo tempo, para não afogar o PC); se o erro
    for de extrator desatualizado, atualiza e tenta mais uma vez.
    """
    if not svc.reads.acquire(timeout=READ_WAIT):
        raise UserError("O servidor está ocupado lendo outros links. Tente de novo em instantes.", code="busy", status=429)
    try:
        started = time.time()
        try:
            return call()
        except YtDlpError as first:
            if not svc.updater.maybe_update_for(first.output, started):
                raise _fail(svc, first, what) from first
        try:
            return call()
        except YtDlpError as second:
            raise _fail(svc, second, what) from second
    finally:
        svc.reads.release()
