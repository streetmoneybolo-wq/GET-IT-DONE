/* =============================================================================
 * platform/corporate-accounts.js — institutional publisher accounts
 *
 * register -> verify domain -> activate -> project to WordPress
 *
 * THE WHOLE THING TURNS ON DOMAIN VERIFICATION.
 * Anyone can type "Bloomberg" into a signup form. Only Bloomberg can publish a
 * DNS TXT record at bloomberg.com or serve a file from it. On a finance
 * platform, one convincing impersonation of a news brand is an existential
 * event — so the domain is derived from the registered website at signup, is
 * never operator-supplied afterwards, and migration 017 refuses status='active'
 * without it.
 *
 * The HTTP fallback is an SSRF sink by construction: it fetches a URL derived
 * from user input. Every mitigation below exists for that, and the reasons are
 * written down so the next person does not "simplify" one away.
 *
 * Clock, fetch and DNS are injected, so the whole verification path is testable
 * without a network.
 * ========================================================================== */

'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

function invalid(message) { return new TypeError(message); }

function requireId(value, name) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw invalid(`${name} must be a positive integer`);
  return id;
}

function requireText(value, name, maximum = 240) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maximum) {
    throw invalid(`${name} must be a non-empty string of at most ${maximum} characters`);
  }
  return text;
}

const CATEGORIES = Object.freeze([
  'news', 'media', 'finance', 'research', 'brokerage', 'data', 'other'
]);

/* Handles collide case-insensitively on this platform — the nicename collision
 * that resolved /grandmasterobi/ to a different user than the display name
 * implied. Stored lowercase, compared lowercase, everywhere. */
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,38}$/;

const WELL_KNOWN_PATH = '/.well-known/sml-verification.txt';

/* A verification file is a token, not a document. Anything larger is either a
 * misconfigured server or someone feeding us a decompression bomb. */
const MAX_VERIFICATION_BYTES = 512;
const VERIFY_TIMEOUT_MS = 5000;

/* -------------------------------------------------------------- domain rules */

/**
 * Reduce a website URL to the host we will demand proof from.
 *
 * Rejects rather than coerces. A registration that cannot state its own domain
 * unambiguously is one we should not be verifying.
 */
function normalizeDomain(websiteUrl) {
  const raw = requireText(websiteUrl, 'websiteUrl', 2048);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw invalid('websiteUrl must be an absolute URL');
  }
  /* https only. An http origin can be rewritten by anyone on the path, which
   * makes the file proof worthless. */
  if (url.protocol !== 'https:') throw invalid('websiteUrl must be https');
  /* Credentials in a URL are a classic parser-confusion vector:
   * https://cnn.com@evil.example resolves to evil.example in some parsers. */
  if (url.username || url.password) throw invalid('websiteUrl must not contain credentials');
  if (url.port) throw invalid('websiteUrl must not specify a port');

  /* WHATWG keeps the brackets on an IPv6 host ("[::1]"), and net.isIP does not
   * recognise the bracketed form — strip them BEFORE the IP check so an IPv6
   * literal is caught as an address rather than falling through to the domain
   * regex. It is refused either way today, but relying on the wrong guard is
   * how a bypass appears the next time that regex is loosened. */
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host) throw invalid('websiteUrl has no host');
  /* An IP literal cannot be owned in the sense that matters here, and it is the
   * usual way to aim a fetcher at infrastructure. */
  if (net.isIP(host)) throw invalid('websiteUrl must name a domain, not an IP address');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw invalid('websiteUrl must be a public domain');
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    throw invalid('websiteUrl host is not a valid domain');
  }
  return host;
}

/**
 * Is this address one we are willing to talk to?
 *
 * Blocks loopback, private, link-local and CGNAT ranges. 169.254.169.254 is the
 * cloud metadata endpoint — on Render, reaching it would hand out instance
 * credentials, so the link-local block is the single most important line here.
 */
function isPublicAddress(address) {
  const kind = net.isIP(address);
  if (kind === 4) {
    const p = address.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return false;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    if (p[0] === 192 && p[1] === 168) return false;
    if (p[0] === 169 && p[1] === 254) return false;            // link-local + metadata
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false; // CGNAT
    if (p[0] >= 224) return false;                              // multicast / reserved
    return true;
  }
  if (kind === 6) {
    const a = address.toLowerCase();
    if (a === '::' || a === '::1') return false;
    if (a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) return false;
    if (a.startsWith('fc') || a.startsWith('fd')) return false; // unique local
    /* ::ffff:10.0.0.1 — an IPv4 private address wearing an IPv6 coat. */
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    return true;
  }
  return false;
}

/* --------------------------------------------------------------- the service */

function createCorporateAccountService({
  pool,
  verificationSecret,
  fetchImpl = globalThis.fetch,
  resolveTxt,
  lookup,
  now = Date.now,
  logger = () => {}
} = {}) {
  if (!pool) throw new Error('corporate accounts service requires a database pool');
  if (!verificationSecret || String(verificationSecret).length < 16) {
    throw new Error('corporate accounts service requires a verificationSecret of at least 16 characters');
  }

  /* Injected so tests never touch the network; defaults are the real resolvers. */
  const dnsTxt = resolveTxt || ((host) => require('node:dns/promises').resolveTxt(host));
  const dnsLookup = lookup || ((host) => require('node:dns/promises').lookup(host, { all: true }));

  /**
   * The token a company must publish.
   *
   * Derived, not stored: an HMAC over the account id and domain. That means it
   * can be shown again on any support call without a lookup, it cannot drift
   * from the row, and rotating the secret invalidates every outstanding
   * challenge at once. It is scoped to the domain so a token proved for one
   * domain cannot be replayed on another.
   */
  function verificationToken(corporateId, domain) {
    const id = requireId(corporateId, 'corporateId');
    const host = String(domain).toLowerCase();
    const mac = crypto.createHmac('sha256', String(verificationSecret))
      .update(`corporate:${id}:${host}`)
      .digest('hex')
      .slice(0, 32);
    return `sml-verification=${mac}`;
  }

  function tokenMatches(expected, candidate) {
    if (typeof candidate !== 'string') return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate.trim());
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /* ------------------------------------------------------------- register */

  async function register(input = {}) {
    const wpUserId = requireId(input.wpUserId, 'wpUserId');
    const companyName = requireText(input.companyName, 'companyName', 200);
    const brandHandle = requireText(input.brandHandle, 'brandHandle', 40).toLowerCase();
    if (!HANDLE_RE.test(brandHandle)) {
      throw invalid('brandHandle must be 2-39 lowercase letters, digits, hyphen or underscore');
    }
    const websiteUrl = requireText(input.websiteUrl, 'websiteUrl', 2048);
    const domain = normalizeDomain(websiteUrl);

    const category = input.category == null ? 'other' : String(input.category);
    if (!CATEGORIES.includes(category)) {
      throw invalid(`category must be one of ${CATEGORIES.join(', ')}`);
    }

    const result = await pool.query(
      `INSERT INTO corporate_accounts
         (wp_user_id, company_name, brand_handle, website_url, logo_url, description,
          category, status, verified_domain)
       VALUES ($1, $2, $3, $4, $5, $6, $7::corporate_category, 'pending', $8)
       RETURNING id`,
      [
        wpUserId, companyName, brandHandle, websiteUrl,
        input.logoUrl == null ? null : String(input.logoUrl).slice(0, 2048),
        input.description == null ? null : String(input.description).slice(0, 2000),
        category,
        /* Recorded at registration as the domain we will DEMAND proof of.
         * verified_at stays null, so migration 017's CHECK still bars
         * activation. Deriving it here means an operator can never later point
         * a verified badge at a domain nobody proved. */
        domain
      ]
    );

    const id = Number(result.rows[0].id);
    logger('info', 'corporate_registered', { corporateId: id, domain });
    return { corporateId: id, domain, token: verificationToken(id, domain) };
  }

  /* --------------------------------------------------------------- verify */

  async function loadAccount(corporateId) {
    const id = requireId(corporateId, 'corporateId');
    const found = await pool.query(
      `SELECT id, status, verified_domain, verified_at FROM corporate_accounts WHERE id = $1`,
      [id]
    );
    if (!found.rows[0]) throw invalid('unknown corporate account');
    return found.rows[0];
  }

  /** DNS TXT at the apex. The stronger of the two proofs — no HTTP involved. */
  async function checkDns(domain, expected) {
    let records;
    try {
      records = await dnsTxt(domain);
    } catch (error) {
      return { ok: false, reason: `dns lookup failed: ${error.code || error.message}` };
    }
    /* resolveTxt returns arrays of string chunks per record; a long value is
     * split at 255 bytes by the protocol, so join before comparing. */
    for (const record of records || []) {
      const value = Array.isArray(record) ? record.join('') : String(record);
      if (tokenMatches(expected, value)) return { ok: true, method: 'dns_txt' };
    }
    return { ok: false, reason: 'no matching TXT record' };
  }

  /** HTTPS file fallback. Every line below is an SSRF mitigation. */
  async function checkWellKnown(domain, expected) {
    /* Resolve first and check the ADDRESSES, not the name. A hostile domain can
     * point its A record at 169.254.169.254 and borrow our cloud credentials. */
    let addresses;
    try {
      addresses = await dnsLookup(domain);
    } catch (error) {
      return { ok: false, reason: `dns lookup failed: ${error.code || error.message}` };
    }
    const list = Array.isArray(addresses) ? addresses : [addresses];
    if (!list.length) return { ok: false, reason: 'domain does not resolve' };
    for (const entry of list) {
      const addr = typeof entry === 'string' ? entry : entry.address;
      if (!isPublicAddress(addr)) {
        logger('warn', 'corporate_verify_blocked_address', { domain });
        return { ok: false, reason: 'domain resolves to a non-public address' };
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(`https://${domain}${WELL_KNOWN_PATH}`, {
        /* Do NOT follow redirects. A 302 to an internal address defeats the
         * address check above, which was performed on the original host only. */
        redirect: 'error',
        signal: controller.signal,
        headers: { Accept: 'text/plain' }
      });
    } catch (error) {
      return { ok: false, reason: `fetch failed: ${error.name === 'AbortError' ? 'timeout' : error.message}` };
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };

    const body = await response.text();
    if (body.length > MAX_VERIFICATION_BYTES) {
      return { ok: false, reason: 'verification file is too large' };
    }
    /* First non-empty line only: trailing newlines and editor cruft are normal
     * and should not fail an otherwise correct proof. */
    const first = body.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
    if (tokenMatches(expected, first)) return { ok: true, method: 'well_known' };
    return { ok: false, reason: 'verification file does not contain the token' };
  }

  /**
   * Prove ownership of the registered domain.
   *
   * DNS first because it is the stronger proof and costs no HTTP. The file
   * fallback exists because plenty of corporate comms teams can put a file on a
   * web server far faster than they can get a DNS change approved.
   */
  async function verifyDomain(corporateId, options = {}) {
    const account = await loadAccount(corporateId);
    if (!account.verified_domain) throw invalid('account has no domain to verify');
    if (account.verified_at) {
      return { verified: true, method: account.verified_method, alreadyVerified: true };
    }

    const domain = account.verified_domain;
    const expected = verificationToken(account.id, domain);

    const dns = await checkDns(domain, expected);
    let outcome = dns;
    if (!dns.ok && options.allowWellKnown !== false) {
      outcome = await checkWellKnown(domain, expected);
      if (!outcome.ok) outcome.reason = `${dns.reason}; ${outcome.reason}`;
    }

    if (!outcome.ok) {
      logger('info', 'corporate_verify_failed', { corporateId: account.id, reason: outcome.reason });
      return { verified: false, reason: outcome.reason };
    }

    await pool.query(
      `UPDATE corporate_accounts
          SET verified_at = to_timestamp($2 / 1000.0), verified_method = $3
        WHERE id = $1 AND verified_at IS NULL`,
      [account.id, now(), outcome.method]
    );
    logger('info', 'corporate_verified', { corporateId: account.id, method: outcome.method });
    return { verified: true, method: outcome.method };
  }

  /* ------------------------------------------------------------- activate */

  /**
   * Turn the badge on.
   *
   * Requires BOTH a proven domain and a settled onboarding fee. The database
   * enforces the first; this enforces the second, and does it by reading the
   * billing row rather than trusting a caller-supplied flag.
   */
  async function activate(corporateId) {
    const id = requireId(corporateId, 'corporateId');
    const found = await pool.query(
      `SELECT a.status, a.verified_at, b.onboarding_paid_at
         FROM corporate_accounts a
         LEFT JOIN corporate_billing b
           ON b.corporate_id = a.id AND b.cycle_end > now()
        WHERE a.id = $1
        ORDER BY b.cycle_start DESC
        LIMIT 1`,
      [id]
    );
    const row = found.rows[0];
    if (!row) throw invalid('unknown corporate account');
    if (row.status === 'active') return { activated: false, reason: 'already active' };
    if (!row.verified_at) throw invalid('domain is not verified');
    if (!row.onboarding_paid_at) throw invalid('onboarding fee is not paid');

    await pool.query(
      `UPDATE corporate_accounts
          SET status = 'active', activated_at = to_timestamp($2 / 1000.0),
              suspended_at = NULL, suspended_reason = NULL
        WHERE id = $1`,
      [id, now()]
    );
    logger('info', 'corporate_activated', { corporateId: id });
    return { activated: true };
  }

  /** Suspend. Never delete: the ledger is the record of what was sold. */
  async function suspend(corporateId, reason) {
    const id = requireId(corporateId, 'corporateId');
    const why = requireText(reason, 'reason', 500);
    await pool.query(
      `UPDATE corporate_accounts
          SET status = 'suspended', suspended_at = to_timestamp($2 / 1000.0), suspended_reason = $3
        WHERE id = $1 AND status <> 'closed'`,
      [id, now(), why]
    );
    logger('warn', 'corporate_suspended', { corporateId: id, reason: why });
    return { suspended: true };
  }

  /**
   * What WordPress is told.
   *
   * Active accounts only. Anything absent from this list must behave exactly
   * like "not a corporate account" on the other side — no badge, no boost, no
   * slot — so suspension is one flag flip and a failed sync costs an impression
   * rather than giving placement away.
   */
  async function projection() {
    const found = await pool.query(
      `SELECT wp_user_id, brand_handle, company_name, category
         FROM corporate_accounts
        WHERE status = 'active'
        ORDER BY id ASC`
    );
    return found.rows.map((r) => ({
      wpUserId: Number(r.wp_user_id),
      handle: r.brand_handle,
      name: r.company_name,
      category: r.category,
      badge: 'corporate',
      active: true
    }));
  }

  return {
    register,
    verifyDomain,
    activate,
    suspend,
    projection,
    verificationToken
  };
}

module.exports = {
  createCorporateAccountService,
  normalizeDomain,
  isPublicAddress,
  CATEGORIES,
  WELL_KNOWN_PATH,
  MAX_VERIFICATION_BYTES
};
