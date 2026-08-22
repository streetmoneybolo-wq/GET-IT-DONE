'use strict';

/*
 * Render's pre-deploy hook needs a deliberate migration mode.  Initial
 * production deployment is dry-run by default: it proves the private database
 * connection and validates the pending migration set without changing schema.
 * A later, explicit `SML_MIGRATION_MODE=apply` release performs the real write.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const mode = String(process.env.SML_MIGRATION_MODE || 'dry-run').trim().toLowerCase();
if (!['dry-run', 'apply'].includes(mode)) {
  console.error('SML_MIGRATION_MODE must be "dry-run" or "apply".');
  process.exit(2);
}

const migrate = path.join(__dirname, '..', 'db', 'migrate.js');
const args = [migrate, 'up'];
if (mode === 'dry-run') args.push('--dry-run');

console.log(`Migration pre-deploy mode: ${mode}`);
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(typeof result.status === 'number' ? result.status : 1);
