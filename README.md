# Ritmo

Player de música e vídeo para Android e iPhone, feito em React Native (Expo SDK 58), seguindo a estrutura de telas do Lark Player — **sem anúncios e sem rastreadores**. Só usa a internet quando você pede: buscar uma letra ou baixar um vídeo/áudio pelo servidor de downloads.

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
- **Compartilhar com o Ritmo**: aparece no "Compartilhar" e no "Abrir com" de outros apps (no iPhone, "Copiar para o Ritmo"); salva a música/vídeo, converte em áudio ou guarda na pasta privada. Com o servidor configurado, links do YouTube e de outras redes abrem direto a escolha de qualidade.
- **Downloads**: links diretos de áudio/vídeo e podcasts, com progresso, cancelar e notificação (Android), podendo baixar um vídeo já como música.
- **Baixar de um site** (servidor próprio): cole um link, **busque no YouTube** ou use o **navegador interno** (abra o vídeo e toque em Baixar); escolha a qualidade do vídeo (144p a 4K em MP4, H.264 quando disponível, com **legenda embutida** se quiser) ou **MP3 320/192/128** / **M4A** com capa, e o arquivo entra na biblioteca. **Playlists inteiras** em lote (marque os vídeos). No iPhone, o Ritmo aparece no **Compartilhar** do YouTube e de outros apps. Funciona com qualquer site que o yt-dlp suporte, sem login e só com conteúdo público.
- **Converter vídeo em áudio** (AAC/M4A): Original (sem perda) ou 96/128/192/256 kbps.
- **Pasta privada** com PIN e digital/Face ID: os arquivos saem da biblioteca e da galeria e a pasta tranca ao sair do app.
- **Tema**: claro/escuro, 5 cores e foto de fundo com desfoque e escurecimento.
- **Idiomas**: português (Brasil), inglês e espanhol, seguindo o aparelho ou escolhido em Ajustes.
- **Robustez**: timer com fade-out no serviço, arquivo quebrado é pulado sem tocar sozinho, registro de erros local (Ajustes › Registro de erros) e **relatório de erros para o servidor** (erros do app e crashes nativos; desligável em Ajustes › Servidor de downloads). No PC: `http://localhost:8787/logs/view`.

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
- `backend/` — servidor Python (FastAPI + yt-dlp + FFmpeg) que resolve os links, baixa, junta vídeo + áudio e converte em MP3/M4A, sem guardar os vídeos (só temporários) e se atualizando sozinho. Guarda os relatórios de erro do app em `backend/logs/`. Detalhes em `backend/README.md`.
- `plugins/` — config plugins: Android (compartilhar, HTTP local), iOS (rotação, HTTP local, CarPlay) e a extensão "Compartilhar" do iPhone (`withRitmoShareExtension.js` + `ritmo-share/`).

## Comandos

```bash
npm install
npm test                 # testes da lógica e dos idiomas (Node)
npx tsc --noEmit         # tipos
npx expo lint            # lint
npx expo run:android     # build de desenvolvimento num aparelho/emulador
```

## Servidor de downloads (yt-dlp)

O celular não fala com o YouTube direto: ele manda o link para um servidor na sua rede (ou VPS), que usa **yt-dlp** para achar as qualidades e **FFmpeg** para juntar e converter.

```powershell
cd backend
.\start.ps1                  # primeira vez: cria .venv e abre o firewall
.\start.ps1 -Key "senha"     # opcional: exige a chave no app
```

Depois, no app: **Ajustes › Servidor de downloads**, informe `192.168.x.x:8787` (o endereço aparece no console) e toque em **Testar conexão**. Para VPS/Docker e solução de problemas, veja `backend/README.md`.

> O servidor não guarda os vídeos: cada arquivo fica no temp do PC só até o celular terminar de baixar. Quando um site muda e o yt-dlp quebra, o servidor se atualiza sozinho (estável e, se preciso, nightly) e tenta de novo.

## Gerar o APK (Windows)

```powershell
.\build-apk.ps1                 # prebuild + compila em C:\rt + assina → ..\Ritmo.apk
.\build-apk.ps1 -SkipPrebuild   # quando app.json e plugins não mudaram
```

O build roda numa cópia em `C:\rt` porque o C++ gerado pelo React Native passa do limite de caminho do Windows; precisa de um `ninja.exe` 1.12+ em `C:\rt-tools\cmake\bin`.

**Assinatura:** a chave própria fica em `%USERPROFILE%\.android\ritmo\` (fora do projeto). O script usa rotação de chave (APK Signature Scheme v3): no Android 9+ a 1.2 instala por cima das versões antigas assinadas com a chave de debug, sem desinstalar. **Guarde uma cópia dessa pasta**: sem ela não dá para publicar atualizações que instalem por cima.

## iPhone (EAS Build)

O IPA é gerado na nuvem pelo EAS (não precisa de Mac). Perfis em `eas.json`:

```bash
npx eas-cli@latest build -p ios --profile simulator   # só compila (Simulador), sem conta Apple
npx eas-cli@latest build -p ios --profile preview     # instala em iPhones cadastrados (conta Apple Developer)
npx eas-cli@latest build -p ios --profile production  # TestFlight / App Store
```

Passo a passo, como colocar músicas e o que muda no iPhone: `../COMO-GERAR-IPHONE.md`. O CarPlay fica desligado (`carPlay: false` no plugin `withRitmoIos`) até a Apple aprovar o entitlement.

