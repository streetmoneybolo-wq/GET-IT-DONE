'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('./server');
const { createPageAssets } = require('./academy-page-assets');

test('the reset script is inlined without characters that break an inlined script, and loads first in the page', () => {
  const src = fs.readFileSync(path.join(__dirname, 'academy-reset.js'), 'utf8');
  assert.ok(!/[`\\]/.test(src) && !src.includes('${'), 'no backtick, backslash or ${');
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(server, /\(\) => ACADEMY_RESET \+ ACADEMY_CHART_GUARD/);
});

test('in a real browser RESET clears the saved layout and cached files, keeps drawings and theme, and Lite mode lightens the page and the charts', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const bars = Array.from({ length: 120 }, (_, i) => ({ t: Date.now() - (120 - i) * 300_000, o: 100, h: 101, l: 99, c: 100, v: 1000 }));
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory: { enabled: true, get: async (s, tf) => ({ ok: true, data: { symbol: s, tf, bars } }) }, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.addInitScript(() => { try { if (!/[?&]r=/.test(location.search)) { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.setItem('sml-academy-explain', 'off'); localStorage.setItem('sml-opt-mini-tf', 'x'); localStorage.setItem('sml-chart-quality', '3'); localStorage.setItem('sml-chart-draw-v1', '{"SPY":[1]}'); localStorage.setItem('sml-academy-appearance-v1', '{"theme":"plum"}'); } } catch (_) { /* private mode */ } });
    await page.goto('http://127.0.0.1:' + server.address().port + '/academy-activity/?symbol=SPY&tf=5m', { waitUntil: 'load' });
    await page.waitForSelector('#sml-reset-btn', { timeout: 10000 });
    await page.click('#sml-reset-btn');
    assert.match(await page.textContent('#sml-reset-card'), /Blank, black or stuck/);
    const card = await page.evaluate(() => { const r = document.getElementById('sml-reset-card').getBoundingClientRect(), c = document.getElementById('chart').getBoundingClientRect(); return { w: r.width, h: r.height, overChart: !(r.right < c.left || r.left > c.right || r.bottom < c.top || r.top > c.bottom) }; });
    assert.ok(card.w <= 342 && card.h < 190, 'a small card');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('[data-r=lite]')]);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ url: location.search, lite: localStorage.getItem('sml-lite'), compact: localStorage.getItem('sml-opt-mini-tf'), quality: localStorage.getItem('sml-chart-quality'), draw: localStorage.getItem('sml-chart-draw-v1'), theme: localStorage.getItem('sml-academy-appearance-v1'), cls: document.documentElement.classList.contains('sml-lite'), dpr: window.smlChartDpr && window.smlChartDpr(), label: (document.getElementById('sml-reset-btn') || {}).textContent }));
    assert.match(after.url, /[?&]r=\d+/); assert.equal(after.lite, '1'); assert.equal(after.compact, null); assert.equal(after.quality, null);
    assert.equal(after.draw, '{"SPY":[1]}', 'drawings are kept'); assert.match(after.theme, /plum/, 'the theme is kept');
    assert.equal(after.cls, true, 'Lite mode is applied'); assert.equal(after.dpr, 1, 'charts draw at normal resolution'); assert.equal(after.label, 'RESET · LITE');
    // and back to full graphics
    await page.click('#sml-reset-btn'); assert.match(await page.textContent('#sml-reset-card'), /Reset \+ full graphics/);
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('[data-r=full]')]);
    assert.equal(await page.evaluate(() => localStorage.getItem('sml-lite')), null);
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
