'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./academy-story-engine');
const D = require('./academy-article-desk');

function daily(n, start = 10) { const out = []; let p = start; for (let i = 0; i < n; i++) { const o = p, c = p * (1 + Math.sin(i / 4) * 0.02 + 0.002); out.push({ t: Date.UTC(2026, 7, 1) + i * 86_400_000, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c, v: 2e6 + i * 1000 }); p = c; } return out; }

const bars = daily(90);
const base = { symbol: 'ABCD', name: 'Abcd Robotics', price: 12.4, changePct: 6.2, relVol: 2.8, adv: 4_000_000, daily: bars, direction: { label: 'Lean bullish', bias: 28 },
  gamma: { available: true, regime: 'negative', pressurePct: 31, pressure: 'high', flipStrike: 11.8, flipDistancePct: -4.8, flipIsApproximate: false, callWall: { strike: 13, distancePct: 4.8 }, putWall: { strike: 11, distancePct: 11 }, zeroDteShare: 0.35 },
  short: { ratio: 0.52, baselineRatio: 0.41, daysToCover: 4.2, shortInterestPct: 18 }, tape: { sweepBuy: 5, sweepSell: 1, blockBuy: 2, blockSell: 0, offSharePct: 58, typicalSharePct: 42, absorption: true },
  smc: { structure: [{ type: 'BOS', dir: 1, level: 12.1 }], sweeps: [{ kind: 'EQL', level: 10.9 }], fvgs: [], orderBlocks: [{ dir: 1, top: 11.6, bottom: 11.2 }], range: { hi: 13.2, lo: 10.5, pos: 0.7 }, vwap: { level: 11.9, above: true }, openLiquidity: [{ kind: 'EQH', level: 13.4, count: 2 }] },
  earnings: { daysAway: 6, date: '2026-10-27', timing: 'AMC', impliedPct: 9.5, histAvgMovePct: 12 } };
const dossier = {
  intent: { ok: true, intent: { phase: 'accumulation', side: 'buyers', strength: 64, evidence: [{ w: 1, text: 'Absorption at 12.10: 3x displayed size refilled.' }, { w: 0.8, text: 'VPIN 0.44 (informed).' }], read: 'Smart money is accumulating: absorbing sells, refilling bids.' }, formulas: { vpin: { ok: true, vpin: 0.44, band: 'informed' }, lambda: { ok: true, lambda: 1.2, band: 'absorbing' }, persistence: { ok: true, acf: 0.3, band: 'worked order' }, darkPool: { ok: true, dix: 0.58 } }, map: { levels: [{ price: 12.1, labels: ['iceberg bid', 'order block'] }, { price: 13, labels: ['call wall'] }] }, glossary: { vpin: 'VPIN: toxicity of the tape.', map: 'Liquidity map: levels the feeds agree on.' } },
  shortInsight: { ok: true, available: true, model: { score: 71, fuel: { score: 60, floatBand: { label: 'low float' } } }, pressing: { score: 22 }, interest: { daysToCover: 4.2, shortInterest: 9_500_000, siChangePct: 11 }, shortVsPrice: { avgRatio: 0.52, rows: [] }, verdict: { long: { call: 'squeeze candidate: fuel and a spark', invalidation: 'a close under the 20-day low (10.9)' }, shortSeller: { call: 'stand aside: this is a crowded short that is being bought' } }, tape: { sweepBuy: 5, sweepSell: 1 } },
  earningsInsight: { ok: true, available: true, signals: [{ key: 'growth', tone: 'up', text: 'Revenue grew 24% year over year last quarter.' }], model: { revenue: 1.2e9, eps: 0.42 }, street: { revenueEstimate: 1.15e9 } },
  darkPool: { available: true, offSharePct: 58, typicalSharePct: 42, read: { headline: 'HEAVY: $4.1M block at $12.05', steps: [{ k: 'WHAT PRINTED', text: 'Biggest single off-exchange print: 340,000 shares at $12.05.' }, { k: 'THE SESSION', text: '58% of today\'s volume printed off-exchange.' }] } },
  sentiment: { available: true, scorePct: 66, label: 'lean bullish', coverage: 80, notes: ['Mentions are running about 2.1x this ticker\'s normal pace.'], components: { social: { available: true, crowdedLong: false } } },
  filings: { available: true, cik: '0001234567', label: 'insiders buying', insiders: { buys: 3, sells: 1 }, activistRecent: 1 },
  company: { name: 'Abcd Robotics', homepage_url: 'https://abcd.example', sic_description: 'Robotics', market_cap: 2e9 },
  news: [{ title: 'Abcd lands a contract', url: 'https://news.example/1' }], alerts: [], patterns: { count: 2, charts: [{ name: 'Bull flag' }], candles: [{ name: 'Hammer' }], trend: { dir: 'up' } }
};
const story = () => E.rankStories([base])[0];
const compose = (over = {}) => D.composeArticle({ story: story(), c: base, dossier, asOf: Date.UTC(2026, 9, 19, 14, 30), author: 'Vaughn McNair', publication: 'Making Easy Money', siteUrl: 'https://stockmarketloop.com', authorUrl: 'https://stockmarketloop.com/n/grandmasterobi/', chartEndpoint: 'https://sml-platform-api.onrender.com/academy-activity/article-chart', discordUrl: 'https://discord.gg/makingeasymoney', url: 'https://stockmarketloop.com/n/grandmasterobi/abcd/', imageUrl: 'https://stockmarketloop.com/wp-content/uploads/p.png', ...over });

test('a topic or a ticker resolves to a subject', () => {
  assert.deepEqual(D.resolveSubject('$nvda'), { symbol: 'NVDA', topic: null, label: '$NVDA' });
  assert.deepEqual(D.resolveSubject('oil'), { symbol: 'USO', topic: 'crude oil', label: 'crude oil' });
  assert.equal(D.resolveSubject('the fed').symbol, 'TLT'); assert.equal(D.resolveSubject('Fed').symbol, 'TLT');
  assert.equal(D.resolveSubject('something long and weird!!'), null); assert.equal(D.resolveSubject(''), null);
});

test('the composed piece reads the whole dossier: every desk section, the modules, the sources, no machine tells', () => {
  const a = compose();
  for (const s of ['What the data says', 'What the smart money is doing', 'The dark-pool tape', "The short seller's problem", 'Options: what the dealers have to do', 'The earnings angle', 'Why it matters: the mechanism', 'The speculation', 'The bull case and the bear case', 'What kills it', 'What to watch next session', 'The crowd', 'Insiders and filings', 'On the chart', 'Bottom line', 'Questions readers ask', 'Keep reading', 'Glossary', 'Sources']) assert.ok(a.sections.includes(s), 'section ' + s);
  assert.deepEqual(a.modules, ['board', 'chart', 'meters', 'tabs', 'countdown', 'bullbear', 'tracker', 'killswitch', 'poll']);
  assert.ok(a.wordCount >= 1100, 'long enough: ' + a.wordCount); assert.ok(a.readMinutes >= 5);
  assert.match(a.bodyHtml, /<svg class="mem-chart"/); assert.match(a.bodyHtml, /data-live-endpoint="https:\/\/sml-platform-api\.onrender\.com\/academy-activity\/article-chart"/); assert.match(a.bodyHtml, /class="mem-gauge"/);
  assert.match(a.bodyHtml, /Smart money is accumulating/); assert.match(a.bodyHtml, /VPIN 0\.44 \(informed\)/); assert.match(a.bodyHtml, /HEAVY: \$4\.1M block/); assert.match(a.bodyHtml, /Squeeze risk scores <strong>71 of 100<\/strong>/); assert.match(a.bodyHtml, /Revenue grew 24%/); assert.match(a.bodyHtml, /insiders buying/); assert.match(a.bodyHtml, /Bull flag, Hammer/);
  assert.match(a.bodyHtml, /class="mem-tabs"/); assert.match(a.bodyHtml, /<input type="radio" name="mem-tab-\d+"/); assert.match(a.bodyHtml, /THE BULL CASE/); assert.match(a.bodyHtml, /THE BEAR CASE/); assert.match(a.bodyHtml, /KILL SWITCH/); assert.match(a.bodyHtml, /EARNINGS COUNTDOWN/); assert.match(a.bodyHtml, /YOUR CALL ON \$ABCD/); assert.match(a.bodyHtml, /SHARE THIS READ/); assert.match(a.bodyHtml, /LABELLED SPECULATION/);
  for (const h of ['https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001234567', 'https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files', 'https://www.nasdaq.com/market-activity/stocks/abcd/short-interest', 'https://www.cboe.com/delayed_quotes/abcd/quote_table', 'https://www.investor.gov/introduction-investing/investing-basics/glossary/short-sales', 'https://abcd.example', 'https://stockmarketloop.com/stocks/abcd/', 'https://discord.gg/makingeasymoney']) assert.ok(a.links.some((l) => l.startsWith(h)), 'link ' + h);
  assert.match(a.bodyHtml, /<a href="https:\/\/www\.sec\.gov[^"]+" rel="noopener" target="_blank">/); assert.ok(!/href="https:\/\/stockmarketloop\.com\/stocks\/abcd\/" rel=/.test(a.bodyHtml), 'internal links carry no noopener');
  const text = a.bodyHtml.replace(/<script>[\s\S]*<\/script>/, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
  assert.ok(!/—/.test(text), 'no em dash'); assert.ok(!/\b(delve|tapestry|landscape|in conclusion|it is important to note|as an AI)\b/i.test(text), 'no machine phrases');
  assert.ok(!/earn money|guaranteed|guarantee\b/i.test(text), 'no promises');
  assert.equal((a.bodyHtml.match(/<script/g) || []).length, 1, 'one enhancement script at the end'); assert.ok(a.js.includes('localStorage') && a.js.includes('data-live-endpoint') && !/<\/script/.test(a.js));
  assert.ok(a.faq.length >= 4 && a.faq.every((f) => f.q.includes('$ABCD') || f.q.includes('Abcd')));
});

test('the head carries the title, description, canonical, social tags and NewsArticle + FAQPage + BreadcrumbList JSON-LD; the document is one page', () => {
  const a = compose();
  assert.match(a.headHtml, /^<title>[^<]{10,60}<\/title>/); assert.match(a.headHtml, /<meta name="description" content="[^"]{110,155}">/); assert.match(a.headHtml, /<link rel="canonical" href="https:\/\/stockmarketloop\.com\/n\/grandmasterobi\/abcd\/">/);
  assert.match(a.headHtml, /property="og:image" content="https:\/\/stockmarketloop\.com\/wp-content\/uploads\/p\.png"/); assert.match(a.headHtml, /name="twitter:card" content="summary_large_image"/); assert.match(a.headHtml, /name="news_keywords"/); assert.match(a.headHtml, /property="article:tag" content="ABCD"/);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(a.headHtml)[1]);
  assert.deepEqual(ld.map((x) => x['@type']), ['NewsArticle', 'FAQPage', 'BreadcrumbList']);
  assert.equal(ld[0].about.tickerSymbol, 'ABCD'); assert.equal(ld[0].author.name, 'Vaughn McNair'); assert.ok(ld[0].wordCount > 1000); assert.ok(ld[1].mainEntity.length >= 4); assert.equal(ld[2].itemListElement[2].name, '$ABCD');
  assert.match(a.document, /^<!doctype html>\n<html lang="en">/); assert.ok(a.document.includes(a.headHtml) && a.document.includes(a.css) && a.document.includes(a.bodyHtml));
  assert.ok(a.css.includes('.mem-article{') && a.css.includes('.mem-tabs') && !/url\(|@import/.test(a.css), 'self-contained css');
  assert.equal(a.slug.length > 10, true); assert.equal(a.seo.meta_title.length <= 60, true);
});

test('the Loop Letters blocks carry the prose as reader blocks and each module as custom code with the stylesheet', () => {
  const a = compose();
  const types = a.blocks.map((b) => b.type);
  assert.equal(types[0], 'custom_code'); assert.ok(types.filter((t) => t === 'custom_code').length === a.modules.length);
  assert.ok(a.blocks.some((b) => b.type === 'heading' && b.text === 'What the smart money is doing')); assert.ok(a.blocks.some((b) => b.type === 'list'));
  /* the letters sanitizer drops svg, iframe, script, input and details: no module block may depend on them */
  for (const b of a.blocks.filter((x) => x.type === 'custom_code')) assert.ok(!/<svg|<iframe|<script|<input|<details|style="/.test(b.html), b.id + ' is sanitizer-safe');
  const chartBlock = a.blocks.find((b) => b.id === 'mod-chart'); assert.match(chartBlock.html, /<img src="https:\/\/stockmarketloop\.com\/wp-content\/uploads\/p\.png"/); assert.match(chartBlock.html, /CHART · AS OF PUBLICATION/); assert.ok(chartBlock.css.startsWith(a.css)); assert.ok(chartBlock.height >= 400);
  const meters = a.blocks.find((b) => b.id === 'mod-meters'); assert.match(meters.html, /class="mem-ring r0"/); assert.match(meters.css, /\.mem-ring\.r0\{background:conic-gradient\(#ffb04a 64%/); assert.match(meters.css, /\.mem-ring\.r1\{background:conic-gradient\(#19c37d 71%/);
  const tabs = a.blocks.find((b) => b.id === 'mod-tabs'); assert.match(tabs.html, /class="mem-strip"/); assert.match(tabs.html, /<h3>TAPE<\/h3>/);
  const track = a.blocks.find((b) => b.id === 'mod-tracker'); assert.match(track.css, /\.mem-track-bar i\{left:[\d.]+%\}/); assert.ok(!/data-live/.test(track.html));
  const kill = a.blocks.find((b) => b.id === 'mod-killswitch'); assert.match(kill.html, /class="mem-check"/);
  const poll = a.blocks.find((b) => b.id === 'mod-poll'); assert.match(poll.html, /href="https:\/\/discord\.gg\/makingeasymoney"/);
  assert.match(a.bodyHtml, /<iframe class="mem-chart-embed" [^>]*src="https:\/\/sml-platform-api\.onrender\.com\/academy-activity\/article-chart-embed\?symbol=ABCD"/, 'the page keeps the embed, at the right path');
  const faqHeading = a.blocks.find((b) => b.type === 'heading' && b.level === 3 && /Is \$ABCD a buy/.test(b.text)); assert.ok(faqHeading, 'faq questions become headings');
  assert.ok(a.blocks.some((b) => b.type === 'paragraph' && b.spans.some((s) => s.mark === 'link' && /sec\.gov/.test(s.href))), 'links survive into spans');
  assert.ok(!a.blocks.some((b) => b.type === 'paragraph' && b.spans.some((s) => /<|>/.test(s.text))), 'no tag soup in spans');
});

test('a thin dossier still composes: no insight sections, the modules that have data, and a topic headline', () => {
  const thin = { ...base, gamma: null, tape: null, smc: null, earnings: null, short: { ratio: 0.55, daysToCover: 6 } };
  const st = E.rankStories([thin])[0]; assert.equal(st.angle, 'short');
  const a = D.composeArticle({ story: st, c: thin, dossier: {}, asOf: Date.UTC(2026, 9, 19, 14, 30), topic: 'crude oil' });
  assert.match(a.title, /^Crude oil through \$ABCD: /); assert.ok(!a.sections.includes('What the smart money is doing') && !a.sections.includes('The crowd'));
  assert.deepEqual(a.modules, ['board', 'chart', 'tabs', 'bullbear', 'tracker', 'killswitch', 'poll']); assert.ok(a.wordCount >= 700, String(a.wordCount));
  assert.ok(!a.blocks.some((b) => b.id === 'mod-chart'), 'no poster, no chart block in the letter'); assert.ok(a.blocks.some((b) => b.id === 'mod-tabs'));
  assert.match(a.bodyHtml, /<figure class="mem-chartbox" data-symbol="ABCD">/, 'no endpoint, no live polling attribute');
  const b = D.bullBear(st, thin, {}, 1); assert.ok(b.bull.length >= 1 && b.bear.length >= 1);
});
