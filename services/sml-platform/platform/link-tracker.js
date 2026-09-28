'use strict';

/**
 * Discord link tracker for the StockMarketLoop Connect bot.
 *
 * A plain URL in a Discord message never tells anyone who opened it. A button
 * does: every tap is an interaction carrying the member's Discord user id and
 * username. So a server manager posts an external link with /track-link, the
 * bot posts it as a button, and each tap is recorded before the member gets a
 * private message with their own one-time link (one more tap opens it).
 *
 * That one-time link goes through a short hand-off page on the platform
 * (/l/<token>) before the browser is sent on to the real address. The page
 * notes the connection and device behind the tap the same way the
 * verification page does — keyed hashes of the IP address and network, the
 * edge-reported country, the browser's user agent, time zone, languages and
 * screen, and a random marker kept in the browser — and flags a device,
 * address or network already seen on another account, in link taps or in
 * verifications. Raw addresses are never stored. Signals are cleared after
 * RETENTION_DAYS; the tap itself (who, which link, when) stays.
 *
 * Members who are not verified yet are told so in the same private reply and
 * get a Verify button (handled by the verify gate), so the link tap doubles
 * as the nudge to get the verified badge.
 *
 *   /track-link url:<https://…> label:<text>   posts the tracked link (Manage Server)
 *   /link-clicks [link:<id>]                   recent links, or who tapped one (Manage Server)
 *   /link-matches member:<@user>               other accounts on the same device / address / network (Manage Server)
 *   button  sml_link:c:<id>                    records the tap, replies with the one-time link
 *   GET/POST /l/<token>                        hand-off page: records connection + device, sends the browser on
 *
 * The posted message tells members that tapping records their Discord name,
 * connection and device. Taps are recorded only through the button.
 */

const crypto = require('node:crypto');
const { createSignalHasher, requestSignals, RETENTION_DAYS } = require('./verify-gate');

const EPHEMERAL = 64;
const MANAGE_GUILD_PERMISSION = '32';
const SNOWFLAKE = /^[0-9]{5,24}$/;
const CUSTOM_ID_PREFIX = 'sml_link:c:';
const VERIFY_START_ID = 'sml_verify:start';
const SITE_HOSTS = /(^|\.)stockmarketloop\.com$/i;
const MAX_LIST = 15;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // a tap's one-time link works for a day
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const SHARED_WINDOW_DAYS = 30;
const RETENTION_SWEEP_MS = 60 * 60 * 1000;
const FLAG_LABELS = Object.freeze({
  shared_device: 'same device as another account',
  shared_ip: 'same IP address as another account (30 days)',
  shared_network: 'same network as another account',
  tor: 'Tor exit',
  automation: 'automated browser'
});

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
  },
  {
    type: 1, name: 'link-matches', description: 'Other accounts seen on the same device, IP address or network as a member',
    default_member_permissions: MANAGE_GUILD_PERMISSION, contexts: [0],
    options: [{ type: 6, name: 'member', description: 'The member to check', required: true }]
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
function clip(value, max) { return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').slice(0, max); }
function esc(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } }
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
function flagsOf(row) {
  const raw = row && row.flags;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') { try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(String) : []; } catch (_) { return []; } }
  return [];
}

/* The hand-off page: says what is recorded, records it, and sends the browser on. */
function handoffHtml({ dest, expired }) {
  const style = `:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b10;color:#e6edf3;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px;box-sizing:border-box}
main{box-sizing:border-box;width:min(520px,100%);background:#0d1720;border:1px solid #1f3942;border-radius:14px;padding:22px}h1{font-size:1.3rem;margin:0 0 10px}p{color:#c7d5dc}.small{font-size:.85rem;color:#8fa5b1}
a.go{display:block;margin-top:10px;padding:13px;border-radius:10px;background:#19c37d;color:#04160d;font-weight:800;text-align:center;text-decoration:none}`;
  const head = (extra) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>StockMarketLoop link</title>${extra || ''}<style>${style}</style></head>`;
  if (expired) {
    return `${head()}<body><main><h1>This link has expired</h1><p>Go back to Discord and tap the link button again for a fresh one.</p></main></body></html>`;
  }
  const host = hostOf(dest);
  const destJs = JSON.stringify(dest).replace(/</g, '\\u003c');
  return `${head(`<noscript><meta http-equiv="refresh" content="0;url=${esc(dest)}"></noscript>`)}<body><main>
<h1>Opening your link…</h1><p>Taking you to <b>${esc(host || 'the link')}</b>.</p>
<p class="small">This tracked link records, for the server team: your Discord name, a scrambled fingerprint of your connection and device (never the address itself), the approximate country of your connection, and your browser's type, time zone and language. The same device or address showing up on several accounts is noted. Records are cleared after ${RETENTION_DAYS} days.</p>
<a class="go" id="go" href="${esc(dest)}" rel="noreferrer">Continue</a></main>
<script>
(function(){var dest=${destJs},done=false;function go(){if(done)return;done=true;location.replace(dest)}
function did(){try{var k='sml_device_id',v=localStorage.getItem(k);if(!v){v=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now());localStorage.setItem(k,v)}return v}catch(e){return''}}
var d={deviceId:did(),timezone:(Intl.DateTimeFormat().resolvedOptions().timeZone||''),languages:(navigator.languages||[navigator.language]).join(','),screen:screen.width+'x'+screen.height+'@'+(window.devicePixelRatio||1),webdriver:!!navigator.webdriver,touch:('ontouchstart' in window)};
try{fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d),keepalive:true}).then(go,go)}catch(e){go()}
setTimeout(go,1500)})();
</script></body></html>`;
}

function createLinkTracker({ pool, now = Date.now, secret = '', baseUrl = 'https://sml-platform-api.onrender.com', logger = () => {} } = {}) {
  if (!pool) throw new TypeError('pool is required');
  const hasher = createSignalHasher(secret);
  const root = String(baseUrl).replace(/\/+$/, '');
  const taps = new Map(); // per-user tap throttle (2 per 10s) — protects the table from button mashing
  let lastSweep = 0;

  function throttled(userId) {
    const t = now(), list = (taps.get(userId) || []).filter((x) => t - x < 10_000);
    if (taps.size > 5000) taps.clear();
    if (list.length >= 2) { taps.set(userId, list); return true; }
    list.push(t); taps.set(userId, list); return false;
  }

  /* Signals older than RETENTION_DAYS are cleared (the tap row itself stays). Once an hour at most. */
  async function sweep() {
    const t = now();
    if (t - lastSweep < RETENTION_SWEEP_MS) return;
    lastSweep = t;
    try {
      await pool.query(
        `UPDATE discord_link_clicks SET token_hash=NULL, ip_hash=NULL, net_hash=NULL, country=NULL, device_id_hash=NULL, user_agent=NULL, timezone=NULL, languages=NULL, screen=NULL
          WHERE clicked_at < now() - interval '${RETENTION_DAYS} days'
            AND (token_hash IS NOT NULL OR ip_hash IS NOT NULL OR device_id_hash IS NOT NULL OR user_agent IS NOT NULL)`
      );
    } catch (error) { logger('warn', 'link_tracker_sweep_failed', { error }); }
  }

  async function verifyConfig(guildId) {
    try {
      return (await pool.query('SELECT verified_role_id, enabled FROM discord_verify_config WHERE guild_id=$1', [guildId])).rows[0] || null;
    } catch (error) { logger('warn', 'link_tracker_verify_config_failed', { error }); return null; }
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
    const host = hostOf(url);
    return {
      response: {
        type: 4,
        data: {
          allowed_mentions: { parse: [] },
          embeds: [{
            title: label,
            description: (note ? note + '\n\n' : '') + `🔗 ${host}`,
            color: 0x19c37d,
            footer: { text: `Tracked link #${id} · tapping the button records your Discord name, connection and device for the server team` }
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
      const totals = (await pool.query(
        `SELECT COUNT(*)::int AS taps, COUNT(DISTINCT discord_user_id)::int AS people, COUNT(opened_at)::int AS opened,
                (COUNT(DISTINCT discord_user_id) FILTER (WHERE flags ? 'shared_device' OR flags ? 'shared_ip'))::int AS shared
           FROM discord_link_clicks WHERE link_id=$1`, [link.id]
      )).rows[0];
      const people = (await pool.query(
        `SELECT discord_user_id, MAX(username) AS username, COUNT(*)::int AS taps, MAX(clicked_at) AS last_at, COUNT(opened_at)::int AS opened,
                MAX(country) AS country, bool_or(flags ? 'shared_device') AS shared_device, bool_or(flags ? 'shared_ip') AS shared_ip, bool_or(flags ? 'shared_network') AS shared_network
           FROM discord_link_clicks WHERE link_id=$1 GROUP BY discord_user_id ORDER BY last_at DESC LIMIT ${MAX_LIST}`, [link.id]
      )).rows;
      const lines = people.map((p) => {
        const marks = [p.shared_device && 'same device', p.shared_ip && 'same IP', p.shared_network && 'same network'].filter(Boolean);
        return `• <@${p.discord_user_id}> · ${cleanText(p.username, 40) || 'unknown'} · \`${p.discord_user_id}\` · ${p.taps} tap${p.taps === 1 ? '' : 's'}` +
          (p.opened != null ? (p.opened > 0 ? ' · opened' : ' · not opened') : '') + (p.country ? ` · ${cleanText(p.country, 2)}` : '') +
          ` · ${ts(p.last_at)}` + (marks.length ? ` · ⚠ ${marks.join(', ')}` : '');
      });
      const opened = totals.opened != null ? `, ${totals.opened} opened` : '';
      const shared = totals.shared ? `\n⚠ ${totals.shared} ${totals.shared === 1 ? 'account shares' : 'accounts share'} a device or IP address with another account. Run \`/link-matches member:<@user>\` to see who.` : '';
      return ephemeral(
        `**#${link.id} ${cleanText(link.label, 80)}**\n${totals.taps} taps by ${totals.people} ${totals.people === 1 ? 'person' : 'people'}${opened}${shared}` +
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
      '\n\nRun `/link-clicks link:<number>` to see who tapped one, or `/link-matches member:<@user>` to see who shares a device or address with someone.');
  }

  /* Everything we know about one member's devices, addresses and networks, from link taps and verifications. */
  async function signalsFor(guildId, userId) {
    const own = { device_id_hash: new Set(), ip_hash: new Set(), net_hash: new Set() };
    const rows = [
      ...(await pool.query('SELECT device_id_hash, ip_hash, net_hash FROM discord_link_clicks WHERE guild_id=$1 AND discord_user_id=$2 AND opened_at IS NOT NULL', [guildId, userId])).rows,
      ...(await pool.query('SELECT device_id_hash, ip_hash, net_hash FROM discord_verifications WHERE guild_id=$1 AND discord_user_id=$2 AND submitted_at IS NOT NULL', [guildId, userId])).rows
    ];
    for (const r of rows) for (const k of Object.keys(own)) if (r[k]) own[k].add(String(r[k]));
    return own;
  }

  async function linkMatches(interaction) {
    const guildId = typeof interaction.guild_id === 'string' ? interaction.guild_id : null;
    if (!guildId) return ephemeral('Run /link-matches inside your Discord server.');
    const target = optionValue(interaction, 'member');
    if (!SNOWFLAKE.test(target)) return ephemeral('Pick the member to check.');
    const own = await signalsFor(guildId, target);
    const counts = { device_id_hash: own.device_id_hash.size, ip_hash: own.ip_hash.size, net_hash: own.net_hash.size };
    if (!counts.device_id_hash && !counts.ip_hash && !counts.net_hash) {
      return ephemeral(`No connection or device records for <@${target}> yet. They show up once the member opens a tracked link or verifies.`);
    }
    const found = new Map(); // other user id → { username, kinds:Set, last_at }
    const note = (rows, kind) => {
      for (const r of rows) {
        const cur = found.get(r.discord_user_id) || { username: r.username, kinds: new Set(), last_at: r.last_at };
        cur.kinds.add(kind);
        if (!cur.username && r.username) cur.username = r.username;
        if (Date.parse(r.last_at) > Date.parse(cur.last_at || 0)) cur.last_at = r.last_at;
        found.set(r.discord_user_id, cur);
      }
    };
    for (const [column, kind] of [['device_id_hash', 'same device'], ['ip_hash', 'same IP'], ['net_hash', 'same network']]) {
      const values = [...own[column]];
      if (!values.length) continue;
      note((await pool.query(
        `SELECT discord_user_id, MAX(username) AS username, MAX(opened_at) AS last_at FROM discord_link_clicks
          WHERE guild_id=$1 AND discord_user_id<>$2 AND ${column} = ANY($3::text[]) GROUP BY discord_user_id`, [guildId, target, values]
      )).rows, kind);
      note((await pool.query(
        `SELECT discord_user_id, MAX(username) AS username, MAX(submitted_at) AS last_at FROM discord_verifications
          WHERE guild_id=$1 AND discord_user_id<>$2 AND ${column} = ANY($3::text[]) AND status IN ('passed','held') GROUP BY discord_user_id`, [guildId, target, values]
      )).rows, kind);
    }
    const rank = (k) => (k.has('same device') ? 0 : k.has('same IP') ? 1 : 2);
    const list = [...found.entries()].sort((a, b) => rank(a[1].kinds) - rank(b[1].kinds) || Date.parse(b[1].last_at || 0) - Date.parse(a[1].last_at || 0));
    const checked = `Checked ${counts.device_id_hash} device marker${counts.device_id_hash === 1 ? '' : 's'}, ${counts.ip_hash} address${counts.ip_hash === 1 ? '' : 'es'} and ${counts.net_hash} network${counts.net_hash === 1 ? '' : 's'} from link taps and verifications.`;
    if (!list.length) return ephemeral(`**Matches for <@${target}>**\n${checked}\n\nNo other account shares a device, address or network with them.`);
    const lines = list.slice(0, MAX_LIST).map(([id, r]) => `• <@${id}> · ${cleanText(r.username, 40) || 'unknown'} · \`${id}\` · ${[...r.kinds].join(', ')} · ${ts(r.last_at)}`);
    return ephemeral(
      `**Matches for <@${target}>**\n${checked}\n\n${lines.join('\n')}` + (list.length > MAX_LIST ? `\n…and ${list.length - MAX_LIST} more.` : '') +
      '\n\n*Same device is strong evidence of one person. Same IP is good evidence. Same network alone is weak (shared carrier, campus or VPN).*'
    );
  }

  async function handleCommand(interaction) {
    const name = interaction && interaction.data && interaction.data.name;
    if (name === 'track-link') return trackLink(interaction);
    if (name === 'link-clicks') return linkClicks(interaction);
    if (name === 'link-matches') return linkMatches(interaction);
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
    await sweep();
    let token = null;
    if (!throttled(who.id)) {
      token = crypto.randomBytes(24).toString('base64url');
      await pool.query(
        'INSERT INTO discord_link_clicks (link_id, guild_id, discord_user_id, username, token_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [link.id, guildId, who.id, who.username || null, sha256(token)]
      );
    }
    const dest = token ? `${root}/l/${token}` : link.url;
    const buttons = [{ type: 2, style: 5, label: 'Open', url: dest }];
    let content = `Here's your link: **${cleanText(link.label, 80)}**`;
    const cfg = await verifyConfig(guildId);
    const roles = (interaction.member && Array.isArray(interaction.member.roles)) ? interaction.member.roles : [];
    if (cfg && cfg.enabled && cfg.verified_role_id && !roles.includes(cfg.verified_role_id)) {
      content += '\n\nYou are not verified yet, so you cannot post or reply in this server. Tap **Verify to post** to get your verified badge — it takes about a minute.';
      buttons.push({ type: 2, style: 3, label: 'Verify to post', emoji: { name: '✅' }, custom_id: VERIFY_START_ID });
    }
    return ephemeral(content, { components: [{ type: 1, components: buttons }] });
  }

  /* ---------------- the hand-off page ---------------- */

  async function findByToken(token) {
    if (!TOKEN_RE.test(token)) return null;
    return (await pool.query(
      `SELECT c.id, c.link_id, c.guild_id, c.discord_user_id, c.clicked_at, c.opened_at, c.device_id_hash, l.url, l.archived_at
         FROM discord_link_clicks c JOIN discord_tracked_links l ON l.id = c.link_id WHERE c.token_hash=$1`, [sha256(token)]
    )).rows[0] || null;
  }

  async function seenElsewhere(row, column, value, days) {
    if (!value) return false;
    const inClicks = (await pool.query(
      `SELECT 1 FROM discord_link_clicks WHERE guild_id=$1 AND ${column}=$2 AND discord_user_id<>$3
         ${days ? `AND opened_at > now() - interval '${days} days'` : ''} LIMIT 1`, [row.guild_id, value, row.discord_user_id]
    )).rows.length > 0;
    if (inClicks) return true;
    return (await pool.query(
      `SELECT 1 FROM discord_verifications WHERE guild_id=$1 AND ${column}=$2 AND discord_user_id<>$3 AND status IN ('passed','held')
         ${days ? `AND submitted_at > now() - interval '${days} days'` : ''} LIMIT 1`, [row.guild_id, value, row.discord_user_id]
    )).rows.length > 0;
  }

  async function recordOpen(row, request) {
    const { ip, ua, country } = requestSignals(request);
    await pool.query(
      `UPDATE discord_link_clicks SET opened_at=COALESCE(opened_at, now()), ip_hash=COALESCE(ip_hash,$2), net_hash=COALESCE(net_hash,$3),
              country=COALESCE(country,$4), user_agent=COALESCE(user_agent,$5) WHERE id=$1`,
      [row.id, hasher.ipHash(ip), hasher.netHash(ip), country, ua || null]
    );
  }

  async function recordDevice(row, request, signals) {
    const { ip, ua, country, countryRaw } = requestSignals(request);
    const ipHash = hasher.ipHash(ip), netHash = hasher.netHash(ip), deviceHash = hasher.deviceHash(signals && signals.deviceId);
    const flags = [];
    if (await seenElsewhere(row, 'device_id_hash', deviceHash, 0)) flags.push('shared_device');
    if (await seenElsewhere(row, 'ip_hash', ipHash, SHARED_WINDOW_DAYS)) flags.push('shared_ip');
    else if (await seenElsewhere(row, 'net_hash', netHash, SHARED_WINDOW_DAYS)) flags.push('shared_network');
    if (countryRaw === 'T1') flags.push('tor');
    if ((signals && signals.webdriver === true) || /HeadlessChrome|PhantomJS|puppeteer|playwright/i.test(ua)) flags.push('automation');
    await pool.query(
      `UPDATE discord_link_clicks SET opened_at=COALESCE(opened_at, now()), ip_hash=COALESCE(ip_hash,$2), net_hash=COALESCE(net_hash,$3),
              country=COALESCE(country,$4), user_agent=COALESCE(user_agent,$5), device_id_hash=$6, timezone=$7, languages=$8, screen=$9, flags=$10 WHERE id=$1`,
      [row.id, ipHash, netHash, country, ua || null, deviceHash, clip(signals && signals.timezone, 64) || null,
        clip(signals && signals.languages, 80) || null, clip(signals && signals.screen, 32) || null, JSON.stringify(flags)]
    );
    if (flags.length) logger('info', 'link_tap_flagged', { clickId: row.id, guildId: row.guild_id, userId: row.discord_user_id, flags });
    return flags;
  }

  /* Returns true when the request was a hand-off page request. */
  async function handleHttp(request, response, path, readBody) {
    const m = path.match(/^\/l\/([A-Za-z0-9_-]{20,64})$/);
    if (!m) return false;
    const send = (status, type, body) => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
      response.end(body);
    };
    const row = await findByToken(m[1]);
    const live = row && !row.archived_at && (now() - Date.parse(row.clicked_at)) < TOKEN_TTL_MS;
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (!live) { send(410, 'text/html; charset=utf-8', handoffHtml({ expired: true })); return true; }
      try { await recordOpen(row, request); } catch (error) { logger('warn', 'link_open_record_failed', { error }); }
      send(200, 'text/html; charset=utf-8', handoffHtml({ dest: destinationFor(row.url, row.id) }));
      return true;
    }
    if (request.method === 'POST') {
      if (!live) { send(410, 'application/json', JSON.stringify({ ok: false, expired: true })); return true; }
      const dest = destinationFor(row.url, row.id);
      if (row.device_id_hash) { send(200, 'application/json', JSON.stringify({ ok: true, url: dest })); return true; }
      const body = await readBody(request);
      let signals = {};
      try { signals = body && body.ok ? JSON.parse(body.rawBody || '{}') : {}; } catch (_) { signals = {}; }
      if (!signals || typeof signals !== 'object') signals = {};
      try {
        const flags = await recordDevice(row, request, signals);
        send(200, 'application/json', JSON.stringify({ ok: true, url: dest, flags: flags.length }));
      } catch (error) {
        logger('error', 'link_device_record_failed', { error });
        send(200, 'application/json', JSON.stringify({ ok: false, url: dest }));
      }
      return true;
    }
    send(405, 'text/plain', 'Method not allowed');
    return true;
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
    const clicks = (await pool.query(
      `SELECT id, link_id, discord_user_id, username, clicked_at, opened_at, country, flags FROM discord_link_clicks WHERE ${where} ORDER BY clicked_at DESC LIMIT ${cap}`, params
    )).rows.map((c) => Object.assign({}, c, { flags: flagsOf(c) }));
    return { links, clicks };
  }

  /* Create-or-update the commands globally. POST upserts by name and
     leaves every other command of the application in place. */
  async function registerCommands({ appId, botToken, fetchImpl = fetch, logger: log = logger, definitions = LINK_COMMAND_DEFINITIONS } = {}) {
    if (!/^[0-9]{15,24}$/.test(String(appId || '')) || !botToken) return { ok: false, reason: 'unconfigured' };
    const base = `https://discord.com/api/v10/applications/${appId}/commands`;
    const headers = { authorization: `Bot ${botToken}`, 'content-type': 'application/json' };
    /* Only send what is missing or changed: Discord caps command creates per day. */
    let existing = [];
    try { const res = await fetchImpl(base, { headers }); if (res.ok) existing = await res.json(); } catch (_) { existing = []; }
    const same = (a, b) => a && a.description === b.description && JSON.stringify((a.options || []).map((o) => [o.name, o.type, !!o.required])) === JSON.stringify((b.options || []).map((o) => [o.name, o.type, !!o.required]));
    const results = [];
    for (const def of definitions) {
      if (same(Array.isArray(existing) ? existing.find((c) => c && c.name === def.name) : null, def)) { results.push({ name: def.name, status: 200, unchanged: true }); continue; }
      try {
        const res = await fetchImpl(base, { method: 'POST', headers, body: JSON.stringify(def) });
        results.push({ name: def.name, status: res.status });
      } catch (_) { results.push({ name: def.name, status: 0 }); }
    }
    log('info', 'link_tracker_commands_registered', { results });
    return { ok: results.every((r) => r.status >= 200 && r.status < 300), results };
  }

  return { handleCommand, handleComponent, handleHttp, report, registerCommands, handoffHtml };
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

module.exports = { createLinkTracker, withLinkTracker, LINK_COMMAND_DEFINITIONS, LINK_COMMAND_NAMES, destinationFor, cleanUrl, FLAG_LABELS, TOKEN_TTL_MS };
