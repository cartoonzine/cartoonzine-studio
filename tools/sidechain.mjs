#!/usr/bin/env node
/**
 * 🔗 Link Sidechain — o robô que mantém os ENVIOS (GitHub Actions, a cada 6 h).
 *
 *   node tools/sidechain.mjs                 roda todos os envios ligados
 *   node tools/sidechain.mjs --envio cartoons-br
 *   node tools/sidechain.mjs --simular       mostra o resultado sem gravar
 *   node tools/sidechain.mjs --max 3000      teste no máximo N links por rodada (padrão 4000)
 *
 * Lê   sidechain/envios.json              (salvo pelo Link Edit → 🔗 Sidechain; um envio pode ter várias listas)
 * Grava listas/sc-<coleção>[-<país>].json e .m3u   uma lista pronta por coleção (e por país no TVzine/rádios)
 *       listas/sidechain-fontes.json      as fontes para o Cloud (lidas via "fontesDoStudio" do sources.json)
 *       listas/<envio>.json e .m3u        lista AVULSA do envio (se pedir): link fixo para outros players (as antigas Receitas)
 *       listas/avulsas.json               índice das listas avulsas
 *       sidechain/estado.json             relatório de cada envio (novos, pendentes, destinos), histórico dos testes
 *                                         e a última lista boa de cada envio (proteção)
 *                                         e o que cada envio já viu (vistos: para marcar o que é NOVO)
 *
 * Proteção: se a lista de um envio não abrir, vier vazia ou encolher mais da metade de uma vez,
 * o robô usa a última versão boa daquele envio e avisa — nunca apaga tudo por causa de um site fora do ar.
 * Teste: canais, Desenhos 24H e rádios são testados (morto sai; "bloqueado" fica — o robô roda nos EUA).
 * Vídeos (cartoons, animes, filmes, séries) não são testados, a não ser que o envio peça (soVivos: true).
 * TMDB (envio com tmdb: true e o secret TMDB_TOKEN): capa, banner, sinopse, gênero e nota dos vídeos — uma busca por
 * série ou filme, guardada 30 dias (sem achar: 7 dias), no máximo 200 buscas por rodada (--max-tmdb).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { RAIZ, lerArgs, lerConfig, chavesExternas, Core } from './lib.mjs';
import { baixarLista, testarCanal } from './linkedit-rede.mjs';

const L = createRequire(import.meta.url)('../core/linkedit-core.js');
const args = lerArgs(process.argv.slice(2));
const ARQ = path.join(RAIZ, 'sidechain', 'envios.json');
const ESTADO = path.join(RAIZ, 'sidechain', 'estado.json');
const SAIDA = path.join(RAIZ, 'listas');
const MAX = parseInt(args.max || '4000', 10);
const VEZES = 16;

const lerJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const config = lerConfig();
if (config.categoriasCanais) L.usarCategorias(config.categoriasCanais);
const pub = config.publicacao || {};
const linkPublico = (arq) => pub.repo ? `https://raw.githubusercontent.com/${pub.repo}/${pub.branch || 'main'}/listas/${arq}` : 'listas/' + arq;
const cols = L.colecoesSidechain(config);

const dados = lerJSON(ARQ, { envios: [] });
const envios = (dados.envios || []).filter(e => e && e.id && (e.url || (e.listas || []).length) && e.ativo !== false && (!args.envio || e.id === args.envio)).map(e => L.envioPadrao(e));
if (!envios.length) { console.log('Nenhum envio ligado em sidechain/envios.json.'); process.exit(0); }
const estado = lerJSON(ESTADO, {});
estado.links = estado.links || {}; estado.envios = estado.envios || {}; estado.ultimo = estado.ultimo || {}; estado.vistos = estado.vistos || {}; estado.tmdb = estado.tmdb || {};
const novoUltimo = {};
// os "vistos" moram no estado do robô (o envios.json é só seu: o robô nunca grava nele)
envios.forEach(e => { e.vistos = estado.vistos[e.id] || {}; e._globais = dados.regrasGlobais || []; });
// o que já está cadastrado na Studio (dist/indice-painel.json): para não mandar de novo para a mesma coleção
const mapaStudio = L.mapaStudio(lerJSON(path.join(RAIZ, 'dist', 'indice-painel.json'), []));
const antes = {};          // envio → { chave: { nome, url } } da rodada anterior (para "saíram" e "mudaram de link")

async function emLotes(itens, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; await fn(itens[k], k); } }));
}
// só o que importa do canal para guardar como "última versão boa" (o arquivo não pode crescer demais)
const enxuto = (c) => { const o = {}; for (const k of ['nome', 'nomeOriginal', 'url', 'logo', 'grupo', 'tvgId', 'pais', 'idioma', 'tipo', 'qualidade', 'formato', 'chave', 'id', 'headers', 'epgGuia', 'tvgNome']) if (c[k] != null && c[k] !== '' && !(k === 'headers' && !Object.keys(c[k]).length)) o[k] = c[k]; return o; };

const lotes = [];
let testados = 0;
for (const envio of envios) {
    // cada link do envio (o principal + as outras listas) tem a SUA última versão boa
    antes[envio.id] = {};
    L.linksDoEnvio(envio).forEach(u => (estado.ultimo[u] || []).forEach(c => { const k = c.chave || L.chaveDe(c); antes[envio.id][k] = { nome: c.nome, url: c.url }; }));
    let canais = [], mantido = false;
    const erros = [];
    for (const u of L.linksDoEnvio(envio)) {
        const ult = estado.ultimo[u] || [];
        let parte;
        try {
            const { texto } = await baixarLista(u);
            parte = L.lerLista(texto, envio.nome).canais;
            if (!parte.length) throw new Error('a lista veio vazia');
            if (ult.length >= 20 && parte.length < ult.length * 0.5) throw new Error(`a lista encolheu de ${ult.length} para ${parte.length} itens de uma vez`);
            novoUltimo[u] = parte.map(enxuto);
        } catch (e) {
            erros.push((L.linksDoEnvio(envio).length > 1 ? u.split('/').pop() + ': ' : '') + e.message);
            parte = ult.map(c => L.completar(Object.assign({}, c)));
            mantido = true;
        }
        canais.push(...parte);
    }
    const erro = erros.join(' · ');
    console.log(`\n🔗 ${envio.nome} (${envio.id}) → ${envio.tipoLista === 'mista' ? 'lista mista (' + (envio.rotas || []).length + ' rotas por grupo)' : envio.destino && envio.destino.colecao ? L.destinoTexto(envio.destino, cols) : 'só lista avulsa'} · ${canais.length} itens${mantido ? ` · ⚠ usando a última versão boa (${erro})` : ''}`);
    canais.forEach(c => { const aj = envio.ajustes && envio.ajustes[L.chaveSC(c)]; if (aj) L.ajustarVideo(c, aj); });
    // testa só o que vai para canais/24H/rádios (ou tudo, se o envio pedir)
    const precisa = canais.filter(c => {
        if (!L.passaFiltros(c, envio)) return false;
        const r = L.rotaDe(c, envio);
        if (r.destino === 'ignorar') return false;
        if (!r.destino) return envio.avulsa && (envio.soVivos != null ? envio.soVivos : !L.ehVideo(c));
        const col = cols.find(x => x.id === r.destino.colecao);
        return envio.soVivos != null ? envio.soVivos : (col && col.tipo !== 'video');
    });
    const hoje = Date.now();
    const urls = [...new Set(precisa.map(c => c.url))];
    const pendentes = urls.filter(u => !(estado.links[u] && hoje - estado.links[u].em < 60 * 60e3)).slice(0, Math.max(0, MAX - testados));
    await emLotes(pendentes, VEZES, async (u) => {
        const c = precisa.find(x => x.url === u);
        const t = await testarCanal(u, { modo: 'rapido', ua: c.headers && c.headers['User-Agent'], referer: c.headers && c.headers.Referer, timeout: 10000 }).catch(e => ({ status: 'morto', motivo: e.message }));
        const e = estado.links[u] || { h: [] };
        e.h = (e.h || []).concat(t.status !== 'morto').slice(-10);
        e.st = t.status; e.ms = t.ms; e.em = hoje;
        if (t.ua) e.ua = t.ua;
        estado.links[u] = e;
        testados++;
    });
    canais.forEach(c => {
        const e = estado.links[c.url];
        if (!e) return;
        c.teste = { status: e.st, ms: e.ms };
        c.historico = e.h.slice();
        if (e.ua) c.headers = Object.assign({}, c.headers, { 'User-Agent': e.ua });
    });
    lotes.push({ envio, canais, mantido, erro });
}

// 🔎 TMDB: capa, banner, sinopse, gênero e nota dos vídeos dos envios que pedem (uma busca por série/filme, guardada 30 dias)
const TMDB = chavesExternas().tmdb;
const MAX_TMDB = parseInt(args['max-tmdb'] || '200', 10);
let buscasTmdb = 0;
for (const { envio, canais } of lotes) {
    if (!envio.tmdb) continue;
    if (!TMDB) { console.log(`  ⚠ ${envio.nome}: TMDB ligado, mas sem a chave (secret TMDB_TOKEN do repositório)`); continue; }
    const porChave = new Map();
    canais.filter(c => L.ehVideo(c) && L.passaFiltros(c, envio)).forEach(c => { const k = L.chaveTMDB(c); if (!porChave.has(k)) porChave.set(k, []); porChave.get(k).push(c); });
    for (const [k, lista] of porChave) {
        let g = estado.tmdb[k];
        const velho = !g || Date.now() - (g.em || 0) > (g.dados ? 30 : 7) * 86400e3;
        if (velho && buscasTmdb < MAX_TMDB) {
            buscasTmdb++;
            try { const r = await Core.completarItem(L.pedidoTMDB(lista[0]), { tmdb: TMDB, tipoColecao: 'video' }); g = estado.tmdb[k] = { em: Date.now(), dados: L.dadosDoTMDB(r.item) }; }
            catch (e) { g = estado.tmdb[k] = { em: Date.now(), dados: null }; }
        }
        if (g && g.dados) lista.forEach(c => L.aplicarTMDB(c, g.dados));
    }
}
if (buscasTmdb) console.log(`\n🔎 TMDB: ${buscasTmdb} busca(s) nesta rodada`);

const { saidas, relatorios, avulsas } = L.montarSidechain(lotes, config, { studio: mapaStudio });
const fontes = [];
for (const s of saidas) {
    const col = cols.find(c => c.id === s.colecao);
    console.log(`  📦 ${s.chave}: ${s.itens.length} itens${s.pais ? ' · país ' + s.pais : ''}`);
    fontes.push(L.fonteDaSaida(s, col, linkPublico));
}
if (args.simular) { console.log('\n(simulação: nada foi gravado)'); process.exit(0); }

fs.mkdirSync(SAIDA, { recursive: true });
const antigas = new Set((lerJSON(path.join(SAIDA, 'sidechain-fontes.json'), []) || []).map(f => String(f.url || '').split('/').pop().replace(/\.(json|m3u)$/, '')));
for (const s of saidas) {
    fs.writeFileSync(path.join(SAIDA, s.chave + '.json'), L.gerarJSON(s.itens));
    fs.writeFileSync(path.join(SAIDA, s.chave + '.m3u'), L.gerarM3U(s.itens));
    antigas.delete(s.chave);
}
// saída que ficou vazia (todo mundo foi desviado/ignorado): sai do Cloud, os arquivos ficam com lista vazia
for (const k of antigas) if (/^sc-/.test(k)) { fs.writeFileSync(path.join(SAIDA, k + '.json'), '[]\n'); fs.writeFileSync(path.join(SAIDA, k + '.m3u'), '#EXTM3U\n'); }
fs.writeFileSync(path.join(SAIDA, 'sidechain-fontes.json'), JSON.stringify(fontes, null, 2) + '\n');
// listas avulsas (as antigas Receitas): M3U/JSON com link fixo, para usar em outros players
const indiceAv = lerJSON(path.join(SAIDA, 'avulsas.json'), { listas: [] });
for (const a of avulsas) {
    const res = (c) => c.reservas.length;
    fs.writeFileSync(path.join(SAIDA, a.id + '.m3u'), L.gerarM3U(a.itens));
    fs.writeFileSync(path.join(SAIDA, a.id + '.json'), L.gerarJSON(a.itens));
    indiceAv.listas = (indiceAv.listas || []).filter(x => x.id !== a.id).concat({ id: a.id, nome: a.nome, total: a.itens.length, comReserva: a.itens.filter(res).length,
        atualizadaEm: new Date().toISOString(), m3u: linkPublico(a.id + '.m3u'), json: linkPublico(a.id + '.json') });
}
indiceAv.listas = (indiceAv.listas || []).filter(x => (dados.envios || []).some(e => e.id === x.id && e.avulsa));
fs.writeFileSync(path.join(SAIDA, 'avulsas.json'), JSON.stringify(indiceAv, null, 1) + '\n');

// relatório + vistos (para o NOVO da próxima rodada) + última versão boa
const quando = new Date().toISOString();
for (const { envio, canais, mantido } of lotes) {
    const rel = relatorios[envio.id];
    const sairam = L.marcarVistos(envio, canais);
    const ant = estado.envios[envio.id] || {};
    // comparar com a rodada anterior: o que saiu e o que mudou de link
    const ant0 = antes[envio.id] || {}, agora = new Map(canais.map(c => [L.chaveSC(c), c]));
    const sairamItens = Object.keys(ant0).length ? Object.entries(ant0).filter(([k]) => !agora.has(k)).map(([, x]) => x.nome) : [];
    const mudaramLink = Object.entries(ant0).filter(([k, x]) => agora.has(k) && agora.get(k).url !== x.url).map(([k, x]) => ({ nome: x.nome, de: x.url, para: agora.get(k).url }));
    const enviados = Object.values(rel.porDestino).reduce((a, b) => a + b, 0);
    const hist = (ant.historico || []).concat({ em: quando, total: rel.total, enviados, mortos: rel.mortos, novos: rel.novos.length, sairam: sairamItens.length, mudaram: mudaramLink.length, pendentes: rel.pendentes.length, mantido: rel.mantido }).slice(-30);
    estado.envios[envio.id] = Object.assign({}, rel, { em: quando, sairam, novos: rel.novos.slice(0, 300), pendentes: rel.pendentes.slice(0, 1000),
        sairamItens: sairamItens.slice(0, 300), mudaramLink: mudaramLink.slice(0, 300), historico: hist });
    console.log(`  ✓ ${envio.nome}: ${Object.entries(rel.porDestino).map(([k, n]) => `${n} → ${k}`).join(' · ') || 'nada enviado'}${rel.novos.length ? ` · ${rel.novos.length} novos` : ''}${rel.pendentes.length ? ` · ${rel.pendentes.length} esperando revisão` : ''}`);
}
// última versão boa de cada link (links que nenhum envio usa mais saem)
const usados = new Set((dados.envios || []).flatMap(e => L.linksDoEnvio(L.envioPadrao(e))));
Object.assign(estado.ultimo, novoUltimo);
for (const u of Object.keys(estado.ultimo)) if (!usados.has(u)) delete estado.ultimo[u];
for (const [k, g] of Object.entries(estado.tmdb)) if (Date.now() - (g.em || 0) > 60 * 86400e3) delete estado.tmdb[k];
// links que nenhum envio usa há 30 dias saem do histórico; envios apagados saem do estado
for (const [u, e] of Object.entries(estado.links)) if (Date.now() - (e.em || 0) > 30 * 86400e3) delete estado.links[u];
const ids = new Set((dados.envios || []).map(e => e.id));
for (const e of envios) estado.vistos[e.id] = e.vistos;
for (const k of Object.keys(estado.envios)) if (!ids.has(k)) { delete estado.envios[k]; delete estado.vistos[k]; }
fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
fs.writeFileSync(ESTADO, JSON.stringify(estado));
console.log(`\nPronto: ${envios.length} envio(s), ${saidas.length} lista(s), ${testados} links testados.`);
