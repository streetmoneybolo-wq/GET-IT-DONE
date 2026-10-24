'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('./server');
const { createPageAssets } = require('./academy-page-assets');

/* The desktop window froze for good (a blank Academy) when LEVELS was on: the levels layer asked the chart for its model while giving the
   chart its levels, and the model asks for the levels again, so the two called each other forever. A member with LEVELS saved on never saw a page. */
test('the chart answers a levels layer that reads the chart model without looping', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'academy-chart-pro.js'), 'utf8');
  assert.match(src, /if \(inLevels\) return out;/, 'a nested level lookup returns nothing');
  const lv = require('node:fs').readFileSync(require('node:path').join(__dirname, 'academy-session-levels-ui.js'), 'utf8');
  assert.ok(lv.includes('!S.a || sym !== S.aSym) return [];'), 'the levels layer never asks for the model inside its own levels');
});

test('the Academy loads and stays responsive on a desktop with LEVELS saved on', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const bars = Array.from({ length: 200 }, (_, i) => ({ t: Date.now() - (200 - i) * 300_000, o: 100 + Math.sin(i / 9) * 3, h: 101 + Math.sin(i / 9) * 3, l: 99 + Math.sin(i / 9) * 3, c: 100.5 + Math.sin(i / 9) * 3, v: 1000 + i * 10 }));
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory: { enabled: true, get: async (s, tf) => ({ ok: true, data: { symbol: s, tf, bars } }) }, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.setItem('sml-academy-explain', 'off'); localStorage.setItem('sml-levels-v1', JSON.stringify({ on: true, o: { ib: true } })); } catch (_) { /* private mode */ } });
    page.goto('http://127.0.0.1:' + server.address().port + '/academy-activity/?symbol=SPY&tf=5m', { waitUntil: 'commit' }).catch(() => {});
    /* a frozen page never answers, so each check races a timer instead of waiting on the page */
    const ask = (fn, ms) => Promise.race([page.evaluate(fn).catch(() => 'error'), new Promise((res) => setTimeout(() => res('hung'), ms))]);
    let r = 'none';
    for (let i = 0; i < 40 && r !== 'model'; i++) { r = await ask(() => (window.smlChartModel && window.smlChartModel() ? 'model' : 'none'), 8000); if (r === 'hung') break; if (r !== 'model') await new Promise((res) => setTimeout(res, 500)); }
    assert.equal(r, 'model', 'the chart draws and the page still answers');
    await new Promise((res) => setTimeout(res, 1500));
    assert.equal(await ask(() => 'ok', 8000), 'ok', 'the page still answers after the levels have drawn');
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});

/* nothing covers the chart: the Session levels card goes where the other tool panels go (the quote column on a desktop, the slot under
   the chart on a phone, the dock beside the plot when the chart lock is off) instead of floating over the candles */
test('the Session levels card never floats over the chart', () => {
  const fs = require('node:fs'), path = require('node:path'), read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const side = read('academy-side-window.js');
  assert.ok(side.includes("['levels-toggle', 'levels-card']"), 'the quote column takes it while LEVELS is on');
  assert.ok(side.includes("main .side>#levels-card{position:static!important"), 'as a block in the column');
  assert.ok(read('academy-mobile-shell.js').includes("const PANELS = ['intent-panel', 'targets-panel', 'levels-card']"), 'a phone puts it under the chart');
  assert.ok(read('academy-chart-dock.js').includes("'#levels-card', '#targets-panel'"), 'the dock takes it when the lock is off');
});
