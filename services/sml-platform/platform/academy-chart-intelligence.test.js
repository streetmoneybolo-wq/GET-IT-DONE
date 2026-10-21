'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INDICATOR_CATEGORIES,
  SCANNER_GROUPS,
  attachIndicatorCurriculum,
  academyChartIntelligenceScript
} = require('./academy-chart-intelligence');

test('Academy registers every requested indicator family and scanner family', () => {
  assert.equal(INDICATOR_CATEGORIES.length, 13);
  assert.ok(INDICATOR_CATEGORIES.reduce((sum, category) => sum + category.indicators.length, 0) >= 200);
  assert.ok(INDICATOR_CATEGORIES.some((category) => category.indicators.includes('Gamma Exposure (GEX)')));
  assert.ok(INDICATOR_CATEGORIES.some((category) => category.indicators.includes('McGinley Dynamic')));
  assert.equal(SCANNER_GROUPS.length, 10);
  assert.ok(SCANNER_GROUPS.some((group) => group.views.includes('3-Minute Ranking')));
  assert.ok(SCANNER_GROUPS.some((group) => group.views.includes('Options Flow Heatmap')));
});

test('indicator curriculum is attached to related lessons without changing lesson count', () => {
  const input = [
    { moduleId: 3, lessonId: 2, steps: ['existing'] },
    { moduleId: 9, lessonId: 2, steps: ['existing'] },
    { moduleId: 99, lessonId: 1, steps: ['untouched'] }
  ];
  const output = attachIndicatorCurriculum(input);
  assert.equal(output.length, input.length);
  assert.match(output[0].steps.join(' '), /Trend Indicators:/);
  assert.match(output[1].steps.join(' '), /Options-Derived Indicators:/);
  assert.equal(output[0].steps.length, input[0].steps.length);
  assert.deepEqual(output[2], input[2]);
});

test('chart intelligence client is executable and keeps external fields fail-closed', () => {
  const html = academyChartIntelligenceScript();
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /No proxy or synthetic value is being shown/);
  assert.match(html, /numeric rank positions and proprietary scores are never displayed/);
  assert.match(html, /changeRate3min/);
  assert.match(html, /academy-indicator-overlay/);
});

test('smart range: levels within one visible range of the candles widen the scale, far ones never do', () => {
  const fs = require('fs'), path = require('path'), vm = require('node:vm');
  const src = fs.readFileSync(path.join(__dirname, 'academy-chart-pro.js'), 'utf8');
  assert.match(src, /window\.smlChartLevels = \{ register/); assert.match(src, /V\.smart !== false && !V\.manual && LEVELS\.size/);
  const body = src.slice(src.indexOf('function reachRange'), src.indexOf('const levelPrices'));
  const fn = vm.runInNewContext('(' + body.replace(/^function reachRange/, 'function') + ')', {});
  const J = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(J(fn(100, 110, [114, 95, 135, 60, NaN])), { lo: 95, hi: 114 });
  assert.deepEqual(J(fn(100, 100, [105])), { lo: 100, hi: 100 });
  const tgt = fs.readFileSync(path.join(__dirname, 'academy-targets-ui.js'), 'utf8'); assert.match(tgt, /smlChartLevels\.register\('targets'/);
});

test('smart range: order-book walls and the click-to-alert entry, target and stop are registered as levels', () => {
  const fs = require('fs'), path = require('path');
  const d = fs.readFileSync(path.join(__dirname, 'academy-depth-tools.js'), 'utf8'), c = fs.readFileSync(path.join(__dirname, 'academy-click-alert-ui.js'), 'utf8');
  assert.match(d, /smlChartLevels\.register\('walls'/); assert.match(d, /walls\(S\.live\.book\)\.map\(\(w\) => w\.price\)/); assert.match(d, /levelsChanged\(\);\s*if \(chartCanvas\.parentElement/);
  assert.match(c, /smlChartLevels\.register\('click-alert'/); assert.match(c, /S\.entry, S\.target, S\.data && S\.data\.stop/); assert.match(c, /levelsChanged\(\);\s*if \(canvas\.parentElement/);
});

test('resolution: chart layers draw at the screen’s real density (up to 3), step down only when the measured drag is slow, and re-sharpen when the density changes', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'academy-chart-pro.js'), 'utf8');
  assert.match(src, /window\.smlChartDpr = \(\) => Math\.min\(window\.devicePixelRatio \|\| 1, dprCap\)/); assert.match(src, /let dprCap = 3/);
  assert.match(src, /sml-chart-dpr-cap/); assert.match(src, /pctl\(f, 0\.95\) > 55/); assert.match(src, /resolution: /);
  assert.match(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'), /-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility/);
});
