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

function createUpgradeChatClient({ clientId, clientSecret, fetchImpl = fetch, now = Date.now }) {
  if (!clientId || !clientSecret) throw new Error('Upgrade.Chat API credentials are not configured');
  let cachedToken = null;
  let tokenExpiresAt = 0;

  async function token() {
    if (cachedToken && tokenExpiresAt > now() + 60_000) return cachedToken;
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    const response = await fetchImpl(TOKEN_URL, {
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

  async function findMembership({ discordUserId, productUuid }) {
    const accessToken = await token();
    const url = new URL(`${API}/orders`);
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', '0');
    url.searchParams.set('userDiscordId', String(discordUserId));
    url.searchParams.set('type', 'UPGRADE');
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Upgrade.Chat orders request failed (${response.status})`);
    const payload = await response.json();
    const matches = (payload.data || []).map((order) => orderRenewal(order, productUuid, now())).filter(Boolean);
    matches.sort((a, b) => new Date(b.renewalAt) - new Date(a.renewalAt));
    if (!matches[0]) throw new TypeError('no eligible Upgrade.Chat subscription was found for this Discord account');
    return matches[0];
  }

  return { findMembership };
}

module.exports = { createUpgradeChatClient, orderRenewal, addUtc, API, TOKEN_URL };
