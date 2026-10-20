import pytest

from ritmo_server.api.ranges import parse_range
from ritmo_server.core.errors import UserError, friendly, last_error, needs_update
from ritmo_server.core.net import validate_url
from ritmo_server.core.text import output_name, sanitize_name
from ritmo_server.ytdlp.media import entry_item, youtube_playlist_url
from ritmo_server.ytdlp.runner import parse_progress


@pytest.mark.parametrize(
    "text",
    [
        "ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies…",
        "ERROR: [youtube] abc: nsig extraction failed: Some formats may be missing",
        "ERROR: [generic] Unable to extract title; please report this issue on https://github.com/yt-dlp/yt-dlp/issues",
        "ERROR: [youtube] abc: Requested format is not available",
        "ERROR: unable to download video data: HTTP Error 403: Forbidden",
    ],
)
def test_erros_que_pedem_atualizacao(text):
    assert needs_update(text)


@pytest.mark.parametrize(
    "text",
    [
        "ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video",
        "ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader",
        "ERROR: [youtube] abc: The uploader has not made this video available in your country",
        "ERROR: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>",
        "ERROR: [youtube] abc: Join this channel to get access to members-only content",
        "ERROR: Read timed out",
    ],
)
def test_erros_que_nao_pedem_atualizacao(text):
    assert not needs_update(text)


def test_mensagens_amigaveis():
    assert friendly("ERROR: [youtube] abc: Private video")[0] == "private"
    assert friendly("ERROR: [youtube] x: Sign in to confirm you're not a bot")[0] == "bot"
    assert friendly("ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate for some users.")[0] == "age"
    assert friendly("ERROR: Unsupported URL: https://exemplo.com")[0] == "unsupported"
    code, message = friendly("ERROR: [vimeo] 123: algo estranho aconteceu")
    assert code == "failed" and message == "algo estranho aconteceu"


def test_ultima_linha_de_erro():
    output = "[youtube] abc: Downloading webpage\nERROR: primeiro\nWARNING: nada\nERROR: segundo\n[info] fim"
    assert last_error(output) == "ERROR: segundo"
    assert last_error("só texto\n\n") == "só texto"


@pytest.mark.parametrize(
    "url",
    ["http://localhost:8787/x", "http://127.0.0.1/a.mp4", "http://192.168.0.10/v", "http://10.0.0.1", "http://[::1]/", "http://nas.local/x", "file:///etc/passwd", "ftp://site.com/a"],
)
def test_links_bloqueados(url):
    with pytest.raises(UserError):
        validate_url(url, allow_private=False)


def test_links_aceitos():
    assert validate_url(" https://www.youtube.com/watch?v=abc ", allow_private=False) == "https://www.youtube.com/watch?v=abc"
    assert validate_url("http://192.168.0.10/v.mp4", allow_private=True)


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, (0, 999, False)),
        ("bytes=0-", (0, 999, True)),
        ("bytes=100-199", (100, 199, True)),
        ("bytes=900-5000", (900, 999, True)),
        ("bytes=-100", (900, 999, True)),
        ("bytes=0-1,5-9", (0, 999, False)),
        ("bytes=1000-", None),
        ("bytes=500-100", None),
        ("bytes=-0", None),
    ],
)
def test_range(header, expected):
    assert parse_range(header, 1000) == expected


def test_nomes():
    assert sanitize_name('  ..Clipe: "ao vivo" / 2024?.. ') == "Clipe_ _ao vivo_ _ 2024_"
    assert sanitize_name("..") == "arquivo"
    assert output_name("Música nova", ".MP3") == "Música nova.mp3"


def test_itens_da_playlist():
    assert entry_item({"id": "v9", "ie_key": "Youtube", "title": "x"})["url"] == "https://www.youtube.com/watch?v=v9"
    assert entry_item({"id": "q", "ie_key": "Other"}) is None
    assert youtube_playlist_url("https://www.youtube.com/watch?v=a&list=PLabc") == "https://www.youtube.com/playlist?list=PLabc"
    assert youtube_playlist_url("https://www.youtube.com/watch?v=a&list=RDabc") is None
    assert youtube_playlist_url("https://vimeo.com/123?list=PL") is None


def test_progresso_do_ytdlp():
    p = parse_progress("RITMO-DL downloading|512|1024|NA")
    assert p and p.kind == "download" and p.downloaded == 512 and p.total == 1024
    p = parse_progress("RITMO-DL downloading|512|NA|2048.5")
    assert p and p.total == 2048
    p = parse_progress("RITMO-PP started|Merger")
    assert p and p.kind == "postprocess" and p.postprocessor == "Merger"
    assert parse_progress("[download] 10% of 1MiB") is None


@pytest.mark.parametrize("url", ["http://127.1/", "http://2130706433/", "http://0x7f.1/", "http://0/", "http://100.64.0.1/", "http://[::ffff:127.0.0.1]/", "http://roteador/"])
def test_formas_disfarcadas_de_ip_local(url):
    with pytest.raises(UserError):
        validate_url(url, allow_private=False)


def test_qualidade_indisponivel_nao_vira_video_indisponivel():
    assert friendly("ERROR: [youtube] abc: Requested format is not available. Use --list-formats")[0] == "format"
    assert friendly("ERROR: [youtube] abc: Video unavailable")[0] == "unavailable"


def test_pagina_sem_video_nao_dispara_atualizacao():
    assert not needs_update("ERROR: Unsupported URL: https://exemplo.com/artigo")
    assert needs_update("ERROR: [youtube] abc: n challenge solving failed")
