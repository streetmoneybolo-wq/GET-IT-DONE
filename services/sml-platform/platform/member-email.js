'use strict';

const crypto = require('node:crypto');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]{1,190}(?:\.[^\s@.]{1,63})+$/;
const BLOB_VERSION = 1;

function normalizeEmail(value) {
  const email = String(value || '').trim().normalize('NFKC').toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

function keyFrom(value, label) {
  const material = String(value || '').trim();
  if (material.length < 32) throw new Error(`${label} must contain at least 32 characters`);
  return crypto.createHash('sha256').update(material, 'utf8').digest();
}

function createEmailCipher({ encryptionKey, hashKey }) {
  const encKey = keyFrom(encryptionKey, 'email encryption key');
  const lookupKey = keyFrom(hashKey || encryptionKey, 'email hash key');
  return {
    encrypt(email) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const encrypted = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from([BLOB_VERSION]), iv, cipher.getAuthTag(), encrypted]);
    },
    decrypt(value) {
      const blob = Buffer.from(value || []);
      if (blob.length < 30 || blob[0] !== BLOB_VERSION) throw new TypeError('invalid encrypted email');
      const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, blob.subarray(1, 13));
      decipher.setAuthTag(blob.subarray(13, 29));
      return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString('utf8');
    },
    hash(email) {
      return crypto.createHmac('sha256', lookupKey).update(email, 'utf8').digest('hex');
    }
  };
}

function renewalFromUpgradeChatOrder(order) {
  if (!order || !order.is_subscription || order.deleted) return null;
  const item = (order.order_items || []).find((entry) => entry && entry.interval);
  const source = order.last_succeeded_charge?.payment_processor_created || order.purchased_at;
  const date = new Date(source);
  const count = Number(item?.interval_count || 1);
  if (!item || !Number.isSafeInteger(count) || count < 1 || Number.isNaN(date.valueOf())) return null;
  if (item.interval === 'day') date.setUTCDate(date.getUTCDate() + count);
  else if (item.interval === 'week') date.setUTCDate(date.getUTCDate() + 7 * count);
  else if (item.interval === 'month') date.setUTCMonth(date.getUTCMonth() + count);
  else if (item.interval === 'year') date.setUTCFullYear(date.getUTCFullYear() + count);
  else return null;
  return date.toISOString();
}

function upgradeChatContact(order) {
  const email = normalizeEmail(order?.user?.email);
  const reference = String(order?.uuid || '').trim();
  if (!email || !reference) return null;
  return {
    email,
    source: 'upgrade_chat',
    sourceCustomerRef: reference,
    discordUserId: order.user?.discord_id ? String(order.user.discord_id) : null,
    renewalAt: renewalFromUpgradeChatOrder(order)
  };
}

function stripeContact(event) {
  const object = event?.data?.object;
  if (!object || typeof object !== 'object') return null;
  const email = normalizeEmail(object.customer_details?.email || object.customer_email ||
    object.receipt_email || object.billing_details?.email || object.charges?.data?.[0]?.billing_details?.email);
  const reference = typeof object.customer === 'string' ? object.customer : object.customer?.id ||
    (String(object.id || '').startsWith('cus_') ? object.id : event.id);
  if (!email || !reference) return null;
  const discordUserId = object.metadata?.discord_user_id || object.metadata?.discordUserId || null;
  const renewalSeconds = object.current_period_end || object.lines?.data?.[0]?.period?.end;
  return {
    email,
    source: 'stripe',
    sourceCustomerRef: String(reference),
    discordUserId: discordUserId ? String(discordUserId) : null,
    renewalAt: Number.isFinite(Number(renewalSeconds)) ? new Date(Number(renewalSeconds) * 1000).toISOString() : null
  };
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  return local && domain ? `${local[0]}***@${domain}` : '***';
}

function createResendSender({ apiKey, from, replyTo = '', fetchImpl = fetch }) {
  const configured = Boolean(apiKey && from);
  return {
    configured,
    async send(message) {
      if (!configured) throw new Error('email_provider_unconfigured');
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json',
          'idempotency-key': message.idempotencyKey },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html,
          ...(replyTo ? { reply_to: replyTo } : {}), headers: message.headers || {} })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.id) throw new Error(`email_provider_failed_${response.status}`);
      return { id: String(data.id) };
    }
  };
}

function createMemberEmailService({ pool, encryptionKey, hashKey, sender, siteUrl = 'https://stockmarketloop.com',
  businessAddress = '', logger = () => {}, now = Date.now }) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('database pool is required');
  const cipher = createEmailCipher({ encryptionKey, hashKey });
  const clock = typeof now === 'function' ? now : Date.now;

  async function upsert(contact, sourceEventId = null) {
    if (!contact) return null;
    const emailHash = cipher.hash(contact.email);
    const domain = contact.email.split('@')[1];
    const result = await pool.query(
      `INSERT INTO member_email_contacts (
         identity_id,discord_user_id,source,source_customer_ref,email_enc,email_hash,email_domain,
         verification_status,renewal_at,last_synced_at,updated_at
       ) VALUES (
         (SELECT id FROM billing_identities WHERE discord_user_id=$1 LIMIT 1),$1,$2,$3,$4,$5,$6,
         'provider_verified',$7,now(),now()
       ) ON CONFLICT (source,source_customer_ref) DO UPDATE SET
         identity_id=COALESCE(member_email_contacts.identity_id,EXCLUDED.identity_id),
         discord_user_id=COALESCE(EXCLUDED.discord_user_id,member_email_contacts.discord_user_id),
         email_enc=EXCLUDED.email_enc,email_hash=EXCLUDED.email_hash,email_domain=EXCLUDED.email_domain,
         verification_status='provider_verified',renewal_at=COALESCE(EXCLUDED.renewal_at,member_email_contacts.renewal_at),
         last_synced_at=now(),updated_at=now()
       RETURNING id`,
      [contact.discordUserId, contact.source, contact.sourceCustomerRef, cipher.encrypt(contact.email),
        emailHash, domain, contact.renewalAt]
    );
    const id = Number(result.rows[0].id);
    await pool.query(
      `INSERT INTO member_email_events (contact_id,event_type,source,provider_event_id,metadata)
       VALUES ($1,'imported',$2,$3,$4::jsonb) ON CONFLICT (source,provider_event_id) DO NOTHING`,
      [id, contact.source, sourceEventId || `${contact.source}:${contact.sourceCustomerRef}`,
        JSON.stringify({ provider: contact.source, hasDiscordId: Boolean(contact.discordUserId) })]
    );
    return id;
  }

  async function syncProviderRecords(limit = 100) {
    let imported = 0;
    const uc = await pool.query(
      `SELECT webhook_event_id,payload->'order' AS provider_object
         FROM upgrade_chat_records
        WHERE payload->'order'->'user'->>'email' IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM member_email_events e
            WHERE e.source='upgrade_chat' AND e.provider_event_id=upgrade_chat_records.webhook_event_id)
        ORDER BY id DESC LIMIT $1`, [Math.max(1, Math.min(Number(limit) || 100, 500))]);
    for (const row of uc.rows) if (await upsert(upgradeChatContact(row.provider_object), row.webhook_event_id)) imported++;
    const stripe = await pool.query(
      `SELECT event_id,payload FROM stripe_events
        WHERE COALESCE(payload->'data'->'object'->'customer_details'->>'email',
                       payload->'data'->'object'->>'customer_email',
                       payload->'data'->'object'->>'receipt_email',
                       payload->'data'->'object'->'billing_details'->>'email') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM member_email_events e
            WHERE e.source='stripe' AND e.provider_event_id=stripe_events.event_id)
        ORDER BY received_at DESC LIMIT $1`, [Math.max(1, Math.min(Number(limit) || 100, 500))]);
    for (const row of stripe.rows) if (await upsert(stripeContact(row.payload), row.event_id)) imported++;
    return { imported, scanned: uc.rowCount + stripe.rowCount };
  }

  async function recordMarketingConsent({ contactId, enabled, source = 'stockmarketloop_preferences' }) {
    const id = Number(contactId);
    if (!Number.isSafeInteger(id) || id < 1) throw new TypeError('invalid contact id');
    const result = await pool.query(
      `UPDATE member_email_contacts SET
         marketing_opt_in=$2,marketing_consent_at=CASE WHEN $2 THEN now() ELSE marketing_consent_at END,
         marketing_consent_source=CASE WHEN $2 THEN $3 ELSE marketing_consent_source END,
         unsubscribed_at=CASE WHEN $2 THEN NULL ELSE now() END,updated_at=now()
       WHERE id=$1 RETURNING id`, [id, enabled === true, String(source).slice(0, 120)]);
    if (!result.rowCount) throw new TypeError('contact not found');
    await pool.query(
      `INSERT INTO member_email_events(contact_id,event_type,source,provider_event_id)
       VALUES($1,$2,$3,$4) ON CONFLICT(source,provider_event_id) DO NOTHING`,
      [id, enabled === true ? 'consent_granted' : 'consent_withdrawn', 'sml', `consent:${id}:${clock()}:${enabled ? 1 : 0}`]);
    return { contactId: id, marketingOptIn: enabled === true };
  }

  async function queueRenewals(daysBefore = 7) {
    const days = Math.max(1, Math.min(Number(daysBefore) || 7, 30));
    const result = await pool.query(
      `INSERT INTO member_email_outbox(contact_id,message_type,template_ref,subject,payload,idempotency_key,available_at)
       SELECT c.id,'renewal','renewal-v1','Your membership renewal is approaching',
              jsonb_build_object('renewalAt',c.renewal_at),
              'renewal:'||c.id||':'||to_char(c.renewal_at AT TIME ZONE 'UTC','YYYY-MM-DD'),now()
         FROM member_email_contacts c
        WHERE c.transactional_allowed AND c.suppressed_at IS NULL
          AND c.renewal_at > now() AND c.renewal_at <= now()+make_interval(days=>$1)
       ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`, [days]);
    return { queued: result.rowCount };
  }

  async function queueSpecialOffer({ subject, html, campaignKey }) {
    const safeSubject = String(subject || '').trim();
    const safeHtml = String(html || '').trim();
    const key = String(campaignKey || '').trim();
    if (!safeSubject || safeSubject.length > 180 || !safeHtml || safeHtml.length > 100000 || !/^[a-z0-9._:-]{3,100}$/i.test(key)) {
      throw new TypeError('invalid campaign');
    }
    if (!String(businessAddress || '').trim()) {
      throw new TypeError('business address is required before marketing email can be queued');
    }
    const result = await pool.query(
      `INSERT INTO member_email_outbox(contact_id,message_type,template_ref,subject,payload,idempotency_key)
       SELECT c.id,'special_offer','special-offer-v1',$1,jsonb_build_object('html',$2),'offer:'||$3||':'||c.id
         FROM (SELECT DISTINCT ON (email_hash) * FROM member_email_contacts
                WHERE marketing_opt_in AND unsubscribed_at IS NULL AND suppressed_at IS NULL
                ORDER BY email_hash,marketing_consent_at DESC NULLS LAST,id DESC) c
       ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`, [safeSubject, safeHtml, key]);
    return { queued: result.rowCount };
  }

  async function analytics({ limit = 100, offset = 0, includeRawEmails = true } = {}) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    const boundedOffset = Math.max(0, Number(offset) || 0);
    const [summary, rows] = await Promise.all([
      pool.query(`SELECT count(*)::int AS contacts,count(*) FILTER(WHERE marketing_opt_in)::int AS marketing_opted_in,
        count(*) FILTER(WHERE suppressed_at IS NOT NULL)::int AS suppressed,
        count(*) FILTER(WHERE source='upgrade_chat')::int AS upgrade_chat,
        count(*) FILTER(WHERE source='stripe')::int AS stripe FROM member_email_contacts`),
      pool.query(`SELECT c.*,bi.sml_user_id,bi.wordpress_user_id AS linked_wordpress_user_id,
        (SELECT max(occurred_at) FROM member_email_events e WHERE e.contact_id=c.id AND e.event_type='sent') AS last_sent_at
        FROM member_email_contacts c LEFT JOIN billing_identities bi ON bi.id=c.identity_id
        ORDER BY c.updated_at DESC,c.id DESC LIMIT $1 OFFSET $2`, [boundedLimit, boundedOffset])
    ]);
    return { summary: summary.rows[0], contacts: rows.rows.map((row) => {
      const email = cipher.decrypt(row.email_enc);
      return { id: Number(row.id), email: includeRawEmails ? email : maskEmail(email), emailDomain: row.email_domain,
        source: row.source, discordUserId: row.discord_user_id, smlUserId: row.sml_user_id,
        wordpressUserId: row.wordpress_user_id || row.linked_wordpress_user_id,
        verificationStatus: row.verification_status, renewalAt: row.renewal_at,
        marketingOptIn: row.marketing_opt_in, marketingConsentAt: row.marketing_consent_at,
        unsubscribedAt: row.unsubscribed_at, suppressedAt: row.suppressed_at,
        lastSyncedAt: row.last_synced_at, lastSentAt: row.last_sent_at };
    }) };
  }

  function renewalHtml(row) {
    const date = row.payload?.renewalAt ? new Date(row.payload.renewalAt).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' }) : 'soon';
    return `<h1>Your membership renewal is approaching</h1><p>Your membership is scheduled to renew on <strong>${date}</strong>.</p>` +
      `<p>Manage your membership and email preferences at <a href="${siteUrl}/my-account/">StockMarketLoop.com</a>.</p>` +
      `<p>This is a service notice about your membership. Promotional email preferences are managed separately.</p>`;
  }

  async function processOne() {
    if (!sender?.configured) return 'disabled';
    const selected = await pool.query(
      `UPDATE member_email_outbox SET status='processing',attempts=attempts+1,locked_at=now(),updated_at=now()
       WHERE id=(SELECT o.id FROM member_email_outbox o JOIN member_email_contacts c ON c.id=o.contact_id
         WHERE o.status IN('pending','failed') AND o.available_at<=now() AND o.attempts<5
           AND c.suppressed_at IS NULL AND (o.message_type<>'special_offer' OR (c.marketing_opt_in AND c.unsubscribed_at IS NULL))
         ORDER BY o.available_at,o.id FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING *`);
    if (!selected.rowCount) return 'empty';
    const row = selected.rows[0];
    try {
      const contact = (await pool.query('SELECT email_enc FROM member_email_contacts WHERE id=$1', [row.contact_id])).rows[0];
      const to = cipher.decrypt(contact.email_enc);
      const html = row.message_type === 'special_offer' ? String(row.payload.html || '') : renewalHtml(row);
      const footer = businessAddress ? `<hr><p>${businessAddress}</p>` : '';
      const result = await sender.send({ to, subject: row.subject, html: html + footer,
        idempotencyKey: row.idempotency_key, headers: { 'List-Unsubscribe': `<${siteUrl}/email-preferences/>` } });
      await pool.query(`UPDATE member_email_outbox SET status='sent',provider_message_id=$2,sent_at=now(),updated_at=now() WHERE id=$1`, [row.id, result.id]);
      await pool.query(`INSERT INTO member_email_events(contact_id,outbox_id,event_type,source,provider_event_id)
        VALUES($1,$2,'sent','resend',$3) ON CONFLICT(source,provider_event_id) DO NOTHING`, [row.contact_id, row.id, result.id]);
      return 'sent';
    } catch (error) {
      await pool.query(`UPDATE member_email_outbox SET status='failed',last_error=$2,
        available_at=now()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::int)),updated_at=now() WHERE id=$1`,
      [row.id, String(error.message || 'delivery_failed').slice(0, 240)]);
      logger('error', 'member_email_delivery_failed', { outboxId: Number(row.id), error });
      return 'failed';
    }
  }

  return { upsert, syncProviderRecords, recordMarketingConsent, queueRenewals, queueSpecialOffer, analytics, processOne };
}

module.exports = { normalizeEmail, createEmailCipher, renewalFromUpgradeChatOrder, upgradeChatContact,
  stripeContact, createResendSender, createMemberEmailService, maskEmail };
