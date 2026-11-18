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
        f: { busca: '', idiomas: new Set(), tipos: new Set(), paises: new Set(), status: new Set(), soVivos: false, semLogo: false, semGuia: false, semCategoria: false, duplicados: false, quarentena: false },
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
        E.desfazer.push(JSON.stringify({ nova: E.nova, flags: E.canais.map(c => [c.id, !!c.quarentena, !!c.fixo, c.logo || '', c.idioma || '', c.pais || '', c.chave, !!c.idiomaManual, c.tvgId || '', c.epgId || '', c.epgGuia || '', c.epgShift || 0, c.tvgIdOriginal, c.grupoSaida || '', !!c.categoriaManual]) }));
        if (E.desfazer.length > 60) E.desfazer.shift();
    }
    function desfazer() {
        const ult = E.desfazer.pop();
        if (!ult) return S.aviso('Nada para desfazer.', 'ok');
        const d = JSON.parse(ult);
        E.nova = d.nova;
        const m = new Map(d.flags.map(f => [f[0], f]));
        E.canais.forEach(c => { const f = m.get(c.id); if (f) { c.quarentena = f[1]; c.fixo = f[2]; if (f.length > 3) c.logo = f[3]; if (f.length > 6) { c.idioma = f[4]; c.pais = f[5]; c.chave = f[6]; c.idiomaManual = f[7]; }
            if (f.length > 8) { c.tvgId = f[8]; c.epgId = f[9] || undefined; c.epgGuia = f[10] || undefined; c.epgShift = f[11] || undefined; c.tvgIdOriginal = f[12]; if (!c.epgId) delete c.epgId; }
            if (f.length > 13) { if (f[13]) { c.grupoSaida = f[13]; c.categoriaManual = f[14]; } else { delete c.grupoSaida; delete c.categoriaManual; } } } });
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
            E.nova.itens.push({ id: c.id, chave: c.chave, nome: c.nome, nomeOriginal: c.nomeOriginal, formato: c.formato, teste: c.teste, url: c.url, reservas: c.reservas.slice(), logo: c.logo, tvgId: c.tvgId, grupo: c.grupo, tipo: c.tipo, pais: c.pais, idioma: c.idioma, epgId: c.epgId, epgGuia: c.epgGuia, epgShift: c.epgShift, grupoSaida: c.grupoSaida, headers: c.headers || {} });
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
    // ---------------------------------------------------------------- SCAN EM LOTE
    // Testa centenas/milhares de canais pelo painel do PC: N ao mesmo tempo, pausar/continuar/parar, tempo restante,
    // contadores, gráfico do tempo de abertura e, no fim, ações de um clique. Na quarentena, o canal que morre
    // 3 vezes seguidas pode ser apagado de vez; o que volta a abrir sai da quarentena sozinho.
    const VIVO = (st) => st === 'vivo' || st === 'lento' || st === 'pede-ua';
    const esperar = (ms) => new Promise(r => setTimeout(r, ms));
    let velocidadeScan = 8;
    try { velocidadeScan = +localStorage.getItem(GUARDA + '-vel') || 8; } catch (e) { /* */ }
    async function scan(lista, opts = {}) {
        if (!local()) return abrirScan();
        if (E.scan) return S.aviso('Já tem um scan rodando (barra acima da tabela).', 'ruim');
        const alvo = lista.filter(c => !/^(magnet|rtmp|rtsp|udp|srt|mms)/i.test(c.url));
        if (!alvo.length) return S.aviso('Nada para testar aqui.', 'ruim');
        const sc = E.scan = { total: alvo.length, feitos: 0, parar: false, pausado: false, t0: Date.now(), pausaMs: 0,
            n: { vivo: 0, lento: 0, 'pede-ua': 0, bloqueado: 0, morto: 0 }, ultimos: [], alvo, rotulo: opts.rotulo || '', quarentena: !!opts.quarentena };
        desenharScan(); pintarScanJanela();
        let i = 0;
        const trabalhar = async () => {
            while (!sc.parar && i < alvo.length) {
                while (sc.pausado && !sc.parar) await esperar(250);
                if (sc.parar) break;
                const c = alvo[i++];
                c.testando = true;
                const r = await testarUm(c);
                c.testando = false;
                sc.feitos++;
                if (r && r.status) {
                    sc.n[r.status] = (sc.n[r.status] || 0) + 1;
                    if (sc.quarentena) {
                        if (VIVO(r.status)) { c.quarentena = false; c.mortesSeguidas = 0; }
                        else c.mortesSeguidas = (c.mortesSeguidas || 0) + 1;
                    }
                    sc.ultimos.unshift({ nome: c.nome, st: r.status, txt: VIVO(r.status) ? [r.tipo && String(r.tipo).toUpperCase(), r.resolucao, r.ms ? (r.ms / 1000).toFixed(1).replace('.', ',') + ' s' : ''].filter(Boolean).join(' · ') : (r.motivo || '') });
                    sc.ultimos.length = Math.min(sc.ultimos.length, 8);
                }
                if (sc.feitos % 4 === 0 || sc.feitos === sc.total) { desenharScan(); agendarTabela(); pintarScanJanela(); }
                if (sc.feitos % 50 === 0) salvar();
            }
        };
        await Promise.all(Array.from({ length: Math.min(velocidadeScan, alvo.length) }, trabalhar));
        sc.fim = Date.now();
        E.scan = null;
        E.ultimoScan = sc;
        salvar(); desenharTudo(); pintarScanJanela();
        const vivos = sc.n.vivo + sc.n.lento + sc.n['pede-ua'];
        S.aviso(`Scan${sc.parar ? ' parado' : ''}: ${sc.feitos} testados · ${vivos} vivos · ${sc.feitos - vivos} com problema.`, 'ok');
    }
    const tempoTxt = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? s + ' s' : s < 3600 ? Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s' : Math.floor(s / 3600) + ' h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ' min'; };
    function pausarScan(sim) { const sc = E.scan; if (!sc) return; if (sim && !sc.pausado) sc.pausadoEm = Date.now(); if (!sim && sc.pausado && sc.pausadoEm) sc.pausaMs += Date.now() - sc.pausadoEm; sc.pausado = sim; desenharScan(); pintarScanJanela(); }
    /** Janela do Scan: o que testar, como, velocidade; acompanha ao vivo e, no fim, as ações de um clique. */
    function abrirScan() {
        const conta = (f) => E.canais.filter(c => !c.quarentena && f(c)).length;
        const vis = E.visiveis.length ? E.visiveis : E.canais.filter(c => !c.quarentena);
        const ALVOS = [
            ['marcados', `Os marcados`, () => selecionados()],
            ['visiveis', `Os que aparecem agora (filtros)`, () => vis],
            ['nunca', `Só os que nunca foram testados`, () => E.canais.filter(c => !c.quarentena && !c.teste)],
            ['mortos', `Retestar os mortos e bloqueados`, () => E.canais.filter(c => !c.quarentena && c.teste && !VIVO(c.teste.status))],
            ['quarentena', `A quarentena (volta quem abrir)`, () => E.canais.filter(c => c.quarentena)]
        ];
        const padrao = E.sel.size ? 'marcados' : conta(c => !c.teste) ? 'nunca' : 'visiveis';
        const j = janela(`<h3>Scan em lote</h3>
          ${local() ? '' : `<div class="le-aviso-scan"><b>O Scan precisa do painel do seu PC.</b> O navegador sozinho não abre a maioria dos canais (links <code>http://</code> numa página <code>https://</code> e servidores que não deixam outra página ler). Na pasta do Studio rode <code>node tools/painel.mjs</code> e abra <code>http://localhost:4321</code> — lá o Scan testa vários canais ao mesmo tempo.</div>`}
          <div id="le-sj-config">
            <div class="le-rot" style="margin-top:4px">O que testar</div>
            <div class="le-sj-alvos">${ALVOS.map(([k, rot, f]) => { const n = f().length; return `<label class="le-sj-op${n ? '' : ' vazia'}"><input type="radio" name="le-sj-alvo" value="${k}" ${k === padrao ? 'checked' : ''} ${n ? '' : 'disabled'}> ${esc(rot)} <small>${n}</small></label>`; }).join('')}</div>
            <div class="le-imp-op" style="margin-top:10px">
              <label>Como <select class="le-campo" id="le-sj-modo"><option value="rapido">Rápido — só confere se responde</option><option value="completo">Completo — abre o stream (resolução, 1º pedaço)</option></select></label>
              <label>Ao mesmo tempo <select class="le-campo" id="le-sj-vel">${[4, 8, 16, 24, 32].map(v => `<option value="${v}" ${v === velocidadeScan ? 'selected' : ''}>${v} canais</option>`).join('')}</select></label>
              <button class="le-bt p" id="le-sj-ir" ${local() ? '' : 'disabled'}>▶ Começar</button>
            </div>
            <p class="le-dica">Dica: comece no <b>Rápido</b> com 16 ou 24 (milhares em poucos minutos) e passe o <b>Completo</b> só nos vivos. Muitos ao mesmo tempo podem fazer alguns servidores recusarem.</p>
          </div>
          <div id="le-sj-vivo"></div>`, 'larga');
        j.querySelector('#le-sj-modo').value = E.modoTeste;
        j.querySelector('#le-sj-ir').onclick = () => {
            const k = (j.querySelector('input[name="le-sj-alvo"]:checked') || {}).value;
            const a = ALVOS.find(x => x[0] === k);
            if (!a) return S.aviso('Escolha o que testar.', 'ruim');
            E.modoTeste = j.querySelector('#le-sj-modo').value;
            velocidadeScan = +j.querySelector('#le-sj-vel').value || 8;
            try { localStorage.setItem(GUARDA + '-vel', String(velocidadeScan)); } catch (e) { /* */ }
            salvar();
            scan(a[2](), { rotulo: a[1], quarentena: k === 'quarentena' });
        };
        pintarScanJanela();
    }
    function pintarScanJanela() {
        const el = raiz && raiz.querySelector('#le-sj-vivo'); if (!el) return;
        const sc = E.scan || E.ultimoScan;
        const cfg = raiz.querySelector('#le-sj-config'); if (cfg) cfg.hidden = !!E.scan;
        if (!sc) { el.innerHTML = ''; return; }
        const rodando = !!E.scan;
        const gasto = (sc.fim || Date.now()) - sc.t0 - sc.pausaMs - (sc.pausado && sc.pausadoEm ? Date.now() - sc.pausadoEm : 0);
        const resta = sc.feitos ? gasto / sc.feitos * (sc.total - sc.feitos) : 0;
        const vivos = sc.n.vivo + sc.n.lento + sc.n['pede-ua'];
        const CARDS = [['vivo', 'Vivos', '#4ade80', 'abre rápido'], ['lento', 'Lentos', '#fbbf24', 'mais de 4 s'], ['pede-ua', 'Pedem UA', '#67e8f9', 'só com User-Agent de player (guardado)'], ['bloqueado', 'Bloqueados', '#a78bfa', 'país, app ou link vencido'], ['morto', 'Mortos', '#f87171', 'não abrem']];
        // tempo para abrir (só vivos do alvo)
        const faixas = [[0, 1000, '< 1 s'], [1000, 2000, '1–2 s'], [2000, 4000, '2–4 s'], [4000, 8000, '4–8 s'], [8000, 1e12, '> 8 s']];
        const ms = sc.alvo.filter(c => c.teste && VIVO(c.teste.status) && c.teste.ms).map(c => c.teste.ms);
        const cont = faixas.map(([a, b]) => ms.filter(x => x >= a && x < b).length), max = Math.max(1, ...cont);
        const ICO = { vivo: ['✓', '#4ade80'], lento: ['◔', '#fbbf24'], 'pede-ua': ['!', '#67e8f9'], bloqueado: ['◐', '#a78bfa'], morto: ['✗', '#f87171'] };
        const vivosLista = sc.alvo.filter(c => c.teste && VIVO(c.teste.status));
        const mortosLista = sc.alvo.filter(c => !c.quarentena && c.teste && !VIVO(c.teste.status));
        const semLogo = vivosLista.filter(c => !c.logo).length, semGuia = vivosLista.filter(c => !c.epgId).length;
        const apagar = E.canais.filter(c => c.quarentena && (c.mortesSeguidas || 0) >= 3);
        el.innerHTML = `
          <div class="le-sj-topo"><b>${rodando ? (sc.pausado ? '⏸ Pausado' : 'Testando') : sc.parar ? 'Parado' : 'Pronto'}</b> · ${esc(sc.rotulo)} · <b style="color:#e5e7eb">${sc.feitos.toLocaleString('pt-BR')}</b> de ${sc.total.toLocaleString('pt-BR')}
            <span style="margin-left:auto">${rodando ? (sc.feitos ? 'falta ~' + tempoTxt(resta) : 'começando…') : 'levou ' + tempoTxt(gasto)}</span></div>
          <div class="le-scan" style="border:0;padding:6px 0"><span class="trilho"><b style="width:${Math.round(sc.feitos / sc.total * 100)}%"></b></span>
            ${rodando ? `<button class="le-bt" id="le-sj-pausa">${sc.pausado ? '▶ Continuar' : '❚❚ Pausar'}</button><button class="le-bt" id="le-sj-parar">■ Parar</button>` : ''}</div>
          <div class="le-sj-cards">${CARDS.map(([k, rot, cor, dica]) => `<div class="le-sj-card" title="${esc(dica)}"><b style="color:${cor}">${(sc.n[k] || 0).toLocaleString('pt-BR')}</b><span>${rot}</span></div>`).join('')}</div>
          <div class="le-sj-meio">
            <div><div class="le-rot">Tempo para abrir (vivos)</div>
              <div class="le-sj-barras">${faixas.map(([, , rot], k) => `<div><span>${rot}</span><i style="width:${Math.round(cont[k] / max * 100)}%"></i><b>${cont[k]}</b></div>`).join('')}</div></div>
            <div><div class="le-rot">Últimos</div>
              <div class="le-sj-ult">${sc.ultimos.map(u => `<div><b style="color:${ICO[u.st] ? ICO[u.st][1] : '#9aa3ad'}">${ICO[u.st] ? ICO[u.st][0] : '?'}</b><span>${esc(u.nome)}</span><small>${esc(u.txt)}</small></div>`).join('') || '<p class="le-dica">…</p>'}</div></div>
          </div>
          ${rodando ? '<p class="le-dica">Pode fechar esta janela: o scan continua (barra acima da tabela).</p>' : `
          <div class="le-rot" style="margin-top:6px">Depois do scan, num clique</div>
          <div class="le-jan-botoes" style="justify-content:flex-start">
            <button class="le-bt r" data-sj="vivos" ${vivosLista.length ? '' : 'disabled'}>➜ Vivos para a lista nova (${vivosLista.length})</button>
            <button class="le-bt" data-sj="mortos" ${mortosLista.length ? '' : 'disabled'}>Mortos para a quarentena (${mortosLista.length})</button>
            <button class="le-bt" data-sj="logos" ${semLogo ? '' : 'disabled'}>Buscar logos que faltam (${semLogo})</button>
            <button class="le-bt" data-sj="guias" ${semGuia ? '' : 'disabled'}>Ligar guias (${semGuia})</button>
            <button class="le-bt" data-sj="vivosSo">Mostrar só os vivos</button>
            ${apagar.length ? `<button class="le-bt" data-sj="apagar" title="Morreram 3 vezes seguidas na quarentena">Apagar de vez os que morreram 3× (${apagar.length})</button>` : ''}
            <button class="le-bt" data-sj="novo">Novo scan</button>
          </div>`}`;
        const pa = el.querySelector('#le-sj-pausa'); if (pa) pa.onclick = () => pausarScan(!E.scan.pausado);
        const pr = el.querySelector('#le-sj-parar'); if (pr) pr.onclick = () => { if (E.scan) { E.scan.parar = true; E.scan.pausado = false; } };
        el.querySelectorAll('[data-sj]').forEach(b => {
            b.onclick = () => {
                const k = b.dataset.sj;
                if (k === 'vivos') { jogarNaLista(vivosLista); fecharJanela(); }
                else if (k === 'mortos') { quarentena(mortosLista, true); S.aviso(`${mortosLista.length} na quarentena. Teste a quarentena de novo mais tarde: quem voltar sai sozinho.`, 'ok'); fecharJanela(); }
                else if (k === 'logos') { fecharJanela(); E.sel = new Set(vivosLista.filter(c => !c.logo).map(c => c.id)); acharLogosQueFaltam(); }
                else if (k === 'guias') { fecharJanela(); ligarGuiasAuto(vivosLista); }
                else if (k === 'vivosSo') { E.f.soVivos = true; fecharJanela(); desenharFiltros(); desenharTabela(); }
                else if (k === 'apagar') { lembrar(); const ids = new Set(apagar.map(c => c.id)); E.canais = E.canais.filter(c => !ids.has(c.id)); salvar(); desenharTudo(); S.aviso(`${ids.size} canais apagados de vez (Ctrl+Z não volta estes).`, 'ok'); fecharJanela(); }
                else if (k === 'novo') { E.ultimoScan = null; abrirScan(); }
            };
        });
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
    function janela(html, classe = '') {
        fecharJanela();
        const d = document.createElement('div');
        d.className = 'le-jan-fundo';
        d.innerHTML = `<div class="le-jan ${classe}" role="dialog" aria-modal="true">${html}<button class="le-jan-x" data-fechar aria-label="Fechar">✕</button></div>`;
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
            ['Del', 'quarentena do canal'], ['Shift + Del', 'quarentena dos marcados'], ['L', 'logo do canal'], ['I', 'idioma (do canal, ou de todos os marcados)'], ['C', 'categoria (do canal, ou dos marcados)'], ['G', 'guia de programação (do canal, ou dos marcados)'], ['B', 'Assets: logos e guias'], ['M · + −', 'som · volume'],
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
        S.aviso('Procurando logos (seu banco de Assets primeiro, depois o iptv-org)…', 'ok');
        await carregarAssets();
        let banco = [], erroBanco = '';
        try { banco = await carregarBancoLogos(); } catch (e) { erroBanco = e.message; }
        lembrar();
        let n = 0;
        const feitos = new Set();
        alvo.forEach(c => {
            if (feitos.has(c.chave)) { const irmao = E.canais.find(x => x.chave === c.chave && ehImagem(x.logo)); if (irmao) { c.logo = irmao.logo; n++; } return; }
            const [meu] = logosDoBanco(c, true);
            if (meu) { copiasDe(c).forEach(x => { if (!ehImagem(x.logo)) x.logo = meu.url; }); feitos.add(c.chave); n++; return; }
            const [m] = acharLogos(banco, c, 1);
            // só o que é certeza (mesmo tvg-id, ou mesmo nome no mesmo país); o resto você escolhe no logo do canal
            if (m && m.pontos >= 85) { copiasDe(c).forEach(x => { if (!ehImagem(x.logo)) x.logo = m.canal.logos[0]; }); feitos.add(c.chave); n++; }
        });
        salvar(); agendarTabela(); desenharFiltros();
        if (erroBanco && !n) return S.aviso('Não consegui abrir o banco do iptv-org (' + erroBanco + ') e o seu banco de Assets não tem esses canais.', 'ruim');
        S.aviso(n ? `${n} logos colocados. Os que faltam: clique no quadrinho do logo e escolha na busca.` : 'Não achei logo certeiro para esses canais. Clique no quadrinho do logo para buscar e escolher.', n ? 'ok' : 'ruim');
    }
    function abrirLogo(c) {
        if (!c) return;
        const img = ehImagem(c.logo) ? c.logo : '';
        const nCopias = copiasDe(c).length;
        // canais com o mesmo nome (de outras listas/países) que ainda estão sem logo
        const iguais = img ? E.canais.filter(x => x.chave !== c.chave && L.norm(x.nome) === L.norm(c.nome) && !ehImagem(x.logo)) : [];
        const noBanco = img && A.logos.some(l => l.url === img);
        carregarAssets().then(() => { const b = raiz.querySelector('#le-logo-guardar'); if (b && img && A.logos.some(l => l.url === img)) { b.disabled = true; b.textContent = '★ Já está no banco'; } });
        const j = janela(`<h3>Logo · ${esc(c.nome)}</h3>
          <div class="le-logo-grande">${img ? `<img id="le-logo-img" src="${esc(img)}" alt="Logo de ${esc(c.nome)}">` : '<span>Sem logo</span>'}</div>
          <p class="le-dica" id="le-logo-info" style="text-align:center">${img ? '' : 'Este canal ainda não tem logo. Escolha um abaixo.'}</p>
          ${img ? `<div class="le-jan-botoes" style="justify-content:center"><button class="le-bt p" id="le-logo-baixar">⤓ Baixar imagem</button><a class="le-bt" style="display:inline-flex;align-items:center;text-decoration:none" href="${esc(img.startsWith('data:') ? '#' : img)}" target="_blank" rel="noopener" ${img.startsWith('data:') ? 'hidden' : ''}>Abrir em aba nova</a><button class="le-bt" id="le-logo-tirar">Remover logo</button></div>` : ''}
          ${img ? `<div class="le-logo-link"><code title="${esc(img.startsWith('data:') ? '' : img)}">${esc(img.startsWith('data:') ? '(imagem enviada do computador — sem link)' : img)}</code>${img.startsWith('data:') ? '' : '<button class="le-bt" id="le-logo-copiar">Copiar link</button>'}</div>
          <div class="le-jan-botoes" style="justify-content:center">${iguais.length ? `<button class="le-bt" id="le-logo-iguais" title="${esc(iguais.slice(0, 8).map(x => x.nome).join(', '))}">Colocar nos ${iguais.length} iguais sem logo</button>` : ''}<button class="le-bt" id="le-logo-guardar" ${noBanco ? 'disabled' : ''}>${noBanco ? '★ Já está no banco' : '★ Salvar no banco (Assets)'}</button><button class="le-bt" id="le-logo-assets">Abrir banco de logos</button></div>` : `<div class="le-jan-botoes" style="justify-content:center"><button class="le-bt" id="le-logo-assets">Abrir banco de logos</button></div>`}
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
        const cp = j.querySelector('#le-logo-copiar'); if (cp) cp.onclick = () => copiarTexto(img, 'Link do logo copiado.');
        const ig = j.querySelector('#le-logo-iguais'); if (ig) ig.onclick = () => { lembrar(); iguais.forEach(x => { x.logo = img; }); salvar(); agendarTabela(); desenharFiltros(); S.aviso(`Logo colocado em ${iguais.length} canais iguais.`, 'ok'); abrirLogo(c); };
        const gd = j.querySelector('#le-logo-guardar'); if (gd) gd.onclick = async () => { await carregarAssets(); if (guardarLogo(c.nome, img, c.pais, (E.listas.find(l => l.id === c.lista) || {}).nome)) { await gravarAssets(); S.aviso('Logo salvo no banco (Assets).', 'ok'); } gd.disabled = true; gd.textContent = '★ Já está no banco'; };
        j.querySelector('#le-logo-assets').onclick = () => abrirAssets(c.nome);
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
            res.innerHTML = '<p class="le-dica">Procurando no seu banco e no banco aberto do iptv-org (a primeira busca baixa o banco, alguns segundos)…</p>';
            await carregarAssets();
            const meus = logosDoBanco(c).slice(0, 9).map(l => ({ u: l.url, rot: '★ ' + l.nome + (l.pais ? ' · ' + l.pais : '') }));
            try {
                let achados = [];
                try { achados = acharLogos(await carregarBancoLogos(), c); } catch (er) { if (!meus.length) throw er; }
                if (!res.isConnected) return;
                const opcoes = meus.slice();
                achados.forEach(a => a.canal.logos.slice(0, 3).forEach(u => opcoes.push({ u, rot: a.canal.nome + (a.canal.pais ? ' · ' + a.canal.pais : '') })));
                res.innerHTML = opcoes.length ? opcoes.slice(0, 18).map(o => `<button class="le-logo-op" data-url="${esc(o.u)}" title="${esc(o.rot)}"><img src="${esc(o.u)}" alt="" loading="lazy"><small>${esc(o.rot)}</small></button>`).join('')
                    : '<p class="le-dica">Nada no banco com esse nome. Tente "Procurar no Google" e cole o link da imagem acima.</p>';
                res.querySelectorAll('[data-url]').forEach(b => { b.onclick = () => aplicar(b.dataset.url); });
            } catch (er) { res.innerHTML = `<p class="le-dica">Não consegui abrir o banco de logos (${esc(er.message)}). Use "Procurar no Google".</p>`; }
        };
    }

    // ---------------------------------------------------------------- idioma (na mão, um ou vários)
    const bandeira = (p) => /^[A-Z]{2}$/.test(p || '') ? String.fromCodePoint(...[...p].map(ch => 127397 + ch.charCodeAt(0))) : '🌐';
    let idiomasRecentes = [];
    try { idiomasRecentes = JSON.parse(localStorage.getItem(GUARDA + '-idiomas') || '[]'); } catch (e) { /* */ }
    /** Abre a escolha de idioma. Se o canal clicado estiver marcado junto com outros, vale para todos os marcados. */
    function escolherIdioma(c) {
        const alvo = c && !(E.sel.has(c.id) && E.sel.size > 1) ? [c] : selecionados();
        if (!alvo.length) return S.aviso('Clique no idioma de um canal (ou marque vários e aperte I).', 'ruim');
        const atual = alvo.length === 1 ? alvo[0].idioma : '';
        const ordem = idiomasRecentes.map(cod => L.IDIOMAS.find(i => i.cod === cod)).filter(Boolean);
        const lista = ordem.concat(L.IDIOMAS.filter(i => !idiomasRecentes.includes(i.cod)));
        const j = janela(`<h3>Idioma · ${alvo.length === 1 ? esc(alvo[0].nome) : alvo.length + ' canais marcados'}</h3>
          <p class="le-dica">${alvo.length === 1 ? `Agora: <b>${esc(atual || 'sem idioma')}</b>${alvo[0].pais ? ' · país ' + esc(alvo[0].pais) : ''}. ` : ''}O código com região (pt-BR, es-MX…) é o que o TVzine/Cloud lê para pôr o canal no país certo.</p>
          <input class="le-campo" id="le-idi-busca" placeholder="Filtrar: portugu, mx, inglês…" autocomplete="off">
          <div class="le-idi-lista" id="le-idi-lista"></div>
          <label class="le-dica" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="le-idi-pais" checked> mudar o país junto (tvg-country) — recomendado para o seletor de países do TVzine</label>
          <div class="le-jan-botoes"><button class="le-bt" id="le-idi-limpar">Tirar o idioma</button><button class="le-bt" data-fechar>Cancelar</button></div>`);
        const caixa = j.querySelector('#le-idi-lista'), busca = j.querySelector('#le-idi-busca');
        const pintar = () => {
            const q = L.norm(busca.value);
            const vis = lista.filter(i => !q || L.norm(i.nome + ' ' + i.cod + ' ' + i.pais).includes(q));
            caixa.innerHTML = vis.map(i => `<button class="le-idi-op${i.cod === atual ? ' on' : ''}" data-cod="${esc(i.cod)}"><span>${bandeira(i.pais)}</span><b>${esc(i.cod)}</b><small>${esc(i.nome)}</small></button>`).join('') || '<p class="le-dica">Nenhum idioma com esse nome.</p>';
        };
        const aplicar = (cod) => {
            const junto = j.querySelector('#le-idi-pais').checked;
            lembrar();
            alvo.forEach(x => {
                const antes = x.url;
                if (cod) L.definirIdioma(x, cod, junto); else { x.idioma = ''; if (junto) x.pais = ''; x.idiomaManual = true; x.chave = L.chaveDe(x); }
                E.nova.itens.forEach(it => { if (it.url === antes) { it.idioma = x.idioma; it.pais = x.pais; it.chave = x.chave; } });
            });
            if (cod) { idiomasRecentes = [cod].concat(idiomasRecentes.filter(k => k !== cod)).slice(0, 5); try { localStorage.setItem(GUARDA + '-idiomas', JSON.stringify(idiomasRecentes)); } catch (e) { /* */ } }
            salvar(); fecharJanela(); desenharFiltros(); desenharTabela(); desenharNova();
            pintarFicha(E.canais.find(x => x.id === E.foco));
            const op = L.IDIOMAS.find(i => i.cod === cod);
            S.aviso(cod ? `${cod} em ${alvo.length} canal(is)${junto && op && op.pais ? ' — no TVzine vão para ' + bandeira(op.pais) + ' ' + op.pais : ''}. Ctrl+Z desfaz.` : `Idioma tirado de ${alvo.length} canal(is).`, 'ok');
        };
        pintar();
        busca.oninput = pintar;
        busca.onkeydown = (e) => { if (e.key === 'Enter') { const b = caixa.querySelector('[data-cod]'); if (b) aplicar(b.dataset.cod); } };
        caixa.onclick = (e) => { const b = e.target.closest('[data-cod]'); if (b) aplicar(b.dataset.cod); };
        j.querySelector('#le-idi-limpar').onclick = () => aplicar('');
        busca.focus();
    }

    // ---------------------------------------------------------------- categoria (vira o group-title = a categoria no app)
    async function escolherCategoria(c) {
        const alvo = c && !(E.sel.has(c.id) && E.sel.size > 1) ? [c] : selecionados();
        if (!alvo.length) return S.aviso('Clique no grupo de um canal (ou marque vários e aperte C).', 'ruim');
        await carregarAssets();
        const um = alvo.length === 1 ? alvo[0] : null;
        const uso = new Map();
        E.canais.forEach(x => { if (x.grupoSaida) uso.set(x.grupoSaida, (uso.get(x.grupoSaida) || 0) + 1); });
        const todas = () => [...new Set(L.CATEGORIAS.concat(A.categorias, [...uso.keys()], L.DESTINOS_ESPECIAIS))];
        const sug = um ? L.categoriaSugerida(um) : '';
        const comSug = alvo.filter(x => !x.grupoSaida && L.categoriaSugerida(x)).length;   // quem já tem categoria escolhida fica como está
        const j = janela(`<h3>Categoria · ${um ? esc(um.nome) : alvo.length + ' canais marcados'}</h3>
          <p class="le-dica">${um ? `Grupo na lista: <b>${esc(um.grupo || '—')}</b>${um.grupoSaida ? ` · categoria escolhida: <b style="color:#67e8f9">${esc(um.grupoSaida)}</b>` : ''}${sug && sug !== um.grupoSaida ? ` · sugestão: <b>${esc(sug)}</b>` : ''}. ` : ''}A categoria vira o <b>group-title</b> da lista exportada — é o nome que aparece no app. Use sempre os mesmos nomes.</p>
          <input class="le-campo" id="le-cat-busca" placeholder="Filtrar ou criar uma categoria nova…" autocomplete="off">
          <div class="le-idi-lista le-cat-lista" id="le-cat-lista"></div>
          <div class="le-jan-botoes">${!um && comSug ? `<button class="le-bt p" id="le-cat-auto" title="Cada canal recebe a categoria sugerida pelo grupo/tipo dele">Usar a sugestão em cada um (${comSug})</button>` : ''}${alvo.some(x => x.grupoSaida) ? '<button class="le-bt" id="le-cat-tirar">Voltar ao grupo original</button>' : ''}<button class="le-bt" data-fechar>Cancelar</button></div>`);
        const caixa = j.querySelector('#le-cat-lista'), busca = j.querySelector('#le-cat-busca');
        const aplicar = async (fn, msg) => {
            lembrar();
            alvo.forEach(x => { fn(x); E.nova.itens.forEach(it => { if (it.url === x.url) it.grupoSaida = x.grupoSaida; }); });
            salvar(); fecharJanela(); desenharFiltros(); desenharTabela(); desenharNova(); pintarFicha(E.canais.find(x => x.id === E.foco));
            S.aviso(msg + ' Ctrl+Z desfaz.', 'ok');
        };
        const escolher = async (cat) => {
            cat = String(cat || '').trim(); if (!cat) return;
            if (!todas().includes(cat)) { A.categorias.push(cat); gravarAssets(); }
            aplicar(x => L.definirCategoria(x, cat), `${cat} em ${alvo.length} canal(is).`);
        };
        const pintar = () => {
            const q = busca.value.trim(), nq = L.norm(q);
            const vis = todas().filter(k => !nq || L.norm(k).includes(nq));
            const atual = um && um.grupoSaida;
            const nova = q && !todas().some(k => L.norm(k) === nq) ? `<button class="le-idi-op le-cat-nova" data-cat="${esc(q)}"><span>＋</span><b>Criar</b><small>“${esc(q)}”</small></button>` : '';
            caixa.innerHTML = (sug && !nq ? [sug].concat(vis.filter(k => k !== sug)) : vis).map(k => `<button class="le-idi-op${k === atual ? ' on' : ''}" data-cat="${esc(k)}"><span>${k === sug ? '★' : ''}</span><b>${esc(k)}</b><small>${L.DESTINOS_ESPECIAIS.includes(k) ? '→ coleção ' + esc(k) : uso.get(k) ? uso.get(k) + ' canais' : L.CATEGORIAS.includes(k) ? '' : 'sua'}</small></button>`).join('') + nova;
        };
        pintar();
        busca.oninput = pintar;
        busca.onkeydown = (e) => { if (e.key === 'Enter') { const b = caixa.querySelector('[data-cat]'); if (b) escolher(b.dataset.cat); } };
        caixa.onclick = (e) => { const b = e.target.closest('[data-cat]'); if (b) escolher(b.dataset.cat); };
        const au = j.querySelector('#le-cat-auto'); if (au) au.onclick = () => aplicar(x => { const k = !x.grupoSaida && L.categoriaSugerida(x); if (k) L.definirCategoria(x, k); }, `Sugestão aplicada em ${comSug} canais.`);
        const ti = j.querySelector('#le-cat-tirar'); if (ti) ti.onclick = () => aplicar(x => L.definirCategoria(x, ''), 'Voltou ao grupo original.');
        busca.focus();
    }

    // ---------------------------------------------------------------- ENVIAR AO STUDIO: um caminho para cada coleção
    // Canais ao vivo (TVzine por país, Desenhos 24H, Rádios) e filmes/séries (Filmes, Séries, Animes, Cartoons) numa
    // janela só, com uma aba por coleção. Cada item já vem com o destino certo; dá para trocar por linha ou mandar a
    // lista inteira para uma coleção ("lista só de filmes em .m3u8" → tudo para 🎬 Filmes).
    const ROT_ACAO = { novo: ['Novo', '#4ade80'], juntar: ['Junta com o que já existe', '#67e8f9'], mesmo: ['Repetido no lote → reserva', '#a78bfa'], erro: ['Falta dado', '#f87171'], fora: ['Fica de fora', '#64748b'] };
    const ENV = { aba: 'tudo', origem: 'nova', paisPadrao: '', soVivos: false, rascunho: false, forcar: '', destCanal: new Map(), destVod: new Map(), dados: new Map(), achados: new Map() };
    const TIPOS_CANAL = ['canal', 'canal24h', 'radio'];
    const todosPara = (id) => ({ has: () => true, get: () => id });      // "mandar a lista inteira para…"
    function abrirImportador(aba) {
        if (!S.config || !S.gravar || !S.C) return S.aviso('Abra o Link Edit pelo Studio para gravar nas coleções.', 'ruim');
        const config = S.config();
        const cols = (config.colecoes || []).filter(c => TIPOS_CANAL.includes(c.tipo) || c.tipo === 'video');
        if (!cols.length) return S.aviso('O studio.config.json não tem coleções de canais nem de vídeo.', 'ruim');
        if (ENV.origem === 'externa' && !ENV.externa) ENV.origem = 'nova';
        if (!E.nova.itens.length && !E.sel.size && !ENV.externa) return S.aviso('Monte a lista nova (ou marque canais) antes de enviar.', 'ruim');
        if (!E.nova.itens.length && ENV.origem === 'nova') ENV.origem = ENV.externa ? 'externa' : 'marcados';
        if (aba) ENV.aba = aba;
        if (ENV.aba !== 'tudo' && !cols.some(c => c.id === ENV.aba)) ENV.aba = 'tudo';
        const familia = (c) => (c && c.tipo === 'video' ? 'vod' : 'canal');
        const base = () => (ENV.origem === 'externa' && ENV.externa ? ENV.externa.itens : ENV.origem === 'marcados' && E.sel.size ? selecionados() : E.nova.itens);
        const planejar = () => {
            const itens = base().filter(it => !ENV.soVivos || !it.teste || ['vivo', 'lento', 'pede-ua'].includes(it.teste.status));
            const forcada = cols.find(c => c.id === ENV.forcar);
            const vodItens = forcada ? (familia(forcada) === 'vod' ? itens : []) : itens.filter(L.ehVOD);
            const canalItens = forcada ? (familia(forcada) === 'canal' ? itens : []) : itens.filter(it => !L.ehVOD(it));
            const canais = L.planejarImportacao(canalItens, S.C, { config, caminhos: new Set((S.indice() || []).map(i => i.caminho)),
                destinos: forcada ? todosPara(forcada.id) : ENV.destCanal, paisPadrao: ENV.paisPadrao, rascunho: ENV.rascunho })
                .map(r => Object.assign(r, { fam: 'canal', chaveLinha: 'c:' + r.it.id }));
            const vods = L.planejarVOD(vodItens, S.C, { config, indice: S.indice() || [], destinos: forcada ? todosPara(forcada.id) : ENV.destVod, dados: ENV.dados, rascunho: ENV.rascunho })
                .map(r => Object.assign(r, { fam: 'vod', chaveLinha: 'v:' + r.chave }));
            return canais.concat(vods);
        };
        const paises = S.C.opcoesDe('paises', config);
        const j = janela(`<h3>Enviar ao Studio${ENV.origem === 'externa' && ENV.externa ? ' · ' + esc(ENV.externa.nome) : ''}</h3>
          <div class="le-abas le-env-abas" id="le-env-abas" role="tablist"></div>
          <div class="le-imp-op">
            <label>Enviar <select class="le-campo" id="le-imp-origem"><option value="nova">a lista nova (${E.nova.itens.length})</option><option value="marcados" ${E.sel.size ? '' : 'disabled'}>os marcados (${E.sel.size})</option>${ENV.externa ? `<option value="externa">a lista importada: ${esc(ENV.externa.nome)} (${ENV.externa.itens.length})</option>` : ''}</select></label>
            <label title="Canais sem país não entram no TVzine">País para quem não tem <select class="le-campo" id="le-imp-pais"><option value="">— nenhum —</option>${paises.map(p => `<option value="${esc(p.v)}">${esc(p.r)}</option>`).join('')}</select></label>
            <label><input type="checkbox" id="le-imp-vivos"> só os vivos</label>
            <label title="Entra no Studio mas não vai para o app até você conferir"><input type="checkbox" id="le-imp-rasc"> como rascunho</label>
          </div>
          <div id="le-env-acoes" class="le-env-acoes"></div>
          <div class="le-imp-cab le-env"><span>Destino</span><span></span><span>Título / canal</span><span>O que é</span><span>Dados</span><span>Situação</span></div>
          <div class="le-as-lista" id="le-imp-lista"></div>
          <div class="le-jan-botoes"><button class="le-bt" data-fechar>Cancelar</button><button class="le-bt r" id="le-imp-gravar">Gravar no Studio</button></div>`, 'larga');
        j.querySelector('#le-imp-origem').value = ENV.origem;
        j.querySelector('#le-imp-pais').value = ENV.paisPadrao;
        j.querySelector('#le-imp-vivos').checked = ENV.soVivos;
        j.querySelector('#le-imp-rasc').checked = ENV.rascunho;
        let P = [], vis = [];
        const vai = (r) => r.acao === 'novo' || r.acao === 'juntar';
        const naAba = (r) => ENV.aba === 'tudo' || (r.col && r.col.id === ENV.aba);
        const pintar = () => {
            P = planejar();
            vis = P.filter(naAba);
            // abas: Tudo + uma por coleção (as que não recebem nada ficam apagadas, mas clicáveis)
            const n = (c) => P.filter(r => r.col === c && r.acao !== 'fora').length;
            j.querySelector('#le-env-abas').innerHTML = `<button class="le-aba${ENV.aba === 'tudo' ? ' on' : ''}" data-env-aba="tudo">Tudo <small>${P.filter(r => r.acao !== 'fora').length}</small></button>`
                + cols.map(c => `<button class="le-aba${ENV.aba === c.id ? ' on' : ''}${n(c) ? '' : ' vazia'}" data-env-aba="${esc(c.id)}" title="${esc(c.nome)}">${esc(c.icone || '')} ${esc(c.nome)} <small>${n(c)}</small></button>`).join('');
            const col = cols.find(c => c.id === ENV.aba);
            const conta = (f) => vis.filter(f).length;
            const porPais = new Map(); vis.forEach(r => { if (r.fam === 'canal' && r.col && r.col.tipo !== 'canal24h' && vai(r)) { const k = r.item.pais || '?'; porPais.set(k, (porPais.get(k) || 0) + 1); } });
            const fora = P.filter(r => r.acao === 'fora').length;
            j.querySelector('#le-env-acoes').innerHTML = `
              ${col ? `<button class="le-bt${ENV.forcar === col.id ? ' p' : ''}" id="le-env-forcar" title="Ignora o destino automático: todos os itens da lista vão para ${esc(col.nome)}">${ENV.forcar === col.id ? '✓ A lista inteira vai para ' : 'Mandar a lista inteira para '}${esc(col.icone || '')} ${esc(col.nome)}</button>` : ''}
              ${ENV.forcar ? '<button class="le-bt" id="le-env-auto">↺ Voltar ao destino automático</button>' : ''}
              ${(() => {
                  const v = vis.filter(r => r.fam === 'vod' && r.col);
                  if (!v.length) return '';
                  const falta = v.filter(r => !ENV.achados.has(r.chave) && (!r.item.capa || !r.item.descricao || (r.eps && !r.item.banner)));
                  const pedidos = falta.reduce((n, r) => n + 3 + (r.item.temporadas ? r.item.temporadas.length : 0), 0);
                  return `<button class="le-bt p" id="le-env-tmdb" title="Capa, banner, sinopse, ano, gêneros, nota, classificação e episódios — só onde está vazio" ${falta.length ? '' : 'disabled'}>🔎 Completar no TMDB (${falta.length} sem dados)</button>
                    <span class="le-dica" title="Os que já têm capa e sinopse ficam como estão">${v.length - falta.length} já completos${falta.length ? ` · ~${pedidos} pedidos à API` : ''}</span>`;
              })()}
              <span class="le-imp-resumo">
                ${conta(r => r.eps) ? `<span class="le-chip">${conta(r => r.eps)} séries · ${vis.reduce((k, r) => k + (r.eps || 0), 0)} ep.</span>` : ''}
                ${conta(r => r.fam === 'vod' && !r.eps) ? `<span class="le-chip">${conta(r => r.fam === 'vod' && !r.eps)} filmes</span>` : ''}
                ${conta(r => r.fam === 'canal' && r.acao !== 'fora') ? `<span class="le-chip">${conta(r => r.fam === 'canal' && r.acao !== 'fora')} canais</span>` : ''}
                ${[...porPais.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, k]) => `<span class="le-chip">${bandeira(p)} ${esc(p)} <small>${k}</small></span>`).join('')}
                ${conta(r => r.acao === 'erro') ? `<span class="le-chip" style="color:#f87171">${conta(r => r.acao === 'erro')} com falta de dado</span>` : ''}
                ${ENV.aba === 'tudo' && fora ? `<span class="le-chip" title="Sem coleção certa: escolha o destino na linha">${fora} de fora</span>` : ''}
              </span>`;
            const ok = vis.filter(vai);
            const g = j.querySelector('#le-imp-gravar');
            g.textContent = ok.length ? `Gravar ${col ? 'em ' + (col.icone || '') + ' ' + col.nome : 'tudo'} (${ok.filter(r => r.acao === 'novo').length} novos · ${ok.filter(r => r.acao === 'juntar').length} juntam)` : 'Nada para gravar aqui';
            g.disabled = !ok.length;
            const lista = vis.slice(0, 600);
            j.querySelector('#le-imp-lista').innerHTML = lista.length ? lista.map((r, i) => {
                const item = r.item || {}, it = r.it || {}, [rot, cor] = ROT_ACAO[r.acao];
                const msg = r.acao === 'erro' ? r.erros.join(' · ') : r.motivo || (r.avisos && r.avisos[0]) || '';
                const img = r.fam === 'vod' ? item.capa : (item.logo || it.logo);
                const mesmas = cols.filter(c => familia(c) === r.fam);
                const que = r.fam === 'vod' ? (r.eps ? `série · ${item.temporadas.length} temp. · ${r.eps} ep.` : 'filme' + (item.ano ? ' · ' + item.ano : '')) + (item.audio ? ' · ' + item.audio : '')
                    : [item.pais ? bandeira(item.pais) + ' ' + item.pais : r.col && r.col.tipo === 'canal' ? '<b style="color:#f87171">sem país</b>' : '', item.categoria, item.idioma].filter(Boolean).join(' · ') || 'canal';
                const dado = r.fam === 'vod' ? ENV.achados.get(r.chave) : null;
                const dados = r.fam === 'vod' ? `<span style="color:${dado ? (dado.ok ? '#4ade80' : '#fbbf24') : '#64748b'}" title="${esc(dado ? dado.texto : 'Ainda não buscado no TMDB')}">${dado ? (dado.ok ? '✓ TMDB' : '?') : item.descricao ? '✓' : '—'}</span>`
                    : `<span style="color:${item.tvgId && item.epg ? '#4ade80' : '#64748b'}" title="Guia de programação">${item.tvgId && item.epg ? '✓ guia' : '—'}</span>`;
                return `<div class="le-imp-linha le-env">
                  <select class="le-campo" data-env-dest="${i}" title="${r.fam === 'vod' ? 'Filme/série: Filmes, Séries, Animes ou Cartoons' : 'Canal: TVzine, Desenhos 24H ou Rádios'}"><option value="">— fica de fora —</option>${mesmas.map(c => `<option value="${esc(c.id)}" ${r.col === c ? 'selected' : ''}>${esc(c.icone || '')} ${esc(c.nome)}</option>`).join('')}</select>
                  <span class="le-as-img">${ehImagem(img) ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}</span>
                  <span title="${esc(r.caminho || '')}"><b>${esc(item.nome || it.nome)}</b><small>${esc(r.caminho ? r.caminho.replace(/^conteudo\//, '') : '')}${r.fam === 'vod' && !r.eps && (item.links || []).length > 1 ? ' · ' + item.links.length + ' links' : ''}</small></span>
                  <span>${que}</span>
                  ${dados}
                  <span style="color:${cor}" title="${esc(msg)}"><b>${esc(rot)}</b>${msg ? `<small>${esc(msg)}</small>` : ''}</span>
                </div>`;
            }).join('') + (vis.length > 600 ? `<p class="le-dica">Mostrando 600 de ${vis.length}. Todos entram na gravação.</p>` : '')
                : `<p class="le-dica" style="padding:12px 0">${col ? `Nada da lista vai para ${esc(col.nome)}. Se a lista inteira é disso, clique em "Mandar a lista inteira para ${esc(col.nome)}".` : 'Nada para enviar.'}</p>`;
            j.querySelectorAll('[data-env-dest]').forEach(sel => {
                sel.onchange = () => {
                    const r = lista[+sel.dataset.envDest];
                    if (ENV.forcar) { ENV.forcar = ''; }
                    (r.fam === 'vod' ? ENV.destVod : ENV.destCanal).set(r.fam === 'vod' ? r.chave : r.it.id, sel.value);
                    pintar();
                };
            });
            const fz = j.querySelector('#le-env-forcar'); if (fz) fz.onclick = () => { ENV.forcar = ENV.forcar === col.id ? '' : col.id; pintar(); };
            const au = j.querySelector('#le-env-auto'); if (au) au.onclick = () => { ENV.forcar = ''; pintar(); };
            const tm = j.querySelector('#le-env-tmdb'); if (tm) tm.onclick = () => completarTMDB(tm);
        };
        const completarTMDB = async (b) => {
            if (!S.completar) return S.aviso('A busca no TMDB precisa do Studio.', 'ruim');
            const faltam = vis.filter(r => r.fam === 'vod' && r.col && !ENV.achados.has(r.chave) && (!r.item.capa || !r.item.descricao || (r.eps && !r.item.banner)));
            if (!faltam.length) return S.aviso('Todos já têm capa e sinopse.', 'ok');
            if (!S.temTmdb()) S.aviso('Sem a chave do TMDB (Chaves, no topo do Studio) a busca usa a Wikipedia, que acha menos coisa.', 'ruim');
            b.disabled = true;
            let k = 0, prox = 0, parar = false;
            const um = async () => {
                while (!parar && prox < faltam.length) {
                    const r = faltam[prox++];
                    if (!j.isConnected) { parar = true; return; }
                    try {
                        const x = await S.completar(r.item);
                        ENV.dados.set(r.chave, x.item);
                        ENV.achados.set(r.chave, { ok: !!x.achados.length, texto: x.achados.concat(x.avisos).join(' · ') || 'nada' });
                    } catch (er) {
                        ENV.achados.set(r.chave, { ok: false, texto: er.message });
                        if (/inválida/.test(er.message)) { parar = true; S.aviso(er.message, 'ruim'); }
                        if (/devagar|limite/.test(er.message)) await esperar(3000);
                    }
                    b.textContent = `Buscando ${++k}/${faltam.length}…`;
                }
            };
            await Promise.all([um(), um(), um(), um()]);      // 4 de cada vez (o TMDB aceita ~40 pedidos/s)
            if (!j.isConnected) return;
            pintar();
            S.aviso(`TMDB: ${[...ENV.achados.values()].filter(a => a.ok).length} achados. Os com "?" foram achados pelo nome ou não acharam — confira antes de gravar.`, 'ok');
        };
        j.querySelector('#le-env-abas').onclick = (e) => { const b = e.target.closest('[data-env-aba]'); if (b) { ENV.aba = b.dataset.envAba; pintar(); } };
        j.querySelector('#le-imp-origem').onchange = (e) => { ENV.origem = e.target.value; pintar(); };
        j.querySelector('#le-imp-pais').onchange = (e) => { ENV.paisPadrao = e.target.value; pintar(); };
        j.querySelector('#le-imp-vivos').onchange = (e) => { ENV.soVivos = e.target.checked; pintar(); };
        j.querySelector('#le-imp-rasc').onchange = (e) => { ENV.rascunho = e.target.checked; pintar(); };
        j.querySelector('#le-imp-gravar').onclick = async (e) => {
            const b = e.target, ok = vis.filter(vai);
            b.disabled = true; b.textContent = 'Gravando…';
            try {
                const mudancas = [];
                for (const r of ok) {
                    let existente = null;
                    if (r.acao === 'juntar') { try { existente = await S.ler(r.caminho); } catch (er) { /* sumiu: grava como novo */ } }
                    const final = r.fam === 'vod' ? (existente ? S.C.mesclarItem(existente, r.item) : r.item) : L.itemFinal(r, S.C, existente);
                    mudancas.push({ caminho: r.caminho, conteudo: S.C.serializar(final) });
                }
                const porCol = [...new Set(ok.map(r => r.col.nome))].join(', ');
                await S.gravar(mudancas, `Link Edit: ${ok.length} itens → ${porCol} (${E.nova.nome})`);
                fecharJanela();
                S.aviso(`${ok.length} itens gravados em ${porCol}${ENV.rascunho ? ' como rascunho' : ''}.`, 'ok');
            } catch (er) { b.disabled = false; b.textContent = 'Tentar de novo'; }
        };
        pintar();
    }
    const abrirImportadorVOD = () => abrirImportador('tudo');

    // ---------------------------------------------------------------- IMPORTAR LISTA INTEIRA (lista que já está pronta)
    // Para listas que você já sabe que estão completas e funcionando: lê a lista inteira e manda para o Studio sem passar
    // pela mesa (as ferramentas continuam lá para os imprevistos). Cada item vai para a coleção certa, ou todos para uma só.
    function abrirImportarLista() {
        const config = S.config ? S.config() : null;
        if (!config || !S.gravar) return S.aviso('Abra o Link Edit pelo Studio para gravar nas coleções.', 'ruim');
        const cols = (config.colecoes || []).filter(c => TIPOS_CANAL.includes(c.tipo) || c.tipo === 'video');
        const j = janela(`<h3>⚡ Importar lista inteira</h3>
          <p class="le-dica">Para listas que você já sabe que estão completas e funcionando: a lista inteira vai direto para o Studio, sem passar pela mesa. Antes de gravar você vê tudo separado por coleção (e ainda pode buscar no TMDB só o que falta).</p>
          <div style="display:flex;gap:6px"><input class="le-campo" id="le-il-url" placeholder="Link da lista (M3U, JSON, TXT, .pages.dev…)" style="flex:1"><label class="le-bt" style="display:inline-flex;align-items:center;cursor:pointer">Arquivo<input type="file" id="le-il-arq" accept=".m3u,.m3u8,.json,.txt,text/*" hidden></label></div>
          <div class="le-imp-op" style="margin-top:8px">
            <label>A lista é de <select class="le-campo" id="le-il-col"><option value="">Automático — cada item na sua coleção</option>${cols.map(c => `<option value="${esc(c.id)}">${esc(c.icone || '')} só ${esc(c.nome)}</option>`).join('')}</select></label>
            <label title="Lista só de filmes/episódios em .m3u8 (sem isso, .m3u8 é tratado como canal ao vivo)"><input type="checkbox" id="le-il-vod"> tudo é filme/série (mesmo .m3u8)</label>
          </div>
          <div class="le-jan-botoes"><button class="le-bt" data-fechar>Cancelar</button><button class="le-bt r" id="le-il-ler">Ler a lista</button></div>
          <p class="le-dica" id="le-il-info"></p>`);
        let arquivo = null;
        j.querySelector('#le-il-arq').onchange = async (e) => { const f = e.target.files[0]; if (f) { arquivo = { nome: f.name, texto: await f.text() }; j.querySelector('#le-il-url').value = f.name; } };
        j.querySelector('#le-il-ler').onclick = async (e) => {
            const b = e.target, url = j.querySelector('#le-il-url').value.trim();
            let texto, nome;
            b.disabled = true; b.textContent = 'Lendo…';
            try {
                if (arquivo && url === arquivo.nome) { texto = arquivo.texto; nome = arquivo.nome; }
                else {
                    if (!/^https?:\/\//i.test(url)) throw new Error('cole um link http(s) ou escolha um arquivo');
                    texto = await baixarTexto(url);
                    nome = (() => { try { const u = new URL(url); return u.pathname.split('/').filter(Boolean).pop() || u.hostname; } catch (er) { return url; } })();
                }
                const r = L.lerLista(texto, nome);
                if (!r.canais.length) throw new Error('não achei itens nessa lista');
                const forcar = j.querySelector('#le-il-col').value, tudoVod = j.querySelector('#le-il-vod').checked;
                r.canais.forEach((c, i) => { c.id = 'imp-' + i + '-' + c.id; if (r.epg && !c.epgGuia && c.tvgId) c.epgGuia = r.epg; if (tudoVod && !L.ehVOD(c)) c.formato = 'arquivo'; });
                ENV.externa = { nome, itens: r.canais };
                ENV.origem = 'externa'; ENV.forcar = forcar; ENV.aba = forcar || 'tudo';
                ENV.destCanal = new Map(); ENV.destVod = new Map();
                fecharJanela();
                abrirImportador(ENV.aba);
                S.aviso(`${r.canais.length.toLocaleString('pt-BR')} itens lidos de "${nome}" (${r.formato.toUpperCase()}).`, 'ok');
            } catch (er) {
                b.disabled = false; b.textContent = 'Ler a lista';
                j.querySelector('#le-il-info').textContent = 'Não consegui ler: ' + er.message + (local() ? '' : ' — no painel do PC (node tools/painel.mjs) qualquer link abre.');
            }
        };
        j.querySelector('#le-il-url').focus();
    }

    // ---------------------------------------------------------------- assets: banco de logos salvos (vale para todas as listas)
    const GUARDA_ASSETS = 'czs-linkedit-assets-v1';
    const A = { logos: [], guias: [], categorias: [], pronto: null };
    function carregarAssets() {
        if (!A.pronto) {
            A.pronto = (async () => {
                let d = null;
                if (local()) { try { d = await (await fetch('/api/linkedit/assets')).json(); } catch (e) { /* */ } }
                if (!d || ((!d.logos || !d.logos.length) && (!d.guias || !d.guias.length))) { try { d = JSON.parse(localStorage.getItem(GUARDA_ASSETS) || 'null') || d; } catch (e) { /* */ } }
                A.logos = (d && d.logos) || []; A.guias = (d && d.guias) || []; A.categorias = (d && d.categorias) || [];
                return A.logos;
            })();
        }
        return A.pronto;
    }
    async function gravarAssets() {
        try { localStorage.setItem(GUARDA_ASSETS, JSON.stringify({ versao: 1, logos: A.logos, guias: A.guias, categorias: A.categorias })); } catch (e) { /* imagens enviadas demais: fica só no arquivo */ }
        if (local()) {
            try { await fetch('/api/linkedit/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logos: A.logos, guias: A.guias, categorias: A.categorias }) }); }
            catch (e) { S.aviso('Não consegui gravar o banco de logos no PC: ' + e.message, 'ruim'); }
        }
    }
    /** Guarda um logo no banco (sem repetir o mesmo link). true = entrou. */
    function guardarLogo(nome, url, pais, origem) {
        if (!ehImagem(url) || A.logos.some(l => l.url === url)) return false;
        A.logos.unshift({ nome: String(nome || 'Sem nome').trim(), n: L.norm(nome), pais: pais || '', url, origem: origem || '', em: Date.now() });
        return true;
    }
    async function salvarLogosEmMassa(canais) {
        await carregarAssets();
        let n = 0;
        canais.forEach(c => { if (ehImagem(c.logo) && guardarLogo(c.nome, c.logo, c.pais, (E.listas.find(l => l.id === c.lista) || {}).nome)) n++; });
        if (n) await gravarAssets();
        S.aviso(n ? `${n} logos salvos no banco (Assets).` : 'Nenhum logo novo: esses já estão no banco (ou os canais não têm logo).', n ? 'ok' : 'ruim');
        return n;
    }
    /** Logos do banco para este canal: mesmo nome (mesmo país primeiro), depois nomes parecidos. */
    function logosDoBanco(c, soCerteza = false) {
        const n = L.norm(c.nome);
        if (!n) return [];
        const r = [];
        A.logos.forEach(l => {
            let p = l.n === n ? 80 : (!soCerteza && n.length >= 3 && (l.n.startsWith(n + ' ') || n.startsWith(l.n + ' ') || l.n.includes(n))) ? 30 : 0;
            if (!p) return;
            if (c.pais && l.pais === c.pais) p += 15; else if (c.pais && l.pais && soCerteza) return;
            r.push([p, l]);
        });
        return r.sort((a, b) => b[0] - a[0]).map(x => x[1]);
    }
    async function abrirAssets(filtro = '') {
        await carregarAssets();
        const c = E.canais.find(x => x.id === E.foco);
        const fonte = (E.sel.size ? selecionados() : E.visiveis).filter(x => ehImagem(x.logo));
        const j = janela(`${abasAssets('logos')}<h3>Assets · banco de logos <small style="color:var(--s);font-weight:600">${A.logos.length} logos</small></h3>
          <p class="le-dica">${local() ? 'Guardado na pasta do Studio (<b>dados/linkedit-assets.json</b>): vale para todas as listas e dá para fazer commit.' : 'Guardado neste navegador. Use <b>Exportar</b> para não perder (no painel local ele vira um arquivo).'}</p>
          <div class="le-jan-botoes" style="justify-content:flex-start">
            <button class="le-bt p" id="le-as-massa" ${fonte.length ? '' : 'disabled'}>★ Salvar logos ${E.sel.size ? 'dos marcados' : 'dos visíveis'} (${fonte.length})</button>
            <button class="le-bt" id="le-as-exp">Exportar</button>
            <label class="le-bt" style="display:inline-flex;align-items:center;cursor:pointer">Importar<input type="file" id="le-as-imp" accept=".json,application/json" hidden></label>
          </div>
          <input class="le-campo" id="le-as-busca" placeholder="Buscar logo pelo nome do canal…" value="${esc(filtro)}" autocomplete="off">
          <div class="le-as-cab"><span>Logo</span><span>Canal</span><span>Link</span><span></span></div>
          <div class="le-as-lista" id="le-as-lista"></div>`, 'larga');
        ligarAbas(j);
        const caixa = j.querySelector('#le-as-lista'), busca = j.querySelector('#le-as-busca');
        const pintar = () => {
            const q = L.norm(busca.value);
            const vis = A.logos.filter(l => !q || l.n.includes(q) || L.norm(l.pais).includes(q)).slice(0, 400);
            caixa.innerHTML = vis.length ? vis.map(l => `<div class="le-as-linha">
                <span class="le-as-img"><img src="${esc(l.url)}" alt="" loading="lazy"></span>
                <span><b>${esc(l.nome)}</b><small>${l.pais ? bandeira(l.pais) + ' ' + esc(l.pais) : ''}${l.origem ? ' · ' + esc(l.origem) : ''}</small></span>
                <code title="${esc(l.url.startsWith('data:') ? 'imagem enviada do computador' : l.url)}">${esc(l.url.startsWith('data:') ? '(imagem enviada do computador)' : l.url)}</code>
                <span class="le-as-acoes">${c ? `<button class="le-bt p" data-as-usar="${esc(l.url)}" title="Usar no canal do visualizador (${esc(c.nome)})">Usar</button>` : ''}<button class="le-bt" data-as-copiar="${esc(l.url)}" ${l.url.startsWith('data:') ? 'disabled' : ''}>Copiar</button><button class="le-bt" data-as-apagar="${esc(l.url)}" aria-label="Apagar ${esc(l.nome)}">✕</button></span>
              </div>`).join('') + (A.logos.length > 400 && !q ? '<p class="le-dica">Mostrando 400. Use a busca.</p>' : '')
                : `<p class="le-dica" style="padding:12px 0">${A.logos.length ? 'Nada com esse nome.' : 'O banco está vazio. Abra uma lista antiga e clique em "Salvar logos" para guardar os logos dela.'}</p>`;
        };
        pintar();
        busca.oninput = pintar;
        caixa.onclick = async (e) => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.dataset.asCopiar) copiarTexto(b.dataset.asCopiar, 'Link do logo copiado.');
            if (b.dataset.asUsar && c) { usarLogo(c, b.dataset.asUsar, true); S.aviso('Logo colocado em ' + c.nome + '.', 'ok'); }
            if (b.dataset.asApagar) { A.logos = A.logos.filter(l => l.url !== b.dataset.asApagar); await gravarAssets(); pintar(); j.querySelector('h3 small').textContent = A.logos.length + ' logos'; }
        };
        j.querySelector('#le-as-massa').onclick = async () => { await salvarLogosEmMassa(fonte); abrirAssets(busca.value); };
        j.querySelector('#le-as-exp').onclick = () => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify({ versao: 1, logos: A.logos }, null, 1)], { type: 'application/json' }));
            a.download = 'linkedit-logos.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        };
        j.querySelector('#le-as-imp').onchange = async (e) => {
            const f = e.target.files[0]; if (!f) return;
            try {
                const d = JSON.parse(await f.text());
                const lista = Array.isArray(d) ? d : d.logos || [];
                let n = 0; lista.forEach(l => { if (l && guardarLogo(l.nome || l.name, l.url || l.logo, l.pais || l.country, l.origem || f.name)) n++; });
                await gravarAssets(); S.aviso(`${n} logos importados.`, 'ok'); abrirAssets();
            } catch (er) { S.aviso('Arquivo de logos inválido: ' + er.message, 'ruim'); }
        };
        busca.focus();
    }
    // ---------------------------------------------------------------- guias (EPG)
    const abasAssets = (aba) => `<div class="le-abas" role="tablist"><button class="le-aba${aba === 'logos' ? ' on' : ''}" data-aba="logos" role="tab" aria-selected="${aba === 'logos'}">★ Logos</button><button class="le-aba${aba === 'guias' ? ' on' : ''}" data-aba="guias" role="tab" aria-selected="${aba === 'guias'}">📺 Guias (EPG)</button></div>`;
    function ligarAbas(j) { j.querySelectorAll('[data-aba]').forEach(b => { b.onclick = () => (b.dataset.aba === 'guias' ? abrirGuias() : abrirAssets()); }); }
    // sugestões de guias abertos (XMLTV). Se algum sair do ar, o "Ler" avisa.
    const GUIAS_SUGERIDOS = [
        ['Brasil (epgshare01)', 'https://epgshare01.online/epgshare01/epg_ripper_BR1.xml.gz', 'BR'],
        ['Portugal (epgshare01)', 'https://epgshare01.online/epgshare01/epg_ripper_PT1.xml.gz', 'PT'],
        ['México (epgshare01)', 'https://epgshare01.online/epgshare01/epg_ripper_MX1.xml.gz', 'MX'],
        ['EUA (epgshare01)', 'https://epgshare01.online/epgshare01/epg_ripper_US1.xml.gz', 'US'],
        ['Pluto TV (todos os países)', 'https://i.mjh.nz/PlutoTV/all.xml.gz', ''],
        ['Samsung TV Plus (todos)', 'https://i.mjh.nz/SamsungTVPlus/all.xml.gz', '']
    ];
    const indiceGuia = new Map();       // url → Promise<[{ guia, guiaNome, id, nomes, icone, pais }]>
    /** Lê os canais de um guia: pelo painel local (qualquer guia, .gz) ou direto no navegador (se o site deixar). */
    function lerGuia(g, forcar) {
        if (!forcar && indiceGuia.has(g.url)) return indiceGuia.get(g.url);
        const tarefa = (async () => {
            let canais;
            if (local()) {
                const r = await (await fetch('/api/linkedit/epg/canais?url=' + encodeURIComponent(g.url) + (forcar ? '&forcar=1' : ''))).json();
                if (r.erro) throw new Error(r.erro);
                canais = r.canais;
            } else {
                const r = await fetch(g.url);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                let corpo = r.body;
                if (/\.gz(\?|$)/i.test(g.url) && window.DecompressionStream) corpo = corpo.pipeThrough(new DecompressionStream('gzip'));
                const leitor = corpo.pipeThrough(new TextDecoderStream()).getReader();
                let texto = '';
                for (;;) { const { done, value } = await leitor.read(); if (done) break; texto += value; if (texto.includes('<programme') || texto.length > 60e6) { leitor.cancel().catch(() => {}); break; } }
                canais = L.canaisXMLTV(texto.split('<programme')[0]);
                if (!canais.length) throw new Error('não achei canais (é um guia XMLTV?)');
            }
            g.canais = canais.length; g.lidoEm = Date.now(); delete g.erro;
            return canais.map(x => Object.assign({ guia: g.url, guiaNome: g.nome, pais: x.pais || g.pais || '' }, x, { pais: x.pais || g.pais || '' }));
        })();
        indiceGuia.set(g.url, tarefa);
        tarefa.catch((e) => { indiceGuia.delete(g.url); g.erro = e.message; });
        return tarefa;
    }
    /** Todos os canais de todos os guias do banco (os que abrirem). */
    async function indiceDosGuias() {
        await carregarAssets();
        const partes = await Promise.all(A.guias.map(g => lerGuia(g).catch(() => [])));
        return partes.flat();
    }
    async function abrirGuias() {
        await carregarAssets();
        const daLista = E.listas.map(l => l.epg).filter(Boolean).flatMap(u => String(u).split(',')).map(u => u.trim()).filter(u => u && !A.guias.some(g => g.url === u));
        const sug = GUIAS_SUGERIDOS.filter(([, u]) => !A.guias.some(g => g.url === u)).concat([...new Set(daLista)].map(u => ['Guia da lista: ' + u.split('/').pop(), u, '']));
        const j = janela(`${abasAssets('guias')}<h3>Assets · guias de programação (EPG) <small style="color:var(--s);font-weight:600">${A.guias.length} guias</small></h3>
          <p class="le-dica">Guias XMLTV (.xml ou .xml.gz). O Link Edit lê só a lista de canais de cada guia e liga cada canal ao código certo; a lista exportada leva o <b>url-tvg</b> dos guias que usa — o Cloud/TVzine faz o resto.${local() ? '' : ' <b>Online, muitos guias não abrem (bloqueio do site e .gz): use o painel local.</b>'}</p>
          <div style="display:flex;gap:6px"><input class="le-campo" id="le-gu-url" placeholder="Link do guia (https://…/guia.xml.gz)" style="flex:2"><input class="le-campo" id="le-gu-nome" placeholder="Nome (opcional)" style="flex:1"><button class="le-bt p" id="le-gu-add">Adicionar</button></div>
          ${sug.length ? `<div class="le-dica">Sugestões: ${sug.map(([n, u, p]) => `<button class="le-chip" data-gu-sug="${esc(u)}" data-nome="${esc(n)}" data-pais="${esc(p)}" title="${esc(u)}">+ ${esc(n)}</button>`).join(' ')}</div>` : ''}
          <div class="le-as-cab le-gu"><span>Guia</span><span>Link</span><span>Canais</span><span></span></div>
          <div class="le-as-lista" id="le-gu-lista"></div>`, 'larga');
        ligarAbas(j);
        const caixa = j.querySelector('#le-gu-lista');
        const pintar = () => {
            caixa.innerHTML = A.guias.length ? A.guias.map((g, i) => `<div class="le-as-linha le-gu">
                <span><b>${esc(g.nome)}</b><small>${g.pais ? bandeira(g.pais) + ' ' + esc(g.pais) : '🌐 vários países'}</small></span>
                <code title="${esc(g.url)}">${esc(g.url)}</code>
                <span class="le-mono" style="color:${g.erro ? '#f87171' : '#9aa3ad'}" title="${esc(g.erro || '')}">${g.erro ? 'não abriu' : g.canais != null ? g.canais : '—'}</span>
                <span class="le-as-acoes"><button class="le-bt" data-gu-ler="${i}">${g.canais != null ? 'Reler' : 'Ler'}</button><button class="le-bt" data-gu-copiar="${i}">Copiar</button><button class="le-bt" data-gu-apagar="${i}" aria-label="Apagar ${esc(g.nome)}">✕</button></span>
              </div>`).join('') : '<p class="le-dica" style="padding:12px 0">Nenhum guia ainda. Adicione um link acima ou clique numa sugestão.</p>';
        };
        const ler = async (g, forcar) => {
            const i = A.guias.indexOf(g);
            const b = caixa.querySelector(`[data-gu-ler="${i}"]`); if (b) { b.disabled = true; b.textContent = 'Lendo…'; }
            try { const cs = await lerGuia(g, forcar); S.aviso(`${g.nome}: ${cs.length} canais no guia.`, 'ok'); }
            catch (e) { S.aviso(`${g.nome}: não abriu (${e.message}).`, 'ruim'); }
            await gravarAssets(); if (caixa.isConnected) pintar();
        };
        const adicionar = (url, nome, pais) => {
            url = String(url || '').trim();
            if (!/^https?:\/\//i.test(url)) return S.aviso('Cole um link http(s) de guia XMLTV.', 'ruim');
            let g = A.guias.find(x => x.url === url);
            if (!g) { g = { url, nome: (nome || '').trim() || url.split('/').pop().replace(/\.(xml|gz)/gi, '') || 'Guia', pais: pais || '' }; A.guias.push(g); }
            pintar(); ler(g);
        };
        pintar();
        j.querySelector('#le-gu-add').onclick = () => adicionar(j.querySelector('#le-gu-url').value, j.querySelector('#le-gu-nome').value);
        j.addEventListener('click', async (e) => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.dataset.guSug) { b.remove(); adicionar(b.dataset.guSug, b.dataset.nome, b.dataset.pais); }
            if (b.dataset.guLer) ler(A.guias[+b.dataset.guLer], true);
            if (b.dataset.guCopiar) copiarTexto(A.guias[+b.dataset.guCopiar].url, 'Link do guia copiado.');
            if (b.dataset.guApagar) { const g = A.guias.splice(+b.dataset.guApagar, 1)[0]; indiceGuia.delete(g.url); await gravarAssets(); pintar(); }
        });
    }

    const horaCurta = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    /** Liga os canais (e as cópias deles) a um canal do guia. */
    function aplicarGuia(alvo, g, shift, logoDoGuia) {
        lembrar();
        const todos = new Set();
        alvo.forEach(x => copiasDe(x).forEach(y => todos.add(y)));
        todos.forEach(x => {
            const antes = x.url;
            L.ligarGuia(x, g, shift);
            if (g && logoDoGuia && g.icone && !ehImagem(x.logo)) x.logo = g.icone;
            E.nova.itens.forEach(it => { if (it.url === antes) Object.assign(it, { tvgId: x.tvgId, epgId: x.epgId, epgGuia: x.epgGuia, epgShift: x.epgShift, chave: x.chave, logo: it.logo || x.logo }); });
        });
        salvar(); desenharFiltros(); desenharTabela(); desenharNova(); pintarFicha(E.canais.find(x => x.id === E.foco));
        return todos.size;
    }
    async function ligarGuiasAuto(alvo0) {
        await carregarAssets();
        if (!A.guias.length) { S.aviso('Adicione um guia primeiro (Assets → Guias).', 'ruim'); return abrirGuias(); }
        const alvo = (alvo0 || (E.sel.size ? selecionados() : E.visiveis)).filter(c => !c.epgId);
        if (!alvo.length) return S.aviso('Esses canais já estão ligados a um guia.', 'ok');
        S.aviso('Lendo os guias e comparando os nomes…', 'ok');
        const indice = await indiceDosGuias();
        if (!indice.length) return S.aviso('Nenhum guia abriu. Confira os links em Assets → Guias.', 'ruim');
        lembrar();
        let n = 0, duvida = 0;
        const feitos = new Set();
        alvo.forEach(c => {
            if (feitos.has(c.chave) || c.epgId) return;
            const [m] = L.acharNoGuia(indice, c, 1);
            // só o que é certeza (mesmo tvg-id, ou mesmo nome no mesmo país); o resto vira sugestão na janela do guia
            if (m && m.pontos >= 85) {
                const k = c.chave;
                copiasDe(c).forEach(x => { L.ligarGuia(x, m.canal); if (m.canal.icone && !ehImagem(x.logo)) x.logo = m.canal.icone; });
                feitos.add(k); feitos.add(c.chave); n++;
            } else if (m) duvida++;
        });
        salvar(); desenharFiltros(); desenharTabela(); pintarFicha(E.canais.find(x => x.id === E.foco));
        S.aviso(`${n} canais ligados ao guia.` + (duvida ? ` ${duvida} têm sugestão: filtre "Sem guia" e clique no + da coluna Guia.` : ''), n ? 'ok' : 'ruim');
    }
    async function escolherGuia(c) {
        const alvo = c && !(E.sel.has(c.id) && E.sel.size > 1) ? [c] : selecionados();
        if (!alvo.length) return S.aviso('Clique no guia de um canal (ou marque vários e aperte G).', 'ruim');
        await carregarAssets();
        const um = alvo.length === 1 ? alvo[0] : null;
        const shiftAtual = um ? (um.epgShift || 0) : 0;
        const guiaNome = (u) => (A.guias.find(g => g.url === u) || {}).nome || (u || '').split('/').pop();
        const j = janela(`<h3>Guia (EPG) · ${um ? esc(um.nome) : alvo.length + ' canais marcados'}</h3>
          <p class="le-dica">${um ? (um.epgId ? `Ligado a <b>${esc(um.epgId)}</b> · ${esc(guiaNome(um.epgGuia))}` : 'Ainda sem guia.') : 'Liga cada marcado ao canal certo do guia, pelo nome (igual ao TVzine).'}</p>
          ${A.guias.length ? '' : '<p class="le-dica" style="color:#fbbf24">Nenhum guia no banco ainda. <button class="le-chip" id="le-g-assets">Adicionar guias</button></p>'}
          ${um ? `<input class="le-campo" id="le-g-busca" placeholder="Buscar no guia: nome ou código do canal…" value="${esc(um.nome)}" autocomplete="off">
          <div class="le-g-lista" id="le-g-lista"><p class="le-dica">Lendo os guias…</p></div>` : `<div class="le-jan-botoes" style="justify-content:flex-start"><button class="le-bt p" id="le-g-auto">Ligar automático nos ${alvo.length} marcados</button></div>`}
          <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
            <label class="le-dica" style="display:flex;gap:6px;align-items:center">Ajuste de horário <select id="le-g-shift" class="le-campo" style="height:32px;padding:0 8px">${Array.from({ length: 25 }, (_, i) => i - 12).map(h => `<option value="${h}" ${h === shiftAtual ? 'selected' : ''}>${h > 0 ? '+' : ''}${h} h</option>`).join('')}</select></label>
            <label class="le-dica" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="le-g-logo" checked> usar o logo do guia em quem não tem logo</label>
          </div>
          <div class="le-jan-botoes">${alvo.some(x => x.epgId) ? '<button class="le-bt" id="le-g-tirar">Tirar o guia</button>' : ''}${um && um.epgId ? '<button class="le-bt" id="le-g-shift-ok">Salvar só o ajuste de horário</button>' : ''}<button class="le-bt" id="le-g-gerenciar">Guias do banco…</button><button class="le-bt" data-fechar>Fechar</button></div>`);
        const shift = () => +j.querySelector('#le-g-shift').value || 0;
        const logo = () => j.querySelector('#le-g-logo').checked;
        const ga = j.querySelector('#le-g-assets'); if (ga) ga.onclick = () => abrirGuias();
        j.querySelector('#le-g-gerenciar').onclick = () => abrirGuias();
        const tirar = j.querySelector('#le-g-tirar'); if (tirar) tirar.onclick = () => { const n = aplicarGuia(alvo.filter(x => x.epgId), null); fecharJanela(); S.aviso(`Guia tirado de ${n} canal(is).`, 'ok'); };
        const so = j.querySelector('#le-g-shift-ok'); if (so) so.onclick = () => { lembrar(); copiasDe(um).forEach(x => { x.epgShift = shift() || undefined; }); salvar(); fecharJanela(); pintarFicha(um); S.aviso('Ajuste de horário salvo.', 'ok'); };
        const auto = j.querySelector('#le-g-auto'); if (auto) auto.onclick = () => { fecharJanela(); ligarGuiasAuto(alvo); };
        if (!um) return;
        const caixa = j.querySelector('#le-g-lista'), busca = j.querySelector('#le-g-busca');
        let indice = [];
        const pintar = () => {
            const q = busca.value.trim();
            let res;
            if (!q || L.norm(q) === L.norm(um.nome)) res = L.acharNoGuia(indice, um, 30);
            else { const nq = L.nomeEPG(q); res = indice.filter(g => g.id.toLowerCase().includes(q.toLowerCase()) || g.nomes.some(n => L.nomeEPG(n).includes(nq))).slice(0, 40).map(g => ({ pontos: 0, canal: g })); }
            caixa.innerHTML = res.length ? res.map(({ pontos, canal: g }, i) => `<button class="le-g-op${um.epgId === g.id && um.epgGuia === g.guia ? ' on' : ''}" data-g="${i}">
                <span class="le-as-img">${g.icone ? `<img src="${esc(g.icone)}" alt="" loading="lazy">` : ''}</span>
                <span><b>${esc(g.nomes[0] || g.id)}</b><small>${esc(g.id)} · ${esc(g.guiaNome || '')}</small></span>
                <span class="le-g-nota ${pontos >= 85 ? 'ok' : pontos ? 'meio' : ''}">${pontos >= 85 ? 'certeiro' : pontos ? 'parecido' : ''}${g.pais ? ' ' + bandeira(g.pais) : ''}</span></button>`).join('')
                : `<p class="le-dica">${A.guias.length ? 'Nada nos guias com esse nome. Tente outra palavra (ou o código, ex.: Globo.br).' : 'Adicione um guia primeiro.'}</p>`;
            caixa.onclick = (e) => {
                const b = e.target.closest('[data-g]'); if (!b) return;
                const g = res[+b.dataset.g].canal;
                const n = aplicarGuia([um], g, shift(), logo());
                fecharJanela();
                S.aviso(`${um.nome} ligado a ${g.id}${n > 1 ? ` (e ${n - 1} cópias)` : ''}.`, 'ok');
            };
        };
        busca.oninput = pintar;
        busca.focus(); busca.select();
        indice = await indiceDosGuias();
        if (caixa.isConnected) pintar();
    }
    /** Ficha: o que passa agora e a seguir (prova de que o guia ligou certo). Só no painel local. */
    async function pintarAgora(c) {
        const el = $('#le-epg-agora'); if (!el || !c || !c.epgId) return;
        if (!local()) { el.innerHTML = '<span class="le-dica">A programação aparece no painel local.</span>'; return; }
        el.innerHTML = '<span class="le-dica">Carregando a programação… (a 1ª vez lê o guia inteiro e pode demorar)</span>';
        try {
            const r = await (await fetch('/api/linkedit/epg/agora?url=' + encodeURIComponent(c.epgGuia) + '&id=' + encodeURIComponent(c.epgId))).json();
            if (E.foco !== c.id || !el.isConnected) return;
            if (r.erro) throw new Error(r.erro);
            const d = (c.epgShift || 0) * 3600e3;
            const linha = (p, rot) => `<div class="le-epg-l"><span>${rot || horaCurta(p[0] + d)}</span><b title="${esc(p[3] || '')}">${esc(p[2] || 'Sem título')}</b><small>${horaCurta(p[0] + d)}–${horaCurta(p[1] + d)}</small></div>`;
            el.innerHTML = (r.agora || r.seguintes.length) ? (r.agora ? linha(r.agora, 'AGORA') : '') + r.seguintes.slice(0, 2).map(p => linha(p)).join('')
                : '<span class="le-dica" style="color:#fbbf24">O guia não tem programação deste canal para agora (código certo? guia atualizado?).</span>';
        } catch (e) { if (el.isConnected) el.innerHTML = `<span class="le-dica" style="color:#f87171">Programação não abriu: ${esc(e.message)}</span>`; }
    }

    async function copiarTexto(t, msg) {
        try { await navigator.clipboard.writeText(t); S.aviso(msg || 'Copiado.', 'ok'); }
        catch (e) { window.prompt('Copie o link:', t); }
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
            <div><span>Idioma</span><button class="le-idi${c.idioma ? '' : ' vazio'}" data-idioma="${esc(c.id)}" title="Trocar o idioma (I)">${esc(c.idioma || '+ idioma')}${c.pais ? ' ' + bandeira(c.pais) : ''}</button></div>
            <div><span>Confiança</span><b>${esc(conf)}</b></div>
            <div><span>Categoria</span><button class="le-idi${c.grupoSaida ? '' : ' vazio'}" data-cat-canal="${esc(c.id)}" title="Trocar a categoria (C)">${esc(c.grupoSaida || '+ categoria')}</button></div>
            <div><span>Guia</span><button class="le-idi${c.epgId ? '' : ' vazio'}" data-guia="${esc(c.id)}" title="${c.epgId ? esc(c.epgId) + ' — trocar (G)' : 'Ligar ao guia (G)'}">${c.epgId ? '✓ ' + esc(c.epgId) : '+ guia'}</button></div>
            ${c.formato === 'arquivo' || t.tamanho ? `<div><span>Tamanho</span><b>${t.tamanho ? (t.tamanho >= 1073741824 ? (t.tamanho / 1073741824).toFixed(1).replace('.', ',') + ' GB' : t.tamanho >= 1048576 ? Math.round(t.tamanho / 1048576) + ' MB' : Math.max(1, Math.round(t.tamanho / 1024)) + ' KB') : '—'}</b></div>
            <div><span>Duração</span><b id="le-ficha-dur">—</b></div>` : ''}
          </div>
          ${t.motivo ? `<div class="le-motivo">${esc(t.motivo)}</div>` : ''}
          ${c.epgId ? '<div class="le-epg" id="le-epg-agora"></div>' : ''}
          <div class="le-url" title="${esc(c.url)}">${esc(c.url)}</div>`;
        if (c.epgId) pintarAgora(c);
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
.le-cab,.le-linha{display:grid;grid-template-columns:30px 40px minmax(140px,1fr) minmax(70px,140px) 64px 40px 92px 62px;gap:10px;align-items:center;padding:0 14px}
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
.le-idi{background:none;border:0;padding:2px 4px;margin-left:-4px;border-radius:5px;font-family:'JetBrains Mono','Share Tech Mono',monospace;font-size:12px;color:#cbd5e1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.le-idi:hover,.le-idi:focus-visible{background:#102a31;color:#67e8f9;outline:none}.le-idi.vazio{color:#fbbf24}.le-idi.manual{color:#67e8f9}
.le-ficha-grade .le-idi{font-weight:800;display:block;padding:0;margin:0}
.le-idi-lista{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;max-height:330px;overflow:auto}
.le-idi-op{display:grid;grid-template-columns:22px 52px 1fr;align-items:center;gap:6px;text-align:left;padding:8px 10px;border-radius:8px;background:#11141b;border:1px solid #2a3140;color:#e5e7eb}
.le-idi-op:hover,.le-idi-op:focus-visible{border-color:var(--c);outline:none}.le-idi-op.on{border-color:var(--c);background:#102a31}
.le-idi-op b{font-family:'JetBrains Mono',monospace;font-size:12px;color:#67e8f9}.le-idi-op small{font-size:12px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.le-logo-link{display:flex;gap:6px;align-items:center}.le-logo-link code{flex:1;min-width:0;font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#9aa3ad;background:#0d1016;border:1px solid #2a3140;border-radius:8px;padding:9px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.le-jan.larga{width:min(900px,100%);height:min(720px,100%)}
.le-as-cab,.le-as-linha{display:grid;grid-template-columns:70px minmax(120px,1fr) minmax(0,1.4fr) auto;gap:10px;align-items:center}
.le-as-cab{font-size:10.5px;font-weight:800;letter-spacing:.12em;color:#8b95a3;text-transform:uppercase;padding:6px 4px 4px;border-bottom:1px solid var(--b)}
.le-as-lista{flex:1;overflow:auto;min-height:120px}
.le-as-linha{padding:6px 4px;border-bottom:1px solid #141821;font-size:13px}
.le-as-linha b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.le-as-linha small{font-size:11.5px;color:var(--s)}
.le-as-linha code{font-family:'JetBrains Mono',monospace;font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.le-as-img{height:40px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#141821 0 25%,#0f1218 0 50%) 0 0/12px 12px}
.le-as-img img{max-width:62px;max-height:34px;object-fit:contain}
.le-as-acoes{display:flex;gap:4px}.le-as-acoes .le-bt{height:30px;padding:0 10px;font-size:12px}
.le-linha .le-idi{line-height:20px;align-self:center}
.le-guia{background:none;border:0;padding:2px 0;border-radius:5px;font-weight:900;font-size:13px;color:#3a4352}.le-guia:hover,.le-guia:focus-visible{background:#102a31;color:#67e8f9;outline:none}.le-guia.ok{color:#4ade80}
.le-abas{display:flex;gap:6px;margin:-4px 30px 6px 0}.le-aba{padding:7px 12px;border-radius:999px;background:#161b24;border:1px solid transparent;color:#cbd5e1;font-weight:800;font-size:12.5px}.le-aba.on{background:#102a31;color:#67e8f9;border-color:#1f5560}
.le-as-cab.le-gu,.le-as-linha.le-gu{grid-template-columns:minmax(140px,1fr) minmax(0,1.6fr) 70px auto}
.le-g-lista{display:flex;flex-direction:column;gap:5px;max-height:320px;overflow:auto}
.le-g-op{display:grid;grid-template-columns:70px 1fr auto;gap:10px;align-items:center;text-align:left;padding:6px 10px;border-radius:8px;background:#11141b;border:1px solid #2a3140;color:#e5e7eb}
.le-g-op:hover,.le-g-op:focus-visible{border-color:var(--c);outline:none}.le-g-op.on{border-color:var(--c);background:#102a31}
.le-g-op b{display:block;font-size:13px}.le-g-op small{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--s)}
.le-g-nota{font-size:11px;font-weight:800;color:var(--s);white-space:nowrap}.le-g-nota.ok{color:#4ade80}.le-g-nota.meio{color:#fbbf24}
.le-epg{margin-top:8px;padding:8px 10px;border-radius:8px;background:#11141b;display:flex;flex-direction:column;gap:4px}
.le-epg-l{display:grid;grid-template-columns:52px 1fr auto;gap:8px;align-items:baseline;font-size:12px}.le-epg-l span{font-family:'JetBrains Mono',monospace;font-size:11px;color:#67e8f9}
.le-epg-l b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.le-epg-l small{color:var(--s);font-size:11px}
.le-cat{background:none;border:0;padding:2px 4px;margin-left:-4px;border-radius:5px;font:inherit;text-align:left;cursor:pointer;max-width:100%}
.le-cat:hover,.le-cat:focus-visible{background:#102a31;color:#67e8f9;outline:none}.le-cat.ok{color:#67e8f9;font-weight:700}
.le-cat-lista .le-idi-op{grid-template-columns:16px 1fr auto}.le-cat-lista .le-idi-op b{font-family:Inter,sans-serif;font-size:13px;color:#e5e7eb}
.le-cat-lista .le-idi-op span{color:#fbbf24}.le-cat-nova b{color:#67e8f9!important}
.le-imp-op{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;font-size:12.5px;color:#cbd5e1}.le-imp-op label{display:flex;gap:6px;align-items:center}.le-imp-op .le-campo{height:32px;padding:0 8px;max-width:240px}
.le-imp-resumo{display:flex;flex-wrap:wrap;gap:6px}
.le-imp-cab,.le-imp-linha{display:grid;grid-template-columns:170px 56px minmax(140px,1.4fr) 56px minmax(80px,1fr) 90px 38px minmax(120px,1.1fr);gap:8px;align-items:center}
.le-imp-cab{font-size:10.5px;font-weight:800;letter-spacing:.1em;color:#8b95a3;text-transform:uppercase;padding:6px 4px 4px;border-bottom:1px solid var(--b)}
.le-imp-linha{padding:5px 4px;border-bottom:1px solid #141821;font-size:12.5px}.le-imp-linha .le-campo{height:30px;padding:0 6px;font-size:12px;width:100%}
.le-imp-linha b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.le-imp-linha small{display:block;font-size:11px;color:var(--s);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.le-imp-linha .le-as-img{height:30px}
.le-imp-cab.le-env,.le-imp-linha.le-env{grid-template-columns:170px 44px minmax(160px,1.5fr) minmax(130px,1.1fr) 60px minmax(130px,1fr)}
.le-imp-linha.le-env .le-as-img{height:40px}.le-imp-linha.le-env .le-as-img img{max-height:38px}
.le-env-abas{flex-wrap:wrap;margin:0}.le-aba.vazia{opacity:.55}
.le-env-acoes{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.le-env-acoes .le-bt{height:32px;font-size:12px}
.le-imp-cab.le-vod,.le-imp-linha.le-vod{grid-template-columns:170px 40px minmax(160px,1.6fr) minmax(110px,1fr) 56px 60px minmax(130px,1.1fr)}
.le-imp-linha.le-vod .le-as-img{height:52px}.le-imp-linha.le-vod .le-as-img img{max-height:50px}
.le-aba small{color:var(--s);margin-left:4px}
.le-aviso-scan{padding:10px 12px;border-radius:10px;background:#2a1f0a;border:1px solid #5a4410;color:#fde68a;font-size:12.5px;line-height:1.5}.le-aviso-scan code{background:#0d1016;padding:1px 5px;border-radius:4px;color:#67e8f9}
.le-sj-alvos{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:6px;margin-top:6px}
.le-sj-op{display:flex;gap:8px;align-items:center;padding:9px 11px;border-radius:9px;background:#11141b;border:1px solid #2a3140;font-size:13px;cursor:pointer}.le-sj-op small{margin-left:auto;color:var(--s)}.le-sj-op.vazia{opacity:.45;cursor:default}
.le-sj-topo{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--s);margin-top:4px}
.le-sj-cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.le-sj-card{padding:10px 12px;border-radius:10px;background:#11141b;border:1px solid var(--b)}.le-sj-card b{display:block;font-size:22px;font-weight:900}.le-sj-card span{font-size:11.5px;color:var(--s)}
.le-sj-meio{display:grid;grid-template-columns:1fr 1.3fr;gap:16px;margin-top:6px}
.le-sj-barras div{display:grid;grid-template-columns:44px 1fr 44px;gap:8px;align-items:center;font-size:12px;margin-top:5px}.le-sj-barras i{display:block;height:10px;border-radius:5px;background:var(--c);min-width:2px}.le-sj-barras b{color:#cbd5e1;font-family:'JetBrains Mono',monospace;font-size:11.5px}
.le-sj-ult div{display:grid;grid-template-columns:16px minmax(0,1fr) minmax(0,1.3fr);gap:8px;font-size:12px;padding:3px 0;border-bottom:1px solid #141821}.le-sj-ult span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}.le-sj-ult small{color:var(--s);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.le-atalhos{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;align-items:center;font-size:13px}
.le-atalhos kbd{font-family:'JetBrains Mono',monospace;font-size:11.5px;padding:3px 8px;border-radius:6px;background:#11141b;border:1px solid #2a3140;color:#67e8f9;white-space:nowrap;justify-self:start}
@media (max-width:1100px){.le-cols{grid-template-columns:1fr}.le-esq,.le-dir{border:0}#le-raiz{height:auto}#le-corpo{height:420px;flex:none}}`;
        document.head.appendChild(s);
    }

    function desenhar(area, ferramentas) {
        S = ferramentas;
        css();
        const cfg = S.config && S.config();
        if (cfg && cfg.categoriasCanais) L.usarCategorias(cfg.categoriasCanais);   // a lista oficial é a do Studio (TVzine)
        if (!E.listas.length && !E.canais.length) carregar();
        area.innerHTML = `
        <div id="le-raiz" tabindex="-1">
          <div class="le-topo">
            <div class="le-logo"><b>LINK</b><i>EDIT</i></div>
            <span class="chip ${local() ? 'ok' : ''}" title="${local() ? 'Testes e túnel do visualizador pelo painel do seu PC' : 'Online: o Scan e o túnel precisam do painel local (node tools/painel.mjs)'}">${local() ? 'painel local' : 'online'}</span>
            <div style="flex:1"></div>
            <button class="le-bt" id="le-importar" title="Lista que já está pronta: vai inteira para o Studio, cada item na coleção certa">⚡ Importar lista inteira</button>
            <button class="le-bt" id="le-assets" title="Banco de logos salvos, para usar em qualquer lista (B)">★ Assets</button>
            <button class="le-bt" id="le-desfazer" title="Desfazer (Ctrl+Z)">↶ Desfazer</button>
            <button class="le-bt" id="le-sair" title="Sair do Link Edit e voltar para as coleções do Studio (o que você fez aqui fica guardado)">📚 Coleções</button>
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
                <button class="le-bt" id="le-guias" title="Liga os marcados (ou visíveis) ao guia de programação, pelo nome — igual ao TVzine">Ligar guias</button>
                <button class="le-bt" id="le-logos" title="Coloca o logo que falta nos marcados (ou visíveis), pelo banco aberto do iptv-org">Achar logos</button>
                <button class="le-bt r" id="le-jogar">➜ Jogar na lista nova</button>
                <button class="le-bt" id="le-ajuda" title="Atalhos do teclado (?)" aria-label="Atalhos do teclado">?</button>
              </div>
              <div class="le-scan" id="le-scan-barra" hidden></div>
              <div class="le-cab" role="row"><button class="le-caixa" id="le-cab-todos" title="Marcar todos os visíveis (Ctrl+A)" aria-label="Marcar todos os visíveis"></button><span>Logo</span><span>Canal</span><span>Grupo</span><span>Idioma</span><span title="Guia de programação (EPG)">Guia</span><span>Status</span><span>Abre em</span></div>
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
                <button class="le-bt r" id="le-studio" title="Grava a lista nova nas coleções do Studio: Canais (TVzine) por país, Desenhos 24H, Rádios">➜ Enviar ao Studio</button>
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
            <button class="le-chip ${E.f.semGuia ? 'on' : ''}" data-t="semGuia">Sem guia</button>
            <button class="le-chip ${E.f.semCategoria ? 'on' : ''}" data-t="semCategoria">Sem categoria</button>
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
              <button class="le-g le-cat${c.grupoSaida ? ' ok' : ''}" data-cat-canal="${esc(c.id)}" title="${c.grupoSaida ? 'Categoria: ' + esc(c.grupoSaida) + ' (grupo na lista: ' + esc(c.grupo || '—') + ')' : 'Grupo na lista: ' + esc(c.grupo || '—') + ' — clique para escolher a categoria (C)'}">${esc(c.grupoSaida || c.grupo || c.tipo)}</button>
              <button class="le-idi${c.idioma ? '' : ' vazio'}${c.idiomaManual ? ' manual' : ''}" data-idioma="${esc(c.id)}" title="${c.idioma ? 'Trocar o idioma (I)' : 'Sem idioma: clique para escolher (I)'}${c.pais ? ' · país ' + esc(c.pais) : ''}">${esc(c.idioma || '+ idioma')}</button>
              <button class="le-guia${c.epgId ? ' ok' : ''}" data-guia="${esc(c.id)}" title="${c.epgId ? 'Guia: ' + esc(c.epgId) + ' (G)' : 'Ligar ao guia de programação (G)'}">${c.epgId ? '✓' : '+'}</button>
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
        const vivos = sc.n.vivo + sc.n.lento + sc.n['pede-ua'];
        el.innerHTML = `<span>${sc.pausado ? '⏸ Pausado' : 'Testando'} <b style="color:#e5e7eb">${sc.feitos}</b> de ${sc.total} · <b style="color:#4ade80">${vivos}</b> vivos · <b style="color:#f87171">${sc.feitos - vivos}</b> com problema</span><span class="trilho"><b style="width:${Math.round(sc.feitos / sc.total * 100)}%"></b></span><button class="le-bt" id="le-scan-pausa">${sc.pausado ? '▶ Continuar' : '❚❚ Pausar'}</button><button class="le-bt" id="le-scan-parar">■ Parar</button><button class="le-bt" id="le-scan-ver">Ver</button>`;
        const p = $('#le-scan-parar'); if (p) p.onclick = () => { sc.parar = true; sc.pausado = false; };
        const pa = $('#le-scan-pausa'); if (pa) pa.onclick = () => pausarScan(!sc.pausado);
        const v = $('#le-scan-ver'); if (v) v.onclick = () => abrirScan();
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
        $('#le-sair').onclick = () => { pararVideo(); if (window.CZStudio && window.CZStudio.irParaColecoes) window.CZStudio.irParaColecoes(); else location.hash = ''; };
        $('#le-assets').onclick = () => abrirAssets();
        $('#le-importar').onclick = () => abrirImportarLista();
        let tb = 0;
        $('#le-busca').oninput = (e) => { clearTimeout(tb); tb = setTimeout(() => { E.f.busca = e.target.value; $('#le-corpo').scrollTop = 0; desenharTabela(); }, 120); };
        $('#le-corpo').addEventListener('scroll', () => requestAnimationFrame(pintarJanela), { passive: true });
        $('#le-sel-todos').onclick = () => { const todos = E.visiveis.every(c => E.sel.has(c.id)); E.visiveis.forEach(c => (todos ? E.sel.delete(c.id) : E.sel.add(c.id))); desenharTabela(); };
        $('#le-sel-vivos').onclick = () => { E.visiveis.forEach(c => { if (c.teste && /vivo|lento|pede-ua/.test(c.teste.status)) E.sel.add(c.id); }); desenharTabela(); };
        $('#le-scan').onclick = () => abrirScan();
        $('#le-quarentena').onclick = () => { const l = E.sel.size ? selecionados() : []; if (!l.length) return S.aviso('Selecione os canais (ou use Del no canal do visualizador).', 'ruim'); quarentena(l, !E.f.quarentena); };
        $('#le-jogar').onclick = () => { const l = selecionados(); if (!l.length) return S.aviso('Selecione os canais primeiro (a caixinha à esquerda de cada um).', 'ruim'); jogarNaLista(l); E.sel.clear(); desenharTabela(); };
        $('#le-ant').onclick = () => andar(-1);
        $('#le-prox').onclick = () => andar(1);
        $('#le-vai').onclick = () => { const c = E.canais.find(x => x.id === E.foco); if (c) { jogarNaLista([c]); andar(1); } };
        $('#le-copiar').onclick = copiar;
        $('#le-studio').onclick = () => abrirImportador();
        $('#le-nova-nome').onchange = (e) => { E.nova.nome = e.target.value.trim() || 'Lista nova'; salvar(); };
        raiz.querySelectorAll('[data-baixar]').forEach(b => { b.onclick = () => pedirNomeEBaixar(b.dataset.baixar); });
        $('#le-cab-todos').onclick = marcarTodos;
        $('#le-logos').onclick = acharLogosQueFaltam;
        $('#le-guias').onclick = () => ligarGuiasAuto();
        $('#le-ajuda').onclick = mostrarAtalhos;
        $('#le-mudo').onclick = () => { const v = $('#le-video'); mudarSom({ mudo: !(v ? v.muted : E.som.mudo), vol: !E.som.vol ? 0.6 : undefined }); };
        $('#le-vol').oninput = (e) => mudarSom({ vol: +e.target.value });
        pintarSom();
        raiz.addEventListener('click', (e) => {
            const t = e.target.closest('button, .le-linha');
            if (!t) return;
            if (t.dataset.tirarLista) return removerLista(t.dataset.tirarLista);
            if (t.dataset.sel) return marcar(t.dataset.sel, e.shiftKey);
            if (t.dataset.catCanal) { const cc = E.canais.find(c => c.id === t.dataset.catCanal); if (cc && !E.sel.has(cc.id)) E.ancora = cc.id; return escolherCategoria(cc); }
            if (t.dataset.guia) { const cg = E.canais.find(c => c.id === t.dataset.guia); if (cg && !E.sel.has(cg.id)) E.ancora = cg.id; return escolherGuia(cg); }
            if (t.dataset.idioma) { const ci = E.canais.find(c => c.id === t.dataset.idioma); if (ci && !E.sel.has(ci.id)) E.ancora = ci.id; return escolherIdioma(ci); }
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
            else if (!ctrl && k === 't') { e.preventDefault(); if (local()) scan(E.sel.size ? selecionados() : E.visiveis, { rotulo: E.sel.size ? 'os marcados' : 'os visíveis' }); else abrirScan(); }
            else if (!ctrl && k === 'l' && c) { e.preventDefault(); abrirLogo(c); }
            else if (!ctrl && k === 'i' && (c || E.sel.size)) { e.preventDefault(); escolherIdioma(E.sel.size > 1 ? null : c); }
            else if (!ctrl && k === 'c' && (c || E.sel.size)) { e.preventDefault(); escolherCategoria(E.sel.size > 1 ? null : c); }
            else if (!ctrl && k === 'g' && (c || E.sel.size)) { e.preventDefault(); escolherGuia(E.sel.size > 1 ? null : c); }
            else if (!ctrl && k === 'b') { e.preventDefault(); abrirAssets(); }
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
