'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const audit = require('./audit');
const { createFakeStore, USER, clock } = require('./testkit');

async function seed(store, now, n = 3) {
  for (let i = 0; i < n; i += 1) {
    await audit.appendStandalone(store.pool, { actor: 'webhook', livemode: false, action: 'access_changed', discordUserId: USER,
      outcome: 'applied', reason: `r${i}`, stripeRefs: ['sub_1', 'not a ref'], details: { step: i } }, { now });
    now.advance(1000);
  }
}

test('the hash chain links every row to the previous one', async () => {
  const now = clock();
  const store = createFakeStore({ now });
  await seed(store, now);
  const rows = store.db.audit;
  assert.equal(rows[0].prev_hash, null);
  assert.equal(rows[1].prev_hash, rows[0].row_hash);
  assert.equal(rows[2].prev_hash, rows[1].row_hash);
  assert.deepEqual(rows[0].stripe_refs, ['sub_1']);
  const result = await audit.verifyChain(store.pool);
  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
  assert.equal(result.head, rows[2].row_hash);
});

test('verifyChain detects an edited row and a removed row', async () => {
  const now = clock();
  const store = createFakeStore({ now });
  await seed(store, now, 4);
  store.db.audit[1].reason = 'edited';
  const edited = await audit.verifyChain(store.pool);
  assert.deepEqual([edited.ok, edited.brokenAt, edited.problem], [false, 2, 'row_hash_mismatch']);
  store.db.audit[1].reason = 'r1';
  assert.equal((await audit.verifyChain(store.pool)).ok, true);
  store.db.audit.splice(2, 1);
  const removed = await audit.verifyChain(store.pool);
  assert.deepEqual([removed.ok, removed.brokenAt, removed.problem], [false, 4, 'chain_link_broken']);
});

test('details carry no email, name, address, amount or secret fields', async () => {
  const now = clock();
  const store = createFakeStore({ now });
  await audit.appendStandalone(store.pool, { actor: 'checkout', action: 'intent_created', discordUserId: USER,
    details: { email: 'a@b.c', username: 'bob', customerName: 'Bob', address: { line1: 'x' }, amount: 2999, token: 't', package: 'monthly', nested: { phone: '1', ok: 1 } } }, { now });
  assert.deepEqual(store.db.audit[0].details, { package: 'monthly', nested: { ok: 1 } });
});

test('invalid actors, actions, outcomes and ids are refused before anything is written', async () => {
  const now = clock();
  const store = createFakeStore({ now });
  await assert.rejects(() => audit.appendStandalone(store.pool, { actor: 'someone', action: 'access_changed' }), /actor/);
  await assert.rejects(() => audit.appendStandalone(store.pool, { actor: 'webhook', action: 'Bad Action' }), /action/);
  await assert.rejects(() => audit.appendStandalone(store.pool, { actor: 'webhook', action: 'access_changed', outcome: 'maybe' }), /outcome/);
  await assert.rejects(() => audit.appendStandalone(store.pool, { actor: 'webhook', action: 'access_changed', discordUserId: 'bob' }), /discord id/);
  await assert.rejects(() => audit.appendStandalone(store.pool, { actor: 'webhook', action: 'access_changed', roleKey: 'premium' }), /role key/);
  assert.equal(store.db.audit.length, 0);
  await audit.appendStandalone(store.pool, { actor: 'cli:owner', action: 'comp_granted' }, { now });
  assert.equal(store.db.audit.length, 1);
});

test('canonical JSON is key-order independent', () => {
  assert.equal(audit.canonical({ b: 1, a: [2, { d: 1, c: null }] }), audit.canonical({ a: [2, { c: null, d: 1 }], b: 1 }));
  assert.notEqual(audit.hashRow(null, { a: 1 }), audit.hashRow('x', { a: 1 }));
});

test('append takes the chain lock and inserts as its last statements', async () => {
  const seen = [];
  const client = { query: async (sql) => { seen.push(sql.trim().split(/\s+/).slice(0, 2).join(' ')); return { rows: [] }; } };
  await audit.append(client, { actor: 'resync', action: 'access_changed' });
  assert.deepEqual(seen, ['SELECT pg_advisory_xact_lock($1::bigint)', 'SELECT row_hash', 'INSERT INTO']);
});

test('migration 028 makes the audit append-only (UPDATE, DELETE and TRUNCATE raise)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../../group-subs/migrations/028_academy_billing_up.sql'), 'utf8');
  assert.match(sql, /BEFORE UPDATE OR DELETE ON academy_billing_audit\s+FOR EACH ROW EXECUTE FUNCTION academy_billing_audit_immutable\(\)/);
  assert.match(sql, /BEFORE TRUNCATE ON academy_billing_audit\s+FOR EACH STATEMENT EXECUTE FUNCTION academy_billing_audit_immutable\(\)/);
  assert.match(sql, /RAISE EXCEPTION 'academy_billing_audit is append-only'/);
});

/* Real-database check, only when a disposable test database is provided.
   Runs 028 in a throw-away schema inside a transaction that is rolled back,
   so it also works on a database that already has 028 applied. */
test('the trigger rejects UPDATE, DELETE and TRUNCATE on a real database', { skip: !process.env.DATABASE_URL_TEST }, async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL_TEST });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = `abaudit_${Date.now()}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    const up = fs.readFileSync(path.join(__dirname, '../../../group-subs/migrations/028_academy_billing_up.sql'), 'utf8')
      .replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
    await client.query(up);
    await audit.append(client, { actor: 'boot', action: 'integration_probe' });
    await client.query('SAVEPOINT s1');
    await assert.rejects(() => client.query("UPDATE academy_billing_audit SET reason = 'x'"), /append-only/);
    await client.query('ROLLBACK TO SAVEPOINT s1');
    await assert.rejects(() => client.query('DELETE FROM academy_billing_audit'), /append-only/);
    await client.query('ROLLBACK TO SAVEPOINT s1');
    await assert.rejects(() => client.query('TRUNCATE academy_billing_audit'), /append-only/);
    await client.query('ROLLBACK TO SAVEPOINT s1');
    const verified = await audit.verifyChain(client);
    assert.equal(verified.ok, true);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
});
