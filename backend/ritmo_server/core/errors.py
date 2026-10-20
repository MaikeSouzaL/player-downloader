"""Erros do servidor e a leitura das mensagens do yt-dlp (o que dizer ao usuário e quando se atualizar)."""

from __future__ import annotations

import re


class UserError(Exception):
    """Erro com mensagem para mostrar no app."""

    def __init__(self, message: str, *, code: str = "failed", status: int = 422) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


class YtDlpError(Exception):
    """O yt-dlp terminou com erro. `output` guarda o fim do que ele escreveu."""

    def __init__(self, message: str, output: str = "") -> None:
        super().__init__(message)
        self.output = output or message


class Cancelled(Exception):
    """O download foi cancelado pelo app."""


ANSI = re.compile(r"\x1b\[[0-9;]*m")
PREFIX = re.compile(r"^(?:ERROR:\s*)?(?:\[[^\]]+\]\s*)?(?:[\w-]+:\s+)?")


def clean(text: str) -> str:
    return ANSI.sub("", text or "").strip()


def last_error(output: str) -> str:
    """A linha "ERROR: …" mais recente; senão a última linha com texto."""
    lines = [clean(line) for line in (output or "").splitlines()]
    lines = [line for line in lines if line]
    for line in reversed(lines):
        if line.startswith("ERROR:"):
            return line
    return lines[-1] if lines else ""


# Erros em que atualizar o yt-dlp não adianta (o vídeo, a rede ou o PC é o problema).
NO_UPDATE_HINTS = (
    "private video",
    "video is private",
    "has been removed",
    "account associated with this video has been terminated",
    "copyright",
    "members-only",
    "join this channel",
    "confirm your age",
    "age-restricted",
    "inappropriate for some users",
    "available in your country",
    "geo restriction",
    "geo-restricted",
    "live event will begin",
    "premieres in",
    "timed out",
    "getaddrinfo",
    "name or service not known",
    "nodename nor servname",
    "connection refused",
    "network is unreachable",
    "temporary failure in name resolution",
    "no space left",
    "ffmpeg not found",
    "ffprobe and ffmpeg not found",
    "http error 404",
    "http error 410",
    "login required",
    "requires authentication",
    "cookies are no longer valid",
    "cookie file is no longer valid",
    "the provided youtube account cookies are no longer valid",
    "failed to decrypt cookies",
    "cookies have expired",
)

# Sinais de extrator quebrado ou proteção nova do site: uma versão mais nova costuma resolver.
NEEDS_UPDATE_HINTS = (
    "unable to extract",
    "nsig",
    "signature extraction",
    "sign in to confirm",
    "not a bot",
    "po token",
    "please report this issue",
    "confirm you are on the latest version",
    "requested format is not available",
    "no video formats found",
    "http error 403",
    "precondition check failed",
    "player response",
    "jsinterp",
    "challenge solving",
    "n challenge",
    "sig challenge",
    "js challenge",
    "unable to download api page",
    "unable to download webpage: http error 400",
)


def needs_update(text: str) -> bool:
    low = clean(text).lower()
    if any(hint in low for hint in NO_UPDATE_HINTS):
        return False
    return any(hint in low for hint in NEEDS_UPDATE_HINTS)


def friendly(text: str) -> tuple[str, str]:
    """(código, mensagem em português) para um erro do yt-dlp."""
    raw = last_error(text) or clean(text)
    low = clean(text).lower()

    def has(*words: str) -> bool:
        return any(word in low for word in words)

    # A idade vem antes: "Sign in to confirm your age" também começa com "sign in to confirm".
    if has("confirm your age", "age-restricted", "inappropriate for some users"):
        return "age", "Este vídeo tem restrição de idade e só abre com login."
    if has("cookies are no longer valid", "cookie file is no longer valid", "failed to decrypt cookies", "cookies have expired", "cookie expired"):
        return "cookies", "Os cookies do YouTube expiraram. Envie o arquivo de cookies de novo."
    if has("not a bot"):
        return "bot", "O site pediu verificação de robô. Entre na sua conta em Ajustes › Conta do YouTube (ou use o cookies.txt) e tente de novo."
    if has("private video", "video is private"):
        return "private", "Este vídeo é privado."
    if has("members-only", "join this channel"):
        return "members", "Este conteúdo é só para membros ou assinantes."
    if has("login required", "requires authentication", "log in to", "logged-in", "you need to log in"):
        return "login", "Este site pede login para este conteúdo."
    if has("available in your country", "geo restriction", "geo-restricted"):
        return "geo", "Este vídeo não está disponível no país do servidor."
    if has("live event will begin", "premieres in", "is a live", "live stream", "is_live"):
        return "live", "Transmissões ao vivo e estreias não podem ser baixadas."
    if has("requested format is not available", "no video formats found"):
        return "format", "Essa qualidade não está mais disponível. Leia o link de novo."
    if has("has been removed", "video unavailable", "video is not available", "is no longer available", "account associated with this video has been terminated"):
        return "unavailable", "Este vídeo não está disponível."
    if has("unsupported url"):
        return "unsupported", "Este site não é suportado ou o link não tem vídeo."
    if has("ffmpeg not found", "ffprobe and ffmpeg not found", "ffmpeg is not installed"):
        return "ffmpeg", "Falta o FFmpeg no servidor para juntar ou converter."
    if has("no space left"):
        return "disk", "Sem espaço no disco do servidor."
    if has("http error 403"):
        return "forbidden", "O site recusou o download (403). Tente de novo em instantes."
    if has("timed out", "timeout", "getaddrinfo", "connection refused", "network is unreachable", "name resolution"):
        return "network", "O site demorou ou não respondeu. Tente de novo."
    message = PREFIX.sub("", raw).strip()
    return "failed", (message[:300] or "Falha ao ler o link.")
