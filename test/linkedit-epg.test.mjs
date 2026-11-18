// Link Edit — guias (EPG/XMLTV): ler canais, comparar nomes igual ao Cloud, programação e exportação
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { canaisDoGuia, programacao } from '../tools/linkedit-epg.mjs';
const L = createRequire(import.meta.url)('../core/linkedit-core.js');

const agora = Date.now();
const xt = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
const XML = `<?xml version="1.0" encoding="UTF-8"?><tv>
<channel id="Globo.br"><display-name>Globo SP HD</display-name><icon src="http://logos/globo.png"/></channel>
<channel id="CartoonNetwork.br"><display-name lang="pt">Cartoon Network</display-name></channel>
<channel id="CartoonNetwork.mx"><display-name>Cartoon Network</display-name></channel>
<programme start="${xt(agora - 600000)}" stop="${xt(agora + 1800000)}" channel="Globo.br"><title>Jornal &amp; Cia</title><desc>Notícias</desc></programme>
<programme start="${xt(agora + 1800000)}" stop="${xt(agora + 3600000)}" channel="Globo.br"><title>Novela</title></programme>
<programme start="${xt(agora - 86400000)}" stop="${xt(agora - 82800000)}" channel="Globo.br"><title>Velho</title></programme>
</tv>`;

test('guia XMLTV (.gz): canais até a programação, agora/a seguir; nomes casam igual ao Cloud', async () => {
    const gz = zlib.gzipSync(XML);
    const srv = http.createServer((req, res) => { res.writeHead(200); res.end(req.url === '/guia.xml.gz' ? gz : XML); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + srv.address().port;
    const fetchFn = (u, o) => fetch(String(u).replace('http://guia.exemplo', base), o);
    try {
        const cs = await canaisDoGuia('http://guia.exemplo/guia.xml.gz', { fetchFn });
        assert.deepEqual(cs.map(c => c.id), ['Globo.br', 'CartoonNetwork.br', 'CartoonNetwork.mx']);
        assert.equal(cs[0].icone, 'http://logos/globo.png'); assert.equal(cs[0].pais, 'BR');
        const p = await programacao('http://guia.exemplo/guia.xml', 'Globo.br', { fetchFn });
        assert.equal(p.agora[2], 'Jornal & Cia'); assert.equal(p.seguintes[0][2], 'Novela'); assert.equal(p.total, 2, 'fora da janela não entra');
        await assert.rejects(canaisDoGuia('http://127.0.0.1:1/x.xml'), /interno/);
    } finally { srv.closeAllConnections(); srv.close(); }
});

test('ligar canal ao guia: tvg-id vira o código do guia, país decide entre iguais, M3U leva url-tvg e tvg-shift', () => {
    const indice = L.canaisXMLTV(XML).map(g => Object.assign(g, { guia: 'https://g/br.xml.gz' }));
    const [cn] = L.lerLista('#EXTM3U\n#EXTINF:-1 group-title="Kids",Cartoon Network [BR]\nhttp://s/cn.m3u8\n').canais;
    const r = L.acharNoGuia(indice, cn);
    assert.equal(r[0].canal.id, 'CartoonNetwork.br'); assert.ok(r[0].pontos >= 85); assert.ok(r[1].pontos < r[0].pontos, 'o do México fica atrás');
    const [g] = L.lerLista('#EXTM3U\n#EXTINF:-1,GLOBO SP FHD\nhttp://s/g.m3u8\n').canais;
    assert.equal(L.acharNoGuia(indice, g)[0].canal.id, 'Globo.br', '"GLOBO SP FHD" = "Globo SP HD" (mesmas chaves do Cloud)');
    L.ligarGuia(cn, r[0].canal, -3);
    assert.equal(cn.tvgId, 'CartoonNetwork.br'); assert.equal(cn.epgGuia, 'https://g/br.xml.gz'); assert.equal(cn.chave, 'id:cartoonnetwork.br');
    const m3u = L.gerarM3U([cn], { epg: 'https://outra/epg.xml' });
    assert.match(m3u, /url-tvg="https:\/\/outra\/epg.xml,https:\/\/g\/br.xml.gz"/); assert.match(m3u, /tvg-id="CartoonNetwork.br"/); assert.match(m3u, /tvg-shift="-3"/);
    assert.equal(L.lerLista(m3u).canais[0].epgShift, -3);
    assert.equal(JSON.parse(L.gerarJSON([cn]))[0].epg, 'https://g/br.xml.gz');
    L.ligarGuia(cn, null);
    assert.equal(cn.tvgId, '', 'tirar o guia volta o tvg-id de antes'); assert.equal(cn.epgId, undefined);
    assert.deepEqual(L.chavesEPG('TV Globo Brasil HD'), ['tvglobobrasil', 'globobrasil', 'tvglobo', 'globo']);
});
