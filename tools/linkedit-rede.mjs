/**
 * 🔗 Link Edit — a parte de REDE (roda no painel local, node tools/painel.mjs):
 *   testarCanal(url)   → abre o canal de verdade: HLS (lista mestre → variante → 1º pedaço), TS, MP4…
 *                        { status: vivo|lento|morto|bloqueado|pede-ua, ms, http, tipo, resolucao, motivo, ua }
 *   baixarLista(url)   → texto de uma lista (M3U/JSON/TXT) sem o bloqueio de CORS do navegador
 *   tunel(req, res)    → o visualizador toca pelo painel: manda User-Agent/Referer do canal e reescreve
 *                        as listas HLS para os pedaços também passarem pelo túnel (canais sem CORS tocam)
 * Endereços internos (localhost, rede da casa) são recusados: o painel não vira porta de entrada para a sua rede.
 */
const UA_PADRAO = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const UA_VLC = 'VLC/3.0.20 LibVLC/3.0.20';
const INTERNO = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd])/i;
const LENTO_MS = 4000;

// só para os testes automáticos (servidor de canais de mentira em 127.0.0.1); nunca ligado no uso normal
const PERMITIR_INTERNO = typeof process !== 'undefined' && process.env && process.env.CZ_LINKEDIT_TESTE === '1';
export function urlPermitida(u) {
    let x; try { x = new URL(u); } catch (e) { return null; }
    if (!/^https?:$/.test(x.protocol) || (INTERNO.test(x.hostname) && !PERMITIR_INTERNO)) return null;
    return x;
}

/** GET com tempo limite; lê no máximo `limite` bytes (o resto é descartado). */
async function pegar(url, { ua = UA_PADRAO, referer, timeout = 8000, limite = 256 * 1024, fetchFn = fetch, intervalo } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    const t0 = Date.now();
    try {
        const headers = { 'User-Agent': ua, Accept: '*/*' };
        if (referer) { headers.Referer = referer; try { headers.Origin = new URL(referer).origin; } catch (e) { /* */ } }
        if (intervalo) headers.Range = intervalo;
        const r = await fetchFn(url, { redirect: 'follow', signal: ctl.signal, headers });
        const ms = Date.now() - t0;
        const partes = []; let n = 0;
        if (r.body && r.body.getReader) {
            const leitor = r.body.getReader();
            while (n < limite) { const { done, value } = await leitor.read(); if (done) break; partes.push(value); n += value.length; }
            try { await leitor.cancel(); } catch (e) { /* */ }
        }
        const buf = Buffer.concat(partes.map(p => Buffer.from(p))).subarray(0, limite);
        const cr = /\/(\d+)\s*$/.exec(r.headers.get('content-range') || ''), cl = +(r.headers.get('content-length') || 0);
        return { ok: r.ok || r.status === 206, status: r.status, final: r.url || url, tipo: (r.headers.get('content-type') || '').split(';')[0].trim(), ms, buf, tamanho: cr ? +cr[1] : (r.status === 200 ? cl : 0) };
    } catch (e) {
        return { ok: false, status: 0, erro: e.name === 'AbortError' ? 'sem resposta em ' + Math.round(timeout / 1000) + ' s' : ((e.cause && e.cause.code) || e.message), ms: Date.now() - t0 };
    } finally { clearTimeout(t); }
}

/** Formato real do arquivo pelos primeiros bytes (o nome e o content-type das listas mentem muito). */
export function containerDe(b) {
    if (!b || !b.length) return '';
    if (b[0] === 0x47 && (b.length < 189 || b[188] === 0x47)) return 'mpegts';
    if (b.length < 4) return '';
    const txt = (i, n) => b.toString('latin1', i, i + n);
    if (b.length >= 12 && txt(4, 4) === 'ftyp') return /^qt/.test(txt(8, 4)) ? 'mov' : 'mp4';
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return b.toString('latin1', 0, 64).includes('webm') ? 'webm' : 'mkv';
    if (txt(0, 4) === 'RIFF') return txt(8, 4) === 'AVI ' ? 'avi' : txt(8, 4) === 'WAVE' ? 'wav' : '';
    if (txt(0, 3) === 'FLV') return 'flv';
    if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0xba) return 'mpeg';
    if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75) return 'wmv';
    if (txt(0, 4) === '.RMF') return 'rmvb';
    if (txt(0, 4) === 'OggS') return 'ogg';
    if (txt(0, 4) === 'fLaC') return 'flac';
    if (txt(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
    return '';
}
/** O navegador (o visualizador do Studio) toca? sim | talvez | nao. No app (VLC/ExoPlayer) quase tudo toca. */
export const TOCA_NO_NAVEGADOR = { mp4: 'sim', webm: 'sim', mp3: 'sim', ogg: 'sim', wav: 'sim', flac: 'sim', mpegts: 'sim', flv: 'sim', mkv: 'talvez', mov: 'talvez', avi: 'nao', wmv: 'nao', mpeg: 'nao', rmvb: 'nao' };

const ehM3U8 = (b) => /^\s*#EXTM3U/.test(b.toString('utf8', 0, 64));
const absoluta = (u, base) => { try { return new URL(u, base).href; } catch (e) { return u; } };

/** O que a lista HLS diz: { mestre, variantes:[{url, resolucao, banda}], pedacos:[url] } */
export function lerHLS(texto, base) {
    const linhas = String(texto).split(/\r?\n/);
    const variantes = [], pedacos = [];
    let info = null;
    for (const l0 of linhas) {
        const l = l0.trim();
        if (!l) continue;
        if (/^#EXT-X-STREAM-INF/i.test(l)) {
            const res = /RESOLUTION=(\d+x\d+)/i.exec(l), bw = /BANDWIDTH=(\d+)/i.exec(l);
            info = { resolucao: res ? res[1] : '', banda: bw ? +bw[1] : 0 };
            continue;
        }
        if (l[0] === '#') continue;
        if (info) { variantes.push(Object.assign({ url: absoluta(l, base) }, info)); info = null; }
        else pedacos.push(absoluta(l, base));
    }
    return { mestre: variantes.length > 0, variantes, pedacos };
}

/**
 * Testa um canal. modo: 'rapido' (o link e a lista respondem) | 'completo' (também baixa o 1º pedaço do vídeo).
 * Se o servidor recusar o navegador (401/403), tenta como VLC: deu certo = "pede-ua" (o canal guarda o UA).
 */
export async function testarCanal(url, { modo = 'completo', ua, referer, fetchFn = fetch, timeout = 8000 } = {}) {
    if (/^(rtmpe?|rtsp|rtp|udp|srt|mms):/i.test(url)) return { status: 'desconhecido', motivo: 'protocolo de transmissão: teste no visualizador do app', tipo: 'protocolo' };
    if (/^magnet:|\.torrent(\?|$)/i.test(url)) return { status: 'desconhecido', motivo: 'torrent: teste no visualizador do app', tipo: 'torrent' };
    if (!urlPermitida(url)) return { status: 'morto', motivo: 'link inválido ou endereço interno' };
    const t0 = Date.now();
    let uaUsado = ua || UA_PADRAO;
    let r = await pegar(url, { ua: uaUsado, referer, fetchFn, timeout });
    if (!r.ok && (r.status === 401 || r.status === 403) && !ua) {
        const r2 = await pegar(url, { ua: UA_VLC, referer, fetchFn, timeout });
        if (r2.ok) { r = r2; uaUsado = UA_VLC; }
    }
    const fim = (o) => Object.assign({ ms: Date.now() - t0, http: r.status || null, ua: uaUsado !== UA_PADRAO ? uaUsado : undefined }, o);
    if (!r.ok) {
        if (r.status === 401 || r.status === 403 || r.status === 451) return fim({ status: 'bloqueado', motivo: `HTTP ${r.status} (bloqueio por país, por app ou link vencido)` });
        return fim({ status: 'morto', motivo: r.erro || `HTTP ${r.status}` });
    }
    let resolucao = '', tipo = r.tipo, aviso = '';
    if (ehM3U8(r.buf)) {
        tipo = 'hls';
        let lista = lerHLS(r.buf.toString('utf8'), r.final);
        if (lista.mestre) {
            // a menor variante: o teste é rápido e a que mais funciona
            const v = lista.variantes.slice().sort((a, b) => (a.banda || 0) - (b.banda || 0))[0];
            resolucao = (lista.variantes.slice().sort((a, b) => (b.banda || 0) - (a.banda || 0))[0] || {}).resolucao || '';
            const rv = await pegar(v.url, { ua: uaUsado, referer, fetchFn, timeout });
            if (!rv.ok || !ehM3U8(rv.buf)) return fim({ status: 'morto', tipo, motivo: 'a lista do canal abre, mas a qualidade escolhida não (' + (rv.erro || 'HTTP ' + rv.status) + ')' });
            lista = lerHLS(rv.buf.toString('utf8'), rv.final);
        }
        if (!lista.pedacos.length) return fim({ status: 'morto', tipo, motivo: 'a lista HLS está vazia (canal fora do ar)' });
        if (modo === 'completo') {
            const pedaco = lista.pedacos[lista.pedacos.length > 3 ? lista.pedacos.length - 3 : 0];
            const rs = await pegar(pedaco, { ua: uaUsado, referer, fetchFn, timeout, limite: 64 * 1024, intervalo: 'bytes=0-65535' });
            if (!rs.ok || !rs.buf.length) return fim({ status: 'morto', tipo, resolucao, motivo: 'a lista abre, mas o vídeo não chega (' + (rs.erro || 'HTTP ' + rs.status) + ')' });
        }
    } else if (/text\/html/i.test(r.tipo) || /^\s*<(!doctype|html)/i.test(r.buf.toString('utf8', 0, 64))) {
        return fim({ status: 'morto', tipo: 'pagina', motivo: 'o link abre uma página, não um vídeo' });
    } else {
        if (!r.buf.length) return fim({ status: 'morto', motivo: 'o servidor respondeu vazio' });
        tipo = containerDe(r.buf) || 'arquivo';          // MP4, MKV, AVI… pelo conteúdo (o tipo do servidor varia muito)
        if (tipo === 'mp4' || tipo === 'mov') {
            // o "índice" (moov) no fim do arquivo: no navegador demora a começar (precisa pular para o fim antes)
            const ini = r.buf.toString('latin1', 0, Math.min(r.buf.length, 256 * 1024));
            if (!ini.includes('moov') && ini.includes('mdat')) aviso = 'o índice do MP4 está no fim do arquivo: demora um pouco para começar';
        }
        const toca = TOCA_NO_NAVEGADOR[tipo];
        if (toca === 'nao') aviso = `link vivo; o navegador não toca ${tipo.toUpperCase()}, mas o app (VLC/ExoPlayer) toca`;
        else if (toca === 'talvez' && !aviso) aviso = `${tipo.toUpperCase()}: o navegador toca se o vídeo for H.264/H.265; senão, só no app`;
    }
    const ms = Date.now() - t0;
    const out = fim({ status: ms > LENTO_MS ? 'lento' : (uaUsado === UA_VLC ? 'pede-ua' : 'vivo'), tipo, resolucao, ms, tamanho: r.tamanho || undefined });
    if (aviso) out.motivo = aviso;
    if (uaUsado === UA_VLC) out.motivo = 'só abre com o User-Agent de player (VLC) — guardado no canal' + (aviso ? '; ' + aviso : '');
    return out;
}

/** Texto de uma lista (até 60 MB). */
export async function baixarLista(url, { fetchFn = fetch } = {}) {
    if (!urlPermitida(url)) throw new Error('link inválido ou endereço interno');
    const r = await pegar(url, { fetchFn, timeout: 45000, limite: 60 * 1024 * 1024 });
    if (!r.ok) throw new Error(r.erro || 'HTTP ' + r.status);
    return { texto: r.buf.toString('utf8'), final: r.final };
}

/** Reescreve uma lista HLS para cada endereço (variantes, pedaços, chaves, legendas) passar pelo túnel. */
export function reescreverM3U8(texto, base, viaTunel) {
    return String(texto).split(/\r?\n/).map((l) => {
        const t = l.trim();
        if (!t) return l;
        if (t[0] === '#') return l.replace(/URI="([^"]+)"/g, (m, u) => `URI="${viaTunel(absoluta(u, base))}"`);
        return viaTunel(absoluta(t, base));
    }).join('\n');
}

/**
 * Túnel do visualizador: GET /api/tunel?u=<link>&ua=&ref=  → repassa (com Range) e reescreve listas HLS.
 * prefixo: endereço do próprio túnel (para montar os links reescritos).
 */
export async function tunel(req, res, prefixo, { fetchFn = fetch } = {}) {
    const q = new URL(req.url, 'http://x').searchParams;
    const alvo = urlPermitida(q.get('u') || '');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (!alvo) { res.writeHead(403, cors); return res.end('link inválido ou endereço interno'); }
    const ua = q.get('ua') || UA_PADRAO, ref = q.get('ref') || '';
    const viaTunel = (u) => `${prefixo}?u=${encodeURIComponent(u)}${q.get('ua') ? '&ua=' + encodeURIComponent(ua) : ''}${ref ? '&ref=' + encodeURIComponent(ref) : ''}`;
    const ctl = new AbortController();
    req.on('close', () => ctl.abort());
    try {
        const headers = { 'User-Agent': ua, Accept: '*/*' };
        if (ref) { headers.Referer = ref; try { headers.Origin = new URL(ref).origin; } catch (e) { /* */ } }
        if (req.headers.range) headers.Range = req.headers.range;
        const r = await fetchFn(alvo.href, { redirect: 'follow', signal: ctl.signal, headers });
        const tipo = r.headers.get('content-type') || '';
        const pareceLista = /mpegurl|m3u/i.test(tipo) || /\.m3u8?(\?|$)/i.test(alvo.pathname);
        if (pareceLista && r.ok) {
            const texto = await r.text();
            if (/^\s*#EXTM3U/.test(texto)) {
                res.writeHead(200, Object.assign({ 'Content-Type': 'application/vnd.apple.mpegurl' }, cors));
                return res.end(reescreverM3U8(texto, r.url || alvo.href, viaTunel));
            }
            res.writeHead(r.status, Object.assign({ 'Content-Type': tipo || 'text/plain' }, cors));
            return res.end(texto);
        }
        const h = Object.assign({}, cors);
        for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = r.headers.get(k); if (v) h[k] = v; }
        res.writeHead(r.status, h);
        if (!r.body) return res.end();
        const leitor = r.body.getReader();
        for (;;) { const { done, value } = await leitor.read(); if (done) break; if (!res.write(Buffer.from(value))) await new Promise(ok => res.once('drain', ok)); }
        res.end();
    } catch (e) {
        if (!res.headersSent) { res.writeHead(502, cors); res.end(String((e.cause && e.cause.code) || e.message)); }
        else res.destroy();
    }
}
