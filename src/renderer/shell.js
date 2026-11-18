'use strict';

/* ============================================================
   Lumen shell — tab strip, omnibox, pages, popovers
   ============================================================ */

const { invoke, on } = window.lumen;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const HOME = 'lumen://newtab';
const PAGE_TITLES = {
  newtab: 'Nova aba',
  settings: 'Configurações',
  bookmarks: 'Favoritos',
  history: 'Histórico',
  downloads: 'Downloads',
  about: 'Sobre o Lumen',
};

const state = {
  tabs: [],
  activeId: null,
  seq: 0,
  settings: {},
  engines: {},
  closed: [],
  downloads: [],
  findOpen: false,
  lastOmni: '',
  findQuery: '',
};

/* ---------------- element helpers ---------------- */

function icon(name, cls = 'icon') {
  return `<svg class="${cls}"><use href="#i-${name}" /></svg>`;
}

// Static buttons in shell.html only carry `data-icon="i-name"`; without this
// they render as empty boxes (invisible on the light theme).
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    if (node.querySelector('svg')) return;
    const ref = node.dataset.icon || '';
    const name = ref.startsWith('i-') ? ref.slice(2) : ref;
    if (!name) return;
    node.insertAdjacentHTML('afterbegin', icon(name));
  });
}

function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function prettyUrl(url) {
  if (!url) return '';
  if (url === HOME) return '';
  if (url.startsWith('lumen://')) return url.startsWith('lumen://page/') ? '' : url;
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.host}${path}${u.search}`;
  } catch {
    return url;
  }
}

function initials(host) {
  if (!host) return '•';
  const clean = host.replace(/^www\./, '');
  return clean.slice(0, 2).toUpperCase();
}

function escapeHtml(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---------------- state lookups ---------------- */

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeId) || null;
}

function tabById(id) {
  return state.tabs.find((t) => t.id === id) || null;
}

function webTabs() {
  return state.tabs.filter((t) => t.kind === 'web');
}

/* ---------------- navigation ---------------- */

function searchUrl(query) {
  const engine = state.engines[state.settings.searchEngine] || state.engines.google;
  return engine.url.replace('%s', encodeURIComponent(query));
}

function resolveInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return HOME;
  if (/^lumen:\/\//i.test(text)) {
    const rest = text.replace(/^lumen:\/\//i, '').replace(/\/$/, '');
    if (!rest || rest === 'newtab' || rest === 'home') return HOME;
    return text;
  }
  if (/^(about|devtools):/i.test(text)) return text;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/i.test(text)) return `http://${text}`;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(text)) return `https://${text}`;
  return searchUrl(text);
}

function openUrl(raw, opts = {}) {
  const url = resolveInput(raw);
  if (url === HOME || /^lumen:\/\/newtab\/?$/.test(url)) {
    openPage('newtab', opts);
    return null;
  }
  const pageMatch = /^lumen:\/\/page\/([a-z-]+)\/?$/i.exec(url);
  if (pageMatch && PAGE_TITLES[pageMatch[1]]) {
    openPage(pageMatch[1], opts);
    return null;
  }
  return createWebTab(url, opts);
}

function privatePageUrl() {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Janela privada</title>
<style>
  html,body{height:100%;margin:0}
  body{display:grid;place-items:center;background:radial-gradient(120% 120% at 20% 10%,#1b2440 0%,#0b0d12 55%,#07080c 100%);
       color:#e9edf5;font:15px/1.5 "Segoe UI Variable Text",system-ui,sans-serif}
  .box{width:min(520px,86vw);text-align:center}
  .badge{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;
         background:rgba(122,162,255,.14);border:1px solid rgba(122,162,255,.3);color:#9db6ff;font-size:12px;letter-spacing:.4px}
  h1{font-weight:300;font-size:30px;letter-spacing:-.8px;margin:18px 0 6px}
  p{color:#8b93a7;font-size:13px;margin:0 0 26px}
  form{display:flex;gap:8px;background:#151922;border:1px solid rgba(255,255,255,.1);
       border-radius:16px;padding:6px 6px 6px 16px}
  input{flex:1;background:none;border:0;outline:0;color:#e9edf5;font-size:15px}
  button{border:0;border-radius:11px;padding:0 18px;font-size:14px;font-weight:600;color:#0b0d12;
         background:linear-gradient(135deg,#7aa2ff,#b98cff);cursor:pointer}
  .hint{margin-top:20px;color:#5d6577;font-size:11.5px}
</style></head>
<body><div class="box">
  <div class="badge">&#128274; Janela privada</div>
  <h1>Nada fica salvo</h1>
  <p>Histórico, favoritos e downloads desta aba não são gravados no Lumen.</p>
  <form id="f"><input id="q" placeholder="Pesquisar na web" autofocus autocomplete="off" />
  <button type="submit">Ir</button></form>
  <div class="hint">Anúncios continuam bloqueados nesta janela.</div>
</div>
<script>
  document.getElementById('f').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = document.getElementById('q').value.trim();
    if (!q) return;
    location.href = 'https://duckduckgo.com/?q=' + encodeURIComponent(q);
  });
</script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createPrivateTab() {
  return createWebTab(privatePageUrl(), {
    private: true,
    title: 'Janela privada',
  });
}

/* ---------------- tab creation ---------------- */

function createWebTab(url, opts = {}) {
  const tab = {
    id: ++state.seq,
    kind: 'web',
    title: opts.title || prettyUrl(url) || 'Nova aba',
    url,
    favicon: '',
    loading: true,
    blocked: 0,
    audible: false,
    muted: false,
    canGoBack: false,
    canGoForward: false,
    suspended: false,
    isPrivate: !!opts.private,
    wcId: 0,
    el: null,
    // Set while a background tab still points at about:blank. The real URL is
    // only loaded when the tab is activated, so restoring a session does not
    // spin up a renderer (and a page load) per tab.
    pendingUrl: null,
    awaitingNav: false,
    ready: false,
  };

  const deferred = !!opts.deferred;
  if (deferred) {
    tab.pendingUrl = url;
    tab.awaitingNav = true;
  }

  const webview = document.createElement('webview');
  webview.setAttribute('src', deferred ? 'about:blank' : url);
  webview.setAttribute('allowpopups', '');
  if (opts.private) webview.setAttribute('partition', 'lumen-private');
  webview.dataset.tabId = String(tab.id);
  // Created hidden; activateTab() clears the class. Creating it visible would
  // flash the page for a frame before the tab is switched.
  webview.classList.add('inactive');
  tab.el = webview;

  wireWebview(tab);
  $('#webviews').appendChild(webview);

  state.tabs.push(tab);
  if (!opts.background) activateTab(tab.id);
  else render();
  scheduleSave();
  return tab;
}

function createPageTab(page, opts = {}) {
  let tab = state.tabs.find((t) => t.kind === 'page' && t.page === page);
  if (!tab) {
    tab = {
      id: ++state.seq,
      kind: 'page',
      page,
      title: PAGE_TITLES[page] || page,
      url: `lumen://page/${page}`,
      loading: false,
      blocked: 0,
      audible: false,
      muted: false,
      canGoBack: false,
      canGoForward: false,
      suspended: false,
      isPrivate: false,
    };
    state.tabs.push(tab);
  }
  if (!opts.background) activateTab(tab.id);
  else render();
  return tab;
}

function openPage(page, opts = {}) {
  return createPageTab(page, opts);
}

/* ---------------- webview events ---------------- */

function wireWebview(tab) {
  const wv = tab.el;

  const onReady = () => {
    tab.ready = true;
    tab.wcId = wv.getWebContentsId();
    invoke('tab:ready', { wcId: tab.wcId }).catch(() => {});
  };

  wv.addEventListener('dom-ready', onReady);
  wv.addEventListener('did-attach', () => {
    setTimeout(() => {
      if (!tab.wcId && wv.getWebContentsId) {
        tab.wcId = wv.getWebContentsId();
        invoke('tab:ready', { wcId: tab.wcId }).catch(() => {});
      }
    }, 60);
  });

  wv.addEventListener('did-start-loading', () => {
    tab.loading = true;
    updateTabChrome(tab);
  });

  wv.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    updateTabChrome(tab);
  });

  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || tab.title;
    updateTabChrome(tab);
  });

  wv.addEventListener('page-favicon-updated', (e) => {
    tab.favicon = e.favicons && e.favicons.length ? e.favicons[e.favicons.length - 1] : '';
    updateTabChrome(tab);
  });

  wv.addEventListener('did-navigate', (e) => {
    // Ignore the placeholder navigation a deferred tab performs on creation.
    if (tab.awaitingNav && (!e.url || e.url === 'about:blank')) return;
    tab.awaitingNav = false;
    if (tab.suppressNav) {
      tab.suppressNav = false;
      return;
    }
    tab.url = e.url;
    syncNav(tab);
    scheduleSave();
    if (state.findOpen && tab.id === state.activeId) closeFind();
    updateTabChrome(tab);
  });

  wv.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url;
    syncNav(tab);
    updateTabChrome(tab);
  });

  wv.addEventListener('found-in-page', (e) => {
    if (e.result.activeMatchOrdinal || e.result.matches === 0) {
      $('#find-count').textContent = e.result.matches
        ? `${e.result.activeMatchOrdinal}/${e.result.matches}`
        : '0/0';
    }
  });

  wv.addEventListener('media-started-playing', () => {
    tab.audible = true;
    updateTabChrome(tab);
  });

  wv.addEventListener('media-paused', () => {
    tab.audible = false;
    updateTabChrome(tab);
  });

  wv.addEventListener('enter-html-full-screen', () => {
    document.body.classList.add('fullscreen');
  });

  wv.addEventListener('leave-html-full-screen', () => {
    document.body.classList.remove('fullscreen');
  });

  wv.addEventListener('context-menu', (e) => {
    if (e.params) showContextMenu(e.params, tab);
  });

  wv.addEventListener('close', () => closeTab(tab.id));

  wv.addEventListener('crashed', () => {
    toast('A página travou. Recarregue para continuar.');
  });

  wv.addEventListener('ipc-message', () => {});
}

function syncNav(tab) {
  if (!tab || !tab.el) return;
  try {
    tab.canGoBack = tab.el.canGoBack();
    tab.canGoForward = tab.el.canGoForward();
  } catch {
    /* ignore */
  }
}

function updateTabChrome(tab) {
  renderTabs();
  if (tab && tab.id === state.activeId) renderToolbar();
}

/* ---------------- tab activation ---------------- */

function activateTab(id) {
  const tab = tabById(id);
  if (!tab) return;
  state.activeId = id;
  tab.lastActive = Date.now();
  syncNav(tab);

  $$('#webviews webview').forEach((wv) => {
    const target = tabById(Number(wv.dataset.tabId));
    const isTarget = !!(target && target.id === id);
    wv.classList.toggle('active', isTarget);
    // `inactive` is what actually hides the webview. Never hide tabs by
    // forcing `display: block` on `.active`: Electron then collapses the
    // guest to its 150px fallback height (see styles.css).
    wv.classList.toggle('inactive', !isTarget);
    if (!isTarget) wv.blur?.();
  });

  $$('.page').forEach((p) => p.classList.remove('active'));
  if (tab.kind === 'page') {
    const pageEl = $(`#page-${tab.page}`);
    if (pageEl) {
      pageEl.classList.add('active');
      if (tab.page === 'newtab') refreshNewTab();
      if (tab.page === 'settings') renderSettings();
      if (tab.page === 'bookmarks') renderBookmarks();
      if (tab.page === 'history') renderHistory();
      if (tab.page === 'downloads') renderDownloads();
      if (tab.page === 'about') renderAbout();
    }
  } else if (tab.kind === 'web' && tab.suspended) {
    resumeTab(tab);
  } else if (tab.kind === 'web' && tab.pendingUrl) {
    hydrateTab(tab);
  }

  enforceMemorySaver();
  render();
  scheduleSave();
}

// Loads a URL in a guest. The `src` attribute must not be pointed at a real
// URL before the first commit lands: Electron writes the committed URL back
// into `src` (WebViewImpl.onLoadCommit), so an early `src` write is overwritten
// by the initial about:blank commit and the real navigation is lost.
function loadInTab(tab, url) {
  const el = tab.el;
  if (!el) return;
  const go = () => {
    try {
      el.loadURL(url);
    } catch {
      el.setAttribute('src', url);
    }
  };
  if (tab.ready) go();
  else el.addEventListener('dom-ready', go, { once: true });
}

// Loads the real URL of a background tab the first time it is shown.
function hydrateTab(tab) {
  if (!tab || !tab.pendingUrl || !tab.el) return false;
  const target = tab.pendingUrl;
  tab.pendingUrl = null;
  tab.loading = true;
  loadInTab(tab, target);
  updateTabChrome(tab);
  return true;
}

function resumeTab(tab) {
  if (tab.pendingUrl) return hydrateTab(tab);
  tab.suspended = false;
  loadInTab(tab, tab.url);
}

function suspendTab(tab) {
  if (tab.suspended || tab.pendingUrl || tab.audible || !tab.el) return;
  tab.suspended = true;
  tab.suppressNav = true;
  tab.el.setAttribute('src', 'about:blank');
  tab.el.classList.remove('active');
  tab.el.classList.add('inactive');
}

function enforceMemorySaver() {
  if (!state.settings.memorySaver) return;
  const max = Number(state.settings.maxLiveTabs) || 6;
  const live = webTabs().filter((t) => !t.suspended && !t.pendingUrl);
  if (live.length <= max) return;
  const candidates = live
    .filter((t) => t.id !== state.activeId && !t.audible)
    .sort((a, b) => (a.lastActive || 0) - (b.lastActive || 0));
  let overflow = live.length - max;
  for (const tab of candidates) {
    if (overflow-- <= 0) break;
    suspendTab(tab);
  }
}

/* ---------------- close / reopen ---------------- */

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, 1500);
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tab = state.tabs[idx];

  if (tab.kind === 'web') {
    state.closed.push({
      url: tab.pendingUrl || (tab.el && tab.el.getURL ? tab.el.getURL() || tab.url : tab.url),
      title: tab.title,
      private: tab.isPrivate,
    });
    if (state.closed.length > 25) state.closed.shift();
    if (tab.el) tab.el.remove();
  }

  state.tabs.splice(idx, 1);
  scheduleSave();

  if (state.activeId === id) {
    const next = state.tabs[idx] || state.tabs[idx - 1] || null;
    if (next) activateTab(next.id);
    else {
      state.activeId = null;
      openUrl(HOME);
      return;
    }
  }
  render();
}

function reopenTab() {
  const last = state.closed.pop();
  if (!last) {
    openUrl(HOME);
    return;
  }
  if (last.private) createWebTab(last.url, { private: true });
  else createWebTab(last.url);
}

/* ---------------- rendering ---------------- */

function renderTabs() {
  const host = $('#tabs');
  const scroll = host.scrollLeft;

  host.innerHTML = state.tabs
    .map((tab) => {
      const active = tab.id === state.activeId;
      const favicon = tab.favicon
        ? `<img class="favicon" src="${escapeHtml(tab.favicon)}" alt="" />`
        : `<span class="fav-fallback">${escapeHtml(initials(tab.kind === 'web' ? hostOf(tab.url) : 'lumen'))}</span>`;
      const loading = tab.loading && !active;
      return `<div class="tab${active ? ' active' : ''}${tab.audible ? ' audible' : ''}${tab.isPrivate ? ' private' : ''}" data-id="${tab.id}" role="tab" aria-selected="${active}">
        ${loading ? '<span class="spinner"></span>' : favicon}
        <span class="tab-audio">${icon('volume')}</span>
        <span class="tab-title">${escapeHtml(tab.title || 'Nova aba')}</span>
        <span class="tab-close" data-close="${tab.id}" title="Fechar aba">${icon('close')}</span>
      </div>`;
    })
    .join('');

  host.scrollLeft = scroll;
}

function renderToolbar() {
  const tab = activeTab();
  const input = $('#omnibox-input');
  const isPage = tab && tab.kind === 'page';

  if (document.activeElement !== input) {
    const value = tab ? (tab.url === HOME ? '' : prettyUrl(tab.url)) : '';
    if (input.value !== value) input.value = value;
  }

  $('#nav-back').disabled = !(tab && tab.canGoBack);
  $('#nav-forward').disabled = !(tab && tab.canGoForward);
  $('#omni-stop').hidden = !(tab && tab.loading && !isPage);

  const star = $('#star');
  const bookmarked = !!(tab && tab.kind === 'web' && state.bookmarks && state.bookmarks.some((b) => b.url === tab.url));
  star.classList.toggle('on', bookmarked);

  const paused = tab && tab.kind === 'web' ? isPaused(tab.url) : false;
  const shield = $('#shield');
  shield.classList.toggle('armed', !!(state.settings.globalAdblock && !paused));
  shield.classList.toggle('paused', paused);

  const count = tab && tab.kind === 'web' ? tab.blocked : 0;
  const badge = $('#shield-count');
  badge.textContent = count > 999 ? '999+' : String(count);
  badge.hidden = !count;
}

function renderBookmarksBar() {
  const bar = $('#bookmarkbar');
  const list = state.bookmarks || [];
  if (!state.settings.showBookmarksBar || !list.length) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;
  bar.innerHTML = list
    .slice(0, 40)
    .map(
      (b) => `<button class="bm-chip" data-url="${escapeHtml(b.url)}" title="${escapeHtml(b.url)}">
        <span class="dot"></span>${escapeHtml(b.title || hostOf(b.url))}
      </button>`
    )
    .join('');
}

function render() {
  renderTabs();
  renderToolbar();
  renderBookmarksBar();
  renderShield();
}

/* ---------------- new tab page ---------------- */

function refreshNewTab() {
  const now = new Date();
  $('#nt-time').textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  $('#nt-date').textContent = now.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const engine = state.engines[state.settings.searchEngine];
  if (engine) $('#nt-engine').textContent = engine.name;

  invoke('history:top-sites').then((sites) => {
    const host = $('#nt-links');
    if (!sites || !sites.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = sites
      .map(
        (s) => `<button class="nt-link" data-url="${escapeHtml(s.url)}" title="${escapeHtml(s.url)}">
          <span class="nt-ico">${escapeHtml(initials(hostOf(s.url)))}</span>
          <span class="nt-name">${escapeHtml(s.title || hostOf(s.url))}</span>
        </button>`
      )
      .join('');
  });
}

/* ---------------- settings page ---------------- */

function settingRow({ title, sub, control }) {
  return `<div class="set-row">
    <div class="set-main"><div class="set-title">${title}</div>${sub ? `<div class="set-sub">${sub}</div>` : ''}</div>
    <div class="set-control">${control}</div>
  </div>`;
}

function switchHtml(id, on) {
  return `<button class="switch${on ? ' on' : ''}" id="${id}" role="switch" aria-checked="${on}"><span></span></button>`;
}

function renderSettings() {
  const s = state.settings;
  const root = $('#settings-root');

  const engineOptions = Object.entries(state.engines)
    .map(([key, e]) => `<option value="${key}"${s.searchEngine === key ? ' selected' : ''}>${escapeHtml(e.name)}</option>`)
    .join('');

  const themeOptions = [
    ['dark', 'Escuro'],
    ['light', 'Claro'],
    ['system', 'Sistema'],
  ]
    .map(([v, label]) => `<option value="${v}"${s.theme === v ? ' selected' : ''}>${label}</option>`)
    .join('');

  const paused = (s.pausedSites || []).length;

  root.innerHTML = `
    <div class="card">
      <div class="card-title">Aparência</div>
      ${settingRow({
        title: 'Tema',
        sub: 'Aparência da interface do navegador',
        control: `<select class="set-select" id="set-theme">${themeOptions}</select>`,
      })}
      ${settingRow({
        title: 'Barra de favoritos',
        sub: 'Mostrar atalhos abaixo da barra de endereço',
        control: switchHtml('set-bookmarks', !!s.showBookmarksBar),
      })}
    </div>

    <div class="card">
      <div class="card-title">Privacidade</div>
      ${settingRow({
        title: 'Bloqueador de anúncios',
        sub: 'Filtra anúncios e rastreadores com listas EasyList, uBlock e EasyPrivacy',
        control: switchHtml('set-ads', !!s.globalAdblock),
      })}
      ${settingRow({
        title: 'Anúncios do YouTube',
        sub: 'Bloqueia anúncios em vídeo, banners e cards promocionais',
        control: switchHtml('set-youtube', !!s.youtubeAds),
      })}
      ${settingRow({
        title: 'Sites pausados',
        sub: paused ? `${paused} site(s) com o bloqueador desativado` : 'Nenhum site pausado',
        control: `<button class="btn ghost tiny" id="set-unpause">Reativar todos</button>`,
      })}
      ${settingRow({
        title: 'Listas de filtros',
        sub: 'Baixar a versão mais recente das listas',
        control: `<button class="btn ghost tiny" id="set-update">Atualizar agora</button>`,
      })}
    </div>

    <div class="card">
      <div class="card-title">Busca</div>
      ${settingRow({
        title: 'Mecanismo de busca',
        sub: 'Usado ao digitar no omnibox',
        control: `<select class="set-select" id="set-engine">${engineOptions}</select>`,
      })}
      ${settingRow({
        title: 'Página inicial',
        sub: 'Aberta em novas abas',
        control: `<input class="set-num" style="width:220px" id="set-home" value="${escapeHtml(s.homepage)}" />`,
      })}
    </div>

    <div class="card">
      <div class="card-title">Desempenho</div>
      ${settingRow({
        title: 'Economia de memória',
        sub: 'Suspende abas inativas para liberar RAM',
        control: switchHtml('set-saver', !!s.memorySaver),
      })}
      ${settingRow({
        title: 'Abas ativas simultâneas',
        sub: 'Limite antes de suspender abas antigas',
        control: `<input class="set-num" id="set-maxtabs" type="number" min="1" max="20" value="${Number(s.maxLiveTabs) || 6}" />`,
      })}
      ${settingRow({
        title: 'Restaurar abas',
        sub: 'Reabrir as abas da sessão anterior',
        control: switchHtml('set-restore', !!s.restoreTabs),
      })}
    </div>

    <div class="card">
      <div class="card-title">Sobre</div>
      ${settingRow({
        title: 'Lumen',
        sub: 'Navegador leve com bloqueador integrado',
        control: `<span class="set-sub" id="set-version"></span>`,
      })}
    </div>
  `;

  invoke('app:info')
    .then((info) => {
      const v = $('#set-version');
      if (v) v.textContent = `v${info.version} · Chromium ${info.chrome} · ${info.memory} MB`;
    })
    .catch(() => {});

  const save = (patch) => invoke('settings:set', patch).then(refreshSettings);

  $('#set-theme').addEventListener('change', (e) => {
    document.documentElement.dataset.theme = e.target.value;
    save({ theme: e.target.value });
  });
  $('#set-bookmarks').addEventListener('click', (e) => {
    const next = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', next);
    save({ showBookmarksBar: next });
  });
  $('#set-ads').addEventListener('click', (e) => {
    const next = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', next);
    save({ globalAdblock: next });
  });
  $('#set-youtube').addEventListener('click', (e) => {
    const next = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', next);
    save({ youtubeAds: next });
  });
  $('#set-unpause').addEventListener('click', () => {
    invoke('adblock:unpause-all').then(refreshSettings);
    toast('Bloqueador reativado em todos os sites');
  });
  $('#set-update').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Atualizando…';
    const result = await invoke('adblock:update');
    const ok = (result || []).filter((r) => r.ok).length;
    e.currentTarget.disabled = false;
    e.currentTarget.textContent = 'Atualizar agora';
    toast(`${ok} lista(s) atualizada(s)`);
  });
  $('#set-engine').addEventListener('change', (e) => save({ searchEngine: e.target.value }));
  $('#set-home').addEventListener('change', (e) => save({ homepage: e.target.value.trim() || HOME }));
  $('#set-saver').addEventListener('click', (e) => {
    const next = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', next);
    save({ memorySaver: next });
  });
  $('#set-maxtabs').addEventListener('change', (e) => {
    const value = Math.max(1, Math.min(20, Number(e.target.value) || 6));
    e.target.value = String(value);
    save({ maxLiveTabs: value }).then(enforceMemorySaver);
  });
  $('#set-restore').addEventListener('click', (e) => {
    const next = !e.currentTarget.classList.contains('on');
    e.currentTarget.classList.toggle('on', next);
    save({ restoreTabs: next });
  });
}

/* ---------------- bookmarks page ---------------- */

function renderBookmarks() {
  const root = $('#bookmarks-root');
  invoke('bookmarks:list').then((list) => {
    state.bookmarks = list || [];
    renderBookmarksBar();
    renderToolbar();

    if (!state.bookmarks.length) {
      root.innerHTML = `<div class="empty">${icon('bookmark')}<div>Nenhum favorito salvo ainda.</div></div>`;
      return;
    }

    root.innerHTML = `<div class="list">${state.bookmarks
      .map(
        (b) => `<div class="list-row" data-id="${escapeHtml(b.id)}">
          <span class="lr-ico">${escapeHtml(initials(hostOf(b.url)))}</span>
          <div class="lr-body" data-open="${escapeHtml(b.url)}">
            <div class="lr-title">${escapeHtml(b.title || hostOf(b.url))}</div>
            <div class="lr-sub">${escapeHtml(b.url)}</div>
          </div>
          <div class="lr-actions">
            <button class="icon-btn small" data-open="${escapeHtml(b.url)}" title="Abrir">${icon('external')}</button>
            <button class="icon-btn small danger" data-del="${escapeHtml(b.id)}" title="Remover">${icon('trash')}</button>
          </div>
        </div>`
      )
      .join('')}</div>`;

    $$('[data-open]', root).forEach((node) => {
      node.addEventListener('click', () => openUrl(node.dataset.open));
    });
    $$('[data-del]', root).forEach((node) => {
      node.addEventListener('click', () => {
        invoke('bookmarks:remove', { id: node.dataset.del }).then(() => {
          renderBookmarks();
          renderToolbar();
        });
      });
    });
  });
}

/* ---------------- history page ---------------- */

let historyQuery = '';

function renderHistory() {
  const root = $('#history-root');
  invoke('history:list').then((list) => {
    const query = historyQuery.toLowerCase();
    const filtered = (list || []).filter(
      (h) => !query || h.url.toLowerCase().includes(query) || (h.title || '').toLowerCase().includes(query)
    );

    if (!filtered.length) {
      root.innerHTML = `<div class="empty">${icon('history')}<div>${query ? 'Nada encontrado.' : 'Seu histórico está vazio.'}</div></div>`;
      return;
    }

    root.innerHTML = `<div class="list">${filtered
      .slice(0, 400)
      .map(
        (h) => `<div class="list-row" data-id="${escapeHtml(h.id)}">
          <span class="lr-ico">${escapeHtml(initials(hostOf(h.url)))}</span>
          <div class="lr-body" data-open="${escapeHtml(h.url)}">
            <div class="lr-title">${escapeHtml(h.title || h.url)}</div>
            <div class="lr-sub">${escapeHtml(h.url)}</div>
          </div>
          <div class="lr-actions">
            <button class="icon-btn small danger" data-del="${escapeHtml(h.id)}" title="Remover">${icon('close')}</button>
          </div>
        </div>`
      )
      .join('')}</div>`;

    $$('[data-open]', root).forEach((node) => {
      node.addEventListener('click', () => openUrl(node.dataset.open));
    });
    $$('[data-del]', root).forEach((node) => {
      node.addEventListener('click', () => {
        invoke('history:remove', { id: node.dataset.del }).then(renderHistory);
      });
    });
  });
}

/* ---------------- downloads page ---------------- */

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function renderDownloads() {
  const root = $('#downloads-root');
  const list = state.downloads || [];

  if (!list.length) {
    root.innerHTML = `<div class="empty">${icon('download')}<div>Nenhum download por aqui.</div></div>`;
    return;
  }

  root.innerHTML = `<div class="list">${list
    .map(
      (d) => `<div class="list-row" data-id="${escapeHtml(d.id)}">
        <span class="lr-ico">${icon('download')}</span>
        <div class="lr-body">
          <div class="lr-title">${escapeHtml(d.filename)}</div>
          <div class="lr-sub">${d.state === 'completed' ? fmtBytes(d.total) : `${fmtBytes(d.received)} de ${fmtBytes(d.total)} · ${d.state}`}</div>
          <div class="dl-bar"><i style="width:${d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0}%"></i></div>
        </div>
        <div class="lr-actions">
          <button class="icon-btn small" data-show="${escapeHtml(d.path)}" title="Mostrar na pasta">${icon('external')}</button>
          <button class="icon-btn small danger" data-dlclear="1" title="Limpar lista">${icon('trash')}</button>
        </div>
      </div>`
    )
    .join('')}</div>`;

    $$('[data-show]', root).forEach((node) => {
      node.addEventListener('click', () => invoke('downloads:show', { path: node.dataset.show }));
    });
    $$('[data-dlclear]', root).forEach((node) => {
      node.addEventListener('click', () => {
        invoke('downloads:clear').then(() => {
          state.downloads = [];
          renderDownloads();
        });
      });
    });
}

/* ---------------- about page ---------------- */

function renderAbout() {
  const root = $('#about-root');
  if (!root) return;

  const info = invoke('app:info')
    .then((meta) => invoke('adblock:get').then((ab) => Object.assign({ ab }, meta)))
    .catch(() => null);

  info.then((data) => {
    if (!data) {
      root.innerHTML = `<div class="empty">${icon('shield')}<div>Não foi possível ler as informações.</div></div>`;
      return;
    }
    const rows = [
      ['Versão', data.version],
      ['Electron', data.electron],
      ['Chromium', data.chrome],
      ['Node.js', data.node],
      ['Memória do processo', `${data.memory} MB`],
      ['Bloqueador', data.ab && data.ab.ready ? 'ativo' : 'inativo'],
    ];
    root.innerHTML = `<div class="list">${rows
      .map(
        ([label, value]) => `<div class="list-row">
          <div class="lr-body">
            <div class="lr-title">${escapeHtml(label)}</div>
            <div class="lr-sub">${escapeHtml(String(value))}</div>
          </div>
        </div>`
      )
      .join('')}</div>`;
  });
}

/* ---------------- shield popover ---------------- */

function isPaused(url) {
  const origin = originOf(url);
  return !!origin && (state.pausedSites || []).includes(origin);
}

function renderShield() {
  const global = !!state.settings.globalAdblock;
  const youtube = !!state.settings.youtubeAds;
  const tab = activeTab();
  const paused = tab && tab.kind === 'web' && isPaused(tab.url);
  const origin = tab && tab.kind === 'web' ? originOf(tab.url) : '';

  $('#shield').classList.toggle('armed', global && !paused);
  $('#shield').classList.toggle('paused', paused);

  $('#shield-sub').textContent = paused
    ? 'Pausado neste site'
    : global
      ? 'Proteção ativa'
      : 'Proteção desligada';

  $('#ab-global').classList.toggle('on', global);
  $('#ab-global').setAttribute('aria-checked', String(global));
  $('#ab-youtube').classList.toggle('on', youtube);
  $('#ab-youtube2').classList.toggle('on', youtube);

  const count = tab && tab.kind === 'web' ? tab.blocked || 0 : 0;
  $('#ab-count').textContent = String(count);

  $('#shield-on').hidden = !global;
  $('#shield-off').hidden = global;

  const pauseBtn = $('#ab-pause-site');
  pauseBtn.textContent = paused ? 'Reativar bloqueador neste site' : 'Pausar neste site';
  pauseBtn.disabled = !origin;
}

/* ---------------- popovers ---------------- */

function positionPopover(node, anchor, align = 'left') {
  node.hidden = false;
  const a = anchor.getBoundingClientRect();
  const n = node.getBoundingClientRect();
  let left = align === 'right' ? a.right - n.width : a.left;
  left = Math.max(8, Math.min(window.innerWidth - n.width - 8, left));
  let top = a.bottom + 8;
  if (top + n.height > window.innerHeight - 8) top = Math.max(8, a.top - n.height - 8);
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

function closePopovers() {
  $('#shield-popover').hidden = true;
  $('#menu-popover').hidden = true;
}

function toggleShield(force) {
  const pop = $('#shield-popover');
  const show = force != null ? force : pop.hidden;
  closePopovers();
  if (!show) return;
  renderShield();
  positionPopover(pop, $('#shield'), 'left');
}

function toggleMenu(force) {
  const pop = $('#menu-popover');
  const show = force != null ? force : pop.hidden;
  closePopovers();
  if (!show) return;
  positionPopover(pop, $('#menu-btn'), 'right');
}

/* ---------------- context menu ---------------- */

function showContextMenu(params, tab) {
  const menu = $('#ctx-menu');
  const items = [];

  if (params.isEditable) {
    items.push({ label: 'Recortar', act: () => tab.el.cut() });
    items.push({ label: 'Copiar', act: () => tab.el.copy() });
    items.push({ label: 'Colar', act: () => tab.el.paste() });
    items.push({ label: 'Selecionar tudo', act: () => tab.el.selectAll() });
    items.push({ sep: true });
  }

  if (params.selectionText) {
    const text = params.selectionText.trim().slice(0, 60);
    items.push({
      label: `Pesquisar "${text}"`,
      act: () => createWebTab(searchUrl(params.selectionText)),
    });
    items.push({ label: 'Copiar texto', act: () => tab.el.copy() });
    items.push({ sep: true });
  }

  if (params.linkURL) {
    items.push({ label: 'Abrir link em nova aba', act: () => createWebTab(params.linkURL) });
    items.push({ label: 'Abrir link em janela privada', act: () => createWebTab(params.linkURL, { private: true }) });
    items.push({ label: 'Copiar endereço do link', act: () => tab.el.copy() });
    items.push({ sep: true });
  }

  if (params.mediaType === 'image' && params.srcURL) {
    items.push({ label: 'Salvar imagem', act: () => tab.el.downloadURL(params.srcURL) });
    items.push({ label: 'Copiar endereço da imagem', act: () => copyText(params.srcURL) });
    items.push({ sep: true });
  }

  const origin = originOf(tab.url);
  if (origin) {
    const paused = isPaused(tab.url);
    items.push({
      label: paused ? 'Reativar bloqueador neste site' : 'Pausar bloqueador neste site',
      act: () => {
        invoke('adblock:toggle-site', { origin }).then(() => refreshAdblockState());
      },
    });
    items.push({ sep: true });
  }

  items.push({ label: 'Voltar', act: () => tab.el.canGoBack() && tab.el.goBack(), disabled: !tab.el.canGoBack() });
  items.push({ label: 'Avançar', act: () => tab.el.canGoForward() && tab.el.goForward(), disabled: !tab.el.canGoForward() });
  items.push({ label: 'Recarregar', act: () => tab.el.reload() });
  items.push({ label: 'Recarregar ignorando cache', act: () => tab.el.reloadIgnoringCache() });
  items.push({ sep: true });
  items.push({ label: 'Inspecionar', act: () => tab.el.inspectElement(params.x, params.y) });

  menu.innerHTML = items
    .map((item, i) =>
      item.sep
        ? '<div class="menu-sep"></div>'
        : `<button class="menu-item${item.danger ? ' danger-item' : ''}" data-i="${i}"${item.disabled ? ' disabled' : ''}>${escapeHtml(item.label)}</button>`
    )
    .join('');

  $$('button', menu).forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = items[Number(btn.dataset.i)];
      menu.hidden = true;
      if (item && !item.disabled) {
        try {
          item.act();
        } catch (err) {
          console.error(err);
        }
      }
    });
  });

  const rect = $('#viewport').getBoundingClientRect();
  const x = Math.max(6, Math.min(window.innerWidth - menu.offsetWidth - 6, rect.left + params.x));
  const y = Math.max(6, Math.min(window.innerHeight - menu.offsetHeight - 6, rect.top + params.y));
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
  menu.hidden = false;
}

/* ---------------- find bar ---------------- */

function openFind() {
  const tab = activeTab();
  if (!tab || tab.kind !== 'web') return;
  state.findOpen = true;
  $('#findbar').hidden = false;
  $('#find-input').value = '';
  $('#find-input').focus();
  $('#find-input').select();
}

function closeFind() {
  state.findOpen = false;
  $('#findbar').hidden = true;
  const tab = activeTab();
  if (tab && tab.kind === 'web' && tab.wcId) {
    invoke('find:close', { wcId: tab.wcId }).catch(() => {});
  }
}

function runFind(next) {
  const tab = activeTab();
  if (!tab || tab.kind !== 'web') return;
  const text = $('#find-input').value;
  if (!text) return;
  tab.el.findInPage(text, { forward: next !== false, findNext: !!state.findQuery });
  state.findQuery = text;
}
/* ---------------- toast ---------------- */

let toastTimer = null;

function copyText(text) {
  invoke('clipboard:write', { text }).catch(() => {});
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  requestAnimationFrame(() => node.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => {
      node.hidden = true;
    }, 220);
  }, 2200);
}

/* ---------------- adblock state refresh ---------------- */

function refreshAdblockState() {
  invoke('adblock:get').then((ab) => {
    state.settings.globalAdblock = ab.global;
    state.settings.youtubeAds = ab.youtube;
    state.pausedSites = ab.paused;
    render();
    const tab = activeTab();
    if (tab && tab.kind === 'page' && tab.page === 'settings') renderSettings();
  });
}

async function refreshSettings() {
  const data = await invoke('settings:get');
  state.settings = data.settings;
  state.engines = data.engines;
  document.documentElement.dataset.theme = state.settings.theme || 'dark';
  const ab = await invoke('adblock:get');
  state.pausedSites = ab.paused;
  state.settings.globalAdblock = ab.global;
  state.settings.youtubeAds = ab.youtube;
  state.bookmarks = await invoke('bookmarks:list');
  render();
  const tab = activeTab();
  if (tab && tab.kind === 'page') {
    if (tab.page === 'settings') renderSettings();
    if (tab.page === 'bookmarks') renderBookmarks();
  }
}

/* ---------------- downloads ---------------- */

function refreshDownloads() {
  invoke('downloads:list').then((list) => {
    state.downloads = list || [];
    renderDownloads();
    renderDownloadPanel();
  });
}

function renderDownloadPanel() {
  const list = state.downloads || [];
  const host = $('#dl-panel-list');
  if (!list.length) {
    host.innerHTML = `<div class="empty">${icon('download')}<div>Nenhum download.</div></div>`;
    return;
  }
  host.innerHTML = list
    .slice(0, 8)
    .map(
      (d) => `<div class="dl-item" data-id="${escapeHtml(d.id)}">
        <span class="dl-ico">${icon(d.state === 'completed' ? 'check' : 'download')}</span>
        <div class="dl-body">
          <div class="dl-name">${escapeHtml(d.filename)}</div>
          <div class="dl-meta">${d.state === 'completed' ? fmtBytes(d.total) : `${fmtBytes(d.received)} · ${Math.round(d.total ? (d.received / d.total) * 100 : 0)}%`}</div>
          <div class="dl-bar"><i style="width:${d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0}%"></i></div>
        </div>
        <button class="icon-btn small" data-show="${escapeHtml(d.path)}" title="Mostrar na pasta">${icon('external')}</button>
      </div>`
    )
    .join('');

  $$('[data-show]', host).forEach((node) => {
    node.addEventListener('click', () => invoke('downloads:show', { path: node.dataset.show }));
  });
}

function toggleDownloadPanel() {
  const panel = $('#panel-downloads');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) refreshDownloads();
}

/* ---------------- shortcuts ---------------- */

const actions = {
  'tab:new': () => openUrl(HOME),
  'tab:reopen': () => reopenTab(),
  'tab:close': () => state.activeId && closeTab(state.activeId),
  'tab:next': () => cycleTab(1),
  'tab:prev': () => cycleTab(-1),
  'focus-omnibox': () => {
    $('#omnibox-input').focus();
    $('#omnibox-input').select();
  },
  reload: () => activeTab()?.el?.reload(),
  'reload-hard': () => activeTab()?.el?.reloadIgnoringCache(),
  find: () => openFind(),
  'find-next': () => runFind(true),
  bookmark: () => toggleBookmark(),
  'page:history': () => openPage('history'),
  'page:downloads': () => openPage('downloads'),
  'page:settings': () => openPage('settings'),
  'page:bookmarks': () => openPage('bookmarks'),
  'window:private': () => createPrivateTab(),
  'window:new': () => openUrl(HOME),
  'toggle-bookmarks': () =>
    invoke('settings:set', { showBookmarksBar: !state.settings.showBookmarksBar }).then(refreshSettings),
  back: () => activeTab()?.el?.canGoBack() && activeTab().el.goBack(),
  forward: () => activeTab()?.el?.canGoForward() && activeTab().el.goForward(),
  'zoom:in': () => activeTab()?.el?.setZoomLevel(Math.min(5, (activeTab().el.getZoomLevel?.() || 0) + 0.5)),
  'zoom:out': () => activeTab()?.el?.setZoomLevel(Math.max(-6, (activeTab().el.getZoomLevel?.() || 0) - 0.5)),
  'zoom:reset': () => activeTab()?.el?.setZoomLevel(0),
  devtools: () => {
    const tab = activeTab();
    if (!tab || !tab.el) return;
    if (tab.el.isDevToolsOpened()) tab.el.closeDevTools();
    else tab.el.openDevTools();
  },
  'tab:close-others': () => {
    const keep = state.activeId;
    [...state.tabs].forEach((t) => {
      if (t.id !== keep) closeTab(t.id);
    });
  },
  escape: () => {
    closePopovers();
    $('#ctx-menu').hidden = true;
    if (state.findOpen) closeFind();
    else $('#omnibox-input').blur();
  },
};

function cycleTab(delta) {
  const list = state.tabs;
  if (!list.length) return;
  const index = list.findIndex((t) => t.id === state.activeId);
  const next = list[(index + delta + list.length) % list.length];
  if (next) activateTab(next.id);
}

async function toggleBookmark() {
  const tab = activeTab();
  if (!tab || tab.kind !== 'web') return;
  const list = state.bookmarks || [];
  const existing = list.find((b) => b.url === tab.url);
  if (existing) {
    await invoke('bookmarks:remove', { id: existing.id });
    toast('Favorito removido');
  } else {
    await invoke('bookmarks:add', { url: tab.url, title: tab.title });
    toast('Adicionado aos favoritos');
  }
  state.bookmarks = await invoke('bookmarks:list');
  render();
}

/* ---------------- boot ---------------- */

async function loadSettings() {
  const data = await invoke('settings:get');
  state.settings = data.settings;
  state.engines = data.engines;
  document.documentElement.dataset.theme = state.settings.theme || 'dark';
}

function wireUi() {
  $('#new-tab').addEventListener('click', () => openUrl(HOME));
  $('#downloads-btn').addEventListener('click', toggleDownloadPanel);

  $('#nav-back').addEventListener('click', () => actions.back());
  $('#nav-forward').addEventListener('click', () => actions.forward());
  $('#nav-reload').addEventListener('click', () => {
    const tab = activeTab();
    if (!tab) return;
    if (tab.kind === 'page') {
      if (tab.page === 'newtab') refreshNewTab();
      return;
    }
    if (tab.suspended) resumeTab(tab);
    else tab.el.reload();
  });
  $('#nav-home').addEventListener('click', () => openUrl(HOME));

  $('#omnibox-input').addEventListener('focus', (e) => {
    e.target.select();
  });
  $('#omnibox-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = e.target.value;
      if (state.findOpen) closeFind();
      openUrl(value);
      e.target.blur();
      e.target.value = '';
    } else if (e.key === 'Escape') {
      e.target.blur();
      renderToolbar();
    }
  });

  $('#omni-stop').addEventListener('click', () => {
    const tab = activeTab();
    if (tab && tab.wcId) invoke('nav:stop', { wcId: tab.wcId }).catch(() => {});
  });
  $('#star').addEventListener('click', toggleBookmark);
  $('#shield').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleShield();
  });
  $('#menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  $('#ab-global').addEventListener('click', () => {
    invoke('adblock:toggle-global').then(refreshAdblockState);
  });
  const toggleYoutube = () => {
    invoke('adblock:toggle-youtube').then(refreshAdblockState);
  };
  $('#ab-youtube').addEventListener('click', toggleYoutube);
  $('#ab-youtube2').addEventListener('click', toggleYoutube);
  $('#ab-pause-site').addEventListener('click', () => {
    const tab = activeTab();
    if (!tab || tab.kind !== 'web') return;
    const origin = originOf(tab.url);
    if (!origin) return;
    invoke('adblock:toggle-site', { origin }).then(refreshAdblockState);
  });
  $('#ab-update').addEventListener('click', async (e) => {
    const status = $('#ab-status');
    status.textContent = 'baixando listas…';
    const result = await invoke('adblock:update');
    const ok = (result || []).filter((r) => r.ok).length;
    status.textContent = `${ok} lista(s) atualizada(s)`;
    toast(`${ok} lista(s) atualizada(s)`);
  });

  $('#menu-popover').addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const action = item.dataset.action;
    $('#menu-popover').hidden = true;
    if (action === 'about') {
      openPage('about');
      return;
    }
    if (action.startsWith('zoom:')) {
      actions[action]();
      return;
    }
    if (action.startsWith('page:')) {
      openPage(action.split(':')[1]);
      return;
    }
    if (action === 'bookmark') {
      toggleBookmark();
      return;
    }
    if (action === 'find') {
      openFind();
      return;
    }
    if (action === 'window:private') {
      createPrivateTab();
      return;
    }
    if (action === 'tab:new') {
      openUrl(HOME);
      return;
    }
  });

  $('#tabs').addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) {
      e.stopPropagation();
      closeTab(Number(closeBtn.dataset.close));
      return;
    }
    const tab = e.target.closest('.tab');
    if (tab) activateTab(Number(tab.dataset.id));
  });

  $('#tabs').addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const tab = e.target.closest('.tab');
    if (tab) {
      e.preventDefault();
      closeTab(Number(tab.dataset.id));
    }
  });

  $('#tabstrip').addEventListener('dblclick', (e) => {
    if (e.target.closest('.tab') || e.target.closest('button')) return;
    invoke('window:maximize').catch(() => {});
  });

  $('#nt-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('#nt-input').value;
    if (!value.trim()) return;
    openUrl(value);
    $('#nt-input').value = '';
  });

  $('#nt-links').addEventListener('click', (e) => {
    const link = e.target.closest('[data-url]');
    if (link) openUrl(link.dataset.url);
  });

  $('#bookmarkbar').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-url]');
    if (chip) openUrl(chip.dataset.url);
  });

  $('#find-input').addEventListener('input', () => {
    state.findQuery = '';
    runFind(true);
  });
  $('#find-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runFind(!e.shiftKey);
    } else if (e.key === 'Escape') {
      closeFind();
    }
  });
  $('#find-prev').addEventListener('click', () => runFind(false));
  $('#find-next').addEventListener('click', () => runFind(true));
  $('#find-close').addEventListener('click', closeFind);

  $('#history-clear').addEventListener('click', () => {
    invoke('history:clear').then(() => {
      renderHistory();
      toast('Histórico apagado');
    });
  });

  const historySearch = $('#history-search');
  if (historySearch) {
    historySearch.addEventListener('input', () => {
      historyQuery = historySearch.value.trim();
      renderHistory();
    });
  }

  $('#dl-panel-clear').addEventListener('click', () => {
    invoke('downloads:clear').then(() => {
      state.downloads = [];
      renderDownloadPanel();
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#shield-popover') && !e.target.closest('#shield') && !e.target.closest('#menu-popover') && !e.target.closest('#menu-btn')) {
      closePopovers();
    }
    if (!e.target.closest('#ctx-menu')) $('#ctx-menu').hidden = true;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePopovers();
      $('#ctx-menu').hidden = true;
      if (state.findOpen) closeFind();
    }
  });

  window.addEventListener('pagehide', saveSession);
  window.addEventListener('beforeunload', saveSession);

  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
      document.body.classList.add('dragging');
    }
  });
  document.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
  document.addEventListener('drop', (e) => {
    document.body.classList.remove('dragging');
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      e.preventDefault();
      const filePath = window.lumen.pathForFile(file);
      if (filePath) createWebTab(`file:///${filePath.replace(/\\/g, '/')}`);
    }
  });
}

function wireMainEvents() {
  on('lumen:stats', ({ wcId, blocked }) => {
    const tab = state.tabs.find((t) => t.wcId === wcId);
    if (!tab) return;
    if (tab.blocked === blocked) return;
    tab.blocked = blocked;
    updateTabChrome(tab);
    renderShield();
  });

  on('lumen:shortcut', ({ name }) => {
    const fn = actions[name];
    if (fn) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  });

  on('lumen:settings', (settings) => {
    state.settings = Object.assign({}, state.settings, settings);
    if (settings.globalAdblock != null) state.settings.globalAdblock = settings.globalAdblock;
    render();
  });

  on('lumen:download', ({ type, item }) => {
    const idx = state.downloads.findIndex((d) => d.id === item.id);
    if (idx >= 0) state.downloads[idx] = { ...state.downloads[idx], ...item };
    else state.downloads.unshift({ ...item });
    if (state.downloads.length > 100) state.downloads.length = 100;
    renderDownloads();
    renderDownloadPanel();
    if (type === 'created') toast(`Baixando ${item.filename}`);
    if (type === 'updated' && item.state === 'completed') toast(`Download concluído: ${item.filename}`);
  });

  on('lumen:popup', ({ url }) => {
    if (!url) return;
    createWebTab(url);
  });

  on('lumen:wc-gone', ({ wcId }) => {
    const tab = state.tabs.find((t) => t.wcId === wcId && t.kind === 'web');
    if (tab) closeTab(tab.id);
  });
}

function saveSession() {
  const web = webTabs();
  if (!web.length) return;
  const tabs = web
    .filter((t) => !t.isPrivate)
    .map((t) => ({
      url:
        t.pendingUrl ||
        (t.suspended ? t.url : t.el && t.el.getURL ? t.el.getURL() || t.url : t.url),
    }))
    .filter((t) => t.url && t.url !== 'about:blank');
  const activeIndex = Math.max(
    0,
    web.filter((t) => !t.isPrivate).findIndex((t) => t.id === state.activeId)
  );
  invoke('session:save', { tabs, active: activeIndex }).catch(() => {});
}

async function restoreSession() {
  if (!state.settings.restoreTabs) {
    openPage('newtab');
    return;
  }
  const saved = await invoke('session:load').catch(() => null);
  const list = (saved && Array.isArray(saved.tabs) ? saved.tabs : []).filter(
    (t) => t && t.url && t.url !== 'about:blank'
  );
  if (!list.length) {
    openPage('newtab');
    return;
  }
  list.slice(0, 20).forEach((t) => createWebTab(t.url, { background: true, deferred: true }));
  const web = webTabs();
  const index = Math.min(Math.max(0, Number(saved.active) || 0), web.length - 1);
  if (web[index]) activateTab(web[index].id);
}

async function init() {
  await loadSettings();
  hydrateIcons();
  wireUi();
  wireMainEvents();

  const ab = await invoke('adblock:get');
  state.pausedSites = ab.paused;
  state.bookmarks = await invoke('bookmarks:list');
  state.downloads = await invoke('downloads:list');

  await restoreSession();

  setInterval(() => {
    if (document.querySelector('#page-newtab.active')) refreshNewTab();
  }, 20_000);

  setInterval(() => {
    const now = new Date();
    const t = $('#nt-time');
    if (t) t.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }, 1000);

  render();
}

init().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:24px;color:#f87171">Falha ao iniciar a interface: ${escapeHtml(err.message)}</pre>`;
});