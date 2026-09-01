'use strict';

const crypto = require('node:crypto');
const moderation = require('../news-engine/src/moderation');

function safeError(error) {
  const code = String(error && error.code || 'unexpected_error').slice(0, 80);
  const detail = String(error && error.message || 'unexpected error')
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [redacted]')
    .slice(0, 500);
  return { code, detail };
}

function isPermanent(error) {
  return new Set([
    'unsafe_source_url', 'unsafe_source_host', 'source_not_found', 'source_not_html',
    'source_content_too_thin', 'source_too_large', 'unsupported_source_image',
    'invalid_article_output', 'invalid_article_length', 'duplicate_article',
    'wordpress_author_mismatch', 'wordpress_author_not_configured', 'wordpress_duplicate'
  ]).has(error && error.code);
}

function createNewsPipeline({ database, fetchSource, generateArticle, publisher, logger, workerId }) {
  async function processJob(job) {
    try {
      const source = await fetchSource(job.source_url);
      source.editorialDesk = job.editorial_desk || null;
      source.marketSnapshot = job.market_snapshot || null;
      source.officialSources = job.official_sources || [];
      await database.saveNewsSource(job.id, source);
      const article = job.generated_payload || await generateArticle(source);
      if (!job.generated_payload) {
        const suffix = job.source_url_hash.slice(0, 8);
        const base = article.slug.slice(0, Math.max(1, 60 - suffix.length - 1)).replace(/-+$/, '');
        article.slug = `${base}-${suffix}`;
      }
      if (!job.generated_payload) await database.saveGeneratedArticle(job.id, article);

      const candidates = await database.recentGeneratedArticles(job.id, 100);
      const result = moderation.moderate({ title: article.title, summary: article.excerpt, body: article.body_html }, {
        duplicateCandidates: candidates.map((item) => ({ entity_id: item.id, simhash: moderation.simhash(item.body_html).toString() }))
      });
      const duplicate = result.flags.find((flag) => flag.flag_type === 'duplicate' && flag.severity >= 4);
      if (duplicate) throw Object.assign(new Error('article is too similar to an existing generated article'), { code: 'duplicate_article' });

      let mediaId = job.wordpress_media_id;
      if (!mediaId && source.imageUrl) {
        const media = await publisher.uploadFeaturedImage(source.imageUrl, article);
        if (media) {
          mediaId = media.id;
          await database.saveNewsMedia(job.id, media.id);
        }
      }
      const published = await publisher.publish({
        article,
        sourceUrl: source.sourceUrl,
        sourceUrlHash: job.source_url_hash,
        mediaId
      });
      await database.completeNewsJob(job.id, published.post.id, published.post.link, published.duplicate);
      logger('info', 'news_article_published', {
        jobId: job.id,
        wordpressPostId: published.post.id,
        duplicate: published.duplicate,
        sourceUrlHash: job.source_url_hash
      });
    } catch (error) {
      const safe = safeError(error);
      const permanent = isPermanent(error);
      await database.failNewsJob(job.id, safe, permanent);
      logger(permanent ? 'warn' : 'error', 'news_article_job_failed', {
        jobId: job.id,
        attempt: job.attempts,
        permanent,
        error: safe
      });
    }
  }

  async function runOnce() {
    const job = await database.claimNewsJob(workerId || `worker-${crypto.randomUUID()}`);
    if (!job) return false;
    await processJob(job);
    return true;
  }

  return { processJob, runOnce };
}

module.exports = { createNewsPipeline, isPermanent, safeError };
