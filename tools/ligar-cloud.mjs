#!/usr/bin/env node
/**
 * Liga o Studio ao cartoonzine-cloud: preenche no sources.json do cloud as
 * URLs dos DBs do Studio. Só precisa rodar UMA vez (as URLs nunca mudam),
 * ou de novo quando você criar uma coleção nova.
 *
 *   node tools/ligar-cloud.mjs ../cartoonzine-cloud/sources.json
 *   node tools/ligar-cloud.mjs ../cartoonzine-cloud/sources.json --simular
 *
 * Como casa as fontes: pelo "nome" (ex.: a vaga vazia "Cartoons VOD"), e os
 * jogos pelo "console". O que não existir lá é adicionado no fim da lista.
 * As outras fontes do cloud (Saimo, Pluto TV...) não são tocadas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, lerArgs } from './lib.mjs';
import { build } from './build.mjs';

const args = lerArgs(process.argv.slice(2));
const alvo = args._[0];
if (!alvo) { console.log('Uso: node tools/ligar-cloud.mjs <caminho do sources.json do cartoonzine-cloud> [--simular]'); process.exit(1); }

const arqFontes = path.join(RAIZ, 'dist', 'fontes-cloud.json');
if (!fs.existsSync(arqFontes)) build({ log: () => {} });
const doStudio = JSON.parse(fs.readFileSync(arqFontes, 'utf8'));
// o sources.json do cloud é editado à mão e aceita vírgula sobrando (o cloud lê assim): aqui também
const lerTolerante = (t) => { try { return JSON.parse(t); } catch (e) { return JSON.parse(t.replace(/^\uFEFF/, '').replace(/,(\s*[}\]])/g, '$1')); } };
const sources = lerTolerante(fs.readFileSync(alvo, 'utf8'));
sources.fontes = sources.fontes || [];

let atualizadas = 0, novas = 0;
for (const f of doStudio) {
    const { _colecao, ...fonte } = f;
    let atual = sources.fontes.find(x => x._studio === _colecao + (fonte.console ? ':' + fonte.console : ''));
    if (!atual && fonte.console) atual = sources.fontes.find(x => x.tipo === 'emulator_json' && x.console === fonte.console && !x.url);
    if (!atual) atual = sources.fontes.find(x => x.nome === fonte.nome && !x.url);
    if (!atual) atual = sources.fontes.find(x => x.nome === fonte.nome && x._studio);
    if (atual) {
        // não apaga nenhum campo extra que você tenha posto no cloud; só atualiza os do Studio
        for (const k of Object.keys(atual)) if (k !== 'nome' && k !== 'ativo' && !k.startsWith('_') && !(k in fonte)) {
            if (['url', 'urls', 'formato'].includes(k)) delete atual[k];
        }
        Object.assign(atual, fonte, { nome: atual.nome });
        atual._studio = _colecao + (fonte.console ? ':' + fonte.console : '');
        atualizadas++;
    } else {
        sources.fontes.push(Object.assign({}, fonte, { _studio: _colecao + (fonte.console ? ':' + fonte.console : '') }));
        novas++;
    }
}

// fontes do Studio que não existem mais (ex.: um console que saiu do studio.config.json) saem do cloud
const chaves = new Set(doStudio.map(f => f._colecao + (f.console ? ':' + f.console : '')));
const antes = sources.fontes.length;
sources.fontes = sources.fontes.filter(x => !x._studio || chaves.has(x._studio));
const removidas = antes - sources.fontes.length;

if (args.simular) {
    console.log(JSON.stringify(sources.fontes.filter(x => x._studio), null, 2));
    console.log(`\n(simulação) ${atualizadas} vagas seriam preenchidas, ${novas} fontes novas, ${removidas} removidas.`);
} else {
    fs.writeFileSync(alvo, JSON.stringify(sources, null, 2) + '\n');
    console.log(`✅ ${atualizadas} vagas preenchidas, ${novas} fontes novas e ${removidas} removidas em ${alvo}`);
    console.log('Faça commit/push do cartoonzine-cloud: o robô de lá reconstrói o catálogo sozinho.');
}
