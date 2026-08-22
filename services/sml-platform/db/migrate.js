#!/usr/bin/env node
/* =============================================================================
 * StockMarketLoop — database migration runner
 *
 *   node migrate.js status              what is applied, what is pending
 *   node migrate.js up                  apply every pending migration
 *   node migrate.js up --dry-run        show what would run, touch nothing
 *   node migrate.js verify              count objects and report the schema
 *   node migrate.js down <version> --yes  roll ONE migration back (destructive)
 *
 * Requires DATABASE_URL. Its value is never logged — only host and database
 * name are echoed, so a pasted log cannot leak a password.
 *
 * Three properties this runner is built to guarantee:
 *
 *   ATOMIC       each migration and its ledger row commit together, in one
 *                transaction. Postgres DDL is transactional, so a migration can
 *                never be half-applied or applied-but-unrecorded.
 *
 *   SINGLE-WRITER  a session advisory lock means two deploys racing (Render
 *                does overlap them) cannot apply the same migration twice.
 *
 *   IMMUTABLE    every applied file's sha256 is stored. Editing a migration
 *                that has already run is refused, loudly — that is how two
 *                environments silently drift apart.
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

/* Both projects share one database. Order is by numeric prefix ACROSS dirs, so
   001/002 (news-engine) run before 003 (group-subs). */
const DEFAULT_DIRS = [
  path.join(__dirname, '..', 'news-engine', 'migrations'),
  path.join(__dirname, '..', 'group-subs', 'migrations')
];

/* Any 64-bit constant; it only has to be the same in every deploy. */
const LOCK_KEY = 8072026;

const LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    name        TEXT        NOT NULL,
    checksum    TEXT        NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms INTEGER     NOT NULL
  )`;

/* -------------------------------------------------------------------------- */
/* Discovery                                                                   */
/* -------------------------------------------------------------------------- */

function dirs() {
  if (!process.env.MIGRATIONS_DIRS) return DEFAULT_DIRS;
  return process.env.MIGRATIONS_DIRS.split(',').map((d) => path.resolve(d.trim()));
}

function discover() {
  const found = [];
  for (const dir of dirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!/_up\.sql$/i.test(file)) continue;
      const m = file.match(/^(\d+)/);
      if (!m) throw new Error(`migration filename must start with a number: ${file}`);
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      found.push({
        version: m[1],
        name: file,
        dir,
        path: path.join(dir, file),
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex')
      });
    }
  }

  /* Two migrations sharing a version would apply in an order that depends on
     directory listing order. That is a coin flip across machines — refuse. */
  const seen = new Map();
  for (const mig of found) {
    if (seen.has(mig.version)) {
      throw new Error(
        `duplicate migration version ${mig.version}:\n  ${seen.get(mig.version).path}\n  ${mig.path}`
      );
    }
    seen.set(mig.version, mig);
  }

  return found.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
}

/* -------------------------------------------------------------------------- */
/* SQL preparation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Remove the file's own outermost BEGIN;/COMMIT; so the runner can wrap the
 * migration and its ledger row in ONE transaction. Without this the file's own
 * COMMIT would close the runner's transaction early and the ledger insert would
 * land outside it — the exact failure that leaves a migration applied but not
 * recorded.
 *
 * Dollar-quote aware: a plpgsql body contains a bare `BEGIN`, and `$BODY$` can
 * legally contain anything at all. Only statement-level BEGIN;/COMMIT; found
 * OUTSIDE a dollar-quoted string are stripped.
 */
function stripOuterTransaction(sql) {
  const lines = sql.split(/\r?\n/);
  const out = [];
  let tag = null;              /* current open dollar-quote tag, or null */
  let stripped = 0;

  for (const line of lines) {
    if (tag === null) {
      const bare = line.trim();
      /* `BEGIN;` and `COMMIT;` — with a semicolon, so plpgsql's bare BEGIN and
         END; are never touched. */
      if (/^(BEGIN|START\s+TRANSACTION)\s*;$/i.test(bare) || /^COMMIT\s*;$/i.test(bare)) {
        stripped++;
        out.push('');          /* keep the line count so error positions stay honest */
        continue;
      }
    }
    /* Toggle dollar-quote state for every $tag$ on the line. */
    const tags = line.match(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g) || [];
    for (const t of tags) {
      if (tag === null) tag = t;
      else if (tag === t) tag = null;
    }
    out.push(line);
  }

  if (tag !== null) throw new Error('unbalanced dollar-quote in migration');
  return { sql: out.join('\n'), stripped };
}

/** Turn a pg error's byte offset into a line/column and the offending line. */
function locate(sql, position) {
  if (!position) return null;
  const upto = sql.slice(0, Number(position) - 1);
  const line = upto.split('\n').length;
  const col = position - upto.lastIndexOf('\n') - 1;
  return { line, col, text: (sql.split('\n')[line - 1] || '').trim() };
}

/* -------------------------------------------------------------------------- */
/* Connection                                                                  */
/* -------------------------------------------------------------------------- */

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.\n' +
      '  local:  postgres://postgres:PASSWORD@localhost:5433/sml\n' +
      '  Render: copy the Internal Database URL from the dashboard');
    process.exit(2);
  }

  let host = 'unknown', db = 'unknown';
  try { const u = new URL(url); host = u.hostname; db = u.pathname.replace(/^\//, ''); } catch (e) { /* opaque URL */ }

  /* Render's managed Postgres terminates TLS with its own CA. Verification is
     off for remote hosts by default; set DATABASE_SSL=verify once a CA bundle
     is configured, or =off for a local container. */
  const mode = process.env.DATABASE_SSL || (host === 'localhost' || host === '127.0.0.1' ? 'off' : 'no-verify');
  const ssl = mode === 'off' ? false : { rejectUnauthorized: mode === 'verify' };

  return { client: new Client({ connectionString: url, ssl }), host, db, mode };
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

async function applied(client, { ensureLedger = true } = {}) {
  /* `up --dry-run` and `status` are inspection commands.  They must not
     create the ledger as a side effect merely to discover that the database
     is brand new. */
  if (ensureLedger) await client.query(LEDGER);
  try {
    const { rows } = await client.query('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version');
    return new Map(rows.map((r) => [r.version, r]));
  } catch (err) {
    /* PostgreSQL's undefined_table code.  With no ledger yet, a read-only
       inspection correctly means “no migrations have been applied.” */
    if (!ensureLedger && err && err.code === '42P01') return new Map();
    throw err;
  }
}

/** Refuse to run if a file that already ran has since been edited. */
function assertUnchanged(migrations, done) {
  const drifted = migrations
    .filter((m) => done.has(m.version) && done.get(m.version).checksum !== m.checksum)
    .map((m) => `  ${m.name}  (applied ${done.get(m.version).applied_at.toISOString()})`);

  if (drifted.length) {
    throw new Error(
      'these migrations were edited after being applied:\n' + drifted.join('\n') +
      '\n\nThis database no longer matches the files. Do NOT "fix" it by editing the\n' +
      'checksum. Write a NEW migration that makes the change forward.'
    );
  }
}

async function cmdStatus(client, migrations) {
  const done = await applied(client, { ensureLedger: false });
  console.log('  version  status   migration');
  console.log('  -------  -------  ---------------------------------------------');
  for (const m of migrations) {
    const row = done.get(m.version);
    const drift = row && row.checksum !== m.checksum ? '  ** EDITED SINCE APPLIED **' : '';
    console.log(`  ${m.version.padEnd(7)}  ${(row ? 'applied' : 'pending').padEnd(7)}  ${m.name}${drift}`);
  }
  const pending = migrations.filter((m) => !done.has(m.version));
  console.log(`\n  ${done.size} applied, ${pending.length} pending`);
  return pending.length;
}

async function cmdUp(client, migrations, dryRun) {
  const done = await applied(client, { ensureLedger: !dryRun });
  assertUnchanged(migrations, done);

  const pending = migrations.filter((m) => !done.has(m.version));
  if (!pending.length) { console.log('  nothing to do — schema is up to date'); return; }

  if (dryRun) {
    console.log('  DRY RUN — nothing will be applied\n');
    for (const m of pending) console.log(`  would apply  ${m.version}  ${m.name}`);
    return;
  }

  for (const m of pending) {
    const prepared = stripOuterTransaction(m.sql);
    const started = Date.now();
    process.stdout.write(`  applying ${m.version}  ${m.name} ... `);

    await client.query('BEGIN');
    try {
      await client.query(prepared.sql);
      const ms = Date.now() - started;
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum, duration_ms) VALUES ($1,$2,$3,$4)',
        [m.version, m.name, m.checksum, ms]
      );
      await client.query('COMMIT');
      console.log(`ok (${ms}ms)`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      const at = locate(prepared.sql, err.position);
      console.error(`\n  ${m.path}`);
      if (at) console.error(`  line ${at.line}, col ${at.col}:  ${at.text}`);
      console.error(`  ${err.message}`);
      if (err.detail) console.error(`  detail: ${err.detail}`);
      if (err.hint) console.error(`  hint: ${err.hint}`);
      console.error('\n  Rolled back. Nothing from this migration was applied.');
      throw err;
    }
  }
}

async function cmdDown(client, migrations, version, confirmed) {
  const done = await applied(client);
  if (!done.has(version)) throw new Error(`migration ${version} is not applied`);

  const mig = migrations.find((m) => m.version === version);
  if (!mig) throw new Error(`no migration file for version ${version}`);

  const downPath = mig.path.replace(/_up\.sql$/i, '_down.sql');
  if (!fs.existsSync(downPath)) throw new Error(`no rollback file: ${path.basename(downPath)}`);

  const newer = [...done.keys()].filter((v) => v > version);
  if (newer.length) {
    throw new Error(
      `${newer.join(', ')} were applied after ${version} and would break.\n` +
      '  Roll those back first, newest to oldest.'
    );
  }

  if (!confirmed) {
    console.error(`Rolling back ${mig.name} DESTROYS the data in its tables.\n  Re-run with --yes to confirm.`);
    process.exit(3);
  }

  const prepared = stripOuterTransaction(fs.readFileSync(downPath, 'utf8'));
  process.stdout.write(`  rolling back ${version} ... `);
  await client.query('BEGIN');
  try {
    await client.query(prepared.sql);
    await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
    await client.query('COMMIT');
    console.log('ok');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log('FAILED');
    throw err;
  }
}

async function cmdVerify(client) {
  const q = async (sql) => Number((await client.query(sql)).rows[0].n);

  const tables = await q(`SELECT count(*) n FROM information_schema.tables
                           WHERE table_schema='public' AND table_type='BASE TABLE'
                             AND table_name <> 'schema_migrations'`);
  const indexes = await q("SELECT count(*) n FROM pg_indexes WHERE schemaname='public' AND tablename <> 'schema_migrations'");
  const types = await q(`SELECT count(*) n FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace
                          WHERE ns.nspname='public' AND t.typtype='e'`);
  const checks = await q(`SELECT count(*) n FROM pg_constraint c JOIN pg_namespace ns ON ns.oid=c.connamespace
                           WHERE ns.nspname='public' AND c.contype='c'`);
  const fks = await q(`SELECT count(*) n FROM pg_constraint c JOIN pg_namespace ns ON ns.oid=c.connamespace
                        WHERE ns.nspname='public' AND c.contype='f'`);
  const funcs = await q(`SELECT count(*) n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                          WHERE ns.nspname='public'`);
  const trigs = await q('SELECT count(*) n FROM pg_trigger WHERE NOT tgisinternal');

  console.log(`  tables        ${tables}`);
  console.log(`  indexes       ${indexes}`);
  console.log(`  enum types    ${types}`);
  console.log(`  CHECKs        ${checks}`);
  console.log(`  foreign keys  ${fks}`);
  console.log(`  functions     ${funcs}`);
  console.log(`  triggers      ${trigs}`);

  const { rows } = await client.query(`SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
  console.log('\n  ' + rows.map((r) => r.table_name).join('\n  '));
  return { tables, indexes, types, checks };
}

/* -------------------------------------------------------------------------- */

async function main() {
  const [, , cmd = 'status', ...rest] = process.argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const args = rest.filter((a) => !a.startsWith('--'));

  const migrations = discover();
  if (!migrations.length) { console.error('no *_up.sql files found in: ' + dirs().join(', ')); process.exit(2); }

  const { client, host, db, mode } = connect();
  await client.connect();
  console.log(`  ${db} @ ${host}  (ssl: ${mode})\n`);

  let locked = false;
  try {
    /* Serialise concurrent deploys. Everything below is single-writer. */
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    locked = true;

    switch (cmd) {
      case 'status':  await cmdStatus(client, migrations); break;
      case 'up':      await cmdUp(client, migrations, flags.has('--dry-run')); break;
      case 'down':
        if (!args[0]) throw new Error('usage: migrate.js down <version> --yes');
        await cmdDown(client, migrations, args[0], flags.has('--yes'));
        break;
      case 'verify':  await cmdVerify(client); break;
      default:
        console.error(`unknown command: ${cmd}\n  use: status | up | down <version> --yes | verify`);
        process.exit(2);
    }
  } finally {
    if (locked) { try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch (e) { /* closing anyway */ } }
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('\n  ' + err.message); process.exit(1); });
}

module.exports = { discover, stripOuterTransaction, locate, applied };
