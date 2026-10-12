'use strict';

/* @mentions for the Academy live chat.
 *
 * Who can be tagged: a member who has used the Academy app — every successful sign-in to the
 * Activity records (touch) the member's Discord display name and the time in academy_students, the
 * enrolment table, and only members seen within ACTIVE_DAYS are offered by the picker (search) or
 * accepted on a message (resolve). A member whose access lapsed stops signing in and so drops out
 * of the picker on their own; hasAccess, when given, is the live check at post time.
 *
 * Notification: the tagged member gets a Discord DM from the Academy bot (notify), whether or not
 * they are in the app. Spam is bounded per sender→recipient (cooldownMs) and per recipient per hour
 * (maxPerHour). The DM never pings (the DM client sends allowed_mentions: none).
 *
 * Memory fallback (no pool) keeps local runs and tests working. */

const { CHANNELS } = require('./academy-chat');

const ACTIVE_DAYS = 45;
const CHANNEL_LABELS = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label]));
const ID_RE = /^\d{15,24}$/;
const cleanName = (v) => String(v || '').replace(/[\u0000-\u001f<>@]/g, '').trim().slice(0, 80);
const likeEscape = (v) => String(v).replace(/[\\%_]/g, (c) => '\\' + c);

function createMentionService({ pool = null, guildId = '', dm = null, hasAccess = null, logger = () => {}, now = Date.now, cooldownMs = 120_000, maxPerHour = 12, channelLabels = CHANNEL_LABELS, appName = 'Academy' } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const guild = String(guildId || '').trim();
  const configured = !!guild;
  const mem = new Map(); // discordId -> { name, seenAt }
  const activeSince = () => now() - ACTIVE_DAYS * 86_400_000;

  /* Records that this member signed in to the app just now, with the name other members tag them by. */
  async function touch({ userId, displayName } = {}) {
    const id = String(userId || ''), name = cleanName(displayName);
    if (!configured || !ID_RE.test(id)) return false;
    if (db) {
      await db.query(`INSERT INTO academy_students (guild_id, discord_id, display_name, last_seen_at) VALUES ($1,$2,$3,now())
        ON CONFLICT (guild_id, discord_id) DO UPDATE SET last_seen_at=now(),
        display_name=CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name ELSE academy_students.display_name END`, [guild, id, name]);
      return true;
    }
    const prev = mem.get(id) || { name: '' };
    mem.set(id, { name: name || prev.name, seenAt: now() });
    return true;
  }

  /* Members matching a typed fragment (substring of the display name, prefix matches first, most recently seen first). */
  async function search(query, { limit = 8, exclude = '' } = {}) {
    if (!configured) return [];
    const q = cleanName(query).toLowerCase().slice(0, 40), n = Math.max(1, Math.min(20, Number(limit) || 8));
    if (db) {
      const rows = (await db.query(`SELECT discord_id, display_name FROM academy_students
        WHERE guild_id=$1 AND display_name <> '' AND last_seen_at IS NOT NULL AND last_seen_at > to_timestamp($2::double precision) AND discord_id <> $5
          AND lower(display_name) LIKE $3 ESCAPE '\\'
        ORDER BY (lower(display_name) LIKE $4 ESCAPE '\\') DESC, last_seen_at DESC LIMIT $6`,
      [guild, activeSince() / 1000, '%' + likeEscape(q) + '%', likeEscape(q) + '%', String(exclude || ''), n])).rows;
      return rows.map((r) => ({ id: String(r.discord_id), name: String(r.display_name) }));
    }
    const since = activeSince();
    return [...mem.entries()].filter(([id, m]) => m.name && m.seenAt > since && id !== String(exclude || '') && m.name.toLowerCase().includes(q))
      .sort((a, b) => (Number(b[1].name.toLowerCase().startsWith(q)) - Number(a[1].name.toLowerCase().startsWith(q))) || (b[1].seenAt - a[1].seenAt))
      .slice(0, n).map(([id, m]) => ({ id, name: m.name }));
  }

  /* The subset of ids that may be tagged right now, with their names: known, recently seen, and (when a live check is wired) still with access. */
  async function resolve(ids) {
    const want = [...new Set((Array.isArray(ids) ? ids : []).map((v) => String(v || '')).filter((v) => ID_RE.test(v)))].slice(0, 10);
    if (!configured || !want.length) return [];
    let found;
    if (db) {
      const rows = (await db.query(`SELECT discord_id, display_name FROM academy_students WHERE guild_id=$1 AND discord_id = ANY($2)
        AND display_name <> '' AND last_seen_at IS NOT NULL AND last_seen_at > to_timestamp($3::double precision)`, [guild, want, activeSince() / 1000])).rows;
      found = rows.map((r) => ({ id: String(r.discord_id), name: String(r.display_name) }));
    } else {
      const since = activeSince();
      found = want.filter((id) => mem.has(id) && mem.get(id).name && mem.get(id).seenAt > since).map((id) => ({ id, name: mem.get(id).name }));
    }
    if (typeof hasAccess !== 'function') return found;
    const checks = await Promise.all(found.map((m) => Promise.resolve().then(() => hasAccess(m.id)).catch(() => true)));
    return found.filter((_, i) => checks[i] !== false);
  }

  const pairLast = new Map(); // "sender>recipient" -> last DM time
  const perRecipient = new Map(); // recipient -> [times within the hour]
  function allowed(sender, recipient) {
    const t = now(), key = sender + '>' + recipient;
    if (pairLast.has(key) && t - pairLast.get(key) < cooldownMs) return false;
    const list = (perRecipient.get(recipient) || []).filter((x) => t - x < 3_600_000);
    if (list.length >= maxPerHour) return false;
    list.push(t); perRecipient.set(recipient, list); pairLast.set(key, t);
    if (pairLast.size > 20_000) pairLast.delete(pairLast.keys().next().value);
    return true;
  }
  /* DMs every tagged member (never the sender) about the message. Returns { sent, skipped } ids; never throws. */
  async function notify({ sender = {}, mentions = [], message = {}, channel = '' } = {}) {
    const out = { sent: [], skipped: [] };
    if (!dm || typeof dm.send !== 'function') return out;
    const senderId = String(sender.userId || ''), senderName = cleanName(sender.displayName) || 'A member';
    const room = channelLabels[channel] || channel || 'chat';
    const body = String(message.body || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const text = `**${senderName}** tagged you in the ${appName} live chat (${room}):\n> ${body || '(no text)'}\nOpen the ${appName} app in Discord to reply.`;
    for (const m of mentions) {
      const id = String(m && m.id || '');
      if (!ID_RE.test(id) || id === senderId || !allowed(senderId, id)) { if (id) out.skipped.push(id); continue; }
      try {
        const res = await dm.send(id, text);
        if (res && res.ok) out.sent.push(id); else { out.skipped.push(id); logger('warn', 'academy_chat_mention_dm_failed', { recipient: id, code: res && res.code }); }
      } catch (error) { out.skipped.push(id); logger('warn', 'academy_chat_mention_dm_failed', { recipient: id, error: String(error && error.message || error) }); }
    }
    if (out.sent.length) logger('info', 'academy_chat_mention_dm', { sender: senderId, channel, sent: out.sent.length, messageId: message.id == null ? null : String(message.id) });
    return out;
  }

  return { configured, touch, search, resolve, notify };
}

module.exports = { createMentionService, ACTIVE_DAYS };
