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
Aba **🎬 Filmes e séries** na mesma janela:
- Entram arquivos (mp4, mkv…), torrents e links `/movie/` `/series/` do Xtream; lista de filmes em .m3u8 → "tratar todos como filme/série".
- **Episódios** (S01E02, 1x02, Episódio 2) viram **uma série com temporadas**; **cópias** do mesmo filme (nome + ano) viram um item com as outras de reserva.
- **Destino pelo tipo:** Animes, Cartoons (desenho/infantil), Séries, Filmes (torrent → Filmes torrent); trocável por linha.
- **🔎 Completar no TMDB (só o que falta):** capa, banner, sinopse, ano, gêneros e episódios — nunca troca o que já tem (sem chave do TMDB usa a Wikipedia).
- Já existe no Studio (mesmo nome na coleção) → junta: episódios novos na temporada certa, links novos de reserva.

## Próximas fases
2. Tela de Scan com gráfico de tempo de abertura e ações em massa; quarentena com reteste automático.
3. Receitas (listas que se refazem sozinhas no robô do Cloud) e envio direto para o Cloud (`sources-idioma.json`).
4. Importador do Studio (listas → Filmes, Séries, Animes, Cartoons, Desenhos 24H, com TMDB só onde falta).
5. Cópias do mesmo título (filmes/séries) com comparação lado a lado.

Código: `core/linkedit-core.js` (leitura, limpeza, cópias, exportação — `test/linkedit.test.mjs`),
`tools/linkedit-rede.mjs` (teste de canal, túnel — `test/linkedit-rede.test.mjs`), `painel/linkedit.js` (tela).
