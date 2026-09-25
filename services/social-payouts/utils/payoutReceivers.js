import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { paths, mutateJson, readJson } from './storage.js';

/**
 * Encrypted-at-rest payout receiver store.
 *
 * A member's PayPal email is the single most dangerous string this bot holds:
 * a payout to the wrong address is unrecoverable money. So the store fails
 * closed - without a well-formed PAYOUT_DETAILS_KEY nothing can be saved or
 * read, and a plaintext address is never written to disk. Display always goes
 * through the mask.
 */

const KEY_ENV = 'PAYOUT_DETAILS_KEY';

export function receiverStoreStatus() {
  const raw = String(process.env[KEY_ENV] || '').trim();
  if (!raw) return { enabled: false, reason: `${KEY_ENV} is not set. Generate 32 random bytes as hex and add it to the bot environment.` };
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return { enabled: false, reason: `${KEY_ENV} must be exactly 64 hex characters (32 bytes).` };
  return { enabled: true, reason: '' };
}

function keyBuffer() {
  const status = receiverStoreStatus();
  if (!status.enabled) throw new Error(status.reason);
  return Buffer.from(process.env[KEY_ENV], 'hex');
}

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer(), iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(enc) {
  const decipher = createDecipheriv('aes-256-gcm', keyBuffer(), Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc.data, 'base64')), decipher.final()]).toString('utf8');
}

export function maskEmail(email) {
  const value = String(email || '');
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  const maskPart = (part) => (part.length <= 1 ? `${part}**` : `${part[0]}${'*'.repeat(Math.min(6, Math.max(2, part.length - 1)))}`);
  return `${maskPart(local)}@${maskPart(domainName)}${tld}`;
}

export function isValidPayoutEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '')) && String(email).length <= 254;
}

export async function saveReceiver({ userId, userName, email }) {
  if (!isValidPayoutEmail(email)) throw new Error('That is not a valid PayPal email address.');
  const record = {
    userId: String(userId),
    userName: String(userName || '').slice(0, 80),
    method: 'paypal',
    enc: encrypt(email),
    emailMasked: maskEmail(email),
    confirmedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await mutateJson(paths.payoutReceivers, [], (rows) => {
    const index = rows.findIndex((row) => row.userId === record.userId);
    if (index >= 0) rows[index] = { ...rows[index], ...record };
    else rows.push(record);
  });
  return { emailMasked: record.emailMasked, confirmedAt: record.confirmedAt };
}

export async function removeReceiver(userId) {
  let removed = false;
  await mutateJson(paths.payoutReceivers, [], (rows) => {
    const index = rows.findIndex((row) => row.userId === String(userId));
    if (index >= 0) {
      rows.splice(index, 1);
      removed = true;
    }
  });
  return removed;
}

export async function getReceiverMasked(userId) {
  const rows = await readJson(paths.payoutReceivers, []);
  const row = rows.find((entry) => entry.userId === String(userId));
  if (!row) return null;
  return { emailMasked: row.emailMasked, confirmedAt: row.confirmedAt, updatedAt: row.updatedAt, method: row.method };
}

/**
 * The only function that returns a live address. Callers are payout executors;
 * nothing that renders Discord output may use it.
 */
export async function resolveReceiverEmail(userId) {
  const rows = await readJson(paths.payoutReceivers, []);
  const row = rows.find((entry) => entry.userId === String(userId));
  if (!row || !row.confirmedAt) return null;
  try {
    const email = decrypt(row.enc);
    return isValidPayoutEmail(email) ? { email, emailMasked: row.emailMasked } : null;
  } catch {
    return null; // wrong key or corrupted record: fail closed, never guess
  }
}

export async function listConfirmedReceivers() {
  const rows = await readJson(paths.payoutReceivers, []);
  const out = new Map();
  for (const row of rows) {
    if (row.confirmedAt) out.set(row.userId, { emailMasked: row.emailMasked, confirmedAt: row.confirmedAt });
  }
  return out;
}
