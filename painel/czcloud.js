/**
 * ☁️ CZ CLOUD — o motor do catálogo (repositório cartoonzine-cloud) controlado pelo Studio.
 *
 *   🛡 Filtro de cópias  modo (desligado/analisar/ativo), travas opcionais e o relatório da última geração
 *   ▶ Build              gerar o catálogo agora (workflow "Build do catálogo"), andamento ao vivo e histórico
 *   📡 Fontes            ligar/desligar, editar e criar fontes do sources.json (com os itens da última rodada)
 *   📊 Visão geral       totais, categorias e fontes com erro (catalog/manifest.json)
 *
 * Lê e grava pelo GitHub: no Studio online usa o mesmo token; no painel do PC (ou se o token não tiver acesso ao
 * Cloud) dá para colar um token só para o Cloud. Salvar o sources.json já dispara o build sozinho (push).
 *
 *   window.CZCloud.desenhar(area, S)   S = { RepoGitHub, config(), token(), guardar, esc, aviso }
 */
(function () {
    'use strict';
    const WF = 'build-catalog.yml', GUARDA_TOKEN = 'czs-cloud-token';
    let S = null, area = null;
    const E = { aba: 'filtro', cfg: null, cfgOrig: '', manifest: null, resumo: null, separados: null, retirados: null, runs: null, jobs: null,
        rel: 'separados', busca: '', mostrar: 40, erro: '', poll: null, editando: null };
    const esc = (t) => S.esc(t);
    const $ = (q) => area && area.querySelector(q);
    const num = (n) => n == null ? '—' : Number(n).toLocaleString('pt-BR');
    const repoNome = () => ((S.config() || {}).cloud || {}).repo || 'cartoonzine/cartoonzine-cloud';
    const token = () => { const t = S.guardar.ler(GUARDA_TOKEN); return (t && t.token) || S.token() || ''; };
    const haQuanto = (d) => { if (!d) return '—'; const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`; };
    const dur = (a, b) => { const s = Math.max(0, Math.round((new Date(b || Date.now()) - new Date(a)) / 1000)); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; };

    // ------------------------------------------------------------ acesso ao GitHub
    async function gh(rota, opts = {}) {
        const t = token();
        const r = await fetch('https://api.github.com/repos/' + repoNome() + rota, Object.assign({ cache: 'no-store' }, opts, {
            headers: Object.assign({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, t ? { Authorization: 'Bearer ' + t } : {}, opts.headers || {})
        }));
        if (!r.ok) {
            let msg = r.status + ''; try { msg = (await r.json()).message || msg; } catch (e) { /* */ }
            const e = new Error(r.status === 401 ? 'token inválido ou expirado' : r.status === 403 || r.status === 404 ? 'o token não tem acesso ao ' + repoNome() + ' (' + msg + ')' : msg);
            e.status = r.status; throw e;
        }
        return r;
    }
    /** arquivo do Cloud: pela API (com token, sempre o mais novo) ou pelo raw (repositório público) */
    async function lerTexto(caminho) {
        if (token()) {
            try { return await (await gh('/contents/' + caminho.split('/').map(encodeURIComponent).join('/') + '?ref=main', { headers: { Accept: 'application/vnd.github.raw+json' } })).text(); }
            catch (e) { if (e.status !== 403 && e.status !== 404) throw e; }
        }
        const r = await fetch(`https://raw.githubusercontent.com/${repoNome()}/main/${caminho}?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(caminho + ': HTTP ' + r.status);
        return r.text();
    }
    /** o sources.json aceita vírgula sobrando (o build é tolerante); ao salvar ele volta limpo */
    function lerJSONTolerante(t) {
        const limpo = String(t).replace(/^﻿/, '').replace(/,(\s*[}\]])/g, '$1');
        return JSON.parse(limpo);
    }
    async function gravarSources(msg) {
        if (!token()) throw new Error('cole um token do GitHub com acesso ao Cloud (aba Fontes ou Filtro, campo "Token")');
        const repo = new S.RepoGitHub({ repo: repoNome(), branch: 'main', token: token() });
        await repo.salvar([{ caminho: 'sources.json', conteudo: JSON.stringify(E.cfg, null, 2) + '\n' }], msg);
        E.cfgOrig = JSON.stringify(E.cfg);
    }

    async function carregar(tudo) {
        E.erro = '';
        const tarefas = [
            lerTexto('sources.json').then(t => { E.cfg = lerJSONTolerante(t); E.cfgOrig = JSON.stringify(E.cfg); }),
            lerTexto('catalog/manifest.json').then(t => { E.manifest = JSON.parse(t); }),
            lerTexto('catalog/analise/resumo.json').then(t => { E.resumo = JSON.parse(t); }).catch(() => { E.resumo = null; }),
            carregarRuns(),
            // 📥 para conferir com o Sidechain: o que ele publicou (fontes) e o balanço da última rodada (fluxo)
            (S.lerStudio ? Promise.all([S.lerStudio('listas/sidechain-fontes.json').catch(() => null), S.lerStudio('sidechain/estado.json').catch(() => null)]).then(([f, e]) => { E.scFontes = Array.isArray(f) ? f : []; E.scFluxo = (e && e.fluxo) || null; }) : Promise.resolve())
        ];
        if (tudo || E.separados) tarefas.push(lerTexto('catalog/analise/separados-pela-capa.json').then(t => { E.separados = JSON.parse(t); }).catch(() => { E.separados = []; }));
        const r = await Promise.allSettled(tarefas);
        const falhou = r.find(x => x.status === 'rejected');
        if (falhou) E.erro = falhou.reason.message;
    }
    async function carregarRuns() {
        try {
            E.runs = (await (await gh(`/actions/workflows/${WF}/runs?per_page=12`)).json()).workflow_runs || [];
            const rodando = E.runs.find(r => r.status !== 'completed');
            E.jobs = rodando ? (await (await gh(`/actions/runs/${rodando.id}/jobs`)).json()).jobs || [] : null;
        } catch (e) { E.runs = E.runs || []; E.runsErro = e.message; }
    }
    function vigiar() {
        clearTimeout(E.poll);
        const rodando = (E.runs || []).some(r => r.status !== 'completed');
        if (!rodando || !area || !area.isConnected) return;
        E.poll = setTimeout(async () => {
            if (!area || !area.isConnected) return;
            const antes = (E.runs || []).find(r => r.status !== 'completed');
            await carregarRuns();
            const agora = antes && (E.runs || []).find(r => r.id === antes.id);
            if (agora && agora.status === 'completed') { await carregar(); S.aviso(agora.conclusion === 'success' ? '☁️ Catálogo gerado e publicado.' : '☁️ O build terminou com erro — veja no GitHub.', agora.conclusion === 'success' ? 'ok' : 'ruim'); }
            pintar();
        }, 10000);
    }

    async function desenhar(a, s) {
        area = a; S = s;
        area.innerHTML = '<div class="cz"><p class="dica" style="padding:30px">☁️ Conectando ao CZ Cloud…</p></div>';
        await carregar();
        pintar();
    }

    // ------------------------------------------------------------ desenho
    const fontesTodas = () => E.cfg ? [].concat((E.cfg.fontes || []).map((f, i) => ({ f, i, lista: 'fontes' })), (E.cfg.fontesDoStudio || []).map((f, i) => ({ f, i, lista: 'fontesDoStudio' }))) : [];
    function pintar() {
        if (!area || !area.isConnected) return;
        const m = E.manifest || {}, t = m.totals || {}, rs = E.resumo || {}, d = (E.cfg && E.cfg.deduplicacao) || {};
        const ativas = fontesTodas().filter(x => x.f && x.f.ativo !== false).length;
        const ult = (E.runs || [])[0];
        const sujo = E.cfg && JSON.stringify(E.cfg) !== E.cfgOrig;
        area.innerHTML = `<div class="cz">
          <div class="cz-hero"><div class="cz-nuvem">☁️</div><div><h2>CZ <b>Cloud</b> — o motor do catálogo</h2><p>Configure o filtro de cópias, ligue e desligue fontes e gere o catálogo do app — sem abrir o GitHub. <span class="dica">(${esc(repoNome())})</span></p></div>
            <div class="cz-st"><div class="a"><b>${num(t.itens)}</b><small>itens no catálogo</small></div><div class="v"><b>${num(ativas)}</b><small>fontes ativas</small></div>
              <div class="r"><b>${num(rs.retirados != null ? rs.retirados : rs.seriamRetirados)}</b><small>${rs.modo === 'analisar' ? 'seriam juntadas' : 'cópias juntadas'}</small></div>
              <div class="y"><b>${haQuanto(m.generatedAt)}</b><small>última geração ${ult ? (ult.status !== 'completed' ? '⟳' : ult.conclusion === 'success' ? '✓' : '✕') : ''}</small></div></div></div>
          ${E.erro ? `<div class="cz-erro">⚠ ${esc(E.erro)}</div>` : ''}
          ${!token() || E.pedirToken ? tokenHTML() : ''}
          <div class="cz-abas">${[['filtro', '🛡 Filtro de cópias'], ['build', '▶ Build'], ['fontes', '📡 Fontes'], ['geral', '📊 Visão geral']].map(([k, n]) => `<button class="${E.aba === k ? 'on' : ''}" data-aba="${k}">${n}</button>`).join('')}
            <span class="espaco"></span><button class="btn mini" data-recarregar="1">🔄 Atualizar</button></div>
          ${sujo ? `<div class="cz-sujo">● Mudanças no sources.json ainda não salvas <button class="btn mini principal" data-salvar="1">💾 Salvar e gerar o catálogo</button><button class="btn mini" data-desfazer="1">Desfazer</button></div>` : ''}
          <div class="cz-corpo">${E.aba === 'filtro' ? filtroHTML(d, rs) : E.aba === 'build' ? buildHTML() : E.aba === 'fontes' ? fontesHTML() : geralHTML()}</div>
        </div>`;
        ligar();
        vigiar();
    }
    function tokenHTML() {
        return `<div class="cz-token"><b>🔑 Token do GitHub para o Cloud</b> <span class="dica">${token() ? 'o token atual não tem acesso ao ' + esc(repoNome()) + ' — cole outro abaixo' : 'para salvar e gerar o catálogo pelo Studio, cole um token (fine-grained) com acesso ao repositório ' + esc(repoNome()) + ': <b>Contents</b> (ler e gravar) e <b>Actions</b> (ler e gravar)'}. Ler funciona sem token.</span>
          <div style="display:flex;gap:8px;margin-top:8px"><input class="campo" id="cz-token" type="password" placeholder="github_pat_…" style="flex:1"><button class="btn mini principal" data-token="1">Guardar</button>${S.guardar.ler(GUARDA_TOKEN) ? '<button class="btn mini" data-tirartoken="1">Tirar</button>' : ''}</div></div>`;
    }

    // ---------- 🛡 filtro
    function filtroHTML(d, rs) {
        const modo = d.modo || 'ativo';
        const sw = (k, on, rot, sub) => `<div class="cz-trava"><div><b>${rot}</b><i>${sub}</i></div><button class="cz-sw ${on ? 'on' : ''}" data-opcao="${k}" role="switch" aria-checked="${on}" aria-label="${esc(rot)}"></button></div>`;
        const fixa = (rot, sub) => `<div class="cz-trava">🛡 <div><b>${rot}</b><i>${sub}</i></div><span class="cz-cad">sempre ligada</span><span class="cz-sw lock"></span></div>`;
        return `<div class="cz-g2">
          <div class="cz-card"><div class="cz-rot">Modo do filtro</div>
            <div class="cz-modos">${[['desligado', '⏸ Desligado', 'Tudo aparece como vem das listas. Só as travas valem.'], ['analisar', '🔍 Analisar', 'Nada muda no app. Gera o relatório do que <u>seria</u> juntado.'], ['ativo', '✅ Ativo', 'As cópias viram 1 card, com os links de reserva.'], ['nenhum', '🧪 Teste', 'Nada junta, nem o mesmo TMDB: cada filme que chega vira um card. Para conferir se a soma bate.']]
                .map(([k, n, t]) => `<button class="cz-modo ${modo === k ? 'on ' + k : ''}" data-modo="${k}"><b>${n}</b><small>${t}</small></button>`).join('')}</div>
            ${modo === 'nenhum' ? '<p class="dica">🧪 <b>Modo teste:</b> o app vai mostrar filmes repetidos (é de propósito). Depois de conferir na 📊 Visão geral → 📥 Chegada, volte para Desligado ou Ativo.</p>' : ''}${modo === 'desligado' || modo === 'nenhum' ? '' : '<p class="dica">⚠ Saindo do <b>desligado</b>, os filmes com "(ano)" no nome passam a ser reconhecidos pelo ano e o id deles muda (o favorito desses títulos se perde uma vez). Melhor fazer isso logo.</p>'}
            <div class="cz-rot" style="margin-top:8px">Travas</div>
            ${fixa('TMDB diferente nunca junta', 'O Rei Leão 1994 × 2019')}
            ${fixa('Séries homônimas separadas', 'Doctor Who 1963 × 2005')}
            ${fixa('TMDB adivinhado só junta se o título bater', 'marca tmdbPorNome do Studio')}
            ${sw('travaCapa', d.travaCapa !== false, '🖼 Trava da capa', 'capas diferentes = filmes diferentes')}
            ${sw('tituloLimpo', d.tituloLimpo !== false, '✨ Título limpo', '"Matrix 1080p DUB" acha "Matrix" (só analisar/ativo)')}
            ${sw('anoNoTitulo', d.anoNoTitulo !== false, '📅 "(ano)" no título', '"Filme (2017)" = Filme de 2017')}
          </div>
          <div class="cz-card">${relatorioHTML(rs)}</div>
        </div>`;
    }
    function relatorioHTML(rs) {
        if (!E.resumo) return '<div class="cz-rot">Relatório</div><p class="dica">Ainda não há relatório (catalog/analise/resumo.json). Ele aparece depois da próxima geração do catálogo.</p>';
        const sep = rs.separados != null ? rs.separados : rs.separadosPelaTravaDaCapa;
        const juntos = rs.retirados != null ? rs.retirados : rs.seriamRetirados;
        const motivos = Object.entries(Object.assign({}, rs.porMotivo || {})).map(([k, n]) => `<span class="cz-chip v">${esc(k)} · ${num(n)}</span>`).join('') +
            Object.entries(rs.separadosPorMotivo || {}).map(([k, n]) => `<span class="cz-chip s">🛡 ${esc(k)} · ${num(n)}</span>`).join('');
        let lista = '';
        if (E.rel === 'separados') {
            if (!E.separados) lista = '<p class="dica">Carregando…</p>';
            else lista = filtrar(E.separados).slice(0, E.mostrar).map(x => par(x.titulo, x.ano ? x.ano : (x.tmdb ? [].concat(x.tmdb)[0] : ''), x.comoCard || x.titulo, x.tmdb ? [].concat(x.tmdb).slice(-1)[0] : '', 's', '🛡 ' + (x.motivo || 'capas diferentes'), (x.capas || [])[1], (x.capas || [])[0])).join('') || '<p class="dica">Nada separado.</p>';
        } else {
            if (!E.retirados) lista = '<p class="dica">Carregando a lista (pode ter alguns MB)…</p>';
            else lista = filtrar(E.retirados).slice(0, E.mostrar).map(x => { const j = x.juntadoEm || x.seriaJuntadoEm || {}; return par(x.titulo, [x.ano, x.origem].filter(Boolean).join(' · '), j.titulo, '', 'v', '✓ ' + (x.motivo || ''), x.capa, j.capa); }).join('') || '<p class="dica">Nada juntado.</p>';
        }
        const total = E.rel === 'separados' ? (E.separados || []).length : (E.retirados || []).length;
        return `<div class="cz-rot">Relatório da última geração <span class="dica" style="text-transform:none;letter-spacing:0">· ${haQuanto(rs.geradoEm)} · modo ${esc(rs.modo || '')}</span></div>
          <div class="cz-rel"><div><b style="color:var(--verde)">${num(juntos)}</b>${rs.modo === 'analisar' ? 'seriam juntados' : 'juntados'}</div><div><b style="color:var(--erro)">${num(sep)}</b>separados pelas travas</div><div><b>${num(rs.cardsDeFilmesNoApp)}</b>cards de filmes no app</div></div>
          <div class="cz-motivos">${motivos}</div>
          <div class="cz-relbar"><button class="${E.rel === 'separados' ? 'on' : ''}" data-rel="separados">🛡 Separados</button><button class="${E.rel === 'juntados' ? 'on' : ''}" data-rel="juntados">✓ ${rs.modo === 'analisar' ? 'Seriam juntados' : 'Juntados'}</button>
            <input class="campo" id="cz-busca" placeholder="🔎 buscar título" value="${esc(E.busca)}"></div>
          <div class="cz-pares">${lista}</div>
          ${total > E.mostrar && filtrar(E.rel === 'separados' ? E.separados || [] : E.retirados || []).length > E.mostrar ? '<button class="btn mini" data-mais="1">Mostrar mais</button>' : ''}`;
    }
    const filtrar = (l) => { const b = E.busca.trim().toLowerCase(); return b ? l.filter(x => String(x.titulo || '').toLowerCase().includes(b) || String(x.comoCard || (x.juntadoEm || x.seriaJuntadoEm || {}).titulo || '').toLowerCase().includes(b)) : l; };
    const capa = (u, ic) => `<div class="cz-pst">${u ? `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ic}</div>`;
    const par = (t1, s1, t2, s2, cls, tag, c1, c2) => `<div class="cz-par">${capa(c1, '🎬')}<div class="t"><b>${esc(t1)}</b><small>${esc(s1 || '')}</small></div><span class="cz-seta">${cls === 's' ? '✕' : '→'}</span>${capa(c2, '🎬')}<div class="t"><b>${esc(t2 || '')}</b><small>${esc(s2 || '')}</small></div><span class="cz-tag ${cls}">${esc(tag)}</span></div>`;

    // ---------- ▶ build
    function buildHTML() {
        const runs = E.runs || [], rod = runs.find(r => r.status !== 'completed'), ult = runs[0];
        const passos = (E.jobs || []).flatMap(j => j.steps || []).filter(s => !/^(Set up job|Post |Complete job)/.test(s.name));
        const ic = (s) => s.status === 'completed' ? (s.conclusion === 'success' ? '✓' : s.conclusion === 'skipped' ? '–' : '✕') : s.status === 'in_progress' ? '⟳' : '○';
        const feitos = passos.filter(s => s.status === 'completed').length, pct = passos.length ? Math.round(feitos / passos.length * 100) : 0;
        const max = Math.max(1, ...runs.map(r => (new Date(r.updated_at) - new Date(r.run_started_at || r.created_at)) / 1000));
        return `<div class="cz-g2"><div class="cz-card">
            <div class="cz-rot">▶ Build do catálogo</div>
            <div class="cz-build">${rod ? `<div class="cz-ring" style="--p:${pct}"><span>${pct}%</span></div><div><h3>Gerando o catálogo…</h3><small>${esc(rod.event === 'workflow_dispatch' ? 'pelo botão' : rod.event === 'push' ? 'por uma mudança no sources.json' : 'pela agenda (a cada 6 h)')} · ${dur(rod.run_started_at || rod.created_at)} · Run #${rod.run_number}</small></div>`
                : `<div class="cz-ring" style="--p:100"><span>${ult ? (ult.conclusion === 'success' ? '✓' : '✕') : '—'}</span></div><div><h3>${ult ? (ult.conclusion === 'success' ? 'Pronto' : 'Último build com erro') : 'Nenhum build ainda'}</h3><small>${ult ? haQuanto(ult.updated_at) + ' · ' + dur(ult.run_started_at || ult.created_at, ult.updated_at) + ' · Run #' + ult.run_number : ''}</small></div>`}
              <button class="btn principal" data-gerar="1" style="margin-left:auto" ${rod ? 'disabled' : ''}>▶ Gerar agora</button></div>
            <div class="cz-opts"><label><input type="checkbox" id="cz-forcar"> publicar mesmo se o catálogo encolher mais de 50% <span class="dica">(quando tirar listas de propósito)</span></label>
              <label><input type="checkbox" id="cz-validar"> retestar TODOS os links agora</label></div>
            ${rod && passos.length ? `<div class="cz-passos">${passos.map(s => `<div class="${s.status === 'completed' ? (s.conclusion === 'success' ? 'ok' : 'ruim') : s.status === 'in_progress' ? 'run' : 'wait'}"><i>${ic(s)}</i>${esc(s.name)}${s.started_at && s.completed_at ? ` <small>· ${dur(s.started_at, s.completed_at)}</small>` : ''}</div>`).join('')}</div>` : ''}
            ${E.runsErro ? `<p class="dica" style="color:var(--amarelo)">⚠ ${esc(E.runsErro)}</p>` : ''}
          </div>
          <div class="cz-card"><div class="cz-rot">Últimas gerações</div>
            <div class="cz-hist">${runs.slice().reverse().map(r => { const s = (new Date(r.updated_at) - new Date(r.run_started_at || r.created_at)) / 1000; return `<a href="${esc(r.html_url)}" target="_blank" rel="noopener" class="${r.status !== 'completed' ? 'now' : r.conclusion === 'success' ? '' : 'f'}" style="height:${Math.max(12, Math.round(s / max * 100))}%" title="#${r.run_number} · ${esc(r.conclusion || r.status)} · ${dur(r.run_started_at || r.created_at, r.updated_at)} · ${new Date(r.created_at).toLocaleString('pt-BR')}"></a>`; }).join('')}</div>
            <table class="cz-tab"><tr><th>Run</th><th>Quando</th><th>Como</th><th>Tempo</th><th>Resultado</th></tr>${runs.slice(0, 8).map(r => `<tr><td><a href="${esc(r.html_url)}" target="_blank" rel="noopener">#${r.run_number}</a></td><td>${new Date(r.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>${esc({ workflow_dispatch: 'botão', push: 'sources.json', schedule: 'agenda' }[r.event] || r.event)}</td><td>${dur(r.run_started_at || r.created_at, r.updated_at)}</td><td class="${r.status !== 'completed' ? '' : r.conclusion === 'success' ? 'ok' : 'ruim'}">${r.status !== 'completed' ? '⟳ rodando' : r.conclusion === 'success' ? '✓ ok' : '✕ ' + esc(r.conclusion)}</td></tr>`).join('')}</table>
          </div></div>`;
    }

    // ---------- 📡 fontes
    function contagem(nome) {
        const fs = ((E.manifest || {}).fontes || []).filter(x => x.nome === nome);
        if (!fs.length) return null;
        return { itens: fs.reduce((t, x) => t + (x.itens || 0), 0), erros: fs.filter(x => !x.ok).map(x => (x.parte ? x.parte + ': ' : '') + (x.erro || 'erro')) };
    }
    function fontesHTML() {
        if (!E.cfg) return '<p class="dica">Não consegui ler o sources.json.</p>';
        const linha = ({ f, i, lista }) => {
            const c = contagem(f.nome), on = f.ativo !== false;
            const cor = !on ? 'var(--suave)' : c && c.erros.length ? (c.itens ? 'var(--amarelo)' : 'var(--erro)') : c ? 'var(--verde)' : '#64748b';
            return `<div class="cz-fonte ${on ? '' : 'off'}"><span class="cz-dot" style="background:${cor}"></span>
              <div class="n"><b>${esc(f.nome || '(sem nome)')}</b><small>${esc([lista === 'fontesDoStudio' ? 'Studio' : f.tipo, f.destino, f.targetCategory, f.pais ? 'país ' + f.pais : '', f.idioma ? 'idioma ' + f.idioma : ''].filter(Boolean).join(' · '))}${c && c.erros.length ? ` · <span style="color:var(--amarelo)">${esc(c.erros.join(' · '))}</span>` : ''}${!on ? ' · desligada' : ''}</small></div>
              <span class="c">${c ? num(c.itens) : '—'}</span>
              <button class="btn mini fantasma" data-editar="${lista}:${i}" title="Editar">✎</button>
              <button class="cz-sw ${on ? 'on' : ''}" data-ligar="${lista}:${i}" role="switch" aria-checked="${on}" aria-label="Ligar ${esc(f.nome)}"></button></div>`;
        };
        const todas = fontesTodas(), b = E.busca.trim().toLowerCase();
        const vis = b ? todas.filter(x => JSON.stringify(x.f).toLowerCase().includes(b)) : todas;
        return `<div class="cz-card">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><div class="cz-rot" style="margin:0">📡 Fontes (${todas.length})</div><input class="campo" id="cz-busca" placeholder="🔎 buscar fonte" value="${esc(E.busca)}" style="max-width:260px;margin-left:auto"><button class="btn mini principal" data-nova="1">+ Nova fonte</button></div>
          <p class="dica">Os números são os itens que cada fonte trouxe na última geração. Desligar tira a fonte do catálogo na próxima geração (ela fica guardada).</p>
          ${vis.map(linha).join('')}
        </div>${E.editando ? editorHTML() : ''}`;
    }
    const TIPOS = ['vod_json', 'vod_m3u', 'm3u', 'json', 'tvzine_worker', 'radio', 'jogos', 'markdown'];
    function editorHTML() {
        const { lista, i } = E.editando, f = i < 0 ? {} : E.cfg[lista][i];
        const v = (k) => f[k] == null ? '' : Array.isArray(f[k]) ? f[k].join('\n') : f[k];
        const tipos = [...new Set(TIPOS.concat((E.cfg.fontes || []).map(x => x.tipo).filter(Boolean)))];
        return `<div class="cz-ed-fundo"><div class="cz-ed" role="dialog" aria-modal="true">
          <h3>${i < 0 ? '+ Nova fonte' : '✎ ' + esc(f.nome)}</h3>
          <div class="cz-ed-g">
            <label>Nome<input class="campo" data-ed="nome" value="${esc(v('nome'))}"></label>
            ${lista === 'fontes' ? `<label>Tipo<select class="campo" data-ed="tipo">${tipos.map(t => `<option ${t === f.tipo ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : '<span></span>'}
            <label class="cheio">Link(s) <small class="dica">um por linha</small><textarea class="campo" data-ed="url" rows="3" spellcheck="false">${esc(v('url'))}</textarea></label>
            ${lista === 'fontes' ? `<label>Categoria no app<input class="campo" data-ed="targetCategory" value="${esc(v('targetCategory'))}" placeholder="Filmes, Séries…"></label>
            <label>Destino<input class="campo" data-ed="destino" value="${esc(v('destino'))}" placeholder="videos, iptv, filmes, series…"></label>
            <label>Prefixo dos ids<input class="campo" data-ed="prefixoId" value="${esc(v('prefixoId'))}" placeholder="ex.: VOD_XYZ"></label>
            <label>País / idioma<span style="display:flex;gap:6px"><input class="campo" data-ed="pais" value="${esc(v('pais'))}" placeholder="br"><input class="campo" data-ed="idioma" value="${esc(v('idioma'))}" placeholder="pt-BR"></span></label>` : ''}
          </div>
          <details><summary class="dica">JSON completo (avançado)</summary><textarea class="campo" id="cz-ed-json" rows="10" spellcheck="false" style="width:100%;font-family:monospace;font-size:12px">${esc(JSON.stringify(f, null, 2))}</textarea><p class="dica">Se mexer aqui, é este JSON que vale.</p></details>
          ${i >= 0 ? '<p class="dica">⚠ Trocar o <b>prefixo dos ids</b> muda o id dos itens desta fonte (favoritos dela se perdem).</p>' : ''}
          <div class="cz-ed-bt">${i >= 0 ? '<button class="btn mini perigo" data-ed-apagar="1">Apagar fonte</button>' : ''}<span class="espaco"></span><button class="btn mini" data-ed-cancelar="1">Cancelar</button><button class="btn mini principal" data-ed-ok="1">OK</button></div>
          <p class="dica">O OK guarda na lista; para ir para o Cloud, use 💾 Salvar e gerar o catálogo.</p>
        </div></div>`;
    }
    function lerEditor() {
        const { lista, i } = E.editando, antes = i < 0 ? {} : E.cfg[lista][i];
        const jsonEl = $('#cz-ed-json');
        if (jsonEl && jsonEl.value.trim() !== JSON.stringify(antes, null, 2)) return JSON.parse(jsonEl.value);
        const f = Object.assign({}, antes);
        area.querySelectorAll('[data-ed]').forEach(el => {
            const k = el.dataset.ed, x = el.value.trim();
            if (k === 'url') { const us = x.split(/\s*\n\s*/).filter(Boolean); if (us.length > 1) f.url = us; else if (us.length) f.url = us[0]; else delete f.url; return; }
            if (x) f[k] = x; else delete f[k];
        });
        return f;
    }

    // ---------- 📥 chegada por categoria: o que entrou de cada fonte × o que virou card (e a conferência com o Sidechain)
    function chegadaHTML() {
        const m = E.manifest || {}, fontes = m.fontes || [], cfgF = ((E.cfg && (E.cfg.fontes || E.cfg.sources)) || []);
        const scPorNome = new Map((E.scFontes || []).map(f => [f.nome, f]));
        const catDe = (f) => f.categoria || (scPorNome.get(f.nome) || {}).targetCategory || (cfgF.find(x => x.nome === f.nome) || {}).targetCategory || '';
        const ehSC = (f) => scPorNome.has(f.nome) || / · Sidechain/.test(f.nome);
        const cats = (m.categories || []).filter(c => c.type === 'vod' || c.type === 'series');
        // o que o Sidechain mandou (balanço da rodada): por categoria do Cloud
        const fx = E.scFluxo, scNoApp = {};
        if (fx && fx.saidas) for (const s of fx.saidas) { const f = (E.scFontes || []).find(x => String(x.url || '').endsWith('/' + s.chave + '.json')); if (f) scNoApp[f.targetCategory] = (scNoApp[f.targetCategory] || 0) + (s.noApp || 0); }
        const soma = (fs, k) => fs.reduce((t, f) => t + (f[k] || 0), 0);
        const temTipos = fontes.some(f => f.recebidos != null);
        const linhas = cats.map(c => {
            const fs = fontes.filter(f => catDe(f) === c.nome && f.ok), fsc = fs.filter(ehSC), fout = fs.filter(f => !ehSC(f));
            const env = scNoApp[c.nome], scChegou = temTipos ? soma(fsc, 'recebidos') : soma(fsc, 'itens');
            const conf = env == null ? '<small class="dica">—</small>' : env === scChegou ? '<span class="ok">✅ bate</span>' : `<span class="ruim" title="o Sidechain publicou ${num(env)}; chegaram ${num(scChegou)}">⚠ ${num(scChegou - env)}</span>`;
            const cd = c.cards || null;
            const filmesCh = temTipos ? soma(fs, 'filmes') : null, epsCh = temTipos ? soma(fs, 'episodios') : null;
            return `<tr><td><b>${esc(c.nome)}</b>${fout.length ? `<small class="dica">+ ${fout.map(f => esc(f.nome)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</small>` : ''}</td>
              <td>${filmesCh == null ? '—' : num(filmesCh)}</td><td><b>${cd ? num(cd.filmes) : num(c.total)}</b>${cd && filmesCh != null && filmesCh > cd.filmes ? `<small class="dica">${num(filmesCh - cd.filmes)} viraram reserva</small>` : ''}</td>
              <td>${epsCh == null ? '—' : num(epsCh)}</td><td>${cd ? `<b>${num(cd.series)}</b> séries<small class="dica">${num(cd.episodios)} episódios</small>` : '—'}</td>
              <td>${num(scChegou)}${env != null ? `<small class="dica">publicou ${num(env)}</small>` : ''}</td><td>${conf}</td></tr>`;
        }).join('');
        const rs = E.resumo || {};
        return `<div class="cz-rot">📥 Chegada por categoria</div>
          <table class="cz-tab"><tr><th>Categoria</th><th>🎬 Filmes chegaram</th><th>🎬 Cards de filme</th><th>🎞 Episódios chegaram</th><th>🎞 Séries no app</th><th>🔗 Do Sidechain</th><th>Conferência</th></tr>${linhas || '<tr><td colspan="7" class="dica">Nenhuma categoria de filmes/séries.</td></tr>'}</table>${temTipos ? '' : '<p class="dica">⏳ A separação filmes × episódios aparece depois da próxima geração do catálogo (precisa do PR do Cloud).</p>'}
          <p class="dica"><b>Filmes</b> se comparam com <b>cards de filme</b> (a diferença virou link reserva: mesmo filme de duas fontes). <b>Episódios</b> se comparam com os <b>episódios das séries</b> no app (cada série é 1 card). <b>Do Sidechain</b> × <b>publicou</b> (o "📱 No app" do 📊 Fluxo): ✅ bate = nada se perdeu no caminho${rs.modo ? ` (filtro: <b>${esc(rs.modo)}</b>${rs.cardsDeFilmesNoApp != null ? ` · filmes: ${num(rs.filmesNasFontes)} chegaram → ${num(rs.cardsDeFilmesNoApp)} cards` : ''})` : ''}. Nas séries, o card é a série e as fontes contam episódios. Para conferir os filmes 1 a 1, use o modo <b>🧪 Teste</b> no 🛡 Filtro: aí os cards de filmes ≈ o total que chegou.</p>`;
    }

    // ---------- 📊 visão geral
    function geralHTML() {
        const m = E.manifest || {}, t = m.totals || {}, pt = t.porTipo || {};
        const erros = ((m.fontes || []).filter(x => !x.ok));
        return `<div class="cz-g2"><div class="cz-card"><div class="cz-rot">📊 Catálogo</div>
            <div class="cz-rel"><div><b>${num(t.itens)}</b>itens</div><div><b>${num(t.series)}</b>séries</div><div><b>${num(t.categorias)}</b>categorias</div></div>
            <div class="cz-rel"><div><b>${num(pt.vod)}</b>filmes</div><div><b>${num(pt.episode)}</b>episódios</div><div><b>${num(pt.live)}</b>canais</div><div><b>${num(pt.game)}</b>jogos</div></div>
            <p class="dica">Gerado ${m.generatedAt ? new Date(m.generatedAt).toLocaleString('pt-BR') : '—'} · versão ${esc(m.version || '—')}${m.validacao ? ' · validação de links ' + haQuanto(m.validacao.em) : ''}</p>
            <div class="cz-rot" style="margin-top:12px">⚠ Fontes com erro na última geração (${erros.length})</div>
            ${erros.length ? `<table class="cz-tab">${erros.map(x => `<tr><td><b>${esc(x.nome)}</b>${x.parte ? ' <small class="dica">parte ' + esc(x.parte) + '</small>' : ''}</td><td class="ruim">${esc(x.erro || 'erro')}</td></tr>`).join('')}</table>` : '<p class="dica">Nenhuma 🎉</p>'}
          </div>
          <div class="cz-card" style="grid-column:1/-1">${chegadaHTML()}</div>
          <div class="cz-card"><div class="cz-rot">Categorias do app</div>
            <table class="cz-tab"><tr><th>Categoria</th><th>Tipo</th><th>Onde</th><th>Itens</th></tr>${(m.categories || []).map(c => `<tr><td><b>${esc(c.nome)}</b></td><td>${esc(c.type)}</td><td>${esc(c.destino || '')}</td><td>${num(c.total)}</td></tr>`).join('')}</table>
          </div></div>`;
    }

    // ------------------------------------------------------------ cliques
    function ligar() {
        area.onclick = async (ev) => {
            const b = ev.target.closest('button'); if (!b) return;
            if (b.dataset.aba) { E.aba = b.dataset.aba; E.busca = ''; E.mostrar = 40; if (E.aba === 'filtro' && !E.separados) { pintar(); await carregarRel(); } return pintar(); }
            if (b.dataset.recarregar) { b.disabled = true; await carregar(true); if (E.rel === 'juntados') E.retirados = null; await carregarRel(); return pintar(); }
            if (b.dataset.token) { const v = $('#cz-token').value.trim(); if (!v) return; S.guardar.gravar(GUARDA_TOKEN, { token: v }); E.pedirToken = false; await carregar(true); return pintar(); }
            if (b.dataset.tirartoken) { S.guardar.apagar(GUARDA_TOKEN); await carregar(true); return pintar(); }
            if (b.dataset.modo) { E.cfg.deduplicacao = Object.assign({}, E.cfg.deduplicacao, { modo: b.dataset.modo }); return pintar(); }
            if (b.dataset.opcao) { const d = E.cfg.deduplicacao = Object.assign({}, E.cfg.deduplicacao); d[b.dataset.opcao] = d[b.dataset.opcao] === false; return pintar(); }
            if (b.dataset.rel) { E.rel = b.dataset.rel; E.mostrar = 40; pintar(); await carregarRel(); return pintar(); }
            if (b.dataset.mais) { E.mostrar += 60; return pintar(); }
            if (b.dataset.desfazer) { E.cfg = JSON.parse(E.cfgOrig); return pintar(); }
            if (b.dataset.salvar) {
                b.disabled = true; b.textContent = 'Salvando…';
                try { await gravarSources('CZ Cloud (pelo Studio): ' + resumoMudancas()); S.aviso('☁️ Salvo no Cloud. O catálogo começa a ser gerado em instantes (aba ▶ Build).', 'ok'); await carregarRuns(); setTimeout(async () => { await carregarRuns(); pintar(); }, 6000); }
                catch (e) { S.aviso('Não deu para salvar: ' + e.message, 'ruim'); if (e.status === 401 || e.status === 403 || e.status === 404 || /token/.test(e.message)) E.pedirToken = true; }
                return pintar();
            }
            if (b.dataset.gerar) {
                if (!token()) { E.pedirToken = true; S.aviso('Para gerar pelo Studio, cole um token com acesso ao Cloud.', 'ruim'); return pintar(); }
                b.disabled = true; b.textContent = 'Pedindo…';
                try {
                    await gh(`/actions/workflows/${WF}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { forcar: !!($('#cz-forcar') || {}).checked, validar_tudo: !!($('#cz-validar') || {}).checked } }) });
                    S.aviso('▶ Pedido enviado: o build começa em alguns segundos.', 'ok');
                    setTimeout(async () => { await carregarRuns(); pintar(); }, 5000);
                } catch (e) { S.aviso('Não deu para gerar: ' + e.message + (e.status === 403 ? ' — o token precisa da permissão Actions (ler e gravar)' : ''), 'ruim'); if (e.status === 401 || e.status === 403) E.pedirToken = true; }
                return pintar();
            }
            if (b.dataset.ligar) { const [l, i] = b.dataset.ligar.split(':'); const f = E.cfg[l][+i]; if (f.ativo === false) delete f.ativo; else f.ativo = false; return pintar(); }
            if (b.dataset.editar) { const [lista, i] = b.dataset.editar.split(':'); E.editando = { lista, i: +i }; return pintar(); }
            if (b.dataset.nova) { E.editando = { lista: 'fontes', i: -1 }; return pintar(); }
            if (b.dataset.edCancelar) { E.editando = null; return pintar(); }
            if (b.dataset.edApagar) { const { lista, i } = E.editando; if (!confirm('Apagar a fonte "' + E.cfg[lista][i].nome + '"? (Se só quer tirar do app por um tempo, use a chave de ligar/desligar.)')) return; E.cfg[lista].splice(i, 1); E.editando = null; return pintar(); }
            if (b.dataset.edOk) {
                let f; try { f = lerEditor(); } catch (e) { return S.aviso('JSON inválido: ' + e.message, 'ruim'); }
                if (!f.nome || !f.url) return S.aviso('A fonte precisa de nome e de link.', 'ruim');
                const { lista, i } = E.editando;
                if (i < 0) E.cfg[lista].push(f); else E.cfg[lista][i] = f;
                E.editando = null; return pintar();
            }
        };
        area.oninput = (ev) => {
            if (ev.target.id === 'cz-busca') { E.busca = ev.target.value; clearTimeout(E.tb); E.tb = setTimeout(() => { pintar(); const x = $('#cz-busca'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 250); }
        };
    }
    async function carregarRel() {
        try {
            if (E.rel === 'separados' && !E.separados) E.separados = JSON.parse(await lerTexto('catalog/analise/separados-pela-capa.json'));
            if (E.rel === 'juntados' && !E.retirados) E.retirados = JSON.parse(await lerTexto('catalog/analise/filmes-retirados.json'));
        } catch (e) { if (E.rel === 'separados') E.separados = []; else E.retirados = []; }
    }
    function resumoMudancas() {
        const a = JSON.parse(E.cfgOrig), b = E.cfg, ms = [];
        if (JSON.stringify(a.deduplicacao) !== JSON.stringify(b.deduplicacao)) ms.push('filtro de cópias (modo ' + ((b.deduplicacao || {}).modo || '') + ')');
        for (const l of ['fontes', 'fontesDoStudio']) {
            const an = new Map((a[l] || []).map(f => [f.nome, f])), bn = new Map((b[l] || []).map(f => [f.nome, f]));
            for (const [n, f] of bn) { const o = an.get(n); if (!o) ms.push('+ ' + n); else if (JSON.stringify(o) !== JSON.stringify(f)) ms.push((o.ativo !== false && f.ativo === false ? 'desliga ' : o.ativo === false && f.ativo !== false ? 'liga ' : 'edita ') + n); }
            for (const n of an.keys()) if (!bn.has(n)) ms.push('− ' + n);
        }
        return ms.join(', ').slice(0, 200) || 'sources.json';
    }

    window.CZCloud = { desenhar: async (a, s) => { await desenhar(a, s); if (E.aba === 'filtro') { await carregarRel(); pintar(); } }, parar: () => clearTimeout(E.poll) };
})();
