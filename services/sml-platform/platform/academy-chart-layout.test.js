'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeByPixel, stackLabels, avoidOverlap, boundZoneEndBar } = require('./academy-chart-layout');

test('mergeByPixel combines items within the gap into one group, sorted by position, and leaves distant items alone', () => {
  const items = [{ id: 'a', y: 100 }, { id: 'b', y: 106 }, { id: 'c', y: 40 }, { id: 'd', y: 160 }];
  const groups = mergeByPixel(items, (i) => i.y, 10, (members, y) => ({ ids: members.map((m) => m.id), y }));
  // a (100) and b (106) are within 10px of each other and merge; c and d stand alone
  assert.deepEqual(groups.map((g) => g.ids), [['c'], ['a', 'b'], ['d']]);
});

test('mergeByPixel merges transitively: a chain of near items collapses into one group', () => {
  const items = [{ id: 'a', y: 0 }, { id: 'b', y: 8 }, { id: 'c', y: 16 }, { id: 'd', y: 24 }];
  const groups = mergeByPixel(items, (i) => i.y, 10, (members) => members.map((m) => m.id));
  assert.deepEqual(groups, [['a', 'b', 'c', 'd']]);
});

test('mergeByPixel with no items merges to nothing, and a single item passes through unchanged', () => {
  assert.deepEqual(mergeByPixel([], (i) => i.y, 10, (m) => m), []);
  const one = mergeByPixel([{ y: 5 }], (i) => i.y, 10, (members, y) => ({ n: members.length, y }));
  assert.deepEqual(one, [{ n: 1, y: 5 }]);
});

test('stackLabels leaves well-separated labels at their natural position', () => {
  const items = [10, 50, 100];
  const placed = stackLabels(items, (v) => v, 20);
  assert.deepEqual(placed.map((p) => p.pos), [10, 50, 100]);
});

test('stackLabels pushes a crowded label down just enough to clear the previous one, cumulatively', () => {
  const items = [10, 15, 18, 100]; // three crowded together, one far away
  const placed = stackLabels(items, (v) => v, 20);
  assert.deepEqual(placed.map((p) => p.pos), [10, 30, 50, 100]);
  assert.equal(placed[3].naturalPos, 100, 'the natural position is preserved even when it differs from the placed one');
});

test('avoidOverlap nudges a colliding box straight down (from its own natural y, by its own height, per retry) until it clears every already-placed box', () => {
  const boxes = [{ x: 0, y: 0, w: 50, h: 10 }, { x: 0, y: 2, w: 50, h: 10 }, { x: 0, y: 4, w: 50, h: 10 }];
  const placed = avoidOverlap(boxes);
  // box1: natural 2 overlaps [0,10) -> +10 = 12, clears it. box2: natural 4 overlaps [0,10) -> +10 = 14, still overlaps [12,22) -> +10 = 24, clears both.
  assert.deepEqual(placed.map((b) => b.y), [0, 12, 24]);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(Math.abs(placed[i].y - placed[j].y) >= 10, 'no two placed boxes overlap');
});

test('avoidOverlap leaves non-overlapping boxes (different x, or far apart in y) exactly where they were', () => {
  const boxes = [{ x: 0, y: 0, w: 20, h: 10 }, { x: 100, y: 0, w: 20, h: 10 }, { x: 0, y: 50, w: 20, h: 10 }];
  const placed = avoidOverlap(boxes);
  assert.deepEqual(placed.map((b) => [b.x, b.y]), [[0, 0], [100, 0], [0, 50]]);
});

test('avoidOverlap gives up after maxTries rather than looping forever on an impossibly crowded chart', () => {
  const boxes = Array.from({ length: 20 }, () => ({ x: 0, y: 0, w: 10, h: 10 }));
  const placed = avoidOverlap(boxes, 3);
  assert.equal(placed[19].y, 30, 'capped at maxTries * h, not pushed indefinitely');
});

test('boundZoneEndBar caps a zone box to maxBars ahead of its origin, never past the chart end, and never short of the natural end when that is closer', () => {
  assert.equal(boundZoneEndBar(10, 500, 24), 34, 'capped at origin + maxBars');
  assert.equal(boundZoneEndBar(10, 15, 24), 15, 'the chart simply ends first');
  assert.equal(boundZoneEndBar(10, 20, 24), 20, 'already-filled end (20) is closer than the cap, so it is kept as-is');
});
