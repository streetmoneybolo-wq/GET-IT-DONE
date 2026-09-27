'use strict';

const API = 'https://api.upgrade.chat/v1';
const TOKEN_URL = 'https://api.upgrade.chat/oauth/token';

function addUtc(date, interval, count) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) throw new TypeError('invalid charge date');
  if (!Number.isSafeInteger(count) || count < 1 || count > 365) throw new TypeError('invalid billing interval count');
  if (interval === 'day') d.setUTCDate(d.getUTCDate() + count);
  else if (interval === 'week') d.setUTCDate(d.getUTCDate() + 7 * count);
  else if (interval === 'month') d.setUTCMonth(d.getUTCMonth() + count);
  else if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + count);
  else throw new TypeError('unsupported billing interval');
  return d;
}

function orderRenewal(order, productUuid, now = Date.now()) {
  if (!order || !order.is_subscription || order.deleted) return null;
  const item = (order.order_items || []).find((entry) =>
    entry && entry.product && String(entry.product.uuid) === String(productUuid));
  if (!item || !item.interval) return null;
  const count = Number(item.interval_count || 1);
  const start = order.last_succeeded_charge && order.last_succeeded_charge.payment_processor_created
    ? order.last_succeeded_charge.payment_processor_created : order.purchased_at;
  const renewal = addUtc(start, item.interval, count);
  /* Never roll a stale charge forward through unpaid cycles. The next date
     after the last successful charge is the paid-through boundary; once it is
     past, this order cannot prove current access. */
  if (renewal.getTime() <= now) return null;
  return {
    externalReference: String(order.uuid || ''),
    renewalAt: renewal.toISOString(),
    cancelledAt: order.cancelled_at || null,
    productUuid: String(productUuid)
  };
}

/* Identifier segments spliced into API paths. Upgrade.Chat ids are UUIDs, but
   the check is deliberately a hair wider (plain alphanumerics with - and _)
   so it stays a path-safety gate, not a provider-format oracle. */
const PATH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function pathId(value, label) {
  const id = String(value == null ? '' : value).trim();
  if (!PATH_ID_RE.test(id)) throw new TypeError(`invalid Upgrade.Chat ${label}`);
  return encodeURIComponent(id);
}

/* timeoutMs (optional, off by default): every request is aborted after this
   many milliseconds, so a caller that must not wait on Upgrade.Chat (the
   Academy billing engine) gets an error instead of a hung promise. */
function createUpgradeChatClient({ clientId, clientSecret, fetchImpl = fetch, now = Date.now, timeoutMs = null }) {
  if (!clientId || !clientSecret) throw new Error('Upgrade.Chat API credentials are not configured');
  let cachedToken = null;
  let tokenExpiresAt = 0;
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : null;
  async function call(url, init) {
    if (!limit) return fetchImpl(url, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Upgrade.Chat request timed out after ${limit} ms`)), limit);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function token() {
    if (cachedToken && tokenExpiresAt > now() + 60_000) return cachedToken;
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    const response = await call(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });
    if (!response.ok) throw new Error(`Upgrade.Chat token request failed (${response.status})`);
    const data = await response.json();
    if (!data.access_token) throw new Error('Upgrade.Chat returned no access token');
    cachedToken = data.access_token;
    tokenExpiresAt = now() + Math.max(60, Number(data.expires_in || 3600)) * 1000;
    return cachedToken;
  }

  async function apiGet(path) {
    const accessToken = await token();
    const response = await call(`${API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error(`Upgrade.Chat request failed (${response.status})`);
    return response.json();
  }

  /* Webhook-event support (dispute-evidence). Upgrade.Chat webhooks are
     UNSIGNED, so the inbound POST body is never trusted: the webhook handler
     only extracts an id, then uses these authenticated reads to confirm the
     event is genuine and to fetch the authoritative body from the API. */
  async function validateWebhookEvent(webhookEventId) {
    return apiGet(`/webhook-events/${pathId(webhookEventId, 'webhook event id')}/validate`);
  }

  async function getWebhookEvent(webhookEventId) {
    return apiGet(`/webhook-events/${pathId(webhookEventId, 'webhook event id')}`);
  }

  async function getOrder(orderUuid) {
    return apiGet(`/orders/${pathId(orderUuid, 'order uuid')}`);
  }

  async function findMembership({ discordUserId, productUuid }) {
    const accessToken = await token();
    const url = new URL(`${API}/orders`);
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', '0');
    url.searchParams.set('userDiscordId', String(discordUserId));
    url.searchParams.set('type', 'UPGRADE');
    const response = await call(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Upgrade.Chat orders request failed (${response.status})`);
    const payload = await response.json();
    const matches = (payload.data || []).map((order) => orderRenewal(order, productUuid, now())).filter(Boolean);
    matches.sort((a, b) => new Date(b.renewalAt) - new Date(a.renewalAt));
    if (!matches[0]) throw new TypeError('no eligible Upgrade.Chat subscription was found for this Discord account');
    return matches[0];
  }

  /* Every UPGRADE order of one Discord account, paged 100 at a time up to
     maxPages. findMembership reads only the first page and only
     subscriptions; this is for callers that must also see one-time
     (lifetime) products and older pages. complete=false when the page cap
     was hit: a caller that needs a conclusive "no membership" must then
     treat the answer as unknown. */
  async function listOrders({ discordUserId, maxPages = 10 }) {
    if (!/^[0-9]{15,24}$/.test(String(discordUserId))) throw new TypeError('invalid Discord user id');
    const accessToken = await token();
    const orders = [];
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(`${API}/orders`);
      url.searchParams.set('limit', '100');
      url.searchParams.set('offset', String(page * 100));
      url.searchParams.set('userDiscordId', String(discordUserId));
      url.searchParams.set('type', 'UPGRADE');
      const response = await call(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error(`Upgrade.Chat orders request failed (${response.status})`);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.data)) throw new Error('Upgrade.Chat orders response has no data list');
      orders.push(...payload.data);
      if (payload.data.length < 100 && payload.has_more !== true) return { data: orders, complete: true };
    }
    return { data: orders, complete: false };
  }

  return { findMembership, listOrders, validateWebhookEvent, getWebhookEvent, getOrder };
}

module.exports = { createUpgradeChatClient, orderRenewal, addUtc, API, TOKEN_URL };
