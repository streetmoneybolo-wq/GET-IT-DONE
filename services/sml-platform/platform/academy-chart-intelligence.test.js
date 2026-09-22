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
