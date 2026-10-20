"""Cookies do YouTube: validação e passagem por pedido (o servidor não guarda)."""

from __future__ import annotations

from pathlib import Path

import pytest

from ritmo_server.cookies import CookieJar
from ritmo_server.core.errors import UserError

from .conftest import wait_for

NETSCAPE = (
    "# Netscape HTTP Cookie File\n"
    ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc123\n"
    ".youtube.com\tTRUE\t/\tTRUE\t0\tHSID\tdef456\n"
)
RAW = "Cookie: SID=abc123; HSID=def456; __Secure-1PSID=ghi789"


def test_accepts_netscape(tmp_path: Path) -> None:
    CookieJar(tmp_path).validate(NETSCAPE)


def test_accepts_raw_header(tmp_path: Path) -> None:
    CookieJar(tmp_path).validate(RAW)


def test_rejects_other_domains(tmp_path: Path) -> None:
    with pytest.raises(UserError):
        CookieJar(tmp_path).validate("example.com\tTRUE\t/\tTRUE\t0\tSID\tabc")


def test_rejects_garbage(tmp_path: Path) -> None:
    with pytest.raises(UserError):
        CookieJar(tmp_path).validate("isso não é um arquivo de cookies")


def test_write_and_discard(tmp_path: Path) -> None:
    jar = CookieJar(tmp_path)
    path = jar.write(RAW)
    assert path.exists()
    assert ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc123" in path.read_text(encoding="utf-8")
    jar.discard(path)
    assert not path.exists()


def test_resolve_forwards_cookies(make_client, runner) -> None:  # type: ignore[no-untyped-def]
    client = make_client()
    response = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123", "cookies": NETSCAPE})
    assert response.status_code == 200
    assert runner.cookies_seen[-1] == NETSCAPE


def test_download_uses_cookies_and_clears_job(make_client, runner) -> None:  # type: ignore[no-untyped-def]
    client = make_client()
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123"}).json()
    created = client.post(
        "/download",
        json={"token": media["token"], "formatId": "v:137", "cookies": NETSCAPE},
    )
    assert created.status_code == 200
    job_id = created.json()["id"]
    wait_for(lambda: client.get(f"/job/{job_id}").json().get("status") == "ready")
    assert runner.cookies_seen[-1] == NETSCAPE
    # O cookie não aparece na resposta pública do job.
    assert "cookies" not in client.get(f"/job/{job_id}").json()


def test_rejects_invalid_cookies_before_creating_job(make_client) -> None:  # type: ignore[no-untyped-def]
    client = make_client()
    response = client.post(
        "/resolve",
        json={"url": "https://www.youtube.com/watch?v=abc123", "cookies": "example.com\tTRUE\t/\tTRUE\t0\tSID\tabc"},
    )
    assert response.status_code == 400


def test_server_has_no_cookie_store(make_client) -> None:  # type: ignore[no-untyped-def]
    client = make_client()
    assert client.get("/cookies").status_code == 404
    assert "cookies" not in client.get("/health").json()
