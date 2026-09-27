'use strict';

/* =============================================================================
 * MEM Academy billing: the 15-minute reconciler (drift repair).
 *
 * It NEVER decides a grant or a revoke itself. Stripe lists are used only to
 * DISCOVER candidate members; every decision goes through the same per-member
 * resync (fresh snapshot + computeAccess) the webhook path uses. So a
 * subscription Stripe still calls 'active' whose current period was refunded,
 * or that has an open dispute, or a past_due one beyond its grace, is not
 * re-granted by the reconciler.
 *
 *   1. candidates from Stripe: every configured recurring price x
 *      active|trialing|past_due; subscriptions.search on sml_kind (catches
 *      prices missing from the config); lifetime PaymentIntents; disputes of
 *      the last 180 days; plus the lifetime cache and active comps.
 *   2. customer -> Discord id via the binding; a missing binding is rebuilt
 *      from Customer.metadata (audited); none -> orphan (ids logged).
 *   3. holders of an engine role: known ids (members, comps, role_state and
 *      audit-log role adds since the stored cursor) or, with the Server
 *      Members intent, the paged member list (403 -> falls back, alerts).
 *   4. revoke candidates = holders - candidates - comps - the bot. Holders
 *      of an EXTERNAL role (Monarch / Elite / Premium) are never discovered
 *      from Discord: only members whose ledger row says the engine granted
 *      that role (academy_billing_external_grants, engine_granted with
 *      had_role_before=false) or whose decided revoke did not land (outbox
 *      failed / suppressed) are added, and resync still needs the
 *      Upgrade.Chat check before it removes anything (external.js).
 *      Upgrade.Chat's own members are invisible here.
 *   5. brakes (revokes only; grants always flow): any Stripe page failed,
 *      more than MAX_REVOKES_PER_RUN candidates, or the candidate count fell
 *      by max(5, 50%) since the last complete run. --force-breaker (CLI) lifts
 *      the cap and the watermark, never the Stripe-complete brake.
 *   6. resync every candidate and every revoke candidate (unbound holders get
 *      a Stripe Search re-check first). dry_run -> resync in audit-only mode.
 *
 * Overlapping runs (Render deploy overlap) are refused by a run-row lease
 * taken under an advisory transaction lock; no lock is held across I/O.
 * ========================================================================== */

const crypto = require('node:crypto');
const { applyBrakes } = require('./access');
const shapes = require('./stripe-shapes');
const audit = require('./audit');

const LIVE = Object.freeze(['active', 'trialing', 'past_due']);
const DISPUTE_LOOKBACK_S = 180 * 86400;
const KNOWN_IDS_CAP = 5000;

function createReconciler({ config, store, stripeApi, bot, resync, preflight, logger = () => {}, now = Date.now,
  uuid = () => crypto.randomUUID() } = {}) {

  async function discoverFromStripe(run, dryRun, actor) {
    const customers = new Set();
    const unmapped = new Set();
    const mark = (r) => { if (!r || r.complete === false) run.stripeComplete = false; return r ? r.data || [] : []; };
    const guard = async (fn) => { try { return mark(await fn()); } catch (error) { run.stripeComplete = false; logger('warn', 'academy_billing_reconcile_stripe_failed', { error: String(error && (error.code || error.message) || 'error').slice(0, 80) }); return []; } };

    for (const entry of config.prices.values()) {
      if (entry.package === 'lifetime') continue;
      for (const status of LIVE) {
        for (const sub of await guard(() => stripeApi.listSubscriptionsByPrice(entry.priceId, status))) customers.add(shapes.idOf(sub.customer));
      }
    }
    for (const sub of await guard(() => stripeApi.searchAcademySubscriptions())) {
      if (LIVE.includes(sub.status)) customers.add(shapes.idOf(sub.customer));
      for (const item of shapes.subItems(sub)) if (item.priceId && !config.prices.has(item.priceId)) unmapped.add(item.priceId);
    }
    for (const pi of await guard(() => stripeApi.searchLifetimePaymentIntents())) customers.add(shapes.idOf(pi.customer));
    const since = Math.floor(now() / 1000) - DISPUTE_LOOKBACK_S;
    for (const dispute of await guard(() => stripeApi.listRecentDisputes(since))) {
      const charge = dispute.charge && typeof dispute.charge === 'object' ? dispute.charge : null;
      if (charge) customers.add(shapes.idOf(charge.customer));
    }
    customers.delete(null);
    run.unmappedPrices = unmapped.size;

    const ids = new Set();
    for (const customerId of customers) {
      const member = await store.getMemberByCustomer(store.pool, customerId);
      if (member) { ids.add(String(member.discord_user_id)); continue; }
      let customer = null;
      try { customer = await stripeApi.retrieveCustomer(customerId); } catch (_) { run.stripeComplete = false; continue; }
      const meta = customer && !customer.deleted ? customer.metadata || {} : {};
      const discordId = /^[0-9]{15,24}$/.test(String(meta.mem_academy_discord_user || '')) ? String(meta.mem_academy_discord_user) : null;
      if (!shapes.isAcademyMeta(meta) || !discordId) {
        /* Not an engine Customer (for example a dispute on a store charge). */
        if (shapes.isAcademyMeta(meta)) { run.orphans += 1; logger('warn', 'academy_billing_orphan_customer', { customerId }); }
        continue;
      }
      try { await rebuild(discordId, customerId, run, dryRun, actor); } catch (error) {
        logger('warn', 'academy_billing_reconcile_rebuild_failed', { discordUserId: discordId, customerId });
        continue;
      }
      ids.add(discordId);
    }
    return ids;
  }

  async function rebuild(discordId, customerId, run, dryRun, actor) {
    if (dryRun) {
      run.dryRebuilt = run.dryRebuilt || new Set();
      run.dryRebuilt.add(discordId);
      await audit.appendStandalone(store.pool, { actor, livemode: config.livemode, runId: run.runId, discordUserId: discordId,
        action: 'reconcile_rebuilt_from_stripe', outcome: 'dry_run', stripeRefs: [customerId] }, { now });
      return;
    }
    await store.withUserTx(discordId, async (client) => {
      const n = await store.upsertRebuiltMember(client, { discordId, customerId, accountId: config.stripeAccountId });
      if (n) {
        await audit.append(client, { actor, livemode: config.livemode, runId: run.runId, discordUserId: discordId,
          action: 'reconcile_rebuilt_from_stripe', outcome: 'applied', stripeRefs: [customerId] }, { now });
      }
    });
  }

  async function observeHolders(run, candidateIds) {
    const holders = new Set();
    const engine = Object.values(config.engineRoleIds).filter(Boolean).map(String);
    const holdsEngine = (roles) => roles.some((role) => engine.includes(String(role)));
    let scope = config.reconcileScan;
    if (scope === 'members') {
      try {
        let after = '0';
        for (let pages = 0; pages < 200; pages += 1) {
          const page = await bot.listMembers(after);
          for (const member of page) if (holdsEngine(member.roles)) holders.add(member.userId);
          if (page.length < 1000) break;
          after = page[page.length - 1].userId;
        }
        return holders;
      } catch (error) {
        logger('error', 'academy_billing_members_scan_unavailable', { kind: error && error.kind, fallback: 'known_ids' });
        scope = 'known_ids';
      }
    }
    const known = new Set(candidateIds);
    for (const id of await store.memberIds(store.pool, KNOWN_IDS_CAP)) known.add(id);
    for (const id of await store.compHolderIds(store.pool)) known.add(id);
    for (const id of await store.roleStateIds(store.pool)) known.add(id);
    const previous = await store.previousRun(store.pool);
    try {
      const found = await bot.auditLogRoleAdds({ after: previous ? previous.audit_log_cursor : null, roleIds: engine });
      for (const add of found.adds) known.add(add.targetId);
      run.auditLogCursor = found.cursor || (previous ? previous.audit_log_cursor : null);
    } catch (_) {
      run.auditLogCursor = previous ? previous.audit_log_cursor : null;
    }
    let scanned = 0;
    for (const id of known) {
      if (scanned >= KNOWN_IDS_CAP) break;
      scanned += 1;
      try {
        const member = await bot.getMember(id);
        if (member.inGuild && holdsEngine(member.roles)) holders.add(id);
      } catch (_) { /* unknown observation: never a revoke candidate this run */ }
    }
    return holders;
  }

  function tally(run, result, unbound) {
    if (!result || result.stale) return;
    if (result.roles.includes('academy')) run.entitledAcademy += 1;
    if (result.roles.includes('mem_lifetime')) run.entitledLifetime += 1;
    for (const op of result.ops || []) {
      if (op.desired) {
        run.plannedGrants += 1;
        if (op.queued && !result.dryRun) run.appliedGrants += 1;
        if (op.awaitingMember || op.state === 'awaiting_member') run.waitingMember += 1;
      } else {
        run.plannedRevokes += 1;
        if (op.queued && !result.dryRun) run.appliedRevokes += 1;
        if (unbound) run.orphanRevokes = (run.orphanRevokes || 0) + 1;
      }
    }
  }

  async function run({ mode = config.reconcileMode, forceBreaker = false, actor = 'reconciler' } = {}) {
    if (!['dry_run', 'apply'].includes(mode)) return { skipped: 'off' };
    if (!preflight.ok()) { logger('warn', 'academy_billing_reconcile_skipped', { reason: 'preflight' }); return { skipped: 'preflight' }; }
    const dryRun = mode === 'dry_run';
    const summary = {
      runId: uuid(), stripeComplete: true, entitledAcademy: 0, entitledLifetime: 0, holdersSeen: 0, plannedGrants: 0,
      plannedRevokes: 0, appliedGrants: 0, appliedRevokes: 0, waitingMember: 0, orphans: 0, unmappedPrices: 0,
      auditLogCursor: null, brake: null, error: null
    };
    if (!await store.startRun({ runId: summary.runId, mode, scope: config.reconcileScan })) {
      logger('info', 'academy_billing_reconcile_skipped', { reason: 'overlap' });
      return { skipped: 'overlap' };
    }
    try {
      const candidates = await discoverFromStripe(summary, dryRun, actor);
      for (const id of await store.lifetimeHolderIds(store.pool)) candidates.add(id);
      const comps = new Set(await store.compHolderIds(store.pool));
      for (const id of comps) candidates.add(id);

      const holders = await observeHolders(summary, candidates);
      /* Engine-granted external roles whose sources may have ended. */
      if (typeof store.externalGrantHolderIds === 'function') {
        for (const id of await store.externalGrantHolderIds(store.pool)) holders.add(id);
      }
      summary.holdersSeen = holders.size;
      const botId = config.appId;
      const revokeCandidates = [...holders].filter((id) => !candidates.has(id) && !comps.has(id) && id !== botId);

      const previous = await store.previousRun(store.pool);
      const brake = applyBrakes({
        stripeComplete: summary.stripeComplete,
        plannedRevokes: revokeCandidates.length,
        maxRevokes: config.maxRevokesPerRun,
        previousEntitled: previous && previous.entitled_academy != null ? Number(previous.entitled_academy) : null,
        entitledNow: candidates.size,
        forceBreaker
      });
      if (brake.brake) {
        summary.brake = brake.brake;
        await audit.appendStandalone(store.pool, { actor, livemode: config.livemode, runId: summary.runId, action: 'reconcile_brake',
          outcome: 'noop', reason: brake.brake, details: { revokeCandidates: revokeCandidates.length, candidates: candidates.size,
            previous: previous ? Number(previous.entitled_academy) : null } }, { now });
        logger('warn', 'academy_billing_reconcile_brake', { brake: brake.brake, revokeCandidates: revokeCandidates.length });
      }
      const opts = { actor, runId: summary.runId, dryRun, allowRevokes: brake.revokesAllowed };

      for (const id of candidates) {
        if (summary.dryRebuilt && summary.dryRebuilt.has(id)) continue;
        try { tally(summary, await resync(id, opts), false); } catch (error) {
          logger('warn', 'academy_billing_reconcile_resync_failed', { discordUserId: id, error: String(error && (error.kind || error.code || error.message) || 'error').slice(0, 80) });
        }
      }
      for (const id of revokeCandidates) {
        const member = await store.getMember(store.pool, id);
        let unbound = !member || !member.stripe_customer_id;
        if (unbound) {
          /* Two-phase: before treating a hand-added role as unpaid, look for a
             purchase Stripe knows about under this Discord id. */
          let found;
          try { found = await stripeApi.searchCustomersByDiscordId(id); } catch (_) { continue; }
          const match = (found.data || []).find((c) => !c.deleted && shapes.isAcademyMeta(c.metadata)
            && Boolean(c.livemode) === Boolean(config.livemode) && String(c.metadata.mem_academy_discord_user) === id);
          if (match) {
            try { await rebuild(id, match.id, summary, dryRun, actor); } catch (error) {
              /* e.g. the Customer is bound to another id: a binding conflict
                 for staff, never a reason to revoke. */
              logger('warn', 'academy_billing_reconcile_rebuild_failed', { discordUserId: id, customerId: match.id });
              continue;
            }
            /* dry run: the binding was not written, so a resync would wrongly
               see an unpaid holder; the audited rebuild is the whole answer. */
            if (dryRun) continue;
            unbound = false;
          } else {
            summary.orphans += 1;
          }
        }
        try {
          const result = await resync(id, opts);
          tally(summary, result, unbound);
          if (unbound && result && (result.ops || []).some((op) => !op.desired)) {
            await audit.appendStandalone(store.pool, { actor, livemode: config.livemode, runId: summary.runId, discordUserId: id,
              action: 'reconcile_orphan_revoke', outcome: dryRun ? 'dry_run' : 'applied', reason: 'no_entitlement_holder' }, { now });
          }
        } catch (error) {
          logger('warn', 'academy_billing_reconcile_resync_failed', { discordUserId: id, error: String(error && (error.kind || error.code || error.message) || 'error').slice(0, 80) });
        }
      }
    } catch (error) {
      summary.error = String(error && (error.code || error.message) || 'error').slice(0, 300);
      logger('error', 'academy_billing_reconcile_failed', { runId: summary.runId, error: summary.error });
    } finally {
      await store.finishRun(store.pool, summary).catch(() => {});
      logger('info', 'academy_billing_reconcile', {
        runId: summary.runId, mode, scope: config.reconcileScan, stripeComplete: summary.stripeComplete,
        entitledAcademy: summary.entitledAcademy, entitledLifetime: summary.entitledLifetime, holdersSeen: summary.holdersSeen,
        plannedGrants: summary.plannedGrants, plannedRevokes: summary.plannedRevokes, appliedGrants: summary.appliedGrants,
        appliedRevokes: summary.appliedRevokes, waitingMember: summary.waitingMember, orphans: summary.orphans,
        unmappedPrices: summary.unmappedPrices, brake: summary.brake, error: summary.error
      });
    }
    return summary;
  }

  return { run, discoverFromStripe, observeHolders };
}

module.exports = { createReconciler };
