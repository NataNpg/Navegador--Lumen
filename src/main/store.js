'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const HISTORY_LIMIT = 5000;

const DEFAULTS = {
  globalAdblock: true,
  youtubeAds: true,
  pausedSites: [],
  theme: 'dark',
  accent: 'violet',
  searchEngine: 'google',
  homepage: 'lumen://newtab',
  showBookmarksBar: false,
  memorySaver: true,
  maxLiveTabs: 6,
  restoreTabs: true,
  openExternal: true,
};

const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s' },
};

function filePath(name) {
  return path.join(app.getPath('userData'), 'data', name);
}

function readJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

const pending = new Map();
let timer = null;

function flush() {
  timer = null;
  try {
    fs.mkdirSync(path.dirname(filePath('x')), { recursive: true });
  } catch {
    /* ignore */
  }
  for (const [name, data] of pending) {
    try {
      fs.writeFileSync(filePath(name + '.tmp'), JSON.stringify(data));
      fs.renameSync(filePath(name + '.tmp'), filePath(name));
    } catch (err) {
      console.error('[store] write failed:', name, err.message);
    }
  }
  pending.clear();
}

function writeJSON(name, data) {
  pending.set(name, data);
  if (!timer) timer = setTimeout(flush, 400);
}

const listeners = new Map();

function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try {
      fn(payload);
    } catch (err) {
      console.error('[store] listener error:', err.message);
    }
  }
}

const settings = Object.assign({}, DEFAULTS, readJSON('settings.json', {}));
const bookmarks = readJSON('bookmarks.json', []);
const history = readJSON('history.json', []);

const store = {
  SEARCH_ENGINES,

  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(fn);
    return () => {
      const arr = listeners.get(event) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  },

  settings: {
    get(key) {
      return settings[key];
    },
    all() {
      return Object.assign({}, settings);
    },
    set(patch) {
      let changed = false;
      for (const [k, v] of Object.entries(patch || {})) {
        if (k in DEFAULTS && settings[k] !== v) {
          settings[k] = v;
          changed = true;
        }
      }
      if (changed) {
        writeJSON('settings.json', settings);
        emit('settings', store.settings.all());
      }
      return store.settings.all();
    },
    searchUrlFor(query) {
      const engine = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google;
      return engine.url.replace('%s', encodeURIComponent(query));
    },
    searchName() {
      return (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google).name;
    },
  },

  bookmarks: {
    all() {
      return bookmarks.slice();
    },
    add(url, title) {
      if (!url) return null;
      const existing = bookmarks.find((b) => b.url === url);
      if (existing) return existing;
      const entry = {
        id: `bm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        url,
        title: title || url,
        dateAdded: Date.now(),
      };
      bookmarks.unshift(entry);
      writeJSON('bookmarks.json', bookmarks);
      emit('bookmarks', bookmarks.slice());
      return entry;
    },
    remove(id) {
      const i = bookmarks.findIndex((b) => b.id === id);
      if (i >= 0) bookmarks.splice(i, 1);
      writeJSON('bookmarks.json', bookmarks);
      emit('bookmarks', bookmarks.slice());
    },
    removeByUrl(url) {
      for (let i = bookmarks.length - 1; i >= 0; i--) {
        if (bookmarks[i].url === url) bookmarks.splice(i, 1);
      }
      writeJSON('bookmarks.json', bookmarks);
      emit('bookmarks', bookmarks.slice());
    },
    has(url) {
      return bookmarks.some((b) => b.url === url);
    },
  },

  history: {
    all() {
      return history.slice();
    },
    add(url, title) {
      if (!url || /^(lumen|about|chrome|edge):/.test(url)) return;
      if (!/^https?:/i.test(url)) return;
      const now = Date.now();
      const top = history[0];
      if (top && top.url === url && now - top.ts < 60_000) {
        top.ts = now;
        if (title) top.title = title;
        writeJSON('history.json', history);
        return;
      }
      history.unshift({ id: `h_${now.toString(36)}`, url, title: title || url, ts: now });
      if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
      writeJSON('history.json', history);
    },
    remove(id) {
      const i = history.findIndex((h) => h.id === id);
      if (i >= 0) history.splice(i, 1);
      writeJSON('history.json', history);
      emit('history', history.slice());
    },
    clear() {
      history.length = 0;
      writeJSON('history.json', history);
      emit('history', history.slice());
    },
    topSites(n = 12) {
      const counts = new Map();
      const recent = history.slice(0, 400);
      for (const h of recent) {
        try {
          const host = new URL(h.url).hostname.replace(/^www\./, '');
          counts.set(host, (counts.get(host) || 0) + 1);
        } catch {
          /* ignore */
        }
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([host]) => {
          const first = recent.find((h) => h.url.includes(host));
          return { url: first ? first.url : `https://${host}`, title: host };
        });
    },
  },

  flush,
};

app.on('before-quit', flush);
process.on('exit', flush);

module.exports = store;