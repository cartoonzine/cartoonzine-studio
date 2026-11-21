/** 🎬 Link Edit: tipo do item (canal/filme/episódio/rádio) e dados de vídeo.  Rodar:  node --test test/linkedit-video.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const L = req('../core/linkedit-core.js');
const C = req('../core/studio-core.js');

const LISTA = `#EXTM3U
#EXTINF:-1 group-title="Animes",Naruto S01E03 Dublado 1080p
http://x/n3.mp4
#EXTINF:-1 group-title="Filmes",Matrix (1999) [Leg]
http://x/matrix.mkv
#EXTINF:-1 group-title="Kids",Gloob
http://x/gloob.m3u8
#EXTINF:-1,Rádio Cidade
http://x/radio.mp3
#EXTINF:-1 group-title="Desenhos",Pica-Pau 2x05
http://x/pp.mp4
#EXTINF:-1,Filme Xtream
http://srv:8080/movie/u/p/123.mp4
`;
const itens = () => L.lerLista(LISTA, 't').canais;

test('descobre sozinho o tipo de cada item e os dados do vídeo', () => {
    const [n, m, g, r, p, x] = itens();
    assert.equal(n.natureza, 'episodio'); assert.deepEqual([n.video.serie, n.video.temporada, n.video.episodio, n.video.audio, n.video.qualidade, n.video.colecao], ['Naruto', 1, 3, 'dublado', 'FHD', 'animes']);
    assert.equal(m.natureza, 'filme'); assert.deepEqual([m.video.titulo, m.video.ano, m.video.audio, m.video.colecao], ['Matrix', 1999, 'legendado', 'filmes']);
    assert.equal(g.natureza, 'canal'); assert.equal(g.video, undefined);
    assert.equal(r.natureza, 'radio');
    assert.equal(p.natureza, 'episodio'); assert.deepEqual([p.video.serie, p.video.temporada, p.video.episodio, p.video.colecao], ['Pica-Pau', 2, 5, 'cartoons']);
    assert.equal(x.natureza, 'filme');
});

test('o que é editado à mão vence a detecção; "Detectar" volta ao automático', () => {
    const [n] = itens();
    L.ajustarVideo(n, { serie: 'Naruto Clássico', episodio: 4, colecao: 'cartoons' });
    assert.equal(n.video.serie, 'Naruto Clássico'); assert.equal(n.video.episodio, 4); assert.ok(n.videoManual);
    L.detectarVideo(n);                                   // detectar de novo sem forçar não apaga o manual
    assert.equal(n.video.serie, 'Naruto Clássico');
    L.detectarVideo(n, true);
    assert.equal(n.video.serie, 'Naruto'); assert.ok(!n.videoManual);
    // trocar o tipo: filme não guarda série/temporada/episódio
    L.ajustarVideo(n, { natureza: 'filme' });
    assert.equal(n.natureza, 'filme'); assert.equal(n.video.serie, undefined); assert.equal(n.video.episodio, undefined);
});

test('o JSON exportado leva os campos que o DB do Cartoonzine lê (title, year, serie, season, episode, audios, qualidadeMax)', () => {
    const [n, m, g] = itens();
    const j = JSON.parse(L.gerarJSON([n, m, g]));
    assert.deepEqual([j[0].title, j[0].serie, j[0].season, j[0].episode, j[0].audios[0], j[0].qualidadeMax], ['Naruto S01E03', 'Naruto', 1, 3, 'dublado', 'FHD']);
    assert.deepEqual([j[1].title, j[1].year, j[1].audios[0]], ['Matrix', 1999, 'legendado']);
    assert.equal(j[2].title, undefined);                   // canal continua como canal
});

test('filtro e contagem por tipo de item', () => {
    const cs = itens();
    assert.deepEqual(Object.fromEntries(L.contar(cs).naturezas), { episodio: 2, filme: 2, canal: 1, radio: 1 });
    assert.equal(L.filtrar(cs, { naturezas: new Set(['filme']) }).length, 2);
});

test('importador de filmes/séries respeita a série, o episódio e a coleção que você arrumou', () => {
    const cs = itens().filter(L.ehVideo);
    const [n] = cs;
    L.ajustarVideo(n, { serie: 'Naruto Shippuden', temporada: 2, episodio: 7, colecao: 'cartoons' });
    const config = { colecoes: [{ id: 'cartoons', nome: 'Cartoons', tipo: 'video' }, { id: 'animes', nome: 'Animes', tipo: 'video' }, { id: 'filmes', nome: 'Filmes', tipo: 'video' }, { id: 'series', nome: 'Séries', tipo: 'video' }] };
    const plano = L.planejarVOD([n], C, { config, rascunho: true });
    assert.equal(plano[0].col.id, 'cartoons');
    assert.equal(plano[0].item.nome, 'Naruto Shippuden');
    const ep = plano[0].item.temporadas[0];
    assert.equal(ep.numero != null ? ep.numero : ep.temporada, 2);
});

test('Sidechain: os ajustes de vídeo salvos no envio valem na rodada do robô', () => {
    const config = { colecoes: [{ id: 'cartoons', nome: 'Cartoons', tipo: 'video', fonteCloud: { nome: 'C', tipo: 'vod_json' } }, { id: 'animes', nome: 'Animes', tipo: 'video', fonteCloud: { nome: 'A', tipo: 'vod_json' } }] };
    const cs = itens();
    const envio = L.envioPadrao({ id: 'e', destino: { colecao: 'cartoons' } });
    envio.ajustes[L.chaveSC(cs[0])] = { serie: 'Naruto Clássico', audio: 'dual' };
    const { saidas } = L.montarSidechain([{ envio, canais: cs }], config);
    const j = JSON.parse(L.gerarJSON(saidas[0].itens));
    const nar = j.find(x => x.serie === 'Naruto Clássico');
    assert.ok(nar); assert.deepEqual(nar.audios, ['dublado', 'legendado']);
});

test('TMDB: uma busca por série (todos os episódios) e os dados vão no JSON do app', () => {
    const [n] = itens();
    const n2 = L.lerLista('#EXTM3U\n#EXTINF:-1,Naruto S01E09\nhttp://x/n9.mp4\n', 't').canais[0];
    assert.equal(L.chaveTMDB(n), L.chaveTMDB(n2));
    const ped = L.pedidoTMDB(n);
    assert.equal(ped.nome, 'Naruto'); assert.equal(ped.temporadas[0].numero, 1);
    const dados = L.dadosDoTMDB({ tmdb: 'tv/46260', nome: 'Naruto', capa: 'http://img/p.jpg', banner: 'http://img/b.jpg', bannerLogo: 'http://img/l.png', descricao: 'Ninja', generos: ['Animação', 'Ação'], notaTmdb: 8.4, classificacao: '12' });
    L.aplicarTMDB(n, dados);
    const j = JSON.parse(L.gerarJSON([n]))[0];
    assert.deepEqual([j.thumb, j.bannerThumb, j.logo, j.desc, j.tmdbId, j.tmdbTipo, j.rating, j.age], ['http://img/p.jpg', 'http://img/b.jpg', 'http://img/l.png', 'Ninja', '46260', 'tv', 8.4, '12']);
    assert.equal(n.video.genero, 'Animação, Ação');
    assert.equal(L.dadosDoTMDB({ nome: 'x' }), null, 'sem código do TMDB = não achou');
});
