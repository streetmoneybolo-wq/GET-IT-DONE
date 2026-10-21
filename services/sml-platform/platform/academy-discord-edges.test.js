'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('./server');
const { createPageAssets } = require('./academy-page-assets');

const edges = fs.readFileSync(path.join(__dirname, 'academy-discord-edges.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, 'academy-mobile-shell.js'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, 'academy-settings-ui.js'), 'utf8');

/* The regression this guards: in the Discord mobile app the top and bottom strips of an Activity are under Discord's own bars and never receive a tap,
   and the Academy's bottom tabs and floating buttons sat in the bottom strip. Every fixed control must sit between the two strips. */
test('the Discord phone edges are wired: detection, the sweep that lifts and drops fixed controls, the page padding, the Settings gaps', () => {
  for (const bit of ["params.get('platform') === 'mobile'", "'--sml-inset-top'", "'--sml-inset-bottom'", '.sml-dm-lift{margin-bottom:var(--sml-inset-bottom,0px)!important}', '.sml-dm-drop{margin-top:var(--sml-inset-top,0px)!important}', 'a full-screen layer', 'new MutationObserver']) assert.ok(edges.includes(bit), bit);
  assert.ok(server.includes('ACADEMY_LOOP_KICK + ACADEMY_DISCORD_EDGES + ACADEMY_MOBILE_COMPACT'), 'injected before the phone scripts');
  assert.ok(shell.includes('+ var(--sml-inset-bottom,0px))!important'), 'the page leaves room under the bottom tabs for the strip');
  for (const bit of ['DISCORD PHONE EDGES', 'data-edge=', 'window.smlDiscordEdges.set({ [t.dataset.edge]: t.value })']) assert.ok(settings.includes(bit), bit);
  assert.ok(!/inset-(top|bottom)[^;]{0,40}\bdesktop\b/.test(edges), 'nothing runs outside the Discord phone app');
});

test('in a browser launched like the Discord phone app, every fixed control sits clear of the top and bottom strips, and the Settings gaps move them', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const marketHistory = { enabled: true, get: async (symbol, tf) => ({ ok: true, data: { symbol, tf, bars: Array.from({ length: 60 }, (_, i) => ({ t: Date.now() - (60 - i) * 300_000, o: 700, h: 701, l: 699, c: 700 + (i % 3), v: 1000 })), asOf: Date.now(), source: 'massive-rest' } }) };
  const srv = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory, pageAssets: createPageAssets() });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const base = 'http://127.0.0.1:' + srv.address().port;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.removeItem('sml-discord-edges'); } catch (_) { /* private mode */ } });
    await page.goto(base + '/academy-activity/?symbol=SPY&tf=5m&frame_id=1&platform=mobile', { waitUntil: 'load' }); await page.waitForTimeout(3200);
    const probe = () => page.evaluate(() => {
      const H = innerHeight, cs = getComputedStyle(document.documentElement), out = { H, bad: [], seen: 0 };
      const px = (v) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;visibility:hidden;height:' + v; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h; };
      const top = px(cs.getPropertyValue('--sml-inset-top').trim() || '0px'), bottom = px(cs.getPropertyValue('--sml-inset-bottom').trim() || '0px');
      out.top = Math.round(top); out.bottom = Math.round(bottom);
      for (const el of document.body.querySelectorAll('button,a[href],input,select,textarea,[role=button]')) {
        let fixed = null; for (let a = el; a && a !== document.documentElement; a = a.parentElement) { if (getComputedStyle(a).position === 'fixed') { fixed = a; break; } }
        if (!fixed) continue; const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue;
        const f = fixed.getBoundingClientRect(); if (f.top <= 1 && f.bottom >= H - 1) continue; // a full-screen layer on purpose
        const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= H) continue;
        out.seen++;
        if (r.bottom > H - bottom + 1 || r.top < top - 1) out.bad.push((el.id || el.className || el.tagName).toString().slice(0, 30) + ' ' + Math.round(r.top) + '-' + Math.round(r.bottom));
      }
      return out;
    });
    let g = await probe();
    assert.equal(g.top, 48); assert.equal(g.bottom, 78);
    assert.ok(g.seen >= 4, 'the bottom tabs and the floating buttons were checked (' + g.seen + ')');
    assert.deepEqual(g.bad, [], 'a control sits under a Discord strip: ' + g.bad.join(', '));
    // the member raises the bottom gap in Settings: the tabs move up by the same amount
    const navBefore = await page.evaluate(() => Math.round(document.getElementById('ms-nav').getBoundingClientRect().bottom));
    await page.evaluate(() => window.smlDiscordEdges.set({ bottom: 110 })); await page.waitForTimeout(400);
    const navAfter = await page.evaluate(() => Math.round(document.getElementById('ms-nav').getBoundingClientRect().bottom));
    assert.equal(navBefore - navAfter, 32, 'the tabs rose 32px with the gap');
    g = await probe(); assert.deepEqual(g.bad, [], g.bad.join(', '));
    // outside the Discord phone app nothing changes
    const plain = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
    await plain.addInitScript(() => { try { localStorage.setItem('sml-academy-tour-v1', '1'); } catch (_) { /* private mode */ } });
    await plain.goto(base + '/academy-activity/?symbol=SPY&tf=5m', { waitUntil: 'load' }); await plain.waitForTimeout(2500);
    assert.equal(await plain.evaluate(() => document.documentElement.classList.contains('sml-dm') || !!document.querySelector('.sml-dm-lift')), false);
  } finally { await browser.close(); srv.close(); }
});
