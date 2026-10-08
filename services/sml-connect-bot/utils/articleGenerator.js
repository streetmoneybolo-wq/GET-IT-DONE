import { canonicalFocusKeyword, cleanSlug, validateSeoPackage } from './articleSeoPolicy.js';
import { assertCashtaggedText, cashtagText } from './tickers.js';

import { generateTwoStageArticle } from './articleAiPipeline.js';
import { embedAlertVisual } from './articleAlertVisual.js';

const GRANDMASTER_URL = 'https://stockmarketloop.com/go/twitter-obi-7oua/';
const DISCORD_URL = 'https://discord.gg/DBFuRWEYe7';
const GRANDMASTER_LINK = `<a href="${GRANDMASTER_URL}" target="_blank" rel="author noopener noreferrer">Grandmaster-OBI</a>`;
const DISCORD_LINK = `<a href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer nofollow sponsored">Making Easy Money Discord</a>`;
const DISCLAIMER = `<strong>Disclaimer:</strong> This article is for informational and educational purposes only and does not constitute financial or investment advice. Alert prices, timestamps, intraday highs and performance figures described as supplied records should be independently verified. Hypothetical returns assume ideal execution at exact stated prices and exclude taxes, commissions, bid-ask spreads, slippage, liquidity limitations, partial fills and trading halts. Nothing in this article establishes that ${GRANDMASTER_LINK} or the ${DISCORD_LINK} caused any security to rise. Past performance does not guarantee future results.`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function tickerLink(symbol) {
  const safe = encodeURIComponent(symbol.toUpperCase());
  return `<a class="sml-ticker-link" href="https://stockmarketloop.com/stock-chart/?symbol=${safe}" title="View ${safe} stock price, chart and discussion on StockMarketLoop">$${escapeHtml(safe)}</a>`;
}

function identityLinks(escapedText) {
  return String(escapedText)
    .replace(/grandmaster(?:[-_]|\s)+obi/gi, GRANDMASTER_LINK)
    .replace(/making easy money discord/gi, DISCORD_LINK);
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
}

function percent(value) {
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

function centralTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

function safeParagraph(text, symbol) {
  const escaped = identityLinks(escapeHtml(text));
  const symbols = Array.isArray(symbol) ? symbol : [symbol];
  return escaped.replace(/\$([A-Z][A-Z0-9.-]*)\b/g, (match, value) => symbols.includes(value) ? tickerLink(value) : match);
}

function articleSymbols(facts) {
  return [...new Set([facts.symbol, ...(facts.roundup?.records || []).map((row) => row.symbol)])];
}

export function validateArticleIdentityLinks(content) {
  const body = String(content || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  const visible = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const rules = [
    { label: 'Grandmaster-OBI', url: GRANDMASTER_URL },
    { label: 'Making Easy Money Discord', url: DISCORD_URL },
  ];
  for (const rule of rules) {
    const count = visible.split(rule.label).length - 1;
    const linked = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter((match) => {
      const text = match[2].replace(/<[^>]+>/g, '').trim();
      const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1] || '';
      return text === rule.label && href === rule.url;
    }).length;
    if (count < 5 || linked !== count) throw new Error(`Article identity-link gate failed for ${rule.label}: ${count} visible, ${linked} correctly linked.`);
  }
  return true;
}

// Preserve both AI stages' actual copy; normalize ticker typography only.
function normalizeTickerSpelling(sections, facts) {
  const tickers = articleSymbols(facts);
  const result = structuredClone(sections);
  for (const key of ['headline', 'seoTitle', 'newsTitle', 'dek', 'excerpt', 'metaDescription', 'focusKeyword', 'imageAltText', 'imageTitle', 'imageCaption', 'imageDescription', 'contextHeading', 'conclusionHeading', 'bottomLine']) result[key] = cashtagText(result[key], tickers);
  for (const key of ['secondaryKeywords', 'tags', 'openingParagraphs', 'contextParagraphs', 'riskPoints']) result[key] = (result[key] || []).map((value) => cashtagText(value, tickers));
  result.faq = result.faq.map((row) => ({ question: cashtagText(row.question, tickers), answer: cashtagText(row.answer, tickers) }));
  result.additionalSections = result.additionalSections.map((row) => ({ heading: cashtagText(row.heading, tickers), paragraphs: row.paragraphs.map((paragraph) => cashtagText(paragraph, tickers)) }));
  for (const value of Object.values(result.socialPosts)) { value.text = cashtagText(value.text, tickers); value.cta = cashtagText(value.cta, tickers); }
  return result;
}

function safeSourceLinks(facts) {
  return (Array.isArray(facts.sources) ? facts.sources : []).filter((source) => {
    if (source?.verified !== true) return false;
    try {
      const url = new URL(source.url);
      return url.protocol === 'https:' && !url.username && !url.password && ![...url.searchParams.keys()].some((key) => /token|key|secret|auth/i.test(key));
    } catch { return false; }
  });
}

export function buildArticleHtml({ sections, facts }) {
  const symbol = articleSymbols(facts);
  const primarySymbol = facts.symbol;
  const ticker = tickerLink(primarySymbol);
  const paragraphs = (rows) => rows.map((row) => `<p>${safeParagraph(row, symbol)}</p>`).join('\n');
  const faq = sections.faq.map((row) => `<h3>${safeParagraph(row.question, symbol)}</h3><p>${safeParagraph(row.answer, symbol)}</p>`).join('\n');
  const risks = sections.riskPoints.map((row) => `<li>${safeParagraph(row, symbol)}</li>`).join('');
  const hypothetical = facts.calculations?.hypotheticalValue ?? 1000 * (facts.verifiedHigh / facts.entryPrice);
  const profit = facts.calculations?.hypotheticalProfit ?? hypothetical - 1000;
  const multiple = facts.calculations?.priceMultiple ?? facts.verifiedHigh / facts.entryPrice;
  const focus = escapeHtml(sections.focusKeyword || canonicalFocusKeyword(primarySymbol));
  const target = Number.isFinite(facts.targetPrice) ? ` and a target of ${money(facts.targetPrice)}${facts.targetIsMinimum ? ' or higher' : ''}` : '';
  const latest = Number.isFinite(facts.latestPrice) && facts.latestPriceAt ? `<tr><th scope="row">Latest captured price (not streaming)</th><td>${money(facts.latestPrice)} · ${escapeHtml(centralTime(facts.latestPriceAt))}</td></tr>` : '';
  const sourceRows = [facts, ...(facts.roundup?.records || []).flatMap((row) => [row, row.facts || {}])].flatMap(safeSourceLinks);
  for (const row of facts.roundup?.records || []) {
    const record = row.facts;
    const guild = record?.discordGuildId || row.message?.guildId;
    const channel = record?.discordChannelId || row.message?.channelId;
    const id = record?.discordMessageId || row.message?.id;
    if ([guild, channel, id].every((value) => /^\d{17,20}$/.test(value || ''))) sourceRows.push({ url: `https://discord.com/channels/${guild}/${channel}/${id}`, title: `${row.symbol} Discord source record${row.status === 'edited_entry_unverified' ? ' (edited; entry chronology unverified)' : ''}`, verified: true });
  }
  const sourceLinks = [...new Map(sourceRows.map((row) => [row.url, row])).values()].map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cashtagText(source.title || 'Supporting source', symbol))}</a></li>`).join('');
  const additionalSections = (sections.additionalSections || []).map((section, index) => `<h2 id="roundup-section-${index + 1}">${safeParagraph(section.heading, symbol)}</h2>${paragraphs(section.paragraphs)}`).join('\n');
  const roundupTable = facts.roundup ? `<section aria-labelledby="roundup-overview"><h2 id="roundup-overview">Four-stock alert review</h2>${facts.roundup.records.map((row) => {
    if (row.status === 'edited_entry_unverified') return `<div class="sml-roundup-record"><h3>${tickerLink(row.symbol)}</h3><p><strong>Entry record:</strong> Entry chronology unverified after edit.<br><strong>Observed price:</strong> ${money(row.observations[0].price)} · ${escapeHtml(centralTime(row.observations[0].at))}.<br><strong>Interpretation:</strong> Market observation only; no verified alert-to-high return.</p></div>`;
    const record = row.facts;
    return `<div class="sml-roundup-record"><h3>${tickerLink(row.symbol)}</h3><p><strong>Entry record:</strong> ${money(record.entryPrice)} · ${escapeHtml(centralTime(record.alertTimestamp))}.<br><strong>Observed high:</strong> ${money(record.verifiedHigh)} · ${escapeHtml(centralTime(record.verifiedHighAt))}.<br><strong>Price comparison:</strong> ${percent(record.verifiedGainPercent)} price change, not a realized trade${row.laterHigh ? `.<br><strong>Later historical context:</strong> Sixth-session high of ${money(row.laterHigh.price)} at ${escapeHtml(centralTime(row.laterHigh.at))} (${percent(row.laterHigh.gainPercent)} from entry), outside the original five-session comparison` : ''}.</p></div>`;
  }).join('')}<p>These are selected historical observations, not a complete trading record. The figures are frozen at the stated timestamps; current quotes may differ.</p></section>` : '';
  return `
<article class="sml-alert-report" data-sml-article-layout="permanent-v1" data-symbol="${escapeHtml(primarySymbol.toUpperCase())}">
  <p class="sml-article-kicker">Retail Trader Spotlight</p>
  <p class="sml-dek sml-article-subtitle">${safeParagraph(sections.dek, symbol)}</p>
  <p><strong>By Retail Trader Spotlight · StockMarketLoop</strong></p>
  <p><strong>Alert source:</strong> ${GRANDMASTER_LINK} · <strong>Community record:</strong> ${DISCORD_LINK}</p>
  <nav class="sml-article-toc" aria-label="Table of contents"><strong>Table of contents</strong><ol><li><a href="#verified-performance">Verified performance</a></li><li><a href="#alert-record">Alert record</a></li><li><a href="#market-context">Market context</a></li><li><a href="#risk-considerations">Risk considerations</a></li><li><a href="#frequently-asked-questions">Frequently asked questions</a></li></ol></nav>
  ${paragraphs(sections.openingParagraphs)}
  ${roundupTable}
  <h2 id="verified-performance">${focus}: alert-to-high market timeline</h2>
  <table><tbody>
    <tr><th scope="row">Reported alert entry</th><td>${money(facts.entryPrice)}</td></tr>
    <tr><th scope="row">Market-data high</th><td>${money(facts.verifiedHigh)}</td></tr>
    <tr><th scope="row">Alert-to-high gain</th><td class="sml-up">${percent(facts.verifiedGainPercent)}</td></tr>
    <tr><th scope="row">Price multiple</th><td>${multiple.toFixed(2)}×</td></tr>
    <tr><th scope="row">Hypothetical $1,000 value</th><td class="sml-up">${money(hypothetical)}</td></tr>
    <tr><th scope="row">Hypothetical profit before costs</th><td class="sml-up">${money(profit)}</td></tr>
    <tr><th scope="row">Market-data high time</th><td>${escapeHtml(centralTime(facts.verifiedHighAt))}</td></tr>
    ${latest}
  </tbody></table>
  <figure class="sml-alert-comparison" aria-label="Reported entry compared with the observed high">
    <svg viewBox="0 0 400 96" role="img" aria-label="Reported entry ${escapeHtml(money(facts.entryPrice))}; observed high ${escapeHtml(money(facts.verifiedHigh))}"><title>Reported entry and observed high</title><rect x="0" y="4" width="${Math.max(1, Math.min(400, 400 * facts.entryPrice / facts.verifiedHigh)).toFixed(2)}" height="32" fill="#3b82f6"/><rect x="0" y="52" width="400" height="32" fill="#10b981"/></svg>
    <figcaption>Reported entry ${money(facts.entryPrice)} (blue) and observed high ${money(facts.verifiedHigh)} (green). Historical comparison; full figures and timestamps appear in the table above.</figcaption>
  </figure>
  <section class="sml-live-market" data-sml-market-pulse data-symbol="${escapeHtml(primarySymbol.toUpperCase())}" data-entry="${escapeHtml(facts.entryPrice)}" data-high="${escapeHtml(facts.verifiedHigh)}" aria-label="Live $${escapeHtml(primarySymbol.toUpperCase())} price action">
    <div class="sml-pulse-loading"><i></i><strong>$${escapeHtml(primarySymbol.toUpperCase())} price action</strong><span>The timestamped historical figures above remain available while the current market panel loads.</span></div>
  </section>
  <p><em>The $1,000 calculation is hypothetical and assumes exact execution at the reported entry and verified high, which is generally unrealistic.</em></p>
  <h2 id="alert-record">${focus}: reported alert record</h2>
  <p>According to the Discord alert record supplied for this article, ${GRANDMASTER_LINK} posted ${ticker} in the ${DISCORD_LINK} with an entry of ${money(facts.entryPrice)}${target} at ${escapeHtml(centralTime(facts.alertTimestamp))}. The record establishes the alert text and time; it does not establish member executions or causation.</p>
  <h2 id="market-context">${safeParagraph(sections.contextHeading || `${sections.focusKeyword || canonicalFocusKeyword(primarySymbol)}: company and market context`, symbol)}</h2>
  <p>${ticker} represents ${escapeHtml(cashtagText(facts.companyName, symbol))}${facts.exchange ? `, listed on ${escapeHtml(facts.exchange)}` : ''}.</p>
  <p>The source attribution identifies ${GRANDMASTER_LINK} as the alert author and the ${DISCORD_LINK} as the distribution venue. That attribution documents provenance; it is not evidence that either caused the subsequent market move.</p>
  ${paragraphs(sections.contextParagraphs)}
  ${additionalSections}
  <p>Readers can compare this verified move with the company’s official market listing and disclosures through <a href="https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(primarySymbol.toLowerCase())}" target="_blank" rel="noopener">Nasdaq market activity</a>.</p>
  ${sourceLinks ? `<aside class="sml-article-sources"><h3>Related reporting and market records</h3><ul>${sourceLinks}</ul></aside>` : ''}
  <h2 id="risk-considerations">${focus}: risk considerations</h2><ul>${risks}</ul>
  <p>Readers evaluating the record associated with ${GRANDMASTER_LINK} and the ${DISCORD_LINK} should consider spreads, liquidity, volatility halts and whether the quoted entry was realistically available.</p>
  <h2 id="frequently-asked-questions">Frequently asked questions about ${focus}</h2>${faq}
  <h2>${safeParagraph(sections.conclusionHeading || `What comes next for ${sections.focusKeyword || canonicalFocusKeyword(primarySymbol)}`, symbol)}</h2><p>${safeParagraph(sections.bottomLine, symbol)}</p>
  <p><strong>Follow the source:</strong> View ${GRANDMASTER_LINK} on X and visit the ${DISCORD_LINK}. These promotional links remain clearly separated from the reported market facts.</p>
  <aside class="sml-market-links" aria-labelledby="sml-market-links-heading">
    <h2 id="sml-market-links-heading">Track the ${symbol.length > 1 ? 'tickers' : 'ticker'} in this story</h2>
    <ul>${symbol.map((item) => `<li><a href="https://stockmarketloop.com/stock-chart/?symbol=${encodeURIComponent(item.toUpperCase())}">$${escapeHtml(item.toUpperCase())} price, chart, news and sentiment</a></li>`).join('')}</ul>
  </aside>
  <aside class="sml-trust-box" aria-label="Article transparency">
    <p><strong>By Stock Market Loop</strong> · Alert recorded ${escapeHtml(centralTime(facts.alertTimestamp))} · Market-data high recorded ${escapeHtml(centralTime(facts.verifiedHighAt))}</p>
    <p>${safeParagraph(facts.publicationDisclosure || 'This coverage contains promotional links to the featured trader and community. Selected alerts do not represent a complete performance record.', symbol)}</p>
    <p>${DISCLAIMER}</p>
  </aside>
</article>
<script id="sml-article-engagement-placement">(()=>{let tries=0;const place=()=>{const bar=document.querySelector('.sml-hfe-article-target');const root=document.querySelector('.sml-alert-report');const title=root?.querySelector('h1')||document.querySelector('h1.wp-block-post-title');if(bar&&title){bar.classList.add('sml-news-engagement');title.insertAdjacentElement('afterend',bar);return true}return false};const run=()=>{if(place()||++tries>8)return;setTimeout(run,250)};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',run,{once:true}):run()})();</script>`;
}

// Opt-in newsroom layout: source illustrations accompany the story instead of
// forcing the reader through a duplicated audit table, methodology and FAQ.
export function buildNewsFeatureHtml({ sections, facts, media = [] }) {
  const symbols = articleSymbols(facts);
  const paragraph = (value) => `<p>${safeParagraph(value, symbols)}</p>`;
  const articles = sections.additionalSections.map((section) => {
    const symbol = symbols.find((item) => new RegExp(`\\b${item}\\b`).test(section.heading));
    if (!symbol) throw new Error('News feature sections must identify their source ticker.');
    const image = media.find((row) => row.symbol === symbol);
    if (!image) throw new Error(`Missing news feature source image for ${symbol}.`);
    return `<section aria-labelledby="story-${symbol.toLowerCase()}"><h2 id="story-${symbol.toLowerCase()}">${safeParagraph(section.heading, symbols)}</h2>${paragraph(section.paragraphs[0])}${embedAlertVisual('', image)}${section.paragraphs.slice(1).map(paragraph).join('\n')}</section>`;
  }).join('\n');
  return `<article class="sml-alert-report" data-sml-article-layout="permanent-v1" data-sml-story-format="news-feature-v1" data-symbol="${escapeHtml(facts.symbol)}">
<p class="sml-dek sml-article-subtitle">${safeParagraph(sections.dek, symbols)}</p>
${sections.openingParagraphs.map(paragraph).join('\n')}
${articles}
${paragraph(sections.bottomLine)}
<aside class="sml-trust-box" aria-label="Disclosure"><p>${safeParagraph('Disclosure: This coverage contains promotional links to Grandmaster-OBI and the Making Easy Money Discord. The price comparisons are historical, not realized trading returns or a complete track record. The alerts have not been established as the cause of the moves. Small-cap trading carries substantial risks, including losses, wide spreads, illiquidity and trading halts. This is not investment advice.', symbols)}</p></aside>
<section class="sml-live-market" data-sml-market-pulse data-symbol="${escapeHtml(facts.symbol)}" data-entry="${escapeHtml(facts.entryPrice)}" data-high="${escapeHtml(facts.verifiedHigh)}" aria-label="Current market data separate from historical article"><div class="sml-pulse-loading"><strong>Current ${tickerLink(facts.symbol)} market data</strong><span>Current quotes are separate from the dated prices in the article.</span></div></section>
<aside class="sml-market-links"><p><strong>Charts:</strong> ${symbols.map(tickerLink).join(' · ')}</p></aside>
</article>
<script id="sml-article-engagement-placement">(()=>{let n=0;const run=()=>{const b=document.querySelector('.sml-hfe-article-target');const h=document.querySelector('h1.wp-block-post-title');if(b&&h){b.classList.add('sml-news-engagement');h.insertAdjacentElement('afterend',b);return}if(++n<8)setTimeout(run,250)};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',run,{once:true}):run()})();</script>`;
}

export function validatePermanentArticleLayout(content, { requireEvidence = false } = {}) {
  const html = String(content || '');
  const newsFeature = /<article\b[^>]*data-sml-story-format="news-feature-v1"/.test(html);
  const required = [
    ['permanent article root', /<article\b[^>]*class=["'][^"']*\bsml-alert-report\b[^"']*["'][^>]*data-sml-article-layout=["']permanent-v1["']/i],
    ['article symbol', /<article\b[^>]*data-symbol=["'][A-Z][A-Z0-9.\-]{0,9}["']/i],
    ['SEO subtitle', /class=["'][^"']*\bsml-article-subtitle\b/i],
    ...(newsFeature ? [['news sections', /<section\b[^>]*aria-labelledby="story-[a-z]+"/]] : [
      ['table of contents', /class=["'][^"']*\bsml-article-toc\b/i],
      ['row-scoped stat table', /<th\b[^>]*scope=["']row["']/i],
    ]),
    ['ticker link', /class=["'][^"']*\bsml-ticker-link\b/i],
    ['market links', /class=["'][^"']*\bsml-market-links\b/i],
    ['trust box', /class=["'][^"']*\bsml-trust-box\b/i],
    ['live market pulse', /data-sml-market-pulse/i],
    ['engagement placement', /id=["']sml-article-engagement-placement["']/i],
  ];
  if (requireEvidence) required.push(['alert evidence', /class=["'][^"']*\bsml-alert-evidence\b/i]);
  const missing = required.filter(([, pattern]) => !pattern.test(html)).map(([label]) => label);
  if (missing.length) throw new Error(`Permanent article layout gate failed: missing ${missing.join(', ')}.`);
  if (newsFeature && /<table\b|sml-article-toc|id="frequently-asked-questions"/i.test(html)) throw new Error('News feature layout must not contain audit tables, a contents panel or FAQ.');
  if (/<style\b/i.test(html)) throw new Error('Permanent article layout gate failed: article content must not carry page-level inline CSS.');
  return true;
}

export async function generateAlertArticle(facts, options = {}) {
  const result = await generateTwoStageArticle(facts, options);
  const { responseId, model } = result;
  const sections = normalizeTickerSpelling(result.sections, facts);
  const article = {
    title: sections.headline,
    seoTitle: sections.seoTitle,
    newsTitle: sections.newsTitle,
    excerpt: sections.excerpt,
    metaDescription: sections.metaDescription,
    focusKeyword: sections.focusKeyword,
    secondaryKeywords: sections.secondaryKeywords,
    slug: cleanSlug(sections.urlSlug),
    categories: sections.categories,
    tags: sections.tags,
    imageAltText: sections.imageAltText,
    imageTitle: sections.imageTitle,
    imageCaption: sections.imageCaption,
    imageDescription: sections.imageDescription,
    socialPosts: sections.socialPosts,
    html: buildArticleHtml({ sections, facts }),
    openaiResponseId: responseId,
    model,
    writerResponseId: result.writerResponseId,
    formatterResponseId: result.formatterResponseId,
    models: result.models,
    promptVersions: result.promptVersions,
    factsFingerprint: result.factsFingerprint,
    pipelineVersion: result.pipelineVersion,
    stages: result.stages,
  };
  const tickers = articleSymbols(facts);
  for (const [label, value] of Object.entries({ title: article.title, seoTitle: article.seoTitle, newsTitle: article.newsTitle, excerpt: article.excerpt, metaDescription: article.metaDescription, focusKeyword: article.focusKeyword, imageAltText: article.imageAltText })) {
    assertCashtaggedText(value, tickers, `article ${label}`);
  }
  const visibleArticle = article.html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  assertCashtaggedText(visibleArticle, tickers, 'article body');
  for (const [platform, post] of Object.entries(article.socialPosts || {})) assertCashtaggedText(`${post.text} ${post.cta}`, tickers, `${platform} article social copy`);
  validateArticleIdentityLinks(article.html);
  validateReaderFacingArticle(article.html);
  validatePermanentArticleLayout(article.html);
  if (!article.html.includes('id="sml-article-engagement-placement"')) throw new Error('Article engagement controls must be placed directly beneath the visible headline.');
  validateSeoPackage(article);
  return article;
}

export function validateReaderFacingArticle(content) {
  const visible = String(content || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const forbidden = [
    /\brequest id\b/i,
    /\bopenapi\b/i,
    /\bmassive adjusted\b/i,
    /\bmodel id\b/i,
    /\bsystem instruction\b/i,
    /\bimage file name\b/i,
    /\bimage title\b/i,
    /\balt text\b/i,
    /\bseo keywords?\b/i,
    /\bjson-ld\b/i,
    /\bprivate audit\b/i,
    /\bautomated report\b/i,
    /\bfactLedger\b/i,
    /\bpipelineVersion\b/i,
    /\beligibility check\b/i,
    /\bpsychological hook\b/i,
  ];
  const match = forbidden.find((rule) => rule.test(visible));
  if (match) throw new Error(`Reader-facing article exposed internal production material: ${match}`);
  return true;
}
