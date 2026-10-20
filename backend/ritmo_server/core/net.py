"""Rede: endereço do PC na rede local e validação dos links recebidos."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

from .errors import UserError

_LOCAL_NAMES = {"localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"}
_LOCAL_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home", ".home.arpa", ".intranet")


def lan_ip() -> str:
    """IP do PC na rede local (o que o celular usa). Não envia nada: só escolhe a interface."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def _literal_ip(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    """IP escrito no link, inclusive formas curtas que o sistema aceita ("127.1", "2130706433", "0x7f.1")."""
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        pass
    try:
        return ipaddress.IPv4Address(socket.inet_aton(host))
    except (OSError, ValueError):
        return None


def _blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    # Só endereços da internet: nada de privado, loopback, link-local, CGNAT/Tailscale (100.64/10)…
    return not ip.is_global or ip.is_multicast


def _is_private_host(host: str) -> bool:
    host = host.strip("[]").rstrip(".").lower()
    if not host or host in _LOCAL_NAMES or host.endswith(_LOCAL_SUFFIXES) or "." not in host and ":" not in host:
        # Nome sem domínio ("nas", "router") também é da rede local.
        return True
    literal = _literal_ip(host)
    if literal is not None:
        return _blocked(literal)
    # Nome que aponta para a rede local (ex.: 127.0.0.1.nip.io): confere todos os endereços.
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except (OSError, UnicodeError):
        return False  # não resolveu: o yt-dlp vai falhar sozinho com uma mensagem clara
    for info in infos:
        try:
            if _blocked(ipaddress.ip_address(info[4][0].split("%")[0])):
                return True
        except ValueError:
            continue
    return False


def validate_url(url: str, *, allow_private: bool) -> str:
    """Só http(s) para um site da internet: o servidor não pode virar um proxy para a rede da casa."""
    url = (url or "").strip()
    try:
        parts = urlsplit(url)
        hostname = parts.hostname
    except ValueError as exc:
        raise UserError("Link inválido.", code="invalid", status=400) from exc
    if parts.scheme.lower() not in {"http", "https"} or not hostname:
        raise UserError("Envie um link http(s).", code="invalid", status=400)
    if not allow_private and _is_private_host(hostname):
        raise UserError("Links para o próprio PC ou para a rede local não são aceitos.", code="private-host", status=400)
    return url
