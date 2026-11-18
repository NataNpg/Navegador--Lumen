const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'assets', 'filters');

const LISTS = [
  ['easylist.txt', 'https://easylist.to/easylist/easylist.txt'],
  ['easyprivacy.txt', 'https://easylist.to/easylist/easyprivacy.txt'],
  ['ublock-filters.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt'],
  ['ublock-quick-fixes.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt'],
  ['ublock-unbreak.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt'],
  ['ublock-badware.txt', 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt'],
  ['adguard-annoyances.txt', 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_14/table/filter.txt'],
  ['peter-lowe.txt', 'https://peterlowey.com/serverlist.txt'.replace('peterlowey.com', 'peter-lowe.com')],
];

async function grab(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Lumen/0.1' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, url] of LISTS) {
    try {
      const text = await grab(url);
      fs.writeFileSync(path.join(OUT, name), text, 'utf8');
      console.log(`ok   ${name.padEnd(26)} ${(text.length / 1024).toFixed(0)} KiB`);
    } catch (err) {
      console.log(`FAIL ${name.padEnd(26)} ${err.message}`);
    }
  }
})();