import { appendFile, mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
const queues = new Map();

export const paths = {
  users: path.join(dataRoot, 'users.json'),
  posts: path.join(dataRoot, 'posts.json'),
  outboundEvents: path.join(dataRoot, 'outbound-events.json'),
  workThreads: path.join(dataRoot, 'user-work-threads.json'),
  shareCopyHistory: path.join(dataRoot, 'share-copy-history.json'),
  xHandles: path.join(root, 'config', 'x-handles.txt'),
  xHashtags: path.join(root, 'config', 'x-hashtags.txt'),
  relatedTickerCache: path.join(dataRoot, 'related-ticker-cache.json'),
  workReportEvents: path.join(dataRoot, 'work-report-events.json'),
  engagementProofs: path.join(dataRoot, 'engagement-proofs.json'),
  payoutLedger: path.join(dataRoot, 'payout-ledger.json'),
  payoutReceivers: path.join(dataRoot, 'payout-receivers.json'),
  payoutCycleAudit: path.join(dataRoot, 'payout-cycle-audit.json'),
  articleFeedCursor: path.join(dataRoot, 'article-feed-cursor.json'),
  pendingReviews: path.join(dataRoot, 'pending-application-reviews.json'),
  ambassadorEligibility: path.join(dataRoot, 'social-ambassador-eligibility.ndjson'),
  instanceLock: path.join(dataRoot, '.instance-lock.json'),
  settings: path.join(root, 'config', 'settings.json'),
  settingsOverrides: path.join(dataRoot, 'settings-overrides.json'),
};

export const dataDirectory = dataRoot;

/* On Render the working copy is thrown away on every deploy. Without DATA_DIR pointing at the persistent disk every ledger and setting would vanish, so refuse to run. */
export function assertDurableStorage(env = process.env) {
  if (env.RENDER && !env.DATA_DIR) throw new Error('DATA_DIR is not set. Point it at the persistent disk (for example /var/data) before starting on Render, or every ledger and setting is lost on deploy.');
}

export const projectRoot = root;

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON state at ${file}; preserve and recover the file before continuing.`, { cause: error });
    throw error;
  }
}

export function lastGoodBackupPath(file) {
  return path.join(path.dirname(file), '.state-backups', `${path.basename(file)}.last-good`);
}

async function durableReplace(file, contents) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const handle = await open(temp, 'wx');
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  // POSIX directory fsync makes the rename durable. Windows rejects directory
  // handles; the file itself was synced before the atomic replacement above.
  if (process.platform !== 'win32') {
    const directory = await open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}

export async function atomicWrite(file, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(next);
  let prior;
  try {
    prior = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (prior !== undefined) {
    // Never overwrite a valid last-good backup with unreadable state. Ordinary
    // mutations fail closed; an explicit recovery tool can replace corruption.
    try { JSON.parse(prior); } catch (error) {
      throw new Error(`Refusing to overwrite invalid JSON state at ${file}; recovery is required.`, { cause: error });
    }
    await durableReplace(lastGoodBackupPath(file), prior);
  } else {
    await durableReplace(lastGoodBackupPath(file), next);
  }
  await durableReplace(file, next);
}

/* One JSON object per line, appended in order. Used for audit trails that only ever grow. */
export function appendRecord(file, record) {
  const previous = queues.get(file) || Promise.resolve();
  const next = previous.then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  });
  queues.set(file, next.catch(() => {}));
  return next;
}

export function mutateJson(file, fallback, mutator) {
  const previous = queues.get(file) || Promise.resolve();
  const next = previous.then(async () => {
    const value = await readJson(file, fallback);
    const result = await mutator(value);
    await atomicWrite(file, value);
    return result;
  });
  queues.set(file, next.catch(() => {}));
  return next;
}

/**
 * Runtime configuration saved by commands like /share-setup. It lives on the
 * persistent disk and deep-merges OVER config/settings.json: the repo file
 * is the base, the overlay wins per key. Without this, anything an
 * admin configured in Discord was silently wiped by the next deploy, because
 * config/settings.json sits on Render's ephemeral build filesystem.
 */
export function writeSettingsOverride(key, value) {
  return mutateJson(paths.settingsOverrides, {}, (overrides) => {
    overrides[key] = value;
  });
}

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/* Objects merge key by key, arrays and scalars are replaced, and null removes a key. A partial override can no longer wipe its sibling settings. */
export function deepMerge(base, override) {
  if (!isPlain(base) || !isPlain(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === null) delete out[key];
    else if (isPlain(value) && isPlain(out[key])) out[key] = deepMerge(out[key], value);
    else out[key] = value;
  }
  return out;
}

export async function readSettings() {
  const overrides = await readJson(paths.settingsOverrides, {});
  const base = await readBaseSettings();
  return deepMerge(base, isPlain(overrides) ? overrides : {});
}

async function readBaseSettings() {
  return readJson(paths.settings, {
    boostNotificationsEnabled: false,
    allowRolePing: false,
    notificationChannelId: '',
    subscribers: [],
    cooldowns: { share: 30, news: 30, notification: 10 },
    linkWorkflow: { enabled: false, sourceChannelId: '', shareChannelId: '', engagementChannelId: '', duplicateWindowHours: 24 },
  });
}
