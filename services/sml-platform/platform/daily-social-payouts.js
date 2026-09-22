'use strict';

/*
 * Daily Social Payouts — compliance-first task primitives.
 *
 * This module deliberately pays for original, disclosed promotional analysis
 * that can be reviewed. It does not create, reward, or score likes, comments,
 * reposts, quote-posts, follows, or other coordinated engagement actions.
 */

const crypto = require('node:crypto');

const PLATFORMS = Object.freeze(['reddit', 'stocktwits', 'x']);
const TASK_TYPES = Object.freeze({
  reddit: 'reddit_article',
  stocktwits: 'stocktwits_article',
  x: 'x_original_article'
});

function cleanString(value, name, { min = 1, max = 4000 } = {}) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) throw new TypeError(`${name} must be ${min} to ${max} characters`);
  return text;
}

function cleanUrl(value, name) {
  let url;
  try { url = new URL(cleanString(value, name, { min: 8, max: 2048 })); } catch (_) { throw new TypeError(`${name} must be an https URL`); }
  if (url.protocol !== 'https:') throw new TypeError(`${name} must be an https URL`);
  return url.toString();
}

function cleanPlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  if (!PLATFORMS.includes(platform)) throw new TypeError('platform must be reddit, stocktwits, or x');
  return platform;
}

function paragraphCount(text) {
  return String(text || '').trim().split(/\n\s*\n+/).filter((part) => part.trim().length >= 40).length;
}

function tickers(text) {
  return [...new Set((String(text || '').toUpperCase().match(/\$[A-Z]{1,5}\b/g) || []).map((value) => value.slice(1)))];
}

function hasDisclosure(text) {
  return /(?:#ad\b|#sponsored\b|paid\s+(?:promotion|partnership)|sponsored\s+post)/i.test(String(text || ''));
}

function ensureOriginalContent(platform, body, articleUrl) {
  const text = cleanString(body, 'submission body', { min: 80, max: 10000 });
  if (!hasDisclosure(text)) throw new TypeError('submission body must include a clear paid-promotion disclosure');
  if (!text.includes(articleUrl)) throw new TypeError('submission body must include the assigned article URL');
  if (platform === 'reddit' && paragraphCount(text) < 3) {
    throw new TypeError('Reddit submissions require at least three substantive paragraphs');
  }
  if (platform === 'stocktwits') {
    const found = tickers(text);
    if (found.length < 1 || found.length > 2) throw new TypeError('Stocktwits submissions require one or two $TICKER symbols');
  }
  if (platform === 'x' && /^(?:RT\s*@|\s*@\w+\s)/i.test(text)) {
    throw new TypeError('X submissions must be original posts, not reposts or quote-posts');
  }
  return text;
}

function taskDraft({ platform, title, articleUrl, summary, tickers: symbolList = [] }) {
  platform = cleanPlatform(platform);
  title = cleanString(title, 'article title', { min: 8, max: 200 });
  articleUrl = cleanUrl(articleUrl, 'article URL');
  summary = cleanString(summary, 'article summary', { min: 80, max: 1500 });
  const symbols = [...new Set((Array.isArray(symbolList) ? symbolList : []).map((v) => String(v).replace(/[^A-Za-z]/g, '').toUpperCase()).filter(Boolean))];
  if (platform === 'stocktwits' && (symbols.length < 1 || symbols.length > 2)) throw new TypeError('Stocktwits task requires one or two tickers');
  const disclosure = '#ad Paid partnership with StockMarketLoop.';
  if (platform === 'reddit') {
    return `${title}\n\n${summary}\n\nAdd your own analysis of the catalyst, chart context, and risk. This needs at least three substantive paragraphs before posting.\n\nSource: ${articleUrl}\n\n${disclosure}`;
  }
  const tags = symbols.map((symbol) => `$${symbol}`).join(' ');
  return `${title}\n\n${summary}\n\n${tags}\n${articleUrl}\n${disclosure}`.trim();
}

function campaignKey(date, platform, articleUrl) {
  return crypto.createHash('sha256').update(`${date}\n${platform}\n${articleUrl}`).digest('hex');
}

function createDailySocialPayouts({ pool, now = Date.now } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('pool is required');

  async function createTask({ platform, articleUrl, articleTitle, articleSummary, tickers: symbols = [], rewardCents, channelId, createdBy }) {
    platform = cleanPlatform(platform);
    articleUrl = cleanUrl(articleUrl, 'article URL');
    articleTitle = cleanString(articleTitle, 'article title', { min: 8, max: 200 });
    articleSummary = cleanString(articleSummary, 'article summary', { min: 80, max: 1500 });
    channelId = cleanString(channelId, 'channel ID', { min: 5, max: 30 });
    createdBy = cleanString(createdBy, 'creator ID', { min: 5, max: 30 });
    rewardCents = Number.parseInt(rewardCents, 10);
    if (!Number.isSafeInteger(rewardCents) || rewardCents < 25 || rewardCents > 10000) throw new TypeError('reward cents must be between 25 and 10000');
    const date = new Date(now()).toISOString().slice(0, 10);
    const key = campaignKey(date, platform, articleUrl);
    const draft = taskDraft({ platform, title: articleTitle, articleUrl, summary: articleSummary, tickers: symbols });
    const result = await pool.query(
      `INSERT INTO dsp_tasks (task_key, task_date, platform, task_type, channel_id, article_url, article_title, article_summary, tickers, draft, reward_cents, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open')
       ON CONFLICT (task_key) DO UPDATE SET updated_at = now()
       RETURNING *`,
      [key, date, platform, TASK_TYPES[platform], channelId, articleUrl, articleTitle, articleSummary, JSON.stringify(symbols), draft, rewardCents, createdBy]
    );
    return result.rows[0];
  }

  async function claimTask({ taskId, discordUserId }) {
    const task = await pool.query(`SELECT * FROM dsp_tasks WHERE id = $1 AND status = 'open' AND task_date = CURRENT_DATE FOR UPDATE`, [taskId]);
    if (!task.rows[0]) throw new TypeError('task is not available');
    const claim = await pool.query(
      `INSERT INTO dsp_claims (task_id, discord_user_id, status)
       VALUES ($1,$2,'claimed') ON CONFLICT (task_id, discord_user_id) DO UPDATE SET updated_at = now()
       RETURNING *`, [taskId, cleanString(discordUserId, 'Discord user ID', { min: 5, max: 30 })]
    );
    return { task: task.rows[0], claim: claim.rows[0] };
  }

  async function submitProof({ claimId, discordUserId, proofUrl, body, accountUrl }) {
    proofUrl = cleanUrl(proofUrl, 'proof URL');
    accountUrl = cleanUrl(accountUrl, 'account URL');
    const claim = await pool.query(
      `SELECT c.*, t.platform, t.article_url, t.reward_cents FROM dsp_claims c JOIN dsp_tasks t ON t.id = c.task_id
       WHERE c.id = $1 AND c.discord_user_id = $2 AND c.status = 'claimed' FOR UPDATE`,
      [claimId, cleanString(discordUserId, 'Discord user ID', { min: 5, max: 30 })]
    );
    if (!claim.rows[0]) throw new TypeError('claim is not available for submission');
    const row = claim.rows[0];
    body = ensureOriginalContent(row.platform, body, row.article_url);
    const result = await pool.query(
      `INSERT INTO dsp_submissions (claim_id, discord_user_id, platform, account_url, proof_url, body, status)
       VALUES ($1,$2,$3,$4,$5,$6,'submitted') RETURNING *`,
      [claimId, discordUserId, row.platform, accountUrl, proofUrl, body]
    );
    await pool.query(`UPDATE dsp_claims SET status = 'submitted', updated_at = now() WHERE id = $1`, [claimId]);
    return result.rows[0];
  }

  async function reviewSubmission({ submissionId, reviewerId, approved, reason = '' }) {
    const submission = await pool.query(
      `SELECT s.*, t.reward_cents FROM dsp_submissions s JOIN dsp_claims c ON c.id = s.claim_id JOIN dsp_tasks t ON t.id = c.task_id
       WHERE s.id = $1 AND s.status = 'submitted' FOR UPDATE`, [submissionId]
    );
    if (!submission.rows[0]) throw new TypeError('submission is not awaiting review');
    const row = submission.rows[0];
    const status = approved === true ? 'approved' : 'rejected';
    await pool.query(`UPDATE dsp_submissions SET status = $2, reviewed_by = $3, review_reason = $4, reviewed_at = now(), updated_at = now() WHERE id = $1`,
      [submissionId, status, cleanString(reviewerId, 'reviewer ID', { min: 5, max: 30 }), String(reason || '').trim().slice(0, 600)]);
    if (approved === true) {
      await pool.query(
        `INSERT INTO dsp_earnings_ledger (discord_user_id, submission_id, amount_cents, kind, status, reference)
         VALUES ($1,$2,$3,'task','available',$4) ON CONFLICT (submission_id) DO NOTHING`,
        [row.discord_user_id, submissionId, row.reward_cents, `task:${submissionId}`]
      );
    }
    return { status, amountCents: approved === true ? row.reward_cents : 0 };
  }

  async function balance(discordUserId) {
    const result = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN status = 'available' THEN amount_cents WHEN status = 'paid' THEN 0 ELSE 0 END), 0)::integer AS available_cents,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0)::integer AS paid_cents
       FROM dsp_earnings_ledger WHERE discord_user_id = $1`,
      [cleanString(discordUserId, 'Discord user ID', { min: 5, max: 30 })]
    );
    return result.rows[0];
  }

  return Object.freeze({ createTask, claimTask, submitProof, reviewSubmission, balance });
}

module.exports = { PLATFORMS, TASK_TYPES, paragraphCount, tickers, ensureOriginalContent, taskDraft, createDailySocialPayouts };
