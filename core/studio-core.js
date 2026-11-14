/**
 * @fileoverview studio-core.js — Núcleo do Cartoonzine Studio
 *
 * Roda IGUAL no navegador (window.StudioCore) e no Node (require), no mesmo
 * estilo do catalog-core.js do cartoonzine-cloud. Tudo que define "como um
 * conteúdo é descrito, entendido e publicado" mora aqui:
 *
 *   - campos de cada tipo de coleção (o painel monta os formulários com isso)
 *   - leitura inteligente de texto colado (nome | link, M3U, mensagem do
 *     @CZStreamBot, links soltos, links do Internet Archive)
 *   - detecção de temporada/episódio pelo nome do arquivo e montagem de séries
 *   - preenchimento automático (Wikipedia, Internet Archive)
 *   - validação
 *   - compilação de uma coleção no formato que o cartoonzine-cloud lê
 *
 * Assim o painel (prévia) e o build (publicação) nunca divergem.
 */
(function (root, factory) {
    const api = factory();
    if (root) root.StudioCore = api;
    if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const VERSAO = '1.1.0';

    // ------------------------------------------------------------------
    // Texto
    // ------------------------------------------------------------------
    function semAcento(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    /** "Caverna do Dragão!" -> "caverna-do-dragao" */
    function slugify(s) {
        const out = semAcento(s).toLowerCase()
            .replace(/&/g, ' e ')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80)
            .replace(/-+$/, '');
        return out || 'item';
    }

    /** Comparação de nomes: sem acento, minúsculo, só letras e números. */
    function normText(s) {
        return semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function limparHtml(s) {
        return String(s || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }

    function lista(v) {
        if (v === undefined || v === null || v === '') return [];
        if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x.trim() : x)).filter(x => x !== '' && x != null);
        return String(v).split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    }

    function inteiro(v) {
        if (v === undefined || v === null || v === '') return undefined;
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : undefined;
    }

    // ------------------------------------------------------------------
    // Links
    // ------------------------------------------------------------------
    const RE_URL = /(?:https?:\/\/|magnet:\?)[^\s<>"'`]+/gi;
    const RE_EXT_VIDEO = /\.(mp4|mkv|avi|mov|webm|m4v|ogv|mpeg|mpg|ts|m3u8)(\?|#|$)/i;
    const RE_EXT_AUDIO = /\.(mp3|aac|ogg|opus|flac|m4a|wav|pls)(\?|#|$)/i;

    function linkValido(u) {
        if (typeof u !== 'string') return false;
        if (/^magnet:\?/i.test(u)) return /xt=urn:/i.test(u);
        try {
            const x = new URL(u);
            return (x.protocol === 'http:' || x.protocol === 'https:') && !!x.hostname && x.hostname.includes('.');
        } catch (e) { return false; }
    }

    function limparLink(u) {
        return String(u || '').trim().replace(/[)\]}>.,;`*]+$/, '');
    }

    /** Nome do arquivo no fim do link, decodificado ("Naruto%20S01E01.mp4" -> "Naruto S01E01.mp4"). */
    function nomeDoLink(u) {
        if (/^magnet:/i.test(u)) {
            const m = /[?&]dn=([^&]+)/i.exec(u);
            return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
        }
        try {
            const x = new URL(u);
            const partes = x.pathname.split('/').filter(Boolean);
            const ult = partes.length ? decodeURIComponent(partes[partes.length - 1]) : '';
            return ult;
        } catch (e) { return ''; }
    }

    /** Links do @CZStreamBot (FileToLink/Thunder): /watch/... é a página do player, o resto é o arquivo direto. */
    function ehLinkDePaginaDoBot(u) {
        try { return /^\/watch\//.test(new URL(u).pathname); } catch (e) { return false; }
    }

    function idDoArchive(u) {
        const m = /archive\.org\/(?:details|download|embed)\/([^/?#\s]+)/i.exec(String(u || ''));
        return m ? decodeURIComponent(m[1]) : null;
    }

    // ------------------------------------------------------------------
    // Nome de arquivo -> título, ano, temporada, episódio
    // ------------------------------------------------------------------
    const LIXO_NOME = /\b(480p|576p|720p|1080p|2160p|4k|uhd|hdr|x264|x265|h\.?264|h\.?265|hevc|aac\d?(\.\d)?|ac3|dts|web[-. ]?dl|webrip|bluray|blu[-. ]?ray|brrip|bdrip|dvdrip|hdtv|hdrip|remux|10bit|8bit|yify|rarbg|proper|repack)\b/gi;

    /**
     * Entende nomes como:
     *   "Naruto S01E03 Dublado 720p.mp4"  -> serie Naruto, T1 E3, audio Dublado
     *   "Caverna do Dragão - 1x05 - O Vale dos Unicórnios.mkv"
     *   "Pica-Pau T2E10.mp4", "Dragon Ball Episódio 12", "Popeye (1933).mp4"
     */
    function analisarNome(bruto) {
        let s = String(bruto || '').trim();
        s = s.replace(/\.(pdf|epub|mobi|azw3|cbz|cbr|cb7|djvu|mp4|mkv|avi|mov|webm|m4v|ogv|mpeg|mpg|ts|m3u8|mp3|aac|ogg|zip|7z|rar|nes|smc|sfc|md|gen|bin|iso|cue|chd|gba|gbc|gb|n64|z64|nds|pce|sms|gg)$/i, '');
        if (!/\s/.test(s) && /[._]/.test(s)) s = s.replace(/[._]+/g, ' ');
        else s = s.replace(/_+/g, ' ');

        let audio;
        if (/\b(dual[ -]?audio|dual)\b/i.test(s)) audio = 'Dual Áudio';
        else if (/\b(dublado|dub|ptbr|pt-br)\b/i.test(s)) audio = 'Dublado';
        else if (/\b(legendado|leg|sub)\b/i.test(s)) audio = 'Legendado';

        s = s.replace(/\[[^\]]*\]/g, ' ')
            .replace(LIXO_NOME, ' ')
            .replace(/\b(dual[ -]?audio|dublado|legendado|ptbr|pt-br)\b/gi, ' ')
            .replace(/\s{2,}/g, ' ').trim();

        let temporada, episodio, epTitulo, serie;
        const padroes = [
            /^(.*?)[\s\-–_.]*\bS(\d{1,2})\s*[\s._-]?\s*E(\d{1,4})\b(.*)$/i,
            /^(.*?)[\s\-–_.]*\bT(\d{1,2})\s*[\s._-]?\s*E(\d{1,4})\b(.*)$/i,
            /^(.*?)[\s\-–_.]*\b(\d{1,2})x(\d{1,4})\b(.*)$/i,
            /^(.*?)[\s\-–_.]*\bTemporada\s*(\d{1,2})\D{0,5}Epis[oó]dio\s*(\d{1,4})\b(.*)$/i,
        ];
        for (const re of padroes) {
            const m = re.exec(s);
            if (m) {
                temporada = parseInt(m[2], 10); episodio = parseInt(m[3], 10); epTitulo = m[4];
                if (m[1].trim()) serie = m[1];
                break;
            }
        }
        // "S02E01.mp4" sem nome da série: guarda temporada/episódio (útil ao colar episódios dentro de uma série)
        if (!serie && episodio !== undefined) {
            const tit = String(epTitulo || '').replace(/^[\s\-–_.:|]+|[\s\-–_.:|]+$/g, '').trim();
            return { nome: tit || `T${temporada}E${episodio}`, temporada, episodio, tituloEpisodio: tit || undefined, audio };
        }
        if (!serie && episodio === undefined) {
            const m = /^(.*?)[\s\-–_.]*\b(?:Epis[oó]dio|Ep\.?|EP|Cap[ií]tulo|Cap\.?)\s*(\d{1,4})\b(.*)$/i.exec(s);
            if (m && m[1].trim()) { serie = m[1]; temporada = 1; episodio = parseInt(m[2], 10); epTitulo = m[3]; }
        }

        let ano;
        const alvo = serie || s;
        const mAno = /[(\[]\s*((?:19|20)\d{2})\s*[)\]]|\s((?:19|20)\d{2})$/.exec(alvo);
        if (mAno) ano = parseInt(mAno[1] || mAno[2], 10);
        const tirarAno = t => t.replace(/[(\[]\s*(?:19|20)\d{2}\s*[)\]]/g, ' ').replace(/\s(?:19|20)\d{2}$/, ' ');
        const arrumar = t => tirarAno(String(t || '')).replace(/[\s\-–_.:|]+$/g, '').replace(/^[\s\-–_.:|]+/g, '').replace(/\s{2,}/g, ' ').trim();

        if (serie) {
            return {
                nome: arrumar(serie), serie: arrumar(serie), temporada, episodio,
                tituloEpisodio: arrumar(epTitulo) || undefined, ano, audio
            };
        }
        return { nome: arrumar(s) || String(bruto || '').trim(), ano, audio };
    }

    // ------------------------------------------------------------------
    // M3U
    // ------------------------------------------------------------------
    function lerM3U(texto) {
        const out = [];
        let atual = null;
        let opcoes = {};
        for (const linhaBruta of String(texto || '').split(/\r?\n/)) {
            const linha = linhaBruta.trim();
            if (!linha) continue;
            if (/^#EXTINF/i.test(linha)) {
                const attrs = {};
                const re = /([\w-]+)="([^"]*)"/g;
                let m;
                while ((m = re.exec(linha))) attrs[m[1].toLowerCase()] = m[2];
                const virgula = linha.lastIndexOf(',');
                const nome = virgula >= 0 ? linha.slice(virgula + 1).trim() : '';
                atual = { nome: nome || attrs['tvg-name'] || '', attrs };
            } else if (/^#EXTVLCOPT:/i.test(linha)) {
                const [k, ...v] = linha.slice(11).split('=');
                opcoes[k.trim().toLowerCase()] = v.join('=').trim();
            } else if (linha.startsWith('#')) {
                continue;
            } else if (atual) {
                const a = atual.attrs;
                const e = {
                    nome: atual.nome,
                    links: [linha],
                    logo: a['tvg-logo'],
                    grupo: a['group-title'],
                    tvgId: a['tvg-id'],
                    pais: a['tvg-country'],
                    idioma: a['tvg-language']
                };
                const headers = {};
                if (opcoes['http-user-agent']) headers['User-Agent'] = opcoes['http-user-agent'];
                if (opcoes['http-referrer'] || opcoes['http-referer']) headers['Referer'] = opcoes['http-referrer'] || opcoes['http-referer'];
                if (Object.keys(headers).length) e.headers = headers;
                out.push(limparVazios(e));
                atual = null; opcoes = {};
            }
        }
        return out;
    }

    function m3uEscapar(v) { return String(v == null ? '' : v).replace(/"/g, "'").replace(/[\r\n]+/g, ' '); }

    // ------------------------------------------------------------------
    // Leitura de texto colado ("adição rápida")
    // ------------------------------------------------------------------
    /**
     * Transforma qualquer texto colado em "entradas" (rascunhos de item):
     *   - lista M3U inteira
     *   - linhas "Nome | link | capa"  ou  "Nome - link"  ou  "Nome link"
     *   - links soltos (o nome vem do arquivo no link)
     *   - mensagens do @CZStreamBot (usa o link de Download, ignora o /watch/)
     *   - links do archive.org (marcados para importar depois, com `archive`)
     * Cada entrada: { nome, links:[...], capa?, archive?, ...analisarNome() }
     */
    function lerTextoColado(texto) {
        let t = String(texto || '');
        const entradas = [];
        if (/#EXTINF/i.test(t)) {
            // separa os blocos M3U (#EXTINF + opções + link) do resto do texto
            const linhas = t.split(/\r?\n/), m3u = [], resto = [];
            for (let i = 0; i < linhas.length; i++) {
                if (!/^\s*#EXTINF/i.test(linhas[i])) { if (!/^\s*#EXTM3U/i.test(linhas[i])) resto.push(linhas[i]); continue; }
                m3u.push(linhas[i]);
                while (i + 1 < linhas.length && /^\s*#/.test(linhas[i + 1]) && !/^\s*#EXTINF/i.test(linhas[i + 1])) m3u.push(linhas[++i]);
                if (i + 1 < linhas.length) m3u.push(linhas[++i]);
            }
            for (const e of lerM3U(m3u.join('\n'))) entradas.push(Object.assign(analisarNome(e.nome), e, { nome: e.nome }));
            t = resto.join('\n');
        }
        const vistos = new Set(entradas.flatMap(e => e.links || []));
        let textoAnterior = '';
        // Link do TMDB/IMDb sozinho numa linha vale para os links das linhas seguintes (até uma linha vazia)
        let refPendente = null, refLinha = null;
        for (const linhaBruta of t.split(/\r?\n/)) {
            const linha = linhaBruta.replace(/[`*>]+/g, ' ').trim();
            if (!linha) { refPendente = null; continue; }
            let urls = (linha.match(RE_URL) || []).map(limparLink).filter(linkValido);
            const refs = {};
            urls = urls.filter(u => { const r = refDoLink(u); if (r) { Object.assign(refs, r); return false; } return true; });
            const tt = /(?:^|[\s|])(tt\d{6,10})(?:$|[\s|])/i.exec(linha);
            if (tt && !refs.imdb) refs.imdb = tt[1].toLowerCase();
            refLinha = Object.keys(refs).length ? refs : null;
            if (refLinha && !urls.length) { refPendente = refLinha; continue; }

            if (!urls.length) {
                // Texto puro: pode ser o nome do arquivo que vem antes do link (ex.: mensagem do bot)
                if (!/^(✨|📂|🚀|🖥|⌛|your links|file size|download link|stream link|note:|links remain|🔗)/i.test(linha)) textoAnterior = linha;
                continue;
            }

            // "Nome | link | capa"
            if (linha.includes('|')) {
                const partes = linha.split('|').map(s => s.trim());
                const nome = partes.find(p => p && !linkValido(limparLink(p)) && !/^tt\d{6,10}$/i.test(p));
                const linksLinha = partes.map(limparLink).filter(u => linkValido(u) && !refDoLink(u));
                const principais = linksLinha.filter(u => !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u));
                const capa = linksLinha.find(u => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u));
                adicionar(nome, principais, capa);
                continue;
            }

            const resto = linha.replace(RE_URL, ' ').replace(/^[\s\-–:|•]+|[\s\-–:|•]+$/g, '').trim();
            for (const u of urls) {
                if (ehLinkDePaginaDoBot(u)) continue; // o mesmo arquivo já vem pelo link de download
                adicionar(resto || null, [u]);
            }
        }
        return entradas;

        function adicionar(nomeInformado, links, capa) {
            links = (links || []).filter(u => !vistos.has(u));
            if (!links.length) return;
            links.forEach(u => vistos.add(u));
            const archive = idDoArchive(links[0]);
            const doArquivo = nomeDoLink(links[0]);
            let base = nomeInformado;
            if (!base && doArquivo && /\.[a-z0-9]{2,4}$/i.test(doArquivo)) base = doArquivo;
            if (!base && textoAnterior) base = textoAnterior;
            if (!base) base = archive || doArquivo || hostDe(links[0]);
            textoAnterior = '';
            const info = analisarNome(base);
            const e = Object.assign({}, info, { links });
            if (capa) e.capa = capa;
            if (archive && !RE_EXT_VIDEO.test(links[0])) e.archive = archive;
            Object.assign(e, refPendente || {}, refLinha || {});
            entradas.push(limparVazios(e));
        }
    }

    function hostDe(u) { try { return new URL(u).hostname; } catch (e) { return 'Sem nome'; } }

    // ------------------------------------------------------------------
    // Adição em MASSA: listas em arquivo
    //   TXT/M3U (igual ao colar) · JSON (lista de objetos ou de links) · CSV/TSV (com ou sem cabeçalho)
    //   RetroArch .lpl · EmulationStation gamelist.xml
    // ------------------------------------------------------------------
    const CHAVES_LISTA = {
        nome: ['nome', 'name', 'title', 'titulo', 'label', 'jogo', 'game', 'filme', 'canal'],
        link: ['link', 'url', 'href', 'rom', 'romurl', 'download', 'arquivo', 'file', 'path', 'caminho', 'pagina', 'page', 'stream', 'links'],
        capa: ['capa', 'cover', 'image', 'imagem', 'img', 'thumb', 'thumbnail', 'poster', 'boxart', 'box', 'icone', 'icon'],
        banner: ['banner', 'fanart', 'background', 'fundo'],
        logo: ['logo', 'wheel', 'marquee'],
        video: ['video', 'trailer', 'snap'],
        console: ['console', 'sistema', 'system', 'plataforma', 'platform', 'dbname'],
        descricao: ['descricao', 'desc', 'description', 'sinopse', 'synopsis', 'resumo'],
        ano: ['ano', 'year', 'releasedate', 'lancamento', 'release', 'data'],
        generos: ['generos', 'genero', 'genre', 'genres', 'categoria', 'category'],
        jogadores: ['jogadores', 'players'],
        licenca: ['licenca', 'license'],
        pais: ['pais', 'country'], idioma: ['idioma', 'language', 'lingua']
    };
    const chaveSimples = (k) => semAcento(String(k || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
    function campoDaLista(obj, campo) {
        const alvo = CHAVES_LISTA[campo];
        for (const [k, v] of Object.entries(obj || {})) {
            if (v === undefined || v === null || v === '') continue;
            if (alvo.includes(chaveSimples(k))) return v;
        }
        return undefined;
    }
    /** "Nintendo - Super Nintendo Entertainment System", "Mega Drive", "SNES"… → id do console do Studio */
    const SISTEMAS_POR_NOME = [
        [/super\s*nintendo|\bsnes\b|super\s*famicom|\bsfc\b/i, 'snes'], [/game\s*boy\s*advance|\bgba\b/i, 'gba'], [/game\s*boy\s*colou?r|\bgbc\b/i, 'gbc'],
        [/game\s*boy|\bgb\b/i, 'gb'], [/nintendo\s*64|\bn64\b/i, 'n64'], [/nintendo\s*3ds|\b3ds\b/i, '3ds'], [/nintendo\s*ds|\bnds\b/i, 'nds'],
        [/virtual\s*boy/i, 'vb'], [/famicom\s*disk|nintendo\s*entertainment|\bnes\b|famicom/i, 'nes'],
        [/mega[\s-]*cd|sega\s*cd/i, 'segacd'], [/\b32x\b/i, 'sega32x'], [/mega\s*drive|genesis/i, 'megadrive'], [/master\s*system|\bsms\b/i, 'mastersystem'],
        [/game\s*gear/i, 'gamegear'], [/saturn/i, 'saturn'], [/playstation\s*portable|\bpsp\b/i, 'psp'], [/playstation|\bpsx\b|\bps1\b/i, 'ps1'],
        [/(pc\s*engine|turbografx)[\s-]*(cd|16\s*cd)/i, 'pcenginecd'], [/pc\s*engine|turbografx/i, 'pcengine'], [/pc[\s-]*fx/i, 'pcfx'],
        [/neo\s*geo\s*pocket/i, 'ngp'], [/neo\s*geo\s*cd/i, 'neogeocd'], [/atari\s*-?\s*2600/i, 'atari2600'], [/atari\s*-?\s*5200/i, 'atari5200'],
        [/atari\s*-?\s*7800/i, 'atari7800'], [/lynx/i, 'lynx'], [/jaguar/i, 'jaguar'], [/wonder\s*swan/i, 'wonderswan'], [/coleco/i, 'colecovision'],
        [/\bmsx/i, 'msx'], [/commodore\s*64|\bc64\b/i, 'c64'], [/amiga/i, 'amiga'], [/odyssey/i, 'odyssey2'], [/\b3do\b/i, '3do'],
        [/ms[\s-]*dos|\bdos\b/i, 'msdos'], [/\bmame\b|fbneo|final\s*burn|arcade|cps[123]?\b/i, 'arcade'], [/neo\s*geo/i, 'neogeo']
    ];
    function consoleDoNomeSistema(texto, config) {
        const t = String(texto || '').replace(/\.lpl$/i, '').trim();
        if (!t) return '';
        const ids = config ? todosConsoles(config).map(c => c.id) : null;
        const direto = t.toLowerCase();
        if (ids && ids.includes(direto)) return direto;
        if (config) { const porNome = todosConsoles(config).find(c => normText(c.nome) === normText(t)); if (porNome) return porNome.id; }
        for (const [re, id] of SISTEMAS_POR_NOME) if (re.test(t) && (!ids || ids.includes(id))) return id;
        return '';
    }
    function xmlTexto(s) {
        return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').trim();
    }
    function lerCsv(texto) {
        const linhas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
        if (!linhas.length) return [];
        const conta = (c) => (linhas[0].match(new RegExp(c === '|' ? '\\|' : c, 'g')) || []).length;
        const sep = [',', ';', '\t', '|'].sort((a, b) => conta(b) - conta(a))[0];
        const celulas = (l) => {
            const out = []; let cur = '', aspas = false;
            for (let i = 0; i < l.length; i++) {
                const ch = l[i];
                if (aspas) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') aspas = false; else cur += ch; }
                else if (ch === '"') aspas = true; else if (ch === sep) { out.push(cur.trim()); cur = ''; } else cur += ch;
            }
            out.push(cur.trim()); return out;
        };
        return linhas.map(celulas);
    }
    function entradaDeObjeto(o, base) {
        if (typeof o === 'string') o = { link: o };
        if (!o || typeof o !== 'object') return null;
        // caminho local da lista (./roms/x.sfc, /home/eu/roms/x.sfc, C:\roms\x.sfc) + endereço base = link
        const completar = (v) => {
            v = String(v || '').trim();
            if (!v || /^(https?:|magnet:|data:)/i.test(v) || !base) return v;
            const b = base.endsWith('/') ? base : base + '/';
            const absoluto = /^([a-z]:)?[\\/]/i.test(v);           // caminho do PC de quem fez a lista: vale só o nome do arquivo
            try { return new URL(absoluto ? encodeURIComponent(v.replace(/^.*[\\/]/, '')) : v.replace(/\\/g, '/').replace(/^\.\//, ''), b).toString(); } catch (e) { return v; }
        };
        let link = campoDaLista(o, 'link');
        if (Array.isArray(link)) link = link[0];
        link = completar(link);
        if (!link) return null;
        const nomeBruto = String(campoDaLista(o, 'nome') || '').trim();
        const e = Object.assign({}, analisarNome(nomeBruto || nomeDoLink(link) || link));
        if (nomeBruto) e.nome = analisarNome(nomeBruto).nome || nomeBruto;
        e.links = [limparLink(link)];
        for (const k of ['capa', 'banner', 'logo', 'video']) { const v = campoDaLista(o, k); if (v) e[k] = completar(v); }
        for (const k of ['descricao', 'licenca', 'pais', 'idioma']) { const v = campoDaLista(o, k); if (v) e[k] = String(v).trim(); }
        const c = campoDaLista(o, 'console'); if (c) e.console = String(c).trim();
        // "core" da lista (ex.: lista-por-core.csv do cartoonzine-jogos: mame_capcom) vira o "Core do emulador" do jogo
        const core = Object.entries(o).find(([k, v]) => chaveSimples(k) === 'core' && v);
        if (core && /^[a-z0-9_]+$/i.test(String(core[1]).trim()) && !/^_/.test(String(core[1]).trim())) e.core = String(core[1]).trim();
        const a = campoDaLista(o, 'ano'); if (a && /(\d{4})/.test(String(a))) e.ano = +RegExp.$1;
        const g = campoDaLista(o, 'generos'); if (g) e.generos = Array.isArray(g) ? g.map(String) : String(g).split(/[,;/]+/).map(x => x.trim()).filter(Boolean);
        const j = campoDaLista(o, 'jogadores'); if (j && /(\d+)\s*$/.test(String(j))) e.jogadores = +RegExp.$1;
        if (nomeBruto) e._nomeInformado = true;
        return limparVazios(e);
    }
    /**
     * Lê uma lista inteira de um arquivo (ou texto) e devolve "entradas" iguais às do colar:
     *   lerListaArquivo('jogos.json', texto, { base: 'https://meusite/roms/' })
     * `base` completa caminhos relativos (./roms/x.sfc) das listas do RetroArch/EmulationStation.
     */
    function lerListaArquivo(nomeArquivo, texto, opts = {}) {
        const ext = (/\.([a-z0-9]+)$/i.exec(String(nomeArquivo || '')) || [])[1] || '';
        const t = String(texto || '').replace(/^﻿/, '');
        const base = opts.base || '';
        const vindo = (lista) => lista.map(o => entradaDeObjeto(o, base)).filter(Boolean);
        const tt = t.trim();
        if (/^(json|lpl)$/i.test(ext) || /^[[{]/.test(tt)) {
            try {
                const j = JSON.parse(tt);
                let lista = Array.isArray(j) ? j : (j.items || j.jogos || j.games || j.itens || j.lista || j.list || j.data || null);
                if (!lista && j && typeof j === 'object') lista = Object.values(j).find(Array.isArray) || null;
                if (Array.isArray(lista)) {
                    const sistemaLista = (ext === 'lpl' && nomeArquivo) ? String(nomeArquivo).replace(/^.*[\\/]/, '').replace(/\.lpl$/i, '') : '';
                    return vindo(lista).map(e => (!e.console && sistemaLista ? Object.assign(e, { console: sistemaLista }) : e));
                }
            } catch (e) { if (/^(json|lpl)$/i.test(ext)) throw new Error('JSON inválido em ' + nomeArquivo + ': ' + e.message); }
        }
        if (/^xml$/i.test(ext) || /<gameList[\s>]/i.test(tt)) {
            const jogos = [];
            const re = /<game\b[^>]*>([\s\S]*?)<\/game>/gi; let m;
            while ((m = re.exec(tt))) {
                const corpo = m[1], tag = (n) => { const x = new RegExp('<' + n + '\\b[^>]*>([\\s\\S]*?)</' + n + '>', 'i').exec(corpo); return x ? xmlTexto(x[1]) : ''; };
                jogos.push({ name: tag('name'), path: tag('path'), image: tag('image') || tag('thumbnail'), marquee: tag('marquee'), video: tag('video'), desc: tag('desc'), releasedate: tag('releasedate'), genre: tag('genre'), players: tag('players') });
            }
            if (jogos.length) return vindo(jogos);
        }
        if (/^(csv|tsv)$/i.test(ext)) {
            const linhas = lerCsv(tt);
            if (!linhas.length) return [];
            const cab = linhas[0].map(chaveSimples);
            const conhecidas = new Set([].concat(...Object.values(CHAVES_LISTA)));
            const temCab = cab.some(c => conhecidas.has(c)) && !linhas[0].some(c => /^(https?:|magnet:)/i.test(c));
            if (temCab) return vindo(linhas.slice(1).map(l => Object.fromEntries(linhas[0].map((k, i) => [k, l[i]]))));
            // sem cabeçalho: o 1º link é o arquivo, uma imagem é a capa, o 1º texto é o nome
            return vindo(linhas.map(l => {
                const urls = l.filter(c => /^(https?:|magnet:)/i.test(c));
                const img = urls.find(u => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u));
                return { link: urls.find(u => u !== img) || l.find(c => /\.[a-z0-9]{2,4}$/i.test(c)), capa: img, nome: l.find(c => c && !/^(https?:|magnet:)/i.test(c) && !/\.[a-z0-9]{2,4}$/i.test(c)) };
            }));
        }
        // TXT, M3U e o resto: o mesmo leitor do "colar"
        return lerTextoColado(t);
    }

    // ------------------------------------------------------------------
    // ROMs em massa: console pela extensão + nome limpo do arquivo (o robô acerta o nome oficial depois)
    // ------------------------------------------------------------------
    const EXT_CONSOLE = {
        nes: 'nes', fds: 'nes', unf: 'nes', unif: 'nes', sfc: 'snes', smc: 'snes', fig: 'snes', swc: 'snes', n64: 'n64', z64: 'n64', v64: 'n64',
        nds: 'nds', '3ds': '3ds', cia: '3ds', gb: 'gb', gbc: 'gbc', gba: 'gba', md: 'megadrive', gen: 'megadrive', smd: 'megadrive', sms: 'mastersystem',
        gg: 'gamegear', '32x': 'sega32x', a26: 'atari2600', a52: 'atari5200', a78: 'atari7800', lnx: 'lynx', j64: 'jaguar', jag: 'jaguar',
        pce: 'pcengine', ngp: 'ngp', ngc: 'ngp', ws: 'wonderswan', wsc: 'wonderswan', vb: 'vb', vboy: 'vb', col: 'colecovision',
        d64: 'c64', t64: 'c64', prg: 'c64', adf: 'amiga', mx1: 'msx', mx2: 'msx', cso: 'psp', pbp: 'ps1', jsdos: 'pcclassics'
    };
    /** console pela extensão do arquivo da ROM ('' quando a extensão serve para vários: zip, 7z, bin, iso, chd, cue…) */
    function consoleDaExtensao(arquivo) {
        const ext = ((/\.([a-z0-9]+)$/i.exec(String(arquivo || '').split(/[?#]/)[0]) || [])[1] || '').toLowerCase();
        return EXT_CONSOLE[ext] || '';
    }
    const EXT_ROM = /\.(zip|7z|nes|fds|unf|unif|sfc|smc|fig|swc|n64|z64|v64|nds|3ds|cia|gb|gbc|gba|md|gen|smd|bin|sms|gg|32x|a26|a52|a78|lnx|j64|jag|pce|ngp|ngc|ws|wsc|vb|vboy|col|d64|t64|prg|crt|adf|dsk|rom|mx1|mx2|iso|cso|pbp|chd|cue|img|ccd|mds|jsdos)$/i;
    /** "Legend of Zelda, The - A Link to the Past (USA) (Rev 1) [!].sfc" → "The Legend of Zelda - A Link to the Past" */
    function limparNomeRom(arquivo) {
        let s = String(arquivo || '').replace(/^.*[\\/]/, '');
        try { s = decodeURIComponent(s); } catch (e) { /* */ }
        s = s.replace(/\.(zip|7z|rar|gz)$/i, '');
        if (EXT_ROM.test(s)) s = s.replace(/\.[a-z0-9]{1,5}$/i, '');
        s = s.replace(/[_]+/g, ' ');
        if (!/\s/.test(s) && /\./.test(s)) s = s.replace(/\.+/g, ' ');
        s = s.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
        // No-Intro: "Nome, The - Subtítulo" / "Nome, The"
        s = s.replace(/^(.+?),\s*(The|A|An|O|A|Os|As|Le|La|Les|Der|Die|Das|El|Los)(\s+-\s+.*|$)/i, (_, a, art, resto) => art + ' ' + a + (resto || ''));
        s = s.replace(/\s+-\s*$/, '').replace(/^\s*-\s+/, '').trim();
        return s || String(arquivo || '').trim();
    }
    /**
     * Prepara um jogo vindo de lista em massa:
     *  • ROM (Jogos Retrô): console pela extensão (quando ela é de um console só) ou pelo nome do sistema da lista;
     *    nome limpo do arquivo quando a lista não trouxe nome — marcado com `_nomeDoArquivo` para o robô trocar
     *    pelo nome oficial (ScreenScraper, pela ROM); o arquivo original fica em `_romArquivo`.
     *  • Jogo web: console/sistema da lista vira o id do sistema web, se der.
     */
    function prepararJogoEmMassa(item, colecao, config, consolePadrao) {
        const it = Object.assign({}, item);
        const avisos = [];
        const web = colecao && colecao.consoles === 'consolesWeb';
        const ids = consolesDaColecao(colecao, config).map(c => c.id);
        if (it.console && !ids.includes(String(it.console).toLowerCase())) {
            let c = consoleDoNomeSistema(it.console, config);
            const WEB_DE = { msdos: 'web-dos', pcclassics: 'web-windows' };
            if (web && c && !ids.includes(c)) c = ids.includes(WEB_DE[c]) ? WEB_DE[c] : ids.includes('web-' + c) ? 'web-' + c : c;   // "DOS" na lista de jogos web → web-dos
            if (c && ids.includes(c)) it.console = c; else { avisos.push('Sistema da lista não reconhecido: ' + it.console); delete it.console; }
        }
        if (!web) {
            const link = (it.links || [])[0] || '';
            const arquivo = nomeDoLink(link);
            if (arquivo && EXT_ROM.test(arquivo)) {
                it._romArquivo = arquivo;
                const doArq = consoleDaExtensao(arquivo);
                if (!it.console && doArq && ids.includes(doArq)) it.console = doArq;
                if (!item._nomeInformado) { it.nome = limparNomeRom(arquivo); it._nomeDoArquivo = true; }
                // nome da lista no padrão No-Intro ("Super Metroid (USA)", "Contra [!]"): tira região, versão e marcas
                else it.nome = String(it.nome || '').replace(/\s*\((USA|Europe|Japan|World|Brazil|Brasil|Korea|Asia|Spain|France|Germany|Italy|En|Ja|Fr|De|Es|It|Pt|Rev|Beta|Proto|Demo|Sample|Unl|v\d)[^)]*\)|\s*\[[^\]]*\]/gi, '').trim() || it.nome;
            }
        }
        if (!it.console && /^mame_/.test(it.core || '') && ids.includes('arcade')) it.console = 'arcade';   // core do MAME = card Arcade
        if (!it.console && consolePadrao) it.console = consolePadrao;
        delete it._nomeInformado;
        return { item: it, avisos };
    }

    /**
     * Junta entradas soltas em itens: episódios da mesma série viram UM item com
     * temporadas; o resto vira item avulso (filme, canal, rádio, jogo).
     */
    function agruparEntradas(entradas, opts = {}) {
        const itens = [];
        const series = new Map();
        for (const e of entradas || []) {
            if (e.serie && opts.series !== false) {
                const k = normText(e.serie);
                if (!series.has(k)) {
                    const item = limparVazios({ nome: e.serie, ano: e.ano, capa: e.capa, audio: e.audio, tmdb: e.tmdb, imdb: e.imdb });
                    item.temporadas = [];
                    series.set(k, item);
                    itens.push(item);
                }
                const item = series.get(k);
                let temp = item.temporadas.find(x => x.numero === e.temporada);
                if (!temp) { temp = { numero: e.temporada, episodios: [] }; item.temporadas.push(temp); }
                const existente = temp.episodios.find(x => x.numero === e.episodio);
                if (existente) {
                    existente.links = unicos(existente.links.concat(e.links));
                } else {
                    temp.episodios.push(limparVazios({ numero: e.episodio, titulo: e.tituloEpisodio, links: e.links.slice() }));
                }
            } else {
                // link de PÁGINA do Internet Archive (archive.org/details/…) não é vídeo: sai da lista para o
                // importador do archive trocar pelos vídeos de verdade (antes ele ficava e a importação nem rodava)
                const links = e.archive ? e.links.filter(u => !idDoArchive(u) || RE_EXT_VIDEO.test(u)) : e.links;
                const item = limparVazios({
                    nome: e.nome, links, capa: e.capa, ano: e.ano, audio: e.audio,
                    logo: e.logo, categoria: e.grupo, tvgId: e.tvgId, pais: e.pais, idioma: e.idioma,
                    headers: e.headers, archive: e.archive, tmdb: e.tmdb, imdb: e.imdb,
                    // vindos das listas em arquivo (JSON/CSV/gamelist): o resto da ficha
                    banner: e.banner, video: e.video, descricao: e.descricao, generos: e.generos, jogadores: e.jogadores,
                    licenca: e.licenca, console: e.console, core: e.core, _nomeInformado: e._nomeInformado
                });
                itens.push(item);
            }
        }
        for (const item of itens) {
            if (!item.temporadas) continue;
            item.temporadas.sort((a, b) => a.numero - b.numero);
            item.temporadas.forEach(t => t.episodios.sort((a, b) => a.numero - b.numero));
        }
        return itens;
    }

    function unicos(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }

    // ------------------------------------------------------------------
    // Internet Archive
    // ------------------------------------------------------------------
    const RE_ARCHIVE_VIDEO = /\.(mp4|mkv|webm|ogv|avi|mpeg|mpg|m4v)$/i;

    /**
     * Converte a resposta de https://archive.org/metadata/<id> em um item.
     * 1 vídeo = filme; vários = série (temporada/episódio pelo nome do arquivo,
     * ou em ordem alfabética como temporada 1).
     * opts.torrent (coleção com "torrent": true): o item vira UM filme cujo link principal é o
     * .torrent oficial do Internet Archive (o vídeo direto fica de reserva).
     */
    function itemDoArchive(meta, id, opts = {}) {
        if (opts.livro) return livroDoArchive(meta, id);
        const md = (meta && meta.metadata) || {};
        id = id || md.identifier;
        const arquivos = ((meta && meta.files) || []).filter(f => f && RE_ARCHIVE_VIDEO.test(f.name || ''));
        // Mesmo vídeo em vários formatos (original + derivados): fica o .mp4
        const porBase = new Map();
        const peso = n => (/\.mp4$/i.test(n) ? (/\.ia\.mp4$/i.test(n) ? 2 : 3) : /\.(mkv|webm)$/i.test(n) ? 1 : 0);
        for (const f of arquivos) {
            const base = f.name.replace(/\.(ia\.)?[a-z0-9]+$/i, '').replace(/_512kb$/i, '').toLowerCase();
            const atual = porBase.get(base);
            if (!atual || peso(f.name) > peso(atual.name)) porBase.set(base, f);
        }
        const videos = Array.from(porBase.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true }));
        const link = n => 'https://archive.org/download/' + encodeURIComponent(id) + '/' + n.split('/').map(encodeURIComponent).join('/');
        const primeiro = v => (Array.isArray(v) ? v[0] : v);
        const titulo = limparHtml(primeiro(md.title)) || id;
        const anoTxt = String(primeiro(md.year) || primeiro(md.date) || '');
        const mAno = /(1[89]\d{2}|20\d{2})/.exec(anoTxt);
        const generos = lista(md.subject).slice(0, 4);

        const item = limparVazios({
            nome: analisarNome(titulo).nome || titulo,
            descricao: limparHtml(primeiro(md.description)).slice(0, 1500) || undefined,
            ano: mAno ? parseInt(mAno[1], 10) : undefined,
            capa: 'https://archive.org/services/img/' + encodeURIComponent(id),
            generos: generos.length ? generos : undefined,
            fonte: 'https://archive.org/details/' + id
        });
        if (opts.torrent) {
            const tor = ((meta && meta.files) || []).find(f => f && /_archive\.torrent$/i.test(f.name || ''));
            if (tor) {
                item.links = [link(tor.name)].concat(videos[0] ? [link(videos[0].name)] : []);
                return item;
            }
        }
        if (videos.length <= 1) {
            if (videos[0]) item.links = [link(videos[0].name)];
            return item;
        }
        const entradas = videos.map((v, i) => {
            const info = analisarNome(v.name.split('/').pop());
            return {
                temporada: info.temporada || 1,
                episodio: info.episodio || i + 1,
                tituloEpisodio: info.tituloEpisodio || (info.serie ? undefined : (v.title || info.nome)),
                links: [link(v.name)]
            };
        });
        const temps = new Map();
        for (const e of entradas) {
            if (!temps.has(e.temporada)) temps.set(e.temporada, []);
            const eps = temps.get(e.temporada);
            let n = e.episodio;
            while (eps.some(x => x.numero === n)) n++;
            eps.push(limparVazios({ numero: n, titulo: e.tituloEpisodio, links: e.links }));
        }
        item.temporadas = Array.from(temps.entries()).sort((a, b) => a[0] - b[0])
            .map(([numero, episodios]) => ({ numero, episodios: episodios.sort((a, b) => a.numero - b.numero) }));
        return item;
    }

    // Livros (Bookzine): o melhor arquivo de leitura do item + um formato diferente de reserva
    const FORMATOS_LIVRO = [
        { f: 'PDF', re: /\.pdf$/i },
        { f: 'EPUB', re: /\.epub$/i },
        { f: 'CBZ', re: /\.cbz$/i }, { f: 'CBR', re: /\.cbr$/i }, { f: 'CB7', re: /\.cb7$/i },
        { f: 'DjVu', re: /\.djvu$/i },
        { f: 'MOBI', re: /\.mobi$/i }, { f: 'AZW3', re: /\.azw3$/i },
        { f: 'TXT', re: /\.txt$/i }
    ];
    function formatoDoLink(u) {
        const n = String(u || '').split(/[?#]/)[0];
        const achado = FORMATOS_LIVRO.find(x => x.re.test(n));
        return achado ? achado.f : (/\.html?$/i.test(n) ? 'HTML' : undefined);
    }
    const IDIOMA_ARCHIVE = { por: 'Português', portuguese: 'Português', 'português': 'Português', pt: 'Português',
        spa: 'Espanhol', spanish: 'Espanhol', 'español': 'Espanhol', es: 'Espanhol', eng: 'Inglês', english: 'Inglês', en: 'Inglês',
        fre: 'Francês', fra: 'Francês', french: 'Francês', ita: 'Italiano', italian: 'Italiano', ger: 'Alemão', deu: 'Alemão', german: 'Alemão',
        lat: 'Latim', latin: 'Latim', grc: 'Grego', gre: 'Grego', greek: 'Grego', heb: 'Hebraico', hebrew: 'Hebraico', jpn: 'Japonês', japanese: 'Japonês' };

    function livroDoArchive(meta, id) {
        const md = (meta && meta.metadata) || {};
        id = id || md.identifier;
        const primeiro = v => (Array.isArray(v) ? v[0] : v);
        // fora: metadados, textos de OCR (_djvu.txt), versões só preto e branco quando há outra
        const arquivos = ((meta && meta.files) || []).map(f => f && f.name).filter(n => n && !/(_meta\.txt|_djvu\.txt|_djvu\.xml|_files\.xml|_meta\.xml)$/i.test(n));
        const link = n => 'https://archive.org/download/' + encodeURIComponent(id) + '/' + n.split('/').map(encodeURIComponent).join('/');
        const escolhidos = [];
        for (const { re } of FORMATOS_LIVRO) {
            const doFormato = arquivos.filter(n => re.test(n)).sort((a, b) =>
                (/_bw\.pdf$/i.test(a) ? 1 : 0) - (/_bw\.pdf$/i.test(b) ? 1 : 0) ||          // colorido antes do preto e branco
                (/-images\.epub$/i.test(b) ? 1 : 0) - (/-images\.epub$/i.test(a) ? 1 : 0) ||  // EPUB com imagens antes
                a.length - b.length);
            if (doFormato[0]) escolhidos.push(link(doFormato[0]));
            if (escolhidos.length >= 2) break;
        }
        const titulo = limparHtml(primeiro(md.title)) || id;
        const mAno = /(1[4-9]\d{2}|20\d{2})/.exec(String(primeiro(md.year) || primeiro(md.date) || ''));
        const generos = lista(md.subject).slice(0, 4);
        const lingua = String(primeiro(md.language) || '').trim().toLowerCase();
        return limparVazios({
            nome: titulo,
            autor: limparHtml(lista(md.creator).join(', ')) || undefined,
            editora: limparHtml(primeiro(md.publisher)) || undefined,
            descricao: limparHtml(primeiro(md.description)).slice(0, 1500) || undefined,
            ano: mAno ? parseInt(mAno[1], 10) : undefined,
            idioma: IDIOMA_ARCHIVE[lingua] || undefined,
            capa: 'https://archive.org/services/img/' + encodeURIComponent(id),
            generos: generos.length ? generos : undefined,
            links: escolhidos.length ? escolhidos : undefined,
            fonte: 'https://archive.org/details/' + id
        });
    }

    async function importarArchive(idOuLink, fetchFn, opts) {
        const id = idDoArchive(idOuLink) || String(idOuLink).trim();
        const f = fetchFn || (typeof fetch === 'function' ? fetch : null);
        const r = await f('https://archive.org/metadata/' + encodeURIComponent(id));
        if (!r.ok) throw new Error('Internet Archive respondeu ' + r.status + ' para ' + id);
        const meta = await r.json();
        if (!meta || !meta.metadata) throw new Error('Item "' + id + '" não existe no Internet Archive');
        return itemDoArchive(meta, id, opts);
    }

    // ------------------------------------------------------------------
    // Wikipedia (sinopse, capa, ano)
    // ------------------------------------------------------------------
    async function buscarWikipedia(nome, fetchFn, idioma = 'pt') {
        const f = fetchFn || fetch;
        const base = 'https://' + idioma + '.wikipedia.org';
        const busca = await f(base + '/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch=' + encodeURIComponent(nome));
        if (!busca.ok) return null;
        const jb = await busca.json();
        const achado = jb && jb.query && jb.query.search && jb.query.search[0];
        if (!achado) return null;
        const r = await f(base + '/api/rest_v1/page/summary/' + encodeURIComponent(achado.title.replace(/ /g, '_')));
        if (!r.ok) return null;
        const s = await r.json();
        if (!s || s.type === 'disambiguation') return null;
        const texto = (s.description || '') + ' ' + (s.extract || '');
        const mAno = /\b(19[2-9]\d|20[0-4]\d)\b/.exec(texto);
        return limparVazios({
            tituloWikipedia: s.title,
            descricao: s.extract,
            capa: (s.originalimage && s.originalimage.source) || (s.thumbnail && s.thumbnail.source),
            ano: mAno ? parseInt(mAno[1], 10) : undefined,
            fonte: s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page
        });
    }

    // ------------------------------------------------------------------
    // TMDB (sinopse em português, capas, episódios) e IMDb (ID e nota)
    // ------------------------------------------------------------------
    /** Link do TMDB/IMDb -> {tmdb:"tv/123"} | {imdb:"tt123"} | null */
    function refDoLink(u) {
        let m = /themoviedb\.org\/(movie|tv)\/(\d+)/i.exec(String(u || ''));
        if (m) return { tmdb: m[1].toLowerCase() + '/' + m[2] };
        m = /imdb\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?title\/(tt\d{5,10})/i.exec(String(u || ''));
        if (m) return { imdb: m[1].toLowerCase() };
        return null;
    }
    function normTmdb(v) {
        if (!v) return undefined;
        const r = refDoLink(v);
        if (r && r.tmdb) return r.tmdb;
        const m = /^(movie|tv|filme|serie|série)\s*[\/:]\s*(\d+)$/i.exec(String(v).trim());
        if (m) return (/^(movie|filme)$/i.test(m[1]) ? 'movie' : 'tv') + '/' + m[2];
        return undefined;
    }
    function normImdb(v) {
        const m = /(tt\d{5,10})/i.exec(String(v || ''));
        return m ? m[1].toLowerCase() : undefined;
    }

    const TMDB_IMG = 'https://image.tmdb.org/t/p/';

    /** Aceita o "Token de leitura da API" (longo, v4) ou a "Chave da API" (32 letras, v3). */
    function clienteTMDB(chave, fetchFn) {
        const f = fetchFn || fetch;
        const bearer = String(chave || '').length > 40;
        return async (rota, params = {}) => {
            const q = new URLSearchParams(params);
            if (!bearer) q.set('api_key', chave);
            const r = await f('https://api.themoviedb.org/3' + rota + '?' + q.toString(), {
                headers: bearer ? { Authorization: 'Bearer ' + chave, accept: 'application/json' } : { accept: 'application/json' }
            });
            if (r.status === 401) throw new Error('Chave do TMDB inválida');
            if (r.status === 404) return null;
            if (r.status === 429) throw new Error('TMDB pediu para ir mais devagar (limite de pedidos); tente de novo em instantes');
            if (!r.ok) throw new Error('TMDB respondeu ' + r.status);
            return r.json();
        };
    }

    /**
     * Acha a obra no TMDB (pelo link/ID do TMDB, pelo ID do IMDb ou pelo nome+ano)
     * e devolve os dados em português. Para séries com temporadas, também traz
     * título, sinopse e imagem de cada episódio já cadastrado (temporadasMeta).
     */
    async function buscarTMDB(item, chave, fetchFn, opts = {}) {
        const api = clienteTMDB(chave, fetchFn);
        const lang = opts.idioma || 'pt-BR';
        const temEps = Array.isArray(item.temporadas) && item.temporadas.length;
        let ref = normTmdb(item.tmdb);
        let porBusca = false;
        const imdb = normImdb(item.imdb);
        if (!ref && imdb) {
            const f = await api('/find/' + imdb, { external_source: 'imdb_id', language: lang });
            const tv = f && f.tv_results && f.tv_results[0];
            const mv = f && f.movie_results && f.movie_results[0];
            if (tv && (temEps || !mv)) ref = 'tv/' + tv.id;
            else if (mv) ref = 'movie/' + mv.id;
            else if (tv) ref = 'tv/' + tv.id;
        }
        if (!ref && item.nome) {
            const tipos = opts.preferir ? [opts.preferir] : temEps ? ['tv', 'movie'] : ['movie', 'tv'];
            for (const t of tipos) {
                const p = { query: item.nome, language: lang, include_adult: 'false' };
                if (item.ano) p[t === 'tv' ? 'first_air_date_year' : 'year'] = item.ano;
                let r = await api('/search/' + t, p);
                let hit = r && r.results && r.results[0];
                if (!hit && item.ano) {
                    delete p.year; delete p.first_air_date_year;
                    r = await api('/search/' + t, p);
                    hit = r && r.results && r.results[0];
                }
                if (hit) { ref = t + '/' + hit.id; porBusca = true; break; }
            }
        }
        if (!ref) return null;
        const [tipo, id] = ref.split('/');
        const d = await api('/' + ref, { language: lang, append_to_response: 'external_ids' });
        if (!d) return null;
        let sinopse = d.overview;
        if (!sinopse) { const en = await api('/' + ref, { language: 'en-US' }); sinopse = en && en.overview; }
        const data = d.release_date || d.first_air_date || '';
        const out = limparVazios({
            tituloTMDB: d.title || d.name,
            nome: d.title || d.name,
            descricao: sinopse || undefined,
            capa: d.poster_path ? TMDB_IMG + 'w500' + d.poster_path : undefined,
            banner: d.backdrop_path ? TMDB_IMG + 'w1280' + d.backdrop_path : undefined,
            ano: /^\d{4}/.test(data) ? parseInt(data, 10) : undefined,
            generos: (d.genres || []).map(g => g.name).filter(Boolean),
            tmdb: ref,
            imdb: normImdb(d.imdb_id || (d.external_ids && d.external_ids.imdb_id)) || imdb,
            porBusca: porBusca || undefined
        });
        if (tipo === 'tv' && temEps && opts.episodios !== false) {
            out.temporadasMeta = [];
            for (const t of item.temporadas) {
                const s = await api(`/tv/${id}/season/${t.numero}`, { language: lang });
                if (!s || !Array.isArray(s.episodes)) continue;
                const porNum = new Map(s.episodes.map(e => [e.episode_number, e]));
                out.temporadasMeta.push({
                    numero: t.numero,
                    episodios: (t.episodios || []).map(e => {
                        const x = porNum.get(e.numero);
                        if (!x) return { numero: e.numero };
                        const titulo = x.name && !/^(epis[oó]dio|episode)\s*\d+$/i.test(x.name.trim()) ? x.name : undefined;
                        return limparVazios({
                            numero: e.numero, titulo,
                            descricao: x.overview || undefined,
                            capa: x.still_path ? TMDB_IMG + 'w300' + x.still_path : undefined
                        });
                    })
                });
            }
        }
        return out;
    }

    /** Nota do IMDb pelo OMDb (chave grátis em omdbapi.com). */
    async function buscarNotaIMDb(imdb, chave, fetchFn) {
        const f = fetchFn || fetch;
        const id = normImdb(imdb);
        if (!id) return null;
        const r = await f('https://www.omdbapi.com/?i=' + id + '&apikey=' + encodeURIComponent(chave));
        if (r.status === 401) throw new Error('Chave do OMDb inválida');
        if (!r.ok) throw new Error('OMDb respondeu ' + r.status);
        const j = await r.json();
        if (j.Response === 'False') {
            if (/api key|limit/i.test(j.Error || '')) throw new Error('OMDb: ' + j.Error);
            return null;
        }
        const nota = parseFloat(j.imdbRating);
        if (!Number.isFinite(nota)) return null;
        return limparVazios({ notaImdb: nota, votosImdb: parseInt(String(j.imdbVotes || '').replace(/\D/g, ''), 10) || undefined });
    }

    /** Coloca no item o que veio de fora, sem apagar o que você escreveu (a nota sempre atualiza). */
    function aplicarDadosExternos(item, achado) {
        if (!achado) return item;
        const { temporadasMeta, tituloTMDB, porBusca, nome, notaImdb, votosImdb, ...resto } = achado;
        const out = mesclarSemSobrescrever(item, resto);
        // mesmo nome escrito diferente ("Serie X" x "Série X"): fica a grafia oficial, com acentos
        if (!out.nome || (nome && normText(out.nome) === normText(nome))) out.nome = nome || out.nome;
        if (notaImdb !== undefined) { out.notaImdb = notaImdb; if (votosImdb) out.votosImdb = votosImdb; }
        if (temporadasMeta && Array.isArray(out.temporadas)) {
            out.temporadas = out.temporadas.map(t => {
                const tm = temporadasMeta.find(x => x.numero === t.numero);
                if (!tm) return t;
                return Object.assign({}, t, {
                    episodios: t.episodios.map(e => {
                        const em = tm.episodios.find(x => x.numero === e.numero);
                        return em ? mesclarSemSobrescrever(e, em) : e;
                    })
                });
            });
        }
        return out;
    }

    /**
     * Completa um item com tudo que der: TMDB (se tiver chave; senão Wikipedia
     * quando pedido) e nota do IMDb (se tiver chave do OMDb).
     * Devolve { item, achados: ["TMDB: ...", ...], avisos: [...] }.
     */
    /**
     * Artes de um JOGO pelo SteamGridDB (links públicos do CDN deles, sem senha):
     *   logo (PNG transparente) · capa (grid vertical 600x900, estilo caixa/DVD) · banner (hero 1920x620).
     * pedir: { logo, capa, banner } — só busca o que for pedido. Devolve { id, logo, capa, banner }.
     */
    async function buscarArtesSteamGrid(nome, chave, fetchFn, pedir = { logo: true }) {
        if (!nome || !chave) return {};
        const f = fetchFn || ((...a) => fetch(...a));
        const h = { headers: { Authorization: 'Bearer ' + String(chave).trim() } };
        const base = 'https://www.steamgriddb.com/api/v2';
        const rb = await f(base + '/search/autocomplete/' + encodeURIComponent(nome), h);
        if (rb.status === 401 || rb.status === 403) throw new Error('chave recusada (' + rb.status + ')');
        if (!rb.ok) throw new Error('busca HTTP ' + rb.status);
        const jb = await rb.json();
        const id = jb && jb.data && jb.data[0] && jb.data[0].id;
        if (!id) return {};
        const primeiro = async (caminho) => {
            const r = await f(base + caminho, h);
            if (!r.ok) return '';
            const j = await r.json();
            return (j && j.data && j.data[0] && j.data[0].url) || '';
        };
        const out = { id };
        if (pedir.logo) out.logo = await primeiro('/logos/game/' + id);
        if (pedir.capa) out.capa = await primeiro('/grids/game/' + id + '?dimensions=600x900') || await primeiro('/grids/game/' + id + '?dimensions=342x482,660x930');
        if (pedir.banner) out.banner = await primeiro('/heroes/game/' + id);
        return out;
    }
    /** (compatível) só o logo */
    async function buscarLogoSteamGrid(nome, chave, fetchFn) {
        return (await buscarArtesSteamGrid(nome, chave, fetchFn, { logo: true })).logo || '';
    }

    /**
     * ScreenScraper: logo "wheel" + vídeo snap do jogo. Precisa das credenciais de dev + login.
     * Busca pelo NOME (jeuRecherche — o jeuInfos exige o CRC da ROM ou o sistema); quando o
     * console do jogo é conhecido, procura primeiro só nele e, sem resultado, em todos.
     */
    const SS_SISTEMAS = {
        msdos: 135, dos: 135, 'web-dos': 135, 'web-windows': 138, 'web-pc': 138, 'web-indie': 138,
        ps1: 57, psx: 57, 'web-ps1': 57, ps2: 58, 'web-ps2': 58, psp: 61, 'web-psp': 61,
        n64: 14, 'web-n64': 14, gamecube: 13, 'web-gamecube': 13, dreamcast: 23, 'web-dreamcast': 23,
        megadrive: 1, genesis: 1, mastersystem: 2, nes: 3, snes: 4, gb: 9, gbc: 10, gba: 12, nds: 15,
        sega32x: 19, segacd: 20, gamegear: 21, saturn: 22, arcade: 75, 'web-arcade': 75, neogeo: 142,
        atari2600: 26, atari5200: 40, atari7800: 41, lynx: 28, jaguar: 27, pcengine: 31, pcenginecd: 114, pcfx: 72,
        ngp: 25, neogeocd: 70, wonderswan: 45, vb: 11, colecovision: 48, msx: 113, c64: 66, amiga: 64, odyssey2: 104, '3do': 29, '3ds': 17,
        pcclassics: 138
    };
    /** Erro do ScreenScraper traduzido (ele explica em francês, em texto) */
    async function erroScreenScraper(r) {
        let txt = ''; try { txt = String(await r.text()).trim().slice(0, 160); } catch (e) { /* */ }
        if (/d[ée]veloppeur|devid|developer/i.test(txt)) return new Error('Dev ID / Dev password recusados — peça os seus no fórum do ScreenScraper (HTTP ' + r.status + ')');
        if (/identifiant|login|utilisateur|ssid|password/i.test(txt)) return new Error('usuário/senha do site recusados (HTTP ' + r.status + ')');
        if (r.status === 429 || r.status === 430 || r.status === 431 || /quota|threads|maximum/i.test(txt)) return new Error('limite de consultas do ScreenScraper atingido; tente mais tarde (HTTP ' + r.status + ')');
        return new Error('HTTP ' + r.status + (txt ? ' — ' + txt : ''));
    }

    /**
     * Procura um JOGO no ScreenScraper pelo nome (jeuRecherche) e devolve a ficha inteira dele
     * (nomes, sinopses, datas, gêneros, jogadores, mídias…) — ou null.
     * Escolhe o resultado cujo nome mais bate com o pedido (nunca "qualquer um"); com o console
     * conhecido, procura primeiro só nele.
     * ⚠ As URLs de mídia da ficha levam as credenciais: NUNCA grave essas URLs — baixe o arquivo.
     */
    async function buscarJogoScreenScraper(nome, ss, fetchFn, consoleId) {
        if (!nome || !ss || !ss.dev) return null;
        const f = fetchFn || ((...a) => fetch(...a));
        const alvo = normText(nome).replace(/\s*\(.*?\)\s*/g, ' ').trim();
        const nomesDe = (j) => (j.noms || []).map(n => normText(n.text || '').replace(/\s*\(.*?\)\s*/g, ' ').trim()).filter(Boolean);
        const nota = (j) => {
            const ns = nomesDe(j);
            if (ns.includes(alvo)) return 3;
            if (ns.some(n => n.startsWith(alvo) || alvo.startsWith(n))) return 2;
            if (ns.some(n => n.includes(alvo) || alvo.includes(n))) return 1;
            return 0;
        };
        const pedir = async (sistema) => {
            const p = new URLSearchParams({
                devid: ss.dev, devpassword: ss.devSenha || '', softname: ss.softname || 'cartoonzine',
                output: 'json', ssid: ss.user || '', sspassword: ss.senha || '', recherche: nome
            });
            if (sistema) p.set('systemeid', String(sistema));
            const r = await f('https://www.screenscraper.fr/api2/jeuRecherche.php?' + p.toString());
            if (!r.ok) {
                if (r.status === 404) return null;
                throw await erroScreenScraper(r);
            }
            let j; try { j = await r.json(); } catch (e) { throw new Error('resposta inválida (confira as credenciais)'); }
            const jogos = ((j && j.response && j.response.jeux) || []).filter(x => x && x.id);
            let melhor = null, nm = 0;
            for (const x of jogos) { const n = nota(x); if (n > nm) { nm = n; melhor = x; } }
            return melhor;
        };
        const sis = SS_SISTEMAS[String(consoleId || '').toLowerCase()];
        let jeu = sis ? await pedir(sis) : null;
        if (!jeu) jeu = await pedir(null);
        return jeu;
    }

    /**
     * Identifica o jogo PELA ROM (jeuInfos: nome do arquivo + sistema, e o md5/tamanho quando o robô baixou o arquivo).
     * É o jeito certo de achar o nome oficial de uma ROM com nome bagunçado. Devolve a ficha (como a da busca) ou null.
     * ⚠ As URLs de mídia da ficha levam as credenciais: NUNCA grave essas URLs — baixe o arquivo.
     */
    async function buscarJogoPorRomScreenScraper(arquivo, ss, fetchFn, consoleId, extra = {}) {
        if (!arquivo || !ss || !ss.dev) return null;
        const sis = SS_SISTEMAS[String(consoleId || '').toLowerCase()];
        if (!sis) return null;                       // sem o sistema o jeuInfos não funciona
        const f = fetchFn || ((...a) => fetch(...a));
        const p = new URLSearchParams({
            devid: ss.dev, devpassword: ss.devSenha || '', softname: ss.softname || 'cartoonzine',
            output: 'json', ssid: ss.user || '', sspassword: ss.senha || '', systemeid: String(sis), romtype: 'rom', romnom: String(arquivo).replace(/^.*[\\/]/, '')
        });
        if (extra.md5) p.set('md5', extra.md5);
        if (extra.tamanho) p.set('romtaille', String(extra.tamanho));
        const r = await f('https://www.screenscraper.fr/api2/jeuInfos.php?' + p.toString());
        if (!r.ok) {
            if (r.status === 404) return null;
            throw await erroScreenScraper(r);
        }
        let j; try { j = await r.json(); } catch (e) { return null; }
        const jeu = j && j.response && j.response.jeu;
        return jeu && jeu.id ? jeu : null;
    }
    /** O nome oficial na ficha do ScreenScraper (Brasil → mundo → EUA → resto) */
    function nomeScreenScraper(jeu) {
        const ns = (jeu && jeu.noms) || [];
        for (const r of ['br', 'wor', 'us', 'ss', 'eu', 'jp']) { const n = ns.find(x => x.region === r && x.text); if (n) return String(n.text).trim(); }
        return ns[0] && ns[0].text ? String(ns[0].text).trim() : '';
    }

    /** Escolhe as mídias de uma ficha do ScreenScraper (URLs COM credenciais — só para baixar). */
    function midiasScreenScraper(jeu) {
        const medias = (jeu && jeu.medias) || [];
        const ordemRegiao = ['br', 'wor', 'us', 'eu', 'ss', 'jp'];
        const achar = (tipos) => {
            for (const t of tipos) {
                const ms = medias.filter(m => (m.type || '') === t && m.url);
                if (!ms.length) continue;
                ms.sort((a, b) => {
                    const ra = ordemRegiao.indexOf(a.region || 'wor'), rb = ordemRegiao.indexOf(b.region || 'wor');
                    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
                });
                return ms[0];
            }
            return null;
        };
        return {
            capa: achar(['box-2D', 'box-3D']),
            logo: achar(['wheel-hd', 'wheel', 'wheel-carbon', 'wheel-steel']),
            banner: achar(['fanart', 'screenmarquee']),
            video: achar(['video-normalized', 'video']),
            previa: achar(['sstitle', 'ss'])          // tela de título (ou uma tela do jogo) para antes do vídeo
        };
    }

    /** Dados de texto de uma ficha do ScreenScraper (sem URLs): sinopse, ano, gêneros, jogadores. */
    function dadosScreenScraper(jeu) {
        if (!jeu) return {};
        const porLingua = (arr, campo = 'text') => {
            const a = Array.isArray(arr) ? arr : [];
            const pt = a.find(x => /^pt/i.test(x.langue || '')), en = a.find(x => /^en/i.test(x.langue || ''));
            const x = pt || en || a[0];
            return x ? { texto: String(x[campo] || '').trim(), lingua: pt ? 'pt' : (en ? 'en' : (x.langue || '')) } : null;
        };
        const sin = porLingua(jeu.synopsis);
        const datas = Array.isArray(jeu.dates) ? jeu.dates : [];
        const data = ['wor', 'br', 'us', 'eu', 'jp'].map(r => datas.find(d => d.region === r)).find(Boolean) || datas[0];
        const ano = data && /(\d{4})/.test(data.text || '') ? +RegExp.$1 : null;
        const generos = (Array.isArray(jeu.genres) ? jeu.genres : [])
            .sort((a, b) => (b.principale === '1') - (a.principale === '1'))
            .map(g => { const n = porLingua(g.noms); return n && n.texto; })
            .filter(Boolean).filter((g, i, a) => a.indexOf(g) === i).slice(0, 3);
        const jog = jeu.joueurs && String(jeu.joueurs.text || '').match(/(\d+)\s*$/);
        return {
            sinopse: sin && sin.texto ? sin.texto : '', sinopseLingua: sin ? sin.lingua : '',
            ano, generos, jogadores: jog ? +jog[1] : null,
            nome: ((jeu.noms || []).find(n => n.region === 'wor') || (jeu.noms || [])[0] || {}).text || '',
            sistema: jeu.systeme && jeu.systeme.text, id: jeu.id
        };
    }

    /** (compatível com o teste da caixa de Chaves) logo/vídeo/capa encontrados — URLs com credenciais, NÃO grave. */
    async function buscarScreenScraper(nome, ss, fetchFn, consoleId) {
        const jeu = await buscarJogoScreenScraper(nome, ss, fetchFn, consoleId);
        const m = midiasScreenScraper(jeu);
        return { logo: (m.logo && m.logo.url) || '', video: (m.video && m.video.url) || '', capa: (m.capa && m.capa.url) || '' };
    }

    async function completarItem(item, { tmdb, omdb, steamgrid, screenscraper, wiki = false, fetchFn, tipoColecao = 'video' } = {}) {
        let out = Object.assign({}, item);
        const achados = [], avisos = [];
        // JOGOS: logo, capa (estilo DVD) e banner pelo SteamGridDB. Nunca sobrescreve o que você pôs à mão.
        // (ScreenScraper fica DESLIGADO: os links de mídia dele levam o seu usuário e as senhas
        //  dentro da URL — gravados no catálogo público, eles vazariam.)
        if (tipoColecao === 'jogo') {
            const pedir = { logo: !out.logo, capa: !out.capa, banner: !out.banner };
            if (steamgrid && (pedir.logo || pedir.capa || pedir.banner)) {
                try {
                    const a = await buscarArtesSteamGrid(out.nome, steamgrid, fetchFn, pedir);
                    const nomes = { logo: 'logo', capa: 'capa', banner: 'banner' };
                    const veio = [];
                    for (const k of ['logo', 'capa', 'banner']) if (pedir[k] && a[k]) { out[k] = a[k]; veio.push(nomes[k]); }
                    if (veio.length) achados.push('SteamGridDB: ' + veio.join(' + '));
                    else avisos.push('SteamGridDB: nada encontrado para "' + (out.nome || '') + '".');
                } catch (e) { avisos.push('SteamGridDB: ' + e.message); }
            }
            if (screenscraper && screenscraper.dev) avisos.push('ScreenScraper desligado (as URLs de mídia dele expõem a senha).');
            return { item: out, achados, avisos };
        }
        if (tipoColecao !== 'video') return { item: out, achados, avisos };
        if (tmdb) {
            try {
                const a = await buscarTMDB(out, tmdb, fetchFn);
                if (a) {
                    out = aplicarDadosExternos(out, a);
                    const eps = (a.temporadasMeta || []).reduce((n, t) => n + t.episodios.filter(e => e.titulo || e.descricao || e.capa).length, 0);
                    achados.push('TMDB: ' + a.tituloTMDB + (eps ? ` (${eps} episódios)` : ''));
                    if (a.porBusca) avisos.push('Achado pelo nome no TMDB — confira se é a obra certa (ou cole o link do TMDB/IMDb).');
                } else avisos.push('Não achei no TMDB.');
            } catch (e) { avisos.push(e.message); }
        }
        if (!tmdb && wiki && (!out.descricao || !out.capa)) {
            try {
                const w = await buscarWikipedia(out.nome, fetchFn);
                if (w) { out = mesclarSemSobrescrever(out, w); achados.push('Wikipedia: ' + w.tituloWikipedia); }
            } catch (e) { avisos.push('Wikipedia: ' + e.message); }
        }
        delete out.tituloWikipedia;
        if (omdb && out.imdb) {
            try {
                const n = await buscarNotaIMDb(out.imdb, omdb, fetchFn);
                if (n) { out = aplicarDadosExternos(out, n); achados.push('IMDb: ⭐ ' + n.notaImdb); }
            } catch (e) { avisos.push(e.message); }
        }
        return { item: out, achados, avisos };
    }

    // ------------------------------------------------------------------
    // Países e idiomas (canais e rádios)
    // ------------------------------------------------------------------
    const PAISES = {
        BR: 'Brasil', PT: 'Portugal', US: 'Estados Unidos', GB: 'Reino Unido', CA: 'Canadá', MX: 'México',
        AR: 'Argentina', CL: 'Chile', CO: 'Colômbia', PE: 'Peru', UY: 'Uruguai', PY: 'Paraguai', BO: 'Bolívia',
        VE: 'Venezuela', EC: 'Equador', ES: 'Espanha', FR: 'França', IT: 'Itália', DE: 'Alemanha', NL: 'Holanda',
        BE: 'Bélgica', CH: 'Suíça', AT: 'Áustria', IE: 'Irlanda', SE: 'Suécia', NO: 'Noruega', DK: 'Dinamarca',
        FI: 'Finlândia', PL: 'Polônia', RU: 'Rússia', UA: 'Ucrânia', TR: 'Turquia', GR: 'Grécia', RO: 'Romênia',
        JP: 'Japão', KR: 'Coreia do Sul', CN: 'China', TW: 'Taiwan', HK: 'Hong Kong', IN: 'Índia', PH: 'Filipinas',
        ID: 'Indonésia', TH: 'Tailândia', VN: 'Vietnã', AU: 'Austrália', NZ: 'Nova Zelândia', ZA: 'África do Sul',
        AO: 'Angola', MZ: 'Moçambique', CV: 'Cabo Verde', NG: 'Nigéria', EG: 'Egito', MA: 'Marrocos',
        SA: 'Arábia Saudita', AE: 'Emirados Árabes', IL: 'Israel', CU: 'Cuba', DO: 'República Dominicana',
        PR: 'Porto Rico', CR: 'Costa Rica', PA: 'Panamá', GT: 'Guatemala', INT: 'Internacional'
    };
    const IDIOMAS = ['Português', 'Português (Portugal)', 'Inglês', 'Espanhol', 'Francês', 'Italiano', 'Alemão', 'Japonês', 'Coreano',
        'Chinês', 'Russo', 'Árabe', 'Hindi', 'Holandês', 'Turco', 'Polonês', 'Latim', 'Grego', 'Hebraico', 'Multilíngue'];

    /** "BR" -> 🇧🇷 (países sem bandeira, como INT, ficam com 🌐) */
    function bandeira(cc) {
        if (!/^[A-Z]{2}$/.test(cc || '')) return '🌐';
        return String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
    }

    /** "Brasil", "br", "BRA", "brasil" -> "BR". Desconhecido -> o próprio texto em maiúsculas. */
    function codigoPais(v) {
        if (!v) return undefined;
        const s = String(v).trim();
        const up = s.toUpperCase();
        if (PAISES[up]) return up;
        const alvo = normText(s);
        for (const [k, nome] of Object.entries(PAISES)) if (normText(nome) === alvo) return k;
        const tres = { BRA: 'BR', PRT: 'PT', USA: 'US', GBR: 'GB', ARG: 'AR', MEX: 'MX', ESP: 'ES', FRA: 'FR', JPN: 'JP' };
        if (tres[up]) return tres[up];
        return up.slice(0, 8);
    }

    /** Categorias em inglês (iptv-org, Pluto TV...) -> nomes usados no TVzine. */
    const CATEGORIAS_PT = {
        general: 'TV Aberta', news: 'Notícias', sports: 'Esportes', kids: 'Infantil', animation: 'Infantil',
        movies: 'Filmes e Séries', series: 'Filmes e Séries', music: 'Música', religious: 'Religioso',
        documentary: 'Documentários', entertainment: 'Variedades', education: 'Educativo', cooking: 'Culinária',
        lifestyle: 'Variedades', comedy: 'Variedades', culture: 'Variedades', family: 'Infantil',
        business: 'Notícias', weather: 'Notícias', legislative: 'Notícias', science: 'Documentários',
        travel: 'Documentários', outdoor: 'Documentários', classic: 'Filmes e Séries', auto: 'Variedades', shop: 'Variedades'
    };
    function traduzirCategoria(c) {
        if (!c) return c;
        const primeira = String(c).split(/[;,]/)[0].trim();
        if (/^undefined$/i.test(primeira)) return undefined;
        return CATEGORIAS_PT[primeira.toLowerCase()] || primeira;
    }

    // ------------------------------------------------------------------
    // Campos de cada tipo (o painel desenha o formulário a partir daqui)
    // ------------------------------------------------------------------
    // tipos de campo: texto, textarea, numero, links, url, lista, escolha, bool, temporadas
    // Aparência no banner da home (Vitrine). Só valem quando o item é destaque.
    const SKINS_BANNER = ['cinema', 'arcade', 'poster', 'vintage'];
    const FX_BANNER = ['none', 'crt', 'vhs', 'scan', 'cinema', 'neon', 'bw'];
    const CAMPOS_BANNER = [
        { k: 'bannerLogo', rotulo: 'Logo no banner (PNG)', tipo: 'url', imagem: true, avancado: true, dica: 'logo do título, de preferência PNG transparente; vazio = busca sozinho ou mostra o nome' },
        { k: 'bannerVideo', rotulo: 'Vídeo da prévia no banner', tipo: 'url', avancado: true, dica: 'trailer/trecho que toca por cima do banner; vazio = usa o próprio vídeo' },
        { k: 'bannerSkin', rotulo: 'Skin no banner', tipo: 'escolha', opcoes: ['', ...SKINS_BANNER], avancado: true, dica: 'vazio = a escolhida no aparelho (Daileon Dashboard)' },
        { k: 'bannerFx', rotulo: 'Efeito no banner', tipo: 'escolha', opcoes: ['', ...FX_BANNER], avancado: true, dica: 'vazio = o escolhido no aparelho' }
    ];
    // Cartucho web (consoles "web" e "webpc")
    const LICENCAS_WEB = ['livre', 'autorizada', 'precisa-original', 'nao-verificada'];
    const ENGINES_WEB = ['WebAssembly', 'Emscripten', 'Unity WebGL', 'Godot', 'Flash/Ruffle', 'HTML5/JavaScript', 'DOS (js-dos)', 'Outro'];
    const CONTROLES_WEB = ['teclado', 'gamepad', 'mouse', 'teclado-mouse', 'toque'];
    const PESOS_WEB = ['leve', 'medio', 'pesado'];
    /** Consoles de uma coleção de jogos (Jogos Retrô usa "consoles"; Jogos Web usa "consolesWeb"). */
    function consolesDaColecao(colecao, config) {
        const lista = config && config[(colecao && colecao.consoles) || 'consoles'];
        return Array.isArray(lista) ? lista : [];
    }
    /** Todos os consoles/sistemas do Studio (retrô + web), para achar um pelo id. */
    function todosConsoles(config) {
        return config ? [].concat(config.consoles || [], config.consolesWeb || []) : [];
    }
    /** console de jogos web? (pelo studio.config.json: "web": true ou estar em consolesWeb; sem config, pelo id web-…) */
    function consoleWeb(id, config) {
        if (!id) return false;
        if (config && (config.consolesWeb || []).some(x => x.id === id)) return true;
        const c = config && todosConsoles(config).find(x => x.id === id);
        return c ? !!c.web : /^web(-[a-z0-9]+|pc|tv)?$/.test(String(id));
    }
    /**
     * Sistema do EmulatorJS de um console retrô ("core" no studio.config.json): é o que o app manda
     * para o cartucho.html quando o jogo não escolheu um core próprio. Sem config, pelo id mais comum.
     */
    const CORE_PADRAO = {
        arcade: 'arcade', neogeo: 'arcade', nes: 'nes', snes: 'snes', n64: 'n64', nds: 'nds', gb: 'gb', gbc: 'gb', gba: 'gba',
        vb: 'vb', megadrive: 'segaMD', mastersystem: 'segaMS', gamegear: 'segaGG', segacd: 'segaCD', sega32x: 'sega32x',
        saturn: 'segaSaturn', atari2600: 'atari2600', atari5200: 'a5200', atari7800: 'atari7800', jaguar: 'jaguar', lynx: 'lynx',
        pcengine: 'pce', pcenginecd: 'pce', pcfx: 'pcfx', ngp: 'ngp', wonderswan: 'ws', colecovision: 'coleco', amiga: 'amiga',
        c64: 'c64', c128: 'c128', pet: 'pet', plus4: 'plus4', vic20: 'vic20', msdos: 'dos', ps1: 'psx', psp: 'psp', '3do': '3do',
        '3ds': '3ds'
    };
    function coreDoConsole(id, config) {
        if (!id) return undefined;
        const c = config && todosConsoles(config).find(x => x.id === id);
        if (c) return c.semEmulador || c.web ? undefined : (c.core || CORE_PADRAO[id]);
        return CORE_PADRAO[id];
    }
    /** Onde o jogo aparece: "Só PC" marcado = só no PC; senão TV e PC (ou o "aparelhos" do console). */
    function aparelhosDoConsole(id, config, item) {
        if (item && item.soPC) return ['pc'];
        const c = config && todosConsoles(config).find(x => x.id === id);
        if (c && Array.isArray(c.aparelhos)) return c.aparelhos.slice();
        return String(id) === 'webpc' ? ['pc'] : ['tv', 'pc'];
    }
    /**
     * Sistema original de um jogo web pelo nome (para quem chega pela importação).
     * Heurística: a 1ª regra que casar vale; sem regra = "web-outros" (Sem categoria), para conferir no painel.
     */
    const REGRAS_SISTEMA_WEB = [
        ["web-fangames", "^a bite at freddy|five nights at (candy|epstein|frickbear|last breath)|freddy's world: refreshed|i can't believe it's not sonic|jumbo mario|kirby ~ soft|open sonic|sonic robo blast|sonic\\.exe|sonic worlds next|super mario bros\\. remastered|super mario zombies|undertale yellow|deltatraveler|touhou mother|pizza tower: scoutdigo|brutal doom|slendytubbies|caseoh|raldi|jeffrey epstein basics|gabriel's awesome|claude of duty|kino der toten|nacht der untoten|^moon |black ops zombies|luigi's picture poker|fundamental paper novel|super mario 64 multiplayer|super mario 64 \\(multiplayer"],
        ["web-remakes", "^ballerburg|^battle city|road rash \\(three|rocks'n'diamonds|zelda ii|pokémon mystery dungeon|eaglercraft|^openttd|^xrick|minesweeper plus|^freegemas|^xgalaga|^vectoroids|super smash bros\\. \\(smash"],
        ["web-pc", "^luanti|^neverball|^tremulous|^urban terror|^freeciv|pekka kana"],
        ["web-dos", "^alley cat|caesar ii|^chasm|commander keen|daggerfall|^descent|^doom($| \\(|$)|doom i & ii|doom multiplayer|^duke[ :]|^nblood|^dune ii|dungeon keeper|fatal racing|heretic|heroes of might and magic ii|prince of persia|^powerslave|^quake($| tg)|quakeworld|netquake|redneck rampage|^shadow warrior|^stunts|^syndicate|toonstruck|^witchaven|tekwar|^ww2 gi|^wwii gi|^nam / napalm|wolfenstein 3d|beneath a steel sky|drascula|amazon queen|^девятка|jump 'n bump|opentyrian|simcity|warcraft ii|^carmageddon|^wadcmd"],
        ["web-windows", "space cadet|american mcgee|arx fatalis|atlantis: the lost|brawlhalla|command & conquer|counter[- ]strike|cyberpunk|^diablo|^doom 3|cricket 07|^fallout|grand theft auto 2|grand theft auto iii|vice city|^gta|half[- ]life|^homeworld|lego island|lego racers|need for speed|no one lives forever|^portal|return to castle|rollercoaster|s\\.t\\.a\\.l\\.k\\.e\\.r|jedi knight|team fortress|unreal tournament|^quake ii|^quake iii|morrowind|hard truck|space rangers|liquidator|silkroad|simgolf|warzone 2100|quest for (hussein|al-qa)|minecraft story mode|call of duty: modern warfare|counter strike 2019|reset generation|hexen ii|harry potter and the chamber|plants vs\\.? zombies|simpsons: hit & run|^sonic mania|tsukihime"],
        ["web-n64", "diddy kong|goldeneye|perfect dark|super mario 64"],
        ["web-gamecube", "battle stadium d\\.o\\.n|super monkey ball|^pikmin|super mario sunshine|star fox adventures|animal crossing|twilight princess|phantasy star online episode i & ii|resident evil 4"],
        ["web-dreamcast", "phantasy star online \\(pso|virtua tennis 2"],
        ["web-xbox", "^halo"],
        ["web-xbox360", "castle crashers|^skate 3|sonic the hedgehog 4"],
        ["web-ps1", "crash bash|crash team racing|legend of legaia|^pepsiman|^wipeout|^tomb raider|gran turismo 2"],
        ["web-psp", "\\(psp|chains of olympus|ghost of sparta|chinatown wars|crisis core|monster hunter freedom|ultimate ninja impact|size matters|silent hill: origins|tekken 5: dark resurrection|tekken: dark resurrection|nba 2k12"],
        ["web-ps3", "ufc 2009"],
        ["web-ps2", "burnout 3|crash nitro kart|budokai|def jam|fifa street|fifa 1[123]$|formula one 06|gran turismo 4|jak and daxter|madden nfl|midnight club 3|shaolin monks|ultimate ninja 5|nba street|nfl street|pro evolution soccer|resident evil outbreak|^ratchet & clank$|spider-man 2|^ssx 3|street fighter anniversary|^tekken [45]$|the warriors|tony hawk|smackdown|hot shots tennis|kingdom hearts|downhill domination"],
        ["web-arcade", "daytona usa|virtua fighter|sonic the fighters|marvel vs\\. capcom|3rd strike|virtual on|taiko no tatsujin"],
        ["web-mobile", "^granny|plague inc|geometry dash|cut the rope|bad piggies|amazing alex|power hover|talking baby hippo|flying gorilla|call of mini|minecraft pocket|minecraft 0\\.6|createrria|spaceflight simulator|f1 race \\(mtk"],
        ["web-java", "runescape classic"],
        ["web-navegador", "duck life|lacey's flash|mini dayz|apes vs helium|cheese rolling|uvuvwevwevwe"],
        ["web-macos", "cro-mag rally"],
        ["web-zxspectrum", "sm-kart-zx"],
        ["web-indie", "20 minutes till dawn|^-3$|difficult game about climbing|ages of conflict|amanda the adventurer|among us|andy's apple farm|antonblast|arthur's nightmare|bad parenting|baldi's basics|beatblock|bendy and|bergentruck|bloodmoney|boil noodles|brotato|buckshot roulette|cheese cube|christmas massacre|class of '09|clover pit|clustertruck|crashout crew|crazy cattle|cruelty squad|cuphead|dead plate|deadseat|deltarune|dice a million|do not take this cat|doki doki|dude simulator|endoparasitic|fear & hunger|fears to fathom|feed & grow|^fez$|^fih$|^fish$|five nights at freddy|^fnaf$|faster than light|getting over it|gorilla tag|happy room|happy sheepies|helltaker|hollow knight|hotline miami|how to fish|human expenditure|i wanna be the guy|in stars and time|inscryption|iron lung|jelly drift|just shapes|karlson|kindergarten|la madriguera|lethal company|^limbo$|lobotomy corporation|look outside|midnight shift|milk (in|out)side|mindwave|miside|needy streamer|nubby's|^omori|oneshot|overburden|^peak|peaks of yore|people playground|pizza tower|^r\\.e\\.p\\.o|^raft$|rain world|rimworld|s\\.p\\.l\\.i\\.t|saihate|schoolboy runaway|scp: containment|shift at midnight|slay the spire|^slender|slime rancher|spelunky|speed stars|stardew|stick with it|^t³|tattletail|not my neighbor|binding of isaac|man (from|in) the window|seven games of the soul|totally accurate|trombone champ|ultrakill|ultrapool|^undertale$|untitled goose|webfishing|who's your daddy|yandere|your only move|yume nikki|^celeste|cave story|vvvvvv|lugaru|terraria|^re:run|promises to keep|fused 240|witch's heart|koi/_flixel|lethal ape"]
    ];
    function sistemaWebDoNome(nome) {
        const n = String(nome || '').trim().toLowerCase();
        for (const [cat, rx] of REGRAS_SISTEMA_WEB) if (new RegExp(rx).test(n)) return cat;
        return 'web-outros';
    }

    /**
     * Lê o README do "Ultimate Catalog of Web Game Ports" (tabelas | Jogo | [▶ host](link) | [📦 repo](link) |)
     * e devolve { jogos: [{nome, ano?, links, repo?, host, secao, estrela}], semDemo: [{nome, repo, secao}] }.
     * Tolerante: linha estranha é ignorada; o link "▶" que aponta para o GitHub mas tem o endereço
     * jogável escrito no texto usa o endereço do texto.
     */
    function lerCatalogoWebPorts(texto) {
        const jogos = [], semDemo = [], vistos = new Set();
        let secao = '';
        for (const bruta of String(texto || '').split(/\r?\n/)) {
            const linha = bruta.trim();
            const h = /^##\s+(.+?)(\s*<sub>.*)?$/.exec(linha);
            if (h) { secao = h[1].trim(); continue; }
            if (!linha.startsWith('|') || /^\|\s*-{3}/.test(linha) || /^\|\s*Game\s*\|/i.test(linha)) continue;
            const cel = linha.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(x => x.trim());
            if (cel.length < 2) continue;
            let nome = cel[0].replace(/^⭐\s*/, '').replace(/\s+/g, ' ').trim();
            const estrela = /^⭐/.test(cel[0]);
            if (!nome || /^(icon|game)$/i.test(nome)) continue;
            let ano;
            const mA = /^(.*\S)\s*\((\d{4})\)\s*$/.exec(nome);
            if (mA) { nome = mA[1]; ano = parseInt(mA[2], 10); }
            const links = [];
            const reLink = /\[▶\s*([^\]]*)\]\(([^)\s]+)\)/g;
            let m;
            while ((m = reLink.exec(cel[1] || ''))) {
                let u = limparLink(m[2]);
                const rot = m[1].trim();
                if (/^https?:\/\//i.test(rot) && /github\.com\//i.test(u) && !/github\.com\//i.test(rot)) u = limparLink(rot);
                if (linkValido(u) && !links.includes(u)) links.push(u);
            }
            const mR = /\[📦[^\]]*\]\(([^)\s]+)\)/.exec(cel.slice(2).join('|'));
            const repo = mR && linkValido(limparLink(mR[1])) ? limparLink(mR[1]) : undefined;
            const chave = normText(nome) + '|' + (links[0] || repo || '');
            if (vistos.has(chave)) continue;
            vistos.add(chave);
            if (links.length) {
                let host = ''; try { host = new URL(links[0]).hostname; } catch (e) { /* */ }
                jogos.push(limparVazios({ nome, ano, links, repo, host, secao, estrela: estrela || undefined }));
            } else if (repo) semDemo.push(limparVazios({ nome, ano, repo, secao }));
        }
        return { jogos, semDemo };
    }

    const CAMPOS_COMUNS_MIDIA = [
        { k: 'capa', rotulo: 'Capa (imagem vertical)', tipo: 'url', imagem: true },
        { k: 'banner', rotulo: 'Banner (imagem horizontal)', tipo: 'url', imagem: true },
        { k: 'fundoImagem', rotulo: 'Imagem do fundo do topo', tipo: 'seletorFundo', dica: 'qual imagem vira o fundo do topo da tela no app · sem banner, usa a capa' },
        { k: 'posFundo', rotulo: 'Posição da imagem no fundo do topo', tipo: 'posicao', de: 'capa', dica: 'no app a imagem vira o fundo do topo da tela, cortada na horizontal: arraste a imagem (ou use a barra) até mostrar a melhor parte · vazio = centro' },
        { k: 'descricao', rotulo: 'Sinopse', tipo: 'textarea' },
        { k: 'ano', rotulo: 'Ano', tipo: 'numero' },
        { k: 'generos', rotulo: 'Gêneros', tipo: 'lista', dica: 'separados por vírgula' }
    ];

    const TIPOS = {
        video: {
            rotulo: 'Filme, desenho ou série',
            campos: [
                { k: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
                { k: 'tmdb', rotulo: 'TMDB', tipo: 'texto', dica: 'cole o link do TMDB (ex.: themoviedb.org/tv/1234) ou deixe vazio' },
                { k: 'imdb', rotulo: 'IMDb', tipo: 'texto', dica: 'cole o link ou o código tt… do IMDb' },
                { k: 'links', rotulo: 'Link do vídeo (filme/desenho avulso)', tipo: 'links', dica: '1º link = principal; os outros viram reserva. Série? Deixe vazio e use as temporadas.' },
                ...CAMPOS_COMUNS_MIDIA,
                { k: 'audio', rotulo: 'Áudio', tipo: 'escolha', opcoes: ['', 'Dublado', 'Legendado', 'Dual Áudio', 'Original'] },
                { k: 'destaque', rotulo: 'Destaque no banner da home', tipo: 'bool' },
                { k: 'temporadas', rotulo: 'Temporadas e episódios', tipo: 'temporadas' },
                ...CAMPOS_BANNER
            ]
        },
        canal24h: {
            rotulo: 'Canal 24 horas',
            campos: [
                { k: 'nome', rotulo: 'Nome do canal', tipo: 'texto', obrigatorio: true },
                { k: 'links', rotulo: 'Link da transmissão', tipo: 'links', obrigatorio: true },
                { k: 'logo', rotulo: 'Logo', tipo: 'url', imagem: true },
                { k: 'descricao', rotulo: 'Descrição', tipo: 'textarea' },
                { k: 'generos', rotulo: 'Gêneros', tipo: 'lista' },
                { k: 'idioma', rotulo: 'Idioma (lista do app)', tipo: 'escolha', opcoesDe: 'idiomas', dica: 'cada idioma tem a própria lista no Desenhos 24H; vazio = Português' },
                { k: 'destaque', rotulo: 'Destaque', tipo: 'bool' },
                { k: 'banner', rotulo: 'Banner (imagem horizontal)', tipo: 'url', imagem: true, avancado: true, dica: 'imagem larga para o banner da home' },
                ...CAMPOS_BANNER
            ]
        },
        canal: {
            rotulo: 'Canal de TV (TVzine)',
            campos: [
                { k: 'nome', rotulo: 'Nome do canal', tipo: 'texto', obrigatorio: true },
                { k: 'links', rotulo: 'Link da transmissão', tipo: 'links', obrigatorio: true },
                { k: 'pais', rotulo: 'País', tipo: 'escolha', opcoesDe: 'paises', obrigatorio: true },
                { k: 'idioma', rotulo: 'Idioma', tipo: 'escolha', opcoesDe: 'idiomas' },
                { k: 'categoria', rotulo: 'Categoria', tipo: 'escolha', opcoesDe: 'categoriasCanais', livre: true, obrigatorio: true },
                { k: 'logo', rotulo: 'Logo', tipo: 'url', imagem: true },
                { k: 'tvgId', rotulo: 'ID do guia (tvg-id)', tipo: 'texto', dica: 'opcional, para a programação (EPG)' },
                { k: 'userAgent', rotulo: 'User-Agent', tipo: 'texto', avancado: true },
                { k: 'referer', rotulo: 'Referer', tipo: 'texto', avancado: true }
            ]
        },
        radio: {
            rotulo: 'Rádio',
            campos: [
                { k: 'nome', rotulo: 'Nome da rádio', tipo: 'texto', obrigatorio: true },
                { k: 'links', rotulo: 'Link do áudio (stream)', tipo: 'links', obrigatorio: true },
                { k: 'pais', rotulo: 'País', tipo: 'escolha', opcoesDe: 'paises', obrigatorio: true },
                { k: 'cidade', rotulo: 'Cidade', tipo: 'texto' },
                { k: 'idioma', rotulo: 'Idioma', tipo: 'escolha', opcoesDe: 'idiomas' },
                { k: 'generos', rotulo: 'Estilos', tipo: 'lista', dica: 'ex.: Pop, Rock, Notícias' },
                { k: 'logo', rotulo: 'Logo', tipo: 'url', imagem: true },
                { k: 'site', rotulo: 'Site', tipo: 'url' }
            ]
        },
        livro: {
            rotulo: 'Livro, gibi ou revista',
            campos: [
                { k: 'nome', rotulo: 'Título', tipo: 'texto', obrigatorio: true },
                { k: 'autor', rotulo: 'Autor(es)', tipo: 'texto' },
                { k: 'links', rotulo: 'Arquivo para ler', tipo: 'links', obrigatorio: true, dica: 'PDF, EPUB, CBZ/CBR (gibis), MOBI, DjVu, TXT… 1º = principal; os outros viram reserva. Link do archive.org importa sozinho.' },
                { k: 'categoria', rotulo: 'Estante', tipo: 'escolha', opcoesDe: 'categoriasLivros', livre: true },
                { k: 'formato', rotulo: 'Formato', tipo: 'escolha', opcoes: ['', 'PDF', 'EPUB', 'CBZ', 'CBR', 'CB7', 'MOBI', 'AZW3', 'DjVu', 'TXT', 'HTML'], dica: 'vazio = descobre pela extensão do link' },
                { k: 'idioma', rotulo: 'Idioma', tipo: 'escolha', opcoesDe: 'idiomas' },
                { k: 'serie', rotulo: 'Coleção / série', tipo: 'texto', dica: 'ex.: Turma da Mônica, Tex, Bíblia de Almeida' },
                { k: 'volume', rotulo: 'Número / volume', tipo: 'numero' },
                { k: 'editora', rotulo: 'Editora', tipo: 'texto' },
                { k: 'paginas', rotulo: 'Páginas', tipo: 'numero' },
                ...CAMPOS_COMUNS_MIDIA,
                { k: 'destaque', rotulo: 'Destaque', tipo: 'bool' }
            ]
        },
        jogo: {
            rotulo: 'Jogo retrô',
            campos: [
                { k: 'nome', rotulo: 'Nome do jogo', tipo: 'texto', obrigatorio: true },
                { k: 'console', rotulo: 'Console', tipo: 'escolha', opcoesDe: 'consoles', obrigatorio: true },
                { k: 'links', rotulo: 'Link da ROM', tipo: 'links', obrigatorio: true, dica: 'nos consoles Web Games: o link da página onde o jogo roda (https://…/index.html)' },
                ...CAMPOS_COMUNS_MIDIA,
                { k: 'jogadores', rotulo: 'Jogadores', tipo: 'numero' },
                { k: 'destaque', rotulo: 'Destaque no banner da home', tipo: 'bool' },
                { k: 'soPC', rotulo: 'Só PC (não aparece na TV)', tipo: 'bool', dica: 'marque nos jogos pesados ou que precisam de mouse/teclado' },
                { k: 'video', rotulo: 'Vídeo (snap)', tipo: 'url', avancado: true, dica: 'preenchido pelo ScreenScraper; vira a prévia do jogo no banner' },
                { k: 'previa', rotulo: 'Imagem da tela de prévia', tipo: 'url', imagem: true, avancado: true, dica: 'aparece no banner antes do vídeo (snap) começar — ex.: a tela de título do jogo · vazio = usa o banner' },
                { k: 'core', rotulo: 'Core do emulador', tipo: 'texto', avancado: true, dica: 'opcional; vazio = o core do console (studio.config.json → consoles → core). Arcade: fbneo (padrão), mame2003, mame2003_plus, fbalpha2012_cps1 ou fbalpha2012_cps2 — todos ficam no card Arcade. Nos Jogos Web é sempre "web"' },
                { k: 'comandoDos', rotulo: 'Comando do jogo (MS-DOS)', tipo: 'texto', avancado: true, dica: 'só MS-DOS: o programa que abre o jogo dentro do zip (ex.: KEEN4E.EXE). Vazio = AUTORUN.BAT do zip ou o .exe principal, escolhido sozinho' },
                // ---- só para os consoles Web Games (cartucho web: jogos que rodam direto no navegador) ----
                { k: 'licenca', rotulo: 'Licença (Web Games)', tipo: 'escolha', opcoes: ['', ...LICENCAS_WEB], avancado: true, dica: 'livre = jogo/código aberto ou gratuito · autorizada = demo oficial ou o dono liberou · precisa-original = o jogador carrega os arquivos do próprio jogo · jogo web só é publicado com a licença conferida' },
                { k: 'engine', rotulo: 'Tipo do port (Web Games)', tipo: 'escolha', opcoes: ['', ...ENGINES_WEB], avancado: true },
                { k: 'controles', rotulo: 'Controle (Web Games)', tipo: 'escolha', opcoes: ['', ...CONTROLES_WEB], avancado: true, dica: 'gamepad = o jogo já lê o controle sozinho (o cartucho não converte para teclado)' },
                { k: 'teclas', rotulo: 'Mapa controle → teclado (Web Games)', tipo: 'texto', avancado: true, dica: 'ex.: A=Space, B=KeyX, START=Enter · vazio = padrão (setas, Z, X, Enter…)' },
                { k: 'peso', rotulo: 'Peso (Web Games)', tipo: 'escolha', opcoes: ['', ...PESOS_WEB], avancado: true, dica: 'pesado = deixe no console "Web Games · Só PC"' },
                { k: 'repo', rotulo: 'Código-fonte (Web Games)', tipo: 'url', avancado: true },
                ...CAMPOS_BANNER
            ]
        }
    };

    // ------------------------------------------------------------------
    // Normalização e validação
    // ------------------------------------------------------------------
    function limparVazios(o) {
        for (const k of Object.keys(o)) {
            const v = o[k];
            if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || Number.isNaN(v)) delete o[k];
        }
        return o;
    }

    /** Aceita variações ("link", "url", "titulo", "sinopse"...) e devolve o formato oficial do Studio. */
    function normalizarItem(bruto, colecao) {
        const b = Object.assign({}, bruto || {});
        const tipo = colecao ? colecao.tipo : undefined;
        const out = {};
        out.nome = String(b.nome || b.titulo || b.title || b.name || '').trim();
        out.links = unicos(lista(b.links || b.link || b.url || b.urls || b.rom).map(limparLink));
        // link do TMDB/IMDb colado no campo de vídeo vira referência
        out.links = out.links.filter(u => { const r = refDoLink(u); if (r) { Object.assign(b, Object.assign({}, r, b.tmdb ? { tmdb: b.tmdb } : {}, b.imdb ? { imdb: b.imdb } : {})); return false; } return true; });
        const tm = normTmdb(b.tmdb), im = normImdb(b.imdb);
        if (tm) out.tmdb = tm;
        if (im) out.imdb = im;
        const nota = parseFloat(b.notaImdb);
        if (Number.isFinite(nota)) out.notaImdb = nota;
        const votos = parseInt(b.votosImdb, 10);
        if (Number.isFinite(votos)) out.votosImdb = votos;
        for (const k of ['capa', 'banner', 'logo', 'video', 'previa', 'site', 'fonte', 'repo']) if (b[k]) out[k] = String(b[k]).trim();
        if (!out.capa && (b.thumb || b.poster)) out.capa = String(b.thumb || b.poster).trim();
        const desc = b.descricao || b.sinopse || b.desc;
        if (desc) out.descricao = String(desc).trim();
        const ano = inteiro(b.ano || b.year);
        if (ano) out.ano = ano;
        const gen = lista(b.generos || b.genero || b.genre || b.estilos);
        if (gen.length) out.generos = gen;
        for (const k of ['audio', 'cidade', 'idioma', 'categoria', 'tvgId', 'userAgent', 'referer', 'core', 'archive', 'autor', 'editora', 'formato', 'serie', 'engine', 'teclas', 'comandoDos']) {
            if (b[k] !== undefined && b[k] !== '') out[k] = String(b[k]).trim();
        }
        if (b.pais) out.pais = codigoPais(b.pais);
        if (out.categoria) { out.categoria = traduzirCategoria(out.categoria); if (!out.categoria) delete out.categoria; }
        if (b.console) out.console = String(b.console).trim().toLowerCase();
        if (LICENCAS_WEB.includes(b.licenca)) out.licenca = b.licenca;
        if (CONTROLES_WEB.includes(b.controles)) out.controles = b.controles;
        if (PESOS_WEB.includes(b.peso)) out.peso = b.peso;
        const jog = inteiro(b.jogadores);
        if (jog) out.jogadores = jog;
        for (const k of ['volume', 'paginas']) { const n = inteiro(b[k]); if (n) out[k] = n; }
        if (b.fundoImagem === 'banner') out.fundoImagem = 'banner';   // capa é o padrão (não precisa gravar)
        const pf = parseFloat(b.posFundo);                 // 0 (topo da imagem) até 100 (pé); vazio = centro
        if (Number.isFinite(pf)) out.posFundo = Math.max(0, Math.min(100, Math.round(pf)));
        if (b.destaque === true || b.destaque === 'true' || b.destaque === 'sim') out.destaque = true;
        if (b.soPC === true || b.soPC === 'true' || b.soPC === 'sim') out.soPC = true;
        for (const k of ['bannerLogo', 'bannerVideo']) if (b[k]) out[k] = String(b[k]).trim();
        if (SKINS_BANNER.includes(b.bannerSkin)) out.bannerSkin = b.bannerSkin;
        if (FX_BANNER.includes(b.bannerFx)) out.bannerFx = b.bannerFx;
        // posição no banner da home (Vitrine): só vale para quem é destaque
        const ordem = inteiro(b.destaqueOrdem);
        if (out.destaque && ordem) out.destaqueOrdem = ordem;
        if (b.headers && typeof b.headers === 'object') {
            if (b.headers['User-Agent'] && !out.userAgent) out.userAgent = b.headers['User-Agent'];
            if (b.headers['Referer'] && !out.referer) out.referer = b.headers['Referer'];
        }
        if (tipo === 'video' && Array.isArray(b.temporadas) && b.temporadas.length) {
            out.temporadas = b.temporadas.map((t, i) => ({
                numero: inteiro(t.numero ?? t.temporada ?? t.season) || i + 1,
                episodios: (t.episodios || t.episodes || []).map((e, j) => limparVazios({
                    numero: inteiro(e.numero ?? e.episodio ?? e.episode) || j + 1,
                    titulo: e.titulo || e.title ? String(e.titulo || e.title).trim() : undefined,
                    links: unicos(lista(e.links || e.link || e.url).map(limparLink)),
                    capa: e.capa || e.thumb || undefined,
                    descricao: e.descricao || e.desc || undefined
                }))
            })).filter(t => t.episodios.length).sort((a, b) => a.numero - b.numero);
            out.temporadas.forEach(t => t.episodios.sort((a, b) => a.numero - b.numero));
        }
        for (const k of Object.keys(b)) if (k.startsWith('_')) out[k] = b[k];
        return limparVazios(out);
    }

    function validarItem(item, colecao, config) {
        const erros = [], avisos = [];
        const tipo = TIPOS[colecao.tipo];
        if (!tipo) return { erros: ['Tipo de coleção desconhecido: ' + colecao.tipo], avisos };
        if (!item.nome) erros.push('Falta o nome');
        const temEps = Array.isArray(item.temporadas) && item.temporadas.length;
        for (const c of tipo.campos) {
            if (!c.obrigatorio || c.k === 'nome') continue;
            const v = item[c.k];
            if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) erros.push('Falta: ' + c.rotulo);
        }
        if (colecao.tipo === 'video' && temEps && (item.links || []).length) avisos.push('Tem link de filme E temporadas: o app mostra como série e o link avulso fica de fora');
        if (colecao.tipo === 'video' && !temEps && !(item.links || []).length) erros.push('Coloque o link do vídeo ou adicione temporadas/episódios');
        for (const u of item.links || []) if (!linkValido(u)) erros.push('Link inválido: ' + u);
        for (const k of ['capa', 'banner', 'logo', 'site', 'bannerLogo', 'bannerVideo']) if (item[k] && !linkValido(item[k])) avisos.push(k + ' não parece um link: ' + item[k]);
        if (temEps) {
            for (const t of item.temporadas) {
                const nums = new Set();
                for (const e of t.episodios) {
                    if (nums.has(e.numero)) avisos.push(`T${t.numero}E${e.numero} repetido`);
                    nums.add(e.numero);
                    if (!(e.links || []).length) erros.push(`T${t.numero}E${e.numero} sem link`);
                    for (const u of e.links || []) if (!linkValido(u)) erros.push(`T${t.numero}E${e.numero}: link inválido ${u}`);
                }
            }
        }
        if (colecao.tipo === 'jogo' && item.console && config && !consolesDaColecao(colecao, config).some(c => c.id === item.console)) {
            erros.push('Console desconhecido nesta coleção: ' + item.console + ' (veja "' + (colecao.consoles || 'consoles') + '" no studio.config.json)');
        }
        if (colecao.tipo === 'jogo' && consoleWeb(item.console, config)) {
            // cartucho web: só vai para o app com a licença conferida (rascunho pode ficar sem)
            if (!item._rascunho && (!item.licenca || item.licenca === 'nao-verificada')) erros.push('Jogo web: confira a licença antes de publicar (campo "Licença")');
            for (const u of item.links || []) if (/^magnet:/i.test(u)) erros.push('Jogo web precisa de um link https da página do jogo');
            if (item.peso === 'pesado' && !item.soPC) avisos.push('jogo pesado indo para a TV: marque "Só PC"');
            if (item.repo && !linkValido(item.repo)) avisos.push('repo não parece um link: ' + item.repo);
        }
        if (item.ano && (item.ano < 1880 || item.ano > 2100)) avisos.push('Ano estranho: ' + item.ano);
        if (item.archive && !(item.links || []).length && !temEps) erros.push('Link do Internet Archive ainda não importado (use "Importar" no painel ou tools/importar.mjs)');
        return { erros, avisos };
    }

    // ------------------------------------------------------------------
    // Caminhos dos arquivos de conteúdo
    // ------------------------------------------------------------------
    /** conteudo/<colecao>/[<subpasta>/]<slug>.json */
    /** Valor da subpasta do item (ou o padrão da coleção, ex.: YouToon sem idioma = Português). */
    function valorSubpasta(colecao, item) {
        const sub = colecao && colecao.subpasta;
        if (!sub) return '';
        return (item && item[sub]) || (colecao.padroes && colecao.padroes[sub]) || '';
    }

    function caminhoItem(colecao, item, slug) {
        let pasta = 'conteudo/' + colecao.id;
        if (colecao.subpasta) {
            const v = valorSubpasta(colecao, item);
            pasta += '/' + (v ? slugify(v) : 'outros');
        }
        return pasta + '/' + (slug || slugify(item.nome)) + '.json';
    }

    function colecaoDoCaminho(config, caminho) {
        const m = /^conteudo\/([^/]+)\//.exec(caminho);
        return m ? (config.colecoes || []).find(c => c.id === m[1]) : null;
    }

    /** Slug livre: "nome", "nome-2", "nome-3"... */
    function slugLivre(base, ocupados) {
        let s = base, n = 2;
        while (ocupados.has(s)) s = base + '-' + n++;
        return s;
    }

    function serializar(item) {
        return JSON.stringify(item, null, 2) + '\n';
    }

    // ------------------------------------------------------------------
    // Compilação: itens do Studio -> formato do cartoonzine-cloud
    // ------------------------------------------------------------------
    function paraCloud(item, colecao, chave, config) {
        const [url, ...espelhos] = item.links || [];
        const base = {
            title: item.nome,
            desc: item.descricao,
            year: item.ano,
            genre: item.generos,
            destaque: item.destaque || undefined,
            destaqueOrdem: item.destaque ? item.destaqueOrdem : undefined,
            bannerlogo: item.bannerLogo, preview: item.bannerVideo,
            bannerSkin: item.bannerSkin, bannerFx: item.bannerFx,
            bgImg: item.fundoImagem === 'banner' ? 'banner' : undefined,   // fundo do topo: o banner no lugar da capa
            bgPosY: item.posFundo,                         // altura da imagem no fundo do topo (0–100 %)
            studio: chave
        };
        switch (colecao.tipo) {
            case 'video': {
                const o = Object.assign(base, {
                    thumb: item.capa, bannerThumb: item.banner, audio: item.audio,
                    imdbId: item.imdb, tmdbId: item.tmdb, imdbRating: item.notaImdb, imdbVotes: item.votosImdb
                });
                if (item.temporadas && item.temporadas.length) {
                    o.seasons = item.temporadas.map(t => ({
                        season: t.numero,
                        episodes: t.episodios.map(e => limparVazios({
                            episode: e.numero, title: e.titulo, url: (e.links || [])[0],
                            thumb: e.capa, overview: e.descricao,
                            reservas: (e.links || []).slice(1)
                        }))
                    }));
                } else {
                    o.url = url;
                    o.mirrors = espelhos;
                }
                return limparVazios(o);
            }
            case 'canal24h':
                return limparVazios(Object.assign(base, { url, mirrors: espelhos, logo: item.logo, bannerThumb: item.banner, idioma: item.idioma || (colecao.padroes && colecao.padroes.idioma), group: colecao.fonteCloud && colecao.fonteCloud.targetCategory }));
            case 'livro':
                return limparVazios(Object.assign(base, {
                    url, mirrors: espelhos, thumb: item.capa, bannerThumb: item.banner,
                    author: item.autor, publisher: item.editora, pages: item.paginas,
                    format: item.formato || formatoDoLink(url), language: item.idioma,
                    category: item.categoria || 'Livros', series: item.serie, volume: item.volume,
                    categoryType: 'livro'
                }));
            case 'canal': {
                const headers = {};
                if (item.userAgent) headers['User-Agent'] = item.userAgent;
                if (item.referer) headers['Referer'] = item.referer;
                return limparVazios(Object.assign(base, {
                    url, mirrors: espelhos, logo: item.logo, group: item.categoria, tvgId: item.tvgId,
                    country: item.pais, countryName: PAISES[item.pais], language: item.idioma,
                    headers: Object.keys(headers).length ? headers : undefined
                }));
            }
            case 'radio':
                return limparVazios(Object.assign(base, {
                    url, mirrors: espelhos, logo: item.logo, country: item.pais, countryName: PAISES[item.pais],
                    city: item.cidade, language: item.idioma, site: item.site
                }));
            case 'jogo': {
                const o = Object.assign(base, {
                    url, mirrors: espelhos, thumb: item.capa, bannerThumb: item.banner,
                    logo: item.logo, video: item.video, preview: item.bannerVideo || item.video, previewThumb: item.previa,
                    bannerlogo: item.bannerLogo || item.logo,   // o banner do app usa "bannerlogo" no lugar do nome do jogo   // logo + vídeo snap (ScreenScraper) para o banner
                    console: item.console, players: item.jogadores, core: item.core || coreDoConsole(item.console, config),
                    dosrun: item.comandoDos,                                                    // MS-DOS: programa do jogo dentro do zip
                    aparelhos: item.soPC ? ['pc'] : undefined                               // "Só PC": a TV não mostra
                });
                // cartucho web: o app abre a página do jogo no cartucho-web.html (core "web")
                if (consoleWeb(item.console, config)) Object.assign(o, {
                    core: 'web', web: true, aparelhos: aparelhosDoConsole(item.console, config, item),
                    engine: item.engine, license: item.licenca, controls: item.controles, keys: item.teclas, weight: item.peso, repo: item.repo
                });
                return limparVazios(o);
            }
            default:
                return limparVazios(Object.assign(base, { url, mirrors: espelhos }));
        }
    }

    function linhaM3U(o, extra) {
        const a = [];
        if (o.tvgId) a.push(`tvg-id="${m3uEscapar(o.tvgId)}"`);
        a.push(`tvg-name="${m3uEscapar(o.title)}"`);
        if (o.logo || o.thumb) a.push(`tvg-logo="${m3uEscapar(o.logo || o.thumb)}"`);
        if (o.country) a.push(`tvg-country="${m3uEscapar(o.country)}"`);
        if (o.language) a.push(`tvg-language="${m3uEscapar(o.language)}"`);
        a.push(`group-title="${m3uEscapar((extra && extra.grupo) || o.group || '')}"`);
        let s = `#EXTINF:-1 ${a.join(' ')},${m3uEscapar(o.title)}\n`;
        if (o.headers && o.headers['User-Agent']) s += `#EXTVLCOPT:http-user-agent=${o.headers['User-Agent']}\n`;
        if (o.headers && o.headers['Referer']) s += `#EXTVLCOPT:http-referrer=${o.headers['Referer']}\n`;
        return s + o.url + '\n';
    }

    function gerarM3U(registros, extra) {
        return '#EXTM3U\n' + registros.filter(o => o.url).map(o => linhaM3U(o, extra)).join('');
    }

    function ordenar(a, b) {
        return (b.destaque ? 1 : 0) - (a.destaque ? 1 : 0) || String(a.title).localeCompare(String(b.title), 'pt', { numeric: true, sensitivity: 'base' });
    }

    /**
     * Compila uma coleção inteira.
     * @param {object} colecao  entrada de config.colecoes
     * @param {Array<{caminho:string,item:object}>} entradas  itens já lidos
     * @returns {{arquivos: Object<string,string>, fontes: object[], relatorio: object}}
     *          arquivos: caminho relativo em dist/ -> conteúdo
     */
    function compilarColecao(colecao, entradas, config) {
        const arquivos = {};
        const fontes = [];
        const rel = { colecao: colecao.id, total: 0, publicados: 0, erros: [], avisos: [] };
        const base = (config.publicacao && config.publicacao.baseUrl) || '';
        const validos = [];
        const linksVistos = new Map();

        for (const { caminho, item: bruto } of entradas) {
            rel.total++;
            const item = normalizarItem(bruto, colecao);
            const { erros, avisos } = validarItem(item, colecao, config);
            avisos.forEach(a => rel.avisos.push({ caminho, msg: a }));
            if (erros.length) { erros.forEach(e => rel.erros.push({ caminho, msg: e })); continue; }
            if (item._rascunho) { rel.avisos.push({ caminho, msg: 'rascunho (_rascunho: true) — não publicado' }); continue; }
            const principal = (item.links || [])[0];
            if (principal) {
                if (linksVistos.has(principal)) rel.avisos.push({ caminho, msg: 'mesmo link de ' + linksVistos.get(principal) });
                else linksVistos.set(principal, caminho);
            }
            const chave = caminho.replace(/^conteudo\//, '').replace(/\.json$/, '');
            validos.push({ item, registro: paraCloud(item, colecao, chave, config) });
        }
        rel.publicados = validos.length;
        const regs = validos.map(v => v.registro).sort(ordenar);

        const fonte = (extraFonte, arq) => Object.assign({}, extraFonte, { url: base + arq });

        if (colecao.tipo === 'jogo' && colecao.fonteCloudPorConsole) {
            const consoles = consolesDaColecao(colecao, config);
            const porConsole = new Map(consoles.map(c => [c.id, []]));
            for (const r of regs) (porConsole.get(r.console) || []).push(r);
            rel.porConsole = {};
            for (const c of consoles) {
                const arq = `${colecao.pastaDist || colecao.id}/${c.id}.json`;   // Jogos Web publica em jogos/ (endereço que o cloud já lê)
                const lst = porConsole.get(c.id);
                arquivos[arq] = JSON.stringify({ console: c.id, nome: c.nome, games: lst }, null, 1);
                rel.porConsole[c.id] = lst.length;
                fontes.push(fonte(limparVazios({ nome: c.nome, tipo: 'emulator_json', prefixoId: c.prefixoId, console: c.id, targetCategory: c.nome, grupo: c.grupo, web: c.web || colecao.consoles === 'consolesWeb' || undefined }), arq));
            }
            arquivos[`${colecao.id}.json`] = JSON.stringify({ colecao: colecao.id, games: regs }, null, 1);
            return { arquivos, fontes, relatorio: rel };
        }

        const chaveLista = { canal: 'channels', canal24h: 'channels', radio: 'items' }[colecao.tipo] || 'items';
        arquivos[`${colecao.id}.json`] = JSON.stringify({ colecao: colecao.id, nome: colecao.nome, [chaveLista]: regs }, null, 1);

        // Uma lista por idioma (YouToon): youtoon/pt-br.json, youtoon/es.json… e uma fonte do cloud para cada uma.
        // Cada lista é publicada mesmo vazia, para a fonte do cloud nunca dar 404.
        if (colecao.listasPorIdioma) {
            const idiomas = config[colecao.listasPorIdioma] || [];
            const padrao = (colecao.padroes && colecao.padroes.idioma) || '';
            const deQual = r => idiomas.find(l => normText(l.nome) === normText(r.idioma || padrao) || normText(l.codigo) === normText(r.idioma || ''));
            for (const r of regs) if (!deQual(r)) rel.avisos.push({ caminho: 'conteudo/' + colecao.id + '/' + r.studio, msg: 'idioma "' + (r.idioma || '?') + '" não tem lista (veja "' + colecao.listasPorIdioma + '" no studio.config.json)' });
            rel.porIdioma = {};
            const indice = [];
            for (const l of idiomas) {
                const arq = `${colecao.id}/${slugify(l.codigo)}.json`;
                const lst = regs.filter(r => deQual(r) === l).map(r => Object.assign({}, r, { idioma: l.codigo }));
                arquivos[arq] = JSON.stringify({ colecao: colecao.id, idioma: l.codigo, nome: l.nome, [chaveLista]: lst }, null, 1);
                rel.porIdioma[l.codigo] = lst.length;
                indice.push({ codigo: l.codigo, nome: l.nome, total: lst.length, json: base + arq });
                if (colecao.fonteCloud) fontes.push(fonte(Object.assign({}, colecao.fonteCloud, {
                    nome: colecao.fonteCloud.nome + ' · ' + l.nome, idioma: l.codigo, prefixoId: l.prefixoId || colecao.fonteCloud.prefixoId
                }), arq));
            }
            arquivos[`${colecao.id}/idiomas.json`] = JSON.stringify({ colecao: colecao.id, idiomas: indice }, null, 1);
            return { arquivos, fontes, relatorio: rel };
        }

        // Bookzine: índice das estantes, formatos e idiomas (para a view montar os filtros sem baixar tudo)
        if (colecao.tipo === 'livro') {
            const conta = (k) => { const o = {}; for (const r of regs) if (r[k]) o[r[k]] = (o[r[k]] || 0) + 1; return o; };
            arquivos[`${colecao.id}/indice.json`] = JSON.stringify({ colecao: colecao.id, total: regs.length,
                estantes: conta('category'), formatos: conta('format'), idiomas: conta('language') }, null, 1);
        }

        if (colecao.tipo === 'canal' || colecao.tipo === 'canal24h' || colecao.tipo === 'radio') {
            arquivos[`${colecao.id}.m3u`] = gerarM3U(regs, colecao.tipo === 'radio' ? { grupo: colecao.nome } : null);
        }
        if (colecao.tipo === 'canal' || colecao.tipo === 'radio') {
            const porPais = new Map();
            for (const r of regs) {
                const p = r.country || 'INT';
                if (!porPais.has(p)) porPais.set(p, []);
                porPais.get(p).push(r);
            }
            rel.porPais = {};
            const indicePaises = [];
            for (const [p, lst] of [...porPais.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
                const cc = p.toLowerCase();
                arquivos[`${colecao.id}/pais/${cc}.m3u`] = gerarM3U(lst, colecao.tipo === 'radio' ? { grupo: colecao.nome } : null);
                arquivos[`${colecao.id}/pais/${cc}.json`] = JSON.stringify({ pais: p, nome: PAISES[p] || p, [chaveLista]: lst }, null, 1);
                rel.porPais[p] = lst.length;
                const cats = {};
                for (const r of lst) if (r.group) cats[r.group] = (cats[r.group] || 0) + 1;
                indicePaises.push(limparVazios({
                    codigo: p, nome: PAISES[p] || p, bandeira: bandeira(p), total: lst.length,
                    idiomas: unicos(lst.map(r => r.language)),
                    categorias: Object.keys(cats).length ? cats : undefined,
                    json: base + `${colecao.id}/pais/${cc}.json`,
                    m3u: base + `${colecao.id}/pais/${cc}.m3u`
                }));
            }
            // Índice para o seletor de países do app (TVzine / rádio): um item por país com os links das listas
            arquivos[`${colecao.id}/paises.json`] = JSON.stringify({ colecao: colecao.id, paises: indicePaises }, null, 1);
        }

        if (colecao.fonteCloud) {
            // Desenhos 24h: a fonte lê o M3U (é o que a vaga do cloud espera); o resto lê o JSON
            const arq = colecao.fonteCloud.tipo === 'vod_m3u' ? `${colecao.id}.m3u` : `${colecao.id}.json`;
            if (!arquivos[arq]) arquivos[arq] = gerarM3U(regs);
            fontes.push(fonte(colecao.fonteCloud, arq));
        }
        return { arquivos, fontes, relatorio: rel };
    }

    /**
     * Sistema novo da seção Jogos Web: monta a linha certa (id web-…, prefixo único) e devolve
     * { sistema, config } com a config já com ele. Erro se o nome/id já existir.
     */
    function novoSistemaWeb(config, { nome, grupo, id, prefixoId } = {}) {
        const n = String(nome || '').trim();
        if (!n) throw new Error('Escreva o nome do sistema');
        const ident = 'web-' + slugify(String(id || n).replace(/^web-/, ''));
        const todos = todosConsoles(config);
        if (todos.some(c => c.id === ident)) throw new Error('Já existe um sistema com o id ' + ident);
        if ((config.consolesWeb || []).some(c => normText(c.nome) === normText(n))) throw new Error('Já existe um sistema chamado ' + n);
        const usados = new Set(todos.map(c => c.prefixoId));
        let pre = String(prefixoId || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        if (!pre || usados.has(pre)) {
            const palavras = semAcento(n).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
            const base = (palavras.length > 1 ? palavras.map(p => p[0]).join('') : (palavras[0] || '')).slice(0, 4) || 'WEB';   // "Game Boy Advance" → GBA
            pre = base; let k = 2;
            while (usados.has(pre)) pre = base.slice(0, 3) + (k++);
        }
        const sistema = { id: ident, nome: n, prefixoId: pre, web: true, grupo: String(grupo || 'Outros').trim() || 'Outros' };
        const nova = Object.assign({}, config, { consolesWeb: [].concat(config.consolesWeb || [], [sistema]) });
        return { sistema, config: nova };
    }

    /**
     * Escreve o sistema novo no TEXTO do studio.config.json sem mexer no resto do arquivo
     * (mantém o alinhamento e os comentários). Se o formato não for o esperado, reescreve o JSON inteiro.
     */
    function inserirSistemaNoTexto(texto, sistema) {
        const linha = '    { ' + Object.keys(sistema).map(k => JSON.stringify(k) + ': ' + JSON.stringify(sistema[k])).join(', ') + ' }';
        const i = texto.indexOf('"consolesWeb": [');
        if (i >= 0) {
            const fim = texto.indexOf('\n  ]', i);
            if (fim > i) {
                const antes = texto.slice(0, fim).replace(/\s*$/, '');
                const vazio = antes.endsWith('[');
                const novo = antes + (vazio ? '\n' : ',\n') + linha + texto.slice(fim);
                try { const c = JSON.parse(novo); if ((c.consolesWeb || []).some(x => x.id === sistema.id)) return novo; } catch (e) { /* cai no plano B */ }
            }
        }
        const c = JSON.parse(texto);
        c.consolesWeb = [].concat(c.consolesWeb || [], [sistema]);
        return JSON.stringify(c, null, 2) + '\n';
    }

    /** Opções de campos "escolha" que vêm da config. */
    function opcoesDe(nome, config, colecao) {
        if (nome === 'paises') return Object.entries(PAISES).map(([v, r]) => ({ v, r: r + ' (' + v + ')' }));
        if (nome === 'idiomas') return IDIOMAS.map(v => ({ v, r: v }));
        if (nome === 'consoles') return (colecao ? consolesDaColecao(colecao, config) : todosConsoles(config)).map(c => ({ v: c.id, r: c.nome }));
        if (nome === 'categoriasCanais') return (config.categoriasCanais || []).map(v => ({ v, r: v }));
        if (nome === 'categoriasLivros') return (config.categoriasLivros || []).map(v => ({ v, r: v }));
        return [];
    }

    /** Preenche um rascunho com o que der para descobrir sozinho, sem sobrescrever o que já existe. */
    function mesclarSemSobrescrever(item, achado) {
        const out = Object.assign({}, item);
        for (const [k, v] of Object.entries(achado || {})) {
            if (k === 'tituloWikipedia') continue;
            if (out[k] === undefined || out[k] === '' || (Array.isArray(out[k]) && !out[k].length)) out[k] = v;
        }
        return out;
    }

    /**
     * Junta um item novo num existente (mesmo nome): episódios novos entram na
     * temporada certa, links novos viram reserva, campos vazios são completados.
     * Nada que já existe é apagado.
     */
    function mesclarItem(existente, novo) {
        const out = mesclarSemSobrescrever(existente, novo);
        out.links = unicos([].concat(existente.links || [], novo.links || []));
        if (!out.links.length) delete out.links;
        if (novo.temporadas && novo.temporadas.length) {
            const temps = (existente.temporadas || []).map(t => ({ numero: t.numero, episodios: t.episodios.map(e => Object.assign({}, e)) }));
            for (const tn of novo.temporadas) {
                let t = temps.find(x => x.numero === tn.numero);
                if (!t) { t = { numero: tn.numero, episodios: [] }; temps.push(t); }
                for (const en of tn.episodios) {
                    const e = t.episodios.find(x => x.numero === en.numero);
                    if (e) {
                        e.links = unicos([].concat(e.links || [], en.links || []));
                        if (!e.titulo && en.titulo) e.titulo = en.titulo;
                    } else t.episodios.push(Object.assign({}, en));
                }
                t.episodios.sort((a, b) => a.numero - b.numero);
            }
            out.temporadas = temps.sort((a, b) => a.numero - b.numero);
        }
        return out;
    }

    /** Linha do índice do painel (lista rápida sem abrir cada arquivo). */
    function resumoItem(caminho, item) {
        return limparVazios({
            caminho,
            nome: item.nome || item.titulo || item.title,
            capa: item.capa || item.logo,
            banner: item.banner,
            ano: item.ano,
            destaque: item.destaque ? true : undefined,
            destaqueOrdem: item.destaque ? item.destaqueOrdem : undefined,
            nota: item.notaImdb,
            eps: contarEpisodios(item) || undefined,
            pais: item.pais, console: item.console, categoria: item.categoria,
            licenca: item.licenca,
            soPC: item.soPC ? true : undefined,
            rascunho: item._rascunho ? true : undefined,
            auto: item._origem ? true : undefined
        });
    }

    /** Quantos episódios um item tem (0 = filme/canal avulso). */
    function contarEpisodios(item) {
        return (item.temporadas || []).reduce((n, t) => n + (t.episodios || []).length, 0);
    }

    return {
        VERSAO, TIPOS, PAISES, IDIOMAS, mesclarItem, contarEpisodios, resumoItem,
        slugify, normText, semAcento, limparHtml, lista,
        linkValido, nomeDoLink, idDoArchive, ehLinkDePaginaDoBot,
        analisarNome, lerM3U, lerTextoColado, agruparEntradas, gerarM3U,
        lerListaArquivo, consoleDoNomeSistema, consoleDaExtensao, limparNomeRom, prepararJogoEmMassa, buscarJogoPorRomScreenScraper, nomeScreenScraper,
        itemDoArchive, importarArchive, buscarWikipedia, livroDoArchive, formatoDoLink, valorSubpasta,
        refDoLink, normTmdb, normImdb, buscarTMDB, buscarNotaIMDb, buscarLogoSteamGrid, buscarArtesSteamGrid, buscarScreenScraper, buscarJogoScreenScraper, midiasScreenScraper, dadosScreenScraper, aplicarDadosExternos, completarItem,
        codigoPais, bandeira, traduzirCategoria, normalizarItem, validarItem, limparVazios,
        caminhoItem, colecaoDoCaminho, slugLivre, serializar,
        paraCloud, compilarColecao, opcoesDe, mesclarSemSobrescrever, coreDoConsole, CORE_PADRAO,
        consoleWeb, aparelhosDoConsole, consolesDaColecao, todosConsoles, novoSistemaWeb, inserirSistemaNoTexto, sistemaWebDoNome, lerCatalogoWebPorts, LICENCAS_WEB, ENGINES_WEB, CONTROLES_WEB, PESOS_WEB
    };
});
