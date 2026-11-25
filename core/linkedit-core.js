/**
 * 🔗 LINK EDIT — a parte "inteligente", sem tela: lê listas de canais (M3U, JSON, TXT ou qualquer texto colado),
 * limpa nomes, descobre idioma/país/tipo, junta cópias do mesmo canal (uma principal + reservas), filtra e
 * exporta de novo (M3U ou JSON do Cartoonzine). Usado pelo painel (painel/linkedit.js) e pelos testes
 * (test/linkedit.test.mjs).
 */
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else raiz.CZLinkEditCore = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const semAcento = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '');
    const norm = (t) => semAcento(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const RE_LINK = /^(https?|rtmpe?|rtsp|rtp|udp|srt|mms|magnet):/i;

    // ------------------------------------------------------------------
    // Ler listas
    // ------------------------------------------------------------------
    const attrs = (linha) => {
        const o = {};
        const re = /([a-z0-9_-]+)\s*=\s*"([^"]*)"/gi;
        let m;
        while ((m = re.exec(linha))) o[m[1].toLowerCase()] = m[2].trim();
        return o;
    };

    /** M3U / M3U8 (listas IPTV): #EXTINF com tvg-*, group-title, #EXTGRP, #EXTVLCOPT (user-agent, referrer) e url|User-Agent=… */
    function lerM3U(texto) {
        const out = [];
        let atual = null, grupo = '', epg = '';
        const linhas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/);
        for (let bruta of linhas) {
            const l = bruta.trim();
            if (!l) continue;
            if (/^#EXTM3U/i.test(l)) { const a = attrs(l); epg = a['url-tvg'] || a['x-tvg-url'] || epg; continue; }
            if (/^#EXTINF/i.test(l)) {
                const a = attrs(l);
                const virg = l.lastIndexOf('",') >= 0 ? l.lastIndexOf('",') + 2 : l.indexOf(',') + 1;
                atual = {
                    nome: (l.slice(virg).trim() || a['tvg-name'] || ''),
                    tvgId: a['tvg-id'] || '', tvgNome: a['tvg-name'] || '', logo: a['tvg-logo'] || a.logo || '',
                    grupo: a['group-title'] || grupo || '', pais: a['tvg-country'] || '', idioma: a['tvg-language'] || '', epgShift: +a['tvg-shift'] || undefined,
                    headers: {}
                };
                const tm = a['tvg-tmdb'] || a['tmdb-id'] || a.tmdb, im = a['tvg-imdb'] || a['imdb-id'] || a.imdb;
                if (tm || im) atual.lista = dadosDaLista({ tmdbId: tm, tmdbTipo: a['tvg-tmdb-type'] || a['tmdb-type'], imdbId: im, year: a['tvg-year'] || a.year });
                const dur = /^#EXTINF:\s*(-?\d+)/i.exec(l);
                if (dur && +dur[1] > 0) atual.duracao = +dur[1];
                continue;
            }
            if (/^#EXTGRP:/i.test(l)) { grupo = l.slice(8).trim(); if (atual && !atual.grupo) atual.grupo = grupo; continue; }
            if (/^#EXTVLCOPT:/i.test(l)) {
                const m = /^#EXTVLCOPT:\s*http-(user-agent|referrer|referer)\s*=\s*(.+)$/i.exec(l);
                if (m && atual) atual.headers[/agent/i.test(m[1]) ? 'User-Agent' : 'Referer'] = m[2].trim();
                continue;
            }
            if (l[0] === '#') continue;
            if (!RE_LINK.test(l)) continue;
            const c = atual || { nome: '', headers: {} };
            const [url, extra] = l.split('|');
            c.url = url.trim();
            if (extra) extra.split('&').forEach(p => { const [k, v] = p.split('='); if (k && v) c.headers[/agent/i.test(k) ? 'User-Agent' : /refer/i.test(k) ? 'Referer' : k] = decodeURIComponent(v); });
            out.push(c);
            atual = null;
        }
        return { canais: out, epg };
    }

    /** JSON: lista de canais, ou objeto com a lista dentro (channels, canais, items, streams, fontes…), formatos comuns de apps IPTV. */
    // ---------- 📋 LISTA COM DADOS (formato do DB oficial: tmdbId, imagens do TMDB, sinopse…) ----------
    // Lista "pronta" chega com os dados de vídeo; lista comum não tem nada disso e segue exatamente como antes.
    const CHAVES_LISTA = ['tmdbId', 'tmdb', 'imdbId', 'bannerThumb', 'backdrop', 'backdropUrl', 'previewThumb', 'posterUrl', 'desc', 'overview', 'description', 'descricao', 'serie', 'season', 'episode', 'runtime', 'bannerlogo', 'bannerLogo', 'imdbRating', 'year', 'ano'];
    /** objeto da lista → dados que o Studio usa (o que veio vazio fica de fora). null = a lista não traz dados de vídeo. */
    function dadosDaLista(o) {
        if (!o || !CHAVES_LISTA.some(k => o[k] != null && o[k] !== '')) return null;
        const pega = (...ks) => { for (const k of ks) if (o[k] != null && o[k] !== '') return o[k]; return undefined; };
        const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : undefined; };
        let tmdb = pega('tmdb');
        const tid = pega('tmdbId');
        if (!tmdb && tid != null) tmdb = /^(movie|tv)\//.test(String(tid)) ? String(tid) : /^\d+$/.test(String(tid)) ? (pega('tmdbTipo') === 'tv' || pega('serie', 'season', 'episode') != null ? 'tv' : 'movie') + '/' + tid : undefined;
        const capa = pega('thumb', 'posterUrl', 'poster', 'cover');
        const logo = pega('bannerlogo', 'bannerLogo') || (capa && o.logo && o.logo !== capa ? o.logo : undefined);
        const gen = pega('genre', 'genres', 'generos');
        const auds = [].concat(pega('audios') || []).map(x => String(x).toLowerCase());
        const d = {
            titulo: pega('title', 'titulo', 'name', 'nome'), ano: num(pega('year', 'ano')),
            capa: capa || (!tmdb ? undefined : o.logo) || undefined, banner: pega('bannerThumb', 'backdropUrl', 'backdrop'), previa: pega('previewThumb'), logo,
            descricao: pega('desc', 'overview', 'description', 'descricao'),
            generos: gen ? [].concat(gen).map(String).filter(Boolean) : undefined,
            tmdb, imdb: pega('imdbId'), nota: num(pega('rating')), notaImdb: num(pega('imdbRating')), votosImdb: num(pega('imdbVotes')),
            popularidade: num(pega('popularity')), duracao: num(pega('runtime')), classificacao: pega('age', 'classificacao') != null ? String(pega('age', 'classificacao')) : undefined,
            serie: pega('serie', 'series'), temporada: num(pega('season', 'temporada')), episodio: num(pega('episode', 'episodio')),
            audio: auds.includes('dublado') && auds.includes('legendado') ? 'dual' : auds[0] || undefined, qualidade: pega('qualidadeMax', 'qualidade')
        };
        Object.keys(d).forEach(k => (d[k] == null || d[k] === '' || (Array.isArray(d[k]) && !d[k].length)) && delete d[k]);
        return Object.keys(d).length ? d : null;
    }
    const DADOS_DA_LISTA = ['capa', 'banner', 'previa', 'logo', 'descricao', 'generos', 'tmdb', 'imdb', 'nota', 'notaImdb', 'votosImdb', 'popularidade', 'duracao', 'classificacao', 'ano'];
    /** a parte da lista que vira "dados" do vídeo (o mesmo lugar onde o TMDB guarda o que achou) */
    function dadosDeVideoDaLista(l) { const o = {}; DADOS_DA_LISTA.forEach(k => { if (l[k] != null) o[k] = l[k]; }); return o; }
    /** a lista manda: tipo, título, ano, série/temporada/episódio, áudio, qualidade e os dados (imagens, sinopse, TMDB…) */
    function aplicarLista(c) {
        const l = c.lista; if (!l || !ehVideo(c)) return c;
        const v = c.video = c.video || {};
        if (l.titulo) v.titulo = String(l.titulo).replace(/\s*[(\[]\d{4}[)\]]\s*$/, '').trim() || v.titulo;
        if (l.ano) v.ano = l.ano;
        if (c.natureza === 'episodio') { if (l.serie) v.serie = l.serie; if (l.temporada != null) v.temporada = l.temporada; if (l.episodio != null) v.episodio = l.episodio; }
        if (l.audio) v.audio = l.audio;
        if (l.qualidade) v.qualidade = String(l.qualidade).toUpperCase();
        if (l.generos && !v.genero) v.genero = l.generos.slice(0, 3).join(', ');
        v.dados = Object.assign({}, v.dados, dadosDeVideoDaLista(l));
        if (l.tmdb) { v.tmdbRef = l.tmdb; delete v.dados.porBusca; }
        return c;
    }
    function lerJSON(texto) {
        let d;
        try { d = JSON.parse(String(texto || '').replace(/^﻿/, '')); } catch (e) { return null; }
        const achar = (o, n = 0) => {
            if (Array.isArray(o)) return o;
            if (!o || typeof o !== 'object' || n > 3) return null;
            for (const k of ['channels', 'canais', 'items', 'itens', 'streams', 'lista', 'list', 'data', 'videos', 'results', 'fontes']) if (Array.isArray(o[k])) return o[k];
            // { "Grupo A": [ ... ], "Grupo B": [ ... ] }
            const grupos = Object.entries(o).filter(([, v]) => Array.isArray(v) && v.some(x => x && typeof x === 'object'));
            if (grupos.length) return grupos.flatMap(([g, l]) => l.map(x => (x && typeof x === 'object' && !x.group && !x.grupo ? Object.assign({ group: g }, x) : x)));
            for (const v of Object.values(o)) { const r = achar(v, n + 1); if (r) return r; }
            return null;
        };
        const lista = achar(d) || [];
        const pega = (o, ...ks) => { for (const k of ks) if (o[k] != null && o[k] !== '') return o[k]; return ''; };
        const canais = [];
        lista.forEach(o => {
            if (!o || typeof o !== 'object') return;
            let url = pega(o, 'url', 'link', 'stream', 'streamUrl', 'stream_url', 'src', 'file', 'uri');
            if (Array.isArray(url)) url = url[0];
            const reservas = [].concat(o.mirrors || o.reservas || o.urls || o.links || []).map(x => (typeof x === 'string' ? x : x && x.url)).filter(Boolean);
            if (!url && reservas.length) url = reservas.shift();
            if (!url || !RE_LINK.test(String(url).trim())) return;
            canais.push({
                nome: String(pega(o, 'name', 'nome', 'title', 'titulo', 'tvgName')).trim(),
                url: String(url).trim(), reservas: reservas.filter(u => u !== url),
                tvgId: String(pega(o, 'tvgId', 'tvg_id', 'tvg-id', 'epgId', 'epg_id')).trim(),
                logo: String(pega(o, 'logo', 'tvgLogo', 'tvg_logo', 'thumb', 'image', 'icon')).trim(),
                grupo: String(pega(o, 'group', 'grupo', 'category', 'categoria', 'genre')).trim(),
                pais: String(pega(o, 'country', 'pais', 'tvgCountry')).trim(),
                idioma: String(pega(o, 'language', 'idioma', 'lang', 'tvgLanguage')).trim(),
                headers: Object.assign({}, o.headers || {}, o.userAgent || o.user_agent ? { 'User-Agent': o.userAgent || o.user_agent } : {}, o.referer || o.referrer ? { Referer: o.referer || o.referrer } : {}),
                lista: dadosDaLista(o) || undefined,
                generosLista: (() => { const g = o.genre || o.genres || o.generos; return g ? [].concat(g).map(String).filter(Boolean) : undefined; })()   // 🎭 gênero que a lista trouxe (só para filtrar)
            });
            const ult = canais[canais.length - 1];
            if (!ult.lista) delete ult.lista;
            else if (ult.lista.serie && !/\bS\d+\s*E\d+/i.test(ult.nome) && ult.lista.episodio != null)   // episódio sem "S01E01" no nome: o nome ganha o padrão
                ult.nome = `${ult.lista.serie} S${String(ult.lista.temporada || 1).padStart(2, '0')}E${String(ult.lista.episodio).padStart(2, '0')}${ult.nome && norm(ult.nome) !== norm(ult.lista.serie) ? ' ' + ult.nome : ''}`;
        });
        return { canais, epg: '' };
    }

    /** Qualquer texto (TXT, página copiada, conversa): cada link vira um canal; "Nome, link" ou "Nome | link" aproveita o nome. */
    function lerTexto(texto) {
        const canais = [];
        const vistos = new Set();
        String(texto || '').split(/\r?\n/).forEach((linha) => {
            const re = /\b((?:https?|rtmpe?|rtsp|rtp|udp|srt|mms):\/\/[^\s"'<>`]+|magnet:\?[^\s"'<>`]+)/gi;
            let m, fimAnterior = 0;
            while ((m = re.exec(linha))) {
                const url = m[1].replace(/[),.;]+$/, '');
                // o nome é o texto ENTRE o link anterior e este ("Nome, link" / "Nome | link"); curto demais não vale
                const antes = linha.slice(fimAnterior, m.index).replace(/[\s,;|:=\-–>]+$/, '').replace(/^[\s#*\-•\d.)]+/, '').trim();
                fimAnterior = m.index + m[0].length;
                if (vistos.has(url)) continue;
                vistos.add(url);
                canais.push({ nome: antes.length >= 3 && antes.length <= 80 ? antes : '', url, headers: {} });
            }
        });
        return { canais, epg: '' };
    }

    /** O texto baixado é o PRÓPRIO stream HLS (master ou pedaços), não uma lista de canais? */
    function ehStreamHLS(texto) {
        const t = String(texto || '');
        if (!/#EXT-X-(STREAM-INF|TARGETDURATION|MEDIA-SEQUENCE|MEDIA:|KEY|ENDLIST)/i.test(t)) return false;
        return !/#EXTINF:\s*-1|tvg-(id|name|logo)=|group-title=/i.test(t);
    }

    /** Link que é um canal (stream/arquivo/protocolo), e não uma lista para baixar. .m3u8 só se confirma pelo conteúdo. */
    function ehLinkDeCanal(url) {
        return ['mpegts', 'dash', 'flv', 'arquivo', 'torrent', 'protocolo', 'youtube'].includes(formatoDe(url));
    }

    /** Nome legível tirado do próprio link: pula pedaços genéricos (index, playlist, live, hls, números...). */
    function nomeDoLink(url) {
        let u; try { u = new URL(url); } catch (e) { return String(url || "").slice(0, 40) || "Canal"; }
        const gen = /^(index|playlist|master|chunklist|chunks?|mono|live|hls|stream|streams|tracks?|video|v\d|play|manifest|output|media|\d+p?|[0-9a-f]{16,}|[a-z0-9_-]{24,})$/i;
        const partes = u.pathname.split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } })
            .map(x => x.replace(/\.(m3u8?|ts|mpd|flv|mp4|mkv|webm|php)$/i, '')).filter(x => x && !gen.test(x));
        const ehIP = /^[\d.:[\]]+$/.test(u.hostname);
        const bruto = partes.pop() || (ehIP ? 'Canal ' + u.hostname.split('.').pop() + (u.port ? ' ' + u.port : '') : u.hostname.replace(/^(www|cdn\d*|live\d*|stream\d*|hls\d*)\./i, '').split('.')[0]);
        const limpo = bruto.replace(/[_\-.]+/g, ' ').trim();
        return limparNome(limpo === limpo.toLowerCase() ? limpo.toUpperCase() : limpo) || 'Canal';   // "tv-cultura" → "Tv Cultura" (siglas curtas ficam: "TV")
    }

    /** Um canal só, a partir de um link solto. */
    function canalDoLink(url, nome, origem = '') {
        return completar({ nome: nome || nomeDoLink(url), url: String(url).trim(), headers: {}, origem, ordem: 0 });
    }

    /** Descobre o formato pelo conteúdo e lê. origem = nome da lista (vai em cada canal). */
    function lerLista(texto, origem = '') {
        const t = String(texto || '').replace(/^﻿/, '').trimStart();
        let r = null, formato = 'texto';
        if (/^#EXTM3U|^#EXTINF/i.test(t)) { r = lerM3U(t); formato = 'm3u'; }
        else if (t[0] === '[' || t[0] === '{') { r = lerJSON(t); formato = 'json'; }
        if (!r || !r.canais.length) { const x = lerTexto(t); if (!r || x.canais.length) { r = x; formato = r === x && formato === 'json' ? 'texto' : formato; } }
        if (formato !== 'm3u' && /#EXTINF/i.test(t) && !r.canais.some(c => c.tvgId || c.grupo)) { r = lerM3U(t); formato = 'm3u'; }
        const canais = r.canais.map((c, i) => completar(Object.assign({}, c, { origem, ordem: i })));
        return { formato, canais, epg: r.epg || '' };
    }

    // ------------------------------------------------------------------
    // Limpar e descobrir
    // ------------------------------------------------------------------
    const TAGS_NOME = /\s*(\[[^\]]*\]|\((?:[^)]*\b(?:hd|fhd|uhd|sd|4k|h265|hevc|backup|alt|opcao|op\d|br|pt|us|es)\b[^)]*)\))\s*/gi;
    const QUALI = /\b(full ?hd|fhd|uhd|hd|sd|4k|8k|h\.?265|hevc|720p|1080p|2160p|480p|360p|backup|alt|alternativo|op[cç][aã]o\s*\d*|\d+fps)\b/gi;

    /** "GLOBO SP FHD [BR] (backup)" → "Globo SP" */
    function limparNome(n) {
        let s = String(n || '').replace(TAGS_NOME, ' ').replace(QUALI, ' ').replace(/[|•●◉★☆✪]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/[\s\-–:]+$/, '').trim();
        if (s && s === s.toUpperCase() && /[A-Z]{3}/.test(s)) {           // tudo maiúsculo: "CARTOON NETWORK" → "Cartoon Network"
            // siglas curtas (SP, TV, SBT, HBO) continuam maiúsculas; palavras comuns curtas não
            const PEQ = /^(de|da|do|das|dos|e|the|of|and|la|el|los|las|en|y|on|in|a|o|tu|mi|my|one|two|kid|kids|mix|max|net|fox|gol|sur)$/i;
            s = s.split(/(\s+|\/)/).map(w => (/^[A-Z0-9&+]{1,3}$/.test(w) && !PEQ.test(w)) ? w : w.charAt(0) + w.slice(1).toLowerCase()).join('');
        }
        return s;
    }
    /** Qualidade dita no nome ou no link. */
    function qualidadeDe(c) {
        const t = (c.nome || '') + ' ' + (c.url || '');
        return /\b(4k|uhd|2160p)\b/i.test(t) ? '4K' : /\b(fhd|full ?hd|1080p)\b/i.test(t) ? 'FHD' : /\b(hd|720p)\b/i.test(t) ? 'HD' : /\b(sd|480p|360p)\b/i.test(t) ? 'SD' : '';
    }

    const PAISES_TAG = { br: 'BR', bra: 'BR', brasil: 'BR', brazil: 'BR', pt: 'PT', por: 'PT', portugal: 'PT', us: 'US', usa: 'US', uk: 'GB', gb: 'GB', es: 'ES', esp: 'ES', espana: 'ES', mx: 'MX', mex: 'MX', mexico: 'MX', ar: 'AR', arg: 'AR', argentina: 'AR', co: 'CO', col: 'CO', cl: 'CL', pe: 'PE', fr: 'FR', de: 'DE', it: 'IT', jp: 'JP', latino: 'LAT', latam: 'LAT', ao: 'AO', mz: 'MZ' };
    const IDIOMA_DO_PAIS = { BR: 'pt-BR', PT: 'pt-PT', AO: 'pt-AO', MZ: 'pt-MZ', US: 'en', GB: 'en', ES: 'es-ES', MX: 'es-MX', AR: 'es-AR', CO: 'es-CO', CL: 'es-CL', PE: 'es-PE', LAT: 'es', FR: 'fr', DE: 'de', IT: 'it', JP: 'ja' };
    const IDIOMAS_NOME = { portugues: 'pt', portuguese: 'pt', por: 'pt', pt: 'pt', 'pt-br': 'pt-BR', 'pt br': 'pt-BR', english: 'en', ingles: 'en', eng: 'en', en: 'en', espanol: 'es', spanish: 'es', espanhol: 'es', spa: 'es', es: 'es', frances: 'fr', french: 'fr', fr: 'fr', japones: 'ja', japanese: 'ja', ja: 'ja', italiano: 'it', italian: 'it', alemao: 'de', german: 'de' };

    /**
     * Idiomas para escolher na mão (código BCP-47 com região: é o que o Cloud/TVzine lê — "pt-BR" põe o canal no Brasil).
     * pais = país que vai junto no tvg-country ('' = idioma sem país: o canal fica em Categorias/Global).
     */
    const IDIOMAS = [
        ['pt-BR', 'Português (Brasil)', 'BR'], ['pt-PT', 'Português (Portugal)', 'PT'], ['pt-AO', 'Português (Angola)', 'AO'], ['pt-MZ', 'Português (Moçambique)', 'MZ'],
        ['es-MX', 'Espanhol (México)', 'MX'], ['es-AR', 'Espanhol (Argentina)', 'AR'], ['es-ES', 'Espanhol (Espanha)', 'ES'], ['es-CO', 'Espanhol (Colômbia)', 'CO'],
        ['es-CL', 'Espanhol (Chile)', 'CL'], ['es-PE', 'Espanhol (Peru)', 'PE'], ['es-US', 'Espanhol (EUA)', 'US'], ['es', 'Espanhol (Latino, sem país)', ''],
        ['en-US', 'Inglês (EUA)', 'US'], ['en-GB', 'Inglês (Reino Unido)', 'GB'], ['en-CA', 'Inglês (Canadá)', 'CA'], ['en-AU', 'Inglês (Austrália)', 'AU'], ['en', 'Inglês (sem país)', ''],
        ['fr-FR', 'Francês (França)', 'FR'], ['fr-CA', 'Francês (Canadá)', 'CA'], ['it-IT', 'Italiano', 'IT'], ['de-DE', 'Alemão', 'DE'], ['nl-NL', 'Holandês', 'NL'],
        ['ja-JP', 'Japonês', 'JP'], ['ko-KR', 'Coreano', 'KR'], ['zh-CN', 'Chinês', 'CN'], ['ru-RU', 'Russo', 'RU'], ['ar', 'Árabe (sem país)', ''],
        ['tr-TR', 'Turco', 'TR'], ['pl-PL', 'Polonês', 'PL'], ['hi-IN', 'Hindi', 'IN'], ['pt', 'Português (sem país)', '']
    ].map(([cod, nome, pais]) => ({ cod, nome, pais }));

    /** Troca o idioma (e o país junto) de um canal escolhido na mão. Devolve o canal. */
    function definirIdioma(c, cod, paisJunto = true) {
        const op = IDIOMAS.find(i => i.cod === cod);
        c.idioma = cod || '';
        if (paisJunto && op) c.pais = op.pais;
        c.idiomaManual = true;
        c.chave = chaveDe(c);
        return c;
    }

    // ---------------------------------------------------------------- EPG (guia de programação, XMLTV)
    // chavesEPG() é a MESMA comparação do Cloud (tools/epg-pronto.mjs) e do app (tvzine-epg-engine):
    // o canal que casar aqui casa igual no TVzine.
    const RUIDO_EPG = /\b(hd|fhd|uhd|sd|4k|8k|h265|hevc|720p|1080p|2160p|60fps|50fps|ao vivo|live|oficial|alt|backup|reserva|sinal|opcao \d)\b/g;
    function nomeEPG(bruto) {
        let s = String(bruto || '');
        if (s.includes('..')) s = s.split('..').pop();
        s = s.replace(/@[\w-]+$/, '').replace(/\.[a-z]{2}$/i, '');
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        s = s.replace(/&/g, ' and ').replace(/\+/g, ' plus ');
        s = s.replace(/[._\-\/|:]+/g, ' ').replace(/[\[(][^\])]*[\])]/g, ' ');
        s = s.replace(RUIDO_EPG, ' ');
        return s.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    }
    function chavesEPG(bruto) {
        const base = nomeEPG(bruto);
        if (!base) return [];
        const out = new Set([base.replace(/ /g, '')]);
        const semTv = base.replace(/^tv /, '').replace(/ tv$/, '');
        const semPais = base.replace(/ (brasil|brazil|br)$/, '');
        out.add(semTv.replace(/ /g, '')); out.add(semPais.replace(/ /g, '')); out.add(semPais.replace(/^tv /, '').replace(/ /g, ''));
        out.delete('');
        return [...out];
    }
    const ENT_XML = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    function textoXML(s) {
        return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
            if (e[0] === '#') { try { return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); } catch (x) { return m; } }
            return ENT_XML[e.toLowerCase()] != null ? ENT_XML[e.toLowerCase()] : m;
        }).trim();
    }
    const attrXML = (t, nome) => { const m = new RegExp('\\b' + nome + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')').exec(t); return m ? textoXML(m[2] !== undefined ? m[2] : m[3]) : ''; };
    /** Hora do XMLTV ("20261118023000 +0000") em ms. */
    function dataXMLTV(str) {
        const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])?(\d{2})?:?(\d{2})?/.exec(String(str || '').trim());
        if (!m) return 0;
        let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
        if (m[7]) ms -= (m[7] === '-' ? -1 : 1) * ((+m[8]) * 60 + (+(m[9] || 0))) * 60000;
        return ms;
    }
    /** Canais de um pedaço de XMLTV: [{ id, nomes, icone, pais }]. pais = final do id ("Globo.br" → BR). */
    function canaisXMLTV(texto) {
        const out = [];
        const re = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
        let m;
        while ((m = re.exec(texto))) {
            const id = attrXML(m[1], 'id');
            if (!id) continue;
            const nomes = [];
            const rn = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g; let n;
            while ((n = rn.exec(m[2]))) { const t = textoXML(n[1]); if (t && !nomes.includes(t)) nomes.push(t); }
            const ic = /<icon\b([^>]*)\/?>/.exec(m[2]);
            const pm = /\.([a-z]{2})(@[\w-]+)?$/i.exec(id);
            out.push({ id, nomes, icone: ic ? attrXML(ic[1], 'src') : '', pais: pm ? pm[1].toUpperCase() : '' });
        }
        return out;
    }
    /** Programas de um pedaço de XMLTV, só dos ids pedidos e na janela [de, ate]: Map id → [[ini, fim, titulo, desc]]. */
    function programasXMLTV(texto, ids, de, ate, mapa = new Map()) {
        const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
        let m;
        while ((m = re.exec(texto))) {
            const id = attrXML(m[1], 'channel');
            if (ids && !ids.has(id)) continue;
            const ini = dataXMLTV(attrXML(m[1], 'start')), fim = dataXMLTV(attrXML(m[1], 'stop')) || ini + 3600000;
            if (fim < de || ini > ate) continue;
            const t = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(m[2]), d = /<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
            const a = mapa.get(id) || []; a.push([ini, fim, t ? textoXML(t[1]) : '', d ? textoXML(d[1]).slice(0, 240) : '']); mapa.set(id, a);
        }
        return mapa;
    }
    /**
     * Canais dos guias que combinam com este canal. indice = [{ guia, id, nomes, icone, pais }].
     * mesmo tvg-id = 100 · mesmas chaves do nome (igual ao Cloud) = 70 (+15 mesmo país) · nome parecido = 30.
     */
    function acharNoGuia(indice, c, max = 20) {
        const tid = String(c.tvgId || '').toLowerCase();
        const minhas = new Set(chavesEPG(c.nome).concat(c.tvgId ? chavesEPG(c.tvgId) : []));
        const base = nomeEPG(c.nome);
        const r = [];
        for (const g of indice) {
            let p = 0;
            if (tid && g.id.toLowerCase() === tid) p = 100;
            else if ([g.id].concat(g.nomes).some(n => chavesEPG(n).some(k => minhas.has(k)))) p = 70;
            else if (base.length >= 3 && g.nomes.some(n => { const x = nomeEPG(n); return x && (x.startsWith(base + ' ') || base.startsWith(x + ' ')); })) p = 30;
            if (!p) continue;
            if (c.pais && g.pais === c.pais) p += 15; else if (c.pais && g.pais && p < 100) p -= 20;
            r.push({ pontos: p, canal: g });
        }
        return r.sort((a, b) => b.pontos - a.pontos).slice(0, max);
    }
    /** Liga o canal a um canal do guia (o tvg-id passa a ser o id do guia: é por ele que o Cloud/TVzine acha a programação). */
    function ligarGuia(c, g, shift) {
        if (!g) { delete c.epgId; delete c.epgGuia; if (c.tvgIdOriginal != null) { c.tvgId = c.tvgIdOriginal; delete c.tvgIdOriginal; } c.chave = chaveDe(c); return c; }
        if (c.tvgIdOriginal == null) c.tvgIdOriginal = c.tvgId || '';
        c.tvgId = g.id; c.epgId = g.id; c.epgGuia = g.guia;
        if (shift != null) c.epgShift = shift;
        c.chave = chaveDe(c);
        return c;
    }
    /** Guias que a lista usa (vão no url-tvg do topo da M3U). */
    function guiasDaLista(canais, extra) {
        const out = [];
        [].concat(extra || []).concat(canais.map(c => c.epgGuia)).forEach(u => { String(u || '').split(',').map(x => x.trim()).forEach(x => { if (/^https?:\/\//i.test(x) && !out.includes(x)) out.push(x); }); });
        return out;
    }

    /**
     * Categorias padrão do Cartoonzine/TVzine: viram o group-title da lista exportada, que é a categoria
     * que o Cloud usa no app. Nome sempre igual = o app fica organizado (nada de "KIDS", "Infantis", "INFANTIL").
     */
    // a lista oficial fica no studio.config.json (categoriasCanais); o painel troca esta pela de lá (usarCategorias)
    const CATEGORIAS = ['TV Aberta', 'Notícias', 'Esportes', 'Infantil', 'Filmes e Séries', 'Documentários', 'Variedades', 'Música', 'Religioso', '24 Horas', 'Culinária', 'Educativo'];
    // não são categorias do TVzine: mandam o canal para OUTRA coleção do Studio (Desenhos 24H, Rádios)
    const DESTINOS_ESPECIAIS = ['Desenhos 24H', 'Rádios'];
    // nomes de outras listas → o nome oficial do TVzine ("Filmes e Séries" = canais ao vivo de filmes/séries)
    const APELIDOS_CAT = { abertos: 'TV Aberta', 'tv aberta': 'TV Aberta', 'canais abertos': 'TV Aberta', religiosos: 'Religioso', gospel: 'Religioso', evangelicos: 'Religioso', catolicos: 'Religioso',
        educativos: 'Educativo', '24 horas': '24 Horas', '24h': '24 Horas', filmes: 'Filmes e Séries', series: 'Filmes e Séries', 'filmes series': 'Filmes e Séries', cinema: 'Filmes e Séries',
        kids: 'Infantil', infantis: 'Infantil', criancas: 'Infantil', noticias: 'Notícias', news: 'Notícias', esporte: 'Esportes', sports: 'Esportes', musica: 'Música', music: 'Música',
        documentario: 'Documentários', documentarios: 'Documentários', variedade: 'Variedades', entretenimento: 'Variedades', novelas: 'Variedades', culinaria: 'Culinária',
        'desenhos 24 horas': 'Desenhos 24H', 'desenhos 24h': 'Desenhos 24H', radios: 'Rádios', radio: 'Rádios' };
    const oficial = (cat) => { const n = norm(cat); return CATEGORIAS.concat(DESTINOS_ESPECIAIS).find(k => norm(k) === n) || APELIDOS_CAT[n] || ''; };
    function usarCategorias(lista) { if (Array.isArray(lista) && lista.length) CATEGORIAS.splice(0, CATEGORIAS.length, ...lista); }
    const CAT_DO_TIPO = { Infantil: 'Infantil', Anime: 'Infantil', Filmes: 'Filmes e Séries', Séries: 'Filmes e Séries', Esportes: 'Esportes', Notícias: 'Notícias',
        Documentários: 'Documentários', Música: 'Música', Religioso: 'Religioso', Abertos: 'TV Aberta', '24 horas': '24 Horas' };
    /** Categoria sugerida: o grupo da lista já é uma padrão? senão, pelo tipo descoberto. '' = sem palpite. */
    function categoriaSugerida(c) {
        const g = norm(c.grupo).replace(/^[a-z]{2}\s*[|:\-–]\s*/, '');
        const igual = oficial(g);
        if (igual) return igual;
        if (/\b(gospel|evangel)/.test(g + ' ' + norm(c.nome))) return 'Religioso';
        if (/\b(desenho|cartoon|toon)/.test(g) && /\b24\s?h|24 horas/.test(g + ' ' + norm(c.nome))) return 'Desenhos 24H';
        if (/\b(culinaria|gastronom|food)/.test(g)) return 'Culinária';
        if (/\b(radio|fm\b)/.test(g)) return 'Rádios';
        const t = CAT_DO_TIPO[c.tipo] || '';
        return t && (CATEGORIAS.includes(t) ? t : oficial(t));
    }
    /** Categoria escolhida (vai no group-title da lista exportada). '' tira e volta ao grupo original. */
    function definirCategoria(c, cat) {
        if (cat) { c.grupoSaida = oficial(cat) || String(cat).trim(); c.categoriaManual = true; } else { delete c.grupoSaida; delete c.categoriaManual; }
        return c;
    }

    // ---------------------------------------------------------------- IMPORTADOR: lista do Link Edit → coleções do Studio
    // idioma do Link Edit (pt-BR, es-MX…) → o nome que o Studio usa ("Português", "Espanhol"…)
    const IDIOMA_STUDIO = { pt: 'Português', 'pt-br': 'Português', 'pt-pt': 'Português (Portugal)', 'pt-ao': 'Português (Portugal)', 'pt-mz': 'Português (Portugal)',
        es: 'Espanhol', en: 'Inglês', fr: 'Francês', it: 'Italiano', de: 'Alemão', ja: 'Japonês', ko: 'Coreano', zh: 'Chinês', ru: 'Russo', ar: 'Árabe',
        hi: 'Hindi', nl: 'Holandês', tr: 'Turco', pl: 'Polonês' };
    function idiomaStudio(cod) {
        const k = String(cod || '').toLowerCase();
        return IDIOMA_STUDIO[k] || IDIOMA_STUDIO[k.split('-')[0]] || '';
    }
    const categoriaDe = (it) => it.grupoSaida || categoriaSugerida(it) || '';
    /** Coleção do Studio para onde o item vai (id) — '' = fica de fora (ex.: filme/série em arquivo: importador de filmes). */
    function destinoPadrao(it, colecoes) {
        const de = (tipo) => colecoes.filter(c => c.tipo === tipo);
        const cat = categoriaDe(it);
        if (cat === 'Rádios') return (de('radio')[0] || {}).id || '';      // rádio é stream de áudio (.mp3/.aac): vem antes do "arquivo"
        if (it.formato === 'arquivo' || it.formato === 'torrent') return '';
        if (cat === 'Desenhos 24H' || cat === '24 Horas' && it.tipo === 'Infantil') {
            const h = de('canal24h');
            const yt = it.formato === 'youtube' && h.find(c => c.id === 'youtoon');
            return (yt || h.find(c => c.id === 'desenhos-24h') || h[0] || {}).id || '';
        }
        if (it.formato === 'youtube') return (de('canal24h').find(c => c.id === 'youtoon') || {}).id || '';
        return (de('canal')[0] || {}).id || '';
    }
    /** O item no formato do Studio (antes do normalizarItem). */
    function itemParaStudio(it, col) {
        const links = [it.url].concat((it.reservas || []).map(r => (typeof r === 'string' ? r : r && r.url))).filter(Boolean);
        const h = it.headers || {};
        const o = { nome: it.nome, links, logo: it.logo || undefined };
        const idi = idiomaStudio(it.idioma);
        if (col.tipo === 'canal') Object.assign(o, { pais: it.pais || undefined, idioma: idi || undefined, categoria: categoriaDe(it) || undefined, tvgId: it.tvgId || undefined, epg: it.epgGuia || undefined, userAgent: h['User-Agent'], referer: h.Referer });
        else if (col.tipo === 'canal24h') Object.assign(o, { idioma: idi || undefined });
        else if (col.tipo === 'radio') Object.assign(o, { pais: it.pais || undefined, idioma: idi || undefined });
        Object.keys(o).forEach(k => o[k] === undefined && delete o[k]);
        return o;
    }
    /**
     * Plano da importação (nada é gravado aqui). C = StudioCore.
     * opts: { config, caminhos (Set dos arquivos que já existem), destinos (Map id→colecao), paisPadrao, soVivos, rascunho }
     * → [{ it, col, item, caminho, acao: 'novo'|'juntar'|'erro'|'fora', erros, avisos, motivo }]
     */
    function planejarImportacao(itens, C, opts = {}) {
        const config = opts.config || {}, cols = (config.colecoes || []).filter(c => ['canal', 'canal24h', 'radio'].includes(c.tipo));
        const caminhos = opts.caminhos || new Set(), destinos = opts.destinos || new Map();
        const noLote = new Map();
        return itens.map((it) => {
            const vivo = !it.teste || ['vivo', 'lento', 'pede-ua'].includes(it.teste.status);
            const colId = destinos.has(it.id) ? destinos.get(it.id) : destinoPadrao(it, cols);
            const col = cols.find(c => c.id === colId);
            if (!col) return { it, acao: 'fora', motivo: it.formato === 'arquivo' ? 'filme/série em arquivo: vai no importador de filmes' : 'sem destino', erros: [], avisos: [] };
            if (opts.soVivos && !vivo) return { it, col, acao: 'fora', motivo: 'não está vivo no último teste', erros: [], avisos: [] };
            const bruto = itemParaStudio(it, col);
            if (col.tipo !== 'canal24h' && !bruto.pais && opts.paisPadrao) bruto.pais = opts.paisPadrao;
            if (opts.rascunho) bruto._rascunho = true;
            const item = C.normalizarItem(bruto, col);
            const { erros, avisos } = C.validarItem(item, col, config);
            const caminho = C.caminhoItem(col, item);
            const r = { it, col, item, caminho, erros, avisos };
            if (erros.length && !opts.rascunho) r.acao = 'erro';
            else if (noLote.has(caminho)) { r.acao = 'mesmo'; r.motivo = 'mesmo canal de outra linha: entra como reserva dele'; noLote.get(caminho).extras.push(item); }
            else { r.acao = caminhos.has(caminho) ? 'juntar' : 'novo'; r.extras = []; noLote.set(caminho, r); }
            return r;
        });
    }
    // ---------------------------------------------------------------- IMPORTADOR de FILMES e SÉRIES (VOD)
    /** É filme/episódio (arquivo, torrent, VOD do Xtream) e não canal ao vivo? */
    function ehVOD(it) {
        const f = it.formato || formatoDe(it.url);
        return f === 'arquivo' || f === 'torrent' || /\/(movie|movies|series|vod)\//i.test(it.url || '');
    }
    const chaveTitulo = (C, item) => C.normText(item.nome) + '|' + (item.temporadas ? 'serie' : (item.ano || ''));
    /** Coleção de vídeo pelo jeito do item: torrent → coleção torrent · anime → Animes · desenho/infantil → Cartoons · série → Séries · resto → Filmes. */
    function destinoVOD(item, dica, cols) {
        const id = (x) => (cols.find(c => c.id === x) || {}).id;
        const n = norm(dica);
        const torrent = (item.links || []).concat(...(item.temporadas || []).flatMap(t => t.episodios.map(e => e.links || []))).some(u => /^magnet:|\.torrent(\?|$)/i.test(u));
        if (torrent && !item.temporadas) return (cols.find(c => c.torrent) || {}).id || id('filmes') || '';
        if (/\banime/.test(n)) return id('animes') || '';
        if (/\b(desenho|cartoon|infantil|kids|animac|toon)/.test(n)) return id('cartoons') || '';
        if (item.temporadas && item.temporadas.length) return id('series') || '';
        return id('filmes') || (cols[0] || {}).id || '';
    }
    /**
     * Filmes e séries da lista → itens do Studio. Episódios ("Naruto S01E03", "1x03", "Episódio 3") viram UMA série
     * com temporadas; cópias do mesmo filme (mesmo nome + ano) viram UM item com as outras como reserva.
     * opts: { config, indice:[{caminho,nome}], destinos: Map(chave → coleção), rascunho, dados: Map(chave → item completado no TMDB) }
     * → [{ chave, item, col, caminho, acao: 'novo'|'juntar'|'erro'|'fora', erros, avisos, copias, eps }]
     */
    function planejarVOD(itens, C, opts = {}) {
        const config = opts.config || {}, cols = (config.colecoes || []).filter(c => c.tipo === 'video');
        const dicas = new Map(), quals = new Map(), auds = new Map();
        const preferida = new Map();                       // coleção escolhida no painel (c.video.colecao)
        const entradas = itens.map((it) => {
            let a = C.analisarNome(it.nomeOriginal || it.nome);
            if (it.video && it.videoManual) {                  // o que você editou no painel vence o que o nome diz
                const v = it.video;
                a = it.natureza === 'episodio'
                    ? Object.assign({}, a, { nome: v.serie || a.nome, serie: v.serie || a.serie, temporada: v.temporada != null ? v.temporada : a.temporada, episodio: v.episodio != null ? v.episodio : a.episodio, tituloEpisodio: v.titulo || a.tituloEpisodio, ano: v.ano || a.ano })
                    : { nome: v.titulo || a.nome, ano: v.ano || a.ano, audio: a.audio };
                if (v.audio) a.audio = v.audio === 'dual' ? 'Dual Áudio' : v.audio === 'dublado' ? 'Dublado' : v.audio === 'legendado' ? 'Legendado' : a.audio;
            }
            if (it.video && it.video.colecao) preferida.set(C.normText(a.serie || a.nome), it.video.colecao);
            // qualidade e áudio de cada cópia (pelo nome e pelo teste): o título fica com a melhor e com todos os áudios
            const kq = C.normText(a.serie || a.nome);
            const q = (it.teste && it.teste.resolucao && (+String(it.teste.resolucao).split('x')[1] >= 2000 ? '4K' : +String(it.teste.resolucao).split('x')[1] >= 1000 ? 'FHD' : +String(it.teste.resolucao).split('x')[1] >= 700 ? 'HD' : 'SD'))
                || (C.qualidadeDoTexto && (C.qualidadeDoTexto(it.nomeOriginal || it.nome) || C.qualidadeDoTexto(it.url))) || '';
            if (q) quals.set(kq, (quals.get(kq) || []).concat(q));
            const au = /dual/i.test(a.audio || '') ? ['dublado', 'legendado'] : /dub/i.test(a.audio || '') ? ['dublado'] : /leg/i.test(a.audio || '') ? ['legendado'] : [];
            if (au.length) auds.set(kq, [...new Set((auds.get(kq) || []).concat(au))]);
            const links = [it.url].concat((it.reservas || []).map(r => (typeof r === 'string' ? r : r && r.url))).filter(Boolean);
            const e = Object.assign({}, a, { links, capa: it.logo || undefined });
            const k = C.normText(a.serie || a.nome);
            if (!dicas.has(k)) dicas.set(k, [it.grupoSaida, it.grupo, it.tipo].filter(Boolean).join(' '));
            return e;
        });
        // séries agrupadas pelo Studio; filmes repetidos juntados aqui (cópias = reserva)
        const porChave = new Map();
        C.agruparEntradas(entradas, { series: true }).forEach((item) => {
            const k = chaveTitulo(C, item);
            const ja = porChave.get(k);
            if (ja) { ja.item = C.mesclarItem(ja.item, item); ja.copias++; } else porChave.set(k, { item, copias: 1 });
        });
        const indice = opts.indice || [], usados = new Set(indice.map(i => i.caminho));
        const QS = ['4K', 'FHD', 'HD', 'SD'];
        // dados do TMDB já buscados + qualidade/áudios; depois junta quem tem o MESMO código do TMDB ("Matrix" = "The Matrix")
        const linhas = [];
        const porTmdb = new Map();
        for (const [chave, { item: bruto, copias }] of porChave.entries()) {
            let item0 = opts.dados && opts.dados.get(chave) ? C.mesclarItem(opts.dados.get(chave), bruto) : bruto;
            const kq = C.normText(bruto.nome);
            const q = QS.find(x => (quals.get(kq) || []).includes(x));
            if (q && !item0.qualidade) item0 = Object.assign({}, item0, { qualidade: q });
            if (auds.get(kq)) item0 = Object.assign({}, item0, { audios: [...new Set((item0.audios || []).concat(auds.get(kq)))] });
            const ja = item0.tmdb && porTmdb.get(item0.tmdb);
            if (ja) {
                const aus = [...new Set((ja.item0.audios || []).concat(item0.audios || []))], qs = [ja.item0.qualidade, item0.qualidade];
                ja.item0 = Object.assign(C.mesclarItem(ja.item0, item0), aus.length ? { audios: aus } : {}, QS.find(x => qs.includes(x)) ? { qualidade: QS.find(x => qs.includes(x)) } : {});
                ja.copias += copias; ja.juntou = (ja.juntou || []).concat(bruto.nome); continue;
            }
            const l = { chave, bruto, item0, copias };
            if (item0.tmdb) porTmdb.set(item0.tmdb, l);
            linhas.push(l);
        }
        return linhas.map(({ chave, bruto, item0, copias, juntou }) => {
            const pref = preferida.get(C.normText(bruto.nome)) || preferida.get(C.normText(item0.nome));
            const colId = opts.destinos && opts.destinos.has(chave) ? opts.destinos.get(chave) : (pref && cols.some(c => c.id === pref) ? pref : destinoVOD(item0, dicas.get(C.normText(item0.nome)) || dicas.get(C.normText(bruto.nome)) || '', cols));
            const col = cols.find(c => c.id === colId);
            const eps = C.contarEpisodios(item0);
            if (!col) return { chave, item: item0, acao: 'fora', motivo: 'sem destino', erros: [], avisos: [], copias, eps };
            if (opts.rascunho) item0 = Object.assign({}, item0, { _rascunho: true });
            const item = C.normalizarItem(item0, col);
            const { erros, avisos } = C.validarItem(item, col, config);
            // já existe nessa coleção (mesmo nome)? junta nele
            const alvo = C.normText(item.nome);
            const daCol = (i) => i.caminho.startsWith('conteudo/' + col.id + '/');
            // já existe? primeiro pelo código do TMDB (exato), depois pelo nome
            const existe = (item.tmdb && indice.find(i => daCol(i) && i.tmdb === item.tmdb)) || indice.find(i => daCol(i) && C.normText(i.nome) === alvo);
            let caminho;
            if (existe) caminho = existe.caminho;
            else {
                const base = C.caminhoItem(col, item), pasta = base.slice(0, base.lastIndexOf('/') + 1);
                const nomes = new Set([...usados].filter(c => c.startsWith(pasta)).map(c => c.slice(pasta.length).replace(/\.json$/, '')));
                caminho = C.caminhoItem(col, item, C.slugLivre(C.slugify(item.nome), nomes));
            }
            usados.add(caminho);
            if (juntou) avisos.push('mesmo filme no TMDB: juntou com ' + juntou.join(', '));
            return { chave, item, col, caminho, erros, avisos, copias, eps, acao: erros.length && !opts.rascunho ? 'erro' : existe ? 'juntar' : 'novo' };
        });
    }

    // ---------------------------------------------------------------- RECEITAS (listas que se refazem sozinhas)
    /**
     * Receita = de onde pegar + que canais entram + como arrumar. O robô do GitHub (tools/receitas.mjs) refaz a cada
     * 6 h com o teste do dia: canal que morreu sai, reserva viva assume. O painel usa as mesmas funções ("Rodar agora").
     * { id, nome, listas:[url], idiomas:['pt-BR'], tipos:['Infantil'], paises:['BR'], categorias:[], excluirTipos:['Adulto'],
     *   soVivos:true, confiancaMin:0..10, busca:'', formato:'m3u'|'json', ativo:true }
     */
    function receitaPadrao(extra) {
        return Object.assign({ id: '', nome: 'Receita nova', listas: [], idiomas: [], tipos: [], paises: [], categorias: [], excluirTipos: ['Adulto'],
            soVivos: true, confiancaMin: 0, busca: '', formato: 'm3u', ativo: true }, extra || {});
    }
    const VIVO_RECEITA = (st) => st === 'vivo' || st === 'lento' || st === 'pede-ua' || st === 'bloqueado';   // bloqueado no robô pode ser só o país do servidor
    /** O canal entra na receita? (antes do teste) */
    function passaReceita(c, r) {
        const has = (a) => Array.isArray(a) && a.length;
        if (has(r.excluirTipos) && r.excluirTipos.includes(c.tipo)) return false;
        if (has(r.idiomas) && !r.idiomas.some(k => c.idioma === k || (k.length === 2 && String(c.idioma || '').split('-')[0] === k))) return false;
        if (has(r.tipos) && !r.tipos.includes(c.tipo)) return false;
        if (has(r.paises) && !r.paises.includes(c.pais)) return false;
        if (has(r.categorias)) { const cat = c.grupoSaida || categoriaSugerida(c); if (!r.categorias.includes(cat)) return false; }
        if (r.busca && !norm([c.nome, c.grupo, c.tvgId].join(' ')).includes(norm(r.busca))) return false;
        return true;
    }
    /** Confiança 0..10 pelo histórico ([true,false,…], últimos 10 testes). null = nunca testado. */
    function confianca(hist) { return hist && hist.length ? Math.round(hist.filter(Boolean).length / hist.length * 10) : null; }
    /**
     * Monta a lista da receita: filtra, (se pedido) só vivos e confiáveis, junta as cópias (as outras viram reserva),
     * mais confiáveis primeiro. Cada canal precisa de .teste/.historico (do Link Edit ou do robô).
     */
    function montarReceita(canais, r) {
        let cs = canais.filter(c => passaReceita(c, r));
        if (r.soVivos) cs = cs.filter(c => c.teste && VIVO_RECEITA(c.teste.status));
        if (r.confiancaMin) cs = cs.filter(c => { const k = confianca(c.historico); return k == null || k >= r.confiancaMin; });
        const lista = agrupar(cs).map(g => {
            const c = canalComReservas(g);
            c.grupoSaida = c.grupoSaida || categoriaSugerida(c) || c.grupo;
            c._conf = Math.max(...[g.principal].concat(g.reservas).map(x => confianca(x.historico) || 0));
            return c;
        });
        return lista.sort((a, b) => b._conf - a._conf || (b.reservas.length - a.reservas.length) || String(a.nome).localeCompare(String(b.nome), 'pt'));
    }
    const idReceita = (nome) => norm(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'receita';

    // ================================================================ 🎬 VÍDEOS (filme / episódio) × CANAIS
    // Cada item ganha a NATUREZA: 'canal' (ao vivo), 'radio', 'filme' ou 'episodio' — descoberta sozinha pelo link e
    // pelo nome, e trocável na mão (c.naturezaManual). Vídeo ganha c.video: { titulo, serie, temporada, episodio,
    // ano, audio, qualidade, colecao } — o que o DB do Cartoonzine usa (Cloud: title/year/serie/season/episode/audios).
    const NATUREZAS = [['canal', '📺', 'Canal ao vivo'], ['filme', '🎬', 'Filme / vídeo'], ['episodio', '🎞', 'Episódio de série'], ['radio', '📻', 'Rádio']];
    const AUDIO_EXT = /\.(mp3|aac|m4a|ogg|opus|flac|wav)(\?|#|$)/i;
    /** Lê "Naruto S01E03 Dublado 1080p", "Pica-Pau 1x02", "Matrix (1999) [Leg]" → { titulo, serie, temporada, episodio, ano, audio, qualidade } */
    function analisarVideo(bruto, url) {
        let s = String(bruto || '').trim().replace(/\.(mp4|mkv|avi|mov|webm|m4v|ts|mpe?g|wmv|flv|m3u8)$/i, '');
        if (!/\s/.test(s) && /[._]/.test(s)) s = s.replace(/[._]+/g, ' ');
        const o = {};
        if (/\b(dual[ -]?(audio|áudio)|dual)\b/i.test(s)) o.audio = 'dual'; else if (/\b(dublado|dub|ptbr|pt-br|nacional)\b/i.test(s)) o.audio = 'dublado'; else if (/\b(legendado|leg|sub|subs)\b/i.test(s)) o.audio = 'legendado';
        o.qualidade = /\b(4k|uhd|2160p)\b/i.test(s) ? '4K' : /\b(fhd|full ?hd|1080p)\b/i.test(s) ? 'FHD' : /\b(hd|720p)\b/i.test(s) ? 'HD' : /\b(sd|480p|360p)\b/i.test(s) ? 'SD' : '';
        s = s.replace(/\[[^\]]*\]/g, ' ').replace(/\b(dual[ -]?(audio|áudio)|dublado|legendado|ptbr|pt-br|nacional|dub|leg|4k|uhd|2160p|fhd|full ?hd|1080p|720p|480p|360p|hd|sd|x26[45]|h\.?26[45]|hevc|web-?dl|webrip|bluray|brrip|hdtv|dvdrip)\b/gi, ' ').replace(/\s{2,}/g, ' ').trim();
        const P = [/^(.*?)[\s\-–_.]*\bS(\d{1,2})\s*[\s._-]?\s*E(\d{1,4})\b(.*)$/i, /^(.*?)[\s\-–_.]*\bT(\d{1,2})\s*[\s._-]?\s*E(\d{1,4})\b(.*)$/i,
            /^(.*?)[\s\-–_.]*\b(\d{1,2})x(\d{1,4})\b(.*)$/i, /^(.*?)[\s\-–_.]*\bTemporada\s*(\d{1,2})\D{0,6}Epis[oó]dio\s*(\d{1,4})\b(.*)$/i];
        for (const re of P) { const m = re.exec(s); if (m) { o.serie = m[1]; o.temporada = +m[2]; o.episodio = +m[3]; o.titulo = m[4]; break; } }
        if (o.episodio == null) { const m = /^(.*?)[\s\-–_.]*\b(?:Epis[oó]dio|Ep\.?|EP|Cap[ií]tulo|Cap\.?)\s*(\d{1,4})\b(.*)$/i.exec(s); if (m && m[1].trim()) { o.serie = m[1]; o.temporada = 1; o.episodio = +m[2]; o.titulo = m[3]; } }
        if (o.episodio == null && /\/series\//i.test(url || '')) { const m = /\/(\d{1,2})\/(\d{1,4})(?:\.\w+)?$/.exec(url); if (m) { o.temporada = +m[1]; o.episodio = +m[2]; } }
        const alvo = o.serie != null ? o.serie : s;
        const mAno = /[(\[]\s*((?:19|20)\d{2})\s*[)\]]|\s((?:19|20)\d{2})$/.exec(alvo);
        if (mAno) o.ano = +(mAno[1] || mAno[2]);
        const arrumar = (t) => String(t || '').replace(/[(\[]\s*(?:19|20)\d{2}\s*[)\]]/g, ' ').replace(/\s(?:19|20)\d{2}$/, ' ').replace(/^[\s\-–_.:|]+|[\s\-–_.:|]+$/g, '').replace(/\s{2,}/g, ' ').trim();
        if (o.serie != null) { o.serie = arrumar(o.serie); o.titulo = arrumar(o.titulo) || ''; }
        else o.titulo = arrumar(s) || String(bruto || '').trim();
        Object.keys(o).forEach(k => (o[k] === '' || o[k] == null) && delete o[k]);
        return o;
    }
    /** Natureza descoberta sozinha (a manual, se houver, vence). */
    function naturezaDe(c) {
        if (c.naturezaManual && c.natureza) return c.natureza;
        if (c.lista) {
            if (c.lista.serie || c.lista.episodio != null || /^tv\//.test(c.lista.tmdb || '')) return 'episodio';
            if (/^movie\//.test(c.lista.tmdb || '')) return 'filme';
        }
        const f = c.formato || formatoDe(c.url);
        if (AUDIO_EXT.test(c.url || '') || (c.grupoSaida || '') === 'Rádios' || /\b(radio|rádio|fm)\b/i.test(c.grupo || '') && f !== 'arquivo') return 'radio';
        const vod = f === 'arquivo' || f === 'torrent' || /\/(movie|movies|series|vod)\//i.test(c.url || '');
        if (!vod) return 'canal';
        const a = analisarVideo(c.nomeOriginal || c.nome, c.url);
        return a.episodio != null || /\/series\//i.test(c.url || '') ? 'episodio' : 'filme';
    }
    const ehVideo = (c) => c && (c.natureza === 'filme' || c.natureza === 'episodio');
    /** Coleção de vídeo sugerida: torrent → torrent · anime → Animes · desenho → Cartoons · episódio → Séries · resto → Filmes */
    function colecaoVideo(c, natureza) {
        const t = norm([c.grupoSaida, c.grupo, c.tipo, c.nome].join(' '));
        if (/^magnet:|\.torrent(\?|$)/i.test(c.url || '') && natureza !== 'episodio') return 'filmes-torrent';
        if (/\b(anime|animes|otaku|crunchy)/.test(t) || c.tipo === 'Anime') return 'animes';
        if (/\b(desenho|cartoon|infantil|kids|animac|toon)/.test(t) || c.tipo === 'Infantil') return 'cartoons';
        return natureza === 'episodio' ? 'series' : 'filmes';
    }
    /** Preenche natureza e dados de vídeo (o que você editou à mão fica). Devolve o item. */
    function detectarVideo(c, forcar) {
        if (forcar) { delete c.naturezaManual; delete c.videoManual; }
        c.natureza = naturezaDe(c);
        if (!ehVideo(c)) { if (!c.videoManual) delete c.video; return c; }
        if (c.videoManual && c.video) return c;
        const velho = c.video || {};
        const a = analisarVideo(c.nomeOriginal || c.nome, c.url);
        if (c.natureza === 'filme') { delete a.serie; delete a.temporada; delete a.episodio; }
        c.video = Object.assign(a, { colecao: colecaoVideo(c, c.natureza) });
        if (velho.dados) c.video.dados = velho.dados;            // o que o TMDB/a lista trouxe não se perde
        if (velho.tmdbRef) c.video.tmdbRef = velho.tmdbRef;
        if (!c.video.qualidade && c.qualidade) c.video.qualidade = c.qualidade;
        return aplicarLista(c);
    }
    /** Mudança feita à mão (no painel ou num envio do Sidechain): natureza e/ou campos do vídeo. */
    // ---------- 🖼 FICHA (igual ao "Novo" das Coleções): capa, banner, fundo do topo, sinopse, banner da home… ----------
    const CAMPOS_FICHA_SC = ['capa', 'banner', 'previa', 'fundoImagem', 'posFundo', 'bannerOk', 'descricao', 'generos', 'classificacao', 'bannerLogo', 'bannerVideo', 'bannerSkin', 'bannerFx', 'destaque', 'imdb', 'notaImdb', 'votosImdb', 'tmdb', 'nota'];
    /** junta a ficha nova na antiga: '' / null apaga o campo */
    function juntarFicha(antiga, nova) {
        const f = Object.assign({}, antiga || {});
        for (const k of CAMPOS_FICHA_SC) if (nova && k in nova) { const v = nova[k]; if (v === '' || v == null || v === false || (Array.isArray(v) && !v.length)) delete f[k]; else f[k] = v; }
        return f;
    }
    /** a série do episódio (chave da ficha da série: vale para todos os episódios, inclusive os que chegarem depois) */
    const chaveSerie = (c) => c.natureza === 'episodio' && c.video && c.video.serie ? norm(c.video.serie) : '';
    /** Tudo o que você arrumou neste envio, aplicado no item: ajustes do item + ficha da série. */
    function aplicarAjustesEnvio(c, envio) {
        const aj = envio.ajustes && envio.ajustes[chaveSC(c)];
        if (aj) ajustarVideo(c, aj);
        const fs = envio.fichasSerie && chaveSerie(c) && envio.fichasSerie[chaveSerie(c)];
        aplicarSeparacao(c, envio);
        if (fs) c.fichaSerie = fs; else delete c.fichaSerie;
        return c;
    }
    /** ✂ separação feita à mão no 🧬 Cópias: a cópia (pelo link; série: pela lista + série) vira obra própria */
    const chaveSepSerie = (envioId, c) => 's:' + envioId + ':' + chaveSerie(c);
    function aplicarSeparacao(c, envio) {
        const sep = envio._sep; if (!sep || !ehVideo(c)) return;
        let sp = sep[c.url] || (chaveSerie(c) && sep[chaveSepSerie(envio.id, c)]);
        if (!sp) return;
        // TMDB colado no campo Título ("movie/123" ou o link): vale como TMDB, não como nome
        if (sp.titulo && /^(https?:\/\/\S*themoviedb\.org\/)?(movie|tv)\/\d+/i.test(sp.titulo.trim())) { const m = sp.titulo.match(/(movie|tv)\/(\d+)/i); sp = Object.assign({}, sp, { tmdb: sp.tmdb || m[1].toLowerCase() + '/' + m[2] }); delete sp.titulo; }
        const v = c.video = c.video || {};
        if (sp.tmdb) { v.tmdbRef = sp.tmdb; if (v.dados) delete v.dados.porBusca; }
        if (sp.ano) v.ano = sp.ano;
        if (sp.titulo) { if (c.natureza === 'episodio') v.serie = sp.titulo; else v.titulo = sp.titulo; }
        const fx = {}; ['capa', 'banner'].forEach(k => { if (sp[k]) fx[k] = sp[k]; }); if (Object.keys(fx).length) c.ficha = juntarFicha(c.ficha, fx);   // capa/banner escolhidos à mão
        if (sp.principal) c.fixo = true;               // ⭐ escolhida no 🧬 Conferir: vai primeiro para o app (as outras viram reserva)
        if (sp.grupo) c._obra = sp.grupo;              // ✓ "mesmo filme" no Conferir: as cópias que ficaram no grupo continuam juntas
        // separada: TMDB igual = mesma obra (as cópias se juntam sozinhas); sem TMDB, título + ano iguais também juntam; sem nada, fica sozinha
        else if (!sp.soDados) c._obra = sp.tmdb ? 't:' + String(sp.tmdb).replace(/^.*?(movie|tv)\//, '$1/') : sp.ano ? 'a:' + norm(sp.titulo || (c.video && (c.video.serie || c.video.titulo)) || c.nome) + '|' + sp.ano : 'u:' + (c.natureza === 'episodio' ? envio.id + ':' + chaveSerie(c) : c.url);
    }
    function ajustarVideo(c, aj) {
        if (!aj) return c;
        if (aj.ficha) { c.ficha = juntarFicha(c.ficha, aj.ficha); if (!Object.keys(c.ficha).length) delete c.ficha; }
        if (aj.nome) { c.nome = aj.nome; c.nomeManual = true; }
        if (aj.natureza) { c.natureza = aj.natureza; c.naturezaManual = true; }
        if (ehVideo(c)) {
            if (!c.video) detectarVideo(c);
            const v = Object.assign({}, c.video || {});
            // "Vai para" escolhido à mão (✎ Editar dados): vale como rota deste item no Sidechain
            if ('colecao' in aj) { if (aj.colecao) c.colecaoManual = aj.colecao; else delete c.colecaoManual; }
            ['titulo', 'serie', 'temporada', 'episodio', 'ano', 'audio', 'qualidade', 'colecao', 'genero'].forEach(k => { if (k in aj) { if (aj[k] === '' || aj[k] == null) delete v[k]; else v[k] = aj[k]; } });
            if (c.natureza === 'filme') { delete v.serie; delete v.temporada; delete v.episodio; }
            c.video = v; c.videoManual = true;
        }
        return c;
    }
    // ---------- 🔎 TMDB: capa, banner, sinopse, gênero, nota… (uma busca por SÉRIE ou por filme, e todos os itens dela usam) ----------
    /** Chave da busca: 'tv|naruto' (todos os episódios da série) ou 'movie|matrix|1999'. */
    function chaveTMDB(c) {
        const v = c.video || {};
        const ref = (c.lista && c.lista.tmdb) || v.tmdbRef || (c.ficha && c.ficha.tmdb) || (c.fichaSerie && c.fichaSerie.tmdb);
        if (ref) return 'id|' + ref;                                        // a lista (ou você) já disse qual é a obra: sem chute
        return c.natureza === 'episodio' ? 'tv|' + norm(v.serie || v.titulo || c.nome) : 'movie|' + norm(v.titulo || c.nome) + '|' + (v.ano || '');
    }
    /** O pedido no formato do StudioCore.completarItem (episódio vai com temporada → o TMDB procura série primeiro). */
    function pedidoTMDB(c) {
        const v = c.video || {};
        const o = { nome: c.natureza === 'episodio' ? (v.serie || v.titulo || c.nome) : (v.titulo || c.nome), links: [c.url] };
        if (v.ano) o.ano = v.ano;
        const ref = v.tmdbRef || (c.ficha && c.ficha.tmdb) || (c.fichaSerie && c.fichaSerie.tmdb);
        if (ref) o.tmdb = ref;
        if (c.natureza === 'episodio') o.temporadas = [{ numero: v.temporada || 1, episodios: [{ numero: v.episodio || 1, links: [c.url] }] }];
        return o;
    }
    /** O que veio do TMDB (item completado) → c.video.dados (só o que o app usa). Nada que você escreveu é trocado. */
    function dadosDoTMDB(it) {
        if (!it || !it.tmdb) return null;
        const d = { tmdb: it.tmdb, imdb: it.imdb, titulo: it.nome, capa: it.capa, banner: it.banner, previa: it.previa, logo: it.bannerLogo, descricao: it.descricao,
            generos: it.generos && it.generos.length ? it.generos : undefined, ano: it.ano, nota: it.notaTmdb, notaImdb: it.notaImdb, votosImdb: it.votosImdb, popularidade: it.popularidade,
            duracao: it.duracao, classificacao: it.classificacao, porBusca: it.porBusca || it._tmdbPorBusca || undefined };
        Object.keys(d).forEach(k => d[k] == null && delete d[k]);
        return d;
    }
    /** Põe os dados do TMDB no item (e no ano/gênero, se estiverem vazios). */
    function aplicarTMDB(c, dados) {
        if (!ehVideo(c) || !dados) return c;
        // lista com dados: o que ela trouxe fica, o TMDB só preenche o que faltava
        if (c.lista) { dados = Object.assign({}, dados, dadosDeVideoDaLista(c.lista)); if (c.lista.tmdb) delete dados.porBusca; }
        c.video = Object.assign({}, c.video || {}, { dados });
        if (!c.video.ano && dados.ano && c.natureza === 'filme') c.video.ano = dados.ano;
        if (!c.video.genero && dados.generos) c.video.genero = dados.generos.slice(0, 3).join(', ');
        return c;
    }

    // ---------- 📂 séries em árvore: Série → Temporada → Episódios, com os que faltam e os repetidos ----------
    function arvoreSeries(canais) {
        const series = new Map();
        canais.filter(c => c.natureza === 'episodio').forEach(c => {
            const v = c.video || {}, nome = v.serie || v.titulo || c.nome, k = norm(nome);
            if (!series.has(k)) series.set(k, { serie: nome, chave: k, temporadas: new Map(), itens: [] });
            const s = series.get(k); s.itens.push(c);
            const t = v.temporada || 1;
            if (!s.temporadas.has(t)) s.temporadas.set(t, new Map());
            const ep = v.episodio != null ? v.episodio : 0;
            const m = s.temporadas.get(t); if (!m.has(ep)) m.set(ep, []); m.get(ep).push(c);
        });
        return [...series.values()].map(s => {
            const temporadas = [...s.temporadas.entries()].sort((a, b) => a[0] - b[0]).map(([numero, m]) => {
                const nums = [...m.keys()].filter(n => n > 0).sort((a, b) => a - b);
                const faltando = []; for (let n = nums[0] || 1; n <= (nums[nums.length - 1] || 0); n++) if (!m.has(n)) faltando.push(n);   // buracos entre o 1º e o último que a lista tem
                return { numero, comeca: nums[0] || 0, eps: [...m.entries()].sort((a, b) => a[0] - b[0]).map(([numero, itens]) => ({ numero, itens })), faltando,
                    repetidos: [...m.entries()].filter(([n, it]) => n > 0 && it.length > 1).map(([n]) => n), semNumero: (m.get(0) || []).length };
            });
            return { serie: s.serie, chave: s.chave, temporadas, total: s.itens.length, itens: s.itens,
                problemas: temporadas.reduce((n, t) => n + t.faltando.length + t.repetidos.length + (t.semNumero ? 1 : 0), 0) };
        }).sort((a, b) => b.problemas - a.problemas || a.serie.localeCompare(b.serie, 'pt'));
    }
    // ---------- 🗂️ já existe na Studio? (para não aparecer dobrado no app) ----------
    /** indice = StudioCore.resumoItem de cada item ({ caminho:'conteudo/<coleção>/…', nome, pais }) → Map */
    function mapaStudio(indice) {
        const m = new Map();
        (indice || []).forEach(i => {
            const col = (String(i.caminho || '').split('/')[1]) || '';
            const n = norm(i.nome);
            if (!n) return;
            m.set('v|' + n, Object.assign({ colecao: col }, i));
            if (i.tmdb) m.set('t|' + i.tmdb, Object.assign({ colecao: col }, i));      // 🧬 o mesmo filme/série pelo TMDB
            m.set('c|' + n + '|' + String(i.pais || '').toUpperCase(), Object.assign({ colecao: col }, i));
        });
        return m;
    }
    function jaNaStudio(c, mapa) {
        if (!mapa || !mapa.size) return null;
        if (ehVideo(c)) {
            const v = c.video || {}, d = v.dados || {};
            if (d.tmdb && mapa.get('t|' + d.tmdb)) return mapa.get('t|' + d.tmdb);
            return mapa.get('v|' + norm(c.natureza === 'episodio' ? (v.serie || v.titulo || c.nome) : (v.titulo || c.nome))) || null;
        }
        return mapa.get('c|' + norm(c.nome) + '|' + String(c.pais || '').toUpperCase()) || null;
    }
    // ---------- ✎ arrumar nomes em lote ----------
    /** ops: { procurar, trocar, regex, tirarPrefixo, tirarTags, caixa: 'titulo'|'' } → nome novo */
    function arrumarNome(nome, ops = {}) {
        let s = String(nome || '');
        if (ops.procurar) {
            if (ops.regex) { try { s = s.replace(new RegExp(ops.procurar, 'gi'), ops.trocar || ''); } catch (e) { /* regex inválida: não muda */ } }
            else s = s.split(ops.procurar).join(ops.trocar || '');
        }
        if (ops.tirarPrefixo) s = s.replace(/^\s*[A-Za-z]{2,4}\s*[|:\-–»›]\s*/, '');
        if (ops.tirarTags) s = s.replace(/\s*[\[(][^\])]{1,24}[\])]\s*/g, ' ').replace(/\b(fhd|uhd|hd|sd|4k|h265|hevc|1080p|720p)\b/gi, ' ');
        if (ops.caixa === 'titulo') s = s.split(/(\s+)/).map(w => (/^[A-Z0-9&+]{1,3}$/.test(w) ? w : w.toLowerCase().replace(/(^|[\-(/"'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()))).join('');   // siglas curtas (SP, TV, HBO) ficam
        return s.replace(/\s{2,}/g, ' ').trim() || String(nome || '');
    }

    /** "Naruto · T1E3", "Matrix (1999)" */
    function videoTexto(c) {
        const v = c.video || {};
        if (c.natureza === 'episodio') return [v.serie || v.titulo || c.nome, v.temporada != null || v.episodio != null ? `T${v.temporada || 1}E${v.episodio != null ? v.episodio : '?'}` : ''].filter(Boolean).join(' · ');
        return (v.titulo || c.nome) + (v.ano ? ` (${v.ano})` : '');
    }

    // ================================================================ 🔗 LINK SIDECHAIN
    // Listas boas que vivem sendo atualizadas: cada ENVIO tem um link e um destino padrão (uma coleção do Studio).
    // O "sidechain" desvia itens dessa lista para outra coleção (ex.: os animes de uma lista de cartoons → Animes).
    // Cada desvio fica salvo pela CHAVE do item (tvg-id ou nome limpo + país, a mesma das cópias), não pela posição:
    // quando a lista atualiza, o mesmo canal vai para o mesmo lugar. O robô (tools/sidechain.mjs) monta, a cada 6 h,
    // uma lista pronta por coleção (e por PAÍS no TVzine/rádios) — o país vai na FONTE do Cloud, então nunca desvia.
    // Destino = { colecao, pais?, idioma?, categoria? }   ·   desvio 'ignorar' = fica de fora.
    const SC_TIPOS = ['video', 'canal', 'canal24h', 'radio'];
    const scComPais = (col) => !!col && (col.tipo === 'canal' || col.tipo === 'radio');
    /** Coleções que podem receber um envio (as de vídeo/canal/rádio que publicam fonte no Cloud). */
    function colecoesSidechain(config) { return ((config && config.colecoes) || []).filter(c => SC_TIPOS.includes(c.tipo) && c.fonteCloud); }
    function envioPadrao(extra) {
        const e = Object.assign({ id: '', nome: 'Envio novo', url: '', listas: [], ativo: true, tipoLista: '', destino: { colecao: '' }, rotas: [], gruposNovos: 'esperar',
            modo: 'auto', soVivos: null, filtros: {}, avulsa: false, tmdb: false, tmdbModo: 'falta', tmdbFundo: true, pularStudio: true, desvios: {}, regras: [], ajustes: {}, vistos: {}, gruposRevisados: {}, fichasSerie: {}, criadoEm: '' }, extra || {});
        e.filtros = Object.assign({ idiomas: [], tipos: [], paises: [], categorias: [], excluirTipos: ['Adulto'], busca: '', confiancaMin: 0 }, e.filtros || {});
        if (!e.tipoLista) e.tipoLista = (e.rotas || []).length ? 'mista' : 'unica';     // envios antigos: uma categoria
        // desvio igual ao destino do envio não muda nada (envios antigos chegaram a guardar centenas de milhares assim)
        if (e.tipoLista === 'unica' && e.destino && e.destino.colecao) {
            for (const [k, d] of Object.entries(e.desvios || {})) if (d && d !== 'ignorar' && mesmoDestino(d, e.destino)) delete e.desvios[k];
        }
        (e.rotas || []).forEach((r, i) => { if (!r.id) r.id = 'r' + (i + 1); r.grupos = r.grupos || []; });
        return e;
    }
    // ---------- 🔀 LISTA MISTA: rotas montadas pelos GRUPOS da lista (não item por item) ----------
    const SEM_GRUPO = '(sem grupo)';
    const grupoDe = (c) => String(c.grupo || '').trim() || SEM_GRUPO;
    /** grupo → rota (a rota guarda os grupos dela) */
    function mapaGrupos(e) { const m = new Map(); (e.rotas || []).forEach(r => (r.grupos || []).forEach(g => m.set(g, r))); return m; }
    /**
     * Coleção sugerida para um grupo inteiro, pelo nome dele e pelo tipo da maioria dos itens.
     * → { colecao } · 'ignorar' · null (sem palpite). cols = colecoesSidechain(config)
     */
    function sugerirGrupo(nome, nats, cols) {
        const g = norm(nome), tem = (id) => cols.some(c => c.id === id) ? id : '';
        const total = Object.values(nats).reduce((a, b) => a + b, 0) || 1, maior = Object.entries(nats).sort((a, b) => b[1] - a[1])[0];
        const nat = maior ? maior[0] : 'canal', video = (nats.filme || 0) + (nats.episodio || 0) > total / 2;
        if (/\b(adult|adulto|xxx|18|porn|hot|erotic)/.test(g)) return 'ignorar';
        if (nat === 'radio') return tem('radios') ? { colecao: 'radios' } : null;
        if (!video) {
            if (/\b(desenho|cartoon|toon)/.test(g) && /\b24/.test(g) && tem('desenhos-24h')) return { colecao: 'desenhos-24h' };
            return tem('canais') ? { colecao: 'canais' } : null;
        }
        if (/\b(anime|animes|otaku|crunchy|manga)/.test(g)) return tem('animes') ? { colecao: 'animes' } : null;
        if (/\b(desenho|desenhos|cartoon|cartoons|infantil|kids|animac|toon|crianca)/.test(g)) return tem('cartoons') ? { colecao: 'cartoons' } : null;
        if (/\b(serie|series|novela|novelas|temporada|dorama|doramas|sitcom)/.test(g) || (nats.episodio || 0) > total / 2) return tem('series') ? { colecao: 'series' } : null;
        if (/\b(torrent|magnet)/.test(g)) return tem('filmes-torrent') ? { colecao: 'filmes-torrent' } : null;
        return tem('filmes') ? { colecao: 'filmes' } : null;
    }
    /** Resumo dos grupos da lista: [{ grupo, n, nats:{canal,filme,episodio,radio}, rota, sugestao }] (maiores primeiro) */
    function analisarGrupos(canais, e, cols) {
        const m = new Map(), mg = mapaGrupos(e);
        const regras = (e.regras || []).concat(e._globais || []).filter(r => r && r.para && r.ativo !== false);
        canais.forEach(c => { const g = grupoDe(c); if (!m.has(g)) m.set(g, { grupo: g, n: 0, nats: {}, manual: {}, nManual: 0, regra: {}, nRegra: 0 }); const x = m.get(g); x.n++;
            // itens deste grupo com destino escolhido um a um (desvio ou "Vai para") ou por regra (ex.: ✂ Separar por tipo): não seguem a rota do grupo
            { const dv = e.desvios && e.desvios[chaveSC(c)], k = dv === 'ignorar' ? 'ignorar' : dv && dv.colecao ? dv.colecao : c.colecaoManual || '';
              if (k) { x.manual[k] = (x.manual[k] || 0) + 1; x.nManual++; }
              else { const r = regras.find(r => passaRegra(c, r)); if (r) { const kr = r.para === 'ignorar' ? 'ignorar' : r.para.colecao; x.regra[kr] = (x.regra[kr] || 0) + 1; x.nRegra++; } } } const nt = c.natureza || 'canal'; x.nats[nt] = (x.nats[nt] || 0) + 1; });
        return [...m.values()].map(x => Object.assign(x, { rota: mg.get(x.grupo) || null, sugestao: sugerirGrupo(x.grupo, x.nats, cols) })).sort((a, b) => b.n - a.n);
    }
    /** Monta as rotas pelas sugestões (só para grupos sem rota). Cria a rota da coleção se ainda não existe. Devolve quantos grupos ganhou rota. */
    function aplicarSugestoes(e, grupos) {
        let n = 0;
        grupos.forEach(x => {
            if (x.rota || !x.sugestao) return;
            const chave = x.sugestao === 'ignorar' ? 'ignorar' : x.sugestao.colecao;
            let r = (e.rotas || []).find(r => (r.destino === 'ignorar' ? 'ignorar' : r.destino && r.destino.colecao) === chave);
            if (!r) { r = { id: 'r' + Date.now().toString(36) + (e.rotas.length + 1), destino: x.sugestao === 'ignorar' ? 'ignorar' : Object.assign({}, x.sugestao), grupos: [] }; e.rotas.push(r); }
            r.grupos.push(x.grupo); x.rota = r; n++;
        });
        return n;
    }
    /** Põe o grupo na rota (ou tira de todas, com rotaId vazio). */
    function moverGrupo(e, grupo, rotaId) {
        (e.rotas || []).forEach(r => { r.grupos = (r.grupos || []).filter(g => g !== grupo); });
        const r = (e.rotas || []).find(x => x.id === rotaId);
        if (r) r.grupos.push(grupo);
    }
    /** Todos os links do envio (o principal + as outras listas que entram junto). */
    function linksDoEnvio(e) { return [...new Set([e.url].concat(e.listas || []).map(u => String(u || '').trim()).filter(u => /^https?:\/\//i.test(u)))]; }
    /** O item passa nos filtros do envio? (os mesmos das antigas Receitas: idioma, tipo, país, categoria, nome, confiança) */
    function passaFiltros(c, e) {
        const f = e.filtros || {};
        if (!passaReceita(c, Object.assign({}, f, { listas: [] }))) return false;
        if (f.confiancaMin) { const k = confianca(c.historico); if (k != null && k < f.confiancaMin) return false; }
        return true;
    }
    const idEnvio = (nome, usados) => { const base = norm(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'envio'; let id = base, i = 2; while (usados && usados.has(id)) id = base + '-' + i++; return id; };
    /** Chave estável do item no sidechain (a mesma das cópias: tvg-id, ou nome limpo + país). */
    const chaveSC = (c) => c.chave || chaveDe(c);
    const mesmoDestino = (a, b) => !!a && !!b && a.colecao === b.colecao && (a.pais || '') === (b.pais || '') && (a.idioma || '') === (b.idioma || '') && (a.categoria || '') === (b.categoria || '');
    /** O destino em palavras: "Canais (TVzine) · BR · pt-BR · Infantil". */
    function destinoTexto(d, colecoes) {
        if (d === 'ignorar') return 'Ignorado';
        if (!d || !d.colecao) return 'sem destino';
        const col = (colecoes || []).find(c => c.id === d.colecao);
        return [col ? col.nome : d.colecao, d.pais, d.idioma, d.categoria].filter(Boolean).join(' · ');
    }
    /** A regra vale para o item? regra = { campo: 'grupo'|'nome'|'tudo', contem: 'anime', para: destino } */
    function passaRegra(c, r) {
        // condições extras (todas precisam bater): tipo do item, idioma, país
        if (r.natureza && (c.natureza || 'canal') !== r.natureza) return false;
        if (r.idioma && !(c.idioma === r.idioma || String(c.idioma || '').split('-')[0] === r.idioma.split('-')[0])) return false;
        if (r.pais && String(c.pais || '').toUpperCase() !== String(r.pais).toUpperCase()) return false;
        if (!String(r.contem || '').trim()) return !!(r.natureza || r.idioma || r.pais);      // só condições, sem texto
        const alvo = ' ' + (r.campo === 'nome' ? norm(c.nomeOriginal || c.nome) : r.campo === 'grupo' ? norm(c.grupo) : norm([c.grupo, c.nomeOriginal || c.nome, c.tvgId].join(' '))) + ' ';
        // "anime | otaku | crunchy": qualquer uma das palavras
        return String(r.contem).split(/\s*[|,;]\s*/).map(norm).filter(Boolean).some(k => alvo.includes(' ' + k));
    }
    /**
     * Para onde o item vai e por quê: { destino, motivo: 'manual'|'regra'|'padrao'|'pendente'|'ignorar', novo, regra }
     * novo = nunca visto neste envio (envio.vistos). No modo 'revisar', o novo sem desvio nem regra fica PENDENTE.
     */
    /** objeto não vazio, sem listar as chaves (Object.keys de 200 mil vistos por item deixava o robô parado por horas) */
    // (nem for-in: o V8 monta a lista inteira de chaves antes). Uma vez com chave, fica guardado.
    const COM_CHAVE = new WeakSet();
    function temChave(o) {
        if (COM_CHAVE.has(o)) return true;
        for (const k in o) { COM_CHAVE.add(o); return true; }
        return false;
    }
    function rotaDe(c, envio) {
        const k = chaveSC(c);
        const novo = envio._novos ? envio._novos.has(k) : !!(envio.vistos && temChave(envio.vistos) && !envio.vistos[k]);
        const d = envio.desvios && envio.desvios[k];
        if (d === 'ignorar') return { destino: 'ignorar', motivo: 'ignorar', novo };
        if (d && d.colecao) return { destino: d, motivo: 'manual', novo };
        if (c.colecaoManual) return { destino: { colecao: c.colecaoManual }, motivo: 'manual', novo };   // "Vai para" do item (✎ Editar dados)
        const r = (envio.regras || []).concat(envio._globais || []).find(x => x && x.para && x.ativo !== false && passaRegra(c, x));
        if (r) return r.para === 'ignorar' ? { destino: 'ignorar', motivo: 'regra', regra: r, novo } : { destino: r.para, motivo: 'regra', regra: r, novo };
        if (envio.tipoLista === 'mista') {
            const g = grupoDe(c), rt = (envio._mapaGrupos && envio._mapaGrupos.get(g)) || mapaGrupos(envio).get(g);
            if (rt) return { destino: rt.destino, motivo: rt.destino === 'ignorar' ? 'ignorar' : 'rota', rota: rt, novo };
            // grupo que ainda não tem rota (chegou agora na lista): espera você, ou vai pela sugestão
            if (envio.gruposNovos === 'sugestao' && envio._cols) { const sg = sugerirGrupo(g, { [c.natureza || 'canal']: 1 }, envio._cols); if (sg) return { destino: sg, motivo: 'sugestao', novo }; }
            return { destino: null, motivo: 'pendente', grupoNovo: g, novo };
        }
        if (novo && envio.modo === 'revisar') return { destino: null, motivo: 'pendente', novo };
        return { destino: envio.destino && envio.destino.colecao ? envio.destino : null, motivo: 'padrao', novo };
    }
    /** O item pronto para o destino, no formato do app (país/idioma/categoria do destino SEMPRE vencem os da lista). */
    function itemNoDestino(c, d, col) {
        const o = Object.assign({}, c);
        if (scComPais(col)) {
            if (d.pais) o.pais = d.pais;                       // o país escolhido manda: o canal nunca vai para outro país
            if (d.idioma) o.idioma = d.idioma; else if (d.pais && !o.idioma) o.idioma = idiomaDe({}, d.pais);
            o.grupoSaida = d.categoria || c.grupoSaida || categoriaSugerida(c) || 'Variedades';
        } else {
            if (d.idioma) o.idioma = d.idioma;
            o.grupoSaida = d.categoria || c.grupoSaida || c.grupo || '';
        }
        return o;
    }
    /** Nome do arquivo de saída: sc-<coleção> (vídeo) ou sc-<coleção>-<país> (TVzine/rádios). */
    function saidaDe(d, col, item) {
        if (!scComPais(col)) return { chave: 'sc-' + d.colecao, colecao: d.colecao, pais: '', idioma: d.idioma || '' };
        const pais = String(d.pais || (item && item.pais) || '').toUpperCase();
        return { chave: 'sc-' + d.colecao + '-' + (pais ? pais.toLowerCase() : 'mundo'), colecao: d.colecao, pais, idioma: '' };
    }
    /**
     * Monta todas as saídas. lotes = [{ envio, canais }] (canais já lidos, com .teste/.historico se testados).
     * → { saidas: [{ chave, colecao, pais, idioma, itens }], relatorios: { [envioId]: {...} } }
     * Cópias do mesmo canal (mesmo destino, de envios diferentes) viram reserva da melhor.
     */
    function montarSidechain(lotes, config, opts = {}) {
        const cols = colecoesSidechain(config);
        const porSaida = new Map(), relatorios = {}, avulsas = [], reservasStudio = {}, naStudioCopias = new Map();
        for (const { envio, canais, mantido, erro } of lotes) {
            const rel = { total: canais.length, porDestino: {}, novos: [], pendentes: [], gruposNovos: {}, ignorados: 0, filtrados: 0, mortos: 0, mantido: !!mantido, erro: erro || '' };
            envio._mapaGrupos = mapaGrupos(envio); envio._cols = cols;
            const avulsa = envio.avulsa ? [] : null;
            const viver = envio.soVivos != null ? envio.soVivos : null;
            for (const c of canais) {
                aplicarAjustesEnvio(c, envio);                  // tipo, dados de vídeo e ficha que você arrumou no Sidechain
                if (envio.tmdb) c.tmdbPref = { modo: envio.tmdbModo || 'falta', fundo: envio.tmdbFundo !== false, campos: Array.isArray(envio.tmdbCampos) ? envio.tmdbCampos : undefined }; else delete c.tmdbPref;
                if (!passaFiltros(c, envio)) { rel.filtrados++; continue; }
                const r = rotaDe(c, envio);
                if (avulsa && r.destino !== 'ignorar') {        // lista avulsa (M3U/JSON para outros players): tudo o que passou nos filtros
                    const viva = !(c.teste && !VIVO_RECEITA(c.teste.status) && (envio.soVivos != null ? envio.soVivos : !ehVideo(c)));
                    if (viva) avulsa.push(r.destino && r.destino.colecao ? itemNoDestino(c, r.destino, cols.find(x => x.id === r.destino.colecao) || {}) : c);
                }
                if (r.novo) rel.novos.push({ chave: chaveSC(c), nome: c.nome, para: r.motivo === 'pendente' ? null : r.destino === 'ignorar' ? 'ignorar' : r.destino && r.destino.colecao, motivo: r.motivo });
                if (r.motivo === 'pendente') { rel.pendentes.push(chaveSC(c)); if (r.grupoNovo) rel.gruposNovos[r.grupoNovo] = (rel.gruposNovos[r.grupoNovo] || 0) + 1; continue; }
                if (r.destino === 'ignorar' || !r.destino) { rel.ignorados++; continue; }
                const col = cols.find(x => x.id === r.destino.colecao);
                if (!col) { rel.ignorados++; continue; }
                // tipo trocado (canal ao vivo indo para uma coleção de vídeo, ou filme indo para o TVzine): só se VOCÊ mandou
                if ((r.motivo === 'padrao' || r.motivo === 'rota' || r.motivo === 'sugestao') && ((col.tipo === 'video') !== ehVideo(c)) && !(col.tipo === 'canal24h' && !ehVideo(c))) { rel.tipoErrado = (rel.tipoErrado || 0) + 1; continue; }
                // já está na MESMA coleção da Studio (cadastrado à mão): não entra de novo — no app apareceria dobrado
                if (envio.pularStudio !== false && opts.studio) {
                    const j = jaNaStudio(c, opts.studio);
                    if (j && j.colecao === col.id) {
                        rel.naStudio = (rel.naStudio || 0) + 1;
                        { const ks = chaveSerie(c), k = col.id + '\u0001' + (ks ? 's|' + ks : 'f|' + chaveSC(c)); const x = naStudioCopias.get(k) || { col: col.id, k: ks ? 's|' + ks : 'f|' + chaveSC(c), nome: ks ? c.video.serie : c.nome, serie: !!ks, listas: new Set(), studio: j.nome }; x.listas.add(envio.nome); naStudioCopias.set(k, x); }
                        // 🧬 não some: o link vira RESERVA do item da Studio (o app troca sozinho se o principal cair)
                        if (ehVideo(c) && c.url && j.caminho) {
                            const r = reservasStudio[j.caminho] || (reservasStudio[j.caminho] = { nome: j.nome, links: [], eps: {} });
                            const v = c.video || {};
                            if (c.natureza === 'episodio' && v.episodio != null) { const k = (v.temporada || 1) + '|' + v.episodio; (r.eps[k] = r.eps[k] || []).push(c.url); }
                            else if (c.natureza !== 'episodio') r.links.push(c.url);
                        }
                        continue;
                    }
                }
                const testar = viver != null ? viver : (col.tipo !== 'video');
                if (testar && c.teste && !VIVO_RECEITA(c.teste.status)) { rel.mortos++; continue; }
                const it = itemNoDestino(c, r.destino, col);
                it._env = envio.nome; it._envId = envio.id;                           // 🧬 de que lista veio (para o relatório de cópias)
                const sd = saidaDe(r.destino, col, it);
                if (!porSaida.has(sd.chave)) porSaida.set(sd.chave, Object.assign(sd, { brutos: [] }));
                porSaida.get(sd.chave).brutos.push(it);
                const rot = destinoTexto(sd.pais ? Object.assign({}, r.destino, { pais: sd.pais }) : r.destino, cols);
                rel.porDestino[rot] = (rel.porDestino[rot] || 0) + 1;
                rel.porColecao = rel.porColecao || {}; rel.porColecao[col.id] = (rel.porColecao[col.id] || 0) + 1;   // 📊 fluxo
            }
            delete envio._mapaGrupos; delete envio._cols;
            relatorios[envio.id] = rel;
            if (avulsa) avulsas.push({ id: envio.id, nome: envio.nome, itens: agrupar(avulsa.map(c => Object.assign({}, c, { chave: chaveSC(c) }))).map(canalComReservas) });
        }
        for (const s of porSaida.values()) { s.brutos.forEach(c => { c.chave = chaveObraSC(c); }); refinarChaves(s.brutos); }   // mesmo nome, obras diferentes (ano/TMDB) não se juntam
        const copias = copiasDasSaidas([...porSaida.values()], naStudioCopias);
        const saidas = [...porSaida.values()].map(s => {
            const grupos = agrupar(s.brutos.map(c => Object.assign({}, c)));
            // 📊 balanço da saída: tudo o que entrou = no app + juntado como reserva + desativado
            s.balanco = { entrou: s.brutos.length, noApp: grupos.length, juntados: grupos.reduce((t, g) => t + g.reservas.length, 0), desativados: s.brutos.filter(c => c.desativado).length };
            const itens = grupos.map(canalComReservas)
                .sort((a, b) => String(a.grupoSaida || '').localeCompare(String(b.grupoSaida || ''), 'pt') || String(a.nome).localeCompare(String(b.nome), 'pt'));
            delete s.brutos;
            return Object.assign(s, { itens });
        }).sort((a, b) => a.chave.localeCompare(b.chave));
        for (const r of Object.values(reservasStudio)) { r.links = [...new Set(r.links)].slice(0, 5); for (const k of Object.keys(r.eps)) r.eps[k] = [...new Set(r.eps[k])].slice(0, 5); if (!Object.keys(r.eps).length) delete r.eps; }
        return { saidas, relatorios, avulsas, reservasStudio, copias };
    }
    /**
     * 🧬 Relatório de cópias (só informativo): o mesmo filme ou episódio vindo mais de uma vez para a mesma coleção
     * (de listas diferentes ou repetido na mesma lista). O robô já junta: a 1ª vira o item e as outras viram reserva.
     * → { [colecao]: [{ k, nome, serie, n, eps?, listas: { [nomeDaLista]: quantos } , studio? }] }
     */
    /**
     * Mesmo nome, obras diferentes: antes de juntar as cópias, separa pelo que as diferencia.
     *  - TMDB vindo da lista/ficha (não o achado só pelo nome) manda: TMDB diferente = obra diferente.
     *  - Sem TMDB, o ano decide (e o ano de quem tem TMDB liga as duas coisas).
     *  - Cópia sem ano e sem TMDB só se junta quando o grupo tem uma obra só; se houver duas ou mais, fica à parte.
     * Muda c.chave (acrescenta #t:… / #a:… / #?) só nos grupos que precisam; o resto continua igual.
     */
    function identidadeVideo(c) {
        if (!ehVideo(c)) return {};
        const v = c.video || {}, d = v.dados || {};
        const ref = v.tmdbRef || (d.tmdb && !d.porBusca ? d.tmdb : '') || (c.ficha && c.ficha.tmdb) || (c.fichaSerie && c.fichaSerie.tmdb) || '';
        const ano = parseInt(v.ano || (c.natureza !== 'episodio' && d.ano) || 0, 10) || 0;
        return { tmdb: ref ? String(ref).replace(/^.*?(movie|tv)\//, '$1/') : '', ano, obra: c._obra || '' };
    }
    /** chave para juntar cópias de FILME: o título sem o ano ("Matrix (1999)" e "Matrix" são candidatos; o ano decide depois em refinarChaves) */
    function chaveObraSC(c) {
        if (ehVideo(c) && c.natureza !== 'episodio' && c.video && c.video.titulo) return 'v:' + norm(c.video.titulo) + '|' + (c.pais || '');
        return chaveSC(c);
    }
    function refinarChaves(lista) {
        const grupos = new Map();
        for (const c of lista) { if (!ehVideo(c)) continue; const k = c.chave; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(c); }
        for (const [k, g] of grupos) {
            if (g.length < 2) continue;
            const ids = g.map(identidadeVideo);
            const tmdbs = new Set(ids.map(x => x.tmdb).filter(Boolean)), anos = new Set(ids.map(x => x.ano).filter(Boolean));
            if (tmdbs.size <= 1 && anos.size <= 1 && !ids.some(x => x.obra)) continue;                     // nada contradiz: junta como sempre
            const anoDoTmdb = new Map();                                        // ano ↔ TMDB (de quem tem os dois)
            ids.forEach(x => { if (x.tmdb && x.ano) anoDoTmdb.set(x.ano, anoDoTmdb.has(x.ano) && anoDoTmdb.get(x.ano) !== x.tmdb ? null : x.tmdb); });
            const obra = (x) => x.obra ? x.obra : x.tmdb ? 't:' + x.tmdb : x.ano ? (anoDoTmdb.get(x.ano) ? 't:' + anoDoTmdb.get(x.ano) : 'a:' + x.ano) : '';
            const obras = new Set(ids.map(obra).filter(Boolean));
            const unica = obras.size === 1 && !ids.some(x => x.obra) ? [...obras][0] : '';   // separado à mão: os outros não vão atrás
            g.forEach((c, i) => { const o = obra(ids[i]) || unica || '?'; c.chave = k + '#' + o; c._separado = obras.size > 1 || undefined; });
        }
        return lista;
    }
    const limparVazios = (o) => { Object.keys(o).forEach(k => (o[k] == null || o[k] === '') && delete o[k]); return o; };
    function copiasDasSaidas(saidas, naStudio) {
        const out = {};
        for (const s of saidas) {
            const porChave = new Map();
            for (const it of s.brutos) { const k = it.chave || chaveSC(it); if (!porChave.has(k)) porChave.set(k, []); porChave.get(k).push(it); }
            const porItem = new Map();
            for (const lista of porChave.values()) {
                if (lista.length < 2) continue;
                const c = lista[0], ks = chaveSerie(c), k = ks ? 's|' + ks : 'f|' + chaveSC(c);
                const x = porItem.get(k) || { k, nome: ks ? c.video.serie : (c.video && c.video.titulo) || c.nome, serie: !!ks, n: 0, eps: 0, listas: {} };
                x.n += lista.length - 1; if (ks) x.eps++;
                x.itens = x.itens || [];
                for (const it of lista) {                       // cada cópia (série: uma amostra por lista) para conferir na janela
                    if (x.itens.length >= 8 || (ks && x.itens.some(y => y.envId === it._envId))) continue;
                    const v = it.video || {}, d = v.dados || {}, id = identidadeVideo(it);
                    x.itens.push(limparVazios({ l: it._env, envId: it._envId, nome: it.nome, url: it.url, sep: ks ? chaveSepSerie(it._envId, it) : it.url, ano: id.ano || d.ano || undefined, tmdb: id.tmdb || (d.tmdb ? String(d.tmdb) + (d.porBusca ? ' (pelo nome)' : '') : undefined), capa: d.capa || it.logo || undefined }));
                }
                for (const it of lista) x.listas[it._env || '?'] = (x.listas[it._env || '?'] || 0) + 1;
                porItem.set(k, x);
            }
            const arr = out[s.colecao] = (out[s.colecao] || []);
            for (const x of porItem.values()) { if (!x.serie) delete x.eps; arr.push(x); }
        }
        for (const x of naStudio.values()) {
            const arr = out[x.col] = (out[x.col] || []);
            const ja = arr.find(y => y.k === x.k);
            if (ja) ja.studio = x.studio; else arr.push({ k: x.k, nome: x.nome, serie: x.serie, n: x.listas.size, studio: x.studio, listas: Object.fromEntries([...x.listas].map(l => [l, 1])) });
        }
        for (const k of Object.keys(out)) { out[k].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt')); if (!out[k].length) delete out[k]; else out[k] = out[k].slice(0, 60000); }
        return out;
    }
    /**
     * A fonte do Cloud de uma saída (vai em listas/sidechain-fontes.json; o Cloud lê via "fontesDoStudio").
     * No TVzine/rádios o país vai na FONTE (pais + paisExclusivo): o Cloud não tenta adivinhar outro.
     */
    function fonteDaSaida(s, col, link) {
        const base = Object.assign({}, col.fonteCloud);
        const f = Object.assign(base, {
            _colecao: 'sidechain',
            nome: base.nome + ' · Sidechain' + (s.pais ? ' ' + s.pais : s.idioma ? ' ' + s.idioma : ''),
            prefixoId: (base.prefixoId || 'SC') + '_SC' + (s.pais || (s.idioma ? s.idioma.replace(/[^a-z]/gi, '').toUpperCase() : '')),
            url: link(s.chave + (base.tipo === 'vod_m3u' ? '.m3u' : '.json'))
        });
        if (s.pais) { f.pais = s.pais.toLowerCase(); f.paisExclusivo = true; }
        if (s.idioma && !s.pais) f.idioma = s.idioma;
        return f;
    }
    /**
     * Regras que dá para aprender com os desvios feitos à mão: um grupo da lista em que (quase) tudo foi para o
     * mesmo lugar. → [{ campo: 'grupo', contem, para, n, de }] (n desviados de "de" itens daquele grupo)
     */
    function sugerirRegras(canais, envio, minimo = 3) {
        const porGrupo = new Map();
        canais.forEach(c => { const g = String(c.grupo || '').trim(); if (!g) return; if (!porGrupo.has(g)) porGrupo.set(g, []); porGrupo.get(g).push(c); });
        const out = [];
        for (const [g, lista] of porGrupo) {
            const ds = lista.map(c => envio.desvios[chaveSC(c)]).filter(Boolean);
            if (ds.length < minimo) continue;
            const alvo = ds[0];
            const iguais = ds.filter(d => d === alvo || (d !== 'ignorar' && alvo !== 'ignorar' && mesmoDestino(d, alvo))).length;
            if (iguais / lista.length < 0.8) continue;
            if ((envio.regras || []).some(r => r.campo === 'grupo' && norm(r.contem) === norm(g))) continue;
            out.push({ campo: 'grupo', contem: g, para: alvo, n: iguais, de: lista.length });
        }
        return out.sort((a, b) => b.n - a.n);
    }
    /** Depois da rodada: todo item visto entra em "vistos" (os que somem há 30 dias saem). Devolve quantos saíram. */
    function marcarVistos(envio, canais, agora = Date.now()) {
        const hoje = new Date(agora).toISOString().slice(0, 10);
        envio.vistos = envio.vistos || {};
        const agoraSet = new Set(canais.map(chaveSC));
        agoraSet.forEach(k => { envio.vistos[k] = hoje; });
        let sairam = 0;
        const limite = new Date(agora - 30 * 86400e3).toISOString().slice(0, 10);
        for (const [k, d] of Object.entries(envio.vistos)) if (!agoraSet.has(k)) { sairam++; if (d < limite) delete envio.vistos[k]; }
        return sairam;
    }

    /** Junta as linhas repetidas do lote (mesmo arquivo) e, se já existe no Studio, o que já estava lá. */
    function itemFinal(r, C, existente) {
        let item = r.item;
        (r.extras || []).forEach(x => { item = C.mesclarItem(item, x); });
        return existente ? C.mesclarItem(existente, item) : item;
    }

    /** País pelo tvg-country, pelo tvg-id ("Globo.br"), por [BR] no nome, pelo grupo ("Brasil | Abertos") ou pelo domínio (.com.br). */
    function paisDe(c) {
        const de = (t) => { const k = norm(t); return PAISES_TAG[k] || null; };
        if (c.pais) { const p = String(c.pais).split(/[,;|]/)[0].trim(); if (/^[a-z]{2}$/i.test(p)) return p.toUpperCase(); const x = de(p); if (x) return x; }
        const id = /\.([a-z]{2})(@|$)/i.exec(c.tvgId || '');
        if (id && PAISES_TAG[id[1].toLowerCase()]) return PAISES_TAG[id[1].toLowerCase()];
        const tag = /[\[(]\s*([a-z]{2,8})\s*[\])]/i.exec(c.nomeOriginal || c.nome || '');
        if (tag && de(tag[1])) return de(tag[1]);
        const pal = /^([a-z]{2,8})\s*[:|\-]\s/i.exec(c.nomeOriginal || c.nome || '');
        if (pal && de(pal[1])) return de(pal[1]);
        for (const parte of String(c.grupo || '').split(/[|/:\-–]+/)) { const x = de(parte); if (x) return x; }
        const dom = /^[a-z]+:\/\/[^/]+\.(br|pt|mx|ar|co|cl|es|fr|it|de|jp)(:\d+)?(\/|$)/i.exec(c.url || '');
        if (dom) return dom[1].toUpperCase();
        return '';
    }
    function idiomaDe(c, pais) {
        if (c.idioma) { const k = norm(c.idioma); if (IDIOMAS_NOME[k]) return k === 'pt' && pais === 'BR' ? 'pt-BR' : k === 'pt' && pais === 'PT' ? 'pt-PT' : IDIOMAS_NOME[k]; return c.idioma; }
        return IDIOMA_DO_PAIS[pais] || '';
    }

    // tipo de canal pelo grupo e pelo nome (os grupos das listas são uma bagunça: "KIDS", "Infantis", "Desenhos 24h"…)
    const TIPOS = [
        ['Adulto', /\b(adult|xxx|\+18|18\+|hot|porn|erotic)/],
        ['Infantil', /\b(kids?|infant|crianc|desenho|cartoon|anima[cç]|nick|disney|gloob|discovery kids|baby|toon|boomerang|zoomoo)/],
        ['Anime', /\b(anime|otaku|crunchy)/],
        ['Notícias', /\b(news|noticia|jornal|cnn|globonews|band news|record news|bbc news|euronews|rtp3|sic not)/],
        ['Esportes', /\b(sport|esporte|espn|fox sports|premiere|combate|sportv|dazn|futebol|nba|ufc|eleven)/],
        ['Filmes', /\b(filme|movie|cine|telecine|hbo|megapix|paramount|warner|tnt|space|universal|amc|star channel)/],
        ['Séries', /\b(serie|series|sony|axn|fx\b|ae\b|a&e|lifetime)/],
        ['Música', /\b(music|musica|mtv|vh1|radio|clipe|hits)/],
        ['Documentários', /\b(document|discovery|history|nat ?geo|animal planet|investigation)/],
        ['Religioso', /\b(gospel|igreja|religi|cancao nova|rede vida|aparecida|evangel)/],
        ['Abertos', /\b(aberto|globo|sbt|record|band|rede tv|redetv|cultura|tv brasil|rtp|sic|tvi)/],
        ['24 horas', /\b(24h|24 horas|24\/7|pluto)/]
    ];
    function tipoDe(c) {
        const g = norm(c.grupo), n = norm(c.nome);
        for (const [tipo, re] of TIPOS) if (re.test(g)) return tipo;
        for (const [tipo, re] of TIPOS) if (re.test(n)) return tipo;
        // VOD: episódio (S01E02, 1x02, /series/) ou filme (/movie/)
        const u = String(c.url || '').toLowerCase();
        if (/\bs\d{1,2}\s?e\d{1,3}\b|\b\d{1,2}x\d{2}\b|\b(episodio|ep)\s?\d/.test(n) || /\/series\//.test(u)) return 'Séries';
        if (/\/(movie|movies)\//.test(u)) return 'Filmes';
        return 'Variados';
    }

    /** Formato do link (para o visualizador escolher o motor). */
    function formatoDe(url) {
        const u = String(url || '').toLowerCase().split('#')[0];
        const p = u.split('?')[0];
        if (/^magnet:|\.torrent$/.test(u)) return 'torrent';
        if (/^(rtmpe?|rtsp|rtp|udp|srt|mms):/.test(u)) return 'protocolo';
        if (/youtube\.com|youtu\.be/.test(u)) return 'youtube';
        if (/\.m3u8$/.test(p) || /[?&](type|output|format)=(m3u8|hls)/.test(u) || /\/hls\//.test(u)) return 'hls';
        if (/\.mpd$/.test(p) || /format=(mpd|dash)/.test(u)) return 'dash';
        if (/\.(ts|m2ts)$/.test(p) || /[?&](output|extension)=(ts|mpegts)/.test(u) || /\/live\/[^/]+\/[^/]+\/\d+\/?$/.test(p)) return 'mpegts';
        if (/\.flv$/.test(p)) return 'flv';
        if (/\.(mp4|m4v|webm|mkv|mov|avi|wmv|asf|mpe?g|vob|3gp|ogv|divx|xvid|rmvb|rm|mp3|aac|m4a|ogg|opus|flac|wav)$/.test(p)) return 'arquivo';
        // filme/episódio de lista Xtream (/movie/usuario/senha/123), Google Drive e Dropbox: arquivo inteiro
        if (/\/(movie|movies|series|vod)\/[^/]+\/[^/]+\/\d+/.test(p) || /drive\.google\.com|drive\.usercontent\.google\.com|dropbox(usercontent)?\.com/.test(u)) return 'arquivo';
        return 'desconhecido';
    }

    /** Link de "ver arquivo" vira link direto do vídeo (Google Drive, Dropbox). Os outros ficam iguais. */
    function linkDireto(url) {
        const s = String(url || '').trim();
        const d = /drive\.google\.com\/(?:file\/d\/|open\?(?:[^#]*&)?id=|uc\?(?:[^#]*&)?id=)([\w-]{20,})/i.exec(s);
        if (d) return 'https://drive.usercontent.google.com/download?id=' + d[1] + '&export=download&confirm=t';
        if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(s)) return s.replace(/([?&])dl=0\b/, '$1raw=1') + (/[?&](raw|dl)=1/.test(s) || /[?&]dl=0/.test(s) ? '' : (s.includes('?') ? '&' : '?') + 'raw=1');
        return s;
    }

    /** Preenche o que dá para descobrir sozinho; nunca apaga o que veio da lista. */
    function completar(c) {
        const o = Object.assign({ headers: {}, reservas: [] }, c);
        const direto = linkDireto(o.url);
        if (direto !== o.url) { o.urlOriginal = o.urlOriginal || o.url; o.url = direto; }
        o.nomeOriginal = o.nomeOriginal || o.nome || o.tvgNome || '';
        o.nome = limparNome(o.nomeOriginal) || o.tvgNome || nomeDoLink(o.url);
        // país no fim ou no começo do nome ("Cartoon Network BR", "PT: SIC") vira o país e sai do nome
        const fim = /^(.*\S)\s+(?:[-–|:]\s*)?([A-Za-z]{2,3})$/.exec(o.nome), ini = /^([A-Za-z]{2,3})\s*[:|\-–]\s*(\S.*)$/.exec(o.nome);
        if (fim && PAISES_TAG[fim[2].toLowerCase()] && fim[2] === fim[2].toUpperCase()) { if (!o.pais) o.pais = PAISES_TAG[fim[2].toLowerCase()]; o.nome = fim[1]; }
        else if (ini && PAISES_TAG[ini[1].toLowerCase()] && ini[1] === ini[1].toUpperCase()) { if (!o.pais) o.pais = PAISES_TAG[ini[1].toLowerCase()]; o.nome = ini[2]; }
        o.pais = paisDe(o);
        o.idioma = idiomaDe(c, o.pais);
        o.tipo = o.tipo || tipoDe(o);
        o.qualidade = o.qualidade || qualidadeDe(Object.assign({}, o, { nome: o.nomeOriginal }));
        o.formato = formatoDe(o.url);
        o.chave = chaveDe(o);
        if (!o.id) o.id = idDe(o.url);
        detectarVideo(o);
        return o;
    }
    /** id estável do canal pelo link (mesmo link = mesmo id em qualquer lista). */
    function idDe(url) {
        let h = 2166136261;
        const s = String(url || '');
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return 'c' + (h >>> 0).toString(36);
    }

    // ------------------------------------------------------------------
    // Cópias do mesmo canal
    // ------------------------------------------------------------------
    /** Chave de "mesmo canal": tvg-id quando há; senão o nome limpo + país (Globo SP ≠ Globo RJ; Disney BR ≠ Disney MX). */
    function chaveDe(c) {
        if (c.tvgId && !/^(none|null|undefined|0)$/i.test(c.tvgId)) return 'id:' + c.tvgId.toLowerCase();
        const n = norm(c.nome).replace(/\b(tv|canal|channel|ao vivo|live|24h|24 horas)\b/g, ' ').replace(/\s+/g, ' ').trim();
        return 'n:' + (n || norm(c.url)) + '|' + (c.pais || '');
    }

    /** Peso para escolher a principal: vivo > rápido > qualidade > mais confiável. */
    const PESO_Q = { '4K': 4, FHD: 3, HD: 2, SD: 1, '': 1.5 };
    function nota(c) {
        const t = c.teste || {};
        const vivo = t.status === 'vivo' ? 1000 : t.status === 'lento' ? 600 : t.status === 'pede-ua' ? 500 : !t.status ? 300 : 0;
        const conf = c.historico && c.historico.length ? (c.historico.filter(Boolean).length / c.historico.length) * 200 : 100;
        const rapido = t.ms ? Math.max(0, 100 - t.ms / 100) : 50;
        const q = (PESO_Q[c.qualidade] || 1) * 40;
        return vivo + conf + rapido + q;
    }

    /**
     * Junta cópias do mesmo canal. Devolve grupos { chave, principal, reservas[], duvida } — a principal é a de maior nota,
     * a não ser que o usuário tenha fixado outra (c.fixo = true).
     */
    function agrupar(canais) {
        const mapa = new Map();
        for (const c of canais) {
            if (c.desativado) continue;
            const k = c.chave || chaveDe(c);
            if (!mapa.has(k)) mapa.set(k, []);
            mapa.get(k).push(c);
        }
        const grupos = [];
        for (const [chave, lista] of mapa) {
            const fixo = lista.find(c => c.fixo);
            const ordenada = lista.slice().sort((a, b) => nota(b) - nota(a));
            const principal = fixo || ordenada[0];
            const reservas = ordenada.filter(c => c !== principal);
            // dúvida: cópias com nota quase igual e qualidades diferentes, ou nomes muito diferentes com o mesmo tvg-id
            const duvida = reservas.length > 0 && !fixo && (Math.abs(nota(principal) - nota(reservas[0])) < 5 && principal.qualidade !== reservas[0].qualidade);
            grupos.push({ chave, principal, reservas, duvida });
        }
        return grupos;
    }

    // ------------------------------------------------------------------
    // Filtrar
    // ------------------------------------------------------------------
    /** f = { busca, idiomas:Set, tipos:Set, paises:Set, status:Set, semLogo, duplicados, soVivos } */
    /** gêneros do item: os que a lista trouxe + os do TMDB (para filtrar "só Animação" etc.) */
    function generosDe(c) {
        const v = c.video || {}, d = v.dados || {}, l = c.lista || {};
        const out = [].concat(l.generos || [], c.generosLista || [], d.generos || [], v.genero ? [v.genero] : []).map(x => String(x).trim()).filter(Boolean);
        const vistos = new Set(); return out.filter(x => { const k = norm(x); if (vistos.has(k)) return false; vistos.add(k); return true; });
    }
    function filtrar(canais, f = {}, contagemChave) {
        const busca = norm(f.busca || '');
        const partes = busca ? busca.split(' ') : [];
        const tem = (s, v) => !s || !s.size || s.has(v);
        return canais.filter((c) => {
            if (partes.length) { const alvo = norm(c.nome + ' ' + c.grupo + ' ' + c.tvgId + ' ' + c.nomeOriginal); if (!partes.every(p => alvo.includes(p))) return false; }
            if (!tem(f.idiomas, c.idioma || '?')) return false;
            if (!tem(f.tipos, c.tipo)) return false;
            if (!tem(f.naturezas, c.natureza || 'canal')) return false;
            if (f.grupos && f.grupos.size && !f.grupos.has(grupoDe(c))) return false;
            if (f.generos && f.generos.size) { const gs = generosDe(c); if (!(gs.length ? gs.some(g => f.generos.has(g)) : f.generos.has('?'))) return false; }
            if (!tem(f.paises, c.pais || '?')) return false;
            if (f.status && f.status.size && !f.status.has((c.teste && c.teste.status) || 'nao-testado')) return false;
            if (f.soVivos && !(c.teste && (c.teste.status === 'vivo' || c.teste.status === 'lento'))) return false;
            if (f.semLogo && c.logo) return false;
            if (f.semGuia && c.epgId) return false;
            if (f.semCategoria && c.grupoSaida) return false;
            if (f.duplicados && contagemChave && (contagemChave.get(c.chave) || 0) < 2) return false;
            return true;
        });
    }
    /** Quantos canais em cada valor (para os chips de filtro): { idiomas: Map, tipos: Map, paises: Map, status: Map } */
    function contar(canais) {
        const r = { idiomas: new Map(), tipos: new Map(), paises: new Map(), status: new Map(), chaves: new Map(), naturezas: new Map(), grupos: new Map(), generos: new Map() };
        const mais = (m, k) => m.set(k, (m.get(k) || 0) + 1);
        canais.forEach(c => { mais(r.idiomas, c.idioma || '?'); mais(r.tipos, c.tipo); mais(r.paises, c.pais || '?'); mais(r.status, (c.teste && c.teste.status) || 'nao-testado'); mais(r.chaves, c.chave); mais(r.naturezas, c.natureza || 'canal'); mais(r.grupos, grupoDe(c)); const gs = generosDe(c); if (gs.length) gs.forEach(g => mais(r.generos, g)); else mais(r.generos, '?'); });
        return r;
    }

    // ------------------------------------------------------------------
    // Exportar
    // ------------------------------------------------------------------
    const aspas = (s) => String(s == null ? '' : s).replace(/"/g, "'").replace(/[\r\n]+/g, ' ');
    /** M3U: um #EXTINF por canal; User-Agent/Referer em #EXTVLCOPT; reservas como linhas extras do mesmo canal (opcional). */
    function gerarM3U(canais, opts = {}) {
        const guias = guiasDaLista(canais, opts.epg);
        const linhas = ['#EXTM3U' + (guias.length ? ` url-tvg="${aspas(guias.join(','))}"` : '')];
        for (const c of canais) {
            const a = [];
            if (c.tvgId) a.push(`tvg-id="${aspas(c.tvgId)}"`);
            a.push(`tvg-name="${aspas(c.nome)}"`);
            if (c.logo) a.push(`tvg-logo="${aspas(c.logo)}"`);
            if (c.pais) a.push(`tvg-country="${aspas(c.pais)}"`);
            if (c.idioma) a.push(`tvg-language="${aspas(c.idioma)}"`);
            if (c.epgShift) a.push(`tvg-shift="${aspas(String(c.epgShift))}"`);
            a.push(`group-title="${aspas(c.grupoSaida || c.tipo || c.grupo || 'Variados')}"`);
            const cab = c.headers || {};
            const uma = (url) => {
                linhas.push(`#EXTINF:-1 ${a.join(' ')},${String(c.nome).replace(/[\r\n]+/g, ' ')}`);
                if (cab['User-Agent']) linhas.push('#EXTVLCOPT:http-user-agent=' + cab['User-Agent']);
                if (cab.Referer) linhas.push('#EXTVLCOPT:http-referrer=' + cab.Referer);
                linhas.push(url);
            };
            uma(c.url);
            if (opts.reservasComoLinhas) (c.reservas || []).forEach(r => uma(typeof r === 'string' ? r : r.url));
        }
        return linhas.join('\n') + '\n';
    }
    /** JSON no formato que o Cartoonzine Cloud e o Studio leem (reservas em "mirrors"). */
    // campos do "Completar pelo TMDB" → o que eles trazem dos dados do TMDB (o resto, como ano e duração, vem sempre)
    const DADOS_DO_CAMPO = { capa: ['capa'], banner: ['banner'], previa: ['previa'], bannerLogo: ['logo'], descricao: ['descricao'], generos: ['generos'], classificacao: ['classificacao'], imdb: ['imdb', 'notaImdb', 'votosImdb'], tmdb: ['tmdb', 'nota'] };
    function dadosPelosCampos(d, campos) {
        if (!campos) return d;
        const o = Object.assign({}, d);
        for (const [campo, ks] of Object.entries(DADOS_DO_CAMPO)) if (!campos.includes(campo)) ks.forEach(k => delete o[k]);
        return o;
    }
    function gerarJSON(canais) { return JSON.stringify(objetosJSON(canais), null, 2) + '\n'; }
    /** os itens no formato do JSON do app (o gerarJSON é isto, com indentação) */
    function objetosJSON(canais) {
        return canais.map(c => {
            const o = { name: c.nome, url: c.url };
            const res = (c.reservas || []).map(r => (typeof r === 'string' ? r : r.url)).filter(Boolean);
            if (res.length) o.mirrors = res;
            if (c.logo) o.logo = c.logo;
            o.group = c.grupoSaida || c.tipo || c.grupo || 'Variados';
            if (c.tvgId) o.tvgId = c.tvgId;
            if (c.epgGuia) o.epg = c.epgGuia;
            if (c.epgShift) o.tvgShift = c.epgShift;
            if (c.pais) o.country = c.pais;
            if (c.idioma) o.language = c.idioma;
            if (c.headers && Object.keys(c.headers).length) o.headers = c.headers;
            if (ehVideo(c) && c.video) {                       // vídeo: os campos que o DB do Cartoonzine lê
                const v = c.video;
                o.title = c.natureza === 'episodio' && v.serie ? `${v.serie} S${String(v.temporada || 1).padStart(2, '0')}E${String(v.episodio != null ? v.episodio : 1).padStart(2, '0')}${v.titulo ? ' ' + v.titulo : ''}` : (v.titulo || c.nome);
                if (v.ano) o.year = v.ano;
                if (c.natureza === 'episodio') { if (v.serie) o.serie = v.serie; if (v.temporada != null) o.season = v.temporada; if (v.episodio != null) o.episode = v.episodio; }
                if (v.audio) o.audios = v.audio === 'dual' ? ['dublado', 'legendado'] : [v.audio];
                if (v.qualidade) o.qualidadeMax = v.qualidade;
                if (v.genero) o.genre = v.genero;
                const d = dadosPelosCampos(v.dados || {}, c.tmdbPref && c.tmdbPref.campos);   // TMDB (capa, banner, sinopse, nota…)
                if (d.capa || c.logo) o.thumb = d.capa || c.logo;
                if (d.banner) o.bannerThumb = d.banner;
                if (d.previa) o.previewThumb = d.previa;            // tela de prévia: outra imagem grande (não repete o banner)
                if (d.descricao) o.desc = d.descricao;
                if (d.logo) o.logo = d.logo; else delete o.logo;   // em vídeo, "logo" é o PNG do título (o tvg-logo da lista já virou a capa)
                if (d.tmdb) { o.tmdbId = String(d.tmdb).split('/').pop(); o.tmdbTipo = String(d.tmdb).split('/')[0]; if (d.porBusca) o.tmdbPorNome = true; }
                if (d.imdb) o.imdbId = d.imdb;
                if (d.nota) o.rating = d.nota;
                if (d.notaImdb) { o.imdbRating = d.notaImdb; o.rating = d.notaImdb; if (d.votosImdb) o.imdbVotes = d.votosImdb; }
                if (d.popularidade) o.popularity = d.popularidade;
                if (d.duracao) o.runtime = d.duracao;
                if (d.classificacao) o.age = d.classificacao;
                if (!o.year && d.ano && c.natureza === 'filme') o.year = d.ano;
                if (!o.genre && d.generos) o.genre = d.generos;
                // TMDB automático do envio: "só o que falta" mantém a thumb que veio na lista; estilo Cartoonzine = banner no fundo do topo
                const pref = c.tmdbPref;
                if (pref && pref.modo !== 'tudo' && c.logo) o.thumb = c.logo;
                if (pref && pref.fundo && o.bannerThumb) o.bgImg = 'banner';
                // 🖼 ficha arrumada à mão (a da série vale para todos os episódios; a do item manda por cima)
                const f = Object.assign({}, c.fichaSerie, c.ficha);
                if (f.capa) o.thumb = f.capa;
                if (f.banner) o.bannerThumb = f.banner;
                if (f.previa) o.previewThumb = f.previa;
                if (f.descricao) o.desc = f.descricao;
                if (f.generos && f.generos.length) o.genre = f.generos;
                if (f.classificacao) o.age = f.classificacao;
                if (f.bannerLogo) { o.logo = f.bannerLogo; o.bannerlogo = f.bannerLogo; }
                if (f.bannerVideo) o.preview = f.bannerVideo;
                if (f.bannerSkin) o.bannerSkin = f.bannerSkin;
                if (f.bannerFx) o.bannerFx = f.bannerFx;
                if (f.fundoImagem === 'banner') o.bgImg = 'banner';
                if (Number.isFinite(+f.posFundo) && f.posFundo !== '') o.bgPosY = Math.max(0, Math.min(100, Math.round(+f.posFundo)));
                if (f.destaque) o.destaque = true;
                if (f.tmdb) { o.tmdbId = String(f.tmdb).split('/').pop(); o.tmdbTipo = String(f.tmdb).split('/')[0]; delete o.tmdbPorNome; }   // escolhido à mão: confiável
                if (f.nota) o.rating = f.nota;
                if (f.imdb) o.imdbId = f.imdb;
                if (f.notaImdb) { o.imdbRating = f.notaImdb; o.rating = f.notaImdb; if (f.votosImdb) o.imdbVotes = f.votosImdb; }
                delete o.tvgId; delete o.epg; delete o.tvgShift;
            }
            return o;
        });
    }
    /** TXT simples: "Nome, link" por linha. */
    function gerarTXT(canais) { return canais.map(c => `${c.nome}, ${c.url}`).join('\n') + '\n'; }

    /** Canal da lista nova a partir de um grupo: a principal com as outras cópias como reserva. */
    function canalComReservas(grupo) {
        return Object.assign({}, grupo.principal, { reservas: grupo.reservas.map(r => r.url).filter(u => u !== grupo.principal.url) });
    }

    return {
        IDIOMAS, definirIdioma, CATEGORIAS, DESTINOS_ESPECIAIS, usarCategorias, idiomaStudio, destinoPadrao, itemParaStudio, planejarImportacao, itemFinal, ehVOD, destinoVOD, planejarVOD, receitaPadrao, passaReceita, montarReceita, confianca, idReceita,
        arvoreSeries, mapaStudio, jaNaStudio, arrumarNome,
        chaveTMDB, pedidoTMDB, dadosDoTMDB, aplicarTMDB,
        NATUREZAS, dadosDaLista, analisarVideo, naturezaDe, ehVideo, colecaoVideo, detectarVideo, ajustarVideo, videoTexto,
        CAMPOS_FICHA_SC, juntarFicha, chaveSerie, aplicarAjustesEnvio, generosDe,
        SEM_GRUPO, grupoDe, mapaGrupos, sugerirGrupo, analisarGrupos, aplicarSugestoes, moverGrupo,
        colecoesSidechain, envioPadrao, linksDoEnvio, passaFiltros, idEnvio, chaveSC, mesmoDestino, destinoTexto, passaRegra, rotaDe, itemNoDestino, saidaDe, montarSidechain, fonteDaSaida, sugerirRegras, marcarVistos, categoriaSugerida, definirCategoria, nomeEPG, chavesEPG, dataXMLTV, canaisXMLTV, programasXMLTV, acharNoGuia, ligarGuia, guiasDaLista, lerLista, lerM3U, lerJSON, lerTexto, ehStreamHLS, ehLinkDeCanal, linkDireto, nomeDoLink, canalDoLink, completar, limparNome, qualidadeDe, paisDe, idiomaDe, tipoDe, formatoDe, chaveDe, idDe,
        agrupar, nota, filtrar, contar, gerarM3U, gerarJSON, objetosJSON, gerarTXT, canalComReservas, norm, TIPOS: TIPOS.map(t => t[0]).concat('Variados')
    };
});
