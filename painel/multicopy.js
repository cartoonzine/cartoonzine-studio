/**
 * 🧬 MULTI COPY — o mesmo vídeo cadastrado mais de uma vez, num lugar só.
 *
 * Grupos (calculados do índice do painel por StudioCore.gruposMultiCopy):
 *   🟢 certeza  — mesmo TMDB, mesmo IMDb ou o mesmo link em itens diferentes → "Juntar" vira 1 item (1 card no app)
 *   🟡 provável — mesmo nome limpo e ano → você confirma (Juntar) ou diz "São diferentes" (fica lembrado)
 *   🎞 cópias   — um item com vários links: ☑ publicado (vai para o app: ★ = ativa, as outras = reserva automática),
 *                 desmarcado = desativado (guardado no Studio), 🗑 = removido (dá para restaurar)
 *
 * Juntar: o item ★ fica com a ficha (o que estiver vazio é completado pelos outros), todos os links viram cópias
 * dele e os outros arquivos vão para conteudo/lixeira/ (dá para restaurar). A memória (são diferentes, lixeira,
 * links removidos) fica em conteudo/multicopy.json.
 *
 *   window.CZMultiCopy.desenhar(area, S)   S = { C, config(), indice(), ler(c), gravar(m, msg), esc, aviso, local() }
 */
(function () {
    'use strict';
    const ARQ = 'conteudo/multicopy.json';
    let S = null, area = null;
    const E = { filtro: 'todos', col: '', busca: '', mostrar: 30, memoria: null, itens: new Map(), teste: new Map(), base: new Map(), abertos: new Set(), lendo: new Set() };
    const esc = (t) => S.esc(t);
    const $ = (q) => area && area.querySelector(q);
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return /^magnet:/i.test(u) ? 'torrent' : String(u).slice(0, 30); } };
    const arquivo = (u) => { try { const p = decodeURIComponent(new URL(u).pathname); return p.split('/').filter(Boolean).pop() || p; } catch (e) { return ''; } };
    const num = (n) => Number(n || 0).toLocaleString('pt-BR');
    const hoje = () => new Date().toISOString().slice(0, 10);
    const colDe = (caminho) => (String(caminho).match(/^conteudo\/([^/]+)\//) || [])[1] || '';
    const colecao = (id) => (S.config().colecoes || []).find(c => c.id === id) || { id, nome: id, tipo: 'video' };

    async function memoria() {
        if (E.memoria) return E.memoria;
        try { E.memoria = (await S.ler(ARQ)) || {}; } catch (e) { E.memoria = {}; }
        E.memoria.naoIguais = E.memoria.naoIguais || []; E.memoria.lixeira = E.memoria.lixeira || []; E.memoria.linksRemovidos = E.memoria.linksRemovidos || []; E.memoria.trocas = E.memoria.trocas || [];
        return E.memoria;
    }
    const memoriaJSON = () => JSON.stringify(E.memoria, null, 1) + '\n';
    async function item(caminho) {
        if (E.itens.has(caminho)) return E.itens.get(caminho);
        const it = S.C.normalizarItem(await S.ler(caminho), colecao(colDe(caminho)));
        E.itens.set(caminho, it);
        return it;
    }

    function grupos() {
        const gs = S.C.gruposMultiCopy(S.indice() || [], S.config(), E.memoria || {});
        const b = S.C.normText ? S.C.normText(E.busca) : E.busca.toLowerCase();
        return gs.filter(g => (!E.col || g.colecao === E.col) && (!b || g.itens.some(r => (S.C.normText ? S.C.normText(r.nome || '') : String(r.nome).toLowerCase()).includes(b) || (r.lks || []).some(u => u.toLowerCase().includes(E.busca.toLowerCase())) || String(r.tmdb || '').includes(E.busca))));
    }

    async function desenhar(a, s) {
        area = a; S = s;
        area.innerHTML = '<div class="mc"><p class="dica" style="padding:30px">🧬 Procurando cópias…</p></div>';
        await memoria();
        pintar();
    }

    function pintar() {
        if (!area || !area.isConnected) return;
        const todos = grupos();
        const n = { certeza: 0, provavel: 0, copias: 0 };
        todos.forEach(g => n[g.nivel]++);
        const nCopias = todos.reduce((t, g) => t + g.itens.reduce((x, r) => x + (r.lks || []).length + (r.off || 0), 0), 0);
        const trocados = new Set(E.memoria.trocas.map(t => t.caminho));
        const lista = E.filtro === 'removidas' || E.filtro === 'trocas' ? [] : E.filtro === 'todos' ? todos : todos.filter(g => g.nivel === E.filtro);
        E.trocados = trocados;
        const vis = lista.slice(0, E.mostrar);
        const cols = [...new Set((S.indice() || []).map(r => colDe(r.caminho)))].map(colecao).filter(c => c.tipo === 'video');
        const lix = E.memoria.lixeira.length + E.memoria.linksRemovidos.length;
        area.innerHTML = `<div class="mc">
          <div class="mc-topo"><h2>🧬 <b>Multi Copy</b></h2><span class="dica">o mesmo vídeo cadastrado mais de uma vez, num lugar só · no app aparece <b>1 card</b>: a ★ ativa toca e as outras são reserva automática</span></div>
          <div class="mc-kpis">
            <div class="mc-k a"><b>${num(todos.length)}</b><small>grupos</small></div>
            <div class="mc-k v"><b>${num(n.certeza)}</b><small>🟢 para juntar (certeza)</small></div>
            <div class="mc-k y"><b>${num(n.provavel)}</b><small>🟡 para olhar (provável)</small></div>
            <div class="mc-k r"><b>${num(n.copias)}</b><small>🎞 títulos com cópias</small></div>
            <div class="mc-k d"><b>${num(E.memoria.trocas.length)}</b><small>🔴 ativa morreu → trocada (30 dias)</small></div>
          </div>
          <div class="mc-grade">
            <aside class="mc-lado">
              <input class="campo" id="mc-busca" placeholder="🔎 Buscar título, link, TMDB…" value="${esc(E.busca)}">
              <div class="mc-rot">Mostrar</div>
              ${[['todos', 'Todos os grupos', todos.length], ['provavel', '🟡 Para olhar', n.provavel], ['certeza', '🟢 Para juntar', n.certeza], ['copias', '🎞 Títulos com cópias', n.copias], ['trocas', '🔴 Ativa trocada', E.memoria.trocas.length], ['removidas', '🗑 Removidas', lix]]
                .map(([k, t, c]) => `<button class="mc-f ${E.filtro === k ? 'on' : ''}" data-f="${k}"><span>${t}</span><i>${num(c)}</i></button>`).join('')}
              <div class="mc-rot">Onde</div>
              <div class="mc-chips"><button class="mc-chip ${!E.col ? 'on' : ''}" data-col="">Todas</button>${cols.map(c => `<button class="mc-chip ${E.col === c.id ? 'on' : ''}" data-col="${esc(c.id)}">${esc((c.icone ? c.icone + ' ' : '') + c.nome)}</button>`).join('')}</div>
              ${S.local() ? '<button class="btn mini" id="mc-testar" style="margin-top:14px;width:100%" title="Testa as cópias desta tela pelo painel do PC">⚡ Testar as cópias da tela</button>' : '<p class="dica" style="margin-top:14px">O teste das cópias funciona no painel do PC.</p>'}
              <p class="dica" style="margin-top:12px">🤖 Todo dia o robô testa as ativas: se a ativa morrer, a melhor reserva assume sozinha (🔴). O que está na lixeira há mais de 30 dias sai de vez.</p>
            <p class="dica">Como ele reconhece: <b>mesmo TMDB, IMDb ou link</b> = certeza · <b>mesmo nome e ano</b> = provável (você confirma) · TMDB diferente nunca junta.</p>
            </aside>
            <section class="mc-lista">
              ${E.filtro === 'removidas' ? removidasHTML() : E.filtro === 'trocas' ? trocasHTML() : vis.length ? vis.map((g, i) => grupoHTML(g, i)).join('') : '<div class="vazio"><b>Nada aqui 🎉</b>Nenhum vídeo repetido neste filtro.</div>'}
              ${lista.length > vis.length ? `<button class="btn" id="mc-mais">Mostrar mais (${num(lista.length - vis.length)})</button>` : ''}
            </section>
          </div>
        </div>`;
        E.vis = vis;
        ligar();
        // os grupos visíveis carregam as fichas (para mostrar as cópias desativadas e poder juntar)
        carregarVisiveis(vis);
    }

    function carregarVisiveis(vis) {
        const falta = [...new Set(vis.flatMap(g => g.itens.map(r => r.caminho)))].filter(c => !E.itens.has(c) && !E.lendo.has(c));
        if (!falta.length) return;
        falta.forEach(c => E.lendo.add(c));
        let k = 0;
        const um = async () => { while (k < falta.length) { const c = falta[k++]; try { await item(c); } catch (e) { /* */ } E.lendo.delete(c); } };
        Promise.all(Array.from({ length: 6 }, um)).then(() => { if (area && area.isConnected && !area.querySelector('.mc-ocupado')) pintar(); });
    }

    function linhaCopia(g, gi, u, i, ativa, publicado) {
        const t = E.teste.get(u), q = S.C.qualidadeDoTexto ? S.C.qualidadeDoTexto(u) : '';
        const a = S.C.analisarNome ? S.C.analisarNome(arquivo(u)).audio : '';
        return `<tr class="${ativa ? 'ativa' : ''}${publicado ? '' : ' off'}">
          <td><label class="mc-pub" title="${publicado ? 'Publicado: vai para o app' : 'Desativado: fica guardado no Studio'}"><input type="checkbox" data-pub="${gi}" data-u="${esc(u)}" ${publicado ? 'checked' : ''}><span></span></label>${ativa ? ' <b class="mc-star" title="Ativa (toca primeiro)">★</b>' : ''}</td>
          <td title="${esc(u)}"><b>${esc(host(u))}</b> <small>${esc(arquivo(u)).slice(0, 60)}</small></td>
          <td>${esc(q || '—')}</td><td>${esc(a || '—')}</td>
          <td class="${t ? (t.ok ? 'ok' : 'ruim') : ''}">${t ? (t.ok ? '✓ ' + num(t.ms) + ' ms' : '✕ ' + esc(t.motivo || 'não abre')) : '<span class="dica">—</span>'}</td>
          <td class="mc-acoes">${publicado && !ativa ? `<button data-ativa="${gi}" data-u="${esc(u)}" title="Fazer esta a ativa">★</button>` : ''}<a href="${esc(u)}" target="_blank" rel="noopener" title="Abrir">▶</a><button data-apagar="${gi}" data-u="${esc(u)}" title="Remover (vai para 🗑 Removidas)">🗑</button></td>
        </tr>`;
    }

    function grupoHTML(g, gi) {
        const c = colecao(g.colecao), r0 = g.itens[0];
        const extra = (g.itens.some(r => E.trocados.has(r.caminho)) ? '<span class="mc-tag d">🔁 ativa trocada pelo robô</span>' : '') +
            (g.itens.some(r => r.sc) ? `<span class="mc-tag c" title="Links que o Sidechain achou para este item: vão para o app como reserva automática">🔗 +${g.itens.reduce((t, r) => t + (r.sc || 0), 0)} reservas do Sidechain</span>` : '');
        const tag = extra + (g.nivel === 'certeza' ? `<span class="mc-tag v">✓ certeza: ${esc(g.motivos.join(' · '))}</span>` : g.nivel === 'provavel' ? `<span class="mc-tag y">🟡 provável: ${esc(g.motivos.join(' · '))}</span>` : '<span class="mc-tag r">🎞 cópias do mesmo item</span>');
        if (g.nivel === 'copias') {
            const it = E.itens.get(r0.caminho);
            const links = it ? it.links || [] : r0.lks || [], des = it ? it.linksDesativados || [] : [];
            return `<div class="mc-g">
              <div class="mc-gh">${capa(r0)}<div><h3>${esc(r0.nome)}${r0.ano ? ` <small>(${r0.ano})</small>` : ''}</h3><small>${esc(c.nome)}${r0.tmdb ? ' · TMDB ' + esc(r0.tmdb) : ''} · ${links.length} publicada${links.length === 1 ? '' : 's'}${des.length || r0.off ? ' · ' + (des.length || r0.off) + ' desativada(s)' : ''}</small></div><div class="mc-bd">${tag}</div></div>
              <table><tr><th>Pub.</th><th>Link</th><th>Qualidade</th><th>Áudio</th><th>Teste</th><th></th></tr>
                ${links.map((u, i) => linhaCopia(g, gi, u, i, i === 0, true)).join('')}${des.map(u => linhaCopia(g, gi, u, -1, false, false)).join('')}</table>
              ${!it ? '<div class="mc-bar"><span class="dica">lendo a ficha…</span></div>' : ''}
            </div>`;
        }
        const base = E.base.get(g.id) || melhorBase(g);
        return `<div class="mc-g ${g.nivel === 'provavel' ? 'prov' : ''}">
          <div class="mc-gh">${capa(r0)}<div><h3>${esc(r0.nome)}${r0.ano ? ` <small>(${r0.ano})</small>` : ''}</h3><small>${esc(c.nome)} · ${g.itens.length} itens com o mesmo vídeo</small></div><div class="mc-bd">${tag}</div></div>
          <table><tr><th title="O ★ fica com a ficha (nome, capa, sinopse); os outros viram cópias dele">★ Ficha</th><th>Item</th><th>Ano</th><th>TMDB</th><th>Links</th><th>Arquivo</th></tr>
            ${g.itens.map(r => `<tr class="${r.caminho === base ? 'ativa' : ''}"><td><label class="mc-radio"><input type="radio" name="mc-b-${gi}" data-base="${gi}" value="${esc(r.caminho)}" ${r.caminho === base ? 'checked' : ''}><span></span></label></td>
              <td><b>${esc(r.nome)}</b>${r.auto ? ' <small class="dica">auto</small>' : ''}</td><td>${esc(r.ano || '—')}</td><td>${esc(r.tmdb || '—')}</td>
              <td>${(r.lks || []).length}${r.off ? ` <small class="dica">+${r.off} off</small>` : ''}${r.eps ? ` <small class="dica">· ${r.eps} ep.</small>` : ''}</td><td class="dica" title="${esc(r.caminho)}">${esc(r.caminho.split('/').slice(2).join('/'))}</td></tr>`).join('')}
          </table>
          <div class="mc-bar">
            <button class="btn mini principal" data-juntar="${gi}" title="Vira 1 item: a ficha do ★ e todos os links como cópias (os outros arquivos vão para a lixeira, dá para restaurar)">✓ ${g.nivel === 'provavel' ? 'São o mesmo — juntar' : 'Juntar em 1 item'}</button>
            ${g.nivel === 'provavel' ? `<button class="btn mini" data-diferentes="${gi}">✕ São diferentes (não perguntar mais)</button>` : ''}
          </div>
        </div>`;
    }
    const capa = (r) => `<div class="mc-capa">${r.capa ? `<img src="${esc(r.capa)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '🎬'}</div>`;
    /** quem fica com a ficha: o que tem TMDB, mais dados e não veio do automático */
    function melhorBase(g) {
        const pts = (r) => (r.tmdb ? 4 : 0) + (r.capa ? 2 : 0) + (r.banner ? 1 : 0) + (r.ano ? 1 : 0) + (r.auto ? 0 : 2) + (r.eps ? 1 : 0);
        return g.itens.slice().sort((a, b) => pts(b) - pts(a))[0].caminho;
    }

    function trocasHTML() {
        const t = E.memoria.trocas;
        if (!t.length) return '<div class="vazio"><b>Nenhuma troca 🎉</b>Quando a cópia ativa de um vídeo morre, o robô coloca a melhor reserva no lugar e ela aparece aqui.</div>';
        return `<div class="mc-g"><div class="mc-gh"><div><h3>🔴 Ativa morreu → trocada pelo robô</h3><small>a morta foi para desativadas (fica guardada); confira e, se quiser, remova no grupo do título</small></div></div>
          <table><tr><th>Título</th><th>Morreu</th><th>Agora toca</th><th>Quando</th></tr>${t.map(x => `<tr><td><b>${esc(x.nome)}</b></td><td class="ruim" title="${esc(x.de)}">${esc(host(x.de))} <small>${esc(arquivo(x.de)).slice(0, 40)}</small></td><td class="ok" title="${esc(x.para)}">${esc(host(x.para))} <small>${esc(arquivo(x.para)).slice(0, 40)}</small></td><td class="dica">${esc(x.em)}</td></tr>`).join('')}</table></div>`;
    }
    function removidasHTML() {
        const m = E.memoria;
        if (!m.lixeira.length && !m.linksRemovidos.length) return '<div class="vazio"><b>Lixeira vazia</b>O que você juntar ou remover aparece aqui e dá para restaurar.</div>';
        return `<div class="mc-g"><div class="mc-gh"><div><h3>🗑 Itens juntados em outro</h3><small>o arquivo foi guardado em conteudo/lixeira/</small></div></div>
            <table>${m.lixeira.map((x, i) => `<tr><td><b>${esc(x.nome)}</b><br><small class="dica">${esc(x.motivo || '')} · ${esc(x.em)}</small></td><td class="dica">${esc(x.de)}</td><td class="mc-acoes"><button class="btn mini" data-restaurar="${i}">↩ Restaurar</button></td></tr>`).join('') || '<tr><td class="dica">nenhum</td></tr>'}</table></div>
          <div class="mc-g"><div class="mc-gh"><div><h3>🗑 Links removidos</h3><small>não vão para o app; restaurar volta como desativado</small></div></div>
            <table>${m.linksRemovidos.map((x, i) => `<tr><td><b>${esc(host(x.url))}</b> <small>${esc(arquivo(x.url))}</small><br><small class="dica">${esc(x.nome || x.caminho)} · ${esc(x.em)}</small></td><td class="mc-acoes"><button class="btn mini" data-restlink="${i}">↩ Restaurar</button></td></tr>`).join('') || '<tr><td class="dica">nenhum</td></tr>'}</table></div>`;
    }

    // ------------------------------------------------------------ ações
    async function salvar(mudancas, msg, botao) {
        mudancas.push({ caminho: ARQ, conteudo: memoriaJSON() });
        const t = botao ? botao.textContent : '';
        if (botao) { botao.disabled = true; botao.textContent = 'Salvando…'; }
        area.classList.add('mc-ocupado');
        try { await S.gravar(mudancas, msg); S.aviso('Salvo. ' + msg.replace(/^Multi Copy: /, ''), 'ok'); }
        catch (e) { S.aviso('Não deu para salvar: ' + e.message, 'ruim'); if (botao) { botao.disabled = false; botao.textContent = t; } }
        area.classList.remove('mc-ocupado');
        mudancas.forEach(m => E.itens.delete(m.caminho));
        pintar();
    }
    const ficha = (caminho, it) => ({ caminho, conteudo: S.C.serializar(S.C.normalizarItem(it, colecao(colDe(caminho)))) });

    async function juntar(g, botao) {
        const base = E.base.get(g.id) || melhorBase(g);
        let out;
        try { out = JSON.parse(JSON.stringify(await item(base))); } catch (e) { return S.aviso('Não deu para ler ' + base + ': ' + e.message, 'ruim'); }
        const mud = [];
        for (const r of g.itens) {
            if (r.caminho === base) continue;
            let o; try { o = await item(r.caminho); } catch (e) { return S.aviso('Não deu para ler ' + r.caminho, 'ruim'); }
            const limpo = Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));   // marcas internas (_origem…) ficam com o ★
            out = S.C.mesclarItem(out, limpo);     // ficha do ★ (o vazio é completado) + links e episódios de todos
            out.linksDesativados = [...new Set([].concat(out.linksDesativados || [], o.linksDesativados || []))].filter(u => !(out.links || []).includes(u));
            out._juntados = (out._juntados || []).concat({ de: r.caminho, em: hoje() });
            const lix = 'conteudo/lixeira/' + r.caminho.replace(/^conteudo\//, '');
            mud.push({ caminho: r.caminho, conteudo: null }, { caminho: lix, conteudo: JSON.stringify(o, null, 2) + '\n' });
            E.memoria.lixeira.unshift({ de: r.caminho, arquivo: lix, nome: o.nome, juntadoEm: base, motivo: 'juntado em ' + (out.nome || base), em: hoje() });
        }
        if (!(out.linksDesativados || []).length) delete out.linksDesativados;
        mud.unshift(ficha(base, out));
        await salvar(mud, `Multi Copy: junta "${out.nome}" (${g.itens.length} itens → 1)`, botao);
    }

    async function mexerCopias(g, fn, msg) {
        const r = g.itens[0];
        let it; try { it = JSON.parse(JSON.stringify(await item(r.caminho))); } catch (e) { return S.aviso('Não deu para ler a ficha.', 'ruim'); }
        it.links = it.links || []; it.linksDesativados = it.linksDesativados || [];
        if (fn(it) === false) return;
        if (!it.links.length) return S.aviso('Fica pelo menos 1 cópia publicada (senão o item sai do app).', 'ruim');
        if (!it.linksDesativados.length) delete it.linksDesativados;
        await salvar([ficha(r.caminho, it)], `Multi Copy: ${msg} — ${it.nome}`);
    }

    async function testar(botao) {
        const urls = [...new Set(E.vis.flatMap(g => g.itens.flatMap(r => { const it = E.itens.get(r.caminho); return it ? [].concat(it.links || [], it.linksDesativados || []) : r.lks || []; })))].filter(u => !E.teste.has(u) && !/^magnet:/i.test(u));
        if (!urls.length) return S.aviso('As cópias desta tela já foram testadas.', 'ok');
        botao.disabled = true;
        let k = 0, feitos = 0;
        const um = async () => {
            while (k < urls.length) {
                const u = urls[k++];
                try { const r = await (await fetch('/api/linkedit/testar?' + new URLSearchParams({ url: u, modo: 'rapido' }))).json(); E.teste.set(u, { ok: ['vivo', 'lento', 'pede-ua'].includes(r.status), ms: r.ms || 0, motivo: r.motivo }); }
                catch (e) { E.teste.set(u, { ok: false, motivo: e.message }); }
                botao.textContent = `Testando ${++feitos}/${urls.length}…`;
            }
        };
        await Promise.all(Array.from({ length: 8 }, um));
        pintar();
    }

    function ligar() {
        const busca = $('#mc-busca');
        if (busca) busca.oninput = () => { E.busca = busca.value; E.mostrar = 30; clearTimeout(E.t); E.t = setTimeout(() => { pintar(); const b = $('#mc-busca'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }, 250); };
        area.onclick = async (ev) => {
            const b = ev.target.closest('button'); if (!b) return;
            const g = (k) => E.vis[+b.dataset[k]];
            if (b.dataset.f) { E.filtro = b.dataset.f; E.mostrar = 30; return pintar(); }
            if (b.dataset.col != null) { E.col = b.dataset.col; E.mostrar = 30; return pintar(); }
            if (b.id === 'mc-mais') { E.mostrar += 30; return pintar(); }
            if (b.id === 'mc-testar') return testar(b);
            if (b.dataset.juntar != null) return juntar(g('juntar'), b);
            if (b.dataset.diferentes != null) {
                const gr = g('diferentes'), cs = gr.itens.map(r => r.caminho);
                for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) E.memoria.naoIguais.push([cs[i], cs[j]].sort().join('|'));
                E.memoria.naoIguais = [...new Set(E.memoria.naoIguais)];
                return salvar([], `Multi Copy: "${gr.itens[0].nome}" são diferentes`, b);
            }
            if (b.dataset.ativa != null) { const u = b.dataset.u; return mexerCopias(g('ativa'), it => { it.links = [u].concat(it.links.filter(x => x !== u)); }, 'nova cópia ativa'); }
            if (b.dataset.apagar != null) {
                const gr = g('apagar'), u = b.dataset.u;
                return mexerCopias(gr, it => {
                    it.links = it.links.filter(x => x !== u); it.linksDesativados = it.linksDesativados.filter(x => x !== u);
                    E.memoria.linksRemovidos.unshift({ caminho: gr.itens[0].caminho, nome: it.nome, url: u, em: hoje() });
                }, 'cópia removida');
            }
            if (b.dataset.restaurar != null) {
                const i = +b.dataset.restaurar, x = E.memoria.lixeira[i];
                let o; try { o = await S.ler(x.arquivo); } catch (e) { return S.aviso('Não achei o arquivo na lixeira.', 'ruim'); }
                E.memoria.lixeira.splice(i, 1);
                return salvar([{ caminho: x.de, conteudo: JSON.stringify(o, null, 2) + '\n' }, { caminho: x.arquivo, conteudo: null }], `Multi Copy: restaura "${x.nome}"`, b);
            }
            if (b.dataset.restlink != null) {
                const i = +b.dataset.restlink, x = E.memoria.linksRemovidos[i];
                let it; try { it = JSON.parse(JSON.stringify(await item(x.caminho))); } catch (e) { return S.aviso('O item não existe mais.', 'ruim'); }
                it.linksDesativados = [...new Set((it.linksDesativados || []).concat(x.url))];
                E.memoria.linksRemovidos.splice(i, 1);
                return salvar([ficha(x.caminho, it)], `Multi Copy: restaura um link de "${it.nome}" (desativado)`, b);
            }
        };
        area.onchange = (ev) => {
            const t = ev.target;
            if (t.dataset.base != null) { const gr = E.vis[+t.dataset.base]; E.base.set(gr.id, t.value); return pintar(); }
            if (t.dataset.pub != null) {
                const gr = E.vis[+t.dataset.pub], u = t.dataset.u, on = t.checked;
                return mexerCopias(gr, it => {
                    if (on) { it.linksDesativados = it.linksDesativados.filter(x => x !== u); if (!it.links.includes(u)) it.links.push(u); }
                    else { it.links = it.links.filter(x => x !== u); if (!it.linksDesativados.includes(u)) it.linksDesativados.push(u); }
                }, on ? 'cópia publicada' : 'cópia desativada');
            }
        };
    }

    window.CZMultiCopy = { desenhar };
})();
