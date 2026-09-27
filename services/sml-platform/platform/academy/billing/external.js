'use strict';

/* =============================================================================
 * MEM Academy billing: EXTERNAL roles (Monarch, Elite, Premium by default).
 *
 * A price (or a comp) may grant roles the engine does not own: Upgrade.Chat
 * sells the same roles to its own members, and staff hand them out. Those
 * roles are GRANT-ONLY-UNLESS-SAFE. The ledger
 * (academy_billing_external_grants) records, at each grant decision that
 * starts an entitlement and from a live read of the guild member, whether the
 * member already held the role:
 *
 *   entitled, role missing, no ledger row  -> PUT; engine_granted,
 *                                             had_role_before=false
 *   entitled, role present, no ledger row  -> held, had_role_before=true (the
 *                                             engine never removes it)
 *   entitled again after an earlier         -> the same decision again, from
 *     entitlement ended (revoked,              the live read: a member who
 *     kept_external, released)                 holds the role now is 'held'
 *   no engine source entitles it any more  -> revoke ONLY IF the ledger says
 *     (union of prices, lifetime, comps)      engine_granted with
 *                                             had_role_before=false AND the
 *                                             Upgrade.Chat check says no
 *                                             active UC membership grants it
 *     UC active                            -> kept_external (no revoke)
 *     UC unconfigured / error / unknown /  -> needs_review (no revoke, audited,
 *        a renewal still being charged        listed by `external-review`)
 *     the role is gone anyway              -> revoked (had_role_before=false)
 *                                             or released (had_role_before=true)
 *
 * No ledger row means the engine never touches the role, so Upgrade.Chat's own
 * Monarch / Premium / Elite holders are invisible to every revoke path. The
 * applier re-reads the ledger before any external DELETE, and never sends one
 * on an Upgrade.Chat answer older than UC_ANSWER_TTL_MS (applier.js).
 *
 * This module holds the Upgrade.Chat check. It reuses platform/upgrade-chat.js
 * (createUpgradeChatClient().listOrders, every UPGRADE order of the account
 * paged to the end, and findMembership) with the platform's
 * UPGRADE_CHAT_CLIENT_ID / UPGRADE_CHAT_CLIENT_SECRET.
 * SML_ACADEMY_BILLING_UC_MATCH picks what counts:
 *   any    (default) ANY active Upgrade.Chat upgrade of the member keeps the
 *          role: every product, the hidden ones (many still have paying
 *          members that hold Elite, Premium or Monarch) and one-time
 *          lifetime orders included. UC_ROLE_PRODUCTS_JSON is not used.
 *          The upgrade that keeps a role may grant ANOTHER role, so
 *          Upgrade.Chat's own bot never removes the kept one: such a
 *          'kept_external' row (the engine granted the role,
 *          had_role_before=false, kept on an Upgrade.Chat 'active' answer) is
 *          NOT final. It is asked again every UC_KEPT_RECHECK_MS while the
 *          member holds the role, and revoked like an engine_granted row once
 *          Upgrade.Chat shows no active upgrade at all (ucKeptRecheckable).
 *          A staff keep (external-review --keep) stays final.
 *   mapped only the products SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON maps
 *          to that role count (a role mapped to [] is a clear "none").
 * A one-time order counts for good unless Upgrade.Chat has ended it: its API
 * has no refund field, and a refunded or charged-back purchase is one it
 * expired ('deleted' set). A time-limited one-time order counts until its
 * time runs out; a subscription until its paid-through date (a free trial
 * with no charge yet: until the trial ends).
 * Every answer that is not a clear yes or a clear no is 'inconclusive', and
 * an inconclusive answer never revokes. The whole check has a deadline
 * (UC_CHECK_DEADLINE_MS): an Upgrade.Chat that does not answer is
 * inconclusive and never holds a resync slot.
 * ========================================================================== */

const { addUtc } = require('../../upgrade-chat');

/* A needs_review row is re-checked against Upgrade.Chat at most this often. */
const UC_RECHECK_MS = 6 * 3600_000;
/* UC_MATCH=any: a role kept on an Upgrade.Chat 'active' answer is asked again
   this often (the upgrade was confirmed active; once a day keeps the load on
   Upgrade.Chat and on MEM's shared Stripe rate limit low). */
const UC_KEPT_RECHECK_MS = 24 * 3600_000;
/* The reason external-review --keep records: a staff decision, never re-checked. */
const STAFF_KEEP_REASON = 'kept_by_staff';
/* An external DELETE is sent only on an Upgrade.Chat "none" at most this old;
   an older one is asked again first (the member may have paid Upgrade.Chat
   for the role while the DELETE waited). */
const UC_ANSWER_TTL_MS = 10 * 60_000;
/* A subscription that is neither cancelled nor deleted is still being charged
   for this long after its paid-through date (the renewal charge is recorded
   late, or payment retries run): inconclusive, never a "no". */
const UC_RENEWAL_GRACE_MS = 7 * 86400_000;
/* The whole Upgrade.Chat check (token, findMembership per product, up to ten
   order pages) answers within this, else inconclusive (uc_timeout). */
const UC_CHECK_DEADLINE_MS = 10_000;
/* findMembership's "nothing found" answer; anything else it throws (HTTP,
   network, a malformed order) is an error, never a "no". */
const UC_NONE = /no eligible Upgrade\.Chat subscription was found/;

const LEDGER_STATES = Object.freeze(['held', 'engine_granted', 'revoked', 'kept_external', 'needs_review', 'released']);

/**
 * Does one Upgrade.Chat order grant one of `products` right now? products
 * null = ANY product (SML_ACADEMY_BILLING_UC_MATCH=any).
 *   subscription -> active until its paid-through date (with no succeeded
 *                   charge yet, at least until its free trial ends); one that
 *                   is not cancelled stays 'renewing' for UC_RENEWAL_GRACE_MS
 *                   after that date (the caller answers inconclusive)
 *   one-time     -> active unless the order is deleted (a UC lifetime
 *                   purchase, active for good unless Upgrade.Chat ended it,
 *                   which is how a refund shows; fail safe toward keeping
 *                   access); a time-limited one-time order only until its
 *                   interval has passed
 * Returns { kind: 'subscription' | 'one_time' | 'renewing', ref, productUuid }
 * or null. Throws on an order it cannot read (the caller turns that into
 * 'inconclusive').
 */
function orderGrants(order, products, nowMs) {
  if (!order || order.deleted) return null;
  const anyProduct = products === null;
  let renewing = null;
  for (const item of Array.isArray(order.order_items) ? order.order_items : []) {
    const uuid = item && item.product && item.product.uuid ? String(item.product.uuid) : '';
    if (!anyProduct && (!uuid || !products.includes(uuid))) continue;
    if (!item) continue;
    const ref = String(order.uuid || '');
    if (!order.is_subscription) {
      if (item.is_time_limited === true && item.interval) {
        const ends = addUtc(order.purchased_at, item.interval, Number(item.interval_count || 1)).getTime();
        if (ends > nowMs) return { kind: 'one_time', ref, productUuid: uuid };
        continue;
      }
      return { kind: 'one_time', ref, productUuid: uuid };
    }
    if (!item.interval) throw new TypeError('Upgrade.Chat subscription order without an interval');
    const charged = order.last_succeeded_charge && order.last_succeeded_charge.payment_processor_created
      ? order.last_succeeded_charge.payment_processor_created : null;
    let paidThrough = addUtc(charged || order.purchased_at, item.interval, Number(item.interval_count || 1)).getTime();
    const trialDays = Number(item.free_trial_length || 0);
    if (!charged && Number.isFinite(trialDays) && trialDays > 0) {
      /* A free trial (calendar days) with no charge yet. */
      const trialEnd = new Date(order.purchased_at).getTime() + trialDays * 86400_000;
      if (Number.isFinite(trialEnd)) paidThrough = Math.max(paidThrough, trialEnd);
    }
    if (paidThrough > nowMs) return { kind: 'subscription', ref, productUuid: uuid };
    if (!order.cancelled_at && nowMs - paidThrough < UC_RENEWAL_GRACE_MS) {
      renewing = renewing || { kind: 'renewing', ref: String(order.uuid || ''), productUuid: uuid };
    }
  }
  return renewing;
}

function withDeadline(promise, ms) {
  let timer = null;
  const deadline = new Promise((resolve) => {
    /* not unref'd: the caller is waiting on it; it is cleared as soon as the check answers */
    timer = setTimeout(() => resolve({ result: 'inconclusive', reason: 'uc_timeout' }), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * createUcChecker({ config, client, deadlineMs }) -> { configured, mode, scope, check(discordId, roleId) }
 * check() never throws; it answers
 *   { result: 'active',       reason, ref }  a UC membership grants the role
 *                                            (mode 'any': ANY active UC upgrade)
 *   { result: 'none',         reason }       conclusively none
 *   { result: 'inconclusive', reason }       not configured, unmapped role
 *                                            ('mapped' only), an error, a
 *                                            truncated list, a renewal still
 *                                            being charged, or no answer
 *                                            within deadlineMs
 * scope 'member' (mode any): the answer is the same for every role of one
 * member, so a caller asks once per member and pass; 'role' (mapped): per role.
 */
function createUcChecker({ config, client = null, logger = () => {}, now = Date.now, deadlineMs = UC_CHECK_DEADLINE_MS } = {}) {
  const mode = config && config.ucMatch === 'mapped' ? 'mapped' : 'any';
  const configured = Boolean(config && config.ucConfigured && client
    && (mode === 'any' ? typeof client.listOrders === 'function' : typeof client.findMembership === 'function'));

  /* mode any: every UPGRADE order of the account, whatever the product. */
  async function askAny(discordId, roleId) {
    try {
      const orders = await client.listOrders({ discordUserId: String(discordId) });
      if (!orders || !Array.isArray(orders.data) || orders.complete === false) return { result: 'inconclusive', reason: 'uc_orders_truncated' };
      let renewing = null;
      for (const order of orders.data) {
        const hit = orderGrants(order, null, now());
        if (!hit) continue;
        if (hit.kind === 'renewing') { renewing = renewing || hit; continue; }
        return { result: 'active', reason: hit.kind === 'one_time' ? 'uc_one_time_order' : 'uc_subscription_active', ref: hit.ref };
      }
      if (renewing) return { result: 'inconclusive', reason: 'uc_renewal_pending', ref: renewing.ref };
      return { result: 'none', reason: 'uc_no_active_upgrade' };
    } catch (error) {
      logger('warn', 'academy_billing_uc_check_failed', { discordUserId: String(discordId), roleId: String(roleId),
        error: String(error && error.message || 'error').slice(0, 80) });
      return { result: 'inconclusive', reason: 'uc_error' };
    }
  }

  async function ask(discordId, roleId, products) {
    try {
      for (const productUuid of products) {
        try {
          const membership = await client.findMembership({ discordUserId: String(discordId), productUuid });
          if (membership) return { result: 'active', reason: 'uc_subscription_active', ref: String(membership.externalReference || '') };
        } catch (error) {
          if (!(error instanceof TypeError && UC_NONE.test(String(error.message)))) throw error;
        }
      }
      /* findMembership sees paid-through subscriptions on the first page only. */
      if (typeof client.listOrders !== 'function') return { result: 'inconclusive', reason: 'uc_orders_unavailable' };
      const orders = await client.listOrders({ discordUserId: String(discordId) });
      if (!orders || !Array.isArray(orders.data) || orders.complete === false) return { result: 'inconclusive', reason: 'uc_orders_truncated' };
      let renewing = null;
      for (const order of orders.data) {
        const hit = orderGrants(order, products, now());
        if (!hit) continue;
        if (hit.kind === 'renewing') { renewing = renewing || hit; continue; }
        return { result: 'active', reason: hit.kind === 'one_time' ? 'uc_one_time_order' : 'uc_subscription_active', ref: hit.ref };
      }
      if (renewing) return { result: 'inconclusive', reason: 'uc_renewal_pending', ref: renewing.ref };
      return { result: 'none', reason: 'uc_no_active_membership' };
    } catch (error) {
      logger('warn', 'academy_billing_uc_check_failed', { discordUserId: String(discordId), roleId: String(roleId),
        error: String(error && error.message || 'error').slice(0, 80) });
      return { result: 'inconclusive', reason: 'uc_error' };
    }
  }

  async function check(discordId, roleId) {
    if (!configured) return { result: 'inconclusive', reason: 'uc_not_configured' };
    let pending;
    if (mode === 'any') pending = askAny(discordId, roleId);
    else {
      const products = config.ucRoleProducts.get(String(roleId));
      if (!products) return { result: 'inconclusive', reason: 'uc_role_unmapped' };
      if (!products.length) return { result: 'none', reason: 'uc_no_product_grants_role' };
      pending = ask(discordId, roleId, products);
    }
    const answer = await withDeadline(pending, deadlineMs);
    if (answer.reason === 'uc_timeout') {
      logger('warn', 'academy_billing_uc_check_failed', { discordUserId: String(discordId), roleId: String(roleId), error: 'timeout' });
    }
    return answer;
  }

  return { configured, mode, scope: mode === 'any' ? 'member' : 'role', check };
}

/** Is this ledger row one whose role the engine may remove (after the UC check)? */
function revocableGrant(grant) {
  return Boolean(grant) && grant.had_role_before === false && (grant.state === 'engine_granted' || grant.state === 'needs_review');
}

/**
 * UC_MATCH=any: a 'kept_external' row the engine itself granted
 * (had_role_before=false) that an Upgrade.Chat 'active' answer kept. Under
 * 'any' that upgrade may be for another product and another role, so nobody
 * else will ever remove this role: the row stays revocable (the caller asks
 * Upgrade.Chat again every UC_KEPT_RECHECK_MS). A staff keep is final.
 */
function ucKeptRecheckable(grant) {
  return Boolean(grant) && grant.state === 'kept_external' && grant.had_role_before === false
    && grant.uc_result === 'active' && grant.last_reason !== STAFF_KEEP_REASON;
}

/** A needs_review row (every UC_RECHECK_MS) or a re-checkable kept row
 *  (every UC_KEPT_RECHECK_MS) is due for another Upgrade.Chat check; any
 *  other row is asked whenever the caller needs an answer. */
function ucRecheckDue(grant, nowMs, force = false) {
  if (!grant) return true;
  const every = grant.state === 'needs_review' ? UC_RECHECK_MS : (grant.state === 'kept_external' ? UC_KEPT_RECHECK_MS : 0);
  if (!every || force) return true;
  const at = grant.uc_checked_at ? new Date(grant.uc_checked_at).getTime() : 0;
  return !Number.isFinite(at) || nowMs - at >= every;
}

/** The ledger's last Upgrade.Chat answer is too old to send a DELETE on. */
function ucAnswerStale(grant, nowMs) {
  const at = grant && grant.uc_checked_at ? new Date(grant.uc_checked_at).getTime() : NaN;
  return !Number.isFinite(at) || nowMs - at > UC_ANSWER_TTL_MS;
}

module.exports = { createUcChecker, orderGrants, revocableGrant, ucRecheckDue, ucAnswerStale, ucKeptRecheckable,
  UC_RECHECK_MS, UC_KEPT_RECHECK_MS, UC_ANSWER_TTL_MS, UC_RENEWAL_GRACE_MS, UC_CHECK_DEADLINE_MS, LEDGER_STATES, STAFF_KEEP_REASON };
