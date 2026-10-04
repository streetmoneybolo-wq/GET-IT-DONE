'use strict';

/* Chat profile cards for the Academy: a member's Discord avatar and profile, and (when their Discord is linked to a verified stockmarketloop.com account) their
 * StockMarketLoop profile, channel and home group, with the links to follow them.
 *
 * Two sources, both read-only and public-fields-only:
 *   - Discord: the Academy bot looks the user up by id (avatar, name, banner colour). The avatar image itself is fetched here and handed to the page as bytes,
 *     because the Activity page may only load images from its own origin (its Content-Security-Policy says img-src 'self').
 *   - stockmarketloop.com: the signed LOOP-KICK bridge (loop-kick-bridge.js, route /discord-profile) returns the card only for a member whose Discord is
 *     linked and email-verified, and only public fields.
 * Following is done on stockmarketloop.com itself, where the member's own login is: the card links to the profile, channel and group pages. Discord has no way for
 * an app to send a friend request for someone, so "Add on Discord" opens their Discord profile, where the Add Friend button is. Nothing is posted or changed here. */

const SNOWFLAKE = /^\d{15,25}$/;
const CDN = 'https://cdn.discordapp.com';
const MAX_AVATAR_BYTES = 262_144;
const httpsUrl = (v) => { try { const u = new URL(String(v || '')); return u.protocol === 'https:' ? u.toString() : ''; } catch (_) { return ''; } };
const text = (v, max = 80) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

function createProfileService({ directory, bridge = null, fetchImpl = globalThis.fetch, now = Date.now, logger = () => {} } = {}) {
  const cards = new Map(), avatars = new Map();
  const fresh = (map, key, ms) => { const hit = map.get(key); return hit && now() - hit.at < ms ? hit.value : undefined; };
  const keep = (map, key, value, cap = 400) => { map.set(key, { at: now(), value }); if (map.size > cap) map.delete(map.keys().next().value); return value; };

  /* the card for one member */
  async function profile(userId) {
    const id = String(userId || '');
    if (!SNOWFLAKE.test(id)) return null;
    const hit = fresh(cards, id, 600_000); if (hit !== undefined) return hit;
    const [discord, site] = await Promise.all([
      directory && directory.userProfile ? directory.userProfile(id).catch(() => null) : null,
      bridge && bridge.configured ? bridge.profile(id).catch(() => ({ ok: false })) : { ok: false }
    ]);
    const card = {
      discordId: id,
      discord: {
        name: discord ? (discord.globalName || discord.username) : '', username: discord ? discord.username : '',
        hasAvatar: !!(discord && discord.avatar), accentColor: discord && discord.accentColor != null ? '#' + discord.accentColor.toString(16).padStart(6, '0') : '',
        profileUrl: 'https://discord.com/users/' + id
      },
      site: { linked: false }
    };
    if (site && site.ok && site.linked && site.card) {
      const c = site.card;
      const profileUrl = httpsUrl(c.profile_url), channelUrl = httpsUrl(c.channel && c.channel.url), groupUrl = httpsUrl(c.group && c.group.url);
      card.site = {
        linked: true, name: text(c.display_name), handle: text(c.handle, 40), avatar: !!c.avatar,
        profileUrl, channel: channelUrl ? { name: text(c.channel.handle, 40), url: channelUrl } : null,
        group: groupUrl ? { name: text(c.group.name, 60), url: groupUrl, members: text(c.group.members, 20) } : null
      };
    } else if (site && site.ok === false && bridge && bridge.configured) {
      card.site.unavailable = true; // the site did not answer: the card still shows Discord, and says so
    }
    // a failed lookup is remembered briefly so a flaky upstream is not hammered by every hover
    return keep(cards, id, card);
  }

  /* the avatar image: the member's own, else Discord's default for their id */
  async function avatar(userId) {
    const id = String(userId || '');
    if (!SNOWFLAKE.test(id)) return null;
    const hit = fresh(avatars, id, 3_600_000); if (hit !== undefined) return hit;
    const discord = directory && directory.userProfile ? await directory.userProfile(id).catch(() => null) : null;
    const url = discord && discord.avatar ? `${CDN}/avatars/${id}/${discord.avatar}.png?size=64` : `${CDN}/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
    let out = null;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(6_000) });
      if (res.ok) {
        const type = String(res.headers.get('content-type') || '');
        const bytes = Buffer.from(await res.arrayBuffer());
        if (/^image\/(png|jpeg|webp|gif)$/.test(type) && bytes.length > 0 && bytes.length <= MAX_AVATAR_BYTES) out = { contentType: type, bytes };
      }
    } catch (error) { logger('warn', 'academy_avatar_fetch_failed', { error: String(error.message || error) }); }
    return keep(avatars, id, out, 600);
  }

  return { profile, avatar };
}

module.exports = { createProfileService };
