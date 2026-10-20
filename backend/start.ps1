# Sobe o servidor no PC (Windows) e mostra o endereço para colocar no Ritmo.
# Uso:  .\start.ps1                      (porta 8787)
#       .\start.ps1 -Port 9000 -Key "uma-senha-longa"
#       .\start.ps1 -Nightly             (usa sempre a versão nightly do yt-dlp)
#       .\start.ps1 -NoUpdate            (não atualiza o yt-dlp sozinho)
#       .\start.ps1 -Public              (aberto para a internet por um túnel: chave obrigatória)
param(
    [int]$Port = 8787,
    [string]$Key = "",
    [switch]$Nightly,
    [switch]$NoUpdate,
    [switch]$Public
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $here '.venv'
$python = Join-Path $venv 'Scripts\python.exe'

if (-not (Test-Path $python)) {
    Write-Host "Criando ambiente Python..." -ForegroundColor Cyan
    py -3.12 -m venv $venv
    & $python -m pip install --upgrade pip
    & $python -m pip install -r (Join-Path $here 'requirements.txt')
}

if ($Public) {
    # Sem -Key, usa a chave guardada em ritmo.key (ou cria uma): o app embutido continua valendo.
    $keyFile = Join-Path $here 'ritmo.key'
    if (-not $Key -and (Test-Path $keyFile)) { $Key = (Get-Content $keyFile -Raw).Trim() }
    if (-not $Key) {
        $bytes = New-Object byte[] 24
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $Key = -join ($bytes | ForEach-Object { $_.ToString('x2') })
        Set-Content -Path $keyFile -Value $Key -Encoding ascii -NoNewline
        Write-Host "Chave nova criada em $keyFile" -ForegroundColor Green
    }
    $env:RITMO_PUBLIC = '1'
    Write-Host "Modo internet: o app precisa da chave que está em $keyFile." -ForegroundColor Cyan
}

if ($Key) { $env:RITMO_KEY = $Key }
$env:PORT = "$Port"
if ($Nightly) { $env:RITMO_YTDLP_CHANNEL = 'nightly' }
if ($NoUpdate) { $env:RITMO_AUTO_UPDATE = '0' }

# Libera a porta no firewall (só na primeira vez; precisa de PowerShell como administrador).
try {
    if (-not (Get-NetFirewallRule -DisplayName "Ritmo Downloader" -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName "Ritmo Downloader" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
        Write-Host "Regra de firewall criada para a porta $Port." -ForegroundColor Green
    }
} catch {
    Write-Host "Não deu para criar a regra de firewall (rode como administrador se o celular não conectar)." -ForegroundColor Yellow
}

if (-not $Key) {
    Write-Host "Sem chave: qualquer aparelho da sua rede pode usar o servidor. Use -Key para proteger." -ForegroundColor Yellow
}
Write-Host "Servidor em http://0.0.0.0:$Port  (feche esta janela para parar)" -ForegroundColor Cyan
& $python -m uvicorn ritmo_server.main:app --host 0.0.0.0 --port $Port --app-dir $here
