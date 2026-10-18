'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyMediaStore } = require('./academy-media-store');

function fakePool() {
  const rows = new Map();
  const queries = [];
  return {
    rows, queries,
    query: async (sql, params = []) => {
      queries.push(sql);
      if (/^INSERT INTO academy_media/.test(sql)) { rows.set(params[0], { kind: params[1], content_type: params[2], bytes: params[3], meta: JSON.parse(params[4]) }); return { rowCount: 1 }; }
      if (/^SELECT bytes/.test(sql)) { const row = rows.get(params[0]); return { rows: row ? [row] : [] }; }
      if (/GROUP BY kind/.test(sql)) {
        const by = new Map();
        for (const row of rows.values()) { const t = by.get(row.kind) || { kind: row.kind, items: 0, bytes: 0 }; t.items += 1; t.bytes += row.bytes.length; by.set(row.kind, t); }
        return { rows: [...by.values()] };
      }
      throw new Error('unexpected sql ' + sql);
    }
  };
}

test('media store keeps bytes with their kind and meta, reads them back, and reports totals per kind', async () => {
  const pool = fakePool();
  const store = createAcademyMediaStore({ pool });
  assert.equal(store.durable, true);
  assert.equal(await store.get('missing'), null);
  assert.equal(await store.put('v1', Buffer.from('mp3'), { kind: 'voice', contentType: 'audio/mpeg', meta: { chars: 12 } }), true);
  assert.equal(await store.put('d1', Buffer.from('{"slides":[]}'), { kind: 'design', contentType: 'application/json' }), true);
  const hit = await store.get('v1');
  assert.equal(hit.bytes.toString(), 'mp3'); assert.equal(hit.contentType, 'audio/mpeg'); assert.deepEqual(hit.meta, { chars: 12 });
  assert.deepEqual(await store.stats(), { voice: { items: 1, bytes: 3 }, design: { items: 1, bytes: 13 } });
  // a second write of the same key replaces it (an edited recording), never duplicates
  await store.put('v1', Buffer.from('mp3-v2'), { kind: 'voice', contentType: 'audio/mpeg' });
  assert.equal((await store.get('v1')).bytes.toString(), 'mp3-v2');
  assert.ok(pool.queries.every((q) => !/DELETE/.test(q)));
});

test('media store without a pool is a transparent miss, and a failing pool is logged, never thrown', async () => {
  const none = createAcademyMediaStore({});
  assert.equal(none.durable, false);
  assert.equal(await none.get('x'), null);
  assert.equal(await none.put('x', Buffer.alloc(1), { kind: 'voice' }), false);
  assert.deepEqual(await none.stats(), {});
  const logs = [];
  const broken = createAcademyMediaStore({ pool: { query: async () => { throw new Error('db down'); } }, logger: (level, event) => logs.push(level + ':' + event) });
  assert.equal(await broken.get('x'), null);
  assert.equal(await broken.put('x', Buffer.alloc(1), { kind: 'voice' }), false);
  assert.deepEqual(logs, ['warn:academy_media_read_failed', 'warn:academy_media_write_failed']);
});
