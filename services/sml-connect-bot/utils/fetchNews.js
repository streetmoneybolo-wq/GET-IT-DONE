import dns from 'node:dns/promises';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as cheerio from 'cheerio';
import { cleanEditorialSummary, cleanEditorialTitle } from './editorialText.js';

const execFileAsync = promisify(execFile);

const sectorTerms = {
  Technology: ['software', 'semiconductor', 'artificial intelligence', 'cloud', 'cybersecurity'],
  Financials: ['bank', 'fintech', 'insurance', 'credit'],
  Healthcare: ['biotech', 'pharma', 'drug', 'healthcare'],
  Energy: ['oil', 'gas', 'energy', 'solar', 'uranium'],
  'Consumer Discretionary': ['retail', 'consumer', 'automaker', 'e-commerce'],
};

function privateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const ip = address.toLowerCase();
  return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:');
}

async function assertPublicUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP or HTTPS article links are allowed.');
  if (url.username || url.password) throw new Error('Article links cannot contain credentials.');
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some((row) => privateIp(row.address))) throw new Error('That article host is not publicly reachable.');
  return url;
}

async function fetchPage(url, redirects = 0) {
  await assertPublicUrl(url.href);
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    headers: { 'user-agent': 'StockMarketLoopDiscordBot/1.0 (+https://stockmarketloop.com/)' },
  });
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    if (redirects >= 3) throw new Error('The article redirected too many times.');
    return fetchPage(new URL(response.headers.get('location'), url), redirects + 1);
  }
  if (!response.ok) {
    const error = new Error(`Article request failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.url = url.href;
    throw error;
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) throw new Error('The supplied URL is not an HTML article.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 2_000_000) throw new Error('The article is too large to inspect safely.');
  return { html: new TextDecoder().decode(bytes), finalUrl: url.href };
}

function isStockMarketLoopUrl(url) {
  return /(^|\.)stockmarketloop\.com$/i.test(url.hostname);
}

function articleSlugFromUrl(url) {
  return String(url.pathname || '').split('/').filter(Boolean).pop() || '';
}

function remoteQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sshConfiguration() {
  return {
    ssh: process.env.WP_SSH_BIN || 'ssh',
    key: process.env.WP_SSH_KEY || 'C:\\Users\\Memob\\.ssh\\id_ed25519_wpcom',
    target: process.env.WP_SSH_TARGET || 'stockmarketloop.wordpress.com@ssh.wp.com',
    root: process.env.WP_SSH_ROOT || '/srv/htdocs',
  };
}

function parseWpCliJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) throw new Error('WP-CLI returned no article data.');
  try {
    return JSON.parse(text);
  } catch {
    const candidates = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('{') || line.startsWith('['));
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(candidates[index]);
      } catch {
        // Keep looking past noisy WordPress warnings.
      }
    }
    throw new Error(`WP-CLI returned invalid article data: ${text.slice(0, 180)}`);
  }
}

async function fetchStockMarketLoopPostViaWpCli(pageUrl) {
  const slug = articleSlugFromUrl(pageUrl);
  if (!slug) throw new Error('StockMarketLoop article URL does not contain a slug.');
  const cfg = sshConfiguration();
  const script = `wp eval ${remoteQuote(`
$slug = ${JSON.stringify(slug)};
$post = get_page_by_path($slug, OBJECT, 'post');
if (!$post) {
  echo json_encode(array('found' => false));
  return;
}
$thumbnail_id = get_post_thumbnail_id($post->ID);
$description = get_post_meta($post->ID, 'rank_math_description', true);
if (!$description) { $description = get_the_excerpt($post); }
if (!$description) { $description = wp_trim_words(wp_strip_all_tags($post->post_content), 45, '…'); }
$content = wp_strip_all_tags($post->post_content);
echo wp_json_encode(array(
  'found' => true,
  'url' => get_permalink($post),
  'title' => get_the_title($post),
  'summary' => $description,
  'content' => $content,
  'image' => $thumbnail_id ? wp_get_attachment_url($thumbnail_id) : '',
));
`)}`;
  const remote = `cd ${remoteQuote(cfg.root)} && ${script}`;
  const { stdout } = await execFileAsync(cfg.ssh, ['-i', cfg.key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', cfg.target, remote], {
    timeout: 45_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  const data = parseWpCliJson(stdout);
  if (!data?.found) throw new Error(`StockMarketLoop article was not found in WordPress for slug "${slug}".`);
  return data;
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function publicImage(value, base) {
  try {
    const image = new URL(clean(value), base);
    if (!['http:', 'https:'].includes(image.protocol)) return '';
    if (!/\.(?:png|jpe?g|webp|gif|avif)(?:$|[?#])/i.test(image.href)) return '';
    return image.href;
  } catch {
    return '';
  }
}

async function wordpressFeaturedImage(pageUrl) {
  try {
    const page = new URL(pageUrl);
    if (!/(^|\.)stockmarketloop\.com$/i.test(page.hostname)) return '';
    const slug = page.pathname.split('/').filter(Boolean).pop();
    if (!slug) return '';
    const endpoint = new URL('/wp-json/wp/v2/posts', page.origin);
    endpoint.searchParams.set('slug', slug);
    endpoint.searchParams.set('_embed', '1');
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return '';
    const posts = await response.json();
    return publicImage(posts?.[0]?._embedded?.['wp:featuredmedia']?.[0]?.source_url || '', pageUrl);
  } catch {
    return '';
  }
}

export async function fetchNewsArticle(rawUrl) {
  const initial = await assertPublicUrl(rawUrl);
  let html = '';
  let finalUrl = initial.href;
  let fallbackArticle = null;
  try {
    const page = await fetchPage(initial);
    html = page.html;
    finalUrl = page.finalUrl;
  } catch (error) {
    if (!isStockMarketLoopUrl(initial) || Number(error?.status) !== 403) throw error;
    fallbackArticle = await fetchStockMarketLoopPostViaWpCli(initial);
    finalUrl = fallbackArticle.url || initial.href;
  }
  const $ = html ? cheerio.load(html) : null;
  const title = cleanEditorialTitle(clean(
    fallbackArticle?.title ||
    ($ ? $('meta[property="og:title"]').attr('content') : '') ||
    ($ ? $('title').first().text() : ''),
  )).slice(0, 240);
  const summary = cleanEditorialSummary(clean(
    fallbackArticle?.summary ||
    ($ ? $('meta[property="og:description"]').attr('content') : '') ||
    ($ ? $('meta[name="description"]').attr('content') : '') ||
    ($ ? $('article p').first().text() : ''),
  )).slice(0, 500);
  if (!title) throw new Error('No article title could be extracted.');
  const corpus = `${title} ${summary} ${fallbackArticle?.content || ''}`;
  const tickers = [...new Set([...corpus.matchAll(/\$([A-Z]{1,5})\b/g)].map((match) => match[1]))].slice(0, 8);
  const lower = corpus.toLowerCase();
  const sectors = Object.entries(sectorTerms)
    .filter(([, terms]) => terms.some((term) => lower.includes(term)))
    .map(([sector]) => sector)
    .slice(0, 4);
  const metaImage = fallbackArticle?.image || publicImage(
    ($ ? $('meta[property="og:image"]').attr('content') : '') ||
    ($ ? $('meta[name="twitter:image"]').attr('content') : ''),
    finalUrl,
  );
  const featuredImage = fallbackArticle?.image || await wordpressFeaturedImage(finalUrl);
  const image = featuredImage || metaImage;
  return { url: finalUrl, title, summary, tickers, sectors, image };
}
