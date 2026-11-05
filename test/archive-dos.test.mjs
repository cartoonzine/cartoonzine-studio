// Importador de MS-DOS do Internet Archive: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importarRespostaArchive, urlDaBusca, nomeDoJogo, generosDoJogo, descricaoCurta } from '../tools/importar-archive-dos.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function raizDeTeste() {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ia-'));
    fs.copyFileSync(path.join(RAIZ, 'studio.config.json'), path.join(r, 'studio.config.json'));
    fs.mkdirSync(path.join(r, 'conteudo', 'jogos', 'msdos'), { recursive: true });
    fs.writeFileSync(path.join(r, 'conteudo', 'jogos', 'msdos', 'brix.json'), JSON.stringify({
        nome: 'brix', links: ['https://archive.org/download/brix-puzz-game-dos-1992/BRIX1.zip'], console: 'msdos'
    }));
    return r;
}

const RESPOSTA = {
    response: {
        numFound: 7000,
        docs: [
            { identifier: 'brix-puzz-game-dos-1992', title: 'Brix (1992)(Epic MegaGames)', year: '1992' },
            { identifier: 'msdos_Commander_Keen_4_1991', title: 'Commander Keen 4: Secret of the Oracle (1991)(id Software)', year: '1991',
              creator: 'id Software', subject: ['msdos', 'Platform', 'Action', 'Commander Keen 4: Secret of the Oracle'],
              description: '<p>Keen is <b>back</b>!<br>Explore Shadowlands &amp; rescue the Oracle Council.</p>' },
            { identifier: 'msdos_Lemmings_1991', title: 'Lemmings', date: '1991-01-01T00:00:00Z', subject: 'Puzzle; game; Strategy', downloads: 99999 }
        ]
    }
};

test('archive dos: link da busca (coleção, década, gênero, ordem, página)', () => {
    const u = new URL(urlDaBusca({ limite: 50, inicio: 100, decada: 1990, genero: 'puzzle', ordem: 'populares' }));
    assert.equal(u.searchParams.get('q'), 'collection:(softwarelibrary_msdos_games) AND year:[1990 TO 1999] AND subject:(puzzle)');
    assert.equal(u.searchParams.get('rows'), '50');
    assert.equal(u.searchParams.get('page'), '3');
    assert.equal(u.searchParams.get('sort[]'), 'downloads desc');
    assert.ok(u.searchParams.getAll('fl[]').includes('identifier'));
});

test('archive dos: nome, gêneros e descrição limpos', () => {
    assert.equal(nomeDoJogo({ title: 'Brix (1992)(Epic MegaGames)' }), 'Brix');
    assert.equal(nomeDoJogo({ title: 'Prince of Persia (1990)' }), 'Prince of Persia');
    assert.deepEqual(generosDoJogo(RESPOSTA.response.docs[1]), ['Platform', 'Action']);
    assert.deepEqual(generosDoJogo(RESPOSTA.response.docs[2]), ['Puzzle', 'Strategy']);
    assert.equal(descricaoCurta('<p>Keen is <b>back</b>!<br>A &amp; B</p>'), 'Keen is back ! A & B');
    assert.ok(descricaoCurta('x '.repeat(400)).length <= 300);
});

test('archive dos: importa os novos e não mexe no que já existe (mesmo item do Archive)', () => {
    const raiz = raizDeTeste();
    const r = importarRespostaArchive(RESPOSTA, { raiz });
    assert.equal(r.lidos, 3);
    assert.equal(r.novos, 2);
    assert.equal(r.pulados, 1);
    const keen = JSON.parse(fs.readFileSync(path.join(raiz, 'conteudo/jogos/msdos/commander-keen-4-secret-of-the-oracle.json'), 'utf8'));
    assert.equal(keen.console, 'msdos');
    assert.deepEqual(keen.links, ['https://archive.org/details/msdos_Commander_Keen_4_1991']);
    assert.equal(keen.capa, 'https://archive.org/services/img/msdos_Commander_Keen_4_1991');
    assert.equal(keen.ano, 1991);
    assert.equal(keen.editora, 'id Software');
    assert.equal(keen._origem, 'auto:Internet Archive MS-DOS');
    const lem = JSON.parse(fs.readFileSync(path.join(raiz, 'conteudo/jogos/msdos/lemmings.json'), 'utf8'));
    assert.equal(lem.ano, 1991);
    // rodar de novo não duplica
    const r2 = importarRespostaArchive(RESPOSTA, { raiz });
    assert.equal(r2.novos, 0);
    assert.equal(r2.pulados, 3);
    // o brix feito à mão continua igual
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(raiz, 'conteudo/jogos/msdos/brix.json'), 'utf8')).nome, 'brix');
});

test('archive dos: rascunho e simulação', () => {
    const raiz = raizDeTeste();
    const s = importarRespostaArchive(RESPOSTA, { raiz, simular: true });
    assert.equal(s.novos, 2);
    assert.equal(fs.readdirSync(path.join(raiz, 'conteudo/jogos/msdos')).length, 1);
    importarRespostaArchive(RESPOSTA, { raiz, rascunho: true });
    const lem = JSON.parse(fs.readFileSync(path.join(raiz, 'conteudo/jogos/msdos/lemmings.json'), 'utf8'));
    assert.equal(lem._rascunho, true);
});
