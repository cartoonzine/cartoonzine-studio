#!/usr/bin/env node
/**
 * 🧬 Robô de saúde do Multi Copy (roda no workflow do Studio, depois do teste de links).
 *
 *  - A cópia ATIVA (1º link) de um filme ou episódio morreu (3 falhas seguidas em dist/saude.json) e o item tem
 *    reservas: testa as reservas na ordem e a primeira que abrir vira a ativa. A morta vai para "desativadas"
 *    (fica guardada, não vai para o app). Cada troca fica anotada em conteudo/multicopy.json (🔴 no Multi Copy).
 *  - Lixeira: o que foi juntado ou removido há mais de 30 dias sai de vez.
 *
 *   node tools/saude-copias.mjs            faz
 *   node tools/saude-copias.mjs --simular  só mostra
 */
import fs from 'node:fs';
import path from 'node:path';
import { Core, RAIZ, lerConfig, lerColecao, lerArgs } from './lib.mjs';

const args = lerArgs(process.argv.slice(2));
const config = lerConfig();
const saude = (() => { try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'dist', 'saude.json'), 'utf8')); } catch (e) { return { links: {} }; } })();
const ARQ_MEM = path.join(RAIZ, 'conteudo', 'multicopy.json');
const mem = (() => { try { return JSON.parse(fs.readFileSync(ARQ_MEM, 'utf8')); } catch (e) { return {}; } })();
mem.naoIguais = mem.naoIguais || []; mem.lixeira = mem.lixeira || []; mem.linksRemovidos = mem.linksRemovidos || []; mem.trocas = mem.trocas || [];
const hoje = new Date().toISOString().slice(0, 10);
const morto = (u) => { const s = saude.links && saude.links[u]; return !!(s && s.falhas >= 3); };

async function abre(url) {
    if (!/^https?:/i.test(url)) return /^magnet:/i.test(url);          // torrent: não dá para testar, conta como vivo
    const tentar = async (metodo) => {
        const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 12000);
        try {
            const r = await fetch(url, { method: metodo, signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (cartoonzine-studio)', ...(metodo === 'GET' ? { Range: 'bytes=0-1023' } : {}) } });
            if (metodo === 'GET') r.body?.cancel().catch(() => {});
            return r.status;
        } finally { clearTimeout(t); }
    };
    try { let s = await tentar('HEAD'); if (s === 405 || s === 403 || s === 501) s = await tentar('GET'); return s < 400; } catch (e) { return false; }
}

/** links = [ativa, …reservas]; devolve a lista nova (ou null se nada muda) e o que saiu */
async function trocar(links) {
    if (!links || links.length < 2 || !morto(links[0])) return null;
    for (let i = 1; i < links.length; i++) {
        const u = links[i];
        if (morto(u)) continue;
        if (await abre(u)) return { links: [u].concat(links.slice(1).filter(x => x !== u)), morta: links[0], nova: u };
    }
    return null;
}

let trocas = 0;
for (const colecao of config.colecoes) {
    if (colecao.tipo !== 'video') continue;
    for (const { caminho, item } of lerColecao(colecao).entradas) {
        const it = Core.normalizarItem(item, colecao);
        let mudou = false;
        const anotar = (t, onde) => {
            it.linksDesativados = [...new Set((it.linksDesativados || []).concat(t.morta))];
            mem.trocas.unshift({ caminho, nome: it.nome + (onde ? ' · ' + onde : ''), de: t.morta, para: t.nova, em: hoje });
            console.log(`🔁 ${caminho}${onde ? ' ' + onde : ''}: a ativa morreu → ${t.nova}`);
            mudou = true; trocas++;
        };
        const t = await trocar(it.links);
        if (t) { it.links = t.links.filter(u => u !== t.morta); anotar(t, ''); }
        for (const tp of it.temporadas || []) for (const ep of tp.episodios || []) {
            const te = await trocar(ep.links);
            if (te) { ep.links = te.links.filter(u => u !== te.morta); anotar(te, `T${tp.numero} E${ep.numero}`); }
        }
        if (mudou && !args.simular) fs.writeFileSync(path.join(RAIZ, caminho), Core.serializar(Core.normalizarItem(it, colecao)));
    }
}

// lixeira: mais de 30 dias sai de vez
const limite = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
const velhos = mem.lixeira.filter(x => (x.em || '') < limite);
for (const x of velhos) { if (!args.simular && x.arquivo) fs.rmSync(path.join(RAIZ, x.arquivo), { force: true }); }
mem.lixeira = mem.lixeira.filter(x => (x.em || '') >= limite);
const nLinks = mem.linksRemovidos.length;
mem.linksRemovidos = mem.linksRemovidos.filter(x => (x.em || '') >= limite);
mem.trocas = mem.trocas.filter(x => (x.em || '') >= limite).slice(0, 300);
if (!args.simular && (trocas || velhos.length || nLinks !== mem.linksRemovidos.length || fs.existsSync(ARQ_MEM))) fs.writeFileSync(ARQ_MEM, JSON.stringify(mem, null, 1) + '\n');
console.log(`🧬 Multi Copy: ${trocas} ativa(s) trocada(s) · ${velhos.length} item(ns) e ${nLinks - mem.linksRemovidos.length} link(s) saíram da lixeira${args.simular ? ' (simulação)' : ''}`);
