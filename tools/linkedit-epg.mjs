/**
 * 🔗 Link Edit — GUIAS (EPG/XMLTV), parte de rede do painel local.
 *   canaisDoGuia(url)       → só a lista de canais do guia ({ id, nomes, icone, pais }); para de ler quando a
 *                             programação começa, então um guia de 200 MB vira um índice pequeno em segundos
 *   programacao(url, id)    → o que passa agora e a seguir naquele canal (lê o guia inteiro uma vez e guarda
 *                             só a janela de -2 h a +8 h de todos os canais por 20 minutos)
 * .xml e .xml.gz (descompacta pelos bytes, não pelo nome). Mesma trava de endereço interno do resto do Link Edit.
 */
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { urlPermitida } from './linkedit-rede.mjs';

const L = createRequire(import.meta.url)('../core/linkedit-core.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const LIMITE = 400 * 1024 * 1024;     // texto lido no máximo (descompactado)

async function* abrirTexto(url, { fetchFn = fetch, timeout = 120000, sinal } = {}) {
    if (!urlPermitida(url)) throw new Error('link inválido ou endereço interno');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    if (sinal) sinal.onParar = () => ctl.abort();
    try {
        const r = await fetchFn(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: '*/*' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const corpo = Readable.fromWeb(r.body);
        const it = corpo[Symbol.asyncIterator]();
        const p = await it.next();
        if (p.done) return;
        const gz = p.value[0] === 0x1f && p.value[1] === 0x8b;
        const bruto = Readable.from((async function* () { yield p.value; for (;;) { const n = await it.next(); if (n.done) return; yield n.value; } })());
        const fluxo = gz ? bruto.pipe(zlib.createGunzip()) : bruto;
        fluxo.setEncoding('utf8');
        let n = 0;
        try {
            for await (const pedaco of fluxo) {
                n += pedaco.length;
                if (n > LIMITE) throw new Error('guia grande demais');
                yield pedaco;
            }
        } finally { try { corpo.destroy(); fluxo.destroy(); } catch (e) { /* */ } }
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('o guia demorou demais para responder');
        throw e;
    } finally { clearTimeout(t); ctl.abort(); }
}

const cacheCanais = new Map();      // url → { em, canais } | Promise
const cacheProg = new Map();        // url → { em, mapa } | Promise
const SEIS_H = 6 * 3600e3, VINTE_MIN = 20 * 60e3;

/** Canais do guia. Lê até a 1ª <programme> (no XMLTV os canais vêm antes). */
export async function canaisDoGuia(url, { fetchFn, forcar = false } = {}) {
    const c = cacheCanais.get(url);
    if (c && !forcar) { if (c.then) return c; if (Date.now() - c.em < SEIS_H) return c.canais; }
    const tarefa = (async () => {
        const canais = [];
        let resto = '';
        for await (const pedaco of abrirTexto(url, { fetchFn })) {
            resto += pedaco;
            const prog = resto.indexOf('<programme');
            const ate = prog >= 0 ? prog : resto.lastIndexOf('</channel>') + 10;
            if (ate > 10) { canais.push(...L.canaisXMLTV(resto.slice(0, ate))); resto = resto.slice(ate); }
            if (prog >= 0) break;                       // a programação começou: os canais acabaram
            if (resto.length > 8e6) resto = resto.slice(-1e6);
        }
        if (resto && !canais.length) canais.push(...L.canaisXMLTV(resto));
        if (!canais.length) throw new Error('não achei canais nesse link (é um guia XMLTV?)');
        cacheCanais.set(url, { em: Date.now(), canais });
        return canais;
    })();
    cacheCanais.set(url, tarefa);
    try { return await tarefa; } catch (e) { cacheCanais.delete(url); throw e; }
}

/** Programação de um canal: { agora, seguintes:[...] } com [inicio, fim, titulo, desc]. */
export async function programacao(url, id, { fetchFn, agora = Date.now() } = {}) {
    let c = cacheProg.get(url);
    if (!c || (!c.then && Date.now() - c.em > VINTE_MIN)) {
        const tarefa = (async () => {
            const de = Date.now() - 2 * 3600e3, ate = Date.now() + 8 * 3600e3;
            const mapa = new Map();
            let resto = '';
            for await (const pedaco of abrirTexto(url, { fetchFn, timeout: 240000 })) {
                resto += pedaco;
                const fim = resto.lastIndexOf('</programme>');
                if (fim >= 0) { L.programasXMLTV(resto.slice(0, fim + 12), null, de, ate, mapa); resto = resto.slice(fim + 12); }
                else if (resto.length > 8e6) resto = resto.slice(-1e6);
            }
            mapa.forEach(a => a.sort((x, y) => x[0] - y[0]));
            const pronto = { em: Date.now(), mapa };
            cacheProg.set(url, pronto);
            return pronto;
        })();
        cacheProg.set(url, tarefa);
        try { c = await tarefa; } catch (e) { cacheProg.delete(url); throw e; }
    } else if (c.then) c = await c;
    const lista = c.mapa.get(id) || [];
    const i = lista.findIndex(p => p[0] <= agora && p[1] > agora);
    return { agora: i >= 0 ? lista[i] : null, seguintes: lista.filter(p => p[0] > agora).slice(0, 4), total: lista.length };
}
