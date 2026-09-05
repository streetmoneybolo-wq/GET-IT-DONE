'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { COMMAND_DEFINITIONS, createConnectCommands } = require('./connect-commands');

const NOW = 1_700_000_000_000;
const USER = '111222333444555666';
const GUILD = '999888777666555444';

/* Planted PII: none of these strings may ever appear in a reply. */
const PII = {
  email: 'leak@example.com',
  name: 'John Doe',
  customer: 'cus_LEAK123',
  paymentIntent: 'pi_LEAK456',
  disputeId: 'dp_LEAK789'
};

function interaction(name, options = [], overrides = {}) {
  return Object.assign({
    id: 'interaction_1',
    type: 2,
    guild_id: GUILD,
    token: 'webhook-token-abc',
    member: { user: { id: USER } },
    data: { name, options }
  }, overrides);
}

function poisonedCase(id = 12) {
  return {
    id,
    provider: 'stripe',
    reason: `fraudulent ${PII.email}`, // fails the token filter on purpose
    amount_cents: 2499,
    currency: 'usd',
    due_by: '2026-09-05T00:00:00.000Z',
    case_state: 'evidence_building',
    lifecycle_stage: 'chargeback',
    response_cycle: 1,
    customer_email: PII.email,
    customer_name: PII.name,
    provider_dispute_id: PII.disputeId,
    payment_intent: PII.paymentIntent
  };
}

function fakes(overrides = {}) {
  const audits = [];
  const calls = { issueReviewToken: [], buildPacket: [], roleStatus: [], roleReconcile: [] };
  const deps = {
    pool: {},
    now: () => NOW,
    graph: {
      async findByRef(_client, provider, refType, refValue) {
        assert.equal(provider, 'discord');
        assert.equal(refType, 'user');
        assert.equal(refValue, USER);
        return { id: 77, verification: 'verified', discord_user_id: USER };
      }
    },
    authorize: async () => ({ ok: true, merchantScope: 'acct_merchant_1' }),
    store: {
      async appendRow(_client, { table, fields }) {
        audits.push({ table, fields });
        return { id: audits.length, integrityHash: 'h'.repeat(64) };
      }
    },
    disputeService: {
      async listCases() { return [poisonedCase(12), poisonedCase(13)]; },
      async caseDetail({ caseId }) {
        return {
          caseRow: poisonedCase(caseId),
          checklist: [
            { kind: 'cancellation_policy', state: 'missing' },
            { kind: 'customer_communication', state: 'weak', note: PII.email },
            { kind: 'billing_history', state: 'present' }
          ]
        };
      },
      async buildPacket(input) {
        calls.buildPacket.push(input);
        return { version: 3, warnings: [{ code: 'policy_not_provable', detail: PII.name }] };
      },
      async issueReviewToken(input) {
        calls.issueReviewToken.push(input);
        return { token: 'tok_single_use_1', expiresAt: NOW + 15 * 60 * 1000 };
      },
      async summarizePayments() {
        return [{ amount_cents: 2499, currency: 'usd', kind: 'charge', status: 'succeeded', occurred_at: NOW - 1000, customer_email: PII.email }];
      },
      async summarizeSubscriptions() {
        return [{ provider: 'stripe', price_cents: 999, currency: 'usd', billing_interval: 'month', origin: 'explicit_purchase', plan_name: PII.name }];
      },
      async customerHistory() {
        return { paymentsCount: 6, firstPaymentAt: NOW - 90 * 86400000, lastPaymentAt: NOW - 86400000, disputesCount: 1, subscriptionsCount: 2, email: PII.email };
      }
    },
    reconciler: {
      async enqueueRoleStatus(input) { calls.roleStatus.push(input); return { queued: true }; },
      async enqueueRoleReconcile(input) { calls.roleReconcile.push(input); return { queued: true }; }
    }
  };
  return { deps: Object.assign(deps, overrides), audits, calls };
}

function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => allStrings(entry, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((entry) => allStrings(entry, out));
  return out;
}

test('command definitions include public owner setup plus protected merchant tools', () => {
  assert.equal(COMMAND_DEFINITIONS.length, 11);
  const names = COMMAND_DEFINITIONS.map((definition) => definition.name);
  assert.deepEqual(names, [
    'connect-setup',
    'payments', 'subscriptions', 'customer-history', 'disputes', 'dispute-view',
    'dispute-build', 'dispute-missing', 'dispute-open-dashboard', 'role-status', 'role-reconcile'
  ]);
  for (const definition of COMMAND_DEFINITIONS) {
    assert.equal(definition.default_member_permissions, definition.name === 'connect-setup' ? '32' : '0');
    assert.deepEqual(definition.contexts, [0]);
    assert.equal(definition.type, 1);
  }
});

test('connect-setup is available before SML account linking and asks Upgrade.Chat by button', async () => {
  const { deps, audits } = fakes({
    graph: { async findByRef() { throw new Error('setup should not require account graph lookup'); } }
  });
  const result = await createConnectCommands(deps).handleCommand(interaction('connect-setup', [], {
    guild: { name: 'Making Easy Money' }
  }));
  assert.equal(result.response.type, 4);
  assert.equal(result.response.data.flags, 64);
  assert.match(result.response.data.content, /StockMarketLoop Connect is installed/);
  assert.match(result.response.data.content, /Making Easy Money/);
  const buttons = result.response.data.components[0].components;
  assert.equal(buttons[0].custom_id, 'sml_connect:uc:yes');
  assert.equal(buttons[1].custom_id, 'sml_connect:uc:no');
  assert.equal(audits.at(-1).fields.detail.outcome, 'setup_started');
});

test('Upgrade.Chat yes button offers migration and group creation with Discord name', async () => {
  const { deps, audits } = fakes();
  const result = await createConnectCommands(deps).handleComponent(interaction('', [], {
    type: 3,
    guild: { name: 'Making Easy Money' },
    data: { custom_id: 'sml_connect:uc:yes' }
  }));
  assert.equal(result.response.data.flags, 64);
  assert.match(result.response.data.content, /No migration fee/);
  assert.match(result.response.data.content, /Making Easy Money/);
  const buttons = result.response.data.components[0].components;
  assert.equal(buttons[0].style, 5);
  assert.match(buttons[0].url, /default_name=Making\+Easy\+Money/);
  assert.match(buttons[1].url, /connect-migrate/);
  assert.equal(audits.at(-1).fields.detail.outcome, 'upgrade_chat_yes');
});

test('Upgrade.Chat no button skips migration but still offers StockMarketLoop group creation', async () => {
  const { deps } = fakes();
  const result = await createConnectCommands(deps).handleComponent(interaction('', [], {
    type: 3,
    guild: { name: 'Making Easy Money' },
    data: { custom_id: 'sml_connect:uc:no' }
  }));
  assert.match(result.response.data.content, /migration skipped/i);
  assert.match(result.response.data.content, /create a StockMarketLoop Group/);
  const buttons = result.response.data.components[0].components;
  assert.equal(buttons[0].label, 'Yes — create SML group');
  assert.equal(buttons[1].custom_id, 'sml_connect:group:no');
});

test('an unlinked Discord account is refused with a neutral ephemeral message', async () => {
  const { deps, audits } = fakes({ graph: { async findByRef() { return null; } } });
  const commands = createConnectCommands(deps);
  const result = await commands.handleCommand(interaction('disputes'));
  assert.equal(result.response.type, 4);
  assert.equal(result.response.data.flags, 64);
  assert.match(result.response.data.content, /not linked/);
  assert.equal(audits.at(-1).fields.detail.outcome, 'refused_unlinked');
});

test('a linked but unauthorized account is refused; a candidate identity too', async () => {
  const { deps } = fakes({ authorize: async () => ({ ok: false }) });
  const commands = createConnectCommands(deps);
  const result = await commands.handleCommand(interaction('disputes'));
  assert.match(result.response.data.content, /not authorized/);
  assert.equal(result.response.data.flags, 64);

  const candidate = fakes({
    graph: { async findByRef() { return { id: 5, verification: 'candidate' }; } }
  });
  const candidateResult = await createConnectCommands(candidate.deps).handleCommand(interaction('disputes'));
  assert.match(candidateResult.response.data.content, /not linked/);
});

test('a missing authorize callback fails closed', async () => {
  const { deps } = fakes({ authorize: undefined });
  const result = await createConnectCommands(deps).handleCommand(interaction('disputes'));
  assert.match(result.response.data.content, /not authorized/);
});

test('unknown commands get an ephemeral error and an audit row', async () => {
  const { deps, audits } = fakes();
  const result = await createConnectCommands(deps).handleCommand(interaction('self-destruct'));
  assert.equal(result.response.data.content, 'Unknown command.');
  assert.equal(result.response.data.flags, 64);
  assert.equal(audits.at(-1).fields.detail.outcome, 'unknown_command');
});

test('no reply string ever contains planted PII, and every reply is ephemeral', async () => {
  const { deps } = fakes();
  const commands = createConnectCommands(deps);
  const caseOption = [{ name: 'case_id', value: '12' }];
  const invocations = [
    interaction('connect-setup'),
    interaction('payments'), interaction('subscriptions'),
    interaction('customer-history', caseOption), interaction('disputes'),
    interaction('dispute-view', caseOption), interaction('dispute-build', caseOption),
    interaction('dispute-missing', caseOption), interaction('dispute-open-dashboard', caseOption),
    interaction('role-status'), interaction('role-reconcile')
  ];
  for (const invocation of invocations) {
    const result = await commands.handleCommand(invocation);
    const payloads = [result.response];
    if (result.followUp) payloads.push(await result.followUp());
    for (const payload of payloads) {
      const data = payload.data || payload;
      assert.equal(data.flags, 64, `${invocation.data.name} must be ephemeral`);
      for (const text of allStrings(payload)) {
        for (const planted of Object.values(PII)) {
          assert.ok(!text.includes(planted), `${invocation.data.name} leaked ${planted} in: ${text}`);
        }
      }
    }
  }
});

test('disputes and dispute-view render only whitelisted case facts', async () => {
  const { deps } = fakes();
  const commands = createConnectCommands(deps);
  const list = await commands.handleCommand(interaction('disputes'));
  assert.match(list.response.data.content, /Dispute cases: 2/);
  assert.match(list.response.data.content, /case #12 · stripe · reason unknown · 24\.99 USD/);

  const view = await commands.handleCommand(interaction('dispute-view', [{ name: 'case_id', value: '12' }]));
  assert.match(view.response.data.content, /state evidence_building/);
  assert.match(view.response.data.content, /1 present · 1 missing · 1 weak/);
});

test('dispute-missing lists only missing and weak checklist kinds', async () => {
  const { deps } = fakes();
  const result = await createConnectCommands(deps)
    .handleCommand(interaction('dispute-missing', [{ name: 'case_id', value: '12' }]));
  assert.match(result.response.data.content, /cancellation_policy: missing/);
  assert.match(result.response.data.content, /customer_communication: weak/);
  assert.ok(!result.response.data.content.includes('billing_history'));
});

test('a non-numeric case id is rejected before any service call', async () => {
  const { deps, calls } = fakes();
  const result = await createConnectCommands(deps)
    .handleCommand(interaction('dispute-build', [{ name: 'case_id', value: 'DROP TABLE' }]));
  assert.match(result.response.data.content, /numeric case id/);
  assert.equal(result.response.data.flags, 64);
  assert.equal(calls.buildPacket.length, 0);
});

test('the 11th command inside a minute is rate limited; tokens refill with the clock', async () => {
  let clock = NOW;
  const { deps, audits } = fakes();
  deps.now = () => clock;
  const commands = createConnectCommands(deps);
  for (let i = 0; i < 10; i += 1) {
    const result = await commands.handleCommand(interaction('disputes'));
    assert.equal(result.response.type, 4);
    assert.ok(!/slow down/.test(result.response.data.content));
  }
  const limited = await commands.handleCommand(interaction('disputes'));
  assert.match(limited.response.data.content, /slow down/);
  assert.equal(limited.response.data.flags, 64);
  assert.equal(audits.at(-1).fields.detail.outcome, 'rate_limited');

  clock = NOW + 61_000;
  const refreshed = await commands.handleCommand(interaction('disputes'));
  assert.ok(!/slow down/.test(refreshed.response.data.content));
});

test('every accepted command writes a dispute_audit_log row before running', async () => {
  const { deps, audits } = fakes();
  await createConnectCommands(deps).handleCommand(interaction('dispute-view', [{ name: 'case_id', value: '12' }]));
  const row = audits.at(-1);
  assert.equal(row.table, 'dispute_audit_log');
  assert.equal(row.fields.actor_kind, 'discord_user');
  assert.equal(row.fields.actor_ref, USER);
  assert.equal(row.fields.action, 'command.dispute-view');
  assert.equal(row.fields.detail.outcome, 'accepted');
  assert.equal(row.fields.case_id, 12);
  assert.equal(row.fields.source, 'discord');
  assert.equal(row.fields.source_event_id, 'interaction_1');
  assert.equal(row.fields.provider_account, GUILD);
  assert.equal(row.fields.occurred_at, new Date(NOW).toISOString());
});

test('an audit write failure aborts the command instead of running unaudited', async () => {
  const { deps, calls } = fakes({
    store: { async appendRow() { throw new Error('database unavailable'); } }
  });
  const result = await createConnectCommands(deps)
    .handleCommand(interaction('dispute-build', [{ name: 'case_id', value: '12' }]));
  assert.equal(result.response.type, 4);
  assert.match(result.response.data.content, /could not be completed/);
  assert.equal(calls.buildPacket.length, 0);
});

test('dispute-open-dashboard renders the single-use token as a style-5 link button only', async () => {
  const { deps, calls } = fakes();
  const result = await createConnectCommands(deps)
    .handleCommand(interaction('dispute-open-dashboard', [{ name: 'case_id', value: '12' }]));
  assert.equal(calls.issueReviewToken.length, 1);
  assert.deepEqual(calls.issueReviewToken[0], {
    caseId: 12, discordUserId: USER, identityId: 77, merchantScope: 'acct_merchant_1'
  });
  const button = result.response.data.components[0].components[0];
  assert.equal(button.type, 2);
  assert.equal(button.style, 5);
  assert.equal(button.url, 'https://stockmarketloop.com/connect-review/?t=tok_single_use_1');
  assert.ok(!result.response.data.content.includes('tok_single_use_1'),
    'the raw token appears only inside the button URL');
  assert.equal(result.response.data.flags, 64);
});

test('dispute-build defers (type 5, flags 64) and the follow-up carries the packet result', async () => {
  const { deps, calls } = fakes();
  const result = await createConnectCommands(deps)
    .handleCommand(interaction('dispute-build', [{ name: 'case_id', value: '12' }]));
  assert.equal(result.response.type, 5);
  assert.equal(result.response.data.flags, 64);
  assert.equal(calls.buildPacket.length, 0, 'work happens in the follow-up, not before the defer');

  const payload = await result.followUp();
  assert.equal(calls.buildPacket.length, 1);
  assert.equal(calls.buildPacket[0].caseId, 12);
  assert.equal(payload.flags, 64);
  assert.match(payload.content, /version 3/);
  assert.match(payload.content, /policy_not_provable/);
});

test('a follow-up failure yields a neutral ephemeral message, never a thrown error', async () => {
  const { deps } = fakes();
  deps.disputeService.buildPacket = async () => { throw new Error(`boom ${PII.email}`); };
  const result = await createConnectCommands(deps)
    .handleCommand(interaction('dispute-build', [{ name: 'case_id', value: '12' }]));
  const payload = await result.followUp();
  assert.equal(payload.flags, 64);
  assert.match(payload.content, /could not be completed/);
  assert.ok(!payload.content.includes(PII.email));
});

test('role commands call the injected reconciler enqueue functions and implement no role logic', async () => {
  const { deps, calls } = fakes();
  const commands = createConnectCommands(deps);
  const status = await commands.handleCommand(interaction('role-status'));
  assert.match(status.response.data.content, /queued/);
  assert.deepEqual(calls.roleStatus[0], {
    guildId: GUILD, merchantScope: 'acct_merchant_1', requestedByDiscordUser: USER
  });

  const reconcile = await commands.handleCommand(interaction('role-reconcile'));
  assert.equal(reconcile.response.type, 5);
  const payload = await reconcile.followUp();
  assert.match(payload.content, /queued/);
  assert.deepEqual(calls.roleReconcile[0], {
    guildId: GUILD, merchantScope: 'acct_merchant_1', requestedByDiscordUser: USER
  });
});

test('customer-history renders counts and dates only', async () => {
  const { deps } = fakes();
  const result = await createConnectCommands(deps)
    .handleCommand(interaction('customer-history', [{ name: 'case_id', value: '12' }]));
  const content = result.response.data.content;
  assert.match(content, /payments recorded: 6/);
  assert.match(content, /dispute cases: 1/);
  assert.match(content, /subscription records: 2/);
});
