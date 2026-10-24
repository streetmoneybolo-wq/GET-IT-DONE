'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shell = fs.readFileSync(path.join(__dirname, 'academy-mobile-shell.js'), 'utf8');
const intentUi = fs.readFileSync(path.join(__dirname, 'academy-smart-intent-ui.js'), 'utf8');
const targetsUi = fs.readFileSync(path.join(__dirname, 'academy-targets-ui.js'), 'utf8');

/* The regression this guards: on a phone the Intent read-out was a sheet laid over the lower half of the chart (and the same went
 * for Targets), with the chart's own labels showing through it. The phone workspace puts every panel in the page flow UNDER the
 * chart; these two were never given a place. */

test('the phone shell gives the Intent and Targets panels a slot under the chart and puts them back when the phone layout ends', () => {
  assert.match(shell, /const PANELS = \['intent-panel', 'targets-panel', 'levels-card'\]/);
  assert.match(shell, /d\.id = 'ms-slot-tools'; chart\.appendChild\(d\)/, 'the slot is made under the chart with the SMC slot');
  assert.match(shell, /dockPanels\(\);\s*\}/, 'docking runs with the slots, which the shell refreshes every second');
  assert.match(shell, /undockPanels\(\);\s*const slot = byId\('ms-slot-smc'\)/, 'teardown returns them to the chart stage');
  assert.match(shell, /\[data-ms-tab=chart\] #ms-slot-tools\{display:block/, 'visible on the Chart tab');
  assert.match(shell, /#ms-slot-tools>#intent-panel,' \+ A \+ ' #ms-slot-tools>#targets-panel,' \+ A \+ ' #ms-slot-tools>#levels-card\{position:static!important/, 'in the flow, not floating');
  /* the panels themselves still float over the stage when nothing moves them (desktop) */
  assert.match(intentUi, /#intent-panel\{position:absolute;right:8px;top:26px/);
  assert.match(targetsUi, /#targets-panel\{position:absolute;right:8px;top:26px/);
});

test('in a phone browser the Intent panel opens under the chart, not over it, and goes back over the chart on a desktop', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  try {
    /* the panel's real floating style (first rule) and its open state, taken from the module */
    const rule = (src, id) => { const m = new RegExp("'(#" + id + "\\{position:absolute[^']*)'").exec(src); return m ? m[1] : '#' + id + '{position:absolute;right:8px;top:26px;z-index:9;width:min(330px,calc(100% - 24px));max-height:calc(100% - 40px);display:none}'; };
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#06101a;color:#e6eef2;font:14px sans-serif}
      ${rule(intentUi, 'intent-panel')}#intent-panel.open{display:block}${rule(targetsUi, 'targets-panel')}#targets-panel.open{display:block}
      .academy-chart-stage{position:relative;height:340px;background:#0a1620}main .chart{display:grid;grid-template-columns:minmax(0,1fr)}</style></head><body>
      <main class="shell"><div class="bar"><strong>MEM</strong><span id="status" class="status">LIVE</span></div>
        <section class="chart"><div class="toolbar"><input id="symbol" value="CAT"><button id="intent-btn">INTENT</button><button id="targets-toggle">TARGETS</button></div>
          <div class="academy-chart-stage"><canvas id="chart" width="390" height="340"></canvas>
            <aside id="intent-panel" class="open"><div class="ih"><b>INTENT</b></div><div class="ib"><p style="height:210px;margin:0">UNDECIDED, no side yet</p></div></aside>
            <aside id="targets-panel"><div class="th"><b>TARGETS</b></div></aside></div>
          <div class="academy-intervals"><button>1m</button><button>5m</button></div></section>
        <div class="side"><div id="label">CAT</div><div id="price">735</div></div></main>
      <script>${shell.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); await page.setContent(html); await page.waitForTimeout(300);
    await page.evaluate(() => window.smlMobileShell.tab('chart')); await page.waitForTimeout(1700); // the shell's own pass runs every 1.2 s
    const geo = () => page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY, left: b.left, right: b.right, parent: e.parentElement.id || e.parentElement.className, pos: getComputedStyle(e).position, display: getComputedStyle(e).display }; }; return { stage: r('.academy-chart-stage'), intent: r('#intent-panel'), slot: r('#ms-slot-tools') }; });
    let g = await geo();
    assert.equal(g.intent.parent, 'ms-slot-tools', 'moved into the slot under the chart'); assert.equal(g.intent.pos, 'static', 'in the flow');
    assert.ok(g.intent.top >= g.stage.bottom - 1, `the panel starts below the chart (${Math.round(g.intent.top)} vs chart end ${Math.round(g.stage.bottom)})`);
    assert.ok(g.intent.left >= -0.5 && g.intent.right <= 390.5, 'within the screen width');
    assert.ok(g.intent.right - g.intent.left > 330, 'uses the width of the screen, not a narrow corner card');
    /* off the Chart tab the slot is hidden, like the other chart-tab tools */
    await page.evaluate(() => window.smlMobileShell.tab('algo')); await page.waitForTimeout(300);
    assert.equal((await geo()).slot.display, 'none', 'hidden on other tabs'); await page.evaluate(() => window.smlMobileShell.tab('chart')); await page.waitForTimeout(300);
    /* a desktop width: the phone layout ends and the panel is back over the chart as before */
    await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(700);
    g = await geo();
    assert.equal(g.intent.parent, 'academy-chart-stage', 'back in the chart stage'); assert.equal(g.intent.pos, 'absolute', 'floating again on a desktop'); assert.equal(g.slot, null, 'the slot is gone');
    await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(1700);
    assert.equal((await geo()).intent.parent, 'ms-slot-tools', 'and under the chart again on a phone');
  } finally { await browser.close(); }
});
