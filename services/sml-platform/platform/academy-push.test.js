'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const P = require('./academy-push');

const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
function browser() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, keys: { p256dh: P.b64u(ecdh.getPublicKey()), auth: P.b64u(auth) } };
}
/* what the browser does on arrival (RFC 8291), to prove the message opens */
function decrypt(ua, body) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const shared = ua.ecdh.computeSecret(asPublic);
  const ikm = hmac(hmac(ua.auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua.ecdh.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  return plain.subarray(0, plain.length - 1).toString();
}

test('payload encryption opens in the browser (RFC 8291)', () => {
  const ua = browser();
  const body = P.encryptPayload(ua.keys, JSON.stringify({ title: 'BIAF new PT $10.76' }));
  assert.equal(body.readUInt32BE(16), 4096);
  assert.deepEqual(JSON.parse(decrypt(ua, body)), { title: 'BIAF new PT $10.76' });
});

test('VAPID header is a valid ES256 JWT for the push service origin', () => {
  const keys = P.generateVapidKeys();
  const h = P.vapidHeader({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys, subject: 'https://example.test', now: () => 1_000_000 });
  const [, t, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [head, claims, sig] = t.split('.');
  const c = JSON.parse(P.unb64u(claims).toString());
  assert.equal(c.aud, 'https://fcm.googleapis.com');
  assert.equal(c.exp, 1000 + 12 * 3600);
  const raw = P.unb64u(keys.publicKey);
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: P.b64u(raw.subarray(1, 33)), y: P.b64u(raw.subarray(33)) }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(head + '.' + claims), { key: pub, dsaEncoding: 'ieee-p1363' }, P.unb64u(sig)));
});

function fakePool() {
  const kv = new Map();
  return { kv, query: async (sql, params = []) => {
    if (/^SELECT/.test(sql)) return { rows: kv.has('push-vapid') ? [{ value: kv.get('push-vapid') }] : [] };
    if (/ON CONFLICT \(key\) DO NOTHING/.test(sql)) { if (!kv.has('push-vapid')) kv.set('push-vapid', JSON.parse(params[0])); return { rows: [] }; }
    throw new Error('unexpected ' + sql);
  } };
}
const memStore = () => { let v = null; return { read: async () => v, write: async (n) => { v = JSON.parse(JSON.stringify(n)); } }; };

test('keys are made once and never replaced; sends only to allowed members; drops gone subscriptions', async () => {
  const pool = fakePool();
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: !url.includes('gone'), status: url.includes('gone') ? 410 : 201 }; };
  const svc = P.createPushService({ pool, subStore: memStore(), fetchImpl });
  const k1 = await svc.publicKey();
  const svc2 = P.createPushService({ pool, subStore: memStore(), fetchImpl });
  assert.equal(await svc2.publicKey(), k1);
  const a = browser(), b = browser(), c = browser();
  assert.equal((await svc.subscribe('u1', { endpoint: 'https://evil.example/x', keys: a.keys })).ok, false);
  assert.ok((await svc.subscribe('u1', { endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: a.keys })).ok);
  assert.ok((await svc.subscribe('u1', { endpoint: 'https://fcm.googleapis.com/fcm/send/gone', keys: c.keys })).ok);
  assert.ok((await svc.subscribe('u2', { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/b', keys: b.keys })).ok);
  const r = await svc.sendTo(async (uid) => uid === 'u1', { title: 'hi' });
  assert.deepEqual(r, { members: 1, sent: 1, gone: 1 });
  assert.equal(calls.length, 2);
  assert.match(calls[0].opts.headers.Authorization, /^vapid t=/);
  assert.equal(calls[0].opts.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(JSON.parse(decrypt(a, calls[0].opts.body)).title, 'hi');
  assert.equal(await svc.count('u1'), 1);
});
