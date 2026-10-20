"""
Cookies do YouTube que o app manda junto de cada pedido.

O servidor **não guarda cookies**: valida o texto, escreve um arquivo temporário só para aquela
chamada do yt-dlp e apaga no fim. Cada job leva o seu próprio conjunto (o `cookies` vem do app na
hora do download), então vários usuários podem usar o mesmo servidor sem misturar contas.

Formatos aceitos:
  - Netscape cookies.txt (o da extensão "Get cookies.txt LOCALLY");
  - o cabeçalho `Cookie: nome=valor; ...` copiado das ferramentas do navegador.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from .core.errors import UserError

MAX_BYTES = 200_000
_NAME = re.compile(r"^[A-Za-z0-9_.\-]+$")
_COOKIE_DOMAINS = ("youtube.com", "google.com")


def _is_cookie_domain(domain: str) -> bool:
    return any(domain == base or domain.endswith(f".{base}") for base in _COOKIE_DOMAINS)


def _netscape_lines(text: str) -> list[tuple[str, str, str]]:
    """Lê linhas Netscape (7 campos separados por TAB). Ignora comentários e linhas quebradas."""
    found: list[tuple[str, str, str]] = []
    for raw in text.splitlines():
        line = raw.rstrip("\r")
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
        elif not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        domain = parts[0].strip().lower()
        name = parts[5].strip()
        value = parts[6]
        if domain and _NAME.fullmatch(name):
            found.append((domain, name, value))
    return found


def _header_lines(text: str) -> list[tuple[str, str, str]]:
    """Converte `Cookie: a=b; c=d` em cookies de `.youtube.com` (sem expiração)."""
    value = text.strip()
    if value.lower().startswith("cookie:"):
        value = value.split(":", 1)[1]
    found: list[tuple[str, str, str]] = []
    for part in value.split(";"):
        if "=" not in part:
            continue
        name, item = part.split("=", 1)
        name = name.strip()
        if name and _NAME.fullmatch(name):
            found.append((".youtube.com", name, item.strip()))
    return found


def _normalize(text: str) -> tuple[str, int]:
    if not text or not text.strip():
        raise UserError("Envie os cookies do YouTube.", code="cookies", status=400)
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise UserError("O arquivo de cookies é grande demais.", code="cookies", status=400)

    cookies = _netscape_lines(text)
    if cookies:
        # Mantém o texto original (o yt-dlp entende comentários e #HttpOnly_), mas garante o
        # cabeçalho que o MozillaCookieJar exige e uma quebra de linha no fim.
        normalized = text.replace("\r\n", "\n").strip("\n") + "\n"
        if not normalized.lstrip().startswith(("# Netscape HTTP Cookie File", "# HTTP Cookie File")):
            normalized = "# Netscape HTTP Cookie File\n" + normalized
    else:
        cookies = _header_lines(text)
        if not cookies:
            raise UserError("Formato de cookies não reconhecido. Use o cookies.txt do navegador.", code="cookies", status=400)
        normalized = "# Netscape HTTP Cookie File\n" + "\n".join(
            f"{domain}\tTRUE\t/\tTRUE\t0\t{name}\t{value}" for domain, name, value in cookies
        ) + "\n"
    if not any(_is_cookie_domain(domain) for domain, _, _ in cookies):
        raise UserError("O arquivo não tem cookies do YouTube.", code="cookies", status=400)
    return normalized, len(cookies)


class CookieJar:
    """Cookies de um pedido/job. Não mantém texto em memória nem arquivo permanente."""

    def __init__(self, base: Path) -> None:
        self.base = base

    def validate(self, text: str) -> None:
        _normalize(text or "")

    def write(self, text: str) -> Path:
        """Um arquivo por chamada do yt-dlp; quem chamou apaga com `discard`."""
        normalized, _ = _normalize(text or "")
        self.base.mkdir(parents=True, exist_ok=True)
        path = self.base / f"{uuid.uuid4().hex}.txt"
        path.write_text(normalized, encoding="utf-8")
        try:
            path.chmod(0o600)
        except OSError:
            pass  # Windows: o diretório temporário já é do usuário
        return path

    @staticmethod
    def discard(path: Path | None) -> None:
        if path is None:
            return
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
