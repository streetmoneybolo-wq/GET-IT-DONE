import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const queues = new Map();

export const paths = {
  users: path.join(root, 'data', 'users.json'),
  posts: path.join(root, 'data', 'posts.json'),
  outboundEvents: path.join(root, 'data', 'outbound-events.json'),
  workThreads: path.join(root, 'data', 'user-work-threads.json'),
  shareCopyHistory: path.join(root, 'data', 'share-copy-history.json'),
  xHandles: path.join(root, 'config', 'x-handles.txt'),
  xHashtags: path.join(root, 'config', 'x-hashtags.txt'),
  monitoredAlerts: path.join(root, 'data', 'monitored-alerts.json'),
  articleJobs: path.join(root, 'data', 'article-jobs.json'),
  articleAudit: path.join(root, 'data', 'article-audit.json'),
  articleFeaturedMedia: path.join(root, 'data', 'article-featured-media.json'),
  alertVisualMedia: path.join(root, 'data', 'alert-visual-media.json'),
  discordAlertMirrorLog: path.join(root, 'data', 'discord-alert-mirror-log.json'),
  telegramForwardLog: path.join(root, 'data', 'telegram-forward-log.json'),
  telegramNewsForwardLog: path.join(root, 'data', 'telegram-news-forward-log.json'),
  relatedTickerCache: path.join(root, 'data', 'related-ticker-cache.json'),
  workReportEvents: path.join(root, 'data', 'work-report-events.json'),
  engagementProofs: path.join(root, 'data', 'engagement-proofs.json'),
  payoutLedger: path.join(root, 'data', 'payout-ledger.json'),
  memberSecurityAudit: path.join(root, 'data', 'member-security-audit.json'),
  memberSecurityGrandfathered: path.join(root, 'data', 'member-security-grandfathered.json'),
  memberWarningLog: path.join(root, 'data', 'member-warning-log.json'),
  premiumVerification: path.join(root, 'data', 'premium-verification.json'),
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
