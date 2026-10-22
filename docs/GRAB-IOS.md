# GrabCore iOS — estado final

**Atualizado:** 2026-10-21
**Status:** M2 (motor de download) compilado com sucesso no EAS para iPhone físico.
**Runtime:** ainda **não executado** (não há iPhone/Mac nesta máquina). O primeiro teste real é o
roteiro da seção 7.

## 1. Entrega

| Item | Valor |
| --- | --- |
| Bundle | `com.ritmo.player` |
| Versão | `1.5.0` (build iOS **6**) |
| Mínimo | **iOS 16.4+** |
| Build EAS | `9c15596c-afbd-4531-80e9-0fae243dc919` |
| Artefato EAS | https://expo.dev/artifacts/eas/cS_KribExp4VBfVKe0W84wO_3zL6UOoSOTFwxL6Shds.ipa |
| IPA local | `ritmo/PlayerDownloader-ios.ipa` |
| Tamanho | 37.116.675 bytes (35,4 MiB) |
| SHA-256 | `9F353840ECF0A8F479AA1AE207C997F389FE811612DA1E269D0972B6EC95ADB3` |
| Distribuição | IPA **sem assinatura**; Sideloadly/AltStore assina com Apple ID comum (≈7 dias) |

O IPA é o build `ipa-gratis` do `eas.json` (perfil `withoutCredentials`). Não é App Store,
TestFlight público nem build assinado. O `PlayerDownloader-ios.ipa` local já foi substituído
por este build; o M1 antigo não é mais o entregável.

## 2. O que está implementado

- **Mesma tela e fila do Android** (`src/app/grab.tsx`, `grabber.ts`, `grab-queue.ts`).
- **Motor 100% no aparelho**, sem servidor, cookies ou login:
  - Python 3.13 + `yt-dlp` embutidos no `.app`;
  - `yt-dlp-ejs` e o plugin `yt-dlp-apple-webkit-jsi` (WebKit) para o YouTube;
  - Python só resolve metadados e URLs diretas;
  - `URLSession` em background baixa os bytes;
  - `AVFoundation` junta vídeo H.264 + áudio AAC, extrai M4A ou salva o arquivo direto.
- **Fila nativa** com até 3 jobs ativos, progresso, cancelamento e persistência.
- **Atualizador** de wheels puras do PyPI com SHA-256, rollback e verificação a cada 6 h.
- **Salvamento** em `Documents/Músicas` ou `Documents/Vídeos`, detectado pelo scan da biblioteca.

### Arquivos principais

```
modules/ritmo-core/ios/
  RitmoCoreModule.swift                 # métodos Expo grab*
  GrabCore/
    GrabCore.swift                      # CPython + JSON bridge
    GrabEngineIOS.swift                 # fila, URLSession, AVFoundation, jobs
    GrabSupport.swift                   # Application Support + overlay ativo
    GrabUpdater.swift                   # status/check/install/rollback
    GrabPython.c                        # inicialização do CPython
  Python/app_packages/grabcore/
    bridge.py                           # ações JSON
    extract.py                          # resolve/busca/playlist
    formats.py                          # formatos compatíveis com o iPhone
    download.py                         # URLs diretas + headers
    updater.py                          # PyPI + SHA-256 + manifesto
    errors.py
src/
  app/grab.tsx                          # UI (esconde formatos incompatíveis)
  app/settings/grab.tsx                 # Ajustes → Motor de download
  lib/grabber.ts                        # contrato JS/nativo
  lib/grab-queue.ts                     # fila/poller existente
  lib/grab-updater.ts                   # updater + watcher de 6 h
```

## 3. Formatos da v1

| Tipo | Regra |
| --- | --- |
| Vídeo | MP4 **H.264** até **1080p**; áudio **AAC** |
| Áudio | **M4A/AAC**; se só existir AAC dentro de MP4, o Swift extrai a faixa |
| Playlist | `h:1080`, `h:720`, `h:480`, `h:360`, `h:240`, `h:144` |
| Fora da v1 | MP3, legendas, 4K, VP9/AV1, HLS/DASH segmentado, live/estreia |
| Cookies/login | Não suportados (Vimeo, por exemplo, hoje exige login e fica de fora) |

A UI do iPhone esconde formatos com `compatible: false`; os IDs nativos aceitam tanto o contrato
novo (`v:`, `h:`, `a:`, `a:muxed:`) quanto IDs antigos sem prefixo.

## 4. Funcionamento da fila

- Sessão URLSession: `com.ritmo.player.grab.downloads`
- `sessionSendsLaunchEvents = false` (mesmo padrão do `DownloadsIOS`): o download continua em
  segundo plano, mas os eventos são entregues quando o app volta.
- Estado: `Application Support/GrabEngine/jobs.json`
- Temporários: `Application Support/GrabEngine/tmp/<jobId>/`
- Máximo de **3 jobs ativos**; o restante fica em `queued`.
- Ao reabrir, o motor reconcilia as tasks vivas com o arquivo de jobs, cancela tasks órfãs e
  reinicia o que ficou pela metade.
- Force-quit do usuário pode interromper as tasks; ao abrir de novo o job volta para a fila.
- Fechar o app durante o merge/conversão mantém o job em `finalizing`; ele termina quando o app
  voltar (não há processamento em background na v1).

## 5. Atualizador

- Pacotes: `yt-dlp`, `yt-dlp-ejs`, `yt-dlp-apple-webkit-jsi`.
- Consulta `https://pypi.org/pypi/<pacote>/json`, aceita somente wheel `py3-none-any` e confere
  o **SHA-256** publicado.
- Instala os três juntos em `Application Support/GrabEngine/versions/<data-hora>/`; o manifesto
  `GrabEngine/update.json` aponta para a pasta ativa.
- O Swift coloca a pasta ativa na frente do `sys.path` **no próximo início** do Python.
- Rollback troca o ponteiro para a versão anterior; se não houver anterior, volta para o
  `yt-dlp` embutido no `.app`.
- **Instalar ou desfazer exige fechar e abrir o app.**
- Verificação automática a cada 6 h e ao abrir; botão manual em
  **Ajustes → Motor de download → Verificar agora**.
- A versão embutida do build é `yt-dlp 2026.08.19`; a última no PyPI na data era `2026.10.21`.

## 6. Limitações conhecidas

- Sem validação de runtime nesta máquina; o build garante compilação, não o comportamento em
  aparelho.
- Sem HLS/DASH: sites que só entregam `.m3u8`/`.mpd` mostram “sem formato compatível” ou erro
  claro. Não há FFmpeg na v1.
- Sem MP3, legendas, capa embutida, 4K, VP9/AV1 ou conversão de codecs.
- Sem cookies/login; Vimeo e conteúdos privados/etários podem falhar.
- O download em background depende do iOS; force-quit e falta de rede podem exigir “Tentar de
  novo”.
- A biblioteca é a pasta do app em `Documents/Músicas` e `Documents/Vídeos` (aparece em
  Arquivos). Não grava na Biblioteca Música do sistema.

## 7. Instalação e teste no iPhone

1. Requisito: iPhone com **iOS 16.4 ou mais novo**.
2. No PC, abra o **Sideloadly**, conecte o iPhone e arraste
   `ritmo/PlayerDownloader-ios.ipa`.
3. Informe o Apple ID e assine. No iPhone, confie no desenvolvedor em
   **Ajustes → Geral → VPN e Gerenciamento de Dispositivo**.
   - O app e as duas extensões (compartilhar e widget) usam o App Group
     `group.com.ritmo.player`. Se a conta/provisionamento não aceitar App Groups, o app principal
     pode instalar, mas compartilhamento e widget podem não funcionar.
   - Conta gratuita expira em ≈7 dias; reinstale com o mesmo IPA para renovar.
4. Abra o app e confira **Ajustes → Motor de download**. A tela deve mostrar as três versões,
   a última checagem e o botão “Verificar agora”.
5. Teste um vídeo do YouTube em **Ferramentas → Baixar de um site**:
   - escolha 720p ou 1080p (H.264);
   - acompanhe a fila em **Downloads**;
   - coloque o app em segundo plano por alguns minutos e volte;
   - confirme o arquivo em **Biblioteca → Vídeos**.
6. Teste áudio M4A e uma playlist pequena.
7. Teste cancelar e “Tentar de novo”.
8. No atualizador, toque em **Verificar agora**. Se houver versão nova, instale, feche e abra o
   app; confira se a versão ativa mudou. Depois teste **Restaurar versão anterior** e feche/abra
   de novo.
9. Se algo falhar, o erro aparece na fila e em **Ajustes → Registro de erros**.

## 8. Build

```powershell
# iOS (gasta cota EAS; gera IPA sem assinatura)
npx eas-cli@latest build --platform ios --profile ipa-gratis --non-interactive --wait

# Android local (não gasta cota EAS; usa a chave em %USERPROFILE%\.android\ritmo)
.\build-apk.ps1 -SkipPrebuild
```

O build iOS roda `expo prebuild`, `pod install` e `xcodebuild` no EAS. O Android roda em
`C:\rt` por causa do limite de caminho do Windows e copia o APK assinado para
`..\PlayerDownloader.apk`.

## 9. APK Android desta entrega

| Item | Valor |
| --- | --- |
| Caminho | `C:\Users\Administrator\Desktop\palyer\PlayerDownloader.apk` |
| Versão | `1.5.0` (versionCode **7**) |
| Pacote | `com.ritmo.player` |
| Tamanho | 126.014.301 bytes (120,2 MiB) |
| SHA-256 | `1A522003BD65334DF9FEFD079D9A1149B9E6448CD947C97F837AEEB8C2375544` |
| ABIs | `arm64-v8a`, `armeabi-v7a` |
| Assinatura | APK Signature Scheme v2+v3, RSA 4096, `CN=Ritmo` (mesma chave/linhagem) |
| Build | local, 8,3 min, sem cota EAS |

`GrabEngine.kt` **não foi alterado**; o APK apenas recompila o motor Android existente com o
JS/UI atualizado desta entrega. O `scripts/verify-apk.ps1` deu **10 PASS, 1 WARN, 0 FAIL**. O
WARN é o falso positivo já conhecido de `settings/grab` (rota da tela de Ajustes, não backend
antigo).

Para instalar por cima da versão atual, use o APK completo; a assinatura mantém a linhagem da
chave anterior. Android mínimo/target conforme o manifesto do app.
