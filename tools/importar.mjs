#!/usr/bin/env node
/**
 * Importa vários conteúdos de uma vez.
 *
 *   node tools/importar.mjs canais lista.m3u --pais BR
 *   node tools/importar.mjs canais https://iptv-org.github.io/iptv/countries/br.m3u --categoria "TV Aberta"
 *   node tools/importar.mjs cartoons links.txt --dados        (um link por linha, ou "Nome | link | capa"; --dados busca sinopse/capas)
 *   node tools/importar.mjs animes eps.txt --tmdb https://www.themoviedb.org/tv/230050   (todos os links são dessa série)
 *   node tools/importar.mjs cartoons https://archive.org/details/popeye_classics
 *   node tools/importar.mjs animes -                          (lê do teclado / pipe; cole as mensagens do @CZStreamBot)
 *
 * EM MASSA (listas em arquivo: .txt .m3u .json .csv .tsv .lpl do RetroArch, gamelist.xml do EmulationStation):
 *   node tools/importar.mjs jogos-web jogos.json --console web-indie --rascunho     (tudo como rascunho para conferir)
 *   node tools/importar.mjs jogos roms.txt --rascunho                  (console pela extensão; .zip/.bin/.iso: --console snes)
 *   node tools/importar.mjs jogos "Nintendo - Super Nintendo Entertainment System.lpl" --base https://archive.org/download/minha-colecao/
 *   ROM sem nome na lista: o nome sai do arquivo e o robô (tools/midia-jogos.mjs) troca pelo nome oficial do ScreenScraper.
 *
 * Episódios ("Naruto S01E03") são agrupados na série certa; itens que já existem
 * só ganham o que falta (episódios novos, links de reserva), nada é apagado.
 * Use --simular para ver o que aconteceria sem salvar nada.
 */
import fs from 'node:fs';
import { Core, lerConfig, acharColecao, lerArgs, baixarTexto, importarTexto } from './lib.mjs';

const args = lerArgs(process.argv.slice(2));
const [colId, fonte] = args._;
if (!colId || !fonte) {
    console.log('Uso: node tools/importar.mjs <colecao> <arquivo | link | -> [--pais BR --categoria X --console nes --dados --tmdb <link> --rascunho --base <url> --simular]');
    process.exit(1);
}
const config = lerConfig();
const colecao = acharColecao(config, colId);

let texto;
if (fonte === '-') texto = fs.readFileSync(0, 'utf8');
else if (Core.idDoArchive(fonte)) texto = fonte;                 // o importador do archive cuida
else if (/^https?:\/\//i.test(fonte)) texto = await baixarTexto(fonte);
else texto = fs.readFileSync(fonte, 'utf8');

const nomeArquivo = fonte !== '-' && /\.(json|csv|tsv|lpl|xml)(\?|$)/i.test(fonte) ? fonte.split('?')[0] : undefined;
const { resultado, falhas } = await importarTexto(colecao, texto, { args, config, log: console.log, simular: !!args.simular, nomeArquivo });
const conta = a => resultado.filter(r => r.acao === a).length;
console.log(`\n✅ ${conta('criado')} criados · 🔄 ${conta('atualizado')} atualizados · = ${conta('igual')} iguais · ✗ ${falhas.length} com erro` + (args.simular ? ' (simulação, nada salvo)' : ''));
if (!args.simular && resultado.length) console.log('Rode "node tools/build.mjs" (ou faça push: o GitHub faz sozinho) para publicar.');
