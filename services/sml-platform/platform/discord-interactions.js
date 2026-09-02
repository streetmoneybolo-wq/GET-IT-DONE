'use strict';

/**
 * POST /v1/discord/interactions — SML Connect interactions endpoint.
 *
 * Signature verification per DESIGN §4b(10): Discord signs
 * `timestamp || rawBody` with Ed25519. On Node 22 `crypto.verify('ed25519')`
 * throws, so the public key is materialised ONCE as a KeyObject from the SPKI
 * DER prefix 302a300506032b6570032100 + the 32-byte raw key
 * (SML_DISCORD_CONNECT_PUBLIC_KEY, hex — env NAME only, value never logged),
 * and verification is `crypto.verify(null, message, keyObject, signature)`.
 *
 * Discord probes this endpoint with deliberately bad signatures and removes
 * endpoints that fail to 401 them, so every invalid/missing signature — PING
 * included — is a 401. Missing configuration fails closed with 503
 * integration_unconfigured, matching the existing webhook convention.
 *
 * Every interaction response and every follow-up carries flags 64 (ephemeral).
 * Slow commands answer type 5 (deferred) and the command handler's followUp
 * result is delivered via POST /webhooks/{appId}/{token} with the injected
 * fetch — 429-aware with a bounded retry.
 */

const crypto = require('node:crypto');
const connectCommands = require('./connect-commands');

const MAX_BODY_BYTES = 64 * 1024;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const SIGNATURE_RE = /^[0-9a-f]{128}$/i;
const PUBLIC_KEY_RE = /^[0-9a-f]{64}$/i;
const SNOWFLAKE_RE = /^[0-9]{15,24}$/;
const WEBHOOK_TOKEN_RE = /^[A-Za-z0-9._-]{1,300}$/;
const FOLLOW_UP_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5000;

const EPHEMERAL = connectCommands.EPHEMERAL;

function buildPublicKey(hexValue) {
  const hex = String(hexValue || '').trim();
  if (!PUBLIC_KEY_RE.test(hex)) return null;
  try {
    return crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, 'hex')]),
      format: 'der',
      type: 'spki'
    });
  } catch (_) {
    return null;
  }
}

function verifyEd25519(publicKeyObject, timestamp, bodyBuffer, signatureHex) {
  try {
    return crypto.verify(
      null,
      Buffer.concat([Buffer.from(String(timestamp), 'utf8'), bodyBuffer]),
      publicKeyObject,
      Buffer.from(signatureHex, 'hex')
    );
  } catch (_) {
    return false;
  }
}

function respond(response, status, body) {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(json)
  });
  response.end(json);
}

function toBodyBuffer(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  return null;
}

function createDiscordInteractions(deps = {}) {
  const { config = {}, pool, graph, disputeService, store } = deps;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now || Date.now;

  const publicKeyObject = buildPublicKey(config.discordConnectPublicKey);
  const appId = SNOWFLAKE_RE.test(String(config.discordConnectAppId || ''))
    ? String(config.discordConnectAppId) : null;

  /* Command handlers live in ./connect-commands (same package); every
   * cross-package collaborator is still injected, never required. */
  const commands = deps.commands || connectCommands.createConnectCommands({
    pool,
    graph,
    disputeService,
    store,
    authorize: deps.authorize,
    reconciler: deps.reconciler,
    now,
    reviewUrlBase: config.reviewUrlBase
  });

  /* 429-aware follow-up sender. The webhook URL embeds the interaction token,
   * so neither the URL nor any error detail is ever logged. */
  async function sendFollowUp(interaction, payload) {
    if (!appId || typeof fetchImpl !== 'function') return null;
    const webhookToken = interaction && typeof interaction.token === 'string' ? interaction.token : '';
    if (!WEBHOOK_TOKEN_RE.test(webhookToken)) return null;
    const url = `https://discord.com/api/v10/webhooks/${appId}/${webhookToken}`;
    const body = JSON.stringify(Object.assign({}, payload, { flags: EPHEMERAL }));

    let status = null;
    for (let attempt = 0; attempt < FOLLOW_UP_ATTEMPTS; attempt += 1) {
      let result;
      try {
        result = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body
        });
      } catch (_) {
        return null;
      }
      status = result && Number(result.status);
      if (status !== 429) return status;

      let retryAfterSeconds = 1;
      try {
        const parsed = result && typeof result.json === 'function' ? await result.json() : null;
        if (parsed && Number.isFinite(Number(parsed.retry_after))) {
          retryAfterSeconds = Number(parsed.retry_after);
        }
      } catch (_) { /* fall back to the default delay */ }
      await sleep(Math.min(MAX_RETRY_DELAY_MS, Math.max(0, retryAfterSeconds * 1000)));
    }
    return status;
  }

  async function handleRequest(request, response, rawBody) {
    if (!publicKeyObject) {
      respond(response, 503, { error: 'integration_unconfigured' });
      return;
    }

    const bodyBuffer = toBodyBuffer(rawBody);
    if (!bodyBuffer) {
      respond(response, 400, { error: 'raw_body_required' });
      return;
    }
    if (bodyBuffer.length > MAX_BODY_BYTES) {
      respond(response, 413, { error: 'payload_too_large' });
      return;
    }

    const headers = (request && request.headers) || {};
    const signature = String(headers['x-signature-ed25519'] || '');
    const timestamp = String(headers['x-signature-timestamp'] || '');
    if (!SIGNATURE_RE.test(signature) || !timestamp || timestamp.length > 32 ||
        !verifyEd25519(publicKeyObject, timestamp, bodyBuffer, signature)) {
      respond(response, 401, { error: 'invalid_signature' });
      return;
    }

    let interaction;
    try {
      interaction = JSON.parse(bodyBuffer.toString('utf8'));
    } catch (_) {
      respond(response, 400, { error: 'invalid_json' });
      return;
    }
    if (!interaction || typeof interaction !== 'object' || Array.isArray(interaction)) {
      respond(response, 400, { error: 'invalid_interaction' });
      return;
    }

    if (interaction.type === 1) {
      respond(response, 200, { type: 1 });
      return;
    }

    if (interaction.type !== 2) {
      respond(response, 200, {
        type: 4,
        data: { content: 'This interaction is not supported.', flags: EPHEMERAL }
      });
      return;
    }

    let result;
    try {
      result = await commands.handleCommand(interaction);
    } catch (_) {
      respond(response, 200, {
        type: 4,
        data: { content: 'The command could not be completed. Please try again later.', flags: EPHEMERAL }
      });
      return;
    }

    respond(response, 200, result.response);

    if (typeof result.followUp === 'function') {
      try {
        const payload = await result.followUp();
        if (payload) await sendFollowUp(interaction, payload);
      } catch (_) {
        /* The deferred acknowledgement was already sent; nothing safe to log
         * here (the interaction token must never reach a log line). */
      }
    }
  }

  return { handleRequest, sendFollowUp };
}

module.exports = {
  MAX_BODY_BYTES,
  buildPublicKey,
  createDiscordInteractions,
  verifyEd25519
};
