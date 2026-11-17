// Link Edit — teste de canais e túnel, com um "servidor IPTV" de mentira: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { testarCanal, lerHLS, reescreverM3U8, baixarLista, tunel } from '../tools/linkedit-rede.mjs';

// o túnel e o teste recusam endereços internos; nos testes o "IPTV" fica em 127.0.0.1, então o fetch é redirecionado
function servidorIPTV() {
    const srv = http.createServer((req, res) => {
        const u = req.url, ua = req.headers['user-agent'] || '';
        if (u === '/vivo/master.m3u8') { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\nhi/index.m3u8\n'); }
        if (u === '/vivo/low.m3u8') { res.writeHead(200); return res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nseg1.ts\n#EXTINF:6,\nhttp://cdn.x/seg2.ts\n'); }
        if (u === '/vivo/seg1.ts') { res.writeHead(206); return res.end(Buffer.from([0x47, 1, 2, 3])); }
        if (u === '/vazio.m3u8') { res.writeHead(200); return res.end('#EXTM3U\n#EXT-X-ENDLIST\n'); }
        if (u === '/sem-video/index.m3u8') { res.writeHead(200); return res.end('#EXTM3U\n#EXTINF:6,\nfalta.ts\n'); }
        if (u === '/vlc.ts') { if (!/VLC/.test(ua)) { res.writeHead(403); return res.end(); } res.writeHead(200, { 'Content-Type': 'video/mp2t' }); return res.end(Buffer.from([0x47, 0, 0])); }
        if (u === '/pagina') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><p>oi'); }
        if (u === '/geo.m3u8') { res.writeHead(403); return res.end(); }
        if (u === '/lento.ts') { setTimeout(() => { res.writeHead(200); res.end(Buffer.from([0x47])); }, 300); return; }
        if (u === '/lista.m3u') { res.writeHead(200); return res.end('#EXTM3U\n#EXTINF:-1,Um\nhttp://a/1.m3u8\n'); }
        res.writeHead(404); res.end();
    });
    return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok(srv)));
}
const montar = (srv) => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    // "iptv.exemplo" → servidor local (assim o bloqueio de endereço interno continua valendo de verdade)
    const fetchFn = (u, o) => fetch(String(u).replace('http://iptv.exemplo', base), o);
    return { fetchFn };
};

test('testarCanal: HLS mestre→variante→pedaço, vazio, sem vídeo, página, bloqueado, pede UA, lento, interno', async () => {
    const srv = await servidorIPTV(); const { fetchFn } = montar(srv);
    const T = (p, o = {}) => testarCanal('http://iptv.exemplo' + p, Object.assign({ fetchFn }, o));
    const vivo = await T('/vivo/master.m3u8');
    assert.equal(vivo.status, 'vivo'); assert.equal(vivo.tipo, 'hls'); assert.equal(vivo.resolucao, '1280x720');
    assert.equal((await T('/vazio.m3u8')).status, 'morto');
    const semVideo = await T('/sem-video/index.m3u8');
    assert.equal(semVideo.status, 'morto'); assert.match(semVideo.motivo, /vídeo não chega/);
    assert.equal((await T('/sem-video/index.m3u8', { modo: 'rapido' })).status, 'vivo', 'no rápido só a lista conta');
    assert.match((await T('/pagina')).motivo, /página/);
    assert.equal((await T('/geo.m3u8')).status, 'bloqueado');
    const vlc = await T('/vlc.ts');
    assert.equal(vlc.status, 'pede-ua'); assert.match(vlc.ua, /VLC/); assert.equal(vlc.tipo, 'mpegts');
    assert.equal((await T('/nao-existe.m3u8')).status, 'morto');
    const lento = await testarCanal('http://iptv.exemplo/lento.ts', { fetchFn, timeout: 2000 });
    assert.equal(lento.status, 'vivo'); assert.ok(lento.ms >= 250);
    assert.equal((await testarCanal('http://127.0.0.1:1/x.m3u8')).status, 'morto', 'endereço interno é recusado');
    assert.equal((await testarCanal('magnet:?xt=urn:btih:abc')).status, 'desconhecido');
    srv.closeAllConnections(); srv.close();
});

test('HLS: leitura da lista e reescrita para o túnel (variantes, pedaços, chave)', () => {
    const l = lerHLS('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1x1\nv/a.m3u8\n', 'http://x/p/m.m3u8');
    assert.equal(l.mestre, true); assert.equal(l.variantes[0].url, 'http://x/p/v/a.m3u8');
    const r = reescreverM3U8('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k.bin"\n#EXTINF:6,\nseg.ts\nhttp://cdn/x.ts\n', 'http://x/p/i.m3u8', (u) => 'T?u=' + encodeURIComponent(u));
    assert.match(r, /URI="T\?u=http%3A%2F%2Fx%2Fp%2Fk\.bin"/); assert.match(r, /\nT\?u=http%3A%2F%2Fx%2Fp%2Fseg\.ts\n/); assert.match(r, /T\?u=http%3A%2F%2Fcdn%2Fx\.ts/);
});

test('túnel: repassa User-Agent, reescreve a lista HLS e entrega o pedaço; recusa endereço interno', async () => {
    const srv = await servidorIPTV(); const { fetchFn } = montar(srv);
    const painel = http.createServer((req, res) => tunel(req, res, '/t', { fetchFn }));
    await new Promise(ok => painel.listen(0, '127.0.0.1', ok));
    const p = `http://127.0.0.1:${painel.address().port}`;
    try {
    const lista = await (await fetch(`${p}/t?u=${encodeURIComponent('http://iptv.exemplo/vivo/low.m3u8')}&ua=VLC`)).text();
    assert.match(lista, /\/t\?u=http%3A%2F%2F[^\n]*%2Fvivo%2Fseg1\.ts&ua=VLC\n/); assert.match(lista, /URI="\/t\?u=[^"]*key\.bin&ua=VLC"/);
    const seg = await fetch(`${p}/t?u=${encodeURIComponent('http://iptv.exemplo/vlc.ts')}&ua=VLC/3`);
    assert.equal(seg.status, 200); assert.equal(Buffer.from(await seg.arrayBuffer())[0], 0x47);
    assert.equal((await fetch(`${p}/t?u=${encodeURIComponent('http://127.0.0.1:9/x')}`)).status, 403);
    assert.equal((await baixarLista('http://iptv.exemplo/lista.m3u', { fetchFn })).texto.split('\n').length, 4);
    } finally { painel.closeAllConnections(); painel.close(); srv.closeAllConnections(); srv.close(); }
});
