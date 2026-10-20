"""
Entrega do arquivo pronto ao celular.

Não pede a chave: o ID do download (128 bits aleatórios) só é conhecido por quem criou o
download com a chave, e assim ela não fica gravada no histórico de downloads do Android.
Quando o celular recebe o arquivo inteiro, ele é marcado como entregue e apagado pouco depois.
"""

from __future__ import annotations

from typing import Iterator
from urllib.parse import quote

from fastapi import APIRouter, Depends, Path, Request, Response
from fastapi.responses import StreamingResponse

from ..core.errors import UserError
from ..services import Services
from .deps import JOB_ID, services
from .ranges import parse_range

router = APIRouter()

CHUNK = 256 * 1024


@router.api_route("/file/{job_id}", methods=["GET", "HEAD"])
def file(request: Request, job_id: str = Path(..., pattern=JOB_ID), svc: Services = Depends(services)) -> Response:
    path, info = svc.registry.ready_file(job_id)
    if not path.exists():
        raise UserError("Arquivo não encontrado.", code="not-found", status=404)
    size = path.stat().st_size

    span = parse_range(request.headers.get("range"), size)
    if span is None:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
    start, end, partial = span
    length = end - start + 1
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(info['name'], safe='')}",
        "Content-Length": str(length),
        "Cache-Control": "no-store",
    }
    if partial:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    status = 206 if partial else 200
    if request.method == "HEAD":
        return Response(status_code=status, headers=headers, media_type=info["mime"])

    def body() -> Iterator[bytes]:
        left = length
        with path.open("rb") as handle:
            handle.seek(start)
            while left > 0:
                chunk = handle.read(min(CHUNK, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk
        # Trecho enviado até o fim. Se a conexão caiu antes, o gerador é interrompido aqui e o
        # arquivo fica para a retomada.
        if left == 0:
            svc.registry.record_sent(job_id, start, end, size)

    return StreamingResponse(body(), status_code=status, headers=headers, media_type=info["mime"])
