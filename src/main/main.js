'use strict';

const electron = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { app } = electron;

// Windows occlusion tracking can keep a restored window marked as occluded,
// which stops the <webview> guests from painting (blank page area) until the
// user interacts with it. Disabling it keeps painting deterministic.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

// Must run before any module resolves paths under userData.
app.setName('Lumen');
if (process.platform === 'win32') app.setAppUserModelId('lumen.browser');
app.setPath('userData', path.join(app.getPath('appData'), 'Lumen'));

const { BrowserWindow, session, ipcMain, shell, clipboard, dialog, nativeTheme, webContents } = electron;
const store = require('./store');
const adblock = require('./adblock');

const EXTERNAL = new Set(['http:', 'https:', 'mailto:']);
const DOWNLOAD_FILE = 'downloads.json';

let win = null;
const downloads = [];

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function broadcast(channel, payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function settingsSnapshot() {
  return {
    settings: store.settings.all(),
    engines: store.SEARCH_ENGINES,
  };
}

/* ------------------------------------------------------------------ */
/* downloads                                                          */
/* ------------------------------------------------------------------ */

function downloadPath() {
  return path.join(app.getPath('userData'), 'data', DOWNLOAD_FILE);
}

function loadDownloads() {
  try {
    const parsed = JSON.parse(fs.readFileSync(downloadPath(), 'utf8'));
    if (Array.isArray(parsed)) downloads.push(...parsed.slice(0, 100));
  } catch {
    /* ignore */
  }
}

function saveDownloads() {
  try {
    const file = downloadPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(downloads.slice(0, 100)));
  } catch {
    /* ignore */
  }
}

function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    i += 1;
  }
  return candidate;
}

function wireDownloads(sess) {
  sess.on('will-download', (_e, item) => {
    try {
      item.savePath = uniquePath(app.getPath('downloads'), item.getFilename());
    } catch {
      /* ignore */
    }
    const entry = {
      id: `d_${Date.now().toString(36)}`,
      filename: item.getFilename(),
      path: item.savePath,
      url: item.getURL(),
      received: 0,
      total: item.getTotalBytes(),
      state: 'progressing',
      startTime: Date.now(),
    };
    downloads.unshift(entry);
    if (downloads.length > 100) downloads.length = 100;
    broadcast('lumen:download', { type: 'created', item: { ...entry } });

    item.on('updated', () => {
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes();
      entry.state = 'progressing';
      broadcast('lumen:download', { type: 'updated', item: { ...entry } });
    });

    item.on('done', (_ev, state) => {
      entry.state = state === 'completed' ? 'completed' : 'cancelled';
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes();
      saveDownloads();
      broadcast('lumen:download', { type: 'updated', item: { ...entry } });
    });
  });
}

/* ------------------------------------------------------------------ */
/* guest web contents wiring                                          */
/* ------------------------------------------------------------------ */

const ytubeScript = `(() => {
  if (window.__lumenYT) return;
  window.__lumenYT = true;
  const SKIP = '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button, button.ytp-ad-skip-button-modern';
  const JUNK = '.ytp-ad-module, .ytp-ad-overlay-slot, .ytp-ad-overlay-container, .ytp-ad-image-overlay, .ytp-featured-product, .ytp-suggested-action, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer, ytd-in-feed-ad-layout-renderer, ytd-banner-promo-renderer, ytd-statement-banner-renderer, #player-ads, #masthead-ad, ytd-rich-section-renderer:has(ytd-statement-banner-renderer), ytd-reel-shelf-renderer, .ytp-ad-player-overlay-layout';
  const clickSkip = () => {
    const btns = document.querySelectorAll(SKIP);
    for (const b of btns) { try { b.click(); } catch (e) {} }
  };
  const clean = () => {
    const junk = document.querySelectorAll(JUNK);
    for (const el of junk) { try { el.remove(); } catch (e) {} }
    clickSkip();
  };
  const timer = setInterval(clean, 900);
  const fast = setInterval(clickSkip, 250);
  try {
    new MutationObserver(() => clean()).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'ad-showing'] });
  } catch (e) {}
  window.addEventListener('yt-navigate-finish', clean);
  window.addEventListener('load', clean);
  window.addEventListener('pagehide', () => { clearInterval(timer); clearInterval(fast); });
})();`;

const attached = new WeakSet();

function attachGuest(wc) {
  if (!wc || attached.has(wc)) return;
  attached.add(wc);
  wireShortcuts(wc);

  wc.on('did-start-navigation', (_e, details) => {
    if (details && details.frameId === 0) adblock.resetStats(wc.id);
  });

  wc.on('did-finish-load', () => {
    const url = wc.getURL();
    if (!/^https?:/i.test(url)) return;
    store.history.add(url, wc.getTitle());
    if (store.settings.get('youtubeAds') && /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(originOf(url))) {
      wc.executeJavaScript(ytubeScript, true).catch(() => {});
    }
  });

  wc.setWindowOpenHandler(({ url }) => {
    broadcast('lumen:popup', { wcId: wc.id, url });
    return { action: 'deny' };
  });

  wc.on('will-navigate', (e, url) => {
    const proto = (() => {
      try {
        return new URL(url).protocol;
      } catch {
        return '';
      }
    })();
    if (!EXTERNAL.has(proto) && !/^(about|devtools):$/i.test(proto)) {
      shell.openExternal(url);
      e.preventDefault();
    }
  });

  wc.on('destroyed', () => {
    broadcast('lumen:wc-gone', { wcId: wc.id });
  });
}

/* ------------------------------------------------------------------ */
/* ipc                                                                */
/* ------------------------------------------------------------------ */

const actions = {
  'settings:get': () => settingsSnapshot(),

  'settings:set': (patch = {}) => {
    const allowed = [
      'theme',
      'accent',
      'searchEngine',
      'homepage',
      'showBookmarksBar',
      'memorySaver',
      'maxLiveTabs',
      'restoreTabs',
      'globalAdblock',
      'youtubeAds',
    ];
    const clean = {};
    for (const key of allowed) if (key in patch) clean[key] = patch[key];
    store.settings.set(clean);
    if ('globalAdblock' in clean) adblock.setGlobal(!!clean.globalAdblock);
    if ('youtubeAds' in clean) {
      adblock.setYoutube(!!clean.youtubeAds);
    }
    if ('theme' in clean) applyTheme();
    broadcast('lumen:settings', store.settings.all());
    return store.settings.all();
  },

  'adblock:get': () => ({
    global: adblock.isGlobalOn(),
    youtube: adblock.isYoutubeOn(),
    paused: adblock.getPaused(),
    ready: adblock.isBlocking(),
  }),

  'adblock:toggle-global': () => {
    const next = !store.settings.get('globalAdblock');
    store.settings.set({ globalAdblock: next });
    adblock.setGlobal(next);
    broadcast('lumen:settings', store.settings.all());
    return { global: next };
  },

  'adblock:toggle-youtube': () => {
    const next = !store.settings.get('youtubeAds');
    store.settings.set({ youtubeAds: next });
    adblock.setYoutube(next);
    broadcast('lumen:settings', store.settings.all());
    return { youtube: next };
  },

  'adblock:toggle-site': (p = {}) => {
    if (!p.origin) return null;
    const paused = adblock.toggleSite(p.origin);
    store.settings.set({ pausedSites: paused });
    return { paused: paused.includes(p.origin), pausedSites: paused };
  },

  'adblock:unpause-all': () => {
    adblock.setPaused([]);
    store.settings.set({ pausedSites: [] });
    return true;
  },

  'adblock:update': async () => adblock.updateLists(),

  'bookmarks:list': () => store.bookmarks.all(),
  'bookmarks:add': (p = {}) => store.bookmarks.add(p.url, p.title),
  'bookmarks:remove': (p = {}) => {
    if (p.url) store.bookmarks.removeByUrl(p.url);
    else if (p.id) store.bookmarks.remove(p.id);
    return true;
  },

  'history:list': () => store.history.all(),
  'history:remove': (p = {}) => {
    store.history.remove(p.id);
    return true;
  },
  'history:clear': () => {
    store.history.clear();
    return true;
  },
  'history:top-sites': () => store.history.topSites(12),

  'downloads:list': () => downloads.slice(0, 100),
  'downloads:show': (p = {}) => {
    if (p.path && fs.existsSync(p.path)) shell.showItemInFolder(p.path);
    return true;
  },
  'downloads:clear': () => {
    downloads.length = 0;
    saveDownloads();
    return true;
  },

  'tab:ready': (p = {}) => {
    const wc = webContents.fromId(p.wcId);
    if (wc) attachGuest(wc);
    return true;
  },

  'external:open': (p = {}) => {
    if (p.url && /^https?:/i.test(p.url)) shell.openExternal(p.url);
    return true;
  },

  'clipboard:read': () => clipboard.readText(),
  'clipboard:write': (p = {}) => {
    clipboard.writeText(String(p.text == null ? '' : p.text));
    return true;
  },

  'nav:stop': (p = {}) => {
    const wc = p.wcId ? webContents.fromId(p.wcId) : null;
    if (wc && !wc.isDestroyed()) wc.stop();
    return true;
  },

  'find:close': (p = {}) => {
    const wc = p.wcId ? webContents.fromId(p.wcId) : null;
    if (wc && !wc.isDestroyed()) wc.stopFindInPage('clearSelection');
    return true;
  },

  'window:minimize': () => (win ? win.minimize() : false),
  'window:maximize': () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return true;
  },
  'window:close': () => (win ? win.close() : false),
  'window:is-maximized': () => (win ? win.isMaximized() : false),

  'session:save': (p = {}) => {
    try {
      const file = path.join(app.getPath('userData'), 'data', 'session.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({
          tabs: (p.tabs || []).slice(0, 40),
          active: Number(p.active) || 0,
          at: Date.now(),
        })
      );
    } catch {
      /* ignore */
    }
    return true;
  },

  'session:load': () => {
    try {
      const file = path.join(app.getPath('userData'), 'data', 'session.json');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  },

  'app:info': () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
  }),
};

ipcMain.handle('lumen:invoke', async (event, channel, payload) => {
  if (event.sender !== win?.webContents) return { error: 'untrusted sender' };
  const handler = actions[channel];
  if (!handler) return { error: `unknown channel: ${channel}` };
  try {
    return await handler(payload);
  } catch (err) {
    console.error(`[ipc] ${channel}:`, err);
    return { error: err.message };
  }
});

adblock.onStats(({ wcId, blocked }) => {
  broadcast('lumen:stats', { wcId, blocked });
});

/* ------------------------------------------------------------------ */
/* window                                                             */
/* ------------------------------------------------------------------ */

function applyTheme() {
  const theme = store.settings.get('theme');
  nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark';
  if (win && !win.isDestroyed()) {
    const light = theme === 'light';
    try {
      win.setTitleBarOverlay({
        color: light ? '#f6f8fc' : '#0e1117',
        symbolColor: light ? '#1b1f2a' : '#e8ecf4',
        height: 38,
      });
    } catch {
      /* not supported on this platform */
    }
  }
}

const SHORTCUTS = {
  'Control+T': 'tab:new',
  'Control+Shift+T': 'tab:reopen',
  'Control+W': 'tab:close',
  'Control+Tab': 'tab:next',
  'Control+Shift+Tab': 'tab:prev',
  'Control+L': 'focus-omnibox',
  'Control+R': 'reload',
  'F5': 'reload',
  'Control+Shift+R': 'reload-hard',
  'Control+F': 'find',
  'F3': 'find-next',
  'Control+D': 'bookmark',
  'Control+Shift+D': 'bookmark-all',
  'Control+H': 'page:history',
  'Control+J': 'page:downloads',
  'Control+Shift+N': 'window:private',
  'Control+Shift+B': 'toggle-bookmarks',
  'Control+N': 'window:new',
  'Alt+Left': 'back',
  'Alt+Right': 'forward',
  'Control+0': 'zoom:reset',
  'Control+Plus': 'zoom:in',
  'Control+Minus': 'zoom:out',
  'Escape': 'escape',
  'Control+Shift+Delete': 'page:history',
  'Control+,': 'page:settings',
  'F1': 'page:settings',
  'F12': 'devtools',
};

function shortcutName(input) {
  if (input.type !== 'keyDown') return null;
  const key = input.key;
  if (input.control && (key === '+' || key === '=')) return 'zoom:in';
  if (input.control && key === '-') return 'zoom:out';
  const normalized = key.length === 1 ? key.toUpperCase() : key;
  const parts = [];
  if (input.control) parts.push('Control');
  if (input.alt) parts.push('Alt');
  if (input.shift) parts.push('Shift');
  if (input.meta) parts.push('Meta');
  parts.push(normalized);
  return parts.join('+');
}

const shortcutWired = new WeakSet();

function wireShortcuts(target) {
  if (!target || shortcutWired.has(target)) return;
  shortcutWired.add(target);
  target.on('before-input-event', (event, input) => {
    if (SHORTCUTS[shortcutName(input)]) {
      event.preventDefault();
      broadcast('lumen:shortcut', { name: SHORTCUTS[shortcutName(input)] });
    }
  });
}

function createWindow() {
  const backgroundColor = store.settings.get('theme') === 'light' ? '#f4f6fb' : '#0d0f14';

  win = new BrowserWindow({
    width: 1024,
    height: 700,
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: backgroundColor,
      symbolColor: store.settings.get('theme') === 'light' ? '#1b1f2a' : '#e8ecf4',
      height: 38,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload-shell.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      v8CacheOptions: 'code',
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'shell.html'));
  win.once('ready-to-show', () => win.show());

  // After the window is restored from a minimized state Electron can stop
  // compositing the <webview> guests: the page area stays blank even though
  // the guest keeps rendering. Invalidate the window and every guest, then
  // nudge the window bounds by 1px to force a fresh compositing pass.
  const repaintGuests = () => {
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.invalidate();
    } catch (_) {
      /* window closing */
    }
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.hostWebContents || wc.isDestroyed()) continue;
      try {
        wc.invalidate();
      } catch (_) {
        /* guest gone */
      }
    }
    const [width, height] = win.getSize();
    win.setBounds({ width: width + 1, height });
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [w2, h2] = win.getSize();
      win.setBounds({ width: w2 - 1, height: h2 });
    }, 60);
  };
  win.on('restore', () => setTimeout(repaintGuests, 80));
  win.on('show', () => setTimeout(repaintGuests, 80));

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  wireShortcuts(win.webContents);

  win.on('closed', () => {
    win = null;
  });

  applyTheme();
  wireDownloads(session.defaultSession);
  try {
    const priv = session.fromPartition('lumen-private');
    wireDownloads(priv);
  } catch (err) {
    console.warn('[win] private partition:', err.message);
  }

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const allowed = new Set([
      'fullscreen',
      'clipboard-sanitized-write',
      'clipboard-read',
      'notifications',
      'pointerLock',
      'accelerated-2d-canvas',
      'window-management',
      'unknown',
      'media',
    ]);
    const secure = (details.requestingUrl || '').startsWith('https://');
    callback(allowed.has(permission) && (secure || permission === 'fullscreen'));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => {
    if (permission === 'fullscreen' || permission === 'notifications') return true;
    return (details.requestingUrl || '').startsWith('https://');
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.commandLine.appendSwitch(
    'disable-features',
    [
      'Translate',
      'MediaRouter',
      'OptimizationHints',
      'InterestFeedContentSuggestions',
      'CalculateNativeWinOcclusion',
      'HardwareMediaKeyHandling',
    ].join(',')
  );
  app.commandLine.appendSwitch('disable-hang-monitor');
  // Keep Chromium's background services (component updates, sync, safe browsing
  // pings, metrics, crash uploads) out of the process list: they cost RAM and
  // network for a browser that does not use them.
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-default-apps');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('disable-sync');
  app.commandLine.appendSwitch('metrics-recording-only');
  app.commandLine.appendSwitch('no-default-browser-check');
  app.commandLine.appendSwitch('no-first-run');
  app.commandLine.appendSwitch('disable-breakpad');
  app.commandLine.appendSwitch('disable-client-side-phishing-detection');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

  const boot = async () => {
    loadDownloads();
    await adblock.init({
      globalAdblock: store.settings.get('globalAdblock'),
      youtubeAds: store.settings.get('youtubeAds'),
      pausedSites: store.settings.get('pausedSites') || [],
    });
    createWindow();

    app.on('web-contents-created', (_e, wc) => {
      const type = wc.getType();
      if (type === 'webview' || type === 'browserView') wireShortcuts(wc);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  };

  app.whenReady().then(boot).catch((err) => {
    console.error('[boot] failed', err);
    dialog.showErrorBox('Lumen', `Falha ao iniciar: ${err.message}`);
    app.quit();
  });
}