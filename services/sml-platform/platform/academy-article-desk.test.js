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

test('the composed piece is a letter, not a report: a lede with a side, at most six sections, the numbers inside sentences, one disclaimer, no glossary, no FAQ, no sentence twice', () => {
  const a = compose();
  assert.ok(a.sections.length >= 4 && a.sections.length <= 6, 'sections: ' + a.sections.join(' | ')); assert.equal(a.sections[a.sections.length - 1], 'Bottom line');
  assert.ok(!a.sections.some((h) => /what the data says|key takeaways|questions readers ask|glossary|sources|the crowd|insiders and filings/i.test(h)), 'no template headings');
  assert.deepEqual(a.modules, ['board', 'chart', 'countdown', 'bullbear', 'tracker', 'killswitch', 'poll']);
  assert.ok(a.wordCount >= 700 && a.wordCount <= 1500, 'a readable length: ' + a.wordCount);
  const text = a.textHtml.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
  assert.equal((text.match(/not financial advice/gi) || []).length, 1, 'one disclaimer'); assert.ok(!/Not a forecast|LABELLED SPECULATION|argues with itself/i.test(a.bodyHtml), 'no stacked disclaimers, no meta');
  assert.ok(/\bI\b/.test(text), 'first person'); assert.ok(!/—/.test(text), 'no em dash'); assert.ok(!/\b(delve|tapestry|landscape|in conclusion)\b/i.test(text));
  const sentences = text.split(/(?<=[.!?])\s+/).map((x) => x.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '')).filter((x) => x.split(' ').length >= 6);
  assert.equal(new Set(sentences).size, sentences.length, 'no sentence appears twice');
  assert.match(a.bodyHtml, /<svg class="mem-chart"/); assert.match(a.bodyHtml, /data-live-endpoint="https:\/\/sml-platform-api\.onrender\.com\/academy-activity\/article-chart"/);
  assert.match(a.bodyHtml, /Smart money is accumulating/); assert.match(a.bodyHtml, /HEAVY: \$4\.1M block/); assert.match(a.bodyHtml, /THE BULL CASE/); assert.match(a.bodyHtml, /KILL SWITCH/); assert.match(a.bodyHtml, /EARNINGS COUNTDOWN/); assert.match(a.bodyHtml, /YOUR CALL ON \$ABCD/); assert.match(a.bodyHtml, /SHARE THIS READ/);
  for (const h of ['https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001234567', 'https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files', 'https://www.nasdaq.com/market-activity/stocks/abcd/short-interest', 'https://www.cboe.com/delayed_quotes/abcd/quote_table', 'https://abcd.example', 'https://stockmarketloop.com/stocks/abcd/', 'https://discord.gg/makingeasymoney']) assert.ok(a.links.some((l) => l.startsWith(h)), 'link ' + h);
  assert.ok(!a.links.some((l) => /investor\.gov/.test(l)), 'no explainer links: the readers know what gamma is');
  assert.equal((a.bodyHtml.match(/<script/g) || []).length, 1, 'one enhancement script at the end'); assert.ok(a.js.includes('localStorage') && !/<\/script/.test(a.js));
  assert.equal(a.narrative.source, 'house'); assert.deepEqual(a.faq, []);
  const rich = compose({ rich: true }); assert.ok(rich.modules.includes('meters') && rich.modules.includes('tabs'), 'the meters and the data strip only on request');
});

test('a narrative from the model is laid out as given: its title, its headings, its bull and bear lines, its kill list', () => {
  const W = require('./academy-article-writer');
  const sheet = W.factSheet({ story: story(), c: base, dossier });
  const n = { ...W.housePiece(sheet, 5), title: '$ABCD: dealers are short gamma and $13.00 is the strike that matters', dek: 'A dek of my own.', sections: [{ heading: 'What I am watching', paragraphs: ['Paragraph one about $ABCD at $12.40.'] }, { heading: 'Where it goes', paragraphs: ['The path to $13.00.'] }, { heading: 'What makes me wrong', paragraphs: ['A close under $11.80.'] }], bull: ['Dealers short gamma'], bear: ['Earnings in 6 days'], kill: ['Loses $11.80', 'Tape flips', 'Volume dies'], source: 'ai', checked: { ok: true, reasons: [] } };
  const a = compose({ narrative: n });
  assert.equal(a.title, n.title); assert.equal(a.dek, 'A dek of my own.'); assert.deepEqual(a.sections, ['What I am watching', 'Where it goes', 'What makes me wrong', 'Bottom line']); assert.equal(a.narrative.source, 'ai');
  assert.match(a.bodyHtml, /<li>Dealers short gamma<\/li>/); assert.match(a.bodyHtml, /<li>Earnings in 6 days<\/li>/); assert.match(a.bodyHtml, /<span>Loses \$11\.80<\/span>/);
  const killAt = a.bodyHtml.indexOf('KILL SWITCH'), wrongAt = a.bodyHtml.indexOf('<h2>What makes me wrong</h2>'); assert.ok(killAt > wrongAt, 'the kill switch sits under the section that names the exit');
});

test('the head carries the title, description, canonical, social tags and NewsArticle + BreadcrumbList JSON-LD; the document is one page', () => {
  const a = compose();
  assert.match(a.headHtml, /^<title>[^<]{10,60}<\/title>/); assert.match(a.headHtml, /<meta name="description" content="[^"]{110,155}">/); assert.match(a.headHtml, /<link rel="canonical" href="https:\/\/stockmarketloop\.com\/n\/grandmasterobi\/abcd\/">/);
  assert.match(a.headHtml, /property="og:image" content="https:\/\/stockmarketloop\.com\/wp-content\/uploads\/p\.png"/); assert.match(a.headHtml, /name="twitter:card" content="summary_large_image"/); assert.match(a.headHtml, /name="news_keywords"/); assert.match(a.headHtml, /property="article:tag" content="ABCD"/);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(a.headHtml)[1]);
  assert.deepEqual(ld.map((x) => x['@type']), ['NewsArticle', 'BreadcrumbList']);
  assert.equal(ld[0].about.tickerSymbol, 'ABCD'); assert.equal(ld[0].author.name, 'Vaughn McNair'); assert.ok(ld[0].wordCount > 600); assert.equal(ld[1].itemListElement[2].name, '$ABCD');
  assert.match(a.document, /^<!doctype html>\n<html lang="en">/); assert.ok(a.document.includes(a.headHtml) && a.document.includes(a.css) && a.document.includes(a.bodyHtml));
  assert.ok(a.css.includes('.mem-article{') && a.css.includes('.mem-tabs') && !/url\(|@import/.test(a.css), 'self-contained css');
  assert.equal(a.slug.length > 10, true); assert.equal(a.seo.meta_title.length <= 60, true);
});

test('the Loop Letters blocks keep dead space out: one tight frame for the figures, native blocks for the chart and the lists, a frame only where nothing native fits', () => {
  const a = compose();
  const types = a.blocks.map((b) => b.type);
  assert.equal(types[0], 'custom_code'); assert.equal(a.blocks[0].id, 'mod-glance', 'the figures lead');
  assert.deepEqual(a.blocks.filter((b) => b.type === 'custom_code').map((b) => b.id), ['mod-glance'], 'one frame in a plain letter: every frame is at least 320 px tall and cannot resize, so small modules share one');
  const glance = a.blocks[0];
  assert.match(glance.html, /class="mem-board"/); assert.match(glance.html, /class="mem-count"/); assert.match(glance.html, /class="mem-track/); assert.ok(!/data-live-endpoint|<script/.test(glance.html));
  assert.match(glance.css, /\.mem-track-bar i\{left:[\d.]+%\}/); assert.ok(glance.css.startsWith(a.css)); assert.match(glance.css, /\.mem-glance \.mem-board\{grid-template-columns:repeat\(3,1fr\)/);
  assert.equal(glance.height, 131 + 67 + 161 + 16, 'board + countdown + tracker + their gaps, measured at the phone width');
  const thinGlance = compose({ story: story() }); assert.ok(thinGlance.blocks[0].height >= 300);
  assert.ok(a.blocks.some((b) => b.type === 'heading' && b.text === 'Bottom line')); assert.ok(a.blocks.some((b) => b.type === 'heading' && b.level === 2 && b.text === a.sections[0]));
  for (const b of a.blocks.filter((x) => x.type === 'custom_code')) assert.ok(!/<svg|<iframe|<script|<input|<details|style="/.test(b.html), b.id + ' is sanitizer-safe');
  assert.ok(!a.blocks.some((b) => b.type === 'image' || b.id === 'img-chart' || b.id === 'mod-chart'), 'no chart in the body: the cover image at the top is the same scenario poster');
  assert.equal(a.modules.includes('chart'), true, 'the standalone page keeps its live chart');
  const headings = a.blocks.filter((b) => b.type === 'heading' && b.level === 3).map((b) => b.text);
  assert.deepEqual(headings, ['The bull case', 'The bear case', 'Kill switch'], 'the cases and the kill switch are plain headings and lists');
  assert.ok(a.blocks.filter((b) => b.type === 'list').length >= 3, 'lists, not frames');
  assert.ok(a.blocks.some((b) => b.type === 'paragraph' && b.spans.some((s) => s.mark === 'link' && s.href === 'https://discord.gg/makingeasymoney')), 'the poll becomes one line that points at the Discord');
  assert.ok(!a.blocks.some((b) => b.id === 'mod-meters' || b.id === 'mod-tabs'));
  const rich = compose({ rich: true }); const meters = rich.blocks.find((b) => b.id === 'mod-meters'); assert.match(meters.html, /class="mem-ring r0"/); assert.match(meters.css, /\.mem-ring\.r0\{background:conic-gradient\(#ffb04a 64%/); assert.match(rich.blocks.find((b) => b.id === 'mod-tabs').html, /class="mem-strip"/);
  assert.ok(a.blocks.some((b) => b.type === 'paragraph' && b.spans.some((s) => s.mark === 'link' && /sec\.gov/.test(s.href))), 'links survive into spans');
  assert.ok(!a.blocks.some((b) => b.type === 'paragraph' && b.spans.some((s) => /<|>/.test(s.text))), 'no tag soup in spans');
  assert.match(a.bodyHtml, /<iframe class="mem-chart-embed" [^>]*src="https:\/\/sml-platform-api\.onrender\.com\/academy-activity\/article-chart-embed\?symbol=ABCD"/, 'the page keeps the embed, at the right path');
  for (const name of ['mem-poll', 'mem-kill', 'mem-vs', 'mem-tabs']) assert.ok(a.bodyHtml.includes(name) || name === 'mem-tabs', 'the standalone page keeps ' + name);
});

test('a thin dossier still composes: the modules that have data, a topic headline, and no chart block without a poster', () => {
  const thin = { ...base, gamma: null, tape: null, smc: null, earnings: null, short: { ratio: 0.55, daysToCover: 6 } };
  const st = E.rankStories([thin])[0]; assert.equal(st.angle, 'short');
  const a = D.composeArticle({ story: st, c: thin, dossier: {}, asOf: Date.UTC(2026, 9, 19, 14, 30), topic: 'crude oil' });
  assert.match(a.title, /^Crude oil through \$ABCD: /); assert.equal(a.sections.length, 4);
  assert.deepEqual(a.modules, ['board', 'chart', 'bullbear', 'tracker', 'killswitch', 'poll']); assert.ok(a.wordCount >= 500, String(a.wordCount));
  assert.ok(!a.blocks.some((b) => b.id === 'img-chart'), 'no poster, no chart block in the letter'); assert.ok(a.blocks.some((b) => b.type === 'heading' && b.text === 'The bull case'));
  assert.match(a.bodyHtml, /<figure class="mem-chartbox" data-symbol="ABCD">/, 'no endpoint, no live polling attribute');
  const b = D.bullBear(st, thin, {}, 1); assert.ok(b.bull.length >= 1 && b.bear.length >= 1);
});

test('an old letter is rebuilt in the compact layout from its stored blocks, and anything that is not a desk letter is left alone', () => {
  const wrap = (h) => `<div class="mem-article mem-letter" data-theme="dark">${h}</div>`;
  const old = [
    { id: 'card1', type: 'custom_code', html: '<div class="ad-t">Key takeaways</div>', css: '.ad-t{}', height: 498 },
    { id: 'mod-board', type: 'custom_code', html: wrap('<div class="mem-board"><div><span>PRICE</span><b>$31.89</b></div></div>'), css: 'x', height: 170 },
    { id: 'p1', type: 'paragraph', spans: [{ text: 'Lede.' }] },
    { id: 'mod-chart', type: 'custom_code', html: wrap('<figure class="mem-chartbox mem-chartimg"><div class="mem-chiprow"><span class="mem-chip">CHART</span><span class="mem-chip">$ARQT <b>$31.89</b> <em class="up">+10.7%</em></span></div><img src="https://stockmarketloop.com/wp-content/uploads/p.png?a=1&amp;b=2" alt="$ARQT daily chart with the scenario path to $36.35" width="1200" height="675" loading="lazy"><figcaption>The candles as published.</figcaption></figure>'), css: 'x', height: 760 },
    { id: 'mod-countdown', type: 'custom_code', html: wrap('<div class="mem-count"><span>EARNINGS</span><b>6 days</b></div>'), css: 'x', height: 320 },
    { id: 'mod-bullbear', type: 'custom_code', html: wrap('<div class="mem-vs"><div class="mem-vs-col mem-vs-bull"><h3>THE BULL CASE</h3><ul><li>Shorts &amp; volume</li></ul></div><div class="mem-vs-col mem-vs-bear"><h3>THE BEAR CASE</h3><ul><li>Gamma is an inference</li></ul></div></div>'), css: 'x', height: 360 },
    { id: 'mod-tracker', type: 'custom_code', html: wrap('<div class="mem-track"><div class="mem-track-bar"><i></i></div></div>'), css: 'BASE\n.mem-track-bar i{left:48.2%}', height: 320 },
    { id: 'mod-killswitch', type: 'custom_code', html: wrap('<div class="mem-kill"><h3>KILL SWITCH</h3><ul class="mem-check"><li>A close under $28.70.</li><li>Sellers absorb it.</li></ul></div>'), css: 'x', height: 320 },
    { id: 'mod-poll', type: 'custom_code', html: wrap('<div class="mem-poll"><h3>YOUR CALL ON $ARQT</h3><p>The desk leans <b>bullish</b>. Bull or bear, say so in <a href="https://discord.gg/x" rel="noopener" target="_blank">the Discord</a>, where the alerts land first.</p></div>'), css: 'x', height: 320 },
    { id: 'd1', type: 'disclosure', position: 'p' }
  ];
  const out = D.compactLetterBlocks(old);
  assert.deepEqual(out.map((b) => b.id.replace(/\d+$/, '')), ['mod-glance', 'p', 'h', 'l', 'h', 'l', 'h', 'p', 'l', 'p', 'd'].map((x) => x === 'p' || x === 'h' || x === 'l' || x === 'd' ? x : x));
  assert.equal(out[0].type, 'custom_code'); assert.match(out[0].html, /mem-glance/); assert.ok(out[0].html.includes('mem-board') && out[0].html.includes('mem-count') && out[0].html.includes('mem-track'));
  assert.ok(out[0].css.includes('.mem-track-bar i{left:48.2%}') && out[0].css.includes('.mem-glance'), 'the marker position survives'); assert.equal(out[0].height, 131 + 67 + 161 + 16);
  assert.ok(!out.some((b) => b.type === 'image' || b.id === 'mod-chart'), 'the old chart frame is gone: the cover is the chart');
  assert.deepEqual(out.filter((b) => b.type === 'heading').map((b) => b.text), ['The bull case', 'The bear case', 'Kill switch']);
  assert.deepEqual(out.filter((b) => b.type === 'list').map((b) => b.items), [['Shorts & volume'], ['Gamma is an inference'], ['A close under $28.70.', 'Sellers absorb it.']]);
  assert.ok(out.some((b) => b.type === 'paragraph' && b.spans.some((s) => s.mark === 'link' && s.href === 'https://discord.gg/x')) && !out.some((b) => b.id === 'card1' || b.id === 'mod-poll'));
  assert.equal(out[out.length - 1].type, 'disclosure');
  /* the animated path and a still chart from the last rebuild go too, even from a letter that is otherwise already compact */
  const withGif = [...old.slice(0, 2), { id: 'gif1', type: 'image', url: 'u', alt: 'a', caption: '' }, ...old.slice(2)];
  assert.ok(!D.compactLetterBlocks(withGif).some((b) => b.id === 'gif1' || b.id === 'img-chart'));
  const lastRebuild = [...out.slice(0, 1), { id: 'img-chart', type: 'image', url: 'u', alt: 'a', caption: 'c' }, ...out.slice(1)];
  const dropped = D.compactLetterBlocks(lastRebuild); assert.ok(dropped && !dropped.some((b) => b.id === 'img-chart') && dropped.length === out.length);
  assert.equal(D.compactLetterBlocks(out), null, 'already compact'); assert.equal(D.compactLetterBlocks([{ id: 'p1', type: 'paragraph', spans: [] }]), null, 'a hand-written letter'); assert.equal(D.compactLetterBlocks(null), null);
});

test('the letter frames are always dark whatever the reader prefers, and a glance block from an earlier rebuild is unwrapped and refreshed', () => {
  assert.match(D.CSS, /\.mem-article\.mem-letter\{--bg:#0b1119;--ink:#e8eff4/, 'the sanitizer strips data-theme, so the letter variant sets its own dark variables');
  /* the sanitized form of an old letter: no data-theme anywhere */
  const wrap = (h) => `<div class="mem-article mem-letter">${h}</div>`;
  const old = [{ id: 'mod-board', type: 'custom_code', html: wrap('<div class="mem-board"><div><span>PRICE</span><b>$1.00</b></div></div>'), css: 'x', height: 170 }, { id: 'mod-tracker', type: 'custom_code', html: wrap('<div class="mem-track"><div class="mem-track-bar"><i></i></div></div>'), css: 'x\n.mem-track-bar i{left:30%}', height: 320 }];
  const out = D.compactLetterBlocks(old);
  assert.equal(out.length, 1); assert.ok(out[0].html.startsWith('<div class="mem-article mem-letter mem-glance"'));
  assert.equal((out[0].html.match(/class="mem-article/g) || []).length, 1, 'one wrapper, not the old one inside the new one');
  /* an earlier rebuild's glance block: nested wrapper, old css */
  const earlier = [{ id: 'mod-glance', type: 'custom_code', html: '<div class="mem-article mem-letter mem-glance"><div class="mem-article mem-letter"><div class="mem-board"></div><div class="mem-track"></div></div></div>', css: 'OLD\n.mem-track-bar i{left:41.5%}', height: 320 }, { id: 'p1', type: 'paragraph', spans: [] }];
  const fixed = D.compactLetterBlocks(earlier);
  assert.equal((fixed[0].html.match(/class="mem-article/g) || []).length, 1); assert.ok(fixed[0].css.startsWith(D.CSS) && fixed[0].css.includes('.mem-track-bar i{left:41.5%}') && fixed[0].css.includes('.mem-glance'));
  assert.equal(D.compactLetterBlocks(fixed), null, 'once fixed it is left alone');
});
