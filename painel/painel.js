/**
 * Cartoonzine Studio — painel
 *
 * Três jeitos de salvar (o resto do painel é igual nos três):
 *   - Local:   node tools/painel.mjs  -> grava direto em conteudo/ do seu PC
 *   - GitHub:  aberto no GitHub Pages -> cada "Salvar" vira um commit (token pessoal)
 *   - Demo:    só para experimentar; fica no navegador
 */
(function () {
    'use strict';
    const C = window.StudioCore;
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const guardar = {
        ler(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
        gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem storage: tudo bem */ } },
        apagar(k) { try { localStorage.removeItem(k); } catch (e) { /* idem */ } }
    };

    let avisoTimer;
    function aviso(msg, tipo = '') {
        const a = $('#aviso');
        a.className = 'aviso ' + tipo;
        a.textContent = msg;
        a.hidden = false;
        clearTimeout(avisoTimer);
        avisoTimer = setTimeout(() => { a.hidden = true; }, tipo === 'ruim' ? 9000 : 4500);
    }

    // ==================================================================
    // Repositórios
    // ==================================================================
    class RepoLocal {
        constructor() { this.modo = 'local'; this.rotulo = 'Local · salvando no seu PC'; this.usaProxy = true; }
        async iniciar() {
            const r = await fetch('/api/info', { cache: 'no-store' });
            if (!r.ok) throw new Error('servidor local não respondeu');
            const j = await r.json();
            if (j.modo !== 'local') throw new Error('não é o servidor do Studio');
            this.config = j.config;
            return this;
        }
        async indice() { return (await fetch('/api/indice', { cache: 'no-store' })).json(); }
        async ler(caminho) {
            const r = await fetch('/api/arquivo?caminho=' + encodeURIComponent(caminho), { cache: 'no-store' });
            if (!r.ok) throw new Error('não consegui abrir ' + caminho);
            return r.json();
        }
        async salvar(mudancas) {
            const r = await fetch('/api/salvar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mudancas }) });
            const j = await r.json();
            if (!r.ok) throw new Error(j.erro || 'erro ao salvar');
            return `Salvo no seu PC. ${j.publicados} itens publicados em dist/` + (j.erros ? ` (${j.erros} com erro)` : '') + '. Faça commit/push para ir pro ar.';
        }
    }

    class RepoGitHub {
        constructor({ repo, branch, token }) {
            this.modo = 'github'; this.repo = repo; this.branch = branch || 'main'; this.token = token;
            this.rotulo = 'GitHub · ' + repo;
        }
        async api(rota, opts = {}) {
            const r = await fetch('https://api.github.com/repos/' + this.repo + rota, Object.assign({}, opts, {
                headers: Object.assign({
                    Authorization: 'Bearer ' + this.token,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }, opts.headers || {})
            }));
            if (!r.ok) {
                let msg = r.status + '';
                try { msg = (await r.json()).message || msg; } catch (e) { /* sem corpo */ }
                const erro = new Error(r.status === 401 ? 'Token inválido ou expirado' : r.status === 404 ? 'Não achei o repositório/arquivo (confira o nome e se o token tem acesso)' : 'GitHub: ' + msg);
                erro.status = r.status;
                throw erro;
            }
            return r;
        }
        async lerTexto(caminho) {
            const r = await this.api('/contents/' + caminho.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(this.branch),
                { headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' });
            return r.text();
        }
        async iniciar() {
            this.config = JSON.parse(await this.lerTexto('studio.config.json'));
            return this;
        }
        async indice() {
            const arvore = await (await this.api('/git/trees/' + encodeURIComponent(this.branch) + '?recursive=1', { cache: 'no-store' })).json();
            const caminhos = (arvore.tree || []).filter(t => t.type === 'blob' && /^conteudo\/.+\.json$/.test(t.path) && !/\/_/.test(t.path)).map(t => t.path);
            let publicado = [];
            try { publicado = JSON.parse(await this.lerTexto('dist/indice-painel.json')); } catch (e) { /* 1º uso: ainda não tem build */ }
            const porCaminho = new Map(publicado.map(p => [p.caminho, p]));
            // O índice do build pode estar uns minutos atrasado: o que ele ainda não conhece aparece pelo nome do arquivo
            return caminhos.map(c => porCaminho.get(c) || { caminho: c, nome: c.split('/').pop().replace(/\.json$/, '').replace(/-/g, ' '), pendente: true });
        }
        async ler(caminho) { return JSON.parse(await this.lerTexto(caminho)); }
        async salvar(mudancas, mensagem) {
            for (let tentativa = 0; tentativa < 2; tentativa++) {
                try {
                    const ref = await (await this.api('/git/ref/heads/' + encodeURIComponent(this.branch), { cache: 'no-store' })).json();
                    const base = ref.object.sha;
                    const commitBase = await (await this.api('/git/commits/' + base)).json();
                    const tree = mudancas.map(m => m.conteudo == null
                        ? { path: m.caminho, mode: '100644', type: 'blob', sha: null }
                        : { path: m.caminho, mode: '100644', type: 'blob', content: m.conteudo });
                    const novaArvore = await (await this.api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commitBase.tree.sha, tree }) })).json();
                    const commit = await (await this.api('/git/commits', { method: 'POST', body: JSON.stringify({ message: mensagem, tree: novaArvore.sha, parents: [base] }) })).json();
                    await this.api('/git/refs/heads/' + encodeURIComponent(this.branch), { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
                    return 'Commit feito no GitHub. O robô publica os DBs em 1–2 minutos.';
                } catch (e) {
                    // 422 = alguém (o robô do build?) commitou no meio do caminho: tenta de novo em cima do mais novo
                    if (e.status !== 422 || tentativa) throw e;
                }
            }
        }
    }

    class RepoDemo {
        constructor() { this.modo = 'demo'; this.rotulo = 'Demonstração · nada vai pro ar'; }
        async iniciar() {
            const r = await fetch('../studio.config.json', { cache: 'no-store' });
            if (!r.ok) throw new Error('não achei o studio.config.json');
            this.config = await r.json();
            this.arquivos = guardar.ler('czs-demo') || {
                'conteudo/cartoons/exemplo-caverna-do-dragao.json': C.serializar({
                    nome: 'Exemplo: Caverna do Dragão', ano: 1983, generos: ['Aventura', 'Fantasia'],
                    descricao: 'Item de demonstração. Os links abaixo são fictícios.',
                    temporadas: [{ numero: 1, episodios: [
                        { numero: 1, titulo: 'A Noite Sem Amanhã', links: ['https://exemplo.com/caverna/s01e01.mp4'] },
                        { numero: 2, links: ['https://exemplo.com/caverna/s01e02.mp4'] }] }]
                }),
                'conteudo/canais/br/exemplo-canal.json': C.serializar({ nome: 'Exemplo: Canal Aberto', links: ['https://exemplo.com/canal.m3u8'], pais: 'BR', idioma: 'Português', categoria: 'TV Aberta' })
            };
            return this;
        }
        async indice() { return Object.entries(this.arquivos).map(([c, t]) => C.resumoItem(c, JSON.parse(t))); }
        async ler(c) { if (!this.arquivos[c]) throw new Error('não existe'); return JSON.parse(this.arquivos[c]); }
        async salvar(mudancas) {
            for (const m of mudancas) { if (m.conteudo == null) delete this.arquivos[m.caminho]; else this.arquivos[m.caminho] = m.conteudo; }
            guardar.gravar('czs-demo', this.arquivos);
            return 'Salvo (demonstração — fica só neste navegador).';
        }
    }

    /** Wikipedia/Internet Archive: no modo local passa pelo servidor (evita bloqueio de CORS). */
    function fetchExterno(url, init) {
        // TMDB e OMDb aceitam o navegador direto; archive.org/Wikipedia passam pelo servidor local quando ele existe
        if (estado.repo && estado.repo.usaProxy && /^https:\/\/([^/]*\.)?(archive\.org|wikipedia\.org|screenscraper\.fr)\//.test(url)) {
            return fetch('/api/proxy?url=' + encodeURIComponent(url));
        }
        return fetch(url, init);
    }

    // ==================================================================
    // Chaves do TMDB e do OMDb (ficam só neste navegador)
    // ==================================================================
    function chaves() { return guardar.ler('czs-chaves') || {}; }

    function mostrarChaves() {
        const ch = chaves();
        const fundo = document.createElement('div');
        fundo.className = 'fundo-modal';
        fundo.innerHTML = `
          <div class="gaveta" role="dialog" aria-modal="true" aria-labelledby="ch-t" style="max-width:640px">
            <h2 id="ch-t">Chaves de busca</h2>
            <p class="dica">Ficam guardadas só neste navegador. Sem elas o Studio usa a Wikipedia.</p>
            <div class="painel" style="margin-top:14px">
              <label class="rot" for="ch-tmdb">TMDB — sinopse em português, capas e episódios</label>
              <input class="campo" id="ch-tmdb" type="password" autocomplete="off" placeholder="Token de leitura da API (eyJ…) ou Chave da API" value="${esc(ch.tmdb || '')}">
              <div class="dica">Grátis: crie uma conta em <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org → Configurações → API</a> e copie o "Token de leitura da API".</div>
              <label class="rot" for="ch-omdb" style="margin-top:14px">OMDb — nota do IMDb</label>
              <input class="campo" id="ch-omdb" type="password" autocomplete="off" placeholder="Chave do OMDb" value="${esc(ch.omdb || '')}">
              <div class="dica">Grátis: peça em <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noopener">omdbapi.com/apikey.aspx</a> (plano FREE) e confirme pelo e-mail.</div>
              <label class="rot" for="ch-steamgrid" style="margin-top:14px">SteamGridDB — logos dos jogos retrô</label>
              <input class="campo" id="ch-steamgrid" type="password" autocomplete="off" placeholder="Chave da API do SteamGridDB" value="${esc(ch.steamgrid || '')}">
              <div class="dica">Grátis: em <a href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noopener">steamgriddb.com → Preferences → API</a>. Usada para baixar o logo dos jogos automaticamente.</div>
              <label class="rot" style="margin-top:14px">ScreenScraper — logo "wheel" + vídeo snap dos jogos</label>
              <div class="dica" style="margin-bottom:8px">Login = seu usuário/senha do site. Dev ID / Dev password: peça no <a href="https://www.screenscraper.fr/forum.php" target="_blank" rel="noopener">fórum do ScreenScraper</a> (apps gratuitos). <a href="https://www.screenscraper.fr/webapi2.php" target="_blank" rel="noopener">doc da API</a>.</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <input class="campo" id="ch-ss-dev" type="text" autocomplete="off" placeholder="Dev ID" value="${esc((ch.screenscraper && ch.screenscraper.dev) || '')}">
                <input class="campo" id="ch-ss-devpass" type="password" autocomplete="off" placeholder="Dev password" value="${esc((ch.screenscraper && ch.screenscraper.devSenha) || '')}">
                <input class="campo" id="ch-ss-user" type="text" autocomplete="off" placeholder="Usuário (ssid)" value="${esc((ch.screenscraper && ch.screenscraper.user) || '')}">
                <input class="campo" id="ch-ss-pass" type="password" autocomplete="off" placeholder="Senha (sspassword)" value="${esc((ch.screenscraper && ch.screenscraper.senha) || '')}">
              </div>
            </div>
            <div class="caixa-erros" id="ch-msg"></div>
            <div class="linha-acoes">
              <button class="btn principal" id="ch-salvar">Salvar e testar</button>
              <button class="btn fantasma" id="ch-fechar">Fechar</button>
            </div>
          </div>`;
        document.body.appendChild(fundo);
        const fechar = () => fundo.remove();
        $('#ch-fechar', fundo).onclick = fechar;
        fundo.addEventListener('mousedown', ev => { if (ev.target === fundo) fechar(); });
        $('#ch-salvar', fundo).onclick = async () => {
            const b = $('#ch-salvar', fundo);
            const ss = { dev: $('#ch-ss-dev', fundo).value.trim(), devSenha: $('#ch-ss-devpass', fundo).value.trim(), user: $('#ch-ss-user', fundo).value.trim(), senha: $('#ch-ss-pass', fundo).value.trim() };
            const novo = { tmdb: $('#ch-tmdb', fundo).value.trim(), omdb: $('#ch-omdb', fundo).value.trim(), steamgrid: $('#ch-steamgrid', fundo).value.trim(), screenscraper: ss };
            guardar.gravar('czs-chaves', novo);
            b.disabled = true; b.textContent = 'Testando…';
            const res = [];
            try {
                if (novo.tmdb) {
                    const r = await C.completarItem({ nome: 'Popeye', links: ['https://exemplo.com/x.mp4'] }, { tmdb: novo.tmdb, fetchFn: fetchExterno });
                    res.push(r.achados.length ? '✅ TMDB funcionando (' + r.achados[0] + ')' : '❌ TMDB: ' + (r.avisos[0] || 'não respondeu'));
                }
                if (novo.omdb) {
                    const n = await C.buscarNotaIMDb('tt0111161', novo.omdb, fetchExterno).then(x => x, e => ({ erro: e.message }));
                    res.push(n && n.notaImdb ? '✅ OMDb funcionando (nota de teste: ' + n.notaImdb + ')' : '❌ OMDb: ' + ((n && n.erro) || 'sem resposta — confirmou a chave pelo e-mail?'));
                }
                if (novo.steamgrid) {
                    const url = await C.buscarLogoSteamGrid('Sonic the Hedgehog', novo.steamgrid, fetchExterno).then(x => x, e => ({ erro: e.message }));
                    if (url && typeof url === 'string') res.push('✅ SteamGridDB funcionando (logo de teste encontrado)');
                    else if (url && url.erro) res.push('❌ SteamGridDB: ' + url.erro);
                    else res.push('❌ SteamGridDB: respondeu, mas sem logo no teste');
                }
                if (ss.dev) {
                    const r = await C.buscarScreenScraper('Sonic The Hedgehog', ss, fetchExterno).then(x => x, e => ({ erro: e.message }));
                    if (r && r.erro) res.push('❌ ScreenScraper: ' + r.erro);
                    else if (r && (r.logo || r.video)) res.push('✅ ScreenScraper funcionando (' + [r.logo ? 'logo' : '', r.video ? 'vídeo' : ''].filter(Boolean).join(' + ') + ')');
                    else res.push('❌ ScreenScraper: respondeu, mas sem mídia no teste');
                }
            } catch (e) { res.push('❌ ' + e.message); }
            b.disabled = false; b.textContent = 'Salvar e testar';
            const box = $('#ch-msg', fundo);
            box.style.borderColor = res.every(x => x.startsWith('✅')) ? 'rgba(46,230,166,.45)' : '';
            box.style.background = res.every(x => x.startsWith('✅')) ? 'rgba(46,230,166,.08)' : '';
            box.style.color = res.every(x => x.startsWith('✅')) ? 'var(--texto)' : '';
            box.innerHTML = res.length ? res.map(esc).join('<br>') : 'Chaves apagadas deste navegador.';
            if (estado.aba === 'rapido') desenharArea();
        };
    }

    // ==================================================================
    // Estado
    // ==================================================================
    const estado = { repo: null, config: null, indice: [], col: null, aba: 'itens', busca: '' };

    const colecaoAtual = () => estado.config.colecoes.find(c => c.id === estado.col) || estado.config.colecoes[0];
    const itensDaColecao = id => estado.indice.filter(i => i.caminho.startsWith('conteudo/' + id + '/'));

    async function conectar(repo) {
        estado.repo = await repo.iniciar();
        estado.config = repo.config;
        estado.col = guardar.ler('czs-col') || estado.config.colecoes[0].id;
        if (!estado.config.colecoes.some(c => c.id === estado.col)) estado.col = estado.config.colecoes[0].id;
        $('#status').textContent = repo.rotulo;
        $('#status').className = 'chip ok';
        $('#btn-sair').hidden = repo.modo === 'local';
        $('#btn-publicacao').hidden = false;
        $('#btn-chaves').hidden = false;
        await recarregarIndice();
        desenharApp();
    }

    async function recarregarIndice() {
        try { estado.indice = await estado.repo.indice(); }
        catch (e) { aviso('Não consegui listar o conteúdo: ' + e.message, 'ruim'); estado.indice = []; }
    }

    // ==================================================================
    // Tela de conexão
    // ==================================================================
    function telaConectar(erro) {
        const salvo = guardar.ler('czs-github') || {};
        const m = /^([^.]+)\.github\.io$/.exec(location.hostname);
        const repoPadrao = salvo.repo || (m ? m[1] + '/' + (location.pathname.split('/')[1] || 'cartoonzine-studio') : 'cartoonzine/cartoonzine-studio');
        $('#raiz').innerHTML = `
        <section class="conectar">
          <h1>Cartoonzine Studio</h1>
          <p class="lead">Adicione cartoons, animes, filmes, séries, canais, rádios e jogos. O Studio organiza tudo e gera os DBs que o cartoonzine-cloud lê.</p>
          ${erro ? `<div class="caixa-erros">${esc(erro)}</div><br>` : ''}
          <div class="opcoes">
            <div class="painel opcao">
              <h3>🐙 Conectar ao GitHub</h3>
              <p>Cada "Salvar" vira um commit no repositório e o robô publica os DBs sozinho. Precisa de um <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">token de acesso</a> com permissão <b>Contents: Read and write</b> só neste repositório.</p>
              <form class="form" id="f-github">
                <div><label class="rot" for="g-repo">Repositório</label><input class="campo" id="g-repo" value="${esc(repoPadrao)}" required></div>
                <div><label class="rot" for="g-branch">Branch</label><input class="campo" id="g-branch" value="${esc(salvo.branch || 'main')}" required></div>
                <div class="cheio"><label class="rot" for="g-token">Token</label><input class="campo" id="g-token" type="password" autocomplete="off" placeholder="github_pat_…" required>
                  <div class="dica">O token fica guardado só neste navegador. Use "Sair" para apagá-lo.</div></div>
                <div class="cheio"><button class="btn principal" type="submit">Conectar</button></div>
              </form>
            </div>
            <div class="painel opcao">
              <h3>💻 Usar no meu PC</h3>
              <p>Na pasta do repositório, rode <code>node tools/painel.mjs</code> e abra <code>http://localhost:4321</code>. Salva direto nos arquivos, sem token.</p>
            </div>
            <div class="painel opcao">
              <h3>🧪 Só experimentar</h3>
              <p>Modo demonstração: tudo fica neste navegador e nada vai para o ar.</p>
              <button class="btn" id="btn-demo">Abrir demonstração</button>
            </div>
          </div>
        </section>`;
        $('#f-github').addEventListener('submit', async ev => {
            ev.preventDefault();
            const dados = { repo: $('#g-repo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, ''), branch: $('#g-branch').value.trim(), token: $('#g-token').value.trim() };
            try {
                await conectar(new RepoGitHub(dados));
                guardar.gravar('czs-github', dados);
            } catch (e) { telaConectar(e.message); }
        });
        $('#btn-demo').addEventListener('click', async () => {
            try { await conectar(new RepoDemo()); } catch (e) { telaConectar('Demonstração: ' + e.message + ' (abra o painel por um servidor, não pelo arquivo direto)'); }
        });
    }

    // ==================================================================
    // App
    // ==================================================================
    function desenharApp() {
        const cfg = estado.config;
        $('#raiz').innerHTML = `
        <div class="app">
          <nav class="lateral" aria-label="Coleções">
            <h2>Coleções</h2>
            ${cfg.colecoes.map(c => `
              <button class="colecao ${c.id === estado.col ? 'ativa' : ''}" data-col="${esc(c.id)}">
                <span class="ic" aria-hidden="true">${esc(c.icone || '•')}</span>
                <span class="nm">${esc(c.nome)}</span>
                <span class="ct">${itensDaColecao(c.id).length}</span>
              </button>`).join('')}
          </nav>
          <section class="principal-area" id="area"></section>
        </div>`;
        $$('.colecao').forEach(b => b.addEventListener('click', () => {
            estado.col = b.dataset.col; estado.busca = ''; guardar.gravar('czs-col', estado.col);
            desenharApp();
        }));
        desenharArea();
    }

    function desenharArea() {
        const col = colecaoAtual();
        const tipo = C.TIPOS[col.tipo];
        const n = itensDaColecao(col.id).length;
        $('#area').innerHTML = `
          <div class="cab">
            <div>
              <h1>${esc(col.icone || '')} ${esc(col.nome)}</h1>
              <div class="sub">${n} ${n === 1 ? 'item' : 'itens'} · ${esc(tipo ? tipo.rotulo : col.tipo)} · vai para ${esc(col.app || 'cartoonzine')}</div>
            </div>
            <div class="espaco"></div>
            <div class="abas" role="tablist">
              <button class="aba ${estado.aba === 'itens' ? 'ativa' : ''}" data-aba="itens" role="tab">Itens</button>
              <button class="aba ${estado.aba === 'rapido' ? 'ativa' : ''}" data-aba="rapido" role="tab">⚡ Adicionar rápido</button>
            </div>
            <button class="btn principal" id="btn-novo">+ Novo</button>
          </div>
          <div id="conteudo-aba"></div>`;
        $$('.aba').forEach(b => b.addEventListener('click', () => { estado.aba = b.dataset.aba; desenharArea(); }));
        $('#btn-novo').addEventListener('click', () => abrirEditor(null));
        if (estado.aba === 'rapido') desenharRapido(); else desenharLista();
    }

    function desenharLista() {
        const col = colecaoAtual();
        const largo = col.tipo === 'canal' || col.tipo === 'radio' || col.tipo === 'canal24h';
        const alvo = C.normText(estado.busca);
        const consoles = new Map((estado.config.consoles || []).map(c => [c.id, c.nome]));
        const itens = itensDaColecao(col.id)
            .filter(i => !alvo || C.normText(i.nome).includes(alvo) || C.normText(i.caminho).includes(alvo))
            .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt', { numeric: true }));
        const total = itensDaColecao(col.id).length;
        const MAX = 300;
        $('#conteudo-aba').innerHTML = `
          <input class="busca" type="search" placeholder="Buscar em ${esc(col.nome)}…" value="${esc(estado.busca)}" aria-label="Buscar">
          ${!total ? `<div class="vazio"><b>Nada aqui ainda</b>Use <b style="display:inline">⚡ Adicionar rápido</b> para colar vários links de uma vez, ou <b style="display:inline">+ Novo</b> para preencher um formulário.</div>` : ''}
          ${total && !itens.length ? `<div class="vazio">Nada encontrado para "${esc(estado.busca)}".</div>` : ''}
          <div class="grade">${itens.slice(0, MAX).map(i => {
              const meta = [i.nota ? '⭐ ' + i.nota : '', i.ano, i.eps ? i.eps + ' ep.' : '', i.console ? consoles.get(i.console) || i.console : '', i.pais, i.categoria].filter(Boolean).join(' · ');
              return `<button class="card ${largo ? 'largo' : ''}" data-caminho="${esc(i.caminho)}">
                ${i.rascunho ? '<span class="selo rasc">rascunho</span>' : ''}${i.auto ? '<span class="selo auto">auto</span>' : ''}
                <div class="img">${i.capa ? `<img src="${esc(i.capa)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : esc(col.icone || '🎬')}</div>
                <div class="info"><div class="t">${esc(i.nome)}</div><div class="m">${esc(meta || (i.pendente ? 'publicando…' : ' '))}</div></div>
              </button>`;
          }).join('')}</div>
          ${itens.length > MAX ? `<p class="dica">Mostrando ${MAX} de ${itens.length}. Use a busca para achar o resto.</p>` : ''}`;
        const busca = $('.busca');
        busca.addEventListener('input', () => {
            estado.busca = busca.value;
            const pos = busca.selectionStart;
            desenharLista();
            const nova = $('.busca'); nova.focus(); nova.setSelectionRange(pos, pos);
        });
        $$('.card').forEach(c => c.addEventListener('click', () => abrirEditor(c.dataset.caminho)));
    }

    // ==================================================================
    // Formulário (gerado a partir de StudioCore.TIPOS)
    // ==================================================================
    function campoHtml(c, valor, prefixo = 'f') {
        const id = prefixo + '-' + c.k;
        const obr = c.obrigatorio ? ' <span class="obr">*</span>' : '';
        const dica = c.dica ? `<div class="dica">${esc(c.dica)}</div>` : '';
        const rot = `<label class="rot" for="${id}">${esc(c.rotulo)}${obr}</label>`;
        switch (c.tipo) {
            case 'textarea':
                return `<div class="cheio">${rot}<textarea class="campo" id="${id}" data-k="${c.k}" rows="4">${esc(valor || '')}</textarea>${dica}</div>`;
            case 'links':
                return `<div class="cheio">${rot}<textarea class="campo" id="${id}" data-k="${c.k}" rows="2" placeholder="https://…  (um por linha)">${esc((valor || []).join('\n'))}</textarea>${dica}</div>`;
            case 'lista':
                return `<div>${rot}<input class="campo" id="${id}" data-k="${c.k}" value="${esc((valor || []).join(', '))}">${dica}</div>`;
            case 'bool':
                return `<div><label class="check"><input type="checkbox" id="${id}" data-k="${c.k}" ${valor ? 'checked' : ''}> ${esc(c.rotulo)}</label>${dica}</div>`;
            case 'escolha': {
                const ops = c.opcoes ? c.opcoes.map(v => ({ v, r: v || '—' })) : C.opcoesDe(c.opcoesDe, estado.config);
                if (c.livre) {
                    return `<div>${rot}<input class="campo" id="${id}" data-k="${c.k}" list="${id}-l" value="${esc(valor || '')}">
                      <datalist id="${id}-l">${ops.map(o => `<option value="${esc(o.v)}">`).join('')}</datalist>${dica}</div>`;
                }
                const tem = ops.some(o => o.v === valor);
                return `<div>${rot}<select class="campo" id="${id}" data-k="${c.k}">
                    ${c.opcoes ? '' : '<option value="">— escolha —</option>'}
                    ${!tem && valor ? `<option value="${esc(valor)}" selected>${esc(valor)}</option>` : ''}
                    ${ops.map(o => `<option value="${esc(o.v)}" ${o.v === valor ? 'selected' : ''}>${esc(o.r)}</option>`).join('')}
                  </select>${dica}</div>`;
            }
            case 'numero':
                return `<div>${rot}<input class="campo" id="${id}" data-k="${c.k}" type="number" inputmode="numeric" value="${esc(valor || '')}">${dica}</div>`;
            case 'url':
                return `<div>${rot}<input class="campo" id="${id}" data-k="${c.k}" type="url" placeholder="https://…" value="${esc(valor || '')}">${dica}
                  ${c.imagem && valor ? `<img class="previa-img" src="${esc(valor)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>`;
            case 'temporadas':
                return `<div class="cheio" id="temporadas-box"></div>`;
            default:
                return `<div>${rot}<input class="campo" id="${id}" data-k="${c.k}" value="${esc(valor || '')}">${dica}</div>`;
        }
    }

    function lerCampos(raiz, campos) {
        const out = {};
        for (const c of campos) {
            const e = raiz.querySelector(`[data-k="${c.k}"]`);
            if (!e) continue;
            if (c.tipo === 'bool') { if (e.checked) out[c.k] = true; continue; }
            const v = e.value.trim();
            if (!v) continue;
            if (c.tipo === 'links') out[c.k] = v.split(/\s+/).filter(Boolean);
            else if (c.tipo === 'lista') out[c.k] = C.lista(v);
            else if (c.tipo === 'numero') out[c.k] = parseInt(v, 10);
            else out[c.k] = v;
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Editor de temporadas
    // ------------------------------------------------------------------
    function editorTemporadas(box, temporadas) {
        let temps = JSON.parse(JSON.stringify(temporadas || []));
        function desenhar() {
            const total = temps.reduce((n, t) => n + t.episodios.length, 0);
            box.innerHTML = `
              <label class="rot">Temporadas e episódios ${total ? `<span class="dica" style="display:inline">· ${temps.length} temp. · ${total} ep.</span>` : ''}</label>
              <div class="dica">Filme ou desenho avulso? Deixe sem temporadas e use o campo de link lá em cima.</div>
              ${temps.map((t, ti) => `
                <div class="temporada">
                  <header><b>Temporada <input class="campo" style="width:70px;display:inline-block;padding:4px 8px" type="number" value="${t.numero}" data-tnum="${ti}" aria-label="Número da temporada"></b>
                    <button type="button" class="btn mini" data-addep="${ti}">+ Episódio</button>
                    <button type="button" class="btn mini perigo" data-deltemp="${ti}">Remover</button></header>
                  ${t.episodios.map((e, ei) => `
                    <div class="ep">
                      <input class="campo" type="number" value="${e.numero}" data-en="${ti}:${ei}" aria-label="Número do episódio">
                      <input class="campo tit" value="${esc(e.titulo || '')}" placeholder="Título (opcional)" data-et="${ti}:${ei}" aria-label="Título do episódio">
                      <input class="campo" value="${esc((e.links || []).join(' '))}" placeholder="https://… (link; reservas separados por espaço)" data-el="${ti}:${ei}" aria-label="Link do episódio">
                      <button type="button" class="x" data-delep="${ti}:${ei}" aria-label="Remover episódio">×</button>
                    </div>`).join('')}
                </div>`).join('')}
              <div class="linha-acoes" style="margin-top:10px">
                <button type="button" class="btn mini" id="add-temp">+ Temporada</button>
                <button type="button" class="btn mini" id="colar-eps">📋 Colar vários episódios</button>
              </div>
              <div id="colar-box" hidden style="margin-top:10px">
                <textarea class="campo" id="colar-txt" rows="5" placeholder="Cole links (um por linha), mensagens do @CZStreamBot ou 'Nome S01E03 | link'. Temporada/episódio saem do nome do arquivo; sem número, entram em ordem."></textarea>
                <div class="linha-acoes"><button type="button" class="btn mini principal" id="colar-ok">Adicionar episódios</button></div>
              </div>`;
            const sync = () => {
                $$('[data-tnum]', box).forEach(i => { temps[+i.dataset.tnum].numero = parseInt(i.value, 10) || 1; });
                $$('[data-en]', box).forEach(i => { const [a, b] = i.dataset.en.split(':'); temps[a].episodios[b].numero = parseInt(i.value, 10) || 1; });
                $$('[data-et]', box).forEach(i => { const [a, b] = i.dataset.et.split(':'); const v = i.value.trim(); if (v) temps[a].episodios[b].titulo = v; else delete temps[a].episodios[b].titulo; });
                $$('[data-el]', box).forEach(i => { const [a, b] = i.dataset.el.split(':'); temps[a].episodios[b].links = i.value.split(/\s+/).filter(Boolean); });
            };
            box.oninput = sync;
            $$('[data-addep]', box).forEach(b => b.onclick = () => {
                sync(); const t = temps[+b.dataset.addep];
                t.episodios.push({ numero: t.episodios.reduce((m, e) => Math.max(m, e.numero), 0) + 1, links: [] });
                desenhar();
            });
            $$('[data-deltemp]', box).forEach(b => b.onclick = () => {
                sync(); const t = temps[+b.dataset.deltemp];
                if (t.episodios.length && !confirm(`Remover a temporada ${t.numero} e seus ${t.episodios.length} episódios?`)) return;
                temps.splice(+b.dataset.deltemp, 1); desenhar();
            });
            $$('[data-delep]', box).forEach(b => b.onclick = () => { sync(); const [a, i] = b.dataset.delep.split(':'); temps[a].episodios.splice(i, 1); desenhar(); });
            $('#add-temp', box).onclick = () => { sync(); temps.push({ numero: temps.reduce((m, t) => Math.max(m, t.numero), 0) + 1, episodios: [] }); desenhar(); };
            $('#colar-eps', box).onclick = () => { $('#colar-box', box).hidden = false; $('#colar-txt', box).focus(); };
            $('#colar-ok', box).onclick = () => {
                sync();
                const entradas = C.lerTextoColado($('#colar-txt', box).value);
                if (!entradas.length) { aviso('Não achei nenhum link no texto.', 'ruim'); return; }
                const novo = { temporadas: [] };
                const ultima = temps.length ? temps[temps.length - 1].numero : 1;
                const colocar = (tn, en, e, titulo) => {
                    let t = novo.temporadas.find(x => x.numero === tn);
                    if (!t) { t = { numero: tn, episodios: [] }; novo.temporadas.push(t); }
                    t.episodios.push(C.limparVazios({ numero: en, titulo, links: e.links }));
                };
                // 1º os que dizem o número (S01E03, 1x03, Episódio 3)...
                const semNumero = [];
                for (const e of entradas) {
                    if (e.episodio !== undefined) colocar(e.temporada || 1, e.episodio, e, e.tituloEpisodio);
                    else semNumero.push(e);
                }
                // ...depois os outros, em ordem, depois do último episódio da última temporada
                const ocupados = [].concat(temps, novo.temporadas).filter(t => t.numero === ultima).flatMap(t => t.episodios.map(e => e.numero));
                let proximo = ocupados.length ? Math.max(...ocupados) + 1 : 1;
                for (const e of semNumero) colocar(ultima, proximo++, e, e.nome);
                temps = C.mesclarItem({ temporadas: temps }, novo).temporadas;
                aviso(`${entradas.length} episódio(s) adicionados.`, 'ok');
                desenhar();
            };
        }
        desenhar();
        return () => { box.oninput && box.oninput(); return temps.filter(t => t.episodios.length); };
    }

    // ------------------------------------------------------------------
    // Gaveta do editor
    // ------------------------------------------------------------------
    async function abrirEditor(caminho) {
        const col = colecaoAtual();
        const tipo = C.TIPOS[col.tipo];
        let item = {};
        if (caminho) {
            try { item = C.normalizarItem(await estado.repo.ler(caminho), col); }
            catch (e) { aviso(e.message, 'ruim'); return; }
        }
        const fundo = document.createElement('div');
        fundo.className = 'fundo-modal';
        const normais = tipo.campos.filter(c => !c.avancado);
        const avancados = tipo.campos.filter(c => c.avancado);
        fundo.innerHTML = `
          <div class="gaveta" role="dialog" aria-modal="true" aria-labelledby="ed-titulo">
            <h2 id="ed-titulo">${caminho ? esc(item.nome || 'Editar') : 'Novo em ' + esc(col.nome)}</h2>
            <div class="caminho">${caminho ? esc(caminho) : 'o arquivo é criado ao salvar'}</div>
            <div class="caixa-erros" id="ed-erros"></div>
            <form class="form" id="ed-form" style="margin-top:16px" novalidate>
              ${normais.map(c => campoHtml(c, item[c.k])).join('')}
              ${avancados.length ? `<details class="avancado cheio"><summary>Opções avançadas</summary><div class="form" style="margin-top:12px">${avancados.map(c => campoHtml(c, item[c.k])).join('')}</div></details>` : ''}
            </form>
            <div class="linha-acoes">
              <button class="btn principal" id="ed-salvar">Salvar</button>
              <button class="btn" id="ed-auto" title="Busca sinopse, capas, episódios e nota (TMDB/IMDb; sem chave usa a Wikipedia) e importa vídeos de links do archive.org">✨ Preencher automaticamente</button>
              <button class="btn fantasma" id="ed-rasc">Salvar como rascunho</button>
              <div class="espaco"></div>
              ${caminho ? '<button class="btn perigo" id="ed-excluir">Excluir</button>' : ''}
              <button class="btn fantasma" id="ed-fechar">Fechar</button>
            </div>
            <details id="ed-json-box" style="margin-top:20px"><summary class="dica" style="cursor:pointer">Ver o que o app vai receber (JSON)</summary><pre class="json" id="ed-json"></pre></details>
          </div>`;
        document.body.appendChild(fundo);
        const form = $('#ed-form', fundo);
        let lerTemps = () => item.temporadas;
        const boxT = $('#temporadas-box', fundo);
        if (boxT) lerTemps = editorTemporadas(boxT, item.temporadas);
        const lerItem = () => {
            // começa do item como está (guarda nota do IMDb, fonte, _origem…) e troca o que o formulário mostra
            const novo = Object.assign({}, item);
            delete novo._rascunho;
            for (const c of tipo.campos) delete novo[c.k];
            Object.assign(novo, lerCampos(form, tipo.campos));
            const t = lerTemps();
            if (t && t.length) novo.temporadas = t;
            return C.normalizarItem(novo, col);
        };
        const atualizarJson = () => {
            const it = lerItem();
            $('#ed-json', fundo).textContent = JSON.stringify(C.paraCloud(it, col, '…'), null, 2);
        };
        $('#ed-json-box', fundo).addEventListener('toggle', atualizarJson);

        const fechar = () => { fundo.remove(); document.removeEventListener('keydown', teclas); };
        const teclas = ev => { if (ev.key === 'Escape') fechar(); };
        document.addEventListener('keydown', teclas);
        fundo.addEventListener('mousedown', ev => { if (ev.target === fundo) fechar(); });
        $('#ed-fechar', fundo).onclick = fechar;
        $('input,textarea,select', form)?.focus();

        async function salvar(rascunho) {
            const novo = lerItem();
            if (rascunho) novo._rascunho = true;
            const { erros } = C.validarItem(novo, col, estado.config);
            if (erros.length && !rascunho) {
                $('#ed-erros', fundo).innerHTML = '<b>Falta pouco:</b><br>' + erros.map(esc).join('<br>') + '<br><span class="dica">Ou use "Salvar como rascunho" para terminar depois.</span>';
                return;
            }
            if (!novo.nome) { $('#ed-erros', fundo).textContent = 'Coloque pelo menos o nome.'; return; }
            const mudancas = [];
            let destino = caminho;
            const sub = col.subpasta;
            if (!caminho || (sub && novo[sub] !== item[sub])) {
                const base = C.caminhoItem(col, novo);
                const pasta = base.slice(0, base.lastIndexOf('/') + 1);
                const nomes = new Set(estado.indice.map(i => i.caminho)
                    .filter(c => c.startsWith(pasta) && !c.slice(pasta.length).includes('/'))
                    .map(c => c.slice(pasta.length).replace(/\.json$/, '')));
                destino = C.caminhoItem(col, novo, C.slugLivre(C.slugify(novo.nome), nomes));
                if (caminho) mudancas.push({ caminho, conteudo: null });
            }
            mudancas.push({ caminho: destino, conteudo: C.serializar(novo) });
            await gravar(mudancas, `Studio: ${caminho ? 'edita' : 'adiciona'} "${novo.nome}" em ${col.nome}`, $('#ed-salvar', fundo));
            fechar();
        }
        $('#ed-salvar', fundo).onclick = () => salvar(false);
        $('#ed-rasc', fundo).onclick = () => salvar(true);
        if (caminho) $('#ed-excluir', fundo).onclick = async () => {
            if (!confirm(`Excluir "${item.nome}"? Ele sai do app no próximo build.`)) return;
            await gravar([{ caminho, conteudo: null }], `Studio: remove "${item.nome}" de ${col.nome}`, $('#ed-excluir', fundo));
            fechar();
        };
        $('#ed-auto', fundo).onclick = async () => {
            const b = $('#ed-auto', fundo);
            b.disabled = true; b.textContent = 'Buscando…';
            try {
                let atual = lerItem();
                const arch = (atual.links || []).map(C.idDoArchive).find(Boolean) || atual.archive;
                const achados = [];
                if (arch) {
                    const doArchive = await C.importarArchive(arch, fetchExterno);
                    const linksSemArchive = (atual.links || []).filter(u => !C.idDoArchive(u) || /\.(mp4|mkv|webm|ogv)$/i.test(u));
                    atual = C.mesclarItem(Object.assign({}, atual, { links: linksSemArchive }), doArchive);
                    if (!atual.nome) atual.nome = doArchive.nome;
                    achados.push('Internet Archive: ' + (C.contarEpisodios(atual) ? C.contarEpisodios(atual) + ' episódios' : '1 vídeo'));
                }
                let avisosAuto = [];
                if (atual.nome && (col.tipo === 'video' || col.tipo === 'jogo')) {
                    const ch = chaves();
                    const r = await C.completarItem(atual, { tmdb: ch.tmdb, omdb: ch.omdb, steamgrid: ch.steamgrid, screenscraper: ch.screenscraper, wiki: true, fetchFn: fetchExterno, tipoColecao: col.tipo });
                    atual = r.item; achados.push(...r.achados); avisosAuto = r.avisos;
                }
                delete atual.archive;
                item = Object.assign({}, item, atual);
                // redesenha o formulário com o que foi achado
                form.innerHTML = normais.map(c => campoHtml(c, item[c.k])).join('') +
                    (avancados.length ? `<details class="avancado cheio"><summary>Opções avançadas</summary><div class="form" style="margin-top:12px">${avancados.map(c => campoHtml(c, item[c.k])).join('')}</div></details>` : '');
                const nb = $('#temporadas-box', fundo);
                if (nb) lerTemps = editorTemporadas(nb, item.temporadas);
                const extra = avisosAuto.length ? ' ⚠ ' + avisosAuto.join(' ') : '';
                aviso((achados.length ? 'Preenchido: ' + achados.join(' · ') + '. Confira antes de salvar.' : 'Não achei nada novo para este nome.') + extra, achados.length ? 'ok' : (avisosAuto.length ? 'ruim' : ''));
            } catch (e) { aviso('Não deu para buscar: ' + e.message, 'ruim'); }
            b.disabled = false; b.textContent = '✨ Preencher automaticamente';
        };
    }

    async function gravar(mudancas, mensagem, botao) {
        const txt = botao ? botao.textContent : '';
        if (botao) { botao.disabled = true; botao.textContent = 'Salvando…'; }
        try {
            const msg = await estado.repo.salvar(mudancas, mensagem);
            // índice: o local/demo é recalculado; no GitHub atualiza na hora com o que acabou de ir
            if (estado.repo.modo === 'github') {
                for (const m of mudancas) {
                    estado.indice = estado.indice.filter(i => i.caminho !== m.caminho);
                    if (m.conteudo != null) estado.indice.push(C.resumoItem(m.caminho, JSON.parse(m.conteudo)));
                }
            } else await recarregarIndice();
            aviso(msg, 'ok');
            desenharApp();
        } catch (e) {
            aviso('Não salvou: ' + e.message, 'ruim');
            throw e;
        } finally {
            if (botao) { botao.disabled = false; botao.textContent = txt; }
        }
    }

    // ==================================================================
    // Adição rápida
    // ==================================================================
    const rapido = { texto: '', previa: null };

    function desenharRapido() {
        const col = colecaoAtual();
        const tipo = C.TIPOS[col.tipo];
        const camposPadrao = { video: ['audio'], canal: ['pais', 'idioma', 'categoria'], radio: ['pais', 'idioma', 'cidade'], jogo: ['console'], canal24h: [] }[col.tipo] || [];
        const padroes = tipo.campos.filter(c => camposPadrao.includes(c.k));
        const salvos = guardar.ler('czs-padroes-' + col.id) || {};
        $('#conteudo-aba').innerHTML = `
          <div class="painel rapido">
            <label class="rot" for="r-texto">Cole aqui</label>
            <textarea class="campo" id="r-texto" placeholder="Exemplos:
Popeye o Marinheiro (1933) | https://…/popeye.mp4 | https://…/capa.jpg
https://…/Naruto%20S01E01.mp4
https://archive.org/details/algum_desenho
(ou uma lista M3U inteira, ou as mensagens do @CZStreamBot)">${esc(rapido.texto)}</textarea>
            <div class="exemplos"><span>Nome | link | capa</span><span>links soltos</span><span>lista M3U</span><span>mensagens do @CZStreamBot</span><span>archive.org</span><span>"Série S01E02" vira episódio</span></div>
            ${padroes.length ? `<div class="padroes">${padroes.map(c => campoHtml(Object.assign({}, c, { obrigatorio: false }), salvos[c.k], 'r')).join('')}</div>
              <div class="dica">Esses valores valem para todos os itens colados que não trouxerem o seu próprio.</div>` : ''}
            <div class="linha-acoes">
              ${col.tipo === 'video' ? `<label class="check"><input type="checkbox" id="r-wiki" ${salvos._wiki ? 'checked' : ''}> Buscar sinopse, capas e episódios ${chaves().tmdb ? '(TMDB' + (chaves().omdb ? ' + nota IMDb' : '') + ')' : '(Wikipedia — <a href="#" id="r-chaves">ponha a chave do TMDB</a> para mais)'}</label>` : '<input type="checkbox" id="r-wiki" hidden>'}
              <div class="espaco"></div>
              <button class="btn principal" id="r-analisar">Analisar</button>
            </div>
          </div>
          <div id="r-previa"></div>`;
        $('#r-texto').addEventListener('input', e => { rapido.texto = e.target.value; });
        $('#r-analisar').addEventListener('click', () => analisarRapido(col, padroes));
        const linkChaves = $('#r-chaves');
        if (linkChaves) linkChaves.addEventListener('click', ev => { ev.preventDefault(); mostrarChaves(); });
        if (rapido.previa && rapido.previa.col === col.id) desenharPrevia(col);
    }

    async function analisarRapido(col, padroes) {
        const btn = $('#r-analisar');
        const pad = lerCampos($('#conteudo-aba'), padroes.map(c => Object.assign({}, c)));
        const wiki = $('#r-wiki').checked;
        guardar.gravar('czs-padroes-' + col.id, Object.assign({}, pad, { _wiki: wiki }));
        const entradas = C.lerTextoColado(rapido.texto);
        if (!entradas.length) { aviso('Não achei nenhum link no texto colado.', 'ruim'); return; }
        let itens = C.agruparEntradas(entradas, { series: col.tipo === 'video' });
        btn.disabled = true;
        const linhas = [];
        for (let i = 0; i < itens.length; i++) {
            btn.textContent = `Analisando ${i + 1}/${itens.length}…`;
            let it = itens[i];
            if (it.categoria) it.categoria = C.traduzirCategoria(it.categoria);
            for (const [k, v] of Object.entries(pad)) if (it[k] === undefined || it[k] === '') it[k] = v;
            if (col.tipo !== 'video') delete it.audio;
            const avisos = [];
            if (it.archive && !(it.links || []).length) {
                try {
                    const a = await C.importarArchive(it.archive, fetchExterno);
                    const nomeManual = it.nome !== it.archive ? it.nome : null;
                    it = C.mesclarItem(a, Object.assign({}, it, { nome: nomeManual || a.nome }));
                    delete it.archive;
                } catch (e) { avisos.push('archive.org: ' + e.message); }
            }
            // com link do TMDB/IMDb colado, busca sempre; sem link, só se a caixinha estiver marcada
            if (col.tipo === 'video' && it.nome && (wiki || it.tmdb || it.imdb)) {
                const ch = chaves();
                const r = await C.completarItem(it, { tmdb: ch.tmdb, omdb: ch.omdb, wiki, fetchFn: fetchExterno, tipoColecao: col.tipo });
                it = r.item; avisos.push(...r.avisos);
            } else if (col.tipo === 'jogo' && it.nome && (chaves().steamgrid || (chaves().screenscraper && chaves().screenscraper.dev)) && (!it.logo || !it.video)) {
                const r = await C.completarItem(it, { steamgrid: chaves().steamgrid, screenscraper: chaves().screenscraper, fetchFn: fetchExterno, tipoColecao: 'jogo' });
                it = r.item; avisos.push(...r.avisos);
            }
            const normal = C.normalizarItem(it, col);
            const { erros } = C.validarItem(normal, col, estado.config);
            const existente = acharExistente(col, normal);
            linhas.push({ item: normal, erros, avisos, existente, incluir: !erros.length });
        }
        btn.disabled = false; btn.textContent = 'Analisar';
        rapido.previa = { col: col.id, linhas };
        desenharPrevia(col);
    }

    function acharExistente(col, item) {
        const alvo = C.normText(item.nome);
        const sub = col.subpasta;
        return estado.indice.find(i => i.caminho.startsWith('conteudo/' + col.id + '/') && C.normText(i.nome) === alvo &&
            (!sub || i.caminho.split('/')[2] === C.slugify(item[sub] || 'outros'))) || null;
    }

    function desenharPrevia(col) {
        const { linhas } = rapido.previa;
        const ok = linhas.filter(l => l.incluir).length;
        const resumo = l => {
            const eps = C.contarEpisodios(l.item);
            if (eps) return `série · ${l.item.temporadas.length} temp. · ${eps} ep.`;
            return { video: 'filme/avulso', canal: [l.item.pais, l.item.categoria].filter(Boolean).join(' · ') || 'canal', radio: l.item.pais || 'rádio', jogo: l.item.console || 'jogo', canal24h: 'canal 24h' }[col.tipo];
        };
        $('#r-previa').innerHTML = `
          <div class="painel" style="margin-top:16px">
            <div class="linha-acoes" style="margin-top:0">
              <b>${linhas.length} encontrados</b><span class="dica">${ok} prontos para salvar</span>
              <div class="espaco"></div>
              <button class="btn principal" id="r-salvar" ${ok ? '' : 'disabled'}>Salvar ${ok} ${ok === 1 ? 'item' : 'itens'}</button>
            </div>
            <div class="tabela-rolagem"><table class="tabela">
              <thead><tr><th style="width:36px"><span class="sr">Incluir</span></th><th>Nome</th><th>O que é</th><th>Destino</th></tr></thead>
              <tbody>${linhas.map((l, i) => `
                <tr>
                  <td><input type="checkbox" data-inc="${i}" ${l.incluir ? 'checked' : ''} ${l.erros.length ? 'disabled' : ''} aria-label="Incluir ${esc(l.item.nome)}"></td>
                  <td><input class="campo" data-nome="${i}" value="${esc(l.item.nome)}" aria-label="Nome">
                    ${l.erros.length ? `<div class="erros">${l.erros.map(esc).join('<br>')}</div>` : ''}
                    ${l.avisos.length ? `<div class="dica">${l.avisos.map(esc).join('<br>')}</div>` : ''}</td>
                  <td>${esc(resumo(l))}${l.item.ano ? ' · ' + l.item.ano : ''}</td>
                  <td>${l.erros.length ? '<span class="tag erro">com erro</span>' : l.existente ? `<span class="tag junta" title="${esc(l.existente.caminho)}">junta com o existente</span>` : '<span class="tag novo">novo</span>'}</td>
                </tr>`).join('')}</tbody>
            </table></div>
          </div>`;
        $$('[data-inc]').forEach(c => c.onchange = () => { linhas[+c.dataset.inc].incluir = c.checked; desenharPrevia(col); });
        $$('[data-nome]').forEach(c => c.onchange = () => {
            const l = linhas[+c.dataset.nome];
            l.item.nome = c.value.trim();
            l.erros = C.validarItem(l.item, col, estado.config).erros;
            l.existente = acharExistente(col, l.item);
            l.incluir = !l.erros.length;
            desenharPrevia(col);
        });
        $('#r-salvar').onclick = () => salvarRapido(col);
    }

    async function salvarRapido(col) {
        const btn = $('#r-salvar');
        const escolhidos = rapido.previa.linhas.filter(l => l.incluir);
        const mudancas = [];
        const ocupados = new Set(estado.indice.map(i => i.caminho));
        try {
            btn.disabled = true; btn.textContent = 'Preparando…';
            const porCaminho = new Map(); // dois colados com o mesmo nome viram um só
            for (const l of escolhidos) {
                const existente = l.existente || null;
                if (existente) {
                    const atual = porCaminho.get(existente.caminho) || C.normalizarItem(await estado.repo.ler(existente.caminho), col);
                    porCaminho.set(existente.caminho, C.mesclarItem(atual, l.item));
                    continue;
                }
                const novoNoLote = [...porCaminho.entries()].find(([c, it]) => !ocupados.has(c) && C.normText(it.nome) === C.normText(l.item.nome) && C.caminhoItem(col, it).split('/').slice(0, -1).join('/') === C.caminhoItem(col, l.item).split('/').slice(0, -1).join('/'));
                if (novoNoLote) { porCaminho.set(novoNoLote[0], C.mesclarItem(novoNoLote[1], l.item)); continue; }
                const base = C.caminhoItem(col, l.item);
                const pasta = base.slice(0, base.lastIndexOf('/') + 1);
                const nomesNaPasta = new Set([...ocupados, ...porCaminho.keys()].filter(c => c.startsWith(pasta) && !c.slice(pasta.length).includes('/')).map(c => c.slice(pasta.length).replace(/\.json$/, '')));
                const caminho = C.caminhoItem(col, l.item, C.slugLivre(C.slugify(l.item.nome), nomesNaPasta));
                porCaminho.set(caminho, l.item);
            }
            for (const [caminho, item] of porCaminho) mudancas.push({ caminho, conteudo: C.serializar(item) });
            await gravar(mudancas, `Studio: +${mudancas.length} em ${col.nome} (adição rápida)`, btn);
            rapido.previa = null; rapido.texto = '';
            estado.aba = 'itens';
            desenharArea();
        } catch (e) {
            btn.disabled = false; btn.textContent = 'Tentar de novo';
        }
    }

    // ==================================================================
    // Links publicados
    // ==================================================================
    function mostrarPublicacao() {
        const cfg = estado.config;
        const base = cfg.publicacao.baseUrl;
        const fundo = document.createElement('div');
        fundo.className = 'fundo-modal';
        const linhas = cfg.colecoes.map(c => {
            const arqs = c.tipo === 'jogo' ? [`${c.id}.json`, `${c.id}/<console>.json`] : [`${c.id}.json`].concat(['canal', 'canal24h', 'radio'].includes(c.tipo) ? [`${c.id}.m3u`] : []);
            return `<tr><td>${esc(c.icone || '')} ${esc(c.nome)}</td><td>${arqs.map(a => a.includes('<') ? `<code>${esc(base + a)}</code>` : `<a href="${esc(base + a)}" target="_blank" rel="noopener">${esc(a)}</a>`).join('<br>')}</td></tr>`;
        }).join('');
        fundo.innerHTML = `
          <div class="gaveta" role="dialog" aria-modal="true" aria-labelledby="pub-t">
            <h2 id="pub-t">Links publicados</h2>
            <p class="dica">Estes endereços nunca mudam. O cartoonzine-cloud lê daqui; o TVzine e players IPTV podem usar os .m3u direto.</p>
            <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Coleção</th><th>Arquivos</th></tr></thead><tbody>${linhas}</tbody></table></div>
            <div class="painel" style="margin-top:18px">
              <b>Ligar ao cartoonzine-cloud (uma vez só)</b>
              <p class="dica">No seu PC, com os dois repositórios lado a lado:</p>
              <pre class="json">node tools/ligar-cloud.mjs ../cartoonzine-cloud/sources.json</pre>
              <p class="dica">Isso preenche as vagas vazias do sources.json (Cartoons VOD, Animes, Desenhos 24 Horas, Rádios, cada console…) com os links acima. Lista completa: <a href="${esc(base)}fontes-cloud.json" target="_blank" rel="noopener">fontes-cloud.json</a> · Resumo: <a href="${esc(base)}index.json" target="_blank" rel="noopener">index.json</a> · Erros: <a href="${esc(base)}relatorio.json" target="_blank" rel="noopener">relatorio.json</a></p>
            </div>
            ${estado.repo.modo === 'github' ? `<p><a href="https://github.com/${esc(estado.repo.repo)}/actions" target="_blank" rel="noopener">Ver o robô publicando (GitHub Actions) →</a></p>` : ''}
            <div class="linha-acoes"><button class="btn" id="pub-fechar">Fechar</button></div>
          </div>`;
        document.body.appendChild(fundo);
        const fechar = () => fundo.remove();
        $('#pub-fechar', fundo).onclick = fechar;
        fundo.addEventListener('mousedown', ev => { if (ev.target === fundo) fechar(); });
    }

    // ==================================================================
    // Início
    // ==================================================================
    $('#btn-publicacao').addEventListener('click', mostrarPublicacao);
    $('#btn-chaves').addEventListener('click', mostrarChaves);
    $('#btn-sair').addEventListener('click', () => {
        guardar.apagar('czs-github');
        estado.repo = null;
        $('#status').textContent = 'desconectado'; $('#status').className = 'chip';
        $('#btn-sair').hidden = true; $('#btn-publicacao').hidden = true; $('#btn-chaves').hidden = true;
        telaConectar();
    });

    (async function iniciar() {
        if (location.protocol !== 'file:') {
            try { await conectar(new RepoLocal()); return; } catch (e) { /* não é o servidor local */ }
        }
        const gh = guardar.ler('czs-github');
        if (gh && gh.token) {
            try { await conectar(new RepoGitHub(gh)); return; } catch (e) { return telaConectar(e.message); }
        }
        telaConectar();
    })();
})();
