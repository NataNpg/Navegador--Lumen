'use strict';

// Headless-ish UI smoke test: talks to Electron over the Chrome DevTools
// Protocol, reloads the shell window, collects console errors and evaluates a
// probe in the page. Usage: node scripts/cdp-check.js [port]

const PORT = process.argv[2] || '9222';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 20000);
    });
  }
}

(async () => {
  let list = [];
  for (let i = 0; i < 30; i++) {
    try {
      list = await targets();
      if (list.length) break;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }

  const shell = list.find((t) => t.type === 'page' && /shell\.html/.test(t.url));
  if (!shell) {
    console.log('FAIL: shell.html target not found');
    console.log(list.map((t) => `${t.type} ${t.url}`).join('\n'));
    process.exit(1);
  }

  const ws = new WebSocket(shell.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  const cdp = new Cdp(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');

  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(6000);

  const probe = `(() => {
    const q = (s) => document.querySelector(s);
    const box = (s) => { const n = q(s); if (!n) return null; const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
    return {
      title: document.title,
      theme: document.documentElement.dataset.theme,
      tabs: document.querySelectorAll('#tabs .tab').length,
      tabTitles: [...document.querySelectorAll('#tabs .tab-title')].map(n => n.textContent),
      webviews: document.querySelectorAll('#webviews webview').length,
      newtabVisible: !!q('#page-newtab.active'),
      omnibox: q('#omnibox-input') ? q('#omnibox-input').value : null,
      shieldArmed: q('#shield').className,
      hasClock: !!q('#nt-time') && q('#nt-time').textContent,
      links: document.querySelectorAll('#nt-links .nt-link').length,
      bodySize: [document.body.scrollWidth, document.body.scrollHeight],
      layout: {
        tabstrip: box('#tabstrip'),
        toolbar: box('#toolbar'),
        omnibox: box('#omnibox'),
        shield: box('#shield'),
        viewport: box('#viewport'),
        activeTab: box('.tab.active'),
        activeWebview: box('#webviews webview.active'),
      },
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  })()`;

  const result = await cdp.send('Runtime.evaluate', {
    expression: probe,
    returnByValue: true,
  });

  const errors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry.text)
    .concat(
      cdp.events
        .filter((e) => e.method === 'Runtime.exceptionThrown')
        .map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)
    )
    .concat(
      cdp.events
        .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
        .map((e) => e.params.args.map((a) => a.value ?? a.description).join(' '))
    );

  console.log('PROBE', JSON.stringify(result.result?.value ?? result, null, 2));
  console.log('ERRORS', errors.length);
  for (const err of errors.slice(0, 20)) console.log('  -', err);

  ws.close();
  process.exit(errors.length ? 2 : 0);
})().catch((err) => {
  console.error('probe failed:', err.message);
  process.exit(1);
});