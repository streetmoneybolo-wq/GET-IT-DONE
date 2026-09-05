'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { MAX_BODY_BYTES, buildPublicKey, createDiscordInteractions } = require('./discord-interactions');

const NOW = 1_700_000_000_000;
const APP_ID = '123456789012345678';
const USER = '111222333444555666';
const GUILD = '999888777666555444';

/* Real Ed25519 vectors: sign exactly what Discord signs (timestamp || body). */
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC_KEY_HEX = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');

function signBody(timestamp, body) {
  return crypto.sign(null, Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from(body, 'utf8')]), privateKey)
    .toString('hex');
}

function fakeRequest(body, { sign = true, timestamp = '1700000000', headers = {} } = {}) {
  const base = {};
  if (sign) {
    base['x-signature-ed25519'] = signBody(timestamp, body);
    base['x-signature-timestamp'] = timestamp;
  }
  return { headers: Object.assign(base, headers) };
}

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(code, responseHeaders) { this.statusCode = code; this.headers = responseHeaders; },
    end(payload) { this.body = payload; },
    json() { return JSON.parse(this.body); }
  };
}

function fakeFetch(statuses = [200]) {
  const calls = [];
  let index = 0;
  const impl = async (url, options) => {
    calls.push({ url, options });
    const status = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    return { status, ok: status >= 200 && status < 300, json: async () => ({ retry_after: 0.01 }) };
  };
  return { impl, calls };
}

function commandInteraction(name, options = []) {
  return JSON.stringify({
    id: 'interaction_9',
    type: 2,
    guild_id: GUILD,
    token: 'follow-up-token-xyz',
    member: { user: { id: USER } },
    data: { name, options }
  });
}

function componentInteraction(customId, overrides = {}) {
  return JSON.stringify(Object.assign({
    id: 'interaction_button_1',
    type: 3,
    guild_id: GUILD,
    token: 'follow-up-token-xyz',
    member: { user: { id: USER } },
    guild: { name: 'Making Easy Money' },
    data: { custom_id: customId }
  }, overrides));
}

function build(overrides = {}) {
  const fetched = fakeFetch(overrides.fetchStatuses);
  const slept = [];
  const handler = createDiscordInteractions(Object.assign({
    config: { discordConnectPublicKey: PUBLIC_KEY_HEX, discordConnectAppId: APP_ID },
    pool: {},
    graph: { async findByRef() { return { id: 77, verification: 'verified' }; } },
    authorize: async () => ({ ok: true, merchantScope: 'acct_merchant_1' }),
    store: { async appendRow() { return { id: 1, integrityHash: 'h'.repeat(64) }; } },
    disputeService: {
      async listCases() { return [{ id: 12, provider: 'stripe', reason: 'fraudulent', amount_cents: 2499, currency: 'usd', due_by: NOW, case_state: 'open' }]; },
      async buildPacket() { return { version: 2, warnings: [] }; }
    },
    reconciler: {},
    fetchImpl: fetched.impl,
    sleep: async (ms) => { slept.push(ms); },
    now: () => NOW
  }, overrides.deps));
  return { handler, fetched, slept };
}

test('the SPKI-prefixed key object round-trips a signature; bad hex yields no key', () => {
  const keyObject = buildPublicKey(PUBLIC_KEY_HEX);
  assert.ok(keyObject);
  const message = Buffer.concat([Buffer.from('1700000000'), Buffer.from('{"type":1}')]);
  const signature = crypto.sign(null, message, privateKey);
  assert.equal(crypto.verify(null, message, keyObject, signature), true);
  assert.equal(buildPublicKey('zz'.repeat(32)), null);
  assert.equal(buildPublicKey(''), null);
  assert.equal(buildPublicKey(PUBLIC_KEY_HEX.slice(0, 60)), null);
});

test('a correctly signed PING gets a PONG', async () => {
  const { handler } = build();
  const body = '{"type":1}';
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { type: 1 });
});

test('missing signature headers are 401 — even for PING', async () => {
  const { handler } = build();
  const body = '{"type":1}';
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body, { sign: false }), response, body);
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error, 'invalid_signature');
});

test('a signature from the wrong key is 401', async () => {
  const { handler } = build();
  const body = '{"type":1}';
  const otherKey = crypto.generateKeyPairSync('ed25519').privateKey;
  const forged = crypto.sign(null, Buffer.concat([Buffer.from('1700000000'), Buffer.from(body)]), otherKey).toString('hex');
  const response = fakeResponse();
  await handler.handleRequest({ headers: { 'x-signature-ed25519': forged, 'x-signature-timestamp': '1700000000' } }, response, body);
  assert.equal(response.statusCode, 401);
});

test('a tampered body or timestamp is 401', async () => {
  const { handler } = build();
  const body = '{"type":1}';
  const request = fakeRequest(body);

  const tamperedBody = fakeResponse();
  await handler.handleRequest(request, tamperedBody, '{"type":1} ');
  assert.equal(tamperedBody.statusCode, 401);

  const tamperedTimestamp = fakeResponse();
  const headers = Object.assign({}, request.headers, { 'x-signature-timestamp': '1700000099' });
  await handler.handleRequest({ headers }, tamperedTimestamp, body);
  assert.equal(tamperedTimestamp.statusCode, 401);
});

test('a malformed signature shape never reaches crypto.verify', async () => {
  const { handler } = build();
  const body = '{"type":1}';
  const response = fakeResponse();
  await handler.handleRequest({
    headers: { 'x-signature-ed25519': 'not-hex!', 'x-signature-timestamp': '1700000000' }
  }, response, body);
  assert.equal(response.statusCode, 401);
});

test('bodies over 64KB are refused before verification', async () => {
  const { handler } = build();
  const body = `{"pad":"${'x'.repeat(MAX_BODY_BYTES)}"}`;
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  assert.equal(response.statusCode, 413);
});

test('an unconfigured public key fails closed with 503', async () => {
  const { handler } = build({ deps: { config: { discordConnectAppId: APP_ID } } });
  const body = '{"type":1}';
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, 'integration_unconfigured');
});

test('signed but invalid JSON is 400', async () => {
  const { handler } = build();
  const body = '{nope';
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'invalid_json');
});

test('an unknown command answers with an ephemeral error', async () => {
  const { handler } = build();
  const body = commandInteraction('who-am-i');
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  assert.equal(response.statusCode, 200);
  const parsed = response.json();
  assert.equal(parsed.type, 4);
  assert.equal(parsed.data.flags, 64);
  assert.equal(parsed.data.content, 'Unknown command.');
});

test('a cheap command answers type 4 with flags 64 and sends no follow-up', async () => {
  const { handler, fetched } = build();
  const body = commandInteraction('disputes');
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  const parsed = response.json();
  assert.equal(parsed.type, 4);
  assert.equal(parsed.data.flags, 64);
  assert.match(parsed.data.content, /case #12/);
  assert.equal(fetched.calls.length, 0);
});

test('a slow command defers (type 5, flags 64) and the follow-up posts to the interaction webhook', async () => {
  const { handler, fetched } = build();
  const body = commandInteraction('dispute-build', [{ name: 'case_id', value: '12' }]);
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);

  const parsed = response.json();
  assert.equal(parsed.type, 5);
  assert.equal(parsed.data.flags, 64);

  assert.equal(fetched.calls.length, 1);
  assert.equal(fetched.calls[0].url, `https://discord.com/api/v10/webhooks/${APP_ID}/follow-up-token-xyz`);
  assert.equal(fetched.calls[0].options.method, 'POST');
  const payload = JSON.parse(fetched.calls[0].options.body);
  assert.equal(payload.flags, 64);
  assert.match(payload.content, /version 2/);
});

test('the follow-up sender retries after a 429 using the returned retry_after', async () => {
  const { handler, fetched, slept } = build({ fetchStatuses: [429, 200] });
  const body = commandInteraction('dispute-build', [{ name: 'case_id', value: '12' }]);
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  assert.equal(fetched.calls.length, 2);
  assert.deepEqual(slept, [10]);
  for (const call of fetched.calls) {
    assert.equal(JSON.parse(call.options.body).flags, 64);
  }
});

test('interaction types other than PING, command, and component get an ephemeral not-supported reply', async () => {
  const { handler } = build();
  const body = JSON.stringify({ id: 'interaction_c', type: 99, token: 'tok', data: {} });
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  const parsed = response.json();
  assert.equal(parsed.type, 4);
  assert.equal(parsed.data.flags, 64);
});

test('a signed component button is routed to the Connect setup handler', async () => {
  const { handler } = build();
  const body = componentInteraction('sml_connect:uc:yes');
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  const parsed = response.json();
  assert.equal(parsed.type, 4);
  assert.equal(parsed.data.flags, 64);
  assert.match(parsed.data.content, /map Upgrade.Chat products/);
  assert.match(parsed.data.content, /Making Easy Money/);
});

test('a follow-up with a malformed webhook token is dropped, not sent', async () => {
  const { handler, fetched } = build();
  const raw = JSON.parse(commandInteraction('dispute-build', [{ name: 'case_id', value: '12' }]));
  raw.token = '../../evil path';
  const body = JSON.stringify(raw);
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  assert.equal(response.json().type, 5);
  assert.equal(fetched.calls.length, 0);
});

test('a transport-level fetch failure is swallowed after the deferred acknowledgement', async () => {
  const { handler } = build({
    deps: { fetchImpl: async () => { throw new Error('network down'); } }
  });
  const body = commandInteraction('dispute-build', [{ name: 'case_id', value: '12' }]);
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  assert.equal(response.json().type, 5);
});

test('an injected commands fake isolates the transport layer', async () => {
  let seen = null;
  const { handler } = build({
    deps: {
      commands: {
        async handleCommand(interaction) {
          seen = interaction;
          return { response: { type: 4, data: { content: 'ok', flags: 64 } } };
        }
      }
    }
  });
  const body = commandInteraction('payments');
  const response = fakeResponse();
  await handler.handleRequest(fakeRequest(body), response, body);
  assert.equal(seen.data.name, 'payments');
  assert.equal(response.json().data.content, 'ok');
});
