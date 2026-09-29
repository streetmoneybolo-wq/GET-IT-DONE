/* Turns on the Message Content privileged intent for the bot's own Discord
   application before the gateway login, so a fresh or re-created application
   does not crash with "Used disallowed intents".

   Discord lets an application edit only its own limited-intent flags through
   the API (PATCH /applications/@me). That covers unverified apps, which is every
   app in fewer than 100 servers. A verified app keeps the intent under Discord's
   review flags and can only be changed in the Developer Portal; this helper then
   logs exactly where to click instead of failing. */

export const GATEWAY_MESSAGE_CONTENT = 1 << 18;          // verified apps
export const GATEWAY_MESSAGE_CONTENT_LIMITED = 1 << 19;  // unverified apps
const API = 'https://discord.com/api/v10/applications/@me';

export async function ensureMessageContentIntent(token, { fetchImpl = fetch, log = console } = {}) {
  if (!token) return { ok: false, reason: 'no_token' };
  const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
  let app;
  try {
    const response = await fetchImpl(API, { headers });
    if (!response.ok) return fail(log, `Discord refused to describe the application (HTTP ${response.status}).`);
    app = await response.json();
  } catch (error) {
    return fail(log, `Could not reach Discord to check the application: ${error.message || error}`);
  }
  const flags = Number(app.flags || 0);
  if (flags & (GATEWAY_MESSAGE_CONTENT | GATEWAY_MESSAGE_CONTENT_LIMITED)) {
    return { ok: true, changed: false, appId: app.id, flags };
  }
  const wanted = flags | GATEWAY_MESSAGE_CONTENT_LIMITED;
  try {
    const response = await fetchImpl(API, { method: 'PATCH', headers, body: JSON.stringify({ flags: wanted }) });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return fail(log, `Discord rejected enabling the Message Content intent (HTTP ${response.status}) ${detail}`.trim(), app.id);
    }
    const updated = await response.json();
    const newFlags = Number(updated.flags || 0);
    if (!(newFlags & (GATEWAY_MESSAGE_CONTENT | GATEWAY_MESSAGE_CONTENT_LIMITED))) {
      return fail(log, 'Discord accepted the request but the Message Content intent is still off.', app.id);
    }
    log.log(`Message Content intent enabled on application ${app.id} (${app.name || 'unnamed'}).`);
    return { ok: true, changed: true, appId: app.id, flags: newFlags };
  } catch (error) {
    return fail(log, `Could not enable the Message Content intent: ${error.message || error}`, app.id);
  }
}

function fail(log, message, appId) {
  const where = appId
    ? `https://discord.com/developers/applications/${appId}/bot`
    : 'https://discord.com/developers/applications';
  log.warn(`${message} Turn on "Message Content Intent" under Privileged Gateway Intents at ${where} and restart this service.`);
  return { ok: false, reason: message, appId };
}
