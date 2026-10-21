'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTradingRoom, cleanRoom, canRead, canWrite, tiersFor, adviceFor, TEMPLATES } = require('./academy-trading-room');
const { createTraderAlerts } = require('./academy-trader-alerts');

const OWNER = '111111111111111111', FREE = '222222222222222222', PAID = '333333333333333333', VIP = '444444444444444444', VISITOR = '555555555555555555';
const names = async (id) => ({ [OWNER]: 'Obi', [FREE]: 'Fran', [PAID]: 'Pat', [VIP]: 'Vic', [VISITOR]: 'Vera' }[id] || '');
const setup = () => {
  let t = 1_700_000_000_000;
  const clock = () => t;
  const alerts = createTraderAlerts({ names, now: clock });
  const rooms = createTradingRoom({ traderAlerts: alerts, names, now: clock });
  return { alerts, rooms, tick: (ms) => { t += ms; } };
};

test('cleanRoom: keeps what is valid, drops what is not, and respects the limits', () => {
  const r = cleanRoom({ enabled: true, name: '  My   Room ', tiers: [{ name: 'Gold', prices: { month: 4900, week: -5, year: 'x' } }, { name: 'Gold' }, { name: '' }],
    categories: [{ name: 'Free', channels: [{ name: 'General', type: 'chat', access: 'members' }, { name: 'general' }, { name: 'Odd', type: 'weird', access: 'nope' }, { name: 'Gold chat', type: 'chat', access: 'paid', minTier: 'gold' }, { name: 'Bad tier', access: 'paid', minTier: 'ghost' }] }] });
  assert.equal(r.name, 'My Room'); assert.equal(r.tiers.length, 1); assert.equal(r.tiers[0].prices.month, 4900); assert.equal(r.tiers[0].prices.week, 0);
  const chs = r.categories[0].channels; assert.deepEqual(chs.map((c) => c.id), ['general', 'odd', 'gold-chat', 'bad-tier']);
  assert.equal(chs[1].type, 'chat'); assert.equal(chs[1].access, 'members'); assert.equal(chs[2].minTier, 'gold'); assert.equal(chs[3].minTier, '', 'an unknown tier is dropped');
  const big = cleanRoom({ categories: Array.from({ length: 12 }, (_, i) => ({ name: 'c' + i, channels: Array.from({ length: 5 }, (__, j) => ({ name: 'ch' + i + '-' + j, type: j === 0 ? 'alerts' : 'chat' })) })) });
  assert.equal(big.categories.length, 8); assert.ok(big.categories.flatMap((c) => c.channels).length <= 30); assert.ok(big.categories.flatMap((c) => c.channels).filter((c) => c.type === 'alerts').length <= 6);
});

test('access: public to all, members need a follow, paid needs a grant and a high enough tier, owner sees all', () => {
  const room = cleanRoom({ enabled: true, tiers: [{ name: 'Plus' }, { name: 'VIP' }], categories: [{ name: 'x', channels: [
    { name: 'pub', type: 'announce', access: 'public' }, { name: 'mem', type: 'chat', access: 'members' }, { name: 'any', type: 'chat', access: 'paid' }, { name: 'vip', type: 'chat', access: 'paid', minTier: 'vip' }] }] });
  const [pub, mem, any, vip] = room.categories[0].channels;
  const roles = { visitor: { kind: 'visitor' }, member: { kind: 'member' }, plus: { kind: 'paid', tier: 'plus' }, vip: { kind: 'paid', tier: 'vip' }, legacy: { kind: 'paid', tier: '' }, owner: { kind: 'owner' }, banned: { kind: 'banned' } };
  const row = (c) => Object.fromEntries(Object.entries(roles).map(([k, r]) => [k, canRead(room, c, r)]));
  assert.deepEqual(row(pub), { visitor: true, member: true, plus: true, vip: true, legacy: true, owner: true, banned: true });
  assert.deepEqual(row(mem), { visitor: false, member: true, plus: true, vip: true, legacy: true, owner: true, banned: false });
  assert.deepEqual(row(any), { visitor: false, member: false, plus: true, vip: true, legacy: true, owner: true, banned: false });
  assert.deepEqual(row(vip), { visitor: false, member: false, plus: false, vip: true, legacy: true, owner: true, banned: false }, 'a higher tier includes the lower ones, not the reverse');
  assert.equal(canWrite(room, pub, roles.member), false, 'announcements are the owner’s'); assert.equal(canWrite(room, pub, roles.owner), true);
  assert.equal(canWrite(room, mem, roles.member), true); assert.equal(canWrite(room, mem, roles.visitor), false); assert.equal(canWrite(room, vip, roles.plus), false);
  assert.deepEqual(tiersFor(room, vip), ['vip']); assert.deepEqual(tiersFor(room, any), []);
});

test('templates: every template cleans to itself and is a usable layout', () => {
  for (const [k, t] of Object.entries(TEMPLATES)) {
    const r = cleanRoom({ tiers: t.tiers, categories: t.categories });
    assert.equal(r.categories.length, t.categories.length, k); assert.equal(r.categories.flatMap((c) => c.channels).length, t.categories.flatMap((c) => c.channels).length, k);
    for (const c of r.categories.flatMap((x) => x.channels)) if (c.minTier) assert.ok(r.tiers.some((x) => x.id === c.minTier), k + ' ' + c.id);
  }
});

test('a room with a template: visitors see public doors open and the rest locked with what unlocks them', async () => {
  const { rooms } = setup();
  assert.equal((await rooms.view(VISITOR, OWNER)).error, 'no_room', 'a closed room is invisible');
  await rooms.applyTemplate(OWNER, 'classic'); await rooms.save(OWNER, { enabled: true, name: 'Obi Trades' });
  const v = await rooms.view(VISITOR, OWNER);
  assert.equal(v.ok, true); assert.equal(v.role.kind, 'visitor'); assert.equal(v.room.name, 'Obi Trades');
  const byId = Object.fromEntries(v.categories.flatMap((c) => c.channels).map((c) => [c.id, c]));
  assert.equal(byId.welcome.canRead, true); assert.equal(byId.general.canRead, false); assert.equal(byId['premium-alerts'].canRead, false);
  const locked = await rooms.channelContent(VISITOR, OWNER, 'general'); assert.equal(locked.error, 'locked'); assert.match(locked.unlock.text, /Follow/);
  const lockedPaid = await rooms.channelContent(VISITOR, OWNER, 'vip-chat'); assert.equal(lockedPaid.unlock.need, 'paid');
  assert.equal(v.settings, undefined, 'a visitor never gets the owner’s settings');
});

test('free members follow; paid members hold a grant; each sees exactly their channels and can chat where allowed', async () => {
  const { rooms, alerts, tick } = setup();
  await rooms.applyTemplate(OWNER, 'classic'); await rooms.save(OWNER, { enabled: true });
  await alerts.follow(FREE, OWNER); await alerts.follow(PAID, OWNER);
  await alerts.grantAccess(PAID, OWNER, { plan: 'month', source: 'stockmarketloop', tier: 'premium' });
  assert.equal((await rooms.roleOf(FREE, OWNER)).kind, 'member'); const pr = await rooms.roleOf(PAID, OWNER); assert.equal(pr.kind, 'paid'); assert.equal(pr.tier, 'premium');
  assert.equal((await rooms.channelContent(FREE, OWNER, 'general')).ok, true);
  assert.equal((await rooms.channelContent(FREE, OWNER, 'vip-chat')).error, 'locked');
  assert.equal((await rooms.channelContent(PAID, OWNER, 'vip-chat')).ok, true);
  const said = await rooms.post(FREE, OWNER, 'general', { body: 'hello room' }); assert.equal(said.ok, true); assert.equal(said.post.authorName, 'Fran');
  assert.equal((await rooms.post(FREE, OWNER, 'general', { body: 'again' })).error, 'slow_mode'); tick(5000);
  assert.equal((await rooms.post(FREE, OWNER, 'general', { body: 'again' })).ok, true);
  assert.equal((await rooms.post(FREE, OWNER, 'welcome', { body: 'nope' })).error, 'read_only', 'members cannot post in the owner’s announcements');
  assert.equal((await rooms.post(FREE, OWNER, 'vip-chat', { body: 'sneak' })).error, 'locked');
  assert.equal((await rooms.post(VISITOR, OWNER, 'general', { body: 'x' })).error, 'locked');
  assert.equal((await rooms.post(OWNER, OWNER, 'welcome', { body: 'Welcome in' })).ok, true);
  const read = await rooms.channelContent(VISITOR, OWNER, 'welcome'); assert.equal(read.posts[0].body, 'Welcome in'); assert.equal(read.posts[0].owner, true);
});

test('expired grants fall back to free member, and a ban closes everything but the public doors', async () => {
  const { rooms, alerts } = setup();
  await rooms.applyTemplate(OWNER, 'classic'); await rooms.save(OWNER, { enabled: true });
  await alerts.follow(PAID, OWNER);
  await alerts.grantAccess(PAID, OWNER, { plan: 'day', tier: 'premium' });
  assert.equal((await rooms.roleOf(PAID, OWNER)).kind, 'paid');
  await alerts.revokeAccess(PAID, OWNER); assert.equal((await rooms.roleOf(PAID, OWNER)).kind, 'member');
  await rooms.setBan(OWNER, PAID, true);
  assert.equal((await rooms.roleOf(PAID, OWNER)).kind, 'banned'); assert.equal((await rooms.channelContent(PAID, OWNER, 'general')).error, 'locked'); assert.equal((await rooms.channelContent(PAID, OWNER, 'welcome')).ok, true);
  await rooms.setBan(OWNER, PAID, false); assert.equal((await rooms.roleOf(PAID, OWNER)).kind, 'member');
});

test('tiers: a higher tier includes the lower, and the Alert Chart locks follow the room’s access levels', async () => {
  const { rooms, alerts } = setup();
  await rooms.applyTemplate(OWNER, 'ladder'); await rooms.save(OWNER, { enabled: true });
  const s = await alerts.settingsOf(OWNER);
  const plus = s.channels.find((c) => c.key === 'plus-alerts'); assert.equal(plus.premium, true); assert.deepEqual(plus.tiers, ['plus', 'vip']);
  await alerts.grantAccess(PAID, OWNER, { plan: 'month', tier: 'plus' }); await alerts.grantAccess(VIP, OWNER, { plan: 'month', tier: 'vip' });
  assert.equal((await rooms.channelContent(PAID, OWNER, 'plus-chat')).ok, true); assert.equal((await rooms.channelContent(PAID, OWNER, 'vip-chat')).error, 'locked');
  assert.equal((await rooms.channelContent(VIP, OWNER, 'plus-chat')).ok, true); assert.equal((await rooms.channelContent(VIP, OWNER, 'vip-chat')).ok, true);
  const posted = await alerts.post(OWNER, { symbol: 'NVDA', side: 'long', entry: 100, targets: [105], channel: 'plus-alerts' });
  assert.equal(posted.ok, true);
  const plusView = await rooms.channelContent(PAID, OWNER, 'plus-alerts'); assert.equal(plusView.alerts.length, 1); assert.equal(plusView.alerts[0].locked, false);
  assert.equal((await rooms.channelContent(FREE, OWNER, 'plus-alerts')).error, 'locked');
});

test('offerFor: only an open room, a real tier and a price of $1 or more can be bought', async () => {
  const { rooms } = setup();
  assert.equal((await rooms.offerFor(OWNER, 'premium', 'month')).error, 'no_room');
  await rooms.applyTemplate(OWNER, 'classic'); await rooms.save(OWNER, { enabled: true });
  assert.equal((await rooms.offerFor(OWNER, 'premium', 'month')).error, 'plan_not_offered');
  const cur = await rooms.roomOf(OWNER); cur.tiers[0].prices.month = 4900; cur.tiers[0].prices.week = 50; await rooms.save(OWNER, { tiers: cur.tiers });
  const o = await rooms.offerFor(OWNER, 'premium', 'month'); assert.equal(o.ok, true); assert.equal(o.priceCents, 4900);
  assert.equal((await rooms.offerFor(OWNER, 'premium', 'week')).error, 'plan_not_offered', 'under $1 is not for sale');
  assert.equal((await rooms.offerFor(OWNER, 'ghost', 'month')).error, 'no_tier'); assert.equal((await rooms.offerFor(OWNER, 'premium', 'decade')).error, 'invalid_plan');
  const v = await rooms.view(VISITOR, OWNER); assert.deepEqual(v.tiers[0].prices, { month: 4900 }); assert.equal(v.tiers[0].forSale, true);
});

test('moderation: the owner (or the author) removes a post, only the owner pins, and the member list shows free and paid', async () => {
  const { rooms, alerts, tick } = setup();
  await rooms.applyTemplate(OWNER, 'classic'); await rooms.save(OWNER, { enabled: true });
  await alerts.follow(FREE, OWNER); await alerts.follow(PAID, OWNER); await alerts.grantAccess(PAID, OWNER, { plan: 'week', tier: 'premium' });
  const a = await rooms.post(FREE, OWNER, 'general', { body: 'spam' }); tick(5000); const b = await rooms.post(PAID, OWNER, 'vip-chat', { body: 'keep' });
  assert.equal((await rooms.removePost(PAID, OWNER, a.post.id)).error, 'not_yours'); assert.equal((await rooms.removePost(OWNER, OWNER, a.post.id)).ok, true);
  assert.equal((await rooms.pinPost(PAID, OWNER, b.post.id)).error, 'not_yours'); assert.equal((await rooms.pinPost(OWNER, OWNER, b.post.id)).ok, true);
  const read = await rooms.channelContent(PAID, OWNER, 'vip-chat'); assert.equal(read.pinned.length, 1);
  assert.equal((await rooms.channelContent(FREE, OWNER, 'general')).posts.length, 0);
  const m = await rooms.members(OWNER); assert.equal(m.total, 2); assert.equal(m.members[0].kind, 'paid'); assert.equal(m.members[0].name, 'Pat'); assert.equal(m.members[1].kind, 'member');
});

test('advice: says in plain words what is missing before the room can sell', () => {
  const ids = (room, ctx) => adviceFor(cleanRoom(room), ctx).map((a) => a.id);
  assert.deepEqual(ids({}, {}), ['template']);
  const t = TEMPLATES.classic;
  const open = cleanRoom({ enabled: true, tiers: t.tiers, categories: t.categories });
  assert.ok(adviceFor(open, { sellerReady: false }).some((a) => a.id === 'price:premium') && adviceFor(open, { sellerReady: false }).some((a) => a.id === 'payouts'));
  open.tiers[0].prices.month = 4900;
  assert.deepEqual(adviceFor(open, { sellerReady: true, followers: 3 }).map((a) => a.id), ['ready']);
  assert.ok(adviceFor(cleanRoom({ enabled: true, categories: [{ name: 'x', channels: [{ name: 'vip', type: 'chat', access: 'paid' }] }] }), {}).some((a) => a.id === 'tier'));
  assert.ok(adviceFor(cleanRoom({ categories: t.categories, tiers: t.tiers }), {}).some((a) => a.id === 'open'));
});

test('the room UI and the owner tools are wired into the page', () => {
  const fs = require('fs'), path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const srv = read('server.js'), ui = read('academy-room-ui.js'), prof = read('academy-profile-ui.js'), dc = read('academy-desktop-compact.js'), nav = read('academy-toolbar-nav.js');
  assert.match(srv, /ACADEMY_PROFILE_UI \+ ACADEMY_ROOM_UI/); assert.match(srv, /sub === '\/checkout'/); assert.match(srv, /rooms: tradingRoom/);
  assert.match(ui, /window\.smlRoom = \{ open: openRoom, door, close \}/); assert.match(ui, /\/checkout/); assert.match(ui, /data-tpl/);
  assert.match(prof, /smlRoom\.door\(/);
  assert.match(dc, /sml-owner-tools/); assert.match(dc, /'evolve-btn', 'squeeze-btn', 'challenge-toggle', 'sml-sig-fab'/); assert.match(nav, /!b\.dataset\.ownerSlot/);
});
