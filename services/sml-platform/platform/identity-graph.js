'use strict';

/* Identity resolution and linking for the dispute-evidence ledgers.
 *
 * One billing_identities row per canonical person; provider-scoped identifier
 * edges live in billing_identity_refs (encrypted value + HMAC lookup hash).
 * `verified` rows come only from trusted linking events (checkout metadata,
 * OAuth link, signed WP gateway event) or an admin confirmation; candidate
 * matches (email) are flagged and never silently promoted. Two existing
 * identities are never merged silently — that is an identity_conflict.
 *
 * All dependencies are injected; the evidence store provides encryption,
 * lookup hashing, and hash-stamped inserts. Invalid input throws TypeError
 * (mapped to 400 by service handlers).
 */

const PROVIDERS = new Set(['stripe', 'paypal', 'upgrade_chat', 'discord', 'wordpress', 'sml']);
const MERCHANT_REF_TYPES = new Set(['merchant', 'connected_account']);
const PERSON_COLUMNS = ['sml_user_id', 'wordpress_user_id', 'discord_user_id'];

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function validateRefInput(provider, refType, refValue) {
  if (!PROVIDERS.has(provider)) throw new TypeError(`unknown provider: ${provider}`);
  requireText(refType, 'refType');
  requireText(refValue, 'refValue');
}

function validateProv(prov) {
  if (!prov || typeof prov !== 'object' || Array.isArray(prov)) {
    throw new TypeError('prov must be an object with source/occurred_at/received_at');
  }
  for (const field of ['source', 'occurred_at', 'received_at']) {
    if (prov[field] === undefined || prov[field] === null) {
      throw new TypeError(`prov.${field} is required`);
    }
  }
  return prov;
}

function provFields(prov) {
  return {
    source: prov.source,
    source_event_id: prov.source_event_id === undefined ? null : prov.source_event_id,
    provider_account: prov.provider_account === undefined ? null : prov.provider_account,
    occurred_at: prov.occurred_at,
    received_at: prov.received_at,
    provenance: prov.provenance === undefined ? {} : prov.provenance
  };
}

function personInput(input) {
  const person = {};
  for (const column of PERSON_COLUMNS) {
    if (input[column] !== undefined && input[column] !== null) person[column] = input[column];
  }
  return person;
}

function createIdentityGraph({ pool, store }) {
  if (!store) throw new TypeError('identity graph requires an evidence store');

  async function findIdentityByPerson(client, person) {
    /* Match every supplied person identifier; two distinct existing identities
     * or a matched identity that disagrees on another supplied identifier is a
     * conflict — never merged silently. */
    const matches = new Map();
    for (const column of Object.keys(person)) {
      const result = await client.query(
        `SELECT * FROM billing_identities WHERE ${column} = $1`,
        [person[column]]
      );
      const row = result.rows && result.rows[0];
      if (row) matches.set(Number(row.id), row);
    }
    if (matches.size > 1) throw new TypeError('identity_conflict');
    const identity = matches.size === 1 ? [...matches.values()][0] : null;
    if (identity) {
      for (const column of Object.keys(person)) {
        if (identity[column] !== undefined && identity[column] !== null &&
            String(identity[column]) !== String(person[column])) {
          throw new TypeError('identity_conflict');
        }
      }
    }
    return identity;
  }

  async function upsertVerifiedIdentity(client, person, via) {
    const identity = await findIdentityByPerson(client, person);
    if (!identity) {
      const inserted = await client.query(
        `INSERT INTO billing_identities (
           sml_user_id, wordpress_user_id, discord_user_id, verification, verified_via
         ) VALUES ($1, $2, $3, 'verified', $4)
         RETURNING id`,
        [
          person.sml_user_id === undefined ? null : person.sml_user_id,
          person.wordpress_user_id === undefined ? null : person.wordpress_user_id,
          person.discord_user_id === undefined ? null : person.discord_user_id,
          via
        ]
      );
      return Number(inserted.rows[0].id);
    }

    const sets = [];
    const values = [identity.id];
    for (const column of Object.keys(person)) {
      if (identity[column] === undefined || identity[column] === null) {
        values.push(person[column]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (identity.verification !== 'verified') {
      sets.push(`verification = 'verified'`);
    }
    if (sets.length) {
      values.push(via);
      sets.push(`verified_via = $${values.length}`);
      sets.push('updated_at = now()');
      await client.query(
        `UPDATE billing_identities SET ${sets.join(', ')} WHERE id = $1`,
        values
      );
    }
    return Number(identity.id);
  }

  async function findExistingRefs(client, provider, refType, refValue) {
    const hashes = store.lookupHashesAll(refValue);
    const result = await client.query(
      `SELECT * FROM billing_identity_refs
        WHERE provider = $1 AND ref_type = $2 AND ref_lookup_hash = ANY($3)`,
      [provider, refType, hashes]
    );
    return result.rows || [];
  }

  async function insertRef(client, { identityId, provider, refType, refValue, verification, prov }) {
    await store.appendRow(client, {
      table: 'billing_identity_refs',
      fields: {
        identity_id: identityId,
        provider,
        ref_type: refType,
        ref_value_enc: store.encryptValue(refValue),
        ref_lookup_hash: store.lookupHash(refValue),
        key_version: store.activeKeyVersion,
        verification,
        ...provFields(prov)
      }
    });
  }

  async function findByRef(client, provider, refType, refValue) {
    validateRefInput(provider, refType, refValue);
    const hashes = store.lookupHashesAll(refValue);
    const result = await client.query(
      `SELECT bi.* FROM billing_identity_refs r
         JOIN billing_identities bi ON bi.id = r.identity_id
        WHERE r.provider = $1 AND r.ref_type = $2 AND r.ref_lookup_hash = ANY($3)
        ORDER BY r.id ASC LIMIT 1`,
      [provider, refType, hashes]
    );
    return (result.rows && result.rows[0]) || null;
  }

  async function linkVerified(client, input) {
    const { provider, refType, refValue, via, prov } = input;
    validateRefInput(provider, refType, refValue);
    requireText(via, 'via (trusted linking event ref)');
    validateProv(prov);
    const person = personInput(input);
    if (!Object.keys(person).length) {
      throw new TypeError('linkVerified requires at least one person identifier');
    }

    const identityId = await upsertVerifiedIdentity(client, person, via);

    const existing = await findExistingRefs(client, provider, refType, refValue);
    const foreign = existing.find((row) => Number(row.identity_id) !== identityId);
    if (foreign && !MERCHANT_REF_TYPES.has(refType)) {
      /* A person-scoped identifier already belongs to another identity. */
      throw new TypeError('identity_conflict');
    }
    const mine = existing.find((row) => Number(row.identity_id) === identityId);
    if (mine) {
      if (mine.verification !== 'verified') {
        /* Promotion is allowed here because linkVerified is only called for
         * trusted linking events — the one sanctioned promotion path. */
        await client.query(
          `UPDATE billing_identity_refs SET verification = 'verified' WHERE id = $1`,
          [mine.id]
        );
      }
      return identityId;
    }

    await insertRef(client, { identityId, provider, refType, refValue, verification: 'verified', prov });
    return identityId;
  }

  async function recordCandidate(client, input) {
    const { provider, refType, refValue, prov } = input;
    validateRefInput(provider, refType, refValue);
    validateProv(prov);
    const person = personInput(input);

    let identityId;
    const identity = Object.keys(person).length
      ? await findIdentityByPerson(client, person)
      : null;
    if (identity) {
      /* Candidates never modify an existing identity's columns. */
      identityId = Number(identity.id);
    } else {
      const inserted = await client.query(
        `INSERT INTO billing_identities (
           sml_user_id, wordpress_user_id, discord_user_id, email_candidate, verification
         ) VALUES ($1, $2, $3, $4, 'candidate')
         RETURNING id`,
        [
          person.sml_user_id === undefined ? null : person.sml_user_id,
          person.wordpress_user_id === undefined ? null : person.wordpress_user_id,
          person.discord_user_id === undefined ? null : person.discord_user_id,
          input.email_candidate === undefined ? null : input.email_candidate
        ]
      );
      identityId = Number(inserted.rows[0].id);
    }

    const existing = await findExistingRefs(client, provider, refType, refValue);
    if (existing.length) {
      /* Candidate rows never touch existing edges — verified or otherwise. */
      const mine = existing.find((row) => Number(row.identity_id) === identityId);
      if (mine) return identityId;
      if (!MERCHANT_REF_TYPES.has(refType)) return identityId;
    }

    await insertRef(client, { identityId, provider, refType, refValue, verification: 'candidate', prov });
    return identityId;
  }

  async function resolveMerchantAdmins(client, merchantScope) {
    requireText(merchantScope, 'merchantScope');
    const hashes = store.lookupHashesAll(merchantScope);
    const result = await client.query(
      `SELECT DISTINCT bi.id AS identity_id, bi.wordpress_user_id, bi.discord_user_id
         FROM billing_identity_refs r
         JOIN billing_identities bi ON bi.id = r.identity_id
        WHERE r.ref_type IN ('merchant','connected_account')
          AND r.verification = 'verified'
          AND r.ref_lookup_hash = ANY($1)
        ORDER BY identity_id ASC`,
      [hashes]
    );
    return (result.rows || []).map((row) => ({
      identityId: Number(row.identity_id),
      wordpress_user_id: row.wordpress_user_id === undefined ? null : row.wordpress_user_id,
      discord_user_id: row.discord_user_id === undefined ? null : row.discord_user_id
    }));
  }

  return {
    pool,
    findByRef,
    linkVerified,
    recordCandidate,
    resolveMerchantAdmins
  };
}

module.exports = {
  MERCHANT_REF_TYPES,
  PROVIDERS,
  createIdentityGraph
};
