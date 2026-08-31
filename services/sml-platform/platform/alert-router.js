'use strict';

const crypto = require('node:crypto');
const { hmac } = require('./wordpress-gateway');

const PROVIDERS = new Set(['sml', 'discord', 'telegram']);

function cleanProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!PROVIDERS.has(provider)) throw new TypeError('provider must be sml, discord, or telegram');
  return provider;
}

function cleanTarget(value, field = 'targetId') {
  const target = String(value || '').trim();
  if (!target || target.length > 120 || !/^[A-Za-z0-9_:@./-]+$/.test(target)) {
    throw new TypeError(`${field} is invalid`);
  }
  return target;
}

function cleanRoute(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('route is required');
  const groupId = Number.parseInt(input.groupId, 10);
  const ownerUserId = Number.parseInt(input.ownerUserId, 10);
  if (!Number.isSafeInteger(groupId) || groupId < 1) throw new TypeError('groupId is invalid');
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId < 1) throw new TypeError('ownerUserId is invalid');
  const name = String(input.name || 'Alert route').trim().slice(0, 120);
  if (!name) throw new TypeError('route name is required');
  const sourceProvider = cleanProvider(input.sourceProvider);
  const sourceTargetId = cleanTarget(input.sourceTargetId, 'sourceTargetId');
  const destinations = Array.isArray(input.destinations) ? input.destinations.map((item) => ({
    provider: cleanProvider(item && item.provider),
    targetId: cleanTarget(item && item.targetId),
    enabled: item && item.enabled !== false
  })) : [];
  const seen = new Set();
  for (const item of destinations) {
    const key = `${item.provider}:${item.targetId}`;
    if (seen.has(key)) throw new TypeError('duplicate route destination');
    seen.add(key);
  }
  return { groupId, ownerUserId, name, sourceProvider, sourceTargetId,
    enabled: input.enabled !== false, destinations };
}

function cleanAlert(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('alert is required');
  const groupId = Number.parseInt(input.groupId, 10);
  if (!Number.isSafeInteger(groupId) || groupId < 1) throw new TypeError('groupId is invalid');
  const sourceProvider = cleanProvider(input.sourceProvider);
  const sourceTargetId = cleanTarget(input.sourceTargetId, 'sourceTargetId');
  const sourceMessageId = cleanTarget(input.sourceMessageId, 'sourceMessageId');
  const body = String(input.body || '').trim();
  if (!body || body.length > 4000) throw new TypeError('alert body must be 1 to 4000 characters');
  const occurredAt = new Date(input.occurredAt || Date.now());
  if (!Number.isFinite(occurredAt.getTime())) throw new TypeError('occurredAt is invalid');
  const attachments = (Array.isArray(input.attachments) ? input.attachments : []).slice(0, 10)
    .map((item) => String(item || '').trim()).filter((url) => /^https:\/\//i.test(url)).slice(0, 10);
  const eventKey = crypto.createHash('sha256')
    .update(`${sourceProvider}\n${sourceTargetId}\n${sourceMessageId}`).digest('hex');
  return {
    groupId, sourceProvider, sourceTargetId, sourceMessageId, body, attachments,
    occurredAt: occurredAt.toISOString(), eventKey,
    authorExternalId: String(input.authorExternalId || '').slice(0, 120) || null,
    authorName: String(input.authorName || '').trim().slice(0, 160) || null
  };
}

function formatAlert(event) {
  const byline = event.author_name ? ` — ${event.author_name}` : '';
  const links = Array.isArray(event.attachments) ? event.attachments : [];
  return `🚨 ${event.body}${byline}${links.length ? `\n\n${links.join('\n')}` : ''}`.slice(0, 4000);
}

function createDiscordClient(token, fetchImpl = fetch) {
  const auth = String(token || '').trim();
  if (!auth) return null;
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`https://discord.com/api/v10${path}`, {
      ...options,
      headers: { authorization: `Bot ${auth}`, 'content-type': 'application/json', ...(options.headers || {}) }
    });
    if (!response.ok) throw new Error(`discord ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  return {
    async listMessages(channelId, after) {
      const query = new URLSearchParams({ limit: '100' });
      if (after) query.set('after', String(after));
      return request(`/channels/${encodeURIComponent(channelId)}/messages?${query}`);
    },
    async send(channelId, event) {
      const result = await request(`/channels/${encodeURIComponent(channelId)}/messages`, {
        method: 'POST', body: JSON.stringify({ content: formatAlert(event), allowed_mentions: { parse: [] } })
      });
      return String(result.id);
    }
  };
}

function createTelegramClient(token, fetchImpl = fetch) {
  const auth = String(token || '').trim();
  if (!auth) return null;
  const request = async (method, body) => {
    const response = await fetchImpl(`https://api.telegram.org/bot${auth}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(`telegram ${response.status}`);
    return data.result;
  };
  return {
    getUpdates(offset) { return request('getUpdates', { offset, timeout: 0, allowed_updates: ['channel_post','message'] }); },
    async send(chatId, event) {
      const result = await request('sendMessage', {
        chat_id: chatId, text: formatAlert(event), disable_web_page_preview: false
      });
      return String(result.message_id);
    }
  };
}

function createWordPressClient({ url, secret, fetchImpl = fetch, now = Date.now }) {
  const endpoint = String(url || '').trim();
  const key = String(secret || '').trim();
  if (!endpoint || !key) return null;
  return {
    async send(targetId, event) {
      const body = JSON.stringify({ targetId, event });
      const timestamp = String(Math.floor(now() / 1000));
      const response = await fetchImpl(endpoint, {
        method: 'POST', body,
        headers: {
          'content-type': 'application/json',
          'x-sml-timestamp': timestamp,
          'x-sml-signature': `sha256=${hmac(key, timestamp, body)}`
        }
      });
      if (!response.ok) throw new Error(`wordpress ${response.status}`);
      const result = await response.json();
      return String(result.id || result.postId || event.id);
    }
  };
}

function createAlertRouter(pool, { discord = null, telegram = null, wordpress = null, logger = () => {} } = {}) {
  const senders = { discord, telegram, sml: wordpress };

  async function replaceRoutes({ groupId, ownerUserId, routes }) {
    const gid = Number.parseInt(groupId, 10);
    const uid = Number.parseInt(ownerUserId, 10);
    if (!Number.isSafeInteger(gid) || gid < 1 || !Number.isSafeInteger(uid) || uid < 1) throw new TypeError('group owner context is invalid');
    const cleaned = (Array.isArray(routes) ? routes : []).map((route) => cleanRoute({ ...route, groupId: gid, ownerUserId: uid }));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM alert_routes WHERE group_id=$1 AND owner_user_id=$2', [gid, uid]);
      for (const route of cleaned) {
        const inserted = await client.query(
          `INSERT INTO alert_routes (group_id,owner_user_id,name,source_provider,source_target_id,enabled)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [gid, uid, route.name, route.sourceProvider, route.sourceTargetId, route.enabled]
        );
        for (const destination of route.destinations) {
          await client.query(
            `INSERT INTO alert_route_destinations (route_id,provider,target_id,enabled) VALUES ($1,$2,$3,$4)`,
            [inserted.rows[0].id, destination.provider, destination.targetId, destination.enabled]
          );
        }
      }
      await client.query('COMMIT');
      return { groupId: gid, routes: cleaned };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async function listRoutes(groupId, ownerUserId) {
    const result = await pool.query(
      `SELECT r.id,r.name,r.source_provider,r.source_target_id,r.enabled,
              COALESCE(jsonb_agg(jsonb_build_object('provider',d.provider,'targetId',d.target_id,'enabled',d.enabled)
                ORDER BY d.id) FILTER (WHERE d.id IS NOT NULL),'[]'::jsonb) destinations
         FROM alert_routes r LEFT JOIN alert_route_destinations d ON d.route_id=r.id
        WHERE r.group_id=$1 AND r.owner_user_id=$2 GROUP BY r.id ORDER BY r.id`,
      [Number(groupId), Number(ownerUserId)]
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, sourceProvider: row.source_provider,
      sourceTargetId: row.source_target_id, enabled: row.enabled, destinations: row.destinations }));
  }

  async function ingest(input) {
    const event = cleanAlert(input);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO alert_events (event_key,group_id,source_provider,source_target_id,source_message_id,
          author_external_id,author_name,body,attachments,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         ON CONFLICT DO NOTHING RETURNING *`,
        [event.eventKey,event.groupId,event.sourceProvider,event.sourceTargetId,event.sourceMessageId,
          event.authorExternalId,event.authorName,event.body,JSON.stringify(event.attachments),event.occurredAt]
      );
      if (!inserted.rowCount) { await client.query('COMMIT'); return { status: 'duplicate' }; }
      const row = inserted.rows[0];
      await client.query(
        `INSERT INTO alert_deliveries (event_id,destination_id)
         SELECT $1,d.id FROM alert_routes r JOIN alert_route_destinations d ON d.route_id=r.id
          WHERE r.group_id=$2 AND r.enabled AND d.enabled
            AND r.source_provider=$3 AND r.source_target_id=$4
            AND NOT (d.provider=$3 AND d.target_id=$4)
         ON CONFLICT DO NOTHING`,
        [row.id,event.groupId,event.sourceProvider,event.sourceTargetId]
      );
      await client.query('COMMIT');
      return { status: 'accepted', id: row.id };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async function processOne() {
    const client = await pool.connect();
    let delivery;
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE alert_deliveries SET status='retry',locked_at=NULL,updated_at=now()
          WHERE status='processing' AND locked_at < now()-interval '15 minutes'`
      );
      const selected = await client.query(
        `SELECT d.*,rd.provider,rd.target_id,e.body,e.author_name,e.attachments,e.source_provider,e.source_target_id,e.occurred_at
           FROM alert_deliveries d JOIN alert_route_destinations rd ON rd.id=d.destination_id
           JOIN alert_events e ON e.id=d.event_id
          WHERE d.status IN ('pending','retry') AND d.next_attempt_at<=now()
          ORDER BY d.id FOR UPDATE SKIP LOCKED LIMIT 1`
      );
      if (!selected.rowCount) { await client.query('COMMIT'); return 'empty'; }
      delivery = selected.rows[0];
      await client.query(`UPDATE alert_deliveries SET status='processing',attempts=attempts+1,locked_at=now(),updated_at=now() WHERE id=$1`, [delivery.id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }

    const sender = senders[delivery.provider];
    if (!sender) {
      await pool.query(`UPDATE alert_deliveries SET status='retry',locked_at=NULL,next_attempt_at=now()+interval '5 minutes',last_error=$2,updated_at=now() WHERE id=$1`, [delivery.id, `${delivery.provider} is not configured`]);
      return 'retry';
    }
    try {
      const externalId = await sender.send(delivery.target_id, delivery);
      await pool.query(`UPDATE alert_deliveries SET status='delivered',destination_message_id=$2,delivered_at=now(),locked_at=NULL,last_error=NULL,updated_at=now() WHERE id=$1`, [delivery.id, externalId]);
      return 'delivered';
    } catch (error) {
      const permanent = Number(delivery.attempts) + 1 >= 8;
      await pool.query(
        `UPDATE alert_deliveries SET status=$2,next_attempt_at=now()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::integer)),locked_at=NULL,last_error=$3,updated_at=now() WHERE id=$1`,
        [delivery.id, permanent ? 'failed' : 'retry', String(error.message || error).slice(0, 500)]
      );
      logger('warn', 'alert_delivery_failed', { deliveryId: delivery.id, provider: delivery.provider, error });
      return permanent ? 'failed' : 'retry';
    }
  }

  async function sourceRoutes(provider) {
    const clean = cleanProvider(provider);
    const result = await pool.query(
      `SELECT r.id,r.group_id,r.source_target_id,c.last_external_id
         FROM alert_routes r LEFT JOIN alert_route_cursors c ON c.route_id=r.id
        WHERE r.source_provider=$1 AND r.enabled
          AND EXISTS (SELECT 1 FROM alert_route_destinations d WHERE d.route_id=r.id AND d.enabled)
        ORDER BY r.id`, [clean]
    );
    return result.rows;
  }

  async function setCursor(routeId, externalId) {
    await pool.query(
      `INSERT INTO alert_route_cursors (route_id,last_external_id,updated_at) VALUES ($1,$2,now())
       ON CONFLICT (route_id) DO UPDATE SET last_external_id=EXCLUDED.last_external_id,updated_at=now()`,
      [routeId, String(externalId)]
    );
  }

  async function pollDiscordOnce() {
    if (!discord || typeof discord.listMessages !== 'function') return { status: 'disabled', ingested: 0 };
    const routes = await sourceRoutes('discord');
    let ingested = 0;
    for (const route of routes) {
      const messages = await discord.listMessages(route.source_target_id, route.last_external_id);
      const ordered = (Array.isArray(messages) ? messages : []).slice().sort((a, b) => {
        try { return BigInt(a.id) < BigInt(b.id) ? -1 : 1; } catch (_) { return String(a.id).localeCompare(String(b.id)); }
      });
      for (const message of ordered) {
        if (!message || !message.id) continue;
        if (!(message.author && message.author.bot)) {
          const body = String(message.content || '').trim();
          const attachments = (message.attachments || []).map((item) => item && item.url).filter(Boolean);
          if (body || attachments.length) {
            await ingest({
              groupId: route.group_id, sourceProvider: 'discord', sourceTargetId: route.source_target_id,
              sourceMessageId: message.id, body: body || 'Shared an alert attachment', attachments,
              authorExternalId: message.author && message.author.id,
              authorName: message.author && (message.author.global_name || message.author.username),
              occurredAt: message.timestamp
            });
            ingested += 1;
          }
        }
        await setCursor(route.id, message.id);
      }
    }
    return { status: 'ok', routes: routes.length, ingested };
  }

  async function pollTelegramOnce() {
    if (!telegram || typeof telegram.getUpdates !== 'function') return { status: 'disabled', ingested: 0 };
    const routes = await sourceRoutes('telegram');
    if (!routes.length) return { status: 'ok', routes: 0, ingested: 0 };
    const cursorValues = routes.map((route) => Number(route.last_external_id || 0)).filter(Number.isSafeInteger);
    const offset = (cursorValues.length ? Math.min(...cursorValues) : 0) + 1;
    const updates = await telegram.getUpdates(offset);
    let ingested = 0;
    let highest = offset - 1;
    for (const update of Array.isArray(updates) ? updates : []) {
      highest = Math.max(highest, Number(update.update_id || 0));
      const message = update.channel_post || update.message;
      if (!message || !message.chat || !message.message_id || (message.from && message.from.is_bot)) continue;
      const matching = routes.filter((route) => String(route.source_target_id) === String(message.chat.id));
      const body = String(message.text || message.caption || '').trim();
      if (!body) continue;
      for (const route of matching) {
        await ingest({
          groupId: route.group_id, sourceProvider: 'telegram', sourceTargetId: route.source_target_id,
          sourceMessageId: message.message_id, body,
          authorExternalId: message.from && message.from.id,
          authorName: message.from && [message.from.first_name, message.from.last_name].filter(Boolean).join(' '),
          occurredAt: Number(message.date || 0) * 1000
        });
        ingested += 1;
      }
    }
    if (highest >= offset) await Promise.all(routes.map((route) => setCursor(route.id, highest)));
    return { status: 'ok', routes: routes.length, ingested };
  }

  return { replaceRoutes, listRoutes, ingest, processOne, sourceRoutes, setCursor, pollDiscordOnce, pollTelegramOnce };
}

module.exports = {
  cleanProvider, cleanTarget, cleanRoute, cleanAlert, formatAlert,
  createDiscordClient, createTelegramClient, createWordPressClient, createAlertRouter
};
