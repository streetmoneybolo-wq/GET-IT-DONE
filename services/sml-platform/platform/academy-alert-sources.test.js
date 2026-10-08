'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAlertSources, createAlertSourceStore, createDiscordDirectory, channelPermissions, canReadWith } = require('./academy-alert-sources');
const { createAlertsService } = require('./academy-alerts');

const G = '100000000000000001', U = '200000000000000002', BOT = '300000000000000003', ROLE = '400000000000000004';
const CH_OPEN = '500000000000000005', CH_VIP = '500000000000000006', CH_VOICE = '500000000000000007';
const VIEW_HISTORY = String((1n << 10n) | (1n << 16n));

test('channel permissions follow Discord: roles, admin, then @everyone, role and member overwrites', () => {
  const roles = [{ id: G, permissions: VIEW_HISTORY }, { id: ROLE, permissions: '0' }];
  const base = { guildId: G, ownerId: 'x', roles, userId: U };
  assert.ok(canReadWith(channelPermissions({ ...base, memberRoles: [], overwrites: [] })));
  const hidden = [{ id: G, type: 0, allow: '0', deny: String(1n << 10n) }];
  assert.ok(!canReadWith(channelPermissions({ ...base, memberRoles: [], overwrites: hidden })), '@everyone denied');
  assert.ok(canReadWith(channelPermissions({ ...base, memberRoles: [ROLE], overwrites: [...hidden, { id: ROLE, type: 0, allow: String(1n << 10n), deny: '0' }] })), 'role overwrite allows');
  assert.ok(!canReadWith(channelPermissions({ ...base, memberRoles: [ROLE], overwrites: [...hidden, { id: ROLE, type: 0, allow: String(1n << 10n), deny: '0' }, { id: U, type: 1, allow: '0', deny: String(1n << 10n) }] })), 'member overwrite wins');
  assert.ok(canReadWith(channelPermissions({ ...base, roles: [{ id: G, permissions: '0' }, { id: ROLE, permissions: String(1n << 3n) }], memberRoles: [ROLE], overwrites: hidden })), 'administrator reads everything');
  assert.ok(canReadWith(channelPermissions({ ...base, ownerId: U, memberRoles: [], overwrites: hidden })), 'the owner reads everything');
});

/* A fake Discord: one server with an open channel, a VIP channel only ROLE can see, and a voice channel. */
function fakeDiscord({ memberRoles = [], messages = [] } = {}) {
  const calls = [];
  const vipOverwrites = [{ id: G, type: 0, allow: '0', deny: String(1n << 10n) }, { id: ROLE, type: 0, allow: String(1n << 10n), deny: '0' }];
  const channels = [
    { id: '600000000000000001', type: 4, name: 'Alerts', position: 1 },
    { id: CH_OPEN, type: 0, name: 'swing-alerts', parent_id: '600000000000000001', position: 1, permission_overwrites: [] },
    { id: CH_VIP, type: 0, name: 'vip', parent_id: '600000000000000001', position: 2, permission_overwrites: vipOverwrites },
    { id: CH_VOICE, type: 2, name: 'voice', position: 3, permission_overwrites: [] }
  ];
  const routes = {
    '/users/@me': { id: BOT }, '/users/@me/guilds?limit=200': [{ id: G, name: 'House of Traders' }],
    [`/guilds/${G}`]: { owner_id: '9', roles: [{ id: G, permissions: VIEW_HISTORY }, { id: ROLE, permissions: '0' }] },
    [`/guilds/${G}/members/${U}`]: { roles: memberRoles }, [`/guilds/${G}/members/${BOT}`]: { roles: [ROLE] },
    [`/guilds/${G}/channels`]: channels,
    [`/channels/${CH_OPEN}`]: { guild_id: G, name: 'swing-alerts', type: 0 }, [`/channels/${CH_VIP}`]: { guild_id: G, name: 'vip', type: 0 },
    [`/channels/${CH_OPEN}/messages?limit=100`]: messages
  };
  const fetchImpl = async (url) => {
    const path = url.replace('https://discord.com/api/v10', ''); calls.push(path);
    if (!(path in routes)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[path] };
  };
  return { fetchImpl, calls };
}

test('the directory lists only shared servers and channels both the member and the bot can read', async () => {
  const plain = createDiscordDirectory({ tokens: [{ label: 'academy', token: 't' }], fetchImpl: fakeDiscord().fetchImpl });
  assert.deepEqual((await plain.guildsFor(U, G)).map((g) => [g.name, g.current]), [['House of Traders', true]]);
  assert.deepEqual((await plain.readableChannels(G, U)).map((c) => c.name), ['swing-alerts'], 'no VIP channel without the role, no voice channel');
  assert.equal(await plain.canRead(U, CH_VIP), false);
  const vip = createDiscordDirectory({ tokens: [{ label: 'academy', token: 't' }], fetchImpl: fakeDiscord({ memberRoles: [ROLE] }).fetchImpl });
  assert.deepEqual((await vip.readableChannels(G, U)).map((c) => [c.name, c.category]), [['swing-alerts', 'Alerts'], ['vip', 'Alerts']]);
  assert.equal(await vip.canRead(U, CH_VIP), true);
  assert.equal(await vip.readableChannels(G, '200000000000000999'), null, 'not a member of that server');
});

test('members follow their own sources; the desk only shows those, and the owner streams keep their tiering', async () => {
  const at = (h) => new Date(Date.parse('2026-09-24T15:00:00Z') - h * 3600_000).toISOString();
  const messages = [
    { id: '700000000000000003', content: '$AAPL entry 180 pt 195', timestamp: at(1), author: { id: '800000000000000001', username: 'ace' } },
    { id: '700000000000000002', content: 'BUY $NVDA @ 120 PT 135', timestamp: at(2), author: { id: '800000000000000002', username: 'bo' } },
    { id: '700000000000000001', content: 'gm everyone', timestamp: at(3), author: { id: '800000000000000002', username: 'bo' } }
  ];
  const discord = fakeDiscord({ messages });
  const directory = createDiscordDirectory({ tokens: [{ label: 'academy', token: 't' }], fetchImpl: discord.fetchImpl });
  const alerts = createAlertsService({ channels: [], now: () => Date.parse('2026-09-24T15:00:00Z') });
  const store = createAlertSourceStore();
  const sources = createAlertSources({ store, directory, alerts, presets: [{ key: 'swings', id: '938944129348558848', mirrorId: '1547569293510705242' }] });

  assert.deepEqual((await sources.list(U)).sources, [], 'the desk starts empty');
  const preview = await sources.preview(U, CH_OPEN);
  assert.deepEqual(preview.alerts.map((a) => a.symbol), ['AAPL', 'NVDA']);
  assert.deepEqual(preview.posters.map((p) => [p.name, p.alerts, p.posts]), [['bo', 1, 2], ['ace', 1, 1]]);
  assert.equal(await sources.preview(U, CH_VIP), null, 'no preview of a channel the member can not read');
  await assert.rejects(sources.add(U, { channel: CH_VIP }), (e) => e.code === 'no_access');

  // follow only "bo" in the open channel, and the owner's swings stream
  const after = await sources.add(U, { channel: CH_OPEN, author: '800000000000000002' });
  assert.equal(after.sources[0].label, '#swing-alerts'); assert.equal(after.sources[0].guildName, 'House of Traders'); assert.equal(after.sources[0].authorName, 'bo');
  await sources.add(U, { channel: '938944129348558848' });
  assert.deepEqual(alerts.channels.map((c) => [c.key, c.premium, c.mirrorId]), [[CH_OPEN, false, ''], ['938944129348558848', true, '1547569293510705242']]);

  for (const m of messages) alerts.ingest(CH_OPEN, m);
  alerts.ingest('938944129348558848', { id: '710000000000000001', content: '@everyone GDC entry 2 pt 2.33 plus', timestamp: at(1), author: { id: '800000000000000009', username: 'gm' } });
  // pretend every alert has been evaluated so the snapshot can show it
  for (const a of alerts.active()) alerts.evaluated.set(a.id, { alert: a, quote: null, risk: { score: 10, band: 'LOW', label: 'low', top: [], flags: [], coverage: 100, factors: [] }, plan: { action: 'HOLD', target: a.target, stop: a.entry * 0.9, reasons: [], progress: 0 }, since: null, after: null });

  const live = alerts.snapshot({ sources: await sources.viewFor(U, 'live') });
  assert.deepEqual(live.alerts.map((a) => a.symbol).sort(), ['GDC', 'NVDA'], 'only bo from the open channel, plus the owner stream');
  const free = alerts.snapshot({ sources: await sources.viewFor(U, 'teaser') });
  assert.deepEqual(free.alerts.map((a) => a.symbol), ['NVDA'], 'a free session sees the member-added channel live, the owner stream as a count');
  assert.equal(free.teaser.count, 1);
  assert.equal(alerts.allows('700000000000000003', await sources.viewFor(U)), null, 'a poster the member did not follow can not be opened');

  await sources.remove(U, { channel: CH_OPEN, author: '800000000000000002' });
  assert.deepEqual(alerts.channels.map((c) => c.key), ['938944129348558848'], 'a channel nobody follows is no longer polled');
  assert.equal([...alerts.alerts.values()].filter((a) => a.source === CH_OPEN).length, 0);
});

test('a linked site member gets their own desk at their Academy level; a group can raise it, never lower it', async () => {
  const OWNER_STREAM = '938944129348558848';
  const alerts = createAlertsService({ channels: [] });
  const directory = { canRead: async (u, c) => c !== '500000000000000077', channelInfo: async (id) => ({ id, guildId: G, name: 'c', type: 0 }), guild: async () => ({ name: 'S' }), recent: async () => [] };
  const tiers = { [U]: 'academy', '400000000000000002': 'free' };
  const sources = createAlertSources({ store: createAlertSourceStore(), directory, alerts, alertsTiering: true, tierFor: async (id) => tiers[id] || 'none',
    presets: [{ key: 'swings', id: OWNER_STREAM, mirrorId: '' }] });
  await sources.add(U, { channel: OWNER_STREAM });
  await sources.add(U, { channel: '500000000000000010' });
  const mine = await sources.siteDesk(U);
  assert.equal(mine.view, 'closed', 'an academy-tier member sees the owner stream as case studies');
  assert.deepEqual(mine.sources.map((s) => [s.channelId, s.view]), [[OWNER_STREAM, 'closed'], ['500000000000000010', 'live']]);
  const inGroup = await sources.siteDesk(U, 'live');
  assert.equal(inGroup.view, 'live', 'a premium group grant raises the owner stream to live');
  assert.equal((await sources.siteDesk(U, 'teaser')).view, 'closed', 'a group never lowers the Academy level');
  const stranger = await sources.siteDesk('400000000000000003');
  assert.deepEqual(stranger.sources, [], 'someone who follows nothing gets an empty desk, not the global one');
  const groupOnly = await sources.siteDesk('400000000000000002', 'live');
  assert.deepEqual(groupOnly.sources.map((s) => [s.channelId, s.view]), [[OWNER_STREAM, 'live']], 'inside a group the owner streams are always on the desk');
  assert.deepEqual((await sources.siteDesk('nope')).sources, []);
});

test('one desk follows at most 12 sources', async () => {
  const alerts = createAlertsService({ channels: [] });
  const directory = { canRead: async () => true, channelInfo: async (id) => ({ id, guildId: G, name: 'c' + id.slice(-2), type: 0 }), guild: async () => ({ name: 'S' }), recent: async () => [] };
  const sources = createAlertSources({ store: createAlertSourceStore(), directory, alerts });
  for (let i = 10; i < 22; i++) await sources.add(U, { channel: '5000000000000000' + i });
  await assert.rejects(sources.add(U, { channel: '500000000000000099' }), RangeError);
  await assert.rejects(sources.add(U, { channel: 'nope' }), TypeError);
});

test('posting under a member: one webhook is made and reused, and the post carries their name and avatar (a name Discord forbids is cleaned)', async () => {
  const d = fakeDiscord(), seen = [];
  const base = d.fetchImpl;
  const fetchImpl = async (url, init = {}) => {
    const path = url.replace('https://discord.com/api/v10', '');
    if (path === `/channels/${CH_OPEN}/webhooks` && !init.method) return { ok: true, status: 200, json: async () => [] };
    if (path === `/channels/${CH_OPEN}/webhooks` && init.method === 'POST') { seen.push(['make', JSON.parse(init.body)]); return { ok: true, status: 200, json: async () => ({ id: '700000000000000007', token: 'tok-abc' }) }; }
    if (path.startsWith('/webhooks/700000000000000007/tok-abc')) { seen.push(['post', JSON.parse(init.body)]); return { ok: true, status: 200, json: async () => ({ id: '800000000000000008', channel_id: CH_OPEN }) }; }
    if (path === `/users/${U}`) return { ok: true, status: 200, json: async () => ({ id: U, username: 'ace', global_name: 'Ace', avatar: 'abc123' }) };
    return base(url, init);
  };
  const dir = createDiscordDirectory({ tokens: [{ label: 'academy', token: 't' }], fetchImpl });
  const first = await dir.postAsMember(CH_OPEN, { content: 'hi' }, [], { userId: U, displayName: 'Ace Discord #1' });
  await dir.postAsMember(CH_OPEN, { content: 'again' }, [], { userId: U, displayName: 'Ace' });
  assert.equal(first.id, '800000000000000008');
  assert.equal(seen.filter((s) => s[0] === 'make').length, 1, 'the webhook is created once');
  const posts = seen.filter((s) => s[0] === 'post').map((s) => s[1]);
  assert.equal(posts[0].username, 'Ace 1');
  assert.ok(!/discord/i.test(posts[0].username), 'Discord forbids that word in a webhook name');
  assert.equal(posts[0].avatar_url, `https://cdn.discordapp.com/avatars/${U}/abc123.png?size=128`);
  assert.equal(posts[1].username, 'Ace');
});
