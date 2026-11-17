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

## Próximas fases
2. Tela de Scan com gráfico de tempo de abertura e ações em massa; quarentena com reteste automático.
3. Receitas (listas que se refazem sozinhas no robô do Cloud) e envio direto para o Cloud (`sources-idioma.json`).
4. Importador do Studio (listas → Filmes, Séries, Animes, Cartoons, Desenhos 24H, com TMDB só onde falta).
5. Cópias do mesmo título (filmes/séries) com comparação lado a lado.

Código: `core/linkedit-core.js` (leitura, limpeza, cópias, exportação — `test/linkedit.test.mjs`),
`tools/linkedit-rede.mjs` (teste de canal, túnel — `test/linkedit-rede.test.mjs`), `painel/linkedit.js` (tela).
