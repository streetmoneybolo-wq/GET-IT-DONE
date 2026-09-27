'use strict';

/**
 * Discord link tracker for the StockMarketLoop Connect bot.
 *
 * A plain URL in a Discord message never tells anyone who opened it. A button
 * does: every tap is an interaction carrying the member's Discord user id and
 * username. So a server manager posts an external link with /track-link, the
 * bot posts it as a button, and each tap is recorded before the member gets a
 * private message with the real link (one more tap opens it).
 *
 *   /track-link url:<https://…> label:<text>   posts the tracked link (Manage Server)
 *   /link-clicks [link:<id>]                   recent links, or who tapped one (Manage Server)
 *   button  sml_link:c:<id>                    records the tap, replies with the link
 *
 * The posted message tells members that tapping records their Discord name.
 * Taps are recorded only through the button; nothing else is collected.
 */

const EPHEMERAL = 64;
const MANAGE_GUILD_PERMISSION = '32';
const SNOWFLAKE = /^[0-9]{5,24}$/;
const CUSTOM_ID_PREFIX = 'sml_link:c:';
const SITE_HOSTS = /(^|\.)stockmarketloop\.com$/i;
const MAX_LIST = 15;

const LINK_COMMAND_DEFINITIONS = Object.freeze([
  {
    type: 1, name: 'track-link', description: 'Post an external link as a button that records who taps it',
    default_member_permissions: MANAGE_GUILD_PERMISSION, contexts: [0],
    options: [
      { type: 3, name: 'url', description: 'The link (https://…)', required: true, max_length: 1000 },
      { type: 3, name: 'label', description: 'What the link is, shown on the post', required: true, max_length: 80 },
      { type: 3, name: 'note', description: 'Optional line of text above the button', required: false, max_length: 300 }
    ]
  },
  {
    type: 1, name: 'link-clicks', description: 'See your tracked links, or who tapped one',
    default_member_permissions: MANAGE_GUILD_PERMISSION, contexts: [0],
    options: [{ type: 3, name: 'link', description: 'Tracked link id (from /link-clicks)', required: false, max_length: 20 }]
  }
]);
const LINK_COMMAND_NAMES = Object.freeze(LINK_COMMAND_DEFINITIONS.map((c) => c.name));

function ephemeral(content, extra) {
  return { response: { type: 4, data: Object.assign({ content, flags: EPHEMERAL, allowed_mentions: { parse: [] } }, extra || {}) } };
}
function optionValue(interaction, name) {
  const opts = (interaction && interaction.data && Array.isArray(interaction.data.options)) ? interaction.data.options : [];
  const hit = opts.find((o) => o && o.name === name);
  return hit && typeof hit.value === 'string' ? hit.value.trim() : '';
}
function invokerOf(interaction) {
  const user = (interaction && interaction.member && interaction.member.user) || (interaction && interaction.user) || {};
  const id = typeof user.id === 'string' && SNOWFLAKE.test(user.id) ? user.id : null;
  const name = typeof user.global_name === 'string' && user.global_name ? user.global_name
    : (typeof user.username === 'string' ? user.username : '');
  return { id, username: String(name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 64) };
}
function cleanUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch (_) { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const out = url.toString();
  return out.length <= 1000 ? out : null;
}
function cleanText(raw, max) {
  return String(raw || '').replace(/[\u0000-\u001f@]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
/* On the site's own links, a click reference lets the site's tracker join the
   Discord tap to the page visit. External sites get the URL untouched. */
function destinationFor(url, clickId) {
  try {
    const u = new URL(url);
    if (SITE_HOSTS.test(u.hostname)) u.searchParams.set('sml_click', 'd' + clickId);
    return u.toString();
  } catch (_) { return url; }
}
function ts(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? `<t:${Math.floor(t / 1000)}:R>` : 'unknown';
}

function createLinkTracker({ pool, now = Date.now } = {}) {
  const taps = new Map(); // per-user tap throttle (2 per 10s) — protects the table from button mashing

  function throttled(userId) {
    const t = now(), list = (taps.get(userId) || []).filter((x) => t - x < 10_000);
    if (taps.size > 5000) taps.clear();
    if (list.length >= 2) { taps.set(userId, list); return true; }
    list.push(t); taps.set(userId, list); return false;
  }

  async function trackLink(interaction) {
    const guildId = typeof interaction.guild_id === 'string' ? interaction.guild_id : null;
    const channelId = typeof interaction.channel_id === 'string' ? interaction.channel_id : null;
    const who = invokerOf(interaction);
    if (!guildId || !who.id) return ephemeral('Run /track-link inside the Discord server where you want to post the link.');
    const url = cleanUrl(optionValue(interaction, 'url'));
    if (!url) return ephemeral('That link is not valid. Use a full address that starts with https://');
    const label = cleanText(optionValue(interaction, 'label'), 80) || 'Open link';
    const note = cleanText(optionValue(interaction, 'note'), 300);
    const { rows } = await pool.query(
      'INSERT INTO discord_tracked_links (guild_id, channel_id, url, label, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [guildId, channelId, url, label, who.id]
    );
    const id = String(rows[0].id);
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { /* validated above */ }
    return {
      response: {
        type: 4,
        data: {
          allowed_mentions: { parse: [] },
          embeds: [{
            title: label,
            description: (note ? note + '\n\n' : '') + `🔗 ${host}`,
            color: 0x19c37d,
            footer: { text: `Tracked link #${id} · tapping the button records your Discord name for the server team` }
          }],
          components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Open link', emoji: { name: '🔗' }, custom_id: CUSTOM_ID_PREFIX + id }] }]
        }
      }
    };
  }

  async function linkClicks(interaction) {
    const guildId = typeof interaction.guild_id === 'string' ? interaction.guild_id : null;
    if (!guildId) return ephemeral('Run /link-clicks inside your Discord server.');
    const raw = optionValue(interaction, 'link').replace(/^#/, '');
    if (raw) {
      if (!/^[0-9]{1,18}$/.test(raw)) return ephemeral('Use the number of a tracked link, for example 12.');
      const link = (await pool.query('SELECT id, label, url, created_at FROM discord_tracked_links WHERE id=$1 AND guild_id=$2', [raw, guildId])).rows[0];
      if (!link) return ephemeral(`No tracked link #${raw} in this server.`);
      const totals = (await pool.query('SELECT COUNT(*)::int AS taps, COUNT(DISTINCT discord_user_id)::int AS people FROM discord_link_clicks WHERE link_id=$1', [link.id])).rows[0];
      const people = (await pool.query(
        `SELECT discord_user_id, MAX(username) AS username, COUNT(*)::int AS taps, MAX(clicked_at) AS last_at
           FROM discord_link_clicks WHERE link_id=$1 GROUP BY discord_user_id ORDER BY last_at DESC LIMIT ${MAX_LIST}`, [link.id]
      )).rows;
      const lines = people.map((p) => `• <@${p.discord_user_id}> · ${cleanText(p.username, 40) || 'unknown'} · \`${p.discord_user_id}\` · ${p.taps} tap${p.taps === 1 ? '' : 's'} · ${ts(p.last_at)}`);
      return ephemeral(
        `**#${link.id} ${cleanText(link.label, 80)}**\n${totals.taps} taps by ${totals.people} ${totals.people === 1 ? 'person' : 'people'}` +
        (lines.length ? `\n\nMost recent:\n${lines.join('\n')}` : '\n\nNobody has tapped it yet.') +
        (totals.people > MAX_LIST ? `\n…and ${totals.people - MAX_LIST} more.` : '')
      );
    }
    const links = (await pool.query(
      `SELECT l.id, l.label, l.created_at, COUNT(c.id)::int AS taps, COUNT(DISTINCT c.discord_user_id)::int AS people
         FROM discord_tracked_links l LEFT JOIN discord_link_clicks c ON c.link_id = l.id
        WHERE l.guild_id=$1 AND l.archived_at IS NULL GROUP BY l.id ORDER BY l.created_at DESC LIMIT ${MAX_LIST}`, [guildId]
    )).rows;
    if (!links.length) return ephemeral('No tracked links yet. Post one with /track-link.');
    return ephemeral('**Tracked links**\n' + links.map((l) => `• #${l.id} ${cleanText(l.label, 60)} · ${l.people} ${l.people === 1 ? 'person' : 'people'}, ${l.taps} taps · posted ${ts(l.created_at)}`).join('\n') +
      '\n\nRun `/link-clicks link:<number>` to see who tapped one.');
  }

  async function handleCommand(interaction) {
    const name = interaction && interaction.data && interaction.data.name;
    if (name === 'track-link') return trackLink(interaction);
    if (name === 'link-clicks') return linkClicks(interaction);
    return null;
  }

  async function handleComponent(interaction) {
    const customId = interaction && interaction.data && typeof interaction.data.custom_id === 'string' ? interaction.data.custom_id : '';
    if (!customId.startsWith(CUSTOM_ID_PREFIX)) return null;
    const id = customId.slice(CUSTOM_ID_PREFIX.length);
    const guildId = typeof interaction.guild_id === 'string' ? interaction.guild_id : null;
    const who = invokerOf(interaction);
    if (!/^[0-9]{1,18}$/.test(id) || !guildId || !who.id) return ephemeral('This link button is not valid here.');
    const link = (await pool.query('SELECT id, url, label, archived_at FROM discord_tracked_links WHERE id=$1 AND guild_id=$2', [id, guildId])).rows[0];
    if (!link || link.archived_at) return ephemeral('This tracked link is no longer available.');
    let clickId = null;
    if (!throttled(who.id)) {
      const { rows } = await pool.query(
        'INSERT INTO discord_link_clicks (link_id, guild_id, discord_user_id, username) VALUES ($1,$2,$3,$4) RETURNING id',
        [link.id, guildId, who.id, who.username || null]
      );
      clickId = rows[0] && rows[0].id;
    }
    const dest = clickId ? destinationFor(link.url, clickId) : link.url;
    return ephemeral(`Here's your link: **${cleanText(link.label, 80)}**`, {
      components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Open', url: dest }] }]
    });
  }

  /* Signed API for the site dashboard: links and taps for one server. */
  async function report({ guildId, linkId, limit = 200 } = {}) {
    if (!SNOWFLAKE.test(String(guildId || ''))) throw new TypeError('invalid_guild');
    const cap = Math.max(1, Math.min(1000, Number(limit) || 200));
    const links = (await pool.query(
      `SELECT l.id, l.label, l.url, l.created_by, l.created_at, COUNT(c.id)::int AS taps, COUNT(DISTINCT c.discord_user_id)::int AS people
         FROM discord_tracked_links l LEFT JOIN discord_link_clicks c ON c.link_id = l.id
        WHERE l.guild_id=$1 GROUP BY l.id ORDER BY l.created_at DESC LIMIT 200`, [guildId]
    )).rows;
    const params = [guildId];
    let where = 'guild_id=$1';
    if (linkId != null && linkId !== '') {
      if (!/^[0-9]{1,18}$/.test(String(linkId))) throw new TypeError('invalid_link');
      params.push(String(linkId)); where += ' AND link_id=$2';
    }
    const clicks = (await pool.query(`SELECT id, link_id, discord_user_id, username, clicked_at FROM discord_link_clicks WHERE ${where} ORDER BY clicked_at DESC LIMIT ${cap}`, params)).rows;
    return { links, clicks };
  }

  /* Create-or-update the two commands globally. POST upserts by name and
     leaves every other command of the application in place. */
  async function registerCommands({ appId, botToken, fetchImpl = fetch, logger = () => {} } = {}) {
    if (!/^[0-9]{15,24}$/.test(String(appId || '')) || !botToken) return { ok: false, reason: 'unconfigured' };
    const base = `https://discord.com/api/v10/applications/${appId}/commands`;
    const headers = { authorization: `Bot ${botToken}`, 'content-type': 'application/json' };
    /* Only send what is missing or changed: Discord caps command creates per day. */
    let existing = [];
    try { const res = await fetchImpl(base, { headers }); if (res.ok) existing = await res.json(); } catch (_) { existing = []; }
    const same = (a, b) => a && a.description === b.description && JSON.stringify((a.options || []).map((o) => [o.name, o.type, !!o.required])) === JSON.stringify((b.options || []).map((o) => [o.name, o.type, !!o.required]));
    const results = [];
    for (const def of LINK_COMMAND_DEFINITIONS) {
      if (same(Array.isArray(existing) ? existing.find((c) => c && c.name === def.name) : null, def)) { results.push({ name: def.name, status: 200, unchanged: true }); continue; }
      try {
        const res = await fetchImpl(base, { method: 'POST', headers, body: JSON.stringify(def) });
        results.push({ name: def.name, status: res.status });
      } catch (_) { results.push({ name: def.name, status: 0 }); }
    }
    logger('info', 'link_tracker_commands_registered', { results });
    return { ok: results.every((r) => r.status >= 200 && r.status < 300), results };
  }

  return { handleCommand, handleComponent, report, registerCommands };
}

/* Puts the link tracker in front of an existing command set (same shape as
   scopeCommands): its commands and buttons are answered here, the rest pass through. */
function withLinkTracker(commands, tracker) {
  return {
    async handleCommand(interaction) {
      const name = interaction && interaction.data && interaction.data.name;
      if (LINK_COMMAND_NAMES.includes(name)) return tracker.handleCommand(interaction);
      return commands.handleCommand(interaction);
    },
    async handleComponent(interaction) {
      const customId = interaction && interaction.data && typeof interaction.data.custom_id === 'string' ? interaction.data.custom_id : '';
      if (customId.startsWith(CUSTOM_ID_PREFIX)) return tracker.handleComponent(interaction);
      if (typeof commands.handleComponent === 'function') return commands.handleComponent(interaction);
      return ephemeral('This button is not recognized.');
    }
  };
}

module.exports = { createLinkTracker, withLinkTracker, LINK_COMMAND_DEFINITIONS, LINK_COMMAND_NAMES, destinationFor, cleanUrl };
