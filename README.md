# Player Downloader

Player de música e vídeo para Android e iPhone, feito em React Native (Expo SDK 58), seguindo a estrutura de telas do Lark Player — **sem anúncios e sem rastreadores**. Só usa a internet quando você pede: buscar uma letra ou baixar um vídeo/áudio.

## O que tem

- **Tela principal** como a do Lark: cabeçalho com ajustes, ordenar e buscar; abas Músicas, Playlists, Pastas, Álbuns, Artistas e Vídeo; mini player com anel de progresso. Ordenação em todas as abas e lista/grade em Álbuns e Vídeos.
- **Player**: carrossel de capa (arraste para os lados, com a anterior e a próxima), arrastar para baixo fecha, título que rola, "A seguir", curtir, velocidade, modo (repetir tudo / repetir uma / embaralhar), fila com arrastar para reordenar, letra sincronizada e equalizador.
- **Segundo plano**: notificação, tela de bloqueio, botões do fone, retomada com o app fechado (fila salva no nativo), capa na notificação, widget na tela inicial e **Android Auto** (Recentes, Curtidas, Playlists, Álbuns, Artistas, Aleatório e busca por voz).
- **Equalizador** do Android com presets, presets próprios salvos, restaurar padrão, reforço de graves, ganho e a saída de áudio atual.
- **Letras**: `.lrc` ao lado da música, letra embutida no MP3 (ID3 USLT), importar/colar e **buscar letra online no LRCLIB** (só quando você toca em "Buscar letra").
- **Biblioteca**: busca com seções, seleção múltipla (tocar, fila, playlist, esconder, excluir), editar informações e capa sem mexer no arquivo, definir como toque, excluir com "Excluídos recentemente" (Android 11+), arquivos ocultos, biblioteca atualizada sozinha quando o MediaStore muda.
- **Vídeo**: pastas, retomar de onde parou, velocidade e girar a tela.
- **Playlists**: curtidas, recentes, mais tocadas e próprias; importar/exportar **M3U**.
- **Backup e restauração** num arquivo JSON (playlists, curtidas, histórico, ajustes, edições, letras), que reconhece as músicas em outro celular pelo caminho e pelo nome.
- **Compartilhar com o Player Downloader**: aparece no "Compartilhar" e no "Abrir com" de outros apps (no iPhone, "Copiar para o Player Downloader"); salva a música/vídeo, converte em áudio ou guarda na pasta privada. No Android, links do YouTube e de outras redes abrem direto a escolha de qualidade.
- **Downloads**: links diretos de áudio/vídeo e podcasts, com progresso, cancelar e notificação (Android), podendo baixar um vídeo já como música.
- **Baixar de um site** (Android, no próprio aparelho): cole um link, **busque no YouTube** ou use o **navegador interno** (abra o vídeo e toque em Baixar); escolha a qualidade do vídeo (144p a 4K em MP4, H.264 quando disponível, com **legenda embutida** se quiser) ou **MP3 320/192/128** / **M4A**, e o arquivo entra na biblioteca. **Playlists inteiras** em lote (marque os vídeos). O **yt-dlp, Python e FFmpeg vão embutidos no app**: o download usa o Wi‑Fi/4G do usuário, sem servidor, chave ou cookies. Funciona com os sites que o yt-dlp suporta, sem DRM. No iPhone essa tela fica indisponível; lá ficam os downloads diretos.
- **Converter vídeo em áudio** (AAC/M4A): Original (sem perda) ou 96/128/192/256 kbps.
- **Pasta privada** com PIN e digital/Face ID: os arquivos saem da biblioteca e da galeria e a pasta tranca ao sair do app.
- **Tema**: claro/escuro, 5 cores e foto de fundo com desfoque e escurecimento.
- **Idiomas**: português (Brasil), inglês e espanhol, seguindo o aparelho ou escolhido em Ajustes.
- **Robustez**: timer com fade-out no serviço, arquivo quebrado é pulado sem tocar sozinho e **registro de erros local** (Ajustes › Registro de erros), inclusive o crash nativo da última abertura. Nada é enviado para servidor.

## Ficou de fora do Lark original

Anúncios e SDKs de rastreamento (Pangle, PubMatic, Vungle, Meta, Mintegral, AppLovin, AppsFlyer, Sensors Data), e tudo o que depende dos servidores deles: playlists online, busca em alta, backup no Google Drive e Premium. Nome e ícone são próprios.

## Estrutura

- `src/app/` — telas (Expo Router).
- `src/screens/` — abas da tela principal.
- `src/store/` — estado (zustand + AsyncStorage).
- `src/lib/` — lógica pura (biblioteca, LRC, fila, M3U, backup, LRCLIB, formatação), coberta por `npm test`.
- `src/i18n/` — textos em pt/en/es (`parts/*.ts`), também conferidos por `npm test`.
- `modules/ritmo-core/android` — módulo nativo Kotlin: MediaStore, player media3 (`MediaLibraryService`), Android Auto, widget, equalizador, timer, lixeira e leitor de letras ID3.
- `modules/ritmo-core/ios` — módulo nativo Swift com as mesmas funções: arquivos importados + app Música, player com AVAudioEngine e equalizador, tela de bloqueio, timer e CarPlay.
- `src/widget/` — widget do iPhone (`expo-widgets`); no Android o widget é nativo.
- `backend/` — servidor Python antigo (FastAPI + yt-dlp + FFmpeg), mantido como ferramenta separada. **O app não usa mais**: o download do YouTube é feito no próprio Android, com o yt-dlp embutido em `modules/ritmo-core/android` (`GrabEngine.kt`). Veja "Backend/Render (legado)".
- `plugins/` — config plugins: Android (compartilhar, HTTP local), iOS (rotação, HTTP local, CarPlay), a extensão "Compartilhar" do iPhone (`withRitmoShareExtension.js` + `ritmo-share/`) e `withRitmoProguard.js` (R8 + regras keep no release).
- `scripts/` — ferramentas locais; `verify-apk.ps1` confere o APK antes de instalar.

## Comandos

```bash
npm install
npm test                 # testes da lógica e dos idiomas (Node)
npx tsc --noEmit         # tipos
npx expo lint            # lint
npx expo run:android     # build de desenvolvimento num aparelho/emulador
```

## Download no aparelho (Android)

O app Android traz **yt-dlp + Python + FFmpeg + QuickJS** embutidos (`youtubedl-android`).
Ele extrai as qualidades e baixa direto pela conexão do celular — **sem servidor, chave ou
cookies** — e salva na biblioteca (MediaStore). Vídeo sai em MP4; áudio em **MP3** ou **M4A**.

- Na primeira vez o motor extrai as libs nativas e pode demorar alguns segundos.
- O APK cresce bastante (as libs nativas) e o primeiro build demora mais.
- Quando o YouTube muda, o motor tenta atualizar o `yt-dlp` sozinho e repetir o download.
- iOS não tem essa tela; lá ficam os downloads diretos de arquivos.

O diretório `backend/` é um servidor opcional antigo; **o app não fala mais com ele** (detalhes abaixo).

## Backend/Render (legado)

`backend/` (FastAPI + yt-dlp + FFmpeg) e `render.yaml` são o servidor de downloads da versão antiga.
**O app não usa mais**: desde a 1.4 o download do YouTube roda no próprio aparelho, então nenhuma
tela faz requisição a essa API e **não é preciso fazer deploy no Render** para usar o app.

- O código e o blueprint do Render continuam no repositório só como referência/histórico; não foram removidos.
- `backend/` está no `.easignore` e não entra no build do iPhone.
- Testar o APK não exige backend, `RITMO_KEY` nem nada do Render.
- Se um dia o backend for removido de vez, isso é uma decisão separada deste trabalho de build.

## Gerar o APK (Windows)

```powershell
.\build-apk.ps1                 # prebuild + R8 + compila em C:\rt + assina → ..\PlayerDownloader.apk
.\build-apk.ps1 -SkipPrebuild   # quando app.json e plugins não mudaram
.\build-apk.ps1 -NoMinify       # fallback seguro: sem R8 e sem encolher recursos
.\build-apk.ps1 -Arm64Only      # só arm64-v8a; gera ..\PlayerDownloader.apk e ..\PlayerDownloader-arm64.apk
```

O build roda numa cópia em `C:\rt` porque o C++ gerado pelo React Native passa do limite de caminho do Windows; precisa de um `ninja.exe` 1.12+ em `C:\rt-tools\cmake\bin`.

**Assinatura:** a chave própria fica em `%USERPROFILE%\.android\ritmo\` (fora do projeto). O script usa rotação de chave (APK Signature Scheme v3): no Android 9+ a 1.2 instala por cima das versões antigas assinadas com a chave de debug, sem desinstalar. **Guarde uma cópia dessa pasta**: sem ela não dá para publicar atualizações que instalem por cima.

### R8 (build normal) x `-NoMinify` (fallback)

O build **normal** liga o R8: `plugins/withRitmoProguard.js` escreve no `gradle.properties`
`android.enableMinifyInReleaseBuilds=true` e `android.enableShrinkResourcesInReleaseBuilds=true`,
e regenera `android/app/proguard-rules.pro` a cada prebuild. O APK fica menor, mas código que usa
reflexão pode quebrar.

O plugin mantém estas regras (bloco marcado, o resto do arquivo é preservado):

```proguard
-keep class expo.modules.ritmocore.** { *; }
-keep class com.yausername.** { *; }
-keep class com.fasterxml.jackson.** { *; }
-keepclassmembers class * { @com.fasterxml.jackson.annotation.* *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable
-dontwarn org.apache.commons.**
```

- `com.yausername.**` — o Python do yt-dlp chama classes Java por nome (JNI/reflexão).
- `com.fasterxml.jackson.**` — o `YoutubeDL` cria um `ObjectMapper` estático no `<clinit>` e lê
  anotações por reflexão; sem o keep o download falha em runtime.
- `SourceFile,LineNumberTable` deixam as pilhas do "Registro de erros" legíveis.

Se um release com R8 falhar (por exemplo, o download abre e fecha, ou aparece
`NoClassDefFoundError`/`JsonMappingException`), use **`-NoMinify`**: ele passa
`-Pandroid.enableMinifyInReleaseBuilds=false` **e** `-Pandroid.enableShrinkResourcesInReleaseBuilds=false`
para o Gradle (o `-P` da linha de comando vence o `gradle.properties`). É a opção segura para
comparar e para gerar um APK de teste. Ao mudar `app.json` ou `plugins/`, rode **sem**
`-SkipPrebuild` para as regras serem regravadas.

### Só arm64 (`-Arm64Only`)

`-Arm64Only` define `-PreactNativeArchitectures=arm64-v8a` e, além do fluxo normal, copia o APK
assinado para `..\PlayerDownloader-arm64.apk`. Serve para reduzir o tamanho (só aparelhos arm64, que são a
maioria dos atuais); emuladores x86_64 precisam do build completo. Dá para combinar:
`.\build-apk.ps1 -Arm64Only -NoMinify`.

### 16 KB (Android 15+)

Aparelhos com página de memória de 16 KB exigem que as `.so` tenham `p_align >= 0x4000` e que o
APK esteja alinhado com `zipalign -P 16`. O `youtubedl-android 0.18.1` já vem alinhado em arm64
(conferido no APK 1.4), mas isso pode mudar ao atualizar a dependência; o `verify-apk.ps1` checa
as duas coisas. Se falhar, o app pode instalar em aparelhos antigos e falhar nos novos.

### Conferir o APK antes de instalar

```powershell
.\scripts\verify-apk.ps1
.\scripts\verify-apk.ps1 -Apk ..\PlayerDownloader-arm64.apk
```

O script lista as entradas do APK e confere:

- **payload do yt-dlp** (`raw/ytdlp`): o AGP pode renomear o arquivo para `res/Nc` na
  otimização de recursos; o script resolve o caminho pelo `aapt2` e, se preciso, identifica o
  arquivo pelo conteúdo (`yt_dlp/version.py`). Arquivo ausente/truncado = FAIL.
- **libs do motor por ABI**: `libpython.so`, `libpython.zip.so`, `libffmpeg.so`,
  `libffmpeg.zip.so` e `libqjs.so` (presença e tamanho > 0).
- **manifest** (via `aapt2`): `extractNativeLibs=true` (ou libs comprimidas =
  `useLegacyPackaging`), `GrabService` com `foregroundServiceType=dataSync` e
  `PlaybackService` com `mediaPlayback` e as 3 ações do Media3 (`MediaLibraryService`,
  `MediaSessionService`, `MediaBrowserService`).
- **bundle JS**: precisa conter `grabResolve`/`grabStart`; referências ao backend antigo
  (`player-downloader`, `onrender.com`, `settings/grab`) geram **WARN** (o termo "Render"
  isolado é ignorado: aparece no runtime do React).
- **assinatura** (`apksigner verify`, inclusive certificado de debug), **`zipalign -c -P 16`**
  e o **alinhamento ELF** das libs 64-bit (se o NDK tiver `llvm-readelf`).

Se `aapt2`, `apksigner`, `zipalign` ou o NDK não estiverem instalados, ele **avisa (WARN) e
continua**; só retorna código 1 quando falta algo real (FAIL), como lib, payload ou serviço.
`zipalign -P 16` precisa de build-tools 35+.

### Checklist de teste do release

- [ ] `npm test`, `npx tsc --noEmit`, `npx expo lint`
- [ ] instala por cima da versão anterior (assinatura) e abre sem crash
- [ ] tocar música, notificação/tela de bloqueio, botões do fone, retomar com o app fechado
- [ ] widget, Android Auto, equalizador e timer
- [ ] **baixar do YouTube em MP3 e MP4** (com e sem legenda) — é o teste que mais pega regressão de R8
- [ ] playlist inteira em lote e converter vídeo em áudio
- [ ] "Compartilhar com o Player Downloader" e abrir link do YouTube
- [ ] pasta privada (PIN/digital/Face ID), backup e restauração
- [ ] `.\scripts\verify-apk.ps1` termina sem `FAIL`

A instalação documentada aqui é **sideload** (APK assinado, instalado manualmente).

## Licenças e distribuição

O **APK Android** embute o **youtubedl-android 0.18.1 (GPL-3.0)**, junto com FFmpeg (build GPL,
com x264/x265), yt-dlp (Unlicense), Python (PSF), QuickJS (MIT), Jackson (Apache-2.0), Media3,
Expo e React Native. Versões, links e obrigações estão em [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md).

Por causa da GPL-3.0, **antes de distribuir o APK publicamente é preciso uma decisão jurídica do
projeto**: adotar a GPL-3.0 (publicando o código-fonte correspondente, o texto da licença e os
avisos) ou remover/substituir o motor youtubedl-android. O `LICENSE` da raiz ainda é o MIT do
template do Expo (© 650 Industries) e **não** é a licença do app; ele não foi alterado aqui.

Esta documentação cobre **sideload** (instalar o APK manualmente). Não há promessa de conformidade
com políticas de loja de aplicativos: se a intenção for publicar na Play Store ou em outra loja,
revise as políticas vigentes e a licença com o responsável legal pelo projeto.

## iPhone (EAS Build)

O IPA é gerado na nuvem pelo EAS (não precisa de Mac). Perfis em `eas.json`:

```bash
npx eas-cli@latest build -p ios --profile simulator   # só compila (Simulador), sem conta Apple
npx eas-cli@latest build -p ios --profile preview     # instala em iPhones cadastrados (conta Apple Developer)
npx eas-cli@latest build -p ios --profile production  # TestFlight / App Store
```

Passo a passo, como colocar músicas e o que muda no iPhone: `../COMO-GERAR-IPHONE.md`. O CarPlay fica desligado (`carPlay: false` no plugin `withRitmoIos`) até a Apple aprovar o entitlement.

