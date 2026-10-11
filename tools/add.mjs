#!/usr/bin/env node
/**
 * Adiciona um conteúdo pela linha de comando.
 *
 *   node tools/add.mjs cartoons "Popeye o Marinheiro (1933)" https://.../popeye.mp4
 *   node tools/add.mjs cartoons "Caverna do Dragão S01E03" https://.../ep3.mp4      <- entra na série existente
 *   node tools/add.mjs canais "TV Cultura" https://.../cultura.m3u8 --pais BR --categoria Educativo
 *   node tools/add.mjs radios "Rádio X" https://.../stream --pais BR --cidade "São Paulo"
 *   node tools/add.mjs jogos "Sonic" https://.../sonic.zip --console megadrive
 *   node tools/add.mjs filmes "Nosferatu" https://archive.org/details/nosferatu --wiki
 *
 * Opções: --ano --capa --banner --logo --descricao --generos "A, B" --audio Dublado
 *         --pais --idioma --categoria --cidade --console --destaque --wiki (busca sinopse/capa)
 */
import { Core, lerConfig, acharColecao, salvarItem, lerArgs, enriquecer, aplicarPadroes } from './lib.mjs';

const args = lerArgs(process.argv.slice(2));
const [colId, nome, ...links] = args._;
if (!colId || !nome) {
    console.log('Uso: node tools/add.mjs <colecao> "Nome" <link> [mais links] [--opções]');
    console.log('Coleções: ' + lerConfig().colecoes.map(c => c.id).join(', '));
    process.exit(1);
}

const config = lerConfig();
const colecao = acharColecao(config, colId);
const info = Core.analisarNome(nome);
const archive = links.map(Core.idDoArchive).find(Boolean);
let item;
if (info.serie && colecao.tipo === 'video') {
    item = { nome: info.serie, ano: info.ano, audio: info.audio, temporadas: [{ numero: info.temporada, episodios: [{ numero: info.episodio, titulo: info.tituloEpisodio, links }] }] };
} else {
    item = { nome: colecao.tipo === 'video' ? info.nome : nome, ano: info.ano, audio: info.audio, links: archive ? [] : links };
    if (archive) item.archive = archive;
}
item = aplicarPadroes(Core.limparVazios(item), args);
item = await enriquecer(item, { wiki: !!args.wiki, log: console.log });

const normal = Core.normalizarItem(item, colecao);
const { erros, avisos } = Core.validarItem(normal, colecao, config);
avisos.forEach(a => console.log('  ⚠ ' + a));
if (erros.length) {
    erros.forEach(e => console.log('  ✗ ' + e));
    console.log('Nada foi salvo. Corrija e rode de novo.');
    process.exit(1);
}
const r = salvarItem(colecao, normal);
const verbo = { criado: '✅ Criado', atualizado: '🔄 Atualizado', igual: '= Já estava assim' }[r.acao];
console.log(`${verbo}: ${r.caminho}`);
