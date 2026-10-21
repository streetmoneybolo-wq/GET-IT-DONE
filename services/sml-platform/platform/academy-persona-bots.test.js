'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPersonaBots, cipherFrom, inviteUrl, INVITE_PERMISSIONS } = require('./academy-persona-bots');

const KEY = 'a-persona-encryption-key-of-at-least-32-characters';
const TOKEN = 'fake_bot_token_for_tests_only.abcd.not_a_real_secret_value_xyz';
const memStore = () => { let v = null; return { read: async () => v, write: async (n) => { v = JSON.parse(JSON.stringify(n)); }, raw: () => v }; };
const fakeFetch = (reply) => async (url, opts) => ({ status: reply.status || 200, ok: (reply.status || 200) < 300, json: async () => reply.body });
const dirs = [];
const createDirectory = ({ label, token }) => { const d = { label, token, guildsFor: async () => [{ id: '1', name: 'My server' }], postingIn: async () => ({ guildId: '1', botCanSend: true, botCanAttach: true }) }; dirs.push(d); return d; };

test('the cipher round-trips and refuses a short key', () => {
  const c = cipherFrom(KEY); const blob = c.encrypt(TOKEN);
  assert.notEqual(blob, TOKEN); assert.equal(c.decrypt(blob), TOKEN);
  assert.equal(cipherFrom('short'), null);
  assert.throws(() => c.decrypt('AAAA'));
});

test('a member registers a bot: validated on Discord, stored encrypted, listed in the map Click-to-Alert reads, and never echoed back', async () => {
  const store = memStore();
  const p = createPersonaBots({ store, encryptionKey: KEY, createDirectory, fetchImpl: fakeFetch({ body: { id: '999000000000000999', bot: true, username: 'Obi Alerts', avatar: 'abc' } }), now: () => 1000 });
  assert.equal(p.map['42'], undefined);
  const r = await p.set('420000000000000042', TOKEN);
  assert.equal(r.ok, true); assert.deepEqual(r.bot, { id: '999000000000000999', username: 'Obi Alerts', avatar: 'https://cdn.discordapp.com/avatars/999000000000000999/abc.png?size=128' });
  assert.equal(r.inviteUrl, 'https://discord.com/oauth2/authorize?client_id=999000000000000999&scope=bot&permissions=' + INVITE_PERMISSIONS);
  assert.ok(p.map['420000000000000042'], 'the directory is in the map'); assert.equal(p.map['420000000000000042'].token, TOKEN);
  const stored = store.raw().users['420000000000000042'];
  assert.ok(stored.token && stored.token !== TOKEN && !stored.token.includes('Gabcde'), 'stored encrypted');
  assert.equal(stored.botId, '999000000000000999');
  const st = await p.status('420000000000000042', { channelId: '1551968149132279908' });
  assert.equal(st.available, true); assert.equal(st.own, 'member'); assert.equal(st.bot.username, 'Obi Alerts'); assert.deepEqual(st.guilds, [{ id: '1', name: 'My server' }]); assert.equal(st.posting.botCanAttach, true);
  assert.ok(!JSON.stringify(st).includes(TOKEN), 'the token never leaves the server');
  assert.equal((await p.remove('420000000000000042')).ok, true); assert.equal(p.map['420000000000000042'], undefined); assert.equal(store.raw().users['420000000000000042'], undefined);
  assert.equal((await p.remove('420000000000000042')).code, 'no_persona');
});

test('a stored bot comes back after a restart, and a bad blob is skipped without taking the others down', async () => {
  const store = memStore();
  const a = createPersonaBots({ store, encryptionKey: KEY, createDirectory, fetchImpl: fakeFetch({ body: { id: '1', bot: true, username: 'A' } }) });
  await a.set('100000000000000001', TOKEN);
  store.raw().users['100000000000000002'] = { token: 'garbage', botId: '2' };
  const b = createPersonaBots({ store, encryptionKey: KEY, createDirectory });
  const r = await b.load();
  assert.equal(r.ok, true); assert.equal(r.loaded, 1); assert.equal(b.map['100000000000000001'].token, TOKEN); assert.equal(b.map['100000000000000002'], undefined);
});

test('bad tokens are refused with a reason: shape, a user token, a token Discord rejects, no key on the server', async () => {
  const store = memStore();
  const user = createPersonaBots({ store, encryptionKey: KEY, createDirectory, fetchImpl: fakeFetch({ body: { id: '5', bot: false, username: 'me' } }) });
  assert.equal((await user.set('100000000000000001', 'nope')).code, 'invalid_token');
  assert.equal((await user.set('100000000000000001', 'Bot ' + TOKEN)).code, 'not_a_bot');
  const rejected = createPersonaBots({ store, encryptionKey: KEY, createDirectory, fetchImpl: fakeFetch({ status: 401, body: { message: 'Unauthorized' } }) });
  const r = await rejected.set('100000000000000001', TOKEN); assert.equal(r.code, 'token_rejected'); assert.equal(r.status, 400);
  const noKey = createPersonaBots({ store, encryptionKey: '', createDirectory });
  assert.equal((await noKey.set('100000000000000001', TOKEN)).code, 'no_encryption_key');
  assert.equal((await noKey.status('100000000000000001')).configured, false);
  assert.equal((await user.set('abc', TOKEN)).code, 'invalid_user');
});

test('the owner bot from the environment is in the map from the start and cannot be removed from the page', async () => {
  const p = createPersonaBots({ store: memStore(), encryptionKey: KEY, createDirectory, ownerIds: ['700000000000000007'], ownerToken: TOKEN });
  assert.equal(p.map['700000000000000007'].label, 'persona');
  const st = await p.status('700000000000000007'); assert.equal(st.own, 'owner'); assert.equal(st.available, true);
  assert.equal((await p.remove('700000000000000007')).code, 'owner_bot_fixed');
  assert.equal(inviteUrl('bad'), '');
});
