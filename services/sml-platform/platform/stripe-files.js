'use strict';

// Stripe file-upload client for dispute evidence (DESIGN.md v2 §4b(4)).
// Fixed host files.stripe.com, multipart purpose=dispute_evidence.
// File rules per docs.stripe.com/disputes/responding + /file-upload:
// PDF/JPEG/PNG only, 4.5MB combined cap, one file per evidence field.
// Page-count limits (<50 pages, <=19 Mastercard) are enforced at
// packet-build time by provider-limits, not here.

const crypto = require('node:crypto');
const https = require('node:https');

const STRIPE_FILES_HOST = 'files.stripe.com';
const STRIPE_FILES_PATH = '/v1/files';
const FILE_PURPOSE = 'dispute_evidence';
const MAX_COMBINED_BYTES = Math.floor(4.5 * 1024 * 1024);
const MAX_FILE_NAME_LENGTH = 128;
const ALLOWED_CONTENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function invalid(message) {
  return new TypeError(message);
}

function safeFileName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > MAX_FILE_NAME_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(name)) {
    throw invalid('file name must be a short plain name (letters, digits, space, dot, dash, underscore)');
  }
  return name;
}

function checkFile(file) {
  if (!file || typeof file !== 'object') throw invalid('evidence file must be an object');
  if (!Buffer.isBuffer(file.bytes) || file.bytes.length === 0) {
    throw invalid('evidence file bytes must be a non-empty Buffer');
  }
  const contentType = String(file.contentType || '').toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw invalid(`unsupported evidence file type: ${contentType || 'unknown'} (allowed: PDF, JPEG, PNG)`);
  }
  safeFileName(file.fileName);
  if (file.bytes.length > MAX_COMBINED_BYTES) {
    throw invalid('evidence file exceeds the 4.5MB combined size cap');
  }
}

function validateEvidenceFiles(files) {
  if (!Array.isArray(files)) throw invalid('evidence files must be an array');
  const seenFields = new Set();
  let combined = 0;
  for (const file of files) {
    checkFile(file);
    const field = typeof file.field === 'string' ? file.field.trim() : '';
    if (!field) throw invalid('every evidence file must name its evidence field');
    if (seenFields.has(field)) {
      throw invalid(`only one file is allowed per evidence field: ${field}`);
    }
    seenFields.add(field);
    combined += file.bytes.length;
  }
  if (combined > MAX_COMBINED_BYTES) {
    throw invalid('combined evidence file size exceeds the 4.5MB cap');
  }
  return { combinedBytes: combined };
}

function buildMultipartBody({ boundary, fileName, contentType, bytes }) {
  const head = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="purpose"\r\n\r\n' +
    `${FILE_PURPOSE}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return Buffer.concat([head, bytes, tail]);
}

function defaultRequest({ path, method, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: STRIPE_FILES_HOST,
      port: 443,
      method,
      path,
      servername: STRIPE_FILES_HOST,
      headers
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          response.destroy();
          reject(new Error('stripe files response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('end', () => resolve({
        statusCode: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
      response.once('error', reject);
    });
    request.setTimeout(timeoutMs || 30_000, () => {
      request.destroy(new Error('stripe files request timed out'));
    });
    request.once('error', reject);
    request.end(body);
  });
}

// createStripeFilesClient({ apiKey, request?, randomBytes? })
// apiKey comes from the STRIPE_SECRET_KEY environment configuration; its
// value is only ever placed in the Authorization header and never logged
// or included in error messages.
function createStripeFilesClient(options = {}) {
  const apiKey = options.apiKey;
  if (typeof apiKey !== 'string' || !apiKey) {
    throw new Error('stripe files client is unconfigured (missing API key)');
  }
  const request = options.request || defaultRequest;
  const randomBytes = options.randomBytes || crypto.randomBytes;

  async function upload({ fileName, contentType, bytes, idempotencyKey }) {
    checkFile({ fileName, contentType, bytes });
    const boundary = `sml${randomBytes(16).toString('hex')}`;
    const body = buildMultipartBody({
      boundary,
      fileName: safeFileName(fileName),
      contentType: String(contentType).toLowerCase(),
      bytes
    });
    const headers = {
      authorization: `Bearer ${apiKey}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': body.length
    };
    if (idempotencyKey != null) headers['idempotency-key'] = String(idempotencyKey);

    const response = await request({
      hostname: STRIPE_FILES_HOST,
      path: STRIPE_FILES_PATH,
      method: 'POST',
      headers,
      body
    });
    const statusCode = response && response.statusCode;
    let parsed = null;
    try { parsed = JSON.parse(response.body); } catch (_) { parsed = null; }
    if (statusCode < 200 || statusCode >= 300 || !parsed || typeof parsed.id !== 'string' || !parsed.id.startsWith('file_')) {
      const code = parsed && parsed.error && parsed.error.code ? String(parsed.error.code).slice(0, 64) : 'unknown';
      throw new Error(`stripe file upload failed (HTTP ${statusCode || 0}, code ${code})`);
    }
    return { fileId: parsed.id };
  }

  // uploadAll(files, { idempotencyKeyBase }) -> { fieldFileIds: {field: fileId} }
  // Validates the full batch (types, one-per-field, combined cap) before any
  // network call, then uploads sequentially.
  async function uploadAll(files, { idempotencyKeyBase } = {}) {
    validateEvidenceFiles(files);
    const fieldFileIds = {};
    for (const file of files) {
      const uploaded = await upload({
        fileName: file.fileName,
        contentType: file.contentType,
        bytes: file.bytes,
        idempotencyKey: idempotencyKeyBase ? `${idempotencyKeyBase}:file:${file.field}` : undefined
      });
      fieldFileIds[file.field] = uploaded.fileId;
    }
    return { fieldFileIds };
  }

  return { upload, uploadAll };
}

module.exports = {
  ALLOWED_CONTENT_TYPES,
  FILE_PURPOSE,
  MAX_COMBINED_BYTES,
  STRIPE_FILES_HOST,
  STRIPE_FILES_PATH,
  buildMultipartBody,
  createStripeFilesClient,
  validateEvidenceFiles
};
