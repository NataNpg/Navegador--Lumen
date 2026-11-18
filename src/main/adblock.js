'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, session } = require('electron');
const { ElectronBlocker, fromElectronDetails } = require('@ghostery/adblocker-electron');
const { FiltersEngine } = require('@ghostery/adblocker');

const FILTER_DIR = path.join(app.getAppPath(), 'assets', 'filters');

function resolvePreloadScript() {
  try {
    return require.resolve('@ghostery/adblocker-electron-preload');
  } catch {
    /* fall through */
  }
  try {
    const dir = path.dirname(require.resolve('@ghostery/adblocker-electron'));
    return require(path.join(dir, 'preload_path.js')).PRELOAD_PATH;
  } catch {
    return '';
  }
}

const PRELOAD_FILE = resolvePreloadScript();

const ENGINE_CONFIG = {
  loadNetworkFilters: true,
  loadCosmeticFilters: true,
  loadCSPFilters: true,
  loadGenericCosmeticsFilters: true,
  enableMutationObserver: false,
  guessRequestTypeFromUrl: true,
  enableHtmlFiltering: false,
};

const CORE_FILES = [
  'easylist.txt',
  'easyprivacy.txt',
  'ublock-filters.txt',
  'ublock-quick-fixes.txt',
  'ublock-unbreak.txt',
  'ublock-badware.txt',
  'lumen-youtube.txt',
];

const REMOTE_UPDATES = [
  ['easylist.txt', 'https://easylist.to/easylist/easylist.txt'],
  ['easyprivacy.txt', 'https://easylist.to/easylist/easyprivacy.txt'],
  ['ublock-filters.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt'],
  ['ublock-quick-fixes.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt'],
  ['ublock-unbreak.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt'],
  ['ublock-badware.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt'],
];

let blocker = null;
let youtubeEngine = null;
let globalOn = true;
let youtubeOn = true;
let pausedSites = new Set();
let urlLookup = () => '';
let loaded = false;

const stats = new Map();
const listeners = new Set();
const flushTimers = new Map();

function emitStats(wcId) {
  const s = stats.get(wcId) || { blocked: 0 };
  for (const fn of listeners) {
    try {
      fn({ wcId, blocked: s.blocked });
    } catch {
      /* ignore */
    }
  }
}

function bump(wcId) {
  if (!wcId) return;
  const s = stats.get(wcId) || { blocked: 0 };
  s.blocked += 1;
  stats.set(wcId, s);
  if (!flushTimers.has(wcId)) {
    const t = setTimeout(() => {
      flushTimers.delete(wcId);
      emitStats(wcId);
    }, 350);
    flushTimers.set(wcId, t);
  }
}

function resetStats(wcId) {
  stats.set(wcId, { blocked: 0 });
  emitStats(wcId);
}

function cacheKey() {
  try {
    let total = 0;
    for (const f of CORE_FILES) {
      const st = fs.statSync(path.join(FILTER_DIR, f));
      total = (total * 31 + st.size + Math.round(st.mtimeMs)) % 2147483647;
    }
    return `${total.toString(36)}-v3`;
  } catch {
    return null;
  }
}

function cacheFile(key) {
  return path.join(app.getPath('userData'), 'cache', `engine-${key}.bin`);
}

function readBundledFilters() {
  const chunks = [];
  for (const file of CORE_FILES) {
    try {
      chunks.push(fs.readFileSync(path.join(FILTER_DIR, file), 'utf8'));
    } catch (err) {
      console.warn('[adblock] missing filter list', file);
    }
  }
  return chunks.join('\n');
}

function buildBlocker() {
  const key = cacheKey();
  if (key) {
    const file = cacheFile(key);
    try {
      const buf = fs.readFileSync(file);
      if (buf.length > 1024) {
        const engine = ElectronBlocker.deserialize(new Uint8Array(buf));
        engine.config.enableMutationObserver = false;
        return engine;
      }
    } catch {
      /* fall through to parse */
    }
  }

  const started = Date.now();
  const text = readBundledFilters();
  const engine = ElectronBlocker.parse(text, ENGINE_CONFIG);
  console.log(`[adblock] parsed filters in ${Date.now() - started} ms`);

  if (key) {
    try {
      const out = cacheFile(key);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(engine.serialize()));
    } catch (err) {
      console.warn('[adblock] could not cache engine:', err.message);
    }
  }
  return engine;
}

function buildYoutubeEngine() {
  try {
    const text = fs.readFileSync(path.join(FILTER_DIR, 'lumen-youtube.txt'), 'utf8');
    return FiltersEngine.parse(text, { loadNetworkFilters: true, loadCosmeticFilters: false });
  } catch (err) {
    console.warn('[adblock] youtube engine unavailable:', err.message);
    return null;
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function isPaused(pageUrl) {
  const origin = originOf(pageUrl);
  return !!origin && pausedSites.has(origin);
}

function handleRequest(details, callback) {
  const wcId = details.webContentsId;
  const pageUrl = urlLookup(wcId) || details.referrer || '';
  if (!globalOn || isPaused(pageUrl) || details.resourceType === 'mainFrame') {
    callback({});
    return;
  }

  try {
    const req = fromElectronDetails(details);
    const { match, redirect } = blocker.match(req);
    if (redirect) {
      callback({ redirectURL: redirect.dataUrl });
      return;
    }
    if (match) {
      bump(wcId);
      callback({ cancel: true });
      return;
    }

    if (youtubeOn && youtubeEngine) {
      const host = new URL(details.url).hostname;
      if (host.endsWith('youtube.com') || host === 'youtu.be' || host.endsWith('googlevideo.com')) {
        const hit = youtubeEngine.match(req);
        if (hit.match) {
          bump(wcId);
          callback({ cancel: true });
          return;
        }
      }
    }
    callback({});
  } catch (err) {
    console.warn('[adblock] request error', err.message);
    callback({});
  }
}

const attachedSessions = new Set();
const preloadIds = new Map();

function attach(sess) {
  if (attachedSessions.has(sess)) return;
  const isDefault = sess === session.defaultSession;

  if (isDefault) {
    // The library registers the cosmetic-filter preload + IPC handlers and its
    // own network listeners for this session.
    blocker.enableBlockingInSession(sess);
    // Take over onBeforeRequest so per-site pauses and per-tab counters apply.
    sess.webRequest.onBeforeRequest(null);
    sess.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, handleRequest);
  } else {
    // IPC handlers are process-wide (already registered above), so only the
    // per-session preload script and the network listener are needed here.
    try {
      const id = sess.registerPreloadScript({ type: 'frame', filePath: PRELOAD_FILE });
      preloadIds.set(sess, id);
    } catch (err) {
      console.warn('[adblock] preload registration skipped:', err.message);
    }
    sess.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, handleRequest);
  }
  attachedSessions.add(sess);
}

function detach(sess) {
  if (!attachedSessions.has(sess)) return;
  attachedSessions.delete(sess);
  try {
    sess.webRequest.onBeforeRequest(null);
  } catch {
    /* ignore */
  }
  if (sess === session.defaultSession) {
    try {
      blocker.disableBlockingInSession(sess);
    } catch (err) {
      console.warn('[adblock] detach warning:', err.message);
    }
  } else {
    const id = preloadIds.get(sess);
    if (id != null) {
      try {
        sess.unregisterPreloadScript(id);
      } catch {
        /* ignore */
      }
      preloadIds.delete(sess);
    }
  }
}

function eachSession(fn) {
  fn(session.defaultSession);
  try {
    fn(session.fromPartition('lumen-private'));
  } catch {
    /* ignore */
  }
}

async function init(initial) {
  blocker = buildBlocker();
  youtubeEngine = buildYoutubeEngine();
  globalOn = initial.globalAdblock !== false;
  youtubeOn = initial.youtubeAds !== false;
  pausedSites = new Set(initial.pausedSites || []);

  eachSession(attach);
  loaded = true;
}

function setGlobal(on) {
  globalOn = !!on;
  if (!loaded) return;
  if (globalOn) eachSession(attach);
  else eachSession(detach);
}

function setYoutube(on) {
  youtubeOn = !!on;
}

function setPaused(sites) {
  pausedSites = new Set(sites || []);
}

function toggleSite(origin) {
  if (pausedSites.has(origin)) {
    pausedSites.delete(origin);
  } else {
    pausedSites.add(origin);
  }
  return [...pausedSites];
}

async function updateLists() {
  const results = [];
  await Promise.all(
    REMOTE_UPDATES.map(async ([name, url]) => {
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 Lumen/0.1' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        fs.writeFileSync(path.join(FILTER_DIR, name), text, 'utf8');
        results.push({ name, ok: true, bytes: text.length });
      } catch (err) {
        results.push({ name, ok: false, error: err.message });
      }
    })
  );
  const next = buildBlocker();
  if (loaded) eachSession(detach);
  blocker = next;
  youtubeEngine = buildYoutubeEngine();
  if (globalOn && loaded) eachSession(attach);
  return results;
}

module.exports = {
  init,
  setGlobal,
  setYoutube,
  setPaused,
  toggleSite,
  updateLists,
  resetStats,
  onStats(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setUrlLookup(fn) {
    urlLookup = fn || (() => '');
  },
  isGlobalOn: () => globalOn,
  isYoutubeOn: () => youtubeOn,
  getPaused: () => [...pausedSites],
  isBlocking: () => loaded,
};