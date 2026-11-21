#!/usr/bin/env node
/**
 * 📋 Receitas do Link Edit — o robô que refaz as listas sozinho (GitHub Actions, a cada 6 h).
 *
 *   node tools/receitas.mjs                 refaz todas as receitas ligadas
 *   node tools/receitas.mjs --receita kids-brasil
 *   node tools/receitas.mjs --simular       mostra o resultado sem gravar
 *   node tools/receitas.mjs --max 3000      teste no máximo N links por rodada (padrão 4000)
 *
 * Lê   receitas/receitas.json   (salvo pelo Link Edit → Receitas)
 * Grava listas/<id>.m3u e listas/<id>.json (o link fixo que vai no Cloud), listas/indice.json (resumo)
 *       receitas/estado.json    (histórico dos testes de cada link: confiança "9 de 10")
 *
 * O teste é o mesmo do Scan do Link Edit (rápido). "bloqueado" não tira o canal: o servidor do GitHub fica nos EUA
 * e muito canal só abre do país dele. Só o que está MORTO sai; a reserva viva assume o lugar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { RAIZ, lerArgs, lerConfig } from './lib.mjs';
import { baixarLista, testarCanal } from './linkedit-rede.mjs';

const L = createRequire(import.meta.url)('../core/linkedit-core.js');
const args = lerArgs(process.argv.slice(2));
const ARQ = path.join(RAIZ, 'receitas', 'receitas.json');
const ESTADO = path.join(RAIZ, 'receitas', 'estado.json');
const SAIDA = path.join(RAIZ, 'listas');
const MAX = parseInt(args.max || '4000', 10);
const VEZES = 16;                                         // links testados ao mesmo tempo

const lerJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const config = lerConfig();
const pub = config.publicacao || {};
const linkPublico = (arq) => pub.repo ? `https://raw.githubusercontent.com/${pub.repo}/${pub.branch || 'main'}/listas/${arq}` : 'listas/' + arq;

const todas = (lerJSON(ARQ, { receitas: [] }).receitas || []).filter(r => r && r.id && r.ativo !== false && (!args.receita || r.id === args.receita));
if (!todas.length) { console.log('Nenhuma receita ligada em receitas/receitas.json.'); process.exit(0); }
const estado = lerJSON(ESTADO, { links: {} });
estado.links = estado.links || {};

async function emLotes(itens, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; await fn(itens[k], k); } }));
}

const indice = lerJSON(path.join(SAIDA, 'indice.json'), { receitas: [] });
let testados = 0;
for (const r0 of todas) {
    const r = L.receitaPadrao(r0);
    console.log(`\n📋 ${r.nome} (${r.id}) — ${r.listas.length} lista(s)`);
    const canais = [], guias = [];
    for (const url of r.listas) {
        try {
            const { texto } = await baixarLista(url);
            const lida = L.lerLista(texto, url.split('/').filter(Boolean).pop() || url);
            if (lida.epg) guias.push(lida.epg);
            canais.push(...lida.canais);
            console.log(`  ✓ ${url} — ${lida.canais.length} itens`);
        } catch (e) { console.log(`  ✗ ${url} — ${e.message}`); }
    }
    const cand = canais.filter(c => L.passaReceita(c, r));
    // testa os candidatos (o mesmo link de outra receita não é testado de novo na mesma rodada)
    const urls = [...new Set(cand.map(c => c.url))];
    const hoje = Date.now();
    const pendentes = urls.filter(u => !(estado.links[u] && hoje - estado.links[u].em < 60 * 60e3)).slice(0, Math.max(0, MAX - testados));
    await emLotes(pendentes, VEZES, async (u) => {
        const c = cand.find(x => x.url === u);
        const t = await testarCanal(u, { modo: 'rapido', ua: c.headers && c.headers['User-Agent'], referer: c.headers && c.headers.Referer, timeout: 10000 }).catch(e => ({ status: 'morto', motivo: e.message }));
        const e = estado.links[u] || { h: [] };
        e.h = (e.h || []).concat(t.status !== 'morto').slice(-10);
        e.st = t.status; e.ms = t.ms; e.em = hoje;
        if (t.ua) e.ua = t.ua;
        estado.links[u] = e;
        testados++;
    });
    cand.forEach(c => {
        const e = estado.links[c.url];
        if (!e) return;
        c.teste = { status: e.st, ms: e.ms };
        c.historico = e.h.slice();
        if (e.ua) c.headers = Object.assign({}, c.headers, { 'User-Agent': e.ua });
    });
    const lista = L.montarReceita(cand, r);
    const comReserva = lista.filter(c => c.reservas.length).length;
    console.log(`  → ${lista.length} canais (${comReserva} com reserva) · ${pendentes.length} links testados agora`);
    if (args.simular) continue;
    fs.mkdirSync(SAIDA, { recursive: true });
    fs.writeFileSync(path.join(SAIDA, r.id + '.m3u'), L.gerarM3U(lista, { epg: guias.join(',') || undefined }));
    fs.writeFileSync(path.join(SAIDA, r.id + '.json'), L.gerarJSON(lista));
    indice.receitas = (indice.receitas || []).filter(x => x.id !== r.id).concat({
        id: r.id, nome: r.nome, total: lista.length, comReserva, candidatos: cand.length, atualizadaEm: new Date().toISOString(),
        m3u: linkPublico(r.id + '.m3u'), json: linkPublico(r.id + '.json')
    });
}
if (!args.simular) {
    // links que nenhuma receita usa há 30 dias saem do histórico (o arquivo não cresce para sempre)
    for (const [u, e] of Object.entries(estado.links)) if (Date.now() - (e.em || 0) > 30 * 86400e3) delete estado.links[u];
    fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
    fs.writeFileSync(ESTADO, JSON.stringify(estado));
    fs.mkdirSync(SAIDA, { recursive: true });
    fs.writeFileSync(path.join(SAIDA, 'indice.json'), JSON.stringify(indice, null, 1) + '\n');
    console.log(`\nPronto: ${todas.length} receita(s), ${testados} links testados.`);
}
