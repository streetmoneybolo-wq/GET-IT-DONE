'use strict';

/* Publishes a Click-to-Alert to a StockMarketLoop group under the member's own site account (signed call to the site's alert-publish route).
   The site then hands it to the Alert Bot, which posts the typed text and the two scenario pictures in Discord. */
const crypto = require('node:crypto');

function createSmlPublisher({ baseUrl = '', secret = '', groupId = '', fetchImpl = fetch, now = Date.now } = {}) {
  const root = String(baseUrl || '').trim().replace(/\/+$/, '');
  const gid = Number.parseInt(groupId, 10);
  const configured = /^https:\/\//i.test(root) && String(secret).length >= 32 && Number.isSafeInteger(gid) && gid > 0;
  async function publish({ discordUserId, ref, body, meta = {}, images = [] }) {
    if (!configured) return { ok: false, status: 503, error: 'publisher_unconfigured' };
    const path = '/wp-json/sml-loop-kick/v1/alert-publish';
    const payload = JSON.stringify({
      discord_user_id: String(discordUserId), group_id: gid, ref: String(ref), body: String(body), meta,
      images: (images || []).slice(0, 2).map((i) => ({ name: i.name, alt: i.alt, b64: Buffer.from(i.bytes).toString('base64') }))
    });
    const ts = String(Math.floor(now() / 1000));
    const sig = crypto.createHmac('sha256', String(secret)).update(`${ts}.${path}.${crypto.createHash('sha256').update(payload).digest('hex')}`).digest('hex');
    let res;
    try { res = await fetchImpl(`${root}${path}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-sml-lk-timestamp': ts, 'x-sml-lk-signature': `sha256=${sig}` }, body: payload, signal: AbortSignal.timeout(25_000) }); }
    catch (_) { return { ok: false, status: 503, error: 'publisher_unavailable' }; }
    let data = null; try { data = await res.json(); } catch (_) { data = null; }
    if (res.ok && data && data.ok === true) return { ok: true, postId: data.postId, status: data.status, images: data.images, url: data.url };
    if (data && typeof data.error === 'string' && res.status === 403) return { ok: false, status: 403, error: data.error };
    return { ok: false, status: 503, error: 'publisher_unavailable' };
  }
  return { configured, groupId: gid, publish };
}

module.exports = { createSmlPublisher };
