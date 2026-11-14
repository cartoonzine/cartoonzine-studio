// Adição em massa (listas em arquivo, ROMs, rascunhos): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../core/studio-core.js');
const config = JSON.parse(fs.readFileSync(new URL('../studio.config.json', import.meta.url), 'utf8'));
const col = (id) => config.colecoes.find(c => c.id === id);

test('massa: nome limpo do arquivo da ROM', () => {
    assert.equal(C.limparNomeRom('Legend of Zelda, The - A Link to the Past (USA) (Rev 1) [!].sfc'), 'The Legend of Zelda - A Link to the Past');
    assert.equal(C.limparNomeRom('Sonic%20The%20Hedgehog%20(USA,%20Europe).md'), 'Sonic The Hedgehog');
    assert.equal(C.limparNomeRom('Super_Mario_Bros.nes'), 'Super Mario Bros');
    assert.equal(C.limparNomeRom('Street.Fighter.II.zip'), 'Street Fighter II');
    assert.equal(C.limparNomeRom('sf2.zip'), 'sf2');
});

test('massa: console pela extensão e pelo nome do sistema', () => {
    assert.equal(C.consoleDaExtensao('jogo.sfc'), 'snes');
    assert.equal(C.consoleDaExtensao('https://x/y/Metroid.gba?download=1'), 'gba');
    assert.equal(C.consoleDaExtensao('jogo.zip'), '');           // zip serve para vários: precisa do console
    assert.equal(C.consoleDaExtensao('jogo.bin'), '');
    assert.equal(C.consoleDoNomeSistema('Nintendo - Super Nintendo Entertainment System', config), 'snes');
    assert.equal(C.consoleDoNomeSistema('Nintendo - Nintendo Entertainment System', config), 'nes');
    assert.equal(C.consoleDoNomeSistema('Sega - Mega Drive - Genesis', config), 'megadrive');
    assert.equal(C.consoleDoNomeSistema('Nintendo - Game Boy Color', config), 'gbc');
    assert.equal(C.consoleDoNomeSistema('FBNeo - Arcade Games', config), 'arcade');
    assert.equal(C.consoleDoNomeSistema('snes', config), 'snes');
    assert.equal(C.consoleDoNomeSistema('coisa nenhuma', config), '');
});

test('massa: JSON (lista de objetos, de links e com chave "jogos")', () => {
    const a = C.lerListaArquivo('lista.json', JSON.stringify([
        { name: 'Jogo Um', url: 'https://ex.com/um/', cover: 'https://ex.com/um.png', year: 2019, genre: 'Ação, Plataforma' },
        { titulo: 'Jogo Dois', link: 'https://ex.com/dois/' }
    ]));
    assert.equal(a.length, 2);
    assert.equal(a[0].nome, 'Jogo Um');
    assert.deepEqual(a[0].links, ['https://ex.com/um/']);
    assert.equal(a[0].capa, 'https://ex.com/um.png');
    assert.equal(a[0].ano, 2019);
    assert.deepEqual(a[0].generos, ['Ação', 'Plataforma']);
    const b = C.lerListaArquivo('x.json', JSON.stringify({ jogos: ['https://ex.com/a.sfc', 'https://ex.com/b.sfc'] }));
    assert.equal(b.length, 2);
    assert.throws(() => C.lerListaArquivo('ruim.json', '{ nada'), /JSON inválido/);
});

test('massa: CSV com cabeçalho (; ou ,) e sem cabeçalho', () => {
    const a = C.lerListaArquivo('l.csv', 'nome;link;capa;sistema\n"Jogo; com ponto e vírgula";https://ex.com/j/;https://ex.com/j.jpg;web-indie\n');
    assert.equal(a.length, 1);
    assert.equal(a[0].nome, 'Jogo; com ponto e vírgula');
    assert.equal(a[0].console, 'web-indie');
    const b = C.lerListaArquivo('l.csv', 'Jogo A,https://ex.com/a/\nJogo B,https://ex.com/b/,https://ex.com/b.png\n');
    assert.equal(b.length, 2);
    assert.equal(b[1].nome, 'Jogo B');
    assert.equal(b[1].capa, 'https://ex.com/b.png');
    const t = C.lerListaArquivo('l.tsv', 'title\turl\nJogo T\thttps://ex.com/t/\n');
    assert.equal(t[0].nome, 'Jogo T');
});

test('massa: RetroArch .lpl (sistema pelo nome do arquivo) e caminhos relativos com endereço base', () => {
    const lpl = JSON.stringify({ version: '1.5', items: [{ path: '/roms/snes/Super Metroid (USA).sfc', label: 'Super Metroid (USA)', db_name: 'Nintendo - Super Nintendo Entertainment System.lpl' }] });
    const [e] = C.lerListaArquivo('Nintendo - Super Nintendo Entertainment System.lpl', lpl, { base: 'https://archive.org/download/colecao/' });
    assert.equal(e.links[0], 'https://archive.org/download/colecao/Super%20Metroid%20(USA).sfc');   // caminho do PC: só o nome do arquivo
    assert.equal(C.consoleDoNomeSistema(e.console, config), 'snes');
    assert.equal(e.nome, 'Super Metroid (USA)');
    assert.equal(C.prepararJogoEmMassa(e, col('jogos'), config, '').item.nome, 'Super Metroid');
});

test('massa: gamelist.xml do EmulationStation', () => {
    const xml = `<?xml version="1.0"?><gameList>
      <game id="1"><path>./Chrono Trigger (USA).sfc</path><name>Chrono Trigger</name><desc>RPG &amp; viagem no tempo</desc>
        <image>./media/chrono.png</image><releasedate>19950311T000000</releasedate><genre>RPG</genre><players>1</players></game>
      <game><path>https://ex.com/x.sfc</path><name>X</name></game></gameList>`;
    const l = C.lerListaArquivo('gamelist.xml', xml, { base: 'https://ex.com/snes' });
    assert.equal(l.length, 2);
    assert.equal(l[0].nome, 'Chrono Trigger');
    assert.equal(l[0].links[0], 'https://ex.com/snes/Chrono%20Trigger%20(USA).sfc');
    assert.equal(l[0].capa, 'https://ex.com/snes/media/chrono.png');
    assert.equal(l[0].descricao, 'RPG & viagem no tempo');
    assert.equal(l[0].ano, 1995);
    assert.equal(l[0].jogadores, 1);
});

test('massa: TXT e M3U usam o mesmo leitor do colar', () => {
    const l = C.lerListaArquivo('lista.txt', 'Jogo Web | https://ex.com/jw/\nhttps://ex.com/roms/Contra%20(USA).nes\n');
    assert.equal(l.length, 2);
    assert.equal(l[0].nome, 'Jogo Web');
});

test('massa: preparar ROM — console pela extensão, nome do arquivo marcado para o robô', () => {
    const [e] = C.lerTextoColado('https://ex.com/roms/Legend%20of%20Zelda%2C%20The%20(USA).sfc');
    const { item } = C.prepararJogoEmMassa(e, col('jogos'), config, '');
    assert.equal(item.console, 'snes');
    assert.equal(item.nome, 'The Legend of Zelda');
    assert.equal(item._nomeDoArquivo, true);
    assert.equal(item._romArquivo, 'Legend of Zelda, The (USA).sfc');
    // zip: console vem do padrão escolhido
    const [z] = C.lerTextoColado('https://ex.com/roms/sf2.zip');
    assert.equal(C.prepararJogoEmMassa(z, col('jogos'), config, 'arcade').item.console, 'arcade');
    assert.equal(C.prepararJogoEmMassa(z, col('jogos'), config, '').item.console, undefined);
    // nome dado na lista fica (sem marca para o robô trocar)
    const [n] = C.lerListaArquivo('l.json', JSON.stringify([{ nome: 'Meu Nome', link: 'https://ex.com/x.gba' }]));
    const p = C.prepararJogoEmMassa(n, col('jogos'), config, '').item;
    assert.equal(p.nome, 'Meu Nome');
    assert.equal(p._nomeDoArquivo, undefined);
    assert.equal(p.console, 'gba');
    // sistema escrito por extenso na lista
    const [s] = C.lerListaArquivo('l.csv', 'nome,link,sistema\nMetroid,https://ex.com/m.zip,Nintendo - Nintendo Entertainment System\n');
    assert.equal(C.prepararJogoEmMassa(s, col('jogos'), config, '').item.console, 'nes');
});

test('massa: jogo web em massa vira rascunho válido (sem licença) e o normalizar guarda as marcas', () => {
    const [e] = C.lerListaArquivo('w.json', JSON.stringify([{ name: 'Jogo Web', url: 'https://ex.com/jw/', system: 'DOS' }]));
    const { item } = C.prepararJogoEmMassa(e, col('jogos-web'), config, 'web-indie');
    assert.equal(item.console, 'web-dos');
    const pub = C.normalizarItem(item, col('jogos-web'));
    assert.ok(C.validarItem(pub, col('jogos-web'), config).erros.some(x => /licença/i.test(x)));
    const rasc = C.normalizarItem(Object.assign({}, item, { _rascunho: true }), col('jogos-web'));
    assert.deepEqual(C.validarItem(rasc, col('jogos-web'), config).erros, []);
    assert.equal(rasc._rascunho, true);
});

test('massa: ScreenScraper pela ROM (jeuInfos) e nome oficial', async () => {
    let pedido = '';
    const ficha = { id: '123', noms: [{ region: 'ss', text: 'Zelda no Densetsu' }, { region: 'us', text: 'The Legend of Zelda: A Link to the Past' }] };
    const fetchFn = async (u) => { pedido = u; return { ok: true, status: 200, json: async () => ({ response: { jeu: ficha } }) }; };
    const ss = { dev: 'd', devSenha: 'p', user: 'u', senha: 's' };
    const jeu = await C.buscarJogoPorRomScreenScraper('Legend of Zelda, The (USA).sfc', ss, fetchFn, 'snes', { md5: 'abc', tamanho: 1048576 });
    assert.equal(jeu.id, '123');
    const q = new URL(pedido).searchParams;
    assert.match(pedido, /jeuInfos\.php/);
    assert.equal(q.get('systemeid'), '4');
    assert.equal(q.get('romnom'), 'Legend of Zelda, The (USA).sfc');
    assert.equal(q.get('md5'), 'abc');
    assert.equal(q.get('romtaille'), '1048576');
    assert.equal(C.nomeScreenScraper(jeu), 'The Legend of Zelda: A Link to the Past');
    // 404 = não achou; console desconhecido = nem pergunta
    assert.equal(await C.buscarJogoPorRomScreenScraper('x.sfc', ss, async () => ({ ok: false, status: 404, text: async () => '' }), 'snes'), null);
    assert.equal(await C.buscarJogoPorRomScreenScraper('x.sfc', ss, fetchFn, 'consolequenaoexiste'), null);
});

test('massa: linha de comando importa lista JSON como rascunho', async () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'czs-massa-'));
    fs.copyFileSync(new URL('../studio.config.json', import.meta.url), path.join(raiz, 'studio.config.json'));
    const { importarTexto } = await import('../tools/lib.mjs');
    const lista = JSON.stringify([{ name: 'Web Um', url: 'https://ex.com/1/', description: 'Um jogo', genre: 'Ação' }, { name: 'Web Dois', url: 'https://ex.com/2/', system: 'DOS' }]);
    const r = await importarTexto(col('jogos-web'), lista, { raiz, config, args: { console: 'web-indie', rascunho: true }, nomeArquivo: 'lista.json' });
    assert.equal(r.falhas.length, 0);
    assert.equal(r.resultado.filter(x => x.acao === 'criado').length, 2);
    const salvo = JSON.parse(fs.readFileSync(path.join(raiz, r.resultado[0].caminho), 'utf8'));
    assert.equal(salvo._rascunho, true);
    assert.equal(salvo.console, 'web-indie');
    assert.equal(salvo.descricao, 'Um jogo');
    assert.deepEqual(salvo.generos, ['Ação']);
    const dos = JSON.parse(fs.readFileSync(path.join(raiz, r.resultado[1].caminho), 'utf8'));
    assert.equal(dos.console, 'web-dos');           // o sistema escrito na lista vence o padrão
    assert.equal(dos._nomeInformado, undefined);
    // ROM: console pela extensão, marca para o robô
    const r2 = await importarTexto(col('jogos'), 'https://ex.com/roms/Contra%20(USA).nes\n', { raiz, config, args: { rascunho: true } });
    const rom = JSON.parse(fs.readFileSync(path.join(raiz, r2.resultado[0].caminho), 'utf8'));
    assert.equal(rom.console, 'nes');
    assert.equal(rom.nome, 'Contra');
    assert.equal(rom._nomeDoArquivo, true);
    assert.equal(rom._romArquivo, 'Contra (USA).nes');
    fs.rmSync(raiz, { recursive: true, force: true });
});
