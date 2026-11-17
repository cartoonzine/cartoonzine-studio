// Link Edit (listas de canais): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../core/linkedit-core.js');

const M3U = `#EXTM3U url-tvg="https://epg.x/guia.xml.gz"
#EXTINF:-1 tvg-id="Globo.br" tvg-logo="https://l/globo.png" group-title="Brasil | Abertos",GLOBO SP FHD [BR]
http://s1/globo.m3u8
#EXTINF:-1 tvg-id="Globo.br" group-title="BR - ABERTOS",Globo SP HD (backup)
http://s2/globo.m3u8
#EXTINF:-1 group-title="KIDS",Cartoon Network [BR]
#EXTVLCOPT:http-user-agent=VLC/3.0
http://s3/cn.ts
#EXTINF:-1 group-title="Infantis",Cartoon Network BR
http://s4/cn/index.m3u8|User-Agent=Mozilla%2F5.0&Referer=https%3A%2F%2Fsite.x
#EXTINF:-1 tvg-country="MX" group-title="Infantil",Cartoon Network
http://s5/cnmx.m3u8
#EXTINF:-1 group-title="XXX",Canal +18
http://s6/a.m3u8
`;

test('M3U: lê tvg-*, grupo, User-Agent (EXTVLCOPT e |), EPG; limpa nomes e descobre país/idioma/tipo', () => {
    const r = L.lerLista(M3U, 'lista1');
    assert.equal(r.formato, 'm3u'); assert.equal(r.epg, 'https://epg.x/guia.xml.gz'); assert.equal(r.canais.length, 6);
    const [g1, g2, cn1, cn2, cnmx, adulto] = r.canais;
    assert.equal(g1.nome, 'Globo SP'); assert.equal(g1.qualidade, 'FHD'); assert.equal(g1.pais, 'BR'); assert.equal(g1.idioma, 'pt-BR'); assert.equal(g1.tipo, 'Abertos');
    assert.equal(g2.nome, 'Globo SP'); assert.equal(g1.chave, g2.chave, 'mesmo tvg-id = mesmo canal');
    assert.equal(cn1.headers['User-Agent'], 'VLC/3.0'); assert.equal(cn1.formato, 'mpegts'); assert.equal(cn1.tipo, 'Infantil'); assert.equal(cn1.pais, 'BR');
    assert.equal(cn2.url, 'http://s4/cn/index.m3u8'); assert.equal(cn2.headers['User-Agent'], 'Mozilla/5.0'); assert.equal(cn2.headers.Referer, 'https://site.x');
    assert.equal(cn1.chave, cn2.chave, 'Cartoon Network [BR] = Cartoon Network BR'); assert.notEqual(cn1.chave, cnmx.chave, 'o do México é outro canal');
    assert.equal(cnmx.idioma, 'es-MX'); assert.equal(adulto.tipo, 'Adulto'); assert.equal(g1.origem, 'lista1');
});

test('JSON e texto solto: formatos comuns, grupos como chaves, "Nome, link" e links no meio do texto', () => {
    const j = L.lerLista(JSON.stringify({ channels: [{ name: 'TV Um', url: 'https://a/1.m3u8', logo: 'x.png', group: 'Notícias', mirrors: ['https://b/1.m3u8'] }, { title: 'sem link' }] }));
    assert.equal(j.formato, 'json'); assert.equal(j.canais.length, 1); assert.deepEqual(j.canais[0].reservas, ['https://b/1.m3u8']); assert.equal(j.canais[0].tipo, 'Notícias');
    const g = L.lerLista(JSON.stringify({ Esportes: [{ nome: 'ESPN', link: 'https://e/1.m3u8' }], Kids: [{ nome: 'Gloob', link: 'https://k/1.m3u8' }] }));
    assert.deepEqual(g.canais.map(c => c.grupo), ['Esportes', 'Kids']);
    const t = L.lerLista('Olha essa lista:\n1. Rede Vida, https://rv/live.m3u8\nTV Cultura | http://cult/x.ts\nlink repetido https://rv/live.m3u8 e magnet:?xt=urn:btih:abc');
    assert.equal(t.formato, 'texto');
    assert.deepEqual(t.canais.map(c => c.nome).slice(0, 2), ['Rede Vida', 'TV Cultura']);
    assert.equal(t.canais.length, 3, 'o link repetido entra uma vez só');
    assert.equal(t.canais[2].formato, 'torrent');
    assert.equal(t.canais[0].tipo, 'Religioso');
});

test('Cópias: principal pela nota (vivo, rápido, qualidade); fixo manual vence; desativado sai', () => {
    const r = L.lerLista(M3U).canais;
    r[0].teste = { status: 'morto' }; r[1].teste = { status: 'vivo', ms: 900 };
    let gr = L.agrupar(r);
    const globo = gr.find(g => g.principal.nome === 'Globo SP');
    assert.equal(globo.principal.url, 'http://s2/globo.m3u8', 'o vivo ganha do FHD morto'); assert.equal(globo.reservas.length, 1);
    r[0].fixo = true;
    gr = L.agrupar(r);
    assert.equal(gr.find(g => g.principal.nome === 'Globo SP').principal.url, 'http://s1/globo.m3u8', 'escolha manual vale');
    r[3].desativado = true;
    gr = L.agrupar(r);
    assert.equal(gr.find(g => g.principal.nome.startsWith('Cartoon') && g.principal.pais === 'BR').reservas.length, 0);
    const novo = L.canalComReservas(L.agrupar(L.lerLista(M3U).canais).find(g => g.principal.nome === 'Globo SP'));
    assert.equal(novo.reservas.length, 1);
});

test('Filtros e contagem; exportar M3U/JSON/TXT e ler de volta sem perder nada', () => {
    const cs = L.lerLista(M3U).canais;
    cs[1].teste = { status: 'vivo' };
    const cont = L.contar(cs);
    assert.equal(cont.tipos.get('Infantil'), 3); assert.equal(cont.chaves.get(cs[0].chave), 2);
    assert.equal(L.filtrar(cs, { tipos: new Set(['Infantil']), paises: new Set(['BR']) }).length, 2);
    assert.equal(L.filtrar(cs, { busca: 'cartoon mx' }).length, 0);
    assert.equal(L.filtrar(cs, { busca: 'cartoon network' }).length, 3);
    assert.equal(L.filtrar(cs, { soVivos: true }).length, 1);
    assert.equal(L.filtrar(cs, { duplicados: true }, cont.chaves).length, 4);
    const saida = [Object.assign({}, cs[2], { reservas: ['http://s4/cn/index.m3u8'] })];
    const m3u = L.gerarM3U(saida, { epg: 'https://epg.x/g.xml' });
    const volta = L.lerLista(m3u).canais[0];
    assert.equal(volta.nome, 'Cartoon Network'); assert.equal(volta.headers['User-Agent'], 'VLC/3.0'); assert.equal(volta.grupo, 'Infantil'); assert.equal(volta.pais, 'BR');
    assert.equal(L.lerLista(L.gerarM3U(saida, { reservasComoLinhas: true })).canais.length, 2);
    const json = JSON.parse(L.gerarJSON(saida));
    assert.deepEqual(json[0].mirrors, ['http://s4/cn/index.m3u8']); assert.equal(json[0].language, 'pt-BR');
    assert.equal(L.lerLista(L.gerarJSON(saida)).canais[0].reservas[0], 'http://s4/cn/index.m3u8');
    assert.equal(L.gerarTXT(saida), 'Cartoon Network, http://s3/cn.ts\n');
    // nome com aspas e quebra não quebra o M3U
    assert.equal(L.lerLista(L.gerarM3U([Object.assign({}, cs[0], { nome: 'A "B"\nC' })])).canais.length, 1);
});

test('Nomes: tudo maiúsculo vira normal, siglas ficam; tags e qualidade saem', () => {
    assert.equal(L.limparNome('CARTOON NETWORK HD'), 'Cartoon Network');
    assert.equal(L.limparNome('SBT FHD [BR] (backup)'), 'SBT');
    assert.equal(L.limparNome('HBO 2 ★ 1080p'), 'HBO 2');
    assert.equal(L.limparNome('Discovery Kids'), 'Discovery Kids');
    assert.equal(L.formatoDe('http://x/live/u/p/123'), 'mpegts');
    assert.equal(L.formatoDe('https://x/a.mpd?t=1'), 'dash');
    assert.equal(L.formatoDe('rtmp://x/live'), 'protocolo');
});
