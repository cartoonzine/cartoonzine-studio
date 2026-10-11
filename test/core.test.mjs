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
