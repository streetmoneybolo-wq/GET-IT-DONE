'use strict';

/**
 * SML Connect slash commands — definitions + per-command handlers.
 *
 * Handlers here NEVER touch the database directly and NEVER require sibling
 * modules: every collaborator (identity graph, dispute service, reconciler,
 * audit store, authorization) is an injected constructor parameter, so the
 * whole module is unit-testable with small fakes.
 *
 * PRIVACY RULE (normative, DESIGN §3 / master prompt): no reply ever contains
 * customer emails, full names, payment identifiers, or evidence text. The
 * renderers below are WHITELIST-based — they only emit case ids, integer-cent
 * amounts, ISO dates, counts, and enum-shaped tokens that pass a strict
 * character filter. A field that fails the filter renders as 'unknown', so a
 * poisoned or unexpected value can never leak through a reply string.
 *
 * Every response is ephemeral (flags 64). Neutral, factual language only —
 * no template characterizes a person.
 */

const EPHEMERAL = 64;
const RATE_LIMIT_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_BUCKETS = 5000;
const BUCKET_IDLE_MS = 10 * 60 * 1000;
const MAX_LIST_LINES = 10;

const DEFAULT_REVIEW_URL_BASE = 'https://stockmarketloop.com/connect-review/';
const DEFAULT_SITE_BASE = 'https://stockmarketloop.com';
const MANAGE_GUILD_PERMISSION = '32';

const CASE_ID_OPTION = {
  type: 3, // STRING — a BIGSERIAL id can exceed the safe range of Discord's INTEGER option
  name: 'case_id',
  description: 'Dispute case id',
  required: true
};

/* Guild-scoped chat-input commands. default_member_permissions '0' hides them
 * from everyone until a guild admin grants access; contexts [0] = guild only.
 * Registered by scripts/register-connect-commands.js. */
const COMMAND_DEFINITIONS = [
  { type: 1, name: 'connect-setup', description: 'Start StockMarketLoop Connect setup for this Discord server', default_member_permissions: MANAGE_GUILD_PERMISSION, contexts: [0], options: [] },
  { type: 1, name: 'payments', description: 'Summarize recent payment records for your merchant scope', default_member_permissions: '0', contexts: [0], options: [] },
  { type: 1, name: 'subscriptions', description: 'Summarize subscription records for your merchant scope', default_member_permissions: '0', contexts: [0], options: [] },
  { type: 1, name: 'customer-history', description: 'Billing history counts for the account behind a dispute case', default_member_permissions: '0', contexts: [0], options: [CASE_ID_OPTION] },
  { type: 1, name: 'disputes', description: 'List dispute cases for your merchant scope', default_member_permissions: '0', contexts: [0], options: [] },
  { type: 1, name: 'dispute-view', description: 'Show one dispute case with its checklist state', default_member_permissions: '0', contexts: [0], options: [CASE_ID_OPTION] },
  { type: 1, name: 'dispute-build', description: 'Build a draft evidence packet for a dispute case', default_member_permissions: '0', contexts: [0], options: [CASE_ID_OPTION] },
  { type: 1, name: 'dispute-missing', description: 'List missing or weak checklist items for a dispute case', default_member_permissions: '0', contexts: [0], options: [CASE_ID_OPTION] },
  { type: 1, name: 'dispute-open-dashboard', description: 'Get a single-use link to the dispute review dashboard', default_member_permissions: '0', contexts: [0], options: [CASE_ID_OPTION] },
  { type: 1, name: 'role-status', description: 'Queue a role status check for this server', default_member_permissions: '0', contexts: [0], options: [] },
  { type: 1, name: 'role-reconcile', description: 'Queue a role reconciliation for this server', default_member_permissions: '0', contexts: [0], options: [] }
];

/* ------------------------------------------------------------------------- */
/* Whitelist renderers — the only way data reaches a reply string            */
/* ------------------------------------------------------------------------- */

/* Enum-shaped values only (provider names, reason codes, states, checklist
 * kinds, warning codes). '@', spaces and most punctuation are rejected, so an
 * email address or a person's name can never pass. */
const TOKEN_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

function token(value, fallback = 'unknown') {
  const text = typeof value === 'string' ? value.trim() : '';
  return TOKEN_RE.test(text) ? text : fallback;
}

function count(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

function money(cents, currency) {
  const n = Number(cents);
  if (!Number.isSafeInteger(n)) return 'amount unavailable';
  const cur = /^[A-Za-z]{3}$/.test(String(currency || '')) ? String(currency).toUpperCase() : 'XXX';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')} ${cur}`;
}

function when(value) {
  if (value == null) return 'none';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return 'none';
  return new Date(ms).toISOString();
}

function caseIdOf(row) {
  const n = Number(row && row.id);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function caseLine(row) {
  const id = caseIdOf(row);
  return [
    `case #${id == null ? 'unknown' : id}`,
    token(row && row.provider),
    `reason ${token(row && row.reason)}`,
    money(row && row.amount_cents, row && row.currency),
    `due ${when(row && row.due_by)}`,
    `state ${token(row && row.case_state)}`
  ].join(' · ');
}

function checklistCounts(list) {
  const totals = { present: 0, missing: 0, weak: 0 };
  for (const item of Array.isArray(list) ? list : []) {
    const state = item && item.state;
    if (state === 'present' || state === 'missing' || state === 'weak') totals[state] += 1;
  }
  return totals;
}

/* ------------------------------------------------------------------------- */
/* Fixed, neutral reply strings                                              */
/* ------------------------------------------------------------------------- */

const MSG_UNLINKED = 'This Discord account is not linked to a verified StockMarketLoop account. Link your account first, then try again.';
const MSG_UNAUTHORIZED = 'This account is not authorized for merchant dispute tools in this server.';
const MSG_RATE_LIMITED = 'You are sending commands too quickly. Please slow down and try again in a minute.';
const MSG_UNKNOWN = 'Unknown command.';
const MSG_FAILED = 'The command could not be completed. Please try again later.';
const SAFE_ERROR_RE = /^[A-Za-z0-9 _.,:'-]{1,140}$/;

function parseCaseIdOption(interaction) {
  const options = interaction && interaction.data && Array.isArray(interaction.data.options)
    ? interaction.data.options : [];
  const option = options.find((entry) => entry && entry.name === 'case_id');
  const raw = option == null ? '' : String(option.value).trim();
  if (!/^[0-9]{1,18}$/.test(raw)) throw new TypeError('a numeric case id is required');
  return Number(raw);
}

function createConnectCommands(deps = {}) {
  const { pool, graph, disputeService, store, authorize, reconciler } = deps;
  const now = deps.now || Date.now;
  const reviewUrlBase = typeof deps.reviewUrlBase === 'string' && deps.reviewUrlBase.startsWith('https://')
    ? deps.reviewUrlBase : DEFAULT_REVIEW_URL_BASE;
  const siteBase = typeof deps.siteBase === 'string' && deps.siteBase.startsWith('https://')
    ? deps.siteBase.replace(/\/+$/, '') : DEFAULT_SITE_BASE;
  const guildResolver = typeof deps.guildResolver === 'function' ? deps.guildResolver : null;

  /* Per-user token bucket: RATE_LIMIT_PER_MINUTE commands / minute. In-memory
   * by design — the limit protects downstream services, not billing state. */
  const buckets = new Map();

  function takeToken(userId, nowMs) {
    if (buckets.size > MAX_BUCKETS) {
      for (const [key, bucket] of buckets) {
        if (nowMs - bucket.updatedAt > BUCKET_IDLE_MS) buckets.delete(key);
      }
    }
    let bucket = buckets.get(userId);
    if (!bucket) {
      bucket = { tokens: RATE_LIMIT_PER_MINUTE, updatedAt: nowMs };
      buckets.set(userId, bucket);
    }
    const elapsed = Math.max(0, nowMs - bucket.updatedAt);
    bucket.tokens = Math.min(RATE_LIMIT_PER_MINUTE,
      bucket.tokens + (elapsed * RATE_LIMIT_PER_MINUTE) / RATE_WINDOW_MS);
    bucket.updatedAt = nowMs;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /* Audit every command (accepted, refused, rate-limited, unknown) into the
   * append-only dispute_audit_log via the injected evidence store. */
  async function audit({ interaction, commandName, discordUserId, guildId, outcome, caseId }) {
    if (!store || typeof store.appendRow !== 'function') return;
    const at = new Date(now()).toISOString();
    await store.appendRow(pool, {
      table: 'dispute_audit_log',
      fields: {
        case_id: caseId == null ? null : caseId,
        actor_kind: 'discord_user',
        actor_ref: discordUserId || null,
        action: `command.${token(commandName, 'unknown')}`,
        detail: { outcome },
        source: 'discord',
        source_event_id: interaction && typeof interaction.id === 'string' ? interaction.id : null,
        provider_account: guildId || null,
        occurred_at: at,
        received_at: at,
        provenance: {}
      }
    });
  }

  function serviceFn(name) {
    return disputeService && typeof disputeService[name] === 'function'
      ? disputeService[name].bind(disputeService) : null;
  }

  function cleanGuildName(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text && text.length <= 120 ? text : '';
  }

  function guildNameFromInteraction(interaction) {
    return cleanGuildName(
      interaction && interaction.guild && typeof interaction.guild.name === 'string'
        ? interaction.guild.name
        : ''
    );
  }

  async function resolveGuildName(interaction, guildId) {
    const embedded = guildNameFromInteraction(interaction);
    if (embedded) return embedded;
    if (!guildResolver || !guildId) return '';
    try {
      const detail = await guildResolver(guildId);
      return cleanGuildName(detail && detail.name);
    } catch (_) {
      return '';
    }
  }

  function urlWithParams(path, params = {}) {
    const url = new URL(path, siteBase);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && String(value).trim() !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  function groupCreateUrl({ guildId, guildName } = {}) {
    return urlWithParams('/register/', {
      sml_connect: '1',
      discord_guild_id: guildId || '',
      default_name: guildName || '',
      redirect_to: urlWithParams('/groups/create/', {
        sml_connect: '1',
        discord_guild_id: guildId || '',
        default_name: guildName || ''
      })
    });
  }

  function migrateUrl({ guildId, guildName } = {}) {
    return urlWithParams('/connect-migrate/', {
      guild_id: guildId || '',
      default_name: guildName || ''
    });
  }

  function setupIntro({ guildId, guildName } = {}) {
    const server = guildName ? `Server detected: ${guildName}.` : `Server detected by ID: ${guildId || 'unknown'}.`;
    return {
      content: [
        'StockMarketLoop Connect is installed. Now finish setup inside Discord.',
        server,
        '',
        'Do you already use Upgrade.Chat for this server?'
      ].join('\n'),
      components: [{
        type: 1,
        components: [
          { type: 2, style: 3, label: 'Yes, we use Upgrade.Chat', custom_id: 'sml_connect:uc:yes' },
          { type: 2, style: 2, label: 'No, skip migration', custom_id: 'sml_connect:uc:no' }
        ]
      }]
    };
  }

  function createGroupQuestion({ guildId, guildName, migrated }) {
    const nameLine = guildName
      ? `If you say yes, your StockMarketLoop group starts with this exact name: ${guildName}.`
      : 'If you say yes, StockMarketLoop will use this Discord server as the source and ask for the group name on signup.';
    return {
      content: [
        migrated
          ? 'Migration path selected. No migration fee, no double billing, and members keep their verified next payment date.'
          : 'Upgrade.Chat migration skipped. You can still use StockMarketLoop Connect for this Discord server.',
        '',
        'Do you want to create a StockMarketLoop Group for this Discord?',
        nameLine,
        '',
        'Perks: indexed Google/Bing group homepage, live Discord feed, membership store, live watch page, Loop Letter, Stripe/PayPal billing, role sync, analytics, dispute defense, Retail Trader Spotlight, and more growth than a locked Discord-only server.'
      ].join('\n'),
      components: [{
        type: 1,
        components: [
          { type: 2, style: 5, label: 'Yes — create SML group', url: groupCreateUrl({ guildId, guildName }) },
          migrated
            ? { type: 2, style: 5, label: 'Start Upgrade.Chat migration', url: migrateUrl({ guildId, guildName }) }
            : { type: 2, style: 2, label: 'No — bot only for now', custom_id: 'sml_connect:group:no' }
        ]
      }]
    };
  }

  /* --------------------------------------------------------------------- */
  /* Command handlers. ctx = { interaction, discordUserId, guildId,        */
  /*   identity, merchantScope, caseId? }                                  */
  /* --------------------------------------------------------------------- */

  const handlers = {
    /* Expected injected shape: disputeService.summarizePayments({ merchantScope,
     * identityId }) -> [{ amount_cents, currency, kind, status, occurred_at }] */
    payments: {
      async run(ctx) {
        const fn = serviceFn('summarizePayments');
        if (!fn) return { content: 'Payment summaries are not available yet.' };
        const rows = await fn({ merchantScope: ctx.merchantScope, identityId: ctx.identity.id });
        const list = Array.isArray(rows) ? rows : [];
        const lines = list.slice(0, MAX_LIST_LINES).map((row) =>
          `- ${token(row && row.kind)} ${money(row && row.amount_cents, row && row.currency)} · status ${token(row && row.status)} · at ${when(row && row.occurred_at)}`);
        return { content: [`Payment records: ${count(list.length)}`, ...lines].join('\n') };
      }
    },

    /* Expected: disputeService.summarizeSubscriptions({ merchantScope, identityId })
     * -> [{ provider, price_cents, currency, billing_interval, origin }] */
    subscriptions: {
      async run(ctx) {
        const fn = serviceFn('summarizeSubscriptions');
        if (!fn) return { content: 'Subscription summaries are not available yet.' };
        const rows = await fn({ merchantScope: ctx.merchantScope, identityId: ctx.identity.id });
        const list = Array.isArray(rows) ? rows : [];
        const lines = list.slice(0, MAX_LIST_LINES).map((row) =>
          `- ${token(row && row.provider)} · ${money(row && row.price_cents, row && row.currency)} / ${token(row && row.billing_interval, 'interval-unknown')} · origin ${token(row && row.origin)}`);
        return { content: [`Subscription records: ${count(list.length)}`, ...lines].join('\n') };
      }
    },

    /* Expected: disputeService.customerHistory({ caseId, merchantScope }) ->
     * { paymentsCount, firstPaymentAt, lastPaymentAt, disputesCount,
     *   subscriptionsCount } — counts and dates only, never identifiers. */
    'customer-history': {
      needsCaseId: true,
      async run(ctx) {
        const fn = serviceFn('customerHistory');
        if (!fn) return { content: 'Customer history summaries are not available yet.' };
        const history = await fn({ caseId: ctx.caseId, merchantScope: ctx.merchantScope }) || {};
        return {
          content: [
            `History for the account behind case #${ctx.caseId}:`,
            `- payments recorded: ${count(history.paymentsCount)} (first ${when(history.firstPaymentAt)}, last ${when(history.lastPaymentAt)})`,
            `- subscription records: ${count(history.subscriptionsCount)}`,
            `- dispute cases: ${count(history.disputesCount)}`
          ].join('\n')
        };
      }
    },

    disputes: {
      async run(ctx) {
        const fn = serviceFn('listCases');
        if (!fn) return { content: 'Dispute listings are not available yet.' };
        const rows = await fn({ merchantScope: ctx.merchantScope });
        const list = Array.isArray(rows) ? rows : [];
        const lines = list.slice(0, MAX_LIST_LINES).map((row) => `- ${caseLine(row)}`);
        return { content: [`Dispute cases: ${count(list.length)}`, ...lines].join('\n') };
      }
    },

    'dispute-view': {
      needsCaseId: true,
      async run(ctx) {
        const fn = serviceFn('caseDetail');
        if (!fn) return { content: 'Dispute detail is not available yet.' };
        const detail = await fn({ caseId: ctx.caseId, merchantScope: ctx.merchantScope }) || {};
        const row = detail.caseRow || {};
        const totals = checklistCounts(detail.checklist);
        return {
          content: [
            caseLine(row),
            `lifecycle ${token(row.lifecycle_stage, 'none')} · cycle ${count(row.response_cycle) || 1}`,
            `checklist: ${totals.present} present · ${totals.missing} missing · ${totals.weak} weak`
          ].join('\n')
        };
      }
    },

    'dispute-build': {
      needsCaseId: true,
      deferred: true,
      async run(ctx) {
        const fn = serviceFn('buildPacket');
        if (!fn) return { content: 'Packet building is not available yet.' };
        const result = await fn({
          caseId: ctx.caseId,
          merchantScope: ctx.merchantScope,
          requestedByDiscordUser: ctx.discordUserId
        }) || {};
        const warnings = Array.isArray(result.warnings) ? result.warnings : [];
        const codes = warnings.slice(0, MAX_LIST_LINES)
          .map((warning) => token(warning && warning.code))
          .join(', ');
        return {
          content: [
            `Draft packet version ${count(result.version)} built for case #${ctx.caseId}.`,
            `Warnings: ${count(warnings.length)}${codes ? ` (${codes})` : ''}`,
            'Review and submission happen on the dashboard; nothing was sent to the provider.'
          ].join('\n')
        };
      }
    },

    'dispute-missing': {
      needsCaseId: true,
      async run(ctx) {
        const fn = serviceFn('caseDetail');
        if (!fn) return { content: 'Dispute detail is not available yet.' };
        const detail = await fn({ caseId: ctx.caseId, merchantScope: ctx.merchantScope }) || {};
        const open = (Array.isArray(detail.checklist) ? detail.checklist : [])
          .filter((item) => item && (item.state === 'missing' || item.state === 'weak'));
        if (!open.length) return { content: `Case #${ctx.caseId}: no missing or weak checklist items.` };
        const lines = open.slice(0, MAX_LIST_LINES).map((item) => `- ${token(item.kind)}: ${token(item.state)}`);
        return { content: [`Case #${ctx.caseId} open checklist items: ${count(open.length)}`, ...lines].join('\n') };
      }
    },

    /* issueReviewToken (P5) stores only the token hash; the raw token appears
     * exactly once, inside this link button. The page still requires login and
     * capability — the token alone grants nothing. */
    'dispute-open-dashboard': {
      needsCaseId: true,
      async run(ctx) {
        const fn = serviceFn('issueReviewToken');
        if (!fn) return { content: 'Dashboard links are not available yet.' };
        const issued = await fn({
          caseId: ctx.caseId,
          discordUserId: ctx.discordUserId,
          identityId: ctx.identity.id,
          merchantScope: ctx.merchantScope
        }) || {};
        const url = typeof issued.url === 'string' && issued.url.startsWith('https://')
          ? issued.url
          : `${reviewUrlBase}?t=${encodeURIComponent(String(issued.token || ''))}`;
        return {
          content: `Single-use review link for case #${ctx.caseId}. It expires ${when(issued.expiresAt) === 'none' ? 'shortly' : when(issued.expiresAt)} and works once, after signing in.`,
          components: [{
            type: 1,
            components: [{ type: 2, style: 5, label: 'Open dispute dashboard', url }]
          }]
        };
      }
    },

    /* Role logic stays in the EXISTING reconciler. Expected injected shape:
     * reconciler.enqueueRoleStatus({ guildId, merchantScope, requestedByDiscordUser })
     * -> Promise<{ queued: true }> */
    'role-status': {
      async run(ctx) {
        if (!reconciler || typeof reconciler.enqueueRoleStatus !== 'function') {
          return { content: 'Role tools are not available yet.' };
        }
        await reconciler.enqueueRoleStatus({
          guildId: ctx.guildId,
          merchantScope: ctx.merchantScope,
          requestedByDiscordUser: ctx.discordUserId
        });
        return { content: 'Role status check queued for this server. Results are delivered through the existing reconciler notifications.' };
      }
    },

    /* Expected: reconciler.enqueueRoleReconcile({ guildId, merchantScope,
     * requestedByDiscordUser }) -> Promise<{ queued: true }> */
    'role-reconcile': {
      deferred: true,
      async run(ctx) {
        if (!reconciler || typeof reconciler.enqueueRoleReconcile !== 'function') {
          return { content: 'Role tools are not available yet.' };
        }
        await reconciler.enqueueRoleReconcile({
          guildId: ctx.guildId,
          merchantScope: ctx.merchantScope,
          requestedByDiscordUser: ctx.discordUserId
        });
        return { content: 'Role reconciliation queued for this server. Changes go through the existing reconcile intents with audit rows.' };
      }
    }
  };

  function ephemeralMessage(content, extra) {
    return { type: 4, data: Object.assign({}, extra, { content, flags: EPHEMERAL }) };
  }

  function renderError(error) {
    if (error instanceof TypeError && SAFE_ERROR_RE.test(String(error.message))) {
      return `The command could not be processed: ${error.message}.`;
    }
    return MSG_FAILED;
  }

  async function handleCommand(interaction) {
    const commandName = interaction && interaction.data && typeof interaction.data.name === 'string'
      ? interaction.data.name : '';
    const invoker = (interaction && interaction.member && interaction.member.user) || (interaction && interaction.user) || {};
    const discordUserId = typeof invoker.id === 'string' && /^[0-9]{5,24}$/.test(invoker.id) ? invoker.id : null;
    const guildId = interaction && typeof interaction.guild_id === 'string' ? interaction.guild_id : null;
    const handler = Object.prototype.hasOwnProperty.call(handlers, commandName) ? handlers[commandName] : null;
    const auditBase = { interaction, commandName, discordUserId, guildId };

    if (!discordUserId) {
      return { response: ephemeralMessage(MSG_UNLINKED) };
    }
    if (commandName === 'connect-setup') {
      if (!guildId) {
        return { response: ephemeralMessage('Run this setup command inside the Discord server you want to connect.') };
      }
      const guildName = await resolveGuildName(interaction, guildId);
      await audit(Object.assign({ outcome: 'setup_started' }, auditBase));
      return { response: { type: 4, data: Object.assign(setupIntro({ guildId, guildName }), { flags: EPHEMERAL }) } };
    }
    if (!handler) {
      await audit(Object.assign({ outcome: 'unknown_command' }, auditBase));
      return { response: ephemeralMessage(MSG_UNKNOWN) };
    }
    if (!takeToken(discordUserId, now())) {
      await audit(Object.assign({ outcome: 'rate_limited' }, auditBase));
      return { response: ephemeralMessage(MSG_RATE_LIMITED) };
    }

    let caseId = null;
    if (handler.needsCaseId) {
      try {
        caseId = parseCaseIdOption(interaction);
      } catch (error) {
        await audit(Object.assign({ outcome: 'invalid_input' }, auditBase));
        return { response: ephemeralMessage(renderError(error)) };
      }
    }

    /* Authorization chain: discord user -> verified identity -> injected
     * merchant-admin check. Fails closed when either link is absent. */
    let identity = null;
    try {
      identity = graph && typeof graph.findByRef === 'function'
        ? await graph.findByRef(pool, 'discord', 'user', discordUserId)
        : null;
    } catch (error) {
      await audit(Object.assign({ outcome: 'lookup_failed', caseId }, auditBase));
      return { response: ephemeralMessage(MSG_FAILED) };
    }
    if (!identity || identity.verification === 'candidate') {
      await audit(Object.assign({ outcome: 'refused_unlinked', caseId }, auditBase));
      return { response: ephemeralMessage(MSG_UNLINKED) };
    }

    /* Expected injected shape: authorize({ identityId, discordUserId, guildId })
     * -> Promise<{ ok: boolean, merchantScope?: string }> (merchant admin check,
     * re-evaluated server-side on every command). */
    let authorization = null;
    try {
      authorization = typeof authorize === 'function'
        ? await authorize({ identityId: identity.id, discordUserId, guildId })
        : null;
    } catch (error) {
      authorization = null;
    }
    if (!authorization || authorization.ok !== true) {
      await audit(Object.assign({ outcome: 'refused_unauthorized', caseId }, auditBase));
      return { response: ephemeralMessage(MSG_UNAUTHORIZED) };
    }

    const ctx = {
      interaction,
      discordUserId,
      guildId,
      identity,
      merchantScope: typeof authorization.merchantScope === 'string' ? authorization.merchantScope : null,
      caseId
    };

    /* The audit row is written BEFORE the handler runs: no command executes
     * without a durable trace. An audit failure aborts the command. */
    try {
      await audit(Object.assign({ outcome: 'accepted', caseId }, auditBase));
    } catch (error) {
      return { response: ephemeralMessage(MSG_FAILED) };
    }

    if (handler.deferred) {
      return {
        response: { type: 5, data: { flags: EPHEMERAL } },
        followUp: async () => {
          try {
            const data = await handler.run(ctx);
            return Object.assign({}, data, { flags: EPHEMERAL });
          } catch (error) {
            return { content: renderError(error), flags: EPHEMERAL };
          }
        }
      };
    }

    try {
      const data = await handler.run(ctx);
      return { response: { type: 4, data: Object.assign({}, data, { flags: EPHEMERAL }) } };
    } catch (error) {
      return { response: ephemeralMessage(renderError(error)) };
    }
  }

  async function handleComponent(interaction) {
    const customId = interaction && interaction.data && typeof interaction.data.custom_id === 'string'
      ? interaction.data.custom_id : '';
    const invoker = (interaction && interaction.member && interaction.member.user) || (interaction && interaction.user) || {};
    const discordUserId = typeof invoker.id === 'string' && /^[0-9]{5,24}$/.test(invoker.id) ? invoker.id : null;
    const guildId = interaction && typeof interaction.guild_id === 'string' ? interaction.guild_id : null;
    const auditBase = { interaction, commandName: customId.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64) || 'component', discordUserId, guildId };

    if (!discordUserId || !guildId) {
      return { response: ephemeralMessage('Run this setup inside the Discord server you want to connect.') };
    }
    if (!customId.startsWith('sml_connect:')) {
      await audit(Object.assign({ outcome: 'unknown_component' }, auditBase));
      return { response: ephemeralMessage('This StockMarketLoop Connect button is not recognized. Run /connect-setup again.') };
    }
    if (!takeToken(discordUserId, now())) {
      await audit(Object.assign({ outcome: 'rate_limited' }, auditBase));
      return { response: ephemeralMessage(MSG_RATE_LIMITED) };
    }

    const guildName = await resolveGuildName(interaction, guildId);
    if (customId === 'sml_connect:uc:yes') {
      await audit(Object.assign({ outcome: 'upgrade_chat_yes' }, auditBase));
      return { response: { type: 4, data: Object.assign(createGroupQuestion({ guildId, guildName, migrated: true }), { flags: EPHEMERAL }) } };
    }
    if (customId === 'sml_connect:uc:no') {
      await audit(Object.assign({ outcome: 'upgrade_chat_no' }, auditBase));
      return { response: { type: 4, data: Object.assign(createGroupQuestion({ guildId, guildName, migrated: false }), { flags: EPHEMERAL }) } };
    }
    if (customId === 'sml_connect:group:no') {
      await audit(Object.assign({ outcome: 'group_declined' }, auditBase));
      return { response: ephemeralMessage('No problem. The bot can stay installed, and you can run /connect-setup anytime when you are ready to create a StockMarketLoop group.') };
    }

    await audit(Object.assign({ outcome: 'unknown_component' }, auditBase));
    return { response: ephemeralMessage('This StockMarketLoop Connect button expired. Run /connect-setup again.') };
  }

  return { handleCommand, handleComponent };
}

module.exports = {
  COMMAND_DEFINITIONS,
  EPHEMERAL,
  RATE_LIMIT_PER_MINUTE,
  createConnectCommands
};
