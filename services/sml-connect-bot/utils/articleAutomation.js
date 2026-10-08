import { mutateJson, paths, readJson, readSettings } from './storage.js';
import { fetchMinuteBars, fetchTickerDetails, fetchTradingSessions, highestBar } from './massiveClient.js';
import { articleCalculations, selectTrackingWindow, verifyArticleEligibility } from './articleEligibility.js';
import { ARTICLE_PROMPT_VERSIONS, articleFactFingerprint } from './articleAiPipeline.js';
import { gainPercent, newlyCrossedMilestones, planMilestoneArticle, endOfDayRecapDue } from './milestonePolicy.js';
import { generateAlertArticle, validateArticleIdentityLinks, validatePermanentArticleLayout } from './articleGenerator.js';
import { applyArticleOptimization, canonicalArticleUrl, createOrUpdateArticle, updateArticleById, verifyWordPressAccess } from './wordpressClient.js';
import { ensureArticleFeaturedImage } from './articleFeaturedImages.js';
import { embedAlertVisual, ensureAlertVisualMedia } from './articleAlertVisual.js';
import { publishArticlePackage } from './articlePackagePublisher.js';
import { buildNewsArticleSchema, validateSeoPackage } from './articleSeoPolicy.js';
import { buildUniversalAlertRecord, scoreArticleReadiness } from './universalAlertProtocol.js';

const MARKET_TIMEZONE = 'America/New_York';
let cycleRunning = false;
let timer = null;

function zonedParts(timestamp, timeZone = MARKET_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function withinExtendedSession(now, session) {
  const current = zonedParts(now, session?.timezone || MARKET_TIMEZONE);
  return current.time >= (session?.start || '04:00') && current.time <= (session?.end || '20:00');
}

function factPacket(alert, plan, market, details, articleType = 'milestone-update') {
  const tracking = alert.performanceTracking;
  const facts = {
    articleType,
    symbol: alert.current.symbol,
    companyName: details.name,
    exchange: details.exchange,
    companyDescription: details.description || '',
    sources: [
      { url: `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(alert.current.symbol.toLowerCase())}`, title: `${alert.current.symbol} market listing`, kind: 'market-data', verified: true },
      ...(details.homepageUrl && /^https:\/\//.test(details.homepageUrl) ? [{ url: details.homepageUrl, title: `${details.name} official website`, kind: 'company', verified: true }] : []),
    ],
    entryPrice: Number(alert.current.entryPrice),
    targetPrice: Number(alert.current.targetPrice),
    targetIsMinimum: Boolean(alert.current.targetIsMinimum),
    alertTimestamp: alert.messageTimestamp,
    alertText: alert.current.raw,
    discordMessageId: alert.messageId,
    discordChannelId: alert.channelId,
    alertVisual: alert.alertVisual || null,
    verifiedHigh: Number(tracking.highestVerifiedPrice),
    verifiedHighAt: tracking.highestVerifiedAt,
    verifiedGainPercent: gainPercent(alert.current.entryPrice, tracking.highestVerifiedPrice),
    milestoneGainPercent: plan?.milestoneGainPercent ?? null,
    crossedMilestones: plan?.crossedMilestones || [],
    massiveRequestId: market.requestId,
    massiveAdjusted: market.adjusted,
    marketDataThrough: tracking.lastBarTimestamp ? new Date(tracking.lastBarTimestamp).toISOString() : null,
    tradingDatesObserved: tracking.tradingDatesObserved || [],
    trackingWindow: tracking.window,
    latestPrice: tracking.latestPrice || null,
    latestPriceAt: tracking.latestPriceAt || null,
    priorPublishedPostId: tracking.lastArticlePostId || null,
    generatedAt: new Date().toISOString(),
  };
  // Keep a normalized, ticker-agnostic record beside the existing pipeline
  // facts. The legacy fields remain for compatibility with existing drafts.
  facts.universalAlertRecord = buildUniversalAlertRecord({
    alertId: alert.messageId, ticker: facts.symbol, companyName: facts.companyName,
    exchange: facts.exchange, alertType: articleType, analyst: alert.authorName || '',
    alertSource: 'Discord', alertChannel: facts.discordChannelId,
    alertTimestamp: facts.alertTimestamp, entryPrice: facts.entryPrice,
    targetPrice: facts.targetPrice, alertText: facts.alertText,
    alertImageUrl: facts.alertVisual?.url || '', verifiedHigh: facts.verifiedHigh,
    verifiedHighAt: facts.verifiedHighAt, latestPrice: facts.latestPrice,
    verificationStatus: 'verified',
  });
  return facts;
}

function queueKey(messageId, type, milestone = '') {
  return `${messageId}:${type}:${milestone}`;
}

function assertPublishableFacts(job, settings) {
  const facts = job?.facts || {};
  const required = ['symbol', 'alertTimestamp', 'discordMessageId', 'verifiedHighAt', 'massiveRequestId'];
  const missing = required.filter((key) => !String(facts[key] || '').trim());
  if (!(Number(facts.entryPrice) > 0)) missing.push('entryPrice');
  if (!(Number(facts.verifiedHigh) > 0)) missing.push('verifiedHigh');
  if (!Number.isFinite(Number(facts.verifiedGainPercent))) missing.push('verifiedGainPercent');
  const visualOptions = settings.articleAutomation?.alertVisuals || {};
  if (visualOptions.enabled !== false && visualOptions.required !== false && (!facts.alertVisual?.path || !facts.alertVisual?.hash)) missing.push('alertVisual');
  if (missing.length) throw new Error(`Publication blocked: missing verified fields (${[...new Set(missing)].join(', ')}).`);
}

async function enqueueJobs(jobs) {
  if (!jobs.length) return;
  await mutateJson(paths.articleJobs, [], (rows) => {
    for (const job of jobs) if (!rows.some((row) => row.id === job.id)) rows.push(job);
  });
}

export async function updateMarketTracking(now = new Date()) {
  const settings = await readSettings();
  const monitor = settings.alertMonitor || {};
  const queued = [];
  await mutateJson(paths.monitoredAlerts, [], async (alerts) => {
    const pending = alerts.filter((alert) => !alert.needsReview && alert.current?.kind === 'equity' && alert.trackingStatus !== 'complete')
      .sort((a, b) => String(a.performanceTracking?.lastMarketPollAt || '').localeCompare(String(b.performanceTracking?.lastMarketPollAt || '')) || String(b.messageTimestamp).localeCompare(String(a.messageTimestamp)))
      .slice(0, Math.max(1, Number(settings.articleAutomation?.maxAlertsPerCycle || 25)));
    for (const alert of pending) {
      if (alert.needsReview || alert.current?.kind !== 'equity' || alert.trackingStatus === 'complete') continue;
      // Never request months of one-minute bars for a five-session alert.
      const dataThrough = new Date(Math.min(new Date(now).getTime(), Date.parse(alert.messageTimestamp) + 21 * 86400_000));
      const data = await Promise.all([
        fetchMinuteBars(alert.current.symbol, alert.messageTimestamp, dataThrough),
        fetchTradingSessions(alert.messageTimestamp, dataThrough),
      ]).catch((error) => {
        alert.performanceTracking ||= {};
        alert.performanceTracking.lastMarketError = String(error.message || error).slice(0, 300);
        alert.performanceTracking.lastMarketErrorAt = new Date().toISOString();
        alert.performanceTracking.lastMarketPollAt = new Date().toISOString();
        return null;
      });
      if (!data) continue;
      const [market, sessions] = data;
      let window;
      try {
        window = selectTrackingWindow({ alertTimestamp: alert.messageTimestamp, sessions, bars: market.bars, now, tradingDayLimit: Number(monitor.trackingTradingDays || 5) });
      } catch (error) {
        alert.performanceTracking ||= {};
        alert.performanceTracking.lastMarketError = String(error.message || error).slice(0, 300);
        alert.performanceTracking.lastMarketPollAt = new Date().toISOString();
        continue;
      }
      const { eligibleBars, allowedTradingDates: allowedDates, ...windowMetadata } = window;
      const peak = highestBar(eligibleBars);
      const tracking = alert.performanceTracking ||= {};
      tracking.tradingDayLimit = Number(monitor.trackingTradingDays || 5);
      tracking.tradingDatesObserved = allowedDates;
      tracking.window = { ...windowMetadata, allowedTradingDates: allowedDates };
      tracking.lastMarketPollAt = new Date().toISOString();
      tracking.lastMassiveRequestId = market.requestId;
      tracking.marketDataSource = 'massive-adjusted-minute-aggregates';
      tracking.lastMarketError = null;
      tracking.lastBarTimestamp = eligibleBars.at(-1)?.timestamp || null;
      tracking.latestPrice = eligibleBars.at(-1)?.close || null;
      tracking.latestPriceAt = tracking.lastBarTimestamp ? new Date(tracking.lastBarTimestamp).toISOString() : null;
      tracking.highestVerifiedPrice = peak?.high || null;
      tracking.highestVerifiedAt = peak ? new Date(peak.timestamp).toISOString() : null;
      const completed = tracking.completedMilestones || [];
      const universalThresholds = settings.universalArticleProtocol?.enabled
        ? settings.universalArticleProtocol.gainThresholds : null;
      const crossings = newlyCrossedMilestones({
        entryPrice: alert.current.entryPrice,
        highPrice: tracking.highestVerifiedPrice,
        milestones: Array.isArray(universalThresholds) && universalThresholds.length ? universalThresholds : monitor.milestoneGainPercents,
        completed: [...completed, ...(tracking.queuedMilestones || [])],
      });
      const plan = planMilestoneArticle(crossings);
      if (plan) {
        const details = await fetchTickerDetails(alert.current.symbol).catch(() => ({ name: alert.current.symbol, exchange: '' }));
        const id = queueKey(alert.messageId, 'milestone', plan.milestoneGainPercent);
        queued.push({
          id, type: 'milestone', status: 'queued', alertMessageId: alert.messageId,
          milestoneGainPercent: plan.milestoneGainPercent, crossedMilestones: plan.crossedMilestones,
          facts: factPacket(alert, plan, market, details), attempts: 0, createdAt: new Date().toISOString(), nextAttemptAt: null,
        });
        tracking.queuedMilestones = [...new Set([...(tracking.queuedMilestones || []), ...plan.crossedMilestones])].sort((a, b) => a - b);
      }
      if (tracking.firstMilestoneArticleAt && !tracking.endOfDayRecapCompleted && !tracking.endOfDayRecapQueued && monitor.endOfDayRecap?.enabled && endOfDayRecapDue({
        now, firstMilestoneArticleAt: tracking.firstMilestoneArticleAt, alreadyCompleted: false,
        time: monitor.endOfDayRecap.time, timeZone: monitor.endOfDayRecap.timezone,
      })) {
        const details = await fetchTickerDetails(alert.current.symbol).catch(() => ({ name: alert.current.symbol, exchange: '' }));
        const id = queueKey(alert.messageId, 'eod');
        queued.push({
          id, type: 'eod', status: 'queued', alertMessageId: alert.messageId,
          facts: factPacket(alert, null, market, details, 'end-of-day-recap'), attempts: 0, createdAt: new Date().toISOString(), nextAttemptAt: null,
        });
        tracking.endOfDayRecapQueued = true;
      }
      if (window.complete) alert.trackingStatus = 'complete';
      else alert.trackingStatus = 'tracking-market-data';
    }
  });
  await enqueueJobs(queued);
  return queued;
}

async function markJob(id, patch) {
  return mutateJson(paths.articleJobs, [], (rows) => {
    const job = rows.find((row) => row.id === id);
    if (job) Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  });
}

async function refreshJobFactsFromTrackedAlert(job, monitoredAlerts) {
  const sourceAlert = monitoredAlerts.find((row) => row.messageId === job.alertMessageId);
  if (!sourceAlert) {
    const error = new Error('Original tracked Discord alert is missing; automatic publication requires review.');
    error.code = 'review_required';
    throw error;
  }
  job.facts ||= {};
  let changed = false;
  if (!job.facts.alertVisual && sourceAlert.alertVisual) {
    job.facts.alertVisual = sourceAlert.alertVisual;
    changed = true;
  }
  const tracking = sourceAlert.performanceTracking || {};
  if (sourceAlert.needsReview || sourceAlert.edited) {
    const error = new Error('Original alert has changed or requires review.');
    error.code = 'review_required';
    throw error;
  }
  const contextChanged = job.facts.latestPrice !== (tracking.latestPrice || null)
    || job.facts.latestPriceAt !== (tracking.latestPriceAt || null)
    || JSON.stringify(job.facts.trackingWindow) !== JSON.stringify(tracking.window);
  if (contextChanged) {
    job.generatedArticle = undefined;
    job.writerCheckpoint = undefined;
    changed = true;
  }
  job.facts.trackingWindow = tracking.window;
  job.facts.latestPrice = tracking.latestPrice || null;
  job.facts.latestPriceAt = tracking.latestPriceAt || null;
  job.facts.priorPublishedPostId = tracking.lastArticlePostId || null;
  const latestHigh = Number(tracking.highestVerifiedPrice);
  const previousHigh = Number(job.facts.verifiedHigh);
  if (!Number.isFinite(latestHigh) || latestHigh <= 0) {
    const error = new Error('No verified post-alert high is available inside the trading window.');
    error.code = 'review_required';
    throw error;
  }
  if (Number.isFinite(latestHigh) && latestHigh > 0 && (!Number.isFinite(previousHigh) || latestHigh !== previousHigh || job.facts.verifiedHighAt !== tracking.highestVerifiedAt)) {
    job.facts.verifiedHigh = latestHigh;
    job.facts.verifiedHighAt = tracking.highestVerifiedAt || job.facts.verifiedHighAt;
    job.facts.verifiedGainPercent = gainPercent(job.facts.entryPrice, latestHigh);
    job.facts.marketDataThrough = tracking.lastBarTimestamp ? new Date(tracking.lastBarTimestamp).toISOString() : job.facts.marketDataThrough;
    job.facts.tradingDatesObserved = tracking.tradingDatesObserved || job.facts.tradingDatesObserved || [];
    job.facts.massiveRequestId = tracking.lastMassiveRequestId || job.facts.massiveRequestId;
    job.generatedArticle = undefined;
    job.openaiResponseId = undefined;
    job.writerCheckpoint = undefined;
    changed = true;
  }
  job.facts.marketDataThrough = tracking.lastBarTimestamp ? new Date(tracking.lastBarTimestamp).toISOString() : null;
  job.facts.massiveRequestId = tracking.lastMassiveRequestId || job.facts.massiveRequestId;
  job.facts.tradingDatesObserved = tracking.tradingDatesObserved || [];
  await markJob(job.id, { facts: job.facts, generatedArticle: job.generatedArticle, openaiResponseId: job.openaiResponseId, writerCheckpoint: job.writerCheckpoint });
  return changed;
}

async function completeAlertForJob(job, post) {
  await mutateJson(paths.monitoredAlerts, [], (alerts) => {
    const alert = alerts.find((row) => row.messageId === job.alertMessageId);
    if (!alert) return;
    const tracking = alert.performanceTracking ||= {};
    if (job.type === 'milestone') {
      tracking.completedMilestones = [...new Set([...(tracking.completedMilestones || []), ...(job.crossedMilestones || [])])].sort((a, b) => a - b);
      tracking.firstMilestoneArticleAt ||= new Date().toISOString();
    } else {
      tracking.endOfDayRecapCompleted = true;
    }
    tracking.lastArticlePostId = post.id;
    tracking.lastArticleUrl = post.link || '';
  });
}

async function notifyReview(client, settings, job, post) {
  const channelId = settings.articleAutomation?.reviewChannelId;
  if (!client || !channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error(`Article review channel ${channelId} is unavailable.`);
  const gain = Number(job.facts.verifiedGainPercent).toFixed(1);
  return channel.send({
    content: `${post.status === 'publish' ? '✅ **WordPress article published**' : '📝 **WordPress draft ready — review required**'}\n**$${job.facts.symbol}** · ${job.type === 'eod' ? 'first-day recap' : `${job.milestoneGainPercent}% milestone`}\nReported entry: $${job.facts.entryPrice} · Verified high: $${job.facts.verifiedHigh} · Gain: ${gain}%\n${post.link || post.editUrl || post.guid?.rendered || ''}`,
    allowedMentions: { parse: [] },
  });
}

export async function processArticleJobs(client = null, now = new Date()) {
  const settings = await readSettings();
  const targetStatus = settings.articleAutomation?.draftOnly === false ? 'publish' : 'draft';
  await mutateJson(paths.articleJobs, [], (rows) => {
    for (const job of rows) {
      if (job.status === 'processing' && Date.now() - new Date(job.processingStartedAt || 0).getTime() > 10 * 60_000) {
        job.status = 'failed';
        job.lastError = 'Recovered a stale processing lease after restart.';
        job.nextAttemptAt = new Date().toISOString();
      }
    }
  });
  const jobs = await readJson(paths.articleJobs, []);
  const monitoredAlerts = await readJson(paths.monitoredAlerts, []);
  const maxRetries = Math.max(1, Number(settings.articleAutomation?.maxRetries || 3));
  const eligible = jobs.filter((job) => ['queued', 'failed'].includes(job.status) && (!job.nextAttemptAt || new Date(job.nextAttemptAt) <= now) && Number(job.attempts || 0) < maxRetries)
    .sort((a, b) => String(b.facts?.alertTimestamp || b.createdAt).localeCompare(String(a.facts?.alertTimestamp || a.createdAt)))
    .slice(0, Math.max(1, Number(settings.articleAutomation?.jobsPerCycle || 2)));
  if (targetStatus === 'publish' && eligible.length) {
    const access = await verifyWordPressAccess();
    if (!access.canPublishPosts) throw new Error('Configured WordPress account cannot publish posts.');
  }
  for (const job of eligible) {
    await markJob(job.id, { status: 'processing', attempts: Number(job.attempts || 0) + 1, processingStartedAt: new Date().toISOString() });
    try {
      await refreshJobFactsFromTrackedAlert(job, monitoredAlerts);
      job.facts.eligibility = verifyArticleEligibility(job.facts, { type: job.type, milestoneGainPercent: job.milestoneGainPercent });
      if (job.facts.eligibility.status !== 'eligible') {
        await markJob(job.id, { status: 'review-required', facts: job.facts, lastError: job.facts.eligibility.reason, nextAttemptAt: null });
        continue;
      }
      job.facts.calculations = articleCalculations(job.facts);
      if (targetStatus === 'publish') assertPublishableFacts(job, settings);
      const article = job.generatedArticle?.pipelineVersion === 'two-stage-v1'
        && job.generatedArticle.factsFingerprint === articleFactFingerprint(job.facts)
        && job.generatedArticle.promptVersions?.writer === ARTICLE_PROMPT_VERSIONS.writer
        && job.generatedArticle.promptVersions?.formatter === ARTICLE_PROMPT_VERSIONS.formatter ? job.generatedArticle : await generateAlertArticle(job.facts, {
        writerCheckpoint: job.writerCheckpoint,
        onWriterCheckpoint: async (checkpoint) => {
          job.writerCheckpoint = checkpoint;
          await markJob(job.id, { facts: job.facts, writerCheckpoint: checkpoint, stage: 'formatter-pending' });
        },
      });
      // Stable across prose/headline/high changes. Different alerts never share
      // an article just because their ticker and rounded percentage match.
      article.slug = `${String(job.facts.symbol).toLowerCase()}-stock-${job.alertMessageId}-${job.type === 'eod' ? 'recap' : `${job.milestoneGainPercent}pct`}`.slice(0, 59);
      validateSeoPackage(article);
      await markJob(job.id, { generatedArticle: article, facts: job.facts, openaiResponseId: article.openaiResponseId, stage: 'publish-pending' });
      const featuredImage = await ensureArticleFeaturedImage({ jobId: job.id, symbol: job.facts.symbol, settings, altText: article.imageAltText });
      const alertVisual = await ensureAlertVisualMedia({ job, settings });
      if (job.facts.universalAlertRecord && alertVisual?.sourceUrl) {
        // The WordPress media URL is the durable, public evidence reference
        // consumed by the article JSON and by the HTML evidence figure below.
        job.facts.universalAlertRecord.alert_image_url = alertVisual.sourceUrl;
        job.facts.universalAlertRecord.alert_image_metadata = {
          media_id: alertVisual.mediaId || null,
          title: alertVisual.title || '', alt_text: alertVisual.altText || '',
          caption: alertVisual.caption || '', width: alertVisual.width || null,
          height: alertVisual.height || null,
        };
        await markJob(job.id, { facts: job.facts });
      }
      const readiness = scoreArticleReadiness({
        record: job.facts.universalAlertRecord || { alert_image_url: alertVisual?.sourceUrl || null },
        article,
        visualReady: Boolean(alertVisual?.mediaId || alertVisual?.sourceUrl),
        sources: job.facts.sources || [],
      });
      job.facts.articleReadiness = readiness;
      // Drafts are review artifacts, never published by this protocol. Low
      // scores are held so an editor can resolve the stated fixes first.
      if (settings.universalArticleProtocol?.enabled && readiness.score < 80) {
        await markJob(job.id, { status: 'review-required', facts: job.facts, lastError: readiness.fixes.join(' '), nextAttemptAt: null });
        continue;
      }
      const articleContent = embedAlertVisual(article.html, alertVisual);
      validateArticleIdentityLinks(articleContent);
      validatePermanentArticleLayout(articleContent, { requireEvidence: Boolean(settings.articleAutomation?.alertVisuals?.required) });
      const prepared = await createOrUpdateArticle({
        ...article,
        content: articleContent,
        featuredMediaId: featuredImage?.mediaId || 0,
        status: 'draft',
        preservePublished: true,
      });
      const canonicalUrl = canonicalArticleUrl(article.slug);
      const schema = buildNewsArticleSchema({
        article,
        post: { ...prepared.post, link: canonicalUrl },
        imageUrl: featuredImage?.sourceUrl || '',
      });
      const optimization = await applyArticleOptimization(prepared.post.id, article, schema);
      const finalPost = targetStatus === 'publish' && prepared.post.status !== 'publish'
        ? await updateArticleById(prepared.post.id, {
          ...article, content: articleContent, featuredMediaId: featuredImage?.mediaId || 0, status: 'publish',
        })
        : prepared.post;
      const result = { ...prepared, post: finalPost };
      const packageDelivery = result.post.status === 'publish' && result.post.link && client
        ? await publishArticlePackage(client, result.post.link, settings).catch((error) => ({ error: String(error.message || error).slice(0, 300) }))
        : null;
      await completeAlertForJob(job, result.post);
      const reviewMessage = await notifyReview(client, settings, job, { ...result.post, editUrl: result.editUrl }).catch((error) => ({ error: error.message }));
      await mutateJson(paths.articleAudit, [], (rows) => rows.push({
        jobId: job.id, alertMessageId: job.alertMessageId, type: job.type, symbol: job.facts.symbol,
        massiveRequestId: job.facts.massiveRequestId, openaiResponseId: article.openaiResponseId,
        pipelineVersion: article.pipelineVersion, writerResponseId: article.writerResponseId, formatterResponseId: article.formatterResponseId,
        promptVersions: article.promptVersions, models: article.models, factsFingerprint: article.factsFingerprint, stages: article.stages,
        eligibility: job.facts.eligibility, calculations: job.facts.calculations,
        wordpressPostId: result.post.id, wordpressStatus: result.post.status, articleCreated: result.created,
        wordpressEditUrl: result.editUrl, seoTitle: article.seoTitle, metaDescription: article.metaDescription,
        focusKeyword: article.focusKeyword, secondaryKeywords: article.secondaryKeywords,
        categories: article.categories, tags: article.tags, imageAltText: article.imageAltText,
        socialPosts: article.socialPosts, newsArticleSchema: schema, optimizationApplied: Boolean(optimization?.applied),
        featuredMediaId: featuredImage?.mediaId || 0, featuredImagePath: featuredImage?.path || '',
        alertVisualMediaId: alertVisual?.mediaId || 0, alertVisualSourceUrl: alertVisual?.sourceUrl || '',
        alertVisualTitle: alertVisual?.title || '', alertVisualAltText: alertVisual?.altText || '',
        alertVisualCaption: alertVisual?.caption || '', alertVisualDescription: alertVisual?.description || '',
        shareMessageId: packageDelivery?.shareMessageId || null, engagementMessageId: packageDelivery?.engagementMessageId || null,
        packageDeliveryError: packageDelivery?.error || null,
        reviewMessageId: reviewMessage?.id || null, reviewError: reviewMessage?.error || null, completedAt: new Date().toISOString(),
      }));
      await markJob(job.id, {
        status: result.post.status === 'publish' ? 'published' : 'drafted', wordpressPostId: result.post.id, wordpressUrl: result.post.link || '', wordpressEditUrl: result.editUrl,
        featuredMediaId: featuredImage?.mediaId || 0, featuredImagePath: featuredImage?.path || '',
        alertVisualMediaId: alertVisual?.mediaId || 0, alertVisualSourceUrl: alertVisual?.sourceUrl || '',
        shareMessageId: packageDelivery?.shareMessageId || null, engagementMessageId: packageDelivery?.engagementMessageId || null,
        packageDeliveryError: packageDelivery?.error || null,
        articleCreated: result.created, completedAt: new Date().toISOString(), generatedArticle: undefined, writerCheckpoint: undefined, stage: 'complete', lastError: null, nextAttemptAt: null,
        writerResponseId: article.writerResponseId, formatterResponseId: article.formatterResponseId, pipelineVersion: article.pipelineVersion,
      });
      console.log(`WordPress ${result.post.status} article ${result.post.id} ready for $${job.facts.symbol} (${job.type}).`);
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      const delayMinutes = Math.min(60, 5 * (2 ** (attempts - 1)));
      await markJob(job.id, {
        // A rejected AI output has not reached WordPress, so let the bounded
        // retry policy request a corrected draft. Evidence and review faults
        // remain blocked for a human.
        status: (error.retryable === false && error.code !== 'output_invalid') || error.code === 'review_required' || error.code === 'facts_invalid' ? 'review-required' : 'failed', lastError: String(error.message || error).slice(0, 500),
        stage: error.stage || 'publication',
        nextAttemptAt: error.retryable === false ? null : new Date(Date.now() + delayMinutes * 60_000).toISOString(),
      });
      console.error(`Article job ${job.id} failed safely:`, error.message || error);
    }
  }
  return eligible.length;
}

export async function runArticleAutomationCycle(client = null, { force = false, now = new Date() } = {}) {
  if (cycleRunning) return { skipped: 'cycle-already-running' };
  cycleRunning = true;
  try {
    const settings = await readSettings();
    if (!settings.articleAutomation?.enabled) return { skipped: 'disabled' };
    if (!force && !withinExtendedSession(now, settings.alertMonitor?.extendedSession)) {
      await processArticleJobs(client, now);
      return { skipped: 'outside-extended-session' };
    }
    const queued = await updateMarketTracking(now);
    const processed = await processArticleJobs(client, now);
    return { queued: queued.length, processed };
  } finally {
    cycleRunning = false;
  }
}

export function startArticleAutomation(client, configuredIntervalSeconds = 120) {
  if (timer) return timer;
  const intervalSeconds = Math.max(60, Number(process.env.ARTICLE_POLL_SECONDS || configuredIntervalSeconds));
  runArticleAutomationCycle(client, { force: true }).catch((error) => console.error('Initial article automation cycle failed safely:', error));
  timer = setInterval(() => runArticleAutomationCycle(client).catch((error) => console.error('Article automation cycle failed safely:', error)), intervalSeconds * 1000);
  timer.unref?.();
  return timer;
}
