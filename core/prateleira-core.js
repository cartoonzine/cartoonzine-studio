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

    // ==================================================================
    // ANÁLISE DETERMINÍSTICA (só regras: nada de IA, nada de executar o que o README manda)
    // ==================================================================

    /**
     * Dependências conhecidas. port = opções do Emscripten que resolvem; null = não existe port (revisão humana).
     * regras = expressões procuradas, LINHA A LINHA, nos arquivos de build (comentários ignorados).
     * Mesma lista (por id) que cartoonzine-jogos/modelo/dependencias.json, usada no diagnóstico dos logs.
     */
    const DEPENDENCIAS = [
        { id: 'sdl2', nome: 'SDL2', port: ['-sUSE_SDL=2'], regras: [/find_package\s*\(\s*SDL2\s*[\s)]/i, /pkg_check_modules\s*\([^)]*\bsdl2\b/i, /sdl2-config/i, /-lSDL2\b(?!_)/, /PKG_CHECK_MODULES\s*\(\s*\[?\w+\]?\s*,\s*\[?\s*sdl2\b/i, /dependency\s*\(\s*'sdl2'/i, /SDL2::SDL2\b/, /-sUSE_SDL=2/] },
        { id: 'sdl1', nome: 'SDL 1.2', port: ['-sUSE_SDL=1'], regras: [/find_package\s*\(\s*SDL\s*[\s)]/i, /\bsdl-config\b/i, /-lSDL\b(?![2_])/, /AM_PATH_SDL\b/, /pkg_check_modules\s*\([^)]*\bsdl\b(?![2_])/i, /-sUSE_SDL=1/] },
        { id: 'sdl2_image', nome: 'SDL2_image', port: ['-sUSE_SDL_IMAGE=2'], regras: [/SDL2_image/i, /SDL2IMAGE/i, /-sUSE_SDL_IMAGE=2/] },
        { id: 'sdl2_mixer', nome: 'SDL2_mixer', port: ['-sUSE_SDL_MIXER=2'], regras: [/SDL2_mixer/i, /SDL2MIXER/i, /-sUSE_SDL_MIXER=2/] },
        { id: 'sdl2_ttf', nome: 'SDL2_ttf', port: ['-sUSE_SDL_TTF=2'], regras: [/SDL2_ttf/i, /SDL2TTF/i, /-sUSE_SDL_TTF=2/] },
        { id: 'sdl2_net', nome: 'SDL2_net', port: ['-sUSE_SDL_NET=2'], regras: [/SDL2_net/i, /SDL2NET/i, /-sUSE_SDL_NET=2/] },
        { id: 'sdl2_gfx', nome: 'SDL2_gfx', port: ['-sUSE_SDL_GFX=2'], regras: [/SDL2_gfx/i, /-sUSE_SDL_GFX=2/] },
        { id: 'sdl1_image', nome: 'SDL_image 1.2', port: ['-sUSE_SDL_IMAGE=1'], regras: [/-lSDL_image\b/, /\bSDL_image\b.*(find_package|pkg_check|PKG_CHECK)/i, /(find_package|pkg_check_modules|PKG_CHECK_MODULES)\s*\([^)]*\bSDL_image\b/i] },
        { id: 'sdl1_mixer', nome: 'SDL_mixer 1.2', port: ['-sUSE_SDL_MIXER=1'], regras: [/-lSDL_mixer\b/, /(find_package|pkg_check_modules|PKG_CHECK_MODULES)\s*\([^)]*\bSDL_mixer\b/i] },
        { id: 'freetype', nome: 'FreeType', port: ['-sUSE_FREETYPE=1'], regras: [/find_package\s*\(\s*Freetype/i, /-lfreetype\b/, /\bfreetype2\b/, /-sUSE_FREETYPE/] },
        { id: 'zlib', nome: 'zlib', port: ['-sUSE_ZLIB=1'], regras: [/find_package\s*\(\s*ZLIB/i, /-lz\b/, /-sUSE_ZLIB/] },
        { id: 'libpng', nome: 'libpng', port: ['-sUSE_LIBPNG=1'], regras: [/find_package\s*\(\s*PNG\b/i, /-lpng\d*\b/, /\blibpng\b/i, /-sUSE_LIBPNG/] },
        { id: 'libjpeg', nome: 'libjpeg', port: ['-sUSE_LIBJPEG=1'], regras: [/find_package\s*\(\s*JPEG\b/i, /-ljpeg\b/, /-sUSE_LIBJPEG/] },
        { id: 'ogg', nome: 'libogg', port: ['-sUSE_OGG=1'], regras: [/find_package\s*\(\s*Ogg\b/i, /-logg\b/, /-sUSE_OGG/] },
        { id: 'vorbis', nome: 'libvorbis', port: ['-sUSE_VORBIS=1'], regras: [/find_package\s*\(\s*Vorbis/i, /-lvorbis(file)?\b/, /-sUSE_VORBIS/] },
        { id: 'openal', nome: 'OpenAL', port: ['-lopenal'], regras: [/find_package\s*\(\s*OpenAL/i, /-lopenal\b/i] },
        { id: 'opengl', nome: 'OpenGL/WebGL', port: ['-lGL'], regras: [/find_package\s*\(\s*OpenGL\b/i, /-lGL\b/, /-lGLESv2\b/, /-sFULL_ES[23]/] },
        // sem port no Emscripten → revisão necessária (receita própria, como a do AstroMenace com o freealut)
        { id: 'alut', nome: 'ALUT (freealut)', port: null, externa: 'freealut', nota: 'não faz parte do OpenAL do Emscripten: a receita precisa compilar o freealut', regras: [/\balut\b/i, /freealut/i] },
        { id: 'gl4es', nome: 'GL4ES', port: null, externa: 'gl4es', nota: 'camada OpenGL→WebGL que precisa ser compilada na receita', regras: [/gl4es/i] },
        { id: 'glu', nome: 'GLU', port: null, nota: 'o Emscripten não tem GLU', regras: [/find_package\s*\(\s*GLU\b/i, /-lGLU\b/, /OpenGL::GLU\b/, /\blibGLU\b/] },
        { id: 'glew', nome: 'GLEW', port: null, nota: 'confira se funciona com o GLEW emulado do Emscripten', regras: [/find_package\s*\(\s*GLEW/i, /-lGLEW\b/] },
        { id: 'boost', nome: 'Boost', port: null, nota: 'sem port: a receita precisa baixar/compilar', regras: [/find_package\s*\(\s*Boost/i, /-lboost_/] },
        { id: 'lua', nome: 'Lua', port: null, nota: 'sem port: o projeto precisa trazer a Lua junto ou a receita compila', regras: [/find_package\s*\(\s*Lua/i, /-llua(jit)?[\d.]*\b/, /\blua5\.\d\b/i] },
        { id: 'physfs', nome: 'PhysicsFS', port: null, nota: 'sem port: a receita precisa compilar', regras: [/physfs/i] },
        { id: 'curl', nome: 'libcurl', port: null, nota: 'não há rede de verdade no navegador: precisa revisão', regras: [/find_package\s*\(\s*CURL/i, /-lcurl\b/] },
        { id: 'qt', nome: 'Qt', port: null, nota: 'Qt não é suportado por estas receitas', regras: [/find_package\s*\(\s*Qt[56]?\b/i] },
        { id: 'gtk', nome: 'GTK', port: null, nota: 'GTK não roda no navegador', regras: [/\bgtk\+?-?[234]\.?\d*\b/i, /find_package\s*\(\s*GTK/i] },
        { id: 'allegro', nome: 'Allegro', port: null, nota: 'sem port nestas receitas', regras: [/\ballegro\b/i] }
    ];

    // opções de Emscripten aceitas de ajustes/guia (lista branca: nada de caractere de shell)
    const RE_FLAG_S = /^-s[A-Z][A-Z0-9_]*(=[A-Za-z0-9_.,\[\]-]+)?$/;
    const RE_FLAG_LINK = /^(-s[A-Z][A-Z0-9_]*(=[A-Za-z0-9_.,\[\]-]+)?|-l[A-Za-z0-9_+-]+|--closure=?[01]|-O[0-3sz])$/;
    const RE_FLAG_COMP = /^(-s[A-Z][A-Z0-9_]*(=[A-Za-z0-9_.,\[\]-]+)?|-D[A-Za-z_][A-Za-z0-9_]*(=[A-Za-z0-9_.-]+)?|-I[A-Za-z0-9_./-]+|-O[0-3sz]|-f[a-z0-9-]+|-Wno-[a-z0-9-]+|-std=[a-z0-9+]+|-include=?[A-Za-z0-9_./-]+)$/;
    const RE_CMAKE_OP = /^-D[A-Za-z_][A-Za-z0-9_]*(:[A-Z]+)?=[A-Za-z0-9_.,\/+-]*$/;
    const RE_CONF_OP = /^--[a-z0-9-]+(=[A-Za-z0-9_.,\/+-]+)?$/;
    const RE_CAMINHO = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_.\/-]+$/;
    const ARQ_BUILD = /(^|\/)(CMakeLists\.txt|Makefile|makefile|GNUmakefile|Makefile\.am|configure\.ac|configure\.in|meson\.build)$/;
    const PASTAS_DADOS = /^(data|gamedata|assets|res|resources|graphics|gfx|images|sound|sounds|sfx|music|levels|maps|fonts|lang|themes|rooms|sprites)$/i;
    const EXEC_AUXILIAR = /(test|tool|editor|server|example|demo|bench|conv|gen|pack)/i;

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

    /** Arquivos de build que valem a pena ler (raiz e até 2 níveis): a tela busca o texto deles na API. */
    function arquivosParaLer(caminhos) {
        const build = caminhos.filter(c => ARQ_BUILD.test(c) && c.split('/').length <= 3)
            .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).slice(0, 12);
        const guia = caminhos.find(c => /^(docs\/)?(emscripten|build[_-]?(web|emscripten|wasm)|web|wasm)\.md$/i.test(c)) || '';
        return { build, guia };
    }

    /** Onde está o build (raiz ou subpasta) e de que tipo. Prefere o mais raso; no mesmo nível: CMake > meson > autotools > make. */
    function tipoDoBuild(caminhos) {
        const ordem = [['cmake', /(^|\/)CMakeLists\.txt$/], ['meson', /(^|\/)meson\.build$/], ['autotools', /(^|\/)configure\.(ac|in)$/], ['make', /(^|\/)(Makefile|makefile|GNUmakefile)$/]];
        for (let nivel = 1; nivel <= 3; nivel++) {
            for (const [tipo, re] of ordem) {
                const achados = caminhos.filter(c => re.test(c) && c.split('/').length === nivel);
                if (achados.length) {
                    const dir = achados[0].includes('/') ? achados[0].slice(0, achados[0].lastIndexOf('/')) : '';
                    return { tipo, subdir: dir, arquivo: achados[0], outros: achados.slice(1) };
                }
            }
        }
        if (caminhos.some(c => /\.sln$/i.test(c))) return { tipo: 'visualstudio', subdir: '', arquivo: caminhos.find(c => /\.sln$/i.test(c)), outros: [] };
        return { tipo: 'desconhecido', subdir: '', arquivo: '', outros: [] };
    }

    /** Linhas úteis de um arquivo de build (sem comentários). */
    function linhasSemComentario(arquivo, texto) {
        const com = /meson\.build$|CMakeLists\.txt$|Makefile|makefile|\.am$/.test(arquivo) ? /^\s*#/ : /^\s*(#|dnl\b)/;
        return String(texto || '').split(/\r?\n/).map((l, i) => ({ l, n: i + 1 })).filter(x => x.l.trim() && !com.test(x.l));
    }

    /**
     * Analisa o repositório SÓ com regras.
     *   info      = GET /repos/{dono}/{repo}
     *   caminhos  = arquivos da árvore (GET /git/trees/{commit}?recursive=1)
     *   arquivos  = { caminho: texto } dos arquivos de build lidos (arquivosParaLer().build)
     *   guia      = texto do EMSCRIPTEN.md (ou parecido), lido como DADO: só opções da lista branca viram evidência
     *   commit    = sha do commit analisado (o build usa exatamente ele)
     *   manifesto = cartoonzine-jogos/modelo/dependencias-externas.json (.externas): dependências sem port que a receita
     *               PODE compilar (repo + commit fixo + licença). Fora dele = revisão.
     * → { ..., evidencias: [{ tipo, valor, arquivo, linha, trecho, regra, confianca }], classificacao: 'candidata'|'revisao', motivos, ajustes }
     */
    function analisarRepo({ info = {}, caminhos = [], arquivos = {}, guia = '', guiaArquivo = '', branches = [], commit = '', branch = '', link = '', manifesto = [] } = {}) {
        const evidencias = [], motivos = [], avisos = [];
        const ev = (tipo, valor, extra) => evidencias.push(Object.assign({ tipo, valor }, extra));

        // licença (do GitHub) — só do CÓDIGO; a dos dados é confirmação humana separada
        const lic = info.license || {};
        const spdx = lic.spdx_id && lic.spdx_id !== 'NOASSERTION' ? lic.spdx_id : '';
        const licenca = { spdx, nome: lic.name || (spdx || 'sem licença'), livre: LIVRES.includes(spdx) };
        ev('licenca', spdx || lic.name || 'nenhuma', { arquivo: 'API do GitHub (license)', regra: 'spdx_id na lista de licenças livres', confianca: spdx ? 'alta' : 'baixa' });
        if (!spdx) motivos.push(lic.name ? `O GitHub não reconheceu a licença ("${lic.name}"): confira à mão.` : 'O repositório não tem licença: o código não é livre para publicar.');
        else if (!licenca.livre) motivos.push(`Licença "${spdx}" fora da lista de licenças livres conhecidas.`);

        // tipo de build (raiz ou subpasta)
        const b = tipoDoBuild(caminhos);
        ev('build', b.tipo, { arquivo: b.arquivo || '(nenhum)', regra: 'arquivo de build mais raso: CMake > meson > autotools > make', confianca: b.arquivo ? 'alta' : 'baixa' });
        if (b.subdir) avisos.push(`O build fica na subpasta "${b.subdir}".`);
        if (b.tipo === 'meson') motivos.push('Projeto Meson: ainda não há template de receita para Meson.');
        if (b.tipo === 'visualstudio') motivos.push('Projeto só para Visual Studio (Windows): sem template.');
        if (b.tipo === 'desconhecido') motivos.push('Não achei CMakeLists.txt, configure.ac, meson.build nem Makefile (até 2 pastas de profundidade).');

        // dependências: linha a linha nos arquivos de build (confiança alta)
        const deps = new Map();
        const nomesArq = Object.keys(arquivos).filter(c => ARQ_BUILD.test(c));
        for (const arq of nomesArq) {
            for (const { l, n } of linhasSemComentario(arq, arquivos[arq])) {
                for (const d of DEPENDENCIAS) {
                    const r = d.regras.find(re => re.test(l));
                    if (!r) continue;
                    if (!deps.has(d.id)) deps.set(d.id, { dep: d, evid: [] });
                    const x = deps.get(d.id);
                    if (x.evid.length < 2) x.evid.push({ arquivo: arq, linha: n, trecho: l.trim().slice(0, 140), regra: String(r), confianca: 'alta' });
                }
            }
        }
        // guia (EMSCRIPTEN.md): DADO, nunca comando. Só opções -s… da lista branca viram evidência (confiança média)
        const flagsGuia = [];
        if (guia) {
            const blocos = [];
            String(guia).replace(/```[^\n]*\n([\s\S]*?)```/g, (_, x) => { blocos.push(x); return ''; });
            const texto = (blocos.length ? blocos.join('\n') : String(guia)).replace(/\s*\\\r?\n\s*/g, ' ');
            const vistos = new Set();
            for (const tok of texto.split(/\s+/)) {
                const t = tok.replace(/^['"]|['"]$/g, '').replace(/'/g, '').replace(/"/g, '');
                if (!RE_FLAG_S.test(t) || vistos.has(t)) continue;
                vistos.add(t);
                const nome = t.slice(2).split('=')[0];
                if (/^USE_/.test(nome)) {
                    const d = DEPENDENCIAS.find(x => x.port && x.port.includes(t)) || DEPENDENCIAS.find(x => x.port && x.port.some(p => p.split('=')[0] === t.split('=')[0]));
                    if (d && !deps.has(d.id)) deps.set(d.id, { dep: d, evid: [{ arquivo: guiaArquivo || 'guia', trecho: t, regra: 'opção -sUSE_* citada no guia', confianca: 'media' }] });
                } else if (/^(SDL2_IMAGE_FORMATS|SDL2_MIXER_FORMATS|ASYNCIFY|INITIAL_MEMORY|TOTAL_MEMORY|STACK_SIZE|FULL_ES2|FULL_ES3|LEGACY_GL_EMULATION|ALLOW_MEMORY_GROWTH)$/.test(nome)) {
                    const f = t.replace('-sTOTAL_MEMORY=', '-sINITIAL_MEMORY=').replace(/=([^\[\]]*,[^\[\]]*)$/, '=[$1]');
                    flagsGuia.push(f);
                    ev('flag', f, { arquivo: guiaArquivo || 'guia', trecho: t, regra: 'opção da lista branca citada no guia', confianca: 'media' });
                }
            }
        }
        // SDL2 já traz SDL; SDL 1.2 e 2 juntos = ficar com o 2 (o 1 costuma ser de um caminho opcional)
        if (deps.has('sdl2') && ['sdl1', 'sdl1_image', 'sdl1_mixer'].some(k => deps.has(k))) {
            avisos.push('O build cita SDL 1.2 e SDL2: usando SDL2 (as bibliotecas de SDL 1.2 saem).');
            ['sdl1', 'sdl1_image', 'sdl1_mixer'].forEach(k => deps.delete(k));
        }
        const dependencias = [...deps.values()].map(({ dep, evid }) => {
            evid.forEach(e => ev('dependencia', dep.nome, e));
            const ext = dep.externa ? (manifesto || []).find(m => m.id === dep.externa) : null;
            return { id: dep.id, nome: dep.nome, port: dep.port, externa: ext ? ext.id : null, nota: dep.nota || '', confianca: evid.some(e => e.confianca === 'alta') ? 'alta' : 'media' };
        });
        const externas = [];
        for (const d of dependencias) {
            if (d.port) continue;
            if (d.externa) {
                const m = manifesto.find(x => x.id === d.externa);
                externas.push(m.id);
                ev('externa', m.id, { arquivo: 'modelo/dependencias-externas.json', trecho: `${m.repo} @ ${m.commit.slice(0, 12)} · ${m.licenca}`, regra: `${d.nome} não tem port; está no manifesto confiável (commit fixo)`, confianca: 'alta' });
                avisos.push(`${d.nome} será compilada na receita a partir do manifesto (${m.repo.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')}@${m.commit.slice(0, 7)}, ${m.licenca}). A validação diz se compila E linka.`);
            } else motivos.push(`Dependência sem port conhecido no Emscripten: ${d.nome} — ${d.nota}${depNoManifesto(d)}.`);
        }

        // submódulos git
        const submodulos = caminhos.includes('.gitmodules');
        if (submodulos) ev('ajuste', 'submodulos', { arquivo: '.gitmodules', regra: 'o repositório usa submódulos', confianca: 'alta' });

        // alvo (executável do jogo) no CMake
        let alvo = '';
        if (b.tipo === 'cmake') {
            const execs = [];
            for (const arq of nomesArq.filter(a => /CMakeLists\.txt$/.test(a)))
                for (const { l, n } of linhasSemComentario(arq, arquivos[arq])) {
                    const m = /add_executable\s*\(\s*([A-Za-z0-9_.+-]+)/i.exec(l);
                    if (m && !m[1].startsWith('${')) execs.push({ nome: m[1], arquivo: arq, linha: n });
                }
            const jogos = [...new Map(execs.filter(e => !EXEC_AUXILIAR.test(e.nome)).map(e => [e.nome, e])).values()];
            if (jogos.length === 1) { alvo = jogos[0].nome; ev('ajuste', 'alvo=' + alvo, { arquivo: jogos[0].arquivo, linha: jogos[0].linha, regra: 'único add_executable que não é teste/ferramenta', confianca: 'alta' }); }
            else if (jogos.length > 1) avisos.push(`Vários executáveis (${jogos.map(e => e.nome).join(', ')}): escolha o do jogo no ajuste "alvo".`);
        }

        // pastas de dados (na raiz do repositório ou do build)
        const pastas = new Set();
        for (const c of caminhos) {
            const p = c.split('/');
            if (p.length > 1 && PASTAS_DADOS.test(p[0])) pastas.add(p[0]);
            if (b.subdir && c.startsWith(b.subdir + '/') && p.length > 2 && PASTAS_DADOS.test(p[1])) pastas.add(p[0] + '/' + p[1]);
        }
        const dados = [...pastas].sort().map(p => p + '@/' + p.split('/').pop());
        if (dados.length) {
            ev('ajuste', 'dados: ' + dados.join(' '), { arquivo: '(árvore de arquivos)', regra: 'pastas com nome de dados (data, assets, graphics, sound…)', confianca: 'media' });
            avisos.push('As pastas de dados entram em /<nome> no sistema de arquivos do jogo: confira se é lá que o jogo procura.');
        }

        // laço principal: sem evidência não liga ASYNCIFY sozinho
        const asyncify = flagsGuia.some(f => /^-sASYNCIFY\b/.test(f));
        const textoBuild = nomesArq.map(a => arquivos[a]).join('\n');
        if (!asyncify && !/emscripten_set_main_loop/.test(textoBuild + guia))
            avisos.push('Sem evidência sobre o laço principal: se o teste no navegador travar, acrescente "-sASYNCIFY" em flagsLinkar.');

        const nome = String(info.name || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
        const ajustes = { subdir: b.subdir, alvo, dados, submodulos, externas, flagsCompilar: [], flagsLinkar: [...new Set(flagsGuia)], cmakeOpcoes: [], configureOpcoes: [] };
        if (!/^[0-9a-f]{40}$/.test(commit)) motivos.push('Não consegui o commit exato do código (a receita precisa dele).');
        return {
            id: idDoNome(info.name || nome),
            nome: nome || info.full_name || 'Jogo',
            descricao: String(info.description || '').trim(),
            site: info.homepage || '',
            estrelas: info.stargazers_count || 0,
            ano: info.created_at ? parseInt(String(info.created_at).slice(0, 4), 10) : undefined,
            original: info.html_url || link,
            git: (info.clone_url || ((info.html_url || link).replace(/\/$/, '') + '.git')),
            branch: branch || info.default_branch || 'main',
            branchWeb: branches.find(x => /^(emscripten|web|wasm|html5|browser)$/i.test(x)) || '',
            commit,
            licenca, tipo: b.tipo, dependencias, evidencias, avisos, motivos,
            classificacao: motivos.length ? 'revisao' : 'candidata',
            ajustes,
            capa: info.owner && info.name ? 'https://opengraph.githubassets.com/1/' + info.owner.login + '/' + info.name : ''
        };
    }

    const depNoManifesto = d => DEPENDENCIAS.some(x => x.id === d.id && x.externa) ? ' (e não está no manifesto de dependências externas)' : '';
    // opções que escondem erro de link (símbolo não resolvido) nunca entram
    const PROIBIDAS = /^-s(ERROR_ON_UNDEFINED_SYMBOLS=0|WARN_ON_UNDEFINED_SYMBOLS|LLD_REPORT_UNDEFINED=0)/;

    /** Confere os ajustes (dados estruturados e revisáveis). Tudo que não passa na lista branca vira erro — nada vai para o shell. */
    function validarAjustes(aj = {}, { manifesto = null } = {}) {
        const erros = [];
        const lista = (k, re, rotulo) => {
            const v = aj[k] == null ? [] : aj[k];
            if (!Array.isArray(v)) { erros.push(`"${k}" precisa ser uma lista`); return []; }
            v.forEach(x => { if (typeof x !== 'string' || !re.test(x)) erros.push(`${rotulo} não permitido: ${JSON.stringify(x)}`); });
            return v.filter(x => typeof x === 'string' && re.test(x));
        };
        const subdir = aj.subdir == null ? '' : String(aj.subdir);
        if (subdir && !RE_CAMINHO.test(subdir)) erros.push('subdir inválido: ' + JSON.stringify(subdir));
        const alvo = aj.alvo == null ? '' : String(aj.alvo);
        if (alvo && !/^[A-Za-z0-9_.+-]+$/.test(alvo)) erros.push('alvo inválido: ' + JSON.stringify(alvo));
        const dados = lista('dados', /^(?!\/)(?!.*\.\.)[A-Za-z0-9_.\/-]+(@\/[A-Za-z0-9_.\/-]*)?$/, 'Pasta de dados');
        const externas = lista('externas', /^[a-z0-9][a-z0-9-]*$/, 'Dependência externa');
        if (manifesto) externas.filter(x => !manifesto.some(m => m.id === x)).forEach(x => erros.push(`Dependência externa "${x}" não está no manifesto (modelo/dependencias-externas.json)`));
        ['flagsCompilar', 'flagsLinkar'].forEach(k => (Array.isArray(aj[k]) ? aj[k] : []).filter(f => PROIBIDAS.test(f)).forEach(f => erros.push(`Opção proibida (esconde símbolos não resolvidos): ${f}`)));
        const out = {
            subdir: RE_CAMINHO.test(subdir) ? subdir : '', alvo: /^[A-Za-z0-9_.+-]*$/.test(alvo) ? alvo : '',
            dados, submodulos: aj.submodulos === true, externas: manifesto ? externas.filter(x => manifesto.some(m => m.id === x)) : externas,
            flagsCompilar: lista('flagsCompilar', RE_FLAG_COMP, 'Flag de compilação').filter(f => !PROIBIDAS.test(f)),
            flagsLinkar: lista('flagsLinkar', RE_FLAG_LINK, 'Flag de link').filter(f => !PROIBIDAS.test(f)),
            cmakeOpcoes: lista('cmakeOpcoes', RE_CMAKE_OP, 'Opção do CMake'),
            configureOpcoes: lista('configureOpcoes', RE_CONF_OP, 'Opção do configure')
        };
        const conhecidas = ['subdir', 'alvo', 'dados', 'submodulos', 'externas', 'flagsCompilar', 'flagsLinkar', 'cmakeOpcoes', 'configureOpcoes'];
        Object.keys(aj).filter(k => !conhecidas.includes(k)).forEach(k => erros.push('Ajuste desconhecido: ' + k));
        return { ok: !erros.length, erros, ajustes: out };
    }

    // ------------------------------------------------------------------ templates (um por tipo, testáveis)
    const aspas = s => '"' + String(s).replace(/["$`\\]/g, '') + '"';
    function flagsDaReceita(a, aj) {
        const ports = [...new Set(a.dependencias.filter(d => d.port).flatMap(d => d.port))];
        const compilar = [...new Set([...ports.filter(f => /^-s/.test(f)), ...aj.flagsCompilar])];
        const linkar = [...new Set([...ports, '-sALLOW_MEMORY_GROWTH=1', '-sENVIRONMENT=web', ...(aj.dados.length ? ['-sFORCE_FILESYSTEM=1'] : []), ...aj.flagsLinkar])];
        return { compilar: compilar.join(' '), linkar: linkar.join(' '), ext: aj.externas.length > 0 };
    }
    // aspas + as variáveis que dependencia_externa preenche (o resto do texto não pode ter $)
    const aspasCom = (s, extra, usar) => usar ? '"' + String(s).replace(/["$`\\]/g, '') + ' ' + extra + '"' : aspas(s);
    const TEMPLATES = {
        cmake: (a, aj, f) => [
            `emcmake cmake -S ${aspas(aj.subdir || '.')} -B build-web -DCMAKE_BUILD_TYPE=Release \\`,
            `  -DCMAKE_C_FLAGS=${aspasCom(f.compilar, '$EXTERNAS_CFLAGS', f.ext)} -DCMAKE_CXX_FLAGS=${aspasCom(f.compilar, '$EXTERNAS_CFLAGS', f.ext)} \\`,
            `  -DCMAKE_EXE_LINKER_FLAGS=${aspasCom(f.linkar, '$EXTERNAS_LIBS', f.ext)}${aj.cmakeOpcoes.length ? ' ' + aj.cmakeOpcoes.join(' ') : ''}${f.ext ? ' "${EXTERNAS_CMAKE[@]}"' : ''}`,
            'cmake --build build-web -j"$(nproc)"',
            `PASTA_BUILD=build-web`],
        make: (a, aj, f) => [
            '# make: as opções do Emscripten entram pelo EMCC_CFLAGS, que o emcc/em++ usa ao compilar E ao linkar',
            `export EMCC_CFLAGS=${aspasCom(f.linkar, '$EXTERNAS_CFLAGS $EXTERNAS_LIBS', f.ext)}`,
            `emmake make -C ${aspas(aj.subdir || '.')} -j"$(nproc)" CC=emcc CXX=em++`,
            'unset EMCC_CFLAGS',
            `PASTA_BUILD=${aspas(aj.subdir || '.')}`],
        autotools: (a, aj, f) => [
            `cd ${aspas(aj.subdir || '.')}`,
            '[ -x configure ] || autoreconf -fi',
            `CFLAGS=${aspasCom(f.compilar, '$EXTERNAS_CFLAGS', f.ext)} CXXFLAGS=${aspasCom(f.compilar, '$EXTERNAS_CFLAGS', f.ext)} LDFLAGS=${aspas(f.linkar)}${f.ext ? ' LIBS="$EXTERNAS_LIBS"' : ''} emconfigure ./configure --host=wasm32-unknown-emscripten${aj.configureOpcoes.length ? ' ' + aj.configureOpcoes.join(' ') : ''}`,
            'emmake make -j"$(nproc)"',
            'cd "$FONTE"',
            `PASTA_BUILD=${aspas(aj.subdir || '.')}`]
    };

    /**
     * Receita candidata. Nunca usa "|| true", nunca junta .o "no chute" e nunca copia comando de README.
     * Se a análise pede revisão (ou os ajustes são inválidos), a receita só para com "REVISAO: …" — não finge que compila.
     */
    function receitaCandidata(a, ajustes = a.ajustes, extras = {}) {
        const v = validarAjustes(ajustes, { manifesto: extras.manifesto || null });
        const aj = v.ajustes;
        const nome = String(extras.nome || a.nome).replace(/["$`\\\n]/g, '');
        const cab = [
            '. "$RAIZ/receitas/comum.sh"',
            `# 🧩 RECEITA CANDIDATA (Prateleira da Studio, só regras) — ${a.tipo}${a.dependencias.length ? ' · ' + a.dependencias.map(d => d.nome).join(', ') : ''}`,
            `# Código: ${a.original} @ ${a.commit || '?'}. Só vira "pronta" depois que o workflow "Validar receita" passar.`,
            `# Os ajustes ficam na ficha do jogo (jogos.json → "ajustes"); edite lá ou aqui e valide de novo.`
        ];
        const motivos = [...a.motivos, ...v.erros];
        if (!TEMPLATES[a.tipo] && !motivos.length) motivos.push(`Sem template para o tipo "${a.tipo}".`);
        if (motivos.length)
            return cab.concat(['# ⚠️ REVISÃO NECESSÁRIA:', ...motivos.map(m => '#   - ' + m.replace(/\n/g, ' ')),
                // o texto dos ajustes inválidos fica só no comentário (inerte); o echo não repete valor vindo de fora
                `echo ${aspas('REVISAO: ' + (a.motivos[0] || 'ajustes inválidos (veja o comentário acima)'))}`, 'exit 1']).join('\n') + '\n';
        const f = flagsDaReceita(a, aj);
        const lic = ['COPYING', 'COPYING.txt', 'LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENCE'].map(x => (aj.subdir ? [aj.subdir + '/' + x, x] : [x])).flat();
        return cab.concat([
            `baixar_commit ${a.git} ${a.commit}${aj.submodulos ? ' submodulos' : ''}`,
            'FONTE=$(pwd)',
            ...aj.externas.map(x => `dependencia_externa ${x}   # manifesto: modelo/dependencias-externas.json (commit fixo)`),
            ...TEMPLATES[a.tipo](a, aj, f),
            `publicar_jogo "$PASTA_BUILD" ${aspas(aj.alvo)} ${aspas(nome)}${aj.dados.map(d => ' ' + aspas(d)).join('')}`,
            `for l in ${lic.join(' ')}; do if [ -f "$FONTE/$l" ]; then cp "$FONTE/$l" "$SAIDA/LICENCA.txt"; break; fi; done`
        ]).join('\n') + '\n';
    }

    /** Entrada do jogos.json: sempre rascunho (publicar é decisão humana depois da validação). */
    function entradaJogo(a, extras = {}) {
        const e = {
            id: extras.id || a.id,
            nome: extras.nome || a.nome,
            ano: extras.ano || a.ano,
            licenca: extras.licenca || (a.licenca.spdx || a.licenca.nome),
            fonte: extras.fonte || (a.original + (a.branch ? '/tree/' + a.branch : '')),
            original: a.original,
            commit: a.commit,
            descricao: extras.descricao != null ? extras.descricao : a.descricao,
            controles: extras.controles || 'teclado',
            generos: extras.generos || [],
            ajustes: validarAjustes(extras.ajustes || a.ajustes).ajustes,
            rascunho: true
        };
        if (extras.teclas) e.teclas = extras.teclas;
        if (!e.ano) delete e.ano;
        if (a.classificacao === 'revisao') e.revisao = a.motivos.slice(0, 5);
        return e;
    }

    // ------------------------------------------------------------------ estado da receita (previsão ≠ resultado real)
    /**
     * Junta os jobs de uma execução do "Validar receita" para um jogo: compilar (<id>) + navegador (<id>).
     * → { status: 'validando'|'ok'|'falhou'|null, url, jobs }
     */
    function resumoValidacao(jobs, id) {
        const meus = (jobs || []).filter(j => j.name === `compilar (${id})` || j.name === `navegador (${id})`);
        if (!meus.length) return null;
        const url = (meus.find(j => j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped') || meus[0]).html_url;
        if (meus.some(j => j.status !== 'completed')) return { status: 'validando', url, jobs: meus };
        const comp = meus.find(j => j.name.startsWith('compilar')), nav = meus.find(j => j.name.startsWith('navegador'));
        const ok = comp && comp.conclusion === 'success' && nav && nav.conclusion === 'success';
        return { status: ok ? 'ok' : 'falhou', url, jobs: meus };
    }

    /**
     * Estado de um jogo para a tela.
     *   jogo        = ficha do jogos.json
     *   validacao   = resumoValidacao(...) da execução mais nova + headSha (commit validado) ou null
     *   receitaSha  = commit mais novo que mexeu na receita/ficha (validação mais velha que isso não vale)
     * → 'publicada' | 'revisao' | 'candidata' | 'validando' | 'pronta' | 'falhou'
     */
    function estadoReceita(jogo, validacao, receitaSha) {
        if (!jogo.rascunho) return 'publicada';
        const atual = validacao && (!receitaSha || validacao.headSha === receitaSha || validacao.depoisDaReceita);
        if (atual && validacao.status === 'validando') return 'validando';
        if (atual && validacao.status === 'falhou') return 'falhou';
        if (atual && validacao.status === 'ok') return 'pronta';
        if (Array.isArray(jogo.revisao) && jogo.revisao.length) return 'revisao';
        return 'candidata';
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

    /** Tira um jogo inteiro do jogos.json (com a vírgula certa, sem mexer no resto do arquivo). */
    function removerDoJogosJson(texto, id) {
        const dados = JSON.parse(texto);
        const n = (dados.jogos || []).length;
        if (!(dados.jogos || []).some(j => j.id === id)) throw new Error('Não achei o jogo "' + id + '" no jogos.json');
        const m = new RegExp('"id"\\s*:\\s*' + JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).exec(texto);
        if (m) {
            const ini = texto.lastIndexOf('{', m.index);
            let fim = -1, nivel = 0, emTexto = false;                 // acha o "}" que fecha este jogo
            for (let i = ini; i < texto.length; i++) {
                const c = texto[i];
                if (emTexto) { if (c === '\\') i++; else if (c === '"') emTexto = false; continue; }
                if (c === '"') emTexto = true; else if (c === '{') nivel++; else if (c === '}' && --nivel === 0) { fim = i + 1; break; }
            }
            if (fim > 0) {
                let a = ini, b = fim;
                const depois = /^\s*,/.exec(texto.slice(b));
                if (depois) b += depois[0].length;                      // "jogo," → leva a vírgula de depois
                else { const antes = /,\s*$/.exec(texto.slice(0, a)); if (antes) a -= antes[0].length; }   // último: leva a de antes
                while (a > 0 && /[ \t]/.test(texto[a - 1])) a--;
                if (texto[a - 1] === '\n' && depois) { a--; }
                const novo = texto.slice(0, a) + texto.slice(b);
                try { const v = JSON.parse(novo); if (v.jogos.length === n - 1 && !v.jogos.some(j => j.id === id)) return novo; } catch (e) { /* plano B */ }
            }
        }
        dados.jogos = dados.jogos.filter(j => j.id !== id);
        return JSON.stringify(dados, null, 2) + '\n';
    }

    // ------------------------------------------------------------------ backup
    /** Um arquivo só com as fichas e as receitas de todos os jogos. receitas = { id: texto } */
    function montarBackup(jogosTexto, receitas, data = new Date()) {
        const dados = JSON.parse(jogosTexto);
        return { _backup: 'cartoonzine-jogos/prateleira', versao: 1, data: new Date(data).toISOString(),
            jogos: dados.jogos || [], receitas: Object.assign({}, receitas) };
    }

    /** O que um backup traria de volta (só o que falta: nada do que já existe é mexido). */
    function planoRestauracao(backup, jogosAtuais, receitasAtuais = []) {
        if (!backup || backup._backup !== 'cartoonzine-jogos/prateleira' || !Array.isArray(backup.jogos))
            throw new Error('Esse arquivo não é um backup da Prateleira.');
        const ids = new Set((jogosAtuais || []).map(j => j.id));
        const temReceita = new Set(receitasAtuais);
        const receitas = backup.receitas || {};
        const jogos = backup.jogos.filter(j => j && typeof j.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(j.id) && !ids.has(j.id));
        const precisam = new Set(jogos.map(j => j.id));
        (jogosAtuais || []).forEach(j => { if (!temReceita.has(j.id) && receitas[j.id]) precisam.add(j.id); });   // ficha existe, receita sumiu
        const arquivos = [...precisam].filter(id => typeof receitas[id] === 'string' && !temReceita.has(id))
            .map(id => ({ caminho: 'receitas/' + id + '.sh', conteudo: receitas[id] }));
        return { jogos, arquivos };
    }

    return { DEPENDENCIAS, arquivosParaLer, tipoDoBuild, validarAjustes, receitaCandidata, TEMPLATES, resumoValidacao, estadoReceita, removerDoJogosJson, montarBackup, planoRestauracao, LIVRES, repoDoLink, idDoNome, analisarRepo, entradaJogo, jaExiste, inserirNoJogosJson,
        PAGINA, statusDosJogos, tirarRascunho, itemJogosWeb, jaCadastrado };
});
