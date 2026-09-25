/* One running copy at a time.
   The payout mutex and the JSON write queues only coordinate inside a single process. Two copies of the bot on the same disk (a deploy overlap, an accidental scale-up) could
   double-post or double-pay. So a lock file on the persistent disk names the copy that owns the data, refreshed by a heartbeat; a second copy waits for it to go stale or exits. */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createInstanceLock({ file, staleMs = 45_000, heartbeatMs = 10_000, waitMs = 90_000, pollMs = 2_000, now = Date.now, log = console, onLost = () => {} } = {}) {
  const id = randomUUID();
  const me = () => ({ id, host: os.hostname(), pid: process.pid, at: now() });
  let timer = null;
  let held = false;

  async function read() {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
  }
  async function write() {
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${id}.tmp`;
    await writeFile(temp, JSON.stringify(me()), 'utf8');
    await rename(temp, file);
  }
  const free = (lock) => !lock || lock.id === id || now() - Number(lock.at || 0) > staleMs;

  /* Resolves true once this copy owns the lock, false if another live copy still holds it after waitMs. */
  async function acquire() {
    const deadline = now() + waitMs;
    for (;;) {
      if (free(await read())) {
        await write();
        await sleep(Math.min(300, pollMs)); // two starters can both pass the check; the later writer wins, and only that one keeps the lock
        if ((await read())?.id === id) { held = true; startHeartbeat(); return true; }
      }
      if (now() >= deadline) return false;
      await sleep(pollMs);
    }
  }

  function startHeartbeat() {
    timer = setInterval(async () => {
      const current = await read();
      if (current && current.id !== id && !free(current)) { held = false; clearInterval(timer); log.error?.('Another copy of the bot took over the data lock; stopping this one.'); onLost(); return; }
      await write().catch((error) => log.warn?.(`Instance lock refresh failed: ${error.message || error}`));
    }, heartbeatMs);
    timer.unref?.();
  }

  async function release() {
    if (timer) clearInterval(timer);
    timer = null;
    if (held && (await read())?.id === id) await rm(file, { force: true });
    held = false;
  }

  return { acquire, release, id, isHeld: () => held };
}
