# Relatório de auditoria de segurança — Lumen (run-1)

- **Alvo:** `C:\Users\djnat\Projects\Lumen`
- **Repositório:** `Navegador--Lumen`
- **Referência de código:** árvore de trabalho (o alvo não é repositório git; sem commit)
- **Perfil:** `standard`
- **Data:** 2026-11-17
- **Modo:** auditoria completa (seis fases), com artefatos em `run-1/`

## 1. Estado da validação de candidatos

**Completa.** Todos os candidatos gerados pelas ondas de caça foram consolidados e validados individualmente contra o código-fonte por verificadores independentes (Fase 3) e por agentes novos de reverificação (Fase 5). Não há fingerprint pendente de validação por limite de orçamento.

- Candidatos brutos: 21 (4 caçadores)
- Duplicatas consolidadas: 11 registros finais
- `confirmed`: 5
- `needs_validation`: 4
- `rejected`: 2

## 2. Resumo executivo

A arquitetura base está correta (sandbox, contextIsolation, CSP `script-src 'self'`, preload com allowlist, guest sem IPC). As falhas encontradas estão no **main process** e na **ponte web→SO**, não na casca:

1. **Download com path traversal (high)** — o nome de arquivo vindo do servidor (`Content-Disposition`) é normalizado apenas para exibição; o caminho gravado aceita `..` e sai da pasta Downloads.
2. **Câmera/microfone sem consentimento (high)** — a política de permissões concede `media` a qualquer origem HTTPS.
3. **`will-navigate` com denylist (medium)** — qualquer esquema não-web (inclui `file:`) é aberto no sistema operacional, sem diálogo.
4. **`createWebTab` sem validação de esquema (medium)** — popups, menu de contexto, arrastar arquivo e restauração de sessão entregam URLs de conteúdo web direto ao `src` do guest.
5. **Notificações em origem http (low)** — o handler de checagem concede `notifications` sem exigir TLS.

Os itens 1, 2 e 3/4 podem ser encadeados: o download com traversal grava um arquivo em caminho escolhido e a navegação por esquema abre arquivos locais no SO, o que em conjunto representa uma superfície de persistência/execução acionada por conteúdo web com um único clique de download.

## 3. Achados confirmados

| # | Fingerprint | Severidade | Resumo |
| --- | --- | --- | --- |
| 1 | `lumen/main-downloads-filename-path-traversal` | **high** | `item.getFilename()` + `path.join` gravam o download fora de `Downloads` |
| 2 | `lumen/permission-media-auto-granted-https` | **high** | `media`/`clipboard-read`/`window-management` concedidos a qualquer origem HTTPS |
| 3 | `lumen/guest-will-navigate-external-open-denylist` | **medium** | Esquemas não-web (inclui `file:`) vão para `shell.openExternal` sem diálogo |
| 4 | `lumen/create-webtab-no-scheme-validation` | **medium** | Quatro caminhos de conteúdo web chegam ao `src` do guest sem validar esquema |
| 5 | `lumen/notifications-permitted-on-insecure-origins` | **low** | `notifications` concedida em origem `http` pelo check handler |

Detalhe por achado, com trace, evidência, condições, execução e correção sugerida: `FINDINGS-DETAIL.md`.

### Correções de menor efeito (ordem recomendada)

1. `src/main/main.js:82-92` — reduzir o nome a um único segmento seguro e validar o caminho final contra a pasta de downloads antes de atribuir `savePath`.
2. `src/main/main.js:553-571` — remover `media`, `clipboard-read`, `window-management` e `unknown` da allowlist automática; negar por padrão e exigir HTTPS nos dois handlers.
3. `src/renderer/shell.js:198` — validar esquema no único ponto de criação do guest e rotear popups/menu por `openUrl`.
4. `src/main/main.js:185-197` — trocar a denylist por allowlist e nunca delegar `file:` ao SO.
5. `src/main/main.js:568-571` — tratar `notifications` como as demais permissões (exigir HTTPS).

## 4. Itens que precisam de validação (needs_validation)

Nenhum deles é confirmado; cada um tem bloqueio explícito e plano de verificação em `NEEDS-VALIDATION.md`.

| Fingerprint | Título | Bloqueio |
| --- | --- | --- |
| `lumen/private-session-no-permission-policy` | Sessão `lumen-private` sem política de permissão | Comportamento default do Electron para sessão sem handlers (fora do repositório) |
| `lumen/downloads-show-arbitrary-path` | `downloads:show` abre qualquer caminho existente | Requer execução de código no renderer (não estabelecido) |
| `lumen/filter-list-update-no-integrity-or-limit` | Atualização de listas sem integridade/tamanho/timeout | Depende de controle do host remoto ou quebra de TLS |
| `lumen/no-will-attach-webview-hardening` | Sem endurecimento em `will-attach-webview` | Requer execução de código no renderer (não estabelecido) |

## 5. Itens rejeitados

| Fingerprint | Motivo |
| --- | --- |
| `lumen/settings-json-prototype-pollution` | Exige escrita local no perfil (mesmo poder do suposto ganho); sem travessia de fronteira |
| `lumen/engine-cache-deserialize` | Cache local derivado de arquivos do próprio app, desserialização com fallback; sem sink de execução |

## 6. Cobertura

- **Sem execução anterior:** não existia `coverage-ledger.json` nem `findings.json` para este alvo; esta é a primeira passada e não esgota o alvo.
- **Unidades do ledger:** 6 (5 cobertas/candidatas + 1 `out_of_scope`).
- **Fora de escopo declarado:** build/release (assinatura de código, ícone padrão do instalador, procedência de binários) — ver `coverage-ledger.json`.
- **Companheiros selecionados:** `DESKTOP-MOBILE-AND-LOCAL-IPC.md`, `CLIENT-SIDE.md`, `SUPPLY-CHAIN-AND-RELEASE.md`.
- **Não coberto:** dependências de terceiros (`@ghostery/adblocker*`, `electron`, `electron-builder`), conteúdo das listas de filtros, e comportamento de runtime do Electron não determinável pelo código.

## 7. Limitações

- **Nenhum código do alvo foi executado.** O ambiente não oferece sandbox de OS com os controles exigidos (sem rede externa, ambiente vazio, limites de CPU/memória/tempo, alvo somente leitura). A única verificação local executada foi um cálculo puro de `path.join` (Node) fora do processo do alvo, usado como evidência do primitivo do achado 1.
- Afirmações que dependem de runtime (política default de sessão sem handlers, honra de `savePath` pelo Electron, execução de scriptlets da biblioteca) estão registradas como `needs_validation`, não como confirmadas.
- A revisão é da árvore de trabalho; como o alvo não usa controle de versão, não há fingerprint de commit que permita repetir a auditoria sobre a mesma revisão no futuro.

## 8. Reprodutibilidade

- Validadores: `validate-findings.cjs findings.json` → `PASS: 11 findings valid`; `validate-coverage-ledger.cjs coverage-ledger.json` → `PASS: 6 coverage units valid`.
- Os validadores exigem `O_NOFOLLOW`/`O_NONBLOCK`; no Windows foram invocados com um shim de constantes (`node --require winfs-flags.cjs`) porque `fs.constants.O_NOFOLLOW` não existe nessa plataforma.
- Nenhum endpoint implantado, serviço externo ou dado de terceiros foi sondado.