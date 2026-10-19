'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyTrial } = require('./academy-trial');
const { createPassStore, createPassService, withPasses } = require('./academy-passes');

const APP = '1551336038713139370';
function fakeResponse() {
  const r = { status: 0, headers: {}, body: '', writeHead(status, headers) { r.status = status; r.headers = headers || {}; }, end(body) { r.body = String(body || ''); } };
  return r;
}
const req = (path, headers = {}) => ({ method: 'GET', headers, socket: { remoteAddress: '10.0.0.1' }, url: path });
const T0 = Date.parse('2026-10-19T00:00:00Z');

test('the trial link: landing, Discord sign-in with a signed state, a 15-day pass once per account, and the Activity link to open', async () => {
  const store = createPassStore();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (/oauth2\/token$/.test(url)) { assert.match(options.body, /grant_type=authorization_code/); assert.match(options.body, /redirect_uri=https%3A%2F%2Facademy.example%2Facademy-activity%2Ftrial%2Fcallback/); return { ok: true, json: async () => ({ access_token: 'at' }) }; }
    if (/users\/@me$/.test(url)) return { ok: true, json: async () => ({ id: '420000000000000042', username: 'ana', global_name: 'Ana' }) };
    throw new Error('unexpected ' + url);
  };
  let t = T0;
  const trial = createAcademyTrial({ clientId: APP, clientSecret: 's3cret', publicUrl: 'https://academy.example/', store, fetchImpl, now: () => t, inviteUrl: 'https://discord.gg/makingeasymoney' });
  assert.equal(trial.configured, true); assert.equal(trial.days, 15);
  assert.equal(trial.link, 'https://academy.example/academy-activity/trial');
  assert.equal(trial.activityUrl, 'https://discord.com/activities/' + APP);
  // landing
  let res = fakeResponse(); assert.equal(await trial.handle(req('/academy-activity/trial'), res, '/academy-activity/trial', new URL('https://academy.example/academy-activity/trial?via=tiktok')), true);
  assert.equal(res.status, 200); assert.match(res.body, /FREE TRIAL · 15 DAYS/); assert.match(res.body, /href="\/academy-activity\/trial\/start\?via=tiktok"/); assert.doesNotMatch(res.body, /s3cret/);
  // start: a redirect to Discord with identify only and a signed state
  res = fakeResponse(); await trial.handle(req('/academy-activity/trial/start'), res, '/academy-activity/trial/start', new URL('https://academy.example/academy-activity/trial/start?via=tiktok'));
  assert.equal(res.status, 302);
  const auth = new URL(res.headers.location);
  assert.equal(auth.origin + auth.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(auth.searchParams.get('scope'), 'identify'); assert.equal(auth.searchParams.get('client_id'), APP);
  assert.equal(auth.searchParams.get('redirect_uri'), 'https://academy.example/academy-activity/trial/callback');
  assert.equal(auth.searchParams.get('prompt'), null, 'the default consent screen: a first-time visitor must be able to authorise');
  const state = auth.searchParams.get('state');
  assert.deepEqual(trial.openState(state).via, 'tiktok');
  assert.equal(trial.openState(state.slice(0, -2) + 'xx'), null, 'a tampered state is refused');
  // callback: the pass is granted, the page opens the Activity
  res = fakeResponse(); await trial.handle(req('/academy-activity/trial/callback'), res, '/academy-activity/trial/callback', new URL('https://academy.example/academy-activity/trial/callback?code=abc&state=' + encodeURIComponent(state)));
  assert.equal(res.status, 200); assert.match(res.body, /You’re in, Ana\./); assert.match(res.body, /discord\.com\/activities\/1551336038713139370/); assert.match(res.body, /oauth2\/authorize\?client_id=1551336038713139370&integration_type=1&scope=applications.commands/); assert.match(res.body, /Open the Academy anywhere in Discord/); assert.match(res.body, /Create your free stockmarketloop\.com account/); assert.match(res.body, /href="https:\/\/stockmarketloop\.com\/connect-discord\/"/); assert.match(res.body, /Stock Market Loop Connect<\/b> bot/); assert.match(res.body, /Add the Academy to your Discord account/); assert.match(res.body, /optional; the Academy works without it/, 'the server is an optional extra, never a requirement'); assert.ok(res.body.indexOf('stockmarketloop.com/register/') < res.body.indexOf('discord.gg/makingeasymoney')); assert.match(res.body, /value="https:\/\/discord.com\/activities\/1551336038713139370"/);
  const pass = await store.active('420000000000000042', new Date(T0 + 1000), 'academy');
  assert.equal(pass.plan, 'trial'); assert.equal(pass.amount, 0); assert.equal(pass.ref, 'acad-trial:420000000000000042');
  assert.equal(new Date(pass.expiresAt).getTime() - new Date(pass.startsAt).getTime(), 15 * 86_400_000);
  // the pass opens the Academy through the ordinary access path, in any server (no roles, no wallet)
  const refused = { ok: false, status: 403, code: 'academy_role_required', userId: '420000000000000042', inGuild: false };
  const access = withPasses({ verify: async () => refused }, createPassService({ store, now: () => new Date(t) }));
  assert.deepEqual(await access.verify('Bearer x'), { ok: true, userId: '420000000000000042', tier: 'academy' });
  // a second attempt on the same account: no second pass
  res = fakeResponse(); await trial.handle(req('/academy-activity/trial/callback'), res, '/academy-activity/trial/callback', new URL('https://academy.example/academy-activity/trial/callback?code=abc2&state=' + encodeURIComponent(state)));
  assert.match(res.body, /Your trial is already running/);
  // after it ends: used, with nothing granted and the access path refusing again
  t = T0 + 16 * 86_400_000;
  res = fakeResponse(); await trial.handle(req('/academy-activity/trial/callback'), res, '/academy-activity/trial/callback', new URL('https://academy.example/academy-activity/trial/callback?code=abc3&state=' + encodeURIComponent(trial.signState({ t, via: '' }))));
  assert.match(res.body, /This account has had its trial/);
  assert.deepEqual(await access.verify('Bearer x'), refused);
  assert.equal(calls.filter((u) => /oauth2\/token$/.test(u)).length, 3, 'one code exchange per callback, no exchange on the landing or start');
});

test('the trial refuses what it should: expired state, a cancelled sign-in, Discord down, too many attempts, and it is off without its settings', async () => {
  const store = createPassStore();
  let t = T0;
  const trial = createAcademyTrial({ clientId: APP, clientSecret: 's', publicUrl: 'https://academy.example', store, now: () => t, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  const cb = (qs) => new URL('https://academy.example/academy-activity/trial/callback?' + qs);
  let res = fakeResponse(); await trial.handle(req('/academy-activity/trial/callback'), res, '/academy-activity/trial/callback', cb('code=x&state=nope')); assert.equal(res.status, 400);
  const old = trial.signState({ t: T0 - 20 * 60_000, via: '' });
  res = fakeResponse(); await trial.handle(req('/academy-activity/trial/callback'), res, '/academy-activity/trial/callback', cb('code=x&state=' + encodeURIComponent(old))); assert.equal(res.status, 400); assert.match(res.body, /expired/);
  const good = trial.signState({ t: T0, via: '' });
  res = fakeResponse(); await trial.handle(req('/academy-activity/trial/callback'), res, '/academy-activity/trial/callback', cb('error=access_denied&state=' + encodeURIComponent(good))); assert.match(res.body, /cancelled/);
  res = fakeResponse(); await trial.handle(req('/academy-activity/trial/callback'), res, '/academy-activity/trial/callback', cb('code=x&state=' + encodeURIComponent(good))); assert.equal(res.status, 502); assert.match(res.body, /Discord did not answer/);
  assert.equal((await store.byRef('acad-trial:420000000000000042')), null, 'nothing granted when Discord fails');
  for (let i = 0; i < 31; i += 1) { res = fakeResponse(); await trial.handle(req('/academy-activity/trial/start'), res, '/academy-activity/trial/start', new URL('https://academy.example/academy-activity/trial/start')); }
  assert.equal(res.status, 429);
  const off = createAcademyTrial({ clientId: '', clientSecret: '', publicUrl: '', store });
  assert.equal(off.configured, false);
  res = fakeResponse(); await off.handle(req('/academy-activity/trial'), res, '/academy-activity/trial', new URL('https://x.example/academy-activity/trial')); assert.equal(res.status, 503);
  const other = fakeResponse(); assert.equal(await trial.handle(req('/academy-activity/market'), other, '/academy-activity/market', new URL('https://x.example/academy-activity/market')), false, 'other paths are not ours');
  // the grant itself: invalid ids, and a member who already holds a pass needs no trial
  assert.deepEqual(await trial.grant('nope'), { ok: false, code: 'invalid_user' });
  await store.add({ discordId: '100000000000000001', plan: 'monthly', amount: 50, ref: 'acad-lb:1:k', startsAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 30 * 86_400_000).toISOString() });
  assert.equal((await trial.grant('100000000000000001')).code, 'already_member');
});


test('the Discord check reads the app with its bot token and says whether the callback and user install are set', async () => {
  const store = createPassStore();
  const seen = [];
  const mk = (app) => createAcademyTrial({ clientId: APP, clientSecret: 's', publicUrl: 'https://academy.example', store, botToken: 'bot-token', fetchImpl: async (url, options) => { seen.push(options.headers.authorization); return { ok: true, json: async () => app }; } });
  const good = await mk({ name: 'Academy', redirect_uris: ['https://academy.example/academy-activity/trial/callback'], integration_types_config: { 0: {}, 1: {} }, flags: 1 << 17 }).inspect();
  assert.deepEqual(good, { checked: true, redirectRegistered: true, redirectUris: 1, userInstall: true, guildInstall: true, embedded: true, name: 'Academy' });
  assert.equal(seen[0], 'Bot bot-token');
  const bad = await mk({ name: 'Academy', redirect_uris: ['https://other.example/cb'], integration_types_config: { 0: {} }, flags: 0 }).inspect();
  assert.equal(bad.redirectRegistered, false); assert.equal(bad.userInstall, false);
  const none = await createAcademyTrial({ clientId: APP, clientSecret: 's', publicUrl: 'https://academy.example', store }).inspect();
  assert.deepEqual(none, { checked: false });
});

test('statusFor: the countdown reads the trial pass (days left), trial over once it expires, a paid pass is not a trial, nothing without a pass', async () => {
  const { createPassStore } = require('./academy-passes');
  const store = createPassStore();
  let t = Date.UTC(2026, 9, 19, 12, 0, 0);
  const trial = createAcademyTrial({ clientId: '1000000000000000000', clientSecret: 's', publicUrl: 'https://academy.example', store, now: () => t, buyUrl: 'https://billing.example/v1/academy/billing/start?purpose=buy' });
  const user = '200000000000000001';
  assert.deepEqual(await trial.statusFor(user), { ok: true, trial: false, member: false, buyUrl: 'https://billing.example/v1/academy/billing/start?purpose=buy' });
  const g = await trial.grant(user, 'discord'); assert.equal(g.code, 'started');
  const s1 = await trial.statusFor(user);
  assert.equal(s1.trial, true); assert.equal(s1.active, true); assert.equal(s1.days, 15); assert.equal(s1.msLeft, 15 * 86_400_000); assert.equal(s1.endsAt, new Date(t + 15 * 86_400_000).toISOString());
  t += 14 * 86_400_000 + 3_600_000;
  const s2 = await trial.statusFor(user); assert.equal(s2.active, true); assert.equal(s2.msLeft, 86_400_000 - 3_600_000);
  t += 2 * 86_400_000;
  const s3 = await trial.statusFor(user); assert.equal(s3.trial, true); assert.equal(s3.active, false); assert.equal(s3.ended, true); assert.equal(s3.msLeft, 0);
  await store.add({ discordId: user, plan: 'monthly', amount: 10, ref: 'paid:1', startsAt: new Date(t).toISOString(), expiresAt: new Date(t + 30 * 86_400_000).toISOString(), product: 'academy' });
  const s4 = await trial.statusFor(user); assert.equal(s4.trial, false); assert.equal(s4.member, true); assert.equal(s4.plan, 'monthly');
  assert.equal((await trial.statusFor('nope')).ok, false);
});
