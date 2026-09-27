'use strict';

/* =============================================================================
 * MEM Academy billing: operator CLI (run from the academy service's Render
 * shell). There is NO HTTP admin surface; this is it.
 *
 *   read-only   status | preflight | validate-config | audit verify
 *               external-review [--state needs_review|revoke_unfinished|engine_granted|held|kept_external|revoked|released|all]
 *               (default: needs_review plus every unfinished revoke;
 *               external-review --recheck --apply --actor <label> re-runs the
 *               Upgrade.Chat check for every listed member now;
 *               external-review --keep --discord <id> --role <id> --reason "..."
 *               --apply --actor <label> settles one needs_review row as kept)
 *   dry-run by default; --apply --actor <label> to write:
 *               reconcile [--force-breaker]
 *               resync <discordId>
 *               rebuild-from-stripe
 *               replay-event <evt_id>
 *               replay-deferred
 *               rebind <newDiscordId> <cus_id> --reason "..."
 *               comp grant --discord <id> [--include-lifetime-role] [--role <id>[,<id>]] [--no-academy]
 *                          [--expires YYYY-MM-DD] --reason "..."
 *               comp revoke --id <n> --reason "..."
 *               purge-test [--force]
 *
 * Every mutation is audited as actor 'cli:<label>'. Output is JSON with ids
 * and counts only, never a secret.
 * ========================================================================== */

const { parseBillingConfig, describeConfig } = require('./config');
const { verifyChain, append, appendStandalone } = require('./audit');
const shapes = require('./stripe-shapes');
const { STAFF_KEEP_REASON } = require('./external');

const SNOWFLAKE = /^[0-9]{15,24}$/;
const ACTOR = /^[A-Za-z0-9_.@-]{1,64}$/;

const USAGE = [
  'usage: node scripts/academy-billing.js <command> [args] [--apply --actor <label>]',
  '  status | preflight | validate-config | audit verify',
  '  external-review [--state needs_review|revoke_unfinished|engine_granted|held|kept_external|revoked|released|all] [--recheck --apply --actor <label>]',
  '  external-review --keep --discord <id> --role <id> --reason "..." [--apply --actor <label>]',
  '  reconcile [--force-breaker] | resync <discordId> | rebuild-from-stripe',
  '  replay-event <evt_id> | replay-deferred',
  '  rebind <newDiscordId> <cus_id> --reason "..."',
  '  comp grant --discord <id> [--include-lifetime-role] [--role <id>[,<id>]] [--no-academy] [--expires YYYY-MM-DD] --reason "..."',
  '  comp revoke --id <n> --reason "..."',
  '  purge-test [--force]'
].join('\n');

const MUTATING = new Set(['reconcile', 'resync', 'rebuild-from-stripe', 'replay-event', 'replay-deferred', 'rebind', 'comp', 'purge-test']);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (['apply', 'force-breaker', 'include-lifetime-role', 'force', 'no-academy', 'recheck', 'keep'].includes(key)) flags[key] = true;
      else if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i += 1; }
      else flags[key] = true;
    } else positional.push(arg);
  }
  return { command: positional[0] || '', args: positional.slice(1), flags };
}

/** Mutations need BOTH --apply and --actor <label>; otherwise dry-run. */
function mutationMode(parsed) {
  if (!parsed.flags.apply) return { apply: false, actor: 'cli:dry-run' };
  const label = String(parsed.flags.actor || '');
  if (!ACTOR.test(label)) throw new Error('--apply requires --actor <label> (letters, digits, _ . @ -)');
  return { apply: true, actor: `cli:${label}` };
}

function parseExpiry(value, now) {
  if (value === undefined || value === true) return null;
  const at = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? Date.parse(`${value}T23:59:59Z`) : Date.parse(String(value));
  if (!Number.isFinite(at) || at <= now) throw new Error('--expires must be a future date (YYYY-MM-DD)');
  return at;
}

function requireReason(flags) {
  const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
  if (reason.length < 3 || reason.length > 200) throw new Error('--reason "<3-200 characters>" is required');
  return reason;
}

async function run(parsed, { env = process.env, engineFactory, out = (obj) => process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`), now = Date.now } = {}) {
  const { command, args, flags } = parsed;
  if (!command || command === 'help') { out({ ok: true, usage: USAGE }); return 0; }

  if (command === 'validate-config') {
    const config = parseBillingConfig(env, { throwOnInvalid: false });
    out({ ok: config.errors.length === 0, config: describeConfig(config) });
    return config.errors.length ? 2 : 0;
  }
  const mutating = MUTATING.has(command) || (command === 'external-review' && (flags.recheck === true || flags.keep === true));
  const mode = mutating ? mutationMode(parsed) : { apply: false, actor: 'cli:read' };
  const engine = engineFactory();
  const { store, config } = engine;
  if (!store) throw new Error('billing engine is not configured (DATABASE_URL and SML_ACADEMY_BILLING_* are required)');
  const ensureSchema = async () => { if (!await engine.checkSchema()) throw new Error('schema 028 is not applied'); };
  const needStripeWrites = async () => {
    const result = await engine.preflight.run();
    if (!result || !result.stripeAccountOk) throw new Error('preflight did not confirm the Stripe account; refusing Stripe writes');
  };
  const cliAudit = (row) => appendStandalone(store.pool, { actor: mode.actor, livemode: config.livemode, ...row }, { now });
  /* Revokes and Stripe writes wait for preflight to confirm the Stripe
     account; run it (best effort) before a mutation that resyncs. If it does
     not pass, the resync defers revokes and the service finishes the job. */
  const warmPreflight = () => Promise.resolve().then(() => engine.preflight.run()).catch(() => null);

  /* external-review --keep: staff decided a needs_review role stays (for
     example a Monarch staff handed out, outside Upgrade.Chat). The row
     becomes kept_external: the engine never removes it and stops re-checking. */
  async function keepExternal() {
    const discordId = String(flags.discord || '');
    const roleId = String(flags.role || '');
    if (!SNOWFLAKE.test(discordId) || !SNOWFLAKE.test(roleId)) throw new Error('usage: external-review --keep --discord <id> --role <id> --reason "..."');
    const reason = requireReason(flags);
    const grant = await store.getExternalGrant(store.pool, discordId, roleId);
    if (!grant || grant.state !== 'needs_review') throw new Error('--keep settles a needs_review row only');
    if (!mode.apply) { out({ ok: true, apply: false, wouldKeep: { discordId, roleId } }); return 0; }
    const kept = await store.withUserTx(discordId, async (client) => {
      const generation = await store.updateExternalGrant(client, { discordId, roleId, generation: grant.generation, state: 'kept_external', reason: STAFF_KEEP_REASON });
      if (generation === null) return false;
      await append(client, { actor: mode.actor, livemode: config.livemode, discordUserId: discordId, roleKey: 'external', action: 'external_grant_state',
        outcome: 'noop', reason, details: { roleId, from: 'needs_review', to: 'kept_external', hadRoleBefore: Boolean(grant.had_role_before) } }, { now });
      return true;
    });
    if (!kept) throw new Error('the row changed meanwhile; run external-review again');
    out({ ok: true, apply: true, kept: { discordId, roleId } });
    return 0;
  }

  try {
    switch (command) {
      case 'status': {
        await ensureSchema();
        out({ ok: true, config: describeConfig(config), counts: await store.statusCounts(store.pool) });
        return 0;
      }
      case 'preflight': {
        const result = await engine.preflight.run();
        out({ ok: Boolean(result && result.ok), preflight: result });
        return result && result.ok ? 0 : 2;
      }
      case 'audit': {
        if (args[0] !== 'verify') throw new Error('usage: audit verify');
        await ensureSchema();
        const result = await verifyChain(store.pool);
        out({ ok: result.ok, audit: result });
        return result.ok ? 0 : 2;
      }
      case 'external-review': {
        /* External roles (Monarch / Elite / Premium) the engine granted but
           did NOT remove, because the Upgrade.Chat check was not configured,
           failed or was inconclusive, or because the member held the role
           before the engine granted it; plus revokes whose DELETE did not
           land (failed, or held by the kill switch; the next resync of the
           member asks Upgrade.Chat again and re-queues them). */
        await ensureSchema();
        if (flags.keep) return await keepExternal();
        const states = ['needs_review', 'engine_granted', 'held', 'kept_external', 'revoked', 'released'];
        const defaultView = flags.state === undefined || flags.state === true;
        const wanted = defaultView ? ['needs_review', 'revoke_unfinished']
          : (String(flags.state) === 'all' ? [...states, 'revoke_unfinished'] : String(flags.state).split(',').map((s) => s.trim()).filter(Boolean));
        if (!wanted.length || wanted.some((s) => s !== 'revoke_unfinished' && !states.includes(s))) {
          throw new Error(`--state must be one of ${[...states, 'revoke_unfinished'].join('|')}|all`);
        }
        const query = { states: wanted.filter((s) => s !== 'revoke_unfinished'), unfinished: wanted.includes('revoke_unfinished') };
        const found = await store.externalReviewRows(store.pool, query);
        const rows = found.map((r) => ({
          discordId: String(r.discord_user_id), roleId: String(r.role_id), state: r.state, hadRoleBefore: Boolean(r.had_role_before),
          revokeUnfinished: r.state === 'revoked' && r.outbox_desired === false && ['failed', 'suppressed'].includes(r.outbox_state),
          outbox: r.outbox_state || null,
          firstSourceRef: r.first_source_ref || null, reason: r.last_reason || null, uc: r.uc_result || null,
          ucCheckedAt: r.uc_checked_at ? new Date(r.uc_checked_at).toISOString() : null,
          since: r.state_changed_at ? new Date(r.state_changed_at).toISOString() : null
        }));
        const ids = [...new Set(rows.map((r) => r.discordId))];
        const hint = 'needs_review: the engine did NOT remove these roles. Check the member in Upgrade.Chat. If the role should go, remove it by hand in Discord '
          + '(the next resync records it as revoked, or released for a role the member held before); if it should stay, run --keep; if Upgrade.Chat '
          + 'was down or not configured, fix it and run --recheck. revokeUnfinished: a DELETE that did not land; the next resync asks Upgrade.Chat '
          + 'again and re-queues it (--recheck does it now).';
        if (!flags.recheck) { out({ ok: true, count: rows.length, states: wanted, ucConfigured: Boolean(config.ucConfigured), ucMatch: config.ucMatch, hint, rows }); return 0; }
        if (!mode.apply) { out({ ok: true, apply: false, wouldRecheck: ids }); return 0; }
        await warmPreflight();
        const results = [];
        for (const id of ids) {
          results.push({ discordId: id, result: await engine.resync(id, { actor: mode.actor, ucRecheck: true }).catch((error) => ({ error: String(error && error.message) })) });
        }
        await cliAudit({ action: 'external_review_recheck', outcome: 'applied', details: { members: ids.length } });
        const after = await store.externalReviewRows(store.pool, query);
        out({ ok: true, apply: true, rechecked: ids.length, remaining: after.length, results });
        return 0;
      }
      case 'reconcile': {
        await ensureSchema();
        await engine.preflight.run();
        const summary = await engine.reconciler.run({ mode: mode.apply ? 'apply' : 'dry_run', forceBreaker: Boolean(flags['force-breaker']), actor: mode.actor });
        out({ ok: !summary.error && !summary.skipped, reconcile: summary });
        return summary.error || summary.skipped ? 2 : 0;
      }
      case 'resync': {
        const id = String(args[0] || '');
        if (!SNOWFLAKE.test(id)) throw new Error('usage: resync <discordId>');
        await ensureSchema();
        if (mode.apply) await needStripeWrites();
        const result = await engine.resync(id, { actor: mode.actor, dryRun: !mode.apply });
        out({ ok: true, apply: mode.apply, resync: result });
        return 0;
      }
      case 'rebuild-from-stripe': {
        await ensureSchema();
        const found = await engine.stripe.searchAcademyCustomers();
        const plan = [];
        for (const customer of found.data || []) {
          if (customer.deleted || Boolean(customer.livemode) !== Boolean(config.livemode) || !shapes.isAcademyMeta(customer.metadata)) continue;
          const discordId = String(customer.metadata.mem_academy_discord_user || '');
          if (!SNOWFLAKE.test(discordId)) continue;
          const bound = await store.getMemberByCustomer(store.pool, customer.id);
          if (bound) continue;
          plan.push({ discordId, customerId: customer.id });
        }
        let rebuilt = 0;
        if (mode.apply) {
          for (const item of plan) {
            const n = await store.withUserTx(item.discordId, async (client) => {
              const count = await store.upsertRebuiltMember(client, { discordId: item.discordId, customerId: item.customerId, accountId: config.stripeAccountId });
              if (count) {
                await append(client, { actor: mode.actor, livemode: config.livemode, discordUserId: item.discordId, action: 'binding_rebuilt',
                  outcome: 'applied', reason: 'rebuild_from_stripe', stripeRefs: [item.customerId] }, { now });
              }
              return count;
            });
            rebuilt += n;
            if (n && rebuilt === 1) await warmPreflight();
            if (n) await engine.resync(item.discordId, { actor: mode.actor }).catch(() => null);
          }
        }
        out({ ok: true, apply: mode.apply, complete: found.complete !== false, candidates: plan.length, rebuilt,
          plan: plan.map((p) => ({ discordId: p.discordId, customerId: p.customerId })) });
        return 0;
      }
      case 'replay-event': {
        const eventId = String(args[0] || '');
        if (!/^evt_[A-Za-z0-9]+$/.test(eventId)) throw new Error('usage: replay-event <evt_id>');
        await ensureSchema();
        if (!mode.apply) { out({ ok: true, apply: false, wouldReplay: eventId }); return 0; }
        const row = await store.replayEvent(store.pool, eventId);
        if (!row) throw new Error('event not found for this livemode');
        await cliAudit({ action: 'event_replayed', outcome: 'applied', eventId });
        out({ ok: true, apply: true, replayed: row });
        return 0;
      }
      case 'replay-deferred': {
        await ensureSchema();
        if (!mode.apply) {
          const counts = await store.statusCounts(store.pool);
          out({ ok: true, apply: false, events: counts.events });
          return 0;
        }
        const n = await store.replayDeferred(store.pool);
        await cliAudit({ action: 'events_replayed', outcome: 'applied', details: { count: n } });
        out({ ok: true, apply: true, replayed: n });
        return 0;
      }
      case 'rebind': {
        const toId = String(args[0] || '');
        const customerId = String(args[1] || '');
        if (!SNOWFLAKE.test(toId) || !/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new Error('usage: rebind <newDiscordId> <cus_id> --reason "..."');
        const reason = requireReason(flags);
        await ensureSchema();
        const from = await store.getMemberByCustomer(store.pool, customerId);
        if (!from) throw new Error('that customer is not bound to any Discord id in this livemode');
        const fromId = String(from.discord_user_id);
        if (fromId === toId) throw new Error('the customer is already bound to that Discord id');
        const target = await store.getMember(store.pool, toId);
        if (target && target.stripe_customer_id) throw new Error('the new Discord id already has its own customer; resolve that first');
        if (!mode.apply) { out({ ok: true, apply: false, plan: { fromId, toId, customerId } }); return 0; }
        await needStripeWrites();
        /* 1. Stripe first: Customer, every Academy subscription and lifetime
              PaymentIntent point at the new id (so a rebuild yields it). */
        const meta = { mem_academy_discord_user: toId };
        await engine.stripe.updateCustomer(customerId, { metadata: meta }, `mem-academy-rebind-v1-${customerId}-${toId}`);
        const subs = await engine.stripe.listSubscriptions(customerId);
        for (const sub of subs.data || []) {
          if (shapes.isAcademyMeta(sub.metadata)) await engine.stripe.updateSubscription(sub.id, { metadata: meta }, `mem-academy-rebind-v1-${sub.id}-${toId}`);
        }
        const pis = await engine.stripe.listPaymentIntents(customerId);
        for (const pi of pis.data || []) {
          if (shapes.isAcademyMeta(pi.metadata)) await engine.stripe.updatePaymentIntent(pi.id, { metadata: meta }, `mem-academy-rebind-v1-${pi.id}-${toId}`);
        }
        /* 2. Move the binding (tombstone the old id) in one transaction. */
        await store.withTx(async (client) => {
          for (const id of [fromId, toId].sort()) await store.lockUser(client, id);
          await store.moveBinding(client, { fromId, toId, customerId, accountId: config.stripeAccountId });
          await append(client, { actor: mode.actor, livemode: config.livemode, discordUserId: toId, action: 'binding_rebound',
            outcome: 'applied', reason, stripeRefs: [customerId], details: { fromDiscordUser: fromId } }, { now });
        });
        /* 3. Old id loses the roles, new id gains them. */
        const oldResult = await engine.resync(fromId, { actor: mode.actor }).catch((error) => ({ error: String(error && error.message) }));
        const newResult = await engine.resync(toId, { actor: mode.actor }).catch((error) => ({ error: String(error && error.message) }));
        out({ ok: true, apply: true, fromId, toId, customerId, old: oldResult, new: newResult });
        return 0;
      }
      case 'comp': {
        const sub = args[0];
        await ensureSchema();
        if (sub === 'grant') {
          const discordId = String(flags.discord || '');
          if (!SNOWFLAKE.test(discordId)) throw new Error('--discord <id> is required');
          const reason = requireReason(flags);
          const expiresAt = parseExpiry(flags.expires, now());
          const includeLifetimeRole = Boolean(flags['include-lifetime-role']);
          if (includeLifetimeRole && !config.lifetimeRoleId) {
            throw new Error('--include-lifetime-role needs SML_ACADEMY_BILLING_LIFETIME_ROLE_ID, which is unset (Lifetime grants Monarch through the lifetime price "roles"); use --role <id> instead');
          }
          const externalRoleIds = flags.role === undefined ? [] : String(flags.role).split(',').map((s) => s.trim()).filter(Boolean);
          for (const roleId of externalRoleIds) {
            if (!SNOWFLAKE.test(roleId) || !(config.externalRoleIds || []).includes(roleId)) {
              throw new Error(`--role ${roleId.slice(0, 24)} is not in SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS`);
            }
          }
          if (new Set(externalRoleIds).size !== externalRoleIds.length || externalRoleIds.length > 10) throw new Error('--role lists a role twice or more than 10 roles');
          const grantsAcademy = !flags['no-academy'];
          if (!grantsAcademy && !includeLifetimeRole && !externalRoleIds.length) throw new Error('a comp must grant something: drop --no-academy or add --role');
          const planned = { discordId, grantsAcademy, includeLifetimeRole, externalRoleIds, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null };
          if (!mode.apply) { out({ ok: true, apply: false, plan: planned }); return 0; }
          const comp = await store.withUserTx(discordId, async (client) => {
            await store.ensureMember(client, { discordId, boundVia: 'admin' });
            const row = await store.insertComp(client, { discordId, includeLifetimeRole, reason, grantedBy: mode.actor, expiresAt, grantsAcademy, externalRoleIds });
            await append(client, { actor: mode.actor, livemode: config.livemode, discordUserId: discordId, action: 'comp_granted', outcome: 'applied',
              reason, details: { comp: Number(row.id), grantsAcademy, includeLifetimeRole, externalRoleIds, expiresAt: planned.expiresAt } }, { now });
            return row;
          });
          await warmPreflight();
          const result = await engine.resync(discordId, { actor: mode.actor }).catch((error) => ({ error: String(error && error.message) }));
          out({ ok: true, apply: true, comp: { id: Number(comp.id), discordId }, resync: result });
          return 0;
        }
        if (sub === 'revoke') {
          const id = Number(flags.id);
          if (!Number.isSafeInteger(id) || id <= 0) throw new Error('--id <n> is required');
          const reason = requireReason(flags);
          if (!mode.apply) { out({ ok: true, apply: false, plan: { comp: id } }); return 0; }
          const row = await store.withTx(async (client) => {
            const revoked = await store.revokeComp(client, { id, revokedBy: mode.actor, reason });
            if (revoked) {
              await append(client, { actor: mode.actor, livemode: config.livemode, discordUserId: revoked.discord_user_id, action: 'comp_revoked',
                outcome: 'applied', reason, details: { comp: id } }, { now });
            }
            return revoked;
          });
          if (!row) throw new Error('comp not found or already revoked');
          await warmPreflight();
          const result = await engine.resync(String(row.discord_user_id), { actor: mode.actor }).catch((error) => ({ error: String(error && error.message) }));
          out({ ok: true, apply: true, revoked: id, resync: result });
          return 0;
        }
        throw new Error('usage: comp grant|revoke ...');
      }
      case 'purge-test': {
        await ensureSchema();
        if (!config.livemode && !flags.force) throw new Error('the engine is in test mode; purge-test removes its own rows. Add --force to do it anyway.');
        if (!mode.apply) { out({ ok: true, apply: false, wouldDelete: 'every livemode=false row except the audit' }); return 0; }
        const counts = await store.withTx(async (client) => {
          const deleted = await store.purgeTestRows(client);
          await append(client, { actor: mode.actor, livemode: false, action: 'purge_test', outcome: 'applied', details: deleted }, { now });
          return deleted;
        });
        out({ ok: true, apply: true, deleted: counts });
        return 0;
      }
      default:
        out({ ok: false, usage: USAGE });
        return 2;
    }
  } finally {
    await engine.stop().catch(() => {});
  }
}

module.exports = { parseArgs, mutationMode, parseExpiry, run, USAGE };
