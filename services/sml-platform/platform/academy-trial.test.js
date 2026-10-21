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
    if (/users\/@me$/.test(url)) return { ok: true, json: async () => ({ id: '420000000000000042', username: 'ana', global_name: 'Ana', email: 'ana@example.com', verified: true }) };
    throw new Error('unexpected ' + url);
  };
  let t = T0;
  const registered = [];
  const bridge = { register: async (o) => { registered.push(o); return { ok: true, created: true, matched: false, verified: true, userId: 77, handle: 'ana', loginUrl: 'https://stockmarketloop.com/?sml_lkc_login=abc', profileUrl: 'https://stockmarketloop.com/members/77/' }; } };
  const trial = createAcademyTrial({ clientId: APP, clientSecret: 's3cret', publicUrl: 'https://academy.example/', store, fetchImpl, now: () => t, inviteUrl: 'https://discord.gg/makingeasymoney', bridge: () => bridge });
  assert.equal(trial.configured, true); assert.equal(trial.days, 15);
  assert.equal(trial.link, 'https://academy.example/academy-activity/trial');
  assert.equal(trial.activityUrl, 'https://discord.com/activities/' + APP);
  // landing
  let res = fakeResponse(); assert.equal(await trial.handle(req('/academy-activity/trial'), res, '/academy-activity/trial', new URL('https://academy.example/academy-activity/trial?via=tiktok')), true);
  assert.equal(res.status, 200); assert.match(res.body, /FREE TRIAL · 15 DAYS · NO CARD/); assert.match(res.body, /See what the big money sees\./); assert.match(res.body, /Start my 15 free days/); assert.match(res.body, /href="\/academy-activity\/trial\/start\?via=tiktok"/); assert.doesNotMatch(res.body, /s3cret/);
  // start: a redirect to Discord with identify only and a signed state
  res = fakeResponse(); await trial.handle(req('/academy-activity/trial/start'), res, '/academy-activity/trial/start', new URL('https://academy.example/academy-activity/trial/start?via=tiktok'));
  assert.equal(res.status, 302);
  const auth = new URL(res.headers.location);
  assert.equal(auth.origin + auth.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(auth.searchParams.get('scope'), 'identify email', 'the email Discord shares makes the site account'); assert.equal(auth.searchParams.get('client_id'), APP);
  assert.equal(auth.searchParams.get('redirect_uri'), 'https://academy.example/academy-activity/trial/callback');
  assert.equal(auth.searchParams.get('prompt'), null, 'the default consent screen: a first-time visitor must be able to authorise');
  const state = auth.searchParams.get('state');
  assert.deepEqual(trial.openState(state).via, 'tiktok');
  assert.equal(trial.openState(state.slice(0, -2) + 'xx'), null, 'a tampered state is refused');
  // callback: the pass is granted, the page opens the Activity
  res = fakeResponse(); await trial.handle(req('/academy-activity/trial/callback'), res, '/academy-activity/trial/callback', new URL('https://academy.example/academy-activity/trial/callback?code=abc&state=' + encodeURIComponent(state)));
  assert.equal(res.status, 200); assert.match(res.body, /You’re in, Ana\./); assert.match(res.body, /discord\.com\/activities\/1551336038713139370/); assert.match(res.body, /oauth2\/authorize\?client_id=1551336038713139370&integration_type=1&scope=applications.commands/); assert.match(res.body, /Open the Academy anywhere in Discord/); assert.match(res.body, /Your stockmarketloop\.com account is ready\.<\/b> It was created from your Discord sign-in, email verified by Discord, and the Stock Market Loop Connect bot is connected\./); assert.match(res.body, /href="https:\/\/stockmarketloop\.com\/\?sml_lkc_login=abc"/); assert.doesNotMatch(res.body, /Create your free stockmarketloop\.com account/, 'the account step is done, not asked for'); assert.equal(registered.length, 1); assert.equal(registered[0].discordUserId, '420000000000000042'); assert.equal(registered[0].emailVerified, true); assert.equal(registered[0].email, 'ana@example.com'); assert.match(res.body, /Add the Academy to your Discord account/); assert.match(res.body, /optional; the Academy works without it/, 'the server is an optional extra, never a requirement'); assert.ok(res.body.indexOf('stockmarketloop.com/register/') < res.body.indexOf('discord.gg/makingeasymoney')); assert.match(res.body, /value="https:\/\/discord.com\/activities\/1551336038713139370"/);
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

test('a reloaded or reused sign-in link says so (Discord answers 400), while a Discord outage still reads as one', async () => {
  const mk = (status) => createAcademyTrial({ clientId: APP, clientSecret: 's', publicUrl: 'https://academy.example', store: createPassStore({}), now: () => 1_000_000, fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) });
  const run = async (trial) => {
    let res = fakeResponse(); await trial.handle(req('/academy-activity/trial/start?via=x'), res, '/academy-activity/trial/start', new URL('https://academy.example/academy-activity/trial/start?via=x'));
    const state = new URL(res.headers.location).searchParams.get('state');
    res = fakeResponse(); await trial.handle(req('/academy-activity/trial/callback'), res, '/academy-activity/trial/callback', new URL('https://academy.example/academy-activity/trial/callback?code=abc&state=' + encodeURIComponent(state)));
    return res;
  };
  const reused = await run(mk(400)); assert.equal(reused.status, 400); assert.match(reused.body, /already used or has expired/);
  const down = await run(mk(503)); assert.equal(down.status, 502); assert.match(down.body, /did not answer/);
});

test('the shared trial link unfurls with the banner, a headline and what is inside; the banner is served as a JPEG', async () => {
  const trial = createAcademyTrial({ clientId: APP, clientSecret: 's3cret', publicUrl: 'https://academy.example/', store: createPassStore() });
  const res = fakeResponse(); await trial.handle(req('/academy-activity/trial'), res, '/academy-activity/trial', new URL('https://academy.example/academy-activity/trial?via=site'));
  assert.equal(res.status, 200);
  assert.match(res.body, /<meta property="og:image" content="https:\/\/academy\.example\/academy-activity\/trial\/banner\.jpg">/);
  assert.match(res.body, /<meta property="og:title" content="See What the Big Money Sees\. Live, Inside Discord\.">/);
  assert.match(res.body, /og:description" content="Level 3 data\. Dark pool prints\./);
  const tags = res.body.match(/<meta [^>]*(og|twitter):(title|description)[^>]*>/g).join(' ');
  assert.doesNotMatch(tags, /MEM ALGO|trial|card/i, 'the preview never names MEM ALGO, the trial or a card');
  assert.match(res.body, /twitter:card" content="summary_large_image"/); assert.match(res.body, /og:url" content="https:\/\/academy\.example\/academy-activity\/trial"/);
  const img = { status: 0, headers: {}, body: null, writeHead(s, h) { img.status = s; img.headers = h; }, end(b) { img.body = b; } };
  await trial.handle(req('/academy-activity/trial/banner.jpg'), img, '/academy-activity/trial/banner.jpg', new URL('https://academy.example/academy-activity/trial/banner.jpg'));
  assert.equal(img.status, 200); assert.equal(img.headers['content-type'], 'image/jpeg'); assert.ok(Buffer.isBuffer(img.body) && img.body[0] === 0xff && img.body[1] === 0xd8 && img.body.length > 50_000, 'a real JPEG');
});

test('Continue with Discord: signs a member in to the site through the same Discord callback, starts no trial, and only ever returns to a path on the site', async () => {
  const store = createPassStore(); let added = 0; const realAdd = store.add; store.add = async (...a) => { added += 1; return realAdd(...a); };
  const user = { id: '420000000000000042', username: 'ana', global_name: 'Ana', email: 'ana@example.com', verified: true };
  const fetchImpl = async (url) => {
    if (/oauth2\/token$/.test(url)) return { ok: true, json: async () => ({ access_token: 'tok' }) };
    if (/users\/@me$/.test(url)) return { ok: true, json: async () => user };
    throw new Error('unexpected ' + url);
  };
  const registered = []; let answer = { ok: true, created: false, matched: true, verified: true, loginUrl: 'https://stockmarketloop.com/?sml_lkc_login=abc&to=%2Fnotes%2F' };
  const bridge = { register: async (o) => { registered.push(o); return answer; } };
  const trial = createAcademyTrial({ clientId: APP, clientSecret: 's3cret', publicUrl: 'https://academy.example/', store, fetchImpl, now: () => T0, bridge: () => bridge });
  const go = async (path) => { const res = fakeResponse(); await trial.handle(req(path), res, path.split('?')[0], new URL('https://academy.example' + path)); return res; };

  // start: a signed state that says sign-in, and the return path
  let res = await go('/academy-activity/trial/signin?return=%2Fnotes%2Fabc%3Fx%3D1');
  assert.equal(res.status, 302); const auth = new URL(res.headers.location);
  assert.equal(auth.searchParams.get('scope'), 'identify email'); assert.equal(auth.searchParams.get('redirect_uri'), 'https://academy.example/academy-activity/trial/callback', 'the callback already registered with Discord');
  const state = auth.searchParams.get('state');
  const payload = JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString()); assert.equal(payload.mode, 'signin'); assert.equal(payload.ret, '/notes/abc?x=1');

  // callback: the site account is made or matched, no trial, and the member goes through the one-time link
  res = await go('/academy-activity/trial/callback?code=c&state=' + encodeURIComponent(state));
  assert.equal(res.status, 302); assert.equal(res.headers.location, answer.loginUrl); assert.equal(added, 0, 'signing in is not starting a trial');
  assert.deepEqual({ ...registered[0] }, { discordUserId: user.id, discordTag: 'ana', email: 'ana@example.com', emailVerified: true, name: 'Ana', returnTo: 'https://stockmarketloop.com/notes/abc?x=1' });

  // anything that is not a path on the site becomes the home page
  for (const bad of ['https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', '/a\r\nb']) {
    const r = await go('/academy-activity/trial/signin?return=' + encodeURIComponent(bad));
    const st = JSON.parse(Buffer.from(new URL(r.headers.location).searchParams.get('state').split('.')[0], 'base64url').toString());
    assert.equal(st.ret, '/', 'return ' + JSON.stringify(bad));
  }
  // a login link that does not point at the site is never followed
  answer = { ok: true, created: true, loginUrl: 'https://evil.example/?sml_lkc_login=abc' };
  res = await go('/academy-activity/trial/callback?code=c&state=' + encodeURIComponent(state)); assert.notEqual(res.status, 302); assert.match(res.body, /did not answer|try again/i);
  // the failures say what happened
  answer = { ok: false, status: 409, error: 'email_unverified_existing' }; res = await go('/academy-activity/trial/callback?code=c&state=' + encodeURIComponent(state));
  assert.equal(res.status, 409); assert.match(res.body, /already exists/); assert.match(res.body, /stockmarketloop\.com\/login\//);
  answer = { ok: false, status: 409, error: 'discord_already_linked' }; res = await go('/academy-activity/trial/callback?code=c&state=' + encodeURIComponent(state)); assert.match(res.body, /already linked/);
  user.email = ''; res = await go('/academy-activity/trial/callback?code=c&state=' + encodeURIComponent(state)); assert.match(res.body, /did not share an email/); assert.equal(res.status, 200);
  // cancelled on Discord's side
  res = await go('/academy-activity/trial/callback?error=access_denied&state=' + encodeURIComponent(state)); assert.match(res.body, /cancelled/); assert.match(res.body, /Back to sign in/);
  // the trial path is untouched: a trial state still starts a trial
  user.email = 'ana@example.com'; res = await go('/academy-activity/trial/start?via=site'); const ts = new URL(res.headers.location).searchParams.get('state');
  res = await go('/academy-activity/trial/callback?code=c&state=' + encodeURIComponent(ts)); assert.equal(res.status, 200); assert.equal(added, 1);
});
