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
        const entradas = itens.map((it) => {
            const a = C.analisarNome(it.nomeOriginal || it.nome);
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
            const colId = opts.destinos && opts.destinos.has(chave) ? opts.destinos.get(chave) : destinoVOD(item0, dicas.get(C.normText(item0.nome)) || dicas.get(C.normText(bruto.nome)) || '', cols);
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
            if (f.semGuia && c.epgId) return false;
            if (f.semCategoria && c.grupoSaida) return false;
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
    function gerarJSON(canais) {
        return JSON.stringify(canais.map(c => {
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
        IDIOMAS, definirIdioma, CATEGORIAS, DESTINOS_ESPECIAIS, usarCategorias, idiomaStudio, destinoPadrao, itemParaStudio, planejarImportacao, itemFinal, ehVOD, destinoVOD, planejarVOD, receitaPadrao, passaReceita, montarReceita, confianca, idReceita, categoriaSugerida, definirCategoria, nomeEPG, chavesEPG, dataXMLTV, canaisXMLTV, programasXMLTV, acharNoGuia, ligarGuia, guiasDaLista, lerLista, lerM3U, lerJSON, lerTexto, ehStreamHLS, ehLinkDeCanal, linkDireto, nomeDoLink, canalDoLink, completar, limparNome, qualidadeDe, paisDe, idiomaDe, tipoDe, formatoDe, chaveDe, idDe,
        agrupar, nota, filtrar, contar, gerarM3U, gerarJSON, gerarTXT, canalComReservas, norm, TIPOS: TIPOS.map(t => t[0]).concat('Variados')
    };
});
