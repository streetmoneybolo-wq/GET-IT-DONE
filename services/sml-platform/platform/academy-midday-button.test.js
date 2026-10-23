'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('./server');
const { createPageAssets } = require('./academy-page-assets');

test('in a real browser the MIDDAY button on the chart toolbar opens the desk, previews the report, and Post sends it', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const bars = Array.from({ length: 120 }, (_, i) => ({ t: Date.now() - (120 - i) * 300_000, o: 100, h: 101, l: 99, c: 100, v: 1000 }));
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory: { enabled: true, get: async (s, tf) => ({ ok: true, data: { symbol: s, tf, bars } }) }, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.addInitScript(() => {
      try { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.setItem('sml-academy-explain', 'off'); } catch (_) { /* private mode */ }
      window.__mid = [];
      const f = window.fetch.bind(window);
      window.fetch = async (u, o) => {
        const url = String(u);
        if (url.startsWith('/academy-activity/alerts')) return new Response(JSON.stringify({ ok: true, perMember: true, sources: 1, alerts: [], me: { userId: '7', owner: true }, feed: {} }), { status: 200 });
        if (url.startsWith('/academy-activity/click-alert/midday')) { const b = JSON.parse(o.body); window.__mid.push(b); return new Response(JSON.stringify(b.post ? { ok: true, posted: 2, failed: 0 } : { ok: true, stats: { alerts: 3, up: 2, down: 1, targetsHit: 1, stopped: 0, avgMovePct: 2 }, channels: [{ id: '1', name: 'free-alerts' }], text: '📊 MIDDAY REPORT — preview text' }), { status: 200 }); }
        return f(u, o);
      };
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/academy-activity/?symbol=SPY&tf=5m', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.smlAlertsDesk && window.smlToolRail && document.getElementById('midday-report-toggle') && document.querySelector('.tg[data-group=share] #midday-report-toggle'), null, { timeout: 30000 }); // a busy machine boots slowly
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('sml-academy-session', { detail: { sessionToken: 'tok' } })));
    await page.waitForFunction(() => window.smlAlertsDesk.state.perMember === true, null, { timeout: 20000 });
    await page.evaluate(() => document.querySelector('.tg[data-group=share]>b').click()); // MIDDAY sits with ALERT in the SHARE tab
    await page.waitForSelector('#midday-report-toggle', { state: 'visible', timeout: 8000 });
    await page.click('#midday-report-toggle');
    await page.waitForSelector('.aa-mid');
    await page.waitForFunction(() => /preview text/.test((document.querySelector('.aa-mid') || {}).textContent || ''), null, { timeout: 15000 });
    assert.match(await page.textContent('.aa-mid'), /preview text/);
    assert.match(await page.textContent('.aa-mid'), /#free-alerts/);
    assert.deepEqual(await page.evaluate(() => window.__mid), [{ post: false }], 'the preview posts nothing');
    await page.click('[data-act=midday-post]');
    await page.waitForFunction(() => window.__mid.length === 2);
    assert.equal(await page.evaluate(() => window.__mid[1].post), true);
    await page.waitForFunction(() => /Posted to 2 channels/.test(document.querySelector('.aa-mid').textContent));
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
