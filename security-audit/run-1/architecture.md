# Arquitetura e fronteiras de confiança — Lumen

## Visão geral

Lumen é um navegador de desktop construído em Electron 45 (Chromium 156) com:

- **Processo principal** (`src/main/main.js`): cria a `BrowserWindow`, registra os handlers IPC (`actions`), aplica a política de permissões por sessão, wires de download, atalhos globais e integração com o bloqueador.
- **Preload da casca** (`src/main/preload-shell.js`): `contextBridge` com allowlist de canais (`CHANNELS`, 22 itens) e de eventos (`EVENTS`), expondo `window.lumen` ao renderer da interface.
- **Renderer da casca** (`src/renderer/shell.js`, `shell.html`, `styles.css`): UI em HTML/CSS/JS puro, abas implementadas com `<webview>`, omnibox, menu de contexto, favoritos, histórico, downloads e páginas internas (`lumen://page/*`).
- **Bloqueador** (`src/main/adblock.js`): `@ghostery/adblocker-electron` com listas EasyList/EasyPrivacy/uBlock, motor serializado em cache (`userData/cache/engine-*.bin`) e atualização remota opcional (`updateLists`).
- **Persistência** (`src/main/store.js`): arquivos JSON em `userData/data/` (settings, bookmarks, history, downloads, session).
- **Build**: `electron-builder` (NSIS, x64) via `package.json` → `dist/Lumen-Setup-0.1.0.exe`.

## Superfícies e fronteiras revisadas

| Superfície | Fronteira | Subsistema | Classe de ataque |
| --- | --- | --- | --- |
| desktop-main-process | renderer-to-main | ipc-and-downloads | untrusted-path-write |
| desktop-main-process | web-content-to-os | navigation-and-permissions | scheme-handling-and-permissions |
| renderer-shell | web-content-to-shell | tab-url-and-dom | xss-and-scheme-injection |
| main-adblock-store | network-and-local-file | filter-lists-and-json-store | supply-chain-and-path-traversal |
| webview-guest | web-content-to-app | guest-navigation-and-permissions | permission-and-scheme-bypass |
| build-and-release | artifact-distribution | electron-builder-and-nsis | supply-chain (out_of_scope) |

## Controles existentes (confirmados no código)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` e `webviewTag: true` na janela principal (`src/main/main.js:491-499`).
- Allowlist de canais no preload (`src/main/preload-shell.js:5-37`) e rejeição de remetente diferente da janela principal (`src/main/main.js:380`).
- CSP restritiva na casca: `default-src 'self'; script-src 'self'` (`src/renderer/shell.html:7`).
- `escapeHtml` aplicado nos pontos de interpolação do renderer (`src/renderer/shell.js:95`), sem XSS estabelecido nesta auditoria.
- Bloqueio de popups reais com repasse ao renderer (`src/main/main.js:180-183`, `src/main/main.js:536`) e bloqueio de navegação da própria janela (`src/main/main.js:537`).
- `external:open` restrito a `^https?:` (`src/main/main.js:310-313`).
- Confinamento de downloads à pasta padrão e política de permissões explícita na sessão padrão (`src/main/main.js:545-571`) — a política, porém, concede permissões sensíveis (ver achados).
- Guest sem `preload`, sem `nodeIntegration` e sem IPC: `ipc-message` é tratado como vazio (`src/renderer/shell.js:376`).

## Lacunas estruturais relevantes

1. `createWebTab` é o único ponto de criação de guests e não valida esquema (`src/renderer/shell.js:198,229`), enquanto `resolveInput` (`:122`) só cobre a entrada digitada.
2. `will-navigate` usa denylist e delega esquemas não-web ao sistema operacional (`src/main/main.js:185-197`).
3. A política de permissões é acoplada a `session.defaultSession` (`src/main/main.js:553-571`); a partição `lumen-private` recebe apenas downloads (`:547-551`).
4. Não existe `will-attach-webview` para impor `webPreferences` seguras aos guests (`src/main/main.js:624-627`).
5. `uniquePath` normaliza apenas o rótulo exibido, não o caminho gravado (`src/main/main.js:82-92`).
6. `updateLists` confia em HTTPS + host terceiro, sem integridade, tamanho ou tempo limite (`src/main/adblock.js:321-342`).

## Escopo e limitações desta revisão

- Revisão do código-fonte apenas; **nenhum código do alvo foi executado** durante a auditoria (não havia sandbox de OS disponível no ambiente).
- Alvo não está sob controle de versão (`git status` → not a git repository), portanto não há commit de referência; a revisão se refere à árvore de trabalho em 17/11/2026.
- Dependências de terceiros (`@ghostery/adblocker*`, `electron`, `electron-builder`) não foram auditadas; apenas os pontos de uso no código do alvo.