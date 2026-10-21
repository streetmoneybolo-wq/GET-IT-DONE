'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEditions, EDITIONS } = require('./academy-editions');

const memStore = () => { let v = null; return { read: async () => v, write: async (n) => { v = JSON.parse(JSON.stringify(n)); }, raw: () => v }; };
const ME = '420000000000000042';

test('a member starts as a Trader, can become an Analyst, and the choice survives a restart', async () => {
  const store = memStore();
  const e = createEditions({ store, now: () => 5 });
  assert.equal(await e.get(ME), 'trader');
  assert.deepEqual(await e.set(ME, 'analyst'), { ok: true, edition: 'analyst' });
  assert.equal(await e.get(ME), 'analyst');
  assert.deepEqual(store.raw().users[ME], { edition: 'analyst', at: 5 });
  assert.equal(await createEditions({ store }).get(ME), 'analyst');
  assert.equal((await e.set(ME, 'wizard')).code, 'invalid_edition');
  assert.equal((await e.set('nope', 'analyst')).code, 'invalid_user');
  assert.equal(await e.get('nope'), 'trader');
  assert.deepEqual(Object.keys(EDITIONS), ['trader', 'analyst']);
});

test('the summary says what an Analyst still has to do, and unlocks the Article Desk only when the site account is linked and letters are configured', async () => {
  const e = createEditions({ store: memStore() });
  await e.set(ME, 'analyst');
  const notLinked = await e.summary(ME, { seller: { configured: true, linked: false, connectUrl: 'https://stockmarketloop.com/connect-discord/?lk=x', consented: false, ready: false }, persona: { configured: true, available: false }, letters: { configured: true } });
  assert.equal(notLinked.edition, 'analyst');
  assert.equal(notLinked.analyst.features.article, false); assert.equal(notLinked.analyst.features.clickAlert, true);
  const site = notLinked.analyst.steps.find((s) => s.key === 'site'); assert.equal(site.done, false); assert.match(site.url, /connect-discord/);
  assert.equal(notLinked.analyst.steps.find((s) => s.key === 'letters').done, false);
  const linked = await e.summary(ME, { seller: { configured: true, linked: true, consented: true, ready: true, stripe: { ready: true } }, persona: { configured: true, available: true, bot: { username: 'Obi Alerts' } }, letters: { configured: true } });
  assert.equal(linked.analyst.features.article, true); assert.equal(linked.analyst.features.letters, true);
  assert.ok(linked.analyst.steps.every((s) => s.done), 'every step done');
  assert.match(linked.analyst.steps.find((s) => s.key === 'bot').detail, /go out as Obi Alerts/);
  const trader = createEditions({ store: memStore() });
  const t = await trader.summary(ME, { seller: { configured: true, linked: true }, letters: { configured: true } });
  assert.equal(t.edition, 'trader'); assert.equal(t.analyst.features.article, false, 'a Trader never sees the Article Desk');
  const owner = await trader.summary(ME, { owner: true, letters: { configured: true } });
  assert.equal(owner.analyst.features.article, true, 'the owner always has it');
  assert.equal((await trader.summary(ME, {})).analyst.steps.find((s) => s.key === 'seller').detail, 'Not available on this server.');
});
