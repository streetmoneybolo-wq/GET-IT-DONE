'use strict';

const { getConfig } = require('./config');
const { createDatabase } = require('./database');
const { log } = require('./logger');
const { createArticleGenerator } = require('./article-generator');
const { createNewsPipeline } = require('./news-pipeline');
const { fetchSourceArticle } = require('./source-article');
const { createWordPressPublisher } = require('./wordpress-publisher');

async function main() {
  const config = getConfig();
  const database = createDatabase(config);
  let stopping = false;
  let pipeline = null;

  const missing = [
    ['OPENAI_API_KEY', config.openaiApiKey],
    ['SML_WORDPRESS_USERNAME', config.wordpressUsername],
    ['SML_WORDPRESS_APP_PASSWORD', config.wordpressAppPassword]
  ].filter((entry) => !entry[1]).map((entry) => entry[0]);

  if (!missing.length) {
    pipeline = createNewsPipeline({
      database,
      fetchSource: fetchSourceArticle,
      generateArticle: createArticleGenerator({ apiKey: config.openaiApiKey, model: config.openaiModel }),
      publisher: createWordPressPublisher(config),
      logger: log,
      workerId: `render-${process.pid}`
    });
  } else {
    log('warn', 'news_pipeline_disabled', { missing });
  }

  async function tick() {
    if (stopping) return;
    try {
      await database.health();
      let processed = 0;
      if (pipeline) {
        /* Drain a small bounded batch each minute. A flood cannot starve the
           process or create an unbounded OpenAI bill in one tick. */
        for (let i = 0; i < 3; i += 1) {
          if (!await pipeline.runOnce()) break;
          processed += 1;
        }
      }
      log('info', 'worker_ready_for_jobs', {
        jobs: ['subscription_sweep', 'news_article_pipeline'],
        newsJobsProcessed: processed
      });
    } catch (error) {
      log('error', 'worker_database_unavailable', { error });
    }
  }

  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    log('info', 'worker_shutdown_started', { signal });
    await database.close();
    log('info', 'worker_shutdown_complete', { signal });
    process.exit(0);
  }

  await tick();
  const timer = setInterval(() => { void tick(); }, config.workerIntervalMs);
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}

if (require.main === module) {
  main().catch((error) => {
    log('error', 'worker_start_failed', { error });
    process.exit(1);
  });
}

module.exports = { main };
