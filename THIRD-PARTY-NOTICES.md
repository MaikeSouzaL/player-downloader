# Avisos de terceiros — Player Downloader

Este arquivo lista os principais componentes de terceiros embutidos no **APK Android** e no
**IPA iOS** do Player Downloader e as licenças aplicáveis. Ele complementa (não substitui) os
textos originais de cada licença, distribuídos com os respectivos projetos.

> Não é aconselhamento jurídico. Antes de distribuir o APK/IPA publicamente, a licença do projeto
> precisa de uma decisão explícita — veja "Licença do projeto" no fim.

## Resumo

| Componente | Versão | Licença | Como entra / para quê |
| --- | --- | --- | --- |
| youtubedl-android (`library` e `ffmpeg`) | 0.18.1 | **GPL-3.0** | Motor de download no aparelho: yt-dlp + Python + FFmpeg + QuickJS |
| FFmpeg (`libffmpeg.so`, `libffprobe.so`) | build do youtubedl-android 0.18.1 | **GPL** (build com x264/x265) | Juntar/converter áudio e vídeo, embutir legenda |
| yt-dlp | embutido no youtubedl-android 0.18.1 | Unlicense (domínio público) | Extrair links e baixar dos sites suportados |
| Python | 3.12 (stdlib empacotada) | PSF License 2.0 | Runtime do yt-dlp (Android) |
| QuickJS | embutido no youtubedl-android 0.18.1 | MIT | Executar o JavaScript que o yt-dlp precisa (Android) |
| Python (iOS) | 3.13.16 (Python-Apple-support 3.13-b16) | PSF License 2.0 | Runtime do yt-dlp no iPhone |
| yt-dlp (iOS) | 2026.08.19 | Unlicense | Extrair links e baixar dos sites no iPhone |
| yt-dlp-ejs (iOS) | 0.8.0 | Unlicense + MIT + ISC | Scripts JS auxiliares do yt-dlp no iPhone |
| yt-dlp-apple-webkit-jsi (iOS) | 0.1.1 | Apache-2.0 | Resolver o JS do YouTube no WKWebView, sem servidor |
| Dependências Python puras (iOS) | requests 2.34.2, urllib3 2.8.0, certifi 2026.10.19, idna 3.20, charset-normalizer 3.5.2, websockets 17.3 | Apache-2.0, MIT, MPL-2.0, BSD-3-Clause, MIT, BSD-3-Clause | HTTP, TLS e WebSocket do yt-dlp no iPhone |
| Jackson (`com.fasterxml.jackson.*`) | dependência do youtubedl-android | Apache-2.0 | JSON do yt-dlp / `ObjectMapper` do `YoutubeDL` (Android) |
| AndroidX Media3 | 1.9.1 | Apache-2.0 | Player, `MediaSession`/`MediaLibraryService`, Android Auto, conversão |
| Expo SDK 58 (módulos `expo-*`) | ~58.x | MIT | Base do app (arquivos, vídeo, share, notificações etc.) |
| React Native | 0.88.0 | MIT | Runtime JS/nativo |
| React Native Reanimated | 4.7.1 | MIT | Animações |
| Demais pacotes npm | ver `package-lock.json` | MIT/Apache-2.0/BSD (em geral) | Interface e utilitários |

As versões de yt-dlp, Python 3.12, FFmpeg e QuickJS da tabela Android são as que o
**youtubedl-android 0.18.1** empacota; elas mudam quando essa dependência é atualizada
(`modules/ritmo-core/android/build.gradle`).

No iOS o motor é separado: Python 3.13 + yt-dlp puro + yt-dlp-ejs + plugin WebKit. O IPA **não**
inclui youtubedl-android, FFmpeg nem QuickJS. O `mutagen` também fica de fora do iOS: é opcional
no yt-dlp e é GPL-2.0+; a v1 não embute metadados/thumbnails.

## Detalhes

### youtubedl-android 0.18.1 — GPL-3.0

- Projeto: <https://github.com/JunkFood02/youtubedl-android> (fork mantido pelo time do Seal, a partir de <https://github.com/yausername/youtubedl-android>).
- Licença: GNU General Public License v3.0 — <https://www.gnu.org/licenses/gpl-3.0.html>.
- É o componente que torna o APK Android uma obra sob GPL-3.0: as AARs `library` e `ffmpeg` são
  linkadas ao app e trazem código GPL-3.0.

### FFmpeg — GPL (build com x264/x265)

- Projeto: <https://ffmpeg.org/>; licenciamento: <https://ffmpeg.org/legal.html>.
- O FFmpeg "puro" costuma ser LGPL-2.1+, mas este build habilita componentes GPL (incluindo
  x264 e x265, usados para codificar/recodificar vídeo), então o binário distribuído é GPL.
- x264: GPL-2.0 — <https://www.videolan.org/developers/x264.html>.
- x265: GPL-2.0 — <https://www.videolan.org/developers/x265.html>.
- No app é usado para juntar vídeo+áudio, converter em MP3/M4A e embutir legendas.

### yt-dlp — Unlicense

- Projeto: <https://github.com/yt-dlp/yt-dlp>.
- Licença: Unlicense (equivalente a domínio público) — <https://unlicense.org/>.
- O uso deve se limitar a conteúdo que o usuário tenha o direito de baixar. O app não remove
  DRM nem usa servidor intermediário; a responsabilidade pelo uso é de quem baixa.

### Python 3.12 — PSF License 2.0

- Projeto: <https://www.python.org/>; licença: <https://docs.python.org/3/license.html>.
- A stdlib vai empacotada em `libpython.zip.so` e é extraída no primeiro uso do motor.

### QuickJS — MIT

- Projeto: <https://bellard.org/quickjs/>.
- Licença: MIT (Copyright (c) 2017-2021 Fabrice Bellard).
- Usado pelo yt-dlp para resolver desafios de JavaScript de alguns sites (Android).

### Python 3.13 (iOS) — PSF License 2.0

- Projeto: <https://www.python.org/>; licença: <https://docs.python.org/3/license.html>.
- Build: Python-Apple-support 3.13-b16 (Python 3.13.16), runtime dinâmico `Python.framework`.
- A stdlib vai em `python/lib/python3.13`; os pacotes puros em `app_packages`. O app exige iOS 16.4+.

### yt-dlp 2026.08.19 (iOS) — Unlicense

- Projeto: <https://github.com/yt-dlp/yt-dlp>.
- Licença: Unlicense (equivalente a domínio público) — <https://unlicense.org/>.
- Embutido como pacote Python puro; não há servidor, cookies nem login. O uso deve se limitar a
  conteúdo que o usuário tenha o direito de baixar.

### yt-dlp-ejs 0.8.0 (iOS) — Unlicense + MIT + ISC

- Projeto: <https://github.com/yt-dlp/ejs>.
- Licença: Unlicense AND MIT AND ISC (o componente `meriyah` é ISC; o `astring` é MIT).
- Fornece os scripts JavaScript que o yt-dlp usa para resolver desafios de sites como o YouTube.

### yt-dlp-apple-webkit-jsi 0.1.1 (iOS) — Apache-2.0

- Projeto: <https://github.com/grqz/yt-dlp-apple-webkit-jsi>.
- Licença: Apache License 2.0 — <https://www.apache.org/licenses/LICENSE-2.0>.
- Provider do yt-dlp que executa o JavaScript em um WKWebView no próprio aparelho (sem PO Token).

### Dependências Python puras (iOS)

- `requests` 2.34.2 — Apache-2.0 — <https://github.com/psf/requests>.
- `urllib3` 2.8.0 — MIT — <https://github.com/urllib3/urllib3>.
- `certifi` 2026.10.19 — MPL-2.0 — <https://github.com/certifi/python-certifi>.
- `idna` 3.20 — BSD-3-Clause — <https://github.com/kjd/idna>.
- `charset-normalizer` 3.5.2 — MIT — <https://github.com/jawah/charset_normalizer>.
- `websockets` 17.3 — BSD-3-Clause — <https://github.com/python-websockets/websockets>.

### Jackson — Apache-2.0

- Projeto: <https://github.com/FasterXML/jackson>.
- Licença: Apache License 2.0 — <https://www.apache.org/licenses/LICENSE-2.0>.
- Crítico para o `YoutubeDL`: o `ObjectMapper` é criado num campo estático e depende de
  reflexão/anotações. As regras de keep ficam em `plugins/withRitmoProguard.js`.

### AndroidX Media3 1.9.1 — Apache-2.0

- Projeto: <https://developer.android.com/jetpack/androidx/releases/media3>.
- Usado no player em segundo plano, na sessão de mídia, no Android Auto e na conversão de vídeo.

### Expo SDK 58, React Native 0.88 e bibliotecas JS — MIT

- Expo: <https://github.com/expo/expo> (MIT).
- React Native: <https://github.com/facebook/react-native> (MIT).
- Cada pacote npm mantém a própria licença em `node_modules/<pacote>/LICENSE`; a lista completa
  de versões está em `package-lock.json`. Para gerar um relatório:

  ```bash
  npx license-checker-rseidelsohn --production --summary
  ```

## O que a GPL-3.0 exige ao distribuir o APK

Em linhas gerais (leia o texto oficial, acima):

- Distribuir o APK com o youtubedl-android significa distribuir uma obra sob GPL-3.0. É preciso
  fornecer o **código-fonte correspondente** (incluindo as alterações do app e a forma de
  reconstruí-lo) a quem receber o binário.
- Incluir o **texto da GPL-3.0** e os avisos de copyright dos componentes.
- Não impor restrições adicionais sobre os direitos que a GPL-3.0 concede (por exemplo, proibir
  engenharia reversa ou redistribuição além do que a licença permite).
- A GPL-3.0 é incompatível com a distribuição apenas em binário fechado; manter o app
  proprietário exige remover/substituir o youtubedl-android (o que também remove o download
  no aparelho).

## Licença do projeto

O arquivo `LICENSE` na raiz é o **MIT do template do Expo** (Copyright (c) 2015-present
650 Industries, Inc. / Expo) e **não descreve a licença do app**. Ele foi mantido como está
por decisão do responsável pelo projeto.

Antes de distribuição pública (sideload ou loja) é necessário decidir, com apoio jurídico:

1. adotar a **GPL-3.0** para o projeto e publicar o código-fonte correspondente; ou
2. remover/substituir o youtubedl-android e as libs GPL, mantendo outra licença.

Até essa decisão, trate o APK como build interno/teste, não como release público.
