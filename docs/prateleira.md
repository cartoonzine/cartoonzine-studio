# 🧩 Prateleira de jogos

Tela da Studio (`#prateleira`) para pôr **jogos livres** no repositório `cartoonzine/cartoonzine-jogos`, onde eles
são compilados do código-fonte para a web com o Emscripten. Tudo é **determinístico**: não há IA nem serviço externo.
O fluxo segue regras explícitas (`core/prateleira-core.js`), o manifesto do repositório de jogos e o resultado de
builds reais.

## Fluxo

1. **Analisar** (navegador, só leitura via API do GitHub)
   - O link vira repositório + branch. A tela pega o **commit exato** (`/commits/<branch>`), a árvore desse commit e
     **só** os arquivos de build: `CMakeLists.txt`, `Makefile*`, `configure.ac`, `meson.build`, da raiz até 2 pastas
     de profundidade. Também pega o guia (`EMSCRIPTEN.md` etc.), lido como **dado**.
   - O tipo de build é o arquivo mais raso; no mesmo nível vale CMake > Meson > Autotools > Make. Se ele estiver numa
     subpasta (por exemplo `trunk/`), o build é feito ali.
   - As dependências vêm da tabela `DEPENDENCIAS`, procurada **linha a linha** nos arquivos de build. Comentários não
     contam. Cada decisão gera uma **evidência**: arquivo, linha, trecho, regra e confiança. A confiança é `alta` quando
     vem do build e `media` quando vem do guia.
   - Do guia só entram opções `-s…` de uma lista branca, como `-sUSE_SDL_TTF=2`, `-sASYNCIFY` ou
     `-sSDL2_MIXER_FORMATS=[ogg]`. **Comandos do README ou do guia nunca são copiados para a receita.**
   - Dependência sem port no Emscripten:
     - se está no **manifesto confiável** do cartoonzine-jogos (`modelo/dependencias-externas.json`: repositório,
       commit fixo, opções de build, licença, cabeçalhos e bibliotecas esperados), ela entra em `ajustes.externas` e
       a receita a compila;
     - se não está no manifesto, a análise dá **revisão necessária**.
   - A previsão é **candidata** ou **revisão necessária**. É previsão, não resultado.
2. **Adicionar como rascunho**: um commit com a ficha em `jogos.json` e `receitas/<id>.sh`.
   - A ficha sempre leva `"rascunho": true`, além de `"commit"`, `"ajustes"` e `"licencaDadosConfirmada"`.
   - Exige a confirmação humana de que **gráficos, sons, fases e dados** são livres. Compilar não prova licença.
3. **Validar receita** (workflow no cartoonzine-jogos). Começa sozinho quando a receita ou a ficha muda, ou pelo botão
   **Validar** / **Validar de novo**. Detalhes no README do cartoonzine-jogos.
4. **Publicar**: o botão só aparece quando a validação **mais nova da receita atual** passou. Ele pede de novo a
   confirmação da licença dos dados e só então tira o `"rascunho"`. Quem publica é o workflow "Construir e publicar".

## Estados na fila

| Estado | Quando |
|---|---|
| 🔎 Revisão necessária | a análise achou motivo de revisão (`"revisao"` na ficha) e ainda não há validação aprovada |
| 📝 Candidata | rascunho sem validação, ou a receita mudou depois da última validação |
| ⚙️ Validando | jobs `compilar (<id>)` / `navegador (<id>)` em andamento |
| ❌ Validação falhou | qualquer etapa falhou; a fila mostra as anotações do diagnóstico e o link do log |
| ✅ Pronta (validada) | `compilar` **e** `navegador` passaram para o commit atual da receita; ainda é rascunho |
| ⏳ / ⚙️ / ❌ / ✅ No ar | jogos publicados (robô "Construir e publicar") |

Validação pendente ou falha **nunca** tira o rascunho.

## Ajustes (estruturados, revisáveis, lista branca)

```json
{ "subdir": "trunk", "alvo": "Bombermaaan", "dados": ["trunk/res/images@/data/images"], "submodulos": true,
  "externas": ["freealut"], "flagsCompilar": [], "flagsLinkar": ["-sASYNCIFY"],
  "cmakeOpcoes": ["-DGRAPHICS_LIBRARY_OPTION=SDL"], "configureOpcoes": [] }
```

- `validarAjustes` recusa qualquer valor fora da lista branca, como caracteres de shell, `..` ou caminho absoluto.
  Também recusa opções que escondem símbolo não resolvido (`-sERROR_ON_UNDEFINED_SYMBOLS=0`) e id externo fora do
  manifesto.
- Ajuste inválido gera uma receita que só faz `echo "REVISAO: …"; exit 1`.

## Receitas candidatas (templates em `TEMPLATES`)

- Todas começam com `baixar_commit <repo> <sha>`.
- Depois vêm as `dependencia_externa <id>` dos ajustes. Elas preenchem `$EXTERNAS_CFLAGS` (`-I…`), `$EXTERNAS_LIBS`
  (caminhos `.a`) e `"${EXTERNAS_CMAKE[@]}"` (variáveis como `ALUT_INCLUDE_DIR` e `ALUT_LIBRARY`), que a receita
  passa **explicitamente** para a configuração e o link.
- Por tipo de build:
  - **CMake**: ports em `CMAKE_C/CXX_FLAGS`; ports e opções de link em `CMAKE_EXE_LINKER_FLAGS`.
  - **Make**: `EMCC_CFLAGS`, que o emcc usa ao compilar e ao linkar.
  - **Autotools**: `CFLAGS`/`CXXFLAGS`/`LDFLAGS`/`LIBS` no `emconfigure`.
- Opções fixas de todo template: `-sALLOW_MEMORY_GROWTH=1`, `-sENVIRONMENT=web` e, se houver pastas de dados,
  `-sFORCE_FILESYSTEM=1`. `-sASYNCIFY` só entra com evidência no guia ou por ajuste.
- `publicar_jogo` copia o `.wasm` e o `.js` do alvo e empacota as pastas de dados em `dados.data` + `dados.js`. Se
  houver mais de um `.wasm` sem alvo definido, ele para com `REVISAO` em vez de escolher um.
- Nunca usa `|| true`, nunca junta `.o` à mão e nunca usa `-sERROR_ON_UNDEFINED_SYMBOLS=0`.

## Permissões do token

- **Contents: Read and write** no cartoonzine-jogos: para adicionar, editar, publicar e remover.
- **Actions: Read**: para ver o estado das validações e das publicações.
- **Actions: Read and write**: só para o botão "Validar de novo". Sem ela, salvar a receita já dispara a validação.
- As anotações do diagnóstico vêm da API de check-runs, que é pública para repositório público.

## Limitações

- A análise lê só arquivos de build (até 12, com até 2 pastas de profundidade) e o guia. Ela **não** varre o
  código-fonte, então um `#include` que nenhum arquivo de build cita só aparece no **diagnóstico do build real**,
  como o `gl4esinit.h` do AstroMenace. O diagnóstico então indica a externa do manifesto, se houver, ou pede revisão.
- O teste no navegador só prova que o jogo **inicia** (`main()` roda sem erro). Não prova que ele é jogável.
- O ASYNCIFY não é ligado sem evidência. Jogos com laço próprio podem travar no teste, e aí é preciso adicionar o
  ajuste.
- A validação considera a última mudança em `receitas/<id>.sh`. Se só os `ajustes` da ficha mudarem, o workflow roda
  de novo para aquele jogo, mas a Studio continua comparando com o commit da receita.
- As receitas antigas, feitas à mão, não seguem os templates.
