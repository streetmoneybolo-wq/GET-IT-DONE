'use strict';

/* Academy seats: a Discord server owner pays per seat, per month, and hands those seats to the
 * members they choose.
 *
 * Why this is not a Discord Guild Subscription: Discord lets an app sell user subscriptions OR
 * guild subscriptions, never both, and the Academy already sells Trader and Analyst as user
 * subscriptions. A guild subscription also covers every member of a server with no way to pick a
 * subset, which is the opposite of what this is for. So seats are sold through Stripe and granted
 * here.
 *
 * A seat grants the TRADER level: the full market-reading desk. It deliberately does not grant the
 * Analyst publishing side (the Article Desk, Click-to-Alert into your own server, charging others
 * for your alert channels), so a bulk buyer cannot hand out the top tier and members still have a
 * reason to buy Analyst themselves.
 *
 * How a seat actually grants access: by writing an ordinary Academy pass against the member's
 * Discord id, the same object the 15-day trial writes. academy-passes.js withPasses already admits
 * a pass holder at the trader tier, and academyTierLive already reads it, so nothing new had to be
 * taught about access. A pass carries its own expiry, so if this service stops running or billing
 * stops renewing, every seat lapses on its own rather than staying open.
 *
 * The pass store keeps one pass per ref and refuses a duplicate, so a renewal cannot reuse a ref:
 * each pass is `seat:<ownerId>:<memberId>:<periodEnd>`. The live ref is kept on the assignment, so a
 * release ends exactly the right pass and re-issuing within one period is idempotent.
 *
 * State lives in one JSON document (academy_state_kv key `academy-seats` in production):
 *   { subs: { <ownerId>: { seats, periodEnd, status, assigned: { <memberId>: { at, ref } } } } }
 */

const SNOWFLAKE = /^\d{15,25}$/;
const MAX_SEATS = 1000;

const isId = (v) => SNOWFLAKE.test(String(v == null ? '' : v).trim());
const id = (v) => String(v == null ? '' : v).trim();
const refFor = (ownerId, memberId, periodEnd = null) => `seat:${ownerId}:${memberId}:${periodEnd || 'open'}`;
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

function createSeats({ store = null, passes = null, now = () => Date.now(), logger = () => {} } = {}) {
  const configured = Boolean(passes && typeof passes.add === 'function');
  let state = null;

  async function load() {
    if (state) return state;
    try { state = (store && await store.read()) || null; } catch (_) { state = null; }
    if (!state || typeof state !== 'object' || !state.subs || typeof state.subs !== 'object') state = { subs: {} };
    return state;
  }
  async function save() {
    if (!store) return;
    try { await store.write(state); }
    catch (error) { logger('warn', 'academy_seats_save_failed', { error: String((error && error.message) || error) }); }
  }

  const live = (sub) => Boolean(sub && sub.status === 'active' && (!sub.periodEnd || Date.parse(sub.periodEnd) > now()));
  const used = (sub) => Object.keys((sub && sub.assigned) || {}).length;

  function view(ownerId, sub) {
    return {
      ownerId,
      seats: Number(sub && sub.seats) || 0,
      used: used(sub),
      free: Math.max(0, (Number(sub && sub.seats) || 0) - used(sub)),
      periodEnd: (sub && sub.periodEnd) || null,
      status: (sub && sub.status) || 'none',
      live: live(sub),
      members: Object.entries((sub && sub.assigned) || {})
        .map(([memberId, row]) => ({ memberId, at: row && row.at ? row.at : null }))
        .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
    };
  }

  /* Billing tells us what the owner is paying for. Called on checkout, renewal and cancellation. */
  async function setSubscription(ownerId, { seats, periodEnd = null, status = 'active' } = {}) {
    const owner = id(ownerId);
    if (!isId(owner)) return { ok: false, status: 400, code: 'invalid_owner' };
    const count = Number(seats);
    if (!Number.isInteger(count) || count < 0 || count > MAX_SEATS) return { ok: false, status: 400, code: 'invalid_seats' };
    await load();
    const sub = state.subs[owner] || { seats: 0, periodEnd: null, status: 'active', assigned: {} };
    sub.seats = count;
    sub.periodEnd = periodEnd ? iso(periodEnd) : null;
    sub.status = status === 'active' ? 'active' : 'ended';
    state.subs[owner] = sub;

    /* Fewer seats than members, or a subscription that has ended: release the newest assignments
       first, so the members who have had a seat longest keep theirs. */
    const over = sub.status === 'active' ? Math.max(0, used(sub) - sub.seats) : used(sub);
    const dropped = [];
    if (over > 0) {
      const newest = Object.entries(sub.assigned)
        .sort((a, b) => String(b[1] && b[1].at || '').localeCompare(String(a[1] && a[1].at || '')))
        .slice(0, over);
      for (const [memberId] of newest) { await revoke(owner, memberId, sub); dropped.push(memberId); }
    }
    /* A renewal moves every seat's expiry out to the new period end. */
    if (sub.status === 'active') for (const memberId of Object.keys(sub.assigned)) await issue(owner, memberId, sub);
    await save();
    return { ok: true, ...view(owner, sub), dropped };
  }

  async function issue(ownerId, memberId, sub) {
    if (!configured) return;
    const row = sub.assigned[memberId] || (sub.assigned[memberId] = { at: new Date(now()).toISOString(), ref: null });
    const expiresAt = sub.periodEnd || new Date(now() + 31 * 86_400_000).toISOString();
    const ref = refFor(ownerId, memberId, sub.periodEnd);
    /* already holding this period's pass: nothing to do (re-issuing is idempotent) */
    if (row.ref === ref) return;
    try {
      /* a renewal ends last period's pass and opens one for the new period, because the store
         keeps one pass per ref and refuses a duplicate */
      if (row.ref && passes.markRefunded) await passes.markRefunded(row.ref);
      await passes.add({
        discordId: memberId, plan: 'seat', amount: 0, ref, product: 'academy',
        startsAt: new Date(now()).toISOString(), expiresAt
      });
      row.ref = ref;
    } catch (error) {
      logger('warn', 'academy_seat_grant_failed', { error: String((error && error.message) || error), ownerId, memberId });
    }
  }

  async function revoke(ownerId, memberId, sub) {
    const row = sub && sub.assigned ? sub.assigned[memberId] : null;
    if (sub && sub.assigned) delete sub.assigned[memberId];
    if (!configured || !passes.markRefunded) return;
    /* end the pass this seat actually issued; an older period's ref is already spent */
    const ref = (row && row.ref) || refFor(ownerId, memberId, sub && sub.periodEnd);
    try { await passes.markRefunded(ref); }
    catch (error) { logger('warn', 'academy_seat_revoke_failed', { error: String((error && error.message) || error), ownerId, memberId }); }
  }

  async function assign(ownerId, memberId) {
    const owner = id(ownerId), member = id(memberId);
    if (!isId(owner)) return { ok: false, status: 400, code: 'invalid_owner' };
    if (!isId(member)) return { ok: false, status: 400, code: 'invalid_member' };
    await load();
    const sub = state.subs[owner];
    if (!live(sub)) return { ok: false, status: 403, code: 'no_active_subscription' };
    if (sub.assigned[member]) return { ok: true, already: true, ...view(owner, sub) };
    if (used(sub) >= sub.seats) return { ok: false, status: 409, code: 'no_seats_free', ...view(owner, sub) };
    sub.assigned[member] = { at: new Date(now()).toISOString(), ref: null };
    await issue(owner, member, sub);
    await save();
    return { ok: true, assigned: member, ...view(owner, sub) };
  }

  async function release(ownerId, memberId) {
    const owner = id(ownerId), member = id(memberId);
    if (!isId(owner) || !isId(member)) return { ok: false, status: 400, code: 'invalid_member' };
    await load();
    const sub = state.subs[owner];
    if (!sub) return { ok: false, status: 404, code: 'no_subscription' };
    if (!sub.assigned[member]) return { ok: true, already: true, ...view(owner, sub) };
    await revoke(owner, member, sub);
    await save();
    return { ok: true, released: member, ...view(owner, sub) };
  }

  async function get(ownerId) {
    const owner = id(ownerId);
    if (!isId(owner)) return { ok: false, status: 400, code: 'invalid_owner' };
    await load();
    return { ok: true, ...view(owner, state.subs[owner]) };
  }

  /* Is this member sitting in someone's seat? Used for reporting; access itself comes from the pass. */
  async function seatOf(memberId) {
    const member = id(memberId);
    if (!isId(member)) return null;
    await load();
    for (const [ownerId, sub] of Object.entries(state.subs)) {
      if (live(sub) && sub.assigned && sub.assigned[member]) return { ownerId, at: sub.assigned[member].at };
    }
    return null;
  }

  return Object.freeze({ configured, setSubscription, assign, release, get, seatOf, MAX_SEATS });
}

module.exports = { createSeats, refFor, MAX_SEATS };
