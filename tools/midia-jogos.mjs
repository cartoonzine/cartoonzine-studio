#!/usr/bin/env node
/**
 * ScreenScraper como fonte PRINCIPAL dos jogos: capa (caixa), logo (wheel PNG), banner (fanart),
 * vídeo (snap) + sinopse em português, ano, gêneros e nº de jogadores.
 *
 * Os links de mídia do ScreenScraper levam as SUAS credenciais dentro da URL, então eles NUNCA
 * vão para o catálogo: o robô baixa cada arquivo e guarda no release "midia-jogos" deste
 * repositório (fora do histórico do git). No catálogo fica só o link público do release.
 *
 * Troca só o que está vazio, o que veio do SteamGridDB ou a miniatura automática do Internet Archive —
 * o que você pôs à mão fica. A sinopse é trocada quando a atual é curta/automática ou está em inglês
 * e o ScreenScraper tem em português.
 *
 *   node tools/midia-jogos.mjs                       (precisa de SS_DEV_ID, SS_DEV_PASSWORD, SS_USER, SS_PASSWORD
 *   node tools/midia-jogos.mjs --limite 50 --minutos 20     e, para guardar os arquivos, GITHUB_TOKEN + GITHUB_REPOSITORY)
 *   node tools/midia-jogos.mjs --sem-video --simular --colecao jogos
 *   node tools/midia-jogos.mjs --refazer             ignora a data da última busca
 */
import fs from 'node:fs';
import path from 'node:path';
import { Core, RAIZ, lerConfig, lerColecao, lerArgs } from './lib.mjs';

const args = lerArgs(process.argv.slice(2));
const config = lerConfig();
const limite = parseInt(args.limite || '200', 10);
const prazo = args.minutos ? Date.now() + parseFloat(args.minutos) * 60000 : Infinity;
const comVideo = !args['sem-video'];
const ss = { dev: process.env.SS_DEV_ID || '', devSenha: process.env.SS_DEV_PASSWORD || '', user: process.env.SS_USER || '', senha: process.env.SS_PASSWORD || '' };
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const repo = process.env.GITHUB_REPOSITORY || '';
const simular = !!args.simular || !token || !repo;
const TAG = 'midia-jogos';
const REFAZER_DIAS = 30;
const hoje = new Date().toISOString().slice(0, 10);

if (!ss.dev) { console.log('ℹ Sem SS_DEV_ID: nada a fazer.'); process.exit(0); }
if (simular && !args.simular) console.log('ℹ Sem GITHUB_TOKEN/GITHUB_REPOSITORY: simulação (nada é baixado nem salvo).');

// ---------- release "midia-jogos" (onde os arquivos ficam) ----------
const gh = async (metodo, url, corpo, cab = {}) => {
    const r = await fetch(url.startsWith('http') ? url : 'https://api.github.com' + url, {
        method: metodo, body: corpo,
        headers: Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'cartoonzine-studio' }, cab)
    });
    return r;
};
let release = null;
const assets = new Map();
async function prepararRelease() {
    let r = await gh('GET', `/repos/${repo}/releases/tags/${TAG}`);
    if (r.status === 404) {
        r = await gh('POST', `/repos/${repo}/releases`, JSON.stringify({
            tag_name: TAG, name: 'Mídia dos jogos (ScreenScraper)', make_latest: 'false',
            body: 'Capas, logos, banners e vídeos dos jogos baixados pelo robô do Studio (tools/midia-jogos.mjs). Não apague: o catálogo aponta para estes arquivos.'
        }), { 'Content-Type': 'application/json' });
    }
    if (!r.ok) throw new Error('release ' + TAG + ': HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    release = await r.json();
    for (let pag = 1; ; pag++) {
        const ra = await gh('GET', `/repos/${repo}/releases/${release.id}/assets?per_page=100&page=${pag}`);
        if (!ra.ok) break;
        const lista = await ra.json();
        lista.forEach(a => assets.set(a.name, a));
        if (lista.length < 100) break;
    }
}
async function enviar(nome, buf, tipo) {
    const velho = assets.get(nome);
    if (velho) await gh('DELETE', `/repos/${repo}/releases/assets/${velho.id}`);
    const r = await gh('POST', `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(nome)}`, buf, { 'Content-Type': tipo });
    if (!r.ok) throw new Error('envio de ' + nome + ': HTTP ' + r.status);
    const a = await r.json();
    assets.set(nome, a);
    return a.browser_download_url;
}

// ---------- baixar uma mídia do ScreenScraper ----------
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4' };
async function baixar(media, extra = {}) {
    if (!media || !media.url) return null;
    const u = new URL(media.url);
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, String(v));
    const r = await fetch(u.toString());
    if (!r.ok) return null;
    const tipo = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await r.arrayBuffer());
    if (!EXT[tipo] || buf.length < 1024) return null;           // "NOMEDIA" / erro em texto
    return { buf, tipo, ext: EXT[tipo] };
}

// ---------- fila ----------
// trocável: vazio, veio do SteamGridDB ou é a miniatura automática do Internet Archive (quase sempre
//   uma tela do jogo, não a caixa)
const trocavel = (v) => !v || /^https?:\/\/([^/]*\.)?steamgriddb\.com\//i.test(String(v)) || /^https?:\/\/archive\.org\/services\/img\//i.test(String(v));
// sinopse "de enchimento" das importações automáticas (ex.: "Jogo de MS-DOS (1998). Do acervo do Internet Archive.")
const sinopseFraca = (t) => !t || String(t).trim().length < 90 || /^jogo de .{0,40}\(\d{4}\)\.?\s*do acervo/i.test(String(t).trim());
const pareceIngles = (t) => {
    const p = ` ${String(t || '').toLowerCase()} `;
    const en = (p.match(/ (the|and|of|to|is|in|with|your|you|a) /g) || []).length;
    const pt = (p.match(/ (de|da|do|que|e|o|um|uma|com|para|os|as|seu|sua) /g) || []).length;
    return en > pt * 1.5 && en >= 3;
};
const fila = [];
for (const colecao of config.colecoes) {
    if (colecao.tipo !== 'jogo' || (args.colecao && args.colecao !== colecao.id)) continue;
    for (const { caminho, item } of lerColecao(colecao).entradas) {
        if (item._travado || !item.nome) continue;
        if (!args.refazer && item._ssEm && (Date.now() - Date.parse(item._ssEm)) < REFAZER_DIAS * 864e5) continue;
        fila.push({ caminho, colecao, item });
    }
}
// nunca buscados primeiro, depois os buscados há mais tempo
fila.sort((a, b) => (a.item._ssEm || '').localeCompare(b.item._ssEm || ''));
const lote = fila.slice(0, limite);
console.log(`${fila.length} jogos na fila do ScreenScraper; vou fazer ${lote.length} agora${comVideo ? '' : ' (sem vídeo)'}.`);

if (!simular) await prepararRelease();

let mudou = 0, achou = 0, naoAchou = 0;
for (const { caminho, colecao, item } of lote) {
    if (Date.now() > prazo) { console.log(`⏱ Tempo de ${args.minutos} min esgotado: o resto fica para a próxima rodada.`); break; }
    let jeu;
    try { jeu = await Core.buscarJogoScreenScraper(item.nome, ss, null, item.console); }
    catch (e) {
        console.log(`⚠ ${caminho}  ScreenScraper: ${e.message}`);
        if (/limite de consultas|recusad/i.test(e.message)) break;   // não adianta insistir hoje
        continue;
    }
    const novo = Object.assign({}, item, { _ssEm: hoje });
    const feito = [];
    if (!jeu) {
        naoAchou++;
        novo._ssId = 0;
        console.log(`· ${caminho}  não encontrado no ScreenScraper`);
    } else {
        achou++;
        novo._ssId = Number(jeu.id) || jeu.id;
        const m = Core.midiasScreenScraper(jeu);
        const base = `${colecao.id}--${Core.slugify(item.console || 'jogo')}--${Core.slugify(item.nome)}`.slice(0, 120);
        const pegar = async (campo, media, extra, rotulo) => {
            if (!media || !trocavel(item[campo])) return;
            if (simular) { feito.push(rotulo + ' (simulação)'); return; }
            try {
                const arq = await baixar(media, extra);
                if (!arq) return;
                novo[campo] = await enviar(`${base}--${campo}.${arq.ext}`, arq.buf, arq.tipo);
                feito.push(rotulo);
            } catch (e) { console.log(`  ⚠ ${rotulo}: ${e.message}`); }
        };
        await pegar('capa', m.capa, { maxwidth: 600, maxheight: 900 }, 'capa');
        await pegar('logo', m.logo, { maxwidth: 800, maxheight: 400 }, 'logo');
        await pegar('banner', m.banner, { maxwidth: 1920, maxheight: 1080 }, 'banner');
        if (comVideo) await pegar('video', m.video, {}, 'vídeo');
        // textos (sem URL, sem senha)
        const d = Core.dadosScreenScraper(jeu);
        if (d.sinopse && (sinopseFraca(item.descricao) || (d.sinopseLingua === 'pt' && pareceIngles(item.descricao)))) { novo.descricao = d.sinopse; feito.push('sinopse' + (d.sinopseLingua === 'pt' ? ' (pt)' : '')); }
        if (d.ano && !item.ano) { novo.ano = d.ano; feito.push('ano'); }
        if (d.generos && d.generos.length && !(item.generos && item.generos.length)) { novo.generos = d.generos; feito.push('gêneros'); }
        if (d.jogadores && !item.jogadores) { novo.jogadores = d.jogadores; feito.push('jogadores'); }
        console.log(`${feito.length ? '✅' : '·'} ${caminho}  [${d.nome || '?'} · ${d.sistema || '?'}]  ${feito.join(' · ') || 'nada novo'}`);
    }
    if (!simular) {
        const normal = Core.normalizarItem(novo, colecao);
        fs.writeFileSync(path.join(RAIZ, caminho), Core.serializar(normal));
        if (feito.length) mudou++;
    }
    await new Promise(ok => setTimeout(ok, 300)); // educado com o ScreenScraper (1 pedido por vez)
}
console.log(`\nScreenScraper: ${achou} encontrados · ${naoAchou} não encontrados · ${mudou} jogos ganharam dados` + (simular ? ' (simulação, nada salvo)' : ''));
