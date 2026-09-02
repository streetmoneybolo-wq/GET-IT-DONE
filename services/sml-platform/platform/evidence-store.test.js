'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  CHAINED_TABLES,
  canonicalJson,
  createEvidenceStore,
  validateNoForbiddenFields
} = require('./evidence-store');

const ACTIVE_KEY = 'active-master-key-material-0123456789';
const OLD_KEY = 'old-master-key-material-9876543210';

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function makeStore(keyList = [ACTIVE_KEY]) {
  return createEvidenceStore({ pool: null, keyList });
}

function fakeClient(responders = []) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ text, values });
      for (const responder of responders) {
        if (responder.match.test(text)) return responder.result({ text, values });
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

function prov(overrides = {}) {
  return {
    source: 'stripe',
    source_event_id: 'evt_1',
    provider_account: null,
    occurred_at: '2026-09-01T12:00:00.000Z',
    received_at: '2026-09-01T12:00:01.000Z',
    provenance: {},
    ...overrides
  };
}

/* ---------- canonicalJson determinism ---------- */

test('canonicalJson sorts keys so insertion order never changes the hash', () => {
  const a = canonicalJson({ zebra: 1, alpha: { b: 2, a: 1 }, mid: [1, 2] });
  const b = canonicalJson({ mid: [1, 2], alpha: { a: 1, b: 2 }, zebra: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"alpha":{"a":1,"b":2},"mid":[1,2],"zebra":1}');
});

test('canonicalJson sorts integer-like keys lexicographically, not numerically', () => {
  assert.equal(canonicalJson({ 10: 'x', 2: 'y' }), '{"10":"x","2":"y"}');
});

test('canonicalJson follows JSONB last-duplicate-wins for duplicate keys', () => {
  const parsed = JSON.parse('{"amount":1,"amount":2,"currency":"usd"}');
  assert.equal(canonicalJson(parsed), '{"amount":2,"currency":"usd"}');
});

test('canonicalJson renders numbers via JSON round-trip canonically', () => {
  assert.equal(canonicalJson({ a: 1.0, b: 1e2, c: 0.5 }), '{"a":1,"b":100,"c":0.5}');
  assert.throws(() => canonicalJson({ a: Infinity }), TypeError);
  assert.throws(() => canonicalJson({ a: NaN }), TypeError);
});

test('canonicalJson renders Date values as UTC ISO-8601 with milliseconds', () => {
  const at = new Date('2026-09-01T05:06:07.089Z');
  assert.equal(canonicalJson({ at }), '{"at":"2026-09-01T05:06:07.089Z"}');
  /* Timestamp strings pass through verbatim — the app renders them. */
  assert.equal(
    canonicalJson({ at: '2026-09-01T05:06:07.089Z' }),
    '{"at":"2026-09-01T05:06:07.089Z"}'
  );
});

test('canonicalJson treats null and undefined values identically and stably', () => {
  assert.equal(canonicalJson(null), 'null');
  assert.equal(canonicalJson({ a: null }), '{"a":null}');
  assert.equal(canonicalJson([1, undefined, 2]), '[1,null,2]');
});

/* ---------- encryption, rotation, key stamping ---------- */

test('encryptValue/decryptValue round-trip with the documented blob format', () => {
  const store = makeStore();
  const blob = store.encryptValue('cus_ABC123');
  assert.ok(Buffer.isBuffer(blob));
  assert.equal(blob[0], 0x01, 'blob version byte');
  assert.equal(blob[1], store.activeKeyVersion, 'key_version stamped in blob');
  assert.ok(blob.length >= 2 + 12 + 16 + 1, 'header + iv + tag + ciphertext');
  assert.equal(store.decryptValue(blob), 'cus_ABC123');
});

test('key rotation: old key still decrypts, new key encrypts new rows', () => {
  const oldStore = makeStore([OLD_KEY]);
  const oldBlob = oldStore.encryptValue('payer-77');
  assert.equal(oldBlob[1], 1);

  const rotated = makeStore([ACTIVE_KEY, OLD_KEY]);
  assert.equal(rotated.activeKeyVersion, 2, 'first entry is active and newest');
  assert.equal(rotated.decryptValue(oldBlob), 'payer-77', 'old key decrypts old rows');

  const newBlob = rotated.encryptValue('payer-77');
  assert.equal(newBlob[1], 2, 'new rows stamped with the active key version');
  assert.equal(rotated.decryptValue(newBlob), 'payer-77');
});

test('tampered ciphertext fails authentication instead of decrypting', () => {
  const store = makeStore();
  const blob = store.encryptValue('sub_123');
  blob[blob.length - 1] ^= 0xff;
  assert.throws(() => store.decryptValue(blob));
});

test('a blob from an unknown key version is rejected', () => {
  const store = makeStore();
  const blob = store.encryptValue('x-value-1');
  blob[1] = 250;
  assert.throws(() => store.decryptValue(blob), /no decryption key/);
});

/* ---------- lookup hashes ---------- */

test('lookupHash uses the active key; lookupHashesAll spans every key version', () => {
  const oldStore = makeStore([OLD_KEY]);
  const rotated = makeStore([ACTIVE_KEY, OLD_KEY]);

  const all = rotated.lookupHashesAll('cus_ABC123');
  assert.equal(all.length, 2);
  assert.equal(all[0], rotated.lookupHash('cus_ABC123'), 'active hash first');
  assert.equal(all[1], oldStore.lookupHash('cus_ABC123'), 'old-key hash still findable');
  assert.notEqual(all[0], all[1]);
  assert.match(all[0], /^[0-9a-f]{64}$/);
  /* Deterministic for equality lookups. */
  assert.equal(rotated.lookupHash('cus_ABC123'), rotated.lookupHash('cus_ABC123'));
  assert.notEqual(rotated.lookupHash('cus_ABC123'), rotated.lookupHash('cus_ABC124'));
});

/* ---------- forbidden-field validation ---------- */

test('forbidden field names are rejected anywhere in the object graph', () => {
  assert.throws(() => validateNoForbiddenFields({ card_number: '1' }), TypeError);
  assert.throws(() => validateNoForbiddenFields({ nested: { cvv: '123' } }), TypeError);
  assert.throws(() => validateNoForbiddenFields({ list: [{ Password: 'x' }] }), TypeError);
  assert.throws(() => validateNoForbiddenFields({ api_token: 'x' }), TypeError);
  assert.throws(() => validateNoForbiddenFields({ Authorization: 'Bearer x' }), TypeError);
  assert.throws(() => validateNoForbiddenFields({ client_secret: 'x' }), TypeError);
  assert.throws(() => validateNoForbiddenFields({ CvC: 'x' }), TypeError);
});

test('ordinary evidence fields pass the denylist', () => {
  const clean = {
    source: 'stripe',
    amount_cents: 999,
    provenance: { note: 'charge record', ids: [1, 2] },
    occurred_at: '2026-09-01T00:00:00.000Z'
  };
  assert.equal(validateNoForbiddenFields(clean), clean);
});

test('appendChained refuses fields with forbidden names', async () => {
  const store = makeStore();
  const client = fakeClient();
  await assert.rejects(
    () => store.appendChained(client, {
      table: 'service_usage_events',
      scopeKey: 42,
      fields: { identity_id: 42, usage_type: 'login', card_last4: '4242', ...prov() }
    }),
    TypeError
  );
  assert.equal(client.calls.length, 0, 'nothing reaches the database');
});

/* ---------- appendChained ---------- */

test('appendChained takes the advisory lock, reads the head, and links prev_hash', async () => {
  const store = makeStore();
  const previousHash = 'f'.repeat(64);
  const client = fakeClient([
    { match: /^SELECT integrity_hash FROM service_usage_events/, result: () => ({ rows: [{ integrity_hash: previousHash }], rowCount: 1 }) },
    { match: /^INSERT INTO service_usage_events/, result: () => ({ rows: [{ id: 501 }], rowCount: 1 }) }
  ]);
  const fields = {
    identity_id: 42,
    usage_type: 'login',
    entitlement_ref: null,
    ...prov()
  };
  const result = await store.appendChained(client, {
    table: 'service_usage_events', scopeKey: 42, fields
  });

  const lock = client.calls[0];
  assert.equal(lock.text, 'SELECT pg_advisory_xact_lock(hashtext($1))');
  assert.deepEqual(lock.values, ['service_usage_events:42']);

  const head = client.calls[1];
  assert.match(head.text, /SELECT integrity_hash FROM service_usage_events WHERE identity_id = \$1 ORDER BY id DESC LIMIT 1/);
  assert.deepEqual(head.values, [42]);

  const insert = client.calls[2];
  assert.match(insert.text, /^INSERT INTO service_usage_events/);
  assert.match(insert.text, /prev_hash, integrity_hash/);
  const prevIndex = insert.values.indexOf(previousHash);
  assert.ok(prevIndex >= 0, 'prev_hash from the chain head is inserted');

  const expectedHash = sha256Hex(canonicalJson({ ...fields, prev_hash: previousHash }));
  assert.equal(result.integrityHash, expectedHash, 'hash covers fields + prev_hash');
  assert.ok(insert.values.includes(expectedHash));
  assert.equal(result.id, 501);
});

test('the first row of a scope links prev_hash NULL', async () => {
  const store = makeStore();
  const client = fakeClient([
    { match: /^INSERT INTO billing_events/, result: () => ({ rows: [{ id: 1 }], rowCount: 1 }) }
  ]);
  const fields = {
    provider: 'paypal', provider_event_id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED',
    ...prov({ source: 'paypal' })
  };
  const result = await store.appendChained(client, {
    table: 'billing_events', scopeKey: 'paypal', fields
  });
  assert.equal(result.integrityHash, sha256Hex(canonicalJson({ ...fields, prev_hash: null })));
});

test('dispute_audit_log system chain uses COALESCE(case_id, 0) with scope 0', async () => {
  const store = makeStore();
  const client = fakeClient([
    { match: /^INSERT INTO dispute_audit_log/, result: () => ({ rows: [{ id: 9 }], rowCount: 1 }) }
  ]);
  await store.appendChained(client, {
    table: 'dispute_audit_log',
    scopeKey: 0,
    fields: {
      case_id: null, actor_kind: 'system', actor_ref: null,
      action: 'sweep_started', detail: {}, ...prov({ source: 'sml_platform' })
    }
  });
  assert.deepEqual(client.calls[0].values, ['dispute_audit_log:0']);
  assert.match(client.calls[1].text, /WHERE COALESCE\(case_id, 0\) = \$1/);
});

test('appendChained validates table, scope, and writer-supplied provenance', async () => {
  const store = makeStore();
  const client = fakeClient();
  await assert.rejects(
    () => store.appendChained(client, { table: 'dispute_packets', scopeKey: 1, fields: prov() }),
    /not a chained table/
  );
  await assert.rejects(
    () => store.appendChained(client, {
      table: 'service_usage_events', scopeKey: 42,
      fields: { identity_id: 43, usage_type: 'login', ...prov() }
    }),
    /must match scopeKey/
  );
  const missingReceived = { identity_id: 42, usage_type: 'login', ...prov() };
  delete missingReceived.received_at;
  await assert.rejects(
    () => store.appendChained(client, {
      table: 'service_usage_events', scopeKey: 42, fields: missingReceived
    }),
    /received_at/
  );
  assert.equal(client.calls.length, 0);
});

test('appendRow is unchained: no lock, no head read, prev_hash NULL', async () => {
  const store = makeStore();
  const client = fakeClient([
    { match: /^INSERT INTO billing_identity_refs/, result: () => ({ rows: [{ id: 3 }], rowCount: 1 }) }
  ]);
  const fields = {
    identity_id: 7, provider: 'stripe', ref_type: 'customer',
    ref_value_enc: store.encryptValue('cus_1'), ref_lookup_hash: store.lookupHash('cus_1'),
    key_version: store.activeKeyVersion, verification: 'verified', ...prov()
  };
  const result = await store.appendRow(client, { table: 'billing_identity_refs', fields });
  assert.equal(client.calls.length, 1, 'exactly one INSERT');
  assert.equal(result.id, 3);
  assert.equal(result.integrityHash, sha256Hex(canonicalJson({ ...fields, prev_hash: null })));
});

/* ---------- verifyChain ---------- */

function buildChainRows(fieldSets) {
  const rows = [];
  let previous = null;
  fieldSets.forEach((fields, index) => {
    const integrityHash = sha256Hex(canonicalJson({ ...fields, prev_hash: previous }));
    rows.push({ id: index + 1, ...fields, prev_hash: previous, integrity_hash: integrityHash });
    previous = integrityHash;
  });
  return rows;
}

function evidenceFields(text) {
  return {
    case_id: 7, kind: 'billing_record', body_text: text, body_json: null,
    file_name: null, file_sha256: null, file_bytes: null,
    cited_records: [{ table: 'billing_transactions', id: 12 }],
    superseded_by: null, ...prov()
  };
}

test('verifyChain accepts an intact chain', async () => {
  const store = makeStore();
  const rows = buildChainRows([evidenceFields('one'), evidenceFields('two'), evidenceFields('three')]);
  const client = fakeClient([
    { match: /^SELECT \* FROM dispute_evidence_items/, result: () => ({ rows, rowCount: rows.length }) }
  ]);
  assert.deepEqual(await store.verifyChain(client, 'dispute_evidence_items', 7), { ok: true });
  assert.match(client.calls[0].text, /WHERE case_id = \$1 ORDER BY id ASC/);
  assert.deepEqual(client.calls[0].values, [7]);
});

test('verifyChain detects a tampered middle row', async () => {
  const store = makeStore();
  const rows = buildChainRows([evidenceFields('one'), evidenceFields('two'), evidenceFields('three')]);
  rows[1].body_text = 'two (altered after the fact)';
  const client = fakeClient([
    { match: /^SELECT \* FROM dispute_evidence_items/, result: () => ({ rows, rowCount: rows.length }) }
  ]);
  assert.deepEqual(
    await store.verifyChain(client, 'dispute_evidence_items', 7),
    { ok: false, brokenAtId: 2 }
  );
});

test('verifyChain detects broken prev_hash linkage', async () => {
  const store = makeStore();
  const rows = buildChainRows([evidenceFields('one'), evidenceFields('two')]);
  rows[1].prev_hash = 'a'.repeat(64);
  const client = fakeClient([
    { match: /^SELECT \* FROM dispute_evidence_items/, result: () => ({ rows, rowCount: rows.length }) }
  ]);
  assert.deepEqual(
    await store.verifyChain(client, 'dispute_evidence_items', 7),
    { ok: false, brokenAtId: 2 }
  );
});

test('verifyChain reproduces hashes for rows read back with Date and JSONB values', async () => {
  /* Writer supplies ISO strings and JS objects; a real read returns Date
   * objects for TIMESTAMPTZ and objects for JSONB. Both must hash alike. */
  const store = makeStore();
  const written = evidenceFields('round-trip');
  const rows = buildChainRows([written]);
  const readBack = {
    ...rows[0],
    occurred_at: new Date(written.occurred_at),
    received_at: new Date(written.received_at),
    cited_records: JSON.parse(JSON.stringify(written.cited_records)),
    provenance: {}
  };
  const client = fakeClient([
    { match: /^SELECT \* FROM dispute_evidence_items/, result: () => ({ rows: [readBack], rowCount: 1 }) }
  ]);
  assert.deepEqual(await store.verifyChain(client, 'dispute_evidence_items', 7), { ok: true });
});

/* ---------- construction ---------- */

test('the chained-table registry matches the design scopes', () => {
  assert.deepEqual(Object.keys(CHAINED_TABLES).sort(), [
    'billing_events', 'dispute_audit_log', 'dispute_evidence_items', 'service_usage_events'
  ]);
  assert.equal(CHAINED_TABLES.billing_events.scopeColumn, 'provider');
  assert.equal(CHAINED_TABLES.dispute_audit_log.coalesceScope, true);
});

test('createEvidenceStore rejects unusable key lists', () => {
  assert.throws(() => createEvidenceStore({ pool: null, keyList: [] }), TypeError);
  assert.throws(() => createEvidenceStore({ pool: null, keyList: ['short'] }), TypeError);
  assert.throws(
    () => createEvidenceStore({ pool: null, keyList: ['1:' + ACTIVE_KEY, '1:' + OLD_KEY] }),
    /duplicate key version/
  );
});
