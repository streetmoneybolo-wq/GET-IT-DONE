'use strict';

/* The Academy free trial link: one address anyone can open, in any Discord. The visitor signs in with Discord (identify only),
 * gets a 15-day Academy pass on their Discord id, and is sent to open the Academy Activity. The pass is checked by the same
 * access path as a paid pass (academy-passes.js withPasses), so it works in every server the Activity is launched in; one
 * trial per Discord account, ever. No wallet, no card.
 *
 * Owner setup, once: add  <public url>/academy-activity/trial/callback  to the Academy app's OAuth2 redirects in the Discord
 * Developer Portal, and make sure the app allows user install so the Activity can be opened anywhere. The link to share is
 * <public url>/academy-activity/trial  (optionally ?via=<campaign> to tell links apart in the log). */

const crypto = require('node:crypto');

const DISCORD = 'https://discord.com';
const DAY_MS = 86_400_000;
const STATE_TTL_MS = 15 * 60_000;
const SNOWFLAKE = /^\d{15,25}$/;
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function createAcademyTrial({ clientId = '', clientSecret = '', publicUrl = '', store = null, days = 15, enabled = true, appName = 'Making Easy Money Academy',
  fetchImpl = globalThis.fetch, now = Date.now, logger = () => {}, buyUrl = '', botToken = '' } = {}) {
  const origin = String(publicUrl || '').replace(/\/+$/, '');
  const configured = Boolean(enabled && clientId && clientSecret && /^https:\/\//.test(origin) && store && typeof store.add === 'function');
  const trialDays = Math.max(1, Math.min(90, Number(days) || 15));
  const redirectUri = origin + '/academy-activity/trial/callback';
  const link = origin + '/academy-activity/trial';
  const key = crypto.createHash('sha256').update('academy-trial\0' + clientSecret).digest();
  const rate = new Map();

  const sign = (payload) => { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return body + '.' + crypto.createHmac('sha256', key).update(body).digest('base64url'); };
  const open = (state) => {
    const [body, mac] = String(state || '').split('.');
    if (!body || !mac) return null;
    const want = crypto.createHmac('sha256', key).update(body).digest('base64url');
    if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
    try { const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return now() - Number(payload.t) < STATE_TTL_MS ? payload : null; } catch (_) { return null; }
  };
  const limited = (ip) => { const t = now(), cur = rate.get(ip); const b = !cur || t - cur.at > 60_000 ? { at: t, n: 0 } : cur; b.n += 1; rate.set(ip, b); if (rate.size > 5000) rate.clear(); return b.n > 30; };

  function authorizeUrl(via = '') {
    const u = new URL(DISCORD + '/oauth2/authorize');
    u.searchParams.set('client_id', clientId); u.searchParams.set('response_type', 'code'); u.searchParams.set('scope', 'identify');
    u.searchParams.set('redirect_uri', redirectUri); u.searchParams.set('state', sign({ t: now(), via: String(via || '').slice(0, 40) }));
    return u.toString();
  }

  /* the one trial a Discord account gets */
  async function grant(discordId, via = '') {
    const id = String(discordId || '');
    if (!SNOWFLAKE.test(id)) return { ok: false, code: 'invalid_user' };
    const ref = 'acad-trial:' + id;
    const before = await store.byRef(ref).catch(() => null);
    if (before) return { ok: false, code: 'trial_used', pass: before, active: !before.expiresAt || new Date(before.expiresAt).getTime() > now() };
    const current = store.active ? await store.active(id, new Date(now()), 'academy').catch(() => null) : null;
    if (current) return { ok: true, code: 'already_member', pass: current };
    const startsAt = new Date(now()).toISOString(), expiresAt = new Date(now() + trialDays * DAY_MS).toISOString();
    try {
      const pass = await store.add({ discordId: id, plan: 'trial', amount: 0, ref, startsAt, expiresAt, product: 'academy' });
      logger('info', 'academy_trial_started', { userId: id, days: trialDays, via: String(via || '') });
      return { ok: true, code: 'started', pass };
    } catch (error) {
      if (/duplicate/i.test(String(error && error.message))) { const again = await store.byRef(ref).catch(() => null); return { ok: false, code: 'trial_used', pass: again, active: true }; }
      throw error;
    }
  }

  async function exchange(code) {
    const res = await fetchImpl(DISCORD + '/api/oauth2/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code: String(code || ''), redirect_uri: redirectUri }).toString(),
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) throw Object.assign(new Error('discord_token_' + res.status), { code: 'discord_token_failed', status: res.status });
    const tok = await res.json();
    const me = await fetchImpl(DISCORD + '/api/users/@me', { headers: { authorization: 'Bearer ' + tok.access_token, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!me.ok) throw Object.assign(new Error('discord_me_' + me.status), { code: 'discord_identify_failed', status: me.status });
    const user = await me.json();
    return { id: String(user && user.id || ''), name: String(user && (user.global_name || user.username) || '') };
  }

  /* ---------- pages ---------- */
  const activityUrl = DISCORD + '/activities/' + encodeURIComponent(clientId);
  const installUrl = DISCORD + '/oauth2/authorize?client_id=' + encodeURIComponent(clientId) + '&integration_type=1&scope=applications.commands';
  const page = (title, body) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title>'
    + '<meta name="robots" content="noindex"><style>html,body{margin:0;background:#06101a;color:#e6eef2;font:500 16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
    + 'main{max-width:560px;margin:0 auto;padding:48px 20px 60px}.card{border:1px solid #1f3942;border-radius:16px;background:linear-gradient(160deg,#0a1620,#0d1b26);padding:26px 24px;box-shadow:0 24px 60px rgba(0,0,0,.5)}'
    + 'h1{margin:0 0 6px;font-size:1.55rem;line-height:1.2}.k{font:800 .68rem ui-monospace,monospace;letter-spacing:.1em;color:#00c47d;margin:0 0 14px}p{margin:0 0 12px;color:#c9dae2}'
    + '.btn{display:inline-block;margin:8px 8px 0 0;padding:12px 18px;border-radius:10px;background:#00c47d;color:#04140d;font-weight:800;text-decoration:none}.btn.alt{background:rgba(255,255,255,.06);color:#e6eef2;border:1px solid #2b4b5a}'
    + 'ol{padding-left:20px;color:#c9dae2}li{margin:0 0 6px}small{display:block;margin-top:16px;color:#7f95a1;font-size:.78rem}'
    + '.lk{display:block;width:100%;box-sizing:border-box;margin:10px 0 4px;padding:11px 12px;border:1px solid #2b4b5a;border-radius:10px;background:#07111a;color:#aef5d5;font:700 .92rem ui-monospace,monospace}h3{margin:18px 0 6px;font-size:1rem}</style></head><body><main><div class="card">' + body + '</div></main></body></html>';
  /* how an Activity actually opens: from inside Discord. The link becomes a Play card when pasted into any chat or DM; the
     App Launcher is the other door; the user-install link puts the Academy on the account for servers that never added it. */
  const launch = () => '<h3>Open the Academy</h3><p>Paste this link into any Discord chat or DM and press <b>Play</b> on the card:</p>'
    + '<input class="lk" readonly value="' + esc(activityUrl) + '" onfocus="this.select()" aria-label="Academy activity link">'
    + '<a class="btn" href="' + activityUrl + '">Open in Discord</a><a class="btn alt" href="' + installUrl + '">Add the Academy to your Discord account</a>'
    + '<ol><li>Or, in any Discord chat, tap the <b>Apps</b> (rocket) button, find <b>' + esc(appName) + '</b> and press <b>Launch</b>.</li>'
    + '<li>In a server that never added the Academy, use <b>Add the Academy to your Discord account</b> first; after that it launches anywhere for you.</li>'
    + '<li>Sign in when the Academy asks; your access is recognised from your Discord account.</li></ol>';
  const landing = (via) => page(appName + ' · free trial', '<p class="k">FREE TRIAL · ' + trialDays + ' DAYS</p><h1>' + esc(appName) + '</h1>'
    + '<p>The live chart lab, every lesson with narration, the scanner, options, Level 2, alerts desk and member profiles. Free for ' + trialDays + ' days on your Discord account, in any Discord server where the Academy runs. No card.</p>'
    + '<a class="btn" href="/academy-activity/trial/start' + (via ? '?via=' + encodeURIComponent(via) : '') + '">Continue with Discord</a>'
    + '<small>Discord only tells us who you are (your id and name). One trial per Discord account. Educational content, not financial advice.</small>');
  const started = (name, pass) => page('Your Academy trial is on', '<p class="k">TRIAL STARTED</p><h1>You’re in' + (name ? ', ' + esc(name) : '') + '.</h1>'
    + '<p>Your ' + trialDays + '-day Academy pass is on your Discord account until <b>' + esc(new Date(pass.expiresAt).toUTCString().replace(/:\d\d GMT$/, ' UTC')) + '</b>. It works wherever you open the Academy.</p>'
    + launch() + '<small>Enjoy the trial. When it ends, the Academy tells you how to keep access.</small>');
  const used = (name, info) => page('Trial already used', '<p class="k">ONE TRIAL PER ACCOUNT</p><h1>' + (info.active ? 'Your trial is already running' : 'This account has had its trial') + (name ? ', ' + esc(name) : '') + '.</h1>'
    + (info.active ? '<p>It runs until <b>' + esc(new Date(info.pass.expiresAt).toUTCString().replace(/:\d\d GMT$/, ' UTC')) + '</b>.</p>' + launch()
      : '<p>The free trial on this Discord account ended on ' + esc(new Date(info.pass.expiresAt).toUTCString().slice(0, 16)) + '. Academy access is available to members' + (buyUrl ? ':' : '.') + '</p>' + (buyUrl ? '<a class="btn" href="' + esc(buyUrl) + '">Get Academy access</a>' : '')));
  const member = (name) => page('You already have access', '<p class="k">MEMBER</p><h1>You already have Academy access' + (name ? ', ' + esc(name) : '') + '.</h1><p>No trial needed.</p>' + launch());
  const failed = (why) => page('Could not start the trial', '<p class="k">NOT YET</p><h1>That did not go through.</h1><p>' + esc(why) + '</p><a class="btn" href="' + link + '">Try again</a>');

  const send = (response, status, html) => { response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); response.end(html); };

  /* true when the request was one of ours (answered); false to let the server carry on */
  async function handle(request, response, path, url) {
    if (!path.startsWith('/academy-activity/trial')) return false;
    if (!configured) { send(response, 503, page('Trial unavailable', '<p class="k">NOT CONFIGURED</p><h1>The free trial link is not switched on yet.</h1><p>Ask the Academy owner.</p>')); return true; }
    const q = url.searchParams;
    if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return true; }
    if (path === '/academy-activity/trial' || path === '/academy-activity/trial/') { send(response, 200, landing(String(q.get('via') || '').slice(0, 40))); return true; }
    const ip = String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) { send(response, 429, failed('Too many attempts from this connection. Wait a minute and try again.')); return true; }
    if (path === '/academy-activity/trial/start') { response.writeHead(302, { location: authorizeUrl(q.get('via') || ''), 'cache-control': 'no-store' }); response.end(); return true; }
    if (path === '/academy-activity/trial/callback') {
      const state = open(q.get('state'));
      if (!state) { send(response, 400, failed('The sign-in link expired. Start again from the trial page.')); return true; }
      if (q.get('error')) { send(response, 200, failed(q.get('error') === 'access_denied' ? 'The Discord sign-in was cancelled. Nothing was started.' : 'Discord did not complete the sign-in (' + String(q.get('error')).slice(0, 40) + ').')); return true; }
      try {
        const who = await exchange(q.get('code'));
        const r = await grant(who.id, state.via);
        logger('info', 'academy_trial_callback', { userId: who.id, outcome: r.code, via: state.via });
        if (r.ok && r.code === 'started') { send(response, 200, started(who.name, r.pass)); return true; }
        if (r.ok && r.code === 'already_member') { send(response, 200, member(who.name)); return true; }
        if (r.code === 'trial_used') { send(response, 200, used(who.name, r)); return true; }
        send(response, 400, failed('That Discord account could not be read.'));
      } catch (error) {
        logger('warn', 'academy_trial_failed', { error, code: error && error.code });
        send(response, 502, failed('Discord did not answer the sign-in just now. Try again in a moment.'));
      }
      return true;
    }
    send(response, 404, failed('That trial page does not exist.'));
    return true;
  }

  /* Ground truth from Discord about the app's own setup (its bot token may read the application): is the callback registered, is user
     install on. Logged at start so a trial that cannot work says why before anyone clicks. */
  async function inspect() {
    if (!botToken || typeof fetchImpl !== 'function') return { checked: false };
    try {
      const res = await fetchImpl(DISCORD + '/api/v10/applications/@me', { headers: { authorization: 'Bot ' + botToken, accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return { checked: false, status: res.status };
      const app = await res.json();
      const uris = Array.isArray(app.redirect_uris) ? app.redirect_uris : [];
      const types = app.integration_types_config && typeof app.integration_types_config === 'object' ? Object.keys(app.integration_types_config) : [];
      const flags = Number(app.flags) || 0;
      return { checked: true, redirectRegistered: uris.includes(redirectUri), redirectUris: uris.length, userInstall: types.includes('1'), guildInstall: types.includes('0'), embedded: Boolean(flags & (1 << 17)), name: String(app.name || '') };
    } catch (error) { return { checked: false, error: String(error && error.message || error) }; }
  }

  return { configured, days: trialDays, link, redirectUri, activityUrl, authorizeUrl, grant, handle, inspect, openState: open, signState: sign };
}

module.exports = { createAcademyTrial };
