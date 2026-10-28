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
