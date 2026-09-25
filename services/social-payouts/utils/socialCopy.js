import { mutateJson, paths, readSettings } from './storage.js';
import { assertCashtaggedText, cashtagText, effectiveTickers } from './tickers.js';
import { selectSubreddit } from './redditRouting.js';
import { readFile } from 'node:fs/promises';

const PLATFORMS = new Set(['x', 'facebook', 'reddit', 'linkedin', 'bluesky', 'threads']);
const GENERIC_TAGS = ['#StockMarket', '#StockNews', '#Trading', '#Investing', '#MarketNews', '#Stocks', '#Finance', '#TradingCommunity', '#MarketUpdate'];

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clip(value, limit = 120) {
  const chars = Array.from(clean(value));
  if (chars.length <= limit) return chars.join('');
  return `${chars.slice(0, Math.max(1, limit - 1)).join('').replace(/[\s,;:.-]+$/, '')}…`;
}

function hashtag(value) {
  const tag = clean(value).replace(/[^a-z0-9]/gi, '');
  return tag ? `#${tag}` : '';
}

export function platformHeadline(post) {
  return clean(post.title)
    .replace(/^[^A-Za-z0-9$]+/u, '')
    .replace(/^(?:Fresh StockMarketLoop coverage|New market read|Worth watching|Market update|On the radar)\s*:\s*/i, '')
    .replace(/\s*[-|]\s*Stock Market Loop\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function bodyVariants(post, platform, reply = false) {
  const tickers = effectiveTickers(post);
  const title = cashtagText(platformHeadline(post), tickers);
  const ticker = tickers[0];
  const cashtag = ticker ? `$${ticker}` : '';
  const fallback = ticker ? `${cashtag} market catalyst traders are watching` : 'Market catalyst traders are watching';
  const base = cashtagText(title || fallback, tickers);
  if (reply) {
    return [
      clip(`${cashtag || 'This'} setup comes down to catalyst quality, volume, and whether price confirms the headline.`, 120),
      clip(`The useful question: is this already priced in, or does the next catalyst change expectations? ${cashtag}`.trim(), 120),
      clip(`I’m watching confirmation, not just the headline: price reaction, volume, and follow-through matter most. ${cashtag}`.trim(), 120),
    ];
  }
  if (platform === 'reddit') {
    return [clip(base.replace(/\b(surges?|explodes?|rockets?|crashes?)\b/ig, 'moves'), 120)];
  }
  if (platform === 'stocktwits') {
    return [clip(`${cashtag || base} catalyst watch: price reaction, volume, and next headline risk are the tells.`, 120)];
  }
  if (platform === 'facebook' || platform === 'linkedin') {
    return [clip(`${base} — why the catalyst, market reaction, and follow-through matter now.`, 120)];
  }
  return [
    clip(`${base}: catalyst, volume, and follow-through are the key tells.`, 120),
    clip(`${base}: what changes expectations next is the real market question.`, 120),
    clip(`${base}: watching price reaction, sentiment, and the next catalyst.`, 120),
  ];
}

function tagSets(post, configuredTags = GENERIC_TAGS, count = 5) {
  const tickerTags = effectiveTickers(post).map(hashtag);
  const sectorTags = (post.sectors || []).map(hashtag);
  const priority = [...new Set([...tickerTags, ...sectorTags].filter(Boolean))].slice(0, 2);
  const pool = [...new Set(configuredTags.map(hashtag).filter(Boolean))];
  const sets = [];
  for (let offset = 0; offset < Math.max(3, pool.length); offset += 1) {
    const set = [...priority];
    for (let index = 0; index < pool.length && set.length < count; index += 1) set.push(pool[(offset + index) % pool.length]);
    const uniqueSet = [...new Set(set)].slice(0, count);
    const signature = uniqueSet.join(' ');
    if (uniqueSet.length === count && !sets.some((existing) => existing.join(' ') === signature)) sets.push(uniqueSet);
  }
  return sets;
}

async function approvedHashtags() {
  const source = await readFile(paths.xHashtags, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return GENERIC_TAGS.join('\n');
    throw error;
  });
  return [...new Set((source.match(/#[A-Za-z0-9_&]+/g) || []).map(hashtag).filter(Boolean))];
}

async function approvedMentions(settings) {
  const configured = settings.xMentionAllowlist || [];
  let source = configured.join('\n');
  if (!source) {
    source = await readFile(paths.xHandles, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
  }
  return [...new Set((source.match(/(?<![A-Za-z0-9_])@[A-Za-z0-9_]{1,15}/g) || []).map((value) => clean(value).toLowerCase()))];
}

function mentionSet(pool, postID, generation) {
  if (!pool.length) return [];
  let seed = generation;
  for (const character of String(postID || '')) seed = ((seed * 31) + character.charCodeAt(0)) >>> 0;
  const start = seed % pool.length;
  const stride = pool.length > 11 ? 11 : 1;
  const result = [];
  for (let index = 0; index < pool.length && result.length < 5; index += 1) {
    const handle = pool[(start + index * stride) % pool.length];
    if (!result.includes(handle)) result.push(handle);
  }
  return result;
}

export async function generateSocialCopy(post, platform, { reply = false } = {}) {
  if (!PLATFORMS.has(platform)) throw new Error('That sharing platform is not supported.');
  const settings = await readSettings();
  const bodies = bodyVariants(post, platform, reply);
  const configuredTags = platform === 'x' ? await approvedHashtags() : GENERIC_TAGS;
  const hashtagCount = reply ? 3 : 5;
  const sets = tagSets(post, configuredTags, hashtagCount);
  if (!sets.length) throw new Error(`The hashtag source must contain at least ${hashtagCount} unique valid hashtags.`);
  const mentionPool = platform === 'x' && !reply ? await approvedMentions(settings) : [];
  const key = `${post.postID}:${platform}:${reply ? 'reply' : 'post'}`;
  let generated;
  await mutateJson(paths.shareCopyHistory, {}, (history) => {
    const previous = history[key] || [];
    const recentSets = new Set(previous.slice(-3).map((entry) => entry.hashtags.join(' ')));
    const hashtags = sets.find((set) => !recentSets.has(set.join(' '))) || sets[previous.length % sets.length];
    const mentions = platform === 'x' && !reply ? mentionSet(mentionPool, post.postID, previous.length) : [];
    generated = {
      // The editorial body limit is independent of the URL, handles, and hashtags.
      body: clip(bodies[previous.length % bodies.length], 120),
      hashtags,
      mentions,
      timestamp: new Date().toISOString(),
    };
    history[key] = [...previous.slice(-11), generated];
  });
  const tickers = effectiveTickers(post);
  assertCashtaggedText(generated.body, tickers, `${platform} ${reply ? 'reply' : 'post'}`);
  return { ...generated, text: [generated.body, generated.mentions.join(' '), generated.hashtags.join(' ')].filter(Boolean).join('\n\n') };
}

function encoded(value) {
  return encodeURIComponent(String(value || ''));
}

export function canonicalSocialUrl(value) {
  const raw = clean(value);
  try {
    const url = new URL(raw);
    url.hash = '';
    const trackingParameters = [
      'global_content', 'invite', 'ref', 'referral', 'referralCode',
      'fbclid', 'gclid', 'mc_cid', 'mc_eid',
    ];
    for (const name of [...url.searchParams.keys()]) {
      if (trackingParameters.includes(name) || name.toLowerCase().startsWith('utm_')) {
        url.searchParams.delete(name);
      }
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function fitUrl(build, text) {
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (build(chars.slice(0, middle).join('')).length <= 512) low = middle;
    else high = middle - 1;
  }
  return build(chars.slice(0, low).join(''));
}

function fitXUrl(copy, url) {
  const canonicalUrl = canonicalSocialUrl(url);
  const mentions = copy.mentions.join(' ');
  const hashtags = copy.hashtags.join(' ');
  const composeText = (body) => [body, mentions, hashtags].filter(Boolean).join('\n\n');
  const build = (body) => `https://twitter.com/intent/tweet?text=${encoded(composeText(body))}&url=${encoded(canonicalUrl)}`;
  // X currently reserves 23 characters for a URL. This is a platform-delivery
  // check only; it does not change the separate 120-character editorial limit.
  const fitsXComposer = (body) => Array.from(composeText(body)).length + 1 + 23 <= 280;
  const body = Array.from(copy.body || '');
  if (build('').length > 512 || !fitsXComposer('')) throw new Error('The approved X handles and hashtags exceed the X composer limit.');
  let low = 0;
  let high = body.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = body.slice(0, middle).join('');
    if (build(candidate).length <= 512 && fitsXComposer(candidate)) low = middle;
    else high = middle - 1;
  }
  return build(body.slice(0, low).join(''));
}

export function socialShareUrl({ platform, copy, url, post }) {
  const withUrl = `${copy.text}\n\n${url}`;
  if (platform === 'x') return fitXUrl(copy, url);
  if (platform === 'facebook') return `https://www.facebook.com/sharer/sharer.php?u=${encoded(url)}`;
  if (platform === 'reddit') {
    const subreddit = selectSubreddit(post).name;
    return fitUrl((title) => `https://www.reddit.com/r/${encoded(subreddit)}/submit?title=${encoded(title)}&url=${encoded(url)}`, copy.body);
  }
  if (platform === 'linkedin') return `https://www.linkedin.com/sharing/share-offsite/?url=${encoded(url)}`;
  if (platform === 'bluesky') return fitUrl((text) => `https://bsky.app/intent/compose?text=${encoded(text)}`, withUrl);
  if (platform === 'threads') return fitUrl((text) => `https://www.threads.net/intent/post?text=${encoded(text)}`, withUrl);
  throw new Error('That sharing platform is not supported.');
}
