'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./academy-alert-line');
const F = require('./academy-alert-format');

test('where the line lands decides the update: raise, lower, or close', () => {
  const c = (to, side = 'long') => L.classify({ side, pt: 110, price: 100, to }).kind;
  assert.equal(c(125), 'raise'); assert.equal(c(105), 'lower'); assert.equal(c(100), 'close'); assert.equal(c(96), 'close');
  assert.equal(c(110.05), 'none', 'a hair off the same target is no change');
  const s = (to) => L.classify({ side: 'short', pt: 90, price: 100, to }).kind;
  assert.equal(s(80), 'raise'); assert.equal(s(95), 'lower'); assert.equal(s(101), 'close');
  assert.equal(L.classify({ pt: 0, price: 100, to: 120 }).kind, 'none');
  assert.equal(L.WINDOW_MS, 60_000);
});

test('PT RAISED and PT LOWERED read as target changes, never as a smashed target', () => {
  const up = F.formatPtAdjust({ ticker: 'tsla', newPt: 130, oldPt: 120, price: 110, entry: 100, side: 'long' });
  assert.match(up, /𝐏𝐓 𝐑𝐀𝐈𝐒𝐄𝐃/); assert.match(up, /\$𝟏𝟑𝟎/); assert.match(up, /\$120/); assert.ok(!/SMASHED|𝐒𝐌𝐀𝐒𝐇/.test(up));
  const down = F.formatPtAdjust({ ticker: 'TSLA', newPt: 115, oldPt: 120, price: 110, entry: 100, side: 'long', mention: false });
  assert.match(down, /𝐏𝐓 𝐋𝐎𝐖𝐄𝐑𝐄𝐃/); assert.ok(!down.startsWith('@everyone'));
  assert.match(F.formatPtAdjust({ ticker: 'X', newPt: 80, oldPt: 90, price: 95, entry: 100, side: 'short' }), /𝐏𝐓 𝐑𝐀𝐈𝐒𝐄𝐃/, 'a short whose target goes lower is raised');
  assert.throws(() => F.formatPtAdjust({ ticker: 'X', newPt: 0, oldPt: 90 }));
});

test('the chart line is a draggable overlay the page loads after the desk', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(src.indexOf('alertsUi + ') < src.indexOf('alertLineUi + '), 'loaded after the alerts desk');
  const line = fs.readFileSync(path.join(__dirname, 'academy-alert-line.js'), 'utf8');
  assert.match(line, /position:fixed;right:12px;bottom:12px/, 'the confirmation is a small corner pop-up, not over the chart');
});

test('dragging the yellow line starts the one-minute window, Undo cancels, Send now posts through the desk', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const src = fs.readFileSync(path.join(__dirname, 'academy-alert-line.js'), 'utf8');
    await page.setContent('<div class="academy-chart-stage" style="position:relative;width:800px;height:500px"><canvas id="chart" width="800" height="500" style="width:800px;height:500px"></canvas></div>');
    await page.evaluate(() => {
      const lo = 80, hi = 140, padT = 10, ph = 480;
      window.smlChartModel = () => ({ symbol: 'TSLA', pad: { l: 0, t: padT }, pw: 740, ph, priceH: ph, hi, lo, y: (p) => padT + (hi - p) / (hi - lo) * ph });
      window.smlAlertsDesk = { reload() {}, state: { me: { userId: '7', owner: false }, alerts: [{ id: '55', symbol: 'TSLA', channelId: '123456789012345678', authorId: '7', entry: 100, target0: 110, price: 105, at: 1, next: {}, ptUpdates: [] }] } };
      window.__calls = [];
      window.fetch = async (u, o) => { window.__calls.push({ u, b: JSON.parse(o.body) }); return new Response(JSON.stringify({ ok: true, move: 'raise', repliedTo: '9' }), { status: 200 }); };
    });
    await page.addScriptTag({ content: src });
    await page.waitForFunction(() => window.smlAlertLine);
    await page.evaluate(() => window.smlAlertLine.refresh());
    // the PT 110 sits at y = 10 + (140-110)/60*480 = 250; grab it and drag up to 125 (y = 130)
    const box = await page.locator('.academy-chart-stage').boundingBox();
    const at = (y) => [box.x + 200, box.y + y];
    await page.mouse.move(...at(250)); assert.equal(await page.evaluate(() => document.querySelector('.academy-chart-stage').style.cursor), 'ns-resize');
    await page.mouse.down(); await page.mouse.move(...at(190), { steps: 4 }); await page.mouse.move(...at(130), { steps: 4 }); await page.mouse.up();
    const pend = await page.evaluate(() => ({ p: window.smlAlertLine.state.pending && { kind: window.smlAlertLine.state.pending.kind, price: window.smlAlertLine.state.pending.price }, toast: document.getElementById('al-toast').textContent, shown: document.getElementById('al-toast').style.display }));
    assert.equal(pend.p.kind, 'raise'); assert.ok(Math.abs(pend.p.price - 125) < 0.6, 'dropped near 125: ' + pend.p.price);
    assert.match(pend.toast, /Raise TSLA PT/); assert.equal(pend.shown, 'block');
    assert.equal(await page.evaluate(() => window.__calls.length), 0, 'nothing posts until the window ends or Send now');
    const rect = await page.evaluate(() => { const r = document.getElementById('al-toast').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    assert.ok(rect.w <= 262 && rect.h < 120, 'a small pop-up');
    await page.click('#al-toast [data-al=undo]');
    assert.equal(await page.evaluate(() => window.smlAlertLine.state.pending), null); assert.equal(await page.evaluate(() => document.getElementById('al-toast').style.display), 'none');
    // again, and send now
    await page.mouse.move(...at(250)); await page.mouse.down(); await page.mouse.move(...at(272), { steps: 6 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.smlAlertLine.state.pending.kind), 'lower');
    await page.click('#al-toast [data-al=now]');
    await page.waitForFunction(() => window.__calls.length === 1);
    const call = await page.evaluate(() => window.__calls[0]);
    assert.equal(call.u, '/academy-activity/click-alert/desk'); assert.equal(call.b.action, 'move'); assert.equal(call.b.alertId, '55'); assert.ok(call.b.target > 100 && call.b.target < 110);
    await page.waitForFunction(() => /posted/.test(document.getElementById('al-toast').textContent));
    // a drag through the live price is a close
    await page.evaluate(() => { window.smlAlertLine.state.over = {}; window.smlAlertLine.refresh(); });
    await page.mouse.move(...at(250)); await page.mouse.down(); await page.mouse.move(...at(420), { steps: 8 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.smlAlertLine.state.pending.kind), 'close');
    assert.match(await page.evaluate(() => document.getElementById('al-toast').textContent), /Close TSLA/);
  } finally { await browser.close(); }
});
