'use strict';

/**
 * Discord verification gate for the StockMarketLoop Connect bot.
 *
 * Server setup: @everyone cannot send messages; a "Verified" role can. A manager
 * runs /verify-setup in a #verify channel, which posts a panel with a Verify
 * button. A new member taps it and gets a private one-time link (20 minutes) to
 * a StockMarketLoop page that tells them what is checked and asks them to
 * confirm. The page reports browser signals; the platform adds network signals
 * and screens the visit:
 *
 *   account_new     Discord account younger than the server's minimum (from the user id)
 *   shared_device   the same browser verified another account in this server
 *   shared_ip       the same IP address verified another account in the last 30 days
 *   tor             the edge network reports the visit came through Tor
 *   automation      the browser identifies itself as automated / headless
 *   shared_network  same /24 network as another account (shown to mods, never blocks)
 *
 * Clean visits get the Verified role at once (mode "auto"). Anything flagged, or
 * every visit in mode "review", is held and posted to the mod log channel with
 * Approve / Deny buttons.
 *
 * PRIVACY: raw IP addresses are never stored — only keyed hashes (so the same
 * address can be recognised without being readable) and the country the edge
 * network reports. The page discloses this before anything is sent. Rows older
 * than 180 days are deleted.
 */

const crypto = require('node:crypto');

const EPHEMERAL = 64;
const MANAGE_GUILD = '32';
const PERM_ADMIN = 1n << 3n;
const PERM_MANAGE_GUILD = 1n << 5n;
const PERM_MANAGE_ROLES = 1n << 28n;
const SNOWFLAKE = /^[0-9]{5,24}$/;
const DISCORD_EPOCH = 1420070400000n;
const TOKEN_TTL_MS = 20 * 60 * 1000;
const RETENTION_DAYS = 180;
const HOLD_FLAGS = new Set(['account_new', 'shared_device', 'shared_ip', 'tor', 'automation', 'quiz_failed']);
const MAX_QUIZ_ATTEMPTS = 3;
/* Five yes/no questions about the server rules. `a` is the answer that follows the rules. */
const RULES_QUIZ = Object.freeze([
  { q: 'Will you keep promotions, referral links and self-advertising out of the server unless a moderator allows it?', a: 'yes' },
  { q: 'Is it OK to DM members asking for money, crypto or account details?', a: 'no' },
  { q: 'Is anything posted here financial advice you must follow?', a: 'no' },
  { q: 'Will you treat other members with respect: no harassment, hate or spam?', a: 'yes' },
  { q: 'Can you repost or sell the server\'s paid alerts and content somewhere else?', a: 'no' }
]);
const FLAG_TEXT = {
  account_new: 'Discord account is newer than the server minimum',
  shared_device: 'Same browser already verified another account here',
  shared_ip: 'Same IP address verified another account (30 days)',
  shared_network: 'Same network as another account (info only)',
  tor: 'Visit came through Tor',
  automation: 'Browser reports automation / headless',
  quiz_failed: 'Answered the rules questions wrong three times',
  role_grant_failed: 'Bot could not give the role (move the bot role above it and give it Manage Roles)'
};

const VERIFY_COMMAND_DEFINITIONS = Object.freeze([
  {
    type: 1, name: 'verify-setup', description: 'Post the Verify panel here and set how new members are screened',
    default_member_permissions: MANAGE_GUILD, contexts: [0],
    options: [
      { type: 8, name: 'role', description: 'Role that can post (given after verification)', required: true },
      { type: 7, name: 'log_channel', description: 'Private channel for mod reviews', required: false, channel_types: [0] },
      { type: 4, name: 'min_account_days', description: 'Hold Discord accounts younger than this (default 7)', required: false, min_value: 0, max_value: 365 },
      { type: 3, name: 'mode', description: 'auto: clean visits pass at once · review: a mod approves everyone', required: false,
        choices: [{ name: 'auto', value: 'auto' }, { name: 'review', value: 'review' }] }
    ]
  },
  {
    type: 1, name: 'verify-check', description: 'Show the latest verification result for a member',
    default_member_permissions: MANAGE_GUILD, contexts: [0],
    options: [{ type: 6, name: 'user', description: 'Member to look up', required: true }]
  }
]);
const VERIFY_COMMAND_NAMES = Object.freeze(VERIFY_COMMAND_DEFINITIONS.map((c) => c.name));

function ephemeral(content, extra) {
  return { response: { type: 4, data: Object.assign({ content, flags: EPHEMERAL, allowed_mentions: { parse: [] } }, extra || {}) } };
}
function opt(interaction, name) {
  const list = (interaction && interaction.data && Array.isArray(interaction.data.options)) ? interaction.data.options : [];
  const hit = list.find((o) => o && o.name === name);
  return hit ? hit.value : undefined;
}
function invokerOf(interaction) {
  const user = (interaction && interaction.member && interaction.member.user) || (interaction && interaction.user) || {};
  return {
    id: typeof user.id === 'string' && SNOWFLAKE.test(user.id) ? user.id : null,
    name: String(user.global_name || user.username || '').replace(/[\u0000-\u001f@]/g, '').slice(0, 64)
  };
}
function hasPerm(interaction, bit) {
  try {
    const p = BigInt(String((interaction && interaction.member && interaction.member.permissions) || '0'));
    return (p & PERM_ADMIN) !== 0n || (p & bit) !== 0n;
  } catch (_) { return false; }
}
function accountCreatedAt(userId) {
  try { return new Date(Number((BigInt(userId) >> 22n) + DISCORD_EPOCH)); } catch (_) { return null; }
}
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function clientIp(request) {
  const h = request.headers || {};
  const raw = h['cf-connecting-ip'] || h['true-client-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || (request.socket && request.socket.remoteAddress) || '';
  return String(raw).trim().replace(/^::ffff:/, '').slice(0, 64);
}
function networkOf(ip) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split('.').slice(0, 3).join('.') + '.0/24';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::/48';
  return '';
}
function clip(value, max) { return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').slice(0, max); }
function esc(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function pageHtml({ state, token, guildName }) {
  const body = state === 'form'
    ? `<h1>Verify to post${guildName ? ' in ' + esc(guildName) : ''}</h1>
<p>Answer these five questions about the server rules.</p>
<ol class="quiz">${RULES_QUIZ.map((item, i) => `<li><p>${esc(item.q)}</p><label><input type="radio" name="q${i}" value="yes"> Yes</label><label><input type="radio" name="q${i}" value="no"> No</label></li>`).join('')}</ol>
<p>This one-time check also keeps bots and duplicate accounts out of the community. When you press the button, StockMarketLoop checks:</p>
<ul><li>your IP address, to spot repeat or anonymised accounts. It is kept only as a scrambled fingerprint, never the address itself;</li>
<li>the approximate country your connection comes from;</li>
<li>your browser and device type, time zone and language;</li>
<li>a random marker saved in this browser, so the same device verifying several accounts can be noticed.</li></ul>
<p class="small">Nothing is shared with other members. Records are deleted after ${RETENTION_DAYS} days.</p>
<button id="go" type="button">Verify me</button><p id="msg" role="status"></p>`
    : state === 'passed' ? '<h1>You are verified ✓</h1><p>Go back to Discord. You can post now.</p>'
      : state === 'held' ? '<h1>Almost there</h1><p>A moderator will review your verification shortly. You can close this page.</p>'
        : '<h1>This link has expired</h1><p>Go back to Discord and press <b>Verify</b> again for a new link.</p>';
  const script = state === 'form' ? `<script>
(function(){var b=document.getElementById('go'),m=document.getElementById('msg');
function did(){try{var k='sml_device_id',v=localStorage.getItem(k);if(!v){v=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now());localStorage.setItem(k,v)}return v}catch(e){return''}}
b.onclick=function(){var answers=[];for(var i=0;i<${RULES_QUIZ.length};i++){var c=document.querySelector('input[name="q'+i+'"]:checked');if(!c){m.textContent='Answer all five questions first.';return}answers.push(c.value)}
b.disabled=true;m.textContent='Checking…';
var d={answers:answers,deviceId:did(),timezone:(Intl.DateTimeFormat().resolvedOptions().timeZone||''),languages:(navigator.languages||[navigator.language]).join(','),screen:screen.width+'x'+screen.height+'@'+(window.devicePixelRatio||1),webdriver:!!navigator.webdriver,touch:('ontouchstart' in window)};
fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json()}).then(function(j){
if(j&&j.status==='passed'){document.querySelector('main').innerHTML='<h1>You are verified ✓</h1><p>Go back to Discord. You can post now.</p>'}
else if(j&&j.status==='held'){document.querySelector('main').innerHTML='<h1>Almost there</h1><p>A moderator will review your verification shortly. You can close this page.</p>'}
else{m.textContent=(j&&j.message)||'Something went wrong. Go back to Discord and press Verify again.';b.disabled=!!(j&&j.expired)}
}).catch(function(){m.textContent='Could not reach the server. Try again.';b.disabled=false})}})();
</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>StockMarketLoop verification</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b10;color:#e6edf3;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px;box-sizing:border-box}
main{box-sizing:border-box;width:min(520px,100%);background:#0d1720;border:1px solid #1f3942;border-radius:14px;padding:22px}h1{font-size:1.3rem;margin:0 0 10px}ul{padding-left:20px}li{margin:6px 0;color:#c7d5dc}
p{color:#c7d5dc}.small{font-size:.85rem;color:#8fa5b1}button{width:100%;margin-top:10px;padding:13px;border:0;border-radius:10px;background:#19c37d;color:#04160d;font-weight:800;font-size:1rem;cursor:pointer}button:disabled{opacity:.6}
#msg{min-height:1.4em;color:#ffce7a}.quiz{padding-left:22px}.quiz li{margin:12px 0}.quiz p{margin:0 0 6px;color:#e6edf3}.quiz label{display:inline-flex;align-items:center;gap:6px;margin-right:18px;padding:6px 0;color:#c7d5dc;cursor:pointer}.quiz input{width:18px;height:18px}</style></head><body><main data-token="${esc(token || '')}">${body}</main>${script}</body></html>`;
}

function createVerifyGate({ pool, botToken = '', secret = '', baseUrl = 'https://sml-platform-api.onrender.com', fetchImpl = globalThis.fetch, now = Date.now, logger = () => {} } = {}) {
  if (!pool) throw new TypeError('pool is required');
  const key = crypto.createHash('sha256').update('sml-verify-gate:' + String(secret || '')).digest();
  const keyed = (label, value) => crypto.createHmac('sha256', key).update(label + ':' + value).digest('hex');
  const root = String(baseUrl).replace(/\/+$/, '');

  async function discord(method, path, body, reason) {
    if (!botToken) return { status: 0, data: null };
    const headers = { authorization: `Bot ${botToken}` };
    if (body) headers['content-type'] = 'application/json';
    if (reason) headers['x-audit-log-reason'] = encodeURIComponent(reason);
    try {
      const res = await fetchImpl(`https://discord.com/api/v10${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      let data = null; try { data = await res.json(); } catch (_) { data = null; }
      return { status: Number(res.status), data };
    } catch (_) { return { status: 0, data: null }; }
  }
  const grantRole = (guildId, userId, roleId) => discord('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, null, 'StockMarketLoop verification passed');

  async function config(guildId) {
    return (await pool.query('SELECT * FROM discord_verify_config WHERE guild_id=$1', [guildId])).rows[0] || null;
  }

  function logEmbed(row, cfg) {
    const flags = Array.isArray(row.flags) ? row.flags : [];
    const ageDays = row.account_created_at ? Math.floor((now() - new Date(row.account_created_at).getTime()) / 86400000) : null;
    const colour = row.status === 'passed' ? 0x19c37d : row.status === 'denied' ? 0xe5484d : 0xffb020;
    return {
      title: `Verification ${row.status === 'passed' ? 'passed' : row.status === 'denied' ? 'denied' : 'held for review'}`,
      color: colour,
      description: `<@${row.discord_user_id}> · ${clip(row.username, 40) || 'unknown'} · \`${row.discord_user_id}\``,
      fields: [
        { name: 'Discord account age', value: ageDays == null ? 'unknown' : `${ageDays} day${ageDays === 1 ? '' : 's'}`, inline: true },
        { name: 'Country', value: row.country || 'not reported', inline: true },
        { name: 'Device', value: clip(row.user_agent, 90) || 'unknown', inline: false },
        { name: 'Time zone · language', value: `${clip(row.timezone, 40) || '—'} · ${clip(row.languages, 40) || '—'}`, inline: false },
        { name: 'Checks', value: flags.length ? flags.map((f) => '⚠ ' + (FLAG_TEXT[f] || f)).join('\n') : '✓ No issues found', inline: false }
      ],
      footer: { text: `Verification #${row.id}${cfg && cfg.mode === 'review' ? ' · review mode' : ''}` }
    };
  }

  async function postLog(cfg, row) {
    if (!cfg || !cfg.log_channel_id) return;
    const held = row.status === 'held';
    await discord('POST', `/channels/${cfg.log_channel_id}/messages`, {
      allowed_mentions: { parse: [] },
      embeds: [logEmbed(row, cfg)],
      components: held ? [{ type: 1, components: [
        { type: 2, style: 3, label: 'Approve', custom_id: `sml_verify:approve:${row.id}` },
        { type: 2, style: 4, label: 'Deny', custom_id: `sml_verify:deny:${row.id}` }
      ] }] : []
    });
  }

  /* ---------------- slash commands ---------------- */

  async function setup(interaction) {
    const guildId = typeof interaction.guild_id === 'string' ? interaction.guild_id : null;
    const who = invokerOf(interaction);
    if (!guildId || !who.id) return ephemeral('Run /verify-setup inside your server, in the channel where new members should verify.');
    if (!hasPerm(interaction, PERM_MANAGE_GUILD)) return ephemeral('You need Manage Server to set up verification.');
    const roleId = String(opt(interaction, 'role') || '');
    if (!SNOWFLAKE.test(roleId) || roleId === guildId) return ephemeral('Pick the role that is allowed to post (not @everyone).');
    const logRaw = opt(interaction, 'log_channel');
    const logId = logRaw && SNOWFLAKE.test(String(logRaw)) ? String(logRaw) : null;
    const daysRaw = opt(interaction, 'min_account_days');
    const days = Number.isInteger(daysRaw) ? Math.max(0, Math.min(365, daysRaw)) : 7;
    const mode = opt(interaction, 'mode') === 'review' ? 'review' : 'auto';
    await pool.query(
      `INSERT INTO discord_verify_config (guild_id, verified_role_id, log_channel_id, min_account_days, mode, enabled, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,TRUE,$6,now())
       ON CONFLICT (guild_id) DO UPDATE SET verified_role_id=EXCLUDED.verified_role_id, log_channel_id=EXCLUDED.log_channel_id,
         min_account_days=EXCLUDED.min_account_days, mode=EXCLUDED.mode, enabled=TRUE, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [guildId, roleId, logId, days, mode, who.id]
    );
    return {
      response: {
        type: 4,
        data: {
          allowed_mentions: { parse: [] },
          embeds: [{
            title: 'Verify before you post',
            description: 'To keep bots, scammers and duplicate accounts out, every new member verifies once.\n\n' +
              'Tap **Verify** below. You will get a private link to a StockMarketLoop page that checks your connection and device, then gives you access to post.',
            color: 0x19c37d,
            footer: { text: 'The page explains exactly what is checked before anything is sent.' }
          }],
          components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Verify', emoji: { name: '✅' }, custom_id: 'sml_verify:start' }] }]
        }
      }
    };
  }

  async function check(interaction) {
    const guildId = typeof interaction.guild_id === 'string' ? interaction.guild_id : null;
    const userId = String(opt(interaction, 'user') || '');
    if (!guildId || !SNOWFLAKE.test(userId)) return ephemeral('Pick a member.');
    const row = (await pool.query(
      'SELECT * FROM discord_verifications WHERE guild_id=$1 AND discord_user_id=$2 ORDER BY created_at DESC LIMIT 1', [guildId, userId]
    )).rows[0];
    if (!row) return ephemeral(`<@${userId}> has not started verification.`);
    return ephemeral('', { embeds: [logEmbed(row, await config(guildId))] });
  }

  async function handleCommand(interaction) {
    const name = interaction && interaction.data && interaction.data.name;
    if (name === 'verify-setup') return setup(interaction);
    if (name === 'verify-check') return check(interaction);
    return null;
  }

  /* ---------------- buttons ---------------- */

  async function start(interaction) {
    const guildId = typeof interaction.guild_id === 'string' ? interaction.guild_id : null;
    const who = invokerOf(interaction);
    if (!guildId || !who.id) return ephemeral('Tap Verify inside the server.');
    const cfg = await config(guildId);
    if (!cfg || !cfg.enabled) return ephemeral('Verification is not set up in this server yet.');
    const roles = (interaction.member && Array.isArray(interaction.member.roles)) ? interaction.member.roles : [];
    if (roles.includes(cfg.verified_role_id)) return ephemeral('You are already verified ✓');
    const last = (await pool.query(
      "SELECT status FROM discord_verifications WHERE guild_id=$1 AND discord_user_id=$2 AND status IN ('held','denied') ORDER BY created_at DESC LIMIT 1",
      [guildId, who.id]
    )).rows[0];
    if (last && last.status === 'held') return ephemeral('Your verification is waiting for a moderator. You will get access once it is approved.');
    if (last && last.status === 'denied') return ephemeral('Your verification was not approved. Contact a moderator if you think this is a mistake.');
    await pool.query(`DELETE FROM discord_verifications WHERE created_at < now() - interval '${RETENTION_DAYS} days'`);
    const token = crypto.randomBytes(24).toString('base64url');
    await pool.query(
      `INSERT INTO discord_verifications (guild_id, discord_user_id, username, account_created_at, token_hash, token_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [guildId, who.id, who.name || null, accountCreatedAt(who.id), sha256(token), new Date(now() + TOKEN_TTL_MS)]
    );
    return ephemeral('Open your private verification link. It works once and expires in 20 minutes.', {
      components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Open verification page', url: `${root}/verify/${token}` }] }]
    });
  }

  async function decide(interaction, action, id) {
    const guildId = typeof interaction.guild_id === 'string' ? interaction.guild_id : null;
    const who = invokerOf(interaction);
    if (!hasPerm(interaction, PERM_MANAGE_ROLES)) return ephemeral('You need Manage Roles to approve or deny verifications.');
    const row = (await pool.query('SELECT * FROM discord_verifications WHERE id=$1 AND guild_id=$2', [id, guildId])).rows[0];
    if (!row) return ephemeral('That verification no longer exists.');
    if (row.status !== 'held') return ephemeral(`Already ${row.status}.`);
    const cfg = await config(guildId);
    let status = action === 'approve' ? 'passed' : 'denied';
    const flags = Array.isArray(row.flags) ? row.flags.slice() : [];
    if (status === 'passed' && cfg) {
      const g = await grantRole(guildId, row.discord_user_id, cfg.verified_role_id);
      if (!(g.status >= 200 && g.status < 300)) {
        if (!flags.includes('role_grant_failed')) flags.push('role_grant_failed');
        await pool.query('UPDATE discord_verifications SET flags=$2 WHERE id=$1', [row.id, JSON.stringify(flags)]);
        return ephemeral('Discord refused to give the role. Move the bot role above the verified role and give it Manage Roles, then press Approve again.');
      }
    }
    await pool.query('UPDATE discord_verifications SET status=$2, decided_at=now(), decided_by=$3 WHERE id=$1', [row.id, status, who.id]);
    const updated = Object.assign({}, row, { status, flags });
    const embed = logEmbed(updated, cfg);
    embed.footer = { text: `${embed.footer.text} · ${status === 'passed' ? 'approved' : 'denied'} by ${who.name || who.id}` };
    return { response: { type: 7, data: { embeds: [embed], components: [], allowed_mentions: { parse: [] } } } };
  }

  async function handleComponent(interaction) {
    const id = interaction && interaction.data && typeof interaction.data.custom_id === 'string' ? interaction.data.custom_id : '';
    if (id === 'sml_verify:start') return start(interaction);
    const m = id.match(/^sml_verify:(approve|deny):([0-9]{1,18})$/);
    if (m) return decide(interaction, m[1], m[2]);
    return null;
  }

  /* ---------------- the page ---------------- */

  async function findByToken(token) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    return (await pool.query('SELECT * FROM discord_verifications WHERE token_hash=$1', [sha256(token)])).rows[0] || null;
  }

  async function submit(row, request, signals) {
    const ip = clientIp(request);
    const ua = clip(request.headers && request.headers['user-agent'], 300);
    const countryRaw = String((request.headers && request.headers['cf-ipcountry']) || '').toUpperCase();
    const country = /^[A-Z][A-Z0-9]$/.test(countryRaw) && countryRaw !== 'XX' ? countryRaw : null;
    const ipHash = ip ? keyed('ip', ip) : null;
    const net = networkOf(ip);
    const netHash = net ? keyed('net', net) : null;
    const deviceRaw = clip(signals && signals.deviceId, 80);
    const deviceHash = deviceRaw ? keyed('dev', deviceRaw) : null;
    const cfg = await config(row.guild_id);
    const flags = [];
    const minDays = cfg ? Number(cfg.min_account_days) : 7;
    if (row.account_created_at && (now() - new Date(row.account_created_at).getTime()) < minDays * 86400000) flags.push('account_new');
    const other = async (column, value, days) => value ? (await pool.query(
      `SELECT 1 FROM discord_verifications WHERE guild_id=$1 AND ${column}=$2 AND discord_user_id<>$3 AND status IN ('passed','held')
         ${days ? `AND submitted_at > now() - interval '${days} days'` : ''} LIMIT 1`, [row.guild_id, value, row.discord_user_id]
    )).rows.length > 0 : false;
    if (await other('device_id_hash', deviceHash, 0)) flags.push('shared_device');
    if (await other('ip_hash', ipHash, 30)) flags.push('shared_ip');
    else if (await other('net_hash', netHash, 30)) flags.push('shared_network');
    if (countryRaw === 'T1') flags.push('tor');
    if ((signals && signals.webdriver === true) || /HeadlessChrome|PhantomJS|puppeteer|playwright/i.test(ua)) flags.push('automation');
    if (signals && signals.__quizFailed) flags.push('quiz_failed');

    let status = (cfg && cfg.mode === 'review') || flags.some((f) => HOLD_FLAGS.has(f)) ? 'held' : 'passed';
    if (status === 'passed' && cfg) {
      const g = await grantRole(row.guild_id, row.discord_user_id, cfg.verified_role_id);
      if (!(g.status >= 200 && g.status < 300)) { flags.push('role_grant_failed'); status = 'held'; }
    }
    await pool.query(
      `UPDATE discord_verifications SET status=$2, ip_hash=$3, net_hash=$4, country=$5, device_id_hash=$6, user_agent=$7, timezone=$8,
         languages=$9, screen=$10, flags=$11, submitted_at=now(), decided_at=CASE WHEN $2='passed' THEN now() ELSE NULL END,
         decided_by=CASE WHEN $2='passed' THEN 'auto' ELSE NULL END, token_expires_at=now() WHERE id=$1`,
      [row.id, status, ipHash, netHash, country, deviceHash, ua || null, clip(signals && signals.timezone, 64) || null,
        clip(signals && signals.languages, 80) || null, clip(signals && signals.screen, 32) || null, JSON.stringify(flags)]
    );
    const saved = Object.assign({}, row, { status, country, user_agent: ua, timezone: clip(signals && signals.timezone, 64), languages: clip(signals && signals.languages, 80), flags });
    try { await postLog(cfg, saved); } catch (error) { logger('warn', 'verify_log_post_failed', { error }); }
    return status;
  }

  /* Returns true when the request was a verification page request. */
  async function handleHttp(request, response, path, readBody) {
    const m = path.match(/^\/verify\/([A-Za-z0-9_-]{20,64})$/);
    if (!m) return false;
    const send = (status, type, body) => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
      response.end(body);
    };
    const row = await findByToken(m[1]);
    const live = row && row.status === 'pending' && new Date(row.token_expires_at).getTime() > now();
    if (request.method === 'GET') {
      const state = live ? 'form' : (row && row.status === 'passed') ? 'passed' : (row && row.status === 'held') ? 'held' : 'expired';
      send(200, 'text/html; charset=utf-8', pageHtml({ state, token: live ? m[1] : '' }));
      return true;
    }
    if (request.method === 'POST') {
      if (!live) { send(410, 'application/json', JSON.stringify({ ok: false, expired: true, status: row ? row.status : 'expired', message: 'This link has expired. Go back to Discord and press Verify again.' })); return true; }
      const body = await readBody(request);
      let signals = {};
      try { signals = body && body.ok ? JSON.parse(body.rawBody || '{}') : {}; } catch (_) { signals = {}; }
      if (!signals || typeof signals !== 'object') signals = {};
      const answers = Array.isArray(signals.answers) ? signals.answers.map((a) => String(a).toLowerCase()) : [];
      const correct = answers.length === RULES_QUIZ.length && RULES_QUIZ.every((item, i) => answers[i] === item.a);
      signals.__quizFailed = false;
      if (!correct) {
        const attempts = Number(row.quiz_attempts || 0) + 1;
        await pool.query('UPDATE discord_verifications SET quiz_attempts=$2 WHERE id=$1', [row.id, attempts]);
        if (attempts < MAX_QUIZ_ATTEMPTS) {
          send(200, 'application/json', JSON.stringify({ ok: false, quiz: true, message: `Some answers don't match the server rules. Read the rules channel and try again (${MAX_QUIZ_ATTEMPTS - attempts} ${MAX_QUIZ_ATTEMPTS - attempts === 1 ? 'try' : 'tries'} left).` }));
          return true;
        }
        signals.__quizFailed = true;
      }
      try {
        const status = await submit(row, request, signals && typeof signals === 'object' ? signals : {});
        send(200, 'application/json', JSON.stringify({ ok: true, status }));
      } catch (error) {
        logger('error', 'verify_submit_failed', { error });
        send(503, 'application/json', JSON.stringify({ ok: false, message: 'Verification is temporarily unavailable. Try again in a minute.' }));
      }
      return true;
    }
    send(405, 'text/plain', 'Method not allowed');
    return true;
  }

  async function report({ guildId, limit = 200 } = {}) {
    if (!SNOWFLAKE.test(String(guildId || ''))) throw new TypeError('invalid_guild');
    const cap = Math.max(1, Math.min(1000, Number(limit) || 200));
    const rows = (await pool.query(
      `SELECT id, discord_user_id, username, account_created_at, status, country, user_agent, timezone, languages, flags, created_at, submitted_at, decided_at, decided_by
         FROM discord_verifications WHERE guild_id=$1 ORDER BY created_at DESC LIMIT ${cap}`, [guildId]
    )).rows;
    return { verifications: rows, config: await config(guildId) };
  }

  return { handleCommand, handleComponent, handleHttp, report, pageHtml };
}

/* Same shape as withLinkTracker: verification commands/buttons first, the rest pass through. */
function withVerifyGate(commands, gate) {
  if (!gate) return commands;
  return {
    async handleCommand(interaction) {
      const name = interaction && interaction.data && interaction.data.name;
      if (VERIFY_COMMAND_NAMES.includes(name)) return gate.handleCommand(interaction);
      return commands.handleCommand(interaction);
    },
    async handleComponent(interaction) {
      const id = interaction && interaction.data && typeof interaction.data.custom_id === 'string' ? interaction.data.custom_id : '';
      if (id.startsWith('sml_verify:')) {
        const out = await gate.handleComponent(interaction);
        if (out) return out;
      }
      return commands.handleComponent(interaction);
    }
  };
}

module.exports = { RULES_QUIZ, createVerifyGate, withVerifyGate, VERIFY_COMMAND_DEFINITIONS, VERIFY_COMMAND_NAMES, accountCreatedAt, networkOf, clientIp };
