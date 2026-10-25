'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const compact = fs.readFileSync(path.join(__dirname, 'academy-mobile-compact.js'), 'utf8');
const radar = fs.readFileSync(path.join(__dirname, 'academy-signal-radar-ui.js'), 'utf8');

/* The regression this guards: the owner's SIGNALS pill (position:fixed, bottom-left) floated over the bottom navigation and the
 * indicator chips on a phone. On a phone it belongs in the header beside Alerts; a wide screen floats it or docks it in the bar rail. */

test('the Signals pill is moved into the header beside Alerts on a phone and back to the page on a wide screen', () => {
  assert.match(compact, /document\.getElementById\('sml-sig-fab'\)/);
  assert.match(compact, /alerts\.insertAdjacentElement\('afterend', sig\)/, 'it sits right after the Alerts pill');
  assert.match(compact, /else if \(!phone && sig\.parentElement === bar\) \{\s*document\.body\.appendChild\(sig\);/, 'and returns to the page off a phone');
  /* the header styling beats the pill's own fixed positioning (an id rule), and matches the Alerts pill's compact size */
  assert.match(compact, /body main \.bar #sml-sig-fab\{position:static!important;z-index:auto!important/);
  assert.match(compact, /body main \.bar #academy-alerts-fab,body main \.bar #sml-sig-fab\{flex:none;height:24px/);
  /* the pill is still the radar's own id and floats when nothing moves it */
  assert.match(radar, /#sml-sig-fab\{position:fixed;left:12px;bottom:58px/);
});

test('in a phone browser the Signals pill lands in the header, clear of the bottom nav, and does not overlap its neighbours', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  try {
    const fabRule = /(#sml-sig-fab\{[^}]*\}#sml-sig-fab\.new\{[^}]*\})/.exec(radar);
    const fabCss = fabRule ? fabRule[1] : '#sml-sig-fab{position:fixed;left:12px;bottom:58px;z-index:2147483240;padding:8px 13px;font:800 .66rem ui-monospace,monospace}';
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#06101a;color:#fff;font:14px sans-serif}${fabCss}
      #academy-alerts-fab{position:fixed;left:12px;bottom:300px;padding:8px 13px;font:800 .66rem ui-monospace;border:1px solid #1f8a5f;background:#07211a;color:#7dffc4;border-radius:999px}
      main .bar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:6px}.nav{position:fixed;left:0;right:0;bottom:0;height:90px;background:#101a24}</style></head><body>
      <main><div class="bar"><strong>MEM</strong><button id="lesson-toggle" class="lesson-toggle">Lessons (151)</button><button id="academy-lk-btn">LOOP-KICK</button><span id="status" class="status">LIVE</span></div><div class="toolbar"><input id="symbol"><button id="load">Load</button></div><div class="chart"><canvas id="chart"></canvas></div></main>
      <button id="academy-alerts-fab"><i></i> Alerts · 2</button><button id="sml-sig-fab">SIGNALS · 0</button><nav class="nav" id="nav"></nav><script>${compact.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); await page.setContent(html); await page.waitForTimeout(400);
    const box = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, parent: e.parentElement.className || e.parentElement.tagName, pos: getComputedStyle(e).position }; }, sel);
    const sig = await box('#sml-sig-fab'), alerts = await box('#academy-alerts-fab'), nav = await box('#nav'), bar = await box('main .bar');
    assert.equal(sig.parent, 'bar', 'in the header'); assert.equal(sig.pos, 'static', 'no longer floating');
    assert.ok(await page.evaluate(() => document.getElementById('academy-alerts-fab').nextElementSibling === document.getElementById('sml-sig-fab')), 'right after Alerts');
    assert.ok(sig.t >= bar.t - 1 && sig.b <= bar.b + 1, 'inside the header band');
    assert.ok(sig.b <= nav.t, 'nowhere near the bottom nav');
    assert.ok(sig.r <= 390 + 0.5 && sig.l >= 0, 'inside the screen width');
    const overlaps = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const kids = await page.evaluate(() => [...document.querySelectorAll('main .bar > *')].map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.tagName, l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) assert.ok(!overlaps(kids[i], kids[j]), `${kids[i].id} overlaps ${kids[j].id}`);
    /* the label changes as signals arrive: still no overlap and still inside the screen */
    await page.evaluate(() => { document.getElementById('sml-sig-fab').textContent = 'SIGNALS · 12'; }); await page.waitForTimeout(150);
    const sig2 = await box('#sml-sig-fab'); assert.ok(sig2.r <= 390 + 0.5, 'a longer label still fits');
    /* off a phone it floats again */
    await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(500);
    const wide = await box('#sml-sig-fab'); assert.notEqual(wide.parent, 'bar'); assert.equal(wide.pos, 'fixed', 'floats on a desktop');
    await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(500);
    assert.equal((await box('#sml-sig-fab')).parent, 'bar', 'and goes back to the header when narrowed again');
  } finally { await browser.close(); }
});
