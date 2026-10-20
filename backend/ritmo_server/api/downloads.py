"""Criar downloads (um vídeo ou vários da playlist), acompanhar e cancelar."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Path, Query

from ..core.errors import UserError
from ..core.net import validate_url
from ..jobs.models import Job
from ..jobs.storage import valid_id
from ..services import Services
from ..ytdlp.formats import plan_for
from .deps import JOB_ID, require_key, services
from .schemas import DownloadBody

router = APIRouter(dependencies=[Depends(require_key)])


@router.post("/download")
def download(body: DownloadBody, svc: Services = Depends(services)) -> dict[str, Any]:
    resolved = svc.registry.get_resolved(body.token)
    playlist = resolved.kind == "playlist"
    plan = plan_for(body.formatId, options=resolved.options, subtitles=body.subtitles, playlist=playlist)

    if not playlist:
        job = Job(
            id=uuid.uuid4().hex, token=resolved.token, format_id=body.formatId, plan=plan,
            source_url=resolved.url, title=resolved.title, subtitles=body.subtitles, info_file=resolved.info_file,
        )
        svc.registry.add_jobs([job])
        svc.pool.submit(job.id)
        return {"id": job.id, "ids": [job.id]}

    # Sem escolha = os primeiros da playlist, até o limite por vez.
    wanted = list(dict.fromkeys(body.entries or list(resolved.entries)[: svc.settings.max_batch]))
    unknown = [entry for entry in wanted if entry not in resolved.entries]
    if unknown:
        raise UserError("Alguns vídeos não estão nesta playlist. Leia o link de novo.", code="entries", status=400)
    if len(wanted) > svc.settings.max_batch:
        raise UserError(f"Escolha até {svc.settings.max_batch} vídeos por vez.", code="batch", status=400)
    batch_id = uuid.uuid4().hex
    jobs: list[Job] = []
    for entry in wanted:
        item = resolved.entries[entry]
        try:
            # O link de cada vídeo veio do site: passa pela mesma checagem dos links do app.
            source = validate_url(item["url"], allow_private=svc.settings.allow_private_hosts)
        except UserError:
            continue
        jobs.append(
            Job(
                id=uuid.uuid4().hex, token=resolved.token, format_id=body.formatId, plan=plan,
                source_url=source, title=item["title"], subtitles=body.subtitles, entry_id=entry, batch_id=batch_id,
            )
        )
    if not jobs:
        raise UserError("Nenhum vídeo desta playlist pode ser baixado.", code="entries", status=400)
    svc.registry.add_jobs(jobs)
    for job in jobs:
        svc.pool.submit(job.id)
    return {
        "id": jobs[0].id,
        "ids": [job.id for job in jobs],
        "batchId": batch_id,
        "jobs": [{"id": job.id, "entryId": job.entry_id, "title": job.title} for job in jobs],
    }


@router.get("/job/{job_id}")
def job_status(job_id: str = Path(..., pattern=JOB_ID), svc: Services = Depends(services)) -> dict[str, Any]:
    return svc.registry.public(job_id)


@router.get("/jobs")
def jobs_status(ids: str = Query(..., max_length=20000), svc: Services = Depends(services)) -> dict[str, Any]:
    """Vários de uma vez (playlist): `?ids=a,b,c`. Os que não existem mais vêm em `missing`."""
    asked = [part for part in ids.split(",") if part][:500]
    found, missing = svc.registry.public_many([job_id for job_id in asked if valid_id(job_id)])
    missing += [job_id for job_id in asked if not valid_id(job_id)]
    return {"jobs": found, "missing": missing}


@router.delete("/job/{job_id}")
def cancel(job_id: str = Path(..., pattern=JOB_ID), svc: Services = Depends(services)) -> dict[str, Any]:
    """Cancela, ou avisa que o celular já salvou o arquivo: o temporário é apagado na hora."""
    if svc.registry.cancel(job_id) and not svc.storage.remove_job(job_id):
        svc.registry.delete_later(job_id)
    return {"ok": True}
