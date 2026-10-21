'use strict';

/* PERSONA BOTS: an analyst's own Discord bot, so the alerts the Academy posts into THEIR server carry their bot's name and picture
 * instead of the StockMarketLoop Connect bot's. Click-to-Alert already knows how to post through a per-member bot (its `personas`
 * map); this registry fills that map from a durable store instead of only from SML_OBI_BOT_TOKEN, and lets a member register,
 * check and remove their bot from inside the Academy.
 *
 *   - the token is validated against Discord first (/users/@me must answer as a bot) and is stored AES-256-GCM encrypted
 *     (academy_state_kv under persona-bots); it is never returned to the page, only the bot's id, name and avatar are
 *   - status() says which servers the bot shares with the member and whether it can post and attach files in a channel, so the
 *     setup card can say "invite it here with these permissions" before the first alert
 *   - the owners' bot from SML_OBI_BOT_TOKEN stays exactly as before and cannot be removed from the page
 *   - with no persona the member's alerts go out through the shared bots (SML Connect), which must be in their server */

const crypto = require('node:crypto');

const SNOWFLAKE = /^\d{15,25}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$/;
const BLOB_VERSION = 1;
/* the permissions an analyst's bot needs in their server: View Channel, Send Messages, Embed Links, Attach Files, Read Message History,
   Create Public Threads, Send Messages in Threads, Mention Everyone */
const INVITE_PERMISSIONS = (1 << 10) | (1 << 11) | (1 << 14) | (1 << 15) | (1 << 16) | (1 << 17) | 2 ** 35 | 2 ** 38;

function cipherFrom(key) {
  const material = String(key || '').trim();
  if (material.length < 32) return null;
  const encKey = crypto.createHash('sha256').update(material, 'utf8').digest();
  return {
    encrypt(text) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', encKey, iv); const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]); return Buffer.concat([Buffer.from([BLOB_VERSION]), iv, c.getAuthTag(), ct]).toString('base64'); },
    decrypt(b64) { const blob = Buffer.from(String(b64 || ''), 'base64'); if (blob.length < 30 || blob[0] !== BLOB_VERSION) throw new TypeError('invalid persona blob'); const d = crypto.createDecipheriv('aes-256-gcm', encKey, blob.subarray(1, 13)); d.setAuthTag(blob.subarray(13, 29)); return Buffer.concat([d.update(blob.subarray(29)), d.final()]).toString('utf8'); }
  };
}

const inviteUrl = (appId) => (SNOWFLAKE.test(String(appId || '')) ? 'https://discord.com/oauth2/authorize?client_id=' + appId + '&scope=bot&permissions=' + String(INVITE_PERMISSIONS) : '');
const avatarUrl = (id, hash) => (hash ? 'https://cdn.discordapp.com/avatars/' + id + '/' + hash + (String(hash).startsWith('a_') ? '.gif' : '.png') + '?size=128' : '');

/* createPersonaBots({ store, encryptionKey, createDirectory, ownerIds, ownerToken, fetchImpl, now, logger })
 *   .map                      the { discordUserId: directory } object Click-to-Alert reads (kept up to date in place)
 *   .load()                   decrypt every stored token and build its directory (boot)
 *   .set(userId, token)       validate on Discord, store encrypted, build the directory -> { ok, bot } | { ok:false, code }
 *   .remove(userId)           forget the member's bot (never an owner's env bot)
 *   .status(userId, guildId?) { configured, available, bot, own, guilds:[{id,name}], inviteUrl, posting? } */
function createPersonaBots({ store = null, encryptionKey = '', createDirectory, ownerIds = [], ownerToken = '', fetchImpl = globalThis.fetch, now = Date.now, logger = () => {} } = {}) {
  const map = {};
  const meta = new Map(); // userId -> { botId, username, avatar, at, own: 'owner'|'member' }
  const cipher = cipherFrom(encryptionKey);
  const owners = new Set((ownerIds || []).map(String));
  let state = null;

  if (ownerToken && typeof createDirectory === 'function') for (const id of owners) { map[id] = createDirectory({ label: 'persona', token: ownerToken }); meta.set(id, { botId: '', username: 'Grandmaster-Obi bot', avatar: '', at: 0, own: 'owner' }); }

  async function load() {
    if (!store || !cipher) return { ok: false, code: !cipher ? 'no_encryption_key' : 'no_store' };
    try { state = (await store.read()) || null; } catch (_) { state = null; }
    if (!state || typeof state !== 'object') state = { users: {} };
    if (!state.users || typeof state.users !== 'object') state.users = {};
    let n = 0;
    for (const [userId, row] of Object.entries(state.users)) {
      if (owners.has(userId) && map[userId]) continue; // the env bot wins for an owner
      try { const token = cipher.decrypt(row.token); map[userId] = createDirectory({ label: 'persona:' + userId, token }); meta.set(userId, { botId: String(row.botId || ''), username: String(row.username || ''), avatar: String(row.avatar || ''), at: Number(row.at) || 0, own: 'member' }); n++; }
      catch (error) { logger('warn', 'persona_bot_load_failed', { userId, error: String(error && error.message || error) }); }
    }
    return { ok: true, loaded: n };
  }
  async function save() { if (!store || !state) return; try { await store.write(state); } catch (error) { logger('warn', 'persona_bot_save_failed', { error: String(error && error.message || error) }); } }

  /* the token must belong to a bot user; Discord answers /users/@me for it */
  async function identify(token) {
    const res = await fetchImpl('https://discord.com/api/v10/users/@me', { headers: { authorization: 'Bot ' + token }, signal: AbortSignal.timeout(8000) });
    if (res.status === 401) return { ok: false, code: 'token_rejected' };
    if (!res.ok) return { ok: false, code: 'discord_' + res.status };
    const me = await res.json().catch(() => null);
    if (!me || !me.id) return { ok: false, code: 'token_rejected' };
    if (!me.bot) return { ok: false, code: 'not_a_bot' };
    return { ok: true, bot: { id: String(me.id), username: String(me.username || ''), avatar: avatarUrl(String(me.id), me.avatar) } };
  }

  async function set(userId, rawToken) {
    userId = String(userId || '');
    if (!SNOWFLAKE.test(userId)) return { ok: false, status: 400, code: 'invalid_user' };
    if (!cipher) return { ok: false, status: 503, code: 'no_encryption_key', detail: 'The server has no SML_PERSONA_ENCRYPTION_KEY, so bot tokens cannot be stored. Ask the owner.' };
    if (!store) return { ok: false, status: 503, code: 'no_store' };
    const token = String(rawToken || '').trim().replace(/^Bot\s+/i, '');
    if (!TOKEN_RE.test(token)) return { ok: false, status: 400, code: 'invalid_token', detail: 'That does not look like a Discord bot token. Copy it from the Bot page of your application in the Discord Developer Portal.' };
    let id;
    try { id = await identify(token); } catch (error) { return { ok: false, status: 503, code: 'discord_unreachable', detail: String(error && error.message || error) }; }
    if (!id.ok) return { ok: false, status: id.code === 'token_rejected' || id.code === 'not_a_bot' ? 400 : 503, code: id.code, detail: id.code === 'not_a_bot' ? 'That token belongs to a user account, not a bot.' : id.code === 'token_rejected' ? 'Discord rejected that token. Reset it in the Developer Portal and paste the new one.' : 'Discord did not answer.' };
    if (!state) await load();
    state.users[userId] = { token: cipher.encrypt(token), botId: id.bot.id, username: id.bot.username, avatar: id.bot.avatar, at: now() };
    await save();
    map[userId] = createDirectory({ label: 'persona:' + userId, token });
    meta.set(userId, { ...id.bot, botId: id.bot.id, at: state.users[userId].at, own: 'member' });
    logger('info', 'persona_bot_set', { userId, botId: id.bot.id });
    return { ok: true, bot: id.bot, inviteUrl: inviteUrl(id.bot.id) };
  }

  async function remove(userId) {
    userId = String(userId || '');
    const m = meta.get(userId);
    if (!m) return { ok: false, status: 404, code: 'no_persona' };
    if (m.own === 'owner') return { ok: false, status: 403, code: 'owner_bot_fixed', detail: 'The owner bot is set on the server, not here.' };
    if (!state) await load();
    delete state.users[userId]; await save();
    delete map[userId]; meta.delete(userId);
    return { ok: true };
  }

  /* what the setup card shows: the bot, the servers it shares with the member, and (for one channel) whether it can post there */
  async function status(userId, { guildId = '', channelId = '' } = {}) {
    userId = String(userId || '');
    const m = meta.get(userId), dir = map[userId] || null;
    const out = { configured: !!cipher && !!store, available: !!dir, own: m ? m.own : null, bot: m ? { id: m.botId, username: m.username, avatar: m.avatar, since: m.at } : null, permissions: String(INVITE_PERMISSIONS), inviteUrl: m && m.botId ? inviteUrl(m.botId) : '', guilds: [], posting: null };
    if (!dir) return out;
    try { out.guilds = (await dir.guildsFor(userId, SNOWFLAKE.test(String(guildId)) ? String(guildId) : '')) || []; } catch (_) { out.guilds = []; }
    if (SNOWFLAKE.test(String(channelId))) { try { out.posting = await dir.postingIn(userId, String(channelId)); } catch (_) { out.posting = null; } }
    return out;
  }

  return { map, load, set, remove, status, INVITE_PERMISSIONS, inviteUrl };
}

module.exports = { createPersonaBots, cipherFrom, inviteUrl, INVITE_PERMISSIONS, TOKEN_RE };
