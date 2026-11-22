/**
 * 🧩 Prateleira de jogos — tela da Studio para o repositório cartoonzine-jogos.
 * Cole o link do GitHub → "Analisar" (só regras, com evidências) → "Adicionar como rascunho" (ficha + receita candidata
 * num commit) → o workflow "Validar receita" do cartoonzine-jogos compila isolado e abre o jogo → "Publicar" (humano).
 * Veja docs/prateleira.md.
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

    /** Busca no GitHub o que a análise precisa: info, branches, commit exato, árvore e só os arquivos de build (+ guia, como dado). */
    async function analisar(S, link, token, manifesto = []) {
        const alvo = P.repoDoLink(link);
        if (!alvo) throw new Error('Isso não parece um link do GitHub (ex.: https://github.com/dono/jogo).');
        const repo = new S.RepoGitHub({ repo: alvo.dono + '/' + alvo.repo, token });
        const info = await lerJson(repo, '');
        const lista = await lerJson(repo, '/branches?per_page=100').catch(() => []);
        const branches = lista.map(b => b.name);
        const branch = alvo.branch || branches.find(b => /^(emscripten|web|wasm|html5|browser)$/i.test(b)) || info.default_branch;
        // commit exato: a análise, a receita e a validação usam o MESMO código
        const commit = await lerJson(repo, '/commits/' + encodeURIComponent(branch)).then(c => c.sha).catch(() => '');
        const arvore = commit ? await lerJson(repo, '/git/trees/' + commit + '?recursive=1').catch(() => ({ tree: [] })) : { tree: [] };
        const caminhos = (arvore.tree || []).filter(t => t.type === 'blob').map(t => t.path);
        const ler = c => lerCru(repo, '/contents/' + c.split('/').map(encodeURIComponent).join('/') + '?ref=' + commit);
        const quais = P.arquivosParaLer(caminhos);
        const arquivos = {};
        for (const c of quais.build) arquivos[c] = (await ler(c)).slice(0, 300000);
        const guia = quais.guia ? (await ler(quais.guia)).slice(0, 100000) : '';
        const a = P.analisarRepo({ info, caminhos, arquivos, guia, guiaArquivo: quais.guia, branches, commit, branch, link, manifesto });
        if (arvore.truncated) a.avisos.push('A árvore do repositório é grande demais e veio cortada pelo GitHub: a análise pode ter deixado arquivos de fora.');
        return a;
    }

    async function lerPrateleira(S, token) {
        const jogos = new S.RepoGitHub({ repo: REPO_JOGOS, branch: 'main', token });
        const [texto, manifesto] = await Promise.all([jogos.lerTexto('jogos.json'),
            // manifesto confiável de dependências externas (sem ele, toda dependência sem port vira "revisão")
            jogos.lerTexto('modelo/dependencias-externas.json').then(t => JSON.parse(t).externas || []).catch(() => [])]);
        return { repo: jogos, texto, lista: JSON.parse(texto).jogos || [], manifesto };
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
                <button class="btn fantasma mini" id="pr-backup" title="Baixa um arquivo com as fichas e as receitas de todos os jogos">💾 Baixar backup</button>
                <button class="btn fantasma mini" id="pr-restaurar" title="Traz de volta os jogos que faltam (não mexe nos que já estão lá)">📂 Restaurar backup</button>
                <input type="file" id="pr-restaurar-arq" accept=".json,application/json" hidden>
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
                const jogos = pr.jogos || await lerPrateleira(S, tk);
                const a = await analisar(S, pr.link, tk, jogos.manifesto);
                pr.analise = pr.original = a; pr.jogos = jogos;
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
        $('#pr-backup').onclick = () => baixarBackup(S, $('#pr-backup'));
        $('#pr-restaurar').onclick = () => { $('#pr-restaurar-arq').value = ''; $('#pr-restaurar-arq').click(); };
        $('#pr-restaurar-arq').onchange = e => { const f = e.target.files[0]; if (f) restaurarBackup(S, f, $('#pr-restaurar')); };
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
        const revisao = a.classificacao === 'revisao';
        const evid = a.evidencias.map(e => `<tr><td>${esc(e.tipo)}</td><td><b>${esc(e.valor)}</b></td><td>${esc(e.arquivo || '')}${e.linha ? ':' + e.linha : ''}${e.trecho ? `<div class="dica"><code>${esc(e.trecho)}</code></div>` : ''}</td><td>${esc(e.regra || '')}</td><td>${esc(e.confianca || '')}</td></tr>`).join('');
        $('#pr-res').innerHTML = `
          <section class="painel" style="margin-top:16px">
            <div style="display:grid;grid-template-columns:minmax(0,260px) 1fr;gap:18px;align-items:start" class="pr-topo">
              <div style="aspect-ratio:2/1;border-radius:10px;overflow:hidden;background:#111">${a.capa ? `<img src="${esc(a.capa)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">` : ''}</div>
              <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
                <b style="font-size:18px">${esc(a.nome)}</b>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  ${selo('Licença do código: ' + esc(a.licenca.spdx || a.licenca.nome), a.licenca.livre)}
                  ${selo('Build: ' + esc(tipoTxt) + (a.ajustes.subdir ? ' em ' + esc(a.ajustes.subdir) + '/' : ''), a.tipo === 'desconhecido' || a.tipo === 'visualstudio' || a.tipo === 'meson' ? false : null)}
                  ${a.dependencias.map(d => selo(esc(d.nome) + (d.port ? '' : ' (sem port)'), d.port ? null : false)).join('')}
                  ${selo('commit ' + esc((a.commit || '?').slice(0, 7)))}
                  ${a.estrelas ? selo('⭐ ' + a.estrelas) : ''}
                </div>
                <div style="padding:8px 10px;border-radius:8px;border:1px solid ${revisao ? 'rgba(255,84,112,.45)' : 'rgba(255,176,0,.4)'}">
                  <b>Previsão pelas regras:</b> ${revisao ? '🔎 revisão necessária' : '📝 receita candidata'}
                  <div class="dica">${revisao ? 'As regras acharam algo sem solução conhecida. A receita gerada só para com o motivo; ajuste à mão e valide.'
                    : 'Isto é uma previsão, não um resultado: o jogo só fica "pronto" depois que o workflow "Validar receita" compilar e abrir o jogo de verdade.'}</div>
                  ${a.motivos.length ? `<ul style="margin:6px 0 0;padding-left:18px">${a.motivos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
                  ${pr.original && (pr.original.motivos.some(m => /licen[cç]a/i.test(m)) || a.licenca.conferidaAMao) ? `
                  <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pr-lic-mao" ${a.licenca.conferidaAMao ? 'checked' : ''}> Conferi a licença do código à mão:</label>
                    <input class="campo" id="pr-lic-mao-v" style="width:150px;padding:4px 8px" placeholder="GPL-3.0" value="${esc(a.licenca.conferidaAMao ? a.licenca.spdx : '')}">
                    <span class="dica">${a.erroLicenca ? '❌ ' + esc(a.erroLicenca) : 'abra o arquivo LICENSE do projeto e escreva o nome (GPL-3.0, MIT, Zlib…)'}</span>
                  </div>` : ''}
                </div>
                ${a.avisos.length ? `<ul class="dica" style="margin:4px 0 0;padding-left:18px">${a.avisos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
                <details><summary class="dica" style="cursor:pointer">🔍 Evidências (${a.evidencias.length})</summary>
                  <div style="overflow:auto"><table class="dica" style="border-collapse:collapse;width:100%;margin-top:6px" cellpadding="4">
                    <tr style="text-align:left"><th>tipo</th><th>decisão</th><th>onde</th><th>regra</th><th>confiança</th></tr>${evid}</table></div></details>
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
              <div class="cheio"><label class="rot" for="pr-ajustes">Ajustes (avançado · JSON · conferidos por lista branca)</label>
                <textarea class="campo" id="pr-ajustes" rows="6" spellcheck="false" style="font-family:'Share Tech Mono',monospace;font-size:12.5px">${esc(JSON.stringify(a.ajustes, null, 1))}</textarea>
                <div class="dica" id="pr-ajustes-msg">subdir, alvo (executável do jogo), dados ("pasta@/destino"), submodulos, externas (ids do manifesto: ${esc(pr.jogos.manifesto.map(m => m.id).join(', ') || 'nenhum')}), flagsCompilar, flagsLinkar, cmakeOpcoes, configureOpcoes. A receita abaixo é refeita quando você muda os ajustes.</div></div>
              <div class="cheio"><label class="rot" for="pr-receita">Receita candidata (receitas/<span id="pr-rid">${esc(a.id)}</span>.sh)</label>
                <textarea class="campo" id="pr-receita" rows="12" spellcheck="false" style="font-family:'Share Tech Mono',monospace;font-size:12.5px">${esc(P.receitaCandidata(a, a.ajustes, { manifesto: pr.jogos.manifesto }))}</textarea>
                <div class="dica">Pode editar. Entra sempre como <b>rascunho</b>: o workflow "Validar receita" compila e abre o jogo; só depois aparece o botão Publicar.</div></div>
              <label class="cheio" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="pr-livres"> <span>Confirmo que <b>os gráficos, sons, fases e dados também são livres</b> (não só o código). Nada de ROM nem arquivo de jogo comercial. <span class="dica">(Compilar não prova licença.)</span></span></label>
            </div>
            <div class="linha-acoes">
              <button class="btn principal" id="pr-add" disabled>Adicionar como rascunho e validar</button>
              <span class="dica" id="pr-msg"></span>
            </div>
          </section>`}`;
        if (dup) return;
        const lm = $('#pr-lic-mao');
        if (lm) {
            const aplicar = () => {
                const campos = ['#pr-id', '#pr-nome', '#pr-ano', '#pr-desc', '#pr-gen', '#pr-ctrl', '#pr-teclas'].map(sel => [sel, ($(sel) || {}).value]);
                pr.analise = lm.checked ? P.confirmarLicenca(pr.original, $('#pr-lic-mao-v').value) : pr.original;
                if (pr.analise.erroLicenca) pr.analise = Object.assign({}, pr.original, { erroLicenca: pr.analise.erroLicenca });
                desenharResultado(S);
                campos.forEach(([sel, v]) => { if ($(sel) && v != null) $(sel).value = v; });
                if (!pr.analise.erroLicenca && pr.analise.licenca.conferidaAMao) $('#pr-lic').value = pr.analise.licenca.spdx;
            };
            lm.onchange = aplicar;
            $('#pr-lic-mao-v').onchange = () => { if (lm.checked) aplicar(); };
        }
        const livres = $('#pr-livres'), add = $('#pr-add'), rec = $('#pr-receita');
        livres.onchange = () => { add.disabled = !livres.checked; };
        $('#pr-id').oninput = e => { $('#pr-rid').textContent = P.idDoNome(e.target.value); };
        let ultima = rec.value;
        const refazer = () => {
            let aj;
            try { aj = JSON.parse($('#pr-ajustes').value); } catch (e) { $('#pr-ajustes-msg').textContent = '❌ JSON inválido: ' + e.message; return; }
            const v = P.validarAjustes(aj, { manifesto: pr.jogos.manifesto });
            $('#pr-ajustes-msg').textContent = v.ok ? '✓ ajustes ok' : '❌ ' + v.erros.join(' · ');
            if (rec.value !== ultima) return;                         // a pessoa editou a receita à mão: não sobrescreve
            rec.value = ultima = P.receitaCandidata(a, aj, { nome: $('#pr-nome').value.trim() || a.nome, manifesto: pr.jogos.manifesto });
        };
        $('#pr-ajustes').oninput = refazer;
        $('#pr-nome').onchange = refazer;
        add.onclick = () => adicionar(S);
    }

    async function adicionar(S) {
        const a = pr.analise, add = $('#pr-add'), msg = $('#pr-msg');
        const id = P.idDoNome($('#pr-id').value);
        const nome = $('#pr-nome').value.trim() || a.nome;
        const receita = $('#pr-receita').value.replace(/\r\n/g, '\n').trim() + '\n';
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { S.aviso('O id só pode ter letras minúsculas, números e "-".', 'ruim'); return; }
        let ajustes;
        try { ajustes = JSON.parse($('#pr-ajustes').value); } catch (e) { S.aviso('Os ajustes não são um JSON válido.', 'ruim'); return; }
        const v = P.validarAjustes(ajustes, { manifesto: pr.jogos.manifesto });
        if (!v.ok) { S.aviso('Ajustes recusados: ' + v.erros.join(' · '), 'ruim'); return; }
        const ano = parseInt($('#pr-ano').value, 10);
        const entrada = P.entradaJogo(a, {
            id, nome, ano: ano > 1970 && ano < 2100 ? ano : undefined, licenca: $('#pr-lic').value.trim(),
            descricao: $('#pr-desc').value.trim(), controles: $('#pr-ctrl').value, teclas: $('#pr-teclas').value.trim(),
            generos: $('#pr-gen').value.split(',').map(g => g.trim()).filter(Boolean), ajustes: v.ajustes
        });
        entrada.licencaDadosConfirmada = new Date().toISOString().slice(0, 10);
        add.disabled = true; msg.textContent = 'Salvando no GitHub…';
        try {
            const atual = await lerPrateleira(S, tokenAtual(S));        // relê na hora: alguém pode ter mudado
            if (P.jaExiste(atual.lista, { id, original: a.original })) throw new Error('Esse jogo (ou o id "' + id + '") já está na prateleira.');
            const novo = P.inserirNoJogosJson(atual.texto, entrada);
            await atual.repo.salvar([
                { caminho: 'jogos.json', conteudo: novo },
                { caminho: 'receitas/' + id + '.sh', conteudo: receita }
            ], 'Prateleira: rascunho — ' + nome);
            pr.jogos = null; pr.analise = null; pr.link = ''; pr.fila = null;
            carregarFila(S);
            $('#pr-res').innerHTML = `<section class="painel" style="margin-top:16px;border-color:rgba(46,230,166,.45)">✅ <b>${S.esc(nome)}</b> entrou na prateleira como <b>rascunho</b>.
              <div class="dica" style="margin-top:6px">O workflow <b>Validar receita</b> começa sozinho (compila num ambiente isolado e abre o jogo num navegador de teste).
              Acompanhe na fila abaixo (↻ Atualizar) ou em <a href="https://github.com/${REPO_JOGOS}/actions/workflows/validar.yml" target="_blank" rel="noopener">Actions</a>.
              Se passar, aparece o botão <b>🚀 Publicar</b>.</div></section>`;
            $('#pr-link').value = '';
            S.aviso('Rascunho salvo: validação começando.', 'ok');
        } catch (e) {
            add.disabled = false; msg.textContent = '';
            S.aviso('Não consegui salvar: ' + e.message, 'ruim');
        }
    }

    // ------------------------------------------------------------------ Parte 2: fila (previsão ≠ resultado real)
    const ROTULO = {
        // publicados (robô "construir")
        aguardando: ['⏳ Esperando o robô', 'var(--amarelo)'], compilando: ['⚙️ Compilando…', 'var(--amarelo)'],
        falhou: ['❌ Falhou ao publicar', 'var(--erro)'], pronto: ['✅ No ar', 'var(--verde)'],
        // rascunhos (workflow "Validar receita")
        revisao: ['🔎 Revisão necessária', 'var(--erro)'], candidata: ['📝 Candidata (não validada)', ''], validando: ['⚙️ Validando…', 'var(--amarelo)'],
        'falhou-validacao': ['❌ Validação falhou', 'var(--erro)'], pronta: ['✅ Pronta (validada)', 'var(--verde)']
    };

    /** Última validação que vale para a receita atual de um rascunho (push do commit da receita ou "validar <id>" depois dele). */
    async function validacaoDe(repo, id, runs, cacheJobs) {
        const c = await lerJson(repo, '/commits?sha=main&per_page=1&path=' + encodeURIComponent('receitas/' + id + '.sh')).then(x => x[0]).catch(() => null);
        if (!c) return { receitaSha: '', validacao: null };
        const quando = c.commit && c.commit.committer ? c.commit.committer.date : '';
        const run = (runs || []).filter(r => (r.event === 'push' && r.head_sha === c.sha) || (r.event === 'workflow_dispatch' && r.display_title === 'validar ' + id && r.created_at >= quando))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        if (!run) return { receitaSha: c.sha, validacao: null };
        if (!cacheJobs.has(run.id)) cacheJobs.set(run.id, await lerJson(repo, '/actions/runs/' + run.id + '/jobs?per_page=100').then(r => r.jobs || []).catch(() => []));
        let v = P.resumoValidacao(cacheJobs.get(run.id), id);
        if (!v && run.status !== 'completed') v = { status: 'validando', url: run.html_url, jobs: [] };   // a matriz ainda não começou
        if (!v) return { receitaSha: c.sha, validacao: null };
        v.headSha = c.sha; v.run = run;
        if (v.status === 'falhou') {
            const ruim = v.jobs.find(j => j.conclusion === 'failure') || v.jobs[0];
            v.erros = ruim ? await lerJson(repo, '/check-runs/' + ruim.id + '/annotations').then(r => r.filter(x => x.annotation_level === 'failure').map(x => (x.title ? x.title + ': ' : '') + x.message)).catch(() => []) : [];
        }
        return { receitaSha: c.sha, validacao: v };
    }

    async function carregarFila(S) {
        const caixa = $('#pr-fila'); if (!caixa) return;
        const tk = tokenAtual(S);
        caixa.innerHTML = '<p class="carregando">Lendo a prateleira…</p>';
        try {
            const jogos = await lerPrateleira(S, tk);
            const repo = jogos.repo;
            const [pastas, capas, runs, runsV] = await Promise.all([
                lerJson(repo, '/git/trees/gh-pages').then(r => (r.tree || []).filter(t => t.type === 'tree').map(t => t.path)).catch(() => []),
                lerJson(repo, '/contents/capas?ref=gh-pages').then(r => r.map(x => x.name)).catch(() => []),
                lerJson(repo, '/actions/workflows/construir.yml/runs?per_page=1').catch(() => null),
                lerJson(repo, '/actions/workflows/validar.yml/runs?per_page=40').then(r => r.workflow_runs || []).catch(() => null)
            ]);
            const run = runs && runs.workflow_runs && runs.workflow_runs[0];
            const jobs = run ? await lerJson(repo, '/actions/runs/' + run.id + '/jobs?per_page=100').then(r => r.jobs || []).catch(() => []) : [];
            const lista = P.statusDosJogos(jogos.lista, pastas, jobs);
            const cache = new Map();
            for (const l of lista.filter(x => x.jogo.rascunho)) {
                const { receitaSha, validacao } = runsV ? await validacaoDe(repo, l.jogo.id, runsV, cache) : { receitaSha: '', validacao: null };
                const e = P.estadoReceita(l.jogo, validacao, receitaSha);
                l.estado = e === 'falhou' ? 'falhou-validacao' : e;
                l.validacao = validacao;
            }
            pr.jogos = jogos;
            pr.fila = { lista, capas, run, semActions: !runs || !runsV };
            desenharFila(S);
        } catch (e) {
            caixa.innerHTML = `<p style="color:var(--erro)">❌ ${S.esc(e.message)}</p>`;
        }
    }

    function desenharFila(S) {
        const esc = S.esc, f = pr.fila, caixa = $('#pr-fila');
        if (!caixa || !f) return;
        const run = f.run;
        $('#pr-fila-info').innerHTML = (run
            ? `último robô de publicação: <a href="${esc(run.html_url)}" target="_blank" rel="noopener">${run.status === 'completed' ? (run.conclusion === 'success' ? 'terminou ✅' : 'terminou com erro ❌') : 'rodando agora ⚙️'}</a> · ${esc(new Date(run.created_at).toLocaleString('pt-BR'))}`
            : '') + (f.semActions ? ' · o token não lê o Actions: validação e publicação aparecem sem estado' : '');
        const sistemas = S.consolesWeb();
        const ordem = { 'falhou-validacao': 0, falhou: 1, pronta: 2, validando: 3, compilando: 4, revisao: 5, candidata: 6, aguardando: 7, pronto: 8 };
        const linhas = f.lista.slice().sort((a, b) => ordem[a.estado] - ordem[b.estado] || String(a.jogo.nome).localeCompare(String(b.jogo.nome), 'pt'));
        if (!linhas.length) { caixa.innerHTML = '<p class="dica">A prateleira está vazia.</p>'; return; }
        caixa.innerHTML = `<div style="display:grid;gap:8px">${linhas.map(l => {
            const j = l.jogo, [rot, cor] = ROTULO[l.estado] || [l.estado, ''];
            const cad = l.noAr ? P.jaCadastrado(S.indice(), j) : null;
            const v = l.validacao;
            const ed = `<button class="btn fantasma mini" data-editar="${esc(j.id)}">✏️ Editar receita</button>`;
            let acoes = '', detalhe = '';
            if (l.estado === 'candidata' || l.estado === 'revisao') acoes = `<button class="btn mini" data-validar="${esc(j.id)}">▶ Validar</button> ${ed}`;
            if (l.estado === 'validando') acoes = `<a class="btn fantasma mini" href="${esc(v.url)}" target="_blank" rel="noopener">Ver no Actions</a>`;
            if (l.estado === 'falhou-validacao') {
                acoes = `<a class="btn mini" href="${esc(v.url)}" target="_blank" rel="noopener">Ver o log</a> ${ed} <button class="btn fantasma mini" data-validar="${esc(j.id)}">↻ Validar de novo</button>`;
                detalhe = `<ul class="dica" style="margin:6px 0 0;padding-left:18px;flex-basis:100%">${(v.erros && v.erros.length ? v.erros.slice(0, 4) : ['Sem resumo automático: abra o log.']).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
            }
            if (l.estado === 'revisao') detalhe = `<ul class="dica" style="margin:6px 0 0;padding-left:18px;flex-basis:100%">${j.revisao.slice(0, 4).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
            if (l.estado === 'pronta') acoes = `<button class="btn principal mini" data-publicar="${esc(j.id)}">🚀 Publicar</button> ${ed}`;
            if (l.estado === 'falhou') acoes = `<a class="btn mini" href="${esc(l.job.html_url)}" target="_blank" rel="noopener">Ver o erro</a> ${ed}`;
            if (l.noAr) acoes += ` <a class="btn fantasma mini" href="${P.PAGINA(j.id)}" target="_blank" rel="noopener">▶ Jogar</a>` + (cad
                ? ` <span class="chip" style="color:var(--verde)" title="${esc(cad.caminho)}">✔ em Jogos Web</span>`
                : ` <span class="pr-cad" style="display:inline-flex;gap:6px;align-items:center"><select class="campo" data-sis="${esc(j.id)}" style="padding:4px 8px;width:auto">${sistemas.map(c => `<option value="${esc(c.id)}" ${c.id === 'web-pc' ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
                   <button class="btn principal mini" data-cadastrar="${esc(j.id)}">Cadastrar em Jogos Web</button></span>`);
            acoes += ` <button class="btn perigo mini" data-remover="${esc(j.id)}" title="Tira o jogo da prateleira (ficha + receita${l.noAr ? ' + a versão publicada' : ''})">🗑️ Remover</button>`;
            return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--borda);border-radius:10px" data-linha="${esc(j.id)}">
                <span style="min-width:150px;flex:1"><b>${esc(j.nome || j.id)}</b> <span class="dica">(${esc(j.id)}${j.commit ? ' · ' + esc(j.commit.slice(0, 7)) : ''})</span></span>
                <span class="chip" style="${cor ? 'color:' + cor : ''}">${rot}${l.estado === 'falhou' && l.noAr ? ' · versão antiga no ar' : ''}</span>
                <span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${acoes}</span>${detalhe}</div>`;
        }).join('')}</div>`;
        caixa.querySelectorAll('[data-validar]').forEach(b => b.onclick = () => validar(S, b.dataset.validar, b));
        caixa.querySelectorAll('[data-publicar]').forEach(b => b.onclick = () => publicar(S, b.dataset.publicar, b));
        caixa.querySelectorAll('[data-editar]').forEach(b => b.onclick = () => editarReceita(S, b.dataset.editar, b));
        caixa.querySelectorAll('[data-cadastrar]').forEach(b => b.onclick = () => cadastrar(S, b.dataset.cadastrar, b));
        caixa.querySelectorAll('[data-remover]').forEach(b => b.onclick = () => remover(S, b.dataset.remover, b));
    }

    /** "Validar de novo": dispara o workflow na mão (precisa de token com Actions: Read and write). */
    async function validar(S, id, botao) {
        botao.disabled = true;
        try {
            const repo = new S.RepoGitHub({ repo: REPO_JOGOS, branch: 'main', token: tokenAtual(S) });
            await repo.api('/actions/workflows/validar.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { id } }) });
            S.aviso('Validação pedida. Leva alguns minutos: clique em ↻ Atualizar para acompanhar.', 'ok');
            setTimeout(() => { pr.fila = null; carregarFila(S); }, 4000);
        } catch (e) {
            botao.disabled = false;
            S.aviso(e.status === 403 || e.status === 404
                ? 'O token não pode disparar o workflow (precisa de "Actions: Read and write"). Alternativa: ✏️ Editar receita e salvar — salvar já valida.'
                : 'Não consegui pedir a validação: ' + e.message, 'ruim');
        }
    }

    /** Publicar = tirar o "rascunho". Só para receita validada, e com a confirmação da licença dos dados de novo. */
    async function publicar(S, id, botao) {
        const l = pr.fila.lista.find(x => x.jogo.id === id);
        if (!l || l.estado !== 'pronta') { S.aviso('Só dá para publicar depois que a validação passar.', 'ruim'); return; }
        if (!confirm(`Publicar "${l.jogo.nome || id}"?\n\nA validação provou que compila e abre — NÃO prova a licença.\nConfirme de novo: os gráficos, sons, fases e dados deste jogo são livres (nada de ROM ou arquivo comercial).`)) return;
        botao.disabled = true; botao.textContent = 'Publicando…';
        try {
            const atual = await lerPrateleira(S, tokenAtual(S));
            await atual.repo.salvar([{ caminho: 'jogos.json', conteudo: P.tirarRascunho(atual.texto, id) }], 'Prateleira: publicar (validado) — ' + (l.jogo.nome || id));
            S.aviso('Publicação pedida: o robô "Construir e publicar" coloca no ar em alguns minutos.', 'ok');
            pr.fila = null; carregarFila(S);
        } catch (e) {
            botao.disabled = false; botao.textContent = '🚀 Publicar';
            S.aviso('Não consegui: ' + e.message, 'ruim');
        }
    }

    /** Editor da receita (e dos ajustes) dentro da fila. Salvar = commit = validação automática. */
    async function editarReceita(S, id, botao) {
        const linha = document.querySelector(`[data-linha="${CSS.escape(id)}"]`);
        if (!linha || linha.querySelector('.pr-editor')) return;
        botao.disabled = true;
        const atual = await lerPrateleira(S, tokenAtual(S)).catch(e => { S.aviso(e.message, 'ruim'); return null; });
        botao.disabled = false;
        if (!atual) return;
        const j = atual.lista.find(x => x.id === id) || {};
        const receita = await atual.repo.lerTexto('receitas/' + id + '.sh').catch(() => '');
        const box = document.createElement('div');
        box.className = 'pr-editor'; box.style.flexBasis = '100%';
        box.innerHTML = `<label class="rot">Ajustes (JSON)</label>
            <textarea class="campo" rows="5" spellcheck="false" style="font-family:'Share Tech Mono',monospace;font-size:12.5px" data-k="ajustes">${S.esc(JSON.stringify(j.ajustes || {}, null, 1))}</textarea>
            <label class="rot" style="margin-top:8px">receitas/${S.esc(id)}.sh</label>
            <textarea class="campo" rows="14" spellcheck="false" style="font-family:'Share Tech Mono',monospace;font-size:12.5px" data-k="receita">${S.esc(receita)}</textarea>
            <div class="linha-acoes" style="margin-top:8px"><button class="btn principal mini" data-k="salvar">Salvar e validar</button><button class="btn fantasma mini" data-k="fechar">Fechar</button><span class="dica" data-k="msg"></span></div>`;
        linha.appendChild(box);
        box.querySelector('[data-k="fechar"]').onclick = () => box.remove();
        box.querySelector('[data-k="salvar"]').onclick = async ev => {
            const b = ev.target, msg = box.querySelector('[data-k="msg"]');
            let aj;
            try { aj = JSON.parse(box.querySelector('[data-k="ajustes"]').value); } catch (e) { msg.textContent = '❌ ajustes: JSON inválido'; return; }
            const v = P.validarAjustes(aj, { manifesto: atual.manifesto });
            if (!v.ok) { msg.textContent = '❌ ' + v.erros.join(' · '); return; }
            const texto = box.querySelector('[data-k="receita"]').value.replace(/\r\n/g, '\n').trim() + '\n';
            if (/\|\|\s*true\b/.test(texto) && !confirm('A receita tem "|| true", que esconde erros e pode fazer um build quebrado parecer certo. Salvar assim mesmo?')) return;
            b.disabled = true; msg.textContent = 'Salvando…';
            try {
                const agora = await lerPrateleira(S, tokenAtual(S));
                const muda = [{ caminho: 'receitas/' + id + '.sh', conteudo: texto }];
                const jj = JSON.parse(agora.texto).jogos.find(x => x.id === id);
                if (jj && JSON.stringify(jj.ajustes || {}) !== JSON.stringify(v.ajustes)) {
                    // troca só a ficha deste jogo (o resto do arquivo fica igual)
                    const nova = Object.assign({}, jj, { ajustes: v.ajustes });
                    muda.push({ caminho: 'jogos.json', conteudo: P.inserirNoJogosJson(P.removerDoJogosJson(agora.texto, id), nova) });
                }
                await agora.repo.salvar(muda, 'Prateleira: receita editada — ' + (j.nome || id));
                S.aviso('Receita salva: a validação começa sozinha.', 'ok');
                pr.fila = null; carregarFila(S);
            } catch (e) { b.disabled = false; msg.textContent = ''; S.aviso('Não consegui salvar: ' + e.message, 'ruim'); }
        };
    }

    // ------------------------------------------------------------------ backup
    async function lerReceitas(repo) {
        const lista = await lerJson(repo, '/contents/receitas?ref=main').catch(() => []);
        const nomes = lista.filter(x => x.type === 'file' && /\.sh$/.test(x.name) && x.name !== 'comum.sh').map(x => x.name.replace(/\.sh$/, ''));
        return nomes;
    }

    async function baixarBackup(S, botao) {
        const txt = botao.textContent; botao.disabled = true; botao.textContent = 'Juntando…';
        try {
            const atual = await lerPrateleira(S, tokenAtual(S));
            const nomes = await lerReceitas(atual.repo);
            const receitas = {};
            for (const id of nomes) receitas[id] = await atual.repo.lerTexto('receitas/' + id + '.sh');
            const bk = P.montarBackup(atual.texto, receitas);
            const url = URL.createObjectURL(new Blob([JSON.stringify(bk, null, 2)], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url; a.download = 'backup-prateleira-' + bk.data.slice(0, 10) + '.json';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            S.aviso('Backup baixado: ' + bk.jogos.length + ' jogos e ' + nomes.length + ' receitas. Guarde o arquivo no seu PC.', 'ok');
        } catch (e) { S.aviso('Não consegui fazer o backup: ' + e.message, 'ruim'); }
        botao.disabled = false; botao.textContent = txt;
    }

    async function restaurarBackup(S, arquivo, botao) {
        const txt = botao.textContent; botao.disabled = true; botao.textContent = 'Lendo…';
        try {
            let bk;
            try { bk = JSON.parse(await arquivo.text()); } catch (e) { throw new Error('o arquivo não é um JSON válido'); }
            const atual = await lerPrateleira(S, tokenAtual(S));
            const plano = P.planoRestauracao(bk, atual.lista, await lerReceitas(atual.repo));
            if (!plano.jogos.length && !plano.arquivos.length) { S.aviso('Nada para restaurar: todos os jogos desse backup já estão na prateleira.', 'ok'); return; }
            const soReceitas = plano.arquivos.filter(a => !plano.jogos.some(j => 'receitas/' + j.id + '.sh' === a.caminho)).map(a => a.caminho.slice(9, -3));
            const msg = 'Backup de ' + new Date(bk.data).toLocaleString('pt-BR') + '.\n\n' +
                (plano.jogos.length ? 'Vai trazer de volta: ' + plano.jogos.map(j => j.nome || j.id).join(', ') + '.\n' : '') +
                (soReceitas.length ? 'Vai repor a receita de: ' + soReceitas.join(', ') + '.\n' : '') +
                '\nOs jogos que já estão na prateleira não são mexidos. Continuar?';
            if (!confirm(msg)) return;
            botao.textContent = 'Restaurando…';
            let texto = atual.texto;
            for (const j of plano.jogos) texto = P.inserirNoJogosJson(texto, j);
            const mud = plano.arquivos.slice();
            if (plano.jogos.length) mud.unshift({ caminho: 'jogos.json', conteudo: texto });
            await atual.repo.salvar(mud, 'Prateleira: restaura backup — ' + (plano.jogos.map(j => j.nome || j.id).join(', ') || soReceitas.join(', ')));
            S.aviso('Restaurado! O robô compila os que não estão em rascunho.', 'ok');
            pr.fila = null; pr.jogos = null; carregarFila(S);
        } catch (e) { S.aviso('Não consegui restaurar: ' + e.message, 'ruim'); }
        finally { botao.disabled = false; botao.textContent = txt; }
    }

    async function remover(S, id, botao) {
        const l = pr.fila.lista.find(x => x.jogo.id === id);
        const nome = l ? (l.jogo.nome || id) : id;
        const cad = l && l.noAr ? P.jaCadastrado(S.indice(), l.jogo) : null;
        if (!confirm(`Remover "${nome}" da prateleira?\n\nApaga a ficha do jogos.json e a receita receitas/${id}.sh` +
            (l && l.noAr ? ', e tira o jogo do site.' : '.') +
            (cad ? `\n\nAtenção: ele também está em Jogos Web (${cad.caminho}). Esse card NÃO é apagado: apague na coleção Jogos Web se quiser.` : ''))) return;
        botao.disabled = true; botao.textContent = 'Removendo…';
        try {
            const atual = await lerPrateleira(S, tokenAtual(S));
            const repo = atual.repo;
            const temReceita = await repo.api('/contents/receitas/' + encodeURIComponent(id) + '.sh?ref=main', { cache: 'no-store' }).then(() => true, () => false);
            const mud = [{ caminho: 'jogos.json', conteudo: P.removerDoJogosJson(atual.texto, id) }];
            if (temReceita) mud.push({ caminho: 'receitas/' + id + '.sh', conteudo: null });
            await repo.salvar(mud, 'Prateleira: remove — ' + nome);
            // a versão publicada (pasta <id>/ no gh-pages): o robô não apaga sozinho
            if (l && l.noAr && /^[a-z0-9][a-z0-9-]*$/.test(id) && !['capas', 'dos', 'pc', 'cores'].includes(id)) {
                try {
                    const site = new S.RepoGitHub({ repo: REPO_JOGOS, branch: 'gh-pages', token: tokenAtual(S) });
                    const arv = await lerJson(site, '/git/trees/gh-pages?recursive=1');
                    const arquivos = (arv.tree || []).filter(t => t.type === 'blob' && t.path.startsWith(id + '/')).map(t => ({ caminho: t.path, conteudo: null }));
                    if (arquivos.length) await site.salvar(arquivos, 'site: remove ' + id);
                } catch (e) { S.aviso('Removido da prateleira, mas não consegui tirar do site: ' + e.message, 'ruim'); }
            }
            S.aviso('"' + nome + '" saiu da prateleira.', 'ok');
            pr.fila = null; pr.jogos = null; carregarFila(S);
        } catch (e) {
            botao.disabled = false; botao.textContent = '🗑️ Remover';
            S.aviso('Não consegui remover: ' + e.message, 'ruim');
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
