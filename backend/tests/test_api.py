import time

from .conftest import FakePip, wait_for, yt_error


def ready(client, job_id):
    data = client.get(f"/job/{job_id}").json()
    return data if data.get("status") == "ready" else None


def test_status_e_chave(make_client):
    client = make_client(api_key="segredo")
    assert client.get("/").json()["ok"] is True
    assert client.get("/health").status_code == 401
    health = client.get("/health", headers={"X-Ritmo-Key": "segredo"})
    assert health.status_code == 200 and health.json()["ytdlp"] == "2026.01.01"
    assert client.post("/resolve", json={"url": "https://youtu.be/abc"}).status_code == 401


def test_temporarios_de_antes_somem_ao_subir(tmp_path, make_client):
    leftover = tmp_path / "ritmo-downloader" / "jobs" / "velho" / "video.mp4"
    leftover.parent.mkdir(parents=True)
    leftover.write_bytes(b"x")
    make_client()
    assert not leftover.exists()


def test_video_completo_e_apagado_depois_de_entregue(make_client, runner, tmp_path):
    client = make_client()
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123&list=PLxyz"}).json()
    assert media["kind"] == "video" and media["title"].startswith("Clipe")
    assert media["playlistUrl"] == "https://www.youtube.com/playlist?list=PLxyz"
    assert all(not key.startswith("_") for option in media["formats"] for key in option)
    assert [s["id"] for s in media["subtitles"]] == ["s:pt-BR", "as:en-orig"]

    job_id = client.post("/download", json={"token": media["token"], "formatId": "v:137", "subtitles": "s:pt-BR"}).json()["id"]
    wait_for(lambda: ready(client, job_id))
    job = ready(client, job_id)
    # Nome limpo (sem [id]) e só o arquivo final na pasta.
    assert job["file"]["name"] == "Clipe de teste_ parte 1_2.mp4" and job["file"]["mime"] == "video/mp4"
    call = runner.calls[0]
    assert call["from_info"] is True and "--embed-subs" in call["plan"].args
    job_dir = tmp_path / "ritmo-downloader" / "jobs" / job_id
    assert [p.name for p in job_dir.iterdir()] == ["media.mp4"]

    # Começo do arquivo (retomada): ainda não conta como entregue.
    part = client.get(f"/file/{job_id}", headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100 and part.headers["content-range"] == "bytes 0-99/10240"
    services = client.app.state.services
    assert services.registry.get(job_id).delivered_at is None
    # O resto até o último byte: entregue.
    rest = client.get(f"/file/{job_id}", headers={"Range": "bytes=100-"})
    assert rest.status_code == 206 and len(rest.content) == 10140
    assert services.registry.get(job_id).delivered_at is not None

    # Depois da carência, a faxina apaga a pasta e o registro.
    services.registry.prune(now=time.time() + services.settings.delivered_grace + 1)
    assert not job_dir.exists()
    assert client.get(f"/job/{job_id}").status_code == 404
    assert client.get(f"/file/{job_id}").status_code == 404


def test_app_avisa_que_salvou_e_o_arquivo_some_na_hora(make_client, tmp_path):
    client = make_client()
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123"}).json()
    job_id = client.post("/download", json={"token": media["token"], "formatId": "a:mp3:320"}).json()["id"]
    wait_for(lambda: ready(client, job_id))
    assert ready(client, job_id)["file"]["name"].endswith(".mp3")
    whole = client.get(f"/file/{job_id}")
    assert whole.status_code == 200 and len(whole.content) == 10240
    assert client.delete(f"/job/{job_id}").json() == {"ok": True}
    assert not (tmp_path / "ritmo-downloader" / "jobs" / job_id).exists()


def test_arquivo_pronto_e_abandonado_expira(make_client, tmp_path):
    client = make_client()
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123"}).json()
    job_id = client.post("/download", json={"token": media["token"], "formatId": "v:18"}).json()["id"]
    wait_for(lambda: ready(client, job_id))
    services = client.app.state.services
    services.registry.prune(now=time.time() + services.settings.ready_ttl + 1)
    assert not (tmp_path / "ritmo-downloader" / "jobs" / job_id).exists()


def test_playlist_em_lote(make_client, runner):
    client = make_client()
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=v1&list=PL1", "playlist": True}).json()
    assert media["kind"] == "playlist" and media["playlist"]["count"] == 3
    assert [e["id"] for e in media["playlist"]["entries"]] == ["v1", "v2", "v3"]
    assert [f["id"] for f in media["formats"]] == ["h:1080", "h:720", "h:480", "h:360"]

    # Um formato exato não vale para playlist (cada vídeo tem os seus).
    assert client.post("/download", json={"token": media["token"], "formatId": "v:137"}).status_code == 400
    assert client.post("/download", json={"token": media["token"], "formatId": "h:720", "entries": ["nao-existe"]}).status_code == 400

    created = client.post("/download", json={"token": media["token"], "formatId": "h:720", "subtitles": "as:pt", "entries": ["v1", "v3", "v1"]}).json()
    assert [job["entryId"] for job in created["jobs"]] == ["v1", "v3"] and created["batchId"]
    ids = created["ids"]
    wait_for(lambda: all(j["status"] == "ready" for j in client.get("/jobs", params={"ids": ",".join(ids)}).json()["jobs"]))
    statuses = client.get("/jobs", params={"ids": ",".join([*ids, "sumiu"])}).json()
    assert statuses["missing"] == ["sumiu"] and {j["title"] for j in statuses["jobs"]} == {"Primeiro", "Terceiro"}
    sources = sorted(call["source"] for call in runner.calls)
    assert sources == ["https://www.youtube.com/watch?v=v1", "https://www.youtube.com/watch?v=v3"]
    assert all(call["from_info"] is False and "height<=720" in call["plan"].format for call in runner.calls)


def test_busca(make_client):
    client = make_client()
    items = client.get("/search", params={"q": "lofi", "limit": 2}).json()["items"]
    assert [item["title"] for item in items] == ["Primeiro", "Segundo"]
    assert client.get("/search", params={"q": "a"}).status_code == 400


def test_link_da_rede_local_e_recusado(make_client):
    client = make_client()
    response = client.post("/resolve", json={"url": "http://192.168.0.1/admin"})
    assert response.status_code == 400 and response.json()["code"] == "private-host"


def test_erro_do_video_vira_mensagem(make_client, runner):
    client = make_client()
    runner.extract_errors.append(yt_error("ERROR: [youtube] abc: Private video. Sign in if you've been granted access"))
    response = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc"})
    assert response.status_code == 422 and response.json() == {"detail": "Este vídeo é privado.", "code": "private"}


def test_extrator_quebrado_atualiza_e_tenta_de_novo(make_client, runner, pip: FakePip):
    pip.stable = "2026.05.05"
    client = make_client(auto_update=True)
    runner.extract_errors.append(yt_error("ERROR: [youtube] abc: Sign in to confirm you're not a bot"))
    response = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc"})
    assert response.status_code == 200
    assert client.app.state.services.updater.version == "2026.05.05"


def test_download_que_falha_atualiza_e_repete(make_client, runner, pip: FakePip):
    pip.stable = "2026.06.06"
    client = make_client(auto_update=True)
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123"}).json()
    runner.download_errors.append(yt_error("ERROR: [youtube] abc123: nsig extraction failed"))
    job_id = client.post("/download", json={"token": media["token"], "formatId": "v:137"}).json()["id"]
    wait_for(lambda: ready(client, job_id))
    # Segunda tentativa lê o site de novo (sem os metadados da versão antiga).
    assert [call["from_info"] for call in runner.calls] == [True, False]


def test_capa_que_falha_entrega_sem_capa(make_client, runner):
    client = make_client()
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123"}).json()
    runner.download_errors.append(yt_error("ERROR: Postprocessing: Unable to embed thumbnail"))
    job_id = client.post("/download", json={"token": media["token"], "formatId": "a:mp3:128"}).json()["id"]
    wait_for(lambda: ready(client, job_id))
    assert [call["with_thumbnail"] for call in runner.calls] == [True, False]


def test_cancelar_mata_o_download_e_limpa(make_client, runner, tmp_path):
    client = make_client()
    runner.block.set()
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123"}).json()
    job_id = client.post("/download", json={"token": media["token"], "formatId": "v:137"}).json()["id"]
    assert runner.started.wait(5)
    client.delete(f"/job/{job_id}")
    wait_for(lambda: not (tmp_path / "ritmo-downloader" / "jobs" / job_id).exists())
    assert client.get(f"/job/{job_id}").json()["status"] == "cancelled"


def test_leitura_expirada(make_client):
    client = make_client(resolve_ttl=0)
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123"}).json()
    time.sleep(0.01)
    response = client.post("/download", json={"token": media["token"], "formatId": "v:137"})
    assert response.status_code == 410 and response.json()["code"] == "expired"


def test_id_malicioso_nao_apaga_nada_fora_do_servidor(make_client, tmp_path):
    client = make_client()
    alvo = tmp_path / "importante"
    alvo.mkdir()
    (alvo / "foto.jpg").write_bytes(b"x")
    for job_id in [str(alvo), "..%5C..%5Cimportante", "../../importante", "%2e%2e/%2e%2e/importante", "C:%5CWindows"]:
        response = client.delete(f"/job/{job_id}")
        assert response.status_code in (404, 405, 422), (job_id, response.status_code)
    assert (alvo / "foto.jpg").exists()
    services = client.app.state.services
    assert services.storage.remove_job("../../importante") is True and (alvo / "foto.jpg").exists()
    services.registry.delete_later(str(alvo))
    services.registry.prune()
    assert (alvo / "foto.jpg").exists()
    assert client.get("/jobs", params={"ids": f"..,{'a' * 32}"}).json()["missing"] == ["a" * 32, ".."]


def test_espiada_no_fim_do_arquivo_nao_conta_como_entregue(make_client):
    client = make_client()
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123"}).json()
    job_id = client.post("/download", json={"token": media["token"], "formatId": "v:18"}).json()["id"]
    wait_for(lambda: ready(client, job_id))
    registry = client.app.state.services.registry
    client.get(f"/file/{job_id}", headers={"Range": "bytes=10000-"})  # player espiando o fim
    assert registry.get(job_id).delivered_at is None
    client.get(f"/file/{job_id}", headers={"Range": "bytes=0-4999"})
    assert registry.get(job_id).delivered_at is None
    client.get(f"/file/{job_id}", headers={"Range": "bytes=5000-"})  # retomada até o fim
    assert registry.get(job_id).delivered_at is not None


def test_cancelar_no_ultimo_instante_nao_volta_a_ficar_pronto(make_client, runner, tmp_path):
    from ritmo_server.jobs.models import CANCELLED, READY

    client = make_client()
    media = client.post("/resolve", json={"url": "https://www.youtube.com/watch?v=abc123"}).json()
    services = client.app.state.services
    runner.block.set()
    job_id = client.post("/download", json={"token": media["token"], "formatId": "v:137"}).json()["id"]
    assert runner.started.wait(5)
    services.registry.update(job_id, status=CANCELLED)
    assert services.registry.update(job_id, status=READY, file={"name": "x"}) is False
    assert services.registry.get(job_id).status == CANCELLED
    runner.block.clear()
