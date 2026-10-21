'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./server');
const { createPageAssets } = require('./academy-page-assets');

/* The regression this guards: the contract chart (the purple card), the chain's trade bar and the hedge ideas each showed FOUR Buy buttons and
   FOUR Sell buttons, one per broker. A contract gets one Buy and one Sell on the member's broker, with a small picker to change the broker, in
   every mode. This renders the real page in a browser and counts the buttons. */
test('in a real browser the contract card has exactly one Buy and one Sell, in every buy mode, and the picker changes the broker', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const marketHistory = { enabled: true, get: async (symbol, tf) => ({ ok: true, data: { symbol, tf, bars: Array.from({ length: 60 }, (_, i) => ({ t: Date.now() - (60 - i) * 300_000, o: 700, h: 701, l: 699, c: 700 + (i % 3), v: 1000 })), asOf: Date.now(), source: 'massive-rest' } }) };
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.removeItem('sml-buy-prefs-v1'); } catch (_) { /* private mode */ } });
    await page.goto(base + '/academy-activity/?symbol=SPY&tf=5m', { waitUntil: 'load' }); await page.waitForTimeout(2500);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('sml-option-mini', { detail: { symbol: 'SPY', side: 'call', strike: 770, expiry: '2026-11-20', row: { bid: 5, ask: 5.2, mid: 5.1 } } })));
    await page.waitForTimeout(800);
    const counts = () => page.evaluate(() => { const c = document.querySelector('.om-trade'); return c ? { buy: c.querySelectorAll('button.buy').length, sell: c.querySelectorAll('button.sell').length, picker: !!c.querySelector('select[data-buy-switch]'), names: [...c.querySelectorAll('button.buy,button.sell')].map((b) => b.textContent.trim()) } : null; });
    for (const mode of ['one', 'each']) {
      await page.evaluate((m) => window.smlBuyPrefs.set({ mode: m }), mode); await page.waitForTimeout(250);
      const c = await counts();
      assert.ok(c, 'the contract card is open');
      assert.equal(c.buy, 1, mode + ': one Buy'); assert.equal(c.sell, 1, mode + ': one Sell'); assert.ok(c.picker, mode + ': a broker picker');
    }
    await page.evaluate(() => { const s = document.querySelector('.om-trade select[data-buy-switch]'); s.value = 'webull'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(250);
    assert.deepEqual((await counts()).names, ['BUY · Webull', 'SELL · Webull'], 'the picker moves both buttons to the chosen broker');
    // the chain's trade bar follows the same rule
    const bar = await page.evaluate(() => { const b = document.querySelector('#options-brokers, .options-brokers, [data-options-brokers]'); return b ? { buy: b.querySelectorAll('button[data-side=buy]').length, sell: b.querySelectorAll('button[data-side=sell]').length } : null; });
    if (bar) { assert.ok(bar.buy <= 1 && bar.sell <= 1, 'the chain bar has at most one Buy and one Sell'); }
  } finally { await browser.close(); server.close(); }
});
