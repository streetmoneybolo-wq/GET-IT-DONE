import { createHmac, timingSafeEqual } from 'node:crypto';

const PLATFORMS = new Set(['reddit', 'x', 'stocktwits', 'bluesky', 'threads', 'facebook']);

function config() {
  const endpoint = String(process.env.TRACKING_API_URL || '').trim().replace(/\/$/, '');
  const secret = String(process.env.TRACKING_SECRET || '').trim();
  if (!endpoint || !secret) throw new Error('Outbound tracking is not configured. Set TRACKING_API_URL and TRACKING_SECRET.');
  return { endpoint, secret };
}

function actorKey(secret, guildId, userId) {
  return createHmac('sha256', secret).update(`${guildId}:${userId}`).digest('hex');
}

function signedHeaders(secret, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`${timestamp}\n${body}`).digest('hex');
  return {
    'content-type': 'application/json',
    'x-sml-share-timestamp': timestamp,
    'x-sml-share-signature': `sha256=${signature}`,
  };
}

async function signedRequest(path, payload) {
  const { endpoint, secret } = config();
  const body = JSON.stringify(payload);
  const response = await fetch(`${endpoint}${path}`, {
    method: 'POST',
    headers: signedHeaders(secret, body),
    body,
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Tracking service returned HTTP ${response.status}.`);
  return data;
}

export function isShareButton(customId) {
  return /^sml-share:[0-9a-f-]{36}:[a-z]+$/i.test(String(customId || ''));
}

export function parseShareButton(customId) {
  const [, postID, platform] = String(customId || '').split(':');
  if (!postID || !PLATFORMS.has(platform)) return null;
  return { postID, platform };
}

export async function registerTrackedRedirect({ post, platform, userId, guildId }) {
  if (!PLATFORMS.has(platform) || !post.platformUrls?.[platform]) throw new Error('That share destination is unavailable.');
  const { secret } = config();
  return signedRequest('/register', {
    post_id: post.postID,
    actor_key: actorKey(secret, guildId, userId),
    platform,
    destination_url: post.platformUrls[platform],
  });
}

export async function fetchTrackingSummary(postID = '') {
  return signedRequest('/summary', { post_id: postID });
}

// Exported only for deterministic tests without exposing the configured secret.
export function verifyTestSignature(secret, timestamp, body, received) {
  const expected = createHmac('sha256', secret).update(`${timestamp}\n${body}`).digest();
  const actual = Buffer.from(String(received).replace(/^sha256=/, ''), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
