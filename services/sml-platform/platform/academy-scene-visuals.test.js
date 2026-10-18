'use strict';

/* Scene renderer (academy-scene-visuals.js): the served runtime is loaded from the exact <script> the Activity ships
 * and driven with a tiny fake DOM, so these tests exercise the shipped code. */

const assert = require('node:assert/strict');
const test = require('node:test');
const { academySceneVisualsScript, sceneBuild, SCENE_KINDS } = require('./academy-scene-visuals');
const { designLocally } = require('./academy-slide-designer');
const { SEED_LESSONS } = require('./academy/curriculum');

const PAGE_BANNED = /<iframe|location\.assign|CLAUDE DESIGNED|Playing Grandmaster-Obi|next lesson is preloading/i;

const SCENES = {
  chart: { title: 'A share re-rates', values: [100, 104, 101, 109], labels: ['Open', '', 'Dip', 'Close'], note: 'Example numbers' },
  candles: { values: [50, 54, 52, 57, 61], labels: ['Buyers step in'] },
  auction: { values: [99.9, 99.95, 100.05, 100.1], labels: ['Bid', 'Bid', 'Ask', 'Ask'] },
  tape: { steps: ['10:01 BUY 500 @ 20.01', '10:01 SELL 300 @ 20.00'], values: [500, 300] },
  risk: { values: [100, 98, 106], labels: ['Entry', 'Stop', 'Target'] },
  formula: { labels: ['Profit', '=', 'Revenue', '−', 'Costs'], values: [20, 120, 100] },
  comparison: { labels: ['Stock', 'Bond'], steps: ['Owns a slice', 'Lends money', 'Profits vary', 'Fixed coupon'] },
  timeline: { labels: ['Earnings', 'Guidance cut', 'Gap down', 'Recovery'] },
  checklist: { steps: ['Plan', 'Stop', 'Size'] },
  flow: { steps: ['Idea', 'Plan', 'Trade', 'Review', 'Journal'] },
  options: { values: [100, 5], note: 'call' }
};

test('every scene kind builds one SVG with revealable groups, escapes text, and never leaks undefined or NaN', () => {
  for (const kind of SCENE_KINDS) {
    const made = sceneBuild(kind, SCENES[kind], {});
    assert.ok(made && /^<svg class="sc-svg"/.test(made.markup), kind + ' renders an svg');
    assert.ok(made.groups >= 3, kind + ' has reveal groups');
    assert.doesNotMatch(made.markup, /undefined|NaN|<\/script/, kind + ' is clean');
    assert.ok(/data-at="0(\.\d+)?"/.test(made.markup), kind + ' groups carry reveal fractions');
    const empty = sceneBuild(kind, {}, {});
    assert.doesNotMatch(empty.markup, /undefined|NaN/, kind + ' survives an empty scene');
  }
  const hostile = sceneBuild('flow', { steps: ['<script>alert(1)</script>', 'a & b'] }, {});
  assert.doesNotMatch(hostile.markup, /<script>/);
  assert.match(hostile.markup, /&lt;script&gt;|a &amp; b/);
  assert.equal(sceneBuild('question', {}, {}), null);
  assert.equal(sceneBuild('nope', {}, {}), null);
});

test('the interactive scenes answer their controls: the risk target slider and the option price slider recompute the numbers', () => {
  const risk = sceneBuild('risk', { values: [1, 3] }, {});
  assert.equal(risk.control.key, 'mult'); assert.match(risk.markup, /1 : 3  risk to reward/);
  assert.match(sceneBuild('risk', { values: [1, 3] }, { mult: 2 }).markup, /1 : 2  risk to reward/);
  const opt = sceneBuild('options', { values: [100, 5] }, {});
  assert.equal(opt.control.key, 'price'); assert.match(opt.markup, /Break-even 105/);
  assert.match(sceneBuild('options', { values: [100, 5] }, { price: 120 }).markup, /At 120: \+15/);
  assert.match(sceneBuild('options', { values: [100, 5], note: 'put' }, { price: 80 }).markup, /Break-even 95[\s\S]*At 80: \+15/);
  // a chart scrubs by index, a checklist ticks, a flow focuses
  assert.ok(sceneBuild('chart', SCENES.chart, {}).scrub === 4);
  assert.match(sceneBuild('checklist', SCENES.checklist, { ticks: new Set([0, 2]) }).markup, /2 of 3 checked/);
  assert.match(sceneBuild('flow', SCENES.flow, { focus: 1 }).markup, /rgba\(95,179,255,\.22\)/);
});

test('every built-in slide scene for all lessons draws', () => {
  let drawn = 0;
  for (const lesson of SEED_LESSONS) {
    for (const slide of designLocally(lesson).slides) {
      if (!slide.scene) { assert.ok(slide.visualKind === 'question' || lesson.example, 'only the knowledge check and the whiteboard example go without a scene'); continue; }
      const made = sceneBuild(slide.visualKind, slide.scene, {});
      assert.ok(made && made.groups >= 2, lesson.moduleId + '.' + lesson.lessonId + ' ' + slide.visualKind);
      assert.doesNotMatch(made.markup, /undefined|NaN/);
      drawn += 1;
    }
  }
  assert.ok(drawn >= 600, 'scenes drawn: ' + drawn);
});

test('the served runtime draws into the deck on a non-example slide, reveals with narration, and leaves the whiteboard example alone', () => {
  const served = academySceneVisualsScript();
  const match = /^<style>([\s\S]*)<\/style><script>([\s\S]*)<\/script>$/.exec(served);
  assert.ok(match, 'served as one <style> followed by one <script>');
  assert.doesNotMatch(served, PAGE_BANNED);
  assert.match(match[1], /\.academy-live-deck \.academy-slide-visual\[data-board="scene"\]/);
  const listeners = new Map();
  const timers = [];
  const win = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {}
  };
  const makeEl = (tag) => {
    const el = { tagName: tag.toUpperCase(), nodeType: 1, children: [], attrs: new Map(), listeners: {}, className: '', hidden: false, dataset: {}, parentNode: null, isConnected: true,
      get innerHTML() { return this._html || ''; },
      set innerHTML(v) { this._html = v; this.groups = [...String(v).matchAll(/class="sc-r[^"]*" data-at="([\d.]+)"/g)].map((m) => ({ at: Number(m[1]), classes: new Set(), classList: null, getAttribute: (n) => (n === 'data-at' ? m[1] : null) })); this.groups.forEach((g) => { g.classList = { add: (c) => g.classes.add(c), remove: (c) => g.classes.delete(c) }; }); },
      replaceChildren(...nodes) { this.children.forEach((c) => { c.parentNode = null; }); this.children = nodes; nodes.forEach((n) => { n.parentNode = this; }); },
      setAttribute(n, v) { this.attrs.set(n, String(v)); }, getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }, hasAttribute(n) { return this.attrs.has(n); }, removeAttribute(n) { this.attrs.delete(n); },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      querySelector(sel) { if (sel === '.sc-host') return this.host; if (sel === '.sc-ctl') return this.ctl; if (sel === '.sc-tipbar') return this.tip; if (sel === '.sc-svg') return this.host && this.host._html ? { getBoundingClientRect: () => ({ left: 0, width: 360 }) } : null; return null; },
      querySelectorAll(sel) { return sel === '.sc-r' ? this.children.flatMap((c) => c.groups || []).concat(this.host ? this.host.groups || [] : []) : []; } };
    return el;
  };
  const doc = { createElement: (tag) => { const el = makeEl(tag); if (tag === 'div') { el.host = makeEl('div'); el.ctl = makeEl('label'); el.ctl.querySelector = (s) => (s === 'input' ? el.ctl.input : s === 'output' ? el.ctl.out : el.ctl.span); el.ctl.input = makeEl('input'); el.ctl.out = makeEl('output'); el.ctl.span = makeEl('span'); el.ctl.dataset = {}; el.tip = makeEl('div'); el.querySelectorAll = (sel) => (sel === '.sc-r' ? el.host.groups || [] : []); } return el; }, querySelector: () => null };
  const api = new Function('window', 'document', match[2].replace(/^\(/, 'return (').replace(/\)\(window,document\);\s*$/, ')')).call(null, win, doc)(win, doc);
  assert.ok(api && typeof api.build === 'function');
  const visual = makeEl('div');
  const slide = { visualKind: 'flow', scene: SCENES.flow };
  listeners.get('sml-academy-slide-sync')({ detail: { lessonKey: '1:1', partIndex: 2, slide, visual, playing: true, isExample: false } });
  assert.equal(visual.getAttribute('data-board'), 'scene');
  assert.equal(visual.children.length, 1);
  const board = visual.children[0];
  assert.match(board.host.innerHTML, /sc-svg/);
  const on = () => board.host.groups.filter((g) => g.classes.has('on')).length;
  assert.ok(on() < board.host.groups.length, 'playing: later groups wait for the narration');
  listeners.get('sml-academy-slide-progress')({ detail: { lessonKey: '1:1', partIndex: 2, partProgress: 0.5, playing: true } });
  const half = on();
  listeners.get('sml-academy-slide-progress')({ detail: { lessonKey: '1:1', partIndex: 2, partProgress: 1, playing: true } });
  assert.ok(on() >= half && on() === board.host.groups.length, 'everything shows by the end of the part');
  // the whiteboard example: the scene renderer steps aside
  listeners.get('sml-academy-slide-sync')({ detail: { lessonKey: '1:1', partIndex: 1, slide: { visualKind: 'flow', scene: SCENES.flow }, visual, playing: true, isExample: true, example: { frames: [{}] } } });
  assert.equal(visual.children.length, 0);
  assert.equal(visual.getAttribute('data-board'), null);
  // a slide without a scene draws nothing
  listeners.get('sml-academy-slide-sync')({ detail: { lessonKey: '1:1', partIndex: 3, slide: { visualKind: 'question' }, visual, playing: false } });
  assert.equal(visual.children.length, 0);
  // a risk scene mounts its slider
  listeners.get('sml-academy-slide-sync')({ detail: { lessonKey: '1:1', partIndex: 4, slide: { visualKind: 'risk', scene: SCENES.risk }, visual, playing: false } });
  assert.equal(visual.children[0].ctl.hidden, false);
  assert.equal(visual.children[0].ctl.dataset.key, 'mult');
  assert.ok(timers.length >= 1, 'a watchdog is armed while playing');
});
