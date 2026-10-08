import { gainPercent } from './milestonePolicy.js';

export function marketParts(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid market timestamp.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

// The broad-market sessions are independent of whether this particular stock
// traded. A halted stock must not earn extra days because its bars are missing.
export function selectTrackingWindow({ alertTimestamp, sessions, bars, now = new Date(), tradingDayLimit = 5 }) {
  const alertMs = Date.parse(alertTimestamp);
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(alertMs) || alertMs > nowMs) throw new Error('Alert time is invalid or in the future.');
  if (Number(tradingDayLimit) !== 5) throw new Error('Spotlight milestone tracking requires five trading days.');
  if (!sessions?.requestId || sessions.complete !== true || !Array.isArray(sessions.dates) || !sessions.dates.length) {
    throw new Error('Trading-session calendar is unavailable or incomplete.');
  }
  const alert = marketParts(alertTimestamp);
  const dates = [...new Set(sessions.dates)].filter((day) => day > alert.date || (day === alert.date && alert.time < '20:00')).sort();
  const allowedTradingDates = dates.slice(0, 5);
  if (!allowedTradingDates.length) throw new Error('No trading session after the alert has been verified yet.');
  const eligibleBars = (bars || []).filter((bar) => {
    if (!(bar.timestamp >= alertMs && bar.timestamp <= nowMs) || !(bar.high > 0) || !(bar.close > 0)) return false;
    const part = marketParts(bar.timestamp);
    return allowedTradingDates.includes(part.date) && part.time >= '04:00' && part.time < '20:00';
  }).sort((a, b) => a.timestamp - b.timestamp);
  const current = marketParts(now);
  const fifth = allowedTradingDates[4];
  return {
    eligibleBars, allowedTradingDates, windowStart: alertTimestamp,
    windowLastTradingDate: fifth || null,
    complete: Boolean(fifth && (current.date > fifth || (current.date === fifth && current.time >= '20:00'))),
    calendarSource: 'massive-SPY-daily-aggregates', calendarRequestId: sessions.requestId,
  };
}

export function verifyArticleEligibility(facts, { type = 'milestone', milestoneGainPercent = null } = {}) {
  const errors = [];
  const window = facts.trackingWindow;
  const highMs = Date.parse(facts.verifiedHighAt);
  const alertMs = Date.parse(facts.alertTimestamp);
  const through = Date.parse(facts.marketDataThrough);
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(facts.symbol || '')) errors.push('invalid ticker');
  if (!/^\d{15,24}$/.test(facts.discordMessageId || '')) errors.push('missing original Discord alert ID');
  if (!Number.isFinite(Number(facts.entryPrice)) || !Number.isFinite(Number(facts.verifiedHigh)) || !(Number(facts.entryPrice) > 0) || !(Number(facts.verifiedHigh) > 0)) errors.push('invalid entry or high');
  if (!Number.isFinite(alertMs) || !Number.isFinite(highMs) || !Number.isFinite(through) || highMs < alertMs || highMs > through || highMs > Date.now()) errors.push('invalid post-alert high timestamp');
  if (!facts.massiveRequestId || facts.massiveAdjusted !== true) errors.push('missing verified adjusted market data');
  if (!window?.calendarRequestId || !Array.isArray(window?.allowedTradingDates) || !window.allowedTradingDates.length || window.allowedTradingDates.length > 5) errors.push('missing five-session eligibility window');
  if (Number.isFinite(highMs) && !window?.allowedTradingDates?.includes(marketParts(highMs).date)) errors.push('high falls outside the five-trading-day window');
  if (Number.isFinite(highMs) && (marketParts(highMs).time < '04:00' || marketParts(highMs).time >= '20:00')) errors.push('high is outside supported trading hours');
  const gain = gainPercent(facts.entryPrice, facts.verifiedHigh);
  if (!Number.isFinite(gain) || !Number.isFinite(Number(facts.verifiedGainPercent)) || Math.abs(gain - Number(facts.verifiedGainPercent)) > 0.000001) errors.push('gain calculation disagrees with verified prices');
  const milestone = Number(milestoneGainPercent ?? facts.milestoneGainPercent);
  if (type === 'milestone' && (!(milestone > 0) || gain + 1e-9 < milestone)) errors.push('configured milestone has not been reached');
  if (type === 'eod' && !(Number(facts.priorPublishedPostId) > 0)) errors.push('recap has no prior published milestone');
  if (facts.priceDiscrepancy || facts.unresolvedPriceDiscrepancies?.length) errors.push('unresolved material price discrepancy');
  return {
    status: errors.length ? 'review_required' : 'eligible', reason: errors.join('; '),
    tradingDayLimit: 5, type, milestoneGainPercent: type === 'milestone' ? milestone : null,
    allowedTradingDates: window?.allowedTradingDates || [], windowStart: facts.alertTimestamp,
    windowLastTradingDate: window?.windowLastTradingDate || null,
    calendarSource: window?.calendarSource || '', calendarRequestId: window?.calendarRequestId || '',
  };
}

export function articleCalculations(facts) {
  const entry = Number(facts.entryPrice), high = Number(facts.verifiedHigh);
  if (!(entry > 0) || !(high > 0)) throw new Error('Cannot calculate article values without positive verified prices.');
  return {
    gainPercent: gainPercent(entry, high), hypotheticalPrincipal: 1000,
    hypotheticalValue: 1000 * high / entry, hypotheticalProfit: 1000 * high / entry - 1000,
    priceMultiple: high / entry,
  };
}
