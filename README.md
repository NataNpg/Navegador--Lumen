# Lumen

Navegador de desktop leve, moderno e com bloqueador de anúncios integrado
(estilo Brave/AdGuard), construído com Electron + WebView2 (Chromium do sistema).

- Interface própria (React-free, HTML/CSS puro) em cima de `<webview>`
- Bloqueio de anúncios e rastreadores com o motor `adblock-rust` (Ghostery
  adblocker, o mesmo núcleo usado em versões recentes do Brave/Tor)
- Regras de rede do EasyList, EasyPrivacy, uBlock Filters, Quick Fixes,
  Unbreak e Badware, empacotadas localmente (funciona offline)
- Bloqueio específico de anúncios do YouTube (rede + script no player)
- Botão de alternância global, por aba e por site (pausar/reativar)
- Economia de memória: suspende abas inativas e libera RAM

## Rodar

```powershell
npm install
npm start
```

> Se `ELECTRON_RUN_AS_NODE` estiver definido no ambiente (comum em shells de
> agentes), o `scripts/start.js` remove a variável antes de abrir a janela.

## Como testar sem abrir a janela

```powershell
npm start -- --remote-debugging-port=9222
node scripts/smoke-test.js 9222
```

O teste recarrega a janela, coleta erros de console e imprime um retrato do
estado da interface (abas, tema, relógio, escudo).

## Estrutura

```
src/main/
  main.js          janela, IPC, downloads, atalhos, injeção no YouTube
  adblock.js       motor de filtros, pós-processamento por aba/site, métricas
  store.js        configurações, favoritos e histórico (JSON em userData)
  preload-shell.js ponte contextBridge (canais com allowlist)
src/renderer/
  shell.html       chrome do navegador (abas, omnibox, páginas internas)
  styles.css       tema claro/escuro, glass, animações
  shell.js         abas <webview>, omnibox, find, favoritos, histórico, etc.
assets/filters/    listas de filtros empacotadas
scripts/
  start.js         launcher (remove ELECTRON_RUN_AS_NODE)
  fetch-lists.js   baixa/re-atualiza as listas
  smoke-test.js    verificação headless via CDP
```

## Arquitetura

O processo principal (`src/main`) não conhece abas: ele cuida de filtros,
persistência, downloads e atalhos. Quem controla abas é o renderer do
`shell.html`, usando elementos `<webview>` — assim a interface tem controle
total de layout (cantos arredondados, find bar, popovers, downloads) sem
janelas nativas sobrepostas.

Cada aba é um guest WebContents com sandbox. O processo principal registra os
listeners de cada guest via `webContents.fromId()` no `dom-ready`
(`tab:ready`), o que mantém o renderer da interface livre de trabalho pesado.

## Desempenho

- Um único processo de UI (o `shell`), abas em guests separados
- `spellcheck`, `webviewTag`, aceleração de código V8 (`v8CacheOptions: 'code'`)
- Suspensão de abas inativas (`maxLiveTabs`, padrão 6) — a aba volta a carregar
  ao ser ativada
- Restauração de sessão sob demanda: as abas do histórico voltam apontando
  para `about:blank` e só carregam a URL real quando ativadas, então abrir o
  navegador com 10 abas salvas custa a memória de uma página
- Serviços de segundo plano do Chromium desligados (component updates, sync,
  métricas, envio de relatórios) — sem processos utilitários ociosos
- Cache do motor de filtros serializado em disco: a primeira execução faz
  parse das listas (~0,7 s), as seguintes carregam do cache

## O que está implementado

| Recurso | Status |
| --- | --- |
| Abas, navegação, histórico, recarregar/parar | ok |
| Omnibox com busca (Google, DuckDuckGo, Brave, Bing, Startpage) | ok |
| Bloqueador de anúncios/rastreadores + pausa por site | ok |
| Anúncios do YouTube (rede + skip automático) | ok |
| Favoritos (barra + página) | ok |
| Histórico com busca e limpeza | ok |
| Downloads com progresso | ok |
| Janela privada (partição de sessão isolada) | ok |
| Find in page (Ctrl+F), zoom, tela cheia | ok |
| Menu de contexto, atalhos de teclado, tema claro/escuro | ok |
| Economia de memória e restauração de abas | ok |

## Ainda não implementado

- Extensões do Chrome Web Store
- Sincronização de favoritos/histórico entre dispositivos
- Gerenciador de senhas e preenchimento automático
- Modo leitor, tradução e VPN/Tor

## Licença

MIT para o código do Lumen. As listas de filtros mantêm suas licenças de
origem (EasyList, uBlock Origin, EasyPrivacy). O motor de bloqueio é MPL-2.0
(Ghostery).