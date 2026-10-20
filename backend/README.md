# Servidor de downloads do Ritmo

O celular não fala com o YouTube/Instagram/TikTok direto: ele manda o link para este
servidor, que usa **yt-dlp** para descobrir as qualidades e o **FFmpeg** para juntar
vídeo + áudio, converter em MP3/M4A e embutir capa e legenda. O arquivo pronto é baixado
pelo próprio Ritmo (DownloadManager no Android, URLSession no iPhone) e entra na biblioteca.

## O que precisa no PC

| Item | Versão | Como instalar |
| --- | --- | --- |
| Python | 3.10+ (testado com 3.10 e 3.12) | https://python.org (marque “Add to PATH”) |
| Node.js | 20+ (testado com 22) | https://nodejs.org — o yt-dlp usa para os desafios do YouTube |
| FFmpeg | qualquer recente | `winget install Gyan.FFmpeg` |

> Sem o FFmpeg o servidor ainda baixa vídeos que já vêm com áudio, mas não junta
> 1080p/4K, não converte para MP3 nem embute legenda. O `/health` avisa se ele falta.

## Subir no Windows

```powershell
cd backend
.\start.ps1                          # porta 8787
.\start.ps1 -Key "uma-senha-longa"   # com chave (recomendado se a rede não for só sua)
.\start.ps1 -Nightly                 # sempre a versão nightly do yt-dlp
.\start.ps1 -NoUpdate                # sem atualização automática
```

Na primeira vez ele cria o `.venv`, instala as dependências e abre a porta no firewall
(essa parte precisa de PowerShell como administrador). O endereço aparece no console:

```
Ritmo Downloader 2.0.0  http://192.168.1.7:8787
```

No celular: **Ajustes › Servidor de downloads**, cole `192.168.1.7:8787`, a chave (se usou)
e toque em **Testar conexão**. O celular e o PC precisam estar na mesma rede Wi-Fi.

## Nada fica guardado

- Os arquivos vivem numa pasta própria dentro do temp do sistema
  (`%TEMP%\ritmo-downloader` no Windows), apagada ao subir e ao desligar o servidor.
  A antiga `backend/data` não é mais usada.
- Cada download tem a sua subpasta, apagada **assim que o celular recebe o último byte**
  (com 60 s de folga para uma retomada), quando o app avisa que salvou
  (`DELETE /job/{id}`), ou em 1 hora se ninguém baixar.
- Erros e cancelamentos apagam o temporário na hora; cancelar mata o yt-dlp e o FFmpeg.
- Só conta como entregue quando o celular recebeu o arquivo **inteiro** (retomadas somam;
  uma espiada só no fim do arquivo não conta). O prazo de 1 hora conta do último acesso.
- Abrir o servidor duas vezes não apaga os downloads do que já está rodando: o segundo
  avisa que a porta está em uso e não sobe.
- A única coisa guardada de propósito são os **relatórios de erro** do app, em `backend/logs/`
  (com rodízio: até ~30 MB).

## Atualização automática do yt-dlp

O YouTube muda as proteções quase toda semana e o yt-dlp quebra até sair uma versão nova.
Por isso o servidor:

1. lê o erro e decide se é **extrator desatualizado** (ex.: “Sign in to confirm you’re not a
   bot”, “nsig extraction failed”, “Unable to extract…”, HTTP 403). Vídeo privado, removido,
   com restrição de idade, só para membros ou rede caída **não** disparam atualização;
2. fecha a porta para processos novos do yt-dlp, espera até 20 s os que estão rodando e
   troca **só o yt-dlp** (`pip install -U --no-deps yt-dlp`, que é Python puro) e depois as
   dependências que a versão nova exigir; se a estável não trouxer nada novo, tenta a
   **nightly** — liberada só para o yt-dlp, nunca para as outras bibliotecas;
3. repete o pedido uma vez com a versão nova — sem reiniciar, porque o yt-dlp roda num
   processo separado a cada pedido.

Página sem vídeo (“Unsupported URL”) não dispara atualização.

Entre uma tentativa e outra espera 15 min, e também confere uma vez por dia (quando não há
download rodando). O histórico aparece no `/health`, e o app tem o botão
**Atualizar yt-dlp** (`POST /update`).

## Endpoints

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/` | status rápido (versões, FFmpeg) |
| `GET` | `/health` | o que o “Testar conexão” usa; inclui a fila e as atualizações |
| `POST` | `/update` | atualiza o yt-dlp agora |
| `POST` | `/resolve` | `{ "url", "playlist"? }` → vídeo (qualidades, áudio, legendas) ou playlist (lista de vídeos) |
| `GET` | `/search?q=&limit=` | busca no YouTube (a “lupa” do SnapTube) |
| `POST` | `/download` | `{ "token", "formatId", "subtitles"?, "entries"? }` → `{ "id", "ids" }` |
| `GET` | `/job/{id}` | `queued`, `downloading`, `converting`, `ready`, `error`, `cancelled` + progresso |
| `GET` | `/jobs?ids=a,b` | vários de uma vez (playlist) |
| `DELETE` | `/job/{id}` | cancela, ou avisa que o celular já salvou (apaga o temporário) |
| `GET`/`HEAD` | `/file/{id}` | o arquivo pronto (aceita `Range`, então o download retoma) |

Tudo pede a chave em `X-Ritmo-Key` (quando `RITMO_KEY` existe), menos `/` e `/file/{id}`:
o ID do download é aleatório (128 bits) e só quem criou o download com a chave o conhece —
assim a chave não fica gravada no histórico de downloads do Android. IDs fora do formato
(32 caracteres hex) são recusados antes de tocar no disco.

Relatórios de erro: `POST /logs` (o app manda), `GET /logs`, `GET /logs/summary`,
`DELETE /logs` e a página **`/logs/view`**, que abre sem chave **só no navegador do próprio PC**
(`http://localhost:8787/logs/view`); de outro aparelho pede a chave.

Limites: no máximo 4 leituras de link ao mesmo tempo (as outras esperam), 100 vídeos por lote,
200 na fila e pedidos de até 2 MB.

IDs de formato: `v:<id>` (qualidade exata de um vídeo), `h:<altura>` (melhor até essa
altura, usado em playlists), `a:mp3:320|192|128` e `a:m4a:0` (áudio); legendas `s:<idioma>`
(escrita) e `as:<idioma>` (automática). O `token` do `/resolve` vale 20 minutos.

Vídeos saem em **MP4**, com H.264 + AAC sempre que o site oferece (toca em qualquer aparelho).
2K/4K do YouTube só existem em VP9/AV1, que iPhones antigos podem não tocar — o app avisa.
Áudio sai em **MP3** ou **M4A** com capa, título e artista. Legendas vão **dentro do MP4**.

## Organização do código

```
backend/
  app.py                 compatibilidade: `uvicorn app:app` ainda funciona
  ritmo_server/
    main.py              monta o FastAPI (create_app) e o ciclo de vida
    config.py            variáveis de ambiente
    services.py          liga as peças
    core/                erros (e quando se atualizar), rede, nomes de arquivo
    ytdlp/               opções de qualidade, execução do yt-dlp, atualizador, JSON → app
    jobs/                fila, registro em memória, temporários e faxina
    api/                 rotas HTTP
  tests/                 pytest com um yt-dlp falso (sem internet)
```

Testes: `pip install -r requirements-dev.txt` e `python -m pytest`.

## Variáveis de ambiente

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `RITMO_KEY` | vazio | chave do app (vazio = sem chave) |
| `PORT` | 8787 | porta |
| `RITMO_TMP` | temp do sistema | onde criar a pasta `ritmo-downloader` |
| `RITMO_WORKERS` | 2 | downloads ao mesmo tempo |
| `RITMO_AUTO_UPDATE` | 1 | atualizar o yt-dlp sozinho |
| `RITMO_YTDLP_CHANNEL` | stable | `nightly` para usar sempre a versão de teste |
| `RITMO_NIGHTLY_FALLBACK` | 1 | se a estável não resolver, tenta a nightly |
| `RITMO_ALLOW_PRIVATE` | 0 | aceitar links da rede local (NAS etc.) |
| `RITMO_LOGS` | `backend/logs` | onde guardar os relatórios de erro do app |

## VPS com Docker

```bash
docker build -t ritmo-downloader .
docker run -d --name ritmo-downloader -p 8787:8787 -e RITMO_KEY="uma-senha-longa" \
  --restart unless-stopped ritmo-downloader
```

Para os vídeos não precisa de volume; para guardar os relatórios de erro entre atualizações
do contêiner, monte um: `-v ritmo-logs:/app/logs`. Coloque um proxy HTTPS (Caddy/Traefik) na frente: aí o app usa
`https://…` e não precisa da liberação de HTTP local (no Android o `usesCleartextTraffic` e
no iOS o `NSAllowsLocalNetworking` só existem para o modo PC na mesma rede).

## Limites e cuidados

- Só conteúdo público: **não** há login, cookies, DRM nem burla de assinatura. Sites que
  exigem conta (alguns vídeos do Vimeo, posts privados do Instagram, conteúdo de membros)
  continuam recusados com uma mensagem clara.
- Transmissões ao vivo e estreias não são baixadas.
- Links para o próprio PC ou para a rede (`localhost`, `10/8`, `172.16/12`, `192.168/16`,
  `100.64/10`, `.local`, nomes sem domínio, formas disfarçadas como `127.1` e nomes que apontam
  para esses endereços) são recusados, inclusive os vídeos de playlists — o servidor não vira
  ponte para a sua rede.
- Baixe apenas o que você tem o direito de usar. As regras de cada site continuam valendo —
  este projeto não é afiliado a nenhum deles.

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| “Não deu para falar com o servidor” | IP errado, PC desligado, firewall ou redes diferentes (celular no 4G) |
| “O site pediu verificação de robô” | o servidor já tentou se atualizar; espere uns minutos (o IP pode estar bloqueado) |
| “Transmissões ao vivo…” | live e estreia não são suportadas |
| MP3 ou legenda indisponível | FFmpeg não está no PATH do PC |
| 401 | chave do app diferente do `RITMO_KEY` |
