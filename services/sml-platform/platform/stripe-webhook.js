'use strict';

/**
 * Stripe webhook verification and parsing.
 *
 * Deliberately hand-rolled rather than calling stripe.webhooks.constructEvent:
 * the scheme is small and stable, and doing it here keeps this module pure and
 * unit-testable with no dependency and no network — the same shape as
 * wordpress-gateway.js next door.
 *
 * THE RULE THAT MATTERS: the signature is computed over the EXACT bytes Stripe
 * sent. Parsing JSON and re-serialising, or letting a body-parser touch the
 * request first, changes those bytes and every signature fails. This module
 * therefore only ever accepts a raw string, and never parses before verifying.
 */

const crypto = require('node:crypto');

/* Stripe's own limit is well under this; the cap exists so an unauthenticated
   caller cannot make the process buffer an arbitrary amount before we have
   verified anything. */
const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

function fail(status, error) {
  return { ok: false, status, error };
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
}

/**
 * Split `t=1690000000,v1=abc...,v1=def...` into its parts.
 *
 * v1 is a LIST, not a single value: during a signing-secret rotation Stripe
 * signs one delivery with both the old and the new secret. Accepting only the
 * first would silently reject half of all traffic for the length of a rotation.
 */
function parseSignatureHeader(header) {
  const out = { timestamp: null, signatures: [] };
  for (const part of String(header || '').split(',')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't' && /^[0-9]{1,12}$/.test(value)) out.timestamp = value;
    else if (key === 'v1' && /^[a-f0-9]{64}$/i.test(value)) out.signatures.push(value.toLowerCase());
  }
  return out;
}

function verifySignature({ secret, header, rawBody, now = Date.now(), tolerance = DEFAULT_TOLERANCE_SECONDS }) {
  /* Stripe assigns a different signing secret to each event destination.
     Accept a comma-separated list so the platform-account and Connect-account
     destinations can safely share this endpoint without weakening signature
     verification. Empty entries are ignored to make secret rotation edits
     tolerant of harmless surrounding commas/whitespace. */
  const secrets = (Array.isArray(secret) ? secret : String(secret || '').split(','))
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (!secrets.length) return fail(503, 'stripe_unconfigured');
  if (typeof rawBody !== 'string') return fail(400, 'raw_body_required');

  const parsed = parseSignatureHeader(header);
  if (!parsed.timestamp || !parsed.signatures.length) return fail(400, 'invalid_signature_header');

  /* Replay window. Stripe retries for days, so without this an attacker who
     captured one valid delivery could replay it indefinitely. */
  const skew = Math.abs(Math.floor(now / 1000) - Number(parsed.timestamp));
  if (skew > tolerance) return fail(400, 'timestamp_out_of_tolerance');

  /* Compare every configured destination secret against every candidate, and
     do NOT short-circuit. This accepts either destination while avoiding a
     timing signal that reveals which secret or signature matched. */
  let matched = false;
  for (const configuredSecret of secrets) {
    const expected = sign(configuredSecret, parsed.timestamp, rawBody);
    for (const candidate of parsed.signatures) {
      if (secureEqual(expected, candidate)) matched = true;
    }
  }
  if (!matched) return fail(400, 'signature_mismatch');

  return { ok: true, timestamp: Number(parsed.timestamp) };
}

/**
 * Validate the envelope only.
 *
 * The per-type semantics live in group-subs/src/lifecycle.js — handleEvent
 * already knows every type that changes access and already guards replay and
 * out-of-order delivery. Re-deciding any of that here would be a second, and
 * eventually divergent, implementation of the access rule.
 */
function parseEvent(rawBody) {
  let body;
  try { body = JSON.parse(rawBody); } catch (_) { return fail(400, 'invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'invalid_event');

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  if (!/^evt_[A-Za-z0-9]+$/.test(id) || !type) return fail(400, 'invalid_event');
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return fail(400, 'invalid_event');

  const created = Number(body.created);
  if (!Number.isFinite(created) || created <= 0) return fail(400, 'invalid_event');

  return {
    ok: true,
    event: {
      id,
      type,
      created,
      livemode: body.livemode === true,
      /* Present when the event belongs to a connected account rather than the
         platform. Which account a subscription belongs to decides whose money
         moved, so it is carried through rather than flattened away. */
      account: typeof body.account === 'string' && body.account ? body.account : null,
      apiVersion: typeof body.api_version === 'string' ? body.api_version : null,
      data: body.data,
      payloadHash: crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
    }
  };
}

module.exports = {
  MAX_BODY_BYTES,
  DEFAULT_TOLERANCE_SECONDS,
  parseSignatureHeader,
  verifySignature,
  parseEvent,
  sign,
  secureEqual
};
