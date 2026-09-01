'use strict';

/* Branded editorial desks are transparent automated authors, not invented people. */
const DESKS = Object.freeze([
  { key: 'options-flow', name: 'SML Options Flow', authorSlug: 'sml-options-flow', beat: 'unusual options volume, premium, repeated strikes, 0DTE and contract activity', eventTypes: ['options_flow', 'unusual_options', 'zero_dte'] },
  { key: 'gamma-volatility', name: 'SML Gamma & Volatility', authorSlug: 'sml-gamma-volatility', beat: 'gamma exposure, IV structure, max pain and volatility regimes', eventTypes: ['gamma', 'volatility', 'iv_skew'] },
  { key: 'earnings', name: 'SML Earnings Desk', authorSlug: 'sml-earnings-desk', beat: 'earnings calendars, reported results, guidance and post-earnings price action', eventTypes: ['earnings', 'guidance'] },
  { key: 'sec-corporate-actions', name: 'SML Filings & Corporate Actions', authorSlug: 'sml-filings-actions', beat: 'SEC filings, offerings, dividends, buybacks, splits and mergers', eventTypes: ['sec_filing', 'offering', 'dividend', 'buyback', 'split', 'merger'] },
  { key: 'analyst-valuation', name: 'SML Analyst & Valuation', authorSlug: 'sml-analyst-valuation', beat: 'ratings, price targets, consensus changes and relative valuation', eventTypes: ['analyst_rating', 'price_target', 'valuation'] },
  { key: 'institutional-ownership', name: 'SML Institutional Ledger', authorSlug: 'sml-institutional-ledger', beat: 'institutional ownership, shareholder changes and fund positioning', eventTypes: ['institutional', 'shareholder', 'ownership'] },
  { key: 'insider-activity', name: 'SML Insider Activity', authorSlug: 'sml-insider-activity', beat: 'verified insider purchases, sales and ownership changes', eventTypes: ['insider'] },
  { key: 'short-interest', name: 'SML Short Interest Watch', authorSlug: 'sml-short-interest-watch', beat: 'short interest, borrow pressure, days to cover and squeeze conditions', eventTypes: ['short_interest', 'short_volume', 'squeeze'] },
  { key: 'macro-policy', name: 'SML Macro & Policy', authorSlug: 'sml-macro-policy', beat: 'economic releases, central banks, rates and market-wide breadth', eventTypes: ['macro', 'fed', 'rates', 'market_breadth'] },
  { key: 'semiconductors-ai', name: 'SML Semiconductors & AI', authorSlug: 'sml-semiconductors-ai', beat: 'semiconductors, AI infrastructure and computing supply chains', sectors: ['semiconductors', 'technology hardware', 'artificial intelligence'] },
  { key: 'biotech-healthcare', name: 'SML Biotech & Healthcare', authorSlug: 'sml-biotech-healthcare', beat: 'biotechnology, pharmaceuticals, healthcare and FDA catalysts', sectors: ['biotechnology', 'pharmaceuticals', 'health care', 'healthcare'] },
  { key: 'energy-commodities', name: 'SML Energy & Commodities', authorSlug: 'sml-energy-commodities', beat: 'energy companies, oil, gas, metals and commodity-linked equities', sectors: ['energy', 'oil & gas', 'basic materials', 'materials'] },
  { key: 'financials-banks', name: 'SML Banks & Financials', authorSlug: 'sml-banks-financials', beat: 'banks, insurers, brokers, credit and financial-system risk', sectors: ['financials', 'financial services', 'banks'] },
  { key: 'consumer-retail', name: 'SML Consumer & Retail', authorSlug: 'sml-consumer-retail', beat: 'retail, consumer demand, travel and discretionary spending', sectors: ['consumer cyclical', 'consumer defensive', 'retail', 'consumer discretionary', 'consumer staples'] },
  { key: 'small-cap-risk', name: 'SML Small-Cap Risk Desk', authorSlug: 'sml-small-cap-risk', beat: 'small caps, low floats, dilution, reverse splits and high-risk catalysts', eventTypes: ['low_float', 'dilution', 'reverse_split', 'microcap'] }
]);

const byKey = new Map(DESKS.map((desk) => [desk.key, Object.freeze(desk)]));

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function chooseDesk(event) {
  const type = normalized(event.eventType);
  const sector = normalized(event.sector || event.industry);
  /* Event specialists own a story before a broad sector desk can claim it. */
  return DESKS.find((desk) => (desk.eventTypes || []).includes(type)) ||
    DESKS.find((desk) => (desk.sectors || []).some((candidate) => sector.includes(candidate))) ||
    null;
}

function deskForKey(key) {
  return byKey.get(normalized(key)) || null;
}

function eventFingerprint(event) {
  const ticker = normalized(event.ticker).replace(/^\$/, '').toUpperCase();
  const type = normalized(event.eventType);
  const sourceId = normalized(event.sourceEventId || event.accessionNumber || event.officialUrl);
  const occurred = String(event.occurredAt || event.marketDate || '').slice(0, 10);
  if (!ticker || !type || !sourceId || !occurred) throw new Error('ticker, eventType, sourceEventId/officialUrl, and occurredAt/marketDate are required');
  return `${ticker}|${type}|${sourceId}|${occurred}`;
}

function validateAssignment(event) {
  const desk = chooseDesk(event);
  if (!desk) return { eligible: false, reason: 'no_exclusive_editorial_desk' };
  return { eligible: true, desk, fingerprint: eventFingerprint(event) };
}

module.exports = { DESKS, chooseDesk, deskForKey, eventFingerprint, validateAssignment };
