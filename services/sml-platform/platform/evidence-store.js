'use strict';

/* Append-only evidence writers/readers for the dispute-evidence ledgers.
 *
 * - canonicalJson: deterministic serialization (sorted keys, JSONB-normalized
 *   values, UTC ISO-8601 millisecond timestamps) so a later verifier re-reading
 *   rows reproduces every integrity hash exactly.
 * - AES-256-GCM at-rest encryption for *_enc columns; subkeys derived with
 *   HKDF-SHA256 from the entries of SML_EVIDENCE_ENCRYPTION_KEY. Blob format:
 *   0x01 || key_version(1B) || iv(12B) || tag(16B) || ciphertext.
 * - HMAC-SHA256 lookup hashes for equality reads across key rotation.
 * - Per-scope hash chains serialized with pg_advisory_xact_lock inside the
 *   caller's transaction; forks are also blocked by partial unique indexes.
 *
 * Secrets are referenced by env name only and never logged. No card data,
 * CVV, passwords, or tokens are ever stored (field-name denylist below).
 */

const crypto = require('node:crypto');

const BLOB_VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_ENC_INFO = 'sml-evidence-enc';
const HKDF_MAC_INFO = 'sml-ref-lookup-hmac';
const FORBIDDEN_FIELD_RE = /card|cvv|cvc|password|secret|token|authorization/i;
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;
const REQUIRED_PROVENANCE_FIELDS = ['source', 'occurred_at', 'received_at'];

/* Chained tables and their scope columns (DESIGN.md §1). Every other
 * provenance table is hash-stamped per row but not chained. */
const CHAINED_TABLES = {
  billing_events: { scopeColumn: 'provider' },
  service_usage_events: { scopeColumn: 'identity_id' },
  dispute_evidence_items: { scopeColumn: 'case_id' },
  dispute_audit_log: { scopeColumn: 'case_id', coalesceScope: true }
};

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/* JSONB-style normalization: last-duplicate-wins already happened when the
 * value was parsed into a JS object; here we sort keys, render numbers via a
 * JSON round-trip, render Date values as UTC ISO-8601 with milliseconds, and
 * leave timestamp strings verbatim (the app renders them before hashing). */
function canonicalValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError('canonicalJson: invalid Date');
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) return value.toString('base64');
  const type = typeof value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    return value;
  }
  if (type === 'string' || type === 'boolean') return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (type === 'object') return value;
  throw new TypeError(`canonicalJson: unsupported value type ${type}`);
}

/* Manual stringifier: JSON.stringify would enumerate integer-like object keys
 * in numeric order regardless of insertion, defeating lexicographic sorting. */
function stringifyCanonical(value) {
  const normalized = canonicalValue(value);
  if (normalized === null) return 'null';
  const type = typeof normalized;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return JSON.stringify(normalized);
  }
  if (Array.isArray(normalized)) {
    return `[${normalized.map(stringifyCanonical).join(',')}]`;
  }
  const keys = Object.keys(normalized).filter((key) => normalized[key] !== undefined).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stringifyCanonical(normalized[key])}`);
  return `{${parts.join(',')}}`;
}

function canonicalJson(value) {
  return stringifyCanonical(value);
}

function validateNoForbiddenFields(value) {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value) || value instanceof Date) return value;
  if (Array.isArray(value)) {
    for (const item of value) validateNoForbiddenFields(item);
    return value;
  }
  if (typeof value !== 'object') return value;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FIELD_RE.test(key)) {
      throw new TypeError(`forbidden field name is never stored: ${key}`);
    }
    validateNoForbiddenFields(value[key]);
  }
  return value;
}

/* keyList entries (index 0 = active): {version, secret}, 'version:secret',
 * or a bare secret (versions then count down from list length so prepending
 * a new key on rotation keeps old versions stable). */
function parseKeyList(keyList) {
  if (!Array.isArray(keyList) || keyList.length === 0) {
    throw new TypeError('keyList must be a non-empty array (parsed SML_EVIDENCE_ENCRYPTION_KEY)');
  }
  const keys = keyList.map((entry, index) => {
    let version = null;
    let secret = null;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      version = entry.version;
      secret = entry.secret;
    } else if (typeof entry === 'string') {
      const prefixed = /^([0-9]{1,3}):(.+)$/.exec(entry);
      if (prefixed) {
        version = Number(prefixed[1]);
        secret = prefixed[2];
      } else {
        version = keyList.length - index;
        secret = entry;
      }
    }
    if (!Number.isInteger(version) || version < 1 || version > 255) {
      throw new TypeError('key version must be an integer between 1 and 255');
    }
    if (typeof secret !== 'string' || secret.length < 16) {
      throw new TypeError('encryption key material is too short');
    }
    const ikm = Buffer.from(secret, 'utf8');
    return {
      version,
      encKey: Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), HKDF_ENC_INFO, 32)),
      macKey: Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), HKDF_MAC_INFO, 32))
    };
  });
  const seen = new Set();
  for (const key of keys) {
    if (seen.has(key.version)) throw new TypeError(`duplicate key version ${key.version}`);
    seen.add(key.version);
  }
  return keys;
}

function scopeExpression(chain) {
  return chain.coalesceScope ? `COALESCE(${chain.scopeColumn}, 0)` : chain.scopeColumn;
}

function validateTableName(table) {
  if (typeof table !== 'string' || !IDENTIFIER_RE.test(table)) {
    throw new TypeError('table must be a lowercase SQL identifier');
  }
  return table;
}

function validateFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new TypeError('fields must be an object');
  }
  const keys = Object.keys(fields).filter((key) => fields[key] !== undefined);
  if (!keys.length) throw new TypeError('fields must not be empty');
  for (const key of keys) {
    if (!IDENTIFIER_RE.test(key)) throw new TypeError(`invalid column name: ${key}`);
  }
  validateNoForbiddenFields(fields);
  for (const required of REQUIRED_PROVENANCE_FIELDS) {
    if (fields[required] === undefined || fields[required] === null) {
      throw new TypeError(`provenance field ${required} is required (received_at is writer-supplied)`);
    }
  }
  return keys;
}

function isJsonColumnValue(value) {
  return value !== null && typeof value === 'object' &&
    !Buffer.isBuffer(value) && !(value instanceof Date);
}

function createEvidenceStore({ pool, keyList }) {
  const keys = parseKeyList(keyList);
  const active = keys[0];

  function encryptValue(plaintext) {
    if (typeof plaintext !== 'string' || !plaintext) {
      throw new TypeError('encryptValue requires a non-empty string');
    }
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', active.encKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([
      Buffer.from([BLOB_VERSION, active.version]),
      iv,
      cipher.getAuthTag(),
      ciphertext
    ]);
  }

  function decryptValue(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 2 + IV_BYTES + TAG_BYTES + 1) {
      throw new TypeError('decryptValue requires an encrypted value buffer');
    }
    if (buf[0] !== BLOB_VERSION) throw new TypeError('unsupported encrypted blob version');
    const key = keys.find((candidate) => candidate.version === buf[1]);
    if (!key) throw new TypeError(`no decryption key for key version ${buf[1]}`);
    const iv = buf.subarray(2, 2 + IV_BYTES);
    const tag = buf.subarray(2 + IV_BYTES, 2 + IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(2 + IV_BYTES + TAG_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key.encKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  function hmacHex(key, value) {
    return crypto.createHmac('sha256', key.macKey).update(String(value), 'utf8').digest('hex');
  }

  function lookupHash(value) {
    if (typeof value !== 'string' || !value) throw new TypeError('lookupHash requires a non-empty string');
    return hmacHex(active, value);
  }

  function lookupHashesAll(value) {
    if (typeof value !== 'string' || !value) throw new TypeError('lookupHashesAll requires a non-empty string');
    return keys.map((key) => hmacHex(key, value));
  }

  async function insertHashedRow(client, table, fields, prevHash) {
    const columns = Object.keys(fields).filter((key) => fields[key] !== undefined);
    const hashed = {};
    for (const column of columns) hashed[column] = fields[column];
    hashed.prev_hash = prevHash;
    const integrityHash = sha256Hex(canonicalJson(hashed));

    const params = [];
    const placeholders = [];
    const insertColumns = [...columns, 'prev_hash', 'integrity_hash'];
    for (const column of insertColumns) {
      const value = column === 'prev_hash' ? prevHash
        : column === 'integrity_hash' ? integrityHash
          : fields[column];
      if (isJsonColumnValue(value)) {
        params.push(JSON.stringify(value));
        placeholders.push(`$${params.length}::jsonb`);
      } else {
        params.push(value === undefined ? null : value);
        placeholders.push(`$${params.length}`);
      }
    }
    const result = await client.query(
      `INSERT INTO ${table} (${insertColumns.join(', ')})
       VALUES (${placeholders.join(', ')})
       RETURNING id`,
      params
    );
    const id = result.rows && result.rows[0] ? result.rows[0].id : null;
    return { id, integrityHash };
  }

  async function appendChained(client, { table, scopeKey, fields }) {
    validateTableName(table);
    const chain = CHAINED_TABLES[table];
    if (!chain) throw new TypeError(`not a chained table: ${table}`);
    if (scopeKey === undefined || scopeKey === null) {
      throw new TypeError('appendChained requires a scopeKey');
    }
    validateFields(fields);
    if (!chain.coalesceScope) {
      const scopeValue = fields[chain.scopeColumn];
      if (scopeValue === undefined || scopeValue === null || String(scopeValue) !== String(scopeKey)) {
        throw new TypeError(`fields.${chain.scopeColumn} must match scopeKey`);
      }
    }

    /* Serialize appends per scope before reading the chain head. */
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`${table}:${scopeKey}`]
    );
    const head = await client.query(
      `SELECT integrity_hash FROM ${table}
        WHERE ${scopeExpression(chain)} = $1
        ORDER BY id DESC LIMIT 1`,
      [scopeKey]
    );
    const prevHash = head.rows && head.rows[0] ? head.rows[0].integrity_hash : null;
    return insertHashedRow(client, table, fields, prevHash);
  }

  async function appendRow(client, { table, fields }) {
    validateTableName(table);
    validateFields(fields);
    return insertHashedRow(client, table, fields, null);
  }

  async function verifyChain(client, table, scopeKey) {
    validateTableName(table);
    const chain = CHAINED_TABLES[table];
    if (!chain) throw new TypeError(`not a chained table: ${table}`);
    if (scopeKey === undefined || scopeKey === null) {
      throw new TypeError('verifyChain requires a scopeKey');
    }
    const result = await client.query(
      `SELECT * FROM ${table}
        WHERE ${scopeExpression(chain)} = $1
        ORDER BY id ASC`,
      [scopeKey]
    );
    let previousHash = null;
    for (const row of result.rows || []) {
      const { id, integrity_hash: integrityHash, ...rest } = row;
      const rowPrev = rest.prev_hash === undefined ? null : rest.prev_hash;
      if (rowPrev !== previousHash) return { ok: false, brokenAtId: id };
      const expected = sha256Hex(canonicalJson({ ...rest, prev_hash: previousHash }));
      if (expected !== integrityHash) return { ok: false, brokenAtId: id };
      previousHash = integrityHash;
    }
    return { ok: true };
  }

  return {
    pool,
    activeKeyVersion: active.version,
    encryptValue,
    decryptValue,
    lookupHash,
    lookupHashesAll,
    appendChained,
    appendRow,
    verifyChain
  };
}

module.exports = {
  CHAINED_TABLES,
  canonicalJson,
  createEvidenceStore,
  validateNoForbiddenFields
};
