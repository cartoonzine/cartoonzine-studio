#!/usr/bin/env node
/**
 * Jogos de MS-DOS do Internet Archive → console MS-DOS (Jogos Retrô).
 * Usa a API pública de busca do Archive (advancedsearch) e a coleção "softwarelibrary_msdos_games".
 * O jogo continua hospedado no Archive: o card guarda o link da PÁGINA do jogo (archive.org/details/<id>)
 * e o cartucho DOS do app (cartoonzine-jogos/dos) descobre sozinho o .zip e o programa (emulator_start).
 *
 *   node tools/importar-archive-dos.mjs                          (os 100 mais jogados)
 *   node tools/importar-archive-dos.mjs --limite 300 --inicio 100 (do 101º ao 400º mais jogado)
 *   node tools/importar-archive-dos.mjs --decada 1990            (só 1990–1999)   · --de 1985 --ate 1992
 *   node tools/importar-archive-dos.mjs --genero puzzle          (assunto do Archive contém "puzzle")
 *   node tools/importar-archive-dos.mjs --ordem titulo|ano|recentes|populares
 *   node tools/importar-archive-dos.mjs --rascunho               (entram como rascunho: não vão para o app ainda)
 *   node tools/importar-archive-dos.mjs --simular                (mostra o que faria, sem salvar)
 *   node tools/importar-archive-dos.mjs --arquivo resposta.json  (usa uma resposta salva da API, para testes)
 *
 * Jogo que já existe no console MS-DOS (mesmo nome ou mesmo item do Archive) não é mexido.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Core, RAIZ, lerConfig, acharColecao, lerColecao, salvarItem, lerArgs } from './lib.mjs';

export const COLECAO_IA = 'softwarelibrary_msdos_games';
const ORIGEM = 'auto:Internet Archive MS-DOS';
const ORDENS = { populares: 'downloads desc', titulo: 'titleSorter asc', ano: 'year asc', recentes: 'publicdate desc' };
const CAMPOS = ['identifier', 'title', 'year', 'date', 'creator', 'subject', 'description', 'downloads', 'emulator_start'];

/** Monta o link da API de busca do Archive. */
export function urlDaBusca({ limite = 100, inicio = 0, ordem = 'populares', decada, de, ate, genero } = {}) {
    let q = `collection:(${COLECAO_IA})`;
    const a0 = decada ? parseInt(decada, 10) : (de ? parseInt(de, 10) : null);
    const a1 = decada ? a0 + 9 : (ate ? parseInt(ate, 10) : null);
    if (a0 || a1) q += ` AND year:[${a0 || 1970} TO ${a1 || 2030}]`;
    if (genero) q += ` AND subject:(${String(genero).replace(/[()"]/g, ' ').trim()})`;
    const rows = Math.max(1, Math.min(1000, parseInt(limite, 10) || 100));
    const page = Math.floor((parseInt(inicio, 10) || 0) / rows) + 1;
    const qs = new URLSearchParams({ q, rows: String(rows), page: String(page), output: 'json' });
    CAMPOS.forEach(c => qs.append('fl[]', c));
    qs.append('sort[]', ORDENS[ordem] || ORDENS.populares);
    return 'https://archive.org/advancedsearch.php?' + qs.toString();
}

const um = (v) => Array.isArray(v) ? v[0] : v;
const lista = (v) => (Array.isArray(v) ? v : (v == null ? [] : [v])).flatMap(x => String(x).split(/[;,]/)).map(s => s.trim()).filter(Boolean);

/** Texto curto e limpo para a descrição (sem HTML, no máximo ~300 letras). */
export function descricaoCurta(d) {
    let t = String(um(d) || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ').trim();
    if (t.length > 300) t = t.slice(0, 297).replace(/\s+\S*$/, '') + '…';
    return t;
}

/** Nome do jogo: o título do Archive sem o "(1992)(Empresa)" do fim. */
export function nomeDoJogo(doc) {
    const t = String(um(doc.title) || doc.identifier || '').replace(/\s*\((19|20)\d\d\)\s*(\([^)]*\))?\s*$/, '').trim();
    return t || doc.identifier;
}

/** Gêneros: os assuntos do Archive que não são "lixo" (msdos, game, nome do jogo…), no máximo 3. */
export function generosDoJogo(doc) {
    const fora = /^(ms-?dos|dos|games?|software|pc|ibm pc|shareware|freeware|abandonware|softwarelibrary|emulation|\d{4})$/i;
    const nome = Core.normText(nomeDoJogo(doc));
    const out = [];
    for (const s of lista(doc.subject)) {
        if (fora.test(s) || Core.normText(s) === nome || s.length > 30) continue;
        const g = s.charAt(0).toUpperCase() + s.slice(1);
        if (!out.some(x => Core.normText(x) === Core.normText(g))) out.push(g);
        if (out.length >= 3) break;
    }
    return out;
}

/** Um resultado da API → item do console MS-DOS. */
export function itemDoArchive(doc, { rascunho = false } = {}) {
    const id = String(doc.identifier);
    const ano = parseInt(um(doc.year) || String(um(doc.date) || '').slice(0, 4), 10);
    const item = {
        nome: nomeDoJogo(doc),
        links: [`https://archive.org/details/${id}`],
        capa: `https://archive.org/services/img/${id}`,
        console: 'msdos',
        fonte: `https://archive.org/details/${id}`,
        _origem: ORIGEM
    };
    if (ano > 1970 && ano < 2030) item.ano = ano;
    const g = generosDoJogo(doc); if (g.length) item.generos = g;
    const d = descricaoCurta(doc.description); if (d) item.descricao = d;
    const autor = um(doc.creator); if (autor) item.editora = String(autor).slice(0, 80);
    if (rascunho) item._rascunho = true;
    return item;
}

/** id do Archive de um link (details/embed/download/<id>) */
const idDoLink = (u) => { const m = /archive\.org\/(?:details|embed|download|metadata)\/([^/?#]+)/i.exec(String(u || '')); return m ? decodeURIComponent(m[1]).toLowerCase() : null; };

/** Importa uma resposta da API. Devolve o resumo (usado também pelos testes). */
export function importarRespostaArchive(resposta, { raiz = RAIZ, simular = false, rascunho = false } = {}) {
    const config = lerConfig(raiz);
    const colecao = acharColecao(config, 'jogos');
    const docs = (resposta && resposta.response && resposta.response.docs) || [];
    const nomes = new Set(), ids = new Set();
    for (const e of lerColecao(colecao, raiz).entradas) {
        if (e.item.console !== 'msdos') continue;
        nomes.add(Core.normText(e.item.nome));
        [].concat(e.item.links || []).forEach(l => { const i = idDoLink(l); if (i) ids.add(i); });
    }
    const r = { lidos: docs.length, total: resposta && resposta.response ? resposta.response.numFound : 0, novos: 0, pulados: 0, caminhos: [] };
    for (const doc of docs) {
        if (!doc || !doc.identifier) continue;
        const item = itemDoArchive(doc, { rascunho });
        const chave = Core.normText(item.nome), id = String(doc.identifier).toLowerCase();
        if (ids.has(id) || nomes.has(chave)) { r.pulados++; continue; }
        nomes.add(chave); ids.add(id);
        if (simular) { r.novos++; r.caminhos.push(item.nome); continue; }
        const s = salvarItem(colecao, item, { raiz });
        if (s.acao === 'criado') r.novos++; else r.pulados++;
        r.caminhos.push(s.caminho);
    }
    return r;
}

// ---- linha de comando ----
const direto = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (direto) {
    const args = lerArgs(process.argv.slice(2));
    let resposta;
    try {
        if (args.arquivo) resposta = JSON.parse(fs.readFileSync(args.arquivo, 'utf8'));
        else {
            const url = urlDaBusca(args);
            console.log('Buscando no Internet Archive: ' + url);
            const r = await fetch(url, { headers: { 'User-Agent': 'Cartoonzine-Studio/1.0 (importador de MS-DOS)' } });
            if (!r.ok) throw new Error('a API respondeu ' + r.status);
            resposta = await r.json();
        }
    } catch (e) {
        console.error('Não deu para buscar no Archive: ' + e.message);
        process.exit(1);
    }
    const r = importarRespostaArchive(resposta, { simular: !!args.simular, rascunho: !!args.rascunho });
    console.log(`${args.simular ? '[simulação] ' : ''}Archive: ${r.total} jogos na busca · ${r.lidos} nesta página`);
    console.log(`Novos: ${r.novos} · já existiam (não mexi): ${r.pulados}`);
    if (args.simular) r.caminhos.slice(0, 30).forEach(n => console.log('  + ' + n));
}
