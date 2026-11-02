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

test('YouToon: uma lista e uma fonte do cloud por idioma (sem idioma = Português)', () => {
    const yt = config.colecoes.find(c => c.id === 'youtoon');
    const r = C.compilarColecao(yt, [
        { caminho: 'conteudo/youtoon/portugues/bluey-24h.json', item: { nome: 'Bluey 24H', links: ['https://www.youtube.com/embed/OBe-ehVPKKk'], generos: ['Pré-escolar'] } },
        { caminho: 'conteudo/youtoon/espanhol/caricaturas.json', item: { nome: 'Caricaturas', links: ['https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/live'], idioma: 'Espanhol' } },
        { caminho: 'conteudo/youtoon/frances/x.json', item: { nome: 'Dessins', links: ['https://www.youtube.com/watch?v=abcdefghijk'], idioma: 'Francês' } }
    ], config);
    const pt = JSON.parse(r.arquivos['youtoon/pt-br.json']), es = JSON.parse(r.arquivos['youtoon/es.json']);
    assert.equal(pt.channels.length, 1); assert.equal(pt.channels[0].idioma, 'pt-BR');
    assert.equal(es.channels.length, 1); assert.equal(es.channels[0].idioma, 'es');
    assert.equal(JSON.parse(r.arquivos['youtoon/en.json']).channels.length, 0);       // publicada mesmo vazia
    assert.equal(JSON.parse(r.arquivos['youtoon/pt-pt.json']).channels.length, 0);
    assert.equal(r.fontes.length, 4);
    const fes = r.fontes.find(f => f.idioma === 'es');
    assert.equal(fes.prefixoId, 'YTN_ES'); assert.equal(fes.categoryType, 'live'); assert.equal(fes.targetCategory, 'Desenhos 24H');
    assert.match(fes.url, /youtoon\/es\.json$/);
    assert.ok(r.relatorio.avisos.some(a => /Francês/.test(a.msg)));                   // idioma sem lista avisa
    assert.equal(JSON.parse(r.arquivos['youtoon/idiomas.json']).idiomas.length, 4);
    assert.equal(C.caminhoItem(yt, { nome: 'Bluey 24H' }), 'conteudo/youtoon/portugues/bluey-24h.json');
});

test('Bookzine: livro com formato pela extensão, estante e índice', () => {
    const bz = config.colecoes.find(c => c.id === 'bookzine');
    const r = C.compilarColecao(bz, [
        { caminho: 'conteudo/bookzine/dom-casmurro.json', item: { nome: 'Dom Casmurro', autor: 'Machado de Assis', links: ['https://x.org/dom.epub'], categoria: 'Clássicos da Literatura', idioma: 'Português', paginas: '256' } },
        { caminho: 'conteudo/bookzine/tex-1.json', item: { nome: 'Tex 1', links: ['https://x.org/tex1.cbz', 'https://x.org/tex1.pdf'], serie: 'Tex', volume: 1 } }
    ], config);
    const j = JSON.parse(r.arquivos['bookzine.json']);
    const dom = j.items.find(i => i.title === 'Dom Casmurro'), tex = j.items.find(i => i.title === 'Tex 1');
    assert.equal(dom.format, 'EPUB'); assert.equal(dom.author, 'Machado de Assis'); assert.equal(dom.pages, 256); assert.equal(dom.categoryType, 'livro');
    assert.equal(tex.format, 'CBZ'); assert.equal(tex.series, 'Tex'); assert.equal(tex.volume, 1); assert.equal(tex.category, 'Livros');
    assert.deepEqual(tex.mirrors, ['https://x.org/tex1.pdf']);
    assert.deepEqual(r.fontes, []);                                                    // fora do cloud até a view existir
    const ind = JSON.parse(r.arquivos['bookzine/indice.json']);
    assert.equal(ind.formatos.EPUB, 1); assert.equal(ind.estantes['Clássicos da Literatura'], 1);
    assert.equal(C.normalizarItem({ nome: 'Tex 1.cbz' }, bz).nome, 'Tex 1.cbz');      // o nome digitado não é mexido
    assert.equal(C.analisarNome('Tex 001.cbz').nome, 'Tex 001');
});

test('Internet Archive em coleção de livros: melhor arquivo de leitura + reserva', () => {
    const biblia = C.itemDoArchive({
        metadata: { identifier: 'biblia1569', title: 'Biblia de Casiodoro de Reina 1569', creator: 'Casiodoro de Reina', date: '1569', language: 'spa' },
        files: [{ name: 'Biblia 1569.djvu' }, { name: 'Biblia 1569.epub' }, { name: 'Biblia 1569.pdf' }, { name: 'Biblia 1569_djvu.txt' }, { name: 'Biblia 1569_jp2.zip' }]
    }, 'biblia1569', { livro: true });
    assert.match(biblia.links[0], /Biblia%201569\.pdf$/); assert.match(biblia.links[1], /\.epub$/);
    assert.equal(biblia.idioma, 'Espanhol'); assert.equal(biblia.ano, 1569); assert.equal(biblia.autor, 'Casiodoro de Reina');
    const gut = C.itemDoArchive({ metadata: { identifier: 'g1', title: 'O Crime do Padre Amaro', language: 'Portuguese' },
        files: [{ name: '31971-8.txt' }, { name: 'pg31971.epub' }, { name: 'pg31971-images.epub' }, { name: 'pg31971.txt_meta.txt' }] }, 'g1', { livro: true });
    assert.match(gut.links[0], /pg31971-images\.epub$/); assert.match(gut.links[1], /\.txt$/); assert.equal(gut.idioma, 'Português');
});

test('Vitrine: destaqueOrdem só com destaque, vai para o cloud e para o índice do painel', () => {
    const filmes = col('filmes');
    const it = C.normalizarItem({ nome: 'O Garoto', links: ['https://exemplo.com/kid.mp4'], destaque: true, destaqueOrdem: '2', banner: 'https://exemplo.com/b.jpg' }, filmes);
    assert.equal(it.destaqueOrdem, 2);
    const semDestaque = C.normalizarItem({ nome: 'X', links: ['https://exemplo.com/x.mp4'], destaqueOrdem: 3 }, filmes);
    assert.equal(semDestaque.destaqueOrdem, undefined);
    const cloud = C.paraCloud(it, filmes, 'filmes/o-garoto');
    assert.equal(cloud.destaque, true);
    assert.equal(cloud.destaqueOrdem, 2);
    const r = C.resumoItem('conteudo/filmes/o-garoto.json', it);
    assert.deepEqual([r.destaque, r.destaqueOrdem, r.banner], [true, 2, 'https://exemplo.com/b.jpg']);
    assert.equal(C.resumoItem('conteudo/filmes/x.json', semDestaque).destaque, undefined);
    // jogo também pode ir para o banner pelo formulário
    assert.ok(C.TIPOS.jogo.campos.some(c => c.k === 'destaque'));
});

test('Vitrine: aparência no banner (logo, vídeo, skin, efeito) vai para o app com os nomes que o banner lê', () => {
    const filmes = col('filmes');
    const it = C.normalizarItem({ nome: 'O Garoto', links: ['https://exemplo.com/kid.mp4'], destaque: true,
        bannerLogo: ' https://exemplo.com/logo.png ', bannerVideo: 'https://exemplo.com/trailer.mp4', bannerSkin: 'vintage', bannerFx: 'crt' }, filmes);
    assert.deepEqual([it.bannerLogo, it.bannerSkin, it.bannerFx], ['https://exemplo.com/logo.png', 'vintage', 'crt']);
    const o = C.paraCloud(it, filmes, 'filmes/o-garoto');
    assert.deepEqual([o.bannerlogo, o.preview, o.bannerSkin, o.bannerFx], ['https://exemplo.com/logo.png', 'https://exemplo.com/trailer.mp4', 'vintage', 'crt']);
    // valores inválidos não passam
    const ruim = C.normalizarItem({ nome: 'X', links: ['https://exemplo.com/x.mp4'], bannerSkin: 'disco', bannerFx: 'glitter' }, filmes);
    assert.equal(ruim.bannerSkin, undefined); assert.equal(ruim.bannerFx, undefined);
    // jogo: o vídeo escolhido para o banner vence o snap do ScreenScraper
    const jogo = C.normalizarItem({ nome: 'Sonic', console: 'megadrive', links: ['https://exemplo.com/s.md'], video: 'https://exemplo.com/snap.mp4', bannerVideo: 'https://exemplo.com/trailer.mp4' }, col('jogos'));
    assert.equal(C.paraCloud(jogo, col('jogos'), 'jogos/sonic').preview, 'https://exemplo.com/trailer.mp4');
    assert.equal(C.paraCloud(Object.assign({}, jogo, { bannerVideo: undefined }), col('jogos'), 'jogos/sonic').preview, 'https://exemplo.com/snap.mp4');
    // canal 24h ganha imagem de banner e os ajustes
    const c24 = C.normalizarItem({ nome: 'Bluey 24H', links: ['https://www.youtube.com/embed/abc'], banner: 'https://exemplo.com/b.jpg', bannerSkin: 'poster' }, col('youtoon'));
    const oc = C.paraCloud(c24, col('youtoon'), 'youtoon/bluey');
    assert.deepEqual([oc.bannerThumb, oc.bannerSkin], ['https://exemplo.com/b.jpg', 'poster']);
    for (const t of ['video', 'jogo', 'canal24h']) assert.ok(C.TIPOS[t].campos.some(c => c.k === 'bannerSkin'), t);
});

// ---------------- Cartucho web (um console por sistema original + "Só PC") ----------------
test('cartucho web: seção Jogos Web com os sistemas e "Só PC"', () => {
    const web = col('jogos-web');
    assert.equal(web.consoles, 'consolesWeb');
    assert.equal(C.consolesDaColecao(web, config).length, config.consolesWeb.length);
    assert.equal(C.consolesDaColecao(col('jogos'), config).length, config.consoles.length);
    for (const id of ['web-fangames', 'web-indie', 'web-remakes', 'web-pc', 'web-dos', 'web-windows', 'web-ps2', 'web-psp', 'web-n64', 'web-arcade', 'web-navegador', 'web-outros'])
        assert.ok(C.consoleWeb(id, config) && config.consolesWeb.some(c => c.id === id), id);
    assert.ok(!C.consoleWeb('snes', config) && !C.consoleWeb('n64', config));
    assert.ok(!config.consoles.some(c => /^web/.test(c.id)), 'Jogos Retrô só com os consoles do emulador');
    const todos = C.todosConsoles(config);
    assert.equal(new Set(todos.map(c => c.prefixoId)).size, todos.length, 'prefixos únicos');
    assert.equal(new Set(todos.map(c => c.id)).size, todos.length, 'ids únicos');
    assert.deepEqual(C.aparelhosDoConsole('web-dos', config), ['tv', 'pc']);
    assert.deepEqual(C.aparelhosDoConsole('web-dos', config, { soPC: true }), ['pc']);
    assert.equal(C.sistemaWebDoNome('Super Mario 64 (rgc.zone)'), 'web-n64');
    assert.equal(C.sistemaWebDoNome('Duke Nukem 3D'), 'web-dos');
    assert.equal(C.sistemaWebDoNome('Tekken 5: Dark Resurrection (Recomp)'), 'web-psp');
    assert.equal(C.sistemaWebDoNome('Um jogo que ninguém conhece'), 'web-outros');
    // sistema web dentro de Jogos Retrô (ou console retrô em Jogos Web) não passa
    assert.ok(C.validarItem(C.normalizarItem({ nome: 'x', console: 'web-dos', links: ['https://a.io/'] }, col('jogos')), col('jogos'), config).erros.some(e => /Console desconhecido/.test(e)));
    assert.ok(C.validarItem(C.normalizarItem({ nome: 'x', console: 'snes', links: ['https://a.io/'] }, web), web, config).erros.some(e => /Console desconhecido/.test(e)));
    assert.deepEqual(C.opcoesDe('consoles', config, web).map(o => o.v), config.consolesWeb.map(c => c.id));
});

test('cartucho web: + Novo sistema (id, prefixo único, texto da config preservado)', () => {
    const fs = require('node:fs');
    const texto = fs.readFileSync(new URL('../studio.config.json', import.meta.url), 'utf8');
    const { sistema, config: nova } = C.novoSistemaWeb(config, { nome: 'Game Boy Advance', grupo: 'Nintendo' });
    assert.equal(sistema.id, 'web-game-boy-advance');
    assert.equal(sistema.web, true);
    assert.ok(!C.todosConsoles(config).some(c => c.prefixoId === sistema.prefixoId));
    assert.equal(nova.consolesWeb.length, config.consolesWeb.length + 1);
    assert.throws(() => C.novoSistemaWeb(config, { nome: 'Indie' }), /Já existe/);
    assert.throws(() => C.novoSistemaWeb(config, { nome: '  ' }), /nome/);
    const novoTexto = C.inserirSistemaNoTexto(texto, sistema);
    const linhasNovas = novoTexto.split('\n').filter(l => !texto.split('\n').includes(l));
    assert.equal(linhasNovas.length, 2, 'só a linha nova (e a vírgula da anterior) mudam');
    assert.ok(JSON.parse(novoTexto).consolesWeb.some(c => c.id === 'web-game-boy-advance'));
    // o build publica o DB do sistema novo na mesma pasta dos outros e a fonte do cloud
    const r = C.compilarColecao(Object.assign({}, col('jogos-web')), [], nova);
    assert.ok(r.arquivos['jogos/web-game-boy-advance.json']);
    assert.ok(r.fontes.some(f => f.console === 'web-game-boy-advance' && f.web === true && f.grupo === 'Nintendo'));
});

test('cartucho web: lê o README do Ultimate Catalog (▶ jogável, 📦 só fonte, ano, link do texto)', () => {
    const md = [
        '## A <sub>· 3</sub>', '| Game | Play | Source |', '| --- | --- | --- |',
        '| Ages of Conflict | [▶ wasm.rip](https://wasm.rip/files/aoc/index.html) |  |',
        '| ⭐ Alley Cat (1984) | [▶ petarov.github.io](https://petarov.github.io/alleycat.exe/) | [📦 petarov/alleycat.exe](https://github.com/petarov/alleycat.exe) |',
        '| ⭐ Alice| [▶ https://x-dot.github.io/alice-web/](https://github.com/x-dot/alice-web) |  |',
        '| Abuse |  | [📦 midzer/abuse](https://github.com/midzer/abuse) |'
    ].join('\n');
    const r = C.lerCatalogoWebPorts(md);
    assert.equal(r.jogos.length, 3);
    assert.equal(r.semDemo.length, 1);
    assert.deepEqual(r.jogos[1], { nome: 'Alley Cat', ano: 1984, links: ['https://petarov.github.io/alleycat.exe/'], repo: 'https://github.com/petarov/alleycat.exe', host: 'petarov.github.io', secao: 'A', estrela: true });
    assert.equal(r.jogos[2].links[0], 'https://x-dot.github.io/alice-web/');
    assert.equal(r.semDemo[0].repo, 'https://github.com/midzer/abuse');
});

test('cartucho web: só publica com licença conferida; vai para o app com core "web"; "Só PC" esconde da TV', () => {
    const jogos = col('jogos-web');
    const base = { nome: 'Alley Cat', console: 'web-dos', links: ['https://petarov.github.io/alleycat.exe/'] };
    const sem = C.validarItem(C.normalizarItem(base, jogos), jogos, config);
    assert.ok(sem.erros.some(e => /licença/.test(e)));
    const rasc = C.validarItem(C.normalizarItem(Object.assign({ _rascunho: true, licenca: 'nao-verificada' }, base), jogos), jogos, config);
    assert.equal(rasc.erros.length, 0);
    const pesado = C.validarItem(C.normalizarItem(Object.assign({ licenca: 'livre', peso: 'pesado' }, base), jogos), jogos, config);
    assert.equal(pesado.erros.length, 0);
    assert.ok(pesado.avisos.some(a => /Só PC/.test(a)));
    assert.equal(C.normalizarItem({ nome: 'x', soPC: 'sim' }, jogos).soPC, true);
    const r = C.compilarColecao(jogos, [
        { caminho: 'conteudo/jogos-web/web-dos/alley-cat.json', item: Object.assign({ licenca: 'livre', engine: 'DOS (js-dos)', controles: 'teclado', teclas: 'A=Space', repo: 'https://github.com/petarov/alleycat.exe' }, base) },
        { caminho: 'conteudo/jogos-web/web-dos/rascunho.json', item: { nome: 'Rascunho', console: 'web-dos', links: ['https://x.com/'], _rascunho: true } },
        { caminho: 'conteudo/jogos-web/web-windows/pesado.json', item: { nome: 'Pesado', console: 'web-windows', links: ['https://y.com/'], licenca: 'autorizada', peso: 'pesado', soPC: true } }
    ], config);
    const dos = JSON.parse(r.arquivos['jogos/web-dos.json']).games;
    assert.equal(dos.length, 1);
    assert.equal(dos[0].core, 'web');
    assert.equal(dos[0].web, true);
    assert.deepEqual(dos[0].aparelhos, ['tv', 'pc']);
    assert.equal(dos[0].license, 'livre');
    assert.equal(dos[0].keys, 'A=Space');
    assert.equal(dos[0].controls, 'teclado');
    const win = JSON.parse(r.arquivos['jogos/web-windows.json']).games;
    assert.deepEqual(win[0].aparelhos, ['pc']);
    assert.ok(r.fontes.some(f => f.console === 'web-ps2' && f.tipo === 'emulator_json' && /jogos\/web-ps2\.json$/.test(f.url)));
    assert.ok(!r.arquivos['jogos/web.json'] && !r.arquivos['jogos/webpc.json']);
    // jogo retrô comum continua igual; "Só PC" também vale para ele
    const retro = col('jogos');
    const snes = C.paraCloud(C.normalizarItem({ nome: 'Mario', console: 'snes', links: ['https://r.x/m.sfc'], licenca: 'livre' }, retro), retro, 'jogos/mario', config);
    assert.equal(snes.core, 'snes');                     // sem core próprio = o core do console (EmulatorJS)
    assert.equal(snes.web, undefined);
    assert.equal(snes.aparelhos, undefined);
    const n64pc = C.paraCloud(C.normalizarItem({ nome: 'Pesado 64', console: 'n64', links: ['https://r.x/p.z64'], soPC: true }, retro), retro, 'jogos/p', config);
    assert.deepEqual(n64pc.aparelhos, ['pc']);
});

test('cartucho web: importador cria rascunhos, junta link repetido e não mexe no que já existe', async () => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'czweb-'));
    fs.copyFileSync(new URL('../studio.config.json', import.meta.url), path.join(raiz, 'studio.config.json'));
    const { importarWebPorts } = await import('../tools/importar-webports.mjs');
    const md = '## A\n| Game | Play | Source |\n| --- | --- | --- |\n| Jogo X | [▶ a.io](https://a.io/x/) |  |\n| Jogo X | [▶ b.io](https://b.io/x/) |  |\n| Só Fonte |  | [📦 r](https://github.com/u/r) |\n| Duke Nukem 3D | [▶ d.io](https://d.io/) |  |\n';
    const r1 = importarWebPorts(md, { raiz });
    assert.equal(JSON.parse(fs.readFileSync(path.join(raiz, 'conteudo/jogos-web/web-dos/duke-nukem-3d.json'), 'utf8')).console, 'web-dos', 'cada jogo vai para o sistema dele');
    assert.equal(r1.novos, 2); assert.equal(r1.atualizados, 1);
    const arq = path.join(raiz, 'conteudo/jogos-web/web-outros/jogo-x.json');
    const it = JSON.parse(fs.readFileSync(arq, 'utf8'));
    assert.deepEqual(it.links, ['https://a.io/x/', 'https://b.io/x/']);
    assert.equal(it._rascunho, true); assert.equal(it.licenca, 'nao-verificada');
    // o usuário publicou e mudou de sistema: reimportar não cria outro nem mexe
    fs.mkdirSync(path.join(raiz, 'conteudo/jogos-web/web-indie'));
    fs.writeFileSync(path.join(raiz, 'conteudo/jogos-web/web-indie/jogo-x.json'), JSON.stringify({ nome: 'Jogo X', console: 'web-indie', links: ['https://a.io/x/'], licenca: 'livre' }));
    fs.unlinkSync(arq);
    const r2 = importarWebPorts(md, { raiz });
    assert.equal(r2.novos, 0); assert.equal(r2.pulados, 3);
    assert.ok(!fs.existsSync(arq));
    assert.equal(JSON.parse(fs.readFileSync(path.join(raiz, 'conteudo/jogos-web/_webports-sem-demo.json'), 'utf8')).jogos[0].nome, 'Só Fonte');
    fs.rmSync(raiz, { recursive: true, force: true });
});

test('jogos retrô: cada console tem o core do EmulatorJS; sistemas novos (Game Boy, Atari, Commodore, PSP, 3DS…)', () => {
    const retro = config.colecoes.find(c => c.id === 'jogos');
    const ids = config.consoles.map(c => c.id);
    for (const novo of ['gb', 'vb', 'atari5200', 'atari7800', 'jaguar', 'lynx', 'wonderswan', 'pcfx', 'c64', 'c128', 'pet', 'plus4', 'vic20', 'mame2003', 'psp', '3ds']) assert.ok(ids.includes(novo), novo);
    // todo console tem core OU está marcado sem emulador; prefixos únicos (retrô + web)
    for (const c of config.consoles) assert.ok(c.core || c.semEmulador, c.id);
    const pre = config.consoles.concat(config.consolesWeb).map(c => c.prefixoId);
    assert.equal(new Set(pre).size, pre.length);
    const mk = (console, extra) => C.paraCloud(C.normalizarItem(Object.assign({ nome: 'X ' + console, console, links: ['https://r.x/a.zip'], licenca: 'livre' }, extra), retro), retro, 'jogos/x', config);
    assert.equal(mk('megadrive').core, 'segaMD');
    assert.equal(mk('gbc').core, 'gb');
    assert.equal(mk('msdos').core, 'dos');
    assert.equal(mk('atari5200').core, 'a5200');
    assert.equal(mk('3ds').core, '3ds');
    assert.equal(mk('snes', { core: 'snes9x' }).core, 'snes9x');   // o core do jogo vence o do console
    assert.equal(mk('msx').core, undefined);
    assert.equal(mk('msdos', { comandoDos: 'KEEN4E.EXE' }).dosrun, 'KEEN4E.EXE');   // MS-DOS: comando do jogo vai para o app
    assert.equal(mk('msdos').dosrun, undefined);                       // sem emulador: não inventa core
    assert.equal(C.coreDoConsole('ps1'), 'psx');                    // sem config: tabela padrão
    // cada console novo vira um DB (dist/jogos/<id>.json) e uma fonte do cloud
    const r = C.compilarColecao(retro, [{ item: C.normalizarItem({ nome: 'Tetris', console: 'gb', links: ['https://r.x/t.gb'], licenca: 'livre' }, retro), caminho: 'conteudo/jogos/gb/tetris.json' }], config);
    assert.ok(r.arquivos['jogos/gb.json']);
    assert.equal(JSON.parse(r.arquivos['jogos/gb.json']).games[0].core, 'gb');
    assert.ok(r.fontes.some(f => f.console === 'psp' && /jogos\/psp\.json$/.test(f.url)));
});
