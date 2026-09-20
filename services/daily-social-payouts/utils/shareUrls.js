import { cashtagText, effectiveTickers } from './tickers.js';
import { redditTitle, selectSubreddit } from './redditRouting.js';
import { cleanEditorialSummary, cleanEditorialTitle } from './editorialText.js';

function encoded(value) {
  return encodeURIComponent(String(value || ''));
}

const DISCORD_BUTTON_URL_LIMIT = 512;

function fitText(build, value) {
  const characters = Array.from(String(value || ''));
  if (build('').length > DISCORD_BUTTON_URL_LIMIT) {
    throw new Error('The source URL is too long for a Discord link button.');
  }
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (build(characters.slice(0, middle).join('')).length <= DISCORD_BUTTON_URL_LIMIT) low = middle;
    else high = middle - 1;
  }
  return build(characters.slice(0, low).join(''));
}

export function buildShareUrls({ title, description, link, tickers = [] }) {
  const knownTickers = effectiveTickers({ tickers, title, description });
  const cleanTitle = cashtagText(cleanEditorialTitle(title), knownTickers);
  const cleanDescription = cashtagText(cleanEditorialSummary(description), knownTickers);
  const text = [cleanTitle, cleanDescription].filter(Boolean).join('\n\n');
  const subreddit = selectSubreddit({ title: cleanTitle, description: cleanDescription, link, tickers }).name;
  const reddit = (value) => `https://www.reddit.com/r/${encoded(subreddit)}/submit?title=${encoded(value)}&url=${encoded(link)}`;
  const x = (value) => `https://twitter.com/intent/tweet?text=${encoded(value)}&url=${encoded(link)}`;
  const primaryTicker = effectiveTickers({ tickers, title: cleanTitle, description: cleanDescription })[0] || '';
  const bluesky = (value) => `https://bsky.app/intent/compose?text=${encoded(`${value}\n\n${link}`)}`;
  const threads = (value) => `https://www.threads.net/intent/post?text=${encoded(`${value}\n\n${link}`)}`;
  return {
    reddit: fitText(reddit, redditTitle({ title: cleanTitle, description: cleanDescription, link, tickers })),
    x: fitText(x, text),
    stocktwits: primaryTicker ? `https://stocktwits.com/symbol/${encoded(primaryTicker)}` : 'https://stocktwits.com/',
    bluesky: fitText(bluesky, text),
    threads: fitText(threads, text),
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded(link)}`,
  };
}
