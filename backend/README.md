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
- **Cookies do YouTube nunca são gravados.** O app manda uma cópia junto de cada `/resolve` e
  `/download`; o servidor usa num arquivo temporário só para aquela chamada do yt-dlp e apaga no
  fim. O job guarda o texto em memória apenas enquanto baixa e o descarta ao terminar.

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
| `POST` | `/resolve` | `{ "url", "playlist"?, "cookies"? }` → vídeo (qualidades, áudio, legendas) ou playlist (lista de vídeos) |
| `GET` | `/search?q=&limit=` | busca no YouTube sem cookies (compatibilidade) |
| `POST` | `/search` | `{ "q", "limit"?, "cookies"? }` → busca no YouTube (a “lupa” do SnapTube) |
| `POST` | `/download` | `{ "token", "formatId", "subtitles"?, "entries"?, "cookies"? }` → `{ "id", "ids" }` |
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
| `RITMO_PUBLIC` | 0 | aberto para a internet: exige `RITMO_KEY` e o `/logs/view` deixa de abrir sem chave no próprio PC |
| `RITMO_YTDLP_ARGS` | vazio | opções a mais em toda chamada do yt-dlp (ex.: `--proxy …`) |
| `RITMO_MAX_READS` | 4 | leituras de link (`/resolve`, `/search`) ao mesmo tempo |

## Usar de fora de casa (grátis): PC + Tailscale Funnel

O servidor continua no PC (IP de casa: o YouTube bloqueia bem menos que IP de nuvem) e o
Tailscale Funnel dá um endereço `https://…ts.net` fixo, com certificado, sem abrir porta no roteador.

1. Crie a conta em tailscale.com (login com Google/GitHub/Microsoft) e instale o Tailscale no PC.
2. No painel do Tailscale, ative **HTTPS** (DNS › HTTPS Certificates) e o **Funnel** para este PC.
3. Suba o servidor no modo internet (cria a chave em `backend/ritmo.key` na primeira vez):
   ```powershell
   .\start.ps1 -Public
   ```
4. Em outro terminal, publique a porta (fica ligado mesmo fechando o terminal):
   ```powershell
   tailscale funnel --bg 8787
   tailscale funnel status   # mostra o endereço https://<pc>.<rede>.ts.net
   ```
5. No app: em `ritmo/.env.local` (modelo em `.env.example`) ponha o endereço e a chave e gere o
   APK/IPA de novo — o app já sai apontando para o servidor. Ou digite os dois em Ajustes › Servidor.

Para abrir o painel de erros pela internet: `https://<pc>.<rede>.ts.net/logs/view?k=<chave>`.
Limites: o PC precisa ficar ligado; o Funnel tem limite de banda (não divulgado) e o plano grátis
é para uso pessoal. Se só você usa, dá até para não publicar: instale o Tailscale no celular e use
o endereço `http://<pc>:8787` da sua rede Tailscale.

## Nuvem grátis sem cartão: Render

O `render.yaml` na raiz do repositório descreve o serviço (Docker, plano grátis, região Virgínia).

1. Crie a conta em render.com entrando com o GitHub e dê acesso ao repositório `player-downloader`.
2. New › **Blueprint** › escolha o repositório. Ele pede a `RITMO_KEY`: cole a do `backend/ritmo.key`.
3. Quando o deploy terminar, copie o endereço `https://….onrender.com` e ponha em `ritmo/.env.local`
   (`EXPO_PUBLIC_GRAB_SERVER`, com a chave em `EXPO_PUBLIC_GRAB_KEY`) antes de gerar o APK/IPA.

Cada push que mexe em `backend/` publica de novo sozinho. Limites do plano grátis: 512 MB e 0,1 de
CPU (um download por vez, e devagar), dorme depois de 15 min sem uso e leva cerca de 1 minuto para
acordar, disco que se apaga ao dormir (as atualizações do yt-dlp se perdem e a imagem volta à
versão do último deploy) e **5 GB de banda por mês** — passou disso, o Render suspende o serviço
até o mês seguinte. Dá para música; vídeo acaba rápido. Os relatórios de erro do app também se
perdem quando ele dorme. E vale o mesmo aviso do YouTube com IP de nuvem (abaixo).

## YouTube em nuvem: cookies da conta (opcional)

IP de datacenter (Render, Oracle) faz o YouTube pedir “confirme que não é um robô”. Trocar o
cliente ajuda em parte (`RITMO_YTDLP_ARGS=--extractor-args youtube:player_client=web_embedded,android_vr`),
mas o bloqueio é por IP; o caminho que costuma passar é usar os cookies de uma conta logada.

**O servidor não guarda cookies.** O app guarda o `cookies.txt` no aparelho e manda uma cópia em
cada `/resolve` e `/download`; o servidor usa num arquivo temporário e apaga no fim. Cada job leva
o seu próprio conjunto, então **várias pessoas podem usar o mesmo servidor sem misturar contas**.
No Render grátis pode dormir à vontade: o app reenvia na próxima operação.

No app: **Ajustes › Conta do YouTube** → login no WebView (ou colar o `cookies.txt`). O arquivo
fica na área privada do app e é reenviado a cada download.

> **Aviso:** cookies dão acesso total à conta. Use uma conta secundária, nunca a principal. O
> Google pode bloquear a conta por automação. O servidor vê os cookies em memória durante o
> download (não tem como usar sem eles), mas não os grava em log nem em disco; quem tiver a chave
> do servidor ainda pode interceptá-los no pedido.

Para testar sem o app (troque endereço e chave):

```powershell
$server = "https://….onrender.com"
$key = "a-chave-do-RITMO_KEY"
$cookies = Get-Content "$env:USERPROFILE\Downloads\cookies.txt" -Raw
$body = @{ url = "https://www.youtube.com/watch?v=jNQXAC9IVRw"; cookies = $cookies } | ConvertTo-Json
Invoke-RestMethod -Uri "$server/resolve" -Method Post -Headers @{ "X-Ritmo-Key" = $key } `
  -ContentType "application/json" -Body $body
```

O `/download` também precisa do mesmo campo `cookies` (o app manda). O `cookies.txt` Netscape e o
cabeçalho `Cookie: ...` são aceitos.

Se ainda aparecer “robô” com cookies válidos, a conta ou o IP foram marcados; tente outra conta ou
um proxy residencial. Cookies **não** são usados para DRM/assinatura. A chave do servidor ainda é
compartilhada; para um grupo pequeno, cada pessoa pode usar a própria chave (ou o próprio servidor).

## Nuvem grátis: Oracle Cloud Always Free

A pasta `deploy/` sobe o servidor numa máquina Ubuntu com Docker e HTTPS automático (Caddy +
Let's Encrypt), e o `deploy.ps1` faz tudo a partir do PC.

1. **Conta** em oracle.com/cloud/free (pede cartão só para conferir; escolha a região de casa
   com cuidado — São Paulo ou Vinhedo —, ela não muda depois).
2. **Máquina**: Compute › Instances › Create. Imagem **Ubuntu 24.04**, forma **Ampere
   VM.Standard.A1.Flex** com o que o Always Free deixar (hoje 2 OCPU / 12 GB). Se der “Out of
   capacity”, tente outro domínio de disponibilidade ou mais tarde; a E2.1.Micro (1 GB) também
   funciona, só que bem mais lenta. Em SSH, “Gerar par de chaves” e **salve a chave privada**
   (por exemplo em `%USERPROFILE%\.ssh\oracle-ritmo.key`). Anote o **IP público**.
3. **Portas**: Networking › Virtual Cloud Networks › a rede › Security Lists › Add Ingress Rules:
   origem `0.0.0.0/0`, TCP, portas `80,443`.
4. **Nome com HTTPS**: em duckdns.org crie um subdomínio (ex.: `meuplayer.duckdns.org`) e ponha
   nele o IP público da máquina.
5. **Envio** (no PC):
   ```powershell
   .\deploy\deploy.ps1 -Server <IP> -KeyFile "$env:USERPROFILE\.ssh\oracle-ritmo.key" -Domain meuplayer.duckdns.org
   ```
   Ele instala Docker e firewall, sobe com HTTPS, usa a chave de `ritmo.key` e grava endereço e
   chave em `ritmo/.env.local` — o próximo APK/IPA já sai apontando para a nuvem. Rodar de novo
   atualiza o servidor (a chave e os relatórios de erro ficam em `/opt/ritmo` na máquina).

Cuidados:
- **YouTube**: em IP de nuvem ele costuma pedir “confirme que não é um robô”; a atualização
  automática não resolve isso (os outros sites em geral funcionam). Dá para tentar o cliente
  `web_embedded` sem mudar o código (`-YtDlpArgs '--extractor-args youtube:player_client=web_embedded,android_vr'`)
  e, se ainda pedir robô, enviar os **cookies da conta** (seção acima) ou usar um proxy
  residencial. Se nada der, o servidor do PC continua sendo o melhor para o YouTube.
- A Oracle pode **recolher máquina grátis parada** (uso baixo por 7 dias). Passar a conta para
  “Pay As You Go” evita isso e continua sem custo enquanto ficar dentro do Always Free.

Em outra VPS qualquer, sem o script:

```bash
docker build -t ritmo-downloader .
docker run -d --name ritmo-downloader -p 8787:8787 -e RITMO_KEY="uma-senha-longa" -e RITMO_PUBLIC=1 \
  --restart unless-stopped ritmo-downloader
```

Para os vídeos não precisa de volume; para guardar os relatórios de erro entre atualizações
do contêiner, monte um: `-v ritmo-logs:/app/logs`. Coloque um proxy HTTPS (Caddy/Traefik) na frente: aí o app usa
`https://…` e não precisa da liberação de HTTP local (no Android o `usesCleartextTraffic` e
no iOS o `NSAllowsLocalNetworking` só existem para o modo PC na mesma rede).

## Limites e cuidados

- Só conteúdo que você já pode acessar: **não** há DRM nem burla de assinatura. Os cookies do
  YouTube são opcionais, ficam no aparelho e permitem usar a sessão do usuário; use uma conta
  secundária. Sites que exigem conta (alguns vídeos do Vimeo, posts privados do Instagram,
  conteúdo de membros) continuam recusados com uma mensagem clara.
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
