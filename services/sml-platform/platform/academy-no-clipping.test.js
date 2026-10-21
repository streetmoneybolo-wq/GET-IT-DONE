'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./server');
const { createPageAssets } = require('./academy-page-assets');

/* The regression this guards: the side column and the chart dock cut the Academy off at the right edge (a contract card wider than its column behind a
   sideways scroll bar: "Copy symbol" and the hint text sliced, a Buy button half out of view). Nothing may be wider than the box that holds it. This
   renders the real page at the widths people use, with the tools that fill those columns turned on, and checks every column and the page itself. */
test('no column, dock or page is wider than its box, at desktop, laptop and phone widths, with the tools on', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const marketHistory = { enabled: true, get: async (symbol, tf) => ({ ok: true, data: { symbol, tf, bars: Array.from({ length: 90 }, (_, i) => ({ t: Date.now() - (90 - i) * 300_000, o: 700, h: 701, l: 699, c: 700 + (i % 4), v: 1000 })), asOf: Date.now(), source: 'massive-rest' } }) };
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const probe = () => {
    const out = [];
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > W + 1) out.push('the page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + W);
    for (const sel of ['main .side', '#chart-dock', '.academy-chart-stage']) {
      const box = document.querySelector(sel); if (!box || getComputedStyle(box).display === 'none') continue;
      const b = box.getBoundingClientRect(); if (b.width < 20) continue;
      if (box.scrollWidth > box.clientWidth + 1) out.push(sel + ' has sideways overflow: ' + box.scrollWidth + ' > ' + box.clientWidth);
      for (const el of box.querySelectorAll('*')) {
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
        const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
        let inner = false; for (let a = el.parentElement; a && a !== box; a = a.parentElement) { if (/(hidden|auto|scroll|clip)/.test(getComputedStyle(a).overflowX) && a.getBoundingClientRect().right <= b.right + 1) { inner = true; break; } }
        if (!inner && r.right > b.right + 1 && cs.position !== 'absolute') out.push(sel + ' > ' + el.tagName + '#' + el.id + '.' + String(el.className).slice(0, 24) + ' ends at ' + Math.round(r.right) + ', its box at ' + Math.round(b.right));
      }
    }
    return out.slice(0, 8);
  };
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const [w, h] of [[1650, 1032], [1366, 768], [1100, 800], [390, 844]]) {
      const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 700, isMobile: w < 700 })).newPage();
      await page.addInitScript(() => { try { localStorage.setItem('sml-academy-tour-v1', '1'); } catch (_) { /* private mode */ } });
      await page.goto(base + '/academy-activity/?symbol=SPY&tf=1D', { waitUntil: 'load' }); await page.waitForTimeout(2200);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('sml-option-mini', { detail: { symbol: 'SPY', side: 'call', strike: 770, expiry: '2026-11-20', row: { bid: 5, ask: 5.2, mid: 5.1 } } })));
      for (const id of ['smc-toggle', 'mem-algo-toggle', 'buysell-toggle', 'darkpool-toggle', 'shortsale-toggle', 'targets-toggle', 'intent-btn']) await page.evaluate((i) => { const b = document.getElementById(i); if (b) b.click(); }, id);
      await page.waitForTimeout(1800);
      const bad = await page.evaluate(probe);
      assert.deepEqual(bad, [], w + 'px: ' + bad.join(' | '));
      await page.context().close();
    }
  } finally { await browser.close(); server.close(); }
});
