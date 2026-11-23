/** 🔎 TMDB: escolhe o resultado pelo título (não o 1º da lista). Rodar: node --test test/tmdb-escolha.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../core/studio-core.js');

const R = [
    { id: 382748, title: 'A Extraordinária Garota Chamada Estrela', original_title: 'Stargirl', release_date: '2020-03-10', popularity: 30 },
    { id: 799883, title: 'A Extraordinária Garota Chamada Estrela em Hollywood', original_title: 'Hollywood Stargirl', release_date: '2022-06-03', popularity: 12 }
];
test('"… em Hollywood" não vira o primeiro filme', () => {
    assert.equal(C.escolherResultadoTMDB(R, 'A Extraordinária Garota Chamada Estrela em Hollywood').id, 799883);
    assert.equal(C.escolherResultadoTMDB(R, 'A Extraordinaria Garota Chamada Estrela').id, 382748);
    assert.equal(C.escolherResultadoTMDB(R, 'Stargirl').id, 382748);
});
test('o ano desempata e nada parecido não vira chute', () => {
    const D = [{ id: 1, title: 'Duna', release_date: '1984-12-14' }, { id: 2, title: 'Duna', release_date: '2021-09-15' }];
    assert.equal(C.escolherResultadoTMDB(D, 'Duna', 2021).id, 2);
    assert.equal(C.escolherResultadoTMDB(D, 'Duna', 1984).id, 1);
    assert.equal(C.escolherResultadoTMDB([{ id: 9, title: 'Um Outro Filme Qualquer' }], 'Código de Honra'), null);
});
