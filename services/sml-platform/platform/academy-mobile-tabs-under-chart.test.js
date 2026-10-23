'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('./server');
const { createPageAssets } = require('./academy-page-assets');

/* The rule: nothing covers the chart. On a phone the tab bar was fixed to the bottom of the window, so in the Discord app it floated up over
   the candles when the page was pulled past its top. It now sits in the page under the chart and only pins to the top once the chart is gone. */
test('on a phone the tab bars start under the chart and never overlap it at any scroll position', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const bars = Array.from({ length: 120 }, (_, i) => ({ t: Date.now() - (120 - i) * 300_000, o: 100, h: 101, l: 99, c: 100, v: 1000 }));
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory: { enabled: true, get: async (s, tf) => ({ ok: true, data: { symbol: s, tf, bars } }) }, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.setItem('sml-academy-explain', 'off'); } catch (_) { /* private mode */ } });
    await page.goto('http://127.0.0.1:' + server.address().port + '/academy-activity/?symbol=SPY&tf=5m', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('ms-nav') && document.querySelector('.academy-chart-stage'), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const geo = () => page.evaluate(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }; const nav = document.getElementById('ms-nav'); return { nav: r(nav), stage: r(document.querySelector('.academy-chart-stage')), pos: getComputedStyle(nav).position, after: nav.previousElementSibling && nav.previousElementSibling.matches('main .chart') }; });
    let g = await geo();
    assert.notEqual(g.pos, 'fixed', 'not fixed to the window');
    assert.equal(g.after, true, 'placed right after the chart card');
    assert.ok(g.nav.top >= g.stage.bottom - 1, `the tabs start below the chart (${Math.round(g.nav.top)} vs ${Math.round(g.stage.bottom)})`);
    const H = await page.evaluate(() => document.documentElement.scrollHeight);
    for (const y of [0, 120, 300, 600, H]) {
      await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(120);
      g = await geo();
      const overlap = Math.min(g.nav.bottom, g.stage.bottom) - Math.max(g.nav.top, g.stage.top);
      assert.ok(overlap <= 1, `scrolled to ${y}: the tabs overlap the chart by ${Math.round(overlap)}px`);
    }
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
