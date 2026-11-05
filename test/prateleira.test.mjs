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

test('prateleira: análise (cmake + sdl2 + branch web)', () => {
    const a = P.analisarRepo({ info: INFO, caminhos: ['CMakeLists.txt', 'src/main.c'], textos: 'find_package(SDL2 REQUIRED)', branches: ['master', 'emscripten'] });
    assert.equal(a.id, 'open-tyrian');
    assert.equal(a.nome, 'Open Tyrian');
    assert.equal(a.tipo, 'cmake');
    assert.equal(a.sdl, 'sdl2');
    assert.equal(a.branchWeb, 'emscripten');
    assert.equal(a.temWeb, true);
    assert.equal(a.licenca.livre, true);
    assert.equal(a.facil, true);
    assert.equal(a.ano, 2008);
    assert.deepEqual(a.avisos, []);
    assert.match(a.capa, /opengraph\.githubassets\.com\/1\/opentyrian\/open-tyrian/);
});

test('prateleira: avisos (sem licença, sdl1, desconhecido)', () => {
    const a = P.analisarRepo({ info: { ...INFO, license: null }, caminhos: ['src/x.c'], textos: '#include <SDL.h> sdl-config' });
    assert.equal(a.licenca.livre, false);
    assert.equal(a.tipo, 'desconhecido');
    assert.equal(a.sdl, 'sdl1');
    assert.equal(a.facil, false);
    assert.equal(a.avisos.length, 3);
    const b = P.analisarRepo({ info: { ...INFO, license: { spdx_id: 'NOASSERTION', name: 'Other' } }, caminhos: ['Makefile'] });
    assert.equal(b.tipo, 'make');
    assert.match(b.avisos[0], /não reconheceu/);
});

test('prateleira: ficha do jogos.json e receita', () => {
    const a = P.analisarRepo({ info: INFO, caminhos: ['CMakeLists.txt'], textos: 'SDL2', branches: ['emscripten'] });
    const e = P.entradaJogo(a, { generos: ['Tiro'] });
    assert.equal(e.rascunho, true);
    assert.equal(e.fonte, 'https://github.com/opentyrian/open-tyrian/tree/emscripten');
    assert.equal(e.licenca, 'GPL-2.0');
    assert.deepEqual(e.generos, ['Tiro']);
    assert.equal(P.entradaJogo(a, { rascunho: false }).rascunho, undefined);
    const r = P.receitaAutomatica(a);
    assert.match(r, /baixar_fonte https:\/\/github\.com\/opentyrian\/open-tyrian\.git emscripten/);
    assert.match(r, /emcmake cmake/);
    assert.match(r, /publicar_saida web "Open Tyrian"/);
    assert.match(P.receitaAutomatica({ ...a, tipo: 'make' }), /emmake make/);
    assert.match(P.receitaAutomatica({ ...a, tipo: 'desconhecido' }), /exit 1/);
    assert.ok(!/"\$\(rm/.test(P.receitaAutomatica(a, { nome: 'X"$(rm -rf /)' })));
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
