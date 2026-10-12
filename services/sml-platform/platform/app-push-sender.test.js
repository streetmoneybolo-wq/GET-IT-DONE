'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAppPushSender, createApnsClient, createFcmClient, createWebPushClient, normalizeMessage, parseServiceAccount } = require('./app-push-sender');
const { createAppPushDevices } = require('./app-push-devices');
const { generateVapidKeys } = require('./academy-push');

const NOW = Date.UTC(2026, 9, 12, 15, 0);
const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const P8 = ec.privateKey.export({ type: 'pkcs8', format: 'pem' });
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { type: 'service_account', project_id: 'sml-app', client_email: 'push@sml-app.iam.gserviceaccount.com', private_key: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
const b64uJson = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

test('messages are cleaned to one shape every sender understands', () => {
  const m = normalizeMessage({ title: ' $NVDA alert\u0000 ', body: 'Entry 180 pt 200', data: { symbol: 'NVDA', price: 181.2, 'bad key!': 'x', ok: true }, url: 'http://insecure.example', ttl: 5, badge: 3, collapseId: 'alert 42!' });
  assert.equal(m.title, '$NVDA alert'); assert.equal(m.body, 'Entry 180 pt 200');
  assert.deepEqual(m.data, { symbol: 'NVDA', price: '181.2', ok: 'true' });
  assert.equal(m.url, '', 'only https urls travel'); assert.equal(m.ttl, 60); assert.equal(m.badge, 3); assert.equal(m.collapseId, 'alert42'); assert.equal(m.channelId, 'alerts');
  assert.equal(normalizeMessage({}).error, 'empty_message');
  assert.equal(normalizeMessage({ title: 'x', url: 'https://stockmarketloop.com/a' }).url, 'https://stockmarketloop.com/a');
});

test('APNs: provider token is a valid ES256 JWT, requests carry the right headers, dead tokens are reported gone, expired provider tokens refresh once', async () => {
  const calls = [];
  let reply = { status: 200, body: '' };
  const transport = async (headers, body) => { calls.push({ headers, body }); const r = typeof reply === 'function' ? reply(calls.length) : reply; return r; };
  let t = NOW;
  const apns = createApnsClient({ keyId: 'KEY123', teamId: 'TEAM456', key: P8.replace(/\n/g, '\\n'), bundleId: 'com.stockmarketloop.app', transport, now: () => t });
  assert.equal(apns.configured, true); assert.equal(apns.host, 'api.push.apple.com');
  const r = await apns.send('f'.repeat(64), { title: 'Alert', body: 'NVDA entry 180', url: 'https://stockmarketloop.com/x', collapseId: 'nvda', data: { symbol: 'NVDA' } });
  assert.deepEqual(r, { ok: true, status: 200 });
  const h = calls[0].headers;
  assert.equal(h[':path'], '/3/device/' + 'f'.repeat(64)); assert.equal(h['apns-topic'], 'com.stockmarketloop.app'); assert.equal(h['apns-push-type'], 'alert'); assert.equal(h['apns-priority'], '10'); assert.equal(h['apns-collapse-id'], 'nvda');
  assert.equal(h['apns-expiration'], String(Math.floor(NOW / 1000) + 3600));
  const jwt = h.authorization.replace(/^bearer /, '');
  const [head, claims, sig] = jwt.split('.');
  assert.deepEqual(b64uJson(head), { alg: 'ES256', kid: 'KEY123' }); assert.deepEqual(b64uJson(claims), { iss: 'TEAM456', iat: Math.floor(NOW / 1000) });
  assert.equal(crypto.verify('sha256', Buffer.from(`${head}.${claims}`), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), true);
  const payload = JSON.parse(calls[0].body);
  assert.deepEqual(payload.aps.alert, { title: 'Alert', body: 'NVDA entry 180' }); assert.equal(payload.aps['thread-id'], 'nvda'); assert.equal(payload.symbol, 'NVDA'); assert.equal(payload.url, 'https://stockmarketloop.com/x');
  // same provider token for 50 minutes, a new one after
  t += 10 * 60_000; await apns.send('f'.repeat(64), { title: 'x' });
  assert.equal(calls[1].headers.authorization, h.authorization);
  t += 45 * 60_000; await apns.send('f'.repeat(64), { title: 'x' });
  assert.notEqual(calls[2].headers.authorization, h.authorization);
  reply = { status: 410, body: JSON.stringify({ reason: 'Unregistered', timestamp: NOW }) };
  assert.deepEqual(await apns.send('a'.repeat(64), { title: 'x' }), { ok: false, status: 410, reason: 'Unregistered', gone: true });
  reply = { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) };
  assert.equal((await apns.send('a'.repeat(64), { title: 'x' })).gone, true);
  reply = { status: 429, body: JSON.stringify({ reason: 'TooManyRequests' }) };
  assert.deepEqual(await apns.send('a'.repeat(64), { title: 'x' }), { ok: false, status: 429, reason: 'TooManyRequests', gone: false });
  const before = calls.length;
  reply = (n) => (n === before + 1 ? { status: 403, body: JSON.stringify({ reason: 'ExpiredProviderToken' }) } : { status: 200, body: '' });
  assert.deepEqual(await apns.send('a'.repeat(64), { title: 'x' }), { ok: true, status: 200 });
  assert.equal(calls.length, before + 2, 'one retry with a fresh provider token');
  assert.notEqual(calls[before + 1].headers.authorization, calls[before].headers.authorization);
  const off = createApnsClient({ keyId: 'k', teamId: 't', key: 'not a key', bundleId: 'b', transport });
  assert.equal(off.configured, false);
  assert.deepEqual(await off.send('a'.repeat(64), { title: 'x' }), { ok: false, error: 'apns_unconfigured' });
  assert.equal(createApnsClient({ keyId: 'k', teamId: 't', key: P8, bundleId: 'b', env: 'sandbox', transport }).host, 'api.sandbox.push.apple.com');
});

test('FCM: a service-account JWT buys an access token once, sends carry it, UNREGISTERED is gone, a 401 refreshes once', async () => {
  const calls = [];
  let sendReply = () => ({ status: 200, body: { name: 'projects/sml-app/messages/1' } });
  let tokenMints = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === SA.token_uri) {
      tokenMints += 1;
      const params = new URLSearchParams(init.body);
      assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const [head, claims, sig] = params.get('assertion').split('.');
      assert.deepEqual(b64uJson(head), { alg: 'RS256', typ: 'JWT' });
      const c = b64uJson(claims);
      assert.equal(c.iss, SA.client_email); assert.equal(c.scope, 'https://www.googleapis.com/auth/firebase.messaging'); assert.equal(c.aud, SA.token_uri); assert.equal(c.exp - c.iat, 3600);
      assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${head}.${claims}`), rsa.publicKey, Buffer.from(sig, 'base64url')), true);
      return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.token' + tokenMints, expires_in: 3599, token_type: 'Bearer' }) };
    }
    const r = sendReply(init);
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  };
  let t = NOW;
  const fcm = createFcmClient({ serviceAccount: Buffer.from(JSON.stringify(SA)).toString('base64'), fetchImpl, now: () => t });
  assert.equal(fcm.configured, true); assert.equal(fcm.projectId, 'sml-app');
  const r = await fcm.send('fcm-token-1', { title: 'Alert', body: 'AMD pt 200', url: 'https://stockmarketloop.com/a', collapseId: 'amd', data: { symbol: 'AMD' } });
  assert.deepEqual(r, { ok: true, status: 200, name: 'projects/sml-app/messages/1' });
  const sent = calls.find((c) => c.url.includes('messages:send'));
  assert.equal(sent.url, 'https://fcm.googleapis.com/v1/projects/sml-app/messages:send');
  assert.equal(sent.init.headers.authorization, 'Bearer ya29.token1');
  const body = JSON.parse(sent.init.body).message;
  assert.equal(body.token, 'fcm-token-1'); assert.deepEqual(body.notification, { title: 'Alert', body: 'AMD pt 200' });
  assert.deepEqual(body.data, { symbol: 'AMD', url: 'https://stockmarketloop.com/a', title: 'Alert', body: 'AMD pt 200' });
  assert.equal(body.android.priority, 'high'); assert.equal(body.android.ttl, '3600s'); assert.equal(body.android.collapse_key, 'amd'); assert.equal(body.android.notification.channel_id, 'alerts');
  await fcm.send('fcm-token-1', { title: 'again' });
  assert.equal(tokenMints, 1, 'the access token is reused while it lives');
  sendReply = () => ({ status: 404, body: { error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } } });
  assert.deepEqual(await fcm.send('dead', { title: 'x' }), { ok: false, status: 404, reason: 'UNREGISTERED', gone: true });
  sendReply = () => ({ status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ errorCode: 'QUOTA_EXCEEDED' }] } } });
  assert.deepEqual(await fcm.send('busy', { title: 'x' }), { ok: false, status: 429, reason: 'QUOTA_EXCEEDED', gone: false });
  let first = true;
  sendReply = () => { if (first) { first = false; return { status: 401, body: { error: { code: 401, status: 'UNAUTHENTICATED' } } }; } return { status: 200, body: { name: 'm2' } }; };
  assert.deepEqual(await fcm.send('fcm-token-1', { title: 'x' }), { ok: true, status: 200, name: 'm2' });
  assert.equal(tokenMints, 2, 'a 401 mints a fresh token and retries once');
  assert.equal(parseServiceAccount('garbage'), null); assert.equal(parseServiceAccount(JSON.stringify({ client_email: 'a' })), null);
  const off = createFcmClient({ serviceAccount: '' });
  assert.equal(off.configured, false); assert.deepEqual(await off.send('t', { title: 'x' }), { ok: false, error: 'fcm_unconfigured' });
});

test('web push: encrypted payload with the VAPID keys; 410 is gone; a device without keys is gone too', async () => {
  const keys = generateVapidKeys();
  const calls = [];
  let status = 201;
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: status < 300, status }; };
  const web = createWebPushClient({ keys, fetchImpl, now: () => NOW });
  assert.equal(web.configured, true); assert.equal(await web.publicKey(), keys.publicKey);
  const sub = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const device = { platform: 'web', token: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: sub.publicKey.export({ type: 'spki', format: 'der' }).subarray(-65).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  const r = await web.send(device, { title: 'Alert', body: 'hello', collapseId: 'alert1' });
  assert.deepEqual(r, { ok: true, status: 201 });
  assert.equal(calls[0].url, device.token);
  assert.equal(calls[0].init.headers['Content-Encoding'], 'aes128gcm'); assert.match(calls[0].init.headers.Authorization, /^vapid t=.+, k=/); assert.equal(calls[0].init.headers.Topic, 'alert1'); assert.equal(calls[0].init.headers.TTL, '3600');
  assert.ok(Buffer.isBuffer(calls[0].init.body) && calls[0].init.body.length > 100);
  status = 410;
  assert.deepEqual(await web.send(device, { title: 'x' }), { ok: false, status: 410, gone: true });
  assert.equal((await web.send({ ...device, keys: null }, { title: 'x' })).gone, true);
  assert.deepEqual(await createWebPushClient({}).send(device, { title: 'x' }), { ok: false, error: 'web_push_unconfigured' });
});

test('the dispatcher fans one message out to every device of a member, disables dead tokens and reports per platform', async () => {
  const devices = createAppPushDevices({ now: () => NOW });
  const apnsSent = [], fcmSent = [];
  const apns = { configured: true, platform: 'ios', send: async (token) => { apnsSent.push(token); return token.startsWith('dead') ? { ok: false, status: 410, reason: 'Unregistered', gone: true } : { ok: true, status: 200 }; } };
  const fcm = { configured: true, platform: 'android', send: async (token) => { fcmSent.push(token); return { ok: true, status: 200 }; } };
  const web = { configured: false, platform: 'web', send: async () => ({ ok: true }), publicKey: async () => null };
  const logs = [];
  const sender = createAppPushSender({ devices, apns, fcm, web, logger: (level, event, data) => logs.push({ level, event, data }) });
  assert.deepEqual(sender.status(), { ios: true, android: true, web: false }); assert.equal(sender.configured, true);
  await devices.register(7, { platform: 'ios', token: 'a'.repeat(64) });
  await devices.register(7, { platform: 'ios', token: 'dead'.padEnd(64, '0').replace(/[^0-9a-f]/g, '0').replace(/^0000/, 'dead').replace(/[g-z]/g, '0') });
  await devices.register(7, { platform: 'android', token: 'fcm-token-for-vaughn-phone' });
  const keys = { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 9).toString('base64url') };
  await devices.register(7, { platform: 'web', token: 'https://push.services.mozilla.com/wpush/v2/abcdefgh', keys });
  await devices.register(9, { platform: 'android', token: 'fcm-token-for-someone-else' });
  const r = await sender.send(7, { title: 'Alert', body: 'NVDA 180 → 200' });
  assert.equal(r.devices, 4); assert.equal(r.sent, 2); assert.equal(r.gone, 1);
  assert.deepEqual(r.results.map((x) => [x.platform, x.ok, x.error || x.reason || null]).sort(), [['android', true, null], ['ios', false, 'Unregistered'], ['ios', true, null], ['web', false, 'web_push_off']]);
  assert.equal((await devices.tokensFor(7)).length, 3, 'the dead APNs token is disabled');
  assert.equal(fcmSent.length, 1); assert.equal(apnsSent.length, 2);
  assert.ok(logs.some((l) => l.event === 'app_push_sent' && l.data.userId === 7));
  const many = await sender.sendMany([7, 9, 9, 'x', 0, 123], { title: 'Group alert', body: 'MEM ALGO long' });
  assert.deepEqual(many, { ok: true, members: 3, reached: 2, devices: 4, sent: 3, gone: 0 }, 'member 7: ios + android sent, web sender off; member 9: android; member 123: nothing');
  assert.deepEqual(await sender.send(7, {}), { ok: false, error: 'empty_message' });
  assert.deepEqual(await sender.send(42, { title: 'nobody' }), { ok: true, userId: 42, devices: 0, sent: 0, gone: 0, results: [] });
});
