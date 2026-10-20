<#
  Gera o APK release do Ritmo neste Windows e copia para ..\Ritmo.apk.

  Por que tantos passos: o C++ gerado pelo React Native passa do limite de caminho do
  Windows, então o build roda numa cópia em C:\rt com um ninja >= 1.12 (C:\rt-tools\cmake).

  Uso (PowerShell, na pasta ritmo):
    .\build-apk.ps1                 # prebuild + sincroniza + compila
    .\build-apk.ps1 -SkipPrebuild   # só sincroniza e compila (quando app.json/plugins não mudaram)
#>
param(
  [switch]$SkipPrebuild,
  [string]$BuildDir = 'C:\rt',
  [string]$CmakeDir = 'C:\rt-tools\cmake',
  [string]$Abis = 'arm64-v8a,armeabi-v7a',
  # Só para testes: gera com a chave de debug, que NÃO instala por cima da 1.2+ (chave própria).
  [switch]$AllowDebugSigning
)

$ErrorActionPreference = 'Stop'
$Project = $PSScriptRoot
$Out = Join-Path (Split-Path $Project -Parent) 'Ritmo.apk'
$started = Get-Date

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

# JDK: usa o do Android Studio se JAVA_HOME não estiver definido.
if (-not $env:JAVA_HOME) {
  $jbr = 'C:\Program Files\Android\Android Studio\jbr'
  if (-not (Test-Path $jbr)) { throw 'Defina JAVA_HOME (JDK 17 ou mais novo).' }
  $env:JAVA_HOME = $jbr
}

# ninja >= 1.12 lida com caminhos longos; o 1.10 do SDK não.
$ninja = Join-Path $CmakeDir 'bin\ninja.exe'
if (-not (Test-Path $ninja)) { throw "Não achei $ninja. Copie o cmake 3.22.1 do SDK para $CmakeDir e troque o ninja.exe pelo 1.12.1." }
$ninjaVersion = [version](& $ninja --version)
if ($ninjaVersion -lt [version]'1.12') { throw "ninja $ninjaVersion é antigo demais; precisa do 1.12 ou mais novo." }

if (-not $AllowDebugSigning -and -not (Test-Path (Join-Path $env:USERPROFILE '.android\ritmo\signing.properties'))) {
  throw 'Falta a chave do Ritmo em %USERPROFILE%\.android\ritmo (signing.properties). Restaure do backup ou use -AllowDebugSigning para um build de teste.'
}

if (-not $SkipPrebuild) {
  Step 'expo prebuild (android)'
  Push-Location $Project
  try {
    npx expo prebuild --platform android --no-install
    if ($LASTEXITCODE) { throw 'expo prebuild falhou.' }
  } finally { Pop-Location }
}

function Sync([string]$from, [string]$to, [string[]]$extra) {
  robocopy $from $to @extra /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy $from falhou (código $LASTEXITCODE)." }
}

Step "Sincronizando para $BuildDir"
# Código do app: espelho exato (arquivo apagado aqui some lá também). As pastas de build
# (build, .cxx, .gradle) ficam de fora para o Gradle reaproveitar o cache.
foreach ($dir in 'src', 'assets', 'plugins', 'tests') {
  if (Test-Path (Join-Path $Project $dir)) { Sync (Join-Path $Project $dir) (Join-Path $BuildDir $dir) @('/MIR') }
}
Sync (Join-Path $Project 'modules') (Join-Path $BuildDir 'modules') @('/MIR', '/XD', 'build', '.cxx', '.gradle')
Sync (Join-Path $Project 'android') (Join-Path $BuildDir 'android') @('/MIR', '/XD', 'build', '.cxx', '.gradle', '/XF', 'local.properties')
# .env.local = servidor que o app já traz (EXPO_PUBLIC_GRAB_*): se saiu daqui, a cópia antiga não pode sobrar lá.
foreach ($envFile in '.env', '.env.local') {
  $copy = Join-Path $BuildDir $envFile
  if (-not (Test-Path (Join-Path $Project $envFile)) -and (Test-Path $copy)) { Remove-Item $copy }
}
Sync $Project $BuildDir @('app.json', 'package.json', 'package-lock.json', 'tsconfig.json', 'babel.config.js', 'metro.config.js', 'index.ts', 'expo-env.d.ts', '.env', '.env.local')
# node_modules: só copia o que mudou, sem apagar (lá ficam os builds das bibliotecas nativas).
Sync (Join-Path $Project 'node_modules') (Join-Path $BuildDir 'node_modules') @('/E')

$props = Join-Path $BuildDir 'android\local.properties'
$lines = @("cmake.dir=$($CmakeDir -replace '\\', '\\' -replace ':', '\:')")
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if ($sdk) { $lines += "sdk.dir=$($sdk -replace '\\', '\\' -replace ':', '\:')" }
Set-Content -Path $props -Value $lines -Encoding ascii

Step 'gradlew :app:assembleRelease'
Push-Location (Join-Path $BuildDir 'android')
try {
  .\gradlew.bat :app:assembleRelease "-PreactNativeArchitectures=$Abis"
  if ($LASTEXITCODE) { throw 'O build do Gradle falhou (veja a saída acima).' }
} finally { Pop-Location }

$apk = Join-Path $BuildDir 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apk)) { throw "APK não encontrado em $apk." }

# Assinatura própria com rotação de chave (APK Signature Scheme v3): o Android 9+ aceita a
# atualização por cima das versões assinadas com a chave de debug, sem desinstalar.
# A chave, a senha e a "linhagem" ficam fora do projeto, em %USERPROFILE%\.android\ritmo.
$signing = Join-Path $env:USERPROFILE '.android\ritmo'
$signingProps = Join-Path $signing 'signing.properties'
if (Test-Path $signingProps) {
  Step 'Assinando com a chave do Ritmo'
  $p = @{}
  Get-Content $signingProps | ForEach-Object { $k, $v = $_ -split '=', 2; $p[$k] = $v }
  $buildTools = Get-ChildItem (Join-Path $(if ($sdk) { $sdk } else { "$env:LOCALAPPDATA\Android\Sdk" }) 'build-tools') | Sort-Object { [version]($_.Name -replace '[^0-9.]', '') } | Select-Object -Last 1
  $apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
  $signed = Join-Path $env:TEMP 'ritmo-signed.apk'
  $env:RITMO_KS_PASS = $p.storePassword
  try {
    & $apksigner sign `
      --ks (Join-Path $signing 'debug-original.keystore') --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android `
      --next-signer --ks $p.storeFile --ks-key-alias $p.keyAlias --ks-pass env:RITMO_KS_PASS --key-pass env:RITMO_KS_PASS `
      --lineage (Join-Path $signing 'ritmo.lineage') --rotation-min-sdk-version 28 --out $signed $apk
    if ($LASTEXITCODE) { throw 'apksigner falhou ao assinar.' }
  } finally { Remove-Item Env:RITMO_KS_PASS -ErrorAction SilentlyContinue }
  & $apksigner verify $signed
  if ($LASTEXITCODE) { throw 'A assinatura não passou na verificação.' }
  Move-Item $signed $Out -Force
} elseif ($AllowDebugSigning) {
  Write-Host "Sem ${signingProps}: o APK fica com a chave de debug (não instala por cima da 1.2+)." -ForegroundColor Yellow
  Copy-Item $apk $Out -Force
} else {
  throw "Não achei ${signingProps}. Sem a chave do Ritmo o APK não instala por cima da versão atual. Restaure a pasta $signing do backup (ou use -AllowDebugSigning para um build de teste)."
}

$size = [math]::Round((Get-Item $Out).Length / 1MB, 1)
$minutes = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
Write-Host "`nPronto: $Out ($size MB) em $minutes min." -ForegroundColor Green
