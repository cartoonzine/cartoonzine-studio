# 🎛️ Cartoonzine Studio

O lugar onde o conteúdo do Cartoonzine nasce. Você adiciona **cartoons, animes, desenhos 24h, filmes,
séries, rádios, canais do TVzine e jogos retrô**. O Studio organiza, completa e publica os DBs
que o [cartoonzine-cloud](https://github.com/cartoonzine/cartoonzine-cloud) já sabe ler.

```
 você (painel, linha de comando ou arquivo)
        │  "Caverna do Dragão S01E03 | https://…"
        ▼
 conteudo/        um .json por série/filme/canal/rádio/jogo  ← fonte da verdade
        │  GitHub Actions (sozinho, a cada mudança)
        ▼
 dist/            cartoons.json · animes.json · canais.m3u · jogos/megadrive.json …
        │  links fixos, ligados uma vez no sources.json do cloud
        ▼
 cartoonzine-cloud → catálogo fatiado → app Cartoonzine / TVzine / Emulador
```

## O que ele faz sozinho

- **Entende o que você cola**: `Nome | link | capa`, links soltos, listas M3U inteiras, links do
  archive.org e até as **mensagens do @CZStreamBot** (pega o link de download e ignora o `/watch/`).
- **Monta séries pelo nome do arquivo**: `Naruto S01E03`, `1x05`, `T2E10`, `Episódio 12`,
  `Temporada 2 Episódio 7`. Episódio novo de uma série que já existe entra na temporada certa.
- **Junta em vez de duplicar**: mesmo nome = mesmo item. Link repetido vira **link reserva**
  (o player tenta o próximo quando um cai). Nada que você escreveu é apagado.
- **Preenche sozinho**: sinopse, capa e ano pela Wikipedia; todos os vídeos de um item do
  Internet Archive viram filme ou série com um clique.
- **Limpa o nome**: tira `720p`, `WEB-DL`, `x264`, `[grupo]`, detecta `Dublado/Legendado` e o ano.
- **Traduz categorias** de listas em inglês (iptv-org, Pluto TV): `News` → Notícias, `Kids` → Infantil…
- **Valida antes de publicar**: item com erro fica de fora e aparece em `dist/relatorio.json`;
  o resto publica normalmente.
- **Modo automático**: puxa listas M3U, itens e buscas do Internet Archive todo dia
  (`automatico/fontes.json`) sem atropelar o que você fez à mão.
- **Testa os links** todo dia e marca como morto só depois de 3 falhas seguidas.

---

## Instalação (uma vez só)

1. **Crie o repositório** `cartoonzine/cartoonzine-studio` no GitHub (público, igual ao cloud) e suba
   todos os arquivos desta pasta (pelo GitHub Desktop, `git push` ou "Add file → Upload files").
2. **Deixe o robô gravar**: no repositório, *Settings → Actions → General → Workflow permissions* →
   marque **Read and write permissions** → *Save*.
3. **Ligue o painel online**: *Settings → Pages* → *Source: Deploy from a branch* → branch `main`,
   pasta `/ (root)` → *Save*. Em 1–2 minutos o painel abre em
   `https://cartoonzine.github.io/cartoonzine-studio/`.
4. **Crie um token** para o painel salvar no GitHub:
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) →
   *Repository access: Only select repositories* → `cartoonzine-studio` →
   *Permissions → Contents: Read and write* → *Generate*. Cole no painel ao conectar.
5. **Ligue ao cartoonzine-cloud** (uma vez; os links nunca mudam):
   ```bash
   node tools/ligar-cloud.mjs ../cartoonzine-cloud/sources.json
   ```
   Isso preenche as vagas vazias do `sources.json` do cloud (Cartoons VOD, Animes, Desenhos 24 Horas,
   Séries, Rádios e cada console) e adiciona "Filmes (Studio)" e "TVzine - Canais (Studio)".
   Depois é só commit/push do cloud.

> Repositório com outro nome ou em outra conta? Troque `publicacao` no `studio.config.json` antes do passo 5.

---

## Três jeitos de adicionar conteúdo

### 1. Painel (o mais fácil)

Online pelo GitHub Pages, ou no seu PC sem token:

```bash
node tools/painel.mjs          # abre em http://localhost:4321 e salva direto em conteudo/
```

- **⚡ Adicionar rápido**: cole qualquer coisa (lista M3U, vários links, mensagens do bot, links do
  archive.org), escolha os padrões (país, categoria, console, áudio) e clique em **Analisar**.
  Aparece uma prévia dizendo o que é novo e o que vai **juntar com o existente**. **Salvar** grava
  tudo de uma vez (no GitHub, um único commit).
- **+ Novo / clicar num card**: formulário completo, editor de temporadas, **📋 Colar vários
  episódios** dentro de uma série e **✨ Preencher automaticamente**.
- **Salvar como rascunho**: guarda sem publicar, para terminar depois.
- **Links publicados**: os endereços fixos de cada DB.

### 2. Linha de comando (Node 18+, sem instalar nada)

```bash
# um item
node tools/add.mjs cartoons "Popeye o Marinheiro (1933)" https://…/popeye.mp4 --wiki
node tools/add.mjs cartoons "Caverna do Dragão S01E03" https://…/ep3.mp4         # entra na série
node tools/add.mjs canais "TV Cultura" https://…/cultura.m3u8 --pais BR --categoria Educativo
node tools/add.mjs radios "Rádio X" https://…/stream --pais BR --cidade "São Paulo"
node tools/add.mjs jogos "Sonic" https://…/sonic.zip --console megadrive
node tools/add.mjs filmes "Nosferatu" https://archive.org/details/<id> --wiki     # importa do archive

# muitos de uma vez
node tools/importar.mjs canais lista.m3u --pais BR --idioma Português
node tools/importar.mjs animes links.txt --wiki
node tools/importar.mjs cartoons - --simular      # cole no terminal, Ctrl+D; --simular não salva

node tools/build.mjs                              # gera dist/ (o GitHub faz isso sozinho)
```

### 3. Arquivos

Um `.json` por item em `conteudo/<coleção>/`. Modelos prontos em [`exemplos/`](exemplos/).
Dá para editar até pelo site do GitHub: o robô publica sozinho a cada commit.

---

## Coleções

| Coleção | Pasta | Vai para | Arquivos publicados |
|---|---|---|---|
| 🎨 Cartoons | `conteudo/cartoons/` | Cartoonzine | `cartoons.json` |
| 🍥 Animes | `conteudo/animes/` | Cartoonzine | `animes.json` |
| 📺 Desenhos 24 Horas | `conteudo/desenhos-24h/` | Cartoonzine | `desenhos-24h.m3u` + `.json` |
| 🎬 Filmes | `conteudo/filmes/` | Cartoonzine | `filmes.json` |
| 🎞️ Séries | `conteudo/series/` | Cartoonzine | `series.json` |
| 📻 Rádios | `conteudo/radios/` | Rádio | `radios.json`, `radios.m3u`, `radios/pais/<pais>.m3u` |
| 📡 Canais | `conteudo/canais/<país>/` | TVzine | `canais.json`, `canais.m3u`, `canais/pais/<pais>.m3u` |
| 🕹️ Jogos Retrô | `conteudo/jogos/<console>/` | Emulador | `jogos/<console>.json` (27 consoles) |

Os `.m3u` por país também funcionam direto em qualquer player IPTV (VLC, TiviMate…).

### Criar uma coleção nova

Copie um bloco de `colecoes` no `studio.config.json`, troque `id`, `nome`, `icone` e o `fonteCloud`
(nome da fonte e categoria no cloud), e escolha o `tipo`:

| tipo | serve para |
|---|---|
| `video` | filmes, desenhos, séries, animes, documentários (avulso ou com temporadas) |
| `canal24h` | canais que passam um desenho/série sem parar |
| `canal` | canais de TV com país, idioma e categoria |
| `radio` | rádios com país e cidade |
| `jogo` | ROMs, separadas por console |

O painel monta o formulário sozinho. Depois rode `node tools/ligar-cloud.mjs` de novo para a fonte
nova entrar no cloud. Console novo? Adicione em `consoles` do mesmo arquivo.

---

## Modo automático

Em `automatico/fontes.json` já vêm 3 exemplos desligados (iptv-org Brasil e Portugal, desenhos
clássicos do Internet Archive). Troque `"ativo": false` para `true` e o robô puxa todo dia.

| tipo | o que puxa |
|---|---|
| `m3u` | uma lista M3U (`url`), com `padroes` (país, categoria…) e `filtro` (regex no nome/grupo) |
| `texto` | um arquivo de links (`url`), no mesmo formato da adição rápida |
| `archive` | itens do Internet Archive (`ids`) |
| `archive-busca` | uma busca do Internet Archive (`busca`, `limite`) |

Convivência com o manual: itens automáticos ganham `"_origem"`. Itens feitos à mão só **ganham**
episódios e links, nunca perdem. `"removerSumidos": true` apaga só os automáticos que saíram da fonte.
Quer congelar um item automático? Coloque `"_travado": true` nele.

---

## Estrutura

```
studio.config.json      coleções, consoles, categorias, onde publicar
core/studio-core.js     o cérebro (o mesmo arquivo roda no painel e no Node)
painel/                 painel web
tools/                  build, add, importar, sincronizar, verificar-links, ligar-cloud, painel
conteudo/               seus itens (um .json cada)
automatico/fontes.json  fontes do modo automático
dist/                   gerado pelo robô; não edite à mão
exemplos/               modelos de arquivo
test/                   testes (node --test test/*.test.mjs)
```

## Dúvidas rápidas

- **Salvei e não apareceu no app.** Veja a aba *Actions* do repositório (o robô leva 1–2 min) e depois
  o robô do cartoonzine-cloud, que reconstrói o catálogo a cada 6 h ou pelo botão *Run workflow* de lá.
- **Um item não foi publicado.** Ele tem erro: está em `dist/relatorio.json` com o motivo.
- **Links do @CZStreamBot** dependem do bot estar no ar no Render. Se o bot cair, o link para de
  funcionar. Para conteúdo fixo, prefira links permanentes (archive.org, seu servidor).
- **Episódios com link reserva**: o cloud de hoje usa só o 1º link de cada episódio; os outros ficam
  guardados em `reservas` para quando o player suportar.
