'use strict';

/* Quick Snapshot for the Academy Live Chart Lab: the member snaps the chart exactly as they see it (their drawings, overlays and zoom included) and it posts
 * straight to a Discord channel they can post in.
 *
 * The picture is made in the member's browser, so the server cannot know what it shows. Because the Academy app is what posts it, the server treats the upload as
 * untrusted: it must be a well-formed PNG chart-sized image under a hard size cap, only into a channel where BOTH the member and the app may send messages and attach
 * files (checked live), never with a mention, rate-limited per member and per channel, attributed to the member by name, and logged. */

const SNOWFLAKE = /^\d{15,25}$/;
const MAX_BYTES = 2_500_000;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LIMITS = { userHour: 12, userDay: 60, channelHour: 40 };

/* A PNG must start with the signature, then IHDR with sane dimensions, then well-formed chunks to a closing IEND with nothing after it. Returns { width, height } or null. */
function inspectPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 70 || buf.length > MAX_BYTES || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let off = 8, width = 0, height = 0, first = true, idat = false;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    if (len > buf.length - off - 12) return null;
    if (first) { if (type !== 'IHDR' || len !== 13) return null; width = buf.readUInt32BE(off + 8); height = buf.readUInt32BE(off + 12); first = false; }
    if (type === 'IDAT') idat = true;
    off += 12 + len;
    if (type === 'IEND') return off === buf.length && idat && width >= 300 && width <= 3200 && height >= 200 && height <= 2400 && width / height <= 4 && height / width <= 2 ? { width, height } : null;
  }
  return null;
}

const cleanSymbol = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9.:-]/g, '').slice(0, 10);
const cleanTf = (v) => (/^(1m|3m|5m|10m|15m|30m|1h|2h|4h|1D|1W|1M|1Q|1Y)$/.test(String(v)) ? String(v) : '');
const cleanNote = (v) => String(v || '').replace(/[\u0000-\u001f<>@`*_~|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);

function createSnapshotService({ directory, now = Date.now, logger = () => {}, limits = {} } = {}) {
  const lim = { ...LIMITS, ...limits };
  const hits = new Map(); // key -> timestamps
  const count = (key, windowMs) => { const cut = now() - windowMs; const list = (hits.get(key) || []).filter((t) => t > cut); hits.set(key, list); return list.length; };
  const mark = (key) => { const list = hits.get(key) || []; list.push(now()); hits.set(key, list); if (hits.size > 5000) hits.delete(hits.keys().next().value); };

  const destinations = (userId, current = '') => directory.guildsFor(String(userId), SNOWFLAKE.test(String(current)) ? String(current) : '');
  const channels = (userId, guildId) => (SNOWFLAKE.test(String(guildId)) ? directory.sendableChannels(String(guildId), String(userId)) : null);

  async function send(user, { channelId, png, symbol, tf, note } = {}) {
    const userId = String(user.userId || '');
    if (!SNOWFLAKE.test(String(channelId))) return { ok: false, status: 400, code: 'invalid_channel' };
    const info = inspectPng(png);
    if (!info) return { ok: false, status: 422, code: 'invalid_image', detail: 'The snapshot must be a PNG chart image under 2.5 MB.' };
    const where = await directory.postingIn(userId, String(channelId)).catch(() => null);
    if (!where) return { ok: false, status: 404, code: 'channel_unavailable', detail: 'The Academy app is not installed in that server, or the channel could not be found.' };
    if (!where.userCanSend) return { ok: false, status: 403, code: 'you_cannot_post_there', detail: 'You do not have permission to send messages in that channel.' };
    if (!where.userCanAttach) return { ok: false, status: 403, code: 'you_cannot_attach_there', detail: 'You do not have permission to attach images in that channel.' };
    if (!where.botCanSend || !where.botCanAttach) return { ok: false, status: 403, code: 'app_cannot_post_there', detail: 'The Academy app cannot send images in that channel. Ask a server admin to allow it, or pick another channel.' };
    if (count('u:' + userId, 3_600_000) >= lim.userHour) return { ok: false, status: 429, code: 'rate_limited', detail: 'You are snapping too quickly. Try again in a few minutes.' };
    if (count('ud:' + userId, 86_400_000) >= lim.userDay) return { ok: false, status: 429, code: 'rate_limited', detail: 'You have reached the daily snapshot limit.' };
    if (count('c:' + channelId, 3_600_000) >= lim.channelHour) return { ok: false, status: 429, code: 'rate_limited', detail: 'This channel has reached its hourly snapshot limit.' };
    const sym = cleanSymbol(symbol), frame = cleanTf(tf), text = cleanNote(note);
    const who = String(user.displayName || 'an Academy member').replace(/[\u0000-\u001f<>@`*_~|]/g, '').slice(0, 40);
    const content = '📸 ' + (sym ? '$' + sym : 'Chart') + (frame ? ' · ' + frame : '') + ' snapshot' + (text ? ' — ' + text : '') + '\n-# Shared by ' + who + ' from the Making Easy Money Academy · educational, not financial advice';
    const name = (sym ? sym.toLowerCase().replace(/[^a-z0-9]/g, '') : 'chart') + '-snapshot.png';
    const posted = await directory.post(String(channelId), { content, allowed_mentions: { parse: [] } }, [{ name, bytes: png, contentType: 'image/png', alt: (sym || 'Chart') + (frame ? ' ' + frame : '') + ' chart snapshot shared from the Academy Live Chart Lab' }]);
    mark('u:' + userId); mark('ud:' + userId); mark('c:' + channelId);
    logger('info', 'academy_snapshot_sent', { userId, channelId: String(channelId), guildId: where.guildId, bytes: png.length, width: info.width, height: info.height });
    return { ok: true, messageId: posted.id, channelId: posted.channelId, channelName: where.name };
  }
  return { send, destinations, channels };
}

module.exports = { createSnapshotService, inspectPng, MAX_BYTES, LIMITS };
