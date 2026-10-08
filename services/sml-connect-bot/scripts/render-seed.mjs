// One-time move of the bot's saved data onto the Render disk. The owner's site holds a bundle
// (data/ + settings.json) in a private folder; this downloads it with the bot's WordPress admin
// login, unpacks it on the disk, then tells the site to delete its copy.
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const disk = path.resolve(process.argv[2] || '/var/data');
const base = String(process.env.WP_BASE_URL || '').replace(/\/$/, '');
const auth = 'Basic ' + Buffer.from(`${process.env.WP_USERNAME || ''}:${process.env.WP_APP_PASSWORD || ''}`).toString('base64');
const url = `${base}/wp-json/sml-discord-site/v2/bot/seed`;

const res = await fetch(url, { headers: { Authorization: auth } });
// never start with an empty disk by accident: that would forget members, payouts and history
if (res.status === 404 && process.env.SEED_EMPTY_OK === '1') {
  console.log('No data bundle on the site and SEED_EMPTY_OK=1: starting with an empty disk.');
  await writeFile(path.join(disk, '.seeded'), new Date().toISOString() + ' empty\n');
  process.exit(0);
}
if (!res.ok) throw new Error(`Data bundle download failed (${res.status}). The bot will retry on its next start.`);
const file = path.join(disk, 'seed.tgz');
await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
execFileSync('tar', ['-tzf', file], { stdio: 'ignore' }); // a broken download stops here, before anything is unpacked
execFileSync('tar', ['-xzf', file, '-C', disk], { stdio: 'inherit' });
await rm(file, { force: true });
await writeFile(path.join(disk, '.seeded'), new Date().toISOString() + '\n');
console.log('Bot data moved onto the Render disk.');
await fetch(url, { method: 'DELETE', headers: { Authorization: auth } }).catch(() => {});
