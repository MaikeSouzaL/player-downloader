"""As peças do servidor montadas juntas (as rotas recebem isto pelo `request.app.state`)."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

from .config import Settings
from .jobs.janitor import Janitor
from .jobs.registry import Registry
from .jobs.storage import TempStorage
from .jobs.worker import WorkerPool
from .reports import ErrorReports
from .ytdlp.runner import YtDlpRunner
from .ytdlp.updater import Updater


@dataclass
class Services:
    settings: Settings
    storage: TempStorage
    updater: Updater
    runner: YtDlpRunner
    registry: Registry
    pool: WorkerPool
    janitor: Janitor
    reports: ErrorReports
    reads: threading.BoundedSemaphore = field(default_factory=lambda: threading.BoundedSemaphore(4))

    @classmethod
    def build(cls, settings: Settings, *, runner: YtDlpRunner | None = None, updater: Updater | None = None) -> "Services":
        storage = TempStorage(settings.temp_dir)
        updater = updater or Updater(settings)
        runner = runner or YtDlpRunner(settings, updater, storage.cache)
        registry = Registry(settings, storage)
        reports = ErrorReports(settings.log_dir)
        pool = WorkerPool(settings, registry, storage, runner, updater, reports)
        janitor = Janitor(registry, updater)
        return cls(settings, storage, updater, runner, registry, pool, janitor, reports, threading.BoundedSemaphore(max(1, settings.max_reads)))
