import { assertCashtaggedText, cashtagText, effectiveTickers } from './tickers.js';
import { cleanEditorialSummary, cleanEditorialTitle } from './editorialText.js';
import { fetchRelatedTickers, fetchTickerDetails } from './massiveClient.js';
import { mutateJson, paths } from './storage.js';

function tickerTag(value) {
  const ticker = String(value || '').toUpperCase().replace(/[^A-Z0-9.]/g, '');
  return ticker ? `$${ticker}` : '';
}

function seoHeadline(post, primary, quote = false) {
  const title = cleanEditorialTitle(post.title);
  const lower = title.toLowerCase();
  if (quote) return primary ? `$${primary} Momentum Follow-Up: Reported Move, Risk and Market Context` : `Market Momentum Follow-Up: Reported Move and Risk Context`;
  if (primary && /alert/.test(lower)) return `$${primary} Stock Alert Update: Reported Price Move and Timeline`;
  if (primary && /(surge|jump|rally|gain|rise)/.test(lower)) return `$${primary} Stock Surge: Price Action and Market Context`;
  if (primary && /earnings?/.test(lower)) return `$${primary} Earnings Update: Results and Market Reaction`;
  return primary ? `$${primary} Stock News: Latest Market Update` : (title || 'Stock Market News Update');
}

function fit(body, suffix, limit) {
  const available = Math.max(0, limit - Array.from(suffix).length);
  const chars = Array.from(body.replaceAll('```', "'''"));
  const fitted = chars.length <= available ? body : `${chars.slice(0, Math.max(0, available - 1)).join('')}…`;
  return `${fitted}${suffix}`;
}

export function validateStocktwitsCashtags(text) {
  const tags = (String(text || '').match(/\$[A-Z][A-Z0-9.]{0,9}\b/g) || []).map((tag) => tag.toUpperCase());
  const unique = [...new Set(tags)];
  if (tags.length !== unique.length) throw new Error('Stocktwits copy contains a repeated cashtag.');
  if (unique.length > 5) throw new Error('Stocktwits copy contains more than five cashtags.');
  return unique;
}

function normalizeStocktwitsCashtags(text) {
  const seen = new Set();
  return String(text || '').replace(/\$([A-Z][A-Z0-9.]{0,9})\b/g, (match, ticker) => {
    const normalized = ticker.toUpperCase();
    if (seen.has(normalized) || seen.size >= 5) return 'the stock';
    seen.add(normalized);
    return `$${normalized}`;
  });
}

function sameIndustry(base, candidate) {
  if (!base.sicCode || !candidate.sicCode) return false;
  return base.sicCode.slice(0, 2) === candidate.sicCode.slice(0, 2);
}

function classifiedSectorFallbacks(details) {
  const corpus = `${details.name || ''} ${details.sicDescription || ''} ${details.description || ''}`.toLowerCase();
  const groups = [
    { terms: ['robotic', 'physical ai', 'intelligent mobility', 'wearable'], tickers: ['SYM', 'SERV', 'IRBT', 'RR', 'ISRG', 'RBOT', 'TER', 'ROK'] },
    { terms: ['semiconductor', 'chipmaker', 'microprocessor'], tickers: ['NVDA', 'AMD', 'AVGO', 'INTC', 'QCOM'] },
    { terms: ['biotech', 'biopharma', 'pharmaceutical', 'drug development'], tickers: ['MRNA', 'BNTX', 'GILD', 'AMGN', 'REGN'] },
    { terms: ['banking', 'commercial bank', 'financial services'], tickers: ['JPM', 'BAC', 'C', 'WFC', 'GS'] },
    { terms: ['cloud software', 'enterprise software', 'software platform'], tickers: ['MSFT', 'ORCL', 'CRM', 'NOW', 'ADBE'] },
    { terms: ['oil and gas', 'petroleum', 'energy exploration'], tickers: ['XOM', 'CVX', 'COP', 'OXY', 'SLB'] },
    { terms: ['electric vehicle', 'automotive', 'automaker'], tickers: ['TSLA', 'GM', 'F', 'RIVN', 'LCID'] },
    { terms: ['retail', 'e-commerce', 'consumer marketplace'], tickers: ['AMZN', 'WMT', 'TGT', 'COST', 'SHOP'] },
  ];
  return groups.find((group) => group.terms.some((term) => corpus.includes(term)))?.tickers || [];
}

export async function relatedStocktwitsTickers(primary, required = 5) {
  if (!primary) return [];
  const key = String(primary).toUpperCase();
  return mutateJson(paths.relatedTickerCache, {}, async (cache) => {
    const existing = cache[key];
    if (existing && Date.now() - new Date(existing.checkedAt || 0).getTime() < 24 * 60 * 60_000 && existing.tickers?.length >= required) {
      return existing.tickers.slice(0, required);
    }
    const [base, related] = await Promise.all([fetchTickerDetails(key), fetchRelatedTickers(key)]);
    const candidates = related.tickers.slice(0, 20);
    const details = await Promise.all(candidates.map((ticker) => fetchTickerDetails(ticker).catch(() => null)));
    const verified = details.filter((row) => row?.active && sameIndustry(base, row)).map((row) => row.symbol);
    const fallback = candidates.filter((ticker) => !verified.includes(ticker));
    const classified = classifiedSectorFallbacks(base).filter((ticker) => ticker !== key && !verified.includes(ticker) && !fallback.includes(ticker));
    const activeClassified = (await Promise.all(classified.map((ticker) => fetchTickerDetails(ticker).catch(() => null))))
      .filter((row) => row?.active)
      .map((row) => row.symbol);
    const tickers = [...verified, ...activeClassified, ...fallback].filter((ticker) => ticker !== key).slice(0, Math.max(required, 8));
    cache[key] = {
      tickers,
      sameIndustryCount: verified.length,
      classifiedSectorCount: activeClassified.length,
      sicCode: base.sicCode,
      sicDescription: base.sicDescription,
      requestId: related.requestId,
      checkedAt: new Date().toISOString(),
    };
    return tickers.slice(0, required);
  });
}

export function buildStocktwitsPackages(post, relatedTickers = [], limit = 900) {
  const primary = effectiveTickers(post)[0] || '';
  const peers = [...new Set(relatedTickers.map((ticker) => String(ticker).toUpperCase()))].filter((ticker) => ticker && ticker !== primary);
  const knownTickers = [primary, ...peers];
  const title = cashtagText(cleanEditorialTitle(post.title), knownTickers);
  const description = cashtagText(cleanEditorialSummary(post.description), knownTickers);
  const originalPeers = peers.slice(0, 2);
  const quotePeers = peers.slice(2, 5);
  const originalPeerTags = originalPeers.map(tickerTag);
  const originalPeerSentence = originalPeerTags.length
    ? `Traders can compare this move with ${originalPeerTags.length === 1 ? originalPeerTags[0] : `${originalPeerTags[0]} and ${originalPeerTags[1]}`} while watching whether momentum broadens or fades across the sector.`
    : '';
  const originalSuffix = `\n\n${post.link}`;
  const peerText = quotePeers.map(tickerTag);
  const peerSentence = peerText.length
    ? `Traders can compare the primary move with ${peerText.length === 1 ? peerText[0] : `${peerText.slice(0, -1).join(', ')}, and ${peerText.at(-1)}`}.`
    : `Traders should compare the move with other companies operating in the same market segment.`;
  const quoteBody = `${peerSentence} The key question is whether momentum holds, fades, or rotates across the group. Read the original post and add your own evidence-based view.`;
  const originalContext = description
    ? 'The report reviews the documented price timeline, market context, momentum, liquidity, and risk.'
    : 'Review the documented market context, momentum, liquidity, and risk.';
  const original = normalizeStocktwitsCashtags(fit([seoHeadline(post, primary), originalContext, originalPeerSentence].filter(Boolean).join('\n\n'), originalSuffix, limit));
  const quote = normalizeStocktwitsCashtags(fit([seoHeadline(post, primary, true), quoteBody].join('\n\n'), '', limit));
  validateStocktwitsCashtags(original);
  validateStocktwitsCashtags(quote);
  assertCashtaggedText(original, [primary, ...originalPeers], 'Stocktwits post');
  assertCashtaggedText(quote, quotePeers, 'Stocktwits quote reply');
  return {
    primary,
    originalPeers,
    quotePeers,
    original,
    quote,
  };
}

export async function stocktwitsPackages(post, limit = 900) {
  const primary = effectiveTickers(post)[0] || '';
  const related = await relatedStocktwitsTickers(primary, 5).catch((error) => {
    console.warn(`Related ticker lookup failed safely for ${primary || 'unknown'}: ${error.message || error}`);
    return [];
  });
  return buildStocktwitsPackages(post, related, limit);
}

export function packagedStocktwitsCaption(post, limit = 900) {
  return buildStocktwitsPackages(post, [], limit).original;
}
