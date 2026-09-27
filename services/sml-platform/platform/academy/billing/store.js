'use strict';

/* =============================================================================
 * MEM Academy billing: every SQL statement for the migration-028 tables.
 *
 * Rules this file follows:
 *   - no DB client or lock is ever held across a network call; callers do the
 *     Stripe/Discord I/O first, then open a SHORT transaction here;
 *   - the per-user lock is pg_advisory_xact_lock(hashtextextended(
 *     'mem-academy:'||id, 0)) (the advisory functions take bigint, so the key
 *     is hashed), released automatically at COMMIT/ROLLBACK;
 *   - every row carries livemode and every read filters on the engine's
 *     livemode, so a test-mode rehearsal can never feed live access;
 *   - queues are claimed with FOR UPDATE SKIP LOCKED plus a short lease, and
 *     the lock is released before any network call.
 * ========================================================================== */

const RECONCILE_LOCK_KEY = '7028028029';
const EVENT_MAX_ATTEMPTS = 20;
const ROLE_MAX_ATTEMPTS = 20;

function createStore({ pool, livemode, guildId }) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('createStore: pool required');
  const lm = Boolean(livemode);

  async function withTx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection may be gone */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async function lockUser(client, discordId) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mem-academy:' || $1::text, 0))", [String(discordId)]);
  }

  /** Short transaction serialized per Discord user. */
  async function withUserTx(discordId, fn) {
    return withTx(async (client) => {
      await lockUser(client, discordId);
      return fn(client);
    });
  }

  async function schemaPresent() {
    try {
      const result = await pool.query("SELECT 1 AS ok FROM schema_migrations WHERE version = '028'", []);
      return Boolean(result.rows && result.rows.length);
    } catch (error) {
      if (error && error.code === '42P01') return false;
      throw error;
    }
  }

  /* ------------------------------ members ------------------------------ */

  async function getMember(q, discordId, { forUpdate = false } = {}) {
    const result = await q.query(
      `SELECT * FROM academy_billing_members WHERE discord_user_id = $1 AND livemode = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [String(discordId), lm]
    );
    return result.rows[0] || null;
  }

  async function getMemberByCustomer(q, customerId) {
    if (!customerId) return null;
    const result = await q.query(
      'SELECT * FROM academy_billing_members WHERE stripe_customer_id = $1 AND livemode = $2',
      [String(customerId), lm]
    );
    return result.rows[0] || null;
  }

  async function memberIds(q, limit = 5000) {
    const result = await q.query(
      `SELECT discord_user_id FROM academy_billing_members
        WHERE livemode = $1 AND stripe_customer_id IS NOT NULL ORDER BY created_at LIMIT $2`,
      [lm, limit]
    );
    return result.rows.map((row) => String(row.discord_user_id));
  }

  async function dueMemberIds(q, limit = 25) {
    const result = await q.query(
      `SELECT discord_user_id FROM academy_billing_members
        WHERE livemode = $1 AND next_check_at IS NOT NULL AND next_check_at <= now()
        ORDER BY next_check_at LIMIT $2`,
      [lm, limit]
    );
    return result.rows.map((row) => String(row.discord_user_id));
  }

  /** Row before the Customer exists ("pending customer"), idempotent. */
  async function ensureMember(q, { discordId, boundVia }) {
    await q.query(
      `INSERT INTO academy_billing_members (discord_user_id, livemode, guild_id, bound_via)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (discord_user_id, livemode) DO NOTHING`,
      [String(discordId), lm, guildId, boundVia]
    );
    return getMember(q, discordId, { forUpdate: true });
  }

  /** Attach a Customer to a row that has none. Returns the row count (0 = someone else won). */
  async function setMemberCustomer(q, { discordId, customerId, accountId }) {
    const result = await q.query(
      `UPDATE academy_billing_members
          SET stripe_customer_id = $3, stripe_account_id = $4, rebound_to = NULL, updated_at = now()
        WHERE discord_user_id = $1 AND livemode = $2 AND stripe_customer_id IS NULL`,
      [String(discordId), lm, customerId, accountId || null]
    );
    return result.rowCount;
  }

  /** Recreate a binding from Stripe metadata (never over a tombstone or another customer). */
  async function upsertRebuiltMember(q, { discordId, customerId, accountId }) {
    const result = await q.query(
      `INSERT INTO academy_billing_members (discord_user_id, livemode, guild_id, stripe_customer_id, stripe_account_id, bound_via)
       VALUES ($1, $2, $3, $4, $5, 'stripe_rebuild')
       ON CONFLICT (discord_user_id, livemode) DO UPDATE
          SET stripe_customer_id = EXCLUDED.stripe_customer_id,
              stripe_account_id = EXCLUDED.stripe_account_id,
              updated_at = now()
        WHERE academy_billing_members.stripe_customer_id IS NULL
          AND academy_billing_members.rebound_to IS NULL
       RETURNING discord_user_id`,
      [String(discordId), lm, guildId, customerId, accountId || null]
    );
    return result.rowCount;
  }

  async function updateMemberAccess(q, { discordId, lastAccess, nextCheckAt, snapshotAt }) {
    const result = await q.query(
      `UPDATE academy_billing_members
          SET last_access = $3::jsonb, next_check_at = $4, last_synced_at = $5, updated_at = now()
        WHERE discord_user_id = $1 AND livemode = $2`,
      [String(discordId), lm, JSON.stringify(lastAccess || {}), nextCheckAt ? new Date(nextCheckAt) : null,
        snapshotAt ? new Date(snapshotAt) : new Date()]
    );
    return result.rowCount;
  }

  async function setNextCheck(q, discordId, at) {
    await q.query(
      'UPDATE academy_billing_members SET next_check_at = $3, updated_at = now() WHERE discord_user_id = $1 AND livemode = $2',
      [String(discordId), lm, at ? new Date(at) : null]
    );
  }

  /** Rebind: the old id keeps a tombstone so a rebuild never restores it. */
  async function moveBinding(q, { fromId, toId, customerId, accountId }) {
    const cleared = await q.query(
      `UPDATE academy_billing_members SET stripe_customer_id = NULL, rebound_to = $3, next_check_at = now(), updated_at = now()
        WHERE discord_user_id = $1 AND livemode = $2 AND stripe_customer_id = $4`,
      [String(fromId), lm, String(toId), customerId]
    );
    if (!cleared.rowCount) throw new Error('rebind_source_not_bound_to_customer');
    const moved = await q.query(
      `INSERT INTO academy_billing_members (discord_user_id, livemode, guild_id, stripe_customer_id, stripe_account_id, bound_via)
       VALUES ($1, $2, $3, $4, $5, 'admin')
       ON CONFLICT (discord_user_id, livemode) DO UPDATE
          SET stripe_customer_id = EXCLUDED.stripe_customer_id, stripe_account_id = EXCLUDED.stripe_account_id,
              rebound_to = NULL, bound_via = 'admin', updated_at = now()
        WHERE academy_billing_members.stripe_customer_id IS NULL
       RETURNING discord_user_id`,
      [String(toId), lm, guildId, customerId, accountId || null]
    );
    /* The target already has another Customer: roll the whole move back. */
    if (!moved.rowCount) throw new Error('rebind_target_already_bound');
    await q.query(
      'UPDATE academy_billing_lifetime SET discord_user_id = $3, updated_at = now() WHERE discord_user_id = $1 AND livemode = $2 AND stripe_customer_id = $4',
      [String(fromId), lm, String(toId), customerId]
    );
  }

  /* ------------------------------ comps ------------------------------ */

  async function compsFor(q, discordId) {
    const result = await q.query(
      `SELECT id, include_lifetime_role, grants_academy, external_role_ids, expires_at, revoked_at, livemode FROM academy_billing_comps
        WHERE discord_user_id = $1 AND livemode = $2 AND revoked_at IS NULL`,
      [String(discordId), lm]
    );
    return result.rows;
  }

  async function compHolderIds(q) {
    const result = await q.query(
      `SELECT DISTINCT discord_user_id FROM academy_billing_comps
        WHERE livemode = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      [lm]
    );
    return result.rows.map((row) => String(row.discord_user_id));
  }

  async function insertComp(q, { discordId, includeLifetimeRole, reason, grantedBy, expiresAt, grantsAcademy = true, externalRoleIds = [] }) {
    const result = await q.query(
      `INSERT INTO academy_billing_comps (discord_user_id, livemode, include_lifetime_role, reason, granted_by, expires_at,
                                         grants_academy, external_role_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[])
       RETURNING id, discord_user_id, include_lifetime_role, grants_academy, external_role_ids, expires_at`,
      [String(discordId), lm, Boolean(includeLifetimeRole), reason, grantedBy, expiresAt ? new Date(expiresAt) : null,
        Boolean(grantsAcademy), (externalRoleIds || []).map(String)]
    );
    return result.rows[0];
  }

  async function revokeComp(q, { id, revokedBy, reason }) {
    const result = await q.query(
      `UPDATE academy_billing_comps SET revoked_at = now(), revoked_by = $3, revoke_reason = $4
        WHERE id = $1 AND livemode = $2 AND revoked_at IS NULL RETURNING id, discord_user_id`,
      [Number(id), lm, revokedBy, reason]
    );
    return result.rows[0] || null;
  }

  /* ------------------------------ lifetime cache ------------------------------ */

  async function lifetimeRows(q, discordId) {
    const result = await q.query(
      'SELECT * FROM academy_billing_lifetime WHERE discord_user_id = $1 AND livemode = $2',
      [String(discordId), lm]
    );
    return result.rows;
  }

  async function lifetimeByPaymentIntent(q, paymentIntentId) {
    if (!paymentIntentId) return null;
    const result = await q.query(
      'SELECT * FROM academy_billing_lifetime WHERE payment_intent_id = $1 AND livemode = $2',
      [String(paymentIntentId), lm]
    );
    return result.rows[0] || null;
  }

  async function lifetimeHolderIds(q) {
    const result = await q.query(
      "SELECT DISTINCT discord_user_id FROM academy_billing_lifetime WHERE livemode = $1 AND stripe_state IN ('paid','partially_refunded','disputed','dispute_won')",
      [lm]
    );
    return result.rows.map((row) => String(row.discord_user_id));
  }

  async function upsertLifetime(q, row) {
    await q.query(
      `INSERT INTO academy_billing_lifetime
         (payment_intent_id, livemode, checkout_session_id, discord_user_id, stripe_customer_id, stripe_price_id,
          amount_cents, currency, paid_at, latest_charge_id, stripe_state, state_checked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (payment_intent_id) DO UPDATE
          SET latest_charge_id = COALESCE(EXCLUDED.latest_charge_id, academy_billing_lifetime.latest_charge_id),
              checkout_session_id = COALESCE(academy_billing_lifetime.checkout_session_id, EXCLUDED.checkout_session_id),
              stripe_price_id = COALESCE(academy_billing_lifetime.stripe_price_id, EXCLUDED.stripe_price_id),
              stripe_state = EXCLUDED.stripe_state,
              state_checked_at = now(),
              updated_at = now()`,
      [row.paymentIntentId, lm, row.checkoutSessionId || null, String(row.discordId), row.customerId,
        row.priceId || null, Number(row.amountCents || 0), String(row.currency || 'usd'), new Date(row.paidAt),
        row.chargeId || null, row.state]
    );
  }

  /* ------------------------------ checkout intents ------------------------------ */

  async function insertIntent(q, intent) {
    await q.query(
      `INSERT INTO academy_billing_checkout_intents
         (id, discord_user_id, guild_id, livemode, package, stripe_price_id, stripe_customer_id, bind_source,
          consent_kind, consent_version, consent_sha256, consented_at, status, expires_at, trial_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'created', $13, $14)`,
      [intent.id, String(intent.discordId), guildId, lm, intent.package, intent.priceId, intent.customerId || null,
        intent.bindSource, intent.consentKind, intent.consentVersion, intent.consentSha256, new Date(intent.consentedAt),
        new Date(intent.expiresAt), Number.isInteger(intent.trialDays) ? intent.trialDays : null]
    );
  }

  /* ------------------------------ free trials ------------------------------ */

  /** The member's free-trial ledger row (one per Discord account), or null. */
  async function trialFor(q, discordId) {
    const result = await q.query(
      `SELECT discord_user_id, first_price_id, stripe_subscription_id, started_at, trial_end_at, recorded_at
         FROM academy_billing_trials WHERE livemode = $1 AND discord_user_id = $2`,
      [lm, String(discordId)]
    );
    return result.rows[0] || null;
  }

  /** Record the member's first trial; 1 when recorded, 0 when one already was. */
  async function recordTrial(q, { discordId, priceId = null, subscriptionId, startedAt, trialEndAt = null }) {
    const result = await q.query(
      `INSERT INTO academy_billing_trials (livemode, discord_user_id, first_price_id, stripe_subscription_id, started_at, trial_end_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (livemode, discord_user_id) DO NOTHING`,
      [lm, String(discordId), priceId || null, String(subscriptionId), new Date(startedAt), trialEndAt == null ? null : new Date(trialEndAt)]
    );
    return result.rowCount || 0;
  }

  async function recentCreatedIntent(q, discordId, seconds = 20) {
    const result = await q.query(
      `SELECT id FROM academy_billing_checkout_intents
        WHERE discord_user_id = $1 AND livemode = $2 AND status = 'created'
          AND created_at > now() - make_interval(secs => $3) LIMIT 1`,
      [String(discordId), lm, Number(seconds)]
    );
    return result.rows[0] || null;
  }

  async function markIntentOpen(q, { id, sessionId }) {
    await q.query(
      `UPDATE academy_billing_checkout_intents SET status = 'open', stripe_checkout_session_id = $2, updated_at = now()
        WHERE id = $1 AND status IN ('created','open')`,
      [id, sessionId]
    );
  }

  /** created/open -> completed|expired|failed; completed is terminal. */
  async function markIntentStatus(q, { id = null, sessionId = null, status }) {
    if (!id && !sessionId) return [];
    const result = await q.query(
      `UPDATE academy_billing_checkout_intents SET status = $3, updated_at = now()
        WHERE (($1::uuid IS NOT NULL AND id = $1::uuid) OR ($2::text IS NOT NULL AND stripe_checkout_session_id = $2::text))
          AND livemode = $4 AND status IN ('created','open')
        RETURNING id, discord_user_id, stripe_checkout_session_id`,
      [id, sessionId, status, lm]
    );
    return result.rows;
  }

  async function getIntentBySession(q, sessionId) {
    const result = await q.query(
      'SELECT * FROM academy_billing_checkout_intents WHERE stripe_checkout_session_id = $1 AND livemode = $2',
      [String(sessionId), lm]
    );
    return result.rows[0] || null;
  }

  async function getIntent(q, id) {
    const result = await q.query('SELECT * FROM academy_billing_checkout_intents WHERE id = $1::uuid', [id]);
    return result.rows[0] || null;
  }

  /* ------------------------------ role outbox ------------------------------ */

  async function roleRowsFor(q, discordId, { forUpdate = false } = {}) {
    const result = await q.query(
      `SELECT * FROM academy_billing_role_state
        WHERE livemode = $1 AND guild_id = $2 AND discord_user_id = $3${forUpdate ? ' FOR UPDATE' : ''}`,
      [lm, guildId, String(discordId)]
    );
    return result.rows;
  }

  async function insertRoleRow(q, { discordId, roleId, roleKey, desired, state, nextAttemptAt = null }) {
    await q.query(
      `INSERT INTO academy_billing_role_state
         (livemode, guild_id, discord_user_id, role_id, role_key, desired, generation, state, attempts,
          next_attempt_at, awaiting_since, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 0, $8, CASE WHEN $7 = 'awaiting_member' THEN now() ELSE NULL END, now())`,
      [lm, guildId, String(discordId), String(roleId), roleKey, Boolean(desired), state, nextAttemptAt ? new Date(nextAttemptAt) : null]
    );
  }

  /** Set a new desired value / state. bump=true increments the generation, so
   *  an applier still working on the previous generation cannot overwrite it. */
  async function updateRoleRow(q, { discordId, roleId, desired, state, bump, nextAttemptAt = null, resetAttempts = true }) {
    const result = await q.query(
      `UPDATE academy_billing_role_state
          SET desired = $5,
              state = $6,
              generation = generation + CASE WHEN $7 THEN 1 ELSE 0 END,
              attempts = CASE WHEN $8 THEN 0 ELSE attempts END,
              next_attempt_at = $9,
              awaiting_since = CASE WHEN $6 = 'awaiting_member' THEN COALESCE(awaiting_since, now()) ELSE NULL END,
              last_applied_at = CASE WHEN $6 = 'synced' THEN COALESCE(last_applied_at, now()) ELSE last_applied_at END,
              updated_at = now()
        WHERE livemode = $1 AND guild_id = $2 AND discord_user_id = $3 AND role_id = $4
        RETURNING generation`,
      [lm, guildId, String(discordId), String(roleId), Boolean(desired), state, Boolean(bump), Boolean(resetAttempts),
        nextAttemptAt ? new Date(nextAttemptAt) : null]
    );
    return result.rows[0] ? Number(result.rows[0].generation) : null;
  }

  /** Claim due rows with a lease; the row lock is released at COMMIT, before
   *  any Discord call. Revokes (desired=false) sort first. grantsOnly leaves
   *  every revoke row queued and untouched (Stripe account unconfirmed). */
  async function claimRoleRows(limit = 20, leaseSeconds = 120, { grantsOnly = false } = {}) {
    return withTx(async (client) => {
      const result = await client.query(
        `UPDATE academy_billing_role_state r
            SET attempts = r.attempts + 1,
                next_attempt_at = now() + make_interval(secs => $2),
                updated_at = now()
          WHERE (r.livemode, r.guild_id, r.discord_user_id, r.role_id) IN (
                SELECT livemode, guild_id, discord_user_id, role_id
                  FROM academy_billing_role_state
                 WHERE livemode = $3 AND guild_id = $4
                   AND state IN ('pending','awaiting_member')
                   AND (next_attempt_at IS NULL OR next_attempt_at <= now())
                   AND (desired = true OR NOT $5::boolean)
                 ORDER BY desired ASC, updated_at ASC
                 FOR UPDATE SKIP LOCKED
                 LIMIT $1)
          RETURNING r.*`,
        [limit, leaseSeconds, lm, guildId, Boolean(grantsOnly)]
      );
      return result.rows.sort((a, b) => Number(a.desired) - Number(b.desired));
    });
  }

  /** Compare-and-set on the generation the applier claimed. */
  async function finishRoleRow(q, { discordId, roleId, generation, state, nextAttemptAt = null, httpStatus = null, error = null }) {
    const result = await q.query(
      `UPDATE academy_billing_role_state
          SET state = $6,
              attempts = CASE WHEN $6 = 'synced' THEN 0 ELSE attempts END,
              next_attempt_at = $7,
              last_http_status = $8,
              last_error = $9,
              last_applied_at = CASE WHEN $6 = 'synced' THEN now() ELSE last_applied_at END,
              applied_generation = CASE WHEN $6 = 'synced' THEN generation ELSE applied_generation END,
              applied_desired = CASE WHEN $6 = 'synced' THEN desired ELSE applied_desired END,
              awaiting_since = CASE WHEN $6 = 'awaiting_member' THEN COALESCE(awaiting_since, now())
                                    WHEN $6 = 'synced' THEN NULL ELSE awaiting_since END,
              updated_at = now()
        WHERE livemode = $1 AND guild_id = $2 AND discord_user_id = $3 AND role_id = $4 AND generation = $5`,
      [lm, guildId, String(discordId), String(roleId), Number(generation), state,
        nextAttemptAt ? new Date(nextAttemptAt) : null, httpStatus, error ? String(error).slice(0, 300) : null]
    );
    return result.rowCount;
  }

  /** Release a claimed row untouched (the latch tripped before its call). */
  async function releaseRoleRow(q, { discordId, roleId, generation }) {
    await q.query(
      `UPDATE academy_billing_role_state SET next_attempt_at = NULL, attempts = GREATEST(0, attempts - 1), updated_at = now()
        WHERE livemode = $1 AND guild_id = $2 AND discord_user_id = $3 AND role_id = $4 AND generation = $5`,
      [lm, guildId, String(discordId), String(roleId), Number(generation)]
    );
  }

  async function roleStateIds(q) {
    const result = await q.query(
      'SELECT DISTINCT discord_user_id FROM academy_billing_role_state WHERE livemode = $1 AND guild_id = $2',
      [lm, guildId]
    );
    return result.rows.map((row) => String(row.discord_user_id));
  }

  /** Engine switched to ROLE_MODE=enforce: every member whose last resync
   *  did not update the role outbox (ROLE_MODE off/dry_run, or the Discord
   *  read failed) is due now, so a purchase, refund or grace end seen while
   *  roles were not enforced gets its role change without waiting for the
   *  next renewal. Returns the number of members made due. */
  async function markRoleSyncDue(q) {
    const result = await q.query(
      `UPDATE academy_billing_members
          SET next_check_at = now(), updated_at = now()
        WHERE livemode = $1
          AND (last_access->>'rolesQueued') IS DISTINCT FROM 'true'
          AND (next_check_at IS NULL OR next_check_at > now())`,
      [lm]
    );
    return result.rowCount || 0;
  }

  /** A hub click or join: waiting grants for this user become due now, and a
   *  grant that gave up because the member was not in the server (90 days,
   *  or failed while they were away) is queued again with a fresh window. */
  async function kickAwaiting(q, discordId) {
    const result = await q.query(
      `UPDATE academy_billing_role_state SET state = 'pending', next_attempt_at = NULL,
              attempts = CASE WHEN state = 'failed' THEN 0 ELSE attempts END,
              awaiting_since = CASE WHEN state = 'failed' THEN NULL ELSE awaiting_since END,
              updated_at = now()
        WHERE livemode = $1 AND guild_id = $2 AND discord_user_id = $3 AND desired = true
          AND (state = 'awaiting_member'
               OR (state = 'failed' AND last_error IN ('member_absent_90d', 'member_not_in_guild')))`,
      [lm, guildId, String(discordId)]
    );
    return result.rowCount;
  }

  async function roleStatusFor(q, discordId) {
    const result = await q.query(
      `SELECT role_key, desired, state FROM academy_billing_role_state
        WHERE livemode = $1 AND guild_id = $2 AND discord_user_id = $3 ORDER BY role_key`,
      [lm, guildId, String(discordId)]
    );
    return result.rows.map((row) => ({ key: row.role_key, desired: Boolean(row.desired), state: row.state }));
  }

  /* ------------------------------ external role ledger ------------------------------ */

  async function externalGrantsFor(q, discordId, { forUpdate = false } = {}) {
    const result = await q.query(
      `SELECT * FROM academy_billing_external_grants
        WHERE livemode = $1 AND guild_id = $2 AND discord_user_id = $3${forUpdate ? ' FOR UPDATE' : ''}`,
      [lm, guildId, String(discordId)]
    );
    return result.rows;
  }

  async function getExternalGrant(q, discordId, roleId) {
    const result = await q.query(
      `SELECT * FROM academy_billing_external_grants
        WHERE livemode = $1 AND guild_id = $2 AND discord_user_id = $3 AND role_id = $4`,
      [lm, guildId, String(discordId), String(roleId)]
    );
    return result.rows[0] || null;
  }

  /** First grant decision for (member, role). Never overwrites: 0 = a row exists. */
  async function insertExternalGrant(q, { discordId, roleId, hadRoleBefore, state, firstSourceRef = null, reason = null }) {
    const result = await q.query(
      `INSERT INTO academy_billing_external_grants
         (livemode, guild_id, discord_user_id, role_id, first_source_ref, had_role_before, state, last_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (livemode, guild_id, discord_user_id, role_id) DO NOTHING`,
      [lm, guildId, String(discordId), String(roleId), firstSourceRef ? String(firstSourceRef).slice(0, 120) : null,
        Boolean(hadRoleBefore), state, reason ? String(reason).slice(0, 200) : null]
    );
    return result.rowCount;
  }

  /** Compare-and-set on the generation that was read; bumps it. Returns the
   *  new generation, or null when the row changed in between (nothing is
   *  written). had_role_before changes only when hadRoleBefore is given: a
   *  grant decision that starts a NEW entitlement (the previous one ended in
   *  revoked / kept_external / released) records it again from the live read. */
  async function updateExternalGrant(q, { discordId, roleId, generation, state, reason = null, ucResult = null, ucChecked = false, hadRoleBefore = null }) {
    const result = await q.query(
      `UPDATE academy_billing_external_grants
          SET last_reason = $7,
              uc_result = CASE WHEN $9 THEN $8 ELSE uc_result END,
              uc_checked_at = CASE WHEN $9 THEN now() ELSE uc_checked_at END,
              had_role_before = COALESCE($10::boolean, had_role_before),
              state_changed_at = CASE WHEN state = $6 THEN state_changed_at ELSE now() END,
              state = $6,
              generation = generation + 1,
              updated_at = now()
        WHERE livemode = $1 AND guild_id = $2 AND discord_user_id = $3 AND role_id = $4 AND generation = $5
        RETURNING generation`,
      [lm, guildId, String(discordId), String(roleId), Number(generation), state, reason ? String(reason).slice(0, 200) : null,
        ucResult, Boolean(ucChecked), typeof hadRoleBefore === 'boolean' ? hadRoleBefore : null]
    );
    return result.rows[0] ? Number(result.rows[0].generation) : null;
  }

  /* A revoke the ledger decided whose DELETE did not land: the outbox row
     gave up ('failed') or was held by the kill switch ('suppressed'). */
  const UNFINISHED_REVOKE = `g.state = 'revoked' AND r.desired = false AND r.state IN ('failed','suppressed')`;
  const GRANT_OUTBOX_JOIN = `LEFT JOIN academy_billing_role_state r
           ON r.livemode = g.livemode AND r.guild_id = g.guild_id AND r.discord_user_id = g.discord_user_id AND r.role_id = g.role_id`;

  /** Members with an engine-granted external role, or an unfinished revoke of
   *  one (the reconciler re-checks them). */
  async function externalGrantHolderIds(q, limit = 5000) {
    const result = await q.query(
      `SELECT DISTINCT g.discord_user_id FROM academy_billing_external_grants g
         ${GRANT_OUTBOX_JOIN}
        WHERE g.livemode = $1 AND g.guild_id = $2
          AND ((g.state = 'engine_granted' AND g.had_role_before = false) OR (${UNFINISHED_REVOKE}))
        LIMIT $3`,
      [lm, guildId, limit]
    );
    return result.rows.map((row) => String(row.discord_user_id));
  }

  /** The CLI external-review listing: the given states, plus (unfinished=true)
   *  every unfinished revoke. */
  async function externalReviewRows(q, { states = ['needs_review'], unfinished = false, limit = 500 } = {}) {
    const result = await q.query(
      `SELECT g.discord_user_id, g.role_id, g.state, g.had_role_before, g.first_source_ref, g.last_reason, g.uc_result, g.uc_checked_at,
              g.generation, g.created_at, g.state_changed_at, r.state AS outbox_state, r.desired AS outbox_desired
         FROM academy_billing_external_grants g
         ${GRANT_OUTBOX_JOIN}
        WHERE g.livemode = $1 AND g.guild_id = $2
          AND (g.state = ANY($3::text[]) OR ($5::boolean AND ${UNFINISHED_REVOKE}))
        ORDER BY g.state_changed_at ASC LIMIT $4`,
      [lm, guildId, states.map(String), limit, Boolean(unfinished)]
    );
    return result.rows;
  }

  /* ------------------------------ events ------------------------------ */

  async function insertEvent(q, row) {
    const result = await q.query(
      `INSERT INTO academy_billing_events
         (event_id, type, livemode, account, api_version, stripe_created_at, object_id, customer_id, subscription_id,
          payment_intent_id, charge_id, checkout_session_id, invoice_id, meta_sml_kind, meta_discord_user, meta_intent,
          payload_sha256, status, ignore_reason)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (event_id) DO NOTHING`,
      [row.eventId, row.type, Boolean(row.livemode), row.account || null, row.apiVersion || null, Number(row.created || 0),
        row.objectId || null, row.customerId || null, row.subscriptionId || null, row.paymentIntentId || null,
        row.chargeId || null, row.checkoutSessionId || null, row.invoiceId || null, row.metaSmlKind || null,
        row.metaDiscordUser || null, row.metaIntent || null, row.payloadSha256, row.status, row.ignoreReason || null]
    );
    return result.rowCount === 1 ? 'inserted' : 'duplicate';
  }

  async function claimEvents(limit = 25, leaseSeconds = 300) {
    return withTx(async (client) => {
      const result = await client.query(
        `UPDATE academy_billing_events e
            SET attempts = e.attempts + 1,
                next_attempt_at = now() + make_interval(secs => $2)
          WHERE e.event_id IN (
                SELECT event_id FROM academy_billing_events
                 WHERE status IN ('pending','failed') AND livemode = $3
                   AND (next_attempt_at IS NULL OR next_attempt_at <= now())
                 ORDER BY received_at
                 FOR UPDATE SKIP LOCKED
                 LIMIT $1)
          RETURNING e.*`,
        [limit, leaseSeconds, lm]
      );
      return result.rows.sort((a, b) => new Date(a.received_at) - new Date(b.received_at));
    });
  }

  async function finishEvent(q, { eventId, status, reason = null }) {
    await q.query(
      `UPDATE academy_billing_events
          SET status = $2, ignore_reason = COALESCE($3, ignore_reason), last_error = NULL, next_attempt_at = NULL,
              processed_at = now()
        WHERE event_id = $1`,
      [eventId, status, reason]
    );
  }

  /** Backoff 30 s x 2^n capped at 6 h; 'dead' after EVENT_MAX_ATTEMPTS. */
  async function retryEvent(q, { eventId, error, delaySeconds = null }) {
    const result = await q.query(
      `UPDATE academy_billing_events
          SET status = CASE WHEN attempts >= $3 THEN 'dead' ELSE 'failed' END,
              next_attempt_at = CASE WHEN attempts >= $3 THEN NULL
                ELSE now() + make_interval(secs => COALESCE($4::double precision, LEAST(21600, 30 * power(2, LEAST(attempts, 20))))) END,
              last_error = $2
        WHERE event_id = $1
        RETURNING status, attempts`,
      [eventId, String(error || 'error').slice(0, 300), EVENT_MAX_ATTEMPTS, delaySeconds]
    );
    return result.rows[0] || null;
  }

  async function replayDeferred(q) {
    const result = await q.query(
      `UPDATE academy_billing_events SET status = 'pending', next_attempt_at = NULL, attempts = 0
        WHERE status = 'deferred' AND livemode = $1`,
      [lm]
    );
    return result.rowCount;
  }

  async function replayEvent(q, eventId) {
    const result = await q.query(
      `UPDATE academy_billing_events SET status = 'pending', next_attempt_at = NULL, attempts = 0
        WHERE event_id = $1 AND livemode = $2 RETURNING event_id, type`,
      [eventId, lm]
    );
    return result.rows[0] || null;
  }

  async function pruneEvents(q) {
    const result = await q.query(
      `DELETE FROM academy_billing_events
        WHERE (status = 'ignored' AND received_at < now() - interval '14 days')
           OR (status = 'processed' AND received_at < now() - interval '180 days')`,
      []
    );
    return result.rowCount || 0;
  }

  /* ------------------------------ reconcile runs ------------------------------ */

  /** Returns false when another run is still in progress (deploy overlap). */
  async function startRun({ runId, mode, scope }) {
    return withTx(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [RECONCILE_LOCK_KEY]);
      const busy = await client.query(
        `SELECT run_id FROM academy_billing_reconcile_runs
          WHERE livemode = $1 AND finished_at IS NULL AND started_at > now() - interval '30 minutes' LIMIT 1`,
        [lm]
      );
      if (busy.rows.length) return false;
      await client.query(
        'INSERT INTO academy_billing_reconcile_runs (run_id, livemode, mode, scope) VALUES ($1, $2, $3, $4)',
        [runId, lm, mode, scope]
      );
      return true;
    });
  }

  async function finishRun(q, run) {
    await q.query(
      `UPDATE academy_billing_reconcile_runs
          SET finished_at = now(), stripe_complete = $2, entitled_academy = $3, entitled_lifetime = $4,
              holders_seen = $5, planned_grants = $6, planned_revokes = $7, applied_grants = $8,
              applied_revokes = $9, waiting_member = $10, orphans = $11, unmapped_prices = $12,
              audit_log_cursor = $13, brake = $14, error = $15
        WHERE run_id = $1`,
      [run.runId, run.stripeComplete, run.entitledAcademy, run.entitledLifetime, run.holdersSeen, run.plannedGrants,
        run.plannedRevokes, run.appliedGrants, run.appliedRevokes, run.waitingMember, run.orphans, run.unmappedPrices,
        run.auditLogCursor || null, run.brake || null, run.error ? String(run.error).slice(0, 300) : null]
    );
  }

  async function previousRun(q) {
    const result = await q.query(
      `SELECT run_id, entitled_academy, audit_log_cursor FROM academy_billing_reconcile_runs
        WHERE livemode = $1 AND finished_at IS NOT NULL AND stripe_complete = true AND error IS NULL
        ORDER BY started_at DESC LIMIT 1`,
      [lm]
    );
    return result.rows[0] || null;
  }

  /* ------------------------------ ops ------------------------------ */

  async function statusCounts(q) {
    const one = async (sql, params = [lm]) => (await q.query(sql, params)).rows;
    return {
      members: await one('SELECT count(*)::int AS n, count(stripe_customer_id)::int AS with_customer FROM academy_billing_members WHERE livemode = $1'),
      intents: await one('SELECT status, count(*)::int AS n FROM academy_billing_checkout_intents WHERE livemode = $1 GROUP BY status ORDER BY status'),
      lifetime: await one('SELECT stripe_state, count(*)::int AS n FROM academy_billing_lifetime WHERE livemode = $1 GROUP BY stripe_state ORDER BY stripe_state'),
      comps: await one('SELECT count(*)::int AS n FROM academy_billing_comps WHERE livemode = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())'),
      roles: await one('SELECT role_key, state, desired, count(*)::int AS n FROM academy_billing_role_state WHERE livemode = $1 GROUP BY role_key, state, desired ORDER BY role_key, state'),
      external: await one('SELECT role_id, state, had_role_before, count(*)::int AS n FROM academy_billing_external_grants WHERE livemode = $1 GROUP BY role_id, state, had_role_before ORDER BY role_id, state'),
      trials: await one('SELECT count(*)::int AS n FROM academy_billing_trials WHERE livemode = $1'),
      events: await one('SELECT status, count(*)::int AS n FROM academy_billing_events WHERE livemode = $1 GROUP BY status ORDER BY status'),
      lastRun: await one(`SELECT run_id, started_at, finished_at, mode, scope, stripe_complete, entitled_academy, entitled_lifetime,
                                 holders_seen, planned_grants, planned_revokes, applied_grants, applied_revokes, waiting_member,
                                 orphans, unmapped_prices, brake, error
                            FROM academy_billing_reconcile_runs WHERE livemode = $1 ORDER BY started_at DESC LIMIT 1`),
      audit: await one('SELECT count(*)::int AS n, max(at) AS last_at FROM academy_billing_audit', [])
    };
  }

  /** Remove every livemode=false row except the append-only audit. */
  async function purgeTestRows(q) {
    const counts = {};
    for (const table of ['academy_billing_role_state', 'academy_billing_external_grants', 'academy_billing_trials', 'academy_billing_lifetime',
      'academy_billing_checkout_intents', 'academy_billing_comps', 'academy_billing_events', 'academy_billing_reconcile_runs', 'academy_billing_members']) {
      const result = await q.query(`DELETE FROM ${table} WHERE livemode = false`, []);
      counts[table] = result.rowCount || 0;
    }
    return counts;
  }

  return {
    pool,
    livemode: lm,
    guildId,
    withTx,
    withUserTx,
    lockUser,
    schemaPresent,
    getMember,
    getMemberByCustomer,
    memberIds,
    dueMemberIds,
    ensureMember,
    setMemberCustomer,
    upsertRebuiltMember,
    updateMemberAccess,
    setNextCheck,
    moveBinding,
    compsFor,
    compHolderIds,
    insertComp,
    revokeComp,
    lifetimeRows,
    lifetimeByPaymentIntent,
    lifetimeHolderIds,
    upsertLifetime,
    insertIntent,
    recentCreatedIntent,
    trialFor,
    recordTrial,
    markIntentOpen,
    markIntentStatus,
    getIntentBySession,
    getIntent,
    roleRowsFor,
    insertRoleRow,
    updateRoleRow,
    claimRoleRows,
    finishRoleRow,
    releaseRoleRow,
    roleStateIds,
    markRoleSyncDue,
    kickAwaiting,
    roleStatusFor,
    externalGrantsFor,
    getExternalGrant,
    insertExternalGrant,
    updateExternalGrant,
    externalGrantHolderIds,
    externalReviewRows,
    insertEvent,
    claimEvents,
    finishEvent,
    retryEvent,
    replayDeferred,
    replayEvent,
    pruneEvents,
    startRun,
    finishRun,
    previousRun,
    statusCounts,
    purgeTestRows
  };
}

module.exports = { createStore, RECONCILE_LOCK_KEY, EVENT_MAX_ATTEMPTS, ROLE_MAX_ATTEMPTS };
