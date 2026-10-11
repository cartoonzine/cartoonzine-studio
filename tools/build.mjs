#!/usr/bin/env node
/**
 * Gera os DBs publicados (dist/) a partir de conteudo/.
 *
 *   node tools/build.mjs            gera tudo
 *   node tools/build.mjs --estrito  falha (código 1) se algum item tiver erro
 *
 * Saída em dist/:
 *   <colecao>.json / .m3u          o DB de cada coleção
 *   canais/pais/<pais>.m3u         canais e rádios separados por país
 *   jogos/<console>.json           um DB por console
 *   fontes-cloud.json              as fontes prontas para o sources.json do cartoonzine-cloud
 *   index.json                     resumo: coleções, totais e links
 *   relatorio.json                 erros e avisos item por item
 */
import fs from 'node:fs';
import path from 'node:path';
import { Core, RAIZ, lerConfig, lerColecao, lerArgs } from './lib.mjs';

export function build({ raiz = RAIZ, saida, log = console.log } = {}) {
    const config = lerConfig(raiz);
    const dist = saida || path.join(raiz, 'dist');
    const novo = dist + '.tmp';
    fs.rmSync(novo, { recursive: true, force: true });
    fs.mkdirSync(novo, { recursive: true });

    const index = {
        projeto: config.projeto, versaoStudio: Core.VERSAO, geradoEm: new Date().toISOString(),
        baseUrl: config.publicacao.baseUrl, colecoes: []
    };
    const todasFontes = [];
    const relatorio = { geradoEm: index.geradoEm, colecoes: [] };
    let totalErros = 0;
    const indicePainel = [];

    for (const colecao of config.colecoes) {
        const { entradas, quebrados } = lerColecao(colecao, raiz);
        const { arquivos, fontes, relatorio: rel } = Core.compilarColecao(colecao, entradas, config);
        for (const e of entradas) indicePainel.push(Core.resumoItem(e.caminho, e.item));
        rel.erros.unshift(...quebrados);
        rel.total += quebrados.length;
        totalErros += rel.erros.length;
        for (const [rotaRel, conteudo] of Object.entries(arquivos)) {
            const abs = path.join(novo, rotaRel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, conteudo);
        }
        todasFontes.push(...fontes.map(f => Object.assign({ _colecao: colecao.id }, f)));
        index.colecoes.push({
            id: colecao.id, nome: colecao.nome, tipo: colecao.tipo, app: colecao.app,
            publicados: rel.publicados, comErro: rel.erros.length,
            arquivos: Object.keys(arquivos).map(a => config.publicacao.baseUrl + a),
            ...(rel.porPais ? { porPais: rel.porPais } : {}),
            ...(rel.porConsole ? { porConsole: rel.porConsole } : {})
        });
        relatorio.colecoes.push(rel);
        const extra = rel.erros.length ? `  ⚠ ${rel.erros.length} com erro` : '';
        log(`${(colecao.icone || '•')} ${colecao.nome.padEnd(20)} ${String(rel.publicados).padStart(6)} publicados${extra}`);
        for (const e of rel.erros.slice(0, 20)) log(`     ✗ ${e.caminho}: ${e.msg}`);
        if (rel.erros.length > 20) log(`     … e mais ${rel.erros.length - 20} (veja dist/relatorio.json)`);
    }

    fs.writeFileSync(path.join(novo, 'fontes-cloud.json'), JSON.stringify(todasFontes, null, 2) + '\n');
    fs.writeFileSync(path.join(novo, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    fs.writeFileSync(path.join(novo, 'indice-painel.json'), JSON.stringify(indicePainel));
    fs.writeFileSync(path.join(novo, 'relatorio.json'), JSON.stringify(relatorio, null, 2) + '\n');
    // saude.json é do verificador de links: atravessa os builds
    const saude = path.join(dist, 'saude.json');
    if (fs.existsSync(saude)) fs.copyFileSync(saude, path.join(novo, 'saude.json'));

    // Troca atômica: quem lê dist/ nunca vê um build pela metade
    fs.rmSync(dist, { recursive: true, force: true });
    fs.renameSync(novo, dist);
    return { index, relatorio, totalErros, fontes: todasFontes };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build.mjs')) {
    const args = lerArgs(process.argv.slice(2));
    const r = build();
    const total = r.index.colecoes.reduce((n, c) => n + c.publicados, 0);
    console.log(`\n✅ ${total} itens publicados em dist/ · ${r.fontes.length} fontes para o cartoonzine-cloud`);
    if (r.totalErros) console.log(`⚠ ${r.totalErros} item(ns) com erro ficaram de fora — detalhes em dist/relatorio.json`);
    if (args.estrito && r.totalErros) process.exit(1);
}
