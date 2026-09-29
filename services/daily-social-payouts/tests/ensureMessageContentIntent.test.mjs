import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMessageContentIntent, GATEWAY_MESSAGE_CONTENT, GATEWAY_MESSAGE_CONTENT_LIMITED } from '../utils/ensureMessageContentIntent.js';

const quiet = { log() {}, warn() {} };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

test('enables the limited intent when the application lacks it', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(init);
    if (!init.method) return json({ id: '1', name: 'Spotlight', flags: 0 });
    return json({ id: '1', flags: JSON.parse(init.body).flags });
  };
  const result = await ensureMessageContentIntent('tok', { fetchImpl, log: quiet });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(JSON.parse(calls[1].body).flags & GATEWAY_MESSAGE_CONTENT_LIMITED, GATEWAY_MESSAGE_CONTENT_LIMITED);
  assert.equal(calls[0].headers.Authorization, 'Bot tok');
});

test('leaves an application alone when the intent is already on', async () => {
  for (const flag of [GATEWAY_MESSAGE_CONTENT, GATEWAY_MESSAGE_CONTENT_LIMITED]) {
    let patched = false;
    const fetchImpl = async (url, init = {}) => {
      if (init.method) patched = true;
      return json({ id: '1', flags: flag | 1 });
    };
    const result = await ensureMessageContentIntent('tok', { fetchImpl, log: quiet });
    assert.deepEqual([result.ok, result.changed, patched], [true, false, false]);
  }
});

test('keeps existing flags when adding the intent', async () => {
  let body;
  const fetchImpl = async (url, init = {}) => {
    if (!init.method) return json({ id: '1', flags: 1 << 23 });
    body = JSON.parse(init.body);
    return json({ id: '1', flags: body.flags });
  };
  await ensureMessageContentIntent('tok', { fetchImpl, log: quiet });
  assert.equal(body.flags, (1 << 23) | GATEWAY_MESSAGE_CONTENT_LIMITED);
});

test('reports a rejected change with the portal link instead of throwing', async () => {
  const warnings = [];
  const fetchImpl = async (url, init = {}) => (init.method ? json({ message: 'nope' }, 403) : json({ id: '42', flags: 0 }));
  const result = await ensureMessageContentIntent('tok', { fetchImpl, log: { log() {}, warn: (m) => warnings.push(m) } });
  assert.equal(result.ok, false);
  assert.match(warnings[0], /HTTP 403/);
  assert.match(warnings[0], /applications\/42\/bot/);
});

test('does nothing without a token', async () => {
  const result = await ensureMessageContentIntent('', { fetchImpl: async () => { throw new Error('should not be called'); }, log: quiet });
  assert.equal(result.reason, 'no_token');
});
