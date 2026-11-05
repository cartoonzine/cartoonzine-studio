/**
 * 🧩 Prateleira de jogos — tela da Studio para o repositório cartoonzine-jogos.
 * Parte 1: cole o link do GitHub de um jogo livre → "Analisar" → confira → "Adicionar"
 * (um commit só: a ficha no jogos.json + a receita receitas/<id>.sh).
 * A lógica fica em core/prateleira-core.js (testada em test/prateleira.test.mjs).
 */
(function () {
    'use strict';
    const P = window.CZPrateleiraCore;
    const REPO_JOGOS = 'cartoonzine/cartoonzine-jogos';
    const CHAVE_TOKEN = 'czs-jogos-token';
    const $ = (s, r = document) => r.querySelector(s);
    const pr = { analise: null, jogos: null, link: '' };

    function tokenAtual(S) {
        const proprio = S.guardar.ler(CHAVE_TOKEN);
        if (proprio) return proprio;
        const gh = S.guardar.ler('czs-github');
        return gh && gh.token ? gh.token : '';
    }

    async function lerJson(repo, rota) { return (await repo.api(rota, { cache: 'no-store' })).json(); }
    async function lerCru(repo, rota) {
        try { return await (await repo.api(rota, { headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' })).text(); }
        catch (e) { return ''; }
    }

    /** Busca no GitHub tudo que a análise precisa (4 a 8 chamadas). */
    async function analisar(S, link, token) {
        const alvo = P.repoDoLink(link);
        if (!alvo) throw new Error('Isso não parece um link do GitHub (ex.: https://github.com/dono/jogo).');
        const repo = new S.RepoGitHub({ repo: alvo.dono + '/' + alvo.repo, token });
        const info = await lerJson(repo, '');
        const branches = (await lerJson(repo, '/branches?per_page=100').catch(() => [])).map(b => b.name);
        const branch = alvo.branch || branches.find(b => /^(emscripten|web|wasm|html5|browser)$/i.test(b)) || info.default_branch;
        const arvore = await lerJson(repo, '/git/trees/' + encodeURIComponent(branch) + '?recursive=1').catch(() => ({ tree: [] }));
        const caminhos = (arvore.tree || []).filter(t => t.type === 'blob').map(t => t.path);
        const deBuild = ['CMakeLists.txt', 'Makefile', 'makefile', 'GNUmakefile', 'configure.ac', 'configure.in', 'meson.build'].filter(c => caminhos.includes(c));
        const textos = [await lerCru(repo, '/readme?ref=' + encodeURIComponent(branch))];
        for (const c of deBuild) textos.push(await lerCru(repo, '/contents/' + c + '?ref=' + encodeURIComponent(branch)));
        const a = P.analisarRepo({ info, caminhos, textos: textos.join('\n').slice(0, 400000), branches, link });
        if (alvo.branch) { a.branchWeb = alvo.branch; a.temWeb = a.temWeb || /emscripten|web|wasm|html5|browser/i.test(alvo.branch); }
        return a;
    }

    async function lerPrateleira(S, token) {
        const jogos = new S.RepoGitHub({ repo: REPO_JOGOS, branch: 'main', token });
        const texto = await jogos.lerTexto('jogos.json');
        return { repo: jogos, texto, lista: JSON.parse(texto).jogos || [] };
    }

    function desenhar(area, S) {
        const esc = S.esc;
        const token = tokenAtual(S);
        area.innerHTML = `
          <div id="pr-raiz">
            <div class="cab">
              <div>
                <h1>🧩 Prateleira de jogos</h1>
                <div class="sub">Repositório <b>${esc(REPO_JOGOS)}</b> · jogos livres compilados do código-fonte para a web</div>
              </div>
            </div>
            <section class="painel">
              <label class="rot" for="pr-link">Link do jogo no GitHub</label>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <input class="campo" id="pr-link" style="flex:1;min-width:240px" placeholder="https://github.com/dono/jogo" value="${esc(pr.link)}">
                <button class="btn principal" id="pr-analisar">Analisar</button>
              </div>
              <div class="dica">Pode ser o projeto original ou um "fork" que já roda na web (ex.: um link com <code>/tree/emscripten</code>).</div>
              <details style="margin-top:12px" ${token ? '' : 'open'}>
                <summary class="dica" style="cursor:pointer">🔑 Token do GitHub ${token ? '(ok)' : '(falta)'}</summary>
                <div class="dica" style="margin:8px 0">Precisa ter acesso ao <b>${esc(REPO_JOGOS)}</b> com permissão <b>Contents: Read and write</b>.
                  Se o token da Studio já tem esse acesso, deixe em branco. Fica só neste navegador.</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap">
                  <input class="campo" id="pr-token" type="password" style="flex:1;min-width:200px" placeholder="${S.guardar.ler(CHAVE_TOKEN) ? 'token próprio salvo' : 'github_pat_…'}" autocomplete="off">
                  <button class="btn fantasma" id="pr-token-ok">Salvar token</button>
                </div>
              </details>
            </section>
            <div id="pr-res"></div>
            <section class="painel" style="margin-top:16px">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <b style="font-size:16px">📋 Fila da prateleira</b>
                <span class="dica" id="pr-fila-info"></span>
                <div class="espaco" style="flex:1"></div>
                <button class="btn fantasma mini" id="pr-fila-atualizar">↻ Atualizar</button>
              </div>
              <div id="pr-fila" style="margin-top:12px"></div>
            </section>
          </div>`;
        $('#pr-token-ok').onclick = () => {
            const v = $('#pr-token').value.trim();
            if (v) S.guardar.gravar(CHAVE_TOKEN, v); else S.guardar.apagar(CHAVE_TOKEN);
            pr.jogos = null;
            S.aviso(v ? 'Token da Prateleira salvo neste navegador.' : 'Token próprio apagado: vou usar o da Studio.', 'ok');
            desenhar(area, S);
        };
        const ir = async () => {
            const b = $('#pr-analisar');
            pr.link = $('#pr-link').value.trim();
            const tk = tokenAtual(S);
            if (!tk) { S.aviso('Falta o token do GitHub (abra "🔑 Token do GitHub").', 'ruim'); return; }
            b.disabled = true; b.textContent = 'Analisando…';
            $('#pr-res').innerHTML = '<p class="carregando">Lendo o repositório no GitHub…</p>';
            try {
                const [a, jogos] = await Promise.all([analisar(S, pr.link, tk), pr.jogos ? Promise.resolve(pr.jogos) : lerPrateleira(S, tk)]);
                pr.analise = a; pr.jogos = jogos;
                desenharResultado(S);
            } catch (e) {
                $('#pr-res').innerHTML = `<section class="painel" style="margin-top:16px;border-color:rgba(255,84,112,.45)">❌ ${esc(e.message)}
                  ${e.status === 404 || e.status === 403 ? '<div class="dica">Se o jogo existe, pode ser que o token não tenha acesso ao <b>' + esc(REPO_JOGOS) + '</b>.</div>' : ''}</section>`;
            }
            b.disabled = false; b.textContent = 'Analisar';
        };
        $('#pr-analisar').onclick = ir;
        $('#pr-link').addEventListener('keydown', ev => { if (ev.key === 'Enter') ir(); });
        if (pr.analise) desenharResultado(S);
        $('#pr-fila-atualizar').onclick = () => { pr.fila = null; carregarFila(S); };
        if (token) { if (pr.fila) desenharFila(S); else carregarFila(S); }
        else $('#pr-fila').innerHTML = '<p class="dica">Salve o token do GitHub para ver a fila.</p>';
    }

    function selo(texto, bom) {
        return `<span class="chip" style="${bom === true ? 'color:var(--verde);border-color:rgba(46,230,166,.4)' : bom === false ? 'color:var(--erro);border-color:rgba(255,84,112,.45)' : ''}">${texto}</span>`;
    }

    function desenharResultado(S) {
        const esc = S.esc, a = pr.analise;
        const dup = P.jaExiste(pr.jogos.lista, a);
        const tipoTxt = { cmake: 'CMake', make: 'Makefile', autotools: 'Autotools (configure)', meson: 'Meson', visualstudio: 'Visual Studio', desconhecido: 'não reconhecido' }[a.tipo];
        $('#pr-res').innerHTML = `
          <section class="painel" style="margin-top:16px">
            <div style="display:grid;grid-template-columns:minmax(0,260px) 1fr;gap:18px;align-items:start" class="pr-topo">
              <div style="aspect-ratio:2/1;border-radius:10px;overflow:hidden;background:#111">${a.capa ? `<img src="${esc(a.capa)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">` : ''}</div>
              <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
                <b style="font-size:18px">${esc(a.nome)}</b>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  ${selo('Licença: ' + esc(a.licenca.spdx || a.licenca.nome), a.licenca.livre)}
                  ${selo('Build: ' + esc(tipoTxt), a.tipo === 'desconhecido' || a.tipo === 'visualstudio' ? false : null)}
                  ${a.sdl ? selo(esc(a.sdl.toUpperCase().replace('SDL', 'SDL ')), a.sdl === 'sdl2' ? true : null) : ''}
                  ${a.temWeb ? selo('Já tem versão web' + (a.branchWeb ? ' (' + esc(a.branchWeb) + ')' : ''), true) : ''}
                  ${selo(a.facil ? '👍 boa chance de compilar' : '🛠️ vai precisar de ajuste', a.facil)}
                  ${a.estrelas ? selo('⭐ ' + a.estrelas) : ''}
                </div>
                ${a.avisos.length ? `<ul class="dica" style="margin:4px 0 0;padding-left:18px">${a.avisos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
                ${dup ? `<div style="color:var(--amarelo)">⚠️ Já está na prateleira como <b>${esc(dup.nome || dup.id)}</b> (id <code>${esc(dup.id)}</code>).</div>` : ''}
              </div>
            </div>
          </section>
          ${dup ? '' : `
          <section class="painel" style="margin-top:16px">
            <div class="form">
              <div><label class="rot" for="pr-id">id (nome da pasta)</label><input class="campo" id="pr-id" value="${esc(a.id)}"></div>
              <div><label class="rot" for="pr-nome">Nome</label><input class="campo" id="pr-nome" value="${esc(a.nome)}"></div>
              <div><label class="rot" for="pr-ano">Ano</label><input class="campo" id="pr-ano" inputmode="numeric" value="${esc(a.ano || '')}"></div>
              <div><label class="rot" for="pr-lic">Licença</label><input class="campo" id="pr-lic" value="${esc(a.licenca.spdx || a.licenca.nome)}"></div>
              <div class="cheio"><label class="rot" for="pr-desc">Descrição</label><textarea class="campo" id="pr-desc" rows="2">${esc(a.descricao)}</textarea></div>
              <div><label class="rot" for="pr-gen">Gêneros (separe com vírgula)</label><input class="campo" id="pr-gen" placeholder="Plataforma, Tiro" value=""></div>
              <div><label class="rot" for="pr-ctrl">Controles</label>
                <select class="campo" id="pr-ctrl"><option value="teclado">teclado</option><option value="gamepad">gamepad</option><option value="mouse">mouse</option></select></div>
              <div class="cheio"><label class="rot" for="pr-teclas">Teclas do controle (opcional)</label><input class="campo" id="pr-teclas" placeholder="A=Space, B=Enter, START=Enter, SELECT=Escape"></div>
              <div class="cheio"><label class="rot" for="pr-receita">Receita (receitas/<span id="pr-rid">${esc(a.id)}</span>.sh)</label>
                <textarea class="campo" id="pr-receita" rows="10" spellcheck="false" style="font-family:'Share Tech Mono',monospace;font-size:12.5px">${esc(P.receitaAutomatica(a))}</textarea>
                <div class="dica">Feita automaticamente pelo tipo de projeto. Jogos com arquivos de dados ou dependências extras costumam precisar de ajuste.</div></div>
              <label class="cheio" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="pr-livres"> <span>Confirmo que <b>os gráficos, sons e fases também são livres</b> (não só o código). Nada de ROM nem arquivo de jogo comercial.</span></label>
              <label class="cheio" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="pr-compilar"> <span>Compilar já (sem isso entra como <b>rascunho</b>: fica na lista, mas o robô só compila quando você tirar o "rascunho")</span></label>
            </div>
            <div class="linha-acoes">
              <button class="btn principal" id="pr-add" disabled>Adicionar à prateleira</button>
              <span class="dica" id="pr-msg"></span>
            </div>
          </section>`}`;
        if (dup) return;
        const livres = $('#pr-livres'), add = $('#pr-add');
        livres.onchange = () => { add.disabled = !livres.checked; };
        $('#pr-id').oninput = e => { $('#pr-rid').textContent = P.idDoNome(e.target.value); };
        $('#pr-nome').onchange = e => {
            const r = $('#pr-receita');
            if (r.value === P.receitaAutomatica(a, { nome: r.dataset.nome || a.nome })) r.value = P.receitaAutomatica(a, { nome: e.target.value });
            r.dataset.nome = e.target.value;
        };
        add.onclick = () => adicionar(S);
    }

    async function adicionar(S) {
        const a = pr.analise, add = $('#pr-add'), msg = $('#pr-msg');
        const id = P.idDoNome($('#pr-id').value);
        const nome = $('#pr-nome').value.trim() || a.nome;
        const receita = $('#pr-receita').value.replace(/\r\n/g, '\n').trim() + '\n';
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { S.aviso('O id só pode ter letras minúsculas, números e "-".', 'ruim'); return; }
        const ano = parseInt($('#pr-ano').value, 10);
        const entrada = P.entradaJogo(a, {
            id, nome, ano: ano > 1970 && ano < 2100 ? ano : undefined, licenca: $('#pr-lic').value.trim(),
            descricao: $('#pr-desc').value.trim(), controles: $('#pr-ctrl').value, teclas: $('#pr-teclas').value.trim(),
            generos: $('#pr-gen').value.split(',').map(g => g.trim()).filter(Boolean), rascunho: !$('#pr-compilar').checked
        });
        add.disabled = true; msg.textContent = 'Salvando no GitHub…';
        try {
            const atual = await lerPrateleira(S, tokenAtual(S));        // relê na hora: alguém pode ter mudado
            if (P.jaExiste(atual.lista, { id, original: a.original })) throw new Error('Esse jogo (ou o id "' + id + '") já está na prateleira.');
            const novo = P.inserirNoJogosJson(atual.texto, entrada);
            await atual.repo.salvar([
                { caminho: 'jogos.json', conteudo: novo },
                { caminho: 'receitas/' + id + '.sh', conteudo: receita }
            ], (entrada.rascunho ? 'Prateleira: rascunho — ' : 'Prateleira: novo jogo — ') + nome);
            pr.jogos = null; pr.analise = null; pr.link = ''; pr.fila = null;
            carregarFila(S);
            $('#pr-res').innerHTML = `<section class="painel" style="margin-top:16px;border-color:rgba(46,230,166,.45)">✅ <b>${S.esc(nome)}</b> entrou na prateleira${entrada.rascunho ? ' como <b>rascunho</b>' : ''}.
              <div class="dica" style="margin-top:6px">${entrada.rascunho
                ? 'Quando quiser compilar: tire o <code>"rascunho": true</code> dele no jogos.json (ou adicione de novo marcando "Compilar já").'
                : 'O robô "construir" começa sozinho e o jogo aparece em uns minutos em'} ${entrada.rascunho ? '' : `<a href="https://cartoonzine.github.io/cartoonzine-jogos/${S.esc(id)}/" target="_blank" rel="noopener">cartoonzine.github.io/cartoonzine-jogos/${S.esc(id)}/</a>.
                Acompanhe em <a href="https://github.com/${REPO_JOGOS}/actions" target="_blank" rel="noopener">Actions</a>.`}</div></section>`;
            $('#pr-link').value = '';
            S.aviso('Jogo adicionado ao cartoonzine-jogos.', 'ok');
        } catch (e) {
            add.disabled = false; msg.textContent = '';
            S.aviso('Não consegui salvar: ' + e.message, 'ruim');
        }
    }

    // ------------------------------------------------------------------ Parte 2: fila
    const ROTULO = {
        rascunho: ['📝 Rascunho', ''], aguardando: ['⏳ Esperando o robô', 'var(--amarelo)'], compilando: ['⚙️ Compilando…', 'var(--amarelo)'],
        falhou: ['❌ Falhou', 'var(--erro)'], pronto: ['✅ No ar', 'var(--verde)']
    };

    async function carregarFila(S) {
        const caixa = $('#pr-fila'); if (!caixa) return;
        const tk = tokenAtual(S);
        caixa.innerHTML = '<p class="carregando">Lendo a prateleira…</p>';
        try {
            const jogos = await lerPrateleira(S, tk);
            const repo = jogos.repo;
            const [pastas, capas, runs] = await Promise.all([
                lerJson(repo, '/git/trees/gh-pages').then(r => (r.tree || []).filter(t => t.type === 'tree').map(t => t.path)).catch(() => []),
                lerJson(repo, '/contents/capas?ref=gh-pages').then(r => r.map(x => x.name)).catch(() => []),
                lerJson(repo, '/actions/workflows/construir.yml/runs?per_page=1').catch(() => null)
            ]);
            const run = runs && runs.workflow_runs && runs.workflow_runs[0];
            const jobs = run ? await lerJson(repo, '/actions/runs/' + run.id + '/jobs?per_page=100').then(r => r.jobs || []).catch(() => []) : [];
            pr.jogos = jogos;
            pr.fila = { lista: P.statusDosJogos(jogos.lista, pastas, jobs), capas, run, semActions: !runs };
            desenharFila(S);
        } catch (e) {
            caixa.innerHTML = `<p style="color:var(--erro)">❌ ${S.esc(e.message)}</p>`;
        }
    }

    function desenharFila(S) {
        const esc = S.esc, f = pr.fila, caixa = $('#pr-fila');
        if (!caixa || !f) return;
        const run = f.run;
        $('#pr-fila-info').innerHTML = run
            ? `último robô: <a href="${esc(run.html_url)}" target="_blank" rel="noopener">${run.status === 'completed' ? (run.conclusion === 'success' ? 'terminou ✅' : 'terminou com erro ❌') : 'rodando agora ⚙️'}</a> · ${esc(new Date(run.created_at).toLocaleString('pt-BR'))}`
            : (f.semActions ? 'o token não lê o Actions: o estado "compilando/falhou" não aparece' : '');
        const sistemas = S.consolesWeb();
        const ordem = { falhou: 0, compilando: 1, aguardando: 2, rascunho: 3, pronto: 4 };
        const linhas = f.lista.slice().sort((a, b) => ordem[a.estado] - ordem[b.estado] || String(a.jogo.nome).localeCompare(String(b.jogo.nome), 'pt'));
        if (!linhas.length) { caixa.innerHTML = '<p class="dica">A prateleira está vazia.</p>'; return; }
        caixa.innerHTML = `<div style="display:grid;gap:8px">${linhas.map(l => {
            const j = l.jogo, [rot, cor] = ROTULO[l.estado];
            const cad = l.noAr ? P.jaCadastrado(S.indice(), j) : null;
            const editar = `https://github.com/${REPO_JOGOS}/edit/main/receitas/${encodeURIComponent(j.id)}.sh`;
            let acoes = '';
            if (l.estado === 'rascunho') acoes = `<button class="btn mini" data-compilar="${esc(j.id)}">▶ Compilar</button> <a class="btn fantasma mini" href="${editar}" target="_blank" rel="noopener">Editar receita</a>`;
            if (l.estado === 'falhou') acoes = `<a class="btn mini" href="${esc(l.job.html_url)}" target="_blank" rel="noopener">Ver o erro</a> <a class="btn fantasma mini" href="${editar}" target="_blank" rel="noopener">Editar receita</a>`;
            if (l.noAr) acoes += ` <a class="btn fantasma mini" href="${P.PAGINA(j.id)}" target="_blank" rel="noopener">▶ Jogar</a>` + (cad
                ? ` <span class="chip" style="color:var(--verde)" title="${esc(cad.caminho)}">✔ em Jogos Web</span>`
                : ` <span class="pr-cad" style="display:inline-flex;gap:6px;align-items:center"><select class="campo" data-sis="${esc(j.id)}" style="padding:4px 8px;width:auto">${sistemas.map(c => `<option value="${esc(c.id)}" ${c.id === 'web-pc' ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
                   <button class="btn principal mini" data-cadastrar="${esc(j.id)}">Cadastrar em Jogos Web</button></span>`);
            return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--borda);border-radius:10px">
                <span style="min-width:150px;flex:1"><b>${esc(j.nome || j.id)}</b> <span class="dica">(${esc(j.id)})</span></span>
                <span class="chip" style="${cor ? 'color:' + cor : ''}">${rot}${l.estado === 'falhou' && l.noAr ? ' · versão antiga no ar' : ''}</span>
                <span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${acoes}</span></div>`;
        }).join('')}</div>`;
        caixa.querySelectorAll('[data-compilar]').forEach(b => b.onclick = () => compilar(S, b.dataset.compilar, b));
        caixa.querySelectorAll('[data-cadastrar]').forEach(b => b.onclick = () => cadastrar(S, b.dataset.cadastrar, b));
    }

    async function compilar(S, id, botao) {
        botao.disabled = true; botao.textContent = 'Salvando…';
        try {
            const atual = await lerPrateleira(S, tokenAtual(S));
            const j = atual.lista.find(x => x.id === id);
            await atual.repo.salvar([{ caminho: 'jogos.json', conteudo: P.tirarRascunho(atual.texto, id) }], 'Prateleira: compilar — ' + (j ? j.nome : id));
            S.aviso('Pronto: o robô vai compilar "' + (j ? j.nome : id) + '". Leva uns minutos — clique em ↻ Atualizar para acompanhar.', 'ok');
            pr.fila = null; carregarFila(S);
        } catch (e) {
            botao.disabled = false; botao.textContent = '▶ Compilar';
            S.aviso('Não consegui: ' + e.message, 'ruim');
        }
    }

    async function cadastrar(S, id, botao) {
        const l = pr.fila.lista.find(x => x.jogo.id === id);
        const sel = document.querySelector(`[data-sis="${CSS.escape(id)}"]`);
        const item = P.itemJogosWeb(l.jogo, { console: sel ? sel.value : 'web-pc', capas: pr.fila.capas });
        try { await S.cadastrarWeb(item, botao); }
        catch (e) { /* o aviso de erro já apareceu */ }
    }

    window.CZPrateleira = { desenhar };
})();
