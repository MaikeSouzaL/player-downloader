<#
  Confere o APK release do Player Downloader antes de instalar (sideload) ou guardar.

  Checagens:
    - ABIs e libs do motor de download: libpython/libffmpeg/libqjs + os .zip.so por ABI;
    - payload do yt-dlp (recurso raw/ytdlp). Com resource optimization o AGP renomeia o
      arquivo (ex.: res/Nc), então o script resolve o caminho pelo aapt2 e, se preciso,
      procura pelo conteúdo (yt_dlp/version.py);
    - manifest (aapt2): extractNativeLibs=true (ou libs comprimidas = useLegacyPackaging),
      GrabService com foregroundServiceType=dataSync, PlaybackService com mediaPlayback e
      as 3 ações do Media3;
    - bundle JS: precisa ter grabResolve/grabStart; referências ao backend antigo
      (player-downloader/onrender.com/settings/grab) só geram WARN;
    - assinatura (apksigner), zipalign -c -P 16 e alinhamento ELF 16 KB (llvm-readelf).

  Se uma ferramenta (aapt2/apksigner/zipalign/NDK) não existir, o script avisa (WARN) e
  continua. Só termina com código 1 quando uma verificação de fato falha (FAIL).

  Uso (PowerShell, na pasta ritmo):
    .\scripts\verify-apk.ps1
    .\scripts\verify-apk.ps1 -Apk ..\PlayerDownloader-arm64.apk
#>
[CmdletBinding()]
param(
  [string]$Apk,
  [string]$SdkRoot
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Project = Split-Path -Parent $PSScriptRoot
if (-not $Apk) { $Apk = Join-Path (Split-Path -Parent $Project) 'PlayerDownloader.apk' }
if (-not (Test-Path -LiteralPath $Apk) -and -not [System.IO.Path]::IsPathRooted($Apk)) {
  $fromProject = Join-Path $Project $Apk
  if (Test-Path -LiteralPath $fromProject) { $Apk = $fromProject }
}
if (-not (Test-Path -LiteralPath $Apk)) {
  Write-Host "APK não encontrado: $Apk" -ForegroundColor Red
  Write-Host 'Gere com .\build-apk.ps1 (ou passe -Apk caminho\do.apk).'
  exit 1
}
$Apk = (Resolve-Path -LiteralPath $Apk).Path

$script:Results = @()
function Add-Result([string]$Check, [string]$Status, [string]$Detail) {
  $script:Results += [pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail }
}
function Shorten([string]$Text, [int]$Max = 320) {
  $one = ($Text -replace '\s+', ' ').Trim()
  if ($one.Length -le $Max) { return $one }
  return $one.Substring(0, $Max) + '...'
}

function Find-Sdk {
  foreach ($candidate in @($SdkRoot, $env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  return $null
}

$sdk = Find-Sdk
$buildTools = $null
if ($sdk -and (Test-Path -LiteralPath (Join-Path $sdk 'build-tools'))) {
  $buildTools = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory |
    Sort-Object { try { [version]($_.Name -replace '[^0-9.]', '') } catch { [version]'0.0' } } |
    Select-Object -Last 1
}
function Find-Tool([string]$Name) {
  if (-not $buildTools) { return $null }
  foreach ($file in @($Name, "$Name.exe", "$Name.bat")) {
    $path = Join-Path $buildTools.FullName $file
    if (Test-Path -LiteralPath $path) { return $path }
  }
  return $null
}

# Executa uma ferramenta nativa sem deixar o stderr (que o PowerShell 5.1 transforma em
# exceção com ErrorActionPreference=Stop) derrubar o script.
function Invoke-Native([string]$Exe, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = (& $Exe @Arguments 2>&1 | Out-String)
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  return [pscustomobject]@{ Code = $code; Output = $output }
}

function Read-ZipEntryBytes($Entry) {
  $stream = $Entry.Open()
  $memory = New-Object System.IO.MemoryStream
  try { $stream.CopyTo($memory) } finally { $stream.Dispose() }
  return ,$memory.ToArray()
}

function Test-YtdlpPayload([byte[]]$Bytes) {
  $text = [System.Text.Encoding]::ASCII.GetString($Bytes)
  return $text.Contains('yt_dlp/version.py')
}

# Blocos de um elemento do xmltree do aapt2: pega a linha "E: tag" e as linhas seguintes
# até o próximo elemento com indentação menor ou igual (irmão).
function Get-ManifestBlocks([string[]]$Lines, [string]$Tag) {
  $blocks = @()
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    $open = [regex]::Match($Lines[$i], '^(\s*)E:\s+' + [regex]::Escape($Tag) + '\s')
    if (-not $open.Success) { continue }
    $indent = $open.Groups[1].Value.Length
    $body = New-Object System.Collections.Generic.List[string]
    for ($j = $i + 1; $j -lt $Lines.Count; $j++) {
      $next = [regex]::Match($Lines[$j], '^(\s*)E:\s+')
      if ($next.Success -and $next.Groups[1].Value.Length -le $indent) { break }
      $body.Add($Lines[$j])
    }
    $blocks += [pscustomobject]@{ Line = $Lines[$i]; Body = ($body -join "`n") }
  }
  return $blocks
}

function Get-AndroidAttr([string]$Text, [string]$Name) {
  $match = [regex]::Match($Text, [regex]::Escape($Name) + '\([^)]*\)=([^\s]+)')
  if ($match.Success) { return $match.Groups[1].Value }
  return $null
}

function Find-ManifestService($Blocks, [string]$Name) {
  foreach ($block in @($Blocks)) {
    $value = Get-AndroidAttr $block.Body 'android:name'
    if ($value) {
      $value = $value.Trim().Trim('"')
      if ($value -eq $Name) { return $block }
    }
  }
  return $null
}

function Get-ServiceTypeMask([string]$Value) {
  if (-not $Value) { return $null }
  $clean = $Value.Trim().Trim('"')
  if ($clean -match '^0x([0-9a-fA-F]+)$') { return [int64][Convert]::ToInt64($Matches[1], 16) }
  if ($clean -match '^\d+$') { return [int64]$clean }
  $mask = [int64]0
  if ($clean.Contains('dataSync')) { $mask = $mask -bor 1 }
  if ($clean.Contains('mediaPlayback')) { $mask = $mask -bor 2 }
  if ($mask -ne 0) { return $mask }
  return $null
}

# apksigner.bat precisa de Java: mesmo fallback do build-apk.ps1.
if (-not $env:JAVA_HOME) {
  $jbr = 'C:\Program Files\Android\Android Studio\jbr'
  if (Test-Path -LiteralPath $jbr) { $env:JAVA_HOME = $jbr }
}

$file = Get-Item -LiteralPath $Apk
$hash = (Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash
Write-Host "APK: $($file.FullName)" -ForegroundColor Cyan
Write-Host ("Tamanho: {0:N1} MB | SHA-256: {1}" -f ($file.Length / 1MB), $hash)
if ($buildTools) { Write-Host "build-tools: $($buildTools.Name)" } else { Write-Host 'build-tools: não encontrado' -ForegroundColor Yellow }
Write-Host ''

# Índice do ZIP (uma leitura só): nomes, tamanhos e se a entrada está comprimida.
$entries = @()
$entrySizes = @{}
$entryStored = @{}
$manifestBytes = $null
$zip = [System.IO.Compression.ZipFile]::OpenRead($Apk)
try {
  foreach ($entry in $zip.Entries) {
    $entries += $entry.FullName
    $entrySizes[$entry.FullName] = $entry.Length
    $entryStored[$entry.FullName] = ($entry.CompressedLength -eq $entry.Length)
  }
  $manifestEntry = $zip.GetEntry('AndroidManifest.xml')
  if ($manifestEntry) { $manifestBytes = Read-ZipEntryBytes $manifestEntry }
} finally { $zip.Dispose() }

$abis = @($entries | ForEach-Object { if ($_ -match '^lib/([^/]+)/') { $Matches[1] } } | Sort-Object -Unique)
if ($abis.Count -eq 0) {
  Add-Result 'ABIs no APK' 'FAIL' 'nenhuma pasta lib/<abi>/ no APK'
} elseif ($abis -contains 'arm64-v8a') {
  Add-Result 'ABIs no APK' 'PASS' ($abis -join ', ')
} else {
  Add-Result 'ABIs no APK' 'WARN' "sem arm64-v8a (só $($abis -join ', ')); confirme se é intencional"
}

# 1) Libs e payloads do motor de download, por ABI.
$requiredLibs = @('libpython.so', 'libpython.zip.so', 'libffmpeg.so', 'libffmpeg.zip.so', 'libqjs.so')
$missingLibs = @()
foreach ($abi in $abis) {
  foreach ($lib in $requiredLibs) {
    $path = "lib/$abi/$lib"
    if (-not $entrySizes.ContainsKey($path) -or $entrySizes[$path] -le 0) { $missingLibs += $path }
  }
}
if ($abis.Count -eq 0) {
  Add-Result 'Libs Python/FFmpeg/QuickJS' 'FAIL' 'APK sem ABIs (lib/<abi>/); não há como checar as libs'
} elseif ($missingLibs.Count -eq 0) {
  $sizes = @()
  foreach ($abi in $abis) {
    $sizes += "$abi ($([math]::Round($entrySizes["lib/$abi/libpython.zip.so"] / 1MB, 1)) MB de Python, $([math]::Round($entrySizes["lib/$abi/libffmpeg.zip.so"] / 1MB, 1)) MB de FFmpeg)"
  }
  Add-Result 'Libs Python/FFmpeg/QuickJS' 'PASS' ($sizes -join '; ')
} else {
  Add-Result 'Libs Python/FFmpeg/QuickJS' 'FAIL' "faltando: $($missingLibs -join ', ')"
}

# 2) Payload do yt-dlp: res/raw/ytdlp pode virar res/Nc (resource optimization do AGP).
$aapt2 = Find-Tool 'aapt2'
$rawResourcePath = $null
if ($aapt2) {
  $resources = Invoke-Native $aapt2 @('dump', 'resources', $Apk)
  if ($resources.Code -eq 0) {
    $lines = $resources.Output -split "`r?`n"
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match '^\s*resource\s+0x[0-9a-fA-F]+\s+raw/ytdlp\s*$') {
        for ($j = $i + 1; $j -lt [Math]::Min($i + 4, $lines.Count); $j++) {
          if ($lines[$j] -match '\(file\)\s+(\S+)') { $rawResourcePath = $Matches[1]; break }
        }
        break
      }
    }
  }
}

$candidates = @()
if ($rawResourcePath) { $candidates += $rawResourcePath }
$candidates += @('res/raw/ytdlp', 'res/raw/ytdlp.zip', 'assets/ytdlp', 'assets/ytdlp.zip', 'assets/yt-dlp', 'res/raw/yt-dlp')
$ytdlpPath = $null
$ytdlpBytes = $null
$zip = [System.IO.Compression.ZipFile]::OpenRead($Apk)
try {
  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    $entry = $zip.GetEntry($candidate)
    if ($entry -and $entry.Length -gt 0) {
      $ytdlpPath = $entry.FullName
      $ytdlpBytes = Read-ZipEntryBytes $entry
      break
    }
  }
  if (-not $ytdlpPath) {
    # Sem aapt2 ou com nome inesperado: procura pelo conteúdo entre os resources grandes.
    $scan = @($zip.Entries | Where-Object { $_.FullName -like 'res/*' -and $_.Length -ge 500000 -and $_.Length -le 20000000 })
    foreach ($entry in $scan) {
      $bytes = Read-ZipEntryBytes $entry
      if (Test-YtdlpPayload $bytes) {
        $ytdlpPath = $entry.FullName
        $ytdlpBytes = $bytes
        break
      }
    }
  }
} finally { $zip.Dispose() }

if (-not $ytdlpPath) {
  Add-Result 'Payload do yt-dlp (raw/ytdlp)' 'FAIL' 'não achei res/raw/ytdlp nem um arquivo equivalente (yt_dlp/version.py) no APK'
} elseif (-not (Test-YtdlpPayload $ytdlpBytes)) {
  Add-Result 'Payload do yt-dlp (raw/ytdlp)' 'FAIL' "$ytdlpPath existe, mas não parece o yt-dlp (sem yt_dlp/version.py); arquivo truncado?"
} else {
  $detail = "$ytdlpPath ($([math]::Round($ytdlpBytes.Length / 1MB, 1)) MB, contém yt_dlp/version.py)"
  if ($rawResourcePath -and $ytdlpPath -ne 'res/raw/ytdlp') {
    $detail += '; resolvido a partir do recurso raw/ytdlp'
  } elseif (-not $rawResourcePath) {
    $detail += '; localizado pelo conteúdo (resource optimization pode renomear raw/ytdlp)'
  }
  Add-Result 'Payload do yt-dlp (raw/ytdlp)' 'PASS' $detail
}

# 3) Manifest: extração das libs e serviços.
$manifestXml = $null
if ($aapt2) {
  $xmltree = Invoke-Native $aapt2 @('dump', 'xmltree', '--file', 'AndroidManifest.xml', $Apk)
  if ($xmltree.Code -eq 0 -and $xmltree.Output) { $manifestXml = $xmltree.Output }
}
if (-not $manifestXml) {
  Add-Result 'Manifest (extração/serviços)' 'WARN' 'aapt2 não encontrado ou não conseguiu ler o AndroidManifest.xml; checagens puladas'
} else {
  $manifestLines = $manifestXml -split "`r?`n"
  $appBlocks = @(Get-ManifestBlocks $manifestLines 'application')

  $extractNativeLibs = $null
  if ($appBlocks.Count -gt 0) { $extractNativeLibs = Get-AndroidAttr $appBlocks[0].Body 'android:extractNativeLibs' }
  if ($extractNativeLibs -eq 'true') {
    Add-Result 'Manifest: extração das libs' 'PASS' 'android:extractNativeLibs=true'
  } else {
    $deflated = @($entries | Where-Object { $_ -match '^lib/[^/]+/libpython\.so$' -and -not $entryStored[$_] })
    if ($deflated.Count -gt 0) {
      Add-Result 'Manifest: extração das libs' 'PASS' "extractNativeLibs ausente, mas libs comprimidas (useLegacyPackaging): $($deflated -join ', ')"
    } else {
      Add-Result 'Manifest: extração das libs' 'WARN' "extractNativeLibs=$extractNativeLibs e libs armazenadas sem compressão; confirme se o motor extrai Python/FFmpeg"
    }
  }

  $services = @(Get-ManifestBlocks $manifestLines 'service')

  $grab = Find-ManifestService $services 'expo.modules.ritmocore.GrabService'
  if (-not $grab) {
    Add-Result 'Manifest: GrabService (dataSync)' 'FAIL' 'expo.modules.ritmocore.GrabService não declarado'
  } else {
    $grabType = Get-AndroidAttr $grab.Body 'foregroundServiceType'
    $grabMask = Get-ServiceTypeMask $grabType
    if ($null -eq $grabMask) {
      Add-Result 'Manifest: GrabService (dataSync)' 'FAIL' 'GrabService sem android:foregroundServiceType'
    } elseif (($grabMask -band 1) -eq 0) {
      Add-Result 'Manifest: GrabService (dataSync)' 'FAIL' "foregroundServiceType=$grabType, falta dataSync"
    } else {
      Add-Result 'Manifest: GrabService (dataSync)' 'PASS' "foregroundServiceType=$grabType"
    }
  }

  $playback = Find-ManifestService $services 'expo.modules.ritmocore.PlaybackService'
  if (-not $playback) {
    Add-Result 'Manifest: PlaybackService (Media3)' 'FAIL' 'expo.modules.ritmocore.PlaybackService não declarado'
  } else {
    $playbackType = Get-AndroidAttr $playback.Body 'foregroundServiceType'
    $playbackMask = Get-ServiceTypeMask $playbackType
    $actions = @('androidx.media3.session.MediaLibraryService', 'androidx.media3.session.MediaSessionService', 'android.media.browse.MediaBrowserService')
    $missingActions = @($actions | Where-Object { -not $playback.Body.Contains($_) })
    $problems = @()
    if ($null -eq $playbackMask) { $problems += 'sem foregroundServiceType' }
    elseif (($playbackMask -band 2) -eq 0) { $problems += "foregroundServiceType=$playbackType, falta mediaPlayback" }
    if ($missingActions.Count -gt 0) { $problems += "sem ações: $($missingActions -join ', ')" }
    if ($problems.Count -gt 0) {
      Add-Result 'Manifest: PlaybackService (Media3)' 'FAIL' ($problems -join '; ')
    } else {
      Add-Result 'Manifest: PlaybackService (Media3)' 'PASS' "foregroundServiceType=$playbackType; MediaLibraryService, MediaSessionService e MediaBrowserService"
    }
  }
}

# 4) Bundle JS: precisa da ponte do grab; o backend antigo só gera WARN.
$bundleName = $null
if ($entrySizes.ContainsKey('assets/index.android.bundle')) {
  $bundleName = 'assets/index.android.bundle'
} else {
  $bundleName = @($entries | Where-Object { $_ -match '^assets/.*\.(bundle|hbc)$' }) | Select-Object -First 1
}
if (-not $bundleName) {
  Add-Result 'Bundle JS (grab)' 'WARN' 'não achei assets/index.android.bundle (ou .hbc) para inspecionar'
} else {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Apk)
  try { $bundleBytes = Read-ZipEntryBytes $zip.GetEntry($bundleName) } finally { $zip.Dispose() }
  $bundleText = [System.Text.Encoding]::UTF8.GetString($bundleBytes)
  $missingBridge = @(@('grabResolve', 'grabStart') | Where-Object { -not $bundleText.Contains($_) })
  if ($missingBridge.Count -gt 0) {
    Add-Result 'Bundle JS (grab)' 'FAIL' "$bundleName sem $($missingBridge -join ', ')"
  } else {
    Add-Result 'Bundle JS (grab)' 'PASS' "$bundleName contém grabResolve e grabStart"
  }
  $legacy = @(@('player-downloader', 'onrender.com', 'settings/grab') | Where-Object { $bundleText.Contains($_) })
  if ($legacy.Count -gt 0) {
    Add-Result 'Bundle JS (backend antigo)' 'WARN' "referências antigas: $($legacy -join ', '); confira (i18n pode dar falso positivo). 'Render' isolado é ignorado (runtime do React)."
  } else {
    Add-Result 'Bundle JS (backend antigo)' 'PASS' 'sem player-downloader/onrender.com/settings/grab'
  }
}

# 5) Assinatura.
$apksigner = Find-Tool 'apksigner'
if (-not $apksigner) {
  Add-Result 'Assinatura' 'WARN' 'apksigner não encontrado; instale build-tools (ou rode pelo Android Studio)'
} else {
  $sig = Invoke-Native $apksigner @('verify', '--verbose', '--print-certs', $Apk)
  if ($sig.Code -ne 0) {
    if ($sig.Output -match '(?i)(java|JAVA_HOME).*(not found|não|nao|no such)|Could not find java') {
      Add-Result 'Assinatura' 'WARN' "apksigner não rodou (Java ausente): $(Shorten $sig.Output)"
    } else {
      Add-Result 'Assinatura' 'FAIL' (Shorten $sig.Output)
    }
  } else {
    $schemes = @()
    if ($sig.Output -match 'Verified using v2 scheme.*: true') { $schemes += 'v2' }
    if ($sig.Output -match 'Verified using v3 scheme.*: true') { $schemes += 'v3' }
    $detail = if ($schemes.Count -gt 0) { "esquemas: $($schemes -join ', ')" } else { 'verificada (v1 ou esquema não informado)' }
    if ($sig.Output -match 'CN=Android Debug') {
      Add-Result 'Assinatura' 'WARN' "$detail; certificado de DEBUG (não instala por cima da versão com a chave própria)"
    } else {
      Add-Result 'Assinatura' 'PASS' $detail
    }
  }
}

# 6) zipalign -P 16 (Android 15+ com página de 16 KB).
$zipalign = Find-Tool 'zipalign'
if (-not $zipalign) {
  Add-Result 'zipalign -P 16' 'WARN' 'zipalign não encontrado; instale build-tools 35+'
} else {
  $align = Invoke-Native $zipalign @('-c', '-P', '16', '-v', '4', $Apk)
  if ($align.Code -eq 0) {
    Add-Result 'zipalign -P 16' 'PASS' 'APK alinhado para página de 16 KB'
  } elseif ($align.Output -match '(?i)unknown option|unrecognized|invalid option') {
    Add-Result 'zipalign -P 16' 'WARN' "zipalign $($buildTools.Name) não aceita -P; use build-tools 35+ se for testar Android 15+"
  } else {
    Add-Result 'zipalign -P 16' 'FAIL' (Shorten $align.Output)
  }
}

# 7) Alinhamento ELF das libs 64-bit (p_align >= 0x4000), se houver NDK com llvm-readelf.
$readelf = $null
if ($sdk -and (Test-Path -LiteralPath (Join-Path $sdk 'ndk'))) {
  $ndk = Get-ChildItem (Join-Path $sdk 'ndk') -Directory | Sort-Object Name | Select-Object -Last 1
  $candidate = Join-Path $ndk.FullName 'toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe'
  if (Test-Path -LiteralPath $candidate) { $readelf = $candidate }
}
$libEntries = @($entries | Where-Object { $_ -match '^lib/(?<abi>[^/]+)/lib(?<name>python|ffmpeg|qjs)(\.zip)?\.so$' })
if (-not $readelf) {
  Add-Result 'ELF 16 KB' 'WARN' 'llvm-readelf do NDK não encontrado; pulei a checagem p_align das .so'
} elseif ($libEntries.Count -eq 0) {
  Add-Result 'ELF 16 KB' 'WARN' 'sem libs nativas para checar'
} else {
  # *.zip.so são ZIPs (stdlib/bibliotecas) e 16 KB só importa nas ABIs 64-bit.
  $elfEntries = @($libEntries | Where-Object { $_ -notmatch '\.zip\.so$' -and $_ -match '^lib/(arm64-v8a|x86_64)/' })
  if ($elfEntries.Count -eq 0) {
    Add-Result 'ELF 16 KB' 'WARN' 'APK sem libs 64-bit (arm64-v8a/x86_64); 16 KB não se aplica'
  } else {
    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ('ritmo-verify-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp | Out-Null
    try {
      $bad = @()
      $zip = [System.IO.Compression.ZipFile]::OpenRead($Apk)
      try {
        foreach ($entryName in $elfEntries) {
          $entry = $zip.GetEntry($entryName)
          if (-not $entry) { continue }
          $dest = Join-Path $temp ($entryName -replace '/', '_')
          [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
          $read = Invoke-Native $readelf @('-l', $dest)
          $loads = @($read.Output -split "`r?`n" | Where-Object { $_ -match '^\s*LOAD\s' })
          $minAlign = $null
          foreach ($line in $loads) {
            $token = ($line.Trim() -split '\s+')[-1] -replace '^0x', ''
            $value = [uint64]0
            if ([uint64]::TryParse($token, [System.Globalization.NumberStyles]::HexNumber, $null, [ref]$value)) {
              if (($null -eq $minAlign) -or ($value -lt $minAlign)) { $minAlign = $value }
            }
          }
          if (($null -ne $minAlign) -and ($minAlign -lt 0x4000)) {
            $bad += "$entryName (0x$($minAlign.ToString('X')))"
          }
        }
      } finally { $zip.Dispose() }
      if ($bad.Count -eq 0) {
        Add-Result 'ELF 16 KB' 'PASS' 'LOADS com p_align >= 0x4000'
      } else {
        Add-Result 'ELF 16 KB' 'WARN' "sem alinhamento de 16 KB: $($bad -join ', ') - pode não instalar em Android 15+ com página de 16 KB"
      }
    } finally {
      Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

# 8) Resumo. FAIL = ausência real; ferramenta faltando é WARN.
Write-Host ''
foreach ($result in $script:Results) {
  $color = switch ($result.Status) { 'PASS' { 'Green' } 'WARN' { 'Yellow' } default { 'Red' } }
  Write-Host ("[{0}] {1}: {2}" -f $result.Status, $result.Check, $result.Detail) -ForegroundColor $color
}
$passCount = @($script:Results | Where-Object { $_.Status -eq 'PASS' }).Count
$warnCount = @($script:Results | Where-Object { $_.Status -eq 'WARN' }).Count
$failCount = @($script:Results | Where-Object { $_.Status -eq 'FAIL' }).Count
Write-Host ''
Write-Host ("Resumo: {0} PASS, {1} WARN, {2} FAIL." -f $passCount, $warnCount, $failCount)
if ($failCount -gt 0) {
  Write-Host 'Há verificação(ões) FAIL. Não distribua este APK.' -ForegroundColor Red
  exit 1
}
if ($warnCount -gt 0) {
  Write-Host "Nenhum FAIL. Confira os $warnCount WARN acima conforme o aparelho alvo." -ForegroundColor Green
} else {
  Write-Host 'Nenhum FAIL e nenhum WARN.' -ForegroundColor Green
}
exit 0
