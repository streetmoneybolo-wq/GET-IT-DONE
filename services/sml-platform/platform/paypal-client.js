'use strict';

/**
 * PayPal REST client for the dispute-evidence system.
 *
 * Fixed-host policy: every request goes to the single base URL selected by
 * SML_PAYPAL_ENV at construction time (api-m.paypal.com or
 * api-m.sandbox.paypal.com), https only, no redirect following, bounded
 * response sizes. No URL is ever built from caller-supplied host material —
 * ids are path-encoded into fixed templates.
 *
 * Error convention: anything ambiguous (transport failure, 5xx, 429, token
 * trouble, an unparseable or unexpected verify outcome) throws an Error with
 * `retryable = true` so the webhook handler can map it to 503 and let PayPal
 * redeliver. Only a definitive provider answer produces a non-retryable
 * result. Input validation failures throw TypeError (the 400 convention).
 *
 * Secrets are referenced by env name only and never logged; this module does
 * not log at all.
 */

const crypto = require('node:crypto');

const HOSTS = Object.freeze({
  live: 'https://api-m.paypal.com',
  sandbox: 'https://api-m.sandbox.paypal.com'
});

/* Mirror of provider-limits PAYPAL_FILE_RULES (kept as a local constant —
   cross-package requires are forbidden; the values are fixed by PayPal docs:
   https://developer.paypal.com/docs/api/customer-disputes/v1/ */
const PAYPAL_FILE_RULES = Object.freeze({
  types: Object.freeze(['jpg', 'jpeg', 'gif', 'png', 'pdf']),
  perFileBytes: 10 * 1024 * 1024,   // each file must be strictly under 10MB
  perRequestBytes: 50 * 1024 * 1024, // whole request at most 50MB
  notesMax: 2000
});

const CONTENT_TYPES = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  png: 'image/png',
  pdf: 'application/pdf'
});

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function retryableError(message, cause) {
  const error = new Error(message);
  error.retryable = true;
  if (cause) error.cause = cause;
  return error;
}

function providerError(message, status) {
  const error = new Error(message);
  error.retryable = false;
  error.statusCode = status;
  return error;
}

async function readBoundedText(response, maxBytes) {
  const declared = Number(response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('content-length') : NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw retryableError('paypal response is too large');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw retryableError('paypal response is too large');
  }
  return text;
}

async function readBoundedJson(response, maxBytes) {
  const text = await readBoundedText(response, maxBytes);
  try {
    return text ? JSON.parse(text) : {};
  } catch (cause) {
    throw retryableError('paypal returned unparseable JSON', cause);
  }
}

function requireId(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 191) {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

function fileExtension(name) {
  const at = name.lastIndexOf('.');
  return at > 0 ? name.slice(at + 1).toLowerCase() : '';
}

/**
 * Validate an evidence payload against PAYPAL_FILE_RULES and return the
 * normalized parts. Every violation is a TypeError — nothing is silently
 * trimmed or dropped, because a submission must show exactly what was
 * reviewed.
 */
function validateEvidencePayload({ evidences = [], files = [], notes = null } = {}) {
  if (!Array.isArray(evidences)) throw new TypeError('evidences must be an array');
  if (!Array.isArray(files)) throw new TypeError('files must be an array');

  for (const evidence of evidences) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      throw new TypeError('each evidence entry must be an object');
    }
    if (typeof evidence.evidence_type !== 'string' || !evidence.evidence_type.trim()) {
      throw new TypeError('each evidence entry requires an evidence_type');
    }
    if (evidence.notes != null &&
        (typeof evidence.notes !== 'string' || evidence.notes.length > PAYPAL_FILE_RULES.notesMax)) {
      throw new TypeError(`evidence notes must be a string of at most ${PAYPAL_FILE_RULES.notesMax} characters`);
    }
  }

  if (notes != null &&
      (typeof notes !== 'string' || !notes.trim() || notes.length > PAYPAL_FILE_RULES.notesMax)) {
    throw new TypeError(`notes must be a non-empty string of at most ${PAYPAL_FILE_RULES.notesMax} characters`);
  }

  let totalFileBytes = 0;
  for (const file of files) {
    if (!file || typeof file !== 'object') throw new TypeError('each file must be an object');
    if (typeof file.name !== 'string' || !file.name || file.name.length > 200 ||
        /["\\\r\n/]/.test(file.name)) {
      throw new TypeError('file name is missing or contains unsupported characters');
    }
    const extension = fileExtension(file.name);
    if (!PAYPAL_FILE_RULES.types.includes(extension)) {
      throw new TypeError(`file type .${extension || '?'} is not accepted (allowed: ${PAYPAL_FILE_RULES.types.join(', ')})`);
    }
    if (!Buffer.isBuffer(file.bytes) || file.bytes.length === 0) {
      throw new TypeError('file bytes must be a non-empty Buffer');
    }
    if (file.bytes.length >= PAYPAL_FILE_RULES.perFileBytes) {
      throw new TypeError('each evidence file must be smaller than 10MB');
    }
    totalFileBytes += file.bytes.length;
  }
  if (totalFileBytes > PAYPAL_FILE_RULES.perRequestBytes) {
    throw new TypeError('evidence files exceed the 50MB per-request limit');
  }

  const inputEvidences = evidences.slice();
  if (notes != null) inputEvidences.push({ evidence_type: 'OTHER', notes });
  if (!inputEvidences.length && !files.length) {
    throw new TypeError('at least one evidence entry, note, or file is required');
  }
  return { evidences: inputEvidences, files };
}

/**
 * Build the multipart/form-data body for provide-evidence / appeal: one
 * `input` JSON part with the evidences array, then one part per file.
 * Deterministic given the boundary, so tests can assert exact shape.
 */
function buildEvidenceBody(payload, boundary = `sml${crypto.randomBytes(12).toString('hex')}`) {
  const { evidences, files } = validateEvidencePayload(payload);
  const parts = [];
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="input"\r\n' +
    'Content-Type: application/json\r\n\r\n' +
    `${JSON.stringify({ evidences })}\r\n`, 'utf8'));
  files.forEach((file, index) => {
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file${index + 1}"; filename="${file.name}"\r\n` +
      `Content-Type: ${CONTENT_TYPES[fileExtension(file.name)]}\r\n\r\n`, 'utf8'));
    parts.push(file.bytes);
    parts.push(Buffer.from('\r\n', 'utf8'));
  });
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  const body = Buffer.concat(parts);
  if (body.length > PAYPAL_FILE_RULES.perRequestBytes) {
    throw new TypeError('evidence request exceeds the 50MB per-request limit');
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function createPayPalClient({ env, clientId, clientSecret, fetchImpl = fetch, now = Date.now }) {
  const base = HOSTS[env];
  if (!base) throw new TypeError('SML_PAYPAL_ENV must be sandbox or live');
  if (!clientId || !clientSecret) {
    throw new Error('PayPal API credentials are not configured (SML_PAYPAL_CLIENT_ID / SML_PAYPAL_CLIENT_SECRET)');
  }

  let cachedToken = null;
  let tokenExpiresAt = 0;

  async function token() {
    if (cachedToken && tokenExpiresAt > now() + 60_000) return cachedToken;
    let response;
    try {
      response = await fetchImpl(`${base}/v1/oauth2/token`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });
    } catch (cause) {
      throw retryableError('paypal token request failed (transport)', cause);
    }
    if (!response.ok) throw retryableError(`paypal token request failed (${response.status})`);
    const data = await readBoundedJson(response, MAX_RESPONSE_BYTES);
    if (!data.access_token) throw retryableError('paypal returned no access token');
    cachedToken = data.access_token;
    tokenExpiresAt = now() + Math.max(60, Number(data.expires_in || 3600)) * 1000;
    return cachedToken;
  }

  async function api(method, path, { query, body, contentType, maxBytes = MAX_RESPONSE_BYTES } = {}) {
    const accessToken = await token();
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value != null) url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(contentType ? { 'Content-Type': contentType } : {})
        },
        ...(body != null ? { body } : {})
      });
    } catch (cause) {
      throw retryableError(`paypal request failed (transport): ${method} ${path}`, cause);
    }
    if (response.status === 401) {
      cachedToken = null; // stale token — a redelivery will mint a fresh one
      throw retryableError('paypal rejected the access token (401)');
    }
    if (response.status === 429 || response.status >= 500) {
      throw retryableError(`paypal request failed (${response.status})`);
    }
    if (!response.ok) {
      throw providerError(`paypal request was rejected (${response.status})`, response.status);
    }
    return readBoundedJson(response, maxBytes);
  }

  async function getDispute(id) {
    return api('GET', `/v1/customer/disputes/${encodeURIComponent(requireId(id, 'dispute id'))}`);
  }

  async function listDisputes({ after } = {}) {
    if (after != null && (typeof after !== 'string' || !after.trim())) {
      throw new TypeError('after must be an RFC3339 timestamp string');
    }
    return api('GET', '/v1/customer/disputes', {
      query: { page_size: 50, ...(after ? { update_time_after: after } : {}) }
    });
  }

  async function provideEvidence(id, payload) {
    const disputeId = requireId(id, 'dispute id');
    const { body, contentType } = buildEvidenceBody(payload || {});
    return api('POST', `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`,
      { body, contentType });
  }

  async function appeal(id, payload) {
    const disputeId = requireId(id, 'dispute id');
    const { body, contentType } = buildEvidenceBody(payload || {});
    return api('POST', `/v1/customer/disputes/${encodeURIComponent(disputeId)}/appeal`,
      { body, contentType });
  }

  async function getSubscription(id) {
    return api('GET', `/v1/billing/subscriptions/${encodeURIComponent(requireId(id, 'subscription id'))}`);
  }

  async function getCapture(id) {
    return api('GET', `/v2/payments/captures/${encodeURIComponent(requireId(id, 'capture id'))}`);
  }

  /**
   * Verify a webhook delivery via PayPal's verify-webhook-signature API.
   *
   * THE RULE THAT MATTERS (DESIGN §4b(7)): the raw webhook bytes are SPLICED
   * verbatim into the webhook_event position by string concatenation. A
   * re-serialized object (JSON.parse → stringify) can change key order,
   * unicode escapes, or number rendering ("10.00" → "10") and PayPal would
   * then verify different bytes than it signed, failing every delivery that
   * happens to carry such a payload.
   *
   * Returns 'SUCCESS' | 'FAILURE'. Everything else — transport failure, 5xx,
   * a non-2xx answer, an unrecognized verification_status — throws a
   * retryable error the handler maps to 503 so PayPal redelivers.
   */
  async function verifyWebhookSignature({ headers, rawBody, webhookId }) {
    if (!webhookId || typeof webhookId !== 'string') {
      throw retryableError('paypal webhook id is not configured (SML_PAYPAL_WEBHOOK_ID)');
    }
    if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) {
      throw new TypeError('rawBody must be the raw webhook string or Buffer');
    }
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const lower = {};
    for (const [key, value] of Object.entries(headers || {})) lower[key.toLowerCase()] = value;
    for (const name of ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id',
      'paypal-transmission-sig', 'paypal-transmission-time']) {
      if (typeof lower[name] !== 'string' || !lower[name]) {
        throw new TypeError(`missing webhook header ${name}`);
      }
    }

    const body = '{' +
      `"auth_algo":${JSON.stringify(lower['paypal-auth-algo'])},` +
      `"cert_url":${JSON.stringify(lower['paypal-cert-url'])},` +
      `"transmission_id":${JSON.stringify(lower['paypal-transmission-id'])},` +
      `"transmission_sig":${JSON.stringify(lower['paypal-transmission-sig'])},` +
      `"transmission_time":${JSON.stringify(lower['paypal-transmission-time'])},` +
      `"webhook_id":${JSON.stringify(webhookId)},` +
      '"webhook_event":' + raw +
      '}';

    const accessToken = await token();
    let response;
    try {
      response = await fetchImpl(`${base}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body
      });
    } catch (cause) {
      throw retryableError('paypal verify-webhook-signature failed (transport)', cause);
    }
    if (response.status === 401) {
      cachedToken = null;
      throw retryableError('paypal rejected the access token (401)');
    }
    if (!response.ok) {
      /* Even a 4xx here is ambiguous — it says nothing definitive about the
         delivery's authenticity, so the caller must 503 and let PayPal retry
         rather than acknowledging or rejecting on our own authority. */
      throw retryableError(`paypal verify-webhook-signature failed (${response.status})`);
    }
    const data = await readBoundedJson(response, MAX_RESPONSE_BYTES);
    if (data.verification_status === 'SUCCESS') return 'SUCCESS';
    if (data.verification_status === 'FAILURE') return 'FAILURE';
    throw retryableError('paypal verify-webhook-signature returned an ambiguous outcome');
  }

  return {
    getDispute,
    listDisputes,
    provideEvidence,
    appeal,
    getSubscription,
    getCapture,
    verifyWebhookSignature
  };
}

module.exports = {
  HOSTS,
  MAX_RESPONSE_BYTES,
  PAYPAL_FILE_RULES,
  buildEvidenceBody,
  createPayPalClient,
  validateEvidencePayload
};
