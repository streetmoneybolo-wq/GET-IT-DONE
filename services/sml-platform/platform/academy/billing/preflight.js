'use strict';

/* =============================================================================
 * MEM Academy billing: preflight (boot and hourly).
 *
 * Gates (logged as academy_billing_preflight with ids and booleans only,
 * never a secret):
 *   - Discord role GRANTS need the Discord checks (discordOk);
 *   - every Stripe write AND every role REVOKE need the Stripe account
 *     confirmed (stripeAccountOk): a key on the wrong account reads every
 *     Customer as deleted, so resync defers revokes and the applier claims
 *     grants only until this passes;
 *   - checkout and the reconciler need everything (ok).
 *
 * Stripe
 *   - GET /v1/account equals SML_ACADEMY_BILLING_STRIPE_ACCOUNT_ID (a
 *     restricted key without Account read falls back to the price checks and
 *     says so);
 *   - every sell:true price: active, right livemode, usd, exact package shape,
 *     an Academy product (metadata sml_kind=mem_academy), tax_behavior set when
 *     automatic tax is on. A failing price becomes unsellable and is audited
 *     config_invalid_price (once per change);
 *   - if the key may list webhook endpoints: the Academy endpoint must NOT
 *     subscribe to invoice.created / invoice.upcoming (a 503 from this service
 *     would delay finalization of every MEM invoice for up to 72 h);
 *   - a sell:true price whose "paymentMethods" lists us_bank_account WARNS
 *     (never fails): ACH Direct Debit must be turned on for the account in the
 *     Stripe Dashboard (live AND test), or creating that Checkout Session
 *     fails; and the engine sends payment_method_options[us_bank_account]
 *     [verification_method]=automatic (Financial Connections, microdeposits as
 *     the fallback). When the account read shows the
 *     us_bank_account_ach_payments capability and it is not 'active', that is
 *     a warning too.
 * Discord
 *   - bot identity (logged; expected to equal SML_ACADEMY_APP_ID);
 *   - the guild is readable and equals SML_ACADEMY_GUILD_ID;
 *   - the bot has MANAGE_ROLES or ADMINISTRATOR;
 *   - with ALLOW_NON_MEMBER=1 or AUTO_JOIN=1, BAN_MEMBERS WARNS when missing:
 *     checkout then cannot tell a banned buyer (who could never join) from
 *     one who has not joined yet;
 *   - each configured engine role (Academy Student, and the lifetime role
 *     only if it is set) exists, is distinct, managed=false, permissions '0',
 *     not protected, and sits strictly BELOW the bot's top role;
 *   - every EXTERNAL role (SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS, default
 *     Monarch, Elite, Premium) WARNS (never fails) when it is missing,
 *     managed, or not strictly below the bot's top role: a grant of it would
 *     be refused with 403 (the applier then holds that row only). Monarch
 *     sits at position 17 today, so the bot role must be dragged above it.
 * ========================================================================== */

const { PERMISSIONS, memberPermissions } = require('./discord');
const audit = require('./audit');

const FORBIDDEN_ENDPOINT_EVENTS = Object.freeze(['invoice.created', 'invoice.upcoming', '*']);
const { US_BANK_VERIFICATION_METHOD } = require('./config');

/** Warnings (never errors) for prices that accept a bank debit. */
function bankDebitWarnings(config, account) {
  const bankPrices = [...config.prices.values()].filter((entry) => entry.sell && Array.isArray(entry.paymentMethods)
    && entry.paymentMethods.includes('us_bank_account')).map((entry) => entry.priceId);
  const warnings = [];
  if (!bankPrices.length) return { bankPrices, warnings, achCapability: null };
  warnings.push('us_bank_account_needs_ach_direct_debit_enabled_on_the_stripe_account');
  warnings.push(`us_bank_account_checkout_sends_verification_method_${US_BANK_VERIFICATION_METHOD}`);
  const capabilities = account && account.capabilities && typeof account.capabilities === 'object' ? account.capabilities : null;
  const achCapability = capabilities && typeof capabilities.us_bank_account_ach_payments === 'string' ? capabilities.us_bank_account_ach_payments : null;
  if (achCapability && achCapability !== 'active') warnings.push(`us_bank_account_ach_payments_capability_${achCapability}`);
  return { bankPrices, warnings, achCapability };
}

function createPreflight({ config, stripeApi, bot, catalog, store = null, logger = () => {}, now = Date.now } = {}) {
  let last = null;
  let lastInvalidKey = '';

  async function checkStripe() {
    const errors = [];
    const warnings = [];
    let accountOk = false;
    let accountCheck = 'skipped';
    let account = null;
    try {
      account = await stripeApi.retrieveAccount();
      accountCheck = 'checked';
      accountOk = Boolean(account && account.id === config.stripeAccountId);
      if (!accountOk) errors.push('stripe_account_mismatch');
    } catch (error) {
      const permission = error && (error.type === 'StripePermissionError' || error.statusCode === 403 || error.code === 'secret_key_required');
      if (permission) {
        accountCheck = 'no_permission';
        warnings.push('stripe_account_read_not_permitted_price_checks_only');
      } else {
        accountCheck = 'failed';
        errors.push('stripe_account_unreachable');
      }
    }

    const catalogState = await catalog.get({ force: true });
    if (!catalogState.complete) errors.push('stripe_price_fetch_failed');
    const invalid = catalogState.invalid;
    /* Account read not permitted: the prices themselves prove the account
       (they only resolve on the account that owns them) and the mode. */
    const sellableCount = catalogState.sellable.size + (catalogState.memberships ? catalogState.memberships.size : 0);
    if (accountCheck === 'no_permission') accountOk = catalogState.complete && sellableCount > 0 && !invalid.some((p) => p.problems.includes('price_livemode_mismatch'));

    let endpointCheck = 'skipped';
    try {
      const endpoints = await stripeApi.listWebhookEndpoints();
      endpointCheck = 'checked';
      const ours = (endpoints.data || []).filter((endpoint) => String(endpoint.url || '').includes('/v1/academy/billing/stripe/webhook'));
      if (!ours.length) warnings.push('academy_webhook_endpoint_not_found');
      for (const endpoint of ours) {
        const events = endpoint.enabled_events || [];
        if (events.some((event) => FORBIDDEN_ENDPOINT_EVENTS.includes(event))) errors.push('academy_endpoint_subscribes_invoice_created');
      }
    } catch (_) {
      endpointCheck = 'no_permission';
    }
    const bank = bankDebitWarnings(config, accountOk ? account : null);
    warnings.push(...bank.warnings);
    return { accountOk, accountCheck, endpointCheck, sellable: [...catalogState.sellable.keys()],
      memberships: catalogState.memberships ? [...catalogState.memberships.keys()] : [], invalid, bankPrices: bank.bankPrices,
      achCapability: bank.achCapability, errors, warnings };
  }

  async function checkDiscord() {
    const errors = [];
    const warnings = [];
    let botId = null;
    try {
      const me = await bot.getMe();
      botId = me && me.id ? String(me.id) : null;
      if (botId !== config.appId) warnings.push('bot_user_id_differs_from_app_id');
      const guild = await bot.getGuild();
      if (!guild || String(guild.id) !== config.guildId || config.guildId !== config.academyGuildId) errors.push('guild_mismatch');
      const roles = await bot.listRoles();
      const botMember = await bot.getMember(botId);
      if (!botMember.inGuild) errors.push('bot_not_in_guild');
      const { bits, topPosition } = memberPermissions({ guildId: config.guildId, roles, memberRoleIds: botMember.roles });
      const admin = (bits & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR;
      const manageRoles = admin || (bits & PERMISSIONS.MANAGE_ROLES) === PERMISSIONS.MANAGE_ROLES;
      if (!manageRoles) errors.push('bot_missing_manage_roles');
      const viewAuditLog = admin || (bits & PERMISSIONS.VIEW_AUDIT_LOG) === PERMISSIONS.VIEW_AUDIT_LOG;
      const createInvite = admin || (bits & PERMISSIONS.CREATE_INSTANT_INVITE) === PERMISSIONS.CREATE_INSTANT_INVITE;
      if (config.autoJoin && !createInvite) errors.push('auto_join_needs_create_instant_invite');
      const banMembers = admin || (bits & PERMISSIONS.BAN_MEMBERS) === PERMISSIONS.BAN_MEMBERS;
      if ((config.allowNonMember || config.autoJoin) && !banMembers) warnings.push('ban_members_missing_banned_non_members_are_not_refused_at_checkout');
      const byId = new Map((roles || []).map((role) => [String(role.id), role]));
      const engine = {};
      for (const [key, id] of Object.entries(config.engineRoleIds)) {
        if (!id) continue;
        const role = byId.get(String(id));
        if (!role) { errors.push(`${key}_role_missing`); continue; }
        if (role.managed) errors.push(`${key}_role_managed`);
        if (String(role.permissions || '0') !== '0') errors.push(`${key}_role_has_permissions`);
        if (config.protectedRoleIds.has(String(id))) errors.push(`${key}_role_protected`);
        if (!(Number(role.position) < topPosition)) errors.push(`${key}_role_not_below_bot`);
        engine[key] = { position: Number(role.position) };
      }
      if (config.engineRoleIds.academy === config.engineRoleIds.mem_lifetime) errors.push('engine_roles_not_distinct');
      const external = {};
      const granted = new Set([...config.prices.values()].flatMap((entry) => entry.roles || []));
      for (const id of config.externalRoleIds || []) {
        const role = byId.get(String(id));
        if (!role) { warnings.push(`external_role_missing:${id}`); external[id] = { exists: false, granted: granted.has(id) }; continue; }
        if (role.managed) warnings.push(`external_role_managed:${id}`);
        const below = Number(role.position) < topPosition;
        if (!below) warnings.push(`external_role_not_below_bot:${id}:grants_would_fail_403_move_the_bot_role_above_position_${Number(role.position)}`);
        external[id] = { exists: true, position: Number(role.position), belowBot: below, granted: granted.has(id) };
      }
      return { ok: !errors.length, botId, manageRoles, viewAuditLog, createInvite, banMembers, topPosition, engine, external, errors, warnings };
    } catch (error) {
      errors.push(`discord_${error && error.kind ? error.kind : 'error'}`);
      return { ok: false, botId, errors, warnings };
    }
  }

  async function run() {
    const stripe = await checkStripe().catch((error) => ({ accountOk: false, errors: [`stripe_${String(error && error.message || 'error').slice(0, 40)}`], warnings: [], invalid: [], sellable: [] }));
    const discord = await checkDiscord();
    const result = {
      ok: stripe.errors.length === 0 && discord.ok,
      stripeOk: stripe.errors.length === 0,
      stripeAccountOk: Boolean(stripe.accountOk),
      discordOk: discord.ok,
      checkedAt: now(),
      stripe,
      discord
    };
    last = result;
    logger(result.ok ? 'info' : 'error', 'academy_billing_preflight', {
      ok: result.ok,
      guildId: config.guildId,
      botId: discord.botId,
      manageRoles: discord.manageRoles,
      stripeAccount: stripe.accountOk ? config.stripeAccountId : null,
      accountCheck: stripe.accountCheck,
      endpointCheck: stripe.endpointCheck,
      sellable: stripe.sellable,
      memberships: stripe.memberships || [],
      externalRoles: discord.external || {},
      bankDebitPrices: stripe.bankPrices || [],
      invalidPrices: (stripe.invalid || []).map((p) => ({ priceId: p.priceId, problems: p.problems })),
      errors: [...stripe.errors, ...discord.errors],
      warnings: [...(stripe.warnings || []), ...(discord.warnings || [])]
    });
    const invalidKey = JSON.stringify((stripe.invalid || []).map((p) => [p.priceId, p.problems]));
    if (store && invalidKey !== lastInvalidKey && (stripe.invalid || []).length) {
      for (const price of stripe.invalid) {
        await audit.appendStandalone(store.pool, {
          actor: 'boot', livemode: config.livemode, action: 'config_invalid_price', outcome: 'noop',
          reason: price.problems.join(',').slice(0, 200), stripeRefs: [price.priceId], details: { package: price.package }
        }, { now }).catch(() => {});
      }
    }
    lastInvalidKey = invalidKey;
    return result;
  }

  return {
    run,
    last: () => last,
    ok: () => Boolean(last && last.ok),
    stripeOk: () => Boolean(last && last.stripeOk),
    stripeAccountOk: () => Boolean(last && last.stripeAccountOk),
    discordOk: () => Boolean(last && last.discordOk)
  };
}

module.exports = { createPreflight, bankDebitWarnings, FORBIDDEN_ENDPOINT_EVENTS };
