import pytest

from ritmo_server.core.errors import UserError
from ritmo_server.ytdlp.formats import codec_label, plan_for, subtitle_args, subtitle_options, video_options

from .conftest import VIDEO_INFO


def test_uma_opcao_por_altura_preferindo_h264():
    options = video_options(VIDEO_INFO)
    assert [o["label"] for o in options] == ["2160p60", "1080p", "360p"]
    by_height = {o["height"]: o for o in options}
    # 1080p: o H.264 (137) ganha do VP9 (248), mesmo maior.
    assert by_height[1080]["_format_id"] == "137"
    assert by_height[1080]["codec"] == "H.264" and by_height[1080]["compatible"] is True
    # Vídeo sem som: o tamanho já soma o melhor áudio M4A.
    assert by_height[1080]["filesize"] == 40_000_000 + 3_000_000
    # 360p: o formato que já vem com som (18) é preferido.
    assert by_height[360]["_format_id"] == "18" and by_height[360]["hasAudio"] is True
    # 4K do YouTube só existe em VP9: marcado como talvez incompatível.
    assert by_height[2160]["compatible"] is False


def test_storyboard_nao_vira_opcao():
    assert all(o["_format_id"] != "sb0" for o in video_options(VIDEO_INFO))


def test_codec_label():
    assert codec_label("avc1.640028") == "H.264"
    assert codec_label("vp09.00.40.08") == "VP9"
    assert codec_label("av01.0.08M.08") == "AV1"
    assert codec_label("none") == ""


def test_planos():
    options = {o["id"]: o for o in video_options(VIDEO_INFO)}
    merged = plan_for("v:137", options=options, subtitles=None, playlist=False)
    assert merged.format == "137+bestaudio[ext=m4a]/137+bestaudio/137" and merged.streams == 2 and merged.media == "video"
    single = plan_for("v:18", options=options, subtitles=None, playlist=False)
    assert single.format == "18" and single.streams == 1

    mp3 = plan_for("a:mp3:192", options=options, subtitles="s:pt-BR", playlist=False)
    assert mp3.media == "audio" and "192K" in mp3.args and "--embed-subs" not in mp3.args
    assert "--embed-thumbnail" in mp3.command_args() and "--embed-thumbnail" not in mp3.command_args(with_thumbnail=False)

    m4a = plan_for("a:m4a:0", options=None, subtitles=None, playlist=True)
    assert m4a.format.startswith("bestaudio[ext=m4a]")

    by_height = plan_for("h:720", options=None, subtitles=None, playlist=True)
    assert "height<=720" in by_height.format and "vcodec^=avc1" in by_height.format


@pytest.mark.parametrize("bad", ["v:999", "a:mp3:999", "x:1", "h:abc", "v:137"])
def test_planos_invalidos(bad):
    options = {} if bad == "v:137" else {o["id"]: o for o in video_options(VIDEO_INFO)}
    with pytest.raises(UserError):
        plan_for(bad, options=options, subtitles=None, playlist=False)


def test_legendas():
    options = subtitle_options(VIDEO_INFO)
    ids = [o["id"] for o in options]
    # Escrita pt-BR; automática do idioma original (en); "pt" automática fica de fora (já há pt escrita).
    assert ids == ["s:pt-BR", "as:en-orig"]
    assert options[0]["name"] == "Português (Brasil)" and options[1]["auto"] is True

    assert subtitle_args("s:pt-BR", playlist=False) == ["--embed-subs", "--sub-langs", r"pt\-BR"]
    assert subtitle_args("as:en-orig", playlist=False) == ["--embed-subs", "--write-auto-subs", "--sub-langs", r"en\-orig"]
    assert "--write-subs" in subtitle_args("as:pt", playlist=True)
    with pytest.raises(UserError):
        subtitle_args("s:pt;rm -rf", playlist=False)


def test_audio_do_melhor_para_o_pior():
    from ritmo_server.ytdlp.formats import audio_options

    assert [a["id"] for a in audio_options(VIDEO_INFO)] == ["a:m4a:0", "a:mp3:320", "a:mp3:192", "a:mp3:128"]
    heights = [o["height"] for o in video_options(VIDEO_INFO)]
    assert heights == sorted(heights, reverse=True)
