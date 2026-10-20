# Servidor do Ritmo (yt-dlp + FFmpeg + Node para os desafios do YouTube).
# VPS:  docker build -t ritmo-downloader . && docker run -d -p 8787:8787 -e RITMO_KEY=... ritmo-downloader
# Não precisa de volume: os arquivos são temporários e somem depois que o celular baixa.
FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN python3 -m venv /venv \
  && /venv/bin/pip install --no-cache-dir --upgrade pip \
  && /venv/bin/pip install --no-cache-dir -r requirements.txt

COPY ritmo_server ./ritmo_server
COPY app.py ./
# O venv é gravável: a autoatualização do yt-dlp funciona dentro do contêiner.
ENV PATH="/venv/bin:$PATH" \
    RITMO_TMP=/tmp \
    PORT=8787
EXPOSE 8787
CMD ["uvicorn", "ritmo_server.main:app", "--host", "0.0.0.0", "--port", "8787"]
