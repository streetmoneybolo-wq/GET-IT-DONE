'use strict';

/* =============================================================================
 * MEM Academy billing: web identity OAuth on the Academy app.
 *
 * Stateless and cookie-bound (see link-token.js). Scope 'identify' only, plus
 * 'guilds.join' when the buyer explicitly opts in to being added to the server
 * (SML_ACADEMY_BILLING_AUTO_JOIN=1). The user's access token is used for
 * /users/@me (and the optional join) and then DISCARDED: never stored, never
 * logged.
 *
 * Redirect URI: SML_ACADEMY_BILLING_PUBLIC_URL + /v1/academy/billing/oauth/callback
 * (a NEW path; the existing /v1/link/discord/callback stays with the Activity
 * OAuth). It must be registered on the Academy app (owner step).
 * ========================================================================== */

const AUTHORIZE = 'https://discord.com/oauth2/authorize';
const TOKEN = 'https://discord.com/api/v10/oauth2/token';
const ME = 'https://discord.com/api/v10/users/@me';
const SNOWFLAKE = /^[0-9]{15,24}$/;

function createBillingOAuth({ config, fetchImpl = globalThis.fetch } = {}) {
  const redirectUri = `${config.publicUrl}/v1/academy/billing/oauth/callback`;

  function authorizeUrl({ state, join = false }) {
    const query = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: join ? 'identify guilds.join' : 'identify',
      state
    });
    if (!join) query.set('prompt', 'none');
    return `${AUTHORIZE}?${query.toString()}`;
  }

  async function exchange(code) {
    if (!code || String(code).length > 200) return null;
    const basic = Buffer.from(`${config.appId}:${config.clientSecret}`).toString('base64');
    const response = await fetchImpl(TOKEN, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUri }).toString(),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const token = await response.json().catch(() => null);
    return token && typeof token.access_token === 'string' ? token.access_token : null;
  }

  async function me(accessToken) {
    const response = await fetchImpl(ME, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const user = await response.json().catch(() => null);
    return user && SNOWFLAKE.test(String(user.id)) ? { id: String(user.id), username: String(user.username || '') } : null;
  }

  return { redirectUri, authorizeUrl, exchange, me };
}

module.exports = { createBillingOAuth };
