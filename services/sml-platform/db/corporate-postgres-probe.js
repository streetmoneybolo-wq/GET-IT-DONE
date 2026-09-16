'use strict';
/* Real-Postgres probe for migrations 017/018 and the corporate services.
 *
 * Run against a SCRATCH database only — it TRUNCATEs every corporate table:
 *   DATABASE_URL=postgres://... node db/migrate.js up
 *   DATABASE_URL=postgres://... node db/corporate-postgres-probe.js
 *
 * Exists because the unit tests use fake pools and a fake evidence store, and
 * that let bugs through that only a real database shows: a hash-chained table
 * missing the provenance block, BIGINTs hashed as numbers but read back as
 * strings, and an enum compared against an untyped text[] parameter.
 * Every check prints PASS/FAIL; the exit code is the number of failures. */

const { Pool } = require('pg');
const path = require('node:path');
const WT = path.join(__dirname, '..', 'platform');
const { createCorporateAccountService } = require(`${WT}/corporate-accounts.js`);
const { createCorporateBillingService } = require(`${WT}/corporate-billing.js`);
const { createCorporatePromoService } = require(`${WT}/corporate-promo.js`);
const { createEvidenceStore } = require(`${WT}/evidence-store.js`);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push([ok ? 'PASS' : 'FAIL', name, detail]);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
async function expectSqlError(name, code, sql, params = []) {
  try {
    await pool.query(sql, params);
    check(name, false, `accepted; expected SQLSTATE ${code}`);
  } catch (e) {
    check(name, e.code === code, `${e.code} ${e.constraint || ''} ${e.code === code ? '' : e.message}`.trim());
  }
}
async function expectReject(name, fn, predicate) {
  try { await fn(); check(name, false, 'did not throw'); }
  catch (e) { check(name, predicate(e), `${e.code || e.name}: ${e.message}`); }
}

const SECRET = 'scratch-verification-secret-0123456789';
const quiet = () => {};

async function main() {
  const db = (await pool.query('SELECT current_database() AS name')).rows[0].name;
  if (!/scratch|test|probe/i.test(db) && process.env.CORPORATE_PROBE_CONFIRM !== db) {
    throw new Error(`refusing to TRUNCATE corporate tables in "${db}". Use a scratch database, or set CORPORATE_PROBE_CONFIRM=${db}.`);
  }
  await pool.query(`TRUNCATE corporate_promotions, corporate_ad_spend, corporate_feed_metrics,
                    corporate_billing, corporate_accounts RESTART IDENTITY CASCADE`);

  const store = createEvidenceStore({ pool, keyList: ['1:scratch-evidence-key-0123456789abcdef'] });
  let tokenFor = null;
  const accounts = createCorporateAccountService({
    pool, verificationSecret: SECRET, logger: quiet,
    resolveTxt: async () => [[tokenFor]],
    lookup: async () => [{ address: '151.101.1.1', family: 4 }],
    fetchImpl: async () => { throw new Error('network disabled in probe'); }
  });
  const billing = createCorporateBillingService({ pool, store, logger: quiet });
  const promos = createCorporatePromoService({ pool, logger: quiet });

  /* ---------------------------------------------------------- lifecycle */
  const reg = await accounts.register({
    wpUserId: 900001, companyName: 'Bloomberg Test', brandHandle: 'bloombergtest',
    websiteUrl: 'https://bloomberg.com', category: 'finance'
  });
  check('register returns an id, domain and token', reg.corporateId > 0 && reg.domain === 'bloomberg.com' && /^sml-verification=/.test(reg.token), JSON.stringify({ id: reg.corporateId, domain: reg.domain }));

  await expectSqlError('017: duplicate wp_user_id is refused', '23505',
    `INSERT INTO corporate_accounts (wp_user_id, company_name, brand_handle, website_url) VALUES (900001,'Dup','dup','https://dup.com')`);

  await expectSqlError('017: active without verification is refused by the database', '23514',
    `UPDATE corporate_accounts SET status='active' WHERE id=$1`, [reg.corporateId]);

  await expectReject('activate refuses an unverified domain',
    () => accounts.activate(reg.corporateId), (e) => /not verified/.test(e.message));

  tokenFor = 'sml-verification=wrong';
  const bad = await accounts.verifyDomain(reg.corporateId);
  check('verifyDomain rejects a wrong DNS token', bad.verified === false, bad.reason);

  tokenFor = reg.token;
  const good = await accounts.verifyDomain(reg.corporateId);
  check('verifyDomain accepts the right DNS token', good.verified === true && good.method === 'dns_txt', JSON.stringify(good));

  const cycle = await billing.openCycle({ corporateId: reg.corporateId });
  check('openCycle inserts a cycle with the default caps', cycle.billingId > 0 && cycle.annualCapCents === 10000000 && cycle.discountCapCents === 2000000, JSON.stringify(cycle));

  await expectReject('activate refuses an unpaid onboarding fee',
    () => accounts.activate(reg.corporateId), (e) => /fee is not paid/.test(e.message));

  const fee1 = await billing.markOnboardingFeePaid({ billingId: cycle.billingId, stripePaymentIntent: 'pi_probe_1' });
  const fee2 = await billing.markOnboardingFeePaid({ billingId: cycle.billingId, stripePaymentIntent: 'pi_probe_1' });
  check('the fee records once; a retried webhook is a no-op', fee1.applied === true && fee2.applied === false);

  const act = await accounts.activate(reg.corporateId);
  check('activate succeeds once verified and paid', act.activated === true);

  const proj = await accounts.projection();
  check('projection lists the active account', proj.length === 1 && proj[0].wpUserId === 900001 && proj[0].category === 'finance', JSON.stringify(proj));

  await expectSqlError('017: suspended without a reason is refused', '23514',
    `UPDATE corporate_accounts SET status='suspended', suspended_reason=NULL WHERE id=$1`, [reg.corporateId]);

  /* -------------------------------------------------------------- money */
  const first = await billing.purchaseAd({ corporateId: reg.corporateId, billingId: cycle.billingId, grossCents: 100000, stripeChargeId: 'ch_probe_first' });
  check('purchaseAd prices $1,000 at $800 net', first.netCents === 80000 && first.discountCents === 20000, JSON.stringify(first));

  /* Concurrency: 12 simultaneous $15,000 purchases, which together blow
   * through both the discount cap and the annual cap. */
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, () =>
    billing.purchaseAd({ corporateId: reg.corporateId, billingId: cycle.billingId, grossCents: 1500000 })));
  const ok = attempts.filter((a) => a.status === 'fulfilled').length;
  const capped = attempts.filter((a) => a.status === 'rejected' && a.reason.code === 'cap_exceeded').length;
  const other = attempts.filter((a) => a.status === 'rejected' && a.reason.code !== 'cap_exceeded');
  check('concurrent purchases either succeed or hit the cap — nothing else', other.length === 0,
    `${ok} succeeded, ${capped} cap_exceeded${other.length ? ', other: ' + other.map((o) => o.reason.message).join(' | ') : ''}`);

  const sums = (await pool.query(
    `SELECT SUM(net_cents)::bigint net, SUM(discount_cents)::bigint disc, COUNT(*)::int n,
            COUNT(*) FILTER (WHERE net_cents <> gross_cents - discount_cents)::int badmath
       FROM corporate_ad_spend WHERE billing_id=$1`, [cycle.billingId])).rows[0];
  check('annual cap never overshot under concurrency', Number(sums.net) <= 10000000, `net ${sums.net} of 10000000 across ${sums.n} rows`);
  check('discount cap never overshot under concurrency', Number(sums.disc) <= 2000000, `discount ${sums.disc} of 2000000`);
  check('every ledger row satisfies net = gross - discount', sums.badmath === 0);

  const client = await pool.connect();
  try {
    const chain = await store.verifyChain(client, 'corporate_ad_spend', cycle.billingId);
    /* ok with NO legacyRows: every row must hash in canonical form. A legacy
     * row here would mean the store's normalization did not run. */
    check('the ad-spend hash chain verifies after concurrent appends, no legacy rows',
      chain.ok === true && !chain.legacyRows, JSON.stringify(chain));
  } finally { client.release(); }

  const summaryBefore = await billing.cycleSummary(cycle.billingId);
  await billing.recordCorrection({ corporateId: reg.corporateId, billingId: cycle.billingId,
    grossCents: -100000, discountCents: -20000, reason: 'probe refund',
    stripeChargeId: 'ch_probe_first', stripeRefundId: 're_probe_first' });
  check('refunding a real Stripe charge does not collide with its purchase row', true);
  const client2 = await pool.connect();
  try {
    const chain2 = await store.verifyChain(client2, 'corporate_ad_spend', cycle.billingId);
    check('the chain still verifies after a correction, no legacy rows',
      chain2.ok === true && !chain2.legacyRows, JSON.stringify(chain2));
  } finally { client2.release(); }
  const summaryAfter = await billing.cycleSummary(cycle.billingId);
  check('a correction restores cap headroom by its net', summaryAfter.remainingCents - summaryBefore.remainingCents === 80000,
    `${summaryBefore.remainingCents} -> ${summaryAfter.remainingCents}`);

  await expectSqlError('017: a ledger row with wrong arithmetic is refused', '23514',
    `INSERT INTO corporate_ad_spend (corporate_id,billing_id,gross_cents,discount_cents,net_cents,source,occurred_at,received_at,integrity_hash)
     VALUES ($1,$2,1000,100,999,'sml_platform',now(),now(),'x')`, [reg.corporateId, cycle.billingId]);
  await expectSqlError('017: a discount larger than the purchase is refused', '23514',
    `INSERT INTO corporate_ad_spend (corporate_id,billing_id,gross_cents,discount_cents,net_cents,source,occurred_at,received_at,integrity_hash)
     VALUES ($1,$2,1000,2000,-1000,'sml_platform',now(),now(),'x')`, [reg.corporateId, cycle.billingId]);

  /* ---------------------------------------------------------- promotions */
  const now = Date.now();
  const iso = (ms) => new Date(now + ms).toISOString();
  const H = 3600 * 1000;

  const promo = await promos.schedule({ corporateId: reg.corporateId, spendId: first.spendId,
    itemRef: 'chart-probe-1', startsAt: iso(-H), endsAt: iso(24 * H) });
  check('018: schedule inserts a running promotion (enum cast on INSERT)', promo && promo.status === 'running', promo && promo.status);

  const live = await promos.livePromotions();
  check('018: livePromotions runs and finds it (enum array cast)', live.items.has('chart-probe-1'), [...live.items].join(','));

  await expectReject('018: a second live promotion on the same item is refused by the index',
    () => promos.schedule({ corporateId: reg.corporateId, spendId: first.spendId,
      itemRef: 'chart-probe-1', startsAt: iso(H), endsAt: iso(2 * H) }),
    (e) => e.code === 'already_promoted');

  const refundRow = (await pool.query(
    `SELECT id FROM corporate_ad_spend WHERE billing_id=$1 AND net_cents < 0 LIMIT 1`, [cycle.billingId])).rows[0];
  await expectReject('a promotion backed by a refund row is refused',
    () => promos.schedule({ corporateId: reg.corporateId, spendId: Number(refundRow.id),
      itemRef: 'chart-probe-2', startsAt: iso(H), endsAt: iso(2 * H) }),
    (e) => e.code === 'spend_not_a_purchase');

  const other2 = await accounts.register({ wpUserId: 900002, companyName: 'CNN Test', brandHandle: 'cnntest',
    websiteUrl: 'https://cnn.com', category: 'news' });
  tokenFor = other2.token;
  await accounts.verifyDomain(other2.corporateId);
  const c2 = await billing.openCycle({ corporateId: other2.corporateId });
  await billing.markOnboardingFeePaid({ billingId: c2.billingId, stripePaymentIntent: 'pi_probe_2' });
  await accounts.activate(other2.corporateId);
  await expectReject('a promotion against another account\'s purchase is refused',
    () => promos.schedule({ corporateId: other2.corporateId, spendId: first.spendId,
      itemRef: 'chart-probe-3', startsAt: iso(H), endsAt: iso(2 * H) }),
    (e) => e.code === 'spend_mismatch');

  const before = (await pool.query('SELECT updated_at FROM corporate_promotions WHERE id=$1', [promo.id])).rows[0].updated_at;
  await new Promise((r) => setTimeout(r, 20));
  const cancelled = await promos.cancel({ promotionId: promo.id, reason: 'probe cancel' });
  const after = (await pool.query('SELECT updated_at FROM corporate_promotions WHERE id=$1', [promo.id])).rows[0].updated_at;
  check('018: cancel works and the touch trigger moves updated_at', cancelled.status === 'cancelled' && after > before);

  const again = await promos.schedule({ corporateId: reg.corporateId, spendId: first.spendId,
    itemRef: 'chart-probe-1', startsAt: iso(H), endsAt: iso(2 * H) });
  check('018: after cancelling, the item can be promoted again (partial index)', again.status === 'scheduled');

  const hist = await promos.purchaseHistory(reg.corporateId);
  check('018: purchaseHistory joins spend to placements', hist.length === 2 && hist.every((h) => Number(h.net_cents) === 80000),
    hist.map((h) => `${h.item_ref}:${h.effectiveStatus}`).join(', '));

  await expectSqlError('018: an inverted window is refused', '23514',
    `INSERT INTO corporate_promotions (corporate_id,spend_id,item_ref,starts_at,ends_at) VALUES ($1,$2,'x1',now(),now()-interval '1 hour')`,
    [reg.corporateId, first.spendId]);
  await expectSqlError('018: cancelled without a reason is refused', '23514',
    `UPDATE corporate_promotions SET status='cancelled', cancelled_at=now(), cancel_reason=NULL WHERE id=$1`, [again.id]);
  await expectSqlError('018: a promotion with no purchase behind it is refused', '23503',
    `INSERT INTO corporate_promotions (corporate_id,spend_id,item_ref,starts_at,ends_at) VALUES ($1,999999,'x2',now(),now()+interval '1 hour')`,
    [reg.corporateId]);
  await expectSqlError('018: a paid spend row cannot be deleted while a promotion points at it', '23001',
    `DELETE FROM corporate_ad_spend WHERE id=$1`, [first.spendId]);

  await accounts.suspend(reg.corporateId, 'probe suspension');
  const liveAfterSuspend = await promos.livePromotions();
  check('suspending an account removes its promotions from delivery', !liveAfterSuspend.corporateIds.has(reg.corporateId));
  const projAfter = await accounts.projection();
  check('suspending an account removes it from the WordPress projection', !projAfter.some((p) => p.wpUserId === 900001));
  await expectReject('a suspended account cannot schedule a promotion',
    () => promos.schedule({ corporateId: reg.corporateId, spendId: first.spendId,
      itemRef: 'chart-probe-9', startsAt: iso(H), endsAt: iso(2 * H) }),
    (e) => e.code === 'not_active');

  console.log(`\n${results.length - failures} passed, ${failures} failed`);
}

main()
  .catch((e) => { console.error('PROBE CRASHED:', e); failures += 1; })
  .finally(async () => { await pool.end(); process.exit(failures); });
