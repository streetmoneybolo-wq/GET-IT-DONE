/* Subscription lifecycle tests.  Run: node --test  (from this directory) */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./lifecycle.js');

const T0 = Date.parse('2026-08-22T12:00:00Z');
const DAY = L.DAY_MS;

const plan = { grace_days: 3, platform_fee_bps: 600 };

function sub(over) {
  return Object.assign({
    id: 1, user_id: 100, group_id: 7, plan_id: 5,
    origin: 'sml_checkout', status: 'active',
    stripe_subscription_id: 'sub_123',
    platform_fee_bps: 600, fee_consent_at: '2026-08-01T00:00:00Z',
    access_until: null, first_failed_at: null, last_event_at: null
  }, over);
}

function evt(type, object, createdMs) {
  return { id: 'evt_' + type + '_' + (createdMs || T0), type, created: Math.floor((createdMs || T0) / 1000), data: { object } };
}

const find = (r, t) => r.intents.find((i) => i.type === t);

/* ---------- the access rule ---------- */

test('active and trialing have access', () => {
  assert.equal(L.hasAccess(sub({ status: 'active' }), T0), true);
  assert.equal(L.hasAccess(sub({ status: 'trialing' }), T0), true);
});

test('grace retains access until the deadline, then loses it', () => {
  const s = sub({ status: 'grace', access_until: T0 + DAY });
  assert.equal(L.hasAccess(s, T0), true, 'inside the window');
  assert.equal(L.hasAccess(s, T0 + DAY + 1), false, 'past the window');
});

test('canceled never has access even with a future access_until', () => {
  assert.equal(L.hasAccess(sub({ status: 'canceled', access_until: T0 + 99 * DAY }), T0), false);
});

/* ---------- webhook: idempotency and ordering ---------- */

test('a replayed event is a no-op', () => {
  const e = evt('invoice.payment_failed', { subscription: 'sub_123' });
  const r = L.handleEvent(e, { seenEventIds: new Set([e.id]), subscription: sub(), plan, now: T0 });
  assert.equal(r.idempotent, true);
  assert.equal(r.intents.length, 0);
});

test('an event older than applied state is discarded', () => {
  /* the classic bug: a late payment_failed revoking a subscription that already
     recovered on the retry */
  const late = evt('invoice.payment_failed', { subscription: 'sub_123' }, T0 - 2 * DAY);
  const r = L.handleEvent(late, { subscription: sub({ last_event_at: T0 }), plan, now: T0 });
  assert.equal(r.stale, true);
  assert.equal(find(r, 'update_subscription'), undefined, 'stale event must not mutate state');
});

test('every event is recorded, even unhandled types', () => {
  const r = L.handleEvent(evt('customer.created', {}), { now: T0 });
  assert.equal(r.ignored, true);
  assert.ok(find(r, 'record_event'), 'unhandled events must still be auditable');
});

test('a malformed event is rejected rather than half-processed', () => {
  assert.equal(L.handleEvent(null).ok, false);
  assert.equal(L.handleEvent({ id: 'x' }).ok, false);
});

/* ---------- webhook: payment failure ---------- */

test('a failed payment starts the grace clock and does NOT revoke', () => {
  const r = L.handleEvent(evt('invoice.payment_failed', { subscription: 'sub_123' }),
    { subscription: sub(), plan, now: T0 });
  const u = find(r, 'update_subscription');
  assert.equal(u.status, 'grace');
  assert.equal(u.access_until, T0 + 3 * DAY);
  assert.equal(find(r, 'sync_roles'), undefined, 'roles must not be pulled on the first failure');
  assert.ok(find(r, 'notify'), 'the member should be told');
});

test('a second failure does not restart the grace clock', () => {
  const started = T0 - 2 * DAY;
  const r = L.handleEvent(evt('invoice.payment_failed', { subscription: 'sub_123' }, T0),
    { subscription: sub({ status: 'grace', first_failed_at: started }), plan, now: T0 });
  const u = find(r, 'update_subscription');
  assert.equal(u.first_failed_at, started, 'clock restarted — member could stall forever');
  assert.equal(u.access_until, started + 3 * DAY);
});

/* ---------- webhook: payment success and fees ---------- */

test('payment success clears failure state and syncs roles', () => {
  const r = L.handleEvent(evt('invoice.paid', { id: 'in_1', subscription: 'sub_123', amount_paid: 9999 }),
    { subscription: sub({ status: 'grace', first_failed_at: T0 - DAY }), plan, now: T0 });
  assert.equal(find(r, 'update_subscription').status, 'active');
  assert.ok(find(r, 'clear_failure_state'));
  assert.ok(find(r, 'sync_roles'));
});

test('the 6% fee is recorded for an SML-originated subscription', () => {
  const r = L.handleEvent(evt('invoice.paid', { id: 'in_1', subscription: 'sub_123', amount_paid: 9999, currency: 'usd' }),
    { subscription: sub(), plan, now: T0 });
  const fee = find(r, 'record_fee');
  assert.equal(fee.gross_cents, 9999);
  assert.equal(fee.fee_cents, 600, '6% of 9999 rounds to 600');
  assert.equal(fee.fee_bps, 600);
  assert.ok(fee.consent_ref, 'the fee must cite its consent');
});

/* The commercial rule, at the code layer as well as the database layer. */
test('NO fee is recorded for an imported Discord subscription', () => {
  const r = L.handleEvent(evt('invoice.paid', { id: 'in_2', subscription: 'sub_ext', amount_paid: 9999 }),
    { subscription: sub({ origin: 'discord_imported', platform_fee_bps: null, fee_consent_at: null }), plan, now: T0 });
  assert.equal(find(r, 'record_fee'), undefined, 'a fee on imported revenue would misstate income');
});

test('no fee is recorded on a zero-amount invoice', () => {
  const r = L.handleEvent(evt('invoice.paid', { id: 'in_3', subscription: 'sub_123', amount_paid: 0 }),
    { subscription: sub(), plan, now: T0 });
  assert.equal(find(r, 'record_fee'), undefined);
});

/* ---------- webhook: cancellation ---------- */

test('cancellation ends access immediately and queues a role sync', () => {
  const r = L.handleEvent(evt('customer.subscription.deleted', { id: 'sub_123' }),
    { subscription: sub(), plan, now: T0 });
  const u = find(r, 'update_subscription');
  assert.equal(u.status, 'canceled');
  assert.equal(u.access_until, T0);
  assert.ok(find(r, 'sync_roles'));
});

/* ---------- reconciler ---------- */

const planGrantsById = { 5: [
  { target: 'sml_group_role', role_ref: '5' },
  { target: 'discord_guild_role', role_ref: '900000000000000001' }
] };

const healthyGuild = { active: true, bot_has_manage_roles: true, bot_highest_role_position: 10 };
const linked = new Set([100]);

test('an active member with no roles yet gets both granted', () => {
  const r = L.reconcile({ subs: [sub()], planGrantsById, actualBySub: {},
    guild: healthyGuild, rolePositions: { '900000000000000001': 5 }, identities: linked, now: T0 });
  assert.equal(r.toGrant.length, 2);
  assert.equal(r.blocked.length, 0);
});

test('an expired member has both roles revoked', () => {
  const s = sub({ status: 'grace', access_until: T0 - DAY });
  const r = L.reconcile({ subs: [s], planGrantsById,
    actualBySub: { 1: [
      { target: 'sml_group_role', role_ref: '5', state: 'granted' },
      { target: 'discord_guild_role', role_ref: '900000000000000001', state: 'granted' }
    ] },
    guild: healthyGuild, identities: linked, now: T0 });
  assert.equal(r.toRevoke.length, 2);
  assert.equal(r.toGrant.length, 0);
  assert.match(r.toRevoke[0].reason, /access ended/);
});

test('a member inside grace keeps their roles', () => {
  const s = sub({ status: 'grace', access_until: T0 + DAY });
  const r = L.reconcile({ subs: [s], planGrantsById,
    actualBySub: { 1: [{ target: 'sml_group_role', role_ref: '5', state: 'granted' }] },
    guild: healthyGuild, identities: linked, now: T0 });
  assert.equal(r.toRevoke.length, 0, 'grace period was not honoured');
});

test('nothing is emitted when desired and actual already agree', () => {
  const r = L.reconcile({ subs: [sub()], planGrantsById,
    actualBySub: { 1: [
      { target: 'sml_group_role', role_ref: '5', state: 'granted' },
      { target: 'discord_guild_role', role_ref: '900000000000000001', state: 'granted' }
    ] },
    guild: healthyGuild, identities: linked, now: T0 });
  assert.equal(r.toGrant.length + r.toRevoke.length, 0);
});

/* ---------- Discord constraints: partial success must work ---------- */

test('an unlinked Discord account still gets the native role', () => {
  const r = L.reconcile({ subs: [sub()], planGrantsById, actualBySub: {},
    guild: healthyGuild, identities: new Set(), now: T0 });
  assert.equal(r.toGrant.length, 1);
  assert.equal(r.toGrant[0].target, 'sml_group_role');
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reason, /has not linked Discord/);
});

test('a role above the bot is blocked with an actionable reason', () => {
  const r = L.reconcile({ subs: [sub()], planGrantsById, actualBySub: {},
    guild: healthyGuild, rolePositions: { '900000000000000001': 15 }, identities: linked, now: T0 });
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reason, /not below the bot/);
  assert.equal(r.toGrant.length, 1, 'the native half should still proceed');
});

test('a bot without MANAGE_ROLES blocks only the Discord half', () => {
  const r = L.reconcile({ subs: [sub()], planGrantsById, actualBySub: {},
    guild: { active: true, bot_has_manage_roles: false }, identities: linked, now: T0 });
  assert.equal(r.toGrant.length, 1);
  assert.match(r.blocked[0].reason, /MANAGE_ROLES/);
});

test('revokes are never blocked by Discord health', () => {
  /* losing access late is recoverable; keeping it wrongly is not */
  const s = sub({ status: 'canceled', access_until: T0 - DAY });
  const r = L.reconcile({ subs: [s], planGrantsById,
    actualBySub: { 1: [{ target: 'discord_guild_role', role_ref: '900000000000000001', state: 'granted' }] },
    guild: null, identities: new Set(), now: T0 });
  assert.equal(r.toRevoke.length, 1, 'a broken guild link must not strand a paid role');
});

/* ---------- grace sweep ---------- */

test('expiredGrace finds only members whose window has actually closed', () => {
  const rows = [
    sub({ id: 1, status: 'grace', failed_payment_count: 3, access_until: T0 - 1 }),
    sub({ id: 2, status: 'grace', failed_payment_count: 3, access_until: T0 + DAY }),
    sub({ id: 4, status: 'grace', failed_payment_count: 2, access_until: T0 - DAY }),
    sub({ id: 3, status: 'active', access_until: null })
  ];
  const out = L.expiredGrace(rows, T0).map((s) => s.id);
  assert.deepEqual(out, [1]);
});

test('a migrated subscription requests external cancellation at the old renewal date', () => {
  const migrated = sub({ id: 22, origin: 'migrated', migration_from_subscription_id: 11,
    migration_external_platform: 'upgrade_chat', migration_external_reference: 'ext_1',
    migration_external_renewal_at: new Date(T0 + DAY).toISOString() });
  const r = L.handleEvent(evt('customer.subscription.created', {
    id: 'sub_123', status: 'trialing', current_period_end: (T0 + DAY) / 1000
  }), { subscription: migrated, plan, now: T0 });
  const cancel = r.intents.find((i) => i.type === 'cancel_external_subscription');
  assert.equal(cancel.imported_subscription_id, 11);
  assert.equal(cancel.external_platform, 'upgrade_chat');
});

test('first migrated payment supersedes the imported row without changing roles twice', () => {
  const migrated = sub({ id: 22, origin: 'migrated', migration_from_subscription_id: 11,
    platform_fee_bps: 600, fee_consent_at: new Date(T0 - 1000).toISOString() });
  const r = L.handleEvent(evt('invoice.paid', {
    id: 'in_1', subscription: 'sub_123', amount_paid: 1000, currency: 'usd'
  }), { subscription: migrated, plan, now: T0 });
  const supersede = r.intents.find((i) => i.type === 'supersede_imported');
  assert.deepEqual(supersede, { type: 'supersede_imported', imported_subscription_id: 11, new_subscription_id: 22 });
  assert.equal(r.intents.filter((i) => i.type === 'sync_roles').length, 1);
});

/* ---------- determinism ---------- */

test('reconcile is deterministic', () => {
  const args = { subs: [sub()], planGrantsById, actualBySub: {}, guild: healthyGuild, identities: linked, now: T0 };
  assert.deepEqual(L.reconcile(args), L.reconcile(args));
});
