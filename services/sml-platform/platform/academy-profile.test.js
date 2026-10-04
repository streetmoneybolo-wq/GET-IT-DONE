'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createProfileService } = require('./academy-profile');
const { createLoopKickBridge } = require('./loop-kick-bridge');
const { createDiscordDirectory } = require('./academy-alert-sources');

const ID = '420000000000000042';
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const fakeDirectory = (user) => ({ userProfile: async () => user });
const linkedCard = { display_name: 'Ana Trader', handle: 'ana', avatar: 'https://x/a.png', profile_url: 'https://stockmarketloop.com/members/ana/', channel: { handle: 'ana', url: 'https://stockmarketloop.com/channel/ana/' }, group: { name: 'Ana Swings', url: 'https://stockmarketloop.com/groups/ana-swings', members: '1200' } };

test('the card joins the Discord profile with the linked StockMarketLoop profile', async () => {
  const bridge = { configured: true, profile: async () => ({ ok: true, linked: true, card: linkedCard }) };
  const svc = createProfileService({ directory: fakeDirectory({ id: ID, username: 'ana#1', globalName: 'Ana', avatar: 'abc', banner: '', accentColor: 0x00c47d }), bridge });
  const card = await svc.profile(ID);
  assert.equal(card.discordId, ID);
  assert.equal(card.discord.name, 'Ana'); assert.equal(card.discord.accentColor, '#00c47d'); assert.equal(card.discord.profileUrl, 'https://discord.com/users/' + ID);
  assert.equal(card.site.linked, true); assert.equal(card.site.handle, 'ana');
  assert.equal(card.site.profileUrl, 'https://stockmarketloop.com/members/ana/');
  assert.equal(card.site.channel.url, 'https://stockmarketloop.com/channel/ana/');
  assert.deepEqual(card.site.group, { name: 'Ana Swings', url: 'https://stockmarketloop.com/groups/ana-swings', members: '1200' });
});

test('a member who is not linked still gets a Discord card, and a site outage is reported rather than hidden', async () => {
  const dir = fakeDirectory({ id: ID, username: 'bob', globalName: '', avatar: '', banner: '', accentColor: null });
  const unlinked = await createProfileService({ directory: dir, bridge: { configured: true, profile: async () => ({ ok: true, linked: false, card: null }) } }).profile(ID);
  assert.equal(unlinked.discord.name, 'bob'); assert.deepEqual(unlinked.site, { linked: false });
  const down = await createProfileService({ directory: dir, bridge: { configured: true, profile: async () => ({ ok: false, status: 503 }) } }).profile(ID);
  assert.equal(down.site.linked, false); assert.equal(down.site.unavailable, true);
  const noBridge = await createProfileService({ directory: dir, bridge: null }).profile(ID);
  assert.deepEqual(noBridge.site, { linked: false });
});

test('only https links from the site are passed on, and text is cleaned', async () => {
  const bad = { display_name: '<b>x</b>', handle: 'h', profile_url: 'javascript:alert(1)', channel: { handle: 'h', url: 'http://insecure.example/c' }, group: { name: 'g', url: 'data:text/html,hi' } };
  const svc = createProfileService({ directory: fakeDirectory(null), bridge: { configured: true, profile: async () => ({ ok: true, linked: true, card: bad }) } });
  const card = await svc.profile(ID);
  assert.equal(card.site.profileUrl, ''); assert.equal(card.site.channel, null); assert.equal(card.site.group, null);
  assert.ok(!/[<>]/.test(card.site.name));
  assert.equal(await svc.profile('nope'), null);
});

test('cards are cached so a hover does not hit Discord or the site again', async () => {
  let calls = 0, t = 1_000;
  const svc = createProfileService({ directory: { userProfile: async () => { calls++; return { id: ID, username: 'a', globalName: '', avatar: '', banner: '', accentColor: null }; } }, bridge: null, now: () => t });
  await svc.profile(ID); await svc.profile(ID); assert.equal(calls, 1);
  t += 700_000; await svc.profile(ID); assert.equal(calls, 2);
});

test('the avatar is fetched from Discord\'s CDN and handed over as bytes, with the default avatar as the fallback', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png }; };
  const withAvatar = createProfileService({ directory: fakeDirectory({ id: ID, avatar: 'a_hash1' }), fetchImpl });
  const out = await withAvatar.avatar(ID);
  assert.equal(out.contentType, 'image/png'); assert.deepEqual([...out.bytes], [...png]);
  assert.equal(urls[0], `https://cdn.discordapp.com/avatars/${ID}/a_hash1.png?size=64`);
  const none = createProfileService({ directory: fakeDirectory(null), fetchImpl });
  await none.avatar(ID);
  assert.match(urls[1], /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
  assert.equal(await none.avatar('x'), null);
});

test('an avatar that is not a small image is refused', async () => {
  const mk = (type, size) => createProfileService({ directory: fakeDirectory({ id: ID, avatar: 'h' }), fetchImpl: async () => ({ ok: true, headers: { get: () => type }, arrayBuffer: async () => Buffer.alloc(size, 1) }) });
  assert.equal(await mk('text/html', 100).avatar(ID), null);
  assert.equal(await mk('image/png', 300_000).avatar(ID), null);
  assert.equal(await createProfileService({ directory: fakeDirectory({ id: ID, avatar: 'h' }), fetchImpl: async () => { throw new Error('down'); } }).avatar(ID), null);
});

test('the bridge signs the profile request like the session request and returns only a linked card', async () => {
  const secret = 's'.repeat(40); let seen;
  const bridge = createLoopKickBridge({ baseUrl: 'https://stockmarketloop.com', secret, now: () => 1_700_000_000_000, fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ ok: true, linked: true, card: linkedCard }) }; } });
  const out = await bridge.profile(ID);
  assert.equal(out.ok, true); assert.equal(out.linked, true); assert.equal(out.card.handle, 'ana');
  assert.equal(seen.url, 'https://stockmarketloop.com/wp-json/sml-loop-kick/v1/discord-profile');
  const body = JSON.stringify({ discord_user_id: ID }); assert.equal(seen.init.body, body);
  const expected = crypto.createHmac('sha256', secret).update(`1700000000./wp-json/sml-loop-kick/v1/discord-profile.${crypto.createHash('sha256').update(body).digest('hex')}`).digest('hex');
  assert.equal(seen.init.headers['x-sml-lk-signature'], 'sha256=' + expected);
  assert.equal((await createLoopKickBridge({}).profile(ID)).error, 'loop_kick_unconfigured');
  assert.equal((await bridge.profile('abc')).error, 'invalid_discord_user');
  const notLinked = createLoopKickBridge({ baseUrl: 'https://stockmarketloop.com', secret, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, linked: false }) }) });
  assert.deepEqual(await notLinked.profile(ID), { ok: true, linked: false, card: null });
  const down = createLoopKickBridge({ baseUrl: 'https://stockmarketloop.com', secret, fetchImpl: async () => { throw new Error('x'); } });
  assert.equal((await down.profile(ID)).error, 'loop_kick_unavailable');
});

test('the directory looks a user up through the first bot that can see them', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(init.headers.authorization); return init.headers.authorization === 'Bot b2' ? { ok: true, status: 200, json: async () => ({ id: ID, username: 'ana', global_name: 'Ana', avatar: 'abc123', banner: null, accent_color: 255 }) } : { ok: false, status: 404, json: async () => ({}) }; };
  const dir = createDiscordDirectory({ tokens: [{ label: 'a', token: 'b1' }, { label: 'b', token: 'b2' }], fetchImpl });
  const u = await dir.userProfile(ID);
  assert.deepEqual(u, { id: ID, username: 'ana', globalName: 'Ana', avatar: 'abc123', banner: '', accentColor: 255 });
  await dir.userProfile(ID); assert.equal(calls.length, 2, 'cached after the first lookup');
});
