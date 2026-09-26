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

  return { configured, session };
}

module.exports = { createLoopKickBridge };
