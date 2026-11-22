# 🔗 Link Edit

Tela do Studio (botão **🔗 Link Edit**, ou `…/painel/#linkedit`) para editar listas de canais sem digitar nada.

## Fase 1 (pronta)
- **Abrir listas:** link (M3U, JSON, TXT), arquivo do PC ou qualquer texto colado (página, conversa) — os links são achados sozinhos.
- **Arruma sozinho:** nome limpo ("GLOBO SP FHD [BR]" → "Globo SP"), país, idioma e tipo (Infantil, Notícias, Esportes…), qualidade, User-Agent/Referer do canal.
- **Filtros:** busca, idioma, tipo, país, status, só vivos, sem logo, duplicados, quarentena.
- **Visualizador:** prévia pequena e muda (HLS, TS, MP4/WebM); no painel local toca pelo túnel (canais sem CORS e que pedem User-Agent tocam).
- **Scan:** testa os selecionados (ou os visíveis) de verdade — lista HLS → qualidade → primeiro pedaço do vídeo. Status: vivo, lento, morto, bloqueado, pede UA. Guarda o histórico (confiança "9 de 10").
- **Lista nova:** "Jogar na lista nova" junta cópias do mesmo canal (mesmo tvg-id, ou mesmo nome + país) em UM canal com as outras como reserva. Ordem com ▲▼; baixar M3U / JSON / TXT ou copiar.
- **Quarentena** (tira da lista, pode voltar) e **Desfazer** (Ctrl+Z).
- Atalhos: ↑ ↓ canal · Espaço testar · → lista nova · Del quarentena · Ctrl+Z desfazer.

O Scan e o túnel precisam do painel local (`node tools/painel.mjs`): o navegador sozinho não lê a maioria dos canais (CORS).
Endereços internos (localhost, rede da casa) são recusados pelo teste e pelo túnel.

## Parte 2 — Enviar ao Studio (canais)
Botão **➜ Enviar ao Studio** na lista nova (ou os marcados). Mostra tudo antes de gravar:
- **Destino pela categoria:** Canais (TVzine) separados por país · *Desenhos 24H* → Desenhos 24 Horas (link do YouTube → YouToon) · *Rádios* → Rádios. Filme/série em arquivo fica de fora (importador de filmes). Dá para trocar o destino de cada linha.
- **Formato do Studio:** país, idioma no nome do Studio (pt-BR → Português), categoria oficial, logo, tvg-id + guia (EPG), User-Agent/Referer; reservas viram links extras.
- **Já existe?** Junta (links novos viram reserva, campos vazios são completados, nada é apagado). Repetido no lote vira reserva.
- **Falta dado** (ex.: país): não grava; "País para quem não tem" resolve em massa. Opções: só os vivos, como rascunho.
- **Categorias:** a lista oficial é `categoriasCanais` do `studio.config.json` (a do TVzine). Nomes de outras listas viram o oficial ("Abertos" → TV Aberta, "Gospel" → Religioso, "Filmes" → Filmes e Séries).
- **Guias:** o canal guarda o link do guia (`epg`); o DB publicado leva `epg` no topo e a M3U o `url-tvg`.

## Parte 2 — Enviar ao Studio (filmes e séries)
Na mesma janela (uma aba por coleção do Studio: 🎨 Cartoons, 🍥 Animes, 📺 Desenhos 24H, 🎬 Filmes, 🎞️ Séries, 📻 Rádios, 📡 Canais…; cada aba grava só a sua coleção, *Tudo* grava todas; "Mandar a lista inteira para…" ignora o destino automático):
- Entram arquivos (mp4, mkv…), torrents e links `/movie/` `/series/` do Xtream; lista de filmes em .m3u8 → "tratar todos como filme/série".
- **Episódios** (S01E02, 1x02, Episódio 2) viram **uma série com temporadas**; **cópias** do mesmo filme (nome + ano) viram um item com as outras de reserva.
- **Destino pelo tipo:** Animes, Cartoons (desenho/infantil), Séries, Filmes (torrent → Filmes torrent); trocável por linha.
- **🔎 Completar no TMDB (só o que falta):** capa, banner, sinopse, ano, gêneros e episódios — nunca troca o que já tem (sem chave do TMDB usa a Wikipedia).
- Já existe no Studio (mesmo nome na coleção) → junta: episódios novos na temporada certa, links novos de reserva.

## Parte 2 — Scan em lote
Botão **Scan** (ou tecla T): o que testar (marcados, visíveis, nunca testados, retestar mortos, quarentena), Rápido/Completo,
4–32 ao mesmo tempo, Pausar/Continuar/Parar, tempo restante, contadores, gráfico do tempo de abertura. No fim, num clique:
vivos → lista nova, mortos → quarentena, logos e guias que faltam. Quarentena: quem volta a abrir sai sozinho; quem morre 3× seguidas pode ser apagado.
Precisa do painel do PC (o navegador não abre links http:// nem servidores sem CORS).

## Parte 3 — Receitas → agora dentro do 🔗 Sidechain
As Receitas viraram parte do Sidechain: um envio pode ter **várias listas**, **filtros** (idioma, tipo, categoria, país,
nome, confiança mínima, fora Adulto) e **"Publicar também como lista avulsa"**, que gera `listas/<envio>.m3u` e `.json`
com link fixo para outros players (índice em `listas/avulsas.json`). O envio pode não ter coleção (só a lista avulsa).
Um robô só (`tools/sidechain.mjs`) faz tudo.

## Parte 4 — Importar lista inteira
Botão **⚡ Importar lista inteira**: lista que já está pronta vai direto para a janela Enviar ao Studio (automático ou tudo para uma
coleção), com TMDB só onde falta (estimativa de pedidos, 4 de cada vez).

## Parte 5 — Cópias do mesmo título
Aba **🎞️ Cópias** nas coleções do Studio: títulos com mais de um link; o automático ordena por critérios que você muda
(qualidade, dublado, https, abre mais rápido); empate vai para "Para olhar"; ★ Principal, subir/descer, desativar (fica em
`linksDesativados`, não vai para o app); Testar as cópias; Tocar lado a lado no mesmo ponto.

## Próximas fases
- Testador na nuvem (Cloudflare) para o Scan funcionar no Studio online.
- Cópias dos episódios de séries na aba Cópias.

Código: `core/linkedit-core.js` (leitura, limpeza, cópias, exportação — `test/linkedit.test.mjs`),
`tools/linkedit-rede.mjs` (teste de canal, túnel — `test/linkedit-rede.test.mjs`), `painel/linkedit.js` (tela).

## 🔗 Link Sidechain (envios que se mantêm sozinhos)
Botão **🔗 Sidechain** no topo do Link Edit. Cada **envio** é uma lista boa que vive atualizando:
- **Enviar para**: a coleção (Cartoons, Animes, Filmes, Séries, Desenhos 24H, Canais/TVzine, Rádios). No TVzine/rádios
  escolha **país · idioma** e a **categoria**: o país vai na fonte do Cloud (`pais` + `paisExclusivo`), então o canal
  **nunca** cai em outro país.
- **🔀 Sidechain**: abre a lista no próprio editor (prévia, filtros, Ctrl/Shift+clique). Cada linha mostra para onde vai.
  Marque e use **Enviar marcados para…** (Enter), **🚫 Ignorar** ou **↩ Voltar ao padrão**. O desvio é guardado pela
  chave do item (tvg-id ou nome limpo + país): a lista pode mudar de ordem ou de link e ele continua no lugar certo.
- **Regras** ("grupo contém *anime* → Animes"): escreva à mão ou aceite as sugestões 💡 que aparecem quando quase todo
  um grupo foi desviado para o mesmo lugar. O que chegar de novo com aquele grupo já vai sozinho.
- **Novidades**: 🤖 automático (o novo vai pela regra ou para o destino do envio) ou ✋ esperar eu revisar (o novo sem
  regra fica ⏳ até você decidir). O botão mostra 🔔 quando o robô achou itens novos; no editor, filtros
  🔔 Novos / ⏳ Esperando / Desviados e a etiqueta **NOVO** na linha.
- **🧪 Simular** mostra na hora para onde vai cada coisa; **💾 Salvar** grava `sidechain/envios.json`.

O robô (`.github/workflows/sidechain.yml` → `tools/sidechain.mjs`, a cada 6 h e logo depois de salvar) baixa cada
envio, aplica desvios e regras, testa canais/24H/rádios (morto sai; vídeo só se o envio pedir), junta cópias de envios
diferentes como reserva e publica `listas/sc-<coleção>[-<país>].json` (+ `.m3u`) e `listas/sidechain-fontes.json`.
**TMDB**: marque "Buscar capa, sinopse e nota no TMDB" no envio — o robô (secret `TMDB_TOKEN`) busca uma vez por série/filme
(guarda 30 dias) e manda capa, banner, sinopse, gênero, nota e classificação para o app. No painel: 🔎 TMDB na ficha, no
editor de vídeo (V) e no botão direito. **Tipo trocado**: canal ao vivo numa coleção de vídeo (ou o contrário) não entra
sozinho — fica "de outro tipo (esperando)" até você mandar pelo 🔀 Sidechain.
**Proteção** (por link): se a lista não abrir, vier vazia ou encolher mais da metade de uma vez, usa a última versão boa e avisa.
Relatório, histórico e o que cada envio já viu ficam em `sidechain/estado.json`.

**No Cloud (uma vez só)**: em `sources.json` → `fontesDoStudio`, a entrada
`{ "nome": "Cartoonzine Studio · Sidechain", "url": "https://raw.githubusercontent.com/cartoonzine/cartoonzine-studio/main/listas/sidechain-fontes.json", "colecoes": ["sidechain"] }`.
Daí em diante toda lista nova do Sidechain entra no catálogo sozinha.

### Assistente do envio (4 passos)

1. **Link** — cole o link e clique em 📥 Ler lista (mostra itens e grupos).
2. **Que lista é?** — 🎯 *Uma categoria só* (tudo vai para o mesmo lugar) ou 🔀 *Lista mista*.
3. **Rotas** — uma categoria: escolha a coleção (no TVzine, país + idioma).
   Lista mista: cada **grupo** (`group-title`) da lista vai por uma rota (🎬 Filmes, 📺 Séries, 🌸 Animes, 🎨 Cartoons, 🚫 Fica de fora…).
   As sugestões AUTO vêm do nome do grupo e do tipo dos itens; ✨ Aplicar sugestões monta o resto.
   Grupo que aparece depois na lista chega com 🔔 e espera você (ou vai pela sugestão, se você escolher).
4. **Conferir e salvar** — novidades, teste dos links, filtros, lista avulsa, TMDB.

A barra "Vai gerar" mostra quanto vai para cada coleção.
Clique no **nome de um grupo** na tabela para abrir só os itens dele no editor; "💾 Salvar grupo e voltar" grava e marca o grupo com ✓ (dá para revisar por partes).
No editor, **🖼 Ficha (F)** (botão na ficha ao lado, menu do botão direito ou tecla F) edita capa, banner, imagem e **posição do fundo do topo**, sinopse, gêneros, classificação e o banner da home (logo, vídeo, skin, efeito, destaque) — igual ao Novo das Coleções. Em episódio, marque "vale para a série toda": vale também para os episódios que chegarem depois. Em branco = automático (TMDB/lista).
**🔎 Completar pelo TMDB** (barra do 🔀, botão direito ou na ficha): para 1, vários ou todos os vídeos do grupo — capa, banner (fundo do topo e tela de prévia), logo PNG, sinopse, gêneros, classificação e IMDb (código + nota, com a chave omdb). "Só o que falta" mantém a thumb certa da lista; "Tudo do TMDB" troca tudo. Vai para a ficha (série toda nos episódios).
No passo 4, **Completar pelo TMDB/IMDb ao salvar** faz o robô fazer isso sozinho a cada rodada (secrets `TMDB_TOKEN` e `OMDB_KEY`).
**👁 Saída** (passo 4): uma aba por coleção de vídeo com os cards como vão chegar no app (capa; banner com logo ao passar o mouse; notas; episódios). Filtros "⚠ Falta algo", sem capa/banner/sinopse/logo; clique no card abre a 🖼 Ficha; marque cards (ou use o filtro) e 🔎 Completar pelo TMDB. Mostra também o que o robô já buscou no TMDB.
**🤖 Robô completa pelo TMDB**: "🤖 Completar agora" (passo 4) ou "Deixar com o robô" (janela do Completar) salva e chama o robô na hora — até 3.000 títulos por rodada, 6 ao mesmo tempo, no máximo 25 min; o resto vai na rodada seguinte. O passo 4 mostra o andamento e o 🔄 Atualizar traz o resultado para a Saída. No painel do PC, faça o commit/push para o robô começar.
**📋 Lista pronta (com dados do TMDB):** uma lista em JSON no formato do DB oficial (`title`, `url`, `mirrors`, `tmdbId`+`tmdbTipo`, `imdbId`, `thumb`, `bannerThumb`, `previewThumb`, `logo`, `desc`, `genre`, `age`, `runtime`, `rating`, `audios`, `qualidadeMax`; episódio com `serie`, `season`, `episode`) entra com tudo isso. Com o `tmdbId` o robô busca pela obra exata (sem chute) e só completa o que faltar. No M3U dá para mandar `tvg-tmdb="603"`. Listas comuns continuam funcionando igual.
Só as **exceções** (o filme que caiu no grupo errado) ficam guardadas item por item no 🔀 Sidechain.
Envios antigos viram "uma categoria" e os desvios iguais ao destino do envio são apagados (não mudavam nada).

Precedência: exceção do item > regras > rota do grupo (mista) ou destino (uma categoria).

## 🎬 Tipo do item e dados de vídeo
Cada item ganha o **tipo**, descoberto sozinho pelo link e pelo nome: 📺 canal ao vivo · 🎬 filme/vídeo · 🎞 episódio de
série · 📻 rádio (ícone na linha; clique ou **Y** para trocar). Filtro **Tipo de item** na esquerda.
Vídeo mostra o que o DB usa, no lugar de categoria/idioma/guia: **série, temporada, episódio, título, ano, áudio
(dublado/legendado/dual), qualidade, gênero e a coleção** (Cartoons, Animes, Filmes, Séries…). Detecta "S01E03",
"1x03", "T1E3", "Temporada 1 Episódio 3", "Episódio 3", "(1999)", "Dublado", "1080p"… e sugere a coleção pelo grupo.
**V** (ou o grupo/áudio da linha, ou "✎ Editar dados") abre o editor — com vários marcados, campo em branco não muda
e dá para **numerar os episódios** na ordem da lista. **🔎 Detectar** volta ao automático. O que você arruma vence a
detecção, vai no JSON exportado (`title`, `year`, `serie`, `season`, `episode`, `audios`, `qualidadeMax`), no
importador de filmes/séries e, no Sidechain, fica guardado no envio (`ajustes`) e o robô repete a cada rodada.

## Mais ferramentas
- **📂 Séries** (barra da tabela): cada série com temporadas e episódios; avisa buracos na numeração, episódios
  repetidos e sem número. Marcar, editar (V) e TMDB por série.
- **✎ Nomes**: arrumar em lote (procurar/trocar, regex, tirar prefixo de país "BR |", tirar [tags]/HD, Maiúsculas
  Só No Começo com as siglas mantidas), com prévia. No Sidechain fica salvo no envio.
- **Já na Studio**: etiqueta na linha e filtro para o que já está cadastrado à mão; no Sidechain, "Não repetir o que já
  está na Studio" (ligado por padrão) — o robô lê `dist/indice-painel.json`.
- **Regras**: várias palavras ("anime | otaku"), condições (tipo do item, idioma, país), prioridade (▲▼), ligar/desligar
  e **⚙ Regras para todos os envios** (`regrasGlobais` no envios.json, valem depois das de cada envio).
- **Saúde do envio**: barrinhas das últimas 30 rodadas (enviados, mortos, lista com problema), aviso ⚠ quando a lista
  cai, e o que **saiu** e o que **mudou de link** desde a rodada anterior.
- **☁️ Testador na nuvem** (`tools/testador-nuvem/`): Scan, ⚡ Testar e "Abrir link" com o Studio online, sem o painel
  do PC. Cloudflare Workers grátis; passo a passo no LEIAME da pasta. Configure em Scan → ☁️.
