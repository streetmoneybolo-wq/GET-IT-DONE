'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

test('the chart never overwrites the ticker box while the member is typing in it', () => {
  assert.ok(src.includes('if(document.activeElement!==sym)sym.value=symbol;'), 'the chart only writes the ticker box when it is not focused');
  assert.ok(!/[^!]sym\.value=symbol;label\.textContent/.test(src.replace('if(document.activeElement!==sym)sym.value=symbol;', '')), 'no unguarded write is left');
});

test('a slow refresh of the old ticker can never repaint the chart after a new ticker was loaded', () => {
  assert.ok(src.includes("(new URLSearchParams(location.search).get('symbol')||'SPY')!==symbol"), 'the refresh checks the ticker is still the one in the address');
  assert.ok(src.includes("(new URLSearchParams(location.search).get('tf')||'5m')!==tf"), 'and the interval too');
});
