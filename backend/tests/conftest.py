"""Peças falsas para testar o servidor sem internet: um yt-dlp e um pip de mentira."""

from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

import pytest
from fastapi.testclient import TestClient

from ritmo_server.config import Settings
from ritmo_server.core.errors import Cancelled, YtDlpError
from ritmo_server.main import create_app
from ritmo_server.ytdlp.formats import Plan
from ritmo_server.ytdlp.runner import Progress
from ritmo_server.ytdlp.updater import Updater

VIDEO_INFO: dict[str, Any] = {
    "id": "abc123",
    "title": "Clipe de teste: parte 1/2",
    "uploader": "Canal",
    "duration": 212,
    "webpage_url": "https://www.youtube.com/watch?v=abc123",
    "extractor_key": "Youtube",
    "thumbnail": "https://i.ytimg.com/vi/abc123/hq.jpg",
    "formats": [
        {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "filesize": 3_000_000},
        {"format_id": "251", "ext": "webm", "vcodec": "none", "acodec": "opus", "filesize": 3_500_000},
        {"format_id": "18", "ext": "mp4", "vcodec": "avc1.42001E", "acodec": "mp4a.40.2", "height": 360, "fps": 30, "filesize": 9_000_000},
        {"format_id": "134", "ext": "mp4", "vcodec": "avc1.4d401e", "acodec": "none", "height": 360, "fps": 30, "filesize": 5_000_000},
        {"format_id": "137", "ext": "mp4", "vcodec": "avc1.640028", "acodec": "none", "height": 1080, "fps": 30, "filesize": 40_000_000},
        {"format_id": "248", "ext": "webm", "vcodec": "vp9", "acodec": "none", "height": 1080, "fps": 30, "filesize": 30_000_000},
        {"format_id": "315", "ext": "webm", "vcodec": "vp9", "acodec": "none", "height": 2160, "fps": 60, "filesize": 300_000_000},
        {"format_id": "sb0", "ext": "mhtml", "vcodec": "none", "acodec": "none", "protocol": "mhtml", "height": 90},
    ],
    "subtitles": {"pt-BR": [{"ext": "vtt", "name": "Portuguese (Brazil)"}], "live_chat": [{"ext": "json"}]},
    "automatic_captions": {"en-orig": [{"ext": "vtt"}], "en": [{"ext": "vtt"}], "pt": [{"ext": "vtt"}], "fr": [{"ext": "vtt"}]},
}

PLAYLIST_INFO: dict[str, Any] = {
    "_type": "playlist",
    "id": "PL1",
    "title": "Minha playlist",
    "uploader": "Canal",
    "webpage_url": "https://www.youtube.com/playlist?list=PL1",
    "playlist_count": 3,
    "entries": [
        {"id": "v1", "url": "https://www.youtube.com/watch?v=v1", "title": "Primeiro", "duration": 60, "ie_key": "Youtube"},
        {"id": "v2", "url": "https://www.youtube.com/watch?v=v2", "title": "Segundo", "duration": 90, "ie_key": "Youtube"},
        {"id": "v3", "ie_key": "Youtube", "title": "Terceiro"},
    ],
}


class FakeRunner:
    def __init__(self) -> None:
        self.extract_errors: list[Exception] = []
        self.download_errors: list[Exception] = []
        self.calls: list[dict[str, Any]] = []
        self.cookies_seen: list[str | None] = []
        self.block = threading.Event()  # set = o download fica parado até cancelar
        self.started = threading.Event()

    def extract(self, url: str, *, playlist: bool = False, cookies: str | None = None) -> dict[str, Any]:
        self.cookies_seen.append(cookies)
        if self.extract_errors:
            raise self.extract_errors.pop(0)
        return PLAYLIST_INFO if (playlist or "playlist" in url) else VIDEO_INFO

    def search(self, query: str, limit: int, *, cookies: str | None = None) -> dict[str, Any]:
        self.cookies_seen.append(cookies)
        return {"_type": "playlist", "entries": PLAYLIST_INFO["entries"][:limit]}

    def download(self, *, source: str, from_info: bool, plan: Plan, out_dir: Path, on_progress: Callable[[Progress], None],
                 cancel: threading.Event, with_thumbnail: bool = True, cookies: str | None = None) -> Path | None:
        self.cookies_seen.append(cookies)
        self.calls.append({"source": source, "from_info": from_info, "plan": plan, "with_thumbnail": with_thumbnail})
        self.started.set()
        if self.block.is_set():
            if cancel.wait(5):
                raise Cancelled()
        if self.download_errors:
            raise self.download_errors.pop(0)
        on_progress(Progress("download", "downloading", 50, 100))
        on_progress(Progress("download", "finished", 100, 100))
        on_progress(Progress("postprocess", "started", postprocessor="ExtractAudio" if plan.media == "audio" else "Merger"))
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "media.f137.mp4.part").write_bytes(b"resto")
        out = out_dir / ("media.mp3" if plan.media == "audio" else "media.mp4")
        out.write_bytes(bytes(range(256)) * 40)  # 10 240 bytes
        return out

    def kill_all(self) -> None:
        pass


class FakePip:
    """Simula `yt_dlp --version` e o `pip install` (nightly = requisito com ".dev0", só para o yt-dlp)."""

    def __init__(self, version: str = "2026.01.01", stable: str | None = None, nightly: str | None = None) -> None:
        self.version = version
        self.stable = stable
        self.nightly = nightly
        self.commands: list[list[str]] = []

    def __call__(self, cmd: list[str], timeout: int) -> subprocess.CompletedProcess:
        self.commands.append(cmd)
        if "pip" in cmd:
            if "-U" in cmd:  # só o primeiro passo troca a versão; o segundo só confere as dependências
                target = self.nightly if any("dev0" in part for part in cmd) else self.stable
                if target:
                    self.version = target
            return subprocess.CompletedProcess(cmd, 0, "ok\n")
        return subprocess.CompletedProcess(cmd, 0, f"{self.version}\n")


def make_settings(tmp_path: Path, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "temp_dir": tmp_path / "ritmo-downloader",
        "log_dir": tmp_path / "logs",
        "workers": 2,
        "auto_update": False,
        "update_cooldown": 0,
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def runner() -> FakeRunner:
    return FakeRunner()


@pytest.fixture
def pip() -> FakePip:
    return FakePip()


@pytest.fixture
def make_client(tmp_path: Path, runner: FakeRunner, pip: FakePip):
    clients: list[TestClient] = []

    def build(**overrides: Any) -> TestClient:
        settings = make_settings(tmp_path, **overrides)
        updater = Updater(settings, python="python", run=pip)
        app = create_app(settings, runner=runner, updater=updater, background=False)  # type: ignore[arg-type]
        client = TestClient(app)
        client.__enter__()
        clients.append(client)
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)


def wait_for(predicate: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("tempo esgotado esperando a condição")


def yt_error(text: str) -> YtDlpError:
    return YtDlpError(text, text)
