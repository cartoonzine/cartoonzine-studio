// Link Edit (listas de canais): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = createRequire(import.meta.url)('../core/linkedit-core.js');

const M3U = `#EXTM3U url-tvg="https://epg.x/guia.xml.gz"
#EXTINF:-1 tvg-id="Globo.br" tvg-logo="https://l/globo.png" group-title="Brasil | Abertos",GLOBO SP FHD [BR]
http://s1/globo.m3u8
#EXTINF:-1 tvg-id="Globo.br" group-title="BR - ABERTOS",Globo SP HD (backup)
http://s2/globo.m3u8
#EXTINF:-1 group-title="KIDS",Cartoon Network [BR]
#EXTVLCOPT:http-user-agent=VLC/3.0
http://s3/cn.ts
#EXTINF:-1 group-title="Infantis",Cartoon Network BR
http://s4/cn/index.m3u8|User-Agent=Mozilla%2F5.0&Referer=https%3A%2F%2Fsite.x
#EXTINF:-1 tvg-country="MX" group-title="Infantil",Cartoon Network
http://s5/cnmx.m3u8
#EXTINF:-1 group-title="XXX",Canal +18
http://s6/a.m3u8
`;

test('M3U: lê tvg-*, grupo, User-Agent (EXTVLCOPT e |), EPG; limpa nomes e descobre país/idioma/tipo', () => {
    const r = L.lerLista(M3U, 'lista1');
    assert.equal(r.formato, 'm3u'); assert.equal(r.epg, 'https://epg.x/guia.xml.gz'); assert.equal(r.canais.length, 6);
    const [g1, g2, cn1, cn2, cnmx, adulto] = r.canais;
    assert.equal(g1.nome, 'Globo SP'); assert.equal(g1.qualidade, 'FHD'); assert.equal(g1.pais, 'BR'); assert.equal(g1.idioma, 'pt-BR'); assert.equal(g1.tipo, 'Abertos');
    assert.equal(g2.nome, 'Globo SP'); assert.equal(g1.chave, g2.chave, 'mesmo tvg-id = mesmo canal');
    assert.equal(cn1.headers['User-Agent'], 'VLC/3.0'); assert.equal(cn1.formato, 'mpegts'); assert.equal(cn1.tipo, 'Infantil'); assert.equal(cn1.pais, 'BR');
    assert.equal(cn2.url, 'http://s4/cn/index.m3u8'); assert.equal(cn2.headers['User-Agent'], 'Mozilla/5.0'); assert.equal(cn2.headers.Referer, 'https://site.x');
    assert.equal(cn1.chave, cn2.chave, 'Cartoon Network [BR] = Cartoon Network BR'); assert.notEqual(cn1.chave, cnmx.chave, 'o do México é outro canal');
    assert.equal(cnmx.idioma, 'es-MX'); assert.equal(adulto.tipo, 'Adulto'); assert.equal(g1.origem, 'lista1');
});

test('JSON e texto solto: formatos comuns, grupos como chaves, "Nome, link" e links no meio do texto', () => {
    const j = L.lerLista(JSON.stringify({ channels: [{ name: 'TV Um', url: 'https://a/1.m3u8', logo: 'x.png', group: 'Notícias', mirrors: ['https://b/1.m3u8'] }, { title: 'sem link' }] }));
    assert.equal(j.formato, 'json'); assert.equal(j.canais.length, 1); assert.deepEqual(j.canais[0].reservas, ['https://b/1.m3u8']); assert.equal(j.canais[0].tipo, 'Notícias');
    const g = L.lerLista(JSON.stringify({ Esportes: [{ nome: 'ESPN', link: 'https://e/1.m3u8' }], Kids: [{ nome: 'Gloob', link: 'https://k/1.m3u8' }] }));
    assert.deepEqual(g.canais.map(c => c.grupo), ['Esportes', 'Kids']);
    const t = L.lerLista('Olha essa lista:\n1. Rede Vida, https://rv/live.m3u8\nTV Cultura | http://cult/x.ts\nlink repetido https://rv/live.m3u8 e magnet:?xt=urn:btih:abc');
    assert.equal(t.formato, 'texto');
    assert.deepEqual(t.canais.map(c => c.nome).slice(0, 2), ['Rede Vida', 'TV Cultura']);
    assert.equal(t.canais.length, 3, 'o link repetido entra uma vez só');
    assert.equal(t.canais[2].formato, 'torrent');
    assert.equal(t.canais[0].tipo, 'Religioso');
});

test('Cópias: principal pela nota (vivo, rápido, qualidade); fixo manual vence; desativado sai', () => {
    const r = L.lerLista(M3U).canais;
    r[0].teste = { status: 'morto' }; r[1].teste = { status: 'vivo', ms: 900 };
    let gr = L.agrupar(r);
    const globo = gr.find(g => g.principal.nome === 'Globo SP');
    assert.equal(globo.principal.url, 'http://s2/globo.m3u8', 'o vivo ganha do FHD morto'); assert.equal(globo.reservas.length, 1);
    r[0].fixo = true;
    gr = L.agrupar(r);
    assert.equal(gr.find(g => g.principal.nome === 'Globo SP').principal.url, 'http://s1/globo.m3u8', 'escolha manual vale');
    r[3].desativado = true;
    gr = L.agrupar(r);
    assert.equal(gr.find(g => g.principal.nome.startsWith('Cartoon') && g.principal.pais === 'BR').reservas.length, 0);
    const novo = L.canalComReservas(L.agrupar(L.lerLista(M3U).canais).find(g => g.principal.nome === 'Globo SP'));
    assert.equal(novo.reservas.length, 1);
});

test('Filtros e contagem; exportar M3U/JSON/TXT e ler de volta sem perder nada', () => {
    const cs = L.lerLista(M3U).canais;
    cs[1].teste = { status: 'vivo' };
    const cont = L.contar(cs);
    assert.equal(cont.tipos.get('Infantil'), 3); assert.equal(cont.chaves.get(cs[0].chave), 2);
    assert.equal(L.filtrar(cs, { tipos: new Set(['Infantil']), paises: new Set(['BR']) }).length, 2);
    assert.equal(L.filtrar(cs, { busca: 'cartoon mx' }).length, 0);
    assert.equal(L.filtrar(cs, { busca: 'cartoon network' }).length, 3);
    assert.equal(L.filtrar(cs, { soVivos: true }).length, 1);
    assert.equal(L.filtrar(cs, { duplicados: true }, cont.chaves).length, 4);
    const saida = [Object.assign({}, cs[2], { reservas: ['http://s4/cn/index.m3u8'] })];
    const m3u = L.gerarM3U(saida, { epg: 'https://epg.x/g.xml' });
    const volta = L.lerLista(m3u).canais[0];
    assert.equal(volta.nome, 'Cartoon Network'); assert.equal(volta.headers['User-Agent'], 'VLC/3.0'); assert.equal(volta.grupo, 'Infantil'); assert.equal(volta.pais, 'BR');
    assert.equal(L.lerLista(L.gerarM3U(saida, { reservasComoLinhas: true })).canais.length, 2);
    const json = JSON.parse(L.gerarJSON(saida));
    assert.deepEqual(json[0].mirrors, ['http://s4/cn/index.m3u8']); assert.equal(json[0].language, 'pt-BR');
    assert.equal(L.lerLista(L.gerarJSON(saida)).canais[0].reservas[0], 'http://s4/cn/index.m3u8');
    assert.equal(L.gerarTXT(saida), 'Cartoon Network, http://s3/cn.ts\n');
    // nome com aspas e quebra não quebra o M3U
    assert.equal(L.lerLista(L.gerarM3U([Object.assign({}, cs[0], { nome: 'A "B"\nC' })])).canais.length, 1);
});

test('Nomes: tudo maiúsculo vira normal, siglas ficam; tags e qualidade saem', () => {
    assert.equal(L.limparNome('CARTOON NETWORK HD'), 'Cartoon Network');
    assert.equal(L.limparNome('SBT FHD [BR] (backup)'), 'SBT');
    assert.equal(L.limparNome('HBO 2 ★ 1080p'), 'HBO 2');
    assert.equal(L.limparNome('Discovery Kids'), 'Discovery Kids');
    assert.equal(L.formatoDe('http://x/live/u/p/123'), 'mpegts');
    assert.equal(L.formatoDe('https://x/a.mpd?t=1'), 'dash');
    assert.equal(L.formatoDe('rtmp://x/live'), 'protocolo');
});

test('Link de canal .m3u8: stream HLS não vira lista; nome sai do link', () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\nhi/index.m3u8\n';
    const pedacos = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:120\n#EXTINF:6.0,\nseg120.ts\n#EXTINF:6.0,\nseg121.ts\n';
    assert.ok(L.ehStreamHLS(master)); assert.ok(L.ehStreamHLS(pedacos));
    assert.ok(!L.ehStreamHLS(M3U), 'lista de canais continua lista');
    assert.ok(L.ehLinkDeCanal('http://x/live/u/p/123')); assert.ok(L.ehLinkDeCanal('https://x/f.mp4'));
    assert.ok(!L.ehLinkDeCanal('https://x/a.m3u8'), '.m3u8 se confirma pelo conteúdo'); assert.ok(!L.ehLinkDeCanal('https://x/lista.m3u'));
    assert.equal(L.nomeDoLink('https://cdn.x.com/live/tv-cultura/index.m3u8'), 'TV Cultura');
    assert.equal(L.nomeDoLink('http://1.2.3.4:8080/discovery_kids/mono.m3u8'), 'Discovery Kids');
    const c = L.canalDoLink('http://1.2.3.4:8080/discovery_kids/mono.m3u8');
    assert.equal(c.formato, 'hls'); assert.equal(c.tipo, 'Infantil'); assert.ok(c.chave && c.id);
});

test('Vídeos de listas de streaming: formatos, VOD Xtream, Drive/Dropbox e Filmes/Séries', () => {
    for (const u of ['http://x/a.mkv', 'http://x/a.avi', 'http://x/a.wmv', 'http://x/a.mpg', 'http://x/a.mov?t=1', 'http://srv:8080/movie/u/p/123.mkv', 'http://srv:8080/series/u/p/456']) assert.equal(L.formatoDe(u), 'arquivo', u);
    assert.equal(L.formatoDe('http://srv:8080/live/u/p/7'), 'mpegts', 'canal ao vivo continua TS');
    const d = L.canalDoLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123/view?usp=sharing', 'Filme');
    assert.equal(d.url, 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOpQrStUvWxYz123&export=download&confirm=t');
    assert.equal(d.formato, 'arquivo'); assert.ok(d.urlOriginal.includes('/view'));
    assert.equal(L.linkDireto('https://www.dropbox.com/s/abc/filme.mp4?dl=0'), 'https://www.dropbox.com/s/abc/filme.mp4?raw=1');
    assert.equal(L.linkDireto('https://www.dropbox.com/scl/fi/abc/filme.mp4?rlkey=x'), 'https://www.dropbox.com/scl/fi/abc/filme.mp4?rlkey=x&raw=1');
    assert.equal(L.lerLista('#EXTM3U\n#EXTINF:-1,Dark S01E02\nhttps://srv.exemplo.com/series/u/p/9.mkv\n').canais[0].tipo, 'Séries');
    assert.equal(L.lerLista('#EXTM3U\n#EXTINF:-1,O Auto da Compadecida (2000)\nhttps://srv.exemplo.com/movie/u/p/8.mp4\n').canais[0].tipo, 'Filmes');
});

test('Idioma na mão: código com região muda o país junto (TVzine põe no país certo) e sai no M3U', () => {
    const c = L.lerLista('#EXTM3U\n#EXTINF:-1 group-title="Kids",Tooncast\nhttp://x/t.m3u8\n').canais[0];
    assert.equal(c.idioma, ''); assert.equal(c.pais, '');
    L.definirIdioma(c, 'pt-BR');
    assert.equal(c.idioma, 'pt-BR'); assert.equal(c.pais, 'BR'); assert.ok(c.chave.endsWith('|BR'));
    const m3u = L.gerarM3U([c]);
    assert.match(m3u, /tvg-country="BR"/); assert.match(m3u, /tvg-language="pt-BR"/);
    L.definirIdioma(c, 'es-MX', false);
    assert.equal(c.pais, 'BR', 'sem "país junto" o país fica');
    assert.ok(L.IDIOMAS.length > 20 && L.IDIOMAS.every(i => i.cod && i.nome));
});

test('Categoria padrão: sugestão pelo grupo/tipo, escolhida vira o group-title exportado', () => {
    const cs = L.lerLista('#EXTM3U\n#EXTINF:-1 group-title="KIDS",Gloob\nhttp://a/1.m3u8\n#EXTINF:-1 group-title="Canais Evangélicos",Rede Gospel\nhttp://a/2.m3u8\n#EXTINF:-1,Sem Grupo\nhttp://a/3.m3u8\n').canais;
    assert.deepEqual(cs.map(L.categoriaSugerida), ['Infantil', 'Religioso', '']);
    L.definirCategoria(cs[0], 'Desenhos 24H');
    assert.match(L.gerarM3U([cs[0]]), /group-title="Desenhos 24H"/);
    assert.equal(JSON.parse(L.gerarJSON([cs[0]]))[0].group, 'Desenhos 24H');
    assert.equal(L.filtrar(cs, { semCategoria: true }).length, 2);
    L.definirCategoria(cs[0], '');
    assert.match(L.gerarM3U([cs[0]]), /group-title="Infantil"/, 'sem escolha: o tipo descoberto');
    assert.ok(L.CATEGORIAS.includes('Filmes e Séries') && !L.CATEGORIAS.includes('Desenhos 24H'));
});

test('Importador: cada item vai para a coleção certa do Studio, no formato dele; repetidos juntam; falta país = erro', () => {
    const C = createRequire(import.meta.url)('../core/studio-core.js');
    const config = JSON.parse(require('node:fs').readFileSync(new URL('../studio.config.json', import.meta.url), 'utf8'));
    const cs = L.lerLista(`#EXTM3U url-tvg="https://guia.exemplo.com/br.xml.gz"
#EXTINF:-1 tvg-id="Globo.br" tvg-logo="https://l/g.png" group-title="Abertos",Globo SP
https://srv.exemplo.com/globo.m3u8
#EXTINF:-1 group-title="Desenhos 24h",Pica-Pau 24h
https://srv.exemplo.com/pp.m3u8
#EXTINF:-1 group-title="Radios",Rádio Teste BR
https://srv.exemplo.com/radio.mp3
#EXTINF:-1 group-title="Filmes",Filme Solto (2001)
https://srv.exemplo.com/movie/u/p/1.mp4
#EXTINF:-1 group-title="Notícias",Sem País News
https://srv.exemplo.com/news.m3u8
#EXTINF:-1 tvg-id="Globo.br" group-title="Abertos",Globo SP backup
https://srv.exemplo.com/globo2.m3u8
`).canais;
    cs[0].epgGuia = 'https://guia.exemplo.com/br.xml.gz'; cs[0].headers = { 'User-Agent': 'VLC/3' };
    L.definirIdioma(cs[1], 'pt-BR'); L.definirIdioma(cs[2], 'pt-BR');
    const plano = L.planejarImportacao(cs, C, { config, caminhos: new Set(['conteudo/canais/br/globo-sp.json']) });
    assert.deepEqual(plano.map(r => r.col ? r.col.id : '—'), ['canais', 'desenhos-24h', 'radios', '—', 'canais', 'canais']);
    assert.deepEqual(plano.map(r => r.acao), ['juntar', 'novo', 'novo', 'fora', 'erro', 'mesmo']);
    const g = plano[0].item;
    assert.equal(g.categoria, 'TV Aberta', '"Abertos" vira o nome oficial'); assert.equal(g.pais, 'BR'); assert.equal(g.idioma, 'Português');
    assert.equal(g.tvgId, 'Globo.br'); assert.equal(g.epg, 'https://guia.exemplo.com/br.xml.gz'); assert.equal(g.userAgent, 'VLC/3');
    assert.equal(plano[0].caminho, 'conteudo/canais/br/globo-sp.json');
    assert.equal(plano[1].item.idioma, 'Português'); assert.equal(plano[1].caminho, 'conteudo/desenhos-24h/pica-pau-24h.json');
    assert.ok(plano[4].erros.some(e => /País/.test(e)));
    const comPais = L.planejarImportacao([cs[4]], C, { config, paisPadrao: 'BR' });
    assert.equal(comPais[0].acao, 'novo');
    const final = L.itemFinal(plano[0], C, { nome: 'Globo SP', links: ['https://antigo.exemplo.com/globo.m3u8'], pais: 'BR', categoria: 'TV Aberta', descricao: 'minha' });
    assert.deepEqual(final.links, ['https://antigo.exemplo.com/globo.m3u8', 'https://srv.exemplo.com/globo.m3u8', 'https://srv.exemplo.com/globo2.m3u8'], 'o que já existia fica 1º; o resto vira reserva');
    assert.equal(final.descricao, 'minha');
});
