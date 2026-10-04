'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CA = require('./academy-click-alert');

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
/* a daily series with a known ~2% daily move and a mild up-drift */
function daily(n, price = 100, sigma = 0.02) {
  const out = []; let p = price; const t0 = Date.UTC(2025, 0, 2, 14, 30);
  for (let i = 0; i < n; i++) {
    const r = 0.0005 + (rnd() - 0.5) * 2 * sigma * 1.7; const o = p, c = p * (1 + r);
    out.push({ t: t0 + i * 864e5, o, h: Math.max(o, c) * (1 + rnd() * 0.006), l: Math.min(o, c) * (1 - rnd() * 0.006), c, v: 1e6 + rnd() * 5e5 }); p = c;
  }
  return out;
}
function intraday(n, price, stepMs = 3e5) {
  const out = []; let p = price; const t0 = Date.now() - n * stepMs;
  for (let i = 0; i < n; i++) { const c = p * (1 + (rnd() - 0.5) * 0.002); out.push({ t: t0 + i * stepMs, o: p, h: Math.max(p, c) * 1.0004, l: Math.min(p, c) * 0.9996, c, v: 1e4 + rnd() * 5e3 }); p = c; }
  return out;
}
const D = daily(300);
const M5 = null;
const lastClose = D[D.length - 1].c;
const bars = (price) => ({ daily: D, weekly: D.filter((_, i) => i % 5 === 4), m5: intraday(200, price), m15: intraday(200, price, 9e5), fresh: true });
const run = (pct, extra = {}) => CA.classify({ symbol: 'TEST', target: lastClose * (1 + pct), price: lastClose, bars: bars(lastClose), ...extra });

test('the horizon follows how far the target is in the stock\'s own daily moves', () => {
  assert.equal(CA.horizonForDays(1), 'day');
  assert.equal(CA.horizonForDays(2), 'day');
  assert.equal(CA.horizonForDays(2.1), 'swing');
  assert.equal(CA.horizonForDays(10), 'swing');
  assert.equal(CA.horizonForDays(10.5), 'mid');
  assert.equal(CA.horizonForDays(126), 'mid');
  assert.equal(CA.horizonForDays(127), 'long');
  const small = run(0.01), medium = run(0.08), large = run(0.35), huge = run(1.5);
  for (const r of [small, medium, large, huge]) assert.equal(r.ok, true);
  const order = ['day', 'swing', 'mid', 'long'];
  assert.ok(order.indexOf(small.horizon) <= order.indexOf(medium.horizon));
  assert.ok(order.indexOf(medium.horizon) <= order.indexOf(large.horizon));
  assert.ok(order.indexOf(large.horizon) <= order.indexOf(huge.horizon));
  assert.equal(small.horizon, 'day');
  assert.ok(['mid', 'long'].includes(huge.horizon), 'a +150% target is a mid or long hold, got ' + huge.horizon);
  assert.ok(order.indexOf(huge.horizon) > order.indexOf(small.horizon));
});

test('entry is the live price, the click is the target, and a lower click is a short', () => {
  const up = run(0.05), down = run(-0.05);
  assert.equal(up.entry, lastClose); assert.equal(up.side, 'long'); assert.ok(up.movePct > 0); assert.ok(up.stop < up.entry);
  assert.equal(down.side, 'short'); assert.ok(down.movePct < 0); assert.ok(down.stop > down.entry);
  assert.equal(up.alert.entry, Math.round(lastClose * 100) / 100);
  assert.match(up.alert.stopNote, /trend weakens/); assert.match(down.alert.stopNote, /downtrend fails/);
});

test('the estimate carries its evidence and an educational disclaimer', () => {
  const r = run(0.08);
  assert.ok(r.rationale.length >= 3);
  assert.ok(r.rationale.some((t) => /daily ranges/.test(t)));
  assert.ok(r.rationale.some((t) => /trading days/.test(t)));
  assert.ok(r.expectedDays.low < r.expectedDays.mid && r.expectedDays.mid < r.expectedDays.high);
  assert.ok(['low', 'medium', 'high'].includes(r.confidence));
  assert.match(r.disclaimer, /not a prediction/);
  assert.ok(Array.isArray(r.levels));
});

test('bad clicks and thin data are refused with a reason', () => {
  assert.equal(CA.classify({ symbol: 'bad symbol!', target: 5, price: 5, bars: bars(5) }).code, 'invalid_symbol');
  assert.equal(CA.classify({ symbol: 'X', target: 5, price: 0, bars: bars(5) }).code, 'no_live_price');
  assert.equal(CA.classify({ symbol: 'X', target: -1, price: 5, bars: bars(5) }).code, 'invalid_target');
  assert.equal(run(0.0005).code, 'target_too_close');
  assert.equal(run(5).code, 'target_too_far');
  assert.equal(CA.classify({ symbol: 'X', target: 6, price: 5, bars: { daily: D.slice(0, 10), m5: [], m15: [], weekly: [] } }).code, 'not_enough_history');
});

test('risk steps up with volatility and for sub-dollar stocks', () => {
  assert.equal(CA.riskFor(0.01, 50), 'low');
  assert.equal(CA.riskFor(0.02, 50), 'mid');
  assert.equal(CA.riskFor(0.035, 50), 'mid-high');
  assert.equal(CA.riskFor(0.06, 50), 'high');
  assert.equal(CA.riskFor(0.1, 50), 'extreme');
  assert.equal(CA.riskFor(0.02, 0.5), 'mid-high');
});

test('the alert text is Obi\'s layout with the click as the target', () => {
  const r = run(0.08);
  assert.match(r.alert.ticker, /TEST/);
  const text = require('./academy-alert-format').formatEntryAlert(r.alert);
  assert.match(text, /^@everyone\n🔥 𝐓𝐄𝐒𝐓 𝐄𝐍𝐓𝐑𝐘 \$/);
  assert.match(text, /𝐏𝐓 \$/);
  assert.match(text, /\(𝐒𝐖𝐈𝐍𝐆 𝐓𝐑𝐀𝐃𝐄\)|\(𝐃𝐀𝐘 𝐓𝐑𝐀𝐃𝐄\)|\(𝐌𝐈𝐃 𝐇𝐎𝐋𝐃\)|\(𝐋𝐎𝐍𝐆 𝐓𝐄𝐑𝐌 𝐇𝐎𝐋𝐃\)/);
  assert.match(text, /🚨 𝐒𝐓𝐎𝐏 𝐋𝐎𝐒𝐒:/);
});

/* ---------- the service: entitlement, permissions, limits ---------- */
const GUILD = '111111111111111111', ROLE = '222222222222222222', USER = '333333333333333333', CHAN = '444444444444444444';
const FIX = { m5: null, m15: null };
function fake({ roles = [ROLE], userCanSend = true, botCanSend = true, mentionEveryone = true, channelFound = true, botCanWebhook = false, webhookFails = false, personas = null, publisher = null, publishUsers = null } = {}) {
  const posts = [];
  const directory = {
    memberRolesLive: async () => roles,
    guildsFor: async () => [{ id: GUILD, name: 'Server', current: true }],
    sendableChannels: async () => [{ id: CHAN, name: 'alerts', category: '', mentionEveryone }],
    postingIn: async () => (channelFound ? { guildId: GUILD, name: 'alerts', userCanSend, botCanSend, mentionEveryone, botCanWebhook } : null),
    postAsMember: async (channelId, body, files, who) => { if (webhookFails) throw new Error('boom'); posts.push({ channelId, body, who, asMember: true }); return { id: '555555555555555555', channelId }; },
    post: async (channelId, body) => { posts.push({ channelId, body }); return { id: '555555555555555555', channelId }; }
  };
  const svc = CA.createClickAlertService({
    getBars: async (sym, tf) => { FIX.m5 = FIX.m5 || intraday(200, lastClose); FIX.m15 = FIX.m15 || intraday(200, lastClose, 9e5); return { bars: tf === '1D' ? D : tf === '1W' ? D.filter((_, i) => i % 5 === 4) : tf === '15m' ? FIX.m15 : FIX.m5 }; },
    directory, personas, publisher, publishUsers, academyGuildId: GUILD, roleIds: [ROLE], limits: { userHour: 3, channelHour: 10, userDay: 10 }
  });
  return { svc, posts };
}
const body = (extra = {}) => ({ symbol: 'TEST', target: lastClose * 1.08, channelId: CHAN, ...extra });

test('an unsubscribed member can preview nothing useful to send and cannot send', async () => {
  const { svc, posts } = fake({ roles: [] });
  assert.deepEqual(await svc.entitlement(USER), { configured: true, entitled: false });
  const out = await svc.send({ userId: USER, displayName: 'Ana' }, body());
  assert.equal(out.ok, false); assert.equal(out.status, 402); assert.equal(out.code, 'click_alert_subscription_required');
  assert.equal(posts.length, 0);
});

test('the add-on is off until a role is configured', async () => {
  const svc = CA.createClickAlertService({ getBars: async () => ({ bars: [] }), directory: {}, academyGuildId: '', roleIds: [] });
  assert.equal(svc.configured, false);
  const out = await svc.send({ userId: USER }, body());
  assert.equal(out.code, 'click_alert_not_configured');
});

test('a subscribed member posts in their layout to a channel they and the app can post in', async () => {
  const { svc, posts } = fake();
  const out = await svc.send({ userId: USER, displayName: 'Ana' }, body({ mention: true }));
  assert.equal(out.ok, true); assert.equal(out.mentioned, true);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.content, /^@everyone\n🔥 𝐓𝐄𝐒𝐓 𝐄𝐍𝐓𝐑𝐘/);
  assert.match(posts[0].body.content, /-# Sent by Ana with Click-to-Alert/);
  assert.deepEqual(posts[0].body.allowed_mentions, { parse: ['everyone'] });
});

test('@everyone is dropped when either the member or the app may not ping it', async () => {
  const { svc, posts } = fake({ mentionEveryone: false });
  const out = await svc.send({ userId: USER, displayName: 'Ana' }, body({ mention: true }));
  assert.equal(out.ok, true); assert.equal(out.mentioned, false); assert.equal(out.mentionRequestedButNotAllowed, true);
  assert.ok(!posts[0].body.content.includes('@everyone'));
  assert.deepEqual(posts[0].body.allowed_mentions, { parse: [] });
  const none = await fake().svc.send({ userId: USER, displayName: 'Ana' }, body({ target: lastClose * 1.09 }));
  assert.equal(none.mentioned, false, 'no ping unless asked for');
});

test('the member must be able to post in the channel, and so must the app', async () => {
  assert.equal((await fake({ userCanSend: false }).svc.send({ userId: USER }, body())).code, 'you_cannot_post_there');
  assert.equal((await fake({ botCanSend: false }).svc.send({ userId: USER }, body())).code, 'app_cannot_post_there');
  assert.equal((await fake({ channelFound: false }).svc.send({ userId: USER }, body())).code, 'channel_unavailable');
  assert.equal((await fake().svc.send({ userId: USER }, body({ channelId: 'x' }))).code, 'invalid_channel');
});

test('a repeated alert and a burst are limited, and nothing is posted past the limit', async () => {
  const { svc, posts } = fake();
  assert.equal((await svc.send({ userId: USER, displayName: 'Ana' }, body({ target: lastClose * 1.05 }))).ok, true);
  const dup = await svc.send({ userId: USER, displayName: 'Ana' }, body({ target: lastClose * 1.05 }));
  assert.equal(dup.code, 'duplicate_alert');
  assert.equal((await svc.send({ userId: USER, displayName: 'Ana' }, body({ target: lastClose * 1.06 }))).ok, true);
  assert.equal((await svc.send({ userId: USER, displayName: 'Ana' }, body({ target: lastClose * 1.07 }))).ok, true);
  const over = await svc.send({ userId: USER, displayName: 'Ana' }, body({ target: lastClose * 1.1 }));
  assert.equal(over.code, 'rate_limited'); assert.equal(over.status, 429);
  assert.equal(posts.length, 3);
});

test('a preview shows the estimate and the alert text without posting', async () => {
  const { svc, posts } = fake();
  const out = await svc.preview(USER, { symbol: 'TEST', target: lastClose * 1.2 });
  assert.equal(out.ok, true); assert.equal(out.entitlement.entitled, true);
  assert.ok(out.analysis.alertText && !out.analysis.alertText.includes('@everyone'));
  assert.ok(out.analysis.alertTextWithMention.startsWith('@everyone'));
  assert.equal(posts.length, 0);
  const bad = await svc.preview(USER, { symbol: 'TEST', target: out.analysis.entry * 1.0005 });
  assert.equal(bad.ok, false); assert.equal(bad.code, 'target_too_close');
});

test('a member name cannot inject mentions or markdown into the footer', async () => {
  const { svc, posts } = fake();
  await svc.send({ userId: USER, displayName: '@everyone **evil** <@1>' }, body());
  const footer = posts[0].body.content.split('\n').pop();
  assert.ok(!/@|\*|<|>/.test(footer.replace('-# Sent by ', '')), footer);
});

test('the horizon read is part of the paid add-on: an unsubscribed member gets no preview', async () => {
  const { svc } = fake({ roles: [] });
  const out = await svc.preview(USER, { symbol: 'TEST', target: lastClose * 1.2 });
  assert.equal(out.ok, false); assert.equal(out.status, 402); assert.equal(out.code, 'click_alert_subscription_required');
  assert.ok(!out.analysis, 'no analysis leaks');
});

test('a live Loop Bucks pass unlocks Click-to-Alert even with no subscription role configured', async () => {
  const { createClickAlertService } = require('./academy-click-alert.js');
  let active = false;
  const passes = { configured: true, hasActive: async () => active };
  const svc = createClickAlertService({ getBars: async () => [], directory: null, passes, academyGuildId: '' });
  assert.deepEqual(await svc.entitlement('300000000000000001'), { configured: true, entitled: false });
  active = true;
  assert.deepEqual(await svc.entitlement('300000000000000001'), { configured: true, entitled: true, via: 'loopbucks' });
  assert.equal(svc.configured, true);
});

test('a free user (the owner) is entitled to Click-to-Alert with nothing else configured', async () => {
  const { createClickAlertService } = require('./academy-click-alert.js');
  const svc = createClickAlertService({ getBars: async () => [], directory: null, freeUserIds: new Set(['1087769175453339648']) });
  assert.deepEqual(await svc.entitlement('1087769175453339648'), { configured: true, entitled: true, via: 'owner' });
  assert.equal((await svc.entitlement('300000000000000001')).entitled, false);
});

test('the alert posts under the member\'s own name and picture when the app can make a webhook there, otherwise as the app with a Sent-by line', async () => {
  const a = fake({ botCanWebhook: true });
  const out = await a.svc.send({ userId: USER, displayName: 'Ana' }, body());
  assert.equal(out.ok, true); assert.equal(out.postedAs, 'member');
  assert.equal(a.posts[0].asMember, true); assert.deepEqual(a.posts[0].who, { userId: USER, displayName: 'Ana' });
  assert.ok(!/Sent by/.test(a.posts[0].body.content), 'no Sent-by line when it already shows their name');
  const b = fake({ botCanWebhook: true });
  const asApp = await b.svc.send({ userId: USER, displayName: 'Ana' }, body({ asMe: false }));
  assert.equal(asApp.postedAs, 'app'); assert.ok(/Sent by Ana/.test(b.posts[0].body.content) && !b.posts[0].asMember);
  const c = fake({ botCanWebhook: false });
  assert.equal((await c.svc.send({ userId: USER, displayName: 'Ana' }, body())).postedAs, 'app');
  const d = fake({ botCanWebhook: true, webhookFails: true });
  const fell = await d.svc.send({ userId: USER, displayName: 'Ana' }, body());
  assert.equal(fell.ok, true); assert.equal(fell.postedAs, 'app'); assert.ok(/Sent by Ana/.test(d.posts[0].body.content), 'falls back honestly');
});

test('a member with their own bot posts through it when it is in the server; otherwise the normal path', async () => {
  const mk = (can) => ({ posts: [], postingIn: async () => (can ? { botCanSend: true, botCanAttach: true } : null), post: async function (c, b, f) { this.posts.push({ b, f }); return { id: '666666666666666666', channelId: c }; } });
  const own = mk(true);
  const a = fake({ botCanWebhook: true, personas: { [USER]: own } });
  const out = await a.svc.send({ userId: USER, displayName: 'Ana' }, body());
  assert.equal(out.ok, true); assert.equal(out.postedAs, 'persona');
  assert.equal(own.posts.length, 1); assert.equal(a.posts.length, 0, 'the shared app did not post');
  assert.ok(!/Sent by/.test(own.posts[0].b.content));
  const away = mk(false);
  const b = fake({ botCanWebhook: true, personas: { [USER]: away } });
  assert.equal((await b.svc.send({ userId: USER, displayName: 'Ana' }, body())).postedAs, 'member', 'their bot is not in this server: falls back to the webhook');
});

test('the owner sends through StockMarketLoop: published to the group under their account with the typed text, time, price and the two pictures; others cannot', async () => {
  const calls = [];
  const publisher = { configured: true, groupId: 77, publish: async (o) => { calls.push(o); return { ok: true, postId: 901, images: o.images.length }; } };
  const a = fake({ publisher, publishUsers: new Set([USER]), botCanWebhook: true });
  assert.equal(a.svc.canPublish(USER), true); assert.equal(a.svc.canPublish('999999999999999999'), false);
  const out = await a.svc.send({ userId: USER, displayName: 'Obi' }, body({ via: 'site', channelId: '' }));
  assert.equal(out.ok, true); assert.equal(out.postedAs, 'site'); assert.equal(out.postId, 901);
  assert.equal(a.posts.length, 0, 'nothing posted straight to Discord');
  assert.equal(calls.length, 1); assert.equal(calls[0].discordUserId, USER);
  assert.match(calls[0].body, /⏱ .* ET · price at alert \$/); assert.equal(calls[0].meta.symbol, 'TEST');
  assert.equal(calls[0].images.length, 2); assert.ok(calls[0].images.every((i) => Buffer.isBuffer(i.bytes)));
  const other = fake({ publisher, publishUsers: new Set(['999999999999999999']) });
  const viaDiscord = await other.svc.send({ userId: USER, displayName: 'Ana' }, body({ via: 'site' }));
  assert.equal(viaDiscord.postedAs, 'app', 'not on the list: the normal Discord path');
  const refused = fake({ publisher: { configured: true, groupId: 77, publish: async () => ({ ok: false, status: 403, error: 'not_group_manager' }) }, publishUsers: new Set([USER]) });
  const r = await refused.svc.send({ userId: USER, displayName: 'Obi' }, body({ via: 'site' }));
  assert.equal(r.ok, false); assert.equal(r.code, 'not_group_manager');
});
