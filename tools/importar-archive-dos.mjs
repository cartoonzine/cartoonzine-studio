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
 *   node tools/importar-archive-dos.mjs --todos                  (inclui os envios de usuários, além dos oficiais msdos_*)
 *   Ficam de fora por padrão: conteúdo adulto (--adultos libera), pacotes de fases/mods e coletâneas.
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
export function urlDaBusca({ limite = 100, inicio = 0, ordem = 'populares', decada, de, ate, genero, todos = false } = {}) {
    let q = `collection:(${COLECAO_IA})`;
    // os itens oficiais da biblioteca do Archive começam com "msdos_" (nome limpo, ano e ficha); o resto são
    // envios de usuários (cópias repetidas, coletâneas, mods). --todos traz os dois.
    if (!todos) q += ' AND identifier:msdos_*';
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
export function descricaoCurta(d, max = 300) {
    let t = String(um(d) || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ').trim();
    if (t.length > max) t = t.slice(0, max - 3).replace(/\s+\S*$/, '') + '…';
    return t;
}

/** Nome do jogo: o título do Archive sem o "(1992)(Empresa)" do fim. */
export function nomeDoJogo(doc) {
    let t = String(um(doc.title) || doc.identifier || '').replace(/\s*\((19|20)\d\d\)\s*(\([^)]*\))?\s*$/, '').trim();
    t = t.replace(/^(ms-?dos|dos)\s*[:\-–]\s*/i, '')                                   // "MS-DOS: Prince of Persia"
        .replace(/\s*[\(\[](ms-?dos|dos|pc|ibm pc)[\)\]]\s*$/i, '')                    // "Doom (MS-DOS)"
        .replace(/\s+[\-–]\s+(ms-?dos|dos)$/i, '')                                       // "Dyna Blaster - DOS"
        .replace(/^(.+?),\s*(The|A|An)$/i, '$2 $1')                                       // "Oregon Trail, The"
        .replace(/^(.+?),\s*(The|A|An)(\s+[\-–:].*)$/i, '$2 $1$3')
        .trim();
    return t || doc.identifier;
}

// ---------- 🚫 o que não entra: conteúdo adulto, pacotes de fases/mods, coletâneas ----------
const ADULTO = /strip\s*poker|\bstrip\b|soft\s*porn|porn|\bsex|erotic|hentai|\bnude|nudity|playboy|penthouse|\bfuck|\bxxx\b|leisure suit larry|\blust\b|\bbrothel/i;
const NAO_JOGO = /new levels for|levels? for (doom|duke|quake|heretic|hexen|wolf)|level pack|\bwads?\b|mission pack|\btrainer\b|\bcheats?\b|\blevel editor\b|\bsave ?games?\b|walkthrough|\bcompilation\b|\bdos games\b|\bgames collection\b/i;
/** Motivo para pular o jogo (ou ''). */
export function motivoParaPular(doc, { adultos = false } = {}) {
    const titulo = String(um(doc.title) || ''), tudo = titulo + ' ' + lista(doc.subject).join(' ') + ' ' + String(um(doc.description) || '');
    if (!adultos && (ADULTO.test(titulo) || /\b(adult|erotic|nudity|sexual content|sexual themes)\b/i.test(tudo))) return 'adulto';
    if (NAO_JOGO.test(titulo)) return 'mod/coletânea';
    const ficha = lerFicha(doc.description);
    if (ficha && /\b(DLC|Add-?on|Expansion)\b/i.test(String(ficha.Genre || '') + ' ' + String(ficha['Add-on'] !== undefined ? 'Add-on' : ''))) return 'expansão (precisa do jogo original)';
    return '';
}

// ---------- 📋 a ficha que o Archive copia do MobyGames ("Developed by … Genre … Description …") ----------
const ROTULOS = ['Also For', 'Developed by', 'Published by', 'Released', 'Genre', 'Gameplay', 'Perspective', 'Visual', 'Setting', 'Art', 'Interface', 'Narrative', 'Pacing', 'Sport', 'Vehicular', 'Educational', 'Misc', 'Add-on', 'Description'];
export function lerFicha(texto) {
    const t = descricaoCurta(texto, 100000);
    if (!/\b(Developed by|Published by)\b/.test(t) || !/\b(Genre|Description)\b/.test(t)) return null;
    const re = new RegExp('\\b(' + ROTULOS.map(r => r.replace(/[-]/g, '\\-')).join('|') + ')\\b', 'g');
    const marcas = []; let m;
    while ((m = re.exec(t))) marcas.push({ rot: m[1], ini: m.index, fim: m.index + m[1].length });
    const f = {};
    marcas.forEach((x, i) => {
        if (f[x.rot] !== undefined) return;                            // só a 1ª vez de cada rótulo (o texto pode repetir a palavra)
        if (x.rot !== 'Description' && f.Description !== undefined) return;
        const fim = x.rot === 'Description' ? t.length : (marcas[i + 1] ? marcas[i + 1].ini : t.length);
        f[x.rot] = t.slice(x.fim, fim).trim();
    });
    // "Windmill Software Platform DOS": o campo "Platform" vem grudado no nome da empresa
    ['Developed by', 'Published by', 'Released'].forEach(k => { if (f[k]) f[k] = f[k].replace(/\s+Platforms?\s+(DOS|PC|Windows|MS-?DOS)\b.*$/i, '').trim(); });
    return f;
}

/** Gêneros: os assuntos do Archive que não são "lixo" (msdos, game, nome do jogo…), no máximo 3. */
export function generosDoJogo(doc) {
    const fora = /^(ms-?dos|dos|games?|video ?games?|dos games|software|pc|ibm pc|shareware|freeware|abandonware|softwarelibrary|emulation|\d{4})$/i;
    const nome = Core.normText(nomeDoJogo(doc));
    const out = [];
    const ficha = lerFicha(doc.description);
    const daFicha = ficha ? [].concat(lista(ficha.Genre), lista(ficha.Gameplay)).map(g => g.replace(/\s+elements?$/i, '').trim()) : [];
    for (const s of daFicha.concat(lista(doc.subject))) {
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
    const ficha = lerFicha(doc.description);
    const autor = (ficha && (ficha['Developed by'] || ficha['Published by'])) || um(doc.creator);
    if (autor) item.editora = String(autor).replace(/\s+/g, ' ').replace(/,?\s*Inc\.?$/i, '').trim().slice(0, 80);
    // descrição curta escrita aqui com os FATOS da ficha (gênero, ano, quem fez): o texto de sinopse do Archive
    // (em geral copiado do MobyGames) não é copiado. Dá para escrever uma sinopse própria no painel depois.
    const partes = [];
    partes.push('Jogo de MS-DOS' + (g.length ? ' · ' + g.join(', ') : '') + (item.ano ? ' (' + item.ano + ')' : ''));
    if (item.editora) partes.push('de ' + item.editora);
    item.descricao = partes.join(', ') + '. Do acervo do Internet Archive.';
    if (rascunho) item._rascunho = true;
    return item;
}

/** id do Archive de um link (details/embed/download/<id>) */
const idDoLink = (u) => { const m = /archive\.org\/(?:details|embed|download|metadata)\/([^/?#]+)/i.exec(String(u || '')); return m ? decodeURIComponent(m[1]).toLowerCase() : null; };

/** Importa uma resposta da API. Devolve o resumo (usado também pelos testes). */
export function importarRespostaArchive(resposta, { raiz = RAIZ, simular = false, rascunho = false, adultos = false } = {}) {
    const config = lerConfig(raiz);
    const colecao = acharColecao(config, 'jogos');
    const docs = (resposta && resposta.response && resposta.response.docs) || [];
    const nomes = new Set(), ids = new Set();
    for (const e of lerColecao(colecao, raiz).entradas) {
        if (e.item.console !== 'msdos') continue;
        nomes.add(Core.normText(e.item.nome));
        [].concat(e.item.links || []).forEach(l => { const i = idDoLink(l); if (i) ids.add(i); });
    }
    const r = { lidos: docs.length, total: resposta && resposta.response ? resposta.response.numFound : 0, novos: 0, pulados: 0, filtrados: 0, caminhos: [], fora: [] };
    for (const doc of docs) {
        if (!doc || !doc.identifier) continue;
        const motivo = motivoParaPular(doc, { adultos });
        if (motivo) { r.filtrados++; r.fora.push(motivo + ': ' + (um(doc.title) || doc.identifier)); continue; }
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
    const r = importarRespostaArchive(resposta, { simular: !!args.simular, rascunho: !!args.rascunho, adultos: !!args.adultos });
    console.log(`${args.simular ? '[simulação] ' : ''}Archive: ${r.total} jogos na busca · ${r.lidos} nesta página`);
    r.fora.forEach(x => console.log('  - fora (' + x + ')'));
    console.log(`Novos: ${r.novos} · já existiam (não mexi): ${r.pulados} · fora do filtro: ${r.filtrados}`);
    if (args.simular) r.caminhos.slice(0, 30).forEach(n => console.log('  + ' + n));
}
