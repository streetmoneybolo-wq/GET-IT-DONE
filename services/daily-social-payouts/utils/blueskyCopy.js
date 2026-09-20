import { cleanEditorialSummary } from './editorialText.js';
import { facebookHashtags } from './facebookCopy.js';
import { relatedStocktwitsTickers } from './stocktwitsCopy.js';
import { cashtagText, effectiveTickers } from './tickers.js';

function canonicalLink(value) {
  const url = new URL(String(value || ''));
  url.search = '';
  url.hash = '';
  return url.toString();
}

function priceMove(summary) {
  const match = String(summary || '').match(/(?:from\s+)?(\$\d+(?:\.\d+)?)\s+(?:to|→)\s+(\$\d+(?:\.\d+)?)/i);
  return match ? `${match[1]} → ${match[2]}` : '';
}

function graphemes(value) {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(String(value || ''))].map((row) => row.segment);
}

export function blueskyIntentUrl(text) {
  const value = String(text || '');
  if (!value.trim()) throw new Error('The Bluesky composer text is empty.');
  const url = `https://bsky.app/intent/compose?text=${encodeURIComponent(value)}`;
  if (url.length > 512) {
    throw new Error('The Bluesky package exceeds Discord\'s safe link-button limit. Shorten the source article URL.');
  }
  return url;
}

export function buildBlueskyPackage(post, relatedTickers = []) {
  const primary = effectiveTickers(post)[0] || '';
  const peers = [...new Set(relatedTickers.map((ticker) => String(ticker).toUpperCase().replace(/[^A-Z0-9.]/g, '')))]
    .filter((ticker) => ticker && ticker !== primary)
    .slice(0, 6);
  const summary = cashtagText(cleanEditorialSummary(post.description), effectiveTickers(post));
  const move = priceMove(summary);
  const firstSentence = primary
    ? (move ? `$${primary}: reported move ${move}.` : `$${primary}: reported stock move and market update.`)
    : 'Stock-market report with verified context.';
  const secondSentence = peers.length ? `Compare ${peers.map((ticker) => `$${ticker}`).join(' ')}.` : 'Compare the move with verified sector peers.';
  const hashtags = facebookHashtags({ ...post, tickers: primary ? [primary] : [] }, 7).split(/\s+/).filter(Boolean);
  const link = canonicalLink(post.link);
  const suffix = `${secondSentence}\n\n${link}\n\n${hashtags.join(' ')}`;
  const available = 300 - graphemes(`\n\n${suffix}`).length;
  if (available < 8) throw new Error('The Bluesky link, six related tickers, and seven hashtags exceed Bluesky’s 300-character limit.');
  const headlineCharacters = graphemes(firstSentence);
  const headline = headlineCharacters.length <= available
    ? firstSentence
    : `${headlineCharacters.slice(0, Math.max(1, available - 1)).join('').replace(/[\s,;:.-]+$/, '')}…`;
  const text = `${headline}\n\n${suffix}`;
  if (graphemes(text).length > 300) throw new Error('The generated Bluesky package exceeds 300 characters.');
  return { text, primary, peers, hashtags, link, length: graphemes(text).length };
}

export function buildBlueskyResharePackage(post, reshareUrl, relatedTickers = []) {
  const originalTickers = new Set(effectiveTickers(post));
  const peers = [...new Set(relatedTickers.map((ticker) => String(ticker).toUpperCase().replace(/[^A-Z0-9.]/g, '')))]
    .filter((ticker) => ticker && !originalTickers.has(ticker))
    .slice(0, 6);
  if (!peers.length) throw new Error('No verified non-duplicate related tickers are available for this Bluesky repost.');
  const hashtags = facebookHashtags({ title: '', description: '', tickers: peers.slice(0, 2) }, 7)
    .split(/\s+/)
    .filter(Boolean);
  const link = canonicalLink(reshareUrl);
  const lead = `Related market context: ${peers.map((ticker) => `$${ticker}`).join(' ')}.`;
  const suffix = `Compare momentum, liquidity, and risk before acting.\n\n${link}\n\n${hashtags.join(' ')}`;
  const available = 300 - graphemes(`\n\n${suffix}`).length;
  if (available < 8) throw new Error('The Bluesky repost link, related tickers, and hashtags exceed Bluesky’s 300-character limit.');
  const leadCharacters = graphemes(lead);
  const fittedLead = leadCharacters.length <= available
    ? lead
    : `${leadCharacters.slice(0, Math.max(1, available - 1)).join('').replace(/[\s,;:.-]+$/, '')}…`;
  const text = `${fittedLead}\n\n${suffix}`;
  if (graphemes(text).length > 300) throw new Error('The generated Bluesky repost package exceeds 300 characters.');
  const cashTags = (text.match(/\$[A-Z][A-Z0-9.]{0,9}\b/g) || []).map((ticker) => ticker.slice(1));
  if (cashTags.some((ticker) => originalTickers.has(ticker))) throw new Error('The Bluesky repost package repeated an original ticker.');
  return { text, peers, hashtags, link, length: graphemes(text).length };
}

export async function blueskyPackage(post) {
  const primary = effectiveTickers(post)[0] || '';
  const related = await relatedStocktwitsTickers(primary, 6).catch((error) => {
    console.warn(`Bluesky related ticker lookup failed safely for ${primary || 'unknown'}: ${error.message || error}`);
    return [];
  });
  return buildBlueskyPackage(post, related);
}

export async function blueskyResharePackage(post, reshareUrl) {
  const originals = effectiveTickers(post);
  const primary = originals[0] || '';
  const related = await relatedStocktwitsTickers(primary, 12).catch((error) => {
    console.warn(`Bluesky repost ticker lookup failed safely for ${primary || 'unknown'}: ${error.message || error}`);
    return [];
  });
  return buildBlueskyResharePackage(post, reshareUrl, related);
}
