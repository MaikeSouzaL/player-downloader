"""Faxina em segundo plano: apaga temporários vencidos e confere atualização do yt-dlp uma vez por dia."""

from __future__ import annotations

import logging
import threading

from ..ytdlp.updater import Updater
from .registry import Registry

log = logging.getLogger("ritmo.janitor")


class Janitor:
    def __init__(self, registry: Registry, updater: Updater, *, interval: float = 30, first_update_delay: float = 20) -> None:
        self.registry = registry
        self.updater = updater
        self.interval = interval
        self.first_update_delay = first_update_delay
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="ritmo-janitor", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        # Espera o servidor subir antes da primeira conferência do yt-dlp.
        if self._stop.wait(self.first_update_delay):
            return
        while not self._stop.is_set():
            try:
                self.registry.prune()
                self.updater.scheduled(busy=lambda: self.registry.active_count() > 0 or self.updater.active > 0)
            except Exception:  # noqa: BLE001 - a faxina não pode derrubar o servidor
                log.exception("Falha na faxina")
            self._stop.wait(self.interval)
