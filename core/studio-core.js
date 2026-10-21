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
                    headers: e.headers, archive: e.archive, tmdb: e.tmdb, imdb: e.imdb
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
    /** Logo (PNG transparente) de um JOGO pelo SteamGridDB. Devolve '' quando não acha. */
    async function buscarLogoSteamGrid(nome, chave, fetchFn) {
        if (!nome || !chave) return '';
        const f = fetchFn || ((...a) => fetch(...a));
        const h = { headers: { Authorization: 'Bearer ' + String(chave).trim() } };
        const base = 'https://www.steamgriddb.com/api/v2';
        const rb = await f(base + '/search/autocomplete/' + encodeURIComponent(nome), h);
        if (rb.status === 401 || rb.status === 403) throw new Error('chave recusada (' + rb.status + ')');
        if (!rb.ok) throw new Error('busca HTTP ' + rb.status);
        const jb = await rb.json();
        const id = jb && jb.data && jb.data[0] && jb.data[0].id;
        if (!id) return '';
        const rl = await f(base + '/logos/game/' + id, h);
        if (!rl.ok) throw new Error('logos HTTP ' + rl.status);
        const jl = await rl.json();
        return (jl && jl.data && jl.data[0] && jl.data[0].url) || '';
    }

    /** ScreenScraper (jeuInfos): logo "wheel" + vídeo snap do jogo. Precisa das credenciais de dev + login. */
    async function buscarScreenScraper(nome, ss, fetchFn) {
        if (!nome || !ss || !ss.dev) return {};
        const f = fetchFn || ((...a) => fetch(...a));
        const p = new URLSearchParams({
            devid: ss.dev, devpassword: ss.devSenha || '', softname: ss.softname || 'cartoonzine',
            output: 'json', ssid: ss.user || '', sspassword: ss.senha || '', romnom: nome
        });
        const r = await f('https://www.screenscraper.fr/api2/jeuInfos.php?' + p.toString());
        if (r.status === 401 || r.status === 403 || r.status === 430) throw new Error('credenciais recusadas (' + r.status + ')');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let j; try { j = await r.json(); } catch (e) { throw new Error('resposta inválida (confira as credenciais)'); }
        const medias = (j && j.response && j.response.jeu && j.response.jeu.medias) || [];
        const achar = (re) => { const m = medias.find(x => re.test(x.type || '') && /(wor|eu|us|ss)/i.test(x.region || 'wor')) || medias.find(x => re.test(x.type || '')); return (m && (m.url || '')) || ''; };
        return { logo: achar(/wheel|logo/i), video: achar(/video/i), capa: achar(/box-2D|box2d|mixrbv|ss$/i) };
    }

    async function completarItem(item, { tmdb, omdb, steamgrid, screenscraper, wiki = false, fetchFn, tipoColecao = 'video' } = {}) {
        let out = Object.assign({}, item);
        const achados = [], avisos = [];
        // JOGOS: logo (SteamGridDB) + logo/vídeo snap (ScreenScraper). Nunca sobrescreve o que você pôs à mão.
        if (tipoColecao === 'jogo') {
            if (steamgrid && !out.logo) {
                try {
                    const url = await buscarLogoSteamGrid(out.nome, steamgrid, fetchFn);
                    if (url) { out.logo = url; achados.push('SteamGridDB: logo'); }
                    else avisos.push('SteamGridDB: logo não encontrado para "' + (out.nome || '') + '".');
                } catch (e) { avisos.push('SteamGridDB: ' + e.message); }
            }
            if (screenscraper && screenscraper.dev && (!out.logo || !out.video)) {
                try {
                    const ss = await buscarScreenScraper(out.nome, screenscraper, fetchFn);
                    if (ss.logo && !out.logo) { out.logo = ss.logo; achados.push('ScreenScraper: logo'); }
                    if (ss.video && !out.video) { out.video = ss.video; achados.push('ScreenScraper: vídeo'); }
                    if (ss.capa && !out.capa) { out.capa = ss.capa; }
                    if (!ss.logo && !ss.video && !out.logo) avisos.push('ScreenScraper: nada encontrado para "' + (out.nome || '') + '".');
                } catch (e) { avisos.push('ScreenScraper: ' + e.message); }
            }
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
    const CAMPOS_COMUNS_MIDIA = [
        { k: 'capa', rotulo: 'Capa (imagem vertical)', tipo: 'url', imagem: true },
        { k: 'banner', rotulo: 'Banner (imagem horizontal)', tipo: 'url', imagem: true },
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
                { k: 'links', rotulo: 'Link da ROM', tipo: 'links', obrigatorio: true },
                ...CAMPOS_COMUNS_MIDIA,
                { k: 'jogadores', rotulo: 'Jogadores', tipo: 'numero' },
                { k: 'destaque', rotulo: 'Destaque no banner da home', tipo: 'bool' },
                { k: 'video', rotulo: 'Vídeo (snap)', tipo: 'url', avancado: true, dica: 'preenchido pelo ScreenScraper; vira a prévia do jogo no banner' },
                { k: 'core', rotulo: 'Core do emulador', tipo: 'texto', avancado: true, dica: 'opcional; vazio = padrão do console' },
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
        for (const k of ['capa', 'banner', 'logo', 'video', 'site', 'fonte']) if (b[k]) out[k] = String(b[k]).trim();
        if (!out.capa && (b.thumb || b.poster)) out.capa = String(b.thumb || b.poster).trim();
        const desc = b.descricao || b.sinopse || b.desc;
        if (desc) out.descricao = String(desc).trim();
        const ano = inteiro(b.ano || b.year);
        if (ano) out.ano = ano;
        const gen = lista(b.generos || b.genero || b.genre || b.estilos);
        if (gen.length) out.generos = gen;
        for (const k of ['audio', 'cidade', 'idioma', 'categoria', 'tvgId', 'userAgent', 'referer', 'core', 'archive', 'autor', 'editora', 'formato', 'serie']) {
            if (b[k] !== undefined && b[k] !== '') out[k] = String(b[k]).trim();
        }
        if (b.pais) out.pais = codigoPais(b.pais);
        if (out.categoria) { out.categoria = traduzirCategoria(out.categoria); if (!out.categoria) delete out.categoria; }
        if (b.console) out.console = String(b.console).trim().toLowerCase();
        const jog = inteiro(b.jogadores);
        if (jog) out.jogadores = jog;
        for (const k of ['volume', 'paginas']) { const n = inteiro(b[k]); if (n) out[k] = n; }
        if (b.destaque === true || b.destaque === 'true' || b.destaque === 'sim') out.destaque = true;
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
        if (colecao.tipo === 'jogo' && item.console && config && !(config.consoles || []).some(c => c.id === item.console)) {
            erros.push('Console desconhecido: ' + item.console + ' (veja "consoles" no studio.config.json)');
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
    function paraCloud(item, colecao, chave) {
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
            case 'jogo':
                return limparVazios(Object.assign(base, {
                    url, mirrors: espelhos, thumb: item.capa, bannerThumb: item.banner,
                    logo: item.logo, video: item.video, preview: item.bannerVideo || item.video,   // logo + vídeo snap (ScreenScraper) para o banner
                    console: item.console, players: item.jogadores, core: item.core
                }));
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
            validos.push({ item, registro: paraCloud(item, colecao, chave) });
        }
        rel.publicados = validos.length;
        const regs = validos.map(v => v.registro).sort(ordenar);

        const fonte = (extraFonte, arq) => Object.assign({}, extraFonte, { url: base + arq });

        if (colecao.tipo === 'jogo' && colecao.fonteCloudPorConsole) {
            const consoles = config.consoles || [];
            const porConsole = new Map(consoles.map(c => [c.id, []]));
            for (const r of regs) (porConsole.get(r.console) || []).push(r);
            rel.porConsole = {};
            for (const c of consoles) {
                const arq = `${colecao.id}/${c.id}.json`;
                const lst = porConsole.get(c.id);
                arquivos[arq] = JSON.stringify({ console: c.id, nome: c.nome, games: lst }, null, 1);
                rel.porConsole[c.id] = lst.length;
                fontes.push(fonte({ nome: c.nome, tipo: 'emulator_json', prefixoId: c.prefixoId, console: c.id, targetCategory: c.nome }, arq));
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

    /** Opções de campos "escolha" que vêm da config. */
    function opcoesDe(nome, config) {
        if (nome === 'paises') return Object.entries(PAISES).map(([v, r]) => ({ v, r: r + ' (' + v + ')' }));
        if (nome === 'idiomas') return IDIOMAS.map(v => ({ v, r: v }));
        if (nome === 'consoles') return (config.consoles || []).map(c => ({ v: c.id, r: c.nome }));
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
        itemDoArchive, importarArchive, buscarWikipedia, livroDoArchive, formatoDoLink, valorSubpasta,
        refDoLink, normTmdb, normImdb, buscarTMDB, buscarNotaIMDb, buscarLogoSteamGrid, buscarScreenScraper, aplicarDadosExternos, completarItem,
        codigoPais, bandeira, traduzirCategoria, normalizarItem, validarItem, limparVazios,
        caminhoItem, colecaoDoCaminho, slugLivre, serializar,
        paraCloud, compilarColecao, opcoesDe, mesclarSemSobrescrever
    };
});
