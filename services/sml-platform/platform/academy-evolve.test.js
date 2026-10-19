'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEvolve, routeKey } = require('./academy-evolve');

const T0 = Date.UTC(2026, 9, 19, 7, 0, 0);

function memStore(initial = null) { let v = initial; return { read: async () => v, write: async (next) => { v = JSON.parse(JSON.stringify(next)); }, get: () => v }; }

test('route keys fold ids and symbols; the ledger times routes, counts tools, devices, visits and errors within bounds', async () => {
  assert.equal(routeKey('/academy-activity/intent?symbol=SPY'), 'intent');
  assert.equal(routeKey('/academy-activity/profiles/123456789012345678'), 'profiles/:id');
  assert.equal(routeKey('/academy-activity/talk/NVDA'), 'talk/:sym');
  assert.equal(routeKey('/academy-activity/'), 'page');
  let clock = T0;
  const ev = createEvolve({ now: () => clock, logger: () => {} });
  for (let i = 0; i < 30; i++) ev.observeRoute('/academy-activity/live?symbol=SPY', 200, 100 + i * 10);
  ev.observeRoute('/academy-activity/live?symbol=QQQ', 503, 20_000, { timeout: true });
  ev.observeRoute('/academy-activity/intent?symbol=SPY', 500, 400);
  assert.equal(ev.observeEvent({ kind: 'tool', id: 'mem-algo-toggle', on: true, phone: true }), true);
  assert.equal(ev.observeEvent({ kind: 'tool', id: 'mem-algo-toggle', on: true }), true);
  assert.equal(ev.observeEvent({ kind: 'tool', id: '<bad>' }), false);
  assert.equal(ev.observeEvent({ kind: 'visit', phone: true, discord: true }), true);
  assert.equal(ev.observeEvent({ kind: 'leave', ms: 90_000 }), true);
  assert.equal(ev.observeEvent({ kind: 'error', message: 'TypeError: x is undefined' }), true);
  assert.equal(ev.observeEvent({ kind: 'nope' }), false);
  ev.observeMemory({ rss: 420, loopP99: 120 }); ev.observeMemory({ rss: 460, loopP99: 600 });
  const d = await ev.digest();
  assert.equal(d.requests, 32); assert.equal(d.timeouts, 1);
  const live = d.busiest.find((r) => r.route === 'live');
  assert.equal(live.n, 31); assert.equal(live.timeouts, 1); assert.ok(live.p95 >= 380);
  assert.equal(d.tools[0].id, 'mem-algo-toggle'); assert.equal(d.tools[0].opens, 2); assert.equal(d.tools[0].phonePct, 50);
  assert.deepEqual(d.devices, { phone: 1, desktop: 0, discord: 1, web: 0 });
  assert.equal(d.visits.avgMinutes, 1.5);
  assert.equal(d.errors[0].n, 1);
  assert.equal(d.memory.rssMax, 460); assert.equal(d.memory.loopP99Max, 600);
  for (let i = 0; i < 200; i++) ev.observeRoute('/academy-activity/r' + i, 200, 1);
  assert.ok(Object.keys(ev.state.ledger.routes).length <= 160, 'the route map is bounded');
});

test('knobs turn only inside their rails from the evidence, never when pinned, and every turn is written down', async () => {
  let clock = T0;
  const ev = createEvolve({ now: () => clock, logger: () => {} });
  for (let i = 0; i < 25; i++) ev.observeRoute('/academy-activity/live?symbol=SPY', 200, 3_000);
  ev.observeMemory({ rss: 470, loopP99: 900 });
  const turns = ev.tune(await ev.digest());
  assert.ok(turns.includes('livePollMs') && turns.includes('squeezeConcurrency') && turns.includes('squeezeMaxSymbols'));
  assert.equal(ev.knob('livePollMs'), 3_500); assert.equal(ev.knob('squeezeConcurrency'), 3); assert.equal(ev.knob('squeezeMaxSymbols'), 100);
  assert.equal(ev.state.turns.length, 3); assert.match(ev.state.turns[0].reason, /live p95 3000 ms/);
  /* pressure keeps coming: the knobs stop at their floors */
  for (let i = 0; i < 6; i++) { ev.observeMemory({ rss: 480, loopP99: 900 }); ev.tune(await ev.digest()); }
  assert.equal(ev.knob('squeezeConcurrency'), 1); assert.equal(ev.knob('squeezeMaxSymbols'), 60);
  assert.deepEqual(ev.setKnob('livePollMs', 99_999, { pinned: true }), { value: 8_000, pinned: true }, 'the owner cannot leave the rail either');
  ev.tune(await ev.digest());
  assert.equal(ev.knob('livePollMs'), 8_000, 'a pinned knob is left alone');
  assert.equal(ev.setKnob('nope', 1), null);
  assert.deepEqual(Object.keys(ev.config()), ['livePollMs', 'squeezeConcurrency', 'squeezeMaxSymbols', 'sentimentTtlMs']);
});

test('the brief: digest to the model, proposals adopted (small low-risk auto ones approved), knob suggestions railed, state persisted and the ledger rolled over', async () => {
  let clock = T0; const calls = []; const logs = [];
  const store = memStore();
  const model = { summary: 'Members mostly used MEM ALGO and the chain; the live route was slow.', proposals: [
    { title: 'Cache the live book for 2 s', evidence: 'live p95 3000 ms', change: 'memoize mergeLive per symbol', effect: 'quote updates stop stalling', risk: 'low', size: 'S', auto: true, area: 'speed' },
    { title: 'Rewrite the options desk', evidence: 'n/a', change: 'big refactor', effect: 'nicer', risk: 'high', size: 'L', auto: true, area: 'navigation' },
    { title: 'Cache the live book for 2 s', evidence: 'dup', change: 'dup', effect: 'dup', risk: 'low', size: 'S', auto: true, area: 'speed' }
  ], knobs: [{ knob: 'sentimentTtlMs', value: 50_000_000, why: 'reads are slow' }, { knob: 'notAKnob', value: 1, why: '' }] };
  const fetchImpl = async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(model) + '\n```' }] }) }; };
  const ev = createEvolve({ store, ai: { apiKey: 'k', model: 'claude-sonnet-5-5' }, fetchImpl, now: () => clock, logger: (l, e, x) => logs.push([e, x]), sources: { outcomes: async () => ({ hitRate: 0.61 }), broken: async () => { throw new Error('x'); } } });
  for (let i = 0; i < 25; i++) ev.observeRoute('/academy-activity/live?symbol=SPY', 200, 3_000);
  ev.observeEvent({ kind: 'tool', id: 'chain-toggle', on: true });
  const brief = await ev.runBrief({ reason: 'owner' });
  assert.equal(calls[0].model, 'claude-sonnet-5-5'); assert.match(calls[0].messages[0].content, /"outcomes":\{"hitRate":0\.61\}/, 'extra sources ride in the digest');
  assert.doesNotMatch(calls[0].messages[0].content, /broken/, 'a failing source is left out');
  assert.equal(brief.summary, model.summary); assert.equal(brief.model, 'claude-sonnet-5-5');
  assert.equal(brief.proposalIds.length, 2, 'the duplicate title is not adopted twice');
  const snap = await ev.snapshot();
  const small = snap.proposals.find((p) => p.title === 'Cache the live book for 2 s'), big = snap.proposals.find((p) => p.title === 'Rewrite the options desk');
  assert.equal(small.status, 'approved', 'size S, low risk, auto: approved on arrival'); assert.equal(big.status, 'proposed', 'auto is refused for a large high-risk change');
  assert.equal(snap.proposals[0].id, small.id, 'approved proposals come first for the builder');
  assert.equal(ev.knob('sentimentTtlMs'), 600_000, 'the model\'s knob is railed at its ceiling');
  assert.ok(brief.turns.includes('livePollMs') && brief.turns.includes('sentimentTtlMs'));
  assert.equal(ev.state.ledger.routes.live, undefined, 'the ledger rolled over');
  assert.equal(store.get().briefs.length, 1); assert.equal(store.get().proposals.length, 2); assert.equal(store.get().knobs.sentimentTtlMs.value, 600_000);
  /* the owner works the queue */
  assert.equal(ev.setProposal(big.id, 'dismissed').status, 'dismissed'); assert.equal(ev.setProposal(big.id, 'weird'), null); assert.equal(ev.setProposal('nope', 'approved'), null);
  assert.equal(ev.setProposal(small.id, 'shipped').status, 'shipped');
  const after = await ev.snapshot();
  assert.equal(after.proposals.length, 0); assert.equal(after.done[0].id, small.id);
  /* a fresh instance loads what was saved */
  const again = createEvolve({ store, now: () => clock, logger: () => {} });
  const loaded = await again.snapshot();
  assert.equal(loaded.done[0].title, small.title); assert.equal(again.knob('sentimentTtlMs'), 600_000); assert.equal(loaded.briefs.length, 1);
  /* due once a day in the quiet hour */
  assert.equal(ev.due(), false, 'just ran');
  clock = T0 + 24 * 3_600_000; assert.equal(ev.due(), true);
  clock = T0 + 25 * 3_600_000; assert.equal(ev.due(), false, 'not the quiet hour');
});

test('without a key or when the model fails, a rules brief still lands with proposals from the failing and slow routes', async () => {
  let clock = T0; const logs = [];
  const ev = createEvolve({ now: () => clock, logger: (l, e, x) => logs.push([e, x]), ai: { apiKey: 'k' }, fetchImpl: async () => ({ ok: false, status: 529 }) });
  for (let i = 0; i < 12; i++) ev.observeRoute('/academy-activity/sentiment?symbol=SPY', i < 4 ? 503 : 200, 7_000);
  ev.observeEvent({ kind: 'error', message: 'ReferenceError: foo' });
  const brief = await ev.runBrief();
  assert.equal(brief.model, 'rules'); assert.equal(brief.modelError, 'anthropic_529');
  assert.match(brief.summary, /sentiment 7000 ms/);
  const snap = await ev.snapshot();
  assert.ok(snap.proposals.some((p) => /sentiment failing/.test(p.title)));
  assert.ok(snap.proposals.some((p) => p.title === 'Fix the most common page error' && p.status === 'approved'));
  assert.equal(ev.knob('sentimentTtlMs'), 120_000, 'the slow failing sentiment read is cached twice as long');
  assert.ok(logs.some((l) => l[0] === 'academy_evolve_model_failed'));
});
