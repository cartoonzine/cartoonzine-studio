/** 🔗 Link Sidechain (core/linkedit-core.js).  Rodar:  node --test test/sidechain.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../core/linkedit-core.js');

const config = { publicacao: { repo: 'cz/studio' }, colecoes: [
    { id: 'cartoons', nome: 'Cartoons', tipo: 'video', fonteCloud: { nome: 'Cartoons VOD', tipo: 'vod_json', prefixoId: 'VOD_CRT', targetCategory: 'Cartoons' } },
    { id: 'animes', nome: 'Animes', tipo: 'video', fonteCloud: { nome: 'Animes', tipo: 'vod_json', prefixoId: 'LIV_ANI', targetCategory: 'Animes' } },
    { id: 'canais', nome: 'Canais (TVzine)', tipo: 'canal', fonteCloud: { nome: 'TVzine - Canais (Studio)', tipo: 'tvzine_worker', prefixoId: 'TV' } },
    { id: 'desenhos-24h', nome: 'Desenhos 24 Horas', tipo: 'canal24h', fonteCloud: { nome: 'Desenhos 24 Horas', tipo: 'vod_m3u', prefixoId: 'LIV_KID' } },
    { id: 'jogos', nome: 'Jogos', tipo: 'jogo' }
] };
const M3U = `#EXTM3U
#EXTINF:-1 group-title="Cartoons",Pica-Pau S01E01
http://v/pica1.mp4
#EXTINF:-1 group-title="Cartoons",Tom e Jerry S01E01
http://v/tom1.mp4
#EXTINF:-1 group-title="Anime",Naruto S01E01
http://v/naruto1.mp4
#EXTINF:-1 group-title="Anime",Naruto S01E02
http://v/naruto2.mp4
#EXTINF:-1 group-title="Anime",Dragon Ball S01E01
http://v/db1.mp4
`;
const canais = () => L.lerLista(M3U, 'teste').canais;
const vivo = (cs) => cs.map(c => Object.assign(c, { teste: { status: 'vivo' } }));

test('só coleções de vídeo/canal/rádio com fonte no Cloud podem receber envio', () => {
    assert.deepEqual(L.colecoesSidechain(config).map(c => c.id), ['cartoons', 'animes', 'canais', 'desenhos-24h']);
});

test('desvio manual pela CHAVE do item vale mesmo se a lista mudar de ordem; o resto vai pro destino padrão', () => {
    const cs = canais();
    const envio = L.envioPadrao({ id: 'e1', nome: 'Cartoons BR', destino: { colecao: 'cartoons' } });
    cs.filter(c => /naruto|dragon/i.test(c.nome)).forEach(c => { envio.desvios[L.chaveSC(c)] = { colecao: 'animes' }; });
    const { saidas, relatorios } = L.montarSidechain([{ envio, canais: cs.reverse() }], config);
    const por = Object.fromEntries(saidas.map(s => [s.chave, s.itens.map(i => i.nome).sort()]));
    assert.deepEqual(por['sc-cartoons'], ['Pica-Pau S01E01', 'Tom e Jerry S01E01']);
    assert.deepEqual(por['sc-animes'], ['Dragon Ball S01E01', 'Naruto S01E01', 'Naruto S01E02']);
    assert.equal(relatorios.e1.porDestino.Animes, 3);
});

test('regra aprendida: grupo "Anime" → Animes; o sugeridor acha a regra pelos desvios', () => {
    const cs = canais();
    const envio = L.envioPadrao({ id: 'e1', destino: { colecao: 'cartoons' } });
    cs.filter(c => c.grupo === 'Anime').forEach(c => { envio.desvios[L.chaveSC(c)] = { colecao: 'animes' }; });
    const sug = L.sugerirRegras(cs, envio);
    assert.equal(sug.length, 1);
    assert.equal(sug[0].contem, 'Anime'); assert.equal(sug[0].para.colecao, 'animes'); assert.equal(sug[0].n, 3);
    // com a regra, um anime NOVO (nunca desviado à mão) já vai sozinho
    const comRegra = L.envioPadrao({ id: 'e1', destino: { colecao: 'cartoons' }, regras: [{ campo: 'grupo', contem: 'Anime', para: { colecao: 'animes' } }] });
    const novo = L.lerLista('#EXTM3U\n#EXTINF:-1 group-title="Anime",One Piece S01E01\nhttp://v/op1.mp4\n', 't').canais[0];
    const r = L.rotaDe(novo, comRegra);
    assert.equal(r.motivo, 'regra'); assert.equal(r.destino.colecao, 'animes');
});

test('NOVO e modo revisar: item nunca visto fica pendente (não vai pra lugar nenhum) até você decidir', () => {
    const cs = canais();
    const envio = L.envioPadrao({ id: 'e1', destino: { colecao: 'cartoons' }, modo: 'revisar' });
    L.marcarVistos(envio, cs.slice(0, 2));               // a lista antiga só tinha os 2 cartoons
    const { saidas, relatorios } = L.montarSidechain([{ envio, canais: cs }], config);
    assert.equal(relatorios.e1.novos.length, 3);
    assert.equal(relatorios.e1.pendentes.length, 3);
    assert.deepEqual(saidas.map(s => s.chave), ['sc-cartoons']);
    // no modo automático o novo vai pro destino padrão
    envio.modo = 'auto';
    const auto = L.montarSidechain([{ envio, canais: cs }], config);
    assert.equal(auto.saidas[0].itens.length, 5);
    assert.equal(auto.relatorios.e1.novos.length, 3);
});

test('TVzine: o país escolhido MANDA — canal da lista com outro país vai para o país do envio, com idioma e categoria do app', () => {
    const lista = `#EXTM3U
#EXTINF:-1 tvg-id="CartoonNetwork.mx" tvg-country="MX" group-title="KIDS",Cartoon Network MX
http://t/cn.m3u8
#EXTINF:-1 group-title="Noticias",Canal 24 Noticias
http://t/news.m3u8
`;
    const cs = vivo(L.lerLista(lista, 't').canais);
    const envio = L.envioPadrao({ id: 'br', destino: { colecao: 'canais', pais: 'BR', idioma: 'pt-BR' } });
    const { saidas } = L.montarSidechain([{ envio, canais: cs }], config);
    assert.deepEqual(saidas.map(s => s.chave), ['sc-canais-br']);
    const itens = JSON.parse(L.gerarJSON(saidas[0].itens));
    assert.ok(itens.every(i => i.country === 'BR' && i.language === 'pt-BR'));
    assert.equal(itens.find(i => /Cartoon/.test(i.name)).group, 'Infantil');
    // a fonte do Cloud leva o país FIXO (pais + paisExclusivo): o Cloud não adivinha outro
    const f = L.fonteDaSaida(saidas[0], config.colecoes[2], (a) => 'https://x/listas/' + a);
    assert.equal(f.pais, 'br'); assert.equal(f.paisExclusivo, true); assert.equal(f.tipo, 'tvzine_worker');
    assert.equal(f.url, 'https://x/listas/sc-canais-br.json'); assert.equal(f._colecao, 'sidechain');
});

test('TVzine: um desvio pode mandar um canal de idioma para OUTRO país; canal morto sai; vídeo não é testado', () => {
    const lista = `#EXTM3U
#EXTINF:-1 group-title="Kids",Discovery Kids
http://t/dk.m3u8
#EXTINF:-1 group-title="Kids",Canal Morto
http://t/morto.m3u8
`;
    const cs = L.lerLista(lista, 't').canais;
    cs[0].teste = { status: 'vivo' }; cs[1].teste = { status: 'morto' };
    const envio = L.envioPadrao({ id: 'mix', destino: { colecao: 'canais', pais: 'BR', idioma: 'pt-BR' } });
    envio.desvios[L.chaveSC(cs[0])] = { colecao: 'canais', pais: 'MX', idioma: 'es-MX', categoria: 'Infantil' };
    const { saidas, relatorios } = L.montarSidechain([{ envio, canais: cs }], config);
    assert.deepEqual(saidas.map(s => s.chave), ['sc-canais-mx']);
    assert.equal(saidas[0].itens[0].pais, 'MX'); assert.equal(saidas[0].itens[0].idioma, 'es-MX');
    assert.equal(relatorios.mix.mortos, 1);
});

test('o mesmo canal vindo de dois envios vira UM, com o outro link de reserva; ignorar tira da lista', () => {
    const a = vivo(L.lerLista('#EXTM3U\n#EXTINF:-1 tvg-id="Gloob.br",Gloob\nhttp://a/gloob.m3u8\n#EXTINF:-1,Lixo\nhttp://a/lixo.m3u8\n', 'a').canais);
    const b = vivo(L.lerLista('#EXTM3U\n#EXTINF:-1 tvg-id="Gloob.br",Gloob HD\nhttp://b/gloob.m3u8\n', 'b').canais);
    const e1 = L.envioPadrao({ id: 'a', destino: { colecao: 'canais', pais: 'BR' } });
    e1.desvios[L.chaveSC(a[1])] = 'ignorar';
    const e2 = L.envioPadrao({ id: 'b', destino: { colecao: 'canais', pais: 'BR' } });
    const { saidas, relatorios } = L.montarSidechain([{ envio: e1, canais: a }, { envio: e2, canais: b }], config);
    assert.equal(saidas[0].itens.length, 1);
    assert.equal(saidas[0].itens[0].reservas.length, 1);
    assert.equal(relatorios.a.ignorados, 1);
});

test('Desenhos 24H usa o M3U na fonte do Cloud; vistos esquecem quem sumiu há mais de 30 dias', () => {
    const s = { chave: 'sc-desenhos-24h', colecao: 'desenhos-24h', pais: '', idioma: 'es' };
    const f = L.fonteDaSaida(s, config.colecoes[3], (a) => a);
    assert.equal(f.url, 'sc-desenhos-24h.m3u'); assert.equal(f.idioma, 'es'); assert.ok(!f.pais);
    const envio = L.envioPadrao({ vistos: { velho: '2020-01-01', recente: new Date().toISOString().slice(0, 10) } });
    const sairam = L.marcarVistos(envio, canais());
    assert.equal(sairam, 2); assert.ok(!envio.vistos.velho); assert.ok(envio.vistos.recente);
});

test('(antigas Receitas) várias listas, filtros e lista avulsa no mesmo envio', () => {
    const e = L.envioPadrao({ id: 'kids', url: 'http://a/1.m3u', listas: ['http://a/2.m3u', 'http://a/1.m3u', 'lixo'], destino: { colecao: '' }, avulsa: true,
        filtros: { tipos: ['Infantil'] } });
    assert.deepEqual(L.linksDoEnvio(e), ['http://a/1.m3u', 'http://a/2.m3u']);
    const cs = L.lerLista(`#EXTM3U
#EXTINF:-1 group-title="Kids",Gloob
http://t/gloob.m3u8
#EXTINF:-1 group-title="Noticias",CNN
http://t/cnn.m3u8
#EXTINF:-1 group-title="XXX",Adulto
http://t/x.m3u8
`, 't').canais.map(c => Object.assign(c, { teste: { status: 'vivo' } }));
    const { saidas, relatorios, avulsas } = L.montarSidechain([{ envio: e, canais: cs }], config);
    assert.equal(saidas.length, 0, 'sem coleção: nada vai para o Cloud');
    assert.equal(relatorios.kids.filtrados, 2);
    assert.deepEqual(avulsas[0].itens.map(i => i.nome), ['Gloob']);
    // com destino, a avulsa leva o mesmo item já no padrão do app
    e.destino = { colecao: 'canais', pais: 'BR', idioma: 'pt-BR' };
    const r2 = L.montarSidechain([{ envio: e, canais: cs }], config);
    assert.equal(r2.saidas[0].chave, 'sc-canais-br');
    assert.equal(r2.avulsas[0].itens[0].pais, 'BR');
});

const cfgMista = { publicacao: { repo: 'cz/studio' }, colecoes: config.colecoes.concat([
    { id: 'filmes', nome: 'Filmes', tipo: 'video', fonteCloud: { nome: 'Filmes', tipo: 'vod_json', prefixoId: 'VOD_FIL' } },
    { id: 'series', nome: 'Séries', tipo: 'video', fonteCloud: { nome: 'Séries', tipo: 'vod_json', prefixoId: 'VOD_SER' } }]) };
const MISTA = `#EXTM3U
#EXTINF:-1 group-title="Filmes | Ação",Matrix (1999)
http://v/matrix.mp4
#EXTINF:-1 group-title="Filmes | Ação",Duro de Matar (1988)
http://v/duro.mp4
#EXTINF:-1 group-title="Séries | Drama",Lost S01E01
http://v/lost1.mp4
#EXTINF:-1 group-title="Animes",Naruto S01E01
http://v/naruto.mp4
#EXTINF:-1 group-title="Desenhos",Pica-Pau S01E01
http://v/pica.mp4
#EXTINF:-1 group-title="XXX Adultos",Coisa (2020)
http://v/x.mp4
`;

test('lista mista: rotas pelos GRUPOS — sugestões, grupo novo espera, exceção item a item ainda vale', () => {
    const cs = L.lerLista(MISTA, 't').canais;
    const e = L.envioPadrao({ id: 'mx', tipoLista: 'mista' });
    const cols = L.colecoesSidechain(cfgMista);
    const g = L.analisarGrupos(cs, e, cols);
    const sug = Object.fromEntries(g.map(x => [x.grupo, x.sugestao === 'ignorar' ? 'ignorar' : x.sugestao && x.sugestao.colecao]));
    assert.deepEqual(sug, { 'Filmes | Ação': 'filmes', 'Séries | Drama': 'series', Animes: 'animes', Desenhos: 'cartoons', 'XXX Adultos': 'ignorar' });
    assert.equal(L.aplicarSugestoes(e, g), 5);
    assert.equal(e.rotas.length, 5);
    // exceção: o Pica-Pau vai para Animes só ele
    e.desvios[L.chaveSC(cs[4])] = { colecao: 'animes' };
    const { saidas, relatorios } = L.montarSidechain([{ envio: e, canais: cs }], cfgMista);
    const por = Object.fromEntries(saidas.map(s => [s.chave, s.itens.length]));
    assert.deepEqual(por, { 'sc-filmes': 2, 'sc-series': 1, 'sc-animes': 2 });
    assert.equal(relatorios.mx.ignorados + relatorios.mx.filtrados, 1);
    // grupo que aparece depois espera (🔔) — ou vai pela sugestão, se o envio quiser
    const novo = L.lerLista('#EXTM3U\n#EXTINF:-1 group-title="Lançamentos 2026",Filme X (2026)\nhttp://v/fx.mp4\n', 't').canais;
    const r1 = L.montarSidechain([{ envio: e, canais: cs.concat(novo) }], cfgMista).relatorios.mx;
    assert.deepEqual(r1.gruposNovos, { 'Lançamentos 2026': 1 });
    e.gruposNovos = 'sugestao';
    const r2 = L.montarSidechain([{ envio: e, canais: cs.concat(novo) }], cfgMista);
    assert.equal(r2.saidas.find(s => s.chave === 'sc-filmes').itens.length, 3);
    // mover grupo de rota
    L.moverGrupo(e, 'Desenhos', e.rotas.find(r => r.destino.colecao === 'animes').id);
    assert.equal(L.rotaDe(cs[4], Object.assign({}, e, { desvios: {} })).destino.colecao, 'animes');
});

test('migração: envio antigo vira "uma categoria" e os desvios iguais ao destino somem', () => {
    const desvios = {}; for (let i = 0; i < 1000; i++) desvios['k' + i] = { colecao: 'filmes' };
    desvios.outro = { colecao: 'series' }; desvios.fora = 'ignorar';
    const e = L.envioPadrao({ id: 'f', destino: { colecao: 'filmes' }, desvios });
    assert.equal(e.tipoLista, 'unica');
    assert.deepEqual(Object.keys(e.desvios).sort(), ['fora', 'outro']);
    assert.equal(L.envioPadrao({ rotas: [{ destino: { colecao: 'filmes' }, grupos: ['A'] }] }).tipoLista, 'mista');
});

test('🖼 ficha: a do item e a da série (vale para episódio que chegar depois) saem no JSON do Cloud', () => {
    const cs = L.lerLista(MISTA, 't').canais;
    const e = L.envioPadrao({ id: 'fx', tipoLista: 'mista' });
    L.aplicarSugestoes(e, L.analisarGrupos(cs, e, L.colecoesSidechain(cfgMista)));
    const matrix = cs.find(c => /Matrix/.test(c.nome));
    e.ajustes[L.chaveSC(matrix)] = { ficha: { capa: 'https://i/matrix.jpg', fundoImagem: 'banner', banner: 'https://i/mb.jpg', posFundo: 20, destaque: true } };
    const lost = cs.find(c => /Lost/.test(c.nome));
    e.fichasSerie[L.chaveSerie(lost)] = { descricao: 'Ilha misteriosa.', posFundo: 75 };
    const novoEp = L.lerLista('#EXTM3U\n#EXTINF:-1 group-title="Séries | Drama",Lost S01E02\nhttp://v/lost2.mp4\n', 't').canais;
    const { saidas } = L.montarSidechain([{ envio: e, canais: cs.concat(novoEp) }], cfgMista);
    const fil = JSON.parse(L.gerarJSON(saidas.find(s => s.chave === 'sc-filmes').itens)).find(i => /Matrix/.test(i.title));
    assert.equal(fil.thumb, 'https://i/matrix.jpg'); assert.equal(fil.bannerThumb, 'https://i/mb.jpg');
    assert.equal(fil.bgImg, 'banner'); assert.equal(fil.bgPosY, 20); assert.equal(fil.destaque, true);
    const eps = JSON.parse(L.gerarJSON(saidas.find(s => s.chave === 'sc-series').itens));
    assert.equal(eps.length, 2);
    assert.ok(eps.every(i => i.desc === 'Ilha misteriosa.' && i.bgPosY === 75));
    // apagar campo: '' tira
    assert.deepEqual(L.juntarFicha({ capa: 'x', descricao: 'y' }, { capa: '' }), { descricao: 'y' });
});
