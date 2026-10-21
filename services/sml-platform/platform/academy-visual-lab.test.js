'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CHART_TYPES, calculateIntervalStats, heikinAshi, renko, academyVisualLabScript } = require('./academy-visual-lab');

const bars = [
  { t: 1, o: 100, h: 105, l: 99, c: 104, v: 10 },
  { t: 2, o: 104, h: 108, l: 102, c: 103, v: 20 },
  { t: 3, o: 103, h: 110, l: 101, c: 109, v: 30 }
];

test('interval stats follow the documented selected-candle formulas', () => {
  const result = calculateIntervalStats(bars);
  const average = ((105 + 99 + 104) / 3 + (108 + 102 + 103) / 3 + (110 + 101 + 109) / 3) / 3;
  assert.equal(result.start, 1);
  assert.equal(result.end, 3);
  assert.equal(result.high, 110);
  assert.equal(result.low, 99);
  assert.equal(result.average, average);
  assert.equal(result.changePct, 9);
  assert.equal(result.amplitudePct, (11 / average) * 100);
  assert.equal(result.volume, 60);
  assert.equal(result.turnover, 10 * ((105 + 99 + 104) / 3) + 20 * ((108 + 102 + 103) / 3) + 30 * ((110 + 101 + 109) / 3));
  assert.deepEqual([result.bullish, result.bearish], [2, 1]);
  assert.deepEqual([result.rise, result.fall], [1, 1]);
  assert.equal(result.count, 3);
});

test('all requested chart families and interactive teaching tools ship in the Activity', () => {
  assert.deepEqual(CHART_TYPES, ['Candlestick', 'Bar', 'Line', 'Heikin-Ashi', 'Renko', 'Point & Figure', 'Kagi', 'OHLC', 'Raindrop', 'Chart Patterns']);
  const html = academyVisualLabScript();
  for (const name of CHART_TYPES) assert.ok(html.includes(name));
  assert.match(html, /INTERVAL STATS/);
  assert.match(html, /VISUAL MATH LAB/);
  assert.match(html, /MutationObserver/);
  assert.match(html, /LEVEL 2/);
  assert.match(html, /SCANNER/);
});

test('derived chart transforms preserve valid OHLC structures', () => {
  const ha = heikinAshi(bars);
  assert.equal(ha.length, bars.length);
  assert.ok(ha.every((bar) => bar.h >= Math.max(bar.o, bar.c) && bar.l <= Math.min(bar.o, bar.c)));
  const bricks = renko([{ t: 1, o: 100, h: 100, l: 100, c: 100 }, { t: 2, o: 100, h: 106, l: 100, c: 106 }], 2);
  assert.equal(bricks.length, 3);
  assert.deepEqual(bricks.map((bar) => bar.c), [102, 104, 106]);
});

/* ---- Interval stats must never sit under the chart's drawing layers, and must be a compact sheet on a phone ----
 * The regression this guards: the panel was z-index 4 while the drawing layer (.academy-pro-layer) is 5, so on a phone the
 * indicator lines ran through the panel and the 2-column grid covered ~70% of the plot. */
const fs = require('node:fs');
const path = require('node:path');
const labCss = () => /<style>([\s\S]*?)<\/style>/.exec(academyVisualLabScript())[1];
const zOf = (src, selector) => {
  const esc = selector.replace(/[.#\[\]=\-"]/g, '\\$&');
  const m = new RegExp(esc + '\\{[^}]*?z-index:(\\d+)').exec(src);
  return m ? Number(m[1]) : null;
};

test('Interval stats stack above every layer drawn in the chart stage', () => {
  const css = labCss();
  const panel = zOf(css, '.academy-interval-stats');
  assert.ok(panel != null, 'the panel has a z-index');
  const files = fs.readdirSync(__dirname).filter((f) => /^academy-.*\.js$/.test(f) && !/\.test\.js$/.test(f));
  const layers = ['.academy-pro-layer', '.academy-pro-zone', '#mem-algo-layer', '#smc-layer', '.academy-chart-overlay'];
  const found = {};
  for (const f of files) { const src = fs.readFileSync(path.join(__dirname, f), 'utf8'); for (const l of layers) { const z = zOf(src, l); if (z != null) found[l] = Math.max(found[l] || 0, z); } }
  assert.ok(found['.academy-pro-layer'] >= 5, 'the drawing layer was found: ' + JSON.stringify(found));
  for (const [layer, z] of Object.entries(found)) assert.ok(panel > z, `Interval stats (z-index ${panel}) must be above ${layer} (${z})`);
  /* and above the other info panels that share the stage (the ones that are not full-screen: those use a huge z-index) */
  for (const f of files) { const src = fs.readFileSync(path.join(__dirname, f), 'utf8'); for (const sel of ['#mem-algo-panel', '#smc-card', '#plive-panel', '.academy-pro-panel', '.academy-pro-palette']) { for (const m of src.matchAll(new RegExp(sel.replace(/[.#]/g, '\\$&') + '\\{[^}]*?z-index:(\\d+)', 'g'))) { const z = Number(m[1]); if (z < 1000) assert.ok(panel >= z, `Interval stats (${panel}) must not be below ${sel} (${z})`); } } }
});

test('on a phone Interval stats is a compact sheet pinned to the bottom of the plot, immune to desktop drag offsets, and not draggable', () => {
  const css = labCss();
  const phone = /@media\(max-width:760px\)\{\.academy-interval-stats\{([^}]*)\}/.exec(css);
  assert.ok(phone, 'a phone rule for the panel exists');
  for (const need of ['left:6px!important', 'right:6px!important', 'top:auto!important', 'bottom:6px!important', 'width:auto!important']) assert.ok(phone[1].includes(need), 'phone rule has ' + need);
  const mh = /max-height:(\d+)%/.exec(phone[1]); assert.ok(mh && Number(mh[1]) <= 50, 'the sheet never takes more than half the plot');
  assert.match(css, /@media\(max-width:760px\)\{[\s\S]*\.academy-stat-grid\{grid-template-columns:repeat\(8,minmax\(0,1fr\)\)/, 'start and end take half a row, the other ten figures four to a row');
  assert.match(css, /\.academy-stat-close\{min-width:34px;min-height:30px/, 'the close button is a touch target');
  assert.match(academyVisualLabScript(), /matchMedia\('\(max-width:760px\)'\)\.matches\)return;/, 'the header drag is off on a phone');
});

/* The same check in a real phone-sized browser, when one is installed: the drawing layer is painted with lines across the panel and a
 * pixel inside the panel must be the panel's colour, not a line's. Skipped where Playwright is not available. */
test('in a phone browser the panel hides the lines under it and covers under half of the plot', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* try the next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  try {
    const items = ['Start', 'End', 'High', 'Low', 'Average', '% Change', 'Amplitude', 'Volume', 'Turnover', 'Bull / Bear', 'Rise / Fall', 'Candles'];
    const proLayer = '.academy-pro-layer{position:absolute;left:0;top:0;width:100%;height:100%;z-index:5;pointer-events:none;background:transparent;border:0}';
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#06101a}${labCss()}${proLayer}.academy-chart-stage{position:relative;height:420px;background:#0a1620;overflow:hidden}</style></head><body><div class="academy-chart-stage"><canvas class="academy-pro-layer" width="390" height="420"></canvas><section class="academy-interval-stats open"><div class="academy-stat-head"><span>INTERVAL STATS</span><span>Candlestick<button type="button" class="academy-stat-close">x</button></span></div><div class="academy-stat-grid">${items.map((i) => `<span>${i}<b>1.00</b></span>`).join('')}</div></section></div><script>const c=document.querySelector('canvas').getContext('2d');c.fillStyle='#ff00ff';c.fillRect(0,0,390,420);</script></body></html>`;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); await page.setContent(html); await page.waitForTimeout(200);
    const m = await page.evaluate(() => { const s = document.querySelector('.academy-interval-stats'), st = document.querySelector('.academy-chart-stage'); const r = s.getBoundingClientRect(), R = st.getBoundingClientRect(); return { pct: r.height / R.height * 100, bottomGap: R.bottom - r.bottom, insideLeft: r.left >= R.left, insideRight: r.right <= R.right, x: r.left + r.width / 2, y: r.top + 4 }; });
    assert.ok(m.pct < 50, 'covers under half the plot, got ' + Math.round(m.pct) + '%'); assert.ok(m.bottomGap >= 0 && m.bottomGap <= 8, 'pinned to the bottom'); assert.ok(m.insideLeft && m.insideRight, 'inside the plot');
    /* the whole drawing layer is magenta: if it painted over the panel, a pixel inside the panel would be magenta */
    const shot = await page.screenshot({ clip: { x: m.x, y: m.y, width: 2, height: 2 } });
    const px = await page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = 1; c.height = 1; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return Array.from(g.getImageData(0, 0, 1, 1).data); }, shot.toString('base64'));
    assert.ok(!(px[0] > 200 && px[2] > 200 && px[1] < 80), 'the drawing layer must not paint over the panel, pixel ' + px.join(','));
  } finally { await browser.close(); }
});
