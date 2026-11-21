/**
 * ☁️ TESTADOR NA NUVEM do Link Edit (Cloudflare Workers, plano grátis).
 * Faz o Scan e abre listas quando o Studio está ONLINE (sem o painel do PC):
 *   GET /testar?url=…&modo=rapido|completo&ua=…&ref=…&t=TOKEN  → { status, ms, tipo, resolucao, motivo, http }
 *   GET /lista?url=…&t=TOKEN                                     → o texto da lista (sem bloqueio de CORS)
 * Status iguais aos do painel: vivo · lento · pede-ua · bloqueado · morto · desconhecido.
 * Proteção: só responde com o TOKEN certo (variável secreta TOKEN) e nunca acessa endereço interno.
 * Instalação em tools/testador-nuvem/LEIAME.md.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const UA_VLC = 'VLC/3.0.20 LibVLC/3.0.20';
const LENTO_MS = 6000;
const INTERNO = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Cache-Control': 'no-store' };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS) });

function permitida(u) { let x; try { x = new URL(u); } catch (e) { return null; } return /^https?:$/.test(x.protocol) && !INTERNO.test(x.hostname) ? x : null; }

async function pegar(url, { ua = UA, ref, limite = 256 * 1024, faixa, timeout = 8000 } = {}) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    try {
        const h = { 'User-Agent': ua, Accept: '*/*' };
        if (ref) { h.Referer = ref; try { h.Origin = new URL(ref).origin; } catch (e) { /* */ } }
        if (faixa) h.Range = faixa;
        const r = await fetch(url, { headers: h, redirect: 'follow', signal: ctl.signal });
        if (!r.ok && r.status !== 206) { try { r.body && r.body.cancel(); } catch (e) { /* */ } return { ok: false, status: r.status }; }
        const leitor = r.body.getReader(); const partes = []; let n = 0;
        while (n < limite) { const { done, value } = await leitor.read(); if (done) break; partes.push(value); n += value.length; }
        try { leitor.cancel(); } catch (e) { /* */ }
        const buf = new Uint8Array(n); let o = 0; for (const p of partes) { buf.set(p.subarray(0, Math.min(p.length, n - o)), o); o += p.length; if (o >= n) break; }
        return { ok: true, status: r.status, buf, tipo: r.headers.get('content-type') || '', final: r.url, tamanho: +(r.headers.get('content-range') || '').split('/')[1] || +r.headers.get('content-length') || 0 };
    } catch (e) { return { ok: false, erro: e.name === 'AbortError' ? 'não respondeu em ' + timeout / 1000 + ' s' : e.message }; }
    finally { clearTimeout(t); }
}
const texto = (buf, n = buf.length) => new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, n));
const ehM3U8 = (buf) => /^\s*#EXTM3U/.test(texto(buf, 64));
function lerHLS(t, base) {
    const linhas = t.split(/\r?\n/), variantes = [], pedacos = [];
    for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i].trim();
        if (/^#EXT-X-STREAM-INF/i.test(l)) { const nx = (linhas[i + 1] || '').trim(); const res = /RESOLUTION=(\d+x\d+)/i.exec(l), bw = /BANDWIDTH=(\d+)/i.exec(l); if (nx && !nx.startsWith('#')) variantes.push({ url: new URL(nx, base).href, resolucao: res ? res[1] : '', banda: bw ? +bw[1] : 0 }); }
        else if (l && !l.startsWith('#') && !variantes.length) pedacos.push(new URL(l, base).href);
    }
    return { mestre: variantes.length > 0, variantes, pedacos };
}
function container(buf) {
    const s = texto(buf, 16), b = buf;
    if (texto(buf, 12).slice(4, 8) === 'ftyp') return 'mp4';
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'mkv';
    if (b[0] === 0x47 && (b.length < 189 || b[188] === 0x47)) return 'mpegts';
    if (s.startsWith('FLV')) return 'flv';
    if (s.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
    if (s.startsWith('OggS')) return 'ogg';
    if (s.startsWith('RIFF')) return 'avi';
    return '';
}
async function testar(url, modo, ua0, ref) {
    if (/^(rtmpe?|rtsp|rtp|udp|srt|mms):/i.test(url)) return { status: 'desconhecido', motivo: 'protocolo de transmissão: teste no app', tipo: 'protocolo' };
    if (/^magnet:|\.torrent(\?|$)/i.test(url)) return { status: 'desconhecido', motivo: 'torrent: teste no app', tipo: 'torrent' };
    if (!permitida(url)) return { status: 'morto', motivo: 'link inválido ou endereço interno' };
    const t0 = Date.now();
    let ua = ua0 || UA, r = await pegar(url, { ua, ref });
    if (!r.ok && (r.status === 401 || r.status === 403) && !ua0) { const r2 = await pegar(url, { ua: UA_VLC, ref }); if (r2.ok) { r = r2; ua = UA_VLC; } }
    const fim = (o) => Object.assign({ ms: Date.now() - t0, http: r.status || null, ua: ua !== UA ? ua : undefined, via: 'nuvem' }, o);
    if (!r.ok) {
        if ([401, 403, 451].includes(r.status)) return fim({ status: 'bloqueado', motivo: `HTTP ${r.status} (bloqueio por país, por app ou link vencido) — testado da nuvem` });
        return fim({ status: 'morto', motivo: r.erro || `HTTP ${r.status}` });
    }
    let tipo = '', resolucao = '';
    if (ehM3U8(r.buf)) {
        tipo = 'hls';
        let l = lerHLS(texto(r.buf), r.final);
        if (l.mestre) {
            resolucao = (l.variantes.slice().sort((a, b) => b.banda - a.banda)[0] || {}).resolucao || '';
            const v = l.variantes.slice().sort((a, b) => a.banda - b.banda)[0];
            const rv = await pegar(v.url, { ua, ref });
            if (!rv.ok || !ehM3U8(rv.buf)) return fim({ status: 'morto', tipo, motivo: 'a lista do canal abre, mas a qualidade escolhida não' });
            l = lerHLS(texto(rv.buf), rv.final);
        }
        if (!l.pedacos.length) return fim({ status: 'morto', tipo, motivo: 'a lista HLS está vazia (canal fora do ar)' });
        if (modo === 'completo') {
            const p = l.pedacos[l.pedacos.length > 3 ? l.pedacos.length - 3 : 0];
            const rs = await pegar(p, { ua, ref, limite: 64 * 1024, faixa: 'bytes=0-65535' });
            if (!rs.ok || !rs.buf.length) return fim({ status: 'morto', tipo, resolucao, motivo: 'a lista abre, mas o vídeo não chega' });
        }
    } else if (/text\/html/i.test(r.tipo) || /^\s*<(!doctype|html)/i.test(texto(r.buf, 64))) {
        return fim({ status: 'morto', tipo: 'pagina', motivo: 'o link abre uma página, não um vídeo' });
    } else {
        if (!r.buf.length) return fim({ status: 'morto', motivo: 'o servidor respondeu vazio' });
        tipo = container(r.buf) || 'arquivo';
    }
    const ms = Date.now() - t0;
    return fim({ status: ms > LENTO_MS ? 'lento' : ua === UA_VLC ? 'pede-ua' : 'vivo', tipo, resolucao, ms, tamanho: r.tamanho || undefined,
        motivo: ua === UA_VLC ? 'só abre com o User-Agent de player (VLC)' : undefined });
}

export default {
    async fetch(req, env) {
        if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
        const u = new URL(req.url);
        if (env.TOKEN && u.searchParams.get('t') !== env.TOKEN) return json({ erro: 'token errado' }, 401);
        const alvo = u.searchParams.get('url') || '';
        if (u.pathname === '/testar') return json(await testar(alvo, u.searchParams.get('modo') || 'rapido', u.searchParams.get('ua') || '', u.searchParams.get('ref') || ''));
        if (u.pathname === '/lista') {
            if (!permitida(alvo)) return json({ erro: 'link inválido ou endereço interno' }, 400);
            const r = await pegar(alvo, { limite: 60 * 1024 * 1024, timeout: 30000 });
            if (!r.ok) return json({ erro: r.erro || 'HTTP ' + r.status }, 502);
            return json({ texto: texto(r.buf), final: r.final });
        }
        return json({ ok: true, servico: 'Testador do Link Edit (Cartoonzine Studio)' });
    }
};
