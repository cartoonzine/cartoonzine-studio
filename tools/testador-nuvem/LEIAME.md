# ☁️ Testador na nuvem do Link Edit

Com ele o **Scan** e o **abrir lista** do Link Edit funcionam com o Studio **online** (sem `node tools/painel.mjs`).
Roda de graça no Cloudflare Workers (100 mil pedidos por dia no plano grátis).

## Instalar (uma vez, ~5 minutos, sem programar)
1. Entre em <https://dash.cloudflare.com> (crie a conta grátis se não tiver).
2. **Workers & Pages → Create → Create Worker** → dê o nome `cz-testador` → **Deploy**.
3. **Edit code** → apague tudo, cole o conteúdo de `worker.js` (esta pasta) → **Deploy**.
4. **Settings → Variables and Secrets → Add** → tipo **Secret**, nome `TOKEN`, valor: uma senha qualquer sua → **Deploy**.
5. Copie o endereço do worker (ex.: `https://cz-testador.SEU-USUARIO.workers.dev`).
6. No Studio online: **Link Edit → Scan → ☁️ Testador na nuvem** → cole o endereço e a senha → **Salvar**.

Pronto: o Scan, o ⚡ Testar e o "Abrir link" usam a nuvem quando você não está no painel do PC.

## Bom saber
- O Cloudflare fica fora do Brasil: canal que só abre no Brasil aparece como **bloqueado** (não morto) — igual ao robô.
- No painel do PC o teste continua sendo pelo seu computador (mais fiel para canais brasileiros).
- A senha (`TOKEN`) fica só no seu navegador; sem ela o worker não responde a ninguém.
