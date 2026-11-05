/**
 * 🧩 PRATELEIRA (cartoonzine-jogos) — a parte "inteligente", sem tela: lê o link de um repositório de jogo,
 * analisa o que o GitHub conta dele e monta a ficha (jogos.json) e uma receita automática (receitas/<id>.sh).
 * Usado pelo painel (painel/prateleira.js) e pelos testes (test/prateleira.test.mjs).
 */
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica();
    else raiz.CZPrateleiraCore = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // licenças de código livre reconhecidas pelo GitHub (spdx_id)
    const LIVRES = ['GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later', 'LGPL-2.1', 'LGPL-2.1-only',
        'LGPL-2.1-or-later', 'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'AGPL-3.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Zlib', 'Apache-2.0',
        'MPL-2.0', 'ISC', 'Unlicense', 'CC0-1.0', 'Artistic-2.0', 'EUPL-1.2', 'BSL-1.0', 'WTFPL', '0BSD'];

    /** "https://github.com/dono/repo(.git)(/tree/branch)" → { dono, repo, branch } (ou null) */
    function repoDoLink(link) {
        const m = /^\s*(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^?#\s]+))?\/?(?:[?#].*)?\s*$/i.exec(String(link || ''));
        if (!m) return null;
        return { dono: m[1], repo: m[2], branch: m[3] ? decodeURIComponent(m[3]).replace(/\/+$/, '') : '' };
    }

    /** id curto e seguro para pasta/arquivo: "OpenTyrian 2000!" → "opentyrian-2000" */
    function idDoNome(nome) {
        return String(nome || 'jogo').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'jogo';
    }

    /**
     * Analisa o repositório.
     *   info     = resposta de GET /repos/{dono}/{repo}
     *   caminhos = lista de arquivos da árvore (GET /git/trees/{branch}?recursive=1 → tree[].path)
     *   textos   = README + arquivos de build (CMakeLists.txt, Makefile, configure.ac…) juntos
     *   branches = nomes dos branches (para achar um "emscripten" / "web" / "wasm")
     */
    function analisarRepo({ info = {}, caminhos = [], textos = '', branches = [], link = '' } = {}) {
        const avisos = [];
        const tem = (re) => caminhos.some(c => re.test(c));
        const raizTem = (nome) => caminhos.includes(nome);
        const lic = info.license || {};
        const spdx = lic.spdx_id && lic.spdx_id !== 'NOASSERTION' ? lic.spdx_id : '';
        const licenca = { spdx, nome: lic.name || (spdx || 'sem licença'), livre: LIVRES.includes(spdx) };
        if (!spdx) avisos.push(lic.name ? 'O GitHub não reconheceu a licença ("' + lic.name + '"): confira o arquivo de licença à mão.' : 'O repositório não tem licença: sem licença o código NÃO é livre para publicar.');
        else if (!licenca.livre) avisos.push('Licença "' + spdx + '" não está na lista de licenças livres conhecidas: confira antes de publicar.');

        // tipo de projeto (como ele é compilado)
        let tipo = 'desconhecido';
        if (raizTem('CMakeLists.txt')) tipo = 'cmake';
        else if (raizTem('meson.build')) tipo = 'meson';
        else if (raizTem('configure.ac') || raizTem('configure.in') || raizTem('configure')) tipo = 'autotools';
        else if (raizTem('Makefile') || raizTem('makefile') || raizTem('GNUmakefile')) tipo = 'make';
        else if (tem(/\.sln$/i)) tipo = 'visualstudio';
        const t = String(textos || '');
        let sdl = null;
        if (/SDL2|SDL_2|sdl2-config|USE_SDL=2|find_package\s*\(\s*SDL2/i.test(t) || tem(/SDL2/)) sdl = 'sdl2';
        else if (/SDL[_ ]?1\.2|sdl-config|\bSDL\.h\b|find_package\s*\(\s*SDL\b/i.test(t)) sdl = 'sdl1';
        else if (/SDL3/i.test(t)) sdl = 'sdl3';

        // já tem versão web? (branch próprio, pasta, ou o build fala de emscripten)
        const branchWeb = branches.find(b => /^(emscripten|web|wasm|html5|browser)$/i.test(b)) || '';
        const temWeb = !!branchWeb || /emscripten|emcmake|emmake|emcc\b|webassembly|\bwasm\b/i.test(t) || tem(/(^|\/)(emscripten|web|wasm)\//i);
        if (tipo === 'visualstudio') avisos.push('Projeto só para Visual Studio (Windows): é difícil compilar para a web sem adaptar.');
        if (tipo === 'desconhecido') avisos.push('Não reconheci como o jogo é compilado (sem CMake/Makefile/meson na raiz): a receita vai precisar de ajuste.');
        if (sdl === 'sdl1') avisos.push('Usa SDL 1.2: o Emscripten tem suporte, mas costuma precisar de ajustes.');
        if (info.archived) avisos.push('O repositório está arquivado (sem manutenção).');

        const nome = String(info.name || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
        const original = info.html_url || link;
        const facil = (temWeb || tipo === 'cmake' || tipo === 'make') && sdl !== 'sdl1' && tipo !== 'visualstudio' && tipo !== 'desconhecido';
        return {
            id: idDoNome(info.name || nome),
            nome: nome || info.full_name || 'Jogo',
            descricao: String(info.description || '').trim(),
            site: info.homepage || '',
            topicos: Array.isArray(info.topics) ? info.topics.slice(0, 8) : [],
            linguagem: info.language || '',
            estrelas: info.stargazers_count || 0,
            ano: info.created_at ? parseInt(String(info.created_at).slice(0, 4), 10) : undefined,
            original,
            branchPadrao: info.default_branch || 'main',
            branchWeb,
            licenca, tipo, sdl, temWeb, facil, avisos,
            capa: info.owner && info.name ? 'https://opengraph.githubassets.com/1/' + info.owner.login + '/' + info.name : ''
        };
    }

    /** Entrada do jogos.json. "rascunho": true = o robô ainda não compila (receita para conferir). */
    function entradaJogo(a, extras = {}) {
        const e = {
            id: extras.id || a.id,
            nome: extras.nome || a.nome,
            ano: extras.ano || a.ano,
            licenca: extras.licenca || (a.licenca.spdx || a.licenca.nome),
            fonte: extras.fonte || (a.original + (a.branchWeb ? '/tree/' + a.branchWeb : '')),
            original: a.original,
            descricao: extras.descricao != null ? extras.descricao : a.descricao,
            controles: extras.controles || 'teclado',
            generos: extras.generos || []
        };
        if (extras.teclas) e.teclas = extras.teclas;
        if (!e.ano) delete e.ano;
        if (extras.rascunho !== false) e.rascunho = true;
        return e;
    }

    /** Receita automática (rascunho) para o tipo de projeto. Usa as funções de receitas/comum.sh. */
    function receitaAutomatica(a, extras = {}) {
        const nome = (extras.nome || a.nome).replace(/["$`\\]/g, '');
        const git = a.original.replace(/\/$/, '') + (/\.git$/.test(a.original) ? '' : '.git');
        const branch = a.branchWeb || a.branchPadrao || 'main';
        const sdlFlags = a.sdl === 'sdl2' ? ' -sUSE_SDL=2' : a.sdl === 'sdl1' ? ' -sUSE_SDL=1' : '';
        const lk = `-sALLOW_MEMORY_GROWTH=1 -sASYNCIFY${sdlFlags}`;
        const cab = `. "$RAIZ/receitas/comum.sh"
# ⚙️ RECEITA AUTOMÁTICA (feita pela Prateleira da Studio) — tipo: ${a.tipo}${a.sdl ? ' · ' + a.sdl : ''}${a.temWeb ? ' · já tem versão web' : ''}
# Se o robô falhar, ajuste aqui (dependências, opções do Emscripten, arquivos de dados) e tire o "rascunho" no jogos.json.
baixar_fonte ${git} ${branch}
`;
        let corpo;
        if (a.tipo === 'cmake') corpo = `emcmake cmake -S . -B web -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS="${sdlFlags.trim()}" -DCMAKE_CXX_FLAGS="${sdlFlags.trim()}" -DCMAKE_EXE_LINKER_FLAGS="${lk}"
cmake --build web -j"$(nproc)"
publicar_saida web "${nome}"`;
        else if (a.tipo === 'make') corpo = `emmake make -j"$(nproc)" CC=emcc CXX=em++ LDFLAGS="${lk}"
publicar_saida . "${nome}"`;
        else if (a.tipo === 'autotools') corpo = `[ -f configure ] || autoreconf -fi
emconfigure ./configure --host=wasm32-unknown-emscripten
emmake make -j"$(nproc)" LDFLAGS="${lk}"
publicar_saida . "${nome}"`;
        else if (a.tipo === 'meson') corpo = `# meson: precisa de um arquivo "cross" do Emscripten — ajuste à mão
echo "receita meson ainda não feita" && exit 1`;
        else corpo = `# não reconheci como o jogo compila: escreva os comandos do Emscripten aqui
echo "receita ainda não feita" && exit 1`;
        return cab + corpo + '\n';
    }

    /** O jogo já está na prateleira? (mesmo id ou mesmo repositório original) */
    function jaExiste(jogos, a) {
        const norm = (u) => String(u || '').toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '').replace(/\/tree\/.*$/, '');
        return (jogos || []).find(j => j.id === a.id || (a.original && (norm(j.original) === norm(a.original) || norm(j.fonte) === norm(a.original)))) || null;
    }

    /** Põe a ficha no fim da lista "jogos" mantendo o jeito do arquivo (um jogo por bloco). */
    function inserirNoJogosJson(texto, entrada) {
        const dados = JSON.parse(texto);
        if (!Array.isArray(dados.jogos)) throw new Error('jogos.json sem a lista "jogos"');
        if (dados.jogos.some(j => j.id === entrada.id)) throw new Error('Já existe um jogo com o id "' + entrada.id + '"');
        const val = v => Array.isArray(v) ? '[' + v.map(x => JSON.stringify(x)).join(', ') + ']' : JSON.stringify(v);
        const linha = '{ ' + Object.keys(entrada).filter(k => entrada[k] !== undefined).map(k => JSON.stringify(k) + ': ' + val(entrada[k])).join(', ') + ' }';
        const fim = texto.lastIndexOf(']');
        const antes = texto.slice(0, fim).replace(/\s+$/, '');
        let novo = antes + (dados.jogos.length ? ',' : '') + '\n    ' + linha + '\n  ' + texto.slice(fim);
        try { const v = JSON.parse(novo); if (v.jogos.length === dados.jogos.length + 1 && v.jogos[v.jogos.length - 1].id === entrada.id) return novo; } catch (e) { /* cai no plano B */ }
        dados.jogos.push(entrada);
        return JSON.stringify(dados, null, 2) + '\n';
    }

    // ------------------------------------------------------------------ Parte 2: fila e cadastro
    const PAGINA = id => 'https://cartoonzine.github.io/cartoonzine-jogos/' + id + '/';

    /**
     * Situação de cada jogo da prateleira.
     *   publicados = pastas que existem no branch gh-pages (jogos já no ar)
     *   jobs       = jobs da última execução do robô "construir" ([{ name: 'jogo (<id>)', status, conclusion, html_url }])
     * → [{ jogo, estado: 'rascunho'|'compilando'|'falhou'|'pronto'|'aguardando', noAr, job }]
     */
    function statusDosJogos(jogos, publicados = [], jobs = []) {
        const noAr = new Set(publicados);
        const porId = new Map();
        for (const j of jobs || []) { const m = /^jogo \((.+)\)$/.exec(j.name || ''); if (m) porId.set(m[1], j); }
        return (jogos || []).map(jogo => {
            const job = porId.get(jogo.id) || null;
            const ar = noAr.has(jogo.id);
            let estado = ar ? 'pronto' : 'aguardando';
            if (jogo.rascunho) estado = 'rascunho';
            else if (job && job.status !== 'completed') estado = 'compilando';
            else if (job && job.conclusion && job.conclusion !== 'success' && job.conclusion !== 'skipped') estado = 'falhou';
            return { jogo, estado, noAr: ar, job };
        });
    }

    /** Tira o "rascunho": true de um jogo no jogos.json (sem mexer no resto do arquivo). */
    function tirarRascunho(texto, id) {
        const dados = JSON.parse(texto);
        const alvo = (dados.jogos || []).find(j => j.id === id);
        if (!alvo) throw new Error('Não achei o jogo "' + id + '" no jogos.json');
        if (!alvo.rascunho) return texto;
        const ini = texto.indexOf('"id": "' + id + '"') >= 0 ? texto.indexOf('"id": "' + id + '"') : texto.indexOf('"id":"' + id + '"');
        if (ini >= 0) {
            const prox = texto.indexOf('"id"', ini + 5);
            const fim = prox < 0 ? texto.length : prox;
            const trecho = texto.slice(ini, fim).replace(/,\s*"rascunho"\s*:\s*true/, '');
            const novo = texto.slice(0, ini) + trecho + texto.slice(fim);
            try { const v = JSON.parse(novo); const j = v.jogos.find(x => x.id === id); if (j && !j.rascunho && v.jogos.length === dados.jogos.length) return novo; } catch (e) { /* plano B */ }
        }
        delete alvo.rascunho;
        return JSON.stringify(dados, null, 2) + '\n';
    }

    /** Ficha do jogo para a coleção "Jogos Web" da Studio (mesmo jeito dos que já estão lá). */
    function itemJogosWeb(jogo, { console: sistema = 'web-pc', capas = [] } = {}) {
        const base = 'https://cartoonzine.github.io/cartoonzine-jogos/capas/' + jogo.id;
        const item = {
            nome: jogo.nome || jogo.id,
            links: [PAGINA(jogo.id)],
            site: jogo.original || jogo.fonte || '',
            fonte: 'https://github.com/cartoonzine/cartoonzine-jogos',
            repo: jogo.original || jogo.fonte || '',
            descricao: (jogo.descricao ? jogo.descricao.replace(/\s*\.?\s*$/, '.') + ' ' : '') + 'Jogo livre (' + (jogo.licenca || 'código aberto') + '), hospedado sem propaganda no Cartoonzine Jogos.',
            ano: jogo.ano,
            generos: jogo.generos || [],
            engine: 'Emscripten',
            teclas: jogo.teclas,
            console: sistema,
            licenca: 'livre',
            controles: jogo.controles || 'teclado',
            _origem: 'prateleira:cartoonzine-jogos'
        };
        if (capas.includes(jogo.id + '.jpg')) item.capa = base + '.jpg';
        if (capas.includes(jogo.id + '-banner.jpg')) { item.banner = base + '-banner.jpg'; item.fundoImagem = 'banner'; }
        Object.keys(item).forEach(k => { if (item[k] === undefined || item[k] === '') delete item[k]; });
        return item;
    }

    /** Já está em Jogos Web? (pelo nome do arquivo ou pelo nome do jogo) — índice = [{ caminho, nome }] */
    function jaCadastrado(indice, jogo) {
        const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const id = norm(jogo.id), nome = norm(jogo.nome);
        return (indice || []).find(i => i.caminho && i.caminho.startsWith('conteudo/jogos-web/') &&
            (norm(i.caminho.split('/').pop().replace(/\.json$/, '')).includes(id) || (nome && norm(i.nome) === nome))) || null;
    }

    return { LIVRES, repoDoLink, idDoNome, analisarRepo, entradaJogo, receitaAutomatica, jaExiste, inserirNoJogosJson,
        PAGINA, statusDosJogos, tirarRascunho, itemJogosWeb, jaCadastrado };
});
