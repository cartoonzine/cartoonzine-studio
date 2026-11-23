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

test('séries em árvore: buracos entre o 1º e o último, repetidos e onde começa', () => {
    const cs = L.lerLista(['#EXTM3U', ...[3, 4, 6, 6, 8].flatMap((n, i) => [`#EXTINF:-1,Naruto S01E0${n}`, `http://x/${n}-${i}.mp4`])].join('\n'), 't').canais;
    const [s] = L.arvoreSeries(cs);
    assert.equal(s.serie, 'Naruto'); assert.equal(s.total, 5);
    assert.deepEqual([s.temporadas[0].comeca, s.temporadas[0].faltando, s.temporadas[0].repetidos], [3, [5, 7], [6]]);
});

test('já na Studio: vídeo pelo título/série, canal pelo nome + país', () => {
    const m = L.mapaStudio([{ caminho: 'conteudo/animes/naruto.json', nome: 'Naruto' }, { caminho: 'conteudo/canais/br/gloob.json', nome: 'Gloob', pais: 'BR' }]);
    const [n, , g] = itens();
    assert.equal(L.jaNaStudio(n, m).colecao, 'animes');
    g.pais = 'BR'; assert.equal(L.jaNaStudio(g, m).colecao, 'canais');
    g.pais = 'PT'; assert.equal(L.jaNaStudio(g, m), null);
});

test('regras mais fortes: várias palavras, condições de tipo/idioma/país e regras globais', () => {
    const c = { grupo: 'Otaku Zone', nome: 'X', natureza: 'episodio', idioma: 'pt-BR', pais: 'BR' };
    assert.ok(L.passaRegra(c, { campo: 'grupo', contem: 'anime | otaku' }));
    assert.ok(!L.passaRegra(c, { campo: 'grupo', contem: 'otaku', natureza: 'filme' }));
    assert.ok(L.passaRegra(c, { contem: '', idioma: 'pt' }));
    assert.ok(!L.passaRegra(c, { contem: '', pais: 'MX' }));
    const e = L.envioPadrao({ destino: { colecao: 'cartoons' }, regras: [{ campo: 'grupo', contem: 'otaku', para: { colecao: 'animes' }, ativo: false }] });
    e._globais = [{ campo: 'tudo', contem: 'otaku', para: 'ignorar' }];
    assert.equal(L.rotaDe(c, e).destino, 'ignorar', 'a do envio está desligada: vale a global');
});

test('arrumar nomes em lote', () => {
    assert.equal(L.arrumarNome('BR | GLOBO SP [FHD] (alt)', { tirarPrefixo: true, tirarTags: true, caixa: 'titulo' }), 'Globo SP');
    assert.equal(L.arrumarNome('Canal ABC HD', { procurar: ' HD', trocar: '' }), 'Canal ABC');
    assert.equal(L.arrumarNome('a1 b22', { procurar: '\\d+', trocar: '#', regex: true }), 'a# b#');
});

test('🧬 Sidechain: relatório de cópias diz quais vídeos chegaram repetidos e de que lista', () => {
    const config = { colecoes: [{ id: 'filmes', nome: 'Filmes', tipo: 'video', fonteCloud: { nome: 'F', tipo: 'vod_json' } }] };
    const la = L.lerLista('#EXTM3U\n#EXTINF:-1,Matrix (1999)\nhttp://a/matrix.mp4\n#EXTINF:-1,Avatar (2009)\nhttp://a/avatar.mp4\n#EXTINF:-1,Lost S01E01\nhttp://a/l1.mp4\n#EXTINF:-1,Lost S01E02\nhttp://a/l2.mp4\n', 'a').canais;
    const lb = L.lerLista('#EXTM3U\n#EXTINF:-1,Matrix (1999)\nhttp://b/matrix.mp4\n#EXTINF:-1,Lost S01E01\nhttp://b/l1.mp4\n#EXTINF:-1,Lost S01E02\nhttp://b/l2.mp4\n', 'b').canais;
    const ea = L.envioPadrao({ id: 'a', nome: 'Lista A', destino: { colecao: 'filmes' } }), eb = L.envioPadrao({ id: 'b', nome: 'Lista B', destino: { colecao: 'filmes' } });
    const { saidas, copias } = L.montarSidechain([{ envio: ea, canais: la }, { envio: eb, canais: lb }], config);
    const arr = copias.filmes;
    const m = arr.find(x => !x.serie), s = arr.find(x => x.serie);
    assert.equal(m.nome, 'Matrix'); assert.equal(m.n, 1); assert.deepEqual(m.listas, { 'Lista A': 1, 'Lista B': 1 });
    assert.equal(s.nome, 'Lost'); assert.equal(s.eps, 2); assert.equal(s.n, 2);
    assert.ok(!arr.some(x => x.nome === 'Avatar'));
    const j = JSON.parse(L.gerarJSON(saidas[0].itens));
    assert.equal(j.filter(x => /Matrix/.test(x.title)).length, 1);            // o app recebe um só (a outra é reserva)
    assert.ok(!JSON.stringify(j).includes('_env'));
});

test('🧬 mesmo nome, obras diferentes: ano ou TMDB diferente não se juntam', () => {
    const config = { colecoes: [{ id: 'filmes', nome: 'Filmes', tipo: 'video', fonteCloud: { nome: 'F', tipo: 'vod_json' } }] };
    const la = L.lerLista('#EXTM3U\n#EXTINF:-1,Código de Honra\nhttp://a/ch1.mp4\n#EXTINF:-1,Matrix (1999)\nhttp://a/m.mp4\n#EXTINF:-1,Duna (1984)\nhttp://a/d84.mp4\n', 'a').canais;
    const lb = L.lerLista('#EXTM3U\n#EXTINF:-1,Código de Honra\nhttp://b/ch2.mp4\n#EXTINF:-1,Matrix (1999)\nhttp://b/m.mp4\n#EXTINF:-1,Duna (2021)\nhttp://b/d21.mp4\n#EXTINF:-1,Duna\nhttp://b/d.mp4\n', 'b').canais;
    la[0].video.tmdbRef = 'movie/111'; lb[0].video.tmdbRef = 'movie/222';
    const ea = L.envioPadrao({ id: 'a', nome: 'A', destino: { colecao: 'filmes' } }), eb = L.envioPadrao({ id: 'b', nome: 'B', destino: { colecao: 'filmes' } });
    const { saidas } = L.montarSidechain([{ envio: ea, canais: la }, { envio: eb, canais: lb }], config);
    const j = JSON.parse(L.gerarJSON(saidas[0].itens));
    const n = (re) => j.filter(x => re.test(x.title)).length;
    assert.equal(n(/^Código de Honra/), 2);          // TMDB diferente → dois filmes
    assert.equal(n(/^Matrix/), 1);                   // mesmo ano → junta (a outra vira reserva)
    assert.equal(n(/^Duna/), 3);                     // 1984, 2021 e o sem ano (não dá para saber qual) ficam à parte
});

test('✂ separação feita à mão (pelo link) vira obra própria; relatório traz cada cópia', () => {
    const config = { colecoes: [{ id: 'filmes', nome: 'Filmes', tipo: 'video', fonteCloud: { nome: 'F', tipo: 'vod_json' } }] };
    const la = L.lerLista('#EXTM3U\n#EXTINF:-1,Código de Honra\nhttp://a/ch1.mp4\n', 'a').canais;
    const lb = L.lerLista('#EXTM3U\n#EXTINF:-1,Código de Honra\nhttp://b/ch2.mp4\n', 'b').canais;
    const ea = L.envioPadrao({ id: 'a', nome: 'A', destino: { colecao: 'filmes' } }), eb = L.envioPadrao({ id: 'b', nome: 'B', destino: { colecao: 'filmes' } });
    let r = L.montarSidechain([{ envio: ea, canais: la }, { envio: eb, canais: lb }], config);
    assert.equal(r.saidas[0].itens.length, 1);
    assert.deepEqual(r.copias.filmes[0].itens.map(x => [x.l, x.url]), [['A', 'http://a/ch1.mp4'], ['B', 'http://b/ch2.mp4']]);
    const sep = { 'http://b/ch2.mp4': { tmdb: 'movie/999', ano: 1992 } };
    ea._sep = sep; eb._sep = sep;
    const la2 = L.lerLista('#EXTM3U\n#EXTINF:-1,Código de Honra\nhttp://a/ch1.mp4\n', 'a').canais, lb2 = L.lerLista('#EXTM3U\n#EXTINF:-1,Código de Honra\nhttp://b/ch2.mp4\n', 'b').canais;
    r = L.montarSidechain([{ envio: ea, canais: la2 }, { envio: eb, canais: lb2 }], config);
    const j = JSON.parse(L.gerarJSON(r.saidas[0].itens));
    assert.equal(j.length, 2);
    assert.ok(j.some(x => x.year === 1992));
    assert.ok(!r.copias.filmes);
});

test('✓ São o mesmo com capa preenchida: continua junto e a capa vale', () => {
    const config = { colecoes: [{ id: 'filmes', nome: 'Filmes', tipo: 'video', fonteCloud: { nome: 'F', tipo: 'vod_json' } }] };
    const la = L.lerLista('#EXTM3U\n#EXTINF:-1,Código de Honra\nhttp://a/ch1.mp4\n', 'a').canais, lb = L.lerLista('#EXTM3U\n#EXTINF:-1,Código de Honra\nhttp://b/ch2.mp4\n', 'b').canais;
    const sep = { 'http://a/ch1.mp4': { soDados: true, capa: 'https://img/x.jpg' }, 'http://b/ch2.mp4': { soDados: true, capa: 'https://img/x.jpg' } };
    const ea = L.envioPadrao({ id: 'a', nome: 'A', destino: { colecao: 'filmes' } }), eb = L.envioPadrao({ id: 'b', nome: 'B', destino: { colecao: 'filmes' } });
    ea._sep = sep; eb._sep = sep;
    const j = JSON.parse(L.gerarJSON(L.montarSidechain([{ envio: ea, canais: la }, { envio: eb, canais: lb }], config).saidas[0].itens));
    assert.equal(j.length, 1); assert.equal(j[0].thumb, 'https://img/x.jpg');
});
