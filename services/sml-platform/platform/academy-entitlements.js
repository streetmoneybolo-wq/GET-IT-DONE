'use strict';

/* Discord in-app purchases for the Academy.
 *
 * A member can buy Academy access inside the Activity through Discord's own checkout. Discord then
 * records an ENTITLEMENT for that user against one of our SKUs, and this module is what the server
 * believes about it.
 *
 * It deliberately does NOT trust the Embedded App SDK. Discord's own guidance is that a malicious
 * page can open its own RPC connection and answer as Discord, so `getEntitlements()` in the browser
 * is a hint, not proof. The Activity uses the SDK to open the purchase modal and to know when
 * something changed; access itself is decided here, from the app's own bot token against
 * GET /applications/{application.id}/entitlements.
 *
 * Shape of the answer (docs.discord.com/developers/resources/entitlement): an entitlement is current
 * when it is not deleted, not consumed, has started, and has not ended. A null `ends_at` means it
 * does not expire (a durable purchase, or a test-mode grant).
 *
 * Fails CLOSED. If Discord cannot be reached the member keeps whatever access their Discord role or
 * their Loop Bucks pass already gives them; an outage never invents an entitlement that was not sold.
 */

const API_ROOT = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{15,25}$/;
const MAX_CACHE = 5000;

/* "123, 456 789" -> ['123','456','789'], ignoring anything that is not a snowflake */
function parseSkuIds(raw) {
  const list = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/[\s,]+/);
  return Object.freeze([...new Set(list.map((id) => String(id || '').trim()).filter((id) => SNOWFLAKE.test(id)))]);
}

/* Is this entitlement good right now? A missing timestamp means "no bound", not "zero". */
function isActiveEntitlement(entitlement, nowMs) {
  if (!entitlement || typeof entitlement !== 'object') return false;
  if (entitlement.deleted === true || entitlement.consumed === true) return false;
  const starts = Date.parse(entitlement.starts_at || '');
  if (Number.isFinite(starts) && starts > nowMs) return false;
  const ends = Date.parse(entitlement.ends_at || '');
  if (Number.isFinite(ends) && ends <= nowMs) return false;
  return true;
}

function createEntitlements({
  appId = '', botToken = '', skuIds = [], fetchImpl = fetch,
  now = () => Date.now(), logger = () => {}, ttlMs = 60_000, timeoutMs = 6_000
} = {}) {
  const app = String(appId || '').trim();
  const token = String(botToken || '').trim();
  const skus = parseSkuIds(skuIds);
  const configured = SNOWFLAKE.test(app) && token.length >= 20 && skus.length > 0;
  /* userId -> { at, active }. Entitlements change rarely; a purchase calls forget() so the buyer
     never waits out the TTL. */
  const cache = new Map();

  function remember(userId, active) {
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(userId, { at: now(), active });
    return active;
  }

  /* Ask Discord for this member's live entitlements to our SKUs. Throws so hasActive can fail closed. */
  async function load(userId) {
    const url = `${API_ROOT}/applications/${encodeURIComponent(app)}/entitlements`
      + `?user_id=${encodeURIComponent(userId)}&sku_ids=${encodeURIComponent(skus.join(','))}`
      + '&exclude_ended=true&exclude_deleted=true&limit=100';
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const guard = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { authorization: `Bot ${token}`, accept: 'application/json' },
        signal: controller ? controller.signal : undefined
      });
    } finally { if (guard) clearTimeout(guard); }
    if (!response || !response.ok) {
      const status = response ? response.status : 0;
      throw Object.assign(new Error(`entitlements_http_${status}`), { status });
    }
    const body = await response.json();
    const rows = Array.isArray(body) ? body : (Array.isArray(body && body.entitlements) ? body.entitlements : []);
    const at = now();
    /* exclude_ended is a filter on Discord's side; re-check here so a changed default cannot let an
       expired entitlement through. */
    return rows.some((row) => skus.includes(String(row && row.sku_id)) && isActiveEntitlement(row, at));
  }

  async function hasActive(discordId) {
    const userId = String(discordId || '').trim();
    if (!configured || !SNOWFLAKE.test(userId)) return false;
    const seen = cache.get(userId);
    if (seen && now() - seen.at < ttlMs) return seen.active;
    try {
      return remember(userId, await load(userId));
    } catch (error) {
      logger('warn', 'academy_entitlements_lookup_failed', { error: String((error && error.message) || error), userId });
      /* Keep the last good answer if we have one; otherwise refuse. Never invent access. */
      return seen ? seen.active : false;
    }
  }

  /* Called right after a purchase so the next tier check asks Discord again instead of serving the
     cached "no". */
  function forget(discordId) {
    const userId = String(discordId || '').trim();
    if (userId) cache.delete(userId);
  }

  return Object.freeze({ configured, skus: () => skus, hasActive, forget });
}

/* Mirrors withPasses in academy-passes.js: a member with no Academy role who has bought through
   Discord gets in at tier 'academy'. The member's id comes from the base check's refusal. */
function withEntitlements(base, entitlements) {
  return {
    async verify(authorization) {
      const result = await base.verify(authorization);
      if (result.ok || result.code !== 'academy_role_required' || !result.userId) return result;
      if (!entitlements || typeof entitlements.hasActive !== 'function' || !entitlements.configured) return result;
      if (await entitlements.hasActive(result.userId)) return { ok: true, userId: result.userId, tier: 'academy' };
      return result;
    }
  };
}

module.exports = { createEntitlements, withEntitlements, parseSkuIds, isActiveEntitlement };
