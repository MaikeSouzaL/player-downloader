@echo off
rem Gera o APK release do Player Downloader com o build-apk.ps1 (prebuild, Gradle e assinatura).
rem O APK sai em ..\PlayerDownloader.apk (pasta palyer). Leva uns 10 minutos.
rem Uso: dois cliques neste arquivo, ou "gerar-apk.bat -SkipPrebuild" quando app.json e plugins nao mudaram.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1" %*
echo.
if errorlevel 1 (
  echo O build falhou. Veja as mensagens acima.
) else (
  echo Pronto: o APK esta em %~dp0..\PlayerDownloader.apk
)
pause
