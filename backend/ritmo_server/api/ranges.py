"""Cabeçalho Range (o download do celular retoma de onde parou)."""

from __future__ import annotations

import re

_RANGE = re.compile(r"\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*")


def parse_range(header: str | None, size: int) -> tuple[int, int, bool] | None:
    """
    (início, fim, parcial). None = intervalo impossível (responder 416).
    Formatos que não entendemos (vários intervalos) recebem o arquivo inteiro, como manda a RFC.
    """
    whole = (0, size - 1, False)
    if not header:
        return whole
    match = _RANGE.fullmatch(header)
    if not match:
        return whole
    first, last = match.groups()
    if not first and not last:
        return whole
    if not first:
        # "bytes=-500": os últimos 500 bytes.
        length = int(last)
        if length == 0:
            return None
        return max(0, size - length), size - 1, True
    start = int(first)
    end = min(int(last), size - 1) if last else size - 1
    if start >= size or start > end:
        return None
    return start, end, True
