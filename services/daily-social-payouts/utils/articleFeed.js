import { linkWorkflowsFromSettings, publishArticlePackage } from './linkWorkflow.js';
import { paths, mutateJson, readJson, readSettings } from './storage.js';

/**
 * The article supply that daily-social mode lost when the bot suite was
 * isolated: the old StockMarketLoop-branded monolith pushed each article it
 * published into the share workflow itself (articleAutomation ->
 * articlePackagePublisher), and that whole subsystem is gated off here. This
 * poller replaces it from the outside in: it watches the site's public
 * WordPress REST feed and turns every NEW published article into the same
 * share + discussion package a Manage Server member would have created by
 * hand in the intake channel - for every configured workflow, each with its
 * own duplicate window.
 *
 * Supply rules:
 *   - First run posts NOTHING. The current feed becomes the baseline, so a
 *     fresh deploy or a lost cursor can never flood the channels with backlog.
 *   - Only articles newer than 24h are ever auto-packaged (second flood guard).
 *   - At most maxPerCycle articles per poll; the rest stay unseen and are
 *     picked up by the next cycle in order.
 *   - A feed or package failure logs and skips - it must never crash the bot.
 */

const FEED_DEFAULT = 'https://stockmarketloop.com/wp-json/wp/v2/posts?per_page=12&orderby=date&order=desc&_fields=id,link,date_gmt,title';
const MAX_SEEN = 400;
const MAX_AGE_MS = 24 * 3_600_000;

export function articleFeedConfig(settings = {}) {
  const feed = settings.articleFeed || {};
  return {
    enabled: feed.enabled === true,
    feedUrl: typeof feed.feedUrl === 'string' && feed.feedUrl ? feed.feedUrl : FEED_DEFAULT,
    pollSeconds: Math.max(120, Number(feed.pollSeconds) || 600),
    maxPerCycle: Math.max(1, Math.min(10, Number(feed.maxPerCycle) || 3)),
    workflowIds: Array.isArray(feed.workflowIds) ? feed.workflowIds.filter(Boolean) : [],
  };
}

/**
 * Pure selection: which fetched posts are new enough and unseen. Oldest first
 * so packages land in publication order; over-cap posts stay unselected AND
 * unseen, so the next cycle takes them - nothing is silently dropped.
 */
export function selectNewPosts(cursor, posts, { maxPerCycle = 3, now = Date.now() } = {}) {
  const seen = new Set(cursor?.seenIds || []);
  const fresh = (posts || [])
    .filter((post) => post && post.id && post.link)
    .filter((post) => !seen.has(post.id))
    .filter((post) => {
      const published = Date.parse(`${post.date_gmt}Z`);
      return Number.isFinite(published) && now - published <= MAX_AGE_MS && published <= now + 5 * 60_000;
    })
    .sort((a, b) => Date.parse(`${a.date_gmt}Z`) - Date.parse(`${b.date_gmt}Z`));
  return fresh.slice(0, maxPerCycle);
}

async function readCursor() {
  return readJson(paths.articleFeedCursor, null);
}

async function writeCursorSeen(ids) {
  await mutateJson(paths.articleFeedCursor, { initializedAt: new Date().toISOString(), seenIds: [] }, (cursor) => {
    if (!Array.isArray(cursor.seenIds)) cursor.seenIds = [];
    for (const id of ids) {
      if (!cursor.seenIds.includes(id)) cursor.seenIds.push(id);
    }
    if (cursor.seenIds.length > MAX_SEEN) cursor.seenIds.splice(0, cursor.seenIds.length - MAX_SEEN);
    if (!cursor.initializedAt) cursor.initializedAt = new Date().toISOString();
  });
}

async function fetchFeed(feedUrl, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const url = new URL(feedUrl);
    url.searchParams.set('_cb', String(Date.now())); // WP.com edge ignores Cache-Control; a unique param is the only reliable bust
    const response = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: { 'user-agent': 'daily-social-payouts article feed', accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Feed responded ${response.status}`);
    const json = await response.json();
    if (!Array.isArray(json)) throw new Error('Feed did not return a post list.');
    return json.map((post) => ({ id: Number(post.id), link: String(post.link || ''), date_gmt: String(post.date_gmt || '') }));
  } finally {
    clearTimeout(timer);
  }
}

export async function runArticleFeedTick(client, { fetchImpl = fetch } = {}) {
  const settings = await readSettings();
  const config = articleFeedConfig(settings);
  if (!config.enabled) return { skipped: 'disabled' };
  const workflows = linkWorkflowsFromSettings(settings)
    .filter((workflow) => !config.workflowIds.length || config.workflowIds.includes(workflow.id || 'default'));
  if (!workflows.length) return { skipped: 'no_workflows' };

  let posts;
  try {
    posts = await fetchFeed(config.feedUrl, fetchImpl);
  } catch (error) {
    console.warn(`Article feed fetch failed safely: ${error.message || error}`);
    return { skipped: 'fetch_failed' };
  }

  const cursor = await readCursor();
  if (!cursor) {
    await writeCursorSeen(posts.map((post) => post.id));
    console.log(`Article feed baseline recorded (${posts.length} existing articles; nothing posted).`);
    return { baseline: posts.length };
  }

  const fresh = selectNewPosts(cursor, posts, { maxPerCycle: config.maxPerCycle });
  const result = { published: 0, duplicates: 0, failures: 0 };
  for (const post of fresh) {
    let handled = false;
    for (const workflow of workflows) {
      try {
        const outcome = await publishArticlePackage({
          client,
          settings,
          workflow,
          url: post.link,
          sharedBy: client.user?.id || 'article-feed',
          sharedByName: 'Article feed',
          workEventKey: `link-posted:auto:${post.id}:${workflow.id || 'default'}`,
        });
        if (outcome.status === 'published') {
          result.published += 1;
          handled = true;
        } else if (outcome.status === 'duplicate') {
          result.duplicates += 1;
          handled = true;
        }
      } catch (error) {
        result.failures += 1;
        console.warn(`Article feed could not package ${post.link} for workflow ${workflow.id || 'default'}: ${String(error.message || error).slice(0, 200)}`);
      }
    }
    /* Seen only once at least one workflow accepted it (published or already
       had it). A post every workflow failed on is retried next cycle. */
    if (handled) await writeCursorSeen([post.id]);
  }
  if (result.published) console.log(`Article feed published ${result.published} package(s) across ${workflows.length} workflow(s).`);
  return result;
}

export function startArticleFeed(client) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runArticleFeedTick(client);
    } catch (error) {
      console.warn(`Article feed tick failed safely: ${error.message || error}`);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 20_000);
  const settingsPoll = async () => {
    const settings = await readSettings().catch(() => ({}));
    return articleFeedConfig(settings).pollSeconds;
  };
  let interval = null;
  settingsPoll().then((seconds) => {
    interval = setInterval(tick, seconds * 1000);
    interval.unref?.();
  });
  return () => interval && clearInterval(interval);
}
