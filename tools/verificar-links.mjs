#!/usr/bin/env node
/**
 * Testa os links principais de tudo que está em conteudo/ e grava dist/saude.json.
 *
 *   node tools/verificar-links.mjs                 tudo
 *   node tools/verificar-links.mjs --colecao canais
 *   node tools/verificar-links.mjs --limite 500    no máximo 500 links por vez
 *
 * Um link só é considerado morto depois de 3 verificações seguidas falhando
 * (o mesmo critério do cartoonzine-cloud). Links magnet não são testados.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Core, RAIZ, lerConfig, lerColecao, lerArgs } from './lib.mjs';

const args = lerArgs(process.argv.slice(2));
const config = lerConfig();
const arqSaude = path.join(RAIZ, 'dist', 'saude.json');
const saude = fs.existsSync(arqSaude) ? JSON.parse(fs.readFileSync(arqSaude, 'utf8')) : { links: {} };
const limite = parseInt(args.limite || '3000', 10);
const CONCORRENCIA = 16;

const alvos = [];
for (const colecao of config.colecoes) {
    if (args.colecao && args.colecao !== colecao.id) continue;
    for (const { caminho, item } of lerColecao(colecao).entradas) {
        const n = Core.normalizarItem(item, colecao);
        const links = [(n.links || [])[0]];
        for (const t of n.temporadas || []) for (const e of t.episodios) links.push((e.links || [])[0]);
        for (const u of links) if (u && /^https?:/i.test(u)) alvos.push({ caminho, url: u });
    }
}
// os que foram testados há mais tempo primeiro
alvos.sort((a, b) => (saude.links[a.url]?.em || '').localeCompare(saude.links[b.url]?.em || ''));
const fila = alvos.slice(0, limite);

async function testar(url) {
    const tentar = async (metodo) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12000);
        try {
            const r = await fetch(url, { method: metodo, signal: ctrl.signal, redirect: 'follow',
                headers: { 'User-Agent': 'Mozilla/5.0 (cartoonzine-studio)', ...(metodo === 'GET' ? { Range: 'bytes=0-1023' } : {}) } });
            if (metodo === 'GET') r.body?.cancel().catch(() => {});
            return r.status;
        } finally { clearTimeout(t); }
    };
    try {
        let s = await tentar('HEAD');
        if (s === 405 || s === 403 || s === 501) s = await tentar('GET');
        return { ok: s < 400, status: s };
    } catch (e) { return { ok: false, status: e.name === 'AbortError' ? 'tempo esgotado' : e.message }; }
}

let i = 0, ok = 0, falhou = 0;
const mortos = [];
await Promise.all(Array.from({ length: CONCORRENCIA }, async () => {
    while (i < fila.length) {
        const { caminho, url } = fila[i++];
        const r = await testar(url);
        const ant = saude.links[url] || { falhas: 0 };
        const reg = { ok: r.ok, status: r.status, em: new Date().toISOString(), falhas: r.ok ? 0 : (ant.falhas || 0) + 1, caminho };
        saude.links[url] = reg;
        if (r.ok) ok++; else { falhou++; if (reg.falhas >= 3) mortos.push({ caminho, url, status: r.status }); }
    }
}));

saude.atualizadoEm = new Date().toISOString();
saude.mortos = Object.entries(saude.links).filter(([, v]) => v.falhas >= 3).map(([url, v]) => ({ url, caminho: v.caminho, status: v.status }));
fs.mkdirSync(path.dirname(arqSaude), { recursive: true });
fs.writeFileSync(arqSaude, JSON.stringify(saude, null, 1));
console.log(`Testados ${fila.length} de ${alvos.length} links: ✅ ${ok} ok · ✗ ${falhou} falharam agora · 💀 ${saude.mortos.length} mortos (3+ falhas seguidas)`);
for (const m of saude.mortos.slice(0, 30)) console.log(`  💀 ${m.caminho}  ${m.url}  (${m.status})`);
