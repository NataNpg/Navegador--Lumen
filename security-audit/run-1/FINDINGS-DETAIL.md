# Detalhe dos achados — Lumen (run-1)

Severidade calibrada pelas âncoras do `SKILL.md`; `confirmed` recebe severidade, `needs_validation` não.

---

## 1. `lumen/main-downloads-filename-path-traversal` — **high**

**Título:** Nome do arquivo do download (`Content-Disposition`) aceita path traversal e grava fora da pasta Downloads.

**Trace**
1. `src/main/main.js:97` (entrypoint) — `item.savePath = uniquePath(app.getPath('downloads'), item.getFilename())`; `getFilename()` é o nome fornecido pelo servidor.
2. `src/main/main.js:85` (propagation) — `let candidate = path.join(dir, filename)`; `path.join` normaliza `..`.
3. `src/main/main.js:97` (sink) — `savePath` explícito; o Electron grava no caminho atribuído.

**Evidência**
- `src/main/main.js:82` — `uniquePath()` é a única sanitização do nome.
- `src/main/main.js:84` — `path.basename` é usado apenas para o rótulo de exibição, não para o caminho gravado.
- `src/main/main.js:97` — nenhuma checagem de prefixo do diretório de downloads.
- `src/renderer/shell.js:1106` — "Salvar imagem" chama `tab.el.downloadURL(params.srcURL)`, permitindo ao guest disparar o download.

**Condições:** interação do usuário (baixar/salvar um arquivo de origem do atacante); diretório de destino precisa existir (`Startup`, `%TEMP%` existem por padrão).

**Execução**
- Payload: `..\..\..\..\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\lumen-update.bat`
- Passos: servir o arquivo com `Content-Disposition` contendo o nome acima → vítima salva o arquivo no Lumen → observar `data/downloads.json`/`item.savePath` apontando para a pasta de Inicialização → reiniciar a sessão do Windows executa o `.bat`.
- Resultado observado: primitivo verificado localmente — `path.join('C:\Users\vitima\Downloads','..\..\evil.bat')` → `C:\evil.bat`; `uniquePath` só acrescenta sufixo quando o caminho já existe.

**Correção:** reduzir o nome a um segmento seguro (`path.basename` + remoção de caracteres inválidos) e revalidar que o caminho final está dentro de `path.resolve(downloads)` antes de atribuir `savePath`.

---

## 2. `lumen/permission-media-auto-granted-https` — **high**

**Título:** Câmera/microfone (`media`), `clipboard-read` e `window-management` concedidos automaticamente a qualquer origem HTTPS.

**Trace**
1. `src/main/main.js:566` (entrypoint) — `callback(allowed.has(permission) && (secure || permission === 'fullscreen'))`.
2. `src/main/main.js:565` (propagation) — `secure` é apenas `requestingUrl.startsWith('https://')`.
3. `src/main/main.js:566` (sink) — `callback(true)` concede sem prompt.

**Evidência:** `src/main/main.js:554` (allowlist com `media`, `clipboard-read`, `window-management`, `unknown`); `src/main/main.js:569` (check handler também libera `fullscreen`/`notifications`).

**Condições:** vítima visita uma página HTTPS do atacante; câmera/microfone presentes.

**Execução**
- Payload: `navigator.mediaDevices.getUserMedia({video:true,audio:true}).then(s=>{})`
- Passos: publicar em HTTPS → abrir no Lumen → observar o stream aberto sem diálogo.
- Resultado observado: derivado do código (`allowed.has('media') && true`); o `getUserMedia` não foi disparado nesta auditoria.

**Correção:** remover permissões que exigem consentimento da allowlist e negar por padrão nos dois handlers.

---

## 3. `lumen/guest-will-navigate-external-open-denylist` — **medium**

**Título:** `will-navigate` usa denylist e encaminha `file:` e protocolos arbitrários para `shell.openExternal`.

**Trace**
1. `src/main/main.js:185` (entrypoint) — `wc.on('will-navigate', (e, url) => ...)`.
2. `src/main/main.js:193` (propagation) — `!EXTERNAL.has(proto) && !/^(about|devtools):$/i.test(proto)`.
3. `src/main/main.js:194` (sink) — `shell.openExternal(url)`.

**Evidência:** `src/main/main.js:25` (`EXTERNAL = {http:, https:, mailto:}`); `:195` (`preventDefault` não desfaz o efeito colateral); `:180` (`setWindowOpenHandler` cobre popups, não esta navegação).

**Condições:** vítima abre página que redirecione para esquema não-web; efeito depende do handler do SO.

**Execução**
- Payloads: `location.href='file:///C:/Users/Public/notes.txt'`; `location.href='search-ms:query=confidential'`.
- Resultado observado: para `proto='file:'` a condição é verdadeira e `openExternal` recebe a URL completa.

**Correção:** allowlist `{http, https, mailto}`; negar todo o resto, especialmente `file:`.

---

## 4. `lumen/create-webtab-no-scheme-validation` — **medium**

**Título:** `createWebTab` aceita qualquer esquema a partir de fontes controladas por conteúdo web.

**Trace**
1. `src/renderer/shell.js:1633` (entrypoint) — `on('lumen:popup', ({url}) => createWebTab(url))`, URL do `setWindowOpenHandler` (`src/main/main.js:181`).
2. `src/renderer/shell.js:229` (propagation) — `webview.setAttribute('src', ...)` sem validação.
3. `src/renderer/shell.js:446` (sink) — `loadInTab()` aplica `loadURL(url)` na ativação.

**Outros pontos de entrada:** `shell.js:1099-1100` (menu de contexto, `params.linkURL`), `shell.js:1588` (arrastar arquivo → `file://`), `shell.js:1673` (restauração de sessão).

**Evidência:** `shell.js:122` (`resolveInput` é a única validação e só cobre entrada digitada); `main.js:306` (`attachGuest`/`will-navigate` só após `tab:ready`, logo a navegação inicial do guest não passa por `will-navigate`).

**Condições:** popup ou clique com botão direito; para restauração de sessão, `session.json` já conter uma URL de esquema perigoso.

**Execução**
- Payloads: `window.open('file:///C:/Users/Public/target.txt')`; `<a href="file:///...">` + menu de contexto.
- Resultado observado: os quatro caminhos alcançam `createWebTab` com a URL intacta.

**Correção:** validar esquema em `createWebTab` (allowlist `http(s)` + destinos internos `lumen://`) e usar `openUrl` nos call sites.

---

## 5. `lumen/notifications-permitted-on-insecure-origins` — **low**

**Título:** `notifications` concedida em origem `http`.

**Trace**
1. `src/main/main.js:569` (entrypoint) — `if (permission === 'fullscreen' || permission === 'notifications') return true;` (sem checar origem).
2. `src/main/main.js:565` (propagation) — a regra de HTTPS existe apenas no handler de requisição (565-566).
3. `src/main/main.js:566` (sink) — allowlist contém `notifications` (linha 554); esse caminho só é alcançado quando o check handler nega.

**Evidência:** `src/main/main.js:554` (notifications na allowlist), `src/main/main.js:569` (retorno true incondicional no check handler).

**Condições:** vítima visita página `http` que solicite notificações.

**Execução**
- Payload: `Notification.requestPermission()`
- Resultado observado: em http, o check handler devolve `true`, concedendo a permissão antes de qualquer requisição.

**Correção:** tratar `notifications` como as demais permissões (exigir HTTPS nos dois handlers).

---

## Itens `needs_validation` (resumo; detalhe em `NEEDS-VALIDATION.md`)

| Fingerprint | claimed_root_cause | Bloqueio |
| --- | --- | --- |
| `lumen/private-session-no-permission-policy` | handlers acoplados a `session.defaultSession`; `lumen-private` só recebe downloads (`main.js:546-551`) | Política default do Electron para sessão sem handlers |
| `lumen/downloads-show-arbitrary-path` | `downloads:show` confia no caminho do renderer (`main.js:294-297`) | Requer execução de código no renderer (sem XSS estabelecido) |
| `lumen/filter-list-update-no-integrity-or-limit` | `fetch` sem timeout/tamanho/integridade antes de gravar e aplicar listas (`adblock.js:321-342`) | Requer controle do host remoto ou quebra de TLS |
| `lumen/no-will-attach-webview-hardening` | ausência de `will-attach-webview` (`main.js:624-627`) | Requer execução de código no renderer |

## Itens `rejected`

| Fingerprint | reason |
| --- | --- |
| `lumen/settings-json-prototype-pollution` | Escrita necessária no perfil do usuário equivale ao próprio poder; sem ganho entre fronteiras |
| `lumen/engine-cache-deserialize` | Caminho derivado de arquivos do app, desserialização com fallback para parse; sem sink de execução |