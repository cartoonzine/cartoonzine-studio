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
                    grupo: a['group-title'] || grupo || '', pais: a['tvg-country'] || '', idioma: a['tvg-language'] || '',
                    headers: {}
                };
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
                headers: Object.assign({}, o.headers || {}, o.userAgent || o.user_agent ? { 'User-Agent': o.userAgent || o.user_agent } : {}, o.referer || o.referrer ? { Referer: o.referer || o.referrer } : {})
            });
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
        if (/\.(mp4|m4v|webm|mkv|mov|avi|ogv|mp3|aac|m4a|ogg|opus)$/.test(p)) return 'arquivo';
        return 'desconhecido';
    }

    /** Preenche o que dá para descobrir sozinho; nunca apaga o que veio da lista. */
    function completar(c) {
        const o = Object.assign({ headers: {}, reservas: [] }, c);
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
    function filtrar(canais, f = {}, contagemChave) {
        const busca = norm(f.busca || '');
        const partes = busca ? busca.split(' ') : [];
        const tem = (s, v) => !s || !s.size || s.has(v);
        return canais.filter((c) => {
            if (partes.length) { const alvo = norm(c.nome + ' ' + c.grupo + ' ' + c.tvgId + ' ' + c.nomeOriginal); if (!partes.every(p => alvo.includes(p))) return false; }
            if (!tem(f.idiomas, c.idioma || '?')) return false;
            if (!tem(f.tipos, c.tipo)) return false;
            if (!tem(f.paises, c.pais || '?')) return false;
            if (f.status && f.status.size && !f.status.has((c.teste && c.teste.status) || 'nao-testado')) return false;
            if (f.soVivos && !(c.teste && (c.teste.status === 'vivo' || c.teste.status === 'lento'))) return false;
            if (f.semLogo && c.logo) return false;
            if (f.duplicados && contagemChave && (contagemChave.get(c.chave) || 0) < 2) return false;
            return true;
        });
    }
    /** Quantos canais em cada valor (para os chips de filtro): { idiomas: Map, tipos: Map, paises: Map, status: Map } */
    function contar(canais) {
        const r = { idiomas: new Map(), tipos: new Map(), paises: new Map(), status: new Map(), chaves: new Map() };
        const mais = (m, k) => m.set(k, (m.get(k) || 0) + 1);
        canais.forEach(c => { mais(r.idiomas, c.idioma || '?'); mais(r.tipos, c.tipo); mais(r.paises, c.pais || '?'); mais(r.status, (c.teste && c.teste.status) || 'nao-testado'); mais(r.chaves, c.chave); });
        return r;
    }

    // ------------------------------------------------------------------
    // Exportar
    // ------------------------------------------------------------------
    const aspas = (s) => String(s == null ? '' : s).replace(/"/g, "'").replace(/[\r\n]+/g, ' ');
    /** M3U: um #EXTINF por canal; User-Agent/Referer em #EXTVLCOPT; reservas como linhas extras do mesmo canal (opcional). */
    function gerarM3U(canais, opts = {}) {
        const linhas = ['#EXTM3U' + (opts.epg ? ` url-tvg="${aspas(opts.epg)}"` : '')];
        for (const c of canais) {
            const a = [];
            if (c.tvgId) a.push(`tvg-id="${aspas(c.tvgId)}"`);
            a.push(`tvg-name="${aspas(c.nome)}"`);
            if (c.logo) a.push(`tvg-logo="${aspas(c.logo)}"`);
            if (c.pais) a.push(`tvg-country="${aspas(c.pais)}"`);
            if (c.idioma) a.push(`tvg-language="${aspas(c.idioma)}"`);
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
    function gerarJSON(canais) {
        return JSON.stringify(canais.map(c => {
            const o = { name: c.nome, url: c.url };
            const res = (c.reservas || []).map(r => (typeof r === 'string' ? r : r.url)).filter(Boolean);
            if (res.length) o.mirrors = res;
            if (c.logo) o.logo = c.logo;
            o.group = c.grupoSaida || c.tipo || c.grupo || 'Variados';
            if (c.tvgId) o.tvgId = c.tvgId;
            if (c.pais) o.country = c.pais;
            if (c.idioma) o.language = c.idioma;
            if (c.headers && Object.keys(c.headers).length) o.headers = c.headers;
            return o;
        }), null, 2) + '\n';
    }
    /** TXT simples: "Nome, link" por linha. */
    function gerarTXT(canais) { return canais.map(c => `${c.nome}, ${c.url}`).join('\n') + '\n'; }

    /** Canal da lista nova a partir de um grupo: a principal com as outras cópias como reserva. */
    function canalComReservas(grupo) {
        return Object.assign({}, grupo.principal, { reservas: grupo.reservas.map(r => r.url).filter(u => u !== grupo.principal.url) });
    }

    return {
        lerLista, lerM3U, lerJSON, lerTexto, ehStreamHLS, ehLinkDeCanal, nomeDoLink, canalDoLink, completar, limparNome, qualidadeDe, paisDe, idiomaDe, tipoDe, formatoDe, chaveDe, idDe,
        agrupar, nota, filtrar, contar, gerarM3U, gerarJSON, gerarTXT, canalComReservas, norm, TIPOS: TIPOS.map(t => t[0]).concat('Variados')
    };
});
