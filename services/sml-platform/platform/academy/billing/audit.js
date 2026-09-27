'use strict';

/* =============================================================================
 * MEM Academy billing: append-only, hash-chained audit.
 *
 * Every mutation the engine makes (a binding, an intent, a desired-role change,
 * a Discord write, a comp, a Stripe write, a brake) writes exactly one row.
 *
 *   row_hash = sha256( prev_hash + "\n" + canonical_json(fields) )
 *
 * Rows are chained under pg_advisory_xact_lock(AUDIT_LOCK_KEY) inside the
 * caller's transaction, as the LAST statement before COMMIT, so the chain can
 * never fork and a rolled-back change leaves no audit row. The table itself
 * refuses UPDATE, DELETE and TRUNCATE (migration 028 trigger), and verifyChain
 * detects an edited or removed row.
 *
 * Details carry ids and enums only: keys that look like personal data (email,
 * name, phone, address, amount) or secrets are dropped before hashing.
 * ========================================================================== */

const crypto = require('node:crypto');

const AUDIT_LOCK_KEY = '7028028028';
const OUTCOMES = Object.freeze(['applied', 'dry_run', 'noop', 'suppressed', 'waiting_member', 'failed_permanent', 'failed_retryable']);
const ROLE_KEYS = Object.freeze(['academy', 'mem_lifetime', 'external']);
const ACTOR = /^(webhook|settle|applier|reconciler|due_scan|resync|checkout|portal|boot|cli:[A-Za-z0-9_.@-]{1,64})$/;
const ACTION = /^[a-z][a-z_]{2,63}$/;
const STRIPE_REF = /^(sub|pi|ch|du|cs|in|cus|price|prod|evt|re|py)_[A-Za-z0-9_]{1,200}$/;
const SNOWFLAKE = /^[0-9]{15,24}$/;
const PII_KEY = /(email|name|phone|address|amount|token|secret|password|card|last4)/i;

function canonical(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sanitizeDetails(value, depth = 0) {
  if (value == null || depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeDetails(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (PII_KEY.test(key)) continue;
      out[key] = sanitizeDetails(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.slice(0, 200);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function hashRow(prevHash, fields) {
  return crypto.createHash('sha256').update(`${prevHash || ''}\n${canonical(fields)}`).digest('hex');
}

function normalize(row, at) {
  if (!ACTOR.test(String(row.actor || ''))) throw new TypeError(`audit: invalid actor ${String(row.actor).slice(0, 40)}`);
  if (!ACTION.test(String(row.action || ''))) throw new TypeError('audit: invalid action');
  if (row.outcome != null && !OUTCOMES.includes(row.outcome)) throw new TypeError('audit: invalid outcome');
  if (row.roleKey != null && !ROLE_KEYS.includes(row.roleKey)) throw new TypeError('audit: invalid role key');
  const discordUserId = row.discordUserId == null ? null : String(row.discordUserId);
  if (discordUserId !== null && !SNOWFLAKE.test(discordUserId)) throw new TypeError('audit: invalid discord id');
  const refs = [...new Set((Array.isArray(row.stripeRefs) ? row.stripeRefs : []).map(String).filter((ref) => STRIPE_REF.test(ref)))].slice(0, 50);
  return {
    at: at.toISOString(),
    livemode: row.livemode == null ? null : Boolean(row.livemode),
    run_id: row.runId || null,
    actor: String(row.actor),
    action: String(row.action),
    discord_user_id: discordUserId,
    role_key: row.roleKey || null,
    outcome: row.outcome || null,
    reason: row.reason == null ? null : String(row.reason).slice(0, 200),
    stripe_refs: refs,
    event_id: row.eventId == null ? null : String(row.eventId).slice(0, 100),
    http_status: Number.isInteger(row.httpStatus) ? row.httpStatus : null,
    details: sanitizeDetails(row.details || {}) || {}
  };
}

/**
 * Append one row inside the caller's open transaction. Call it LAST, just
 * before COMMIT: the advisory lock it takes is held until the commit.
 */
async function append(client, row, { now = Date.now } = {}) {
  const fields = normalize(row, new Date(now()));
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [AUDIT_LOCK_KEY]);
  const prev = await client.query('SELECT row_hash FROM academy_billing_audit ORDER BY id DESC LIMIT 1', []);
  const prevHash = prev.rows && prev.rows[0] ? prev.rows[0].row_hash : null;
  const rowHash = hashRow(prevHash, fields);
  await client.query(
    `INSERT INTO academy_billing_audit
       (at, livemode, run_id, actor, action, discord_user_id, role_key, outcome, reason,
        stripe_refs, event_id, http_status, details, prev_hash, row_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13::jsonb, $14, $15)`,
    [fields.at, fields.livemode, fields.run_id, fields.actor, fields.action, fields.discord_user_id,
      fields.role_key, fields.outcome, fields.reason, JSON.stringify(fields.stripe_refs), fields.event_id,
      fields.http_status, JSON.stringify(fields.details), prevHash, rowHash]
  );
  return rowHash;
}

/** Append several rows (in order) in the caller's transaction. */
async function appendAll(client, rows, options) {
  const hashes = [];
  for (const row of rows) hashes.push(await append(client, row, options));
  return hashes;
}

/** Stand-alone append in its own short transaction. */
async function appendStandalone(pool, row, options) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await append(client, row, options);
    await client.query('COMMIT');
    return hash;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection may be gone */ }
    throw error;
  } finally {
    client.release();
  }
}

function fieldsFromDbRow(row) {
  const at = row.at instanceof Date ? row.at : new Date(row.at);
  const parse = (value, fallback) => {
    if (value == null) return fallback;
    if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return fallback; } }
    return value;
  };
  return {
    at: at.toISOString(),
    livemode: row.livemode == null ? null : Boolean(row.livemode),
    run_id: row.run_id || null,
    actor: row.actor,
    action: row.action,
    discord_user_id: row.discord_user_id || null,
    role_key: row.role_key || null,
    outcome: row.outcome || null,
    reason: row.reason == null ? null : row.reason,
    stripe_refs: parse(row.stripe_refs, []),
    event_id: row.event_id || null,
    http_status: row.http_status == null ? null : Number(row.http_status),
    details: parse(row.details, {})
  };
}

/**
 * Walk the chain from the first row. Detects an edited row (hash mismatch),
 * a removed row (prev_hash no longer links) and a fork.
 */
async function verifyChain(queryable, { batch = 1000 } = {}) {
  let lastId = 0;
  let prevHash = null;
  let count = 0;
  for (;;) {
    const result = await queryable.query(
      `SELECT id, at, livemode, run_id, actor, action, discord_user_id, role_key, outcome, reason,
              stripe_refs, event_id, http_status, details, prev_hash, row_hash
         FROM academy_billing_audit WHERE id > $1 ORDER BY id ASC LIMIT $2`,
      [lastId, batch]
    );
    const rows = result.rows || [];
    for (const row of rows) {
      if ((row.prev_hash || null) !== prevHash) {
        return { ok: false, count, brokenAt: Number(row.id), problem: 'chain_link_broken' };
      }
      const expected = hashRow(prevHash, fieldsFromDbRow(row));
      if (expected !== row.row_hash) return { ok: false, count, brokenAt: Number(row.id), problem: 'row_hash_mismatch' };
      prevHash = row.row_hash;
      lastId = Number(row.id);
      count += 1;
    }
    if (rows.length < batch) break;
  }
  return { ok: true, count, brokenAt: null, problem: null, head: prevHash };
}

module.exports = {
  AUDIT_LOCK_KEY,
  OUTCOMES,
  canonical,
  sanitizeDetails,
  hashRow,
  append,
  appendAll,
  appendStandalone,
  verifyChain,
  fieldsFromDbRow
};
