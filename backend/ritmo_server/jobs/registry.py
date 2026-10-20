"""Registro em memória dos links lidos e dos downloads (some quando o servidor reinicia)."""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any

from ..config import Settings
from ..core.errors import UserError
from .models import ACTIVE, CANCELLED, ERROR, FINISHED, QUEUED, READY, Job, Resolved
from .storage import TempStorage, valid_id

log = logging.getLogger("ritmo.registry")

# Leituras guardadas ao mesmo tempo (cada uma tem um JSON de ~1 MB no temporário).
MAX_RESOLVED = 300


class Registry:
    def __init__(self, settings: Settings, storage: TempStorage) -> None:
        self.settings = settings
        self.storage = storage
        self._lock = threading.RLock()
        self._resolved: dict[str, Resolved] = {}
        self._jobs: dict[str, Job] = {}
        # Pastas que não deu para apagar ainda (arquivo aberto no Windows): tenta de novo depois.
        self._pending_delete: set[str] = set()

    # ------------------------------------------------------------------ links lidos

    def add_resolved(self, resolved: Resolved) -> None:
        evicted: list[str] = []
        with self._lock:
            self._resolved[resolved.token] = resolved
            while len(self._resolved) > MAX_RESOLVED:
                oldest = min(self._resolved.values(), key=lambda item: item.created)
                self._resolved.pop(oldest.token, None)
                evicted.append(oldest.token)
        for token in evicted:
            self.storage.remove_info(token)

    def get_resolved(self, token: str) -> Resolved:
        with self._lock:
            resolved = self._resolved.get(token)
        if resolved is None or time.time() - resolved.created > self.settings.resolve_ttl:
            raise UserError("A leitura do link expirou. Leia de novo.", code="expired", status=410)
        return resolved

    # ------------------------------------------------------------------ downloads

    def add_jobs(self, jobs: list[Job]) -> None:
        with self._lock:
            active = sum(1 for job in self._jobs.values() if job.status in ACTIVE)
            if active + len(jobs) > self.settings.max_queue:
                raise UserError("Muitos downloads na fila do servidor. Tente de novo em instantes.", code="busy", status=429)
            for job in jobs:
                self._jobs[job.id] = job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def require(self, job_id: str) -> Job:
        job = self.get(job_id)
        if job is None:
            raise UserError("Download não encontrado.", code="not-found", status=404)
        return job

    def update(self, job_id: str, **patch: Any) -> bool:
        """
        Atualiza o download. Um download cancelado não volta a andar: o trabalhador pode terminar
        logo depois do cancelamento, e essa atualização "atrasada" é ignorada (devolve False).
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return False
            if job.status == CANCELLED and patch.get("status") != CANCELLED:
                return False
            for key, value in patch.items():
                setattr(job, key, value)
            job.updated = time.time()
            if patch.get("status") in FINISHED | {READY}:
                job.finished_at = job.updated
            return True

    def public(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            return self.require(job_id).public()

    def public_many(self, job_ids: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
        with self._lock:
            found = [self._jobs[job_id].public() for job_id in job_ids if job_id in self._jobs]
            missing = [job_id for job_id in job_ids if job_id not in self._jobs]
        return found, missing

    def ready_file(self, job_id: str) -> tuple[Path, dict[str, Any]]:
        """Caminho e dados do arquivo pronto, lidos juntos (sem ver um estado pela metade)."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise UserError("Download não encontrado.", code="not-found", status=404)
            if job.status != READY or job.path is None or job.file is None:
                raise UserError("O arquivo ainda está sendo preparado.", code="not-ready", status=409)
            job.last_access = time.time()
            return job.path, dict(job.file)

    def active_count(self) -> int:
        with self._lock:
            return sum(1 for job in self._jobs.values() if job.status in ACTIVE)

    def cancel(self, job_id: str) -> bool:
        """
        Cancela ou, se já estava pronto, descarta (o app avisa assim que salvou o arquivo).
        Devolve True só quando há uma pasta para apagar agora (o download existia e nada mais
        escreve nela). ID desconhecido: nada a apagar.
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return False
            job.cancel.set()
            if job.status in ACTIVE and job.status != QUEUED:
                # Rodando: o trabalhador mata o yt-dlp e limpa a pasta.
                job.status = CANCELLED
                job.stage = "Cancelado"
                job.finished_at = time.time()
                return False
            self._jobs.pop(job_id, None)
            return True

    def record_sent(self, job_id: str, start: int, end: int, size: int) -> None:
        """
        Um trecho [start, end] foi enviado inteiro. Só conta como entregue quando o celular recebeu
        o arquivo todo do começo ao fim (retomadas somam; uma espiada só no final não conta).
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status != READY:
                return
            job.last_access = time.time()
            if start <= job.sent_upto:
                job.sent_upto = max(job.sent_upto, end + 1)
            if job.sent_upto >= size and job.delivered_at is None:
                job.delivered_at = time.time()

    # ------------------------------------------------------------------ limpeza

    def prune(self, now: float | None = None) -> None:
        """Apaga links vencidos, arquivos entregues ou abandonados e downloads antigos que falharam."""
        now = time.time() if now is None else now
        settings = self.settings
        drop_tokens: list[str] = []
        drop_jobs: list[str] = []
        with self._lock:
            for token, resolved in list(self._resolved.items()):
                if now - resolved.created > settings.resolve_ttl:
                    self._resolved.pop(token, None)
                    drop_tokens.append(token)
            for job_id, job in list(self._jobs.items()):
                # Abandonado conta a partir do último acesso: um download lento não perde o arquivo.
                idle_since = max(job.finished_at or 0, job.last_access or 0)
                expired = (
                    (job.status == READY and job.delivered_at is not None and now - job.delivered_at > settings.delivered_grace)
                    or (job.status == READY and job.delivered_at is None and idle_since and now - idle_since > settings.ready_ttl)
                    or (job.status in (ERROR, CANCELLED) and job.finished_at and now - job.finished_at > settings.finished_ttl)
                )
                if expired:
                    self._jobs.pop(job_id, None)
                    drop_jobs.append(job_id)
            drop_jobs.extend(self._pending_delete)
            self._pending_delete.clear()
        failed: list[str] = []
        try:
            for token in drop_tokens:
                self.storage.remove_info(token)
            for job_id in set(drop_jobs):
                if not self.storage.remove_job(job_id):
                    failed.append(job_id)
        finally:
            if failed:
                with self._lock:
                    self._pending_delete.update(failed)

    def delete_later(self, job_id: str) -> None:
        if not valid_id(job_id):
            return
        with self._lock:
            self._pending_delete.add(job_id)

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            counts: dict[str, int] = {}
            for job in self._jobs.values():
                counts[job.status] = counts.get(job.status, 0) + 1
            return {"links": len(self._resolved), **counts}
