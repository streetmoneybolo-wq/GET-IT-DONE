'use strict';

const crypto = require('node:crypto');

function encode(value) { return Buffer.from(value).toString('base64url'); }

function issueDisciplineToken({ secret, userId, guildId, now = Date.now, ttlMs = 12 * 60 * 60 * 1000 }) {
  if (!secret || !/^\d{15,24}$/.test(String(userId)) || !/^\d{15,24}$/.test(String(guildId))) throw new TypeError('invalid discipline token input');
  const payload = encode(JSON.stringify({ u: String(userId), g: String(guildId), exp: Number(now()) + ttlMs }));
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyDisciplineToken(token, secret, now = Date.now) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!secret || !payload || !signature || extra) return { ok: false, code: 'invalid_token' };
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch (_) { return { ok: false, code: 'invalid_token' }; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return { ok: false, code: 'invalid_token' };
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!/^\d{15,24}$/.test(String(claims.u)) || !/^\d{15,24}$/.test(String(claims.g)) || Number(claims.exp) < Number(now())) return { ok: false, code: 'expired_token' };
    return { ok: true, userId: String(claims.u), guildId: String(claims.g) };
  } catch (_) { return { ok: false, code: 'invalid_token' }; }
}

module.exports = { issueDisciplineToken, verifyDisciplineToken };
