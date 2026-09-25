import { mkdir, open, readFile, rename } from 'node:fs/promises';
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
  monitoredAlerts: path.join(dataRoot, 'monitored-alerts.json'),
  articleJobs: path.join(dataRoot, 'article-jobs.json'),
  articleAudit: path.join(dataRoot, 'article-audit.json'),
  articleFeaturedMedia: path.join(dataRoot, 'article-featured-media.json'),
  alertVisualMedia: path.join(dataRoot, 'alert-visual-media.json'),
  discordAlertMirrorLog: path.join(dataRoot, 'discord-alert-mirror-log.json'),
  telegramForwardLog: path.join(dataRoot, 'telegram-forward-log.json'),
  telegramNewsForwardLog: path.join(dataRoot, 'telegram-news-forward-log.json'),
  relatedTickerCache: path.join(dataRoot, 'related-ticker-cache.json'),
  workReportEvents: path.join(dataRoot, 'work-report-events.json'),
  engagementProofs: path.join(dataRoot, 'engagement-proofs.json'),
  payoutLedger: path.join(dataRoot, 'payout-ledger.json'),
  payoutReceivers: path.join(dataRoot, 'payout-receivers.json'),
  payoutCycleAudit: path.join(dataRoot, 'payout-cycle-audit.json'),
  articleFeedCursor: path.join(dataRoot, 'article-feed-cursor.json'),
  memberSecurityAudit: path.join(dataRoot, 'member-security-audit.json'),
  memberSecurityGrandfathered: path.join(dataRoot, 'member-security-grandfathered.json'),
  memberWarningLog: path.join(dataRoot, 'member-warning-log.json'),
  premiumVerification: path.join(dataRoot, 'premium-verification.json'),
  settings: path.join(root, 'config', 'settings.json'),
};

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

export async function readSettings() {
  return readJson(paths.settings, {
    boostNotificationsEnabled: false,
    allowRolePing: false,
    notificationChannelId: '',
    subscribers: [],
    cooldowns: { share: 30, news: 30, notification: 10 },
    linkWorkflow: { enabled: false, sourceChannelId: '', shareChannelId: '', engagementChannelId: '', duplicateWindowHours: 24 },
  });
}
