'use strict';

/* =============================================================================
 * MEM Academy billing: one-time hand-off codes (Activity / hub -> web).
 *
 * A bearer token must never travel in a URL (browser history, screen shares,
 * request logs). So a Discord-verified surface (the Activity token exchange on
 * sml-platform-api, or an Ed25519-verified hub click on this service) stores a
 * random code server side:
 *
 *   academy_billing_handoffs(code_sha256, discord_user_id, guild_id, source,
 *                            purpose='buy', expires_at = now()+5 min, used_at)
 *
 * and links to /v1/academy/billing/start?h=<code>. /start redeems it ONCE
 * (UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING), sets
 * the purpose=buy bind cookie and 303s to /buy, so the code leaves the address
 * bar immediately. A used, expired or unknown code is worthless. Only the
 * sha256 of the code is stored.
 *
 * Both services share the database, so the API can call issueHandoff() with
 * its own pool; nothing else of the engine is needed there.
 * ========================================================================== */

const crypto = require('node:crypto');

const SNOWFLAKE = /^[0-9]{15,24}$/;
const SOURCES = Object.freeze(['activity', 'hub']);
const CODE_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function startUrl(publicUrl, code) {
  return `${String(publicUrl || '').replace(/\/+$/, '')}/v1/academy/billing/start?h=${encodeURIComponent(code)}`;
}

async function issueHandoff(pool, { discordUserId, guildId, source, publicUrl, randomBytes = crypto.randomBytes } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('issueHandoff: pool required');
  if (!SNOWFLAKE.test(String(discordUserId))) throw new TypeError('issueHandoff: discordUserId must be a snowflake');
  if (!SNOWFLAKE.test(String(guildId))) throw new TypeError('issueHandoff: guildId must be a snowflake');
  if (!SOURCES.includes(source)) throw new TypeError('issueHandoff: source must be activity|hub');
  if (!/^https:\/\//.test(String(publicUrl || ''))) throw new TypeError('issueHandoff: https publicUrl required');
  const code = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO academy_billing_handoffs (code_sha256, discord_user_id, guild_id, source, purpose, expires_at)
     VALUES ($1, $2, $3, $4, 'buy', now() + interval '5 minutes')`,
    [hashCode(code), String(discordUserId), String(guildId), source]
  );
  return { code, url: startUrl(publicUrl, code) };
}

/** Single use: returns the identity once, then null forever. */
async function redeemHandoff(pool, code) {
  if (!CODE_PATTERN.test(String(code || ''))) return null;
  const result = await pool.query(
    `UPDATE academy_billing_handoffs
        SET used_at = now()
      WHERE code_sha256 = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING discord_user_id, guild_id, source, purpose`,
    [hashCode(code)]
  );
  const row = result.rows && result.rows[0];
  if (!row) return null;
  return { userId: String(row.discord_user_id), guildId: String(row.guild_id), source: row.source, purpose: row.purpose };
}

async function pruneHandoffs(pool) {
  const result = await pool.query(
    "DELETE FROM academy_billing_handoffs WHERE expires_at < now() - interval '1 day'", []
  );
  return result.rowCount || 0;
}

module.exports = { issueHandoff, redeemHandoff, pruneHandoffs, hashCode, startUrl, SOURCES };
