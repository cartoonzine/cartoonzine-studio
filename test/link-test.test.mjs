// 🔗 Link test do painel local: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarServidor } from '../tools/painel.mjs';

test('link test: só links http(s) públicos são checados', async () => {
    const srv = criarServidor();
    await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
    const base = 'http://127.0.0.1:' + srv.address().port + '/api/checar-link?url=';
    try {
        let r = await fetch(base + encodeURIComponent('ftp://exemplo.com/x'));
        assert.equal(r.status, 400);
        r = await fetch(base + encodeURIComponent('nada'));
        assert.equal(r.status, 400);
        for (const interno of ['http://localhost:8080/', 'http://127.0.0.1/', 'http://192.168.0.1/', 'http://10.0.0.5/', 'http://[::1]/']) {
            r = await fetch(base + encodeURIComponent(interno));
            assert.equal(r.status, 403, interno);
        }
    } finally { srv.close(); }
});
