# Envia o servidor do PC para a máquina na nuvem (Oracle Cloud ou qualquer Ubuntu com SSH), sobe com
# HTTPS e deixa o app apontando para ela (ritmo\.env.local). Rodar de novo atualiza o servidor.
# Uso:  .\deploy.ps1 -Server 150.230.10.20 -KeyFile "$env:USERPROFILE\.ssh\oracle-ritmo.key" -Domain meuservidor.duckdns.org
#       .\deploy.ps1 -Server 150.230.10.20 -KeyFile ...   (sem domínio: tenta 150-230-10-20.sslip.io)
#       .\deploy.ps1 -Server ... -KeyFile ... -YtDlpArgs '--extractor-args youtube:player_client=tv'
# O .env do servidor é refeito a cada envio: repita o -YtDlpArgs para manter as opções do yt-dlp.
param(
    [Parameter(Mandatory = $true)] [string]$Server,
    [Parameter(Mandatory = $true)] [string]$KeyFile,
    [string]$User = 'ubuntu',
    [string]$Domain = '',
    [string]$YtDlpArgs = ''
)

$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$project = Split-Path -Parent $backend

function Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }

# O OpenSSH vem com o Windows, mas nem sempre a pasta dele está no PATH.
$env:Path += ";$env:SystemRoot\System32\OpenSSH"
if (-not (Get-Command ssh.exe, scp.exe -ErrorAction SilentlyContinue)) {
    throw 'Falta o OpenSSH do Windows (Configurações › Aplicativos › Recursos opcionais › Cliente OpenSSH).'
}

if (-not (Test-Path $KeyFile)) { throw "Não achei a chave SSH em $KeyFile." }
# O OpenSSH do Windows recusa chave privada que outros usuários do PC conseguem ler.
icacls $KeyFile /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null

# HTTPS precisa de um nome. O melhor grátis é um subdomínio do DuckDNS (cada um tem a própria cota
# no Let's Encrypt). Sem -Domain, tenta o sslip.io (150-230-10-20.sslip.io responde com o próprio IP),
# mas a cota dele é dividida com todo mundo e o certificado pode demorar ou não sair.
if (-not $Domain) {
    if ($Server -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'Passe o IP público da máquina em -Server (ou o nome dela em -Domain).' }
    $Domain = ($Server -replace '\.', '-') + '.sslip.io'
}
$url = "https://$Domain"

# A mesma chave do start.ps1 -Public: o app funciona com os dois servidores.
$keyPath = Join-Path $backend 'ritmo.key'
if (Test-Path $keyPath) {
    $apiKey = (Get-Content $keyPath -Raw).Trim()
} else {
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $apiKey = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    Set-Content -Path $keyPath -Value $apiKey -Encoding ascii -NoNewline
    Write-Host "Chave nova criada em $keyPath" -ForegroundColor Green
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ritmo-deploy-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    Step 'Empacotando o servidor'
    $tgz = Join-Path $work 'ritmo-server.tgz'
    tar -czf $tgz --exclude=.venv --exclude=__pycache__ --exclude=.pytest_cache --exclude=./logs --exclude=./data --exclude=./tests --exclude=ritmo.key -C $backend .
    if ($LASTEXITCODE) { throw 'Não deu para empacotar o servidor.' }

    $envLines = @("RITMO_KEY=$apiKey", "RITMO_DOMAIN=$Domain")
    if ($YtDlpArgs) { $envLines += "RITMO_YTDLP_ARGS=$YtDlpArgs" }
    $envFile = Join-Path $work 'ritmo.env'
    # Quebra de linha do Linux e sem BOM: o Docker lê este arquivo.
    [IO.File]::WriteAllText($envFile, ($envLines -join "`n") + "`n")

    $sshOpts = @('-i', $KeyFile, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30')
    $target = "$User@$Server"
    Step "Enviando para $target"
    scp @sshOpts $tgz $envFile "${target}:/tmp/"
    if ($LASTEXITCODE) { throw "O envio falhou. Confira o IP, o usuário ($User) e se a porta 22 está liberada." }

    Step 'Instalando na nuvem (Docker, firewall e HTTPS)'
    # Código novo numa pasta limpa (arquivo apagado aqui não sobra lá); .env e logs ficam fora dela.
    # O tar do Windows grava tudo como gravável por qualquer um: tira isso (o install.sh roda como root).
    # O trap apaga a chave do /tmp mesmo se um passo falhar. Só aspas simples aqui: o PowerShell 5.1
    # estraga aspas duplas dentro de um argumento passado ao ssh.
    $remote = 'set -e; trap ''rm -f /tmp/ritmo.env /tmp/ritmo-server.tgz'' EXIT; chmod 600 /tmp/ritmo.env; ' +
        'sudo mkdir -p /opt/ritmo; sudo rm -rf /opt/ritmo/app.new; sudo mkdir /opt/ritmo/app.new; ' +
        'sudo tar -xzf /tmp/ritmo-server.tgz -C /opt/ritmo/app.new --no-same-permissions --no-same-owner; sudo chmod -R go-w /opt/ritmo/app.new; ' +
        'sudo rm -rf /opt/ritmo/app; sudo mv /opt/ritmo/app.new /opt/ritmo/app; ' +
        'sudo install -m 600 /tmp/ritmo.env /opt/ritmo/.env; sudo bash /opt/ritmo/app/deploy/install.sh'
    ssh @sshOpts $target $remote
    if ($LASTEXITCODE) { throw 'A instalação na nuvem falhou (veja a saída acima).' }
} finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

Step "Esperando o HTTPS em $url (o primeiro certificado sai em até 2 minutos)"
$ready = $false
for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
    # -s sem -S: nada vai para o stderr (no PowerShell 5.1, stderr com 'Stop' vira erro fatal).
    curl.exe -fs --ssl-revoke-best-effort --max-time 10 -o NUL "$url/"
    if ($LASTEXITCODE -eq 0) { $ready = $true } else { Start-Sleep -Seconds 6 }
}
if (-not $ready) {
    throw ("O servidor subiu, mas $url não respondeu. Na Oracle, libere as portas 80 e 443 (TCP) na Security List da rede. " +
        "Se já estão liberadas, o certificado não saiu: use um nome do DuckDNS em -Domain (o log está em: sudo docker logs ritmo-caddy-1).")
}

# O app passa a sair de fábrica com este servidor (os outros valores do .env.local ficam).
$envLocal = Join-Path $project '.env.local'
$keep = @()
if (Test-Path $envLocal) { $keep = @(Get-Content $envLocal | Where-Object { $_ -notmatch '^EXPO_PUBLIC_GRAB_(SERVER|KEY)=' }) }
$lines = $keep + @("EXPO_PUBLIC_GRAB_SERVER=$url", "EXPO_PUBLIC_GRAB_KEY=$apiKey")
[IO.File]::WriteAllText($envLocal, ($lines -join "`n") + "`n")

Write-Host "`nPronto: o servidor está em $url" -ForegroundColor Green
Write-Host "O app já aponta para ele em $envLocal. Gere o APK/IPA de novo para valer no celular." -ForegroundColor Green
