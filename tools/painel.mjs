#!/usr/bin/env node
/**
 * Abre o painel no seu PC, salvando direto na pasta conteudo/ (sem GitHub, sem token).
 *
 *   node tools/painel.mjs              -> http://localhost:4321
 *   node tools/painel.mjs --porta 8080
 *
 * Depois de adicionar o que quiser, é só fazer commit/push (ou usar o GitHub Desktop):
 * o GitHub Actions publica os DBs sozinho.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Core, RAIZ, lerConfig, lerColecao, lerArgs } from './lib.mjs';
import { build } from './build.mjs';

const TIPOS_MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.m3u': 'audio/x-mpegurl; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8'
};
const HOSTS_PROXY = /(^|\.)(archive\.org|wikipedia\.org)$/i;
const CAMINHO_OK = /^conteudo\/[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*\.json$/;

export function criarServidor({ raiz = RAIZ } = {}) {
    const indice = () => {
        const config = lerConfig(raiz);
        const out = [];
        for (const c of config.colecoes) for (const e of lerColecao(c, raiz).entradas) out.push(Core.resumoItem(e.caminho, e.item));
        return out;
    };
    const json = (res, status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
    };
    const corpo = req => new Promise((ok, falha) => {
        let d = '';
        req.on('data', c => { d += c; if (d.length > 20e6) { falha(new Error('grande demais')); req.destroy(); } });
        req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch (e) { falha(e); } });
    });

    return http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        try {
            if (url.pathname === '/') { res.writeHead(302, { Location: '/painel/' }); return res.end(); }
            if (url.pathname === '/api/info') return json(res, 200, { modo: 'local', config: lerConfig(raiz), versao: Core.VERSAO });
            if (url.pathname === '/api/indice') return json(res, 200, indice());
            if (url.pathname === '/api/arquivo') {
                const c = url.searchParams.get('caminho') || '';
                if (!CAMINHO_OK.test(c) || c.includes('..')) return json(res, 400, { erro: 'caminho inválido' });
                const abs = path.join(raiz, c);
                if (!fs.existsSync(abs)) return json(res, 404, { erro: 'não existe' });
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
                return res.end(fs.readFileSync(abs));
            }
            if (url.pathname === '/api/salvar' && req.method === 'POST') {
                const { mudancas = [] } = await corpo(req);
                for (const m of mudancas) if (!CAMINHO_OK.test(m.caminho || '') || m.caminho.includes('..')) return json(res, 400, { erro: 'caminho inválido: ' + m.caminho });
                for (const m of mudancas) {
                    const abs = path.join(raiz, m.caminho);
                    if (m.conteudo == null) {
                        fs.rmSync(abs, { force: true });
                        // apaga pastas que ficaram vazias (ex.: conteudo/canais/xx/)
                        let d = path.dirname(abs);
                        while (d.startsWith(path.join(raiz, 'conteudo') + path.sep) && fs.existsSync(d) && !fs.readdirSync(d).length) { fs.rmdirSync(d); d = path.dirname(d); }
                    } else {
                        JSON.parse(m.conteudo); // nunca grava JSON quebrado
                        fs.mkdirSync(path.dirname(abs), { recursive: true });
                        fs.writeFileSync(abs, m.conteudo);
                    }
                }
                const r = build({ raiz, log: () => {} });
                return json(res, 200, { ok: true, publicados: r.index.colecoes.reduce((n, c) => n + c.publicados, 0), erros: r.totalErros });
            }
            if (url.pathname === '/api/proxy') {
                const alvo = new URL(url.searchParams.get('url') || '');
                if (alvo.protocol !== 'https:' || !HOSTS_PROXY.test(alvo.hostname)) return json(res, 403, { erro: 'host não permitido' });
                const r = await fetch(alvo, { headers: { 'User-Agent': 'cartoonzine-studio' } });
                res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' });
                return res.end(Buffer.from(await r.arrayBuffer()));
            }
            // Arquivos estáticos (painel, core, dist)
            const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            const abs = path.resolve(raiz, rel.endsWith('/') || rel === '' ? rel + 'index.html' : rel);
            if (!abs.startsWith(raiz + path.sep) || rel.split('/').some(p => p.startsWith('.'))) return json(res, 403, { erro: 'proibido' });
            if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
                if (fs.existsSync(path.join(abs, 'index.html'))) { res.writeHead(302, { Location: url.pathname + '/' }); return res.end(); }
                return json(res, 404, { erro: 'não encontrado' });
            }
            res.writeHead(200, { 'Content-Type': TIPOS_MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            fs.createReadStream(abs).pipe(res);
        } catch (e) {
            json(res, 500, { erro: e.message });
        }
    });
}

if (process.argv[1]?.endsWith('painel.mjs')) {
    const args = lerArgs(process.argv.slice(2));
    const porta = parseInt(args.porta || '4321', 10);
    criarServidor().listen(porta, '127.0.0.1', () => {
        console.log(`🎛  Cartoonzine Studio aberto em http://localhost:${porta}`);
        console.log('   Tudo que você salvar vai para conteudo/ e o dist/ é gerado na hora.');
        console.log('   Para publicar: commit + push. Ctrl+C fecha o painel.');
    });
}
