'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'home-feed.js'), 'utf8');
const match = source.match(/function signalDay\(t\)\{[\s\S]*?function signalEvents\(bars\)\{[\s\S]*?\n    \}/);
assert.ok(match, 'market-monitor detector functions must remain present');

const context = {
  Intl,
  Date,
  Number,
  Math,
  isFinite,
  fmtVol(value) {
    value = Number(value);
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
    return String(value);
  },
};
vm.createContext(context);
vm.runInContext(match[0] + '\nthis.detect = signalEvents;', context);

const start = Date.UTC(2026, 7, 26, 13, 30, 0);
const bars = [];
for (let i = 0; i < 24; i += 1) {
  const close = 100 + (i * 0.01);
  bars.push({ t: start + (i * 60000), o: close, h: close + 0.05, l: close - 0.05, c: close, v: 1000 });
}
bars.push({ t: start + (24 * 60000), o: 100.23, h: 108.4, l: 100.2, c: 108.1, v: 9000 });

const result = context.detect(bars);
assert.ok(result.rows.length > 0, 'real threshold crossings should create events');
assert.ok(result.rows.length <= 5, 'the embedded tape must show at most five events');
assert.ok(result.rows.some((row) => row.type === 'Rise 7%+'), 'a +7% session crossing should be detected');
assert.ok(result.rows.some((row) => row.type === 'Skyrocket'), 'a >=3% one-minute move should be detected');
assert.ok(result.rows.some((row) => row.type === '↑ Huge Volume'), 'a >=4x volume spike should be detected');
assert.equal(result.rows.some((row) => /Block|Soaring Trade|Diving Trade/.test(row.type)), false, 'unsupported trade-print events must never be fabricated');
assert.equal(result.bulls > 0, true, 'bullish stats should count detected bullish events');

console.log('PASS  Signal News watermark market-monitor detector');
