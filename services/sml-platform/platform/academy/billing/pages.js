'use strict';

/* =============================================================================
 * MEM Academy billing: server-rendered pages and the consent disclosure.
 *
 * Every value is HTML-escaped. Pages are no-store, no-referrer, framed by
 * nobody, with a strict CSP (a per-response nonce for the one inline style and
 * the success page's status poll).
 *
 * The disclosure shown next to each package is rendered from ONE versioned
 * template (SML_ACADEMY_BILLING_CONSENT_VERSION). Its exact text is hashed:
 *   consent_sha256 = sha256(version + "\n" + text)
 * and stored on the checkout intent and in the Stripe metadata as proof of the
 * auto-renewal consent (California ARL). There are no earnings or performance
 * claims anywhere on these pages.
 *
 * A price that accepts a bank debit (us_bank_account, lifetime only) shows
 * BANK_PAYMENT_NOTE on its card, OUTSIDE the hashed disclosure (so adding the
 * method never changes an approved consent text): bank payments take a few
 * business days to clear and access starts when the payment clears.
 *
 * The disclosure names what the offer grants: the Academy Student role with
 * the paid Making Easy Money Discord access every Academy package includes,
 * the price's external roles by name (Monarch on Lifetime) and the optional
 * lifetime role only when it is configured. A membership (academy:false)
 * names its role(s) and says it does not include MEM Academy.
 *
 * FREE TRIALS AND AUTO-STOP are part of the hashed text: a price with a free
 * trial the member can still use says so ("7-day free trial, then ..."; one
 * free trial per Discord account), a trial that stops before any charge is a
 * 'free_trial' consent that says it is never charged, and a price with
 * "cancelAfterDays" says how many charges it can make at most. A member who
 * already used their free trial is sold the same price without one: the card
 * says so outside the hashed text, and the hashed text has no trial. A
 * free-only offer (Free Trial Access) is the exception: it is only ever a
 * free trial, so that member is not offered it at all (FREE_TRIAL_USED_NOTE).
 * ========================================================================== */

const crypto = require('node:crypto');
const { LABELS, intervalPhrase, formatAmount, isRecurring, cancelAfterFor, maxCharges } = require('./catalog');
const assets = require('./assets');

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const LIFETIME_DEFINITION = 'MEM Lifetime lasts for as long as MEM Academy operates. It belongs to one Discord account and cannot be transferred.';

/* Shown wherever a bank debit (ACH) can be chosen or is in flight. */
const BANK_PAYMENT_NOTE = 'Bank payments (ACH) take a few business days to clear. Your access starts when the payment clears.';
const LIFETIME_SUSPENDED_TEXT = 'A payment on this account is disputed or under review (for a bank payment, this can be a bank return or an authorization inquiry), so your MEM Lifetime access is paused. It comes back if the dispute closes in your favor. Contact support with any questions.';
const MICRODEPOSIT_NOTE ='If Stripe emails you to verify your bank account with a small deposit, follow that email first.';
const METHOD_NAMES = Object.freeze({ card: 'card', link: 'Link', us_bank_account: 'US bank account' });

/** Plain text for a package that accepts a bank debit; '' otherwise. */
function paymentMethodNote(desc) {
  const methods = desc && Array.isArray(desc.paymentMethods) ? desc.paymentMethods : [];
  if (!methods.includes('us_bank_account')) return '';
  const names = methods.map((method) => METHOD_NAMES[method] || method);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
  const instant = methods.some((method) => method === 'card' || method === 'link') ? ' Card payments are confirmed right away.' : '';
  return `You can pay by ${list}. ${BANK_PAYMENT_NOTE}${instant}`;
}

function listPhrase(items) {
  const list = (items || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

/**
 * The supersede sentence of a lifetime disclosure. After a paid lifetime the
 * engine sets every renewing plan the lifetime fully covers to cancel at the
 * end of its paid period (resync.js enforceBillingRules): an Academy plan
 * when the lifetime grants the Academy, and a membership plan whose roles
 * are all among the lifetime's roles. roleNames come from the price's
 * configured "roles" only, never from a fixed list: the Academy Lifetime
 * (Monarch only) names Monarch and covers no Elite plan, while Elite
 * Lifetime Access (Monarch + Elite) names both and covers the Elite plans.
 */
function supersedeSentence({ academy, roleNames, subject }) {
  const names = (roleNames || []).filter(Boolean);
  const roles = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : (names[0] || '');
  const membership = roles ? `a membership plan that gives no role other than the ${roles} role` : '';
  let plans;
  if (academy) plans = membership ? `an Academy plan, or ${membership}, that renews` : 'an Academy plan that renews';
  else plans = membership ? `${membership} and renews` : 'a plan for the same role that renews';
  return `If you have ${plans}, buying ${subject} sets that plan to cancel at the end of its current paid period. That period is not refunded.`;
}

/* "$89.90/month", "$300.00 every 3 months" (the /buy trial line). */
function perInterval(pkg, price) {
  const every = intervalPhrase(pkg);
  return /^\d/.test(every) ? `${price} every ${every}` : `${price}/${every}`;
}

const TRIAL_ONCE = 'one free trial per Discord account';
const TRIAL_USED_NOTE = 'This Discord account already used its free trial, so this plan starts with a charge today.';
/* The free-trial history could not be read (Stripe busy): a trial price is
   not sold until it can (checkout.js answers 503 for it). */
const TRIAL_UNKNOWN_NOTE = 'We could not check this Discord account\'s free trial right now. Reload this page in a minute to buy this plan.';
/* A free-only offer (Free Trial Access) is only ever a free trial: an account
   whose trial is used is never sold it as a paid plan (owner decision
   2026-09-26: it never charges). checkout.js refuses it too. */
const FREE_TRIAL_USED_NOTE = 'This Discord account already used its free trial. This offer is only a free trial, so it is not available again.';

/**
 * The trial and auto-stop terms one member is offered for one price:
 *   trialDays        the free trial offered (null: none, or already used)
 *   trialNoCard      that trial needs no payment method
 *   cancelAfterDays  the auto-stop (a daily price defaults to 3)
 *   trialUsed        the price has a trial this account can no longer use
 *   trialOnly        a free-only offer: the price's own trial covers its
 *                    auto-stop (Free Trial Access). It is sold ONLY with that
 *                    trial, never as a paid plan (trialOnly and no trialDays:
 *                    not for sale to this account)
 *   charges          the most charges it can make (null: renews until
 *                    cancelled; 0: a free trial that is never charged)
 */
function offerTerms(desc, { trialUsed = false } = {}) {
  const pkg = desc && desc.key ? desc.key : (desc && desc.pkg) || '';
  const own = desc && Number.isInteger(desc.trialDays) ? desc.trialDays : null;
  const trialDays = own !== null && !trialUsed && isRecurring(pkg) ? own : null;
  const cancelAfterDays = desc && desc.cancelAfterDays !== undefined ? desc.cancelAfterDays : cancelAfterFor(pkg, null);
  const trialOnly = own !== null && isRecurring(pkg) && maxCharges({ pkg, trialDays: own, cancelAfterDays }) === 0;
  return {
    trialDays,
    trialNoCard: trialDays !== null && Boolean(desc.trialNoCard),
    cancelAfterDays: Number.isInteger(cancelAfterDays) ? cancelAfterDays : null,
    trialUsed: own !== null && Boolean(trialUsed),
    trialOnly,
    charges: isRecurring(pkg) ? maxCharges({ pkg, trialDays, cancelAfterDays }) : null,
    /* a win-back price: the first month's amount (null: none) and the
       Academy days it adds (membership win-back only) */
    introCents: desc && desc.winback && Number.isInteger(desc.introCents) && isRecurring(pkg) ? desc.introCents : null,
    bonusAcademyDays: desc && desc.winback && Number.isInteger(desc.bonusAcademyDays) ? desc.bonusAcademyDays : null,
    winback: Boolean(desc && desc.winback)
  };
}

const WINBACK_ONCE = 'This welcome-back price is only for former Making Easy Money monthly members and can be used once per Discord account.';

/**
 * A win-back price (config.js "winback"): optional first-month amount, then
 * the price's own amount every period until cancelled, with the optional
 * bonus Academy days on a membership.
 */
function winbackDisclosure({ pkg, price, intro, name, gives, academy, terms, links }) {
  const every = intervalPhrase(pkg);
  const bonus = terms.bonusAcademyDays
    ? ` It also includes ${plural(terms.bonusAcademyDays, 'day')} of MEM Academy (the Academy Student role) from the day it starts, at no extra charge; those days end by themselves.`
    : '';
  const lead = intro !== null
    ? `Intro price, then automatic renewal: ${name} costs ${intro} (plus any applicable tax) for the first ${every}, then ${price} (plus any applicable tax) every ${every}, and renews automatically at ${price} until you cancel.`
    : `Automatic renewal: ${name} costs ${price} (plus any applicable tax) and renews automatically every ${every} at ${price} until you cancel.`;
  return {
    kind: 'auto_renewal',
    checkbox: intro !== null
      ? `I agree that after the first ${every} at ${intro}, ${name} renews automatically every ${every} at ${price} until I cancel.`
      : `I agree that ${name} renews automatically every ${every} at ${price} until I cancel.`,
    text: [
      lead,
      WINBACK_ONCE,
      `While it is active it gives this Discord account ${gives}.${academy ? '' : ' It does not include MEM Academy except for any bonus days named here.'}${bonus}`,
      `You can cancel online at any time in Manage billing. Access continues until the end of the period you already paid for${academy ? '; an open Academy Activity can take up to about 15 minutes to update' : ''}.`,
      `Payments are not refunded except where the ${academy ? 'MEM Academy ' : ''}Terms or the law require it. A refunded or charged-back payment ends the access it paid for.`,
      links
    ].join(' ')
  };
}

/** The /buy line for a trial offer, '' when none. */
function trialLine(pkg, amount, currency, terms) {
  if (!terms || terms.trialDays === null) return '';
  if (terms.charges === 0) {
    return `${plural(terms.cancelAfterDays, 'day')} free${terms.trialNoCard ? ', no card needed' : ''}, stops by itself`;
  }
  const then = perInterval(pkg, formatAmount(amount, currency));
  return `${terms.trialDays}-day free trial${terms.trialNoCard ? ' (no card needed)' : ''}, then ${then}; ${TRIAL_ONCE}`;
}

/** The auto-stop sentence of a recurring disclosure ('' when none). */
function capSentence({ subject, amount, currency, terms }) {
  const n = terms.charges;
  if (n === null || n === undefined || n === 0) return '';
  const total = formatAmount(amount * n, currency);
  if (terms.trialDays !== null) return ` After the free trial ${subject} is charged at most ${plural(n, 'time')} (${total} in total) and then ends by itself.`;
  if (n === 1) return ` ${subject[0].toUpperCase()}${subject.slice(1)} is charged once and ends by itself after ${plural(terms.cancelAfterDays, 'day')}.`;
  return ` ${subject[0].toUpperCase()}${subject.slice(1)} renews at most ${plural(n - 1, 'time')} (${n} charges in total, ${total}) and then ends by itself.`;
}

/** The trial sentences of a recurring disclosure. */
function trialSentences(terms) {
  if (terms.trialDays === null) return [];
  return [
    terms.trialNoCard
      ? 'No payment method is needed for the trial. If you do not add one before the trial ends, it ends by itself and nothing is charged.'
      : 'Cancel before the trial ends and you are not charged.',
    'One free trial per Discord account.'
  ];
}

/* What every Academy package includes (owner decision 2026-09-26): the
   Academy AND the same length of paid Making Easy Money Discord access, both
   carried by the Academy Student role. */
const ACADEMY_ROLE_PHRASE = 'the Academy Student role (MEM Academy and paid access to the Making Easy Money Discord server)';

/**
 * The exact consent text for one offer at one price.
 * grants (from the catalog offer; defaults = the Academy line with the
 * optional lifetime role configured):
 *   academy      the offer grants the Academy Student role (Academy line)
 *   lifetimeRole a lifetime offer also grants the optional MEM Lifetime role
 *   roleNames    display names of the offer's external roles (e.g. Monarch)
 *   label        a membership offer's name (its Stripe product name)
 * terms (offerTerms(): the trial this member is offered and the auto-stop;
 * default = no trial, and a daily price stops after 3 charges).
 */
function disclosureFor({ pkg, amount, currency = 'usd', termsUrl, privacyUrl, grants = {}, terms = null }) {
  const price = formatAmount(amount, currency);
  const academy = grants.academy !== false;
  const roleNames = Array.isArray(grants.roleNames) ? grants.roleNames.filter(Boolean) : [];
  const roleList = roleNames.map((name) => `the ${name} role`);
  const links = `Terms: ${termsUrl} Privacy: ${privacyUrl}`;
  const t = terms || offerTerms({ key: pkg });
  if (t.winback && isRecurring(pkg)) {
    const intro = t.introCents !== null ? formatAmount(t.introCents, currency) : null;
    const gives = academy
      ? listPhrase([ACADEMY_ROLE_PHRASE, ...roleList])
      : `${listPhrase(roleList) || 'its membership role'} in the Making Easy Money Discord server`;
    const name = grants.label ? `the ${grants.label} plan` : (academy ? 'the MEM Academy plan' : 'the membership');
    return winbackDisclosure({ pkg, price, intro, name, gives, academy, terms: t, links });
  }
  if (!academy) return membershipDisclosure({ pkg, price, amount, currency, label: grants.label || listPhrase(roleNames), roleList, roleNames, links, terms: t });
  const label = LABELS[pkg] || pkg;
  if (!isRecurring(pkg)) {
    const granted = [ACADEMY_ROLE_PHRASE, ...roleList, ...(grants.lifetimeRole === false ? [] : ['the MEM Lifetime role'])];
    return {
      kind: 'final_sale',
      checkbox: 'I understand MEM Lifetime is a one-time final sale as described above.',
      text: [
        `One-time payment: ${label} costs ${price} (plus any applicable tax), charged once, with no renewal.`,
        `It gives this Discord account ${listPhrase(granted)}.`,
        LIFETIME_DEFINITION,
        'It is a final sale except where the MEM Academy Terms or the law require a refund. A refund or a lost chargeback removes it.',
        supersedeSentence({ academy: true, roleNames, subject: 'Lifetime' }),
        links
      ].join(' ')
    };
  }
  const every = intervalPhrase(pkg);
  /* "Day plan" / "Week plan" already say plan: never "Day plan plan" */
  const plan = /\bplan$/i.test(label) ? label : `${label} plan`;
  const gives = listPhrase([ACADEMY_ROLE_PHRASE, ...roleList]);
  if (t.charges === 0) return freeTrialDisclosure({ name: `the MEM Academy ${plan}`, short: `${plan}`, gives, terms: t, links, academy: true });
  const cap = capSentence({ subject: `the ${plan}`, amount, currency, terms: t });
  if (t.trialDays !== null) {
    return {
      kind: 'auto_renewal',
      checkbox: `I agree that after the ${t.trialDays}-day free trial my ${plan} renews automatically every ${every} at ${price} until I cancel.`,
      text: [
        `Free trial, then automatic renewal: the MEM Academy ${plan} starts with a ${t.trialDays}-day free trial. When the trial ends it costs ${price} (plus any applicable tax) and renews automatically every ${every} at ${price} until you cancel.${cap}`,
        ...trialSentences(t),
        `While the plan is active, the trial included, it gives this Discord account ${gives}.`,
        'You can cancel online at any time in Manage billing. Access continues until the end of the trial or of the period you already paid for; an open Academy Activity can take up to about 15 minutes to update.',
        'Payments are not refunded except where the MEM Academy Terms or the law require it. A refunded or charged-back payment ends the access it paid for.',
        links
      ].join(' ')
    };
  }
  return {
    kind: 'auto_renewal',
    checkbox: `I agree that my ${plan} renews automatically every ${every} at ${price} until I cancel.`,
    text: [
      `Automatic renewal: the MEM Academy ${plan} costs ${price} (plus any applicable tax) and renews automatically every ${every} at ${price} until you cancel.${cap}`,
      `While the plan is active it gives this Discord account ${gives}.`,
      'You can cancel online at any time in Manage billing. Access continues until the end of the period you already paid for; an open Academy Activity can take up to about 15 minutes to update.',
      'Payments are not refunded except where the MEM Academy Terms or the law require it. A refunded or charged-back payment ends the access it paid for.',
      links
    ].join(' ')
  };
}

/**
 * A free trial that stops by itself before any charge (charges 0: the
 * auto-stop does not come after the trial; the engine ends it 10 minutes
 * before the trial end, resync.js). Nothing renews and nothing is charged.
 */
function freeTrialDisclosure({ name, short, gives, terms, links, academy }) {
  const days = plural(terms.cancelAfterDays, 'day');
  return {
    kind: 'free_trial',
    checkbox: `I understand ${short} is a ${terms.cancelAfterDays}-day free trial that ends by itself and is never charged.`,
    text: [
      `Free trial: ${name} is free for ${days}${terms.trialNoCard ? ' and needs no payment method' : ''}. It ends by itself after ${days}, does not renew and is never charged.`,
      'One free trial per Discord account.',
      `While it is active it gives this Discord account ${gives}.${academy ? '' : ' It does not include MEM Academy.'}`,
      links
    ].join(' ')
  };
}

/** A pure membership (academy:false): its roles only, never the Academy. */
function membershipDisclosure({ pkg, price, amount, currency, label, roleList, roleNames = [], links, terms }) {
  const name = label || 'membership';
  const roles = listPhrase(roleList) || 'its membership role';
  const t = terms || offerTerms({ key: pkg });
  if (!isRecurring(pkg)) {
    return {
      kind: 'final_sale',
      checkbox: `I understand ${name} is a one-time final sale as described above.`,
      text: [
        `One-time payment: ${name} costs ${price} (plus any applicable tax), charged once, with no renewal.`,
        `It gives this Discord account ${roles} in the Making Easy Money Discord server for as long as Making Easy Money operates the server. It belongs to one Discord account and cannot be transferred. It does not include MEM Academy.`,
        'It is a final sale except where the Terms or the law require a refund. A refund or a lost chargeback removes it.',
        supersedeSentence({ academy: false, roleNames, subject: 'this' }),
        links
      ].join(' ')
    };
  }
  const every = intervalPhrase(pkg);
  const gives = `${roles} in the Making Easy Money Discord server`;
  if (t.charges === 0) return freeTrialDisclosure({ name, short: name, gives, terms: t, links, academy: false });
  const cap = capSentence({ subject: 'it', amount, currency, terms: t });
  if (t.trialDays !== null) {
    return {
      kind: 'auto_renewal',
      checkbox: `I agree that after the ${t.trialDays}-day free trial my ${name} membership renews automatically every ${every} at ${price} until I cancel.`,
      text: [
        `Free trial, then automatic renewal: the ${name} membership starts with a ${t.trialDays}-day free trial. When the trial ends it costs ${price} (plus any applicable tax) and renews automatically every ${every} at ${price} until you cancel.${cap}`,
        ...trialSentences(t),
        `While it is active, the trial included, it gives this Discord account ${gives}. It does not include MEM Academy.`,
        'You can cancel online at any time in Manage billing. Access continues until the end of the trial or of the period you already paid for.',
        'Payments are not refunded except where the Terms or the law require it. A refunded or charged-back payment ends the access it paid for.',
        links
      ].join(' ')
    };
  }
  return {
    kind: 'auto_renewal',
    checkbox: `I agree that my ${name} membership renews automatically every ${every} at ${price} until I cancel.`,
    text: [
      `Automatic renewal: the ${name} membership costs ${price} (plus any applicable tax) and renews automatically every ${every} at ${price} until you cancel.${cap}`,
      `While it is active it gives this Discord account ${roles} in the Making Easy Money Discord server. It does not include MEM Academy.`,
      'You can cancel online at any time in Manage billing. Access continues until the end of the period you already paid for.',
      'Payments are not refunded except where the Terms or the law require it. A refunded or charged-back payment ends the access it paid for.',
      links
    ].join(' ')
  };
}

function consentSha(version, text) {
  return crypto.createHash('sha256').update(`${String(version)}\n${String(text)}`).digest('hex');
}

function newNonce() { return crypto.randomBytes(16).toString('base64'); }

function securityHeaders(nonce) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'content-security-policy': [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      "img-src 'self' data:",
      "media-src 'self'",
      "form-action 'self' https://checkout.stripe.com https://billing.stripe.com https://discord.com",
      "base-uri 'none'",
      "frame-ancestors 'none'"
    ].join('; ')
  };
}

/* The Making Easy Money look: black and deep green, neon-green glow, gold for the crown, the bull/bear banner as a backdrop.
   The hero (logo, tagline, looping clip and GrandMaster-OBI) tops the store pages; every legal text and control below keeps
   its markup, only the styling changed. */
const STYLE = `
:root{--bg:#04070b;--panel:#0a1219;--panel2:#0d1a12;--line:#173324;--text:#e9f3ec;--muted:#93a99b;--green:#00e35c;--neon:#39ff14;--gold:#f2c94c;--red:#ff2d3a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg) radial-gradient(1200px 500px at 50% -10%,rgba(0,227,92,.16),transparent 60%);color:var(--text);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:880px;margin:0 auto;padding:0 16px 56px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:0}
.hero{position:relative;overflow:hidden;margin:0 -16px 18px;min-height:250px;background:#000 url(${assets.assetUrl('banner-bull-bear.webp')}) center/cover no-repeat;border-bottom:1px solid var(--line)}
.hero video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}
.hero .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,40,16,.45) 0%,rgba(4,7,11,.6) 55%,var(--bg) 100%)}
.hero .inner{position:relative;z-index:1;display:flex;align-items:flex-end;gap:12px;max-width:880px;margin:0 auto;padding:36px 16px 18px;min-height:250px}
.hero .txt{flex:1;min-width:0}
.hero .crown{width:72px;height:72px;object-fit:contain;filter:drop-shadow(0 0 14px rgba(242,201,76,.55))}
.hero h1{font-size:clamp(1.6rem,5.2vw,2.6rem);line-height:1.05;letter-spacing:.02em;text-transform:uppercase;font-weight:900;margin:6px 0 4px;text-shadow:0 0 18px rgba(57,255,20,.45),0 2px 0 #000}
.hero h1 b{color:var(--neon)}
.hero .tag{margin:0;color:#d6ead9;font-weight:600;font-style:italic;font-size:.95rem;text-shadow:0 1px 0 #000}
.hero .obi{width:150px;max-height:230px;object-fit:contain;object-position:bottom;filter:drop-shadow(0 0 16px rgba(57,255,20,.35));margin-right:-6px}
.hero .sound{position:absolute;right:14px;top:12px;z-index:2;background:rgba(0,0,0,.55);border:1px solid var(--line);color:#fff;border-radius:999px;padding:7px 12px;font-size:.8rem;font-weight:700;cursor:pointer}
.hero .sound.on{border-color:var(--neon);color:var(--neon)}
.who{display:flex;align-items:center;gap:8px}.who img{width:30px;height:30px;border-radius:50%;border:1px solid var(--line);background:#000}
.muted{color:var(--muted);font-size:.9rem}
.card{position:relative;border:1px solid var(--line);border-radius:14px;padding:18px;margin:16px 0;background:linear-gradient(180deg,#0c1810,var(--panel));box-shadow:0 0 0 1px rgba(0,227,92,.06),0 10px 30px rgba(0,0,0,.45)}
.card h2{font-size:1.2rem;font-weight:800;letter-spacing:.01em}
.card:has(>.ribbon){border-color:rgba(242,201,76,.55);background:linear-gradient(180deg,#141708,#0d1a12);box-shadow:0 0 0 1px rgba(242,201,76,.15),0 0 34px rgba(0,227,92,.12)}
.ribbon{position:absolute;top:-11px;left:16px;background:var(--gold);color:#1a1400;font-size:.66rem;font-weight:900;letter-spacing:.12em;padding:3px 9px;border-radius:999px}
.thanks{position:relative;margin:14px auto 18px;max-width:420px;border-radius:16px;overflow:hidden;border:1px solid rgba(242,201,76,.45);box-shadow:0 0 40px rgba(0,227,92,.2);background:#000}.thanks video{display:block;width:100%;max-height:520px;object-fit:contain;cursor:pointer}.thanks .sound{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);background:rgba(0,0,0,.65);border:1px solid var(--neon);color:#fff;border-radius:999px;padding:9px 16px;font-size:.85rem;font-weight:800;cursor:pointer}
.showcase{display:block;width:100%;max-width:520px;margin:18px auto 6px;border-radius:16px;border:1px solid var(--line);box-shadow:0 0 40px rgba(0,227,92,.18)}
.perks{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;padding:0;list-style:none}.perks li{font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#bff5cf;background:rgba(0,0,0,.5);border:1px solid var(--line);border-radius:999px;padding:4px 9px}
.price{font-size:1.7rem;font-weight:900;margin:6px 0;color:var(--neon);text-shadow:0 0 14px rgba(57,255,20,.35)}
.disclosure{font-size:.85rem;color:#c9d9cf;background:#071009;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:10px 0}
label{display:flex;gap:8px;align-items:flex-start;font-size:.9rem;margin:8px 0}input[type=checkbox]{margin-top:4px;accent-color:var(--green)}
button,.button{display:inline-block;background:linear-gradient(180deg,#22ff77,#00b84a);color:#03140a;border:0;border-radius:10px;padding:12px 18px;font-weight:900;letter-spacing:.02em;text-decoration:none;cursor:pointer;box-shadow:0 0 18px rgba(0,227,92,.35)}
button:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}
.button.secondary{background:#132019;color:#e9f3ec;box-shadow:none;border:1px solid var(--line)}
.notice{border-left:3px solid var(--gold);padding:8px 12px;background:#161408;margin:12px 0;border-radius:0 8px 8px 0}
a{color:#7fe3a9}
.foot{display:flex;align-items:center;gap:10px;margin-top:26px;padding-top:14px;border-top:1px solid var(--line)}.foot img{height:34px}
@media(max-width:600px){.hero .obi{display:none}.hero .inner{padding-top:28px;min-height:220px}.hero .crown{width:56px;height:56px}main{padding-bottom:40px}}
`;

const TAGLINE = 'Discipline protects the dream. Consistency builds the freedom.';

/* The branded top of the store: the ME crown, the name, the tagline, the looping clip behind them (muted; it is decoration) and
   GrandMaster-OBI. A "Music on" button appears only when assets/store-music.mp3 exists, because browsers only play sound after
   a tap. Pages that are plain messages (errors, thank-you) show a slimmer version without the clip. */
function hero({ full = true } = {}) {
  const audio = full && assets.hasAsset('store-music.mp3');
  return `<header class="hero">
${full && assets.hasAsset('academy-hero.mp4') ? `<video autoplay muted loop playsinline preload="metadata" poster="${assets.assetUrl('academy-hero-poster.webp')}" aria-hidden="true"><source src="${assets.assetUrl('academy-hero.mp4')}" type="video/mp4">${assets.hasAsset('academy-hero.webm') ? `<source src="${assets.assetUrl('academy-hero.webm')}" type="video/webm">` : ''}</video>` : ''}
<div class="shade"></div>
${audio ? `<button type="button" class="sound" id="sound" aria-pressed="false">🎵 Music on</button><audio id="intro" preload="none" loop src="${assets.assetUrl('store-music.mp3')}"></audio>` : ''}
<div class="inner"><div class="txt"><img class="crown" src="${assets.assetUrl('me-crown.webp')}" alt="Making Easy Money"><h1>Making Easy Money <b>Academy</b></h1><p class="tag">${esc(TAGLINE)}</p><ul class="perks"><li>Academy</li><li>Trading tools</li><li>Discord membership</li></ul></div>
${full ? `<img class="obi" src="${assets.assetUrl('grandmaster-obi.webp')}" alt="GrandMaster-OBI">` : ''}</div></header>`;
}

const SOUND_SCRIPT = "(function(){var b=document.getElementById('sound'),a=document.getElementById('intro');if(!b||!a)return;a.volume=0.6;var on=false;b.addEventListener('click',function(){if(!on){a.play().then(function(){on=true;b.className='sound on';b.textContent='🔇 Music off';b.setAttribute('aria-pressed','true');}).catch(function(){});}else{a.pause();on=false;b.className='sound';b.textContent='🎵 Music on';b.setAttribute('aria-pressed','false');}});})();";

/* After a purchase: the owner's thank-you clip, full width, starts by itself without sound (browsers allow that) and a tap on it
   or on the button turns the sound on and plays it from the top. */
const THANKS_SCRIPT = "(function(){var v=document.getElementById('thanks-clip'),b=document.getElementById('thanks-sound');if(!v||!b||typeof v.play!=='function'||typeof b.addEventListener!=='function')return;function on(){v.muted=false;v.currentTime=0;v.play().then(function(){b.hidden=true;}).catch(function(){});}b.addEventListener('click',on);v.addEventListener('click',function(){if(v.muted)on();});v.addEventListener('ended',function(){if(!v.muted)return;b.hidden=false;});})();";
function thanksClip() {
  if (!assets.hasAsset('thank-you.mp4')) return '';
  return `<div class="thanks"><video id="thanks-clip" autoplay muted playsinline preload="auto" poster="${assets.assetUrl('thank-you-poster.webp')}"><source src="${assets.assetUrl('thank-you.mp4')}" type="video/mp4">${assets.hasAsset('thank-you.webm') ? `<source src="${assets.assetUrl('thank-you.webm')}" type="video/webm">` : ''}</video><button type="button" id="thanks-sound" class="sound">🔊 Play with sound</button></div>`;
}

function layout({ title, body, nonce, script = '', brand = 'full' }) {
  const top = brand === 'none' ? '' : hero({ full: brand === 'full' });
  const scripts = [brand === 'full' && assets.hasAsset('store-music.mp3') ? SOUND_SCRIPT : '', script].filter(Boolean).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><link rel="icon" href="${assets.assetUrl('grandmaster-obi-chibi.gif')}"><style nonce="${esc(nonce)}">${STYLE}</style></head>
<body><main>${top}${body}</main>${scripts ? `<script nonce="${esc(nonce)}">${scripts}</script>` : ''}</body></html>`;
}

function footerLinks(config) {
  return `<p class="muted foot"><img src="${assets.assetUrl('banner-bull-bear.webp')}" alt=""><span><a href="${esc(config.termsUrl)}" rel="noreferrer">Academy Terms</a> &middot; <a href="${esc(config.privacyUrl)}" rel="noreferrer">Privacy</a></span></p>`;
}

function whoLine(user, userId) {
  const name = user && (user.globalName || user.username) ? `@${user.username || user.globalName}` : `Discord user ${userId}`;
  return `<p class="muted who"><img src="${assets.assetUrl('grandmaster-obi-chibi.gif')}" alt=""><span>Buying for ${esc(name)}. Not you? <a href="/v1/academy/billing/start">Sign in again</a>.</span></p>`;
}

/** The grants an offer's consent text names (see disclosureFor). */
function offerGrants(desc) {
  return {
    academy: desc.academy !== false,
    lifetimeRole: desc.lifetimeRole !== undefined ? Boolean(desc.lifetimeRole) : true,
    roleNames: Array.isArray(desc.roleNames) ? desc.roleNames : [],
    label: desc.label || null
  };
}

function packageCard({ pkg, desc, config, csrf, disabled, trialUsed = false, trialUnknown = false }) {
  const grants = offerGrants(desc);
  const terms = offerTerms(desc, { trialUsed: trialUsed || trialUnknown });
  const unknown = Boolean(trialUnknown) && terms.trialUsed;
  if (unknown) disabled = true;
  const d = disclosureFor({ pkg, amount: desc.amount, currency: desc.currency, termsUrl: config.termsUrl, privacyUrl: config.privacyUrl, grants, terms });
  const sha = consentSha(config.consentVersion, d.text);
  const every = isRecurring(pkg) ? ` / ${intervalPhrase(pkg)}` : ' once';
  const field = isRecurring(pkg) ? 'consent_renewal' : 'consent_final';
  const title = grants.academy ? (LABELS[pkg] || pkg) : (desc.label || pkg);
  /* A free-only offer whose trial this account can no longer use (or whose
     trial history could not be read) is not for sale: no form at all. */
  if (terms.trialOnly && terms.trialDays === null) {
    return `<section class="card"><h2>${esc(title)}</h2>
<div class="price">Free</div>
<p class="muted">${esc(unknown ? TRIAL_UNKNOWN_NOTE : FREE_TRIAL_USED_NOTE)}</p></section>`;
  }
  const priceText = terms.charges === 0 ? 'Free' : `${formatAmount(desc.amount, desc.currency)}${every}`;
  let trial = trialLine(pkg, desc.amount, desc.currency, terms);
  if (terms.introCents !== null) {
    trial = `${formatAmount(terms.introCents, desc.currency)} for your first ${intervalPhrase(pkg)}, then ${perInterval(pkg, formatAmount(desc.amount, desc.currency))}`
      + `${terms.bonusAcademyDays ? `, plus ${plural(terms.bonusAcademyDays, 'day')} of MEM Academy free` : ''}`;
  }
  return `<section class="card">${pkg === 'lifetime' && grants.academy ? '<span class="ribbon">ONE PAYMENT · LIFETIME</span>' : ''}<h2>${esc(title)}</h2>
<div class="price">${esc(priceText)}</div>
${trial ? `<p class="notice">${esc(trial)}</p>` : ''}
${terms.trialUsed ? `<p class="muted">${esc(unknown ? TRIAL_UNKNOWN_NOTE : TRIAL_USED_NOTE)}</p>` : ''}
${pkg === 'lifetime' && grants.academy ? `<p class="muted">${esc(LIFETIME_DEFINITION)}</p>` : ''}
${paymentMethodNote(desc) ? `<p class="notice">${esc(paymentMethodNote(desc))}</p>` : ''}
<form method="post" action="/v1/academy/billing/checkout">
<input type="hidden" name="package" value="${esc(pkg)}"><input type="hidden" name="csrf" value="${esc(csrf)}">
${desc.priceId ? `<input type="hidden" name="price" value="${esc(desc.priceId)}">` : ''}
<input type="hidden" name="disclosure_sha" value="${esc(sha)}">
<p class="disclosure">${esc(d.text)}</p>
<label><input type="checkbox" name="${field}" value="1" required> <span>${esc(d.checkbox)}</span></label>
<button type="submit"${disabled ? ' disabled' : ''}>Continue to secure checkout</button>
</form></section>`;
}

/* Invite (and the optional "add me" join) for a buyer who is not in the
   Making Easy Money server. Used on /buy when ALLOW_NON_MEMBER=1 and on the
   success / pending page. */
const AWAITING_TEXT = 'Payment received. Your roles are waiting for you: join the Making Easy Money Discord server and they are added automatically.';
/* A checkout that started a free trial charged nothing: never "Payment received". */
const TRIAL_STARTED = 'Your free trial has started.';
const TRIAL_AWAITING_TEXT = AWAITING_TEXT.replace('Payment received.', TRIAL_STARTED);

function joinLinks(config, pkg = '') {
  const invite = config.inviteUrl
    ? `<a class="button" href="${esc(config.inviteUrl)}" rel="noreferrer">Join the Making Easy Money server</a>`
    : '';
  const join = config.autoJoin
    ? ` <a class="button secondary" href="/v1/academy/billing/start?purpose=join${pkg ? `&amp;package=${esc(pkg)}` : ''}">Add me to the server with Discord</a>`
    : '';
  if (!invite && !join) return '<p>Ask a staff member for an invite to the Making Easy Money server.</p>';
  return `<p>${invite}${join}</p>${config.autoJoin ? '<p class="muted">"Add me" asks Discord for permission to add you to the Making Easy Money server. Nothing else is done with it.</p>' : ''}`;
}

function joinCard({ config, pkg = '', inGuild = false, id = '', hidden = false, paid = false }) {
  const lead = inGuild === false
    ? (paid ? 'You are not in the Making Easy Money Discord server yet. Your roles are added as soon as you join.'
      : 'You are not in the Making Easy Money Discord server yet. You can pay now: your roles are added as soon as you join the server.')
    : 'Not in the Making Easy Money Discord server yet? Your roles are added as soon as you join.';
  return `<section class="card"${id ? ` id="${esc(id)}"` : ''}${hidden ? ' hidden' : ''}><h2>Join the server to receive your roles</h2><p>${esc(lead)}</p>
${joinLinks(config, pkg)}</section>`;
}

function buyPage({ config, nonce, userId, user, packages, memberships = [], winback = [], csrf, state, notice = '', inGuild = true, pkg = '' }) {
  const parts = [whoLine(user, userId)];
  if (notice) parts.push(`<p class="notice">${esc(notice)}</p>`);
  /* Only reached for a non-member with SML_ACADEMY_BILLING_ALLOW_NON_MEMBER=1. */
  if (inGuild === false) parts.push(joinCard({ config, pkg, inGuild: false }));
  if (state.lifetime && state.lifetimeSuspended) {
    parts.push(`<section class="card"><h2>MEM Lifetime: paused while a payment dispute is open</h2><p>${esc(LIFETIME_SUSPENDED_TEXT)}</p></section>`);
    if (state.entitled) parts.push('<section class="card"><h2>Access active</h2><p>Your other Academy access stays active. Open the Academy in Discord.</p></section>');
  } else if (state.lifetime) {
    parts.push('<section class="card"><h2>Access active: MEM Lifetime</h2><p>Your Academy access does not need a plan. Open the Academy in Discord.</p></section>');
  } else if (state.lifetimePending) {
    parts.push(`<section class="card"><h2>MEM Lifetime: bank payment processing</h2><p>${esc(`Your bank payment for MEM Lifetime is processing. ${BANK_PAYMENT_NOTE} You do not need to pay again.`)}</p>
<p class="muted">${esc(MICRODEPOSIT_NOTE)}</p></section>`);
    if (state.entitled) parts.push('<section class="card"><h2>Access active</h2><p>Your current Academy access stays active in the meantime. Open the Academy in Discord.</p></section>');
  } else if (state.recurring && state.entitled) {
    parts.push(`<section class="card"><h2>Access active</h2><p>You already have an Academy plan. Change or cancel it in Manage billing.</p>
<p><a class="button secondary" href="/v1/academy/billing/start?purpose=manage">Manage billing</a></p></section>`);
  } else if (state.recurring) {
    parts.push(`<section class="card"><h2>Your plan needs attention</h2><p>You have an Academy plan that does not give access right now, for example after a failed renewal, a refund or a payment dispute, and it may still renew. Update or cancel it in Manage billing before buying another plan, or contact support.</p>
<p><a class="button secondary" href="/v1/academy/billing/start?purpose=manage">Manage billing</a></p></section>`);
  } else if (state.entitled) {
    parts.push('<section class="card"><h2>Access active</h2><p>Your Academy access is active. Open the Academy in Discord.</p></section>');
  }
  /* WELCOME BACK: the win-back prices, only for a listed former member who
     never used one (checkout.js checks the same), with the same per-line
     guard as the other offers. */
  if (winback.length && state.winbackEligible && !state.lifetimePending) {
    const blocking = new Set(state.blockingLines || []);
    const cards = winback.filter((desc) => !blocking.has(desc.line) && !(desc.academy && state.lifetime))
      .map((desc) => packageCard({ pkg: desc.key, desc, config, csrf, disabled: !config.checkoutEnabled }));
    if (cards.length) {
      parts.push('<h2>Welcome back</h2><p class="muted">A thank-you for former Making Easy Money monthly members. Pick one; it can be used once per Discord account.</p>', ...cards);
    }
  }
  /* Nothing is sold while a lifetime bank payment clears (checkout.js refuses
     it too), so a second debit is never started next to the first. */
  const offered = packages.filter((p) => !state.lifetime && !state.lifetimePending && (!state.recurring || p.key === 'lifetime'));
  if (!offered.length && !state.entitled && !state.lifetime && !state.lifetimePending) parts.push('<p class="notice">No Academy plans are on sale right now.</p>');
  const trialUsed = Boolean(state.trialUsed);
  const trialUnknown = Boolean(state.trialUnknown);
  for (const desc of offered) parts.push(packageCard({ pkg: desc.key, desc, config, csrf, disabled: !config.checkoutEnabled, trialUsed, trialUnknown }));

  /* Pure memberships (academy:false): one line per role set, the same guard
     per line as checkout.js. */
  if (memberships.length) {
    const blocking = new Set(state.blockingLines || []);
    const owned = new Set((state.ownedExternal || []).map(String));
    const cards = [];
    const noted = new Set();
    for (const desc of memberships) {
      if ((desc.roles || []).every((roleId) => owned.has(String(roleId)))) {
        if (!noted.has(desc.line)) { noted.add(desc.line); cards.push(`<section class="card"><h2>${esc(desc.label)}: active</h2><p>This membership is already on this Discord account.</p></section>`); }
        continue;
      }
      if (state.lifetimePending) continue;
      if (isRecurring(desc.key) && blocking.has(desc.line)) {
        if (!noted.has(desc.line)) {
          noted.add(desc.line);
          cards.push(`<section class="card"><h2>${esc(desc.label)}: you already have this plan</h2><p>Change or cancel it in Manage billing.</p>
<p><a class="button secondary" href="/v1/academy/billing/start?purpose=manage">Manage billing</a></p></section>`);
        }
        continue;
      }
      cards.push(packageCard({ pkg: desc.key, desc, config, csrf, disabled: !config.checkoutEnabled, trialUsed, trialUnknown }));
    }
    if (cards.length) parts.push('<h2>Memberships (without MEM Academy)</h2>', ...cards);
  }
  parts.push('<p class="muted">Payments are processed by Stripe. Stripe emails your receipt. You can cancel a plan online at any time.</p>');
  parts.push(footerLinks(config));
  return layout({ title: 'MEM Academy plans', body: parts.join('\n'), nonce });
}

function nonMemberPage({ config, nonce, userId, user, pkg = '' }) {
  return layout({ title: 'Join the server first', nonce, body: `<h1>Join the server first</h1>${whoLine(user, userId)}
<p>Academy access is a role in the Making Easy Money Discord server, so you need to be a member before you pay.</p>
${joinLinks(config, pkg)}
<p><a class="button secondary" href="/v1/academy/billing/buy?package=${esc(pkg)}">I have joined, continue</a></p>${footerLinks(config)}` });
}

function signInPage({ config, nonce, pkg = '', purpose = 'buy' }) {
  const href = `/v1/academy/billing/start?purpose=${encodeURIComponent(purpose)}${pkg ? `&package=${encodeURIComponent(pkg)}` : ''}`;
  return layout({ title: 'Sign in with Discord', nonce, body: `<h2>Lifetime access to the Academy, the trading tools and the Making Easy Money Discord</h2>
<p>Sign in with Discord so your purchase is attached to the right account.</p>
<p><a class="button" href="${esc(href)}">Sign in with Discord</a></p>
<img class="showcase" src="${assets.assetUrl('academy-poster.webp')}" alt="Making Easy Money Academy: learn, practice, strategize, execute, grow">${footerLinks(config)}` });
}

function messagePage({ config, nonce, title, text, links = [] }) {
  const actions = links.map((link) => `<a class="button secondary" href="${esc(link.href)}">${esc(link.label)}</a>`).join(' ');
  return layout({ title, nonce, brand: 'slim', body: `<h1>${esc(title)}</h1><p>${esc(text)}</p>${actions ? `<p>${actions}</p>` : ''}${footerLinks(config)}` });
}

const FAILED_TEXT = 'Your bank payment did not go through, so no access was granted. You can start a new purchase from the plans page.';
const PROCESSING_TEXT = `Your payment is processing. ${BANK_PAYMENT_NOTE} You can close this page.`;

/* The poll script is plain ES5 and reads its session id from a data
   attribute, so nothing user-controlled is ever interpolated into script
   (the fixed texts are embedded with JSON.stringify). A bank payment
   (data-delayed) is polled slowly: it clears in days, not seconds. While a
   role waits for a buyer who is not in the server (awaitingMember) the join
   card is shown; the status call re-checks the membership about once a
   minute, so the role lands soon after they join. */
const POLL_SCRIPT = [
  "(function(){var el=document.getElementById('status');if(!el)return;",
  "var sid=el.getAttribute('data-session');var delayed=el.getAttribute('data-delayed')==='1';var tries=0;var max=delayed?40:120;",
  `var trial=el.getAttribute('data-trial')==='1';var pre=trial?${JSON.stringify(`${TRIAL_STARTED} `)}:'Payment received. ';`,
  `var AW=trial?${JSON.stringify(TRIAL_AWAITING_TEXT)}:${JSON.stringify(AWAITING_TEXT)};`,
  "function show(t){el.textContent=t;}",
  "function join(){var c=document.getElementById('join');if(c)c.hidden=false;}",
  /* a bank payment is only for Lifetime: an older plan's role is not its access */
  "function mine(j){return j&&j.entitled&&j.roles&&j.roles.length&&(!delayed||j.lifetime===true);}",
  "function poll(){tries++;fetch('/v1/academy/billing/status?session_id='+encodeURIComponent(sid),{credentials:'same-origin'})",
  ".then(function(r){return r.json();}).then(function(j){",
  "if(j&&j.awaitingMember)join();",
  `if(j&&j.intent==='failed'&&!j.lifetimePending){show(${JSON.stringify(FAILED_TEXT)});return;}`,
  `if(j&&j.lifetimePending){show(${JSON.stringify(PROCESSING_TEXT)});}`,
  "else if(mine(j)&&j.roles.every(function(x){return x.state==='synced';})){show('Access active. Open the Academy in Discord.');return;}",
  "else if(mine(j)&&j.awaitingMember){show(AW);}",
  "else if(mine(j)){show(pre+'Adding your Discord role...');}",
  "if(tries<max)setTimeout(poll,delayed?15000:(tries<30?2000:5000));",
  "else if(mine(j)&&j.awaitingMember)show(AW);",
  "else if(mine(j)&&!j.lifetimePending)show(pre+'Your role can take a few minutes; you can close this page.');",
  `else show(delayed||(j&&j.lifetimePending)?${JSON.stringify(PROCESSING_TEXT)}:'Your payment is still processing. Your role is added when it clears; you can close this page.');`,
  "}).catch(function(){if(tries<max)setTimeout(poll,delayed?15000:5000);});}",
  "poll();})();"
].join('');

/**
 * inGuild: true (a member), false (not in the server) or null (unknown).
 * Anyone not known to be in the server sees the invite (and the "add me"
 * join when AUTO_JOIN=1) on the success and pending page; for a member the
 * card stays hidden and the poll reveals it if a role starts waiting.
 */
function successPage({ config, nonce, sessionId, paid, processing = false, failed = false, lifetimeWithPlan = false, inGuild = null, trial = false }) {
  let lead = 'Your payment is processing. This page updates by itself.';
  if (paid && trial) lead = inGuild === false ? TRIAL_AWAITING_TEXT : `${TRIAL_STARTED} Adding your Discord role...`;
  else if (paid) lead = inGuild === false ? AWAITING_TEXT : 'Payment received. Adding your Discord role...';
  else if (failed) lead = FAILED_TEXT;
  else if (processing) lead = PROCESSING_TEXT;
  const extra = processing && !paid && !failed ? `<p class="muted">${esc(MICRODEPOSIT_NOTE)}</p>` : '';
  const note = lifetimeWithPlan
    ? '<p class="notice">Your renewing plan has been set to cancel at the end of its current paid period, because Lifetime replaces it.</p>'
    : '';
  const heading = failed && !paid ? 'Payment not completed' : 'Thank you';
  const after = failed && !paid
    ? '<p><a class="button secondary" href="/v1/academy/billing/buy">Back to plans</a></p>'
    : '<p class="muted">Stripe emails your receipt. Manage or cancel a plan any time at <a href="/v1/academy/billing/start?purpose=manage">Manage billing</a>.</p>';
  const joinBlock = failed && !paid ? '' : joinCard({ config, inGuild, id: 'join', hidden: inGuild === true, paid: true });
  const clip = paid && !failed ? thanksClip() : '';
  return layout({ title: 'MEM Academy: thank you', nonce, brand: 'slim', script: clip ? `${THANKS_SCRIPT}\n${POLL_SCRIPT}` : POLL_SCRIPT, body: `<h1>${esc(heading)}</h1>${clip}
<p id="status" data-session="${esc(sessionId)}"${processing && !paid ? ' data-delayed="1"' : ''}${paid && trial ? ' data-trial="1"' : ''}>${esc(lead)}</p>${extra}${note}
${joinBlock}
${after}${footerLinks(config)}` });
}

module.exports = {
  esc,
  disclosureFor,
  consentSha,
  newNonce,
  securityHeaders,
  layout,
  buyPage,
  nonMemberPage,
  signInPage,
  messagePage,
  successPage,
  paymentMethodNote,
  offerGrants,
  offerTerms,
  trialLine,
  TRIAL_USED_NOTE,
  TRIAL_UNKNOWN_NOTE,
  FREE_TRIAL_USED_NOTE,
  joinCard,
  LIFETIME_DEFINITION,
  BANK_PAYMENT_NOTE,
  AWAITING_TEXT,
  WINBACK_ONCE
};
