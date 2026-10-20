import json

import pytest
from starlette.testclient import TestClient

from ritmo_server.reports import ErrorReports, fingerprint

from .conftest import wait_for, yt_error

DEVICE = {"app": "ritmo", "version": "1.3.0", "platform": "android", "os": "15", "model": "Pixel 8", "install": "abc", "senha": "não guardar"}


def test_app_envia_erros_e_o_servidor_guarda(make_client, tmp_path):
    client = make_client(api_key="k")
    headers = {"X-Ritmo-Key": "k"}
    assert client.post("/logs", json={"device": DEVICE, "entries": [{"message": "x"}]}).status_code == 401
    entries = [
        {"at": "2026-10-20T12:00:00Z", "source": "Player", "message": "Falha ao tocar 123.mp3", "stack": "at a\nat b", "count": 2},
        {"at": "2026-10-20T12:01:00Z", "source": "Player", "message": "Falha ao tocar 456.mp3"},
        {"source": "Tela", "message": "Cannot read property 'x' of undefined", "fatal": True, "extra": {"rota": "/grab"}},
        {"source": "vazio", "message": "   "},
    ]
    saved = client.post("/logs", json={"device": DEVICE, "entries": entries}, headers=headers).json()
    assert saved == {"ok": True, "saved": 3}

    lines = (tmp_path / "logs" / "app-errors.jsonl").read_text(encoding="utf-8").splitlines()
    first = json.loads(lines[0])
    assert first["device"]["model"] == "Pixel 8" and "senha" not in first["device"]
    assert first["client"] and first["received"] and first["count"] == 2

    recent = client.get("/logs", params={"limit": 2}, headers=headers).json()["entries"]
    assert [e["source"] for e in recent] == ["Tela", "Player"] and recent[0]["fatal"] is True
    assert client.get("/logs", params={"q": "cannot read"}, headers=headers).json()["entries"][0]["source"] == "Tela"

    groups = client.get("/logs/summary", headers=headers).json()["groups"]
    # "123.mp3" e "456.mp3" são o mesmo erro.
    assert groups[0]["source"] == "Player" and groups[0]["count"] == 3 and groups[0]["devices"] == 1
    page = client.get("/logs/view", params={"k": "k"})
    assert page.status_code == 200 and "Cannot read property" in page.text and "<script" not in page.text

    assert client.delete("/logs", headers=headers).json() == {"ok": True}
    assert client.get("/logs", headers=headers).json()["entries"] == []


def test_texto_enorme_e_cortado_e_html_escapado(tmp_path):
    reports = ErrorReports(tmp_path)
    reports.append({"platform": "ios"}, [{"source": "<b>x</b>", "message": "m" * 10_000, "stack": "s" * 50_000}])
    entry = next(reports.iter_entries())
    assert len(entry["message"]) == 2_000 and len(entry["stack"]) == 8_000


def test_rodizio_por_tamanho(tmp_path):
    reports = ErrorReports(tmp_path, max_bytes=300, backups=2)
    for index in range(30):
        reports.append({"platform": "android"}, [{"source": "s", "message": f"erro {index} " + "x" * 50}])
    files = sorted(p.name for p in tmp_path.iterdir())
    assert files == ["app-errors.1.jsonl", "app-errors.2.jsonl", "app-errors.jsonl"]
    assert next(reports.iter_entries())["message"].startswith("erro 29")


def test_falha_sem_explicacao_do_servidor_vai_para_o_relatorio(make_client, runner, tmp_path):
    client = make_client()
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123"}).json()
    runner.download_errors.append(yt_error("ERROR: algo muito estranho aconteceu"))
    runner.download_errors.append(yt_error("ERROR: algo muito estranho aconteceu"))
    job_id = client.post("/download", json={"token": media["token"], "formatId": "v:137"}).json()["id"]
    wait_for(lambda: client.get(f"/job/{job_id}").json()["status"] == "error")
    entries = list(ErrorReports(tmp_path / "logs").iter_entries())
    assert entries and entries[0]["source"] == "Servidor: download" and entries[0]["device"]["platform"] == "server"
    # Vídeo privado é erro conhecido: não polui o relatório.
    runner.extract_errors.append(yt_error("ERROR: [youtube] x: Private video"))
    client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=x"})
    assert len(list(ErrorReports(tmp_path / "logs").iter_entries())) == len(entries)


def test_impressao_digital_ignora_numeros_e_links():
    assert fingerprint("A", "falhou em https://x.com/1 código 403") == fingerprint("A", "falhou em https://y.com/2 código 500")
    assert fingerprint("A", "falhou") != fingerprint("B", "falhou")


def test_logs_view_so_dispensa_a_chave_no_proprio_pc_sem_tunel(make_client):
    client = make_client(api_key="k")
    local = TestClient(client.app, client=("127.0.0.1", 50000))
    assert local.get("/logs/view").status_code == 200
    # Pelo túnel (Tailscale Funnel, Cloudflare) o pedido também sai de 127.0.0.1, mas vem com cabeçalho de proxy.
    assert local.get("/logs/view", headers={"X-Forwarded-For": "203.0.113.9"}).status_code == 401
    assert local.get("/logs/view", headers={"Tailscale-Funnel-Request": "?1"}).status_code == 401
    assert TestClient(client.app, client=("203.0.113.9", 50000)).get("/logs/view").status_code == 401


def test_modo_internet_exige_chave_ate_no_proprio_pc(make_client):
    with pytest.raises(RuntimeError, match="RITMO_KEY"):
        make_client(public=True)
    client = make_client(api_key="k", public=True)
    local = TestClient(client.app, client=("127.0.0.1", 50000))
    assert local.get("/logs/view").status_code == 401
    assert local.get("/logs/view", params={"k": "k"}).status_code == 200
    assert local.get("/health").status_code == 401
