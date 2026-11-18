# Itens que precisam de validação — Lumen (run-1)

Nenhum item abaixo é um achado confirmado. Cada um tem uma hipótese de fronteira fundamentada no código-fonte, um bloqueio explícito e um plano seguro de validação.

---

## 1. `lumen/private-session-no-permission-policy`

**Hipótese:** a partição `lumen-private` (`src/main/main.js:547-551`) recebe apenas `wireDownloads`; os handlers de permissão e de checagem existem somente para `session.defaultSession` (`src/main/main.js:553-571`). Como a política é por sessão, abas privadas ficariam sem a política do app.

**Evidência no código-fonte**
- `src/main/main.js:546` — bloco da partição privada contém apenas `wireDownloads(priv)`.
- `src/renderer/shell.js:232` — `webview.setAttribute('partition', 'lumen-private')`.
- `src/main/main.js:553` e `:568` — handlers registrados apenas em `session.defaultSession`.

**Bloqueios**
1. O comportamento padrão do Electron 45 para uma sessão sem `setPermissionRequestHandler`/`setPermissionCheckHandler` não está documentado no repositório (as definições locais em `node_modules/electron/electron.d.ts` descrecem a assinatura, não o default).
2. A verificação decisiva exige executar o app com uma página de teste em aba privada.

**Plano de validação**
- Local: em sandbox de OS com rede loopback, servir uma página em `http://127.0.0.1` que chame `getUserMedia` e `geolocation.getCurrentPosition`; abrir em aba privada no Lumen instrumentado com CDP; verificar se o pedido é concedido sem prompt.
- Deployment: confirmar no changelog do Electron 45 a política default de sessões sem handlers; se for "conceder", equiparar a política da partição privada à da sessão padrão.

---

## 2. `lumen/downloads-show-arbitrary-path`

**Hipótese:** `downloads:show` (`src/main/main.js:294-297`) aceita qualquer `p.path` do renderer e chama `shell.showItemInFolder` bastando `fs.existsSync`.

**Evidência no código-fonte**
- `src/main/main.js:295` — `if (p.path && fs.existsSync(p.path)) shell.showItemInFolder(p.path);`.
- `src/main/preload-shell.js:23` — canal presente na allowlist exposta ao renderer.
- `src/renderer/shell.js:947` — o renderer envia o caminho do item de download (único uso legítimo).

**Bloqueios**
1. Não foi estabelecido caminho pelo qual conteúdo web alcance `window.lumen`: a casca roda com `contextIsolation`/`sandbox`, CSP `script-src 'self'` (`src/renderer/shell.html:7`), o guest não tem preload e `ipc-message` é vazio (`src/renderer/shell.js:376`).
2. Sem renderer comprometido, o efeito é apenas capacidade, não exploração.

**Plano de validação**
- Local: em cópia descartável do alvo dentro de sandbox, inserir no renderer um payload que invoque `downloads:show` com caminho fora de `Downloads` e observar a abertura do gerenciador de arquivos.
- Deployment: não aplicável (canal local ao processo).

---

## 3. `lumen/filter-list-update-no-integrity-or-limit`

**Hipótese:** `updateLists` (`src/main/adblock.js:321-342`) baixa seis listas sem timeout, sem limite de tamanho e sem verificação de integridade, grava em `assets/filters` e reconstrói o motor com filtros cosméticos ativos (`src/main/adblock.js:31`), o que tornaria o canal de listas um vetor de injeção de script e de reescrita de requisições.

**Evidência no código-fonte**
- `src/main/adblock.js:326` — `fetch(url)` sem `AbortSignal`.
- `src/main/adblock.js:328` — `await res.text()` (corpo inteiro em memória).
- `src/main/adblock.js:329` — `writeFileSync` sobre a lista usada no próximo `buildBlocker`.
- `src/main/adblock.js:44` — hosts de origem (`easylist.to`, `raw.githubusercontent.com`).

**Bloqueios**
1. O efeito depende de controle do host remoto, de comprometimento de CA ou de troca de conteúdo no caminho; nada no repositório indica comprometimento atual.
2. A execução de scriptlets é comportamento interno do `@ghostery/adblocker` (fora do alvo) e não foi executada.

**Plano de validação**
- Local: em sandbox sem rede externa, substituir a resposta de uma das URLs por uma lista de teste com regra `$redirect` e um scriptlet, executar `updateLists` e observar a aplicação em uma página fixture local.
- Deployment: não aplicável; o risco residual é de cadeia de suprimentos e deve ser tratado com pin de hash/assinatura, limite de tamanho e timeout.

---

## 4. `lumen/no-will-attach-webview-hardening`

**Hipótese:** com `webviewTag: true` (`src/main/main.js:496`) e nenhum `will-attach-webview` (`src/main/main.js:624-627` só chama `wireShortcuts`), um renderer comprometido poderia anexar guests com `nodeintegration`, `preload` próprio ou `disablewebsecurity`.

**Evidência no código-fonte**
- `src/main/main.js:496` — `webviewTag: true`.
- `src/renderer/shell.js:231` — o app cria o guest apenas com `allowpopups`/`partition`.
- `src/renderer/shell.js:376` — guest sem `ipc-message` e sem preload.

**Bloqueios**
1. O pré-requisito (execução de código no renderer) não foi estabelecido: CSP `script-src 'self'`, `escapeHtml` aplicado e guest sem IPC.
2. A demonstração exige executar o app com renderer modificado em sandbox.

**Plano de validação**
- Local: em cópia descartável do alvo, criar no renderer um `<webview nodeintegration>` apontando para um script local e verificar, em sandbox, se o guest obtém `require` — isso demonstra o controle ausente, não exploração por conteúdo web.
- Deployment: não aplicável.