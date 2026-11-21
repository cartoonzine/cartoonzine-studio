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
