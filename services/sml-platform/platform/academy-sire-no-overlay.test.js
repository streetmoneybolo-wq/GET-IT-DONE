'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('./server');
const { createPageAssets } = require('./academy-page-assets');

/* The strict rule: nothing sits on the chart and nothing moves or shrinks it. S.I.R.E. used to float over the right edge of the chart (chart lock);
   it now lives in the quote column. This renders the real page, turns SIRE on and measures. */
test('in a real browser S.I.R.E. opens in the quote column, never over the chart, and the chart does not move or shrink', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const marketHistory = { enabled: true, get: async (symbol, tf) => ({ ok: true, data: { symbol, tf, bars: Array.from({ length: 120 }, (_, i) => ({ t: Date.now() - (120 - i) * 300_000, o: 2 + Math.sin(i / 7) * 0.1, h: 2.1 + Math.sin(i / 7) * 0.1, l: 1.9 + Math.sin(i / 7) * 0.1, c: 2.02 + Math.sin(i / 7) * 0.1, v: 1000 + i })) } }) };
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.setItem('sml-academy-explain', 'off'); } catch (_) { /* private mode */ } });
    await page.goto('http://127.0.0.1:' + server.address().port + '/academy-activity/?symbol=YMAT&tf=1d', { waitUntil: 'load' }); await page.waitForTimeout(2500);
    await page.evaluate(() => { const e = document.getElementById('academy-intro'); if (e) e.remove(); });
    const rect = () => page.evaluate(() => { const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; }; const sp = document.getElementById('sire-panel'); return { chart: R(document.getElementById('chart')), sire: R(sp), pos: sp && getComputedStyle(sp).position, parent: sp && sp.parentElement && sp.parentElement.matches('main .side'), open: document.body.classList.contains('sire-open') }; });
    const before = await rect();
    await page.evaluate(() => document.getElementById('sire-toggle').click()); await page.waitForTimeout(1200);
    const after = await rect();
    assert.equal(after.open, true, 'SIRE is on');
    assert.equal(after.pos, 'static', 'not floating'); assert.equal(after.parent, true, 'it is in the quote column');
    assert.ok(after.sire.l >= after.chart.r, `the panel (${after.sire.l}) starts at or after the chart's right edge (${after.chart.r})`);
    assert.deepEqual(after.chart, before.chart, 'the chart did not move or shrink');
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});

test('the chart lock no longer lets S.I.R.E. float: the source has no absolute rule for it and says nothing sits on the chart', () => {
  const fs = require('node:fs'), path = require('node:path');
  const lock = fs.readFileSync(path.join(__dirname, 'academy-chart-lock.js'), 'utf8');
  assert.doesNotMatch(lock, /#sire-panel\{position:absolute/);
  assert.match(lock, /#sire-panel\{position:static!important/);
  assert.match(fs.readFileSync(path.join(__dirname, 'academy-side-window.js'), 'utf8'), /adoptSire/);
});

test('in a real browser Market Direction, the VIX block and Unusual Volume sit directly under the chart, ahead of the Indicator Engine; phones keep their own layout', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const marketHistory = { enabled: true, get: async (symbol, tf) => ({ ok: true, data: { symbol, tf, bars: Array.from({ length: 120 }, (_, i) => ({ t: Date.now() - (120 - i) * 300_000, o: 2, h: 2.1, l: 1.9, c: 2.02, v: 1000 + i })) } }) };
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    for (const [name, vp, phone] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 780 }, true]]) {
      const page = await (await browser.newContext({ viewport: vp, isMobile: phone })).newPage();
      await page.addInitScript(() => { try { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.setItem('sml-academy-explain', 'off'); } catch (_) { /* private mode */ } });
      await page.goto('http://127.0.0.1:' + server.address().port + '/academy-activity/?symbol=YMAT&tf=1d', { waitUntil: 'load' }); await page.waitForTimeout(2500);
      /* the Indicator Engine mounts right after <main> when a member signs in: stand one in, as it does */
      await page.evaluate(() => { const box = document.createElement('section'); box.className = 'academy-intelligence'; box.textContent = 'INDICATOR ENGINE'; document.querySelector('main').after(box); });
      await page.waitForTimeout(900);
      const order = await page.evaluate(() => { const main = document.querySelector('main'); const sibs = []; for (let e = main; e && sibs.length < 5; e = e.nextElementSibling) sibs.push(e.tagName === 'MAIN' ? 'main' : e.className.split(' ')[0] || e.id || e.tagName); const trio = document.querySelector('.academy-market-trio'); return { sibs, trioParent: trio && trio.parentElement && (trio.parentElement.id || trio.parentElement.tagName), members: trio ? [...trio.children].map((e) => e.id) : [] }; });
      if (!phone) {
        assert.equal(order.sibs[0], 'main'); assert.equal(order.sibs[1], 'academy-market-trio', 'the trio is first under the chart: ' + order.sibs.join(' > '));
        assert.equal(order.sibs[2], 'academy-intelligence', 'the Indicator Engine follows it');
        assert.deepEqual([...order.members].sort(), ['academy-direction', 'academy-sml-vix', 'academy-unusual-volume']);
      } else {
        assert.notEqual(order.sibs[1], 'academy-market-trio', 'phones are left alone');
      }
      await page.close();
    }
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
