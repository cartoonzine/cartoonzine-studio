/**
 * 🔗 LINK EDIT — tela do Studio para editar listas de canais (M3U, JSON, TXT ou texto colado):
 * testar canais (um a um no visualizador ou em lote no Scan), separar vivos, juntar cópias do mesmo canal como
 * reserva, filtrar por idioma/país/tipo e montar listas novas sem digitar nada.
 * A lógica fica em core/linkedit-core.js (test/linkedit.test.mjs); o teste de rede e o túnel do visualizador
 * em tools/linkedit-rede.mjs (só no painel local: node tools/painel.mjs).
 */
(function () {
    'use strict';
    const L = window.CZLinkEditCore;
    const GUARDA = 'czs-linkedit-v1';
    const ALTURA_LINHA = 40;
    const BANCO_LOGOS = 'https://iptv-org.github.io/api/';   // banco aberto de canais e logos (iptv-org)
    const LIBS = {
        hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js',
        mpegts: 'https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.min.js'
    };
    const ROTULO_STATUS = { vivo: 'VIVO', lento: 'LENTO', morto: 'MORTO', bloqueado: 'BLOQUEADO', 'pede-ua': 'PEDE UA', desconhecido: '?', 'nao-testado': '—', testando: '…' };
    const COR_STATUS = { vivo: '#4ade80', lento: '#fbbf24', morto: '#f87171', bloqueado: '#fb923c', 'pede-ua': '#38bdf8', desconhecido: '#9aa3ad', 'nao-testado': '#5b6472', testando: '#67e8f9' };

    // ---------------------------------------------------------------- estado
    const E = {
        listas: [],            // [{ id, nome, formato, epg }]
        canais: [],            // todos os canais de todas as listas (c.lista = id da lista)
        sel: new Set(),        // ids selecionados
        foco: null,            // id do canal no visualizador
        f: { busca: '', idiomas: new Set(), tipos: new Set(), paises: new Set(), status: new Set(), soVivos: false, semLogo: false, duplicados: false, quarentena: false },
        nova: { nome: 'Lista nova', itens: [] },
        desfazer: [],
        scan: null,            // { total, feitos, parar, modo }
        modoTeste: 'completo',
        visiveis: [], cont: null,
        som: { mudo: true, vol: 0.6 },   // som da prévia
        ancora: null           // última caixinha clicada (Shift+clique marca o trecho)
    };
    let S = null;              // ferramentas do painel (aviso, esc, estado.repo…)
    let raiz = null;

    const local = () => !!(S && S.local && S.local());
    const esc = (t) => S.esc(t);
    const $ = (sel) => raiz && raiz.querySelector(sel);

    function salvar() {
        try {
            localStorage.setItem(GUARDA, JSON.stringify({
                listas: E.listas, nova: E.nova, modoTeste: E.modoTeste, som: E.som,
                canais: E.canais.map(c => { const o = Object.assign({}, c); delete o.testando; return o; })
            }));
        } catch (e) { /* lista grande demais para o navegador: fica só nesta sessão */ }
    }
    function carregar() {
        try {
            const d = JSON.parse(localStorage.getItem(GUARDA) || 'null');
            if (!d) return;
            E.listas = d.listas || []; E.canais = d.canais || []; E.nova = d.nova || E.nova; E.modoTeste = d.modoTeste || 'completo'; if (d.som) E.som = d.som;
        } catch (e) { /* */ }
    }
    function lembrar() {                      // antes de mudar algo: guarda como estava (Desfazer)
        E.desfazer.push(JSON.stringify({ nova: E.nova, flags: E.canais.map(c => [c.id, !!c.quarentena, !!c.fixo, c.logo || '']) }));
        if (E.desfazer.length > 60) E.desfazer.shift();
    }
    function desfazer() {
        const ult = E.desfazer.pop();
        if (!ult) return S.aviso('Nada para desfazer.', 'ok');
        const d = JSON.parse(ult);
        E.nova = d.nova;
        const m = new Map(d.flags.map(f => [f[0], f]));
        E.canais.forEach(c => { const f = m.get(c.id); if (f) { c.quarentena = f[1]; c.fixo = f[2]; if (f.length > 3) c.logo = f[3]; } });
        salvar(); desenharTudo();
    }

    // ---------------------------------------------------------------- listas
    let seqLista = 0;
    function adicionarLista(texto, nome) {
        const id = 'l' + Date.now().toString(36) + (seqLista++);
        const r = L.lerLista(texto, nome);
        if (!r.canais.length) return S.aviso('Não achei nenhum link de canal nisso.', 'ruim');
        const ja = new Set(E.canais.map(c => c.lista + '|' + c.url));
        let n = 0;
        r.canais.forEach((c) => {
            c.lista = id;
            if (ja.has(id + '|' + c.url)) return;
            // o mesmo link já aberto noutra lista: aproveita o teste que ele já tem
            const igual = E.canais.find(x => x.url === c.url && x.teste);
            if (igual) { c.teste = igual.teste; c.historico = (igual.historico || []).slice(); }
            c.id = id + '-' + (n++);
            E.canais.push(c);
        });
        E.listas.push({ id, nome: nome || 'Lista ' + E.listas.length + 1, formato: r.formato, epg: r.epg });
        salvar(); desenharTudo();
        S.aviso(`${n} canais lidos de "${nome}" (${r.formato.toUpperCase()}).`, 'ok');
    }
    function removerLista(id) {
        lembrar();
        E.listas = E.listas.filter(l => l.id !== id);
        E.canais = E.canais.filter(c => c.lista !== id);
        [...E.sel].forEach(s => { if (!E.canais.some(c => c.id === s)) E.sel.delete(s); });
        salvar(); desenharTudo();
    }
    /** Canais soltos (.m3u8, .ts, .mp4...) vão todos para uma lista fixa "Links avulsos". */
    function adicionarAvulsos(canais) {
        let lista = E.listas.find(l => l.id === 'avulsos');
        if (!lista) { lista = { id: 'avulsos', nome: 'Links avulsos', formato: 'links', epg: '' }; E.listas.push(lista); }
        lembrar();
        let n = 0;
        canais.forEach((c) => {
            if (E.canais.some(x => x.lista === 'avulsos' && x.url === c.url)) return;
            const igual = E.canais.find(x => x.url === c.url && x.teste);
            if (igual) { c.teste = igual.teste; c.historico = (igual.historico || []).slice(); }
            c.lista = 'avulsos'; c.id = 'avulsos-' + Date.now().toString(36) + '-' + (seqLista++);
            E.canais.push(c); n++;
        });
        salvar(); desenharTudo();
        if (!n) return S.aviso('Esse canal já está em "Links avulsos".', 'ok');
        S.aviso(n === 1 ? `Canal "${canais[0].nome}" adicionado em "Links avulsos". Clique nele para ver e testar.` : `${n} canais adicionados em "Links avulsos".`, 'ok');
        const ultimo = E.canais[E.canais.length - 1];
        if (n === 1 && ultimo) focar(ultimo.id);            // já abre no visualizador
    }

    async function baixarTexto(url) {
        if (local()) {
            const r = await (await fetch('/api/linkedit/lista?url=' + encodeURIComponent(url))).json();
            if (r.erro) throw new Error(r.erro);
            return r.texto;
        }
        const r = await fetch(url);                 // online: só funciona se o site liberar (CORS)
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
    }

    /** Campo de link: aceita link de LISTA (M3U/JSON/TXT) ou de CANAL (.m3u8, .ts, .mp4...), um ou vários de uma vez. */
    async function abrirLink(entrada) {
        const links = String(entrada || '').match(/(?:https?|rtmpe?|rtsp|udp|srt):\/\/[^\s"'<>]+|magnet:\?[^\s"'<>]+/gi) || [];
        if (!links.length) return S.aviso('Cole um link de lista ou de canal (http, .m3u8...).', 'ruim');
        const soltos = [];
        for (const url of links) {
            if (L.ehLinkDeCanal(url)) { soltos.push(L.canalDoLink(url)); continue; }
            const nome = (() => { try { const u = new URL(url); return (u.pathname.split('/').filter(Boolean).pop() || u.hostname); } catch (e) { return url; } })();
            try {
                const texto = await baixarTexto(url);
                // .m3u8 de UM canal (master ou pedaços): entra como canal, não como lista
                if (L.ehStreamHLS(texto)) soltos.push(L.canalDoLink(url));
                else adicionarLista(texto, nome);
            } catch (e) {
                if (L.formatoDe(url) === 'hls') { soltos.push(L.canalDoLink(url)); continue; }   // não baixou: entra assim mesmo, o teste diz se está vivo
                S.aviso('Não consegui abrir: ' + e.message + (local() ? '' : ' — no painel local (node tools/painel.mjs) qualquer link abre.'), 'ruim');
            }
        }
        if (soltos.length) adicionarAvulsos(soltos);
    }

    // ---------------------------------------------------------------- filtros
    function filtrados() {
        const base = E.canais.filter(c => (E.f.quarentena ? c.quarentena : !c.quarentena));
        E.cont = L.contar(base);
        return L.filtrar(base, E.f, E.cont.chaves);
    }

    // ---------------------------------------------------------------- lista nova
    function jogarNaLista(canais) {
        if (!canais.length) return;
        lembrar();
        let novos = 0, reservas = 0;
        for (const g of L.agrupar(canais)) {
            const c = L.canalComReservas(g);
            const ja = E.nova.itens.find(x => x.chave === c.chave);
            if (ja) {                                   // já está: as cópias viram reserva (sem duplicar)
                [c.url].concat(c.reservas).forEach(u => { if (u !== ja.url && !ja.reservas.includes(u)) { ja.reservas.push(u); reservas++; } });
                continue;
            }
            E.nova.itens.push({ id: c.id, chave: c.chave, nome: c.nome, url: c.url, reservas: c.reservas.slice(), logo: c.logo, tvgId: c.tvgId, grupo: c.grupo, tipo: c.tipo, pais: c.pais, idioma: c.idioma, headers: c.headers || {} });
            novos++;
        }
        salvar(); desenharNova(); desenharTabela();
        S.aviso(novos || reservas ? `${novos} canal(is) na lista nova${reservas ? ` · ${reservas} reserva(s) somada(s)` : ''}.` : 'Já está na lista nova.', 'ok');
    }
    function moverNaNova(i, d) {
        const j = i + d;
        if (j < 0 || j >= E.nova.itens.length) return;
        lembrar();
        const it = E.nova.itens; [it[i], it[j]] = [it[j], it[i]];
        salvar(); desenharNova();
    }
    function tirarDaNova(i) { lembrar(); E.nova.itens.splice(i, 1); salvar(); desenharNova(); desenharTabela(); }
    /** Antes de salvar: janela para dar nome à lista (vira o nome do arquivo). */
    function pedirNomeEBaixar(formato) {
        if (!E.nova.itens.length) return S.aviso('A lista nova está vazia.', 'ruim');
        const ext = formato === 'json' ? 'json' : formato === 'txt' ? 'txt' : 'm3u';
        const arq = (n) => (L.norm(n).replace(/ /g, '-') || 'lista') + '.' + ext;
        const j = janela(`<h3>Salvar lista</h3>
          <label class="le-dica" for="le-salvar-nome">Nome da lista</label>
          <input class="le-campo" id="le-salvar-nome" value="${esc(E.nova.nome)}" maxlength="80">
          <p class="le-dica">Arquivo: <b id="le-salvar-arq">${esc(arq(E.nova.nome))}</b> · ${E.nova.itens.length} canais</p>
          <div class="le-jan-botoes"><button class="le-bt" data-fechar>Cancelar</button><button class="le-bt p" id="le-salvar-ok">Salvar ${ext.toUpperCase()}</button></div>`);
        const inp = j.querySelector('#le-salvar-nome');
        inp.focus(); inp.select();
        inp.oninput = () => { j.querySelector('#le-salvar-arq').textContent = arq(inp.value); };
        const ok = () => {
            E.nova.nome = inp.value.trim() || 'Lista nova';
            const campo = $('#le-nova-nome'); if (campo) campo.value = E.nova.nome;
            salvar(); fecharJanela(); baixar(formato);
        };
        inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
        j.querySelector('#le-salvar-ok').onclick = ok;
    }
    function baixar(formato) {
        if (!E.nova.itens.length) return S.aviso('A lista nova está vazia.', 'ruim');
        const epg = (E.listas.find(l => l.epg) || {}).epg;
        const texto = formato === 'json' ? L.gerarJSON(E.nova.itens) : formato === 'txt' ? L.gerarTXT(E.nova.itens) : L.gerarM3U(E.nova.itens, { epg });
        const nome = (L.norm(E.nova.nome).replace(/ /g, '-') || 'lista') + '.' + (formato === 'json' ? 'json' : formato === 'txt' ? 'txt' : 'm3u');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
        a.download = nome; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    async function copiar() {
        if (!E.nova.itens.length) return S.aviso('A lista nova está vazia.', 'ruim');
        try { await navigator.clipboard.writeText(L.gerarM3U(E.nova.itens)); S.aviso('Lista M3U copiada.', 'ok'); }
        catch (e) { S.aviso('O navegador não deixou copiar; use "Baixar".', 'ruim'); }
    }

    // ---------------------------------------------------------------- testar / scan
    async function testarUm(c) {
        if (!local()) return null;
        const p = new URLSearchParams({ url: c.url, modo: E.modoTeste });
        if (c.headers && c.headers['User-Agent']) p.set('ua', c.headers['User-Agent']);
        if (c.headers && c.headers.Referer) p.set('ref', c.headers.Referer);
        try {
            const r = await (await fetch('/api/linkedit/testar?' + p)).json();
            aplicarTeste(c, r);
            return r;
        } catch (e) { return null; }
    }
    function aplicarTeste(c, r) {
        if (!r || !r.status) return;
        c.teste = { status: r.status, ms: r.ms, motivo: r.motivo || '', tipo: r.tipo || '', resolucao: r.resolucao || c.teste && c.teste.resolucao || '', tamanho: r.tamanho || c.teste && c.teste.tamanho || 0, em: Date.now() };
        if (r.ua) c.headers = Object.assign({}, c.headers, { 'User-Agent': r.ua });
        if (r.status !== 'desconhecido') {
            c.historico = (c.historico || []).concat(r.status === 'vivo' || r.status === 'lento' || r.status === 'pede-ua').slice(-10);
        }
    }
    async function scan(lista) {
        if (!local()) return S.aviso('O Scan testa os canais pelo painel no seu PC (node tools/painel.mjs). Online, teste um por um no visualizador.', 'ruim');
        if (E.scan) return;
        const alvo = lista.filter(c => !/^(magnet|rtmp|rtsp|udp|srt|mms)/i.test(c.url));
        if (!alvo.length) return S.aviso('Nada para testar aqui.', 'ruim');
        const sc = E.scan = { total: alvo.length, feitos: 0, parar: false, vivos: 0, mortos: 0 };
        desenharScan();
        let i = 0;
        const LIMITE = 8;
        const trabalhar = async () => {
            while (!sc.parar && i < alvo.length) {
                const c = alvo[i++];
                c.testando = true;
                const r = await testarUm(c);
                c.testando = false;
                sc.feitos++;
                if (r && (r.status === 'vivo' || r.status === 'lento' || r.status === 'pede-ua')) sc.vivos++; else if (r) sc.mortos++;
                if (sc.feitos % 4 === 0 || sc.feitos === sc.total) { desenharScan(); agendarTabela(); }
            }
        };
        await Promise.all(Array.from({ length: Math.min(LIMITE, alvo.length) }, trabalhar));
        E.scan = null;
        salvar(); desenharTudo();
        S.aviso(`Scan: ${sc.feitos} testados · ${sc.vivos} vivos · ${sc.mortos} com problema.`, 'ok');
    }
    function quarentena(canais, sim = true) {
        if (!canais.length) return;
        lembrar();
        canais.forEach(c => { c.quarentena = sim; E.sel.delete(c.id); });
        salvar(); desenharTudo();
    }

    // ---------------------------------------------------------------- visualizador
    let player = { hls: null, mpegts: null, t0: 0, token: 0 };
    const libs = {};
    function carregarLib(nome) {
        if (window[nome === 'hls' ? 'Hls' : 'mpegts']) return Promise.resolve(true);
        if (!libs[nome]) libs[nome] = new Promise((ok) => { const s = document.createElement('script'); s.src = LIBS[nome]; s.onload = () => ok(true); s.onerror = () => { libs[nome] = null; ok(false); }; document.head.appendChild(s); });
        return libs[nome];
    }
    function pararVideo() {
        player.token++;
        if (player.hls) { try { player.hls.destroy(); } catch (e) { /* */ } player.hls = null; }
        if (player.mpegts) { try { player.mpegts.destroy(); } catch (e) { /* */ } player.mpegts = null; }
        const v = $('#le-video');
        if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* */ } }
    }
    function viaTunel(c, url) {
        if (!local()) return url;
        const p = new URLSearchParams({ u: url });
        if (c.headers && c.headers['User-Agent']) p.set('ua', c.headers['User-Agent']);
        if (c.headers && c.headers.Referer) p.set('ref', c.headers.Referer);
        return '/api/linkedit/tunel?' + p;
    }
    async function tocar(c) {
        pararVideo();
        const v = $('#le-video'), msg = $('#le-tela-msg');
        if (!v || !c) return;
        const meu = player.token;
        const status = (t) => { if (msg) { msg.textContent = t || ''; msg.hidden = !t; } };
        status('Abrindo…');
        player.t0 = performance.now();
        const tt = (c.teste && c.teste.tipo) || '';
        // o teste viu o formato real pelos bytes: ele manda (link sem extensão, .mp4 que na verdade é TS etc.)
        const fmt = ({ hls: 'hls', mpegts: 'mpegts', flv: 'flv' })[tt] || c.formato;
        const NAO_TOCA = { avi: 'AVI', wmv: 'WMV', mpeg: 'MPEG', rmvb: 'RMVB' };
        if (NAO_TOCA[tt]) return status(`Vídeo ${NAO_TOCA[tt]}: o link está vivo, mas o navegador não toca este formato. No app (VLC/ExoPlayer) toca.`);
        if (fmt === 'torrent' || fmt === 'protocolo' || fmt === 'youtube') return status(fmt === 'torrent' ? 'Torrent: teste no app (o Studio não baixa torrent).' : fmt === 'youtube' ? 'YouTube: abra no app.' : 'RTMP/RTSP/UDP: o navegador não toca; teste no app do PC.');
        const url = viaTunel(c, c.url);
        v.muted = E.som.mudo; v.volume = E.som.vol;
        const aoTocar = () => {
            if (meu !== player.token) return;
            status('');
            const ms = Math.round(performance.now() - player.t0);
            const ficha = $('#le-ficha-abriu'), img = $('#le-ficha-img');
            if (ficha) ficha.textContent = (ms / 1000).toFixed(1).replace('.', ',') + ' s';
            if (img) img.textContent = v.videoWidth ? v.videoWidth + '×' + v.videoHeight : '—';
            if (!c.teste || c.teste.status !== 'vivo') { aplicarTeste(c, { status: ms > 4000 ? 'lento' : 'vivo', ms, tipo: fmt }); salvar(); agendarTabela(); pintarFicha(c); }
        };
        v.onplaying = aoTocar;
        v.onloadedmetadata = () => {
            const d = $('#le-ficha-dur');
            if (d && isFinite(v.duration) && v.duration > 0) { const m = Math.round(v.duration / 60); d.textContent = v.duration < 60 ? Math.round(v.duration) + ' s' : m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') : m + ' min'; }
        };
        const MOTIVO_MIDIA = { 1: 'a abertura foi interrompida', 2: 'erro de rede', 3: 'o vídeo veio com defeito', 4: 'o link não é um vídeo que o navegador abre (formato, página ou link fora do ar)' };
        v.onerror = () => {
            if (meu !== player.token) return;
            const cod = v.error && v.error.code;
            // arquivo que o servidor entrega (teste vivo) mas o navegador não decodifica: o link NÃO está morto
            if ((cod === 3 || cod === 4) && c.formato === 'arquivo' && c.teste && ['vivo', 'lento', 'pede-ua'].includes(c.teste.status)) {
                return status('O link está vivo, mas o navegador não toca este vídeo (codec ' + ((tt || 'do arquivo').toUpperCase()) + '). No app (VLC/ExoPlayer) toca.');
            }
            if (meu === player.token) { status('Não tocou: ' + (MOTIVO_MIDIA[v.error && v.error.code] || 'formato ou link com problema')); aplicarTeste(c, { status: 'morto', motivo: 'não tocou no visualizador' }); salvar(); agendarTabela(); pintarFicha(c); } };
        try {
            if (fmt === 'hls' || (fmt === 'desconhecido' && /m3u8/i.test(c.url))) {
                if (v.canPlayType('application/vnd.apple.mpegurl') && !window.MediaSource) { v.src = url; }
                else {
                    if (!(await carregarLib('hls')) || meu !== player.token) return status('Não consegui carregar o hls.js.');
                    // resolução baixa de propósito: o teste é rápido e gasta pouco (o quadro é pequeno)
                    const h = player.hls = new window.Hls({ capLevelToPlayerSize: true, startLevel: 0, maxBufferLength: 8, maxMaxBufferLength: 15, backBufferLength: 0, enableWorker: true });
                    h.on(window.Hls.Events.ERROR, (ev, d) => { if (d && d.fatal && meu === player.token) { status('Não tocou: ' + (d.details || d.type)); aplicarTeste(c, { status: 'morto', motivo: 'HLS: ' + (d.details || d.type) }); salvar(); agendarTabela(); pintarFicha(c); } });
                    h.loadSource(url); h.attachMedia(v);
                }
            } else if (fmt === 'mpegts' || fmt === 'flv') {
                if (!(await carregarLib('mpegts')) || meu !== player.token) return status('Não consegui carregar o mpegts.js.');
                const m = player.mpegts = window.mpegts.createPlayer({ type: fmt === 'flv' ? 'flv' : 'mpegts', isLive: c.formato !== 'arquivo', url: new URL(url, location.href).href }, { enableStashBuffer: false, liveBufferLatencyChasing: true });
                m.on(window.mpegts.Events.ERROR, (t, d) => { if (meu === player.token) { status('Não tocou: ' + d); aplicarTeste(c, { status: 'morto', motivo: 'TS: ' + d }); salvar(); agendarTabela(); pintarFicha(c); } });
                m.attachMediaElement(v); m.load();
            } else {
                v.src = url;
            }
            const p = v.play();
            // o navegador às vezes não deixa começar COM som sem um clique: começa mudo e avisa no botão
            if (p && p.catch) p.catch((e) => { if (e && e.name === 'NotAllowedError' && !v.muted) { v.muted = true; pintarSom(); v.play().catch(() => {}); } });
        } catch (e) { status('Não tocou: ' + e.message); }
    }
    // ---------------------------------------------------------------- som da prévia
    function pintarSom() {
        const v = $('#le-video'), b = $('#le-mudo'), r = $('#le-vol');
        const mudo = v ? v.muted : E.som.mudo;
        if (b) { b.textContent = mudo || !E.som.vol ? '🔇' : E.som.vol < 0.5 ? '🔉' : '🔊'; b.title = (mudo ? 'Ligar o som' : 'Tirar o som') + ' (M)'; b.setAttribute('aria-pressed', String(!mudo)); }
        if (r) r.value = String(E.som.vol);
        const n = $('#le-vol-n'); if (n) n.textContent = Math.round(E.som.vol * 100) + '%';
    }
    function mudarSom({ mudo, vol } = {}) {
        if (vol != null) { E.som.vol = Math.max(0, Math.min(1, Math.round(vol * 100) / 100)); if (E.som.vol > 0 && mudo == null) mudo = false; }
        if (mudo != null) E.som.mudo = mudo;
        const v = $('#le-video'); if (v) { v.volume = E.som.vol; v.muted = E.som.mudo; }
        pintarSom(); salvar();
    }

    // ---------------------------------------------------------------- janelas (salvar, logo, atalhos)
    function janela(html) {
        fecharJanela();
        const d = document.createElement('div');
        d.className = 'le-jan-fundo';
        d.innerHTML = `<div class="le-jan" role="dialog" aria-modal="true">${html}<button class="le-jan-x" data-fechar aria-label="Fechar">✕</button></div>`;
        d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-fechar]')) fecharJanela(); });
        raiz.appendChild(d);
        return d;
    }
    function fecharJanela() { const d = raiz && raiz.querySelector('.le-jan-fundo'); if (d) { d.remove(); raiz.focus(); } }

    function mostrarAtalhos() {
        const A = [['↑ ↓', 'canal anterior / próximo'], ['Shift + ↑ ↓', 'marca enquanto anda'], ['PgUp PgDn · Home End', 'pula 10 · primeiro / último'],
            ['Clique na caixinha', 'marca / desmarca'], ['Shift + clique', 'marca o trecho inteiro (caixinha ou linha)'], ['Ctrl + clique na linha', 'marca / desmarca sem abrir'],
            ['X', 'marca / desmarca o canal do visualizador'], ['Ctrl + A', 'marca todos os visíveis'], ['Esc', 'desmarca tudo (ou fecha a janela)'],
            ['Espaço', 'tocar e testar'], ['T', 'scan dos marcados (ou dos visíveis)'], ['→', 'canal pra lista nova'], ['Enter', 'marcados pra lista nova'],
            ['Del', 'quarentena do canal'], ['Shift + Del', 'quarentena dos marcados'], ['L', 'logo do canal'], ['M · + −', 'som · volume'],
            ['/', 'buscar'], ['Ctrl + S', 'salvar a lista nova'], ['Ctrl + Z', 'desfazer'], ['?', 'esta ajuda']];
        janela(`<h3>Atalhos do teclado</h3><div class="le-atalhos">${A.map(([k, t]) => `<kbd>${esc(k)}</kbd><span>${esc(t)}</span>`).join('')}</div>`);
    }

    // ---------------------------------------------------------------- logos
    const ehImagem = (u) => /^(https?:|data:image\/)/i.test(String(u || ''));
    function copiasDe(c) { return E.canais.filter(x => x.chave === c.chave); }
    function usarLogo(c, url, todas) {
        lembrar();
        (todas ? copiasDe(c) : [c]).forEach(x => { x.logo = url || ''; });
        E.nova.itens.forEach(it => { if (it.chave === c.chave) it.logo = url || ''; });
        salvar(); agendarTabela(); desenharFiltros();
    }
    async function baixarImagem(url, nome) {
        try {
            const r = await fetch(url.startsWith('data:') ? url : local() ? viaTunel({}, url) : url);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const b = await r.blob();
            const ext = (/image\/(png|jpe?g|gif|webp|svg)/.exec(b.type) || [, (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.exec(url) || [, 'png'])[1]])[1].replace('jpeg', 'jpg').replace('svg', 'svg');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b); a.download = (L.norm(nome).replace(/ /g, '-') || 'logo') + '-logo.' + ext;
            document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        } catch (e) {
            window.open(url, '_blank', 'noopener');
            S.aviso('O site da imagem não deixou baixar direto; abri numa aba nova — lá use "Salvar imagem como".', 'ok');
        }
    }
    /** Imagem enviada do computador: reduz para no máximo 400 px (a lista não fica pesada) e vira PNG. */
    function lerImagemDoPC(arquivo) {
        return new Promise((ok, erro) => {
            const fr = new FileReader();
            fr.onerror = () => erro(new Error('não li o arquivo'));
            fr.onload = () => {
                if (/svg/.test(arquivo.type) && fr.result.length < 60000) return ok(fr.result);
                const img = new Image();
                img.onerror = () => erro(new Error('não é uma imagem'));
                img.onload = () => {
                    const k = Math.min(1, 400 / Math.max(img.width, img.height));
                    const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
                    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                    ok(cv.toDataURL('image/png'));
                };
                img.src = fr.result;
            };
            fr.readAsDataURL(arquivo);
        });
    }
    // banco aberto de canais do iptv-org (nome, outros nomes, país, logo) — baixado uma vez por sessão
    let bancoLogos = null;
    async function pegarJSON(url) {
        try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { /* sem CORS: tenta pelo painel local */ }
        if (local()) { const r = await (await fetch('/api/linkedit/lista?url=' + encodeURIComponent(url))).json(); if (!r.erro) return JSON.parse(r.texto); }
        throw new Error('não consegui baixar ' + url.split('/').pop());
    }
    function carregarBancoLogos() {
        if (!bancoLogos) {
            bancoLogos = Promise.all([pegarJSON(BANCO_LOGOS + 'channels.json'), pegarJSON(BANCO_LOGOS + 'logos.json').catch(() => [])]).then(([canais, logos]) => {
                const porCanal = new Map();
                (logos || []).forEach(l => { if (l && l.channel && l.url && !l.feed) { const a = porCanal.get(l.channel) || []; a.push(l); porCanal.set(l.channel, a); } });
                return (canais || []).map(ch => ({
                    id: ch.id, nome: ch.name, pais: ch.country, nomes: [ch.name].concat(ch.alt_names || []).map(L.norm),
                    logos: (porCanal.get(ch.id) || []).sort((a, b) => (b.width || 0) - (a.width || 0)).map(l => l.url).concat(ch.logo ? [ch.logo] : [])
                })).filter(x => x.logos.length);
            }).catch((e) => { bancoLogos = null; throw e; });
        }
        return bancoLogos;
    }
    /** Logos que combinam: mesmo tvg-id > mesmo nome no mesmo país > mesmo nome > nome parecido. */
    function acharLogos(banco, c, max = 12) {
        const id = String(c.tvgId || '').toLowerCase().split('@')[0];
        const n = L.norm(c.nome);
        const pts = [];
        for (const x of banco) {
            let p = 0;
            if (id && x.id.toLowerCase() === id) p = 100;
            else if (x.nomes.includes(n)) p = 70;
            else if (n.length >= 4 && x.nomes.some(m => m.startsWith(n + ' ') || n.startsWith(m + ' '))) p = 35;
            else continue;
            if (c.pais && x.pais === c.pais) p += 15;
            pts.push([p, x]);
        }
        return pts.sort((a, b) => b[0] - a[0]).slice(0, max).map(([p, x]) => ({ pontos: p, canal: x }));
    }
    async function acharLogosQueFaltam() {
        const alvo = (E.sel.size ? selecionados() : E.visiveis).filter(c => !ehImagem(c.logo));
        if (!alvo.length) return S.aviso('Todos esses canais já têm logo.', 'ok');
        S.aviso('Procurando logos no banco aberto do iptv-org…', 'ok');
        let banco;
        try { banco = await carregarBancoLogos(); } catch (e) { return S.aviso('Não consegui abrir o banco de logos: ' + e.message, 'ruim'); }
        lembrar();
        let n = 0;
        const feitos = new Set();
        alvo.forEach(c => {
            if (feitos.has(c.chave)) { const irmao = E.canais.find(x => x.chave === c.chave && ehImagem(x.logo)); if (irmao) { c.logo = irmao.logo; n++; } return; }
            const [m] = acharLogos(banco, c, 1);
            // só o que é certeza (mesmo tvg-id, ou mesmo nome no mesmo país); o resto você escolhe no logo do canal
            if (m && m.pontos >= 85) { copiasDe(c).forEach(x => { if (!ehImagem(x.logo)) x.logo = m.canal.logos[0]; }); feitos.add(c.chave); n++; }
        });
        salvar(); agendarTabela(); desenharFiltros();
        S.aviso(n ? `${n} logos colocados. Os que faltam: clique no quadrinho do logo e escolha na busca.` : 'Não achei logo certeiro para esses canais. Clique no quadrinho do logo para buscar e escolher.', n ? 'ok' : 'ruim');
    }
    function abrirLogo(c) {
        if (!c) return;
        const img = ehImagem(c.logo) ? c.logo : '';
        const nCopias = copiasDe(c).length;
        const j = janela(`<h3>Logo · ${esc(c.nome)}</h3>
          <div class="le-logo-grande">${img ? `<img id="le-logo-img" src="${esc(img)}" alt="Logo de ${esc(c.nome)}">` : '<span>Sem logo</span>'}</div>
          <p class="le-dica" id="le-logo-info" style="text-align:center">${img ? '' : 'Este canal ainda não tem logo. Escolha um abaixo.'}</p>
          ${img ? `<div class="le-jan-botoes" style="justify-content:center"><button class="le-bt p" id="le-logo-baixar">⤓ Baixar imagem</button><a class="le-bt" style="display:inline-flex;align-items:center;text-decoration:none" href="${esc(img.startsWith('data:') ? '#' : img)}" target="_blank" rel="noopener" ${img.startsWith('data:') ? 'hidden' : ''}>Abrir em aba nova</a><button class="le-bt" id="le-logo-tirar">Remover logo</button></div>` : ''}
          <div class="le-rot" style="margin-top:14px">${img ? 'Trocar o logo' : 'Inserir logo'}</div>
          <div style="display:flex;gap:6px;margin-top:6px"><input class="le-campo" id="le-logo-url" placeholder="Cole o link da imagem (PNG, JPG, SVG…)" style="flex:1"><button class="le-bt p" id="le-logo-usar">Usar</button></div>
          <div class="le-jan-botoes"><label class="le-bt" style="display:inline-flex;align-items:center;cursor:pointer">Enviar do computador<input type="file" id="le-logo-arq" accept="image/*" hidden></label>
            <button class="le-bt" id="le-logo-buscar">🔎 Buscar no banco de logos</button>
            <a class="le-bt" style="display:inline-flex;align-items:center;text-decoration:none" target="_blank" rel="noopener" href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent(c.nome + ' logo png')}">Procurar no Google</a></div>
          <div id="le-logo-res" class="le-logo-res"></div>
          ${nCopias > 1 ? `<label class="le-dica" style="display:flex;gap:6px;align-items:center;margin-top:10px"><input type="checkbox" id="le-logo-todas" checked> usar também nas outras ${nCopias - 1} cópias deste canal</label>` : ''}`);
        const todas = () => { const k = j.querySelector('#le-logo-todas'); return !k || k.checked; };
        const aplicar = (url, msg) => { usarLogo(c, url, todas()); S.aviso(msg || 'Logo trocado.', 'ok'); abrirLogo(c); };
        const im = j.querySelector('#le-logo-img');
        if (im) {
            im.onload = () => { const i = j.querySelector('#le-logo-info'); if (i) i.textContent = im.naturalWidth + ' × ' + im.naturalHeight + ' px' + (img.startsWith('data:') ? ' · enviada do computador' : ''); };
            im.onerror = () => { const i = j.querySelector('#le-logo-info'); if (i) i.textContent = 'A imagem não abriu (link quebrado?). Troque abaixo.'; };
        }
        const bx = j.querySelector('#le-logo-baixar'); if (bx) bx.onclick = () => baixarImagem(img, c.nome);
        const tr = j.querySelector('#le-logo-tirar'); if (tr) tr.onclick = () => aplicar('', 'Logo removido (Ctrl+Z volta).');
        const campo = j.querySelector('#le-logo-url');
        const usarCampo = () => { const u = campo.value.trim(); if (!ehImagem(u)) return S.aviso('Cole um link http(s) de imagem.', 'ruim'); aplicar(u); };
        j.querySelector('#le-logo-usar').onclick = usarCampo;
        campo.onkeydown = (e) => { if (e.key === 'Enter') usarCampo(); };
        j.querySelector('#le-logo-arq').onchange = async (e) => {
            const f = e.target.files[0]; if (!f) return;
            try { aplicar(await lerImagemDoPC(f), 'Logo enviado. Ele vai embutido na lista; se puder, prefira um link (lista fica mais leve).'); }
            catch (er) { S.aviso('Não consegui usar essa imagem: ' + er.message, 'ruim'); }
        };
        j.querySelector('#le-logo-buscar').onclick = async () => {
            const res = j.querySelector('#le-logo-res');
            res.innerHTML = '<p class="le-dica">Procurando no banco aberto do iptv-org (a primeira busca baixa o banco, alguns segundos)…</p>';
            try {
                const achados = acharLogos(await carregarBancoLogos(), c);
                if (!res.isConnected) return;
                const opcoes = [];
                achados.forEach(a => a.canal.logos.slice(0, 3).forEach(u => opcoes.push({ u, rot: a.canal.nome + (a.canal.pais ? ' · ' + a.canal.pais : '') })));
                res.innerHTML = opcoes.length ? opcoes.slice(0, 18).map(o => `<button class="le-logo-op" data-url="${esc(o.u)}" title="${esc(o.rot)}"><img src="${esc(o.u)}" alt="" loading="lazy"><small>${esc(o.rot)}</small></button>`).join('')
                    : '<p class="le-dica">Nada no banco com esse nome. Tente "Procurar no Google" e cole o link da imagem acima.</p>';
                res.querySelectorAll('[data-url]').forEach(b => { b.onclick = () => aplicar(b.dataset.url); });
            } catch (er) { res.innerHTML = `<p class="le-dica">Não consegui abrir o banco de logos (${esc(er.message)}). Use "Procurar no Google".</p>`; }
        };
    }

    /** Caixinha/linha clicada: Shift marca o trecho desde a última clicada (com o estado dela). */
    function marcar(id, trecho) {
        const lista = E.visiveis;
        const i = lista.findIndex(c => c.id === id), a = lista.findIndex(c => c.id === E.ancora);
        if (trecho && a >= 0 && i >= 0) {
            const ligar = E.sel.has(E.ancora) || !E.sel.size;
            for (let k = Math.min(a, i); k <= Math.max(a, i); k++) ligar ? E.sel.add(lista[k].id) : E.sel.delete(lista[k].id);
        } else {
            E.sel.has(id) ? E.sel.delete(id) : E.sel.add(id);
            E.ancora = id;
        }
        desenharTabela();
    }
    function marcarTodos() {
        const todos = E.visiveis.length && E.visiveis.every(c => E.sel.has(c.id));
        E.visiveis.forEach(c => (todos ? E.sel.delete(c.id) : E.sel.add(c.id)));
        desenharTabela();
    }
    function focar(id, tocarJa = true) {
        E.foco = id;
        const c = E.canais.find(x => x.id === id);
        pintarFicha(c);
        raiz.querySelectorAll('.le-linha.foco').forEach(el => el.classList.remove('foco'));
        const el = raiz.querySelector(`.le-linha[data-id="${CSS.escape(id)}"]`);
        if (el) el.classList.add('foco');
        if (c && tocarJa) tocar(c);
    }
    function vizinhoDoFoco(d) {
        const lista = E.visiveis;
        if (!lista.length) return null;
        const i = lista.findIndex(c => c.id === E.foco);
        const j = i < 0 ? 0 : Math.max(0, Math.min(lista.length - 1, i + d));
        return lista[j];
    }
    function andar(d) {
        const c = vizinhoDoFoco(d);
        if (!c) return;
        focar(c.id);
        const corpo = $('#le-corpo'), idx = E.visiveis.indexOf(c);
        if (corpo && idx >= 0) {
            const topo = idx * ALTURA_LINHA;
            if (topo < corpo.scrollTop) corpo.scrollTop = topo;
            else if (topo + ALTURA_LINHA > corpo.scrollTop + corpo.clientHeight) corpo.scrollTop = topo + ALTURA_LINHA - corpo.clientHeight;
        }
    }
    function pintarFicha(c) {
        const f = $('#le-ficha');
        if (!f) return;
        if (!c) { f.innerHTML = '<p class="le-dica">Clique num canal (ou use ↑ ↓) para ver e testar aqui.</p>'; return; }
        const t = c.teste || {};
        const h = c.historico || [];
        const conf = h.length ? `${h.filter(Boolean).length} de ${h.length}` : '—';
        f.innerHTML = `
          <div class="le-ficha-nome">${esc(c.nome)}</div>
          <div class="le-ficha-sub">${esc(c.grupo || '')}${c.grupo ? ' · ' : ''}${esc((E.listas.find(l => l.id === c.lista) || {}).nome || '')}</div>
          <div class="le-ficha-grade">
            <div><span>Formato</span><b>${esc((t.tipo || c.formato || '—').toUpperCase())}</b></div>
            <div><span>Imagem</span><b id="le-ficha-img">${esc(t.resolucao || '—')}</b></div>
            <div><span>Abriu em</span><b id="le-ficha-abriu">${t.ms ? (t.ms / 1000).toFixed(1).replace('.', ',') + ' s' : '—'}</b></div>
            <div><span>Status</span><b style="color:${COR_STATUS[t.status || 'nao-testado']}">${esc(ROTULO_STATUS[t.status || 'nao-testado'])}</b></div>
            <div><span>Idioma</span><b>${esc(c.idioma || '?')}</b></div>
            <div><span>Confiança</span><b>${esc(conf)}</b></div>
            ${c.formato === 'arquivo' || t.tamanho ? `<div><span>Tamanho</span><b>${t.tamanho ? (t.tamanho >= 1073741824 ? (t.tamanho / 1073741824).toFixed(1).replace('.', ',') + ' GB' : t.tamanho >= 1048576 ? Math.round(t.tamanho / 1048576) + ' MB' : Math.max(1, Math.round(t.tamanho / 1024)) + ' KB') : '—'}</b></div>
            <div><span>Duração</span><b id="le-ficha-dur">—</b></div>` : ''}
          </div>
          ${t.motivo ? `<div class="le-motivo">${esc(t.motivo)}</div>` : ''}
          <div class="le-url" title="${esc(c.url)}">${esc(c.url)}</div>`;
    }

    // ---------------------------------------------------------------- desenho
    function css() {
        if (document.getElementById('le-css')) return;
        const s = document.createElement('style'); s.id = 'le-css';
        s.textContent = `
#le-raiz{--c:#22d3ee;--r:#ff2d95;--b:#1f2430;--f:#07070a;--f2:#09090d;--f3:#0e1117;--s:#9aa3ad;display:flex;flex-direction:column;height:calc(100vh - 90px);min-height:560px;background:var(--f);color:#e5e7eb;border-radius:14px;overflow:hidden;border:1px solid var(--b);font-family:Inter,system-ui,sans-serif}
#le-raiz *{box-sizing:border-box}
#le-raiz button{font-family:inherit;cursor:pointer}
.le-topo{height:58px;padding:0 18px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--b);background:#0b0b10;flex-shrink:0}
.le-logo{font-size:19px;font-weight:900;letter-spacing:.04em}.le-logo b{color:var(--c)}.le-logo i{font-style:normal;color:var(--r)}
.le-bt{height:38px;padding:0 14px;border-radius:8px;border:1px solid #2a3140;background:#11141b;color:#e5e7eb;font-weight:800;font-size:12.5px;white-space:nowrap}
.le-bt:hover,.le-bt:focus-visible{border-color:var(--c);outline:none}
.le-bt.p{border:0;background:var(--c);color:#031417;font-weight:900}.le-bt.r{border:0;background:var(--r);color:#fff}
.le-bt:disabled{opacity:.45;cursor:not-allowed}
.le-cols{flex:1;display:grid;grid-template-columns:270px minmax(0,1fr) 380px;min-height:0}
.le-esq{border-right:1px solid var(--b);padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--f2);overflow:auto}
.le-rot{font-size:10.5px;font-weight:800;letter-spacing:.18em;color:#8b95a3;text-transform:uppercase}
.le-add{display:flex;flex-direction:column;gap:8px}
.le-add input,.le-add textarea,.le-busca{width:100%;border-radius:8px;border:1px solid #2a3140;background:#0d1016;color:#e5e7eb;padding:9px 11px;font:500 13px Inter,sans-serif}
.le-add textarea{height:70px;resize:vertical}
.le-lista{padding:11px 12px;border-radius:10px;background:#101318;border:1px solid var(--b);display:flex;gap:8px;align-items:flex-start}
.le-lista b{display:block;font-size:13.5px;word-break:break-all}.le-lista small{font-size:12px;color:var(--s)}
.le-lista button{margin-left:auto;background:none;border:0;color:#6b7480;font-size:14px;padding:2px 4px}
.le-chips{display:flex;flex-wrap:wrap;gap:6px}
.le-chip{padding:5px 10px;border-radius:999px;background:#161b24;color:#cbd5e1;font-size:12px;font-weight:700;border:1px solid transparent}
.le-chip small{color:#6b7480;font-weight:600;margin-left:4px}
.le-chip.on{background:#102a31;color:#67e8f9;border-color:#1f5560}.le-chip.on small{color:#67e8f9}
.le-chip.rosa.on{background:#2a1020;color:#ff7ac0;border-color:#5a1f40}
.le-meio{display:flex;flex-direction:column;min-width:0;min-height:0}
.le-barra{min-height:54px;padding:8px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--b);flex-wrap:wrap}
.le-busca{flex:1;min-width:180px;height:38px}
.le-scan{padding:8px 14px;border-bottom:1px solid var(--b);display:flex;align-items:center;gap:12px;font-size:12.5px;color:var(--s)}
.le-scan .trilho{flex:1;height:8px;border-radius:99px;background:#141821;overflow:hidden}.le-scan .trilho b{display:block;height:100%;background:var(--c)}
.le-cab,.le-linha{display:grid;grid-template-columns:30px 40px minmax(140px,1fr) minmax(70px,140px) 64px 92px 62px;gap:10px;align-items:center;padding:0 14px}
.le-cab{height:36px;color:#8b95a3;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;border-bottom:1px solid var(--b)}
#le-corpo{flex:1;overflow:auto;position:relative}
.le-linha{position:absolute;left:0;right:0;height:${ALTURA_LINHA}px;border-bottom:1px solid #141821;font-size:13px;cursor:pointer}
.le-linha:hover{background:#0d1117}.le-linha.foco{background:#0f1a1f;box-shadow:inset 3px 0 0 var(--c)}
.le-linha.na-nova .le-nome::after{content:' ✓';color:var(--r)}
.le-caixa{width:18px;height:18px;border-radius:5px;border:2px solid #3a4352;background:transparent;padding:0}
.le-caixa.on{background:var(--c);border-color:var(--c)}
.le-logo-c{width:34px;height:22px;border-radius:4px;background:#1a1f29 center/contain no-repeat}
.le-nome{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.le-g{color:var(--s);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.le-mono{font-family:'JetBrains Mono','Share Tech Mono',monospace;font-size:12px;color:#cbd5e1}
.le-st{font-weight:800;font-size:12px}
.le-rodape{min-height:40px;padding:6px 14px;display:flex;align-items:center;gap:14px;border-top:1px solid var(--b);color:var(--s);font-size:12px;flex-wrap:wrap}
.le-rodape b{color:#e5e7eb}
.le-dir{border-left:1px solid var(--b);display:flex;flex-direction:column;background:var(--f2);min-height:0}
.le-tela{position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#000;border:1px solid var(--c)}
.le-tela video{width:100%;height:100%;object-fit:contain;background:#000}
#le-tela-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:14px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.06em}
.le-ficha-nome{margin-top:10px;font-weight:900;font-size:15.5px}.le-ficha-sub{font-size:12px;color:var(--s)}
.le-ficha-grade{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:10px;font-size:11px}
.le-ficha-grade div{padding:7px 8px;border-radius:8px;background:#11141b}.le-ficha-grade span{display:block;color:#8b95a3}
.le-motivo{margin-top:8px;font-size:12px;color:#fcd34d}
.le-url{margin-top:8px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.le-nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}
.le-nav .le-bt{height:42px}
.le-nova{flex:1;border-top:1px solid var(--b);padding:14px 16px;display:flex;flex-direction:column;gap:8px;min-height:0}
.le-nova-nome{width:100%;background:transparent;border:0;border-bottom:1px dashed #3a1530;color:#ff9fd0;font:800 14px Inter,sans-serif;padding:4px 0}
.le-itens{flex:1;overflow:auto;display:flex;flex-direction:column;gap:5px}
.le-item{padding:8px 10px;border-radius:8px;background:#160f16;border:1px solid #3a1530;font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px}
.le-item span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.le-item small{color:var(--s);font-weight:600;white-space:nowrap}
.le-item button{background:none;border:0;color:#8b95a3;font-size:13px;padding:2px 5px}.le-item button:hover{color:#fff}
.le-saida{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.le-dica{font-size:12px;color:#8b95a3;margin:0}
#le-raiz{position:relative}
.le-linha{user-select:none}
.le-caixa.meio{border-color:var(--c);background:linear-gradient(var(--c),var(--c)) center/8px 2px no-repeat}
button.le-logo-c{border:0;padding:0;cursor:zoom-in}button.le-logo-c:hover,button.le-logo-c:focus-visible{outline:1px solid var(--c)}
.le-logo-c.vazio{cursor:pointer;color:#3a4352;font-weight:900;font-size:14px;line-height:22px}.le-logo-c.vazio::after{content:'+'}
.le-som{display:flex;align-items:center;gap:8px;margin-top:8px}.le-som .le-bt{height:32px;width:40px;padding:0;font-size:15px}
.le-som input{flex:1;accent-color:var(--c)}.le-som span{width:38px;text-align:right;color:var(--s)}
.le-jan-fundo{position:absolute;inset:0;z-index:30;background:rgba(3,4,8,.72);display:flex;align-items:center;justify-content:center;padding:20px}
.le-jan{position:relative;width:min(560px,100%);max-height:100%;overflow:auto;background:#0b0d13;border:1px solid var(--c);border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:8px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.le-jan h3{margin:0 30px 4px 0;font-size:16px;font-weight:900}
.le-jan-x{position:absolute;top:10px;right:10px;background:none;border:0;color:#8b95a3;font-size:16px}
.le-jan-botoes{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;margin-top:6px}
.le-campo{border-radius:8px;border:1px solid #2a3140;background:#0d1016;color:#e5e7eb;padding:9px 11px;font:500 13px Inter,sans-serif;height:38px}
.le-logo-grande{height:200px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#141821 0 25%,#0f1218 0 50%) 0 0/18px 18px;border:1px solid var(--b)}
.le-logo-grande img{max-width:92%;max-height:180px;object-fit:contain}.le-logo-grande span{color:#64748b;font-weight:800}
.le-logo-res{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-top:8px}
.le-logo-op{background:#11141b;border:1px solid #2a3140;border-radius:10px;padding:8px;display:flex;flex-direction:column;align-items:center;gap:6px;color:#cbd5e1}
.le-logo-op:hover,.le-logo-op:focus-visible{border-color:var(--c);outline:none}.le-logo-op img{height:54px;max-width:100%;object-fit:contain}
.le-logo-op small{font-size:10.5px;color:var(--s);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.le-atalhos{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;align-items:center;font-size:13px}
.le-atalhos kbd{font-family:'JetBrains Mono',monospace;font-size:11.5px;padding:3px 8px;border-radius:6px;background:#11141b;border:1px solid #2a3140;color:#67e8f9;white-space:nowrap;justify-self:start}
@media (max-width:1100px){.le-cols{grid-template-columns:1fr}.le-esq,.le-dir{border:0}#le-raiz{height:auto}#le-corpo{height:420px;flex:none}}`;
        document.head.appendChild(s);
    }

    function desenhar(area, ferramentas) {
        S = ferramentas;
        css();
        if (!E.listas.length && !E.canais.length) carregar();
        area.innerHTML = `
        <div id="le-raiz" tabindex="-1">
          <div class="le-topo">
            <div class="le-logo"><b>LINK</b><i>EDIT</i></div>
            <span class="chip ${local() ? 'ok' : ''}" title="${local() ? 'Testes e túnel do visualizador pelo painel do seu PC' : 'Online: o Scan e o túnel precisam do painel local (node tools/painel.mjs)'}">${local() ? 'painel local' : 'online'}</span>
            <div style="flex:1"></div>
            <button class="le-bt" id="le-desfazer" title="Desfazer (Ctrl+Z)">↶ Desfazer</button>
          </div>
          <div class="le-cols">
            <aside class="le-esq" aria-label="Listas e filtros">
              <div class="le-rot">Abrir lista</div>
              <div class="le-add">
                <input id="le-url" placeholder="Link da lista ou do canal (.m3u, .m3u8, .ts, JSON…)" aria-label="Link da lista ou do canal">
                <div style="display:flex;gap:6px"><button class="le-bt p" id="le-abrir" style="flex:1">Abrir link</button><label class="le-bt" style="display:inline-flex;align-items:center;cursor:pointer">Arquivo<input type="file" id="le-arquivo" accept=".m3u,.m3u8,.json,.txt,text/*" multiple hidden></label></div>
                <textarea id="le-colar" placeholder="…ou cole qualquer texto com links (lista, página, conversa)" aria-label="Colar texto"></textarea>
                <button class="le-bt" id="le-ler-colado">Ler o texto colado</button>
              </div>
              <div class="le-rot">Listas abertas</div>
              <div id="le-listas" style="display:flex;flex-direction:column;gap:8px"></div>
              <div class="le-rot">Filtrar</div>
              <div id="le-filtros"></div>
            </aside>
            <main class="le-meio" aria-label="Canais">
              <div class="le-barra">
                <input class="le-busca" id="le-busca" placeholder="Buscar canal, grupo, tvg-id…" aria-label="Buscar canal" value="${esc(E.f.busca)}">
                <button class="le-bt" id="le-sel-todos" title="Seleciona todos os canais que aparecem com os filtros atuais">Selecionar visíveis</button>
                <button class="le-bt" id="le-sel-vivos">Selecionar vivos</button>
                <button class="le-bt" id="le-scan" title="Testa os selecionados (ou todos os visíveis)">Scan</button>
                <button class="le-bt" id="le-quarentena" title="Tira da lista principal (pode voltar depois)">Quarentena</button>
                <button class="le-bt" id="le-logos" title="Coloca o logo que falta nos marcados (ou visíveis), pelo banco aberto do iptv-org">Achar logos</button>
                <button class="le-bt r" id="le-jogar">➜ Jogar na lista nova</button>
                <button class="le-bt" id="le-ajuda" title="Atalhos do teclado (?)" aria-label="Atalhos do teclado">?</button>
              </div>
              <div class="le-scan" id="le-scan-barra" hidden></div>
              <div class="le-cab" role="row"><button class="le-caixa" id="le-cab-todos" title="Marcar todos os visíveis (Ctrl+A)" aria-label="Marcar todos os visíveis"></button><span>Logo</span><span>Canal</span><span>Grupo</span><span>Idioma</span><span>Status</span><span>Abre em</span></div>
              <div id="le-corpo" role="table" aria-label="Canais"><div id="le-alto" style="position:relative"></div></div>
              <div class="le-rodape" id="le-rodape"></div>
            </main>
            <aside class="le-dir" aria-label="Visualizador e lista nova">
              <div style="padding:14px 16px">
                <div class="le-tela"><video id="le-video" muted playsinline></video><div id="le-tela-msg">PRÉVIA</div></div>
                <div class="le-som"><button class="le-bt" id="le-mudo" aria-label="Som da prévia">🔇</button><input type="range" id="le-vol" min="0" max="1" step="0.05" aria-label="Volume da prévia"><span id="le-vol-n" class="le-mono"></span></div>
                <div id="le-ficha"></div>
                <div class="le-nav">
                  <button class="le-bt" id="le-ant">◀ Anterior</button>
                  <button class="le-bt p" id="le-vai" title="→">✓ Vai pra lista</button>
                  <button class="le-bt" id="le-prox">Próximo ▶</button>
                </div>
              </div>
              <div class="le-nova">
                <div style="display:flex;align-items:center;gap:8px"><div class="le-rot" style="color:#ff7ac0">Lista nova</div><small id="le-nova-n" style="margin-left:auto;color:#9aa3ad;font-size:12px"></small></div>
                <input class="le-nova-nome" id="le-nova-nome" value="${esc(E.nova.nome)}" aria-label="Nome da lista nova">
                <div class="le-itens" id="le-itens"></div>
                <div class="le-saida">
                  <button class="le-bt p" data-baixar="m3u">M3U</button><button class="le-bt" data-baixar="json">JSON</button><button class="le-bt" data-baixar="txt">TXT</button><button class="le-bt" id="le-copiar">Copiar</button>
                </div>
                <p class="le-dica">Atalhos: <b>↑ ↓</b> canal · <b>Shift+clique</b> trecho · <b>Espaço</b> testar · <b>→</b> lista nova · <b>Del</b> quarentena · <b>Ctrl+Z</b> desfazer · <b>?</b> todos</p>
              </div>
            </aside>
          </div>
        </div>`;
        raiz = area.querySelector('#le-raiz');
        ligar();
        desenharTudo();
        pintarFicha(E.canais.find(c => c.id === E.foco));
    }

    function desenharTudo() {
        if (!raiz || !raiz.isConnected) return;
        desenharListas(); desenharFiltros(); desenharTabela(); desenharNova(); desenharScan();
    }
    function desenharListas() {
        const el = $('#le-listas'); if (!el) return;
        if (!E.listas.length) { el.innerHTML = '<p class="le-dica">Nenhuma lista aberta ainda.</p>'; return; }
        el.innerHTML = E.listas.map((l) => {
            const cs = E.canais.filter(c => c.lista === l.id);
            const vivos = cs.filter(c => c.teste && /vivo|lento|pede-ua/.test(c.teste.status)).length;
            const testados = cs.filter(c => c.teste).length;
            return `<div class="le-lista"><div><b>${esc(l.nome)}</b><small>${esc(l.formato.toUpperCase())} · ${cs.length} canais · ${testados ? `<span style="color:#4ade80">${vivos} vivos</span>` : '<span style="color:#fbbf24">não testada</span>'}</small></div><button data-tirar-lista="${esc(l.id)}" title="Fechar a lista" aria-label="Fechar a lista ${esc(l.nome)}">✕</button></div>`;
        }).join('');
    }
    function desenharFiltros() {
        const el = $('#le-filtros'); if (!el) return;
        filtrados();
        const C = E.cont;
        const grupo = (rot, campo, mapa, rotulos = {}) => {
            const ops = [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
            if (ops.length < 2 && !E.f[campo].size) return '';
            return `<div style="margin-bottom:10px"><div class="le-dica" style="margin-bottom:5px">${esc(rot)}</div><div class="le-chips">${ops.map(([k, n]) => `<button class="le-chip ${E.f[campo].has(k) ? 'on' : ''}" data-f="${campo}" data-v="${esc(k)}">${esc(rotulos[k] || (k === '?' ? 'sem info' : k))}<small>${n}</small></button>`).join('')}</div></div>`;
        };
        el.innerHTML = `
          <div class="le-chips" style="margin-bottom:10px">
            <button class="le-chip rosa ${E.f.soVivos ? 'on' : ''}" data-t="soVivos">Só vivos</button>
            <button class="le-chip ${E.f.semLogo ? 'on' : ''}" data-t="semLogo">Sem logo</button>
            <button class="le-chip ${E.f.duplicados ? 'on' : ''}" data-t="duplicados">Duplicados</button>
            <button class="le-chip ${E.f.quarentena ? 'on' : ''}" data-t="quarentena">Quarentena</button>
          </div>
          ${grupo('Idioma', 'idiomas', C.idiomas)}${grupo('Tipo', 'tipos', C.tipos)}${grupo('País', 'paises', C.paises)}${grupo('Status', 'status', C.status, ROTULO_STATUS)}`;
    }
    let pedidoTabela = 0;
    function agendarTabela() { if (pedidoTabela) return; pedidoTabela = requestAnimationFrame(() => { pedidoTabela = 0; desenharTabela(); }); }
    function desenharTabela() {
        const corpo = $('#le-corpo'), alto = $('#le-alto'); if (!corpo || !alto) return;
        E.visiveis = filtrados();
        alto.style.height = E.visiveis.length * ALTURA_LINHA + 'px';
        pintarJanela();
        const ct = $('#le-cab-todos');
        if (ct) {
            const n = E.visiveis.filter(c => E.sel.has(c.id)).length;
            ct.classList.toggle('on', !!n && n === E.visiveis.length); ct.classList.toggle('meio', !!n && n < E.visiveis.length);
            ct.setAttribute('aria-pressed', n && n === E.visiveis.length ? 'true' : n ? 'mixed' : 'false');
        }
        const r = $('#le-rodape');
        if (r) {
            const s = E.cont.status;
            const vivos = (s.get('vivo') || 0) + (s.get('lento') || 0) + (s.get('pede-ua') || 0);
            r.innerHTML = `<span><b>${E.visiveis.length}</b> de ${E.canais.length} canais</span><span><b style="color:#4ade80">${vivos}</b> vivos</span><span><b style="color:#f87171">${(s.get('morto') || 0) + (s.get('bloqueado') || 0)}</b> com problema</span><span><b style="color:#a78bfa">${[...E.cont.chaves.values()].filter(n => n > 1).length}</b> canais com cópia</span><span><b style="color:#67e8f9">${E.sel.size}</b> selecionados</span>`;
        }
    }
    function pintarJanela() {
        const corpo = $('#le-corpo'), alto = $('#le-alto'); if (!corpo || !alto) return;
        const de = Math.max(0, Math.floor(corpo.scrollTop / ALTURA_LINHA) - 8);
        const ate = Math.min(E.visiveis.length, de + Math.ceil((corpo.clientHeight || 600) / ALTURA_LINHA) + 16);
        const naNova = new Set(E.nova.itens.map(i => i.chave));
        let h = '';
        for (let i = de; i < ate; i++) {
            const c = E.visiveis[i];
            const st = c.testando ? 'testando' : (c.teste && c.teste.status) || 'nao-testado';
            const logo = ehImagem(c.logo) ? `background-image:url('${esc(c.logo.replace(/'/g, '%27'))}')` : '';
            h += `<div class="le-linha${c.id === E.foco ? ' foco' : ''}${naNova.has(c.chave) ? ' na-nova' : ''}" role="row" data-id="${esc(c.id)}" style="top:${i * ALTURA_LINHA}px">
              <button class="le-caixa ${E.sel.has(c.id) ? 'on' : ''}" data-sel="${esc(c.id)}" aria-label="Selecionar ${esc(c.nome)}" aria-pressed="${E.sel.has(c.id)}"></button>
              <button class="le-logo-c${logo ? '' : ' vazio'}" style="${logo}" data-logo="${esc(c.id)}" title="${logo ? 'Ver, baixar ou trocar o logo (L)' : 'Inserir logo (L)'}" aria-label="Logo de ${esc(c.nome)}"></button>
              <span class="le-nome" title="${esc(c.nomeOriginal || c.nome)}">${esc(c.nome)}</span>
              <span class="le-g" title="${esc(c.grupo)}">${esc(c.grupo || c.tipo)}</span>
              <span class="le-mono">${esc(c.idioma || '—')}</span>
              <span class="le-st" style="color:${COR_STATUS[st]}" title="${esc((c.teste && c.teste.motivo) || '')}">${esc(ROTULO_STATUS[st])}</span>
              <span class="le-mono" style="color:#9aa3ad">${c.teste && c.teste.ms && /vivo|lento|pede-ua/.test(c.teste.status) ? (c.teste.ms / 1000).toFixed(1).replace('.', ',') + ' s' : '—'}</span>
            </div>`;
        }
        alto.innerHTML = h || (E.canais.length ? '<p class="le-dica" style="padding:20px">Nenhum canal com esses filtros.</p>' : '<p class="le-dica" style="padding:20px">Abra uma lista à esquerda: link, arquivo ou texto colado.</p>');
    }
    function desenharNova() {
        const el = $('#le-itens'); if (!el) return;
        const n = $('#le-nova-n'); if (n) n.textContent = E.nova.itens.length + ' canais';
        el.innerHTML = E.nova.itens.length ? E.nova.itens.map((it, i) => `
          <div class="le-item"><span title="${esc(it.url)}">${esc(it.nome)}</span>${it.reservas.length ? `<small>${it.reservas.length} reserva${it.reservas.length > 1 ? 's' : ''}</small>` : ''}
            <button data-subir="${i}" aria-label="Subir ${esc(it.nome)}" title="Subir">▲</button><button data-descer="${i}" aria-label="Descer ${esc(it.nome)}" title="Descer">▼</button><button data-tirar="${i}" aria-label="Tirar ${esc(it.nome)}" title="Tirar da lista">✕</button></div>`).join('')
            : '<p class="le-dica">Selecione canais e clique em "Jogar na lista nova" (ou → no canal do visualizador). Cópias do mesmo canal entram como reserva.</p>';
    }
    function desenharScan() {
        const el = $('#le-scan-barra'); if (!el) return;
        const sc = E.scan;
        const b = $('#le-scan'); if (b) b.textContent = sc ? 'Scan…' : 'Scan';
        if (!sc) { el.hidden = true; return; }
        el.hidden = false;
        el.innerHTML = `<span>Testando <b style="color:#e5e7eb">${sc.feitos}</b> de ${sc.total} · <b style="color:#4ade80">${sc.vivos}</b> vivos · <b style="color:#f87171">${sc.mortos}</b> com problema</span><span class="trilho"><b style="width:${Math.round(sc.feitos / sc.total * 100)}%"></b></span><button class="le-bt" id="le-scan-parar">Parar</button>`;
        const p = $('#le-scan-parar'); if (p) p.onclick = () => { sc.parar = true; };
    }

    // ---------------------------------------------------------------- eventos
    function selecionados() { return E.canais.filter(c => E.sel.has(c.id)); }
    let tecladoLigado = false;
    function ligar() {
        $('#le-abrir').onclick = () => abrirLink($('#le-url').value);
        $('#le-url').onkeydown = (e) => { if (e.key === 'Enter') abrirLink(e.target.value); };
        $('#le-arquivo').onchange = async (e) => { for (const f of e.target.files) adicionarLista(await f.text(), f.name); e.target.value = ''; };
        $('#le-ler-colado').onclick = () => { const t = $('#le-colar').value; if (t.trim()) { adicionarLista(t, 'Texto colado ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })); $('#le-colar').value = ''; } };
        $('#le-desfazer').onclick = desfazer;
        let tb = 0;
        $('#le-busca').oninput = (e) => { clearTimeout(tb); tb = setTimeout(() => { E.f.busca = e.target.value; $('#le-corpo').scrollTop = 0; desenharTabela(); }, 120); };
        $('#le-corpo').addEventListener('scroll', () => requestAnimationFrame(pintarJanela), { passive: true });
        $('#le-sel-todos').onclick = () => { const todos = E.visiveis.every(c => E.sel.has(c.id)); E.visiveis.forEach(c => (todos ? E.sel.delete(c.id) : E.sel.add(c.id))); desenharTabela(); };
        $('#le-sel-vivos').onclick = () => { E.visiveis.forEach(c => { if (c.teste && /vivo|lento|pede-ua/.test(c.teste.status)) E.sel.add(c.id); }); desenharTabela(); };
        $('#le-scan').onclick = () => scan(E.sel.size ? selecionados() : E.visiveis);
        $('#le-quarentena').onclick = () => { const l = E.sel.size ? selecionados() : []; if (!l.length) return S.aviso('Selecione os canais (ou use Del no canal do visualizador).', 'ruim'); quarentena(l, !E.f.quarentena); };
        $('#le-jogar').onclick = () => { const l = selecionados(); if (!l.length) return S.aviso('Selecione os canais primeiro (a caixinha à esquerda de cada um).', 'ruim'); jogarNaLista(l); E.sel.clear(); desenharTabela(); };
        $('#le-ant').onclick = () => andar(-1);
        $('#le-prox').onclick = () => andar(1);
        $('#le-vai').onclick = () => { const c = E.canais.find(x => x.id === E.foco); if (c) { jogarNaLista([c]); andar(1); } };
        $('#le-copiar').onclick = copiar;
        $('#le-nova-nome').onchange = (e) => { E.nova.nome = e.target.value.trim() || 'Lista nova'; salvar(); };
        raiz.querySelectorAll('[data-baixar]').forEach(b => { b.onclick = () => pedirNomeEBaixar(b.dataset.baixar); });
        $('#le-cab-todos').onclick = marcarTodos;
        $('#le-logos').onclick = acharLogosQueFaltam;
        $('#le-ajuda').onclick = mostrarAtalhos;
        $('#le-mudo').onclick = () => { const v = $('#le-video'); mudarSom({ mudo: !(v ? v.muted : E.som.mudo), vol: !E.som.vol ? 0.6 : undefined }); };
        $('#le-vol').oninput = (e) => mudarSom({ vol: +e.target.value });
        pintarSom();
        raiz.addEventListener('click', (e) => {
            const t = e.target.closest('button, .le-linha');
            if (!t) return;
            if (t.dataset.tirarLista) return removerLista(t.dataset.tirarLista);
            if (t.dataset.sel) return marcar(t.dataset.sel, e.shiftKey);
            if (t.dataset.logo) return abrirLogo(E.canais.find(c => c.id === t.dataset.logo));
            if (t.dataset.f) { const s = E.f[t.dataset.f]; s.has(t.dataset.v) ? s.delete(t.dataset.v) : s.add(t.dataset.v); desenharFiltros(); desenharTabela(); return; }
            if (t.dataset.t) { E.f[t.dataset.t] = !E.f[t.dataset.t]; desenharFiltros(); desenharTabela(); return; }
            if (t.dataset.subir) return moverNaNova(+t.dataset.subir, -1);
            if (t.dataset.descer) return moverNaNova(+t.dataset.descer, 1);
            if (t.dataset.tirar) return tirarDaNova(+t.dataset.tirar);
            if (t.classList.contains('le-linha')) {
                if (e.shiftKey && E.ancora) return marcar(t.dataset.id, true);
                if (e.ctrlKey || e.metaKey) return marcar(t.dataset.id, false);
                E.ancora = t.dataset.id; focar(t.dataset.id);
            }
        });
        // no documento (uma vez só): a tabela se redesenha e o foco do clique some; o atalho tem que continuar valendo
        if (tecladoLigado) return;
        tecladoLigado = true;
        document.addEventListener('keydown', (e) => {
            if (!raiz || !raiz.isConnected) return;
            if (e.target !== document.body && e.target !== document.documentElement && !raiz.contains(e.target)) return;
            if (raiz.querySelector('.le-jan-fundo')) { if (e.key === 'Escape') { e.preventDefault(); fecharJanela(); } return; }
            if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
            const c = E.canais.find(x => x.id === E.foco);
            const ctrl = e.ctrlKey || e.metaKey, k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.shiftKey) {
                e.preventDefault();
                if (c) E.sel.add(c.id);
                andar(e.key === 'ArrowDown' ? 1 : -1);
                const n = E.canais.find(x => x.id === E.foco); if (n) { E.sel.add(n.id); E.ancora = n.id; }
                desenharTabela();
            }
            else if (e.key === 'ArrowDown') { e.preventDefault(); andar(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); andar(-1); }
            else if (e.key === 'PageDown') { e.preventDefault(); andar(10); }
            else if (e.key === 'PageUp') { e.preventDefault(); andar(-10); }
            else if (e.key === 'Home') { e.preventDefault(); andar(-1e9); }
            else if (e.key === 'End') { e.preventDefault(); andar(1e9); }
            else if (ctrl && k === 'a') { e.preventDefault(); marcarTodos(); }
            else if (ctrl && k === 's') { e.preventDefault(); pedirNomeEBaixar('m3u'); }
            else if (e.key === 'Escape') { if (E.sel.size) { E.sel.clear(); desenharTabela(); } }
            else if (!ctrl && k === 'x' && c) { e.preventDefault(); marcar(c.id, false); }
            else if (!ctrl && k === 't') { e.preventDefault(); scan(E.sel.size ? selecionados() : E.visiveis); }
            else if (!ctrl && k === 'l' && c) { e.preventDefault(); abrirLogo(c); }
            else if (!ctrl && k === 'm') { e.preventDefault(); $('#le-mudo').click(); }
            else if (!ctrl && (k === '+' || k === '=')) { e.preventDefault(); mudarSom({ vol: E.som.vol + 0.1 }); }
            else if (!ctrl && (k === '-' || k === '_')) { e.preventDefault(); mudarSom({ vol: E.som.vol - 0.1 }); }
            else if (!ctrl && k === '/') { e.preventDefault(); const b = $('#le-busca'); if (b) { b.focus(); b.select(); } }
            else if (!ctrl && k === '?') { e.preventDefault(); mostrarAtalhos(); }
            else if (e.key === 'Enter' && E.sel.size) { e.preventDefault(); jogarNaLista(selecionados()); E.sel.clear(); desenharTabela(); }
            else if (e.key === 'Delete' && e.shiftKey && E.sel.size) { e.preventDefault(); quarentena(selecionados(), !E.f.quarentena); }
            else if (e.key === 'ArrowRight' && c) { e.preventDefault(); jogarNaLista([c]); andar(1); }
            else if (e.key === ' ' && c) { e.preventDefault(); tocar(c); testarUm(c).then(() => { salvar(); agendarTabela(); pintarFicha(c); }); }
            else if ((e.key === 'Delete' || e.key === 'Backspace') && c) { e.preventDefault(); const prox = vizinhoDoFoco(1); quarentena([c], !c.quarentena); if (prox && prox !== c) focar(prox.id); }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); desfazer(); }
        });
    }

    window.CZLinkEdit = { desenhar, parar: pararVideo, _estado: E };
})();
