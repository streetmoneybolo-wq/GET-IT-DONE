'use strict';

/* EDITIONS: the Academy comes in two editions a member picks for themselves.
 *   TRADER   the chart, the desks, the alerts, the rooms they follow: everything that reads the market
 *   ANALYST  the Trader edition plus the publishing side: their own profile page with a trading room they run, Click-to-Alert
 *            posted to their server, the Alert Chart seller tools, their own Discord bot for the alerts (their name and picture,
 *            or the StockMarketLoop Connect bot when they have none), and, once their stockmarketloop.com account is linked, the
 *            Article Desk and the automatic Loop Letters writer filing under their own byline
 * The choice lives in academy_state_kv under academy-editions; the capability read (summary) folds in what the site link, the
 * persona bot, the seller status and the letters publisher say, so one call tells the page what to show and what is left to do. */

const SNOWFLAKE = /^\d{15,25}$/;
const EDITIONS = {
  trader: { key: 'trader', label: 'Trader', blurb: 'The chart, the desks, the alerts and the rooms you follow. Everything that reads the market.' },
  analyst: { key: 'analyst', label: 'Analyst', blurb: 'Trader plus the publishing side: your profile page with your own trading room, Click-to-Alert into your server, the Alert Chart seller tools, your own bot for the alerts, and the Article Desk and Loop Letters once your stockmarketloop.com account is linked.',
    includes: ['Profile page with your own trading room', 'Click-to-Alert into your Discord server', 'Alert Chart: premium channels sold through stockmarketloop.com', 'Your own Discord bot carries the alerts (or the StockMarketLoop Connect bot)', 'Article Desk and the automatic Loop Letters writer under your byline (site account linked)'] }
};

function createEditions({ store = null, now = Date.now, logger = () => {} } = {}) {
  let state = null;
  async function load() {
    if (state) return state;
    try { state = (store && await store.read()) || null; } catch (_) { state = null; }
    if (!state || typeof state !== 'object' || !state.users || typeof state.users !== 'object') state = { users: {} };
    return state;
  }
  async function save() { if (store) { try { await store.write(state); } catch (error) { logger('warn', 'editions_save_failed', { error: String(error && error.message || error) }); } } }

  async function get(userId) {
    userId = String(userId || ''); if (!SNOWFLAKE.test(userId)) return 'trader';
    await load();
    const row = state.users[userId];
    return row && EDITIONS[row.edition] ? row.edition : 'trader';
  }
  async function set(userId, edition) {
    userId = String(userId || ''); if (!SNOWFLAKE.test(userId)) return { ok: false, status: 400, code: 'invalid_user' };
    edition = String(edition || '').toLowerCase();
    if (!EDITIONS[edition]) return { ok: false, status: 400, code: 'invalid_edition' };
    await load();
    state.users[userId] = { edition, at: now() };
    await save();
    return { ok: true, edition };
  }

  /* what the page shows: the edition, and for the Analyst side each requirement with whether it is met and what to do next.
     seller: alertChartBilling.sellerStatus(me) | null; persona: personaBots.status(me) | null; letters: { configured } | null */
  async function summary(userId, { seller = null, persona = null, letters = null, owner = false, tier = '' } = {}) {
    const edition = await get(userId);
    const linked = !!(seller && seller.linked);
    const lettersReady = !!(letters && letters.configured);
    const botOwn = !!(persona && persona.available);
    const steps = [
      { key: 'site', label: 'Link your stockmarketloop.com account', done: linked, detail: linked ? 'Linked.' : 'Needed for the Alert Chart seller tools, the Article Desk and Loop Letters.', url: seller && seller.connectUrl ? seller.connectUrl : '' },
      { key: 'bot', label: 'Your own Discord bot for the alerts', done: botOwn, detail: botOwn ? 'Alerts into your server go out as ' + (persona.bot && persona.bot.username ? persona.bot.username : 'your bot') + '.' : 'Optional. Without one, the StockMarketLoop Connect bot posts your alerts, and it must be in your server with permission to post and attach files.', optional: true },
      { key: 'seller', label: 'Alert Chart seller setup', done: !!(seller && seller.ready), detail: !seller ? 'Not available on this server.' : seller.ready ? 'Ready to sell premium channels.' : !linked ? 'Link your site account first.' : !seller.consented ? 'Accept the seller terms in the Alert Chart.' : 'Finish the Stripe onboarding in the Alert Chart.', optional: true },
      { key: 'letters', label: 'Article Desk and Loop Letters', done: linked && lettersReady, detail: !lettersReady ? 'The letters publisher is not configured on this server.' : linked ? 'The ARTICLE button writes and files letters under your byline.' : 'Link your site account and open your Loop Letters once; the ARTICLE button then appears.', optional: true }
    ];
    const features = {
      room: true, clickAlert: true, alertChartSeller: !!(seller && seller.configured), persona: !!(persona && persona.configured),
      article: owner || (edition === 'analyst' && linked && lettersReady), letters: owner || (edition === 'analyst' && linked && lettersReady)
    };
    return { ok: true, edition, editions: EDITIONS, tier, owner: !!owner, analyst: { linked, connectUrl: seller && seller.connectUrl ? seller.connectUrl : '', bot: persona, seller: seller ? { configured: !!seller.configured, linked, consented: !!seller.consented, stripe: seller.stripe || null, ready: !!seller.ready } : null, letters: { configured: lettersReady }, steps, features } };
  }

  return { get, set, summary, load };
}

module.exports = { createEditions, EDITIONS };
