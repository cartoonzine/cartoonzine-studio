// Testes do núcleo: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core/studio-core.js');
const config = JSON.parse(require('node:fs').readFileSync(new URL('../studio.config.json', import.meta.url)));
const col = id => config.colecoes.find(c => c.id === id);

test('slug', () => {
    assert.equal(C.slugify('Caverna do Dragão!'), 'caverna-do-dragao');
    assert.equal(C.slugify('Tom & Jerry'), 'tom-e-jerry');
    assert.equal(C.slugify('   '), 'item');
});

test('nomes de arquivo viram série/temporada/episódio', () => {
    const casos = [
        ['Naruto S01E03 Dublado 720p.mp4', { serie: 'Naruto', temporada: 1, episodio: 3, audio: 'Dublado' }],
        ['Caverna do Dragão - 1x05 - O Vale dos Unicórnios.mkv', { serie: 'Caverna do Dragão', temporada: 1, episodio: 5, tituloEpisodio: 'O Vale dos Unicórnios' }],
        ['Pica-Pau T2E10.mp4', { serie: 'Pica-Pau', temporada: 2, episodio: 10 }],
        ['Dragon Ball Episódio 12', { serie: 'Dragon Ball', temporada: 1, episodio: 12 }],
        ['Os.Simpsons.S10E02.WEB-DL.1080p.mkv', { serie: 'Os Simpsons', temporada: 10, episodio: 2 }],
        ['Cavaleiros do Zodiaco - Temporada 2 Episodio 7.mp4', { serie: 'Cavaleiros do Zodiaco', temporada: 2, episodio: 7 }],
    ];
    for (const [nome, esperado] of casos) {
        const r = C.analisarNome(nome);
        for (const [k, v] of Object.entries(esperado)) assert.equal(r[k], v, `${nome} -> ${k}`);
    }
    const filme = C.analisarNome('Popeye o Marinheiro (1933).mp4');
    assert.equal(filme.nome, 'Popeye o Marinheiro');
    assert.equal(filme.ano, 1933);
    assert.equal(filme.serie, undefined);
});

test('mensagem do @CZStreamBot vira item com o link direto (sem o /watch/)', () => {
    const msg = `✨ Your Links are Ready! ✨

Caverna do Dragão S01E02.mp4

📂 File Size: 212.4 MB

🚀 Download Link:
https://czstreambot.onrender.com/AgADxx123/Caverna%20do%20Drag%C3%A3o%20S01E02.mp4

🖥️ Stream Link:
https://czstreambot.onrender.com/watch/AgADxx123/Caverna%20do%20Drag%C3%A3o%20S01E02.mp4

⌛️ Note: Links remain active while the bot is running and the file is accessible.`;
    const e = C.lerTextoColado(msg);
    assert.equal(e.length, 1);
    assert.equal(e[0].serie, 'Caverna do Dragão');
    assert.equal(e[0].episodio, 2);
    assert.ok(!e[0].links[0].includes('/watch/'));
});

test('texto misto: "nome | link", links soltos e episódios agrupados', () => {
    const t = `Pica-Pau 24h | https://exemplo.tv/picapau/index.m3u8 | https://img.exemplo.tv/picapau.png
https://cdn.exemplo.com/videos/Naruto%20S01E01.mp4
https://cdn.exemplo.com/videos/Naruto%20S01E02.mp4
Popeye - https://cdn.exemplo.com/popeye.mp4`;
    const entradas = C.lerTextoColado(t);
    assert.equal(entradas.length, 4);
    assert.equal(entradas[0].nome, 'Pica-Pau 24h');
    assert.equal(entradas[0].capa, 'https://img.exemplo.tv/picapau.png');
    assert.equal(entradas[3].nome, 'Popeye');
    const itens = C.agruparEntradas(entradas);
    assert.equal(itens.length, 3);
    const naruto = itens.find(i => i.nome === 'Naruto');
    assert.equal(naruto.temporadas[0].episodios.length, 2);
});

test('M3U colado vira canais com país, idioma, categoria e headers', () => {
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="TVCultura.br" tvg-logo="https://l.exemplo/cultura.png" tvg-country="BR" tvg-language="Português" group-title="Educativo",TV Cultura
#EXTVLCOPT:http-user-agent=Mozilla/5.0
https://stream.exemplo/cultura.m3u8`;
    const itens = C.agruparEntradas(C.lerTextoColado(m3u));
    assert.equal(itens.length, 1);
    const n = C.normalizarItem(itens[0], col('canais'));
    assert.equal(n.pais, 'BR');
    assert.equal(n.categoria, 'Educativo');
    assert.equal(n.userAgent, 'Mozilla/5.0');
});

test('Internet Archive: vários vídeos viram série; derivados duplicados somem', () => {
    const meta = {
        metadata: { identifier: 'popeye-colecao', title: 'Popeye Classics', year: '1936', subject: ['cartoon', 'animation'], description: '<p>Desenhos clássicos</p>' },
        files: [
            { name: 'Popeye_S01E01.mp4' }, { name: 'Popeye_S01E01.ogv' }, { name: 'Popeye_S01E01_512kb.mp4' },
            { name: 'Popeye_S01E02.mp4' }, { name: 'capa.jpg' }
        ]
    };
    const item = C.itemDoArchive(meta, 'popeye-colecao');
    assert.equal(item.nome, 'Popeye Classics');
    assert.equal(item.ano, 1936);
    assert.equal(item.descricao, 'Desenhos clássicos');
    assert.equal(item.temporadas[0].episodios.length, 2);
    assert.match(item.temporadas[0].episodios[0].links[0], /^https:\/\/archive\.org\/download\/popeye-colecao\/Popeye_S01E01\.mp4$/);
});

test('validação aponta o que falta', () => {
    const r = C.validarItem(C.normalizarItem({ nome: 'Canal X', links: ['nao-e-link'] }, col('canais')), col('canais'), config);
    assert.ok(r.erros.some(e => /inválido/.test(e)));
    assert.ok(r.erros.some(e => /País/.test(e)));
    const jogo = C.validarItem(C.normalizarItem({ nome: 'Sonic', console: 'playstation9', links: ['https://x.com/s.zip'] }, col('jogos')), col('jogos'), config);
    assert.ok(jogo.erros.some(e => /Console desconhecido/.test(e)));
});

test('compilar: jogos por console e fontes do cloud com URL fixa', () => {
    const r = C.compilarColecao(col('jogos'), [
        { caminho: 'conteudo/jogos/megadrive/sonic.json', item: { nome: 'Sonic', console: 'megadrive', links: ['https://roms.exemplo/sonic.zip'] } },
        { caminho: 'conteudo/jogos/nes/x.json', item: { nome: 'Sem link', console: 'nes' } }
    ], config);
    const md = JSON.parse(r.arquivos['jogos/megadrive.json']);
    assert.equal(md.games.length, 1);
    assert.equal(md.games[0].title, 'Sonic');
    assert.equal(r.relatorio.erros.length, 1);
    const f = r.fontes.find(x => x.console === 'megadrive');
    assert.equal(f.tipo, 'emulator_json');
    assert.equal(f.url, config.publicacao.baseUrl + 'jogos/megadrive.json');
});

test('compilar: série vira seasons/episodes que o cloud entende', () => {
    const r = C.compilarColecao(col('cartoons'), [
        { caminho: 'conteudo/cartoons/caverna.json', item: { nome: 'Caverna do Dragão', temporadas: [{ numero: 1, episodios: [{ numero: 1, links: ['https://a.b/1.mp4', 'https://c.d/1.mp4'] }] }] } }
    ], config);
    const j = JSON.parse(r.arquivos['cartoons.json']);
    assert.equal(j.items[0].seasons[0].episodes[0].url, 'https://a.b/1.mp4');
    assert.deepEqual(j.items[0].seasons[0].episodes[0].reservas, ['https://c.d/1.mp4']);
});

test('caminho do item usa subpasta (país/console)', () => {
    assert.equal(C.caminhoItem(col('canais'), { nome: 'TV Cultura', pais: 'BR' }), 'conteudo/canais/br/tv-cultura.json');
    assert.equal(C.caminhoItem(col('jogos'), { nome: 'Sonic 2', console: 'megadrive' }), 'conteudo/jogos/megadrive/sonic-2.json');
    assert.equal(C.caminhoItem(col('cartoons'), { nome: 'Popeye' }), 'conteudo/cartoons/popeye.json');
});

test('M3U misturado com "Nome | link" no mesmo texto', () => {
    const e = C.lerTextoColado('#EXTM3U\n#EXTINF:-1 group-title="Sports",Esporte X\nhttps://s.exemplo.com/x.m3u8\nCanal Y | https://s.exemplo.com/y.m3u8');
    assert.deepEqual(e.map(x => x.nome), ['Esporte X', 'Canal Y']);
});

test('arquivo só com S02E01 guarda temporada/episódio', () => {
    const r = C.analisarNome('s02e01.mp4');
    assert.equal(r.temporada, 2);
    assert.equal(r.episodio, 1);
    assert.equal(r.serie, undefined);
});

test('mesclar: episódios novos entram, links viram reserva, nada some', () => {
    const a = { nome: 'X', descricao: 'manual', temporadas: [{ numero: 1, episodios: [{ numero: 1, links: ['https://a.b/1'] }] }] };
    const b = { nome: 'X', descricao: 'da wiki', capa: 'https://c.d/c.jpg', temporadas: [{ numero: 1, episodios: [{ numero: 1, links: ['https://m.b/1'] }, { numero: 2, links: ['https://a.b/2'] }] }] };
    const m = C.mesclarItem(a, b);
    assert.equal(m.descricao, 'manual');
    assert.equal(m.capa, 'https://c.d/c.jpg');
    assert.deepEqual(m.temporadas[0].episodios.map(e => e.links.length), [2, 1]);
});

test('categoria em inglês vira a do TVzine', () => {
    assert.equal(C.traduzirCategoria('News;Sports'), 'Notícias');
    assert.equal(C.traduzirCategoria('Undefined'), undefined);
    assert.equal(C.traduzirCategoria('Anime'), 'Anime');
});

// ---------- TMDB / IMDb (respostas simuladas) ----------
function fetchFalso(rotas, log = []) {
    return async (url, init = {}) => {
        log.push({ url, auth: init.headers && init.headers.Authorization });
        const u = new URL(url);
        const chave = u.hostname + u.pathname + (u.searchParams.get('language') ? '|' + u.searchParams.get('language') : '');
        const achou = Object.entries(rotas).find(([k]) => chave.startsWith(k) || chave === k);
        if (!achou) return { ok: false, status: 404, json: async () => ({}) };
        const corpo = typeof achou[1] === 'function' ? achou[1](u) : achou[1];
        return { ok: true, status: 200, json: async () => corpo };
    };
}
const TOKEN_V4 = 'eyJ' + 'x'.repeat(60);

test('links do TMDB/IMDb colados viram referência, não vídeo', () => {
    const e = C.lerTextoColado(`https://www.themoviedb.org/tv/230050-alguma-serie/season/2/episode/1
https://cdn.exemplo.com/Serie%20X%20S02E01.mp4
https://cdn.exemplo.com/Serie%20X%20S02E02.mp4

Filme Y | https://www.imdb.com/title/tt28313387/ | https://cdn.exemplo.com/y.mp4`);
    assert.equal(e.length, 3);
    assert.equal(e[0].tmdb, 'tv/230050');
    assert.equal(e[1].tmdb, 'tv/230050');
    assert.equal(e[2].imdb, 'tt28313387');
    assert.equal(e[2].nome, 'Filme Y');
    assert.deepEqual(e[2].links, ['https://cdn.exemplo.com/y.mp4']);
    const itens = C.agruparEntradas(e);
    assert.equal(itens[0].tmdb, 'tv/230050');
    const n = C.normalizarItem({ nome: 'Z', links: ['https://www.imdb.com/title/tt0111161/', 'https://v.exemplo.com/z.mp4'] }, col('filmes'));
    assert.equal(n.imdb, 'tt0111161');
    assert.deepEqual(n.links, ['https://v.exemplo.com/z.mp4']);
});

test('TMDB: série pelo ID do IMDb, sinopse pt-BR e episódios', async () => {
    const log = [];
    const f = fetchFalso({
        'api.themoviedb.org/3/find/tt28313387': { tv_results: [{ id: 230050 }], movie_results: [] },
        'api.themoviedb.org/3/tv/230050/season/2': { episodes: [
            { episode_number: 1, name: 'O Retorno', overview: 'Sinopse do ep 1', still_path: '/ep1.jpg' },
            { episode_number: 2, name: 'Episódio 2', overview: '', still_path: null }] },
        'api.themoviedb.org/3/tv/230050': { name: 'Série X', overview: 'Sinopse em português', poster_path: '/p.jpg', backdrop_path: '/b.jpg',
            first_air_date: '2023-05-01', genres: [{ name: 'Animação' }], external_ids: { imdb_id: 'tt28313387' } },
    }, log);
    const item = { nome: 'serie x', imdb: 'tt28313387', descricao: 'minha sinopse', temporadas: [{ numero: 2, episodios: [{ numero: 1, links: ['https://a.b/1.mp4'] }, { numero: 2, links: ['https://a.b/2.mp4'] }] }] };
    const r = await C.completarItem(item, { tmdb: TOKEN_V4, fetchFn: f });
    assert.equal(r.item.descricao, 'minha sinopse', 'não sobrescreve o que já existe');
    assert.equal(r.item.capa, 'https://image.tmdb.org/t/p/w500/p.jpg');
    assert.equal(r.item.ano, 2023);
    assert.equal(r.item.tmdb, 'tv/230050');
    const [e1, e2] = r.item.temporadas[0].episodios;
    assert.equal(e1.titulo, 'O Retorno');
    assert.equal(e1.capa, 'https://image.tmdb.org/t/p/w300/ep1.jpg');
    assert.equal(e2.titulo, undefined, 'ignora o título genérico "Episódio 2"');
    assert.ok(log.every(l => l.auth === 'Bearer ' + TOKEN_V4), 'token longo vai no cabeçalho');
    assert.ok(r.achados[0].includes('Série X'));
});

test('TMDB: filme pelo nome + ano, chave curta vai como api_key; nota do IMDb pelo OMDb', async () => {
    const log = [];
    const f = fetchFalso({
        'api.themoviedb.org/3/search/movie': u => ({ results: u.searchParams.get('year') === '1922' ? [{ id: 653 }] : [] }),
        'api.themoviedb.org/3/movie/653|pt-BR': { title: 'Nosferatu', overview: '', poster_path: '/n.jpg', release_date: '1922-03-04', genres: [{ name: 'Terror' }], imdb_id: 'tt0013442' },
        'api.themoviedb.org/3/movie/653|en-US': { overview: 'English overview' },
        'www.omdbapi.com/': { Response: 'True', imdbRating: '7.8', imdbVotes: '112,345' }
    }, log);
    const r = await C.completarItem({ nome: 'Nosferatu', ano: 1922, links: ['https://v.exemplo.com/n.mp4'] }, { tmdb: 'a'.repeat(32), omdb: 'k123', fetchFn: f });
    assert.equal(r.item.descricao, 'English overview', 'sem sinopse em pt-BR usa a em inglês');
    assert.equal(r.item.imdb, 'tt0013442');
    assert.equal(r.item.notaImdb, 7.8);
    assert.equal(r.item.votosImdb, 112345);
    assert.ok(r.avisos.some(a => /confira/.test(a)), 'avisa que foi achado pelo nome');
    assert.ok(log.some(l => l.url.includes('api_key=' + 'a'.repeat(32))));
    const nuvem = C.paraCloud(C.normalizarItem(r.item, col('filmes')), col('filmes'), 'filmes/nosferatu');
    assert.equal(nuvem.imdbRating, 7.8);
    assert.equal(nuvem.imdbId, 'tt0013442');
});

test('TMDB: chave errada vira aviso, não quebra', async () => {
    const f = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const r = await C.completarItem({ nome: 'X', links: ['https://a.b/x.mp4'] }, { tmdb: 'errada', fetchFn: f });
    assert.equal(r.item.nome, 'X');
    assert.ok(r.avisos.some(a => /inválida/.test(a)));
});

test('canais: uma lista por país + índice para o seletor do TVzine', () => {
    const r = C.compilarColecao(col('canais'), [
        { caminho: 'conteudo/canais/br/a.json', item: { nome: 'A', links: ['https://s.exemplo.com/a.m3u8'], pais: 'BR', idioma: 'Português', categoria: 'Notícias' } },
        { caminho: 'conteudo/canais/br/b.json', item: { nome: 'B', links: ['https://s.exemplo.com/b.m3u8'], pais: 'BR', categoria: 'Infantil' } },
        { caminho: 'conteudo/canais/jp/c.json', item: { nome: 'C', links: ['https://s.exemplo.com/c.m3u8'], pais: 'JP', idioma: 'Japonês', categoria: 'Infantil' } }
    ], config);
    const idx = JSON.parse(r.arquivos['canais/paises.json']).paises;
    assert.deepEqual(idx.map(p => p.codigo), ['BR', 'JP']);
    assert.equal(idx[0].bandeira, '🇧🇷');
    assert.equal(idx[0].total, 2);
    assert.deepEqual(idx[0].categorias, { 'Notícias': 1, 'Infantil': 1 });
    assert.equal(idx[1].json, config.publicacao.baseUrl + 'canais/pais/jp.json');
    assert.equal(JSON.parse(r.arquivos['canais/pais/br.json']).channels.length, 2);
    assert.ok(r.arquivos['canais/pais/jp.m3u'].includes('tvg-country="JP"'));
});

test('nome do TMDB corrige acentos, mas não troca um nome diferente que você escolheu', () => {
    assert.equal(C.aplicarDadosExternos({ nome: 'Serie X' }, { nome: 'Série X' }).nome, 'Série X');
    assert.equal(C.aplicarDadosExternos({ nome: 'Meu Nome' }, { nome: 'Série X' }).nome, 'Meu Nome');
});

test('Internet Archive em coleção torrent: vira UM filme com o .torrent oficial e o vídeo de reserva', () => {
    const meta = {
        metadata: { identifier: 'golem-1920', title: 'The Golem (1920)', year: '1920' },
        files: [
            { name: 'The Golem (1920).mkv' }, { name: 'The Golem (1920).mp4' },
            { name: 'golem-1920_archive.torrent', format: 'Archive BitTorrent' }, { name: 'parte2.mp4' }
        ]
    };
    const item = C.itemDoArchive(meta, 'golem-1920', { torrent: true });
    assert.equal(item.temporadas, undefined);
    assert.equal(item.links[0], 'https://archive.org/download/golem-1920/golem-1920_archive.torrent');
    assert.match(item.links[1], /\.mp4$/);
    // sem torrent no item: continua como antes
    const sem = C.itemDoArchive({ metadata: { identifier: 'x' }, files: [{ name: 'a.mp4' }] }, 'x', { torrent: true });
    assert.equal(sem.links[0], 'https://archive.org/download/x/a.mp4');
    // magnet é link válido na coleção de filmes torrent
    const tor = config.colecoes.find(c => c.id === 'filmes-torrent');
    const v = C.validarItem(C.normalizarItem({ nome: 'Nosferatu', links: ['magnet:?xt=urn:btih:abc&dn=Nosferatu'] }, tor), tor, config);
    assert.deepEqual(v.erros, []);
});

test('YouToon: idioma vai para o app e a fonte é JSON ao vivo no Desenhos 24H', () => {
    const yt = config.colecoes.find(c => c.id === 'youtoon');
    const r = C.compilarColecao(yt, [{ caminho: 'conteudo/youtoon/bluey-24h.json', item: { nome: 'Bluey 24H', links: ['https://www.youtube.com/embed/OBe-ehVPKKk'], idioma: 'Espanhol', generos: ['Pré-escolar'] } }], config);
    const j = JSON.parse(r.arquivos['youtoon.json']);
    assert.equal(j.channels[0].idioma, 'Espanhol');
    assert.equal(j.channels[0].group, 'Desenhos 24H');
    assert.equal(r.fontes[0].tipo, 'vod_json');
    assert.equal(r.fontes[0].categoryType, 'live');
    assert.match(r.fontes[0].url, /youtoon\.json$/);
});
