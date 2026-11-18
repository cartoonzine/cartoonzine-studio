/**
 * 🎞️ Cópias do mesmo título — aba "Cópias" das coleções do Studio.
 *
 * Um título (filme, canal, rádio) com vários links: o 1º é o principal, os outros são reserva (o player troca
 * sozinho se o principal cair). Aqui você vê as cópias lado a lado e decide a ordem — ou deixa o automático
 * decidir pelos critérios (qualidade, dublado, https, abre rápido). Cópia desativada fica guardada no Studio
 * (linksDesativados) e não vai para o app.
 *
 *   window.CZCopias.desenhar(area, S)   S = { C, col, indice(), ler(c), gravar(m, msg), esc, aviso, local() }
 */
(function () {
    'use strict';
    const GUARDA = 'czs-copias-v1';
    const LIBS = { hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js' };
    const ROT_CRIT = { qualidade: ['Qualidade', '4K > FHD > HD > SD, pelo nome do arquivo/link'], dublado: ['Dublado primeiro', 'link com "dub", "dublado" ou "dual" no nome'],
        https: ['HTTPS primeiro', 'abre em mais aparelhos e no navegador'], rapido: ['Abre mais rápido', 'pelo teste (botão Testar as cópias, no painel do PC)'] };
    let S = null, area = null;
    const E = { col: '', grupos: [], carregando: false, filtro: 'olhar', mostrar: 40, teste: new Map(), mudou: new Set(), criterios: null };
    const ler = (k, d) => { try { const v = JSON.parse(localStorage.getItem(GUARDA + '-' + k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
    const gravar = (k, v) => { try { localStorage.setItem(GUARDA + '-' + k, JSON.stringify(v)); } catch (e) { /* */ } };
    const esc = (t) => S.esc(t);
    const $ = (q) => area && area.querySelector(q);
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u).slice(0, 30); } };
    const arquivo = (u) => { try { const p = decodeURIComponent(new URL(u).pathname); return p.split('/').filter(Boolean).pop() || p; } catch (e) { return ''; } };
    const formato = (u) => { const m = /\.([a-z0-9]{2,5})(\?|#|$)/i.exec(String(u).split('?')[0]); return /^magnet:/i.test(u) ? 'torrent' : m ? m[1].toLowerCase() : /m3u8/i.test(u) ? 'm3u8' : '—'; };

    function sugestao(g) {
        return S.C.ordenarCopias(g.item.links || [], { criterios: E.criterios, teste: E.teste });
    }

    async function carregar() {
        const ids = (S.indice() || []).filter(i => i.caminho.startsWith('conteudo/' + E.col + '/') && i.links > 1);
        E.grupos = ids.map(i => ({ caminho: i.caminho, nome: i.nome, capa: i.capa, n: i.links, item: null }));
        E.carregando = true; pintar();
        let k = 0;
        const um = async () => {
            while (k < E.grupos.length) {
                const g = E.grupos[k++];
                try { g.item = S.C.normalizarItem(await S.ler(g.caminho), S.col); g.original = foto(g.item); } catch (e) { g.erro = e.message; }
                if (k % 20 === 0) pintar();
            }
        };
        await Promise.all([um(), um(), um(), um(), um(), um()]);
        E.carregando = false; pintar();
    }

    function pintar() {
        if (!area || !area.isConnected) return;
        const prontos = E.grupos.filter(g => g.item);
        prontos.forEach(g => { const s = sugestao(g); g.certeza = s.certeza; g.sugerida = s.ordem.map(x => x.url); g.info = new Map(s.ordem.map(x => [x.url, x])); g.naOrdem = JSON.stringify(g.sugerida) === JSON.stringify(g.item.links); });
        const olhar = prontos.filter(g => !g.certeza);
        const auto = prontos.filter(g => g.certeza && !g.naOrdem);
        const lista = E.filtro === 'olhar' ? olhar : E.filtro === 'auto' ? auto : prontos;
        const vis = lista.slice(0, E.mostrar);
        area.innerHTML = `
          <div class="copias">
            <div class="cop-topo">
              <div><b>${E.grupos.length}</b> ${E.grupos.length === 1 ? 'título' : 'títulos'} com cópias${E.carregando ? ` · lendo ${prontos.length}/${E.grupos.length}…` : ''} ·
                <b style="color:var(--verde)">${prontos.length - olhar.length}</b> o automático resolve · <b style="color:var(--amarelo)">${olhar.length}</b> para você olhar</div>
              <div class="espaco"></div>
              ${S.local() ? `<button class="btn" id="cop-testar" title="Testa cada cópia (só se responde e quanto demora) pelo painel do PC">⚡ Testar as cópias</button>` : ''}
              <button class="btn principal" id="cop-auto" ${auto.length ? '' : 'disabled'} title="Põe na ordem sugerida os títulos em que o automático tem certeza">Resolver no automático (${auto.length})</button>
              <button class="btn" id="cop-salvar" ${E.mudou.size ? '' : 'disabled'}>Salvar (${E.mudou.size})</button>
            </div>
            <div class="cop-crit"><span class="dica">O automático escolhe a principal por, nesta ordem:</span>
              ${E.criterios.map((c, i) => `<span class="cop-chip" title="${esc(ROT_CRIT[c][1])}"><b>${i + 1}</b> ${esc(ROT_CRIT[c][0])}<button data-sobe="${i}" aria-label="Subir ${esc(ROT_CRIT[c][0])}" ${i ? '' : 'disabled'}>▲</button><button data-desce="${i}" aria-label="Descer ${esc(ROT_CRIT[c][0])}" ${i < E.criterios.length - 1 ? '' : 'disabled'}>▼</button></span>`).join('')}
            </div>
            <div class="abas" role="tablist" style="margin:10px 0">
              <button class="aba ${E.filtro === 'olhar' ? 'ativa' : ''}" data-f="olhar">Para olhar (${olhar.length})</button>
              <button class="aba ${E.filtro === 'auto' ? 'ativa' : ''}" data-f="auto">O automático muda (${auto.length})</button>
              <button class="aba ${E.filtro === 'todos' ? 'ativa' : ''}" data-f="todos">Todos (${prontos.length})</button>
            </div>
            ${!E.grupos.length ? '<div class="vazio"><b>Nenhum título com cópias aqui</b>Quando um filme ou canal tiver mais de um link (por exemplo, juntado pelo Link Edit), ele aparece aqui.</div>' : ''}
            ${E.grupos.length && !vis.length && !E.carregando ? `<div class="vazio">${E.filtro === 'olhar' ? 'Nada para olhar: o automático resolve todos.' : 'Nada aqui.'}</div>` : ''}
            ${vis.map(g => grupoHTML(g, prontos.indexOf(g))).join('')}
            ${lista.length > vis.length ? `<button class="btn" id="cop-mais" style="margin-top:10px">Mostrar mais (${lista.length - vis.length})</button>` : ''}
            <p class="dica" style="margin-top:14px">No app aparece <b>um card só</b>: o 1º link é o principal; se ele cair, o player troca sozinho para a próxima reserva. Cópia desativada fica guardada aqui e não vai para o app.</p>
          </div>`;
        ligar(prontos);
    }

    function grupoHTML(g, idx) {
        const it = g.item, links = it.links || [], des = it.linksDesativados || [];
        const linha = (u, i, desativada) => {
            const x = g.info.get(u) || {}, t = E.teste.get(u);
            return `<div class="cop-linha${desativada ? ' des' : ''}">
              <span class="cop-n">${desativada ? '—' : i === 0 ? '★' : i + 1}</span>
              <span class="cop-link" title="${esc(u)}"><b>${esc(host(u))}</b><small>${esc(arquivo(u))}</small></span>
              <span class="cop-tag">${esc(x.qualidade || '—')}</span>
              <span class="cop-tag">${esc(x.audio || '—')}</span>
              <span class="cop-tag">${esc(formato(u))}${x.https ? ' · https' : ''}</span>
              <span class="cop-tag" style="color:${t ? (t.ok ? 'var(--verde)' : 'var(--erro)') : 'var(--suave)'}">${t ? (t.ok ? '✓ ' + (t.ms / 1000).toFixed(1).replace('.', ',') + ' s' : '✗ ' + (t.motivo || 'não abre')) : 'não testado'}</span>
              <span class="cop-acoes">${desativada ? `<button class="btn mini" data-reativar="${idx}" data-u="${esc(u)}">Reativar</button>`
                : `${i ? `<button class="btn mini" data-principal="${idx}" data-u="${esc(u)}">★ Principal</button><button class="btn mini fantasma" data-cima="${idx}" data-u="${esc(u)}" aria-label="Subir">▲</button>` : '<span class="selo">principal</span>'}
                  ${i < links.length - 1 ? `<button class="btn mini fantasma" data-baixo="${idx}" data-u="${esc(u)}" aria-label="Descer">▼</button>` : ''}
                  ${links.length > 1 ? `<button class="btn mini fantasma" data-desativar="${idx}" data-u="${esc(u)}">Desativar</button>` : ''}`}</span>
            </div>`;
        };
        const difere = !g.naOrdem;
        return `<div class="cop-grupo${E.mudou.has(g.caminho) ? ' mudou' : ''}">
            <div class="cop-cab">
              <div class="cop-capa">${g.capa ? `<img src="${esc(g.capa)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>
              <div><b>${esc(it.nome)}</b>${it.ano ? ` <span class="dica">(${it.ano})</span>` : ''}<div class="dica">${links.length} cópias${des.length ? ` · ${des.length} desativada${des.length > 1 ? 's' : ''}` : ''} · ${g.certeza ? (difere ? 'o automático mudaria a ordem' : 'já está na melhor ordem') : '<span style="color:var(--amarelo)">empate ou sem informação: escolha você</span>'}</div></div>
              <div class="espaco"></div>
              <button class="btn mini" data-tocar="${idx}">▶ Tocar lado a lado</button>
              ${difere && g.certeza ? `<button class="btn mini" data-sug="${idx}">Usar a ordem sugerida</button>` : ''}
            </div>
            ${links.map((u, i) => linha(u, i, false)).join('')}${des.map(u => linha(u, -1, true)).join('')}
          </div>`;
    }

    const foto = (it) => JSON.stringify([it.links || [], it.linksDesativados || []]);
    function mexer(g, fn) { fn(g.item); if (!(g.item.linksDesativados || []).length) delete g.item.linksDesativados; if (foto(g.item) === g.original) E.mudou.delete(g.caminho); else E.mudou.add(g.caminho); pintar(); }

    function ligar(prontos) {
        const pega = (b, attr) => prontos[+b.dataset[attr]];
        area.querySelectorAll('[data-f]').forEach(b => { b.onclick = () => { E.filtro = b.dataset.f; E.mostrar = 40; pintar(); }; });
        area.querySelectorAll('[data-sobe],[data-desce]').forEach(b => {
            b.onclick = () => {
                const i = +(b.dataset.sobe != null ? b.dataset.sobe : b.dataset.desce), j = b.dataset.sobe != null ? i - 1 : i + 1;
                [E.criterios[i], E.criterios[j]] = [E.criterios[j], E.criterios[i]]; gravar('criterios', E.criterios); pintar();
            };
        });
        const mais = $('#cop-mais'); if (mais) mais.onclick = () => { E.mostrar += 40; pintar(); };
        area.querySelectorAll('[data-principal]').forEach(b => { b.onclick = () => mexer(pega(b, 'principal'), it => { it.links = [b.dataset.u].concat(it.links.filter(u => u !== b.dataset.u)); }); });
        area.querySelectorAll('[data-cima],[data-baixo]').forEach(b => {
            b.onclick = () => { const g = pega(b, b.dataset.cima != null ? 'cima' : 'baixo'); mexer(g, it => { const i = it.links.indexOf(b.dataset.u), j = b.dataset.cima != null ? i - 1 : i + 1; if (j < 0 || j >= it.links.length) return; [it.links[i], it.links[j]] = [it.links[j], it.links[i]]; }); };
        });
        area.querySelectorAll('[data-desativar]').forEach(b => { b.onclick = () => mexer(pega(b, 'desativar'), it => { it.links = it.links.filter(u => u !== b.dataset.u); it.linksDesativados = (it.linksDesativados || []).concat(b.dataset.u); }); });
        area.querySelectorAll('[data-reativar]').forEach(b => { b.onclick = () => mexer(pega(b, 'reativar'), it => { it.linksDesativados = (it.linksDesativados || []).filter(u => u !== b.dataset.u); it.links = it.links.concat(b.dataset.u); }); });
        area.querySelectorAll('[data-sug]').forEach(b => { b.onclick = () => { const g = pega(b, 'sug'); mexer(g, it => { it.links = g.sugerida.slice(); }); }; });
        area.querySelectorAll('[data-tocar]').forEach(b => { b.onclick = () => tocarLadoALado(pega(b, 'tocar')); });
        const au = $('#cop-auto'); if (au) au.onclick = () => { prontos.filter(g => g.certeza && !g.naOrdem).forEach(g => { g.item.links = g.sugerida.slice(); E.mudou.add(g.caminho); }); pintar(); S.aviso('Ordem sugerida aplicada. Confira e clique em Salvar.', 'ok'); };
        const sv = $('#cop-salvar'); if (sv) sv.onclick = salvar;
        const te = $('#cop-testar'); if (te) te.onclick = () => testar(te, prontos);
    }

    async function salvar() {
        const gs = E.grupos.filter(g => E.mudou.has(g.caminho) && g.item);
        if (!gs.length) return;
        const mudancas = gs.map(g => ({ caminho: g.caminho, conteudo: S.C.serializar(g.item) }));
        try {
            await S.gravar(mudancas, `Cópias: ordem de ${gs.length} título(s)`);
            gs.forEach(g => { g.original = foto(g.item); });
            E.mudou.clear();
        } catch (e) { /* o aviso já apareceu */ }
    }

    async function testar(botao, prontos) {
        const vis = (E.filtro === 'olhar' ? prontos.filter(g => !g.certeza) : prontos).slice(0, E.mostrar);
        const urls = [...new Set(vis.flatMap(g => g.item.links || []))].filter(u => !E.teste.has(u) && !/^magnet:/i.test(u));
        if (!urls.length) return S.aviso('As cópias dessa tela já foram testadas.', 'ok');
        botao.disabled = true;
        let k = 0, feitos = 0;
        const um = async () => {
            while (k < urls.length) {
                const u = urls[k++];
                try {
                    const r = await (await fetch('/api/linkedit/testar?' + new URLSearchParams({ url: u, modo: 'rapido' }))).json();
                    E.teste.set(u, { ok: ['vivo', 'lento', 'pede-ua'].includes(r.status), ms: r.ms || 0, motivo: r.motivo });
                } catch (e) { E.teste.set(u, { ok: false, motivo: e.message }); }
                botao.textContent = `Testando ${++feitos}/${urls.length}…`;
            }
        };
        await Promise.all(Array.from({ length: 8 }, um));
        pintar();
        S.aviso(`${urls.length} cópias testadas. As mortas foram para o fim da sugestão.`, 'ok');
    }

    // ------------------------------------------------------------ tocar lado a lado (todas no mesmo ponto)
    function carregarHls() {
        if (window.Hls) return Promise.resolve(true);
        return new Promise(ok => { const s = document.createElement('script'); s.src = LIBS.hls; s.onload = () => ok(true); s.onerror = () => ok(false); document.head.appendChild(s); });
    }
    function tocarLadoALado(g) {
        const links = (g.item.links || []).filter(u => !/^magnet:/i.test(u)).slice(0, 4);
        const fundo = document.createElement('div');
        fundo.className = 'fundo-modal cop-modal';
        fundo.innerHTML = `<div class="cop-caixa" role="dialog" aria-modal="true" aria-label="Cópias lado a lado">
            <div class="linha-acoes" style="margin-top:0"><b>${esc(g.item.nome)}</b><span class="dica">todas começam no mesmo ponto · o som é de uma por vez</span><div class="espaco"></div>
              <label class="dica">Ponto <select class="campo mini" id="cop-ponto"><option value="0.1">10%</option><option value="0.25" selected>25%</option><option value="0.5">metade</option></select></label>
              <button class="btn" data-fechar>Fechar</button></div>
            <div class="cop-videos">${links.map((u, i) => `<div class="cop-v"><video muted playsinline data-i="${i}"></video><div class="cop-v-info"><b>${i === 0 ? '★ Principal' : 'Reserva ' + (i + 1)}</b> · ${esc(host(u))}<span data-res="${i}"></span><button class="btn mini" data-som="${i}">🔈</button></div><div class="cop-v-msg" data-msg="${i}">abrindo…</div></div>`).join('')}</div>
          </div>`;
        document.body.appendChild(fundo);
        const hls = [];
        const fechar = () => { hls.forEach(h => { try { h.destroy(); } catch (e) { /* */ } }); fundo.querySelectorAll('video').forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); }); fundo.remove(); document.removeEventListener('keydown', tecla); };
        const tecla = (e) => { if (e.key === 'Escape') fechar(); };
        document.addEventListener('keydown', tecla);
        fundo.addEventListener('click', e => { if (e.target === fundo || e.target.closest('[data-fechar]')) fechar(); });
        const via = (u) => (S.local() ? '/api/linkedit/tunel?' + new URLSearchParams({ u }) : u);
        const pular = () => { const f = +fundo.querySelector('#cop-ponto').value; fundo.querySelectorAll('video').forEach(v => { if (isFinite(v.duration) && v.duration > 0) v.currentTime = v.duration * f; }); };
        fundo.querySelector('#cop-ponto').onchange = pular;
        fundo.querySelectorAll('[data-som]').forEach(b => { b.onclick = () => { const i = b.dataset.som; fundo.querySelectorAll('video').forEach(v => { v.muted = v.dataset.i !== i || !v.muted ? true : v.muted; }); const v = fundo.querySelector(`video[data-i="${i}"]`); v.muted = false; }; });
        links.forEach(async (u, i) => {
            const v = fundo.querySelector(`video[data-i="${i}"]`), msg = fundo.querySelector(`[data-msg="${i}"]`);
            v.onloadedmetadata = () => { const f = +fundo.querySelector('#cop-ponto').value; if (isFinite(v.duration) && v.duration > 0) v.currentTime = v.duration * f; };
            v.onplaying = () => { msg.hidden = true; const r = fundo.querySelector(`[data-res="${i}"]`); if (r) r.textContent = v.videoWidth ? ` · ${v.videoWidth}×${v.videoHeight}` + (isFinite(v.duration) ? ` · ${Math.round(v.duration / 60)} min` : '') : ''; };
            v.onerror = () => { msg.textContent = 'não tocou no navegador (formato ou link)'; };
            if (/m3u8/i.test(u)) {
                if (!(await carregarHls()) || !window.Hls || !window.Hls.isSupported()) { v.src = via(u); }
                else { const h = new window.Hls({ startLevel: 0, capLevelToPlayerSize: true }); hls.push(h); h.loadSource(new URL(via(u), location.href).href); h.attachMedia(v); }
            } else v.src = via(u);
            v.play().catch(() => {});
        });
    }

    function desenhar(alvo, ferramentas) {
        S = ferramentas; area = alvo;
        if (!E.criterios) E.criterios = ler('criterios', S.C.CRITERIOS_COPIAS.slice()).filter(c => ROT_CRIT[c]);
        S.C.CRITERIOS_COPIAS.forEach(c => { if (!E.criterios.includes(c)) E.criterios.push(c); });
        if (E.col !== S.col.id || !E.grupos.length) { E.col = S.col.id; E.mudou.clear(); E.mostrar = 40; carregar(); }
        else pintar();
    }

    window.CZCopias = { desenhar, _estado: E };
})();
