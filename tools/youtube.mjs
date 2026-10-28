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
    const CAMPOS = 'snippet,contentDetails,brandingSettings,statistics';
    const dadosDe = (c) => {
        const sn = c.snippet || {}, br = (c.brandingSettings && c.brandingSettings.channel) || {};
        const th = sn.thumbnails || {};
        return {
            id: c.id, titulo: sn.title || '', descricao: sn.description || '', customUrl: sn.customUrl || '',
            logo: (th.high || th.medium || th.default || {}).url || '',
            idioma: sn.defaultLanguage || br.defaultLanguage || '', pais: sn.country || br.country || '',
            inscritos: +((c.statistics && c.statistics.subscriberCount) || 0), videos: +((c.statistics && c.statistics.videoCount) || 0),
            uploads: (c.contentDetails && c.contentDetails.relatedPlaylists && c.contentDetails.relatedPlaylists.uploads) || ''
        };
    };
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
            return c ? dadosDe(c) : null;
        },
        /** busca CANAIS pelo nome (custa 100 unidades) → dados dos canais achados (+1 unidade) */
        async buscarCanais(q, { idioma, regiao, max = 10 } = {}) {
            const j = await chamar('search', Object.assign({ part: 'snippet', type: 'channel', q, maxResults: max },
                idioma ? { relevanceLanguage: idioma } : {}, regiao ? { regionCode: regiao } : {}), 100);
            const ids = (j.items || []).map(i => (i.id && i.id.channelId) || (i.snippet && i.snippet.channelId)).filter(Boolean);
            if (!ids.length) return [];
            const d = await chamar('channels', { part: CAMPOS, id: ids.join(','), maxResults: 50 });
            return (d.items || []).map(dadosDe);
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

// ---------------------------------------------------------------- VERSÕES LOCALIZADAS (PT-BR, ES, PT-PT)
// Para cada desenho da lista em inglês, o Studio procura o canal OFICIAL do mesmo desenho em outro idioma
// (ex.: "Peppa Pig" → "Peppa Pig em Português Brasil", "Peppa Pig en Español"). A busca custa 100 unidades
// da cota, então o resultado fica guardado em automatico/youtoon-localizados.json (feito uma vez; os
// "não achou" são procurados de novo depois de 60 dias) e a descoberta é dividida em vários dias.
// Você pode corrigir esse arquivo: "ignorar": true tira um canal; "id": "UC…" com "manual": true fixa outro.
export const ALVOS_LOCAIS = {
    'Português': { busca: 'em português', idioma: 'pt', regiao: 'BR', sinal: /portugu[eê]s|brasil|\bbr\b|dublad/i },
    'Espanhol': { busca: 'en español', idioma: 'es', regiao: 'MX', sinal: /espa[nñ]ol|latino|castellano|latinoam/i },
    'Português (Portugal)': { busca: 'Portugal português', idioma: 'pt', regiao: 'PT', sinal: /portugal|\bpt-?pt\b/i }
};
// nomes traduzidos dos desenhos (o canal localizado nem sempre usa o nome em inglês)
const TRADUCOES = {
    'spongebob': ['bob esponja'], 'smurfs': ['smurfs', 'pitufos', 'estrumpfes'], 'thomas': ['thomas e seus amigos', 'thomas y sus amigos', 'thomas e amigos', 'thomas'],
    'shaun the sheep': ['shaun', 'oveja shaun', 'ovelha'], 'sesame street': ['sésamo', 'sesamo'], 'adventure time': ['hora de aventura'],
    'curious george': ['curioso', 'jorge el curioso', 'george'], 'wild kratts': ['kratts', 'kratt'], 'fairly oddparents': ['padrinhos mágicos', 'padrinos mágicos'],
    'totally spies': ['totally spies', 'espiãs', 'espías'], 'masha': ['masha'], 'oggy': ['oggy'], 'zig': ['zig'], 'loud house': ['loud'],
    'pokemon': ['pokémon', 'pokemon'], 'yu-gi-oh': ['yu-gi-oh', 'yugioh'], 'my little pony': ['my little pony'], 'winx': ['winx'],
    'peppa': ['peppa'], 'pj masks': ['pj masks'], 'dora': ['dora'], 'barbie': ['barbie'], 'lego': ['lego'], 'garfield': ['garfield'],
    'popeye': ['popeye'], 'ben 10': ['ben 10'], 'mr bean': ['mr bean', 'mr. bean'], 'miraculous': ['miraculous', 'ladybug'],
    'super simple': ['super simple'], 'numberblocks': ['numberblocks'], 'alphablocks': ['alphablocks'], 'blippi': ['blippi'],
    'transformers': ['transformers'], 'power rangers': ['power rangers'], 'angry birds': ['angry birds'], 'oddbods': ['oddbods'],
    'cartoon network': ['cartoon network'], 'disney': ['disney'], 'nick jr': ['nick jr'], 'nicktoons': ['nicktoons', 'nickelodeon'],
    'cartoonito': ['cartoonito'], 'pbs kids': ['pbs kids'], 'wb kids': ['wb kids', 'warner'], 'clifford': ['clifford'],
    'inspector gadget': ['inspetor bugiganga', 'inspector gadget'], 'simon': ["simon's cat", 'simon'], 'gormiti': ['gormiti']
};
const FRACAS = new Set(['little', 'network', 'house', 'time', 'world', 'club', 'adventures', 'super', 'magic', 'mighty', 'space', 'studio', 'animation']);
const PALAVRAS_VAZIAS = new Set(['the', 'and', 'official', 'oficial', 'officiel', 'channel', 'canal', 'tv', 'kids', 'for', 'of', 'en', 'em', 'de', 'do', 'da', 'english', 'uk', 'usa', 'us', 'classic', 'scholastic', 'videos', 'educational', 'show', 'series', 'cartoon', 'cartoons', 'friends', 'big', 'red', 'dog']);
/** Palavras que identificam o desenho no nome do canal localizado */
export function chavesDoDesenho(nome) {
    const base = Core.normText(String(nome).split(/\s[-–|:]\s|\//)[0]).replace(/[!.'’]/g, '').replace(/&/g, ' ');
    const chaves = new Set();
    for (const [k, nomes] of Object.entries(TRADUCOES)) if (base.includes(Core.normText(k))) nomes.forEach(n => chaves.add(Core.normText(n)));
    const traduzido = chaves.size > 0;
    const fortes = base.replace(/\bcartoon network\b/, 'cartoonnetwork').split(/\s+/).filter(w => w.length >= 3 && !PALAVRAS_VAZIAS.has(w)).map(w => w === 'cartoonnetwork' ? 'cartoon network' : w);
    if (fortes.length >= 2) chaves.add(fortes.slice(0, 2).join(' '));     // "peppa pig", "zig sharko"…
    else if (fortes.length === 1 && (fortes[0].length >= 4 || fortes[0].includes(' '))) chaves.add(fortes[0]);
    // uma palavra solta só vale se for bem própria do desenho (não "little", "network", "house"…)
    if (!traduzido && fortes[0] && fortes[0].length >= 5 && !FRACAS.has(fortes[0])) chaves.add(fortes[0]);
    return [...chaves].filter(Boolean);
}
const NAO_OFICIAL = /\bfan\b|fandub|fanmade|react|reacci|rea[cç][aã]o|toys?\b|brinquedo|juguete|unbox|asmr|gameplay|\bjogos?\b|\bjuegos?\b|mods?\b|minecraft|roblox|edits?\b|memes?\b|compilad[oa]s? por|tribute|tributo|cover\b|karaok/i;
/** Escolhe, entre os canais achados na busca, o oficial do desenho no idioma pedido (ou null) */
export function escolherLocalizado(original, candidatos, alvo, { minInscritos = 50000, idOriginal } = {}) {
    const A = ALVOS_LOCAIS[alvo];
    const chaves = chavesDoDesenho(original.nome);
    let melhor = null;
    for (const c of candidatos) {
        if (!c || c.id === idOriginal) continue;
        const texto = Core.normText(`${c.titulo} ${c.customUrl}`);
        const textoLongo = `${c.titulo} ${c.customUrl} ${String(c.descricao).slice(0, 400)}`;
        if (!chaves.some(k => texto.includes(k))) continue;                         // não é o mesmo desenho
        if (NAO_OFICIAL.test(c.titulo) || NAO_OFICIAL.test(c.customUrl)) continue;  // fã, reação, brinquedos…
        const lang = idiomaDoYouTube(c.idioma, c.pais);
        const sinalNome = A.sinal.test(textoLongo);
        // idioma: o canal declara, o país bate ou o nome/descrição diz
        let idiomaOk = lang === alvo || sinalNome || (alvo === 'Português' && c.pais === 'BR') || (alvo === 'Espanhol' && /^(MX|ES|AR|CO|CL|PE|US)$/.test(c.pais)) || (alvo === 'Português (Portugal)' && c.pais === 'PT');
        if (alvo === 'Português' && (c.pais === 'PT' || /portugal/i.test(c.titulo))) idiomaOk = false;
        if (alvo === 'Português (Portugal)' && !(c.pais === 'PT' || /portugal/i.test(textoLongo))) idiomaOk = false;
        if (lang && lang !== alvo && !sinalNome) idiomaOk = false;                 // declara outro idioma
        if (!idiomaOk) continue;
        const piso = alvo === 'Português (Portugal)' ? Math.min(minInscritos, 10000) : minInscritos;
        if (c.inscritos < piso || c.videos < 10) continue;
        const pontos = Math.log10(c.inscritos + 1) + (/oficial|official|officiel/i.test(textoLongo) ? 1.5 : 0) + (lang === alvo ? 1 : 0) + (sinalNome ? 0.5 : 0);
        if (!melhor || pontos > melhor.pontos) melhor = Object.assign({ pontos }, c);
    }
    return melhor;
}
/** Tira do nome do canal localizado os penduricalhos ("- Canal Oficial", "| Official"…) */
export function nomeLimpo(t) {
    return String(t || '').replace(/\s*[-–|·]\s*(canal )?(oficial|official)( channel| canal)?\s*$/i, '').replace(/\s*\((canal )?(oficial|official)\)\s*$/i, '').trim() || String(t || '').trim();
}

const DIA = 864e5;
/** Descobre (com limite de buscas por dia) e sincroniza os canais localizados. Guarda o achado no cache. */
async function localizar({ f, originais, api, raiz, log, salvar, ehCota, canaisComFalha }) {
    const L = f.localizar || {};
    const alvos = (L.idiomas && L.idiomas.length ? L.idiomas : Object.keys(ALVOS_LOCAIS)).filter(a => ALVOS_LOCAIS[a]);
    const arq = path.join(raiz, 'automatico', L.arquivo || 'youtoon-localizados.json');
    let cache = { _comentario: '', canais: {} };
    try { cache = JSON.parse(fs.readFileSync(arq, 'utf8')); if (!cache.canais) cache.canais = {}; } catch (e) { /* primeira vez */ }
    cache._comentario = 'Canais oficiais localizados que o Studio achou para cada desenho da lista (YouTube). Para tirar um: "ignorar": true. Para trocar: coloque "id": "UC…" e "manual": true. "nada": ainda não achou (procura de novo depois de 60 dias).';
    const antes = JSON.stringify(cache);
    let buscas = 0, canais = 0, parouCota = false;
    const limite = L.buscasPorDia ?? 60, hoje = new Date().toISOString().slice(0, 10);
    // 1) descobrir o que falta (cada busca = 100 unidades da cota)
    fora: for (const { c, dados } of originais) {
        const idiomaOriginal = idiomaDoYouTube(dados.idioma, dados.pais) || 'Inglês';
        for (const alvo of alvos) {
            if (alvo === idiomaOriginal) continue;
            const reg = (cache.canais[c.nome] = cache.canais[c.nome] || {});
            const e = reg[alvo];
            if (e && (e.id || e.ignorar || (e.nada && Date.now() - Date.parse(e.checadoEm || 0) < 60 * DIA))) continue;
            if (buscas >= limite) break fora;
            const A = ALVOS_LOCAIS[alvo];
            const nucleo = String(c.nome).split(/\s[-–|:]\s|\//)[0].replace(/\b(official|oficial)\b/ig, '').replace(/\s+/g, ' ').trim();
            try {
                buscas++;
                const achados = await api.buscarCanais(`${nucleo} ${A.busca}`, { idioma: A.idioma, regiao: A.regiao });
                const ok = escolherLocalizado(c, achados, alvo, { minInscritos: L.minInscritos ?? 50000, idOriginal: dados.id });
                reg[alvo] = ok ? { id: ok.id, titulo: ok.titulo, inscritos: ok.inscritos, pais: ok.pais || undefined, achadoEm: hoje } : { nada: true, checadoEm: hoje };
                log(`  🔎 ${c.nome} [${alvo}] → ${ok ? ok.titulo + ' (' + ok.inscritos.toLocaleString('pt-BR') + ' inscritos)' : 'nenhum canal oficial'}`);
            } catch (e) {
                log(`  ✗ busca ${c.nome} [${alvo}]: ${e.message}`);
                if (ehCota(e)) { parouCota = true; break fora; }
            }
        }
    }
    if (JSON.stringify(cache) !== antes) {
        const ordenado = { _comentario: cache._comentario, canais: Object.fromEntries(Object.keys(cache.canais).sort((a, b) => a.localeCompare(b)).map(k => [k, cache.canais[k]])) };
        fs.writeFileSync(arq, JSON.stringify(ordenado, null, 2) + '\n');
    }
    // 2) sincronizar os canais localizados já conhecidos (live / episódios / playlists, como os originais)
    if (!parouCota) {
        const usados = new Set(originais.map(o => o.dados.id));
        for (const { c } of originais) {
            const reg = cache.canais[c.nome] || {};
            const ajusteOrig = (f.canais || {})[c.nome] || {};
            for (const alvo of alvos) {
                const e = reg[alvo];
                if (!e || !e.id || e.ignorar || usados.has(e.id)) continue;
                usados.add(e.id);
                const c2 = { nome: nomeLimpo(e.titulo) || c.nome, nota: c.nota, secao: c.secao, url: `https://www.youtube.com/channel/${e.id}` };
                try {
                    const dados = await api.canal(c2.url);
                    if (!dados) { canaisComFalha.add(c2.url); continue; }
                    const [lives, playlists] = await Promise.all([api.aoVivo(dados.uploads), api.playlists(dados.id)]);
                    const f2 = Object.assign({}, f, { canais: { [c2.nome]: { idioma: alvo, generos: generosDe(c, ajusteOrig), maxPlaylists: ajusteOrig.maxPlaylists } } });
                    const itens = itensDoCanal(c2, dados, { lives, playlists }, f2);
                    if (!itens.length) continue;
                    canais++;
                    salvar(itens);
                    log(`  • ${c2.nome} [${alvo}] → ${itens.length} item(ns)${lives.length ? ' · AO VIVO' : ''}`);
                } catch (err) {
                    canaisComFalha.add(c2.url);
                    log(`  ✗ ${c2.nome}: ${err.message}`);
                    if (ehCota(err)) { parouCota = true; return { canais, buscas, parouCota }; }
                }
            }
        }
    }
    return { canais, buscas, parouCota };
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
    const ehCota = (e) => /quota|keyInvalid|API_KEY|forbidden|accessNotConfigured|dailyLimit/i.test(e.razao || e.message);
    const salvar = (itens) => {
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
    };
    const originais = [];          // canais da lista que deram certo hoje (base para achar as versões localizadas)
    for (const c of lista) {
        const cl = classificarCanal(c, f);
        if (!cl.entra) { conta.fora++; continue; }
        if (parouCota) { canaisComFalha.add(c.url); continue; }
        try {
            const dados = await api.canal(c.url);
            if (!dados) { log(`  ✗ ${c.nome}: canal não encontrado (${c.url})`); conta.erros++; canaisComFalha.add(c.url); continue; }
            const [lives, playlists] = await Promise.all([api.aoVivo(dados.uploads), api.playlists(dados.id)]);
            originais.push({ c, dados });
            const itens = itensDoCanal(c, dados, { lives, playlists }, f);
            if (!itens.length) { conta.fora++; continue; }
            conta.canais++;
            salvar(itens);
            log(`  • ${c.nome} → ${itens.length} item(ns)${lives.length ? ' · AO VIVO' : ''}`);
        } catch (e) {
            conta.erros++; canaisComFalha.add(c.url);
            log(`  ✗ ${c.nome}: ${e.message}`);
            if (ehCota(e)) {
                parouCota = true;
                log('  ⚠ a API do YouTube recusou (cota/chave): os canais que faltam ficam como estavam até amanhã.');
            }
        }
    }

    // 🌎 versões localizadas (PT-BR, ES, PT-PT) dos mesmos desenhos
    if (f.localizar && !parouCota) {
        const r = await localizar({ f, originais, api, raiz, log, salvar, ehCota, canaisComFalha });
        conta.localizados = r.canais; conta.buscas = r.buscas;
        if (r.parouCota) parouCota = true;
    }
    // tira o que saiu da fonte (live que acabou, playlist apagada…) — nunca de canal que falhou hoje
    if (f.removerSumidos && !parouCota) {
        for (const e of existentes) {
            if (e.item._origem !== origem || e.item._travado || vistos.has(e.caminho)) continue;
            if (e.item._listaUrl && canaisComFalha.has(e.item._listaUrl)) continue;      // canal falhou hoje: fica como estava
            fs.rmSync(path.join(raiz, e.caminho)); conta.removidos++;
        }
    }
    if (f.localizar) log(`  🌎 versões localizadas: ${conta.localizados || 0} canais · ${conta.buscas || 0} buscas hoje`);
    log(`  ✅ ${conta.canais} canais · ${conta.criados} novos · 🔄 ${conta.atualizados} atualizados · ✗ ${conta.erros} com erro · 🗑 ${conta.removidos} removidos · ${conta.fora} fora do filtro · cota usada: ~${api.unidades()} unidades`);
    return conta;
}
