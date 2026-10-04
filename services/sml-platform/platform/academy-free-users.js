'use strict';

/* People who get every Academy feature free (the owner). Their Discord id is checked from the signed-in Discord account, so it cannot be claimed by anyone else.
   Defaults to the owner (Grandmaster-Obi); SML_ACADEMY_FREE_USER_IDS adds more, comma separated. */

const OWNER_IDS = Object.freeze(['1087769175453339648']);
const SNOWFLAKE = /^\d{15,25}$/;

function freeUserIds(env = process.env) {
  const extra = String(env.SML_ACADEMY_FREE_USER_IDS || '').split(',').map((v) => v.trim()).filter((v) => SNOWFLAKE.test(v));
  return new Set([...OWNER_IDS, ...extra]);
}

/* Wraps the Academy access check: a free user is let in at the top ('member') tier whatever roles they hold, even outside the Academy server.
   `identity` proves who the Discord account is when the role check cannot say (e.g. the person is not in the server). */
function withFreeUsers(base, ids, identity = null) {
  const free = ids instanceof Set ? ids : new Set(ids || []);
  return {
    async verify(authorization) {
      const r = await base.verify(authorization);
      if (r.ok) return r.userId && free.has(String(r.userId)) && r.tier !== 'member' ? { ...r, tier: 'member' } : r;
      let id = r.userId ? String(r.userId) : '';
      if (!id && identity && typeof identity.verify === 'function') {
        try { const who = await identity.verify(authorization); if (who && who.ok) id = String(who.userId || ''); } catch (_) { /* the refusal stands */ }
      }
      return id && free.has(id) ? { ok: true, userId: id, tier: 'member' } : r;
    }
  };
}

module.exports = { OWNER_IDS, freeUserIds, withFreeUsers };
