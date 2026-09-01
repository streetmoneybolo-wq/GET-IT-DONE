'use strict';

/* Branded editorial desks are transparent automated authors, not invented people. */
const DESKS = Object.freeze([
  { key: 'options-flow', name: 'SML Options Flow', authorSlug: 'sml-options-flow', beat: 'unusual options volume, premium, repeated strikes, 0DTE and contract activity', voice: 'fast tape-reader; lead with the contract, premium and what the flow does not prove', layout: 'flow-tape', eventTypes: ['options_flow', 'unusual_options', 'zero_dte'] },
  { key: 'gamma-volatility', name: 'SML Gamma & Volatility', authorSlug: 'sml-gamma-volatility', beat: 'gamma exposure, IV structure, max pain and volatility regimes', voice: 'measured derivatives quant; explain regimes, ranges and assumptions before directional implications', layout: 'volatility-grid', eventTypes: ['gamma', 'volatility', 'iv_skew'] },
  { key: 'earnings', name: 'SML Earnings Desk', authorSlug: 'sml-earnings-desk', beat: 'earnings calendars, reported results, guidance and post-earnings price action', voice: 'crisp scorecard reporter; separate reported results, guidance and market reaction', layout: 'earnings-scorecard', eventTypes: ['earnings', 'guidance'] },
  { key: 'sec-corporate-actions', name: 'SML Filings & Corporate Actions', authorSlug: 'sml-filings-actions', beat: 'SEC filings, offerings, dividends, buybacks, splits and mergers', voice: 'plain-English filing analyst; cite the filing and translate legal mechanics without speculation', layout: 'filing-docket', eventTypes: ['sec_filing', 'offering', 'dividend', 'buyback', 'split', 'merger'] },
  { key: 'analyst-valuation', name: 'SML Analyst & Valuation', authorSlug: 'sml-analyst-valuation', beat: 'ratings, price targets, consensus changes and relative valuation', voice: 'skeptical research analyst; compare assumptions, valuation ranges and consensus changes', layout: 'valuation-notebook', eventTypes: ['analyst_rating', 'price_target', 'valuation'] },
  { key: 'institutional-ownership', name: 'SML Institutional Ledger', authorSlug: 'sml-institutional-ledger', beat: 'institutional ownership, shareholder changes and fund positioning', voice: 'patient ownership detective; emphasize position changes, reporting lag and portfolio context', layout: 'ownership-ledger', eventTypes: ['institutional', 'shareholder', 'ownership'] },
  { key: 'insider-activity', name: 'SML Insider Activity', authorSlug: 'sml-insider-activity', beat: 'verified insider purchases, sales and ownership changes', voice: 'forensic transaction reporter; distinguish buying, selling, grants and prearranged plans', layout: 'insider-casefile', eventTypes: ['insider'] },
  { key: 'short-interest', name: 'SML Short Interest Watch', authorSlug: 'sml-short-interest-watch', beat: 'short interest, borrow pressure, days to cover and squeeze conditions', voice: 'risk-first squeeze monitor; quantify pressure while rejecting automatic squeeze claims', layout: 'pressure-monitor', eventTypes: ['short_interest', 'short_volume', 'squeeze'] },
  { key: 'macro-policy', name: 'SML Macro & Policy', authorSlug: 'sml-macro-policy', beat: 'economic releases, central banks, rates and market-wide breadth', voice: 'calm macro strategist; connect releases to rates, sectors and scenarios without false certainty', layout: 'macro-briefing', eventTypes: ['macro', 'fed', 'rates', 'market_breadth'] },
  { key: 'semiconductors-ai', name: 'SML Semiconductors & AI', authorSlug: 'sml-semiconductors-ai', beat: 'semiconductors, AI infrastructure and computing supply chains', voice: 'systems-minded technology reporter; trace demand through chips, infrastructure and supply constraints', layout: 'circuit-board', sectors: ['semiconductors', 'technology hardware', 'artificial intelligence'] },
  { key: 'biotech-healthcare', name: 'SML Biotech & Healthcare', authorSlug: 'sml-biotech-healthcare', beat: 'biotechnology, pharmaceuticals, healthcare and FDA catalysts', voice: 'evidence-led healthcare reporter; identify trial phase, endpoints, regulators and binary risks', layout: 'clinical-brief', sectors: ['biotechnology', 'pharmaceuticals', 'health care', 'healthcare'] },
  { key: 'energy-commodities', name: 'SML Energy & Commodities', authorSlug: 'sml-energy-commodities', beat: 'energy companies, oil, gas, metals and commodity-linked equities', voice: 'field-to-market commodities analyst; connect supply, inventories, curves and company exposure', layout: 'commodity-terminal', sectors: ['energy', 'oil & gas', 'basic materials', 'materials'] },
  { key: 'financials-banks', name: 'SML Banks & Financials', authorSlug: 'sml-banks-financials', beat: 'banks, insurers, brokers, credit and financial-system risk', voice: 'balance-sheet-focused banking analyst; prioritize capital, liquidity, credit and rate sensitivity', layout: 'banking-ledger', sectors: ['financials', 'financial services', 'banks'] },
  { key: 'consumer-retail', name: 'SML Consumer & Retail', authorSlug: 'sml-consumer-retail', beat: 'retail, consumer demand, travel and discretionary spending', voice: 'energetic demand reporter; connect traffic, pricing, mix and consumer trade-down behavior', layout: 'retail-pulse', sectors: ['consumer cyclical', 'consumer defensive', 'retail', 'consumer discretionary', 'consumer staples'] },
  { key: 'small-cap-risk', name: 'SML Small-Cap Risk Desk', authorSlug: 'sml-small-cap-risk', beat: 'small caps, low floats, dilution, reverse splits and high-risk catalysts', voice: 'direct risk investigator; surface float, cash runway, dilution and listing risks before momentum', layout: 'hazard-board', eventTypes: ['low_float', 'dilution', 'reverse_split', 'microcap'] }
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

function subjectFingerprint(event) {
  const ticker = normalized(event.ticker).replace(/^\$/, '').toUpperCase() || 'MARKET';
  const type = normalized(event.eventType);
  const occurred = String(event.occurredAt || event.marketDate || '').slice(0, 10);
  if (!type || !occurred) throw new Error('eventType and occurredAt/marketDate are required');
  return `${ticker}|${type}|${occurred}`;
}

function chooseContentKind(event) {
  const requested = normalized(event.contentKind || event.content_kind);
  if (requested === 'article' || requested === 'short_post') return requested;
  const score = Number(event.importanceScore ?? event.importance_score ?? event.severity ?? 0);
  return Number.isFinite(score) && score >= 75 ? 'article' : 'short_post';
}

function validateAssignment(event) {
  const desk = chooseDesk(event);
  if (!desk) return { eligible: false, reason: 'no_exclusive_editorial_desk' };
  return {
    eligible: true,
    desk,
    fingerprint: eventFingerprint(event),
    subjectFingerprint: subjectFingerprint(event),
    contentKind: chooseContentKind(event)
  };
}

module.exports = { DESKS, chooseContentKind, chooseDesk, deskForKey, eventFingerprint, subjectFingerprint, validateAssignment };
