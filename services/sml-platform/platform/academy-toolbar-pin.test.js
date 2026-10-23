'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('./server');
const { createPageAssets } = require('./academy-page-assets');

test('in a real browser MEM ALGO stays on the bar whichever tab is open, and MIDDAY lives in SHARE', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const bars = Array.from({ length: 120 }, (_, i) => ({ t: Date.now() - (120 - i) * 300_000, o: 100, h: 101, l: 99, c: 100, v: 1000 }));
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory: { enabled: true, get: async (s, tf) => ({ ok: true, data: { symbol: s, tf, bars } }) }, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.setItem('sml-academy-explain', 'off'); } catch (_) { /* private mode */ } });
    await page.goto('http://127.0.0.1:' + server.address().port + '/academy-activity/?symbol=SPY&tf=5m', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tool-rail .tail, .sml-dc-tail', { state: 'attached', timeout: 10000 }); await page.waitForTimeout(1500);
    for (const tab of ['chart', 'flow', 'desk', 'share']) {
      await page.evaluate((k) => document.querySelector('.tg[data-group=' + k + ']>b').click(), tab);
      const r = await page.evaluate(() => { const e = document.getElementById('mem-algo-toggle'), b = e.getBoundingClientRect(); return { w: b.width, h: b.height, inTail: !!e.closest('.tail, .sml-dc-tail') }; });
      assert.ok(r.w > 20 && r.h > 10 && r.inTail, `MEM ALGO is on the bar with the ${tab} tab open`);
    }
    assert.equal(await page.evaluate(() => !!document.querySelector('.tg[data-group=desk] #mem-algo-toggle')), false);
    assert.equal(await page.evaluate(() => !!document.querySelector('.tg[data-group=share] #midday-report-toggle')), true);
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
