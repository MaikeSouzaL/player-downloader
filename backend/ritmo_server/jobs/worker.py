"""Trabalhadores da fila: baixam, juntam/convertem e deixam o arquivo pronto para o celular."""

from __future__ import annotations

import logging
import queue
import threading
import time
from typing import Callable
from urllib.parse import urlsplit, urlunsplit

from ..config import Settings
from ..core.errors import Cancelled, YtDlpError, friendly
from ..core.text import mime_for, output_name
from ..reports import ErrorReports
from ..ytdlp.runner import Progress, YtDlpRunner
from ..ytdlp.updater import Updater
from .models import CANCELLED, CONVERTING, DOWNLOADING, ERROR, READY, Job
from .registry import Registry
from .storage import TempStorage

log = logging.getLogger("ritmo.worker")

# Nomes que o yt-dlp informa em "postprocess" (conferidos com o yt-dlp 2026.08).
STAGES = {
    "Merger": "Juntando vídeo e áudio",
    "ExtractAudio": "Convertendo o áudio",
    "ThumbnailsConvertor": "Preparando a capa",
    "EmbedThumbnail": "Colocando a capa",
    "EmbedSubtitle": "Colocando a legenda",
    "SubtitlesConvertor": "Preparando a legenda",
    "Metadata": "Gravando título e artista",
    "FixupM4a": "Ajustando o arquivo",
    "FixupM3u8": "Ajustando o arquivo",
    "MoveFiles": "Finalizando",
}


def _without_query(url: str) -> str:
    """Link sem a parte depois do "?" (pode ter tokens): basta o site e o caminho para investigar."""
    try:
        parts = urlsplit(url)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    except ValueError:
        return ""


def _thumbnail_failed(text: str) -> bool:
    low = text.lower()
    return "thumbnail" in low and ("embed" in low or "convert" in low)


class WorkerPool:
    def __init__(
        self, settings: Settings, registry: Registry, storage: TempStorage, runner: YtDlpRunner, updater: Updater, reports: ErrorReports | None = None
    ) -> None:
        self.settings = settings
        self.reports = reports
        self.registry = registry
        self.storage = storage
        self.runner = runner
        self.updater = updater
        self._queue: "queue.Queue[str | None]" = queue.Queue()
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        for index in range(self.settings.workers):
            thread = threading.Thread(target=self._loop, name=f"ritmo-worker-{index + 1}", daemon=True)
            thread.start()
            self._threads.append(thread)

    def stop(self) -> None:
        for _ in self._threads:
            self._queue.put(None)

    def submit(self, job_id: str) -> None:
        self._queue.put(job_id)

    def _loop(self) -> None:
        while True:
            job_id = self._queue.get()
            if job_id is None:
                return
            job = self.registry.get(job_id)
            if job is None or job.cancel.is_set():
                continue
            try:
                self.run(job)
            except Exception as exc:  # noqa: BLE001 - um download com problema não pode parar a fila
                log.exception("Falha inesperada no download %s", job_id)
                self._report(f"{type(exc).__name__}: {exc}", job, source="Servidor: exceção")
                self.registry.update(job.id, status=ERROR, stage="Falhou", error="Falha inesperada no servidor.", code="internal")
                self.storage.remove_job(job.id)

    def _report(self, message: str, job: Job, *, source: str = "Servidor: download", output: str | None = None) -> None:
        if self.reports is None:
            return
        try:
            self.reports.server_error(
                message, source=source,
                extra={"url": _without_query(job.source_url), "format": job.format_id, "ytdlp": self.updater.version, "output": output},
            )
        except OSError:
            log.warning("Não deu para gravar o relatório de erro")

    # ------------------------------------------------------------------ um download

    def _progress(self, job: Job) -> Callable[[Progress], None]:
        """Progresso geral: vídeo + áudio são dois arquivos, cada um vale metade."""
        streams = max(1, job.plan.streams)
        state = {"done": 0}

        def on_progress(p: Progress) -> None:
            if job.cancel.is_set():
                return
            if p.kind == "download":
                if p.status == "finished":
                    state["done"] = min(streams, state["done"] + 1)
                    overall = state["done"] / streams
                else:
                    fraction = min(1.0, p.downloaded / p.total) if p.total else 0.0
                    overall = (min(state["done"], streams - 1) + fraction) / streams
                # 97–100% fica para juntar/converter.
                progress = round(max(job.progress, min(0.97, overall)), 3)
                self.registry.update(job.id, status=DOWNLOADING, stage="Baixando", progress=progress)
            elif p.status == "started":
                stage = STAGES.get(p.postprocessor, "Preparando o arquivo")
                self.registry.update(job.id, status=CONVERTING, stage=stage, progress=max(job.progress, 0.97))

        return on_progress

    def run(self, job: Job) -> None:
        started = time.time()
        directory = self.storage.job_dir(job.id)
        use_info = job.info_file is not None and job.info_file.exists()
        with_thumbnail = True
        self.registry.update(job.id, status=DOWNLOADING, stage="Baixando", progress=0.0)
        final = None
        for attempt in range(3):
            try:
                final = self.runner.download(
                    source=str(job.info_file) if use_info else job.source_url,
                    from_info=use_info,
                    plan=job.plan,
                    out_dir=directory,
                    on_progress=self._progress(job),
                    cancel=job.cancel,
                    with_thumbnail=with_thumbnail,
                )
                break
            except Cancelled:
                self.registry.update(job.id, status=CANCELLED, stage="Cancelado")
                if not self.storage.remove_job(job.id):
                    self.registry.delete_later(job.id)
                return
            except YtDlpError as exc:
                text = exc.output or str(exc)
                if job.cancel.is_set():
                    self.registry.update(job.id, status=CANCELLED, stage="Cancelado")
                    self.storage.remove_job(job.id)
                    return
                self.storage.clear_dir(directory)
                if attempt < 2:
                    if with_thumbnail and job.plan.embed_thumbnail and _thumbnail_failed(text):
                        with_thumbnail = False  # a capa não entrou: entrega sem ela
                        continue
                    if self.updater.maybe_update_for(text, started):
                        self.registry.update(job.id, stage="Atualizando o yt-dlp e tentando de novo", progress=0.0)
                        use_info = False  # metadados da versão antiga: lê o site de novo
                        continue
                    if use_info:
                        use_info = False  # os links lidos no /resolve podem ter vencido
                        continue
                code, message = friendly(text)
                log.info("Download %s falhou (%s): %s", job.id, code, text.strip().splitlines()[-1:] or text)
                if code == "failed":
                    # Erro sem explicação conhecida: vai para o relatório, para a gente investigar.
                    self._report(message, job, output=text[-3000:])
                self.registry.update(job.id, status=ERROR, stage="Falhou", error=message, code=code)
                self.storage.remove_job(job.id)
                return

        file = final if final is not None and final.exists() else self.storage.pick_output(directory)
        if file is None or not file.exists() or file.stat().st_size == 0:
            self._report("O yt-dlp terminou sem arquivo final", job)
            self.registry.update(job.id, status=ERROR, stage="Falhou", error="O site não entregou nenhum arquivo.", code="empty")
            self.storage.remove_job(job.id)
            return
        self.storage.keep_only(directory, file)
        name = output_name(job.title, file.suffix)
        ready = self.registry.update(
            job.id,
            status=READY,
            stage="Pronto",
            progress=1.0,
            file={"name": name, "mime": mime_for(name), "size": file.stat().st_size},
            path=file,
        )
        if not ready:
            # Cancelado bem no fim (ou já descartado): o arquivo não fica esperando no disco.
            if not self.storage.remove_job(job.id):
                self.registry.delete_later(job.id)
