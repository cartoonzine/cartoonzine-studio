// Funções comuns das ferramentas de linha de comando do Cartoonzine Studio.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const Core = require('../core/studio-core.js');
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function lerConfig(raiz = RAIZ) {
    return JSON.parse(fs.readFileSync(path.join(raiz, 'studio.config.json'), 'utf8'));
}

export function acharColecao(config, id) {
    const c = config.colecoes.find(x => x.id === id || Core.slugify(x.nome) === Core.slugify(id || ''));
    if (!c) {
        const ids = config.colecoes.map(x => x.id).join(', ');
        throw new Error(`Coleção "${id}" não existe. Use uma destas: ${ids}`);
    }
    return c;
}

function* arquivosJson(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) yield* arquivosJson(p);
        else if (e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('_')) yield p;
    }
}

/** Lê conteudo/<colecao>/**.json -> [{caminho, item}] e os arquivos com JSON quebrado. */
export function lerColecao(colecao, raiz = RAIZ) {
    const entradas = [], quebrados = [];
    for (const abs of arquivosJson(path.join(raiz, 'conteudo', colecao.id))) {
        const caminho = path.relative(raiz, abs).split(path.sep).join('/');
        try { entradas.push({ caminho, item: JSON.parse(fs.readFileSync(abs, 'utf8')) }); }
        catch (e) { quebrados.push({ caminho, msg: 'JSON inválido: ' + e.message }); }
    }
    entradas.sort((a, b) => a.caminho.localeCompare(b.caminho));
    return { entradas, quebrados };
}

/** Procura um item da coleção com o mesmo nome (para juntar episódios em séries existentes). */
export function acharPorNome(colecao, item, raiz = RAIZ) {
    const alvo = Core.normText(item.nome);
    const sub = colecao.subpasta;
    for (const e of lerColecao(colecao, raiz).entradas) {
        if (Core.normText(e.item.nome) !== alvo) continue;
        // canais/jogos: "Discovery" do BR e dos EUA são itens diferentes
        if (sub && String(Core.normalizarItem(e.item, colecao)[sub] || '') !== String(item[sub] || '')) continue;
        return e;
    }
    return null;
}

/**
 * Salva um item: se já existe um com o mesmo nome, junta (episódios/links novos);
 * senão cria conteudo/<colecao>/.../<slug>.json. Devolve {caminho, acao}.
 */
export function salvarItem(colecao, novo, { raiz = RAIZ, substituir = false } = {}) {
    const item = Core.normalizarItem(novo, colecao);
    const existente = acharPorNome(colecao, item, raiz);
    if (existente) {
        if (existente.item._travado && item._origem) return { caminho: existente.caminho, acao: 'travado' };
        const final = substituir ? item : Core.mesclarItem(Core.normalizarItem(existente.item, colecao), item);
        // item feito à mão continua sendo "à mão": a sincronização automática nunca vai apagá-lo
        if (!existente.item._origem) delete final._origem;
        const antes = Core.serializar(existente.item), depois = Core.serializar(final);
        if (antes === depois) return { caminho: existente.caminho, acao: 'igual' };
        fs.writeFileSync(path.join(raiz, existente.caminho), depois);
        return { caminho: existente.caminho, acao: 'atualizado' };
    }
    let caminho = Core.caminhoItem(colecao, item);
    const dir = path.dirname(path.join(raiz, caminho));
    fs.mkdirSync(dir, { recursive: true });
    const ocupados = new Set(fs.readdirSync(dir).map(f => f.replace(/\.json$/, '')));
    const slug = Core.slugLivre(Core.slugify(item.nome), ocupados);
    caminho = Core.caminhoItem(colecao, item, slug);
    fs.writeFileSync(path.join(raiz, caminho), Core.serializar(item));
    return { caminho, acao: 'criado' };
}

/** Argumentos "--chave valor" e "--flag" -> objeto; o resto vai em _ */
export function lerArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const k = a.slice(2);
            const v = argv[i + 1];
            if (v === undefined || v.startsWith('--')) out[k] = true;
            else { out[k] = v; i++; }
        } else out._.push(a);
    }
    return out;
}

export async function baixarTexto(url, { timeoutMs = 30000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'cartoonzine-studio' } });
        if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
        return await r.text();
    } finally { clearTimeout(t); }
}

/** Completa itens com Wikipedia/Internet Archive. Erros de rede não param nada. */
export async function enriquecer(item, { wiki = false, log = () => {} } = {}) {
    let out = item;
    if (out.archive && !(out.links || []).length && !(out.temporadas || []).length) {
        try {
            const doArchive = await Core.importarArchive(out.archive);
            const nomeManual = out.nome && out.nome !== out.archive ? out.nome : null;
            out = Core.mesclarItem(doArchive, Object.assign({}, out, { nome: nomeManual || doArchive.nome }));
            out.nome = nomeManual || doArchive.nome;
            delete out.archive;
            log(`  ↳ Internet Archive: ${Core.contarEpisodios(out) || 1} vídeo(s)`);
        } catch (e) { log('  ⚠ Internet Archive: ' + e.message); }
    }
    if (wiki && (!out.descricao || !out.capa)) {
        try {
            const w = await Core.buscarWikipedia(out.nome);
            if (w) { out = Core.mesclarSemSobrescrever(out, w); log(`  ↳ Wikipedia: ${w.tituloWikipedia}`); }
        } catch (e) { log('  ⚠ Wikipedia: ' + e.message); }
    }
    return out;
}

export function aplicarPadroes(item, args) {
    const out = Object.assign({}, item);
    for (const k of ['pais', 'idioma', 'categoria', 'console', 'audio', 'cidade', 'capa', 'banner', 'logo', 'descricao', 'ano', 'generos', 'jogadores', 'core', 'tvgId']) {
        if (args[k] !== undefined && args[k] !== true && (out[k] === undefined || out[k] === '')) out[k] = args[k];
    }
    if (args.destaque) out.destaque = true;
    return out;
}

/**
 * Importa texto (M3U, lista de links, mensagens do bot, links do archive.org) para uma coleção.
 * Devolve [{caminho, acao, nome}] e os erros por item.
 */
export async function importarTexto(colecao, texto, { args = {}, raiz = RAIZ, origem, config = lerConfig(raiz), log = () => {}, simular = false, filtroNome } = {}) {
    const entradas = Core.lerTextoColado(texto);
    const itens = Core.agruparEntradas(entradas, { series: colecao.tipo === 'video' });
    const resultado = [], falhas = [];
    for (let item of itens) {
        if (filtroNome && !filtroNome(item.nome)) continue;
        if (item.categoria !== undefined) item.categoria = Core.traduzirCategoria(item.categoria);
        item = aplicarPadroes(Core.limparVazios(item), args);
        if (colecao.tipo !== 'video') { delete item.audio; }
        if (origem) item._origem = origem;
        log(`• ${item.nome}`);
        item = await enriquecer(item, { wiki: !!args.wiki, log });
        const normal = Core.normalizarItem(item, colecao);
        const { erros } = Core.validarItem(normal, colecao, config);
        if (erros.length) { falhas.push({ nome: normal.nome, erros }); log('  ✗ ' + erros.join('; ')); continue; }
        if (simular) { resultado.push({ nome: normal.nome, acao: 'simulado', item: normal }); continue; }
        const r = salvarItem(colecao, normal, { raiz });
        resultado.push(Object.assign({ nome: normal.nome }, r));
    }
    return { resultado, falhas };
}
