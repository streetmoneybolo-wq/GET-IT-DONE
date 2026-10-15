'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanLayout, cleanScope, layoutKey } = require('./academy-layout');

test('a desk layout keeps its panels, clamped and de-duplicated', () => {
  const out = cleanLayout({ panels: [
    { id: 'chart', x: 0.1, y: 0.2, w: 0.6, h: 0.9 },
    { id: 'chart', x: 0, y: 0, w: 1, h: 1 },
    { id: 'level2', x: -3, y: 9, w: 0.001, h: 7 },
    { id: 'Bad Id', x: 0, y: 0, w: 1, h: 1 },
    { id: 'tape', x: 'nope', y: null, w: undefined, h: {} }
  ] });
  assert.deepEqual(out, { v: 2, modules: {}, panels: [
    { id: 'chart', x: 0.1, y: 0.2, w: 0.6, h: 0.9 },
    { id: 'level2', x: -0.9, y: 1, w: 0.05, h: 2 },
    { id: 'tape', x: 0, y: 0, w: 0.5, h: 0.5 }
  ] });
});

test('per-module settings are reduced to known fields and values', () => {
  const out = cleanLayout({ modules: {
    'mem-algo': { accent: '#FF9F43', size: 117, height: 360, width: 'full', hidden: true, order: 3, extra: '<b>x</b>' },
    chart: { size: 100, height: 999, width: 'half', hidden: 'yes', order: 120 },
    scanner: { accent: 'red', size: 40 },
    'Bad Id': { hidden: true },
    quote: null
  } });
  assert.deepEqual(out, { v: 2, panels: [], modules: {
    'mem-algo': { accent: '#ff9f43', size: 115, height: 360, width: 'full', hidden: true, order: 3 }
  } });
});

test('a body that is not a layout is rejected, an empty one is accepted', () => {
  assert.equal(cleanLayout(null), null);
  assert.equal(cleanLayout('x'), null);
  assert.equal(cleanLayout([]), null);
  assert.equal(cleanLayout({ v: 2 }), null);
  assert.deepEqual(cleanLayout({ panels: [] }), { v: 2, panels: [], modules: {} });
  assert.deepEqual(cleanLayout({ modules: {} }), { v: 2, panels: [], modules: {} });
});

test('scopes map to separate keys and the desk key is unchanged', () => {
  assert.equal(cleanScope('activity'), 'activity');
  assert.equal(cleanScope('desk'), 'desk');
  assert.equal(cleanScope('../x'), 'desk');
  assert.equal(layoutKey('123456789012345678', 'desk'), 'desk:layout:123456789012345678');
  assert.equal(layoutKey('123456789012345678', 'activity'), 'desk:layout:123456789012345678:activity');
});

test('oversized lists are cut', () => {
  const panels = Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i, x: 0, y: 0, w: 1, h: 1 }));
  const modules = {};
  for (let i = 0; i < 60; i++) modules['m' + i] = { hidden: true };
  const out = cleanLayout({ panels, modules });
  assert.equal(out.panels.length, 20);
  assert.equal(Object.keys(out.modules).length, 40);
});
