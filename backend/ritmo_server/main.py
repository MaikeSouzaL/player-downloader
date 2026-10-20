"""
Servidor de downloads do Ritmo.

Recebe um link (YouTube, Instagram, TikTok, X, Facebook, Vimeo, SoundCloud e os demais sites que
o yt-dlp entende), devolve as opções de vídeo/áudio e prepara o arquivo. O celular baixa o arquivo
pronto por HTTP (DownloadManager no Android, URLSession no iPhone) e o temporário é apagado.

Rodar:  uvicorn ritmo_server.main:app --host 0.0.0.0 --port 8787   (ou `python -m ritmo_server`)
"""

from __future__ import annotations

import logging
import shutil
import socket
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import __version__
from .api import router
from .config import Settings
from .core.errors import UserError
from .core.net import lan_ip
from .services import Services
from .ytdlp.runner import YtDlpRunner
from .ytdlp.updater import Updater


def _setup_logging() -> None:
    log = logging.getLogger("ritmo")
    if log.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s %(name)s: %(message)s", "%H:%M:%S"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    log.propagate = False


# Corpo máximo de um pedido (os relatórios de erro são os maiores): o resto é recusado.
MAX_BODY = 2_000_000


def _port_in_use(port: int) -> bool:
    """Outro servidor do Ritmo já está rodando? (Subir de novo apagaria os temporários dele.)"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def create_app(
    settings: Settings | None = None,
    *,
    runner: YtDlpRunner | None = None,
    updater: Updater | None = None,
    background: bool = True,
) -> FastAPI:
    """Monta o app. Os testes passam um `runner` falso e `background=False` (sem faxina nem atualização)."""
    _setup_logging()
    settings = settings or Settings.from_env()
    if settings.public and not settings.api_key:
        raise RuntimeError("RITMO_PUBLIC=1 exige uma chave (RITMO_KEY): sem ela qualquer pessoa na internet usaria o servidor.")
    svc = Services.build(settings, runner=runner, updater=updater)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if background and _port_in_use(settings.port):
            raise RuntimeError(f"A porta {settings.port} já está em uso: o servidor do Ritmo já está aberto em outra janela?")
        svc.storage.reset()  # nada de uma execução anterior fica no disco
        svc.pool.start()
        if background:
            svc.janitor.start()
            version = svc.updater.current_version()
            print(
                f"\n  Player Downloader (servidor) {__version__}  http://{lan_ip()}:{settings.port}\n"
                f"  yt-dlp {version} | ffmpeg: {bool(shutil.which('ffmpeg'))} | node: {bool(shutil.which('node'))}"
                f" | chave: {'sim' if settings.api_key else 'não'} | autoatualização: {'sim' if settings.auto_update else 'não'}"
                f" | internet: {'sim' if settings.public else 'não'}\n"
                f"  temporários: {svc.storage.base}\n",
                flush=True,
            )
        try:
            yield
        finally:
            svc.janitor.stop()
            svc.pool.stop()
            # Os processos do yt-dlp rodam em grupo próprio (Ctrl+C não chega neles): encerra aqui.
            svc.runner.kill_all()
            svc.storage.reset()

    app = FastAPI(title="Player Downloader", version=__version__, lifespan=lifespan)
    app.state.services = svc

    @app.middleware("http")
    async def limit_body(request: Request, call_next):  # type: ignore[no-untyped-def]
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_BODY:
            return JSONResponse({"detail": "Pedido grande demais.", "code": "too-large"}, status_code=413)
        return await call_next(request)

    @app.exception_handler(UserError)
    async def user_error(_: Request, exc: UserError) -> JSONResponse:
        return JSONResponse({"detail": exc.message, "code": exc.code}, status_code=exc.status)

    app.include_router(router)
    return app


app = create_app()


def run() -> None:
    import uvicorn

    settings = app.state.services.settings
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
