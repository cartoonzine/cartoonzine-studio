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
// o pesado NÃO vai para o git: a última versão boa de cada lista e os "vistos" ficam no cache do GitHub Actions
// (sidechain/.cache, restaurado e salvo pelo workflow). O estado.json fica pequeno (o painel abre rápido).
const CACHE = path.join(RAIZ, 'sidechain', '.cache');
const ARQ_TMDB = path.join(RAIZ, 'sidechain', 'tmdb.json');
// relógio: o workflow tem 45 min; o robô se organiza para terminar e gravar antes disso
const INICIO = Date.now();
const MINUTOS = parseFloat(args.minutos || process.env.SC_MINUTOS || '36');
const ATE = INICIO + MINUTOS * 60e3;
const passou = () => ((Date.now() - INICIO) / 60e3).toFixed(1) + ' min';
const hashLink = (u) => { let h = 2166136261; for (let i = 0; i < u.length; i++) { h ^= u.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

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
estado.links = estado.links || {}; estado.envios = estado.envios || {};
// versões antigas guardavam tudo no estado.json (passava de 100 MB): migra para o cache / tmdb.json
fs.mkdirSync(CACHE, { recursive: true });
const ultimoDe = (u) => lerJSON(path.join(CACHE, 'ultimo-' + hashLink(u) + '.json'), null) || (estado.ultimo && estado.ultimo[u]) || [];
const vistosCache = lerJSON(path.join(CACHE, 'vistos.json'), null) || estado.vistos || {};
estado.tmdb = Object.assign({}, estado.tmdb || {}, lerJSON(ARQ_TMDB, {}));
delete estado.ultimo; delete estado.vistos;
const novoUltimo = {};
// os "vistos" moram no estado do robô (o envios.json é só seu: o robô nunca grava nele)
envios.forEach(e => { e.vistos = vistosCache[e.id] || {}; e._globais = dados.regrasGlobais || []; e._sep = dados.separacoes || {}; });
// o que já está cadastrado na Studio (dist/indice-painel.json): para não mandar de novo para a mesma coleção
const mapaStudio = L.mapaStudio(lerJSON(path.join(RAIZ, 'dist', 'indice-painel.json'), []));
const antes = {};          // envio → { chave: { nome, url } } da rodada anterior (para "saíram" e "mudaram de link")

async function emLotes(itens, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; await fn(itens[k], k); } }));
}
// só o que importa do canal para guardar como "última versão boa" (o arquivo não pode crescer demais)
const enxuto = (c) => { const o = {}; for (const k of ['nome', 'nomeOriginal', 'url', 'logo', 'grupo', 'tvgId', 'pais', 'idioma', 'tipo', 'qualidade', 'formato', 'chave', 'id', 'headers', 'epgGuia', 'tvgNome', 'lista']) if (c[k] != null && c[k] !== '' && !(k === 'headers' && !Object.keys(c[k]).length)) o[k] = c[k]; return o; };

const lotes = [];
let testados = 0;
for (const envio of envios) {
    // cada link do envio (o principal + as outras listas) tem a SUA última versão boa
    antes[envio.id] = {};
    const ults = new Map(L.linksDoEnvio(envio).map(u => [u, ultimoDe(u)]));
    ults.forEach(l => l.forEach(c => { const k = c.chave || L.chaveDe(c); antes[envio.id][k] = { nome: c.nome, url: c.url }; }));
    let canais = [], mantido = false;
    const erros = [];
    for (const u of L.linksDoEnvio(envio)) {
        const ult = ults.get(u) || [];
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
        for (const c of parte) canais.push(c);   // sem push(...parte): lista enorme estoura a pilha
    }
    const erro = erros.join(' · ');
    console.log(`\n🔗 ${envio.nome} (${envio.id}) → ${envio.tipoLista === 'mista' ? 'lista mista (' + (envio.rotas || []).length + ' rotas por grupo)' : envio.destino && envio.destino.colecao ? L.destinoTexto(envio.destino, cols) : 'só lista avulsa'} · ${canais.length} itens${mantido ? ` · ⚠ usando a última versão boa (${erro})` : ''}`);
    canais.forEach(c => L.aplicarAjustesEnvio(c, envio));
    // testa só o que vai para canais/24H/rádios (ou tudo, se o envio pedir)
    envio._mapaGrupos = L.mapaGrupos(envio);
    const precisa = canais.filter(c => {
        if (!L.passaFiltros(c, envio)) return false;
        const r = L.rotaDe(c, envio);
        if (r.destino === 'ignorar') return false;
        if (!r.destino) return envio.avulsa && (envio.soVivos != null ? envio.soVivos : !L.ehVideo(c));
        const col = cols.find(x => x.id === r.destino.colecao);
        if (col && col.tipo !== 'video' && L.ehVideo(c)) return false;   // vídeo numa coleção de canais nem sai: não testa
        return envio.soVivos != null ? envio.soVivos : (col && col.tipo !== 'video');
    });
    delete envio._mapaGrupos;
    const hoje = Date.now();
    const urls = [...new Set(precisa.map(c => c.url))];
    const pendentes = urls.filter(u => !(estado.links[u] && hoje - estado.links[u].em < 60 * 60e3)).slice(0, Math.max(0, MAX - testados));
    const porUrl = new Map(precisa.map(c => [c.url, c]));
    const ateTeste = Math.min(ATE - 20 * 60e3, Date.now() + 12 * 60e3);   // testes: no máximo 12 min, e sobra tempo para o resto
    if (pendentes.length) console.log(`  🧪 testando ${pendentes.length} links… (${passou()})`);
    let feitos = 0;
    await emLotes(pendentes, VEZES, async (u) => {
        if (Date.now() > ateTeste) return;
        if (++feitos % 500 === 0) console.log(`     ${feitos}/${pendentes.length} testados (${passou()})`);
        const c = porUrl.get(u);
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
// até 3.000 títulos por rodada, 6 de cada vez, e no máximo 25 min (o resto fica para a próxima rodada)
const MAX_TMDB = parseInt(args['max-tmdb'] || process.env.SC_MAX_TMDB || '3000', 10);
const VEZES_TMDB = parseInt(args['vezes-tmdb'] || '6', 10);
const ATE_TMDB = Math.min(Date.now() + parseFloat(args['minutos-tmdb'] || '25') * 60e3, ATE - 4 * 60e3);
let buscasTmdb = 0;
const statsTmdb = {};
// quem você pediu agora ("🤖 completar agora") vai primeiro
const ordemTmdb = lotes.filter(l => l.envio.tmdb).sort((a, b) => String(b.envio.tmdbPedidoEm || '').localeCompare(String(a.envio.tmdbPedidoEm || '')));
for (const { envio, canais } of ordemTmdb) {
    if (!TMDB) { console.log(`  ⚠ ${envio.nome}: TMDB ligado, mas sem a chave (secret TMDB_TOKEN do repositório)`); statsTmdb[envio.id] = { semChave: true }; continue; }
    const porChave = new Map();
    canais.filter(c => L.ehVideo(c) && L.passaFiltros(c, envio)).forEach(c => { const k = L.chaveTMDB(c); if (!porChave.has(k)) porChave.set(k, []); porChave.get(k).push(c); });
    // v2 = já com a "Imagem da tela de prévia": as buscas guardadas antes dela são refeitas uma vez
    // v3 = escolhe o resultado pelo título exato (não o 1º da lista): as buscas pelo NOME feitas antes são refeitas uma vez
    const velho = (g, k) => !g || Date.now() - (g.em || 0) > (g.dados ? 30 : 7) * 86400e3 || (g.dados && !g.v) || (g.dados && !/^id\|/.test(k) && (g.v || 0) < 3);
    const fila = [...porChave.keys()].filter(k => velho(estado.tmdb[k], k));
    if (fila.length) console.log(`  🔎 ${envio.nome}: ${fila.length} títulos para buscar no TMDB… (${passou()})`);
    await emLotes(fila, VEZES_TMDB, async (k) => {
        if (buscasTmdb >= MAX_TMDB || Date.now() > ATE_TMDB) return;
        if (++buscasTmdb % 200 === 0) console.log(`     ${buscasTmdb} buscas (${passou()})`);
        try { const r = await Core.completarItem(L.pedidoTMDB(porChave.get(k)[0]), { tmdb: TMDB, omdb: chavesExternas().omdb, tipoColecao: 'video' }); const dd = L.dadosDoTMDB(r.item); if (dd && !/^id\|/.test(k)) dd.porBusca = true; estado.tmdb[k] = { em: Date.now(), v: 3, dados: dd }; }
        catch (e) { estado.tmdb[k] = { em: Date.now(), dados: null }; }
    });
    const st = { titulos: porChave.size, achados: 0, semAchar: 0, faltam: 0 };
    for (const [k, lista] of porChave) {
        const g = estado.tmdb[k];
        if (!g) st.faltam++; else if (g.dados) { st.achados++; if (!/^id\|/.test(k)) g.dados.porBusca = true; lista.forEach(c => L.aplicarTMDB(c, g.dados)); } else st.semAchar++;
    }
    statsTmdb[envio.id] = st;
    console.log(`  🔎 ${envio.nome}: TMDB ${st.achados} achados · ${st.semAchar} sem achar · ${st.faltam} para a próxima rodada (de ${st.titulos} títulos)`);
}
if (buscasTmdb) console.log(`\n🔎 TMDB: ${buscasTmdb} busca(s) nesta rodada`);

console.log(`\n📦 montando as listas… (${passou()})`);
const { saidas, relatorios, avulsas, reservasStudio, copias } = L.montarSidechain(lotes, config, { studio: mapaStudio });
const fontes = [];
// lista grande vira PARTES de até ~35 MB (o GitHub recusa arquivo de mais de 100 MB). Uma série nunca é partida ao meio.
// JSON compacto, um item por linha (o git guarda só as linhas que mudaram). M3U só onde o Cloud usa (Desenhos 24H).
const MAX_PARTE = parseFloat(args['mb-parte'] || '35') * 1e6;
const arquivos = [];        // { chave, json, m3u? }
for (const s of saidas) {
    const col = cols.find(c => c.id === s.colecao);
    const objs = L.objetosJSON(s.itens).map((o, i) => ({ o, i, txt: JSON.stringify(o), grupo: o.serie ? 's|' + o.serie : 'i|' + i }));
    const grupos = new Map(); objs.forEach(x => { if (!grupos.has(x.grupo)) grupos.set(x.grupo, []); grupos.get(x.grupo).push(x); });
    const partes = [[]]; let tam = 0;
    for (const g of grupos.values()) {
        const t = g.reduce((n, x) => n + x.txt.length + 2, 0);
        if (tam && tam + t > MAX_PARTE) { partes.push([]); tam = 0; }
        partes[partes.length - 1].push(...g); tam += t;
    }
    const usaM3U = (col.fonteCloud || {}).tipo === 'vod_m3u';
    partes.forEach((p, n) => {
        const sp = Object.assign({}, s, { chave: s.chave + (n ? '-' + (n + 1) : '') });
        arquivos.push({ chave: sp.chave, json: '[\n' + p.map(x => x.txt).join(',\n') + '\n]\n', m3u: usaM3U ? L.gerarM3U(p.map(x => s.itens[x.i])) : null });
        const f = L.fonteDaSaida(sp, col, linkPublico);
        if (partes.length > 1) f.nome += ` · parte ${n + 1}/${partes.length}`;
        fontes.push(f);
        console.log(`  📦 ${sp.chave}: ${p.length} itens${s.pais ? ' · país ' + s.pais : ''}${partes.length > 1 ? ` (parte ${n + 1}/${partes.length})` : ''}`);
    });
}
if (args.simular) { console.log('\n(simulação: nada foi gravado)'); process.exit(0); }

fs.mkdirSync(SAIDA, { recursive: true });
const antigas = new Set((lerJSON(path.join(SAIDA, 'sidechain-fontes.json'), []) || []).map(f => String(f.url || '').split('/').pop().replace(/\.(json|m3u)$/, '')));
const feitos = new Set();
for (const a of arquivos) {
    fs.writeFileSync(path.join(SAIDA, a.chave + '.json'), a.json);
    if (a.m3u) fs.writeFileSync(path.join(SAIDA, a.chave + '.m3u'), a.m3u);
    else fs.rmSync(path.join(SAIDA, a.chave + '.m3u'), { force: true });      // vídeo/canais: o Cloud lê o JSON
    feitos.add(a.chave); antigas.delete(a.chave);
}
// saída que ficou vazia (todo mundo foi desviado/ignorado) ou parte que sobrou: sai do Cloud
for (const f of fs.readdirSync(SAIDA)) { const k = f.replace(/\.(json|m3u)$/, ''); if (/^sc-/.test(k) && !feitos.has(k)) antigas.add(k); }
for (const k of antigas) if (/^sc-/.test(k)) { fs.rmSync(path.join(SAIDA, k + '.json'), { force: true }); fs.rmSync(path.join(SAIDA, k + '.m3u'), { force: true }); }
fs.writeFileSync(path.join(SAIDA, 'sidechain-fontes.json'), JSON.stringify(fontes, null, 2) + '\n');
// 🧬 o que já estava cadastrado na Studio não some: os links viram reserva do item de lá (o build da Studio junta)
fs.writeFileSync(path.join(SAIDA, 'sc-reservas.json'), JSON.stringify(reservasStudio || {}, null, 1) + '\n');
// 🧬 relatório de cópias (informativo): o painel mostra em Sidechain → 🧬 Cópias e nos cards da Saída
fs.writeFileSync(path.join(RAIZ, 'sidechain', 'copias.json'), JSON.stringify({ em: new Date().toISOString(), colecoes: copias || {} }) + '\n');
{ const n = Object.values(copias || {}).reduce((t, a) => t + a.length, 0); if (n) console.log(`  🧬 ${n} títulos chegaram repetidos (viraram reserva) — veja em Sidechain → 🧬 Cópias`); }
if (Object.keys(reservasStudio || {}).length) console.log(`  🧬 ${Object.keys(reservasStudio).length} itens da Studio ganharam reservas do Sidechain`);
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
        sairamItens: sairamItens.slice(0, 300), mudaramLink: mudaramLink.slice(0, 300), historico: hist, tmdb: statsTmdb[envio.id] || undefined, tmdbPedidoEm: envio.tmdbPedidoEm || undefined });
    console.log(`  ✓ ${envio.nome}: ${Object.entries(rel.porDestino).map(([k, n]) => `${n} → ${k}`).join(' · ') || 'nada enviado'}${rel.novos.length ? ` · ${rel.novos.length} novos` : ''}${rel.pendentes.length ? ` · ${rel.pendentes.length} esperando revisão` : ''}`);
}
// última versão boa de cada link: no cache do Actions (links que nenhum envio usa mais saem)
const usados = new Set((dados.envios || []).flatMap(e => L.linksDoEnvio(L.envioPadrao(e))));
for (const [u, l] of Object.entries(novoUltimo)) fs.writeFileSync(path.join(CACHE, 'ultimo-' + hashLink(u) + '.json'), JSON.stringify(l));
const vivos = new Set([...usados].map(u => 'ultimo-' + hashLink(u) + '.json'));
for (const f of fs.readdirSync(CACHE)) if (/^ultimo-/.test(f) && !vivos.has(f)) fs.rmSync(path.join(CACHE, f), { force: true });
for (const [k, g] of Object.entries(estado.tmdb)) if (Date.now() - (g.em || 0) > 60 * 86400e3) delete estado.tmdb[k];
// TMDB: arquivo próprio, um título por linha (o git guarda só o que mudou; o painel lê só no passo 4)
const tmdbOrd = Object.keys(estado.tmdb).sort();
fs.writeFileSync(ARQ_TMDB, '{\n' + tmdbOrd.map(k => JSON.stringify(k) + ':' + JSON.stringify(estado.tmdb[k])).join(',\n') + '\n}\n');
delete estado.tmdb;
// links que nenhum envio usa há 30 dias saem do histórico; envios apagados saem do estado
for (const [u, e] of Object.entries(estado.links)) if (Date.now() - (e.em || 0) > 30 * 86400e3) delete estado.links[u];
const ids = new Set((dados.envios || []).map(e => e.id));
for (const e of envios) vistosCache[e.id] = e.vistos;
for (const k of Object.keys(vistosCache)) if (!ids.has(k)) delete vistosCache[k];
for (const k of Object.keys(estado.envios)) if (!ids.has(k)) delete estado.envios[k];
fs.writeFileSync(path.join(CACHE, 'vistos.json'), JSON.stringify(vistosCache));
fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
fs.writeFileSync(ESTADO, JSON.stringify(estado));
console.log(`\nPronto em ${passou()}: ${envios.length} envio(s), ${saidas.length} lista(s), ${testados} links testados. estado.json: ${(fs.statSync(ESTADO).size / 1e3).toFixed(0)} KB`);
