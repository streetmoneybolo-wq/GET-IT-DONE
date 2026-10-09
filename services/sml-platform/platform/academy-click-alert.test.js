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
function fake({ roles = [ROLE], userCanSend = true, botCanSend = true, mentionEveryone = true, channelFound = true, botCanWebhook = false, webhookFails = false, personas = null, publisher = null, publishUsers = null, extra = {} } = {}) {
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
    directory, personas, publisher, publishUsers, academyGuildId: GUILD, roleIds: [ROLE], limits: { userHour: 3, channelHour: 10, userDay: 10 }, ...extra
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
  const dflt = await fake().svc.send({ userId: USER, displayName: 'Ana' }, body({ target: lastClose * 1.09 }));
  assert.equal(dflt.mentioned, true, 'everyone by default when nothing was said');
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

test('a member with their own bot uses it for everything: listing, checks and the post; if it is not in that server the alert is not sent as the shared app', async () => {
  const mk = (can) => ({ posts: [], guildsFor: async () => [{ id: GUILD, name: 'Own server' }], sendableChannels: async () => [{ id: CHAN, name: 'obi-alerts', mentionEveryone: true }], postingIn: async () => (can ? { guildId: GUILD, userCanSend: true, userCanAttach: true, botCanSend: true, botCanAttach: true, mentionEveryone: true } : null), post: async function (c, b, f) { this.posts.push({ b, f }); return { id: '666666666666666666', channelId: c }; } });
  const own = mk(true);
  const a = fake({ botCanWebhook: true, personas: { [USER]: own } });
  assert.deepEqual((await a.svc.destinations(USER)).map((g) => g.name), ['Own server'], 'servers come from their own bot');
  assert.equal((await a.svc.channels(USER, GUILD))[0].name, 'obi-alerts');
  const out = await a.svc.send({ userId: USER, displayName: 'Ana' }, body());
  assert.equal(out.ok, true); assert.equal(out.postedAs, 'persona');
  assert.equal(own.posts.length, 1); assert.equal(a.posts.length, 0, 'the shared app did not post');
  assert.ok(!/Sent by/.test(own.posts[0].b.content));
  assert.match(own.posts[0].b.content, /⏱ .* ET · price at alert \$/);
  const away = mk(false);
  const b = fake({ botCanWebhook: true, personas: { [USER]: away } });
  const nope = await b.svc.send({ userId: USER, displayName: 'Ana' }, body());
  assert.equal(nope.ok, false); assert.equal(nope.code, 'channel_unavailable'); assert.equal(b.posts.length, 0);
});

test('the unavailable StockMarketLoop publishing route is refused without publishing', async () => {
  const calls = [];
  const publisher = { configured: true, groupId: 77, publish: async (o) => { calls.push(o); return { ok: true, postId: 901, images: o.images.length }; } };
  const a = fake({ publisher, publishUsers: new Set([USER]), botCanWebhook: true });
  const out = await a.svc.send({ userId: USER, displayName: 'Obi' }, body({ via: 'site', channelId: '' }));
  assert.equal(out.ok, false); assert.equal(out.status, 410); assert.equal(out.code, 'site_publishing_unavailable');
  assert.equal(a.posts.length, 0); assert.equal(calls.length, 0);
});

/* ---------- PT SMASHED: a higher target after the earlier alert's target was reached ---------- */
function smashService(store, posts) {
  const directory = { guildsFor: async () => [], sendableChannels: async () => [], postingIn: async () => ({ guildId: GUILD, name: 'a', userCanSend: true, botCanSend: true, mentionEveryone: true, userCanAttach: true, botCanAttach: true }), post: async (c, body, files) => { posts.push({ body, files }); return { id: '555555555555555555', channelId: c }; } };
  return CA.createClickAlertService({
    getBars: async (s, tf) => ({ bars: tf === '1D' ? D : tf === '1W' ? D.filter((_, i) => i % 5 === 4) : tf === '15m' ? intraday(200, lastClose, 9e5) : intraday(200, lastClose) }),
    directory, store, freeUserIds: [USER]
  });
}
const prior = (store, extra = {}) => store.record({ userId: USER, guildId: GUILD, channelId: CHAN, messageId: '1', symbol: 'TEST', side: 'long', entry: lastClose * 0.9, target: lastClose * 0.95, stop: lastClose * 0.85, horizon: 'swing', confidence: 'medium', ...extra });

test('a higher target after the earlier target was hit posts as PT SMASHED to everyone with the wide stop and both images', async () => {
  const store = CA.createClickAlertStore(), posts = [];
  await prior(store);
  const svc = smashService(store, posts);
  const p = await svc.preview(USER, { symbol: 'TEST', target: lastClose * 1.08 });
  assert.equal(p.ok, true); assert.ok(p.analysis.smashed, 'detected');
  assert.match(p.analysis.alertText, /𝐏𝐓 𝐒𝐌𝐀𝐒𝐇𝐄𝐃/); assert.match(p.analysis.alertText, /𝐖𝐈𝐃𝐄 𝐒𝐓𝐎𝐏 𝐋𝐎𝐒𝐒: Below \$/);
  assert.match(p.analysis.alertTextWithMention, /^@everyone\n/);
  const out = await svc.send({ userId: USER, displayName: 'Ana' }, { symbol: 'TEST', target: lastClose * 1.08, channelId: CHAN });
  assert.equal(out.ok, true); assert.equal(out.smashed, true); assert.equal(out.mentioned, true, 'everyone by default');
  assert.match(posts[0].body.content, /^@everyone\n🔥 𝐓𝐄𝐒𝐓 𝐏𝐓 𝐒𝐌𝐀𝐒𝐇𝐄𝐃/);
  assert.deepEqual(posts[0].body.allowed_mentions, { parse: ['everyone'] });
  assert.equal(out.imagesAttached, 2);
});

test('PT SMASHED needs the earlier target reached and a further target; the member can force either way', async () => {
  const store = CA.createClickAlertStore(), posts = [];
  const svc = smashService(store, posts);
  assert.equal((await svc.preview(USER, { symbol: 'TEST', target: lastClose * 1.08 })).analysis.smashed, null, 'no earlier alert');
  await prior(store, { target: lastClose * 1.5 });
  assert.equal((await svc.preview(USER, { symbol: 'TEST', target: lastClose * 1.08 })).analysis.smashed, null, 'earlier target not reached');
  const s2 = CA.createClickAlertStore(); await prior(s2); const svc2 = smashService(s2, posts);
  const s3 = CA.createClickAlertStore(); await prior(s3, { side: 'short' });
  assert.equal((await smashService(s3, posts).preview(USER, { symbol: 'TEST', target: lastClose * 1.08 })).analysis.smashed, null, 'an earlier short is not a long update');
  assert.equal((await svc2.preview(USER, { symbol: 'TEST', target: lastClose * 1.08, mode: 'new' })).analysis.smashed, null, 'always a new alert');
  const forced = await svc.preview(USER, { symbol: 'TEST', target: lastClose * 1.08, mode: 'smashed' });
  assert.ok(forced.analysis.smashed.forced); assert.match(forced.analysis.alertText, /𝐏𝐓 𝐒𝐌𝐀𝐒𝐇𝐄𝐃/);
});

test('the wide-stop layout matches the member\'s template and a short flips Above/Below', () => {
  const F = require('./academy-alert-format');
  const t = F.formatPtSmashed({ ticker: 'QTEX', newPt: 2.44, plus: true, mention: true, stopLow: 1.98, stopHigh: 2.05, side: 'long' });
  assert.equal(t, ['@everyone', '🔥 𝐐𝐓𝐄𝐗 𝐏𝐓 𝐒𝐌𝐀𝐒𝐇𝐄𝐃 — 𝐍𝐄𝐖 𝐏𝐓 𝐒𝐄𝐓 $𝟐.𝟒𝟒+ 🔥', '🎯 Previous PT smashed — momentum still pushing upward.', '', '👉 🆕 𝐍𝐄𝐖 𝐓𝐀𝐑𝐆𝐄𝐓 𝐙𝐎𝐍𝐄 — $2.44+  ', 'Continuation valid — strong extension forming.', '', '⚠️ 𝐇𝐈𝐆𝐇‑𝐑𝐈𝐒𝐊 𝐙𝐎𝐍𝐄  ', 'Volatility elevated — consider majority profits as we push deeper into extended territory.', '', '🚨 𝐖𝐈𝐃𝐄 𝐒𝐓𝐎𝐏 𝐋𝐎𝐒𝐒: Below $1.98–$2.05 (wide buffer for QTEX volatility)'].join('\n'));
  assert.match(F.formatPtSmashed({ ticker: 'X', newPt: 5, plus: true, stopLow: 5.4, stopHigh: 5.6, side: 'short' }), /Above \$5\.40–\$5\.60/);
});

test('an alert goes to @everyone by default, and only a deliberate "no" or a channel that does not allow it leaves it out', async () => {
  const a = fake(); // the member and the app may ping here
  const out = await a.svc.send({ userId: USER, displayName: 'Ana' }, body({ target: lastClose * 1.11 }));
  assert.equal(out.ok, true); assert.equal(out.mentioned, true);
  assert.match(a.posts[0].body.content, /^@everyone\n/); assert.deepEqual(a.posts[0].body.allowed_mentions, { parse: ['everyone'] });
  const off = fake();
  const no = await off.svc.send({ userId: USER, displayName: 'Ana' }, body({ target: lastClose * 1.12, mention: false }));
  assert.equal(no.mentioned, false); assert.ok(!off.posts[0].body.content.includes('@everyone'));
  const blocked = fake({ mentionEveryone: false });
  const b = await blocked.svc.send({ userId: USER, displayName: 'Ana' }, body({ target: lastClose * 1.13 }));
  assert.equal(b.mentioned, false); assert.equal(b.mentionRequestedButNotAllowed, true);
  assert.ok(!blocked.posts[0].body.content.includes('@everyone'));
});

/* ---------- options ALERT mode: the stock target derived from a double-clicked contract ---------- */
test('autoTargetForContract: a call targets the next resistance above price and breakeven that is reachable before expiry', () => {
  // price 100, IV 30%, 30 days: one expected move is about 8.6, reach is about 12.9
  const levels = [{ price: 101, text: 'swing high' }, { price: 104, text: 'supply block' }, { price: 106, text: 'equal highs x2' }, { price: 130, text: 'swing high' }, { price: 95, text: 'swing low' }];
  const r = CA.autoTargetForContract({ type: 'call', price: 100, strike: 100, premium: 3, iv: 0.3, dte: 30, levels });
  assert.equal(r.ok, true); assert.equal(r.basis, 'level');
  assert.equal(r.breakeven, 103);
  assert.equal(r.target, 104, 'the first level above max(price, breakeven 103)');
  assert.match(r.targetBasis, /^next resistance at \$104\.00 \(supply block\)$/);
  // IV given in percent is read the same way
  assert.equal(CA.autoTargetForContract({ type: 'C', price: 100, strike: 100, premium: 3, iv: 30, dte: 30, levels }).target, 104);
});

test('autoTargetForContract: with no reachable level a call targets breakeven + one expected move', () => {
  const r = CA.autoTargetForContract({ type: 'call', price: 100, strike: 105, premium: 2, iv: 0.3, dte: 30, levels: [{ price: 130, text: 'swing high' }, { price: 106, text: 'gap' }] });
  const em = 100 * 0.3 * Math.sqrt(30 / 365);
  assert.equal(r.ok, true); assert.equal(r.basis, 'expected_move');
  assert.equal(r.target, Math.round((107 + em) * 100) / 100);
  assert.match(r.targetBasis, /^breakeven \$107\.00 \+ 1 expected move \(\$8\.60 over 30 days\)$/);
  // a deep in-the-money call (already past breakeven) measures from the live price, so the target stays above it
  const itm = CA.autoTargetForContract({ type: 'call', price: 100, strike: 80, premium: 19, iv: 0.3, dte: 30, levels: [] });
  assert.ok(itm.target > 100); assert.match(itm.targetBasis, /^live price \$100\.00 \+ 1 expected move/);
  // a far lottery call is capped so the analysis can still run
  const far = CA.autoTargetForContract({ type: 'call', price: 10, strike: 60, premium: 0.05, iv: 2, dte: 300, levels: [] });
  assert.equal(far.capped, true); assert.equal(far.target, 35);
});

test('autoTargetForContract: a put mirrors it (support below price and strike - premium, else breakeven - one expected move)', () => {
  const levels = [{ price: 99, text: 'swing low' }, { price: 96, text: 'demand block' }, { price: 93, text: 'equal lows x3' }, { price: 70, text: 'swing low' }, { price: 104, text: 'swing high' }];
  const r = CA.autoTargetForContract({ type: 'put', price: 100, strike: 100, premium: 3, iv: 0.3, dte: 30, levels });
  assert.equal(r.ok, true); assert.equal(r.breakeven, 97);
  assert.equal(r.target, 96); assert.match(r.targetBasis, /^next support at \$96\.00 \(demand block\)$/);
  const none = CA.autoTargetForContract({ type: 'put', price: 100, strike: 95, premium: 2, iv: 0.3, dte: 30, levels: [{ price: 70, text: 'swing low' }] });
  const em = 100 * 0.3 * Math.sqrt(30 / 365);
  assert.equal(none.basis, 'expected_move'); assert.equal(none.target, Math.round((93 - em) * 100) / 100);
  assert.match(none.targetBasis, /^breakeven \$93\.00 - 1 expected move/);
  assert.ok(none.target > 0);
});

test('autoTargetForContract: refuses what it cannot price', () => {
  assert.equal(CA.autoTargetForContract({ type: 'call', price: 0, strike: 100, premium: 1, iv: 0.3, dte: 10 }).code, 'no_live_price');
  assert.equal(CA.autoTargetForContract({ type: 'x', price: 100, strike: 100, premium: 1, iv: 0.3, dte: 10 }).code, 'invalid_contract');
  assert.equal(CA.autoTargetForContract({ type: 'call', price: 100, strike: 100, premium: 1, iv: 0.3, dte: 0 }).code, 'contract_expired');
  assert.equal(CA.autoTargetForContract({ type: 'call', price: 100, strike: 100, premium: 1, iv: null, dte: 10 }).code, 'contract_not_priced');
});

/* ---------- the Stock / Option chooser on the ALERT panel: the contract picker's chain and the earnings + news catalyst check ---------- */
const calcPx = require('./academy-options-calc');
const isoDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const EXP_NEAR = isoDays(30), EXP_FAR = isoDays(60), EXP_LISTED = isoDays(90);
function chainRows(expiry, days, raw = false) {
  const T = days / 365, out = [];
  for (let k = Math.round(lastClose * 0.85); k <= lastClose * 1.25; k += Math.max(1, Math.round(lastClose * 0.03))) {
    const leg = (t) => { const p = calcPx.price(t, lastClose, k, T, 0.043, 0, 0.3).price; return { bid: +(p * 0.98).toFixed(2), ask: +(p * 1.02).toFixed(2), iv: 0.3, oi: 900, volume: 200 }; };
    out.push(raw ? { strike: k, expiration: expiry, call: leg('call'), put: leg('put') } : { expiry, strike: k, call: leg('call'), put: leg('put') });
  }
  return out;
}
const optionsExtra = (catalysts = null) => ({
  chain: async () => chainRows(EXP_NEAR, 30),
  chainExpiry: async (sym, expiry) => (expiry === EXP_FAR ? chainRows(EXP_FAR, 60, true) : null),
  expirations: async () => [EXP_NEAR, EXP_FAR, EXP_LISTED],
  catalysts
});

test('the picker chain lists every expiration, serves the loaded strikes with live quotes, and fetches an expiration the chain left out', async () => {
  const { svc } = fake({ extra: optionsExtra() });
  const first = await svc.chainFor({ symbol: 'TEST' });
  assert.equal(first.ok, true); assert.equal(first.symbol, 'TEST'); assert.ok(first.price > 0, 'the live price rides along for the ATM marker');
  assert.deepEqual(first.expirations, [EXP_NEAR, EXP_FAR, EXP_LISTED]);
  assert.deepEqual(first.loaded, [EXP_NEAR]);
  assert.ok(first.rows.length > 5 && first.rows.every((r) => r.expiry === EXP_NEAR && r.call.mid > 0 && r.put.mid > 0 && r.call.oi === 900));
  const far = await svc.chainFor({ symbol: 'TEST', expiry: EXP_FAR });
  assert.equal(far.expiry, EXP_FAR); assert.ok(far.rows.length > 5 && far.rows.every((r) => r.expiry === EXP_FAR), 'the missing expiration was fetched and normalised');
  assert.deepEqual(far.loaded, [EXP_NEAR, EXP_FAR]);
  assert.equal((await svc.chainFor({ symbol: 'bad!' })).code, 'invalid_symbol');
  const none = fake().svc; assert.equal((await none.chainFor({ symbol: 'TEST' })).code, 'options_unavailable');
});

test('an options alert picked on the panel is read from the contract, and earnings before expiry plus the week\'s news write the reason into the alert', async () => {
  const earningsSoon = { date: isoDays(12), daysAway: 12 };
  const headlines = [{ title: 'TEST beats on revenue and raises guidance', url: 'https://example.com/a', date: new Date(Date.now() - 864e5).toISOString() }];
  const { svc, posts } = fake({ extra: optionsExtra({ earnings: async () => earningsSoon, news: async () => headlines }) });
  const strike = chainRows(EXP_NEAR, 30).map((r) => r.strike).reduce((a, b) => (Math.abs(b - lastClose * 1.03) < Math.abs(a - lastClose * 1.03) ? b : a));
  const out = await svc.preview(USER, { symbol: 'TEST', contract: { type: 'call', strike, expiry: EXP_NEAR }, autoTarget: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.analysis.autoTarget, true); assert.ok(out.analysis.target > out.analysis.entry, 'a call targets above the live price');
  assert.equal(out.options.contract.type, 'call'); assert.equal(out.options.contract.strike, strike);
  const c = out.catalysts;
  assert.equal(c.earnings.beforeExpiry, true); assert.equal(c.riskBump, true); assert.equal(c.news.positive, 1);
  assert.ok(['caution', 'against'].includes(c.verdict));
  assert.match(out.analysis.alert.riskNote, /^Earnings .* before expiry/);
  assert.match(out.analysis.alert.setup, /News leans with the trade this week: TEST beats/);
  assert.ok(out.analysis.rationale.some((r) => /before this contract expires/.test(r)), 'the reason is in the evidence list');
  assert.match(out.analysis.alertText, /before expiry/); assert.match(out.analysis.alertText, /News leans with the trade/);
  assert.equal(posts.length, 0);
  const sent = await svc.send({ userId: USER, displayName: 'Ana' }, { symbol: 'TEST', contract: { type: 'call', strike, expiry: EXP_NEAR }, autoTarget: true, channelId: CHAN });
  assert.equal(sent.ok, true, JSON.stringify(sent)); assert.deepEqual(sent.catalysts, { verdict: c.verdict, headline: c.headline });
  assert.match(posts[0].body.content, /before expiry/);
});

test('a stock alert gets the same catalyst check, the risk steps up a notch when it says so, and a broken provider never blocks the alert', async () => {
  const quiet = fake({ extra: { catalysts: { earnings: async () => null, news: async () => [] } } });
  const base = await quiet.svc.preview(USER, { symbol: 'TEST', target: lastClose * 1.08 });
  assert.equal(base.ok, true); assert.equal(base.catalysts.available, false); assert.equal(base.catalysts.verdict, 'quiet');
  const flagged = fake({ extra: { catalysts: { earnings: async () => ({ date: isoDays(2), daysAway: 2 }), news: async () => [{ title: 'TEST prices $40M stock offering', date: new Date().toISOString() }] } } });
  const out = await flagged.svc.preview(USER, { symbol: 'TEST', target: lastClose * 1.08 });
  assert.equal(out.ok, true);
  const order = ['low', 'mid', 'mid-high', 'high', 'extreme'];
  assert.equal(order.indexOf(out.analysis.risk), Math.min(4, order.indexOf(base.analysis.risk) + 1), 'risk is one notch higher');
  assert.equal(out.analysis.alert.risk, out.analysis.risk);
  assert.match(out.analysis.alertText, /Red-flag news this week/);
  assert.match(out.analysis.alert.riskNote, /inside the window/);
  const broken = fake({ extra: { catalysts: { earnings: async () => { throw new Error('bridge down'); }, news: () => new Promise(() => {}) } } });
  const t0 = Date.now();
  const ok = await broken.svc.preview(USER, { symbol: 'TEST', target: lastClose * 1.08 });
  assert.equal(ok.ok, true); assert.equal(ok.catalysts.verdict, 'quiet');
  assert.ok(Date.now() - t0 < 6000, 'a hanging provider is cut off by the timeout');
});
