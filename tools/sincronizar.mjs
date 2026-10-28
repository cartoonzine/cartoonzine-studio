#!/usr/bin/env node
/**
 * Modo automático: puxa as fontes de automatico/fontes.json para conteudo/.
 * Roda sozinho no GitHub Actions (todo dia) ou à mão:  node tools/sincronizar.mjs
 *
 * Regras de convivência com o que você faz à mão:
 *   - itens criados aqui ganham "_origem": "auto:<nome da fonte>"
 *   - itens que você editou e marcou com "_travado": true nunca são mexidos
 *   - itens manuais (sem _origem) só ganham episódios/links novos, nunca perdem nada
 *   - "removerSumidos": true apaga itens automáticos que saíram da fonte
 */
import fs from 'node:fs';
import path from 'node:path';
import { Core, RAIZ, lerConfig, acharColecao, lerArgs, lerColecao, baixarTexto, importarTexto } from './lib.mjs';
import { sincronizarYouTube } from './youtube.mjs';

export async function sincronizar({ raiz = RAIZ, log = console.log, so } = {}) {
    const config = lerConfig(raiz);
    const arq = path.join(raiz, 'automatico', 'fontes.json');
    const { fontes = [] } = JSON.parse(fs.readFileSync(arq, 'utf8'));
    const resumo = [];
    for (const f of fontes) {
        if (f.ativo === false || (so && f.nome !== so)) continue;
        const colecao = acharColecao(config, f.colecao);
        const origem = 'auto:' + f.nome;
        log(`\n▶ ${f.nome} → ${colecao.nome}`);
        try {
            // lista de canais do YouTube → itens do YouToon (live / episódios / playlists), pela YouTube API
            if (f.tipo === 'youtube-lista') {
                const r = await sincronizarYouTube(f, colecao, { raiz, origem, log });
                resumo.push(Object.assign({ fonte: f.nome }, r));
                continue;
            }
            let texto;
            if (f.tipo === 'archive') texto = [].concat(f.ids || f.id).map(id => 'https://archive.org/details/' + id).join('\n');
            else if (f.tipo === 'archive-busca') texto = await buscarNoArchive(f.busca, f.limite || 50, f.ordem);
            else texto = await baixarTexto(f.url);

            // itens travados não podem ser tocados: tira do caminho antes de importar
            const travados = new Set(lerColecao(colecao, raiz).entradas.filter(e => e.item._travado).map(e => Core.normText(e.item.nome)));
            if (f.filtro) {
                const re = new RegExp(f.filtro, 'i');
                texto = filtrarTexto(texto, re);
            }
            const antes = new Set(lerColecao(colecao, raiz).entradas.filter(e => e.item._origem === origem && !e.item._travado).map(e => e.caminho));
            const { resultado, falhas } = await importarTexto(colecao, texto, {
                args: Object.assign({}, f.padroes || {}, { dados: !!(f.dados || f.wiki) }), raiz, origem, config,
                log: () => {}, filtroNome: n => !travados.has(Core.normText(n))
            });
            const vistos = new Set(resultado.map(r => r.caminho));
            let removidos = 0;
            if (f.removerSumidos) {
                for (const c of antes) if (!vistos.has(c)) { fs.rmSync(path.join(raiz, c)); removidos++; }
            }
            const conta = a => resultado.filter(r => r.acao === a).length;
            log(`  ✅ ${conta('criado')} novos · 🔄 ${conta('atualizado')} atualizados · ✗ ${falhas.length} com erro · 🗑 ${removidos} removidos`);
            resumo.push({ fonte: f.nome, criados: conta('criado'), atualizados: conta('atualizado'), erros: falhas.length, removidos });
        } catch (e) {
            log('  ⚠ fonte ignorada desta vez: ' + e.message);
            resumo.push({ fonte: f.nome, falhou: e.message });
        }
    }
    return resumo;
}

/** Busca na API do Internet Archive e devolve um link por item achado. */
async function buscarNoArchive(busca, limite, ordem) {
    // "ordem" (ex.: "downloads desc") deixa o resultado estável: sem ela o archive devolve em ordem variável
    const url = 'https://archive.org/advancedsearch.php?fl[]=identifier&rows=' + limite + '&output=json' +
        (ordem ? '&sort[]=' + encodeURIComponent(ordem) : '') + '&q=' + encodeURIComponent(busca);
    const j = JSON.parse(await baixarTexto(url));
    return (j.response?.docs || []).map(d => 'https://archive.org/details/' + d.identifier).join('\n');
}

/** Mantém só as entradas de M3U (ou linhas) que batem com o filtro. */
function filtrarTexto(texto, re) {
    if (!/#EXTINF/i.test(texto)) return texto.split(/\r?\n/).filter(l => re.test(l)).join('\n');
    const linhas = texto.split(/\r?\n/), out = ['#EXTM3U'];
    for (let i = 0; i < linhas.length; i++) {
        if (!/^#EXTINF/i.test(linhas[i])) continue;
        const bloco = [linhas[i]];
        let j = i + 1;
        while (j < linhas.length && linhas[j].startsWith('#')) bloco.push(linhas[j++]);
        if (j < linhas.length) bloco.push(linhas[j]);
        if (re.test(bloco[0])) out.push(...bloco);
        i = j;
    }
    return out.join('\n');
}

if (process.argv[1]?.endsWith('sincronizar.mjs')) {
    const args = lerArgs(process.argv.slice(2));
    const r = await sincronizar({ so: args.fonte });
    if (!r.length) console.log('Nenhuma fonte ativa em automatico/fontes.json.');
}
