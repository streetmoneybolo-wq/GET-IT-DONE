'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createEvidenceStore } = require('./evidence-store');
const { createIdentityGraph } = require('./identity-graph');

const ACTIVE_KEY = 'active-master-key-material-0123456789';
const OLD_KEY = 'old-master-key-material-9876543210';

function makeStore(keyList = [ACTIVE_KEY, OLD_KEY]) {
  return createEvidenceStore({ pool: null, keyList });
}

function makeGraph(store = makeStore()) {
  return { graph: createIdentityGraph({ pool: null, store }), store };
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
    source_event_id: 'evt_link_1',
    provider_account: 'acct_1',
    occurred_at: '2026-09-01T12:00:00.000Z',
    received_at: '2026-09-01T12:00:01.000Z',
    provenance: { via: 'checkout_metadata' },
    ...overrides
  };
}

function identityRow(overrides = {}) {
  return {
    id: 3,
    sml_user_id: null,
    wordpress_user_id: 8,
    discord_user_id: null,
    email_candidate: null,
    verification: 'verified',
    verified_via: 'oauth_link',
    ...overrides
  };
}

/* ---------- findByRef ---------- */

test('findByRef looks up across every key version via lookupHashesAll', async () => {
  const { graph, store } = makeGraph();
  const row = identityRow();
  const client = fakeClient([
    { match: /^SELECT bi\.\* FROM billing_identity_refs/, result: () => ({ rows: [row], rowCount: 1 }) }
  ]);
  const found = await graph.findByRef(client, 'stripe', 'customer', 'cus_ABC');
  assert.deepEqual(found, row);
  const call = client.calls[0];
  assert.equal(call.values[0], 'stripe');
  assert.equal(call.values[1], 'customer');
  assert.deepEqual(call.values[2], store.lookupHashesAll('cus_ABC'), 'all key versions searched');
  assert.match(call.text, /ref_lookup_hash = ANY\(\$3\)/);
});

test('findByRef returns null on no match and validates the provider', async () => {
  const { graph } = makeGraph();
  const client = fakeClient();
  assert.equal(await graph.findByRef(client, 'stripe', 'customer', 'cus_none'), null);
  await assert.rejects(() => graph.findByRef(client, 'venmo', 'customer', 'x-1'), TypeError);
  await assert.rejects(() => graph.findByRef(client, 'stripe', 'customer', ''), TypeError);
});

/* ---------- linkVerified ---------- */

test('linkVerified creates a new identity and a verified encrypted ref edge', async () => {
  const { graph, store } = makeGraph();
  const client = fakeClient([
    { match: /^INSERT INTO billing_identities/, result: () => ({ rows: [{ id: 11 }], rowCount: 1 }) },
    { match: /^INSERT INTO billing_identity_refs/, result: () => ({ rows: [{ id: 5 }], rowCount: 1 }) }
  ]);
  const identityId = await graph.linkVerified(client, {
    provider: 'stripe',
    refType: 'customer',
    refValue: 'cus_NEW',
    sml_user_id: 42,
    via: 'checkout_metadata:cs_123',
    prov: prov()
  });
  assert.equal(identityId, 11);

  const identityInsert = client.calls.find((call) => call.text.startsWith('INSERT INTO billing_identities'));
  assert.match(identityInsert.text, /'verified'/);
  assert.equal(identityInsert.values[0], 42);
  assert.equal(identityInsert.values[3], 'checkout_metadata:cs_123');

  const refInsert = client.calls.find((call) => call.text.startsWith('INSERT INTO billing_identity_refs'));
  assert.ok(refInsert, 'ref edge inserted');
  assert.ok(refInsert.values.includes('verified'));
  assert.ok(refInsert.values.includes(store.lookupHash('cus_NEW')), 'active-key lookup hash stored');
  assert.ok(refInsert.values.includes(store.activeKeyVersion), 'key_version stamped');
  const encrypted = refInsert.values.find((value) => Buffer.isBuffer(value));
  assert.ok(encrypted, 'ref value stored encrypted, never in clear');
  assert.equal(store.decryptValue(encrypted), 'cus_NEW');
  assert.equal(refInsert.values.includes('cus_NEW'), false, 'plaintext never reaches SQL');
  assert.match(refInsert.text, /integrity_hash/, 'ref rows are hash-stamped');
});

test('linkVerified reuses a matched identity and fills missing person columns', async () => {
  const { graph } = makeGraph();
  const existing = identityRow({ id: 3, wordpress_user_id: 8, discord_user_id: null });
  const client = fakeClient([
    { match: /^SELECT \* FROM billing_identities WHERE wordpress_user_id/, result: () => ({ rows: [existing], rowCount: 1 }) },
    { match: /^SELECT \* FROM billing_identities WHERE discord_user_id/, result: () => ({ rows: [], rowCount: 0 }) },
    { match: /^INSERT INTO billing_identity_refs/, result: () => ({ rows: [{ id: 6 }], rowCount: 1 }) }
  ]);
  const identityId = await graph.linkVerified(client, {
    provider: 'discord',
    refType: 'uc_customer',
    refValue: 'uc-900',
    wordpress_user_id: 8,
    discord_user_id: 'discord-555',
    via: 'signed_wp_gateway:evt-1',
    prov: prov({ source: 'wordpress' })
  });
  assert.equal(identityId, 3);
  assert.equal(client.calls.some((call) => call.text.startsWith('INSERT INTO billing_identities')), false, 'no second identity');
  const update = client.calls.find((call) => call.text.startsWith('UPDATE billing_identities'));
  assert.ok(update, 'missing identifier filled in');
  assert.match(update.text, /discord_user_id = \$2/);
  assert.deepEqual(update.values.slice(0, 2), [3, 'discord-555']);
});

test('linkVerified never merges two existing identities silently', async () => {
  const { graph } = makeGraph();
  const client = fakeClient([
    { match: /WHERE sml_user_id/, result: () => ({ rows: [identityRow({ id: 1, sml_user_id: 42 })], rowCount: 1 }) },
    { match: /WHERE wordpress_user_id/, result: () => ({ rows: [identityRow({ id: 2, wordpress_user_id: 8 })], rowCount: 1 }) }
  ]);
  await assert.rejects(
    () => graph.linkVerified(client, {
      provider: 'stripe', refType: 'customer', refValue: 'cus_X',
      sml_user_id: 42, wordpress_user_id: 8,
      via: 'checkout_metadata:cs_9', prov: prov()
    }),
    (error) => error instanceof TypeError && /identity_conflict/.test(error.message)
  );
  assert.equal(client.calls.some((call) => /INSERT|UPDATE/.test(call.text)), false, 'no write happened');
});

test('linkVerified conflicts when a matched identity disagrees on another identifier', async () => {
  const { graph } = makeGraph();
  const client = fakeClient([
    { match: /WHERE wordpress_user_id/, result: () => ({ rows: [identityRow({ id: 3, wordpress_user_id: 8, sml_user_id: 700 })], rowCount: 1 }) },
    { match: /WHERE sml_user_id/, result: () => ({ rows: [], rowCount: 0 }) }
  ]);
  await assert.rejects(
    () => graph.linkVerified(client, {
      provider: 'stripe', refType: 'customer', refValue: 'cus_X',
      sml_user_id: 42, wordpress_user_id: 8,
      via: 'checkout_metadata:cs_9', prov: prov()
    }),
    /identity_conflict/
  );
});

test('linkVerified conflicts when a person-scoped ref already belongs to another identity', async () => {
  const { graph } = makeGraph();
  const client = fakeClient([
    { match: /^INSERT INTO billing_identities/, result: () => ({ rows: [{ id: 20 }], rowCount: 1 }) },
    { match: /^SELECT \* FROM billing_identity_refs/, result: () => ({ rows: [{ id: 90, identity_id: 4, verification: 'verified' }], rowCount: 1 }) }
  ]);
  await assert.rejects(
    () => graph.linkVerified(client, {
      provider: 'stripe', refType: 'customer', refValue: 'cus_TAKEN',
      sml_user_id: 42, via: 'checkout_metadata:cs_1', prov: prov()
    }),
    /identity_conflict/
  );
});

test('linkVerified is idempotent for an existing verified edge and promotes only via trusted events', async () => {
  const { graph } = makeGraph();
  const client = fakeClient([
    { match: /WHERE sml_user_id/, result: () => ({ rows: [identityRow({ id: 3, sml_user_id: 42 })], rowCount: 1 }) },
    { match: /^SELECT \* FROM billing_identity_refs/, result: () => ({ rows: [{ id: 90, identity_id: 3, verification: 'candidate' }], rowCount: 1 }) }
  ]);
  const identityId = await graph.linkVerified(client, {
    provider: 'stripe', refType: 'customer', refValue: 'cus_MINE',
    sml_user_id: 42, via: 'oauth_link:9', prov: prov()
  });
  assert.equal(identityId, 3);
  const promote = client.calls.find((call) => call.text.startsWith('UPDATE billing_identity_refs'));
  assert.ok(promote, 'candidate edge promoted by the trusted linking event');
  assert.match(promote.text, /verification = 'verified'/);
  assert.equal(client.calls.some((call) => call.text.startsWith('INSERT INTO billing_identity_refs')), false);
});

test('linkVerified requires a trusted linking event ref and a person identifier', async () => {
  const { graph } = makeGraph();
  const client = fakeClient();
  await assert.rejects(
    () => graph.linkVerified(client, {
      provider: 'stripe', refType: 'customer', refValue: 'cus_1', sml_user_id: 42, prov: prov()
    }),
    TypeError
  );
  await assert.rejects(
    () => graph.linkVerified(client, {
      provider: 'stripe', refType: 'customer', refValue: 'cus_1',
      via: 'checkout_metadata:cs_1', prov: prov()
    }),
    /person identifier/
  );
  assert.equal(client.calls.length, 0);
});

/* ---------- recordCandidate ---------- */

test('recordCandidate creates a flagged candidate identity and edge, never verified', async () => {
  const { graph } = makeGraph();
  const client = fakeClient([
    { match: /^INSERT INTO billing_identities/, result: () => ({ rows: [{ id: 31 }], rowCount: 1 }) },
    { match: /^INSERT INTO billing_identity_refs/, result: () => ({ rows: [{ id: 8 }], rowCount: 1 }) }
  ]);
  const identityId = await graph.recordCandidate(client, {
    provider: 'paypal',
    refType: 'payer',
    refValue: 'PAYER-1',
    email_candidate: 'match@example.com',
    prov: prov({ source: 'paypal' })
  });
  assert.equal(identityId, 31);

  const identityInsert = client.calls.find((call) => call.text.startsWith('INSERT INTO billing_identities'));
  assert.match(identityInsert.text, /'candidate'/);
  assert.doesNotMatch(identityInsert.text, /'verified'/);
  assert.equal(identityInsert.values[3], 'match@example.com');

  const refInsert = client.calls.find((call) => call.text.startsWith('INSERT INTO billing_identity_refs'));
  assert.ok(refInsert.values.includes('candidate'));
  assert.equal(refInsert.values.includes('verified'), false);
});

test('recordCandidate never modifies an existing identity or its verified edges', async () => {
  const { graph } = makeGraph();
  const existing = identityRow({ id: 3, wordpress_user_id: 8 });
  const client = fakeClient([
    { match: /WHERE wordpress_user_id/, result: () => ({ rows: [existing], rowCount: 1 }) },
    { match: /^SELECT \* FROM billing_identity_refs/, result: () => ({ rows: [{ id: 91, identity_id: 3, verification: 'verified' }], rowCount: 1 }) }
  ]);
  const identityId = await graph.recordCandidate(client, {
    provider: 'stripe', refType: 'customer', refValue: 'cus_SAME',
    wordpress_user_id: 8, prov: prov()
  });
  assert.equal(identityId, 3);
  assert.equal(client.calls.some((call) => /^(INSERT|UPDATE)/.test(call.text)), false, 'read-only when everything exists');
});

/* ---------- resolveMerchantAdmins ---------- */

test('resolveMerchantAdmins returns verified merchant-edge holders across key versions', async () => {
  const { graph, store } = makeGraph();
  const client = fakeClient([
    {
      match: /^SELECT DISTINCT bi\.id AS identity_id/,
      result: () => ({
        rows: [
          { identity_id: 3, wordpress_user_id: 8, discord_user_id: 'd-1' },
          { identity_id: 5, wordpress_user_id: null, discord_user_id: 'd-2' }
        ],
        rowCount: 2
      })
    }
  ]);
  const admins = await graph.resolveMerchantAdmins(client, 'acct_MERCH');
  assert.deepEqual(admins, [
    { identityId: 3, wordpress_user_id: 8, discord_user_id: 'd-1' },
    { identityId: 5, wordpress_user_id: null, discord_user_id: 'd-2' }
  ]);
  const call = client.calls[0];
  assert.deepEqual(call.values[0], store.lookupHashesAll('acct_MERCH'));
  assert.match(call.text, /ref_type IN \('merchant','connected_account'\)/);
  assert.match(call.text, /verification = 'verified'/);
});

test('resolveMerchantAdmins validates its scope argument', async () => {
  const { graph } = makeGraph();
  await assert.rejects(() => graph.resolveMerchantAdmins(fakeClient(), ''), TypeError);
});

/* ---------- construction ---------- */

test('the identity graph requires an injected evidence store', () => {
  assert.throws(() => createIdentityGraph({ pool: null }), TypeError);
});
