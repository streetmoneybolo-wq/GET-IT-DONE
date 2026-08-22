/* Migration-runner tests.  Run: node --test  (from this directory)
 *
 * These cover the pure parts — discovery, ordering, and the SQL preparation
 * that makes each migration atomic with its ledger row. No database needed.
 * The against-a-real-Postgres check is `node migrate.js verify`. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const M = require('./migrate.js');

/* ---------- transaction stripping: the correctness-critical part ---------- */

test('outer BEGIN;/COMMIT; are removed so the runner owns the transaction', () => {
  const r = M.stripOuterTransaction('BEGIN;\nCREATE TABLE t (id INT);\nCOMMIT;\n');
  assert.equal(r.stripped, 2);
  assert.doesNotMatch(r.sql, /^\s*BEGIN\s*;/mi);
  assert.doesNotMatch(r.sql, /^\s*COMMIT\s*;/mi);
  assert.match(r.sql, /CREATE TABLE t/);
});

test('START TRANSACTION; is stripped too', () => {
  assert.equal(M.stripOuterTransaction('START TRANSACTION;\nSELECT 1;\nCOMMIT;\n').stripped, 2);
});

/* If this regressed, every plpgsql function in 001 and 003 would be corrupted
   into a syntax error — the single highest-consequence bug in this file. */
test('a plpgsql BEGIN inside a dollar-quoted body is NOT stripped', () => {
  const sql = [
    'BEGIN;',
    'CREATE FUNCTION set_updated_at() RETURNS TRIGGER AS $BODY$',
    'BEGIN',
    '  NEW.updated_at = now();',
    '  RETURN NEW;',
    'END;',
    '$BODY$ LANGUAGE plpgsql;',
    'COMMIT;'
  ].join('\n');
  const r = M.stripOuterTransaction(sql);
  assert.equal(r.stripped, 2, 'only the outer pair should go');
  assert.match(r.sql, /^BEGIN$/m, 'the function body lost its BEGIN');
  assert.match(r.sql, /RETURN NEW;/);
});

test('a literal BEGIN; inside a dollar-quoted body survives', () => {
  const sql = "BEGIN;\nCREATE FUNCTION f() RETURNS void AS $q$\nBEGIN;\n$q$ LANGUAGE sql;\nCOMMIT;";
  const r = M.stripOuterTransaction(sql);
  assert.equal(r.stripped, 2);
  assert.match(r.sql, /\$q\$\nBEGIN;\n\$q\$/, 'the quoted BEGIN; was eaten');
});

test('bare $$ quoting is handled', () => {
  const r = M.stripOuterTransaction('BEGIN;\nDO $$\nBEGIN\n  NULL;\nEND;\n$$;\nCOMMIT;');
  assert.equal(r.stripped, 2);
  assert.match(r.sql, /^BEGIN$/m);
});

test('line numbers are preserved so error positions stay honest', () => {
  const src = 'BEGIN;\nline2;\nline3;\nCOMMIT;';
  const r = M.stripOuterTransaction(src);
  assert.equal(r.sql.split('\n').length, src.split('\n').length);
  assert.equal(r.sql.split('\n')[1], 'line2;');
});

test('an unbalanced dollar-quote is rejected rather than silently mangled', () => {
  assert.throws(() => M.stripOuterTransaction('BEGIN;\nAS $BODY$\nSELECT 1;\n'), /unbalanced/);
});

test('a file with no explicit transaction is left alone', () => {
  const r = M.stripOuterTransaction('CREATE TABLE t (id INT);\n');
  assert.equal(r.stripped, 0);
  assert.equal(r.sql.trim(), 'CREATE TABLE t (id INT);');
});

test('BEGIN without a semicolon is not treated as a transaction', () => {
  assert.equal(M.stripOuterTransaction('BEGIN\nSELECT 1;').stripped, 0);
});

/* ---------- error location ---------- */

test('a byte offset resolves to the right line and text', () => {
  const sql = 'CREATE TABLE a (id INT);\nCREATE TABEL b (id INT);\n';
  const at = M.locate(sql, sql.indexOf('TABEL') + 1);
  assert.equal(at.line, 2);
  assert.match(at.text, /TABEL/);
});

test('a missing position yields no location rather than a crash', () => {
  assert.equal(M.locate('SELECT 1', undefined), null);
});

test('a read-only migration inspection does not create a ledger on a new database', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      const error = new Error('relation "schema_migrations" does not exist');
      error.code = '42P01';
      throw error;
    }
  };
  const done = await M.applied(client, { ensureLedger: false });
  assert.equal(done.size, 0);
  assert.equal(queries.some((sql) => /CREATE TABLE/i.test(sql)), false);
});

/* ---------- discovery ---------- */

test('the real migrations are discovered and ordered across both projects', () => {
  const found = M.discover();
  assert.ok(found.length >= 3, `expected at least 3 migrations, found ${found.length}`);

  const versions = found.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort(), 'migrations are out of order');

  /* 000/001/002 live in news-engine, 003 in group-subs — ordering must be
     by version across directories, not by directory.  The ticker registry
     must come first because article_tickers has a real foreign key to it. */
  assert.equal(found[0].version, '000');
  assert.match(found[0].name, /ticker_registry/);
  const v1 = found.find((m) => m.version === '001');
  assert.ok(v1, 'news-engine migration missing');
  assert.match(v1.name, /news_engine/);
  const v3 = found.find((m) => m.version === '003');
  assert.ok(v3, 'group-subs migration missing');
  assert.match(path.basename(v3.dir), /migrations/);
  assert.match(v3.path, /group-subs/);
});

test('only *_up.sql files are collected — rollbacks are never applied forward', () => {
  assert.equal(M.discover().filter((m) => /_down\.sql$/.test(m.name)).length, 0);
});

test('every discovered migration has a stable checksum', () => {
  const a = M.discover(), b = M.discover();
  assert.deepEqual(a.map((m) => m.checksum), b.map((m) => m.checksum));
  for (const m of a) assert.match(m.checksum, /^[0-9a-f]{64}$/);
});

test('every real migration survives preparation with its transaction stripped', () => {
  for (const m of M.discover()) {
    const r = M.stripOuterTransaction(m.sql);
    assert.ok(r.stripped >= 2, `${m.name}: expected an outer BEGIN/COMMIT pair, stripped ${r.stripped}`);
    assert.doesNotMatch(r.sql, /^\s*COMMIT\s*;\s*$/m, `${m.name}: a COMMIT survived`);
  }
});

test('every forward migration now has a rollback', () => {
  const fs = require('fs');
  const missing = M.discover()
    .filter((m) => !fs.existsSync(m.path.replace(/_up\.sql$/, '_down.sql')))
    .map((m) => m.name);
  assert.deepEqual(missing, [], `no rollback for: ${missing.join(', ')}`);
});
