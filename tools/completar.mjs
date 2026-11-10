#!/usr/bin/env node
/**
 * Completa o que já está cadastrado: sinopse, capas, episódios (TMDB) e nota do IMDb (OMDb).
 * Nunca apaga nem troca o que você escreveu; só preenche o que está vazio
 * (a nota do IMDb é a exceção: ela é atualizada, porque muda com o tempo).
 *
 *   node tools/completar.mjs                       itens sem sinopse/capa de todas as coleções de vídeo
 *   node tools/completar.mjs --colecao animes
 *   node tools/completar.mjs --notas               só atualiza as notas do IMDb
 *   node tools/completar.mjs --limite 50 --simular
 *
 * Precisa das chaves nas variáveis TMDB_TOKEN e/ou OMDB_KEY
 * (no GitHub: Settings → Secrets and variables → Actions). Sem TMDB_TOKEN usa a Wikipedia.
 *
 * JOGOS: com STEAMGRID_KEY e/ou SS_DEV_ID + SS_DEV_PASSWORD + SS_USER + SS_PASSWORD
 * (ScreenScraper), busca o LOGO (e o vídeo snap) dos jogos que ainda não têm.
 *   node tools/completar.mjs --jogos               só os jogos
 */
import fs from 'node:fs';
import path from 'node:path';
import { Core, RAIZ, lerConfig, lerColecao, lerArgs, chavesExternas } from './lib.mjs';

const args = lerArgs(process.argv.slice(2));
const config = lerConfig();
const ch = chavesExternas();
const limite = parseInt(args.limite || '150', 10);
const soNotas = !!args.notas;
const soJogos = !!args.jogos;
const temChaveJogo = !!(ch.steamgrid || ch.screenscraper);

if (soNotas && !ch.omdb) { console.log('Sem OMDB_KEY: nada a fazer com --notas.'); process.exit(0); }
if (!ch.tmdb && !soJogos) console.log('ℹ Sem TMDB_TOKEN: vou usar a Wikipedia (só sinopse e capa).');
if (!temChaveJogo) console.log('ℹ Sem STEAMGRID_KEY / SS_DEV_ID: os logos dos jogos ficam como estão.');

const fila = [];
for (const colecao of config.colecoes) {
    if (args.colecao && args.colecao !== colecao.id) continue;
    // jogos: só o logo / vídeo snap (SteamGridDB · ScreenScraper)
    if (colecao.tipo === 'jogo') {
        if (!soJogos || !temChaveJogo) continue;   // jogos só com --jogos (não disputam o lote dos vídeos)
        for (const { caminho, item } of lerColecao(colecao).entradas) {
            if (item._travado || item._semLogo) continue;
            const n = Core.normalizarItem(item, colecao);
            if (n.nome && (!n.logo || (ch.screenscraper && !n.video))) fila.push({ caminho, colecao, item: n });
        }
        continue;
    }
    if (colecao.tipo !== 'video' || soJogos) continue;
    for (const { caminho, item } of lerColecao(colecao).entradas) {
        if (item._travado) continue;
        const n = Core.normalizarItem(item, colecao);
        const falta = !n.descricao || !n.capa || !n.banner || (ch.tmdb && !n.tmdb) ||
            (n.temporadas || []).some(t => t.episodios.some(e => !e.titulo && !e.descricao));
        const precisaNota = ch.omdb && n.imdb;
        if (soNotas ? precisaNota : (falta || (args.tudo && true))) fila.push({ caminho, colecao, item: n });
    }
}
// os que nunca foram completados primeiro
fila.sort((a, b) => (a.item._completadoEm || '').localeCompare(b.item._completadoEm || ''));
const lote = fila.slice(0, limite);
console.log(`${fila.length} itens para completar; vou fazer ${lote.length} agora.`);

let mudou = 0;
for (const { caminho, colecao, item } of lote) {
    const r = soNotas
        ? await Core.completarItem({ imdb: item.imdb }, { omdb: ch.omdb }).then(x => ({ ...x, item: Core.aplicarDadosExternos(item, { notaImdb: x.item.notaImdb, votosImdb: x.item.votosImdb }) }))
        : colecao.tipo === 'jogo'
            ? await Core.completarItem(item, { steamgrid: ch.steamgrid, screenscraper: ch.screenscraper, tipoColecao: 'jogo' })
            : await Core.completarItem(item, { tmdb: ch.tmdb, omdb: ch.omdb, wiki: true, tipoColecao: colecao.tipo });
    const novo = Core.normalizarItem(Object.assign(r.item, { _completadoEm: new Date().toISOString().slice(0, 10) }), colecao);
    const antes = JSON.stringify(Object.assign({}, item, { _completadoEm: undefined }));
    const depois = JSON.stringify(Object.assign({}, novo, { _completadoEm: undefined }));
    const msg = r.achados.concat(r.avisos.map(a => '⚠ ' + a)).join(' · ') || 'nada novo';
    console.log(`${antes !== depois ? '✅' : '·'} ${caminho}  ${msg}`);
    if (!args.simular) {
        fs.writeFileSync(path.join(RAIZ, caminho), Core.serializar(novo));
        if (antes !== depois) mudou++;
    }
    await new Promise(ok => setTimeout(ok, 120)); // educado com as APIs
}
console.log(`\n${mudou} itens ganharam dados novos` + (args.simular ? ' (simulação, nada salvo)' : ''));
