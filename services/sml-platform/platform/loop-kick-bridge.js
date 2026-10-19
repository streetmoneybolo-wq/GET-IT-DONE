'use strict';

const crypto = require('node:crypto');

/**
 * Signed client for the site's LOOP-KICK Discord session mint
 * (POST /wp-json/sml-loop-kick/v1/discord-session). Same HMAC family as the
 * Academy data bridge, extended to bind the POST body:
 * sign("{ts}.{path}.{sha256(body)}") with SML_LOOP_KICK_BRIDGE_SECRET.
 * No WordPress credential is involved anywhere on this side.
 */
function createLoopKickBridge({ baseUrl = '', secret = '', appUrl = '', fetchImpl = fetch, now = Date.now } = {}) {
  const root = String(baseUrl || '').trim().replace(/\/+$/, '');
  const configured = /^https:\/\//i.test(root) && String(secret).length >= 32;

  async function session(discordUserId) {
    if (!configured) {
      return { ok: false, status: 503, error: 'loop_kick_unconfigured' };
    }
    const cleanId = String(discordUserId || '').replace(/\D/g, '');
    if (!/^\d{15,24}$/.test(cleanId)) {
      return { ok: false, status: 400, error: 'invalid_discord_user' };
    }
    const path = '/wp-json/sml-loop-kick/v1/discord-session';
    const body = JSON.stringify({ discord_user_id: cleanId });
    const timestamp = String(Math.floor(now() / 1000));
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const signature = crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${path}.${bodyHash}`).digest('hex');
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-sml-lk-timestamp': timestamp,
          'x-sml-lk-signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      return { ok: false, status: 503, error: 'loop_kick_unavailable' };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    if (response.status === 403 && payload && (payload.error === 'not_linked' || payload.error === 'not_verified')) {
      // pass the member-facing shape through untouched (connect_url / verify_url)
      return { ok: false, status: 403, ...payload };
    }
    if (!response.ok || !payload || payload.ok !== true || !payload.token) {
      return { ok: false, status: 503, error: 'loop_kick_unavailable' };
    }
    return {
      ok: true,
      status: 200,
      token: String(payload.token),
      expires_at: Number(payload.expires_at) || 0,
      user: payload.user && typeof payload.user === 'object' ? payload.user : null,
      app_url: String(appUrl || payload.app_url || ''),
    };
  }

  /* A linked, verified member's PUBLIC card (handle, name, avatar, profile / channel / group links), by Discord id. Same signed channel as session(). */
  async function profile(discordUserId) {
    if (!configured) return { ok: false, status: 503, error: 'loop_kick_unconfigured' };
    const cleanId = String(discordUserId || '').replace(/\D/g, '');
    if (!/^\d{15,24}$/.test(cleanId)) return { ok: false, status: 400, error: 'invalid_discord_user' };
    const path = '/wp-json/sml-loop-kick/v1/discord-profile';
    const body = JSON.stringify({ discord_user_id: cleanId });
    const timestamp = String(Math.floor(now() / 1000));
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const signature = crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${path}.${bodyHash}`).digest('hex');
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-sml-lk-timestamp': timestamp, 'x-sml-lk-signature': `sha256=${signature}` }, body, signal: AbortSignal.timeout(6_000) });
    } catch (error) { return { ok: false, status: 503, error: 'loop_kick_unavailable' }; }
    let payload = null; try { payload = await response.json(); } catch (error) { payload = null; }
    if (!response.ok || !payload || payload.ok !== true) return { ok: false, status: 503, error: 'loop_kick_unavailable' };
    return { ok: true, linked: payload.linked === true, card: payload.linked === true && payload.card && typeof payload.card === 'object' ? payload.card : null };
  }

  /* A linked, verified member's recent PUBLIC activity on the site (posts, comments, their social feed), newest first, for the
     Academy profile page. POST /wp-json/sml-loop-kick/v1/discord-activity, signed like profile(). */
  async function activity(discordUserId, limit = 12) {
    if (!configured) return { ok: false, status: 503, error: 'loop_kick_unconfigured' };
    const cleanId = String(discordUserId || '').replace(/\D/g, '');
    if (!/^\d{15,24}$/.test(cleanId)) return { ok: false, status: 400, error: 'invalid_discord_user' };
    const path = '/wp-json/sml-loop-kick/v1/discord-activity';
    const body = JSON.stringify({ discord_user_id: cleanId, limit: Math.max(1, Math.min(20, Number(limit) || 12)) });
    const timestamp = String(Math.floor(now() / 1000));
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const signature = crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${path}.${bodyHash}`).digest('hex');
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-sml-lk-timestamp': timestamp, 'x-sml-lk-signature': `sha256=${signature}` }, body, signal: AbortSignal.timeout(12_000) });
    } catch (error) { return { ok: false, status: 503, error: 'loop_kick_unavailable' }; }
    let payload = null; try { payload = await response.json(); } catch (error) { payload = null; }
    if (response.status === 404) return { ok: false, status: 503, error: 'activity_unconfigured' }; // the site runs an older profile-card plugin
    if (!response.ok || !payload || payload.ok !== true) return { ok: false, status: 503, error: 'loop_kick_unavailable' };
    const items = (Array.isArray(payload.items) ? payload.items : []).filter((x) => x && typeof x === 'object').slice(0, 20);
    return { ok: true, linked: payload.linked === true, user: payload.linked === true && payload.user && typeof payload.user === 'object' ? payload.user : null, items: payload.linked === true ? items : [] };
  }

  /* Store Discord id ↔ WordPress user (the member proved the account through the site's app identity sign-in first).
     Signed route POST /wp-json/sml-loop-kick/v1/discord-link; 409 when the Discord account already belongs to another member. */
  async function link({ discordUserId = '', wpUserId = 0, discordTag = '' } = {}) {
    if (!configured) return { ok: false, status: 503, error: 'loop_kick_unconfigured' };
    const cleanId = String(discordUserId || '').replace(/\D/g, '');
    const userId = Number(wpUserId);
    if (!/^\d{15,24}$/.test(cleanId)) return { ok: false, status: 400, error: 'invalid_discord_user' };
    if (!Number.isInteger(userId) || userId <= 0) return { ok: false, status: 400, error: 'invalid_site_user' };
    const path = '/wp-json/sml-loop-kick/v1/discord-link';
    const body = JSON.stringify({ discord_user_id: cleanId, wp_user_id: userId, discord_tag: String(discordTag || '').slice(0, 190) });
    const timestamp = String(Math.floor(now() / 1000));
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const signature = crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${path}.${bodyHash}`).digest('hex');
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-sml-lk-timestamp': timestamp, 'x-sml-lk-signature': `sha256=${signature}` }, body, signal: AbortSignal.timeout(8_000) });
    } catch (error) { return { ok: false, status: 503, error: 'loop_kick_unavailable' }; }
    let payload = null; try { payload = await response.json(); } catch (error) { payload = null; }
    if (response.status === 404 && payload && payload.code === 'rest_no_route') {
      // the site still runs the bridge without the link route: the panel falls back to the site page
      return { ok: false, status: 503, error: 'connect_unconfigured' };
    }
    if (response.status === 409) return { ok: false, status: 409, error: 'discord_already_linked' };
    if (!response.ok || !payload || payload.ok !== true) return { ok: false, status: 503, error: 'loop_kick_unavailable' };
    return { ok: true, status: 200, linked: payload.linked === true, userId: Number(payload.user_id) || userId, verified: payload.verified !== false };
  }

  /* Sign up with Discord: create or match the member's site account from what Discord shared (identify + email), link the Discord id,
     mark the email verified when Discord verified it, and get a one-time sign-in link. POST /wp-json/sml-loop-kick/v1/discord-register. */
  async function register({ discordUserId = '', discordTag = '', email = '', emailVerified = false, name = '', returnTo = '' } = {}) {
    if (!configured) return { ok: false, status: 503, error: 'loop_kick_unconfigured' };
    const cleanId = String(discordUserId || '').replace(/\D/g, '');
    if (!/^\d{15,24}$/.test(cleanId)) return { ok: false, status: 400, error: 'invalid_discord_user' };
    const path = '/wp-json/sml-loop-kick/v1/discord-register';
    const body = JSON.stringify({ discord_user_id: cleanId, discord_tag: String(discordTag || '').slice(0, 190), email: String(email || '').trim().slice(0, 254), email_verified: emailVerified === true, name: String(name || '').slice(0, 80), return_to: String(returnTo || '').slice(0, 500) });
    const timestamp = String(Math.floor(now() / 1000));
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const signature = crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${path}.${bodyHash}`).digest('hex');
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-sml-lk-timestamp': timestamp, 'x-sml-lk-signature': `sha256=${signature}` }, body, signal: AbortSignal.timeout(10_000) });
    } catch (error) { return { ok: false, status: 503, error: 'loop_kick_unavailable' }; }
    let payload = null; try { payload = await response.json(); } catch (error) { payload = null; }
    if (response.status === 404 && payload && payload.code === 'rest_no_route') return { ok: false, status: 503, error: 'register_unconfigured' }; // the site runs the connect plugin without sign-up
    if (response.status === 409) return { ok: false, status: 409, error: payload && payload.code === 'sml_lkd_discord_already_linked' ? 'discord_already_linked' : 'email_unverified_existing' };
    if (response.status === 400) return { ok: false, status: 400, error: payload && payload.code === 'sml_lkc_email_required' ? 'email_required' : 'invalid_request' };
    if (!response.ok || !payload || payload.ok !== true) return { ok: false, status: 503, error: 'loop_kick_unavailable' };
    const https = (v) => (/^https:\/\//i.test(String(v || '')) ? String(v) : '');
    return { ok: true, status: 200, created: payload.created === true, matched: payload.matched === true, verified: payload.verified === true, userId: Number(payload.user_id) || 0, handle: String(payload.handle || '').slice(0, 80), loginUrl: https(payload.login_url), profileUrl: https(payload.profile_url) };
  }

  return { configured, session, profile, activity, link, register };
}

module.exports = { createLoopKickBridge };
