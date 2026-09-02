'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createUsageConsumer, entitlementRef, USAGE_TYPES } = require('./usage-consumer');

const NOW = 1_756_900_000_000;

function fakeDb(gatewayRows) {
  const usage = [];
  const sql = [];
  let nextId = 500;
  const links = [];
  function client() {
    return {
      async query(text, values = []) {
        const normalized = String(text).replace(/\s+/g, ' ').trim();
        sql.push({ text: normalized, values });
        if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') return { rows: [] };
        if (normalized.startsWith('SELECT e.id, e.event_id')) {
          const pending = gatewayRows.filter((row) => row.actor_user_id != null && values[0].includes(row.event_type) &&
            !usage.some((u) => u.source_event_id === row.event_id));
          return { rows: pending.slice(0, values[1]) };
        }
        throw new Error(`unexpected SQL ${normalized.slice(0, 60)}`);
      },
      release() {}
    };
  }
  const store = {
    async appendChained(_client, { table, scopeKey, fields }) {
      assert.equal(table, 'service_usage_events');
      if (usage.some((u) => u.source_event_id === fields.source_event_id)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      }
      const id = nextId++;
      usage.push({ id, scopeKey, ...fields });
      return { id, integrityHash: `h${id}` };
    }
  };
  const graph = {
    async linkVerified(_client, input) {
      links.push(input);
      if (input.wordpress_user_id === 666) throw new TypeError('identity_conflict');
      return 3000 + Number(input.wordpress_user_id);
    }
  };
  return { usage, sql, links, store, graph, pool: { async connect() { return client(); }, async query(t, v) { return client().query(t, v); } } };
}

function gatewayRow(overrides = {}) {
  return {
    id: 1, event_id: '5b8f9e7a-1111-4aaa-8bbb-000000000001', event_type: 'usage.group_access',
    occurred_at: new Date(NOW - 60_000), actor_user_id: 42, subject_type: 'group', subject_id: '9',
    payload: { groupId: 9, ip: '203.0.113.9', userAgent: 'Mozilla/5.0' },
    ...overrides
  };
}

test('entitlement reference prefers explicit entitlement, then group, then subject', () => {
  assert.equal(entitlementRef({ payload: { entitlement: 'plan:gold' } }), 'plan:gold');
  assert.equal(entitlementRef({ payload: { groupId: 9 } }), 'group:9');
  assert.equal(entitlementRef({ payload: {}, subject_type: 'stream', subject_id: 'live-77' }), 'stream:live-77');
  assert.equal(entitlementRef({ payload: {} }), null);
});

test('usage events are copied into the identity-scoped chain with mapped types and NO IP or device data', async () => {
  const db = fakeDb([gatewayRow(), gatewayRow({ id: 2, event_id: '5b8f9e7a-1111-4aaa-8bbb-000000000002', event_type: 'usage.login', payload: { ip: '198.51.100.1' }, subject_type: null, subject_id: null })]);
  const consumer = createUsageConsumer({ pool: db.pool, store: db.store, graph: db.graph, now: () => NOW });
  const summary = await consumer.sweep(50);
  assert.deepEqual(summary, { scanned: 2, recorded: 2, duplicate: 0, skipped: 0, failed: 0 });
  assert.equal(db.usage[0].usage_type, 'group_access');
  assert.equal(db.usage[0].entitlement_ref, 'group:9');
  assert.equal(db.usage[0].identity_id, 3042);
  assert.equal(db.usage[0].scopeKey, 3042);
  assert.equal(db.usage[0].source, 'wordpress');
  assert.equal(db.usage[1].usage_type, 'login');
  const serialized = JSON.stringify(db.usage);
  assert.doesNotMatch(serialized, /203\.0\.113\.9|198\.51\.100\.1|Mozilla/);
  assert.equal(db.links[0].via, 'wordpress_gateway:5b8f9e7a-1111-4aaa-8bbb-000000000001');
  assert.equal(db.links[0].refType, 'user');
  assert.equal(db.links[0].provider, 'wordpress');
});

test('a second sweep does not re-record already copied events, and a unique violation is reported as duplicate', async () => {
  const db = fakeDb([gatewayRow()]);
  const consumer = createUsageConsumer({ pool: db.pool, store: db.store, graph: db.graph, now: () => NOW });
  await consumer.sweep(10);
  const again = await consumer.sweep(10);
  assert.equal(again.scanned, 0);
  const outcome = await consumer.consumeRow(gatewayRow());
  assert.equal(outcome, 'duplicate');
});

test('rows without an actor and non-usage types are excluded at the query, and identity conflicts fail the row without stopping the sweep', async () => {
  const db = fakeDb([
    gatewayRow({ id: 3, event_id: '5b8f9e7a-1111-4aaa-8bbb-000000000003', actor_user_id: null }),
    gatewayRow({ id: 4, event_id: '5b8f9e7a-1111-4aaa-8bbb-000000000004', event_type: 'creator.channel.updated' }),
    gatewayRow({ id: 5, event_id: '5b8f9e7a-1111-4aaa-8bbb-000000000005', actor_user_id: 666 }),
    gatewayRow({ id: 6, event_id: '5b8f9e7a-1111-4aaa-8bbb-000000000006', actor_user_id: 7 })
  ]);
  const consumer = createUsageConsumer({ pool: db.pool, store: db.store, graph: db.graph, now: () => NOW, logger: () => {} });
  const summary = await consumer.sweep(10);
  assert.equal(summary.scanned, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.recorded, 1);
  const select = db.sql.find((entry) => entry.text.startsWith('SELECT e.id'));
  assert.match(select.text, /actor_user_id IS NOT NULL/);
  assert.deepEqual(select.values[0], Object.keys(USAGE_TYPES));
});
