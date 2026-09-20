// Universal, ticker-agnostic alert-to-article protocol.  This module is
// deliberately independent of a particular analyst, symbol, or past story.
export const UNIVERSAL_ALERT_PROTOCOL_VERSION = 'universal-alert-v1';

export const ARTICLE_THRESHOLDS = Object.freeze([
  [1000, 'major-feature'], [500, 'breaking-news'], [250, 'full-article'],
  [100, 'short-article'], [50, 'discord-recap'], [25, 'internal-recap'], [0, 'save-only'],
]);

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clean = (value, max = 12000) => String(value ?? '').trim().slice(0, max);
const iso = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function articleTierForGain(gainPercent) {
  const gain = number(gainPercent);
  if (gain == null) return { gainPercent: null, tier: 'save-only', action: 'save', reason: 'No verified gain is available yet.' };
  const [, tier] = ARTICLE_THRESHOLDS.find(([minimum]) => gain >= minimum);
  return { gainPercent: gain, tier, action: ['save-only', 'internal-recap', 'discord-recap'].includes(tier) ? 'monitor' : 'draft', reason: `Verified alert-to-high gain is ${gain.toFixed(2)}%.` };
}

export function classifyArticleType(record) {
  const special = record.specialTriggers || {};
  if (special.membershipDeadline) return 'membership-community';
  if (special.streak) return 'alert-streak';
  if (special.backstory) return 'backstory';
  if (special.companyCatalyst || special.halt) return 'catalyst';
  return 'single-alert';
}

export function buildUniversalAlertRecord(input = {}) {
  const entryPrice = number(input.entryPrice);
  const highestPrice = number(input.highestPriceAfterAlert ?? input.verifiedHigh);
  const gain = entryPrice && highestPrice ? ((highestPrice - entryPrice) / entryPrice) * 100 : null;
  const alertDatetime = iso(input.alertDatetimeCT ?? input.alertTimestamp);
  const highDatetime = iso(input.highestPriceDatetimeCT ?? input.verifiedHighAt);
  const verified = input.verificationStatus || (entryPrice && highestPrice && alertDatetime && highDatetime ? 'verified' : 'needs_review');
  const tier = articleTierForGain(gain);
  const status = verified === 'verified' ? verified : 'needs_review';
  const alert = {
    protocolVersion: UNIVERSAL_ALERT_PROTOCOL_VERSION,
    alert_id: clean(input.alertId ?? input.alert_id ?? input.discordMessageId, 64),
    ticker: clean(input.ticker ?? input.symbol).toUpperCase(),
    company_name: clean(input.companyName ?? input.company_name, 500),
    exchange: clean(input.exchange, 80),
    alert_type: clean(input.alertType ?? input.alert_type ?? 'equity-alert', 80),
    analyst: clean(input.analyst, 200),
    alert_source: clean(input.alertSource ?? input.alert_source ?? 'Discord', 200),
    alert_channel: clean(input.alertChannel ?? input.alert_channel ?? input.discordChannelId, 64),
    alert_datetime_ct: alertDatetime,
    entry_price: entryPrice,
    target_price: number(input.targetPrice ?? input.target_price),
    stop_loss: number(input.stopLoss ?? input.stop_loss),
    alert_text: clean(input.alertText ?? input.alert_text),
    alert_image_url: clean(input.alertImageUrl ?? input.alert_image_url, 2048) || null,
    highest_price_after_alert: highestPrice,
    highest_price_datetime_ct: highDatetime,
    latest_price_checked: number(input.latestPrice ?? input.latest_price_checked),
    gain_percent: gain,
    hypothetical_1000_value: entryPrice && highestPrice ? 1000 * highestPrice / entryPrice : null,
    time_to_high: alertDatetime && highDatetime ? Math.max(0, Date.parse(highDatetime) - Date.parse(alertDatetime)) : null,
    company_catalyst: clean(input.companyCatalyst ?? input.company_catalyst, 4000) || null,
    risk_flags: Array.isArray(input.riskFlags ?? input.risk_flags) ? (input.riskFlags ?? input.risk_flags).map((x) => clean(x, 300)).filter(Boolean) : [],
    verification_status: status,
    article_angle: clean(input.articleAngle ?? input.article_angle) || null,
    related_alerts: Array.isArray(input.relatedAlerts ?? input.related_alerts) ? input.relatedAlerts : [],
    membership_context: clean(input.membershipContext ?? input.membership_context, 4000) || null,
    article_type: classifyArticleType(input),
    trigger: tier,
  };
  if (!alert.ticker || !entryPrice || !alertDatetime) alert.verification_status = 'needs_review';
  return alert;
}

export function scoreArticleReadiness({ record, article = {}, visualReady = false, sources = [] } = {}) {
  const fixes = [];
  const verified = record?.verification_status === 'verified';
  const numbers = verified && number(record.entry_price) && number(record.highest_price_after_alert) && number(record.gain_percent) != null;
  const sourceScore = sources.filter((source) => source?.verified === true).length >= 2 ? 20 : (sources.some((source) => source?.verified === true) ? 10 : 0);
  const newsScore = clean(article.title).length >= 35 && clean(article.metaDescription).length >= 120 ? 20 : 8;
  const visualScore = visualReady && record?.alert_image_url ? 20 : 0;
  const performanceScore = numbers ? 20 : 0;
  const conversionScore = clean(record?.membership_context).length ? 10 : 0;
  const complianceScore = verified && !/guaranteed|risk[- ]free|caused the (?:move|rally|squeeze)/i.test(JSON.stringify(article)) ? 10 : 0;
  if (sourceScore < 20) fixes.push('Add at least two verified company or market sources.');
  if (newsScore < 20) fixes.push('Complete a descriptive headline and 120–160 character meta description.');
  if (visualScore < 20) fixes.push('Attach the original alert screenshot or a clearly labeled rendered source record.');
  if (performanceScore < 20) fixes.push('Verify entry, post-alert high, timestamps, and gain before making performance claims.');
  if (conversionScore < 10) fixes.push('Add transparent membership context only if it is relevant.');
  if (complianceScore < 10) fixes.push('Remove unsupported guarantees or causal claims and add the risk disclosure.');
  const score = sourceScore + newsScore + visualScore + performanceScore + conversionScore + complianceScore;
  return { score, fixes, disposition: score >= 90 ? 'draft_ready_for_human_review' : score >= 80 ? 'needs_editorial_improvements' : 'hold_for_review', autoPublish: false };
}
