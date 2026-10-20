"""Cookies do YouTube: validação, armazenamento em memória e endpoints."""

from __future__ import annotations

from pathlib import Path

import pytest

from ritmo_server.cookies import CookieStore
from ritmo_server.core.errors import UserError

NETSCAPE = (
    "# Netscape HTTP Cookie File\n"
    ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc123\n"
    ".youtube.com\tTRUE\t/\tTRUE\t0\tHSID\tdef456\n"
)


def test_accepts_netscape(tmp_path: Path) -> None:
    store = CookieStore(tmp_path)
    status = store.save(NETSCAPE)
    assert status["configured"] is True
    assert status["count"] == 2
    assert isinstance(status["updatedAt"], int)


def test_accepts_raw_cookie_header(tmp_path: Path) -> None:
    store = CookieStore(tmp_path)
    status = store.save("Cookie: SID=abc123; HSID=def456; __Secure-1PSID=ghi789")
    assert status["configured"] is True
    assert status["count"] == 3
    snapshot = store.snapshot()
    assert snapshot is not None
    text = snapshot.read_text(encoding="utf-8")
    assert ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc123" in text
    store.discard(snapshot)
    assert not snapshot.exists()


def test_rejects_other_domains(tmp_path: Path) -> None:
    store = CookieStore(tmp_path)
    with pytest.raises(UserError):
        store.save("example.com\tTRUE\t/\tTRUE\t0\tSID\tabc")


def test_rejects_garbage(tmp_path: Path) -> None:
    store = CookieStore(tmp_path)
    with pytest.raises(UserError):
        store.save("isso não é um arquivo de cookies")


def test_clear(tmp_path: Path) -> None:
    store = CookieStore(tmp_path)
    store.save(NETSCAPE)
    store.clear()
    assert store.status()["configured"] is False
    assert store.snapshot() is None


def test_without_header_gets_one(tmp_path: Path) -> None:
    store = CookieStore(tmp_path)
    store.save(".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc")
    snapshot = store.snapshot()
    assert snapshot is not None
    assert snapshot.read_text(encoding="utf-8").startswith("# Netscape HTTP Cookie File\n")
    store.discard(snapshot)


def test_runner_passes_cookie_file(tmp_path: Path) -> None:
    from ritmo_server.config import Settings
    from ritmo_server.ytdlp.runner import YtDlpRunner

    class FakeUpdater:
        generation = 0

    store = CookieStore(tmp_path)
    store.save(NETSCAPE)
    settings = Settings(temp_dir=tmp_path / "ritmo-downloader", auto_update=False)
    runner = YtDlpRunner(settings, FakeUpdater(), tmp_path / "cache", cookies=store)  # type: ignore[arg-type]
    runner.supported_flags = lambda: set()  # type: ignore[method-assign]
    snapshot = store.snapshot()
    assert snapshot is not None
    command = runner.base_command(cookies=snapshot)
    assert "--cookies" in command
    assert str(snapshot) in command
    store.discard(snapshot)


def test_api_saves_and_hides_content(make_client) -> None:  # type: ignore[no-untyped-def]
    client = make_client()
    assert client.get("/cookies").json()["configured"] is False

    response = client.post("/cookies", json={"cookies": NETSCAPE})
    assert response.status_code == 200
    assert response.json()["configured"] is True
    assert "abc123" not in response.text

    health = client.get("/health").json()
    assert health["cookies"]["configured"] is True
    assert health["cookies"]["count"] == 2

    assert client.delete("/cookies").json() == {"ok": True}
    assert client.get("/cookies").json()["configured"] is False


def test_api_rejects_without_youtube(make_client) -> None:  # type: ignore[no-untyped-def]
    client = make_client()
    response = client.post("/cookies", json={"cookies": "example.com\tTRUE\t/\tTRUE\t0\tSID\tabc"})
    assert response.status_code == 400
    assert "YouTube" in response.json()["detail"]


def test_api_requires_server_key(make_client) -> None:  # type: ignore[no-untyped-def]
    client = make_client(api_key="segredo")
    assert client.get("/cookies").status_code == 401
    assert client.get("/cookies", headers={"X-Ritmo-Key": "segredo"}).status_code == 200
