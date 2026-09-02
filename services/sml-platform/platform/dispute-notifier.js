'use strict';

/* =============================================================================
 * dispute-notifier — worker handlers for the `dispute_alert` and
 * `dispute_deadline` outbox intents.
 *
 * Recipients are the VERIFIED merchant admins of the case's merchant scope
 * (identity graph, ref_type merchant/connected_account). Each admin receives a
 * private Discord DM through the SML Connect bot token, and WordPress receives
 * one signed `dispute_notify` intent through the existing billing bridge.
 *
 * Every DM is recorded in notification_delivery_events with a deterministic
 * source_event_id, so an outbox retry (for example after the WordPress bridge
 * returned 503) never sends the same DM twice.
 *
 * Message text is factual and neutral: case id, provider, amount, deadline,
 * state. No customer name, email, or payment identifier ever appears.
 * ========================================================================== */

const TERMINAL_STATES = new Set(['won', 'lost', 'warning_closed', 'accepted', 'expired']);
const DISCORD_API = 'https://discord.com/api/v10';
/* Discord JSON error codes that mean "this DM can never be delivered". */
const PERMANENT_DM_CODES = new Set([50007, 50278, 10013, 50033]);

function money(cents, currency) {
  const n = Number(cents);
  if (!Number.isSafeInteger(n)) return 'amount unavailable';
  const cur = /^[A-Za-z]{3}$/.test(String(currency || '')) ? String(currency).toUpperCase() : 'XXX';
  const abs = Math.abs(n);
  return `${n < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')} ${cur}`;
}

function when(value) {
  if (value == null) return 'none';
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : 'none';
}

function token(value, fallback = 'unknown') {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(text) ? text : fallback;
}

function createDiscordDmClient({ token: botToken, fetchImpl = globalThis.fetch } = {}) {
  const auth = String(botToken || '').trim();
  if (!auth) return null;
  async function post(path, body) {
    const response = await fetchImpl(`${DISCORD_API}${path}`, {
      method: 'POST',
      headers: { authorization: `Bot ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    return { status: Number(response.status), data };
  }
  return {
    async send(discordUserId, content) {
      const channel = await post('/users/@me/channels', { recipient_id: String(discordUserId) });
      if (channel.status === 429) return { ok: false, code: 429, retryable: true };
      if (channel.status >= 300 || !channel.data || !channel.data.id) {
        return { ok: false, code: (channel.data && channel.data.code) || channel.status, retryable: false };
      }
      const message = await post(`/channels/${encodeURIComponent(String(channel.data.id))}/messages`, {
        content, allowed_mentions: { parse: [] }
      });
      if (message.status === 429) return { ok: false, code: 429, retryable: true };
      if (message.status >= 300) {
        const code = (message.data && message.data.code) || message.status;
        return { ok: false, code, retryable: !PERMANENT_DM_CODES.has(code) && message.status >= 500 };
      }
      return { ok: true, messageId: message.data && message.data.id ? String(message.data.id) : null };
    }
  };
}

function noticeTypeFor(intentType, payload, caseRow) {
  if (intentType === 'dispute_deadline') return 'deadline_warning';
  if (payload && payload.noticeType === 'submission_result') return 'submission_result';
  if (caseRow && TERMINAL_STATES.has(caseRow.case_state)) return 'final_outcome';
  return 'dispute_alert';
}

function renderMessage(noticeType, payload, caseRow) {
  const caseId = Number(caseRow.id);
  const head = {
    dispute_alert: 'Dispute update',
    deadline_warning: 'Dispute deadline warning',
    submission_result: 'Dispute evidence submission result',
    final_outcome: 'Dispute final outcome'
  }[noticeType] || 'Dispute update';
  const parts = [
    `${head}: case #${caseId}`,
    token(caseRow.provider),
    `reason ${token(caseRow.reason)}`,
    money(caseRow.amount_cents, caseRow.currency),
    `due ${when(caseRow.due_by)}`,
    `state ${token(caseRow.case_state)}`
  ];
  if (noticeType === 'deadline_warning') parts.push(`window ${token(payload && payload.bucket, 'unknown')}`);
  if (noticeType === 'submission_result') parts.push(`result ${token(payload && payload.result, 'unknown')}`);
  if (caseRow.lifecycle_stage) parts.push(`stage ${token(caseRow.lifecycle_stage)}`);
  return `${parts.join(' · ')}\nUse /dispute-view ${caseId}, /dispute-missing ${caseId}, or /dispute-open-dashboard ${caseId} in the merchant server.`;
}

function createDisputeNotifier({ pool, store, graph, dm = null, wordpress = null, now, logger } = {}) {
  if (!pool) throw new TypeError('a pg pool is required');
  if (!store) throw new TypeError('an evidence store is required');
  if (!graph) throw new TypeError('an identity graph is required');
  const clock = now || Date.now;
  const log = typeof logger === 'function' ? logger : () => {};

  async function loadCase(caseId) {
    const found = await pool.query(`SELECT * FROM dispute_cases WHERE id = $1`, [Number(caseId)]);
    return found.rows[0] || null;
  }

  async function alreadyDelivered(sourceEventId) {
    const found = await pool.query(
      `SELECT id FROM notification_delivery_events
        WHERE source = 'sml_platform' AND source_event_id = $1 AND delivery_status = 'sent'
        LIMIT 1`,
      [sourceEventId]
    );
    return !!found.rows[0];
  }

  async function recordDelivery({ identityId, noticeType, channel, status, messageId, sourceEventId, caseRow, extra }) {
    const at = new Date(clock()).toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await store.appendRow(client, {
        table: 'notification_delivery_events',
        fields: {
          identity_id: identityId == null ? null : Number(identityId),
          notice_type: noticeType,
          channel,
          template_ref: `connect.${noticeType}`,
          delivery_status: status,
          provider_message_id: messageId || null,
          source: 'sml_platform',
          source_event_id: sourceEventId,
          provider_account: caseRow.merchant_account || null,
          occurred_at: at,
          received_at: at,
          provenance: Object.assign({ case_id: Number(caseRow.id) }, extra || {})
        }
      });
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async function audit(caseRow, action, detail) {
    const at = new Date(clock()).toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await store.appendChained(client, {
        table: 'dispute_audit_log',
        scopeKey: Number(caseRow.id),
        fields: {
          case_id: Number(caseRow.id),
          actor_kind: 'system',
          actor_ref: null,
          action,
          detail: detail || {},
          source: 'sml_platform',
          source_event_id: null,
          provider_account: caseRow.merchant_account || null,
          occurred_at: at,
          received_at: at,
          provenance: {}
        }
      });
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  }

  function handler(intentType) {
    return async function deliver(payload, row) {
      const caseId = payload && payload.caseId;
      const caseRow = await loadCase(caseId);
      if (!caseRow) throw new Error('dispute case not found for notification');
      const noticeType = noticeTypeFor(intentType, payload, caseRow);
      const scope = caseRow.merchant_account || 'platform';
      const admins = await graph.resolveMerchantAdmins(pool, scope);
      const content = renderMessage(noticeType, payload, caseRow);
      const sourceKey = row && row.source_key ? String(row.source_key) : `${intentType}:${caseRow.id}`;

      let sent = 0;
      let skipped = 0;
      let failed = 0;
      if (dm) {
        for (const admin of admins) {
          if (!admin.discord_user_id) continue;
          const sourceEventId = `${sourceKey}:discord:${admin.discord_user_id}`;
          if (await alreadyDelivered(sourceEventId)) { skipped += 1; continue; }
          const result = await dm.send(admin.discord_user_id, content);
          if (result.ok) {
            sent += 1;
            await recordDelivery({
              identityId: admin.identityId, noticeType, channel: 'discord_dm', status: 'sent',
              messageId: result.messageId, sourceEventId, caseRow, extra: { intent: intentType }
            });
            continue;
          }
          if (result.retryable) throw new Error(`discord DM temporarily unavailable (${result.code})`);
          failed += 1;
          await recordDelivery({
            identityId: admin.identityId, noticeType, channel: 'discord_dm', status: 'failed',
            messageId: null, sourceEventId, caseRow, extra: { intent: intentType, discord_code: result.code }
          });
        }
      }

      if (!admins.length) {
        await audit(caseRow, 'alert_no_recipients', { intent: intentType, notice_type: noticeType, merchant_scope: scope });
      }

      /* WordPress last: a bridge failure throws so the outbox retries, and the
         delivery ledger above prevents duplicate DMs on that retry. */
      if (typeof wordpress === 'function') {
        await wordpress({
          noticeType,
          caseId: Number(caseRow.id),
          provider: caseRow.provider,
          reason: caseRow.reason,
          amountCents: caseRow.amount_cents,
          currency: caseRow.currency,
          dueBy: caseRow.due_by,
          caseState: caseRow.case_state,
          lifecycleStage: caseRow.lifecycle_stage,
          bucket: payload && payload.bucket ? payload.bucket : null,
          result: payload && payload.result ? payload.result : null
        }, { source_key: `${sourceKey}:wp`, intent_type: 'dispute_notify' });
      }

      log('info', 'dispute_notification_processed', {
        caseId: Number(caseRow.id), intent: intentType, noticeType, sent, skipped, failed, wordpress: typeof wordpress === 'function'
      });
      return { sent, skipped, failed, noticeType };
    };
  }

  return {
    disputeAlert: handler('dispute_alert'),
    disputeDeadline: handler('dispute_deadline')
  };
}

module.exports = {
  PERMANENT_DM_CODES,
  createDiscordDmClient,
  createDisputeNotifier,
  noticeTypeFor,
  renderMessage
};
