#!/usr/bin/env node
/**
 * 🔗 Link Sidechain — o robô que mantém os ENVIOS (GitHub Actions, a cada 6 h).
 *
 *   node tools/sidechain.mjs                 roda todos os envios ligados
 *   node tools/sidechain.mjs --envio cartoons-br
 *   node tools/sidechain.mjs --simular       mostra o resultado sem gravar
 *   node tools/sidechain.mjs --max 3000      teste no máximo N links por rodada (padrão 4000)
 *
 * Lê   sidechain/envios.json              (salvo pelo Link Edit → 🔗 Sidechain)
 * Grava listas/sc-<coleção>[-<país>].json e .m3u   uma lista pronta por coleção (e por país no TVzine/rádios)
 *       listas/sidechain-fontes.json      as fontes para o Cloud (lidas via "fontesDoStudio" do sources.json)
 *       sidechain/estado.json             relatório de cada envio (novos, pendentes, destinos), histórico dos testes
 *                                         e a última lista boa de cada envio (proteção)
 *                                         e o que cada envio já viu (vistos: para marcar o que é NOVO)
 *
 * Proteção: se a lista de um envio não abrir, vier vazia ou encolher mais da metade de uma vez,
 * o robô usa a última versão boa daquele envio e avisa — nunca apaga tudo por causa de um site fora do ar.
 * Teste: canais, Desenhos 24H e rádios são testados (morto sai; "bloqueado" fica — o robô roda nos EUA).
 * Vídeos (cartoons, animes, filmes, séries) não são testados, a não ser que o envio peça (soVivos: true).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { RAIZ, lerArgs, lerConfig } from './lib.mjs';
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
const envios = (dados.envios || []).filter(e => e && e.id && e.url && e.ativo !== false && (!args.envio || e.id === args.envio)).map(e => L.envioPadrao(e));
if (!envios.length) { console.log('Nenhum envio ligado em sidechain/envios.json.'); process.exit(0); }
const estado = lerJSON(ESTADO, {});
estado.links = estado.links || {}; estado.envios = estado.envios || {}; estado.ultimo = estado.ultimo || {}; estado.vistos = estado.vistos || {};
// os "vistos" moram no estado do robô (o envios.json é só seu: o robô nunca grava nele)
envios.forEach(e => { e.vistos = estado.vistos[e.id] || {}; });

async function emLotes(itens, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; await fn(itens[k], k); } }));
}
// só o que importa do canal para guardar como "última versão boa" (o arquivo não pode crescer demais)
const enxuto = (c) => { const o = {}; for (const k of ['nome', 'nomeOriginal', 'url', 'logo', 'grupo', 'tvgId', 'pais', 'idioma', 'tipo', 'qualidade', 'formato', 'chave', 'id', 'headers', 'epgGuia']) if (c[k] != null && c[k] !== '' && !(k === 'headers' && !Object.keys(c[k]).length)) o[k] = c[k]; return o; };

const lotes = [];
let testados = 0;
for (const envio of envios) {
    const ult = estado.ultimo[envio.id] || [];
    let canais = [], mantido = false, erro = '';
    try {
        const { texto } = await baixarLista(envio.url);
        canais = L.lerLista(texto, envio.nome).canais;
        if (!canais.length) throw new Error('a lista veio vazia');
        if (ult.length >= 20 && canais.length < ult.length * 0.5) throw new Error(`a lista encolheu de ${ult.length} para ${canais.length} itens de uma vez`);
    } catch (e) {
        erro = e.message;
        canais = ult.map(c => L.completar(Object.assign({}, c)));
        mantido = true;
    }
    console.log(`\n🔗 ${envio.nome} (${envio.id}) → ${L.destinoTexto(envio.destino, cols)} · ${canais.length} itens${mantido ? ` · ⚠ usando a última versão boa (${erro})` : ''}`);
    // testa só o que vai para canais/24H/rádios (ou tudo, se o envio pedir)
    const precisa = canais.filter(c => {
        const r = L.rotaDe(c, envio);
        if (!r.destino || r.destino === 'ignorar') return false;
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

const { saidas, relatorios } = L.montarSidechain(lotes, config);
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

// relatório + vistos (para o NOVO da próxima rodada) + última versão boa
const quando = new Date().toISOString();
for (const { envio, canais, mantido } of lotes) {
    const rel = relatorios[envio.id];
    const sairam = mantido ? 0 : L.marcarVistos(envio, canais);
    const ant = estado.envios[envio.id] || {};
    const hist = (ant.historico || []).concat({ em: quando, total: rel.total, novos: rel.novos.length, sairam, pendentes: rel.pendentes.length, mantido: rel.mantido }).slice(-20);
    estado.envios[envio.id] = Object.assign({}, rel, { em: quando, sairam, novos: rel.novos.slice(0, 300), pendentes: rel.pendentes.slice(0, 1000), historico: hist });
    if (!mantido) estado.ultimo[envio.id] = canais.map(enxuto);
    console.log(`  ✓ ${envio.nome}: ${Object.entries(rel.porDestino).map(([k, n]) => `${n} → ${k}`).join(' · ') || 'nada enviado'}${rel.novos.length ? ` · ${rel.novos.length} novos` : ''}${rel.pendentes.length ? ` · ${rel.pendentes.length} esperando revisão` : ''}`);
}
// links que nenhum envio usa há 30 dias saem do histórico; envios apagados saem do estado
for (const [u, e] of Object.entries(estado.links)) if (Date.now() - (e.em || 0) > 30 * 86400e3) delete estado.links[u];
const ids = new Set((dados.envios || []).map(e => e.id));
for (const e of envios) estado.vistos[e.id] = e.vistos;
for (const k of Object.keys(estado.envios)) if (!ids.has(k)) { delete estado.envios[k]; delete estado.ultimo[k]; delete estado.vistos[k]; }
fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
fs.writeFileSync(ESTADO, JSON.stringify(estado));
console.log(`\nPronto: ${envios.length} envio(s), ${saidas.length} lista(s), ${testados} links testados.`);
