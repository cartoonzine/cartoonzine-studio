// ==========================================================================
// CÓPIA do cz-banner.js do app Cartoonzine, usada SÓ pela prévia da 🎬 Vitrine do Studio.
// Quando o banner do app mudar, copie o arquivo novo para cá (painel/vitrine/cz-banner.js)
// para a prévia continuar igual ao que aparece na home.
// ==========================================================================
// 🎬 CZBanner — BANNER DE DESTAQUE DA HOME (skins + prévia + efeitos + notas)
// --------------------------------------------------------------------------
// Banner em tela cheia, estilo streaming:
//   • SKINS (Daileon Dashboard):  cinema (padrão) · arcade · poster · auto (por tipo)
//   • PRÉVIA estilo Netflix (liga/desliga): o vídeo entra por cima da imagem após alguns segundos.
//       - jogos: usa o vídeo do item de games (preview/video/trailer)
//       - filmes/canais: usa o MESMO link que o player usa (item.url); HLS .m3u8 via hls.js se existir
//   • EFEITOS de imagem: none · crt · vhs · scan · cinema · neon · bw
//   • NOTAS de cinema (IMDb/TMDB/Rotten/OMDb) numa faixa de chips elegante, via CZInfo
//   • LOGO PNG (CZLogo) com ALTURA equilibrada · sombreado à esquerda · entrada do logo
//   • Botões gêmeos: "Assistir/Jogar" (ciano cristal + ícone) e "Wiki Sabe" (vidro + borda RGB)
//
// DESTAQUES: itens com  destaque:true  (ordem por  destaqueOrdem ) — regra única para legacy, Studio e cloud.
// Resolve id OU slug. Botões chamam setView('player'|'emulator', slug||id).
//
// INTEGRAÇÃO
//   index.html (depois de cz-info.js e cz-logo.js):  <script src="cz-banner.js"></script>
//   ui-components.js:   banner: () => CZBanner.html(),
//   app.js:             apague o setInterval do loop antigo (o CZBanner cuida do loop)
//   Dashboard:          CZBanner.montarControles('#container')
// ==========================================================================
(function () {
    'use strict';
    if (window.CZBanner) return;

    var SKINS = ['cinema', 'arcade', 'poster', 'vintage'];
    var FX = ['none', 'crt', 'vhs', 'scan', 'cinema', 'neon', 'bw'];
    var FX_NOME = { none: 'Padrão', crt: 'CRT Tubo', vhs: 'VHS / Interferência', scan: 'Scanlines', cinema: 'Cinema', neon: 'Neon Moderno', bw: 'P&B Retrô' };
    var SKIN_NOME = { auto: 'Automático (por tipo)', cinema: 'Cinema', arcade: 'Arcade CRT', poster: 'Pôster', vintage: 'Vintage CRT' };
    var PADRAO = { skin: 'auto', preview: true, fx: 'auto', intervalo: 9000, previewInicioFilme: 180, previewDuracao: 24000 };

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    // texto da sinopse com tamanho fixo: abrevia com … para nunca estourar pra dentro do banner
    function resumo(s, max) { s = String(s == null ? '' : s).trim(); max = max || 150; return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : s; }

    function lerCfg() { var c = {}; try { c = JSON.parse(localStorage.getItem('cz_banner_cfg') || '{}') || {}; } catch (e) {} return Object.assign({}, PADRAO, c); }
    function salvarCfg(c) { try { localStorage.setItem('cz_banner_cfg', JSON.stringify(c)); } catch (e) {} }

    function catalogo() { var DB = window.DB || {}; return (Array.isArray(DB.videos) ? DB.videos : []).concat(Array.isArray(DB.games) ? DB.games : []); }
    function acharPorId(x) { var l = catalogo(); for (var i = 0; i < l.length; i++) { var it = l[i]; if (String(it.id) === String(x) || (it.slug && String(it.slug) === String(x))) return it; } return null; }
    function destaques() {
        var vistos = {}, out = [];
        catalogo().filter(function (it) { return it && (it.destaque === true || it.destaque === 'true'); })
            .sort(function (a, b) { return (a.destaqueOrdem || 999) - (b.destaqueOrdem || 999); })
            .forEach(function (it) { var k = String(it.slug || it.id); if (!vistos[k]) { vistos[k] = 1; out.push(it); } });   // sem repetidos
        if (!out.length) console.warn('[CZBanner] nenhum item com destaque:true no catálogo — o banner fica vazio.');
        return out;
    }
    function tipoDe(it) {
        return {
            game: !!(it.console || /game|jogo|arcade/i.test([it.cat, it.categoria, it.tipo].join(' '))),
            live: it.categoryType === 'live' || it.isLive === true || /24h|ao vivo|live/i.test([it.cat, it.categoria].join(' '))
        };
    }
    // PADRÃO = cinema (design nº 1 aprovado) para TUDO, igual ao banner antigo (limpo).
    // arcade/poster e os efeitos CRT/VHS continuam como SKINS manuais no Daileon Dashboard.
    function skinDe(it, cfg) { if (it.bannerSkin && SKINS.indexOf(it.bannerSkin) >= 0) return it.bannerSkin; if (cfg.skin && cfg.skin !== 'auto') return cfg.skin; return 'cinema'; }
    function fxDe(it, cfg) { if (it.bannerFx && FX.indexOf(it.bannerFx) >= 0) return it.bannerFx; if (cfg.fx && cfg.fx !== 'auto') return cfg.fx; return 'none'; }

    function injetarCSS() { if (document.getElementById('cz-banner-css')) return; var s = document.createElement('style'); s.id = 'cz-banner-css'; s.textContent = CSS; document.head.appendChild(s); }

    var S = { i: 0, timer: null, lista: [], raiz: null, obs: null, prevHls: null, fichaSeq: 0, autoOff: false };

    // ---------- ícones ----------
    // ícone ORIGINAL do Wiki Sabe: círculo ciano com o livro branco dentro
    function bookSvg() { return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>'; }
    // ícones ORIGINAIS do 1º botão: 🎮 jogo · 📺 ao vivo · ▶ filme
    function iconePlay(game, live) {
        if (game) return '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10a5 5 0 0 1 5 5 3.5 3.5 0 0 1-6.3 2.1l-.4-.6H8.7l-.4.6A3.5 3.5 0 0 1 2 12a5 5 0 0 1 5-5Zm-1 3v1.5H4.5V13H6v1.5h1.5V13H9v-1.5H7.5V10H6Zm10.5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm2 2.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>';
        if (live) return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12.5" rx="2"/><path stroke-linecap="round" d="M8.5 21h7M9 6l3-2.8L15 6"/></svg>';
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2Z"/></svg>';
    }

    function fmtDur(m) { m = +m || 0; if (!m) return ''; return m >= 60 ? (Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'min' : '')) : m + ' min'; }
    // linha de dados limpa (igual ao mockup):  1987 • 4 temporadas • Animação · Sci-Fi • HD • ★ 8.1
    // 'f' = ficha do CZInfo (IMDb/TMDB/OMDb) quando chega; antes disso usa os dados do próprio catálogo.
    function metaLinha(it, t, f) {
        f = f || {}; var n = f.notas || {}, sep = '<span class="czb-dot">•</span>', out = [];
        var ano = f.ano || it.year || it.ano; if (ano) out.push('<span>' + esc(ano) + '</span>');
        var temp = it.temporadas || it.seasons;
        if (!t.game && temp) out.push('<span>' + esc(temp) + ' temporada' + (+temp > 1 ? 's' : '') + '</span>');
        else if (t.game && it.console) out.push('<span>' + esc(it.console) + '</span>');
        else { var dur = f.duracao || it.duracao || it.duration; if (dur) out.push('<span>' + esc(fmtDur(dur)) + '</span>'); }
        var g = (Array.isArray(f.generos) && f.generos.length) ? f.generos.slice(0, 2).join(' · ')
            : (it.genre || it.genero || (Array.isArray(it.generos) ? it.generos.slice(0, 2).join(' · ') : ''));
        if (g) out.push('<span>' + esc(g) + '</span>');
        out.push('<span class="czb-hd">' + esc(it.quality || it.qualidade || 'HD') + '</span>');
        var nota = n.imdb != null ? n.imdb : (n.tmdb != null ? n.tmdb : (n.mal != null ? n.mal : (it.nota != null ? it.nota : it.rating)));
        if (nota != null && nota !== '') out.push('<span class="czb-nota"><b>★</b> ' + esc(nota) + '</span>');
        return out.join(sep);
    }

    function html() {
        injetarCSS();
        return ''
            + '<div id="cz-banner" class="czb" data-skin="cinema" data-fx="none">'
            +   '<div class="czb-art" id="czb-art"></div>'
            +   '<div class="czb-glow" id="czb-glow" aria-hidden="true"></div>'
            +   '<video class="czb-prev" id="czb-prev" muted loop playsinline preload="none" aria-hidden="true"></video>'
            +   '<div class="czb-veil left"></div><div class="czb-veil bottom"></div><div class="czb-veil vig"></div>'
            +   '<div class="czb-scan"></div><div class="czb-crt"></div><div class="czb-vhs"></div>'
            +   '<div class="czb-cine"></div><div class="czb-neon"></div><div class="czb-grain"></div>'
            +   '<div class="czb-crtmask" aria-hidden="true"></div>'
            +   '<div class="czb-arcade-top" aria-hidden="true"><span class="c">1P&nbsp;&nbsp;00</span><span class="hi">HIGH SCORE&nbsp;&nbsp;40000</span><span class="c">2P&nbsp;&nbsp;00</span></div>'
            +   '<button class="czb-mute" id="czb-mute" aria-label="Ativar som da prévia" hidden>🔇</button>'
            +   '<div class="czb-poster" id="czb-poster" aria-hidden="true"><div class="shine"></div></div>'
            +   '<div class="czb-info" id="czb-info"></div>'
            +   '<div class="czb-dots" id="czb-dots" role="group" aria-label="Destaques"></div>'
            + '</div>';
    }

    function render(n) {
        var raiz = S.raiz; if (!raiz) return;
        var cfg = lerCfg();
        var it = S.lista[n]; if (!it) { raiz.querySelector('#czb-info').innerHTML = ''; return; }
        var t = tipoDe(it), skin = skinDe(it, cfg), fx = fxDe(it, cfg), isGame = t.game, isLive = t.live;
        raiz.dataset.skin = skin; raiz.dataset.fx = fx;

        var img = it.bannerThumb || it.thumb || it.poster || '';
        raiz.querySelector('#czb-art').style.backgroundImage = img ? "url('" + encodeURI(img) + "')" : 'none';
        raiz.querySelector('#czb-glow').style.backgroundImage = raiz.querySelector('#czb-art').style.backgroundImage;
        raiz.querySelector('#czb-poster').style.backgroundImage = "url('" + encodeURI(it.poster || img) + "')";

        var tituloTxt = isGame ? (it.title || it.name || '') : (it.serie || it.title || it.name || '');
        // selo divertido ao lado do destaque: jogo = INSERT COIN (âmbar) · filme/vídeo = Let's Watch (roxo)
        var tag = isGame
            ? ' <span class="czb-sep">|</span> <span class="czb-coin">INSERT COIN</span>'
            : ' <span class="czb-sep">|</span> <span class="czb-lets">Let\'s Watch</span>';
        var eyebrow = isGame ? ('Destaque Retrô' + (it.console ? ': ' + esc(it.console) : '') + tag)
            : isLive ? ('<span class="live"><i></i>24H · AO VIVO</span>' + tag)
            : ('Destaque de Hoje' + tag);
        var rotulo = isGame ? 'Jogar Agora' : 'Assistir Agora';
        var acao = isGame ? 'emulator' : 'player';
        var idx = skin === 'poster' ? '<div class="czb-idx">Em destaque <b>' + String(n + 1).padStart(2, '0') + '</b> / ' + String(S.lista.length).padStart(2, '0') + '</div>' : '';

        raiz.querySelector('#czb-info').innerHTML = ''
            + idx
            + '<span class="czb-eyebrow">' + eyebrow + '</span>'
            + '<div class="czb-logo" id="czb-logo"><h1 class="czb-wm">' + esc(tituloTxt) + '</h1></div>'
            + '<div class="czb-meta" id="czb-meta">' + metaLinha(it, t) + '</div>'
            + '<p class="czb-desc">' + esc(resumo(it.desc || it.descricao || it.sinopse || '', 150)) + '</p>'
            + '<div class="czb-btns">'
            +   '<button id="banner-btn-1" class="czb-btn play nav-item" onkeydown="CZBanner._nav(event,1)"><span class="ic">' + iconePlay(isGame, isLive) + '</span>' + esc(rotulo) + '</button>'
            +   '<button id="banner-btn-2" class="czb-btn ghost nav-item" onkeydown="CZBanner._nav(event,2)" data-termo="' + esc(it.serie || it.title || '') + '"><span class="ic">' + bookSvg() + '</span>Wiki Sabe</button>'
            + '</div>';

        var alvo = it.id != null ? it.id : it.slug;     // o player/emulador recebem o id (o slug é o nome público)
        raiz.querySelector('#banner-btn-1').onclick = function () { if (typeof window.setView === 'function') window.setView(acao, alvo); };
        var b2 = raiz.querySelector('#banner-btn-2');
        b2.onclick = function () { if (typeof window.WikiSabe === 'function') window.WikiSabe(b2.getAttribute('data-termo')); };

        // logo PNG (CZLogo: TMDB/jogos) → bannerlogo → texto. ALTURA grande (proporção do banner antigo).
        var logoEl = raiz.querySelector('#czb-logo');
        // logo escolhido à mão (Vitrine do Studio: "bannerlogo") vence a busca automática do CZLogo
        if (it.bannerlogo) {
            var imLogo = document.createElement('img');
            imLogo.className = 'czb-logoimg'; imLogo.alt = tituloTxt; imLogo.src = it.bannerlogo;
            imLogo.onerror = function () { logoEl.innerHTML = '<h1 class="czb-wm">' + esc(tituloTxt) + '</h1>'; };   // link quebrado: volta ao nome
            logoEl.innerHTML = ''; logoEl.appendChild(imLogo);
        }
        else if (window.CZLogo && window.CZLogo.aplicar) window.CZLogo.aplicar(logoEl, it, { alt: tituloTxt, ao: 'left', altura: 'clamp(120px,19vh,200px)', largura: 'min(82%,660px)' });
        else if (it.logo) logoEl.innerHTML = '<img class="czb-logoimg" src="' + esc(it.logo) + '" alt="' + esc(tituloTxt) + '">';

        // dados de cinema (IMDb/TMDB/OMDb) — preenchem a nota ★ na linha limpa, via CZInfo (só filmes/séries)
        if (!isGame && window.CZInfo && window.CZInfo.ficha) {
            var seq = ++S.fichaSeq;
            window.CZInfo.ficha(it).then(function (f) {
                if (seq !== S.fichaSeq) return;
                var meta = raiz.querySelector('#czb-meta');
                if (meta && f) meta.innerHTML = metaLinha(it, t, f);
            }).catch(function () {});
        }

        prepararPrevia(it, t, cfg);

        pintarDots();
        try { window.dispatchEvent(new CustomEvent('cz:banner:change', { detail: { index: S.i, total: S.lista.length } })); } catch (e) {}
        raiz.classList.remove('show'); void raiz.offsetWidth; raiz.classList.add('show');

        // agenda a próxima troca do carrossel: se houver PRÉVIA, espera a prévia tocar bastante
        // (senão o vídeo mal aparecia antes de trocar). Sem prévia, usa o intervalo normal.
        var vaiPreviar = cfg.preview && !!fontePrevia(it, t) && !matchMedia('(prefers-reduced-motion:reduce)').matches;
        agenda(vaiPreviar ? (3000 + (cfg.previewDuracao || 24000)) : Math.max(5000, cfg.intervalo || 9000));
    }

    // ---------- prévia (Netflix) ----------
    var prevTimer = null;
    function fontePrevia(it, t) {
        if (t.game) return it.preview || it.previewVideo || it.video || it.trailer || '';
        return it.preview || it.trailer || it.previewVideo || it.url || '';   // filmes/canais: mesmo link do player
    }
    function abrirPrevia(v, src, isGame, cfg) {
        try { if (S.prevHls) { S.prevHls.destroy(); S.prevHls = null; } } catch (e) {}
        // FILMES/SÉRIES: pula a abertura (≈3 min) pra cair direto no conteúdo; JOGOS começam do início.
        // Espera a duração ser conhecida (mp4 sabe cedo; webm/HLS às vezes só depois) antes de pular.
        function pularIntro() {
            try {
                if (isGame) { limparPuladores(); return; }
                var dur = v.duration;
                if (!isFinite(dur) || dur <= 0) return;                      // duração ainda desconhecida
                var alvo = (cfg && cfg.previewInicioFilme) || 180;
                if (dur > alvo + 12) v.currentTime = alvo;
                else if (dur > 50) v.currentTime = Math.min(dur * 0.25, dur - 35);
                limparPuladores();
            } catch (e) {}
        }
        function limparPuladores() { v.removeEventListener('loadedmetadata', pularIntro); v.removeEventListener('durationchange', pularIntro); v.removeEventListener('canplay', pularIntro); }
        v.addEventListener('loadedmetadata', pularIntro);
        v.addEventListener('durationchange', pularIntro);
        v.addEventListener('canplay', pularIntro);
        if (/\.m3u8(\?|$)/i.test(src) && window.Hls && window.Hls.isSupported && window.Hls.isSupported()) {
            try { var h = new window.Hls(); S.prevHls = h; h.loadSource(src); h.attachMedia(v); } catch (e) { v.src = src; }
        } else { v.src = src; }
        v.muted = true; var p = v.play(); if (p && p.catch) p.catch(function () {});
    }
    function prepararPrevia(it, t, cfg) {
        var raiz = S.raiz, v = raiz.querySelector('#czb-prev'), mute = raiz.querySelector('#czb-mute');
        clearTimeout(prevTimer);
        raiz.classList.remove('previewing');
        try { if (S.prevHls) { S.prevHls.destroy(); S.prevHls = null; } } catch (e) {}
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
        mute.hidden = true;
        var src = fontePrevia(it, t);
        if (!cfg.preview || !src || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
        prevTimer = setTimeout(function () {
            abrirPrevia(v, src, t.game, cfg);
            raiz.classList.add('previewing');
            mute.hidden = false; mute.textContent = v.muted ? '🔇' : '🔊';
        }, 3000);
    }

    function proximo() { S.i = (S.i + 1) % S.lista.length; render(S.i); }   // render() reagenda sozinho
    function agenda(ms) { clearTimeout(S.timer); S.timer = null; if (S.autoOff) return; if (S.lista.length > 1 && !matchMedia('(prefers-reduced-motion:reduce)').matches) S.timer = setTimeout(fade, ms); }
    function fade() {
        var raiz = S.raiz; if (!raiz) return;
        var foco = document.activeElement, focoId = foco && (foco.id === 'banner-btn-1' || foco.id === 'banner-btn-2') ? foco.id : null;
        raiz.style.transition = 'opacity .5s'; raiz.style.opacity = '0';
        setTimeout(function () {
            proximo();
            raiz.style.transition = 'opacity 1.2s'; raiz.style.opacity = '1';
            if (focoId) { var nb = raiz.querySelector('#' + focoId); if (nb) nb.focus({ preventScroll: true }); }
        }, 520);
    }
    var MAX_DOTS = 10;                                   // teto de bolinhas visíveis
    function visiveis() { return Math.min(S.lista.length, MAX_DOTS); }
    // janela deslizante: mantém a ativa por perto e nunca passa de MAX_DOTS bolinhas
    function janelaInicio() {
        var n = S.lista.length, vis = visiveis();
        if (n <= vis) return 0;
        return Math.max(0, Math.min(S.i - Math.floor(vis / 2), n - vis));
    }
    function montarDots() {
        var dots = S.raiz.querySelector('#czb-dots'); if (!dots) return; dots.innerHTML = '';
        for (var s = 0; s < visiveis(); s++) dots.appendChild(document.createElement('button'));  // pool fixo (<=10)
    }
    // atualiza as bolinhas a cada troca: ativa (grande, gradiente, pulsando) · mini nas bordas quando há mais itens
    function pintarDots() {
        var dots = S.raiz.querySelector('#czb-dots'); if (!dots) return;
        var n = S.lista.length, vis = visiveis(), ini = janelaInicio();
        if (dots.children.length !== vis) montarDots();
        [].forEach.call(dots.children, function (b, s) {
            var idx = ini + s;
            b.setAttribute('aria-label', 'Destaque ' + (idx + 1));
            b.setAttribute('aria-current', idx === S.i ? 'true' : 'false');
            b.classList.toggle('ativa', idx === S.i);
            b.classList.toggle('mini', (s === 0 && ini > 0) || (s === vis - 1 && ini + vis < n));  // "tem mais além"
            b.onclick = function () { S.i = idx; render(idx); };
        });
    }

    var CZBanner = {
        html: html,
        // ---- controle do carrossel (para o Daileon Dashboard / controle remoto) ----
        total: function () { return S.lista.length; },
        atual: function () { return S.i; },
        ir: function (n) { if (!S.lista.length) return; S.i = ((n % S.lista.length) + S.lista.length) % S.lista.length; render(S.i); },
        proximo: function () { CZBanner.ir(S.i + 1); },
        anterior: function () { CZBanner.ir(S.i - 1); },
        inicio: function () { CZBanner.ir(0); },
        aleatorio: function () { if (S.lista.length > 1) { var n; do { n = Math.floor(Math.random() * S.lista.length); } while (n === S.i); CZBanner.ir(n); } },
        auto: function (on) { S.autoOff = !on; if (S.raiz) { if (S.autoOff) { clearTimeout(S.timer); S.timer = null; } else render(S.i); } return !S.autoOff; },
        config: lerCfg,
        setConfig: function (patch) { var c = Object.assign(lerCfg(), patch || {}); salvarCfg(c); if (S.raiz) { render(S.i); } return c; },
        iniciar: function () {
            var raiz = document.getElementById('cz-banner'); if (!raiz) return false;
            clearTimeout(S.timer); clearTimeout(prevTimer);
            S.raiz = raiz; S.i = (window.state && window.state.bannerIndex) || 0; S.lista = destaques();
            if (!S.lista.length) { raiz.querySelector('#czb-info').innerHTML = '<p class="czb-desc" style="border:0">Marque itens com <b>destaque:true</b> no catálogo para aparecerem aqui.</p>'; return true; }
            if (S.i >= S.lista.length) S.i = 0;
            montarDots(); render(S.i); return true;    // render() já agenda o carrossel
        },
        parar: function () { clearTimeout(S.timer); clearTimeout(prevTimer); try { if (S.prevHls) { S.prevHls.destroy(); S.prevHls = null; } } catch (e) {} S.timer = null; },
        _nav: function (e, btn) {
            if (e.key === 'ArrowRight' && btn === 1) { e.preventDefault(); e.stopPropagation(); var b2 = document.getElementById('banner-btn-2'); if (b2) b2.focus(); }
            else if (e.key === 'ArrowLeft' && btn === 2) { e.preventDefault(); e.stopPropagation(); var b1 = document.getElementById('banner-btn-1'); if (b1) b1.focus(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); if (window.navControls && window.navControls.moveFocusSpatial) window.navControls.moveFocusSpatial('down'); }
        },
        montarControles: function (el) {
            if (typeof el === 'string') el = document.querySelector(el);
            if (!el) return;
            var c = lerCfg();
            var opt = function (val, nome, atual) { return '<option value="' + val + '"' + (val === atual ? ' selected' : '') + '>' + esc(nome) + '</option>'; };
            el.innerHTML = '<div class="czb-ctl">'
                + '<label>Skin do banner<select data-k="skin">' + ['auto'].concat(SKINS).map(function (k) { return opt(k, SKIN_NOME[k], c.skin); }).join('') + '</select></label>'
                + '<label>Efeito de imagem<select data-k="fx">' + ['auto'].concat(FX).map(function (k) { return opt(k, k === 'auto' ? 'Automático (por tipo)' : FX_NOME[k], c.fx); }).join('') + '</select></label>'
                + '<label class="czb-sw"><input type="checkbox" data-k="preview"' + (c.preview ? ' checked' : '') + '><span>Prévia em vídeo (estilo Netflix)</span></label>'
                + '<label>Troca a cada<select data-k="intervalo">' + [5000, 7000, 10000, 15000].map(function (ms) { return opt(ms, (ms / 1000) + ' segundos', c.intervalo); }).join('') + '</select></label>'
                + '</div>';
            el.querySelectorAll('[data-k]').forEach(function (inp) {
                inp.addEventListener('change', function () {
                    var k = inp.dataset.k, val = inp.type === 'checkbox' ? inp.checked : (k === 'intervalo' ? +inp.value : inp.value);
                    CZBanner.setConfig(Object.fromEntries([[k, val]]));
                });
            });
        }
    };

    function vigiar() {
        if (S.obs) return;
        S.obs = new MutationObserver(function () {
            var existe = document.getElementById('cz-banner');
            if (existe && existe !== S.raiz) CZBanner.iniciar();
            else if (!existe && S.raiz) { CZBanner.parar(); S.raiz = null; }
        });
        try { S.obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    }
    if (document.body) { vigiar(); if (document.getElementById('cz-banner')) CZBanner.iniciar(); }
    else document.addEventListener('DOMContentLoaded', function () { vigiar(); if (document.getElementById('cz-banner')) CZBanner.iniciar(); });

    window.CZBanner = CZBanner;

    // ---------------- CSS ----------------
    var CSS = [
// tela cheia (igual ao banner antigo): preenche o slide do carrossel da home (roleta = 100vh) e
// a imagem vai de ponta a ponta, por baixo da navbar transparente. SEM margin negativo.
'.czb{position:relative;width:100%;height:100vh;height:100dvh;min-height:560px;overflow:hidden;background:#05070d;font-family:"Saira",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:1}',
'@media(max-width:760px){.czb{height:auto;aspect-ratio:3/4;min-height:0}}',
'.czb *{box-sizing:border-box}',
'.czb-art,.czb-glow{position:absolute;inset:0;background-size:cover;background-position:center;transition:filter .4s}',
'.czb-art{filter:brightness(.72) saturate(1.08);transform:scale(1.08)}',   // escurece a imagem (texto legível)
// ZOOM REVERSO consistente em TODAS as imagens: começa ampliada e recua devagar
'.czb.show .czb-art{animation:czbZoomOut 9s ease-out both}',
'@keyframes czbZoomOut{from{transform:scale(1.22)}to{transform:scale(1.08)}}',
'.czb-glow{z-index:0;filter:blur(70px) saturate(1.5);opacity:0;transform:scale(1.1)}',
'.czb-prev{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 1s;z-index:1}',
'.czb.previewing .czb-prev{opacity:1}',
// sombreado forte à esquerda (igual ao antigo) + base inferior
'.czb-veil{position:absolute;inset:0;z-index:2}',
'.czb-veil.left{background:linear-gradient(90deg,#000 0%,rgba(0,0,0,.82) 26%,rgba(0,0,0,.35) 56%,transparent 82%)}',
'.czb-veil.bottom{background:linear-gradient(0deg,rgba(0,0,0,.85) 0%,rgba(0,0,0,.2) 32%,transparent 58%)}',
'.czb-veil.vig{background:radial-gradient(135% 135% at 40% 46%,transparent 52%,rgba(0,0,0,.5) 100%)}',
// conteúdo: centralizado no canto ESQUERDO (igual ao banner antigo), sem invadir o centro
'.czb-info{position:absolute;z-index:6;left:clamp(22px,5vw,88px);right:auto;top:50%;transform:translateY(-48%);max-width:min(600px,56%)}',
'.czb-eyebrow{display:inline-flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:.26em;text-transform:uppercase;color:#22d3ee;margin-bottom:15px}',
'.czb-eyebrow .live{display:inline-flex;align-items:center;gap:6px;color:#ff2e8a}',
'.czb-eyebrow .live i{width:7px;height:7px;border-radius:50%;background:#ff2e8a;box-shadow:0 0 10px #ff2e8a;animation:czbPulse 1.4s infinite}',
'.czb-sep{opacity:.45;margin:0 1px}',
'.czb-coin{font-family:"Press Start 2P",monospace;font-size:1em;color:#f5b64a;letter-spacing:.02em;animation:czbBlink 1.1s steps(1) infinite}',
// "Let\'s Watch" para filmes/vídeos: mesma piscadinha do INSERT COIN, mas no ROXO do Cartoonzine
'.czb-lets{font-family:"Press Start 2P",monospace;font-size:1em;color:#ff3b30;letter-spacing:.02em;text-shadow:0 0 10px rgba(255,59,48,.8);animation:czbBlink 1.1s steps(1) infinite}',
'@keyframes czbPulse{50%{opacity:.35}}@keyframes czbBlink{50%{opacity:.25}}',
'.czb-logo{display:flex;align-items:flex-end;min-height:clamp(120px,19vh,200px);margin-bottom:18px}',
'.czb-wm{margin:0;font-family:"Saira Condensed","Saira",system-ui,sans-serif;font-weight:900;font-style:italic;line-height:.84;text-transform:uppercase;font-size:clamp(52px,9vw,116px);letter-spacing:-.01em;color:#fff;filter:drop-shadow(0 6px 22px rgba(0,0,0,.65))}',
'.czb-logoimg,.czb-logo .cz-logo-img{height:clamp(120px,19vh,200px);width:auto;max-width:min(82%,660px);object-fit:contain;object-position:left bottom;filter:drop-shadow(0 6px 22px rgba(0,0,0,.6))}',
// linha de dados limpa:  1987 • 4 temporadas • Animação · Sci-Fi • HD • ★ 8.1
'.czb-meta{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-bottom:18px;min-height:22px;font-size:13.5px;font-weight:700;color:#cfd6e2;letter-spacing:.01em;font-variant-numeric:tabular-nums}',
'.czb-meta .czb-dot{opacity:.4}',
'.czb-hd{display:inline-flex;align-items:center;font-size:11px;font-weight:800;letter-spacing:.08em;color:#9fb0c3;border:1px solid rgba(255,255,255,.3);border-radius:5px;padding:1px 7px}',
'.czb-nota{display:inline-flex;align-items:center;gap:5px;color:#fff;font-weight:800}.czb-nota b{color:#f5c518;font-size:1.05em}',
// sinopse com TAMANHO FIXO (2 linhas), largura contida: nunca estoura pra dentro do banner
'.czb-desc{font-size:clamp(14px,1.45vw,16.5px);line-height:1.5;font-weight:500;color:#d7dce6;margin:0 0 22px;max-width:min(46ch,100%);border-left:3px solid #22d3ee;padding-left:16px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:calc(1.5em * 2)}',
// ---------- BOTÕES GÊMEOS ----------
'.czb-btns{display:flex;flex-wrap:wrap;gap:14px;align-items:center}',
// GÊMEOS: largura E altura fixas e iguais nos dois botões
'.czb-btn{position:relative;isolation:isolate;display:inline-flex;align-items:center;justify-content:center;gap:10px;border:0;border-radius:15px;width:clamp(188px,15vw,216px);height:56px;padding:0 18px;font-family:"Saira",system-ui,sans-serif;font-weight:900;font-size:13.5px;text-transform:uppercase;letter-spacing:.05em;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,background .2s ease}',
'.czb-btn .ic{display:grid;place-items:center;width:24px;height:24px;flex:none}',
// os botões do banner são .nav-item (p/ o motor de controle achá-los), mas mantêm o foco PRÓPRIO
// do banner — anula o pulse da navbar que a classe .nav-item traria junto
'.czb-btn.nav-item:focus{animation:none!important}',
'.czb-btn:hover,.czb-btn:focus-visible{transform:translateY(-3px) scale(1.03);outline:none}',
'.czb-btn:active{transform:scale(.96)}',
// play: branco sólido, texto/ícone escuros (igual ao banner antigo) — foco/hover com NEON CIANO (seta e mouse)
'.czb-btn.play{background:#fff;color:#0a0e16;box-shadow:0 12px 30px -12px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.9)}',
'.czb-btn.play .ic{color:#0a0e16}',
'.czb-btn.play:hover,.czb-btn.play:focus-visible{background:#eafcff;box-shadow:0 0 0 4px rgba(6,182,212,1),0 0 14px rgba(6,182,212,.75),0 0 34px rgba(6,182,212,.5),0 0 64px rgba(6,182,212,.22),0 16px 40px -12px rgba(0,0,0,.6)}',
// wiki: vidro/cristal + borda RGB animada no hover/foco (o wiki da 1ª versão que você aprovou)
'.czb-btn.ghost{background:linear-gradient(180deg,rgba(255,255,255,.17),rgba(255,255,255,.045));color:#fff;border:1px solid rgba(255,255,255,.26);backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px) saturate(1.4);box-shadow:inset 0 1px 0 rgba(255,255,255,.4),inset 0 -8px 16px rgba(0,0,0,.18),0 12px 30px -12px rgba(0,0,0,.6)}',
// ícone ORIGINAL do wiki: círculo ciano + livro branco, com brilho e leve zoom no hover/foco
'.czb-btn.ghost .ic{width:24px;height:24px;border-radius:50%;background:#06b6d4;color:#fff;box-shadow:0 0 15px rgba(6,182,212,.8);transition:transform .2s ease}',
'.czb-btn.ghost:hover .ic,.czb-btn.ghost:focus-visible .ic{transform:scale(1.1)}',
'.czb-btn.ghost::before{content:"";position:absolute;inset:-1.5px;border-radius:17px;z-index:-1;padding:1.5px;background:conic-gradient(from 0deg,#22d3ee,#8a2eff,#ff2e8a,#f5b64a,#22d3ee);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:0;transition:opacity .3s}',
'.czb-btn.ghost:hover::before,.czb-btn.ghost:focus-visible::before{opacity:1;animation:czbHue 3s linear infinite}',
'@keyframes czbHue{to{filter:hue-rotate(360deg)}}',
'.czb-btn.ghost:hover,.czb-btn.ghost:focus-visible{background:linear-gradient(180deg,rgba(255,255,255,.24),rgba(255,255,255,.09))}',
// indicador do loop
// indicadores: BOLINHAS centralizadas embaixo (no lugar da setinha), janela de até 10
'.czb-dots{position:absolute;z-index:7;display:flex;align-items:center;justify-content:center;gap:10px;left:50%;transform:translateX(-50%);bottom:clamp(20px,5vh,40px)}',
'.czb-dots button{width:10px;height:10px;border:0;border-radius:50%;padding:0;cursor:pointer;background:rgba(255,255,255,.3);transition:width .55s cubic-bezier(.22,1,.36,1),height .55s cubic-bezier(.22,1,.36,1),background .45s ease,opacity .45s ease,box-shadow .45s ease}',
'.czb-dots button:hover{background:rgba(255,255,255,.55)}',
'.czb-dots button.mini{width:6px;height:6px;opacity:.5}',   // borda da janela: "tem mais além"
// ativa: cresce (a outra murcha ao mesmo tempo), gradiente do quadrado do logo (ciano→roxo diagonal) e pulsa neon sutil
'.czb-dots button.ativa{width:17px;height:17px;opacity:1;background:linear-gradient(135deg,#00C2D1 58%,#8A2EFF 100%);animation:czbDotPulse 1.7s ease-in-out infinite}',
'@keyframes czbDotPulse{0%,100%{box-shadow:0 0 7px rgba(0,194,209,.65),0 0 14px rgba(138,46,255,.35)}50%{box-shadow:0 0 14px rgba(0,194,209,.95),0 0 26px rgba(138,46,255,.6)}}',
// tira a setinha "SCROLL ↓" do centro-baixo (as bolinhas ficam no lugar dela)
'#roleta-scroll-hint{display:none!important}',
// entrada orquestrada
'.czb-info .czb-eyebrow,.czb-info .czb-logo,.czb-info .czb-meta,.czb-info .czb-desc,.czb-info .czb-btns{opacity:0;transform:translateY(18px)}',
'.czb.show .czb-info .czb-eyebrow{animation:czbRise .7s .05s both}',
'.czb.show .czb-info .czb-logo{animation:czbLogoIn .9s .12s both}',
'.czb.show .czb-info .czb-meta{animation:czbRise .7s .24s both}',
'.czb.show .czb-info .czb-desc{animation:czbRise .7s .32s both}',
'.czb.show .czb-info .czb-btns{animation:czbRise .7s .42s both}',
'@keyframes czbRise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}',
'@keyframes czbLogoIn{0%{opacity:0;transform:translateX(-34px) skewX(-7deg)}60%{opacity:1}100%{opacity:1;transform:none}}',
// camadas de efeito/chrome escondidas por padrão
'.czb-scan,.czb-crt,.czb-vhs,.czb-cine,.czb-neon,.czb-grain,.czb-crtmask,.czb-arcade-top,.czb-poster,.czb-mute{opacity:0;pointer-events:none}',
'.czb-mute[hidden]{display:none}',
// SKIN ARCADE
'.czb[data-skin="arcade"]{background:#02040a}',
'.czb[data-skin="arcade"] .czb-crtmask{opacity:1;position:absolute;inset:0;z-index:5;box-shadow:inset 0 0 140px 36px rgba(0,0,0,.8),inset 0 0 0 3px rgba(0,0,0,.6);background:radial-gradient(120% 120% at 50% 50%,transparent 62%,rgba(0,0,0,.55) 100%)}',
'.czb[data-skin="arcade"] .czb-arcade-top{opacity:1;position:absolute;z-index:7;top:clamp(14px,3vh,26px);left:0;right:0;display:flex;justify-content:space-between;padding-inline:clamp(22px,5vw,60px);font-family:"Press Start 2P",monospace;font-size:clamp(8px,1vw,11px);color:#fff}',
'.czb[data-skin="arcade"] .czb-arcade-top .hi{color:#ff2e8a}.czb[data-skin="arcade"] .czb-arcade-top .c{color:#22d3ee}',
'.czb[data-skin="arcade"] .czb-eyebrow{color:#ff2e8a}',
'.czb[data-skin="arcade"] .czb-wm{text-shadow:3px 0 #ff2e8a,-3px 0 #22d3ee}',
// SKIN POSTER
'.czb[data-skin="poster"]{background:linear-gradient(120deg,#070a12,#0c1222 60%,#13101f)}',
'.czb[data-skin="poster"] .czb-art{inset:0 0 0 44%;transform:none!important}',
'.czb[data-skin="poster"] .czb-veil.left{background:linear-gradient(90deg,#070a12 34%,rgba(7,10,18,.4) 52%,transparent 66%)}',
'.czb[data-skin="poster"] .czb-veil.bottom{opacity:.4}',
'.czb-idx{font-family:"Saira Condensed","Saira",sans-serif;font-weight:900;font-style:italic;font-size:13px;letter-spacing:.1em;color:#99a1b3;margin-bottom:12px}.czb-idx b{color:#22d3ee}',
'.czb[data-skin="poster"] .czb-poster{opacity:1;position:absolute;z-index:6;right:clamp(28px,5vw,80px);top:50%;transform:translateY(-50%) rotate(3deg);width:clamp(170px,20vw,300px);aspect-ratio:2/3;border-radius:16px;overflow:hidden;background-size:cover;background-position:center;box-shadow:0 30px 70px -18px rgba(0,0,0,.85),0 0 0 1px rgba(255,255,255,.12)}',
'.czb-poster .shine{position:absolute;inset:0;background:linear-gradient(130deg,transparent 42%,rgba(255,255,255,.22) 50%,transparent 58%)}',
'@media(max-width:760px){.czb[data-skin="poster"] .czb-art{inset:0 0 58% 0}.czb[data-skin="poster"] .czb-veil.left{background:linear-gradient(0deg,#070a12 42%,transparent 72%)}.czb[data-skin="poster"] .czb-poster{display:none}}',
// SKIN VINTAGE — vidro de TV antiga (estilo ShaderGlass): fósforo quente, scanlines, brilho de vidro, leve curvatura e aberração cromática
'.czb[data-skin="vintage"]{background:#0b0805}',
'.czb[data-skin="vintage"] .czb-art{filter:brightness(.68) saturate(1.2) contrast(1.1) sepia(.2) hue-rotate(-6deg)}',
'.czb[data-skin="vintage"] .czb-scan{opacity:.55}',                 // scanlines sempre ligadas
'.czb[data-skin="vintage"] .czb-grain{opacity:.35}',               // granulado de tubo
'.czb[data-skin="vintage"] .czb-crtmask{opacity:1;position:absolute;inset:0;z-index:5;border-radius:18px;box-shadow:inset 0 0 160px 40px rgba(0,0,0,.82),inset 0 0 0 3px rgba(0,0,0,.6),inset 0 2px 30px rgba(255,210,150,.08);background:radial-gradient(130% 115% at 50% 46%,transparent 55%,rgba(20,8,0,.6) 100%)}',
// brilho de vidro (glare) no topo + leve varredura
'.czb[data-skin="vintage"] .czb-crtmask::after{content:"";position:absolute;left:0;right:0;top:0;height:42%;border-radius:18px 18px 60% 60%/18px 18px 22% 22%;background:linear-gradient(180deg,rgba(255,255,255,.07),transparent);pointer-events:none}',
'.czb[data-skin="vintage"] .czb-wm{text-shadow:1.6px 0 rgba(255,45,45,.55),-1.6px 0 rgba(40,180,255,.55);filter:drop-shadow(0 0 10px rgba(255,170,90,.25))}',
'.czb[data-skin="vintage"] .czb-eyebrow{color:#ffcf8a}',
'.czb[data-skin="vintage"] .czb-art,.czb[data-skin="vintage"].show .czb-art{animation:czbZoomOut 11s ease-out both}',
// botão de som da prévia
'.czb-mute{position:absolute;z-index:7;right:clamp(16px,3vw,30px);top:clamp(80px,9vh,110px);width:46px;height:46px;border-radius:50%;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.4);color:#fff;display:grid;place-items:center;cursor:pointer;backdrop-filter:blur(6px);pointer-events:auto}',
'.czb.previewing .czb-mute:not([hidden]){opacity:1}',
// EFEITOS
'.czb-scan{position:absolute;inset:0;z-index:4;background:repeating-linear-gradient(0deg,rgba(0,0,0,.26) 0 1px,transparent 1px 3px);mix-blend-mode:multiply}',
'.czb-crt{position:absolute;inset:0;z-index:4;background:radial-gradient(130% 130% at 50% 50%,transparent 58%,rgba(0,0,0,.5) 100%);box-shadow:inset 0 0 90px 20px rgba(0,0,0,.55)}',
'.czb-vhs{position:absolute;inset:0;z-index:4;background:repeating-linear-gradient(0deg,rgba(255,255,255,.04) 0 2px,transparent 2px 5px)}',
'.czb-vhs::before{content:"";position:absolute;left:0;right:0;height:14%;top:-20%;background:linear-gradient(0deg,transparent,rgba(255,255,255,.14),transparent);animation:czbTrack 7s linear infinite}',
'@keyframes czbTrack{to{top:120%}}',
'.czb-cine{position:absolute;inset:0;z-index:5}.czb-cine::before,.czb-cine::after{content:"";position:absolute;left:0;right:0;height:9%;background:#000}.czb-cine::before{top:0}.czb-cine::after{bottom:0}',
'.czb-neon{position:absolute;inset:0;z-index:4;mix-blend-mode:screen;background:radial-gradient(60% 80% at 76% 30%,rgba(34,211,238,.22),transparent 60%),radial-gradient(60% 80% at 24% 80%,rgba(138,46,255,.22),transparent 60%)}',
'.czb-grain{position:absolute;inset:0;z-index:5;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'120\' height=\'120\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'.9\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'.5\'/%3E%3C/svg%3E");background-size:180px 180px;animation:czbGrain .5s steps(3) infinite}',
'@keyframes czbGrain{to{background-position:180px 0}}',
'.czb[data-fx="crt"] .czb-scan,.czb[data-fx="scan"] .czb-scan{opacity:1}',
'.czb[data-fx="crt"] .czb-crt{opacity:1}',
'.czb[data-fx="crt"] .czb-art,.czb[data-fx="scan"] .czb-art{filter:saturate(1.25) contrast(1.05) brightness(.8)}',
'.czb[data-fx="crt"] .czb-wm,.czb[data-fx="crt"] .czb-desc{text-shadow:1.5px 0 rgba(255,46,138,.6),-1.5px 0 rgba(34,211,238,.6)}',
'.czb[data-fx="vhs"] .czb-vhs{opacity:1}.czb[data-fx="vhs"] .czb-art{filter:saturate(1.5) contrast(1.08) hue-rotate(-4deg) brightness(.8)}',
'.czb[data-fx="vhs"] .czb-wm{text-shadow:2.5px 0 rgba(255,46,138,.7),-2.5px 0 rgba(34,211,238,.7)}',
'.czb[data-fx="cinema"] .czb-cine{opacity:1}.czb[data-fx="cinema"] .czb-art{filter:contrast(1.12) saturate(.92) sepia(.1) brightness(.72)}',
'.czb[data-fx="neon"] .czb-neon{opacity:1}.czb[data-fx="neon"] .czb-art{filter:saturate(1.7) contrast(1.08) brightness(.9)}',
'.czb[data-fx="neon"] .czb-wm{filter:drop-shadow(0 0 14px rgba(34,211,238,.6))}',
'.czb[data-fx="bw"] .czb-art{filter:grayscale(1) contrast(1.15) brightness(.82)}.czb[data-fx="bw"] .czb-scan{opacity:.5}',
'.czb[data-fx="crt"] .czb-grain,.czb[data-fx="vhs"] .czb-grain,.czb[data-fx="cinema"] .czb-grain,.czb[data-fx="bw"] .czb-grain{opacity:.5}',
// controles do dashboard
'.czb-ctl{display:flex;flex-wrap:wrap;gap:14px;font-family:"Saira",system-ui,sans-serif}',
'.czb-ctl label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;letter-spacing:.04em;color:#9aa3b2;text-transform:uppercase}',
'.czb-ctl select{font:inherit;font-size:13px;font-weight:600;text-transform:none;letter-spacing:0;color:#eef1f6;background:#141926;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:9px 12px}',
'.czb-ctl .czb-sw{flex-direction:row;align-items:center;gap:9px;text-transform:none;letter-spacing:0;color:#eef1f6;font-weight:600}',
'.czb-ctl .czb-sw input{width:18px;height:18px;accent-color:#0891b2}',
'@media (prefers-reduced-motion:reduce){.czb *{animation-duration:.001s!important}.czb-info .czb-eyebrow,.czb-info .czb-logo,.czb-info .czb-meta,.czb-info .czb-desc,.czb-info .czb-btns{opacity:1;transform:none}}'
].join('\n');
})();
