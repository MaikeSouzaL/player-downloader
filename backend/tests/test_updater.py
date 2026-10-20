import time

from ritmo_server.ytdlp.updater import Updater

from .conftest import FakePip, make_settings

BOT = "ERROR: [youtube] abc: Sign in to confirm you're not a bot"


def test_nao_atualiza_quando_desligado_ou_erro_do_video(tmp_path):
    pip = FakePip(stable="2026.02.02")
    off = Updater(make_settings(tmp_path, auto_update=False), python="python", run=pip)
    assert off.maybe_update_for(BOT, time.time()) is False
    on = Updater(make_settings(tmp_path, auto_update=True), python="python", run=pip)
    assert on.maybe_update_for("ERROR: [youtube] abc: Private video", time.time()) is False
    assert not any("pip" in cmd for cmd in pip.commands)


def test_atualiza_a_estavel_e_avisa_para_repetir(tmp_path):
    pip = FakePip(stable="2026.02.02")
    updater = Updater(make_settings(tmp_path, auto_update=True), python="python", run=pip)
    assert updater.maybe_update_for(BOT, time.time()) is True
    assert updater.version == "2026.02.02" and updater.generation == 1
    assert updater.history[0]["channel"] == "stable"
    assert not any("dev0" in part for cmd in pip.commands for part in cmd)
    # Troca só o yt-dlp e depois confere as dependências (sem forçar a atualização delas).
    pips = [cmd for cmd in pip.commands if "pip" in cmd]
    assert "--no-deps" in pips[0] and pips[1][-1] == "yt-dlp[default]" and "-U" not in pips[1]


def test_sem_estavel_nova_tenta_a_nightly(tmp_path):
    pip = FakePip(stable=None, nightly="2026.02.03.120000")
    updater = Updater(make_settings(tmp_path, auto_update=True), python="python", run=pip)
    assert updater.maybe_update_for(BOT, time.time()) is True
    # A versão "dev" vale só para o yt-dlp (nada de --pre para todas as dependências).
    assert any("yt-dlp>=0.0.0.dev0" in cmd for cmd in pip.commands)
    assert not any("--pre" in cmd for cmd in pip.commands)
    assert updater.history[0]["channel"] == "nightly"


def test_espera_entre_tentativas_e_aproveita_atualizacao_de_outro_pedido(tmp_path):
    pip = FakePip(stable=None, nightly=None)
    updater = Updater(make_settings(tmp_path, auto_update=True, update_cooldown=3600), python="python", run=pip)
    assert updater.maybe_update_for(BOT, time.time()) is False  # nada novo
    pip_runs = sum("pip" in cmd for cmd in pip.commands)
    assert updater.maybe_update_for(BOT, time.time()) is False  # dentro do intervalo: nem tenta
    assert sum("pip" in cmd for cmd in pip.commands) == pip_runs

    started = time.time() - 10
    updater.last_change = time.time()  # outro pedido atualizou depois que este começou
    assert updater.maybe_update_for(BOT, started) is True


def test_conferencia_diaria_so_sem_downloads(tmp_path):
    pip = FakePip(stable="2026.03.03")
    updater = Updater(make_settings(tmp_path, auto_update=True), python="python", run=pip)
    updater.scheduled(busy=lambda: True)
    assert updater.version is None
    updater.scheduled(busy=lambda: False)
    assert updater.version == "2026.03.03"
    updater.scheduled(busy=lambda: False)  # já conferiu hoje
    assert len(updater.history) == 1


def test_atualizacao_espera_os_processos_e_segura_os_novos(tmp_path):
    import threading

    pip = FakePip(stable="2026.04.04")
    updater = Updater(make_settings(tmp_path, auto_update=True), python="python", run=pip)
    started = threading.Event()
    release = threading.Event()

    def running_download():
        with updater.running():
            started.set()
            release.wait(5)

    thread = threading.Thread(target=running_download)
    thread.start()
    started.wait(2)
    assert updater.active == 1
    result = {}
    upd = threading.Thread(target=lambda: result.setdefault("changed", updater.update("teste")))
    upd.start()
    time_ok = upd.join(0.3) or upd.is_alive()
    assert time_ok and updater.updating  # esperando o download terminar
    release.set()
    thread.join(2)
    upd.join(5)
    assert result["changed"] is True and not updater.updating and updater.active == 0
