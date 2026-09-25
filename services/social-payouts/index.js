import 'dotenv/config';
import { assertDurableStorage, dataDirectory, paths } from './utils/storage.js';
import { backupStateOnce } from './src/bot/backup.js';
import { createInstanceLock } from './src/bot/instanceLock.js';
import { createBotClient } from './src/bot/events.js';
import { cancelApplicationReviewTimers } from './src/features/socialApplications.js';

/* Social Payouts bot entry point. Everything else lives under src/ (bot wiring, features, interaction handlers) and utils/ (shared libraries). */

if (!process.env.DISCORD_TOKEN) throw new Error('Missing required environment variable: DISCORD_TOKEN');
assertDurableStorage();

const backup = await backupStateOnce(dataDirectory);
if (!backup.skipped) console.log(`Saved a pre-v2 copy of ${backup.copied} state file(s) to ${backup.target}.`);

const lock = createInstanceLock({
  file: paths.instanceLock,
  onLost: () => { console.error('Lost the data lock to another copy of the bot. Exiting.'); process.exit(1); },
});
if (!(await lock.acquire())) {
  console.error('Another copy of the bot is running against this data disk. Exiting without starting so nothing is posted or paid twice.');
  process.exit(1);
}

const client = createBotClient();
let stopping = false;

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received; shutting down.`);
  try {
    client.stopBackgroundJobs?.();
    cancelApplicationReviewTimers();
    await client.destroy();
  } finally {
    await lock.release().catch(() => {});
    process.exit(0);
  }
}
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));

await client.login(process.env.DISCORD_TOKEN);
