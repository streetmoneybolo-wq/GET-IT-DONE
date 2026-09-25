/* One-time safety copy of every state file before this version writes to a data disk for the first time.
   The formats are unchanged from the previous bot, so the ledgers, settings and member data carry over as they are; this copy exists so the previous state can always be restored. */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const KEEP = /\.(json|ndjson)$/i;

export async function backupStateOnce(dataDir, label = 'pre-v2') {
  const target = path.join(dataDir, '.state-backups', label);
  try {
    await stat(target);
    return { skipped: true, target, copied: 0 };
  } catch { /* not there yet: take the copy */ }
  let names;
  try { names = await readdir(dataDir); } catch { return { skipped: true, target, copied: 0 }; }
  await mkdir(target, { recursive: true });
  let copied = 0;
  for (const name of names) {
    if (!KEEP.test(name)) continue;
    const from = path.join(dataDir, name);
    if (!(await stat(from)).isFile()) continue;
    await copyFile(from, path.join(target, name));
    copied += 1;
  }
  return { skipped: false, target, copied };
}
