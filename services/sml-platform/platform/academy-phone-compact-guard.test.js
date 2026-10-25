'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('./server');
const { createPageAssets } = require('./academy-page-assets');

/* THE OWNER'S RULE: the phone Academy stays compact, the chart high on the screen. A "bigger tap targets" pass (44px buttons) once
   pushed the chart 75px down and a wrapping hint stretched the tool row to 77px, leaving dead space over the chart. These limits fail
   any change that grows the phone header back. Change them only when the owner asks for a taller phone layout. */
test('the phone layout stays compact: thin top bar, one-line tool row, the chart starts high', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const bars = Array.from({ length: 120 }, (_, i) => ({ t: Date.now() - (120 - i) * 86_400_000, o: 1200, h: 1210, l: 1190, c: 1205, v: 1e6 }));
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory: { enabled: true, get: async (s, tf) => ({ ok: true, data: { symbol: s, tf, bars } }) }, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const page = await (await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.setItem('sml-academy-explain', 'off'); } catch (_) { /* private mode */ } });
    await page.goto('http://127.0.0.1:' + server.address().port + '/academy-activity/?symbol=SNDK&tf=1D', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('ms-nav') && document.querySelector('.academy-chart-stage') && document.getElementById('candle-recap-hint'), null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => {
      const intro = document.getElementById('academy-intro'); if (intro) intro.remove(); window.scrollTo(0, 0);
      const h = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : 0; };
      const tallest = (s) => Math.max(0, ...[...document.querySelectorAll(s)].filter((e) => getComputedStyle(e).display !== 'none').map((e) => Math.round(e.getBoundingClientRect().height)));
      return { bar: h('main .bar'), tools: h('.academy-chart-tools'), stageTop: Math.round(document.querySelector('.academy-chart-stage').getBoundingClientRect().top + scrollY), barBtn: tallest('main .bar button'), toolBtn: tallest('.academy-chart-tools button') };
    });
    assert.ok(m.bar <= 40, 'top bar is one thin row (' + m.bar + 'px)');
    assert.ok(m.barBtn <= 30, 'top bar buttons stay compact (' + m.barBtn + 'px)');
    assert.ok(m.tools <= 36, 'the chart tool row is one line (' + m.tools + 'px)');
    assert.ok(m.toolBtn <= 30, 'chart tool buttons stay compact (' + m.toolBtn + 'px)');
    assert.ok(m.stageTop <= 220, 'the chart starts high on the screen (' + m.stageTop + 'px from the top)');
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
