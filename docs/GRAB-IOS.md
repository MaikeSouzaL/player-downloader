# GrabCore iOS — arquitetura e plano

**Status:** M1 (base) implementado em 2026-10-21; builds EAS de dispositivo e simulador verdes;
IPA gerado. Runtime não executado (sem iPhone/CI).
**Aparelho:** não há iPhone no momento; a validação de runtime depende de simulador/CI ou de um
aparelho emprestado. O app atual exige **iOS 16.4+**.
**Entrega acordada:** **build-only** — código + EAS verde + IPA + autoteste embutido. Runtime
não será validado nesta entrega; o primeiro teste real fica para quando houver iPhone/CI.
**Objetivo:** dar ao iPhone o mesmo fluxo “Baixar de um site” do Android — colar link ou
pesquisar, ler metadados/qualidades, enfileirar, baixar no próprio aparelho e salvar na
biblioteca — com yt-dlp embutido, sem servidor.

---

## 1. Fora de escopo (v1)

- **Android**: não muda. `GrabEngine.kt` continua intocado.
- **App Store / TestFlight público**: distribuição só por sideload (Sideloadly/EAS).
- **Cookies/login**: igual ao Android hoje, sem cookies.
- **MP3, legendas embutidas, 4K/VP9/AV1**: fase 2, com FFmpeg.
- **Transmissões ao vivo e estreias**: recusadas com mensagem clara.
- **Backend/servidor**: nada de Render ou servidor local.
- **SDK publicado**: a “biblioteca” é interna ao repo, não um pacote distribuível.

## 2. Estado atual

| Lado | Hoje |
| --- | --- |
| Android | Motor local completo (`GrabEngine.kt`): yt-dlp + Python + FFmpeg + QuickJS via `youtubedl-android`; resolve, busca, playlist, fila, progresso, cancelamento, merge MP4, MP3/M4A, legenda, capa, notificação e serviço em primeiro plano. |
| iOS | **M1 (base):** motor Python/yt-dlp embutido, bridge `grab*` e `grabSelfTest`; `grabEnabled()` ainda retorna `false` fora do Android e `grabStart` é stub. A tela e o download entram no M2/M3. O download de **URL direta** (`DownloadsIOS`, URLSession background) e a conversão via AVFoundation (`AudioConverterIOS`) continuam existindo. |
| Backend | Referência histórica: FastAPI + yt-dlp + FFmpeg no servidor. Não será usado. |

## 3. Decisões fechadas

| Tema | Decisão |
| --- | --- |
| Escopo de sites | Todos os extractors do yt-dlp (YouTube, Instagram, TikTok, X, Facebook, SoundCloud, Vimeo etc.). |
| Onde roda | 100% no aparelho, em processo, sem servidor. |
| Runtime Python | `Python.xcframework` do BeeWare **Python-Apple-support 3.13** (iOS 13+), embutido no app. |
| YouTube no iOS | Vendorizar o plugin puro Python **`yt-dlp-apple-webkit-jsi`** (WebKit/JavaScriptCore em processo; iOS 14+, Apache-2.0). |
| Mídia v1 | **AVFoundation**: MP4 H.264 até 1080p + áudio M4A. Sem MP3/legendas/VP9/AV1 na v1. |
| Fase 2 | FFmpeg (FFmpegKitNext, compilado no EAS/GitHub Actions) para MP3, legendas, capa e 4K. |
| App fechado | URLSession background baixa; merge/conversão finaliza quando o app volta. Sem hack de áudio silencioso. |
| Atualização | Automática (≈6 h/abertura) + botão “Verificar agora” em Ajustes, com versão exibida e rollback. |
| API JS | Mesma do Android; a tela `grab.tsx` e a fila `grab-queue.ts` não mudam. |
| Aparelho de teste | **Não há iPhone no momento.** O IPA atual (Expo SDK 58) exige **iOS 16.4+**. Sem aparelho, a entrega máxima é “código + build verde”; runtime só com simulador/CI ou iPhone emprestado. |

## 4. Arquitetura

### 4.1 Camadas

```
JS (grab.tsx / grabber.ts / grab-queue.ts)
        │  mesma API: grabAvailable, grabResolve, grabSearch,
        │             grabStart, grabJobs, grabCancel
        ▼
Expo Module RitmoCore (Swift)  ←  mesmas funções do módulo Kotlin
        ▼
GrabCore (Swift, nosso)
   ├── GrabPython      → CPython embutido (C API), JSON in/out, GIL
   ├── GrabDownloader  → URLSession background (streams diretos)
   ├── GrabPostProcess → AVFoundation (merge H.264+AAC / M4A)
   ├── GrabJobStore    → estado persistido (UserDefaults/JSON)
   └── GrabUpdater     → yt-dlp/plugin pelo PyPI, SHA-256, rollback
        │
        ▼
Python: yt_dlp + yt_dlp_ejs + yt_dlp_plugins.apple_webkit_jsi
        └── rede do aparelho (sem cookies, sem proxy)
```

### 4.2 Estrutura de arquivos proposta

```
modules/ritmo-core/
  ios/
    GrabCore/
      GrabCore.swift              # fachada (resolve/start/jobs/cancel/search/update)
      GrabPython.swift            # embed CPython, PYTHONHOME, sys.path, JSON bridge
      GrabDownloader.swift        # URLSession background + fila serial
      GrabPostProcess.swift       # merge/m4a via AVFoundation
      GrabJobStore.swift          # jobs, progresso, journal de concluídos (TTL 7 dias)
      GrabUpdater.swift           # PyPI + SHA-256 + versões + rollback
    GrabCore.podspec              # ou extensão do RitmoCore.podspec
    Frameworks/
      Python.xcframework          # BeeWare (device + simulator)
    Resources/
      python/                     # stdlib 3.13 + site-packages vendorizados
      grabcore/                   # NOSSO pacote Python (regras/erros/normalização)
  python/
    grabcore/
      formats.py                  # seleção/rotulagem de formatos (espelha GrabEngine)
      extract.py                  # extract_info(download=False) → JSON normalizado
      errors.py                   # mapa de erros → mesmas mensagens do Android
      update.py                   # resolução de versões/wheels puros
    tests/                        # pytest roda no PC (Windows), sem iOS
plugins/
  withGrabIos.js                  # config plugin (CNG): frameworks, resources, linker, Info.plist
```

- `ios/` continua sendo **gerado** (CNG). Nada é editado à mão; o plugin configura tudo.
- O `podspec` do módulo passa a declarar `vendored_frameworks`, resources e `pod_target_xcconfig`
  conforme o `USAGE.md` do Python-Apple-support (linker `-lz -lbz2 -liconv`, frameworks do sistema).

### 4.3 Contrato JS (inalterado)

- `grabAvailable(): boolean` — no iOS passa a ser `true` quando o Python embutido inicializa.
- `grabResolve(url, playlist): GrabMedia` — mesmo shape (`kind`, `token`, `formats`, `audio`,
  `subtitles`, `playlist`, `playlistUrl`).
- `grabSearch(query): { items: GrabEntry[] }`.
- `grabStart(url, formatId, payload): GrabStarted` — mesmos campos (`id`, `ids`, `batchId`, `jobs`).
- `grabJobs(ids): { jobs, missing }` — mesmos estados (`queued`, `downloading`, `converting`,
  `saving`, `done`, `ready`, `error`, `cancelled`).
- `grabCancel(id)`.

Única mudança no JS: `grabEnabled()` deixa de exigir `Platform.OS === 'android'` e passa a
perguntar ao módulo nativo (`grabAvailable`). Nada mais na UI muda.

### 4.4 Fluxo

**Resolve** (`grabResolve`)
1. Swift chama Python: `yt_dlp.YoutubeDL({...}).extract_info(url, download=False)`.
2. `grabcore.extract` normaliza para o shape `GrabMedia` (mesmas regras do `GrabEngine.buildMedia`).
3. Playlist: `extract_flat` com `playlist_items 1:200`; vídeo dentro de playlist devolve
   `playlistUrl` quando for YouTube.
4. Live/estreia: erro claro. URL não suportada: erro claro.

**Start** (`grabStart`)
1. Cria 1 job por vídeo (playlist: até 100 por leva; 200 no total).
2. Cada job resolve **na hora de baixar** (URLs de mídia expiram): extrai de novo e pega as URLs
   diretas + headers.
3. `GrabDownloader` baixa os streams com URLSession background, em fila serial.
4. Quando todos os streams do job terminam **e o app está ativo**, `GrabPostProcess` monta o
   arquivo final e salva na biblioteca (`LibraryStore`/`MediaSaverIOS`).
5. Job vira `ready` com `file` (name/mime/size) e entra no journal de concluídos (TTL 7 dias).

**Jobs/Cancel/Search**
- `grabJobs` lê o `GrabJobStore` (persistido entre aberturas) e devolve `missing` para ids
  desconhecidos — igual ao Android.
- `grabCancel` cancela as tasks da URLSession e o job; apaga temporários.
- `grabSearch` usa `ytsearch15:<query>` (flat), mesmo shape do Android.

### 4.5 Formatos na v1 (iOS)

| Tipo | Regra |
| --- | --- |
| Vídeo | Preferir H.264 (`avc1`) + áudio M4A; até 1080p. MP4 pré-muxado tem prioridade (fica pronto sem merge). |
| Incompatível | VP9/AV1 (4K), codecs fora de H.264/AAC: `compatible: false`; a UI esconde no iOS. |
| Áudio | Somente **M4A (AAC)** na v1. As opções MP3 320/192/128 ficam ocultas até a fase 2. |
| Legendas | Lista vazia na v1 (sem FFmpeg para embutir). |
| Playlist | Seletor `h:altura` igual ao Android (`GrabRules.playlistSelector`). |
| Limites | Playlist 200, leva 100, live recusado, sem cookies. |

### 4.6 Download e app fechado

- Sessão própria: `com.ritmo.player.grab` (não mistura com `com.ritmo.player.downloads`).
- `sessionSendsLaunchEvents = false`, pelo mesmo motivo já documentado no `DownloadsIOS`
  (o handler do expo-file-system segura o aviso de qualquer sessão). Consequência: o download
  continua com o app em segundo plano/fechado, mas os eventos são entregues **quando o app volta**.
- **Force-quit** do usuário cancela as tasks (comportamento do iOS): na próxima abertura o job
  vira `error` com mensagem específica, sem travar a fila.
- Cada stream guarda bytes/total no job store; o poller do JS mostra progresso.
- Fechar o app no meio: ao voltar, o `GrabJobStore` reconcilia as tasks concluídas e finaliza.
- Sem notificação ao vivo na v1 (o app não é acordado). Fase 2 opcional: AppDelegate +
  `BGProcessingTask` + notificação local.
- Merge/conversão **não** roda em background na v1; fica `downloading`/`converting` até o app
  voltar. O usuário vê “finalizando…” ao reabrir.

### 4.7 Pós-processamento (AVFoundation)

- **MP4 com áudio** (pré-muxado): move direto para a biblioteca.
- **Vídeo H.264 + M4A**: `AVMutableComposition` + `AVAssetExportSession` (passthrough) → `.mp4`.
  Se o export falhar (codec/track incompatível), erro claro — nunca salva arquivo quebrado.
- **Áudio M4A**: passthrough, sem recodificar.
- **Metadados**: título/artista via `AVMutableMetadataItem` (capa fica para a fase 2).
- **Nome do arquivo**: mesmo saneamento do Android/iOS (`%(title).100B [%(id)s]` → `MediaSaverIOS.sanitize`).
- **Salvamento**: `LibraryStore` + evento `onLibraryChanged`; temporários apagados no fim.
- **Sem MP3 e sem legenda embutida** na v1. Nada de recodificar vídeo (perda de qualidade/tempo).

### 4.8 Persistência

- `Application Support/grab/jobs.json`: jobs ativos + journal de concluídos (TTL 7 dias).
- `Caches/grab/<jobId>/`: streams temporários; apagados ao concluir/cancelar.
- Fila do JS (`grab-queue.ts`) continua sendo a dona da UX; o motor só executa e reporta.
- Ao reinstalar por cima (mesma assinatura), os dados continuam.

### 4.9 Atualização do extrator

- No IPA vai uma versão **pinada** de `yt-dlp`, `yt-dlp-ejs` e `yt-dlp-apple-webkit-jsi`.
- Em runtime, o `GrabUpdater`:
  1. consulta o PyPI (`/pypi/<pacote>/json`) e escolhe a última **stable**;
  2. baixa somente **wheels puros** (`py3-none-any`), confere **SHA-256** do PyPI;
  3. valida `Requires-Python` e a compatibilidade `yt-dlp ↔ yt-dlp-ejs`;
  4. extrai em `Application Support/grab/py/<versão>/` e coloca na frente do `sys.path`;
  5. faz smoke test (import + versão) antes de promover; guarda a versão anterior para rollback.
- **Automático**: no máximo a cada 6 h e na abertura; falha silenciosa (registra no log de erros).
- **Manual**: Ajustes → “Downloads de sites” mostra versões (embutida/atual), última checagem,
  botões “Verificar agora”, “Atualizar” e “Restaurar versão embutida”.
- Só pacotes Python puros são atualizáveis. Python e FFmpeg só mudam com IPA novo.

### 4.10 Erros

- `grabcore.errors` traduz exceções do yt-dlp para os mesmos códigos/mensagens do Android
  (bot check, URL não suportada, 403, timeout, privado, idade, live, sem espaço etc.).
- Integra com `errorlog.ts` (Ajustes → Registro de erros).
- Nada de retry infinito: 3 tentativas de rede, igual ao Android.

## 5. Mudanças no app (JS/UI)

| Arquivo | Mudança |
| --- | --- |
| `src/lib/grabber.ts` | `grabEnabled()` deixa de ser Android-only; passa a checar `grabAvailable()`. |
| `src/app/grab.tsx` | No iOS: sem MP3, sem legendas, só formatos `compatible`; textos “M4A”. |
| `src/app/settings/*` | Nova seção “Downloads de sites” (iOS) com versões/atualização/rollback. |
| `src/i18n/*` | Chaves novas (versões, atualização, finalizando). |
| `modules/ritmo-core/ios/RitmoCoreModule.swift` | Adiciona as 6 funções `grab*` chamando o `GrabCore`. |
| `modules/ritmo-core/ios/RitmoCore.podspec` | Frameworks/resources do Python e do GrabCore. |
| `plugins/withGrabIos.js` | Config plugin do build (CNG). |
| `THIRD-PARTY-NOTICES.md` | Python, yt-dlp, yt-dlp-ejs, apple-webkit-jsi (e FFmpeg na fase 2). |

Nada muda em `GrabEngine.kt`, no backend ou nos dados existentes.

## 6. Build e empacotamento

- `Python.xcframework` (BeeWare 3.13) vendorizado; apenas a slice de device entra no IPA.
- Stdlib do Python copiada para o bundle, sem `test/`, `idlelib`, `tkinter`; `PYTHONHOME` aponta
  para o bundle e `sys.path` inclui o `site-packages` vendorizado.
- CPython via C API (sem PythonKit): `Py_Initialize`, `PyRun_SimpleString`, chamadas com GIL.
  Uma única instância; uma fila serial para chamadas Python.
- `withGrabIos.js` adiciona frameworks, resources, linker flags e (fase 2) `BGTaskScheduler`.
- EAS continua sendo o build (não precisa de Mac). Sem iPhone, o ciclo é: build EAS (device e
  `simulator`) + testes Python/TS no PC + validação em simulador/CI (se aprovada). Sideloadly
  só entra quando houver aparelho.
- **Tamanho estimado**: IPA atual 23 MB → ~45–60 MB (Python + yt-dlp + plugin). Medir no M1.
- **Assinatura**: mesma bundle id `com.ritmo.player`; sideload re-assina. Dados preservados ao
  instalar por cima.

### 6.1 Validação sem iPhone

O repo tem remote no GitHub (`MaikeSouzaL/player-downloader`) e o `eas.json` já tem o perfil
`simulator`. Sem aparelho, há três níveis de confiança:

| Nível | O que prova | O que não prova | Custo |
| --- | --- | --- | --- |
| **A. Build-only** | Compila, linka e gera IPA/.app | Nada em runtime | Baixo |
| **B. Simulador/CI** | App abre; Python sobe; yt-dlp resolve; download/merge; UI; logs | Background real, force-quit, Sideloadly, rede do celular | Médio (GitHub Actions + segredos) |
| **C. iPhone real** | Tudo, inclusive background e sideload | — | Aparelho emprestado ou device farm |

- **B** seria o mínimo para chamar de PoC. Um workflow macOS pode rodar `expo prebuild`,
  `pod install`, `xcodebuild` para o simulador, instalar o `.app`, abrir e executar um
  **autoteste embutido** (versões, resolve, download pequeno, merge) que grava um JSON de
  resultado e logs.
- **C** é obrigatório para o aceite final de background/force-quit e para o IPA via Sideloadly.
- **A** só é aceitável se você assumir explicitamente “não testado”; eu não recomendo.
- **Escolha atual: nível A (build-only).** B e C ficam disponíveis se você mudar de ideia; sem
  eles, o M1 não é um PoC executado, e sim um build com autoteste para o futuro.
- O app iOS atual **nunca foi executado**. Antes do GrabCore, recomendo um **M0.5** de smoke
  test (abrir, navegar, biblioteca) para não misturar bugs antigos com os do motor novo. Sem
  device/CI, o M0.5 também fica pendente.

### 6.2 Resultado do M1 (dispositivo e simulador)

- **Build EAS `ipa-gratis`:** `1e52e42c-5445-4bde-831f-816066418c0f` — verde.
  [Página do build](https://expo.dev/accounts/aike171/projects/ritmo/builds/1e52e42c-5445-4bde-831f-816066418c0f).
- **Build anterior supersedido:** `cc2f91ad-5e25-43fc-81d7-5810dcf3daa5`. A inspeção do IPA
  achou o `certifi/cacert.pem` ausente porque o `.easignore` excluía `*.pem`; a exceção foi
  adicionada e os `__pycache__`/`.pyc` locais foram removidos. O build atual não tem esse problema.
- **IPA:** [`ritmo/PlayerDownloader-ios.ipa`](https://expo.dev/artifacts/eas/pGUGDaBtkP-zMhrK-2YAz-AxNkHChOkKcAzoFA6ZpoY.ipa)
  — **38.062.517 bytes**; SHA-256
  `FC1916DA53E605A7E67044199E965E1786495DB254C73EC360D7E8D2C71A0A9D`.
- **Identidade:** `com.ritmo.player`, versão 1.5.0 (5), `MinimumOSVersion` **16.4**, scheme
  `ritmo`/`com.ritmo.player`.
- **Conteúdo verificado no IPA:** Python **3.13.16**, stdlib, 68 frameworks no total (Expo/React,
  Python e módulos `.fwork`), **1.214 arquivos** em `app_packages` (12.456.311 bytes), incluindo
  `grabcore`, `yt_dlp`, `yt_dlp_ejs`, o plugin WebKit e `certifi/cacert.pem` (238.856 bytes).
  Sem `__pycache__` e sem `.pyc`.
- **Link/assinatura:** o binário principal carrega `@rpath/Python.framework/Python` e tem os
  rpaths `@executable_path/Frameworks` e `@loader_path/Frameworks`. Os `.fwork` estão assinados
  ad-hoc; o app e o `Python.framework` ficam **sem assinatura** no perfil `ipa-gratis` e são
  reassinados pelo Sideloadly na instalação.
- **Autoteste:** `await RitmoCore.grabSelfTest({ resolve: true })`, a ser chamado num dev
  build/console (o IPA de release não tem botão de diagnóstico). Retorna versões, caminhos,
  checks de `ctypes`/`hashlib`/`ssl`/`certifi` e, opcionalmente, o resolve de um vídeo.
- **Simulador:** build `3b5acda3-46e4-4a1e-9a78-947c7a7a09f5` — verde.
  [Página do build](https://expo.dev/accounts/aike171/projects/ritmo/builds/3b5acda3-46e4-4a1e-9a78-947c7a7a09f5).
  Artefato: [`PlayerDownloader-ios-simulator.tar.gz`](https://expo.dev/artifacts/eas/AcQdM3aGdyGd0k6r2MfSFAHwHR1_vtEV3N4t6CWAbts.tar.gz)
  — **57.920.151 bytes**; SHA-256
  `5D4507035E22FAD8BD6A99D78466BDF67AE72F1CFCF7CD4A0E83FD94C96597F0`.
  O `.app` é universal (arm64/x86_64), com Python 3.13.16 universal, `app_packages` e
  `certifi/cacert.pem`; os `.fwork` foram gerados para **arm64** (Apple Silicon, o caso do EAS).
- **Não executado:** sem iPhone/CI, o IPA prova compilação, link e empacotamento — não prova
  que o Python sobe, que o WebKit JSI funciona ou que o YouTube resolve. O primeiro iPhone
  precisa estar em **iOS 16.4+**.

## 7. Fases e critérios de aceite

**Definição de pronto (acordada):** build EAS `ipa-gratis` verde + IPA gerado + autoteste embutido
+ `tsc`/`lint`/`test` verdes. **Não inclui** execução no simulador ou aparelho. A coluna
“Checklist futuro” é o roteiro para quando houver iPhone/CI; ela não será executada nesta entrega.

| Fase | Entrega | Aceite de build | Checklist futuro (não executado) |
| --- | --- | --- | --- |
| **M0** | Esta spec | Aprovada por você. | — |
| **M0.5 — Smoke iOS** | Opcional; só com CI. | EAS/`xcodebuild` verde. | App abre e navega; sem crash no boot (simulador/CI). |
| **M1 — Base** | Python + yt-dlp + plugin no app; autoteste de versões e resolve de 1 vídeo do YouTube. | ✅ Device + simulador verdes. | `yt-dlp <versão>` + título/duração/qualidades. |
| **M2 — Resolve** | `grabResolve`, `grabSearch`, playlist; tela habilitada no iOS; formatos filtrados. | Build verde. | Vídeo, Shorts, playlist e busca; live/privado com erro claro. |
| **M3 — Download** | 1 vídeo (pré-muxado e 1080p com merge) + 1 áudio M4A; progresso, cancelar, salvar. | Build verde. | Arquivo toca; nome correto; cancelar limpa temporários. |
| **M4 — Fila** | Playlist/leva, journal, retomada, erros mapeados. | Build verde. | Playlist de 10 em sequência; fechar/abrir no meio retoma. |
| **M5 — Background** | URLSession background, lock screen, app fechado, finalização ao voltar. | Build verde. | **iPhone real**: bloquear não interrompe; force-quit vira erro claro. |
| **M6 — Updater** | PyPI + SHA-256 + rollback + Ajustes. | Build verde. | Forçar versão, falhar e restaurar. |
| **M7 — Hardening** | Testes, docs, limpeza, tamanho, bateria. | Build verde. | Checklist completo no simulador + iPhone (quando houver). |

**Prazo realista:** 4–8 semanas em part-time para código + build verde. A validação real
(simulador/CI ou iPhone) é uma fase separada, quando existir; ela pode revelar bugs que só
aparecem em runtime — o build verde não garante funcionamento.

## 8. Riscos e mitigação

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Plugin WebKit JSI é experimental e cobre nsig, **não PO Token** | Alguns vídeos do YouTube podem falhar/limitar formatos | Testar cedo (M1); usar clients que não exigem PO Token; se necessário, cookies ou provider próprio na fase 2. |
| YouTube muda toda semana | Motor para de funcionar | Updater (M6) + fallback nightly + versão embutida; testar links reais a cada release. |
| Merge no iOS não roda com app fechado | Arquivo final atrasa | UX “finalizando ao voltar”; opcional BGProcessingTask/notificação na fase 2. |
| FFmpeg source-only (FFmpegKitNext) | Build longo/arriscado | Fase 2 separada; compilar no EAS/GitHub Actions e versionar o XCFramework. |
| Sem Mac | Iteração mais lenta | Builds EAS + logs + Registro de erros do app + testes Python no PC. |
| App iOS nunca executado | Bugs de base antes do GrabCore | M0.5 de smoke test se houver CI; sem CI, fica pendente (risco aceito). |
| Sem iPhone para testar | Runtime não verificado; background/force-quit só no aparelho | **Aceito:** entrega build-only; autoteste embutido + logs para diagnosticar no primeiro iPhone; CI/device farm opcional no futuro. |
| Tamanho do IPA e 1ª abertura | Instalação mais pesada | Medir no M1; podar stdlib; extração só do necessário. |
| Sideload 7 dias | App expira | Reinstalar com Sideloadly (dados continuam); não é regressão do projeto. |
| Legal/ToS | Uso pessoal, sideload | Sem App Store; aviso no README; licenças de terceiros atualizadas. |
| AVFoundation não cobre VP9/AV1/Opus | Menos formatos que Android | Esconder incompatíveis; fase 2 com FFmpeg. |
| App atual exige **iOS 16.4** | iPhone com iOS 15 não instala o app | Confirmar aparelho ≥ 16.4 antes do M1; downgrade do Expo é fora do escopo aprovado. |

## 9. Premissas

- Sem cookies/login (igual ao Android).
- Mesma API JS e mesma tela; nenhuma mudança de UX além de esconder MP3/legendas no iOS.
- Playlist 200 / leva 100 / live recusado / 3 tentativas de rede.
- “Biblioteca” = código nosso dentro do repo, não um SDK publicado.
- **Não há iPhone no momento** e a entrega acordada é **build-only**: código + build EAS verde
  + IPA + autoteste. Runtime não será validado; “funciona” fica pendente de iPhone/CI.
- GitHub Actions, simulador e device farm **não fazem parte desta entrega**; ficam como opção
  futura. Sem eles, o build verde não garante funcionamento.
- Não há Mac no fluxo; builds via EAS.
- yt-dlp é pinado no build; atualizações são só pacotes Python puros.
- FFmpeg (MP3/legendas/4K) é fase 2, não bloqueia a v1.
- Quando houver aparelho, ele precisa rodar o app atual (**iOS ≥ 16.4**). Um iPhone com iOS 15
  não instala o IPA; downgrade do Expo é fora do escopo.

## 10. Decisão final

| Tema | Decisão |
| --- | --- |
| Aparelho | **Sem iPhone**; sem device farm. |
| Nível de entrega | **Build-only**: código + build EAS verde + IPA + autoteste embutido. |
| Validação de runtime | **Não incluída**; fica pendente de iPhone/CI. |
| GitHub Actions | Fora desta entrega (opção futura). |
| Tamanho do IPA | “Tanto faz”; medir no M1. |
| Cota EAS | “Sim, tranquilo”; 8–12 builds. |
| YouTube/PO Token | Cobertura parcial na v1; cookies/PO Token na fase 2 se necessário. |
| FFmpeg | v1 sem; fase 2 só sob demanda. |

### O que “pronto” significa nesta entrega

- Código implementado (GrabCore iOS + Python + JS/UI + updater).
- `npx tsc --noEmit`, `npx expo lint`, `npm test` verdes.
- Build EAS iOS (`ipa-gratis`) verde e **IPA gerado**.
- Autoteste embutido (versões, checks de runtime e resolve) para rodar no primeiro iPhone/dev build.
- **Não significa** que o app abre, que o Python inicializa, que o YouTube resolve ou que o
  download/background funcionam. Essas provas exigem runtime (simulador/CI ou iPhone).

### Próximo passo (M2 — Resolve/UI)

- Habilitar `grabEnabled()` no iOS e a tela “Baixar de um site”.
- Ligar `grabResolve`/`grabSearch`/playlist à UI e filtrar formatos compatíveis com AVFoundation.
- Manter `grabStart` como stub até o M3 (download real).
- Rodar o autoteste no primeiro iPhone/dev build e anexar o JSON de resultado ao M1.

O M1 está concluído como **build-only**: código, IPA e autoteste embutido. Sem runtime, a
confiança é de compilação/link/empacotamento — não de funcionamento. Se quiser mudar para
simulador/CI ou iPhone emprestado, isso muda o nível de confiança, não a arquitetura.
