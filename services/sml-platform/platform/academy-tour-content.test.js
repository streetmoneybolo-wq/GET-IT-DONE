'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { TOOLS, STEPS, lineFor, catalogForPage, lines } = require('./academy/tour-content');
const { createAcademyVoice } = require('./academy-voice');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

test('every tool in the toolbar rail has a first-use card', () => {
  const nav = read('academy-toolbar-nav.js');
  const group = nav.match(/const GROUPS = \[([\s\S]*?)\n  \];/)[1];
  const ids = [...group.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).filter((id) => /-(toggle|btn)$|^depth-/.test(id));
  assert.ok(ids.length >= 20, 'found the rail ids');
  for (const id of ids) assert.ok(TOOLS[id], 'no first-use card for ' + id);
  for (const id of ['lesson-toggle', 'academy-alerts-fab']) assert.ok(TOOLS[id], id);
});

test('every card is complete and short enough to be read aloud', () => {
  for (const [id, t] of Object.entries(TOOLS)) {
    assert.ok(t.name && t.group && t.what && t.edge && t.watch, id + ' is missing a part');
    assert.ok(Array.isArray(t.use) && t.use.length >= 2 && t.use.length <= 4, id + ' steps');
    assert.ok(t.say.length > 120 && t.say.length < 420, id + ' spoken length ' + t.say.length);
    for (const p of t.pairs) assert.ok(TOOLS[p], id + ' pairs with unknown ' + p);
    assert.doesNotMatch(t.say + t.what + t.edge, /guarantee[sd]? (profit|return|win)|can.t lose|risk.free/i, id);
  }
});

test('the tour steps and the spoken script agree id for id', () => {
  const src = read('academy-tour.js');
  const ids = [...src.matchAll(/\{ id: '([a-z-]+)'/g)].map((m) => m[1]);
  assert.equal(ids.length, 26);
  const { PLAYBOOKS, stepKey } = require('./academy/tour-playbooks');
  const pb = Object.entries(PLAYBOOKS).flatMap(([n, p]) => p.steps.map((s) => stepKey(n, s.k)));
  assert.deepEqual([...ids, ...pb].sort(), Object.keys(STEPS).sort());
});

test('every playbook step has words that fit a card and a unique key', () => {
  const { PLAYBOOKS } = require('./academy/tour-playbooks');
  assert.deepEqual(Object.keys(PLAYBOOKS).sort(), ['cheap', 'fda', 'hedge', 'indicators', 'profile', 'social', 'spy', 'together']);
  for (const [n, p] of Object.entries(PLAYBOOKS)) {
    assert.ok(p.title && p.blurb && p.mins >= 2 && p.steps.length >= 6, n);
    assert.equal(new Set(p.steps.map((s) => s.k)).size, p.steps.length, n + ' keys');
    for (const s of p.steps) { assert.ok(s.t.length < 60 && s.b.length > 60 && s.b.length < 420, n + ':' + s.k + ' ' + s.b.length); assert.doesNotMatch(s.t + s.b, /guarantee|can.t lose|risk.free|will (double|triple)/i, n + ':' + s.k); }
  }
});

test('playbook targets only name steps that exist, and every card that offers a walkthrough names a real one', () => {
  const vm = require('node:vm');
  const { PLAYBOOKS, stepKey } = require('./academy/tour-playbooks');
  const ctx = { window: {}, document: { querySelector: () => null } };
  vm.runInNewContext(read('academy-playbooks.js'), ctx);
  const known = new Set(Object.entries(PLAYBOOKS).flatMap(([n, p]) => p.steps.map((s) => stepKey(n, s.k))));
  const keys = Object.keys(ctx.window.smlTourTargets);
  assert.ok(keys.length > 40);
  for (const k of keys) assert.ok(known.has(k), 'target for unknown step ' + k);
  for (const [id, t] of Object.entries(TOOLS)) if (t.playbook) assert.ok(PLAYBOOKS[t.playbook], id + ' -> ' + t.playbook);
  for (const id of ['market-direction', 'hedge-income', 'fda-scanner', 'price-calculator', 'options-chain-lab', 'live-chat', 'academy-indicator-toggle', 'profile-customize']) assert.ok(TOOLS[id] && TOOLS[id].playbook, id);
});

test('the voice can only speak lines written in the catalog', () => {
  assert.ok(lineFor('tool', 'smc-toggle'));
  assert.ok(lineFor('step', 'welcome'));
  for (const [k, id] of [['tool', 'nope'], ['step', '__proto__'], ['tool', 'constructor'], ['x', 'welcome'], ['tool', null], ['tool', ['smc-toggle']]]) assert.equal(lineFor(k, id), null, k + ':' + id);
  assert.equal(lines().length, Object.keys(TOOLS).length + Object.keys(STEPS).length);
});

test('the page catalog carries the cards but never the spoken text', () => {
  const page = catalogForPage();
  assert.equal(Object.keys(page.tools).length, Object.keys(TOOLS).length);
  assert.ok(!JSON.stringify(page).includes(TOOLS['smc-toggle'].say));
  assert.deepEqual(page.steps.sort(), Object.keys(STEPS).sort());
});

test('tour audio: one request per distinct line, cached, rate limited per member, nothing else voiced', async () => {
  const calls = [];
  const svc = createAcademyVoice({ apiKey: 'k', voiceId: 'v1', fetchImpl: async (url, o) => { calls.push(JSON.parse(o.body).text); return new Response(Buffer.from('mp3'), { status: 200 }); } });
  const a = await svc.getTourAudio({ kind: 'tool', id: 'smc-toggle', userId: 'u' });
  const b = await svc.getTourAudio({ kind: 'tool', id: 'smc-toggle', userId: 'u' });
  assert.equal(a.cached, false); assert.equal(b.cached, true);
  assert.deepEqual(calls, [TOOLS['smc-toggle'].say]);
  await assert.rejects(svc.getTourAudio({ kind: 'tool', id: 'say anything', userId: 'u' }), TypeError);
  assert.equal(calls.length, 1);
  let limited = null;
  for (let n = 0; n < 14 && !limited; n += 1) { try { await svc.getTourAudio({ kind: 'step', id: 'welcome', userId: 'busy' }); } catch (e) { limited = e; } }
  assert.equal(limited && limited.code, 'rate_limited');
  const idle = createAcademyVoice({ fetchImpl: async () => { throw new Error('no network'); } });
  await assert.rejects(idle.getTourAudio({ kind: 'step', id: 'welcome', userId: 'u' }), (e) => e.code === 'integration_unconfigured');
});

test('the Activity page ships the catalog, the tour and the first-use explainer, and the route is wired', () => {
  const server = read('server.js');
  assert.match(server, /window\.__smlTourCatalog=/);
  assert.match(server, /academy-auto-tour\.js/);
  assert.match(server, /path === '\/academy-activity\/tour-speech'/);
});

test('the tour bake records every line once, skips what is stored, waits out rate limits and stops on a dead key', async () => {
  const { bakeTourLines } = require('./academy-bake');
  const total = lines().length;
  const stored = new Set(); const seen = [];
  const voice = { configured: true, getTourAudio: async ({ kind, id, internal }) => { assert.equal(internal, true); const k = kind + ':' + id; seen.push(k); const had = stored.has(k); stored.add(k); return { cached: had }; } };
  const store = { durable: true };
  const first = await bakeTourLines({ voice, store, wait: async () => {} });
  assert.deepEqual([first.done, first.skipped, first.failed], [total, 0, 0]);
  const second = await bakeTourLines({ voice, store, wait: async () => {} });
  assert.deepEqual([second.done, second.skipped], [0, total]);
  let n = 0; const flaky = { configured: true, getTourAudio: async () => { n += 1; if (n === 1) { const e = new Error('x'); e.code = 'provider_rate_limited'; throw e; } return { cached: false }; } };
  const waits = [];
  const third = await bakeTourLines({ voice: flaky, store, wait: async (ms) => { waits.push(ms); } });
  assert.equal(third.failed, 0); assert.ok(waits.includes(15000));
  const dead = await bakeTourLines({ voice: { configured: true, getTourAudio: async () => { const e = new Error('bad'); e.code = 'provider_unavailable'; throw e; } }, store, wait: async () => {} });
  assert.equal(dead.failed, 3); assert.equal(dead.stopped, 'provider_unavailable');
  assert.equal((await bakeTourLines({ voice: { configured: false }, store })).stopped, 'provider_unconfigured');
});
