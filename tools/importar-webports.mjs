#!/usr/bin/env node
/**
 * Cartucho web: importa a lista "Ultimate Catalog of Web Game Ports" para a seção Jogos Web.
 *
 *   node tools/importar-webports.mjs                       (baixa o README oficial do GitHub)
 *   node tools/importar-webports.mjs README.md             (ou um arquivo/link que você escolher)
 *   node tools/importar-webports.mjs --console web-dos     (manda tudo para um sistema; sem isso, cada jogo vai para o sistema dele)
 *   node tools/importar-webports.mjs --secao A --limite 20 (só a letra A, no máximo 20 jogos)
 *   node tools/importar-webports.mjs --simular             (mostra o que faria, sem salvar nada)
 *
 * O que ele faz:
 *   • cada jogo com link jogável (▶) vira conteudo/jogos-web/<sistema>/<nome>.json como RASCUNHO
 *     (licença "nao-verificada"): nada vai para o app antes de você conferir a licença no painel;
 *   • quem só tem código-fonte (📦, sem demo) vai para conteudo/jogos-web/_webports-sem-demo.json
 *     (arquivo com "_" na frente: o build ignora; é só uma lista para consulta);
 *   • jogo que já existe em qualquer console web (mesmo que você tenha mudado de web para webpc
 *     ou já publicado) NÃO é mexido. Com --atualizar ele só ganha o que falta (link reserva, repo).
 *
 * Sistemas: consolesWeb no studio.config.json (Fangames, Indie, DOS, PS2…). Jogo pesado: marque "Só PC".
 */
import fs from 'node:fs';
import path from 'node:path';
import { Core, RAIZ, lerConfig, acharColecao, lerColecao, salvarItem, lerArgs, baixarTexto } from './lib.mjs';

export const README_OFICIAL = 'https://raw.githubusercontent.com/Carter54git/Ultimate-Catalog-Of-Web-Game-Ports/main/README.md';
export const PAGINA_OFICIAL = 'https://github.com/Carter54git/Ultimate-Catalog-Of-Web-Game-Ports';
const ORIGEM = 'auto:Ultimate Catalog of Web Game Ports';

/** Importa o texto do README. Devolve o resumo (usado também pelos testes). */
export function importarWebPorts(texto, { raiz = RAIZ, console: destino = 'auto', secao, limite, simular = false, atualizar = false } = {}) {
    const config = lerConfig(raiz);
    const colecao = acharColecao(config, 'jogos-web');
    // "auto" = cada jogo vai para o sistema original dele (pelo nome); o que não der para saber fica em "Sem categoria"
    if (destino !== 'auto' && !Core.consoleWeb(destino, config)) throw new Error(`"${destino}" não é um console web (veja consolesWeb no studio.config.json)`);
    const sistemaDe = (nome) => destino === 'auto' ? Core.sistemaWebDoNome(nome) : destino;
    const { jogos, semDemo } = Core.lerCatalogoWebPorts(texto);
    const filtro = (j) => !secao || String(j.secao).toLowerCase() === String(secao).toLowerCase();
    let lista = jogos.filter(filtro);
    if (limite) lista = lista.slice(0, parseInt(limite, 10) || lista.length);

    // nomes que já existem em QUALQUER console web (o usuário pode ter mudado de web → webpc)
    const existentes = new Map();
    for (const e of lerColecao(colecao, raiz).entradas) {
        if (Core.consoleWeb(e.item.console, config)) existentes.set(Core.normText(e.item.nome), e.caminho);
    }

    const criadosAgora = new Set();   // mesmo nome duas vezes na lista = outro link do mesmo jogo (vira reserva)
    const r = { lidos: jogos.length, semDemo: semDemo.length, novos: 0, atualizados: 0, iguais: 0, pulados: 0, caminhos: [] };
    for (const j of lista) {
        const ja = existentes.get(Core.normText(j.nome));
        const item = {
            nome: j.nome, ano: j.ano, console: sistemaDe(j.nome), links: j.links, repo: j.repo,
            licenca: 'nao-verificada', descricao: `Port para navegador · ${j.host}`,
            fonte: PAGINA_OFICIAL, _rascunho: true, _origem: ORIGEM
        };
        const chaveNome = Core.normText(j.nome);
        if (ja && !atualizar && !criadosAgora.has(chaveNome)) { r.pulados++; continue; }
        if (simular) {
            if (ja) r.atualizados++; else { r.novos++; criadosAgora.add(chaveNome); existentes.set(chaveNome, Core.caminhoItem(colecao, Core.normalizarItem(item, colecao))); }
            r.caminhos.push(existentes.get(chaveNome));
            continue;
        }
        if (ja) {
            // só completa: mantém console, licença, rascunho e o resto do que já está lá
            const atual = JSON.parse(fs.readFileSync(path.join(raiz, ja), 'utf8'));
            const novo = Core.mesclarSemSobrescrever(atual, { links: j.links, repo: j.repo, ano: j.ano });
            novo.links = Core.unicos ? Core.unicos([].concat(atual.links || [], j.links)) : Array.from(new Set([].concat(atual.links || [], j.links)));
            const antes = Core.serializar(atual), depois = Core.serializar(novo);
            if (antes === depois) { r.iguais++; continue; }
            fs.writeFileSync(path.join(raiz, ja), depois);
            r.atualizados++; r.caminhos.push(ja);
            continue;
        }
        const s = salvarItem(colecao, item, { raiz });
        if (s.acao === 'igual') r.iguais++; else if (s.acao === 'atualizado') r.atualizados++; else r.novos++;
        existentes.set(chaveNome, s.caminho);
        criadosAgora.add(chaveNome);
        r.caminhos.push(s.caminho);
    }
    if (!simular) {
        const arq = path.join(raiz, 'conteudo', colecao.id, '_webports-sem-demo.json');
        fs.mkdirSync(path.dirname(arq), { recursive: true });
        fs.writeFileSync(arq, JSON.stringify({
            _comentario: 'Jogos do Ultimate Catalog que só têm código-fonte (sem página jogável). O build ignora este arquivo.',
            fonte: PAGINA_OFICIAL, total: semDemo.length, jogos: semDemo.filter(filtro)
        }, null, 1) + '\n');
    }
    return r;
}

// ---- linha de comando ----
const direto = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (direto) {
    const args = lerArgs(process.argv.slice(2));
    const fonte = args._[0] || README_OFICIAL;
    let texto;
    try {
        texto = /^https?:\/\//i.test(fonte) ? await baixarTexto(fonte) : fs.readFileSync(fonte === '-' ? 0 : fonte, 'utf8');
    } catch (e) {
        console.error('Não deu para ler a lista: ' + e.message);
        process.exit(1);
    }
    try {
        const r = importarWebPorts(texto, { console: args.console || 'auto', secao: args.secao, limite: args.limite, simular: !!args.simular, atualizar: !!args.atualizar });
        console.log(`${args.simular ? '[simulação] ' : ''}Lista lida: ${r.lidos} jogos jogáveis · ${r.semDemo} só com código-fonte`);
        console.log(`Novos: ${r.novos} · atualizados: ${r.atualizados} · iguais: ${r.iguais} · já existiam (não mexi): ${r.pulados}`);
        console.log('Todos entram como RASCUNHO com licença "nao-verificada". Para publicar um jogo: abra no painel,');
        console.log('confira a licença (livre / autorizada / precisa-original) e tire o rascunho. Jogo pesado → marque "Só PC".');
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}
