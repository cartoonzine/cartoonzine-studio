# Exemplos de arquivos

Um arquivo `.json` por conteúdo, dentro de `conteudo/<coleção>/`. Estes aqui são só modelos
(a pasta `exemplos/` não é publicada). Copie, troque os dados e salve na coleção certa:

| Modelo | Vai em |
|---|---|
| `serie.json` | `conteudo/cartoons/`, `conteudo/animes/`, `conteudo/series/` |
| `filme.json` | `conteudo/filmes/`, `conteudo/cartoons/`, `conteudo/animes/` |
| `canal-24h.json` | `conteudo/desenhos-24h/` |
| `canal.json` | `conteudo/canais/<país>/` (ex.: `conteudo/canais/br/`) |
| `radio.json` | `conteudo/radios/` |
| `jogo.json` | `conteudo/jogos/<console>/` (ex.: `conteudo/jogos/megadrive/`) |

Campos com `_` no começo são internos:
- `"_rascunho": true` — fica guardado mas não vai para o app
- `"_travado": true` — a sincronização automática nunca mexe nesse item
- `"_origem"` — colocado pela sincronização automática (não precisa mexer)
