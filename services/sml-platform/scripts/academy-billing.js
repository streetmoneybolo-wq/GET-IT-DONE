#!/usr/bin/env node
'use strict';

/* MEM Academy billing operator CLI. Run it from the making-easy-money-academy
 * service's Render shell (it needs DATABASE_URL and the SML_ACADEMY_BILLING_*
 * env). Read-only commands never write; every mutating command is a dry run
 * unless it is given BOTH --apply and --actor <label>. See
 * platform/academy/billing/README.md.
 *
 *   node scripts/academy-billing.js status
 *   node scripts/academy-billing.js preflight
 *   node scripts/academy-billing.js validate-config
 *   node scripts/academy-billing.js audit verify
 *   node scripts/academy-billing.js reconcile [--force-breaker] [--apply --actor ops]
 *   node scripts/academy-billing.js resync <discordId> [--apply --actor ops]
 *   node scripts/academy-billing.js rebuild-from-stripe [--apply --actor ops]
 *   node scripts/academy-billing.js replay-event <evt_id> [--apply --actor ops]
 *   node scripts/academy-billing.js replay-deferred [--apply --actor ops]
 *   node scripts/academy-billing.js rebind <newDiscordId> <cus_id> --reason "..." [--apply --actor ops]
 *   node scripts/academy-billing.js comp grant --discord <id> [--role <id>[,<id>]] [--no-academy] [--include-lifetime-role] [--expires 2026-12-31] --reason "..." [--apply --actor ops]
 *   node scripts/academy-billing.js comp revoke --id <n> --reason "..." [--apply --actor ops]
 *   node scripts/academy-billing.js purge-test [--force] [--apply --actor ops]
 *   node scripts/academy-billing.js external-review [--state needs_review|revoke_unfinished|engine_granted|held|kept_external|revoked|released|all] [--recheck --apply --actor ops]
 *   node scripts/academy-billing.js external-review --keep --discord <id> --role <id> --reason "..." [--apply --actor ops]
 */

const { parseArgs, run } = require('../platform/academy/billing/cli');
const { createAcademyBilling } = require('../platform/academy/billing');

function logger(level, event, fields) {
  if (level === 'error' || level === 'warn') process.stderr.write(`${JSON.stringify({ level, event, ...fields })}\n`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const code = await run(parsed, {
    env: process.env,
    engineFactory: () => createAcademyBilling({
      env: process.env,
      databaseUrl: String(process.env.DATABASE_URL || '').trim(),
      databaseSsl: String(process.env.DATABASE_SSL || '').trim(),
      logger
    })
  });
  process.exitCode = code;
  /* The Stripe SDK keeps sockets alive; do not let them hold the shell. */
  setTimeout(() => process.exit(code), 1000).unref();
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`academy-billing: ${String(error && error.message || error)}\n`);
    process.exit(1);
  });
}
