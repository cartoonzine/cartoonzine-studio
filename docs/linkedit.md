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

## Parte 3 — Receitas (listas que se refazem sozinhas)
Botão **📋 Receitas**: de onde pegar (links) + que canais entram (idioma, tipo, categoria, país, nome, só vivos, confiança mínima,
fora Adulto). "Rodar agora aqui" monta na hora; "Salvar" grava `receitas/receitas.json`. O robô do GitHub
(`.github/workflows/receitas.yml` → `tools/receitas.mjs`) refaz a cada 6 h: testa, tira os mortos, a reserva viva assume, e publica
`listas/<id>.json` (com reservas — é este que vai no Cloud) e `listas/<id>.m3u`. Histórico dos testes em `receitas/estado.json`.

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
**Proteção**: se a lista não abrir, vier vazia ou encolher mais da metade de uma vez, usa a última versão boa e avisa.
Relatório, histórico e o que cada envio já viu ficam em `sidechain/estado.json`.

**No Cloud (uma vez só)**: em `sources.json` → `fontesDoStudio`, a entrada
`{ "nome": "Cartoonzine Studio · Sidechain", "url": "https://raw.githubusercontent.com/cartoonzine/cartoonzine-studio/main/listas/sidechain-fontes.json", "colecoes": ["sidechain"] }`.
Daí em diante toda lista nova do Sidechain entra no catálogo sozinha.
