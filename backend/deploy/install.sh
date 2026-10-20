#!/usr/bin/env bash
# Prepara a máquina na nuvem (Ubuntu 22.04/24.04; feito para a Oracle Cloud) e sobe o servidor com
# HTTPS. Quem chama é o deploy.ps1, como root; rodar de novo só atualiza (chave e relatórios ficam).
set -euo pipefail

BASE=/opt/ritmo
cd "$BASE/app/deploy"
[ -f "$BASE/.env" ] || { echo "Falta $BASE/.env (o deploy.ps1 cria)." >&2; exit 1; }
mkdir -p "$BASE/logs"

# Máquina pequena (a E2.1.Micro tem 1 GB): sem swap, o build da imagem e o FFmpeg ficam sem memória.
if [ "$(awk '/MemTotal/ { print $2 }' /proc/meminfo)" -lt 2000000 ] && [ -z "$(swapon --show)" ]; then
  echo "== Criando 2 GB de swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "== Instalando o Docker"
  # Máquina recém-criada: as atualizações automáticas seguram o apt nos primeiros minutos.
  while fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 5; done
  apt-get -o DPkg::Lock::Timeout=300 update -y
  DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y docker.io docker-compose-v2
  systemctl enable --now docker
fi

# A imagem Ubuntu da Oracle vem com o iptables recusando tudo menos a porta 22: libera 80 e 443
# antes da regra de recusa e grava, para continuar valendo depois de reiniciar.
for port in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    reject=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
    iptables -I INPUT "${reject:-1}" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80,443/tcp >/dev/null; fi

echo "== Subindo o servidor (a primeira vez leva alguns minutos)"
# --force-recreate: o Caddyfile novo é outro arquivo, e o contêiner antigo ficaria com o velho montado.
docker compose --env-file "$BASE/.env" up -d --build --force-recreate --remove-orphans
docker image prune -f >/dev/null
docker compose --env-file "$BASE/.env" ps
