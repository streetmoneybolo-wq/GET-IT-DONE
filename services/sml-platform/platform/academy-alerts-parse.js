'use strict';

/* Parses the trader's Discord alert messages into structured alerts.
 * Ported from the share bot's alertParser so the Academy reads an alert exactly as the rest of the site does:
 *   "@everyone GDC entry $2 pt 2.33 plus"      -> equity, entry 2, target 2.33, "plus" = the target is a minimum
 *   "@everyone NEXR entry 33cents pt 38cents"   -> cents are converted to dollars
 *   "@everyone CCXI entry 14,40 pt 16 plus"     -> a decimal comma is accepted
 *   "@everyone ZEO entry 34cents pt 55cents plus high risk" -> the author's own risk flag is kept
 *   "@everyone SPY calls 590 1/16"              -> options: symbol, call/put, strike, expiry (month/day, year inferred)
 * Educational: nothing here places a trade. */

const RISK_WORDS = /\b(high[- ]?risk|very risky|risky|lotto|yolo|gamble|small size|small position)\b/i;

function marketDate(timestamp, timeZone = 'America/New_York') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function isoDate(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function resolveOptionExpiration(text, timestamp, timeZone = 'America/New_York') {
  const alertDate = marketDate(timestamp, timeZone);
  if (/\bdaily\b/i.test(text)) return { expiration: isoDate(alertDate.year, alertDate.month, alertDate.day), source: 'daily' };
  const match = String(text).match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/(\d{2}|\d{4}))?\b/);
  if (!match) return { expiration: null, source: 'missing' };
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year;
  if (match[3]) year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  else {
    year = alertDate.year;
    const candidate = isoDate(year, month, day);
    const alertIso = isoDate(alertDate.year, alertDate.month, alertDate.day);
    if (candidate && candidate < alertIso) year += 1;
  }
  const expiration = isoDate(year, month, day);
  return expiration ? { expiration, source: match[3] ? 'explicit-date' : 'inferred-year' } : { expiration: null, source: 'invalid-date' };
}

function parseAlertMessage(content, timestamp = new Date().toISOString(), timeZone = 'America/New_York') {
  // the trader posts alerts in Discord bold ("@everyone **$TXG entry $87 pt $120 plus  **"): drop the formatting marks so the ticker still starts a word
  const text = String(content || '').replace(/[*_~`|]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const normalized = text
    .replace(/\b(\d+(?:\.\d+)?)\s*cents?\b/gi, (_, cents) => String(Number(cents) / 100))
    .replace(/(\d),(\d{1,4})(?=\s|$)/g, '$1.$2');
  const price = String.raw`\d+(?:\.\d+)?`;
  const riskFlag = RISK_WORDS.test(text);
  const option = normalized.match(new RegExp(String.raw`(?:^|\s)\$?([A-Z]{1,6})\s+(CALLS?|PUTS?)\s+\$?(${price})(?=\s|$)`, 'i'));
  if (option) {
    const expiry = resolveOptionExpiration(text, timestamp, timeZone);
    return {
      kind: 'option', symbol: option[1].toUpperCase(), contractType: option[2].toUpperCase().startsWith('CALL') ? 'CALL' : 'PUT', strike: Number(option[3]),
      expiration: expiry.expiration, expirationSource: expiry.source, needsReview: !expiry.expiration, riskFlag, raw: text
    };
  }
  const entryWord = String.raw`(?:entry|entnry|entery|enrty|etry)`;
  const equity = normalized.match(new RegExp(String.raw`(?:^|\s)\$?([A-Z]{1,6})\s+${entryWord}\s+\$?(${price})\s+(?:pt|target)\s+\$?(${price})(?:\s*(plus|\+|plyus|pls))?`, 'i'));
  if (equity) {
    const entryPrice = Number(equity[2]);
    const targetPrice = Number(equity[3]);
    if (!(entryPrice > 0) || !(targetPrice > 0)) return null;
    return { kind: 'equity', symbol: equity[1].toUpperCase(), entryPrice, targetPrice, targetIsMinimum: Boolean(equity[4]), needsReview: false, riskFlag, raw: text };
  }
  return null;
}

module.exports = { parseAlertMessage, resolveOptionExpiration, RISK_WORDS };
