'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPreflight } = require('./preflight');
const { createCatalog } = require('./catalog');
const k = require('./testkit');

const { GUILD, APP, ACADEMY_ROLE, LIFETIME_ROLE, MONARCH, PREMIUM, ELITE } = k;
const BOT_ROLE = '1700000000000000021';

function setup({ roles = null, botRoles = [BOT_ROLE], overrides = {}, account, endpoints = [], prices = {} } = {}) {
  const now = k.clock();
  const config = k.config(overrides);
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe({ account, endpoints, prices });
  const bot = k.createFakeBot({ members: { [APP]: botRoles }, roles });
  const logs = [];
  const preflight = createPreflight({ config, stripeApi: stripe, bot, catalog: createCatalog({ config, stripeApi: stripe, now }), store, now,
    logger: (level, event, fields) => logs.push({ level, event, fields }) });
  return { preflight, logs, store, stripe };
}

const role = (id, position, extra = {}) => ({ id, position, permissions: '0', managed: false, ...extra });
const defaultRoles = (overrides = {}) => [
  role(GUILD, 0), role(BOT_ROLE, 21, { permissions: String(1n << 28n), managed: true }),
  role(ACADEMY_ROLE, 1), role(LIFETIME_ROLE, 2), role(MONARCH, 30), ...(overrides.extra || [])
];

test('passes with MANAGE_ROLES, plain engine roles below the bot and a matching account', async () => {
  const t = setup({ roles: defaultRoles() });
  const result = await t.preflight.run();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stripeAccountOk, true);
  assert.equal(t.preflight.discordOk(), true);
  const log = t.logs.find((l) => l.event === 'academy_billing_preflight');
  assert.equal(log.fields.ok, true);
  assert.equal(log.fields.guildId, GUILD);
  assert.equal(JSON.stringify(log).includes('rk_test'), false);
  assert.equal(JSON.stringify(log).includes('academy-bot-token'), false);
});

test('fails without MANAGE_ROLES (ADMINISTRATOR also counts)', async () => {
  const noPerm = setup({ roles: [role(GUILD, 0), role(BOT_ROLE, 21, { managed: true }), role(ACADEMY_ROLE, 1), role(LIFETIME_ROLE, 2)] });
  assert.ok((await noPerm.preflight.run()).discord.errors.includes('bot_missing_manage_roles'));
  const admin = setup({ roles: [role(GUILD, 0), role(BOT_ROLE, 21, { managed: true, permissions: '8' }), role(ACADEMY_ROLE, 1), role(LIFETIME_ROLE, 2)] });
  assert.equal((await admin.preflight.run()).discordOk, true);
});

test('fails when an engine role is missing, managed, has permissions or sits above the bot', async () => {
  const cases = [
    [[role(GUILD, 0), role(BOT_ROLE, 21, { permissions: String(1n << 28n) }), role(LIFETIME_ROLE, 2)], 'academy_role_missing'],
    [defaultRoles().map((r) => (r.id === ACADEMY_ROLE ? { ...r, managed: true } : r)), 'academy_role_managed'],
    [defaultRoles().map((r) => (r.id === LIFETIME_ROLE ? { ...r, permissions: '8' } : r)), 'mem_lifetime_role_has_permissions'],
    [defaultRoles().map((r) => (r.id === LIFETIME_ROLE ? { ...r, position: 25 } : r)), 'mem_lifetime_role_not_below_bot'],
    [defaultRoles().map((r) => (r.id === ACADEMY_ROLE ? { ...r, position: 21 } : r)), 'academy_role_not_below_bot']
  ];
  for (const [roles, error] of cases) {
    const result = await setup({ roles }).preflight.run();
    assert.equal(result.ok, false, error);
    assert.ok(result.discord.errors.includes(error), `${error} in ${result.discord.errors}`);
  }
});

test('fails on a Stripe account mismatch; a key without Account read falls back to prices', async () => {
  const wrong = await setup({ roles: defaultRoles(), account: { id: 'acct_other' } }).preflight.run();
  assert.equal(wrong.stripeAccountOk, false);
  assert.ok(wrong.stripe.errors.includes('stripe_account_mismatch'));
  const denied = Object.assign(new Error('permission'), { type: 'StripePermissionError', statusCode: 403 });
  const fallback = await setup({ roles: defaultRoles(), account: denied }).preflight.run();
  assert.equal(fallback.stripe.accountCheck, 'no_permission');
  assert.equal(fallback.stripeAccountOk, true);
  assert.ok(fallback.stripe.warnings.includes('stripe_account_read_not_permitted_price_checks_only'));
});

test('an Academy endpoint subscribed to invoice.created is refused', async () => {
  const endpoints = [{ id: 'we_1', url: 'https://making-easy-money-academy.onrender.com/v1/academy/billing/stripe/webhook', enabled_events: ['invoice.paid', 'invoice.created'] }];
  const result = await setup({ roles: defaultRoles(), endpoints }).preflight.run();
  assert.equal(result.stripeOk, false);
  assert.ok(result.stripe.errors.includes('academy_endpoint_subscribes_invoice_created'));
});

test('an invalid sellable price is unsellable and audited once as config_invalid_price', async () => {
  const bad = { price_weekly1: { ...k.stripePrice('price_weekly1'), recurring: { interval: 'week', interval_count: 2 } } };
  const t = setup({ roles: defaultRoles(), prices: bad });
  const result = await t.preflight.run();
  assert.equal(result.stripe.sellable.includes('weekly'), false);
  assert.deepEqual(result.stripe.invalid.map((p) => p.priceId), ['price_weekly1']);
  await t.preflight.run();
  assert.deepEqual(k.actions(t.store), ['config_invalid_price']);
});

test('a Discord failure fails the Discord half closed', async () => {
  const t = setup({ roles: defaultRoles() });
  const bot = k.createFakeBot({ members: { [APP]: [BOT_ROLE] }, roles: defaultRoles() });
  bot.getGuild = async () => { throw k.discordError('unauthorized', 401, 0); };
  const preflight = createPreflight({ config: k.config(), stripeApi: t.stripe, bot, catalog: createCatalog({ config: k.config(), stripeApi: t.stripe }) });
  const result = await preflight.run();
  assert.equal(result.discordOk, false);
  assert.ok(result.discord.errors.includes('discord_unauthorized'));
});

test('a sellable price with us_bank_account WARNS about ACH Direct Debit and the verification method, never fails', async () => {
  const t = setup({ roles: defaultRoles(), overrides: k.BANK_LIFETIME_ENV });
  const result = await t.preflight.run();
  assert.equal(result.ok, true, JSON.stringify(result.stripe.errors));
  assert.deepEqual(result.stripe.bankPrices, ['price_life1']);
  for (const warning of ['us_bank_account_needs_ach_direct_debit_enabled_on_the_stripe_account', 'us_bank_account_checkout_sends_verification_method_automatic']) {
    assert.ok(result.stripe.warnings.includes(warning), warning);
  }
  const log = t.logs.find((l) => l.event === 'academy_billing_preflight');
  assert.equal(log.level, 'info');
  assert.deepEqual(log.fields.bankDebitPrices, ['price_life1']);
  assert.ok(log.fields.warnings.includes('us_bank_account_needs_ach_direct_debit_enabled_on_the_stripe_account'));
  assert.deepEqual(k.actions(t.store), []);
  /* card-only prices: no bank warnings at all */
  const plain = await setup({ roles: defaultRoles() }).preflight.run();
  assert.deepEqual(plain.stripe.bankPrices, []);
  assert.equal(plain.stripe.warnings.some((w) => w.startsWith('us_bank_account')), false);
});

test('external roles: missing or above the bot WARN clearly (grants would 403), never fail; below the bot is quiet', async () => {
  /* today: Monarch at 17 above a bot at 12 */
  const today = [role(GUILD, 0), role(BOT_ROLE, 12, { permissions: String(1n << 28n), managed: true }), role(ACADEMY_ROLE, 1),
    role(MONARCH, 17, { permissions: '1024' }), role(PREMIUM, 5, { permissions: '1024' })];
  const t = setup({ roles: today, overrides: k.ownerEnv() });
  const result = await t.preflight.run();
  assert.equal(result.ok, true, JSON.stringify([result.stripe.errors, result.discord.errors]));
  const warnings = result.discord.warnings;
  assert.ok(warnings.includes(`external_role_not_below_bot:${MONARCH}:grants_would_fail_403_move_the_bot_role_above_position_17`), warnings.join());
  assert.ok(warnings.includes(`external_role_missing:${ELITE}`));
  assert.equal(warnings.some((w) => w.includes(PREMIUM)), false, 'Premium sits below the bot');
  assert.deepEqual(result.discord.external[MONARCH], { exists: true, position: 17, belowBot: false, granted: true });
  assert.deepEqual(result.discord.external[PREMIUM], { exists: true, position: 5, belowBot: true, granted: true });
  const log = t.logs.find((l) => l.event === 'academy_billing_preflight');
  assert.equal(log.fields.externalRoles[MONARCH].belowBot, false);
  assert.ok(log.fields.warnings.some((w) => w.startsWith(`external_role_not_below_bot:${MONARCH}`)));
  /* the fix: drag the bot role above Monarch */
  const fixed = today.map((r) => (r.id === BOT_ROLE ? { ...r, position: 20 } : r));
  const ok = await setup({ roles: fixed, overrides: k.ownerEnv() }).preflight.run();
  assert.equal(ok.discord.warnings.some((w) => w.startsWith('external_role_not_below_bot')), false);
});

test('without the optional lifetime role nothing about it is checked; memberships are listed as sellable', async () => {
  const roles = [role(GUILD, 0), role(BOT_ROLE, 21, { permissions: String(1n << 28n), managed: true }), role(ACADEMY_ROLE, 1), role(MONARCH, 17), role(PREMIUM, 5), role(ELITE, 6)];
  const result = await setup({ roles, overrides: k.ownerEnv() }).preflight.run();
  assert.equal(result.ok, true, JSON.stringify(result.discord.errors));
  assert.deepEqual(Object.keys(result.discord.engine), ['academy']);
  assert.deepEqual(result.stripe.memberships.sort(), ['price_premium1', 'price_premlife1'].sort());
  assert.ok(result.stripe.sellable.includes('lifetime'));
});

test('AUTO_JOIN needs Create Instant Invite on the bot (guilds.join)', async () => {
  const noInvite = await setup({ roles: defaultRoles(), overrides: { SML_ACADEMY_BILLING_AUTO_JOIN: '1' } }).preflight.run();
  assert.ok(noInvite.discord.errors.includes('auto_join_needs_create_instant_invite'));
  const invite = defaultRoles().map((r) => (r.id === BOT_ROLE ? { ...r, permissions: String((1n << 28n) | 1n) } : r));
  const ok = await setup({ roles: invite, overrides: { SML_ACADEMY_BILLING_AUTO_JOIN: '1' } }).preflight.run();
  assert.equal(ok.discordOk, true);
  assert.equal(ok.discord.createInvite, true);
});

test('ALLOW_NON_MEMBER / AUTO_JOIN without Ban Members WARN (a banned buyer would not be refused at checkout), never fail', async () => {
  const W = 'ban_members_missing_banned_non_members_are_not_refused_at_checkout';
  const strict = await setup({ roles: defaultRoles() }).preflight.run();
  assert.equal(strict.discord.warnings.includes(W), false, 'strict mode sells to server members only');
  for (const overrides of [{ SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1' }]) {
    const open = await setup({ roles: defaultRoles(), overrides }).preflight.run();
    assert.ok(open.discord.warnings.includes(W));
    assert.equal(open.discordOk, true);
    assert.equal(open.discord.banMembers, false);
  }
  const withBan = defaultRoles().map((r) => (r.id === BOT_ROLE ? { ...r, permissions: String((1n << 28n) | (1n << 2n)) } : r));
  const ok = await setup({ roles: withBan, overrides: { SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1' } }).preflight.run();
  assert.equal(ok.discord.warnings.includes(W), false);
  assert.equal(ok.discord.banMembers, true);
});

test('an account read that shows the ACH capability inactive adds a warning; active adds none', async () => {
  const inactive = await setup({ roles: defaultRoles(), overrides: k.BANK_LIFETIME_ENV,
    account: { id: k.ACCOUNT, capabilities: { card_payments: 'active', us_bank_account_ach_payments: 'inactive' } } }).preflight.run();
  assert.equal(inactive.ok, true);
  assert.equal(inactive.stripe.achCapability, 'inactive');
  assert.ok(inactive.stripe.warnings.includes('us_bank_account_ach_payments_capability_inactive'));
  const active = await setup({ roles: defaultRoles(), overrides: k.BANK_LIFETIME_ENV,
    account: { id: k.ACCOUNT, capabilities: { us_bank_account_ach_payments: 'active' } } }).preflight.run();
  assert.equal(active.stripe.warnings.some((w) => w.startsWith('us_bank_account_ach_payments_capability')), false);
  /* a retired (sell:false) bank price is not warned about */
  const retired = k.pricesJson({ price_life1: { sell: false, paymentMethods: ['card', 'us_bank_account'] } });
  const quiet = await setup({ roles: defaultRoles(), overrides: { SML_ACADEMY_BILLING_PRICES_JSON: retired } }).preflight.run();
  assert.deepEqual(quiet.stripe.bankPrices, []);
});
