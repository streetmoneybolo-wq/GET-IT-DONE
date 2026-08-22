/* =============================================================================
 * StockMarketLoop — subscription lifecycle: webhooks + role reconciler
 *
 * Both halves are PURE. They take state and return INTENTS; they never touch a
 * database, Stripe, or Discord. The caller applies the intents inside its own
 * transaction. That is what makes the money-handling paths testable without a
 * sandbox account, and what lets a failed apply be retried safely.
 *
 * The access rule is implemented ONCE, in hasAccess(). Everything else asks it.
 * Three copies of that rule in three jobs is how members end up with roles they
 * are not paying for, and vice versa.
 * ========================================================================== */

'use strict';

const DAY_MS = 24 * 3600 * 1000;

/* Events that change access. Anything else is recorded and ignored, rather than
 * silently dropped — an unhandled type should be visible, not invisible. */
const HANDLED = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed'
]);

/* -------------------------------------------------------------------------- */
/* The access rule — one implementation, referenced everywhere                 */
/* -------------------------------------------------------------------------- */

/**
 * A member has access while paying, and for the grace window after a failure.
 *
 * The grace window exists because Stripe retries failed charges over several
 * days. Revoking on the first failure ejects customers whose card succeeds on
 * attempt two, and they charge back.
 */
function hasAccess(sub, now) {
  if (!sub) return false;
  const t = now == null ? 0 : now;
  if (sub.status === 'trialing' || sub.status === 'active') return true;
  if (sub.status === 'past_due' || sub.status === 'grace' || sub.status === 'unpaid') {
    return sub.access_until != null && t < toMs(sub.access_until);
  }
  return false;
}

function toMs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

/* -------------------------------------------------------------------------- */
/* Webhook handling                                                            */
/* -------------------------------------------------------------------------- */

function intent(type, payload) { return Object.assign({ type }, payload); }

/**
 * Turn one Stripe event into intents.
 *
 * ctx supplies what the caller already knows:
 *   seenEventIds   Set of processed event ids            (idempotency)
 *   subscription   the local row this event refers to, or null
 *   plan           the plan row, for grace_days and fee
 *   now            epoch ms
 *
 * Two guards matter more than the routing:
 *
 *   IDEMPOTENCY — Stripe retries. A replayed payment_failed must not re-run the
 *   grace clock and quietly extend access.
 *
 *   ORDERING — Stripe does not guarantee order. A payment_failed delivered late,
 *   after the retry already succeeded, would otherwise revoke a healthy
 *   subscription. Events older than the state already applied are discarded.
 */
function handleEvent(event, ctx = {}) {
  if (!event || !event.id || !event.type) {
    return { ok: false, error: 'malformed event', intents: [] };
  }

  const seen = ctx.seenEventIds || new Set();
  if (seen.has(event.id)) {
    return { ok: true, idempotent: true, skipped: 'already processed', intents: [] };
  }

  const record = intent('record_event', {
    event_id: event.id,
    event_type: event.type,
    event_created_at: event.created ? event.created * 1000 : (ctx.now || 0)
  });

  if (!HANDLED.has(event.type)) {
    return { ok: true, ignored: true, intents: [record] };
  }

  const sub = ctx.subscription || null;
  const plan = ctx.plan || {};
  const now = ctx.now == null ? 0 : ctx.now;
  const eventMs = event.created ? event.created * 1000 : now;

  /* Ordering guard: never let a stale delivery overwrite newer state. */
  if (sub && sub.last_event_at != null && eventMs < toMs(sub.last_event_at)) {
    return { ok: true, stale: true, skipped: 'event predates applied state', intents: [record] };
  }

  const obj = (event.data && event.data.object) || {};
  const intents = [record];

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const status = String(obj.status || 'active');
      intents.push(intent('update_subscription', {
        stripe_subscription_id: obj.id,
        status,
        current_period_end: obj.current_period_end ? obj.current_period_end * 1000 : null,
        cancel_at_period_end: !!obj.cancel_at_period_end,
        last_event_at: eventMs
      }));
      /* Recovery from grace is not signalled by invoice.paid alone in every
         flow, so an update back to active clears the failure state too. */
      if (status === 'active' || status === 'trialing') {
        intents.push(intent('clear_failure_state', { stripe_subscription_id: obj.id }));
        intents.push(intent('sync_roles', { reason: 'active', stripe_subscription_id: obj.id }));
      }
      break;
    }

    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      intents.push(intent('update_subscription', {
        stripe_subscription_id: obj.subscription,
        status: 'active',
        last_event_at: eventMs
      }));
      intents.push(intent('clear_failure_state', { stripe_subscription_id: obj.subscription }));

      /* Fee ledger. Only ever recorded for subscriptions this platform
         originated — an imported row cannot carry a fee, and writing a ledger
         entry for one would misstate revenue. */
      const feeBps = sub && sub.platform_fee_bps ? sub.platform_fee_bps : 0;
      const originOk = sub && sub.origin !== 'discord_imported';
      const gross = Number(obj.amount_paid || 0);
      if (originOk && feeBps > 0 && gross > 0) {
        intents.push(intent('record_fee', {
          stripe_invoice_id: obj.id,
          stripe_charge_id: obj.charge || null,
          subscription_id: sub.id,
          group_id: sub.group_id,
          gross_cents: gross,
          fee_cents: Math.round(gross * feeBps / 10000),
          fee_bps: feeBps,
          currency: obj.currency || 'usd',
          consent_ref: sub.fee_consent_at || null
        }));
      }
      intents.push(intent('sync_roles', { reason: 'paid', stripe_subscription_id: obj.subscription }));
      break;
    }

    case 'invoice.payment_failed': {
      const graceDays = plan.grace_days == null ? 3 : plan.grace_days;
      /* The clock starts at the FIRST failure and is not restarted by later
         ones, or a member could sit in grace indefinitely by failing weekly. */
      const firstFailed = sub && sub.first_failed_at ? toMs(sub.first_failed_at) : eventMs;
      intents.push(intent('update_subscription', {
        stripe_subscription_id: obj.subscription,
        status: 'grace',
        first_failed_at: firstFailed,
        access_until: firstFailed + graceDays * DAY_MS,
        increment_failed_count: true,
        last_event_at: eventMs
      }));
      intents.push(intent('notify', {
        template: 'payment_failed',
        user_id: sub ? sub.user_id : null,
        access_until: firstFailed + graceDays * DAY_MS
      }));
      /* Deliberately NO revoke here. The reconciler pulls roles when the grace
         window actually expires. */
      break;
    }

    case 'customer.subscription.deleted': {
      intents.push(intent('update_subscription', {
        stripe_subscription_id: obj.id,
        status: 'canceled',
        canceled_at: eventMs,
        access_until: eventMs,
        last_event_at: eventMs
      }));
      intents.push(intent('sync_roles', { reason: 'canceled', stripe_subscription_id: obj.id }));
      break;
    }
  }

  return { ok: true, intents };
}

/* -------------------------------------------------------------------------- */
/* Reconciler                                                                  */
/* -------------------------------------------------------------------------- */

/** Roles a subscription should confer right now. No access means none. */
function desiredRoles(sub, planGrants, now) {
  if (!hasAccess(sub, now)) return [];
  return (planGrants || []).map((g) => ({ target: g.target, role_ref: String(g.role_ref) }));
}

function keyOf(g) { return `${g.target}:${g.role_ref}`; }

/**
 * Compare desired against actual and emit operations.
 *
 * Discord work can be BLOCKED without the native half being blocked — a member
 * who never linked Discord should still get their on-site role. Partial success
 * has to be representable or the whole grant stalls on the weakest link.
 *
 * input:
 *   subs           [{id,user_id,group_id,plan_id,status,access_until,origin}]
 *   planGrantsById { [plan_id]: [{target, role_ref}] }
 *   actualBySub    { [sub_id]: [{target, role_ref, state}] }
 *   guild          { bot_has_manage_roles, bot_highest_role_position, active }
 *   rolePositions  { [role_ref]: position }   Discord role positions
 *   identities     Set of user_ids with a linked Discord account
 */
function reconcile(input = {}) {
  const now = input.now == null ? 0 : input.now;
  const subs = input.subs || [];
  const planGrantsById = input.planGrantsById || {};
  const actualBySub = input.actualBySub || {};
  const guild = input.guild || null;
  const positions = input.rolePositions || {};
  const identities = input.identities || new Set();

  const toGrant = [];
  const toRevoke = [];
  const blocked = [];

  const guildUsable = !!(guild && guild.active && guild.bot_has_manage_roles);

  for (const sub of subs) {
    const desired = desiredRoles(sub, planGrantsById[sub.plan_id], now);
    const actual = (actualBySub[sub.id] || []).filter((a) => a.state === 'granted' || a.state === 'pending');

    const desiredKeys = new Set(desired.map(keyOf));
    const actualKeys = new Set(actual.map(keyOf));

    for (const d of desired) {
      if (actualKeys.has(keyOf(d))) continue;

      if (d.target === 'discord_guild_role') {
        if (!guildUsable) {
          blocked.push({ subscription_id: sub.id, user_id: sub.user_id, role: d,
            reason: guild ? 'bot lacks MANAGE_ROLES or guild inactive' : 'no guild linked' });
          continue;
        }
        if (!identities.has(sub.user_id)) {
          blocked.push({ subscription_id: sub.id, user_id: sub.user_id, role: d,
            reason: 'user has not linked Discord' });
          continue;
        }
        /* Discord refuses edits to roles at or above the bot's own highest
           role. Checking here turns a silent API failure into a visible,
           actionable reason. */
        const pos = positions[d.role_ref];
        if (pos != null && guild.bot_highest_role_position != null && pos >= guild.bot_highest_role_position) {
          blocked.push({ subscription_id: sub.id, user_id: sub.user_id, role: d,
            reason: `role position ${pos} is not below the bot at ${guild.bot_highest_role_position}` });
          continue;
        }
      }

      toGrant.push({ subscription_id: sub.id, user_id: sub.user_id, group_id: sub.group_id, ...d });
    }

    for (const a of actual) {
      if (desiredKeys.has(keyOf(a))) continue;
      /* Revokes are never blocked on Discord health. If the call fails the row
         stays in 'revoking' and the next sweep retries — losing access late is
         recoverable, granting access wrongly is not. */
      toRevoke.push({ subscription_id: sub.id, user_id: sub.user_id, group_id: sub.group_id,
        target: a.target, role_ref: a.role_ref,
        reason: hasAccess(sub, now) ? 'plan no longer grants this role' : `access ended (${sub.status})` });
    }
  }

  return {
    toGrant, toRevoke, blocked,
    summary: `${toGrant.length} grant, ${toRevoke.length} revoke, ${blocked.length} blocked`
  };
}

/**
 * Subscriptions whose grace window has expired and which still hold roles.
 * The sweep that actually ends access — the payment_failed webhook only starts
 * the clock.
 */
function expiredGrace(subs, now) {
  return (subs || []).filter((s) =>
    (s.status === 'grace' || s.status === 'past_due' || s.status === 'unpaid') &&
    s.access_until != null && now >= toMs(s.access_until));
}

module.exports = {
  hasAccess,
  handleEvent,
  desiredRoles,
  reconcile,
  expiredGrace,
  HANDLED,
  DAY_MS
};
