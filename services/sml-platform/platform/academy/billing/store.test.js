'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('./store');
const audit = require('./audit');
const handoff = require('./handoff');
const k = require('./testkit');

function recordingPool(reply = () => ({ rows: [], rowCount: 0 })) {
  const log = [];
  const query = async (sql, params = []) => { log.push({ sql: String(sql), params }); return reply(String(sql), params); };
  return { log, query, connect: async () => ({ query, release() {} }) };
}

const MIGRATION = path.join(__dirname, '../../../group-subs/migrations/028_academy_billing_up.sql');

test('every engine read and write filters on livemode (except the audit and hand-offs)', async () => {
  const pool = recordingPool();
  const store = createStore({ pool, livemode: true, guildId: k.GUILD });
  const q = pool;
  await store.getMember(q, k.USER);
  await store.getMemberByCustomer(q, 'cus_1');
  await store.memberIds(q);
  await store.dueMemberIds(q);
  await store.compsFor(q, k.USER);
  await store.compHolderIds(q);
  await store.lifetimeRows(q, k.USER);
  await store.lifetimeByPaymentIntent(q, 'pi_1');
  await store.lifetimeHolderIds(q);
  await store.getIntentBySession(q, 'cs_test_1');
  await store.markIntentStatus(q, { sessionId: 'cs_test_1', status: 'expired' });
  await store.roleRowsFor(q, k.USER);
  await store.roleStateIds(q);
  await store.kickAwaiting(q, k.USER);
  await store.roleStatusFor(q, k.USER);
  await store.claimRoleRows();
  await store.claimEvents();
  await store.replayDeferred(q);
  await store.previousRun(q);
  await store.externalGrantsFor(q, k.USER);
  await store.getExternalGrant(q, k.USER, k.MONARCH);
  await store.insertExternalGrant(q, { discordId: k.USER, roleId: k.MONARCH, hadRoleBefore: false, state: 'engine_granted' });
  await store.updateExternalGrant(q, { discordId: k.USER, roleId: k.MONARCH, generation: 1, state: 'revoked' });
  await store.externalGrantHolderIds(q);
  await store.externalReviewRows(q);
  await store.trialFor(q, k.USER);
  await store.recordTrial(q, { discordId: k.USER, priceId: 'price_x1', subscriptionId: 'sub_x1', startedAt: k.T0 });
  const engineStatements = pool.log.filter((entry) => /academy_billing_(?!audit|handoffs)/.test(entry.sql) && !/^(BEGIN|COMMIT)$/.test(entry.sql));
  assert.ok(engineStatements.length >= 27);
  for (const entry of engineStatements) {
    assert.match(entry.sql, /livemode/, entry.sql.slice(0, 80));
    assert.ok(entry.params.includes(true), `livemode param missing: ${entry.sql.slice(0, 60)}`);
  }
});

test('the applier finish is a compare-and-set on the claimed generation', async () => {
  const pool = recordingPool(() => ({ rows: [], rowCount: 0 }));
  const store = createStore({ pool, livemode: false, guildId: k.GUILD });
  const n = await store.finishRoleRow(pool, { discordId: k.USER, roleId: k.ACADEMY_ROLE, generation: 7, state: 'synced' });
  assert.equal(n, 0);
  const { sql, params } = pool.log[0];
  assert.match(sql, /WHERE livemode = \$1 AND guild_id = \$2 AND discord_user_id = \$3 AND role_id = \$4 AND generation = \$5/);
  assert.equal(params[4], 7);
});

test('queues are claimed with SKIP LOCKED and a lease; revokes sort first', async () => {
  const pool = recordingPool((sql) => (sql.includes('RETURNING r.*')
    ? { rows: [{ desired: true, updated_at: 1 }, { desired: false, updated_at: 2 }], rowCount: 2 } : { rows: [], rowCount: 0 }));
  const store = createStore({ pool, livemode: false, guildId: k.GUILD });
  const rows = await store.claimRoleRows(5, 120);
  assert.deepEqual(rows.map((r) => r.desired), [false, true]);
  const claim = pool.log.find((e) => e.sql.includes('RETURNING r.*'));
  assert.match(claim.sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(claim.sql, /ORDER BY desired ASC/);
  assert.match(claim.sql, /next_attempt_at = now\(\) \+ make_interval\(secs => \$2\)/);
  assert.deepEqual(pool.log.map((e) => e.sql.trim().split(/\s+/)[0]), ['BEGIN', 'UPDATE', 'COMMIT']);
  await store.claimEvents(3);
  assert.match(pool.log.find((e) => e.sql.includes('RETURNING e.*')).sql, /FOR UPDATE SKIP LOCKED/);
});

test('the per-user lock is a hashed transaction lock released by COMMIT/ROLLBACK', async () => {
  const pool = recordingPool();
  const store = createStore({ pool, livemode: false, guildId: k.GUILD });
  await store.withUserTx(k.USER, async () => 'ok');
  assert.deepEqual(pool.log.map((e) => e.sql.trim().split(/\s+/).slice(0, 2).join(' ')), ['BEGIN', 'SELECT pg_advisory_xact_lock(hashtextextended(\'mem-academy:\'', 'COMMIT']);
  pool.log.length = 0;
  await assert.rejects(() => store.withUserTx(k.USER, async () => { throw new Error('inner'); }), /inner/);
  assert.equal(pool.log[pool.log.length - 1].sql, 'ROLLBACK');
});

test('events die after 20 attempts; purge deletes children before members', async () => {
  const pool = recordingPool((sql) => ({ rows: sql.includes('RETURNING status') ? [{ status: 'dead', attempts: 20 }] : [], rowCount: 1 }));
  const store = createStore({ pool, livemode: true, guildId: k.GUILD });
  await store.retryEvent(pool, { eventId: 'evt_1', error: 'x' });
  assert.equal(pool.log[0].params[2], 20);
  assert.match(pool.log[0].sql, /LEAST\(21600, 30 \* power\(2/);
  pool.log.length = 0;
  await store.purgeTestRows(pool);
  const tables = pool.log.map((e) => /DELETE FROM (\w+)/.exec(e.sql)[1]);
  assert.ok(tables.indexOf('academy_billing_lifetime') < tables.indexOf('academy_billing_members'));
  assert.ok(pool.log.every((e) => /WHERE livemode = false/.test(e.sql)));
  assert.equal(tables.includes('academy_billing_audit'), false);
});

test('schemaPresent is false (not an error) before the ledger exists', async () => {
  const pool = recordingPool(() => { throw Object.assign(new Error('no table'), { code: '42P01' }); });
  assert.equal(await createStore({ pool, livemode: false, guildId: k.GUILD }).schemaPresent(), false);
});

test('migration 028 is additive, carries livemode everywhere and has a matching down', () => {
  const up = fs.readFileSync(MIGRATION, 'utf8').replace(/\r\n/g, '\n');
  const down = fs.readFileSync(MIGRATION.replace('_up.sql', '_down.sql'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(/ALTER TABLE|DROP TABLE|DROP COLUMN/i.test(up), false);
  const tables = [...up.matchAll(/CREATE TABLE (academy_billing_\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, ['academy_billing_members', 'academy_billing_checkout_intents', 'academy_billing_lifetime', 'academy_billing_comps',
    'academy_billing_events', 'academy_billing_role_state', 'academy_billing_audit', 'academy_billing_reconcile_runs', 'academy_billing_handoffs',
    'academy_billing_external_grants', 'academy_billing_trials']);
  /* one free trial per Discord account and livemode; a free-trial consent names its trial */
  assert.match(up, /PRIMARY KEY \(livemode, discord_user_id\),\n  CHECK \(trial_end_at IS NULL OR trial_end_at >= started_at\)/);
  assert.match(up, /consent_kind\s+TEXT\s+NOT NULL CHECK \(consent_kind IN \('auto_renewal','final_sale','free_trial'\)\)/);
  assert.match(up, /CHECK \(consent_kind <> 'free_trial' OR trial_days IS NOT NULL\)/);
  assert.ok(down.indexOf('DROP TABLE IF EXISTS academy_billing_trials;') < down.indexOf('DROP TABLE IF EXISTS academy_billing_members;'));
  assert.match(up, /had_role_before\s+BOOLEAN\s+NOT NULL/);
  assert.match(up, /state\s+TEXT\s+NOT NULL CHECK \(state IN \('held','engine_granted','revoked','kept_external','needs_review','released'\)\)/);
  /* comps: no NULL and no repeated external role id (a CHECK cannot hold a subquery: a helper function) */
  assert.match(up, /CREATE FUNCTION academy_billing_ids_distinct\(ids TEXT\[\]\) RETURNS BOOLEAN\s+LANGUAGE sql IMMUTABLE/);
  assert.match(up, /AND academy_billing_ids_distinct\(external_role_ids\)/);
  assert.ok(down.indexOf('DROP TABLE IF EXISTS academy_billing_comps;') < down.indexOf('DROP FUNCTION IF EXISTS academy_billing_ids_distinct(TEXT[]);'));
  assert.match(up, /role_key\s+TEXT\s+NOT NULL CHECK \(role_key IN \('academy','mem_lifetime','external'\)\)/);
  for (const table of tables) assert.ok(down.includes(`DROP TABLE IF EXISTS ${table};`), table);
  assert.ok(down.indexOf('academy_billing_lifetime;') < down.indexOf('academy_billing_members;'));
  assert.match(up, /discord_user_id ~ '\^\[0-9\]\{15,24\}\$'/);
  assert.match(up, /generation\s+BIGINT\s+NOT NULL DEFAULT 1/);
  assert.equal(/\r/.test(up), false);
});

/* ---------------------------------------------------------------------------
 * Real PostgreSQL, only when DATABASE_URL_TEST points at a disposable DB.
 * Runs 028 in a throw-away schema and exercises the statements end to end.
 * ------------------------------------------------------------------------ */
test('store statements against a real PostgreSQL', { skip: !process.env.DATABASE_URL_TEST }, async () => {
  const { Pool } = require('pg');
  const schema = `abtest_${Date.now()}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL_TEST, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST, max: 3, options: `-c search_path=${schema}` });
  try {
    const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
    await pool.query(sql);
    await pool.query("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY); INSERT INTO schema_migrations VALUES ('028')");
    const store = createStore({ pool, livemode: false, guildId: k.GUILD });
    assert.equal(await store.schemaPresent(), true);
    await store.withUserTx(k.USER, async (client) => {
      await store.ensureMember(client, { discordId: k.USER, boundVia: 'web_oauth' });
      assert.equal(await store.setMemberCustomer(client, { discordId: k.USER, customerId: 'cus_real1', accountId: k.ACCOUNT }), 1);
      await store.insertRoleRow(client, { discordId: k.USER, roleId: k.ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'pending' });
      await audit.append(client, { actor: 'resync', action: 'role_desired_changed', discordUserId: k.USER, roleKey: 'academy', outcome: 'applied' });
    });
    const [claimed] = await store.claimRoleRows(5, 60);
    assert.equal(Number(claimed.generation), 1);
    await store.withUserTx(k.USER, (client) => store.updateRoleRow(client, { discordId: k.USER, roleId: k.ACADEMY_ROLE, desired: false, state: 'pending', bump: true }));
    assert.equal(await store.finishRoleRow(pool, { discordId: k.USER, roleId: k.ACADEMY_ROLE, generation: 1, state: 'synced' }), 0);
    assert.equal(await store.finishRoleRow(pool, { discordId: k.USER, roleId: k.ACADEMY_ROLE, generation: 2, state: 'synced', httpStatus: 204 }), 1);
    assert.equal(await store.insertEvent(pool, { eventId: 'evt_real1', type: 'invoice.paid', livemode: false, created: 1, customerId: 'cus_real1', payloadSha256: 'a'.repeat(64), status: 'pending' }), 'inserted');
    assert.equal(await store.insertEvent(pool, { eventId: 'evt_real1', type: 'invoice.paid', livemode: false, created: 1, payloadSha256: 'a'.repeat(64), status: 'pending' }), 'duplicate');
    const [evt] = await store.claimEvents(5, 60);
    assert.equal(evt.attempts, 1);
    assert.equal((await store.retryEvent(pool, { eventId: 'evt_real1', error: 'x' })).status, 'failed');
    const code = await handoff.issueHandoff(pool, { discordUserId: k.USER, guildId: k.GUILD, source: 'hub', publicUrl: 'https://x.example' });
    assert.equal((await handoff.redeemHandoff(pool, code.code)).userId, k.USER);
    assert.equal(await handoff.redeemHandoff(pool, code.code), null);
    assert.equal((await audit.verifyChain(pool)).ok, true);
    await assert.rejects(() => pool.query('DELETE FROM academy_billing_audit'), /append-only/);
    await assert.rejects(() => pool.query("INSERT INTO academy_billing_members (discord_user_id, livemode, guild_id, bound_via) VALUES ('bob', false, $1, 'hub')", [k.GUILD]));
    assert.ok(await store.startRun({ runId: '00000000-0000-4000-8000-000000000001', mode: 'dry_run', scope: 'known_ids' }));
    assert.equal(await store.startRun({ runId: '00000000-0000-4000-8000-000000000002', mode: 'dry_run', scope: 'known_ids' }), false);
    const counts = await store.statusCounts(pool);
    assert.equal(counts.members[0].n, 1);

    /* External roles: the ledger, its CHECKs and the outbox/audit role key. */
    assert.equal(await store.insertExternalGrant(pool, { discordId: k.USER, roleId: k.MONARCH, hadRoleBefore: false, state: 'engine_granted',
      firstSourceRef: 'pi_real1', reason: 'granted' }), 1);
    assert.equal(await store.insertExternalGrant(pool, { discordId: k.USER, roleId: k.MONARCH, hadRoleBefore: true, state: 'held' }), 0, 'never overwrites the first decision');
    assert.equal(await store.insertExternalGrant(pool, { discordId: k.USER, roleId: k.PREMIUM, hadRoleBefore: true, state: 'held', reason: 'held_before_first_grant' }), 1);
    const [first] = (await store.externalGrantsFor(pool, k.USER)).filter((r) => r.role_id === k.MONARCH);
    assert.deepEqual([first.state, first.had_role_before, Number(first.generation), first.first_source_ref], ['engine_granted', false, 1, 'pi_real1']);
    assert.deepEqual(await store.externalGrantHolderIds(pool), [k.USER]);
    assert.equal(await store.updateExternalGrant(pool, { discordId: k.USER, roleId: k.MONARCH, generation: 5, state: 'revoked' }), null, 'compare-and-set');
    assert.equal(await store.updateExternalGrant(pool, { discordId: k.USER, roleId: k.MONARCH, generation: 1, state: 'needs_review', reason: 'uc_error',
      ucResult: 'inconclusive', ucChecked: true }), 2);
    const review = await store.externalReviewRows(pool);
    assert.deepEqual(review.map((r) => [r.role_id, r.state, r.last_reason, r.uc_result, r.had_role_before]), [[k.MONARCH, 'needs_review', 'uc_error', 'inconclusive', false]]);
    assert.ok(review[0].uc_checked_at instanceof Date);
    assert.equal(await store.updateExternalGrant(pool, { discordId: k.USER, roleId: k.MONARCH, generation: 2, state: 'revoked', reason: 'uc_no_active_membership',
      ucResult: 'none', ucChecked: true }), 3);
    /* a role held before the first grant can never be 'revoked'; 'held' needs had_role_before */
    await assert.rejects(() => store.updateExternalGrant(pool, { discordId: k.USER, roleId: k.PREMIUM, generation: 1, state: 'revoked' }), /check constraint/);
    await assert.rejects(() => store.updateExternalGrant(pool, { discordId: k.USER, roleId: k.MONARCH, generation: 3, state: 'held' }), /check constraint/);
    await assert.rejects(() => store.updateExternalGrant(pool, { discordId: k.USER, roleId: k.MONARCH, generation: 3, state: 'maybe' }), /check constraint/);
    await assert.rejects(() => store.insertExternalGrant(pool, { discordId: k.USER, roleId: 'x', hadRoleBefore: false, state: 'engine_granted' }), /check constraint/);
    /* the outbox and the audit accept the 'external' role key */
    await store.withUserTx(k.USER, async (client) => {
      await store.insertRoleRow(client, { discordId: k.USER, roleId: k.MONARCH, roleKey: 'external', desired: false, state: 'pending' });
      await audit.append(client, { actor: 'resync', action: 'external_grant_state', discordUserId: k.USER, roleKey: 'external', outcome: 'applied',
        reason: 'uc_no_active_membership', details: { roleId: k.MONARCH, from: 'needs_review', to: 'revoked' } });
    });
    await assert.rejects(() => pool.query(`INSERT INTO academy_billing_role_state (livemode, guild_id, discord_user_id, role_id, role_key, desired, state)
      VALUES (false, $1, $2, $3, 'monarch', true, 'pending')`, [k.GUILD, k.USER, k.PREMIUM]), /check constraint/);
    assert.equal((await audit.verifyChain(pool)).ok, true);
    /* comps: the Academy flag and external roles */
    const comp = await store.insertComp(pool, { discordId: k.USER, includeLifetimeRole: false, reason: 'legacy lifetime', grantedBy: 'cli:owner',
      grantsAcademy: false, externalRoleIds: [k.MONARCH] });
    assert.deepEqual([comp.grants_academy, comp.external_role_ids], [false, [k.MONARCH]]);
    const [loaded] = await store.compsFor(pool, k.USER);
    assert.deepEqual(loaded.external_role_ids, [k.MONARCH]);
    await assert.rejects(() => store.insertComp(pool, { discordId: k.USER, includeLifetimeRole: false, reason: 'nothing at all', grantedBy: 'cli:owner',
      grantsAcademy: false, externalRoleIds: [] }), /check constraint/);
    await assert.rejects(() => store.insertComp(pool, { discordId: k.USER, reason: 'bad role', grantedBy: 'cli:owner', externalRoleIds: ['nope'] }), /check constraint/);
    /* comps: no NULL element (grants nothing) and no repeated role id */
    await assert.rejects(() => store.insertComp(pool, { discordId: k.USER, reason: 'null role', grantedBy: 'cli:owner', grantsAcademy: false,
      externalRoleIds: [null] }), /check constraint/);
    await assert.rejects(() => store.insertComp(pool, { discordId: k.USER, reason: 'null role', grantedBy: 'cli:owner', grantsAcademy: true,
      externalRoleIds: [k.MONARCH, null] }), /check constraint/);
    await assert.rejects(() => store.insertComp(pool, { discordId: k.USER, reason: 'twice', grantedBy: 'cli:owner', externalRoleIds: [k.MONARCH, k.MONARCH] }), /check constraint/);
    assert.equal((await store.insertComp(pool, { discordId: k.USER, reason: 'two roles', grantedBy: 'cli:owner', grantsAcademy: false,
      externalRoleIds: [k.MONARCH, k.PREMIUM] })).external_role_ids.length, 2);
    const status = await store.statusCounts(pool);
    assert.deepEqual(status.external.map((r) => [r.role_id, r.state, r.n]).sort(), [[k.MONARCH, 'revoked', 1], [k.PREMIUM, 'held', 1]].sort());
    /* a revoke whose DELETE did not land (failed / held by the kill switch) is re-checked by the reconciler and listed */
    assert.deepEqual(await store.externalGrantHolderIds(pool), [], 'a DELETE still queued is not unfinished');
    assert.equal(await store.finishRoleRow(pool, { discordId: k.USER, roleId: k.MONARCH, generation: 1, state: 'failed', error: 'max_attempts' }), 1);
    assert.deepEqual(await store.externalGrantHolderIds(pool), [k.USER]);
    assert.deepEqual(await store.externalReviewRows(pool), [], 'not a needs_review row');
    const unfinished = await store.externalReviewRows(pool, { states: ['needs_review'], unfinished: true });
    assert.deepEqual(unfinished.map((r) => [r.role_id, r.state, r.outbox_state, r.outbox_desired]), [[k.MONARCH, 'revoked', 'failed', false]]);
    /* a later purchase by a member who holds the role again: had_role_before is recorded again */
    assert.equal(await store.updateExternalGrant(pool, { discordId: k.USER, roleId: k.MONARCH, generation: 3, state: 'held', reason: 'held_at_new_grant',
      hadRoleBefore: true }), 4);
    assert.equal((await store.getExternalGrant(pool, k.USER, k.MONARCH)).had_role_before, true);
    assert.equal(await store.updateExternalGrant(pool, { discordId: k.USER, roleId: k.MONARCH, generation: 4, state: 'released', reason: 'role_absent' }), 5);
    await assert.rejects(() => store.updateExternalGrant(pool, { discordId: k.USER, roleId: k.MONARCH, generation: 5, state: 'held', hadRoleBefore: false }), /check constraint/);
    assert.equal(await store.updateExternalGrant(pool, { discordId: k.USER, roleId: k.MONARCH, generation: 5, state: 'engine_granted', reason: 're_granted',
      hadRoleBefore: false }), 6);
    const regranted = await store.getExternalGrant(pool, k.USER, k.MONARCH);
    assert.deepEqual([regranted.state, regranted.had_role_before], ['engine_granted', false]);
    /* a join revives a grant that gave up while the member was away, nothing else */
    await store.insertRoleRow(pool, { discordId: k.USER2, roleId: k.ACADEMY_ROLE, roleKey: 'academy', desired: true, state: 'pending' });
    assert.equal(await store.finishRoleRow(pool, { discordId: k.USER2, roleId: k.ACADEMY_ROLE, generation: 1, state: 'failed', httpStatus: 404, error: 'member_absent_90d' }), 1);
    assert.equal(await store.kickAwaiting(pool, k.USER2), 1);
    const [revived] = (await store.roleRowsFor(pool, k.USER2));
    assert.deepEqual([revived.state, revived.attempts, revived.awaiting_since], ['pending', 0, null]);
    assert.equal(await store.finishRoleRow(pool, { discordId: k.USER2, roleId: k.ACADEMY_ROLE, generation: 1, state: 'failed', error: 'max_attempts' }), 1);
    assert.equal(await store.kickAwaiting(pool, k.USER2), 0);
    /* one free trial per Discord account: the first one recorded wins, for good */
    assert.equal(await store.trialFor(pool, k.USER), null);
    assert.equal(await store.recordTrial(pool, { discordId: k.USER, priceId: 'price_freetrial', subscriptionId: 'sub_trial1',
      startedAt: k.T0, trialEndAt: k.T0 + 3 * 86400_000 }), 1);
    assert.equal(await store.recordTrial(pool, { discordId: k.USER, priceId: 'price_elitemonth', subscriptionId: 'sub_trial2', startedAt: k.T0 + 1000 }), 0);
    const trial = await store.trialFor(pool, k.USER);
    assert.deepEqual([trial.first_price_id, trial.stripe_subscription_id, trial.started_at.getTime(), trial.trial_end_at.getTime()],
      ['price_freetrial', 'sub_trial1', k.T0, k.T0 + 3 * 86400_000]);
    /* livemode is part of the key: a test-mode trial never uses up the live one */
    const live = createStore({ pool, livemode: true, guildId: k.GUILD });
    assert.equal(await live.trialFor(pool, k.USER), null);
    assert.equal(await live.recordTrial(pool, { discordId: k.USER, subscriptionId: 'sub_live1', startedAt: k.T0 }), 1);
    await assert.rejects(() => store.recordTrial(pool, { discordId: k.USER2, subscriptionId: 'nope', startedAt: k.T0 }), /check constraint/);
    await assert.rejects(() => store.recordTrial(pool, { discordId: k.USER2, subscriptionId: 'sub_t3', startedAt: k.T0, trialEndAt: k.T0 - 1000 }), /check constraint/);
    await assert.rejects(() => store.recordTrial(pool, { discordId: k.USER2, priceId: 'bad', subscriptionId: 'sub_t3', startedAt: k.T0 }), /check constraint/);
    /* the checkout intent keeps the trial it offered; a free-trial consent needs one */
    const intent = (id, extra) => ({ id, discordId: k.USER, package: 'daily', priceId: 'price_freetrial', customerId: 'cus_real1', bindSource: 'web_oauth',
      consentKind: 'free_trial', consentVersion: '2026-10-01', consentSha256: 'b'.repeat(64), consentedAt: k.T0, expiresAt: k.T0 + 60_000, ...extra });
    await store.insertIntent(pool, intent('00000000-0000-4000-8000-0000000000a1', { trialDays: 3 }));
    assert.equal((await store.getIntent(pool, '00000000-0000-4000-8000-0000000000a1')).trial_days, 3);
    await assert.rejects(() => store.insertIntent(pool, intent('00000000-0000-4000-8000-0000000000a2', { trialDays: null })), /check constraint/);
    await assert.rejects(() => store.insertIntent(pool, intent('00000000-0000-4000-8000-0000000000a3', { consentKind: 'auto_renewal', trialDays: 31 })), /check constraint/);
    assert.equal((await store.statusCounts(pool)).trials[0].n, 1);
    const purged = await store.withTx((client) => store.purgeTestRows(client));
    assert.equal(purged.academy_billing_external_grants, 2);
    assert.equal(purged.academy_billing_trials, 1);
    assert.ok(await live.trialFor(pool, k.USER), 'purge-test keeps the live trial ledger');
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

test('migration 028 is discovered after 027 and its outer transaction is stripped by the runner', () => {
  const M = require('../../../db/migrate');
  const found = M.discover();
  const versions = found.map((m) => m.version);
  assert.ok(versions.indexOf('028') > versions.indexOf('027'));
  assert.equal(versions.filter((v) => v === '028').length, 1);
  const mig = found.find((m) => m.version === '028');
  assert.equal(mig.name, '028_academy_billing_up.sql');
  const prepared = M.stripOuterTransaction(mig.sql);
  assert.equal(prepared.stripped, 2);
  assert.match(prepared.sql, /\$BODY\$\nBEGIN\n  RAISE EXCEPTION/);
});

test('a revoke hold claims grants only; the enforce sweep marks non-queued members due', async () => {
  const pool = recordingPool();
  const store = createStore({ pool, livemode: true, guildId: k.GUILD });
  await store.claimRoleRows(5, 120, { grantsOnly: true });
  const claim = pool.log.find((e) => e.sql.includes('RETURNING r.*'));
  assert.match(claim.sql, /AND \(desired = true OR NOT \$5::boolean\)/);
  assert.deepEqual(claim.params, [5, 120, true, k.GUILD, true]);
  pool.log.length = 0;
  await store.claimRoleRows();
  assert.equal(pool.log.find((e) => e.sql.includes('RETURNING r.*')).params[4], false);
  pool.log.length = 0;
  await store.markRoleSyncDue(pool);
  assert.match(pool.log[0].sql, /\(last_access->>'rolesQueued'\) IS DISTINCT FROM 'true'/);
  assert.match(pool.log[0].sql, /WHERE livemode = \$1/);
  assert.deepEqual(pool.log[0].params, [true]);
});
