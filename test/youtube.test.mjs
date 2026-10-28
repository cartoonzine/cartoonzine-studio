// Testes do YouToon automático (tools/youtube.mjs) — sem internet: a API do YouTube é simulada.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerListaMarkdown, classificarCanal, idiomaDoYouTube, idiomaDoTitulo, itensDoCanal, generosDe, sincronizarYouTube } from '../tools/youtube.mjs';
import { RAIZ, lerConfig, acharColecao, lerColecao } from '../tools/lib.mjs';

const LISTA = `# Lista
### Anime
[**Official Yu-Gi-Oh!**](https://www.youtube.com/@yugioh) (Full episodes of various Yu-Gi-Oh! series)
[**Crunchyroll Collection**](https://www.youtube.com/@crunchyroll) (Clips, trailers, and openings/endings from popular anime)
[**Doraemon/【公式】ドラえもん**](https://www.youtube.com/@Doraemon_F_Channel)
### Cartoons
[**Oggy and the Cockroaches**](https://www.youtube.com/@oggy) (full episodes and live re-runs of seasons)
[**Kaeloo Officiel**](https://www.youtube.com/@KaelooOfficiel) (Full episodes and compilations, French only)
[**Adult Swim**](https://www.youtube.com/@adultswim) (Adult Swim is famous for surreal, dark humor, shock comedy)
[**Vivziepop/SpindleHorse**](https://www.youtube.com/@SpindleHorse) (Not suitable for kids, full episodes and related content)
[**Pokemon**](https://www.youtube.com/@OfficialPoke%CC%81monTV) (Multiple languages, full episodes)
[**Canal Legado**](https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa) (Full episodes)
### Kids Media
[**Totally Spies!**](https://www.youtube.com/@TotallySpiesChannel) (Full Seasons and episodes)
[**Oggy repetido**](https://www.youtube.com/@oggy/videos) (Full episodes)
### Sport
[**Futebol**](https://www.youtube.com/@futebol) (Full matches)
`;
const SECOES = ['Anime', 'Cartoons', 'Kids Media'];

test('lê só as seções pedidas e sem repetir canal', () => {
    const l = lerListaMarkdown(LISTA, SECOES);
    assert.deepEqual(l.map(c => c.nome), ['Official Yu-Gi-Oh!', 'Crunchyroll Collection', 'Doraemon/【公式】ドラえもん', 'Oggy and the Cockroaches', 'Kaeloo Officiel', 'Adult Swim', 'Vivziepop/SpindleHorse', 'Pokemon', 'Canal Legado', 'Totally Spies!']);
    assert.equal(l[0].secao, 'Anime');
    assert.equal(l[0].nota, 'Full episodes of various Yu-Gi-Oh! series');
});

test('filtro: só completos, sem adulto, sem idioma de fora, com excluir', () => {
    const f = { excluir: ['Adult Swim'], soCompletos: true };
    const r = Object.fromEntries(lerListaMarkdown(LISTA, SECOES).map(c => [c.nome, classificarCanal(c, f)]));
    assert.equal(r['Official Yu-Gi-Oh!'].entra, true);
    assert.equal(r['Crunchyroll Collection'].motivo, 'só clipes/trailers');
    assert.equal(r['Doraemon/【公式】ドラえもん'].motivo, 'idioma fora do YouToon');
    assert.equal(r['Kaeloo Officiel'].motivo, 'idioma fora do YouToon');
    assert.equal(r['Adult Swim'].entra, false);
    assert.equal(r['Vivziepop/SpindleHorse'].motivo, 'conteúdo adulto');
    assert.equal(r['Pokemon'].entra, true);
    // ajuste manual força um canal de clipes a entrar
    assert.equal(classificarCanal({ nome: 'Crunchyroll Collection', nota: 'Clips' }, { canais: { 'Crunchyroll Collection': { forcar: true } } }).entra, true);
});

test('idiomas: só PT-BR, ES, EN e PT-PT', () => {
    assert.equal(idiomaDoYouTube('pt-BR'), 'Português');
    assert.equal(idiomaDoYouTube('pt', 'PT'), 'Português (Portugal)');
    assert.equal(idiomaDoYouTube('es-419'), 'Espanhol');
    assert.equal(idiomaDoYouTube('en-US'), 'Inglês');
    assert.equal(idiomaDoYouTube('fr'), null);
    assert.equal(idiomaDoYouTube(''), undefined);
    assert.equal(idiomaDoTitulo('Pokémon Jornadas | Episódios em Português'), 'Português');
    assert.equal(idiomaDoTitulo('Pokémon en Español Latino'), 'Espanhol');
    assert.equal(idiomaDoTitulo('Pokémon (Português de Portugal)'), 'Português (Portugal)');
    assert.equal(idiomaDoTitulo('Pokémon auf Deutsch'), null);
    assert.equal(idiomaDoTitulo('Pokémon – Folgen Deutsch'), null);
    assert.equal(idiomaDoTitulo('Season 1'), undefined);
});

test('gêneros entendidos pelo Desenhos 24H', () => {
    assert.ok(generosDe({ nome: 'Official Yu-Gi-Oh!', nota: '', secao: 'Anime' }).includes('Anime'));
    assert.ok(generosDe({ nome: 'Oggy and the Cockroaches', nota: '', secao: 'Cartoons' }).includes('Comédia'));
    assert.deepEqual(generosDe({ nome: 'X', nota: '', secao: 'Kids Media' }), ['Infantil']);
    assert.deepEqual(generosDe({ nome: 'X', nota: '', secao: 'Cartoons' }, { generos: ['Clássicos'] }), ['Clássicos']);
});

test('itens de um canal: live, episódios e playlists por idioma', () => {
    const c = { nome: 'Pokemon', nota: 'multiple languages, full episodes', secao: 'Anime', url: 'https://www.youtube.com/@x' };
    const dados = { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', logo: 'https://yt/logo.jpg', idioma: 'en', pais: 'US' };
    const its = itensDoCanal(c, dados, {
        lives: [{ id: 'v1', titulo: 'Pokémon 24/7', thumb: 'https://yt/v1.jpg' }],
        playlists: [
            { id: 'PL1', titulo: 'Pokémon Journeys', videos: 40, thumb: '' },
            { id: 'PL2', titulo: 'Pokémon em Português', videos: 30, thumb: '' },
            { id: 'PL3', titulo: 'Official Trailers', videos: 50, thumb: '' },
            { id: 'PL4', titulo: 'Pokémon en Español', videos: 3, thumb: '' },
            { id: 'PL5', titulo: 'Pokémon Folgen auf Deutsch', videos: 99, thumb: '' }
        ]
    }, { maxPlaylists: 10, minVideosPlaylist: 5 });
    assert.deepEqual(its.map(i => [i.nome, i.links[0], i.idioma]), [
        ['Pokemon 24H', 'https://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb/live', 'Inglês'],
        ['Pokemon', 'https://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb', 'Inglês'],
        ['Pokemon · Pokémon Journeys', 'https://www.youtube.com/playlist?list=PL1', 'Inglês'],
        ['Pokemon · Pokémon em Português', 'https://www.youtube.com/playlist?list=PL2', 'Português']
    ]);
    assert.ok(its.every(i => i._canal === dados.id && i.generos.includes('Anime')));
    // canal francês: só as playlists com idioma do YouToon no título
    const fr = itensDoCanal(c, Object.assign({}, dados, { idioma: 'fr' }), { playlists: [{ id: 'PLa', titulo: 'Episódios dublados', videos: 9 }, { id: 'PLb', titulo: 'Saison 1', videos: 9 }] }, {});
    assert.deepEqual(fr.map(i => [i.nome, i.idioma]), [['Pokemon · Episódios dublados', 'Português']]);
});

// ---------------------------------------------------------------- ponta a ponta com a API simulada
function apiFalsa(estado) {
    const canais = {
        '@yugioh': { id: 'UCyyyyyyyyyyyyyyyyyyyyyy', title: 'Yu-Gi-Oh!', lang: 'en' },
        '@oggy': { id: 'UCoooooooooooooooooooooo', title: 'Oggy', lang: 'pt-BR' },
        '@OfficialPokémonTV': { id: 'UCpppppppppppppppppppppp', title: 'Pokémon', lang: '' },
        '@TotallySpiesChannel': { id: 'UCtttttttttttttttttttttt', title: 'Totally Spies', lang: 'es' }
    };
    const porId = Object.fromEntries(Object.values(canais).map(c => [c.id, c]));
    const resp = (status, corpo) => ({ ok: status === 200, status, json: async () => corpo });
    return async (url) => {
        estado.chamadas = (estado.chamadas || 0) + 1;
        const u = new URL(url);
        const p = Object.fromEntries(u.searchParams);
        const rota = u.pathname.split('/').pop();
        if (estado.cota && estado.chamadas > estado.cota) return resp(403, { error: { errors: [{ reason: 'quotaExceeded' }] } });
        if (rota === 'channels') {
            const c = p.forHandle ? canais[p.forHandle.normalize('NFC')] || canais[p.forHandle] : p.id ? porId[p.id] : null;
            if (!c) return resp(200, { items: [] });
            return resp(200, { items: [{ id: c.id, snippet: { title: c.title, defaultLanguage: c.lang, thumbnails: { high: { url: 'https://yt/' + c.id + '.jpg' } } }, contentDetails: { relatedPlaylists: { uploads: 'UU' + c.id.slice(2) } } }] });
        }
        if (rota === 'playlistItems') return resp(200, { items: [{ contentDetails: { videoId: 'live1' } }, { contentDetails: { videoId: 'vod1' } }] });
        if (rota === 'videos') {
            const aoVivo = estado.aoVivo !== false && p.id.includes('live1');
            return resp(200, { items: [{ id: 'live1', snippet: { title: 'AO VIVO 24/7', liveBroadcastContent: aoVivo ? 'live' : 'none', thumbnails: {} } }, { id: 'vod1', snippet: { title: 'ep', liveBroadcastContent: 'none' } }] });
        }
        if (rota === 'playlists') {
            const c = porId[p.channelId];
            return resp(200, { items: [{ id: 'PL' + c.id.slice(2, 8), snippet: { title: c.title + ' Season 1', thumbnails: {} }, contentDetails: { itemCount: 26 } }] });
        }
        return resp(404, {});
    };
}

function raizTemporaria() {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-yt-'));
    fs.copyFileSync(path.join(RAIZ, 'studio.config.json'), path.join(raiz, 'studio.config.json'));
    fs.mkdirSync(path.join(raiz, 'conteudo', 'youtoon', 'ingles'), { recursive: true });
    fs.mkdirSync(path.join(raiz, 'automatico'), { recursive: true });
    // item feito à mão com o mesmo nome de um automático: nunca pode ser sobrescrito
    fs.writeFileSync(path.join(raiz, 'conteudo', 'youtoon', 'ingles', 'oggy-manual.json'), JSON.stringify({ nome: 'Official Yu-Gi-Oh!', links: ['https://www.youtube.com/embed/abcdefghijk'], idioma: 'Inglês' }));
    return raiz;
}

test('sincroniza, tira a live que acabou e não apaga nada quando a API falha', async () => {
    const raiz = raizTemporaria();
    const colecao = acharColecao(lerConfig(raiz), 'youtoon');
    const f = { nome: 'teste', tipo: 'youtube-lista', secoes: SECOES, soCompletos: true, excluir: ['Adult Swim'], removerSumidos: true };
    const origem = 'auto:teste', log = () => {};
    const estado = {};
    const r1 = await sincronizarYouTube(f, colecao, { raiz, origem, log, chave: 'x', texto: LISTA, fetchImpl: apiFalsa(estado), baseApi: 'https://api.test/youtube/v3/' });
    const itens = () => lerColecao(colecao, raiz).entradas.map(e => [e.item.nome, e.item.idioma || '', (e.item.links || [])[0], e.item._origem || 'manual']).sort((a, b) => a[0].localeCompare(b[0]));
    const depois1 = itens();
    assert.ok(r1.canais >= 4, 'canais: ' + JSON.stringify(r1));
    // manual intacto (o automático de mesmo nome e idioma foi pulado)
    assert.deepEqual(depois1.find(i => i[0] === 'Official Yu-Gi-Oh!'), ['Official Yu-Gi-Oh!', 'Inglês', 'https://www.youtube.com/embed/abcdefghijk', 'manual']);
    // idioma do canal: Oggy pt-BR, Totally Spies espanhol, Pokémon sem idioma → inglês
    assert.ok(depois1.some(i => i[0] === 'Oggy and the Cockroaches 24H' && i[1] === 'Português' && /\/live$/.test(i[2])));
    assert.ok(depois1.some(i => i[0] === 'Totally Spies!' && i[1] === 'Espanhol'));
    assert.ok(depois1.some(i => i[0] === 'Pokemon · Pokémon Season 1' && i[1] === 'Inglês' && /playlist\?list=PL/.test(i[2])));
    assert.ok(!depois1.some(i => /Canal Legado/.test(i[0])), 'canal que a API não achou fica de fora');

    // a live acabou: o item "24H" sai, o resto fica
    estado.aoVivo = false; estado.chamadas = 0;
    await sincronizarYouTube(f, colecao, { raiz, origem, log, chave: 'x', texto: LISTA, fetchImpl: apiFalsa(estado), baseApi: 'https://api.test/youtube/v3/' });
    const depois2 = itens();
    assert.ok(!depois2.some(i => /24H$/.test(i[0]) && i[3] !== 'manual'), 'lives que acabaram foram tiradas');
    assert.equal(depois2.length, depois1.filter(i => !(/24H$/.test(i[0]) && i[3] !== 'manual')).length);

    // cota estourou no meio: nada é apagado
    const est3 = { cota: 3, aoVivo: false };
    await sincronizarYouTube(f, colecao, { raiz, origem, log, chave: 'x', texto: LISTA, fetchImpl: apiFalsa(est3), baseApi: 'https://api.test/youtube/v3/' });
    assert.deepEqual(itens(), depois2);

    // sem chave: pula sem mexer em nada
    const r4 = await sincronizarYouTube(f, colecao, { raiz, origem, log, chave: '', texto: LISTA });
    assert.equal(r4.pulada, true);
    assert.deepEqual(itens(), depois2);
    fs.rmSync(raiz, { recursive: true, force: true });
});

// ---------------------------------------------------------------- versões localizadas
import { escolherLocalizado, chavesDoDesenho, nomeLimpo } from '../tools/youtube.mjs';

test('localizado: acha o canal oficial certo e recusa fã, brinquedo, idioma errado e canal pequeno', () => {
    const orig = { nome: 'Peppa Pig', nota: 'Clips and full episodes' };
    const c = (o) => Object.assign({ id: 'UC' + Math.random().toString(36).slice(2).padEnd(22, 'x').slice(0, 22), titulo: '', customUrl: '', descricao: '', idioma: '', pais: '', inscritos: 0, videos: 500 }, o);
    const cand = [
        c({ titulo: 'Peppa Pig Toys Brasil', pais: 'BR', inscritos: 9e6 }),                              // brinquedos
        c({ titulo: 'Peppa Pig Fan Dublagens', pais: 'BR', inscritos: 2e6 }),                           // fã
        c({ titulo: 'Peppa Pig em Português Brasil - Canal Oficial', idioma: 'pt-BR', pais: 'BR', inscritos: 8e6 }),
        c({ titulo: 'Peppa Pig Português Portugal', idioma: 'pt-PT', pais: 'PT', inscritos: 4e5 }),
        c({ titulo: 'Peppa Pig en Español - Canal Oficial', idioma: 'es-419', pais: 'MX', inscritos: 6e6 }),
        c({ titulo: 'Peppa Pig Clube', pais: 'BR', inscritos: 3000 })                                  // pequeno
    ];
    assert.equal(escolherLocalizado(orig, cand, 'Português').titulo, 'Peppa Pig em Português Brasil - Canal Oficial');
    assert.equal(escolherLocalizado(orig, cand, 'Espanhol').titulo, 'Peppa Pig en Español - Canal Oficial');
    assert.equal(escolherLocalizado(orig, cand, 'Português (Portugal)').titulo, 'Peppa Pig Português Portugal');
    // outro desenho com o mesmo idioma não serve
    assert.equal(escolherLocalizado(orig, [c({ titulo: 'Masha e o Urso', idioma: 'pt', pais: 'BR', inscritos: 9e6 })], 'Português'), null);
    // nome traduzido: SpongeBob → Bob Esponja
    assert.ok(chavesDoDesenho('SpongeBob SquarePants Official').includes('bob esponja'));
    assert.equal(escolherLocalizado({ nome: 'SpongeBob SquarePants Official' }, [c({ titulo: 'Bob Esponja em Português', pais: 'BR', inscritos: 3e6 })], 'Português').titulo, 'Bob Esponja em Português');
    assert.equal(nomeLimpo('Peppa Pig em Português Brasil - Canal Oficial'), 'Peppa Pig em Português Brasil');
});

test('localizado ponta a ponta: descobre com limite de buscas, guarda no cache e sincroniza', async () => {
    const raiz = raizTemporaria();
    const colecao = acharColecao(lerConfig(raiz), 'youtoon');
    const LISTA2 = '### Cartoons\n[**Oggy and the Cockroaches**](https://www.youtube.com/@oggy) (full episodes)\n[**Zig & Sharko**](https://www.youtube.com/@ZigandSharko) (Full episodes)\n';
    const orig = { '@oggy': 'UCoggyoggyoggyoggyoggyo', '@ZigandSharko': 'UCzigzigzigzigzigzigzigz' };
    const loc = {
        'oggy and the cockroaches em português': [{ id: 'UCoggyptbrptbrptbrptbrpt', title: 'Oggy e as Baratas - Oficial', lang: 'pt-BR', pais: 'BR', subs: 2e6 }],
        'oggy and the cockroaches en español': [{ id: 'UCoggyesesesesesesesesex', title: 'Oggy y las Cucarachas', lang: 'es', pais: 'ES', subs: 1e6 }],
        'zig & sharko em português': [{ id: 'UCzigptbrptbrptbrptbrptb', title: 'Zig e Sharko Brasil', lang: '', pais: 'BR', subs: 9e5 }]
    };
    const todos = {};
    Object.entries(orig).forEach(([h, id]) => { todos[id] = { id, title: h.slice(1), lang: 'en', pais: 'FR', subs: 1e7 }; });
    Object.values(loc).flat().forEach(x => { todos[x.id] = x; });
    const estado = { buscas: 0 };
    const resp = (j) => ({ ok: true, status: 200, json: async () => j });
    const item = (c) => ({ id: c.id, snippet: { title: c.title, defaultLanguage: c.lang, country: c.pais, thumbnails: {} }, statistics: { subscriberCount: String(c.subs), videoCount: '300' }, contentDetails: { relatedPlaylists: { uploads: 'UU' + c.id.slice(2) } } });
    const fake = async (url) => {
        const u = new URL(url), p = Object.fromEntries(u.searchParams), rota = u.pathname.split('/').pop();
        if (rota === 'channels') {
            if (p.forHandle) { const id = orig[p.forHandle]; return resp({ items: id ? [item(todos[id])] : [] }); }
            return resp({ items: p.id.split(',').map(id => todos[id]).filter(Boolean).map(item) });
        }
        if (rota === 'search') { estado.buscas++; const ach = loc[p.q.toLowerCase()] || []; return resp({ items: ach.map(x => ({ id: { channelId: x.id } })) }); }
        if (rota === 'playlistItems') return resp({ items: [] });
        if (rota === 'playlists') return resp({ items: [] });
        return resp({ items: [] });
    };
    const f = { nome: 'loc', tipo: 'youtube-lista', secoes: ['Cartoons'], removerSumidos: true,
        localizar: { idiomas: ['Português', 'Espanhol', 'Português (Portugal)'], buscasPorDia: 4, minInscritos: 50000 } };
    const args = { raiz, origem: 'auto:loc', log: () => {}, chave: 'x', texto: LISTA2, fetchImpl: fake, baseApi: 'https://api.test/youtube/v3/' };
    const r1 = await sincronizarYouTube(f, colecao, args);
    assert.equal(estado.buscas, 4, 'respeita o limite de buscas do dia');
    const cache1 = JSON.parse(fs.readFileSync(path.join(raiz, 'automatico', 'youtoon-localizados.json'), 'utf8'));
    assert.equal(cache1.canais['Oggy and the Cockroaches']['Português'].id, 'UCoggyptbrptbrptbrptbrpt');
    assert.equal(cache1.canais['Oggy and the Cockroaches']['Espanhol'].id, 'UCoggyesesesesesesesesex');
    assert.equal(cache1.canais['Oggy and the Cockroaches']['Português (Portugal)'].nada, true);
    assert.equal(r1.localizados, 3);
    // dia seguinte: só busca o que faltou (Zig ES e PT-PT), não repete as já feitas
    estado.buscas = 0;
    const r2 = await sincronizarYouTube(f, colecao, args);
    assert.equal(estado.buscas, 2);
    assert.equal(r2.localizados, 3);
    const nomes = lerColecao(colecao, raiz).entradas.map(e => [e.item.nome, e.item.idioma]);
    assert.ok(nomes.some(([n, i]) => n === 'Oggy e as Baratas' && i === 'Português'));
    assert.ok(nomes.some(([n, i]) => n === 'Oggy y las Cucarachas' && i === 'Espanhol'));
    assert.ok(nomes.some(([n, i]) => n === 'Zig e Sharko Brasil' && i === 'Português'));
    // você marcou "ignorar" num localizado: ele some na próxima sincronização
    const cache2 = JSON.parse(fs.readFileSync(path.join(raiz, 'automatico', 'youtoon-localizados.json'), 'utf8'));
    cache2.canais['Zig & Sharko']['Português'].ignorar = true;
    fs.writeFileSync(path.join(raiz, 'automatico', 'youtoon-localizados.json'), JSON.stringify(cache2));
    await sincronizarYouTube(f, colecao, args);
    assert.ok(!lerColecao(colecao, raiz).entradas.some(e => e.item.nome === 'Zig e Sharko Brasil'));
    fs.rmSync(raiz, { recursive: true, force: true });
});
