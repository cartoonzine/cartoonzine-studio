/**
 * YouToon automático: transforma uma LISTA DE CANAIS DO YOUTUBE em itens do YouToon (Desenhos 24H).
 *
 * Fonte (automatico/fontes.json), tipo "youtube-lista":
 *   { "nome": "...", "ativo": true, "colecao": "youtoon", "tipo": "youtube-lista",
 *     "url": "https://raw.githubusercontent.com/.../README.md",   ← lista em Markdown: [**Nome**](link) (nota)
 *     "secoes": ["Anime", "Cartoons", "Kids Media"],               ← seções (### Título) que entram
 *     "soCompletos": true,                                         ← só canais com episódios completos
 *     "maxPlaylists": 10, "minVideosPlaylist": 5,
 *     "excluir": ["Adult Swim", ...],                              ← canais que nunca entram
 *     "canais": { "Nome do canal": { "generos": [...], "idioma": "Português", "ignorar": true, "maxPlaylists": 3 } },
 *     "removerSumidos": true }
 *
 * Para cada canal, com a chave da YouTube Data API (secret YOUTUBE_API_KEY), o Studio gera:
 *   • "<Canal> 24H"           → youtube.com/channel/UC…/live   (só se o canal estiver AO VIVO agora)
 *   • "<Canal>"               → youtube.com/channel/UC…        (Episódios sem parar: todos os vídeos do canal)
 *   • "<Canal> · <playlist>"  → youtube.com/playlist?list=…    (as maiores playlists do canal)
 * O link @nome da lista vira o código UC do canal (o player do YouTube só aceita o UC).
 * Idioma: o que o canal declara no YouTube (pt / es / en, PT = Portugal); playlists com o idioma no
 * título ("Português", "Español"…) vão para a lista daquele idioma. Outros idiomas ficam de fora.
 * Custo da cota (10.000 unidades/dia grátis): ~4 unidades por canal.
 * Sem a chave, a fonte é pulada e nada do que já existe é apagado.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Core, RAIZ, lerColecao, salvarItem, baixarTexto } from './lib.mjs';

// ---------------------------------------------------------------- lista em Markdown
/** "[**Nome**](link) (nota)" dentro das seções "### Título" → [{secao, nome, url, nota}] (sem repetir link) */
export function lerListaMarkdown(texto, secoes) {
    const quero = secoes && secoes.length ? new Set(secoes.map(s => Core.normText(s))) : null;
    const out = [], vistos = new Set();
    let secao = null;
    for (const l of String(texto || '').split(/\r?\n/)) {
        const h = l.match(/^#{2,4}\s+(.+?)\s*$/);
        if (h) { secao = h[1].trim(); continue; }
        if (!secao || (quero && !quero.has(Core.normText(secao)))) continue;
        for (const m of l.matchAll(/\[\*\*(.+?)\*\*\]\((https?:\/\/[^)\s]+)\)\s*(?:\(([^]*)\))?/g)) {
            const url = m[2].replace(/\/+$/, '');
            const chave = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/(videos|featured|streams|playlists)$/, '');
            if (!/youtube\.com|youtu\.be/i.test(url) || vistos.has(chave)) continue;
            vistos.add(chave);
            out.push({ secao, nome: m[1].trim(), url, nota: (m[3] || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim() });
        }
    }
    return out;
}

// ---------------------------------------------------------------- filtros pela nota da lista
const COMPLETOS = /\bfull\b|marathon|live re-?runs?|complete (series|seasons?|episodes?)/i;
const ADULTO = /not suitable for kids|mature|adult|dark humor|shock comedy|nsfw/i;
// idiomas que o YouToon não tem (a lista avisa na nota ou no nome)
const OUTRO_IDIOMA = /french only|in french|en fran[cç]ais|polish|po polsku|hindi|indian languages|cantonese|japanese|korean|german only|italian only/i;
const NOME_OUTRO_IDIOMA = /\bofficiel\b|fran[cç]ais|po polsku|polsk|[぀-ヿ一-鿿가-힯ऀ-ॿ]/i;

/** Decide se o canal entra: {entra, motivo} */
export function classificarCanal(c, f = {}) {
    const ajuste = (f.canais || {})[c.nome] || {};
    const excl = (f.excluir || []).map(s => Core.normText(s));
    if (ajuste.ignorar || excl.some(e => e && Core.normText(c.nome).includes(e))) return { entra: false, motivo: 'excluído na configuração' };
    if (ADULTO.test(c.nota)) return { entra: false, motivo: 'conteúdo adulto' };
    if (!ajuste.idioma && (OUTRO_IDIOMA.test(c.nota) || NOME_OUTRO_IDIOMA.test(c.nome))) return { entra: false, motivo: 'idioma fora do YouToon' };
    if (f.soCompletos !== false && !ajuste.forcar && !COMPLETOS.test(c.nota)) return { entra: false, motivo: 'só clipes/trailers' };
    return { entra: true };
}

// gêneros que o Desenhos 24H entende (aliases das categorias da view)
const GENEROS = [
    [/anime|pok[eé]mon|yu-?gi-?oh|gundam|lupin|doraemon|beyblade/i, 'Anime'],
    [/classic|looney|popeye|garfield|pink panther|inspector gadget|retro|rerun/i, 'Clássicos'],
    [/phonics|math|science|teach|learn|educat|wildlife|biology|numberblocks|alphablocks/i, 'Educativos'],
    [/nursery|\bsongs\b|rhymes|super simple/i, 'Musicais'],
    [/super ?hero|marvel|transformers|power rangers|ninja|ben 10|avatar|slugterra|lyoko|(?<!live-)\baction\b/i, 'Heróis e Ação'],
    [/myster|spooky|spookiz|ghost|horror|scooby/i, 'Mistério e Sobrenatural'],
    [/spies|adventure|huntik|dragons/i, 'Aventura'],
    [/pony|winx|barbie|fairy|magic|mermaid|ever after|h2o/i, 'Fantasia e Magia'],
    [/peppa|bluey|dora|pj masks|blippi|curious george|backyardigans|nick jr|disney jr|preschool|toddler|baby|cocomelon|thomas/i, 'Pré-escolar'],
    [/comedy|slapstick|funny|oggy|zig|oddbods|simon'?s cat|johnny test|mr\.? bean|sponge/i, 'Comédia']
];
export function generosDe(c, ajuste = {}) {
    if (ajuste.generos && ajuste.generos.length) return ajuste.generos;
    const txt = `${c.nome} ${c.nota}`;
    const g = GENEROS.filter(([re]) => re.test(txt)).map(([, n]) => n);
    if (Core.normText(c.secao) === 'anime' && !g.includes('Anime')) g.unshift('Anime');
    if (!g.length) g.push(Core.normText(c.secao).includes('kids') ? 'Infantil' : 'Comédia');
    return [...new Set(g)].slice(0, 3);
}

// ---------------------------------------------------------------- idioma (listas do YouToon)
/** Código de idioma do YouTube (+ país) → nome do idioma no studio.config.json (ou null = fora) */
export function idiomaDoYouTube(codigo, pais) {
    const c = String(codigo || '').toLowerCase();
    if (/^pt/.test(c)) return (c === 'pt-pt' || String(pais).toUpperCase() === 'PT') ? 'Português (Portugal)' : 'Português';
    if (/^es/.test(c)) return 'Espanhol';
    if (/^en/.test(c)) return 'Inglês';
    return c ? null : undefined;          // undefined = o canal não declarou
}
/** Idioma escrito no título da playlist ("Português", "Español", "Dublado"…) */
export function idiomaDoTitulo(t) {
    const s = String(t || '');
    if (/portugal|portugu[eê]s europeu|\bpt-?pt\b/i.test(s)) return 'Português (Portugal)';
    if (/portugu[eê]s|brasil|dublad[oa]|\bpt-?br\b/i.test(s)) return 'Português';
    if (/espa[nñ]ol|castellano|latino|en espa/i.test(s)) return 'Espanhol';
    if (/\benglish\b|\bin english\b/i.test(s)) return 'Inglês';
    if (/fran[cç]ais|deutsch|italiano|polsk|русск|日本|한국|हिन्दी|العربية|türk/i.test(s)) return null;
    return undefined;
}

// ---------------------------------------------------------------- YouTube Data API v3
export function criarApi(chave, { fetchImpl = fetch, base = 'https://www.googleapis.com/youtube/v3/' } = {}) {
    let unidades = 0;
    const chamar = async (rota, params, custo = 1) => {
        const q = new URLSearchParams(Object.assign({}, params, { key: chave }));
        let ultimo;
        for (let t = 0; t < 3; t++) {
            const r = await fetchImpl(base + rota + '?' + q, { headers: { 'User-Agent': 'cartoonzine-studio' } });
            unidades += custo;
            if (r.ok) return r.json();
            let corpo = null; try { corpo = await r.json(); } catch (e) { /* */ }
            const razao = corpo && corpo.error && corpo.error.errors && corpo.error.errors[0] && corpo.error.errors[0].reason;
            ultimo = new Error(`YouTube API ${r.status}${razao ? ' (' + razao + ')' : ''}`);
            ultimo.razao = razao || '';
            if (r.status === 403 || r.status === 400 || r.status === 404) break;    // cota/chave/pedido: não adianta repetir
            await new Promise(ok => setTimeout(ok, 800 * (t + 1)));
        }
        throw ultimo;
    };
    const CAMPOS = 'snippet,contentDetails,brandingSettings';
    return {
        unidades: () => unidades,
        /** link do canal (UC…, @nome, /user/, /c/ ou nome solto) → dados do canal ou null */
        async canal(url) {
            const u = String(url);
            let m, j = null;
            if ((m = u.match(/\/channel\/(UC[\w-]{22})/))) j = await chamar('channels', { part: CAMPOS, id: m[1] });
            else if ((m = u.match(/\/@([^/?#]+)/))) j = await chamar('channels', { part: CAMPOS, forHandle: '@' + decodeURIComponent(m[1]) });
            else if ((m = u.match(/\/user\/([^/?#]+)/))) j = await chamar('channels', { part: CAMPOS, forUsername: m[1] });
            else if ((m = u.match(/youtube\.com\/(?:c\/)?([^/?#@]+)/))) {
                j = await chamar('channels', { part: CAMPOS, forHandle: '@' + m[1] });
                if (!j.items || !j.items.length) j = await chamar('channels', { part: CAMPOS, forUsername: m[1] });
            }
            const c = j && j.items && j.items[0];
            if (!c) return null;
            const sn = c.snippet || {}, br = (c.brandingSettings && c.brandingSettings.channel) || {};
            const th = sn.thumbnails || {};
            return {
                id: c.id, titulo: sn.title || '', descricao: sn.description || '',
                logo: (th.high || th.medium || th.default || {}).url || '',
                idioma: sn.defaultLanguage || br.defaultLanguage || '', pais: sn.country || br.country || '',
                uploads: (c.contentDetails && c.contentDetails.relatedPlaylists && c.contentDetails.relatedPlaylists.uploads) || ''
            };
        },
        /** lives acontecendo agora entre os 50 vídeos mais recentes do canal */
        async aoVivo(uploads) {
            if (!uploads) return [];
            const pl = await chamar('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 50 });
            const ids = (pl.items || []).map(i => i.contentDetails && i.contentDetails.videoId).filter(Boolean);
            if (!ids.length) return [];
            const v = await chamar('videos', { part: 'snippet', id: ids.join(','), maxResults: 50 });
            return (v.items || []).filter(x => x.snippet && x.snippet.liveBroadcastContent === 'live')
                .map(x => ({ id: x.id, titulo: x.snippet.title, idioma: x.snippet.defaultAudioLanguage || x.snippet.defaultLanguage || '', thumb: ((x.snippet.thumbnails || {}).high || {}).url || '' }));
        },
        /** playlists do canal (até 50) */
        async playlists(canalId) {
            const j = await chamar('playlists', { part: 'snippet,contentDetails', channelId: canalId, maxResults: 50 });
            return (j.items || []).map(p => ({
                id: p.id, titulo: (p.snippet && p.snippet.title) || '', videos: (p.contentDetails && p.contentDetails.itemCount) || 0,
                idioma: (p.snippet && p.snippet.defaultLanguage) || '',
                thumb: (((p.snippet || {}).thumbnails || {}).high || ((p.snippet || {}).thumbnails || {}).medium || {}).url || ''
            }));
        }
    };
}

const PLAYLIST_FORA = /trailer|teaser|\bshorts?\b|behind the scenes|\bbts\b|promo|\btoys?\b|unboxing|commercial|\bads?\b|interview|making of|reaction|clips? only|liked videos|favorites/i;

/** Monta os itens do YouToon de UM canal (pura: recebe os dados já buscados) */
export function itensDoCanal(c, dados, { lives = [], playlists = [] } = {}, f = {}) {
    const ajuste = (f.canais || {})[c.nome] || {};
    const generos = generosDe(c, ajuste);
    const idiomaCanal = ajuste.idioma || idiomaDoYouTube(dados.idioma, dados.pais) || (dados.idioma ? null : 'Inglês');
    const base = { generos, _canal: dados.id, _listaUrl: c.url };
    const itens = [];
    const nomeCanal = ajuste.nome || c.nome;
    const desc = `Canal oficial de ${nomeCanal} no YouTube: episódios sem parar.`;
    if (idiomaCanal) {
        if (lives.length) {
            itens.push(Object.assign({}, base, { nome: `${nomeCanal} 24H`, links: [`https://www.youtube.com/channel/${dados.id}/live`],
                logo: lives[0].thumb || dados.logo, descricao: lives[0].titulo, idioma: idiomaCanal }));
        }
        itens.push(Object.assign({}, base, { nome: nomeCanal, links: [`https://www.youtube.com/channel/${dados.id}`],
            logo: dados.logo, descricao: desc, idioma: idiomaCanal }));
    }
    const max = ajuste.maxPlaylists ?? f.maxPlaylists ?? 10, min = f.minVideosPlaylist ?? 5;
    playlists
        .filter(p => p.videos >= min && !PLAYLIST_FORA.test(p.titulo))
        .map(p => {
            // título diz o idioma > idioma declarado na playlist > idioma do canal (null = fora do YouToon)
            const doTitulo = idiomaDoTitulo(p.titulo), daPlaylist = idiomaDoYouTube(p.idioma);
            return Object.assign(p, { lingua: doTitulo !== undefined ? doTitulo : daPlaylist !== undefined ? daPlaylist : idiomaCanal });
        })
        .filter(p => p.lingua)
        .sort((a, b) => b.videos - a.videos)
        .slice(0, Math.max(0, max))
        .forEach(p => itens.push(Object.assign({}, base, {
            nome: `${nomeCanal} · ${p.titulo}`.slice(0, 120), links: [`https://www.youtube.com/playlist?list=${p.id}`],
            logo: p.thumb || dados.logo, descricao: `Playlist de ${nomeCanal} · ${p.videos} vídeos`, idioma: p.lingua
        })));
    return itens;
}

// ---------------------------------------------------------------- sincronização (chamada por tools/sincronizar.mjs)
export async function sincronizarYouTube(f, colecao, { raiz = RAIZ, origem, log = console.log, chave = process.env.YOUTUBE_API_KEY, fetchImpl, baseApi, texto } = {}) {
    if (!chave) {
        log('  ⚠ sem YOUTUBE_API_KEY: fonte pulada (nada foi apagado). Crie a chave e coloque nos Secrets do repositório.');
        return { pulada: true, criados: 0, atualizados: 0, erros: 0, removidos: 0 };
    }
    const lista = lerListaMarkdown(texto ?? await baixarTexto(f.url), f.secoes);
    const api = criarApi(chave, Object.assign({}, fetchImpl ? { fetchImpl } : {}, baseApi ? { base: baseApi } : {}));
    const conta = { criados: 0, atualizados: 0, erros: 0, removidos: 0, fora: 0, canais: 0 };
    const vistos = new Set(), canaisComFalha = new Set();
    const existentes = lerColecao(colecao, raiz).entradas;
    // itens feitos à mão (sem _origem) ou travados nunca são sobrescritos: o automático pula o nome
    const intocaveis = new Set(existentes.filter(e => e.item._travado || !e.item._origem || e.item._origem !== origem)
        .map(e => Core.normText(e.item.nome) + '|' + Core.normText(e.item.idioma || '')));
    let parouCota = false;
    for (const c of lista) {
        const cl = classificarCanal(c, f);
        if (!cl.entra) { conta.fora++; continue; }
        if (parouCota) { canaisComFalha.add(c.url); continue; }
        try {
            const dados = await api.canal(c.url);
            if (!dados) { log(`  ✗ ${c.nome}: canal não encontrado (${c.url})`); conta.erros++; canaisComFalha.add(c.url); continue; }
            const [lives, playlists] = await Promise.all([api.aoVivo(dados.uploads), api.playlists(dados.id)]);
            const itens = itensDoCanal(c, dados, { lives, playlists }, f);
            if (!itens.length) { conta.fora++; continue; }
            conta.canais++;
            for (const it of itens) {
                if (intocaveis.has(Core.normText(it.nome) + '|' + Core.normText(it.idioma || ''))) continue;
                it._origem = origem;
                const normal = Core.normalizarItem(it, colecao);
                const { erros } = Core.validarItem(normal, colecao);
                if (erros.length) { conta.erros++; log(`  ✗ ${it.nome}: ${erros.join('; ')}`); continue; }
                const r = salvarItem(colecao, normal, { raiz, substituir: true });
                vistos.add(r.caminho);
                if (r.acao === 'criado') conta.criados++; else if (r.acao === 'atualizado') conta.atualizados++;
            }
            log(`  • ${c.nome} → ${itens.length} item(ns)${lives.length ? ' · AO VIVO' : ''}`);
        } catch (e) {
            conta.erros++; canaisComFalha.add(c.url);
            log(`  ✗ ${c.nome}: ${e.message}`);
            if (/quota|keyInvalid|API_KEY|forbidden|accessNotConfigured/i.test(e.razao || e.message)) {
                parouCota = true;
                log('  ⚠ a API do YouTube recusou (cota/chave): os canais que faltam ficam como estavam até amanhã.');
            }
        }
    }
    // tira o que saiu da fonte (live que acabou, playlist apagada…) — nunca de canal que falhou hoje
    if (f.removerSumidos && !parouCota) {
        for (const e of existentes) {
            if (e.item._origem !== origem || e.item._travado || vistos.has(e.caminho)) continue;
            if (e.item._listaUrl && canaisComFalha.has(e.item._listaUrl)) continue;      // canal falhou hoje: fica como estava
            fs.rmSync(path.join(raiz, e.caminho)); conta.removidos++;
        }
    }
    log(`  ✅ ${conta.canais} canais · ${conta.criados} novos · 🔄 ${conta.atualizados} atualizados · ✗ ${conta.erros} com erro · 🗑 ${conta.removidos} removidos · ${conta.fora} fora do filtro · cota usada: ~${api.unidades()} unidades`);
    return conta;
}
