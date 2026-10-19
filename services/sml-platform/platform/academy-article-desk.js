'use strict';

/* THE ARTICLE DESK, second edition: one ticker (or a market topic mapped to its proxy ticker) in, a finished piece out.
 *
 * The desk reads everything the Academy knows about the name (the story engine's candidate plus the insight services:
 * the smart-money intent read, the short insight with its squeeze model, the earnings insight, the dark-pool read, the
 * sentiment composite, MEM ALGO, the pattern scanner, SEC filings, the company record, the ticker's headlines and the
 * alerts desk) and writes a market news piece the way the best-read desks do: a headline with the number in it, a lede
 * that takes a side, the numbers before the opinion, the speculation labelled as speculation, the bull case and the
 * bear case argued against each other, a path with a target and a line that proves it wrong, a checklist for the next
 * session, questions readers actually search for, and a bottom line.
 *
 * It ships with retention modules the reader can use (a live chart with the scenario path, a smart-money meter, a tape
 * tab strip, a bull-versus-bear split, a path tracker, a kill-switch checklist, an earnings countdown, a bull-or-bear
 * poll, a share row) that work without script (CSS only) and get live when the page may run the enhancement script,
 * backlinks to the primary sources (SEC EDGAR, FINRA, Nasdaq, Cboe, Investor.gov, the company's investor site) and the
 * site's own pages, and a full SEO head: title, description, canonical, Open Graph, Twitter, NewsArticle + FAQPage +
 * BreadcrumbList JSON-LD.
 *
 * The output is made to be pasted: bodyHtml (the article), css (its stylesheet), headHtml (the meta tags and JSON-LD),
 * document (the whole page), and blocks (the Loop Letters block list). Every number comes from the data; every value
 * is escaped; there are no em dashes and none of the phrases that read as machine copy. */

const engine = require('./academy-story-engine');
const V = require('./academy-article-voice');
const { seoFor } = require('./academy-article-seo');
const chart = require('./academy-article-chart');
const { htmlToBlocks } = require('./academy-letter-blocks');

const esc = chart.esc;
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const px = (v) => (Math.abs(v) >= 1 ? '$' + Number(v).toFixed(2) : '$' + Number(v).toFixed(4));
const pct = (v, d = 1) => (v >= 0 ? '+' : '') + Number(v).toFixed(d) + '%';
const big = (v) => (v == null ? null : Math.abs(v) >= 1e12 ? (v / 1e12).toFixed(2) + 'T' : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)));
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
const seedOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const plain = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const timed = (fn, ms) => Promise.race([Promise.resolve().then(fn), new Promise((r) => { const t = setTimeout(() => r(null), ms); if (t.unref) t.unref(); })]).catch(() => null);

/* ---------- subjects: a ticker, or a topic the market trades through a proxy ---------- */
const TOPICS = [
  [/^(market|markets|s&p|sp500|s&p ?500|stocks|wall ?street|spy)$/i, 'SPY', 'the S&P 500'],
  [/^(nasdaq|tech|qqq|big tech|megacap)$/i, 'QQQ', 'the Nasdaq 100'],
  [/^(dow|djia|dia)$/i, 'DIA', 'the Dow'],
  [/^(small ?caps?|russell|iwm)$/i, 'IWM', 'small caps'],
  [/^(fed|rates|interest rates|treasur(y|ies)|bonds|tlt|yields)$/i, 'TLT', 'long Treasuries and the rate trade'],
  [/^(dollar|dxy|usd|uup)$/i, 'UUP', 'the dollar'],
  [/^(oil|crude|wti|uso|energy)$/i, 'USO', 'crude oil'],
  [/^(gold|gld)$/i, 'GLD', 'gold'],
  [/^(silver|slv)$/i, 'SLV', 'silver'],
  [/^(bitcoin|btc|crypto|ibit)$/i, 'IBIT', 'bitcoin'],
  [/^(semis|semiconductors|chips|smh)$/i, 'SMH', 'semiconductors'],
  [/^(banks|financials|xlf)$/i, 'XLF', 'the banks'],
  [/^(biotech|xbi)$/i, 'XBI', 'biotech'],
  [/^(housing|homebuilders|xhb)$/i, 'XHB', 'housing'],
  [/^(retail|xrt|consumer)$/i, 'XRT', 'retail'],
  [/^(china|fxi)$/i, 'FXI', 'China'],
  [/^(vix|volatility|fear)$/i, 'VIXY', 'volatility'],
  [/^(ai|artificial intelligence|botz)$/i, 'BOTZ', 'the AI trade']
];
function resolveSubject(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const t = raw.replace(/^\$/, '').replace(/^the\s+/i, '');
  if (/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(t) && !TOPICS.some(([re]) => re.test(t))) return { symbol: t.toUpperCase(), topic: null, label: '$' + t.toUpperCase() };
  const hit = TOPICS.find(([re]) => re.test(t));
  if (hit) return { symbol: hit[1], topic: hit[2], label: hit[2] };
  if (/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(t)) return { symbol: t.toUpperCase(), topic: null, label: '$' + t.toUpperCase() };
  return null;
}

/* ---------- the dossier: every read the Academy can give on one name, each raced against a clock ---------- */
async function buildDossier(symbol, deps = {}, { budgetMs = 20_000 } = {}) {
  const S = String(symbol).toUpperCase();
  const get = (fn, ms) => (typeof fn === 'function' ? timed(() => fn(S), Math.min(ms, budgetMs)) : Promise.resolve(null));
  const [shortInsight, earningsInsight, intent, darkPool, sentiment, filings, company, news, alerts, patterns, memAlgo] = await Promise.all([
    get(deps.shortInsight, 18_000), get(deps.earningsInsight, 15_000), get(deps.intent, 9_000), get(deps.darkPool, 14_000),
    get(deps.sentiment, 10_000), get(deps.filings, 10_000), get(deps.company, 6_000), get(deps.news, 8_000), get(deps.alerts, 3_000),
    get(deps.patterns, 6_000), get(deps.memAlgo, 8_000)
  ]);
  const ok = (x) => (x && x.ok !== false && x.available !== false ? x : null);
  return { symbol: S, shortInsight: ok(shortInsight), earningsInsight: ok(earningsInsight), intent: ok(intent), darkPool: ok(darkPool), sentiment: ok(sentiment), filings: ok(filings),
    company: company && typeof company === 'object' ? (company.results || company.company || company) : null,
    news: Array.isArray(news) ? news : news && Array.isArray(news.articles) ? news.articles : news && Array.isArray(news.items) ? news.items : [],
    alerts: Array.isArray(alerts) ? alerts.filter((a) => a && String(a.symbol || '').toUpperCase() === S) : [], patterns: ok(patterns), memAlgo: memAlgo && typeof memAlgo === 'object' ? memAlgo : null };
}

/* ---------- the sources: primary, authoritative, and the site's own ---------- */
function sourcesFor(c, d, { siteUrl, authorUrl, discordUrl }) {
  const S = c.symbol, low = S.toLowerCase(), cik = d && d.filings && d.filings.cik ? String(d.filings.cik) : '';
  const co = d && d.company ? d.company : {};
  const home = typeof co.homepage_url === 'string' && /^https:\/\//.test(co.homepage_url) ? co.homepage_url : '';
  const list = [
    { key: 'edgar', href: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + encodeURIComponent(cik || S) + '&type=&dateb=&owner=include&count=40', text: 'SEC EDGAR filings for ' + S, who: 'U.S. Securities and Exchange Commission' },
    { key: 'finraShort', href: 'https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files', text: 'FINRA daily short sale volume files', who: 'FINRA' },
    { key: 'finraSi', href: 'https://www.finra.org/finra-data/browse-catalog/equity-short-interest/data', text: 'FINRA equity short interest data', who: 'FINRA' },
    { key: 'nasdaqSi', href: 'https://www.nasdaq.com/market-activity/stocks/' + encodeURIComponent(low) + '/short-interest', text: 'Nasdaq short interest: ' + S, who: 'Nasdaq' },
    { key: 'nasdaqEr', href: 'https://www.nasdaq.com/market-activity/stocks/' + encodeURIComponent(low) + '/earnings', text: 'Nasdaq earnings page: ' + S, who: 'Nasdaq' },
    { key: 'cboe', href: 'https://www.cboe.com/delayed_quotes/' + encodeURIComponent(low) + '/quote_table', text: 'Cboe options quotes: ' + S, who: 'Cboe Global Markets' },
    { key: 'shortSales', href: 'https://www.investor.gov/introduction-investing/investing-basics/glossary/short-sales', text: 'Short sales, explained by Investor.gov', who: 'Investor.gov (SEC)' },
    { key: 'options', href: 'https://www.investor.gov/introduction-investing/investing-basics/glossary/options', text: 'Options, explained by Investor.gov', who: 'Investor.gov (SEC)' },
    { key: 'margin', href: 'https://www.investor.gov/introduction-investing/investing-basics/glossary/margin', text: 'Margin, explained by Investor.gov', who: 'Investor.gov (SEC)' },
    { key: 'stocks', href: siteUrl + '/stocks/' + low + '/', text: S + ' quote, chart and data on StockMarketLoop', who: 'StockMarketLoop', internal: true },
    { key: 'author', href: authorUrl, text: 'More from this desk', who: 'StockMarketLoop', internal: true }
  ];
  if (home) list.push({ key: 'ir', href: home, text: (co.name || S) + ' investor site', who: co.name || S });
  if (discordUrl) list.push({ key: 'discord', href: discordUrl, text: 'Making Easy Money Discord', who: 'Making Easy Money', internal: true });
  return list;
}
const link = (src, text, rel) => (src ? '<a href="' + esc(src.href) + '"' + (src.internal ? '' : ' rel="' + (rel || 'noopener') + '" target="_blank"') + '>' + esc(text || src.text) + '</a>' : esc(text || ''));

/* ---------- the writing ---------- */
function ledeFor(st, c, d, seed) {
  const S = '$' + c.symbol, name = c.name || c.symbol, it = d.intent && d.intent.intent;
  const number = st.facts && st.facts[0] ? plain(st.facts[0]) : '';
  const L = {
    gamma: [`${name} is not a stock chart this week. It is an options book with a stock attached, and the people hedging that book do not get a vote on the price they pay.`, `Everyone watching ${S} is watching the candles. The dealers who sold the calls are watching their delta, and their delta is the one with a budget.`],
    short: [`Somebody is still shorting ${name} into this, and the tape has the receipts.`, `The short case on ${S} was reasonable. The problem with reasonable short cases is the exit, and the exit is getting narrow.`],
    earnings: [`${name} reports soon, and the consensus number is the least interesting thing about it. The positioning is the story.`, `Every preview of ${S} earnings will quote the estimate. Almost none will tell you what the tape did before anyone was paying attention.`],
    tape: [`The chart on ${name} looks like a Tuesday. The prints behind it do not.`, `Someone is working ${S} where the public cannot watch, and the size is not retail size.`],
    structure: [`${name} just ran the obvious level, took the stops, and closed back inside. That is not noise. That is a sweep, and sweeps have a sequel.`, `Price in ${S} visited the stops, collected them, and left. The question now is where it is going with the money.`]
  }[st.angle] || [`A data-driven read on ${S}.`];
  const two = `${S} trades at ${px(c.price)}${num(c.changePct) != null ? ` (${pct(c.changePct)} on the session)` : ''}${num(c.relVol) != null ? ` on ${c.relVol.toFixed(1)}x its usual volume` : ''}. ${number ? cap(number.charAt(0).toLowerCase() + number.slice(1)) : ''}`;
  const three = it && it.phase && it.phase !== 'undecided'
    ? `The smart-money read calls it ${it.phase}${it.side && it.side !== 'neither' ? ' with ' + it.side + ' in control' : ''}, which is the part the headline writers keep missing.`
    : `This piece builds the case for ${px(st.pt)} from the Academy's data desk, then tries to break it. If the case cannot survive its own cross-examination, it does not deserve your money.`;
  return [pick(L, seed), two.trim(), three];
}

function intentSection(d, c, seed) {
  const r = d.intent; if (!r || !r.intent) return null;
  const it = r.intent, f = r.formulas || {};
  const ev = (it.evidence || []).filter((e) => e && e.text).slice(0, 4).map((e) => plain(e.text));
  const levels = (r.map && r.map.levels ? r.map.levels : []).filter((l) => l && num(l.price) != null).slice(0, 5);
  const lines = [];
  lines.push(`<p>${esc(it.read || '')} ${esc(pick([`That is the intent read, built from the prints themselves rather than from anyone's opinion.`, `That read is mechanical: it comes from the tape, the book and the levels, not from a feeling about the chart.`], seed))}</p>`);
  if (ev.length) lines.push(`<ul>${ev.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`);
  const fl = [];
  if (f.vpin && f.vpin.ok) fl.push(`VPIN ${f.vpin.vpin} (${f.vpin.band})`);
  if (f.lambda && f.lambda.ok) fl.push(`Kyle's lambda ${f.lambda.lambda} (${f.lambda.band || 'impact'})`);
  if (f.persistence && f.persistence.ok) fl.push(`sign persistence ${f.persistence.acf}, ${f.persistence.band}`);
  if (f.darkPool && f.darkPool.ok && f.darkPool.dix != null) fl.push(`dark-pool buy share ${Math.round(f.darkPool.dix * 100)}%`);
  if (fl.length) lines.push(`<p>The numbers behind it: ${esc(fl.join('; '))}. ${esc(pick([`Each of those is a published microstructure measure, not a house invention, and each is explained in the glossary at the end.`, `None of those are proprietary. They are the measures the market-microstructure literature uses, applied to this tape.`], seed + 1))}</p>`);
  if (levels.length) lines.push(`<p>The liquidity map puts the levels that matter at ${esc(levels.map((l) => px(l.price) + (l.labels && l.labels.length ? ' (' + plain(l.labels.slice(0, 2).join(', ')) + ')' : '')).join(', '))}. ${esc(pick([`Where several feeds agree on a price, that price tends to get defended or attacked; that is the whole point of the map.`, `A level that three independent feeds mark is a level somebody has to deal with.`], seed + 2))}</p>`);
  return { title: 'What the smart money is doing', html: lines.join('\n'), phase: it.phase, side: it.side, strength: num(it.strength, 0), levels };
}

function shortSection(d, c, seed) {
  const si = d.shortInsight; if (!si) return null;
  const m = si.model, v = si.verdict, it = si.interest, svp = si.shortVsPrice;
  const lines = [];
  const sq = m && num(m.score) != null ? num(m.score) : (si.squeeze && num(si.squeeze.score) != null ? num(si.squeeze.score) : null);
  const pr = si.pressing && num(si.pressing.score) != null ? num(si.pressing.score) : null;
  if (sq != null || pr != null) lines.push(`<p>${sq != null ? `Squeeze risk scores <strong>${Math.round(sq)} of 100</strong>` : ''}${sq != null && pr != null ? ' and ' : ''}${pr != null ? `shorts-pressing scores <strong>${Math.round(pr)} of 100</strong>` : ''}. ${esc(pick([`Those are two different questions: whether the shorts are winning, and whether they can get out if they stop winning.`, `Read them together. A high pressing score with a high squeeze score is a short that is right today and trapped tomorrow.`], seed))}</p>`);
  const facts = [];
  if (it && num(it.daysToCover) != null) facts.push(`${Number(it.daysToCover).toFixed(1)} days to cover`);
  if (it && num(it.shortInterest) != null) facts.push(`${big(num(it.shortInterest))} shares short`);
  if (it && num(it.siChangePct) != null) facts.push(`short interest ${pct(num(it.siChangePct))} since the last report`);
  if (svp && num(svp.avgRatio) != null) facts.push(`${Math.round(num(svp.avgRatio) * 100)}% average short volume over the last sessions`);
  if (m && m.fuel && m.fuel.floatBand) facts.push(`a ${plain(m.fuel.floatBand.label || m.fuel.floatBand)} float`);
  if (facts.length) lines.push(`<p>The fuel: ${esc(facts.join(', '))}. ${esc(pick([`Short interest is the stock of open bets; short volume is today's flow. The squeeze lives in the first number and gets lit by the second.`, `Open short interest is the pile of dry wood. Daily short volume is whether anyone is still adding to it.`], seed + 1))}</p>`);
  if (svp && Array.isArray(svp.rows) && svp.rows.length) { /* a short-volume-by-day series for the bars chart */ }
  if (v && v.long && v.long.call) lines.push(`<p><strong>For a long:</strong> ${esc(cap(v.long.call))}.${v.long.invalidation ? ' Wrong if ' + esc(v.long.invalidation) + '.' : ''}</p>`);
  if (v && v.shortSeller && v.shortSeller.call) lines.push(`<p><strong>For a short seller:</strong> ${esc(cap(v.shortSeller.call))}.</p>`);
  if (si.brief && typeof si.brief === 'object' && si.brief.text) lines.push(`<p>${esc(plain(si.brief.text).slice(0, 600))}</p>`);
  if (!lines.length) return null;
  return { title: "The short seller's problem", html: lines.join('\n'), squeeze: sq, pressing: pr, series: svp && Array.isArray(svp.rows) ? svp.rows.slice(-10) : [] };
}

function darkPoolSection(d, seed) {
  const dp = d.darkPool; if (!dp) return null;
  const read = dp.read || dp.darkRead || null;
  const lines = [];
  if (read && read.headline) lines.push(`<p><strong>${esc(read.headline)}.</strong></p>`);
  const steps = read && Array.isArray(read.steps) ? read.steps.slice(0, 3) : [];
  for (const s of steps) lines.push(`<p>${esc(plain(s.text))}</p>`);
  if (!steps.length && num(dp.offSharePct) != null) lines.push(`<p>${esc(`${Math.round(dp.offSharePct)}% of today's volume printed off-exchange against a typical ${Math.round(num(dp.typicalSharePct, 42))}%.`)} ${esc(pick([`Off-exchange share is common and says little by itself. The jump is what matters, and the direction of the big prints.`, `Dark pools are where size goes to avoid being seen. A high share with a side is a tell; a high share without one is a Tuesday.`], seed))}</p>`);
  if (!lines.length) return null;
  return { title: 'The dark-pool tape', html: lines.join('\n') };
}

function earningsSection(d, c, seed) {
  const e = d.earningsInsight; const er = c.earnings;
  if (!e && !er) return null;
  const lines = [];
  if (er && num(er.daysAway) != null && er.daysAway >= 0 && er.daysAway <= 45) lines.push(`<p>${esc(`${c.symbol} reports ${er.daysAway === 0 ? 'today' : er.daysAway === 1 ? 'tomorrow' : 'in ' + er.daysAway + ' days'}${er.date ? ' (' + String(er.date).slice(0, 10) + ')' : ''}${er.timing && er.timing !== 'UNSPECIFIED' ? ', ' + er.timing : ''}.`)}${num(er.impliedPct) != null ? ` The options market prices a ${Number(er.impliedPct).toFixed(1)}% move${num(er.histAvgMovePct) != null ? ` against a ${Number(er.histAvgMovePct).toFixed(1)}% average on past prints` : ''}.` : ''}</p>`);
  if (e) {
    const sig = (e.signals || []).filter((s) => s && s.text).slice(0, 4);
    if (sig.length) lines.push(`<ul>${sig.map((s) => `<li>${esc(plain(s.text))}</li>`).join('')}</ul>`);
    if (e.model && num(e.model.revenue) != null) lines.push(`<p>${esc(`The base-rate model (last year's same quarter grown at the blended trend, margins moved along their slope) lands revenue near $${big(num(e.model.revenue))}${num(e.model.eps) != null ? ' and EPS near $' + Number(e.model.eps).toFixed(2) : ''}${e.street && num(e.street.revenueEstimate) != null ? ', against a street estimate of $' + big(num(e.street.revenueEstimate)) : ''}.`)} ${esc(pick([`A model is a reference to judge the report by, not a prediction of it.`, `Treat the model as the bar, not the outcome.`], seed))}</p>`);
    if (e.ai && typeof e.ai === 'object' && e.ai.text) lines.push(`<p>${esc(plain(e.ai.text).slice(0, 500))}</p>`);
  }
  if (!lines.length) return null;
  return { title: 'The earnings angle', html: lines.join('\n'), date: er && er.date ? String(er.date).slice(0, 10) : null, daysAway: er ? num(er.daysAway) : null };
}

function optionsSection(c, seed) {
  const g = c.gamma; if (!g || !g.available) return null;
  const bits = [];
  bits.push(`Dealers are ${g.regime === 'negative' ? 'short gamma, which means they chase the move' : 'long gamma, which means they lean against the move'}.`);
  if (g.callWall && num(g.callWall.strike) != null) bits.push(`The call wall sits at ${px(g.callWall.strike)}${num(g.callWall.distancePct) != null ? ' (' + Number(g.callWall.distancePct).toFixed(1) + '% away)' : ''}.`);
  if (g.putWall && num(g.putWall.strike) != null) bits.push(`The put wall sits at ${px(g.putWall.strike)}.`);
  if (num(g.flipStrike) != null) bits.push(`The gamma flip is near ${px(g.flipStrike)}.`);
  if (num(g.zeroDteShare) != null && g.zeroDteShare >= 0.2) bits.push(`${Math.round(g.zeroDteShare * 100)}% of the open options expire the same day.`);
  if (num(g.pressurePct) != null) bits.push(`Hedging pressure equals ${Math.round(g.pressurePct)}% of an average day's volume.`);
  return { title: 'Options: what the dealers have to do', html: `<p>${esc(bits.join(' '))} ${esc(pick([`None of this is a forecast. It is a description of who is obliged to trade, and at which prices the obligation gets heavy.`, `Dealers have no thesis. They have inventory, and the strikes above are where the inventory gets expensive to carry.`], seed))}</p>` };
}

function sentimentSection(d, seed) {
  const s = d.sentiment; if (!s || s.available === false || num(s.scorePct) == null && num(s.score) == null) return null;
  const score = num(s.scorePct, Math.round((num(s.score, 0) + 1) * 50));
  const notes = (s.notes || []).slice(0, 3).map(plain);
  return { title: 'The crowd', score, html: `<p>Sentiment composite: <strong>${esc(s.label || '')}</strong> (${Math.round(score)} of 100, from ${num(s.coverage) != null ? s.coverage + '% of' : ''} the usual sources). ${esc(pick([`Sentiment is a contrarian tool at the extremes and a confirmation tool in the middle. Know which regime you are in.`, `The crowd is usually right about direction and usually wrong about timing, which is why the number only matters at the edges.`], seed))}</p>${notes.length ? `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}` };
}

function filingsSection(d, src, seed) {
  const f = d.filings; if (!f || f.available === false) return null;
  const ins = f.insiders || {};
  const bits = [];
  if (f.label) bits.push(`Insider read: ${plain(f.label)}.`);
  if (num(ins.buys) != null || num(ins.sells) != null) bits.push(`${num(ins.buys, 0)} open-market buys and ${num(ins.sells, 0)} sells on Form 4 in the last ninety days.`);
  if (f.activistRecent) bits.push(`${f.activistRecent} activist 13D filing${f.activistRecent === 1 ? '' : 's'} in the last sixty days.`);
  if (!bits.length) return null;
  return { title: 'Insiders and filings', html: `<p>${esc(bits.join(' '))} The filings themselves are public on ${link(src.edgar, 'SEC EDGAR')}; Form 4 lags two business days and 13D ten.</p>` };
}

function patternsSection(d, seed) {
  const p = d.patterns; if (!p || !p.count) return null;
  const names = [...(p.charts || []).map((x) => x && (x.name || x.type)), ...(p.candles || []).map((x) => x && (x.name || x.type))].filter(Boolean).slice(0, 4).map(plain);
  if (!names.length) return null;
  return { title: 'On the chart', html: `<p>The pattern scanner marks ${esc(names.join(', '))}${p.trend && p.trend.dir ? ` inside a ${esc(p.trend.dir)} trend` : ''}. ${esc(pick([`Patterns are a vocabulary, not a verdict: they tell you where other people's stops are.`, `A named pattern is useful mostly because the crowd trades it, which puts their orders where you can see them.`], seed))}</p>` };
}

function bullBear(st, c, d, seed) {
  const bull = [], bear = [];
  const facts = (st.facts || []).map(plain);
  for (const f of facts.slice(0, 3)) (st.lean === 'bearish' ? bear : bull).push(f);
  const it = d.intent && d.intent.intent;
  if (it && it.phase && it.phase !== 'undecided') (it.side === 'sellers' || it.phase === 'distribution' || it.phase === 'markdown' ? bear : it.side === 'buyers' || it.phase === 'accumulation' || it.phase === 'markup' ? bull : bear).push(`Intent read: ${it.phase}${it.side && it.side !== 'neither' ? ', ' + it.side + ' in control' : ''}.`);
  const si = d.shortInsight;
  if (si && si.pressing && num(si.pressing.score) >= 60) bear.push(`Shorts are pressing a weak tape (${Math.round(si.pressing.score)} of 100).`);
  if (si && si.model && num(si.model.score) >= 60) bull.push(`Squeeze fuel is real (${Math.round(si.model.score)} of 100 on the squeeze model).`);
  if (c.direction && num(c.direction.bias) != null) (c.direction.bias >= 15 ? bull : c.direction.bias <= -15 ? bear : bear).push(`Market backdrop: ${plain(c.direction.label)} (bias ${c.direction.bias >= 0 ? '+' : ''}${c.direction.bias}).`);
  if (d.sentiment && d.sentiment.components && d.sentiment.components.social && d.sentiment.components.social.crowdedLong) bear.push('Social positioning is crowded long; the bar is high.');
  if (c.earnings && num(c.earnings.daysAway) != null && c.earnings.daysAway <= 7) bear.push(`Earnings in ${c.earnings.daysAway} day${c.earnings.daysAway === 1 ? '' : 's'}: a binary that can gap through every level here.`);
  const counter = plain(V.counter(st, c, seed));
  (st.lean === 'bearish' ? bull : bear).push(counter);
  return { bull: bull.filter(Boolean).slice(0, 5), bear: bear.filter(Boolean).slice(0, 5) };
}

function faqFor(st, c, d, seed) {
  const S = '$' + c.symbol, name = c.name || c.symbol, label = engine.ANGLES[st.angle].label.toLowerCase();
  const q = [];
  q.push({ q: `Is ${S} a buy right now?`, a: `Nobody honest answers that for you. The data says ${S} is a ${st.lean} ${label} candidate with a scenario target of ${px(st.pt)} (${pct(st.ptPct)}) and an invalidation at ${num(st.stop) != null ? px(st.stop) : 'the level named above'}. Whether that fits your account, your horizon and your risk is your call, not ours.` });
  q.push({ q: `What is the ${S} price target in this read?`, a: `The scenario target is ${px(st.pt)}, ${pct(st.ptPct)} from ${px(c.price)}, over ${st.timeframe}. It is where the setup runs out of fuel if it works, not a forecast and not a recommendation.` });
  q.push({ q: `What would prove the ${S} ${label} thesis wrong?`, a: `${cap(plain(st.scenario.invalidation))}. If that happens, the read is wrong and the idea should not exist anymore.` });
  if (st.angle === 'short' || (d.shortInsight && d.shortInsight.interest)) q.push({ q: `How heavily shorted is ${name}?`, a: `${d.shortInsight && d.shortInsight.interest && num(d.shortInsight.interest.daysToCover) != null ? `The latest reported days-to-cover figure is ${Number(d.shortInsight.interest.daysToCover).toFixed(1)}.` : ''} ${c.short && num(c.short.ratio) != null ? `${Math.round(c.short.ratio * 100)}% of recent off-exchange volume printed as short sales on the FINRA feed.` : ''} Short interest is reported twice a month; short volume is daily, and the two measure different things.`.trim() });
  if (st.angle === 'gamma' || (c.gamma && c.gamma.available)) q.push({ q: `What is a gamma squeeze, and does it apply to ${S}?`, a: `A gamma squeeze happens when dealers who sold calls must buy stock to stay hedged as the price rises, which pushes the price further. ${c.gamma && c.gamma.available ? `On ${S} dealers are currently ${c.gamma.regime === 'negative' ? 'short gamma, so the mechanism is live' : 'long gamma, so the mechanism damps moves until the flip is cleared'}.` : ''}`.trim() });
  if (c.earnings && num(c.earnings.daysAway) != null && c.earnings.daysAway <= 45 && c.earnings.date) q.push({ q: `When does ${name} report earnings?`, a: `${S} is scheduled to report on ${String(c.earnings.date).slice(0, 10)}${c.earnings.timing && c.earnings.timing !== 'UNSPECIFIED' ? ' (' + c.earnings.timing + ')' : ''}. Dates can move; confirm on the company's investor site or the exchange calendar before trading the event.` });
  return q.slice(0, 5);
}

function nextSession(st, c, d) {
  const out = [];
  out.push(`${cap(plain(st.scenario.trigger))}.`);
  out.push(`${cap(plain(st.scenario.confirm))}.`);
  const lv = d.intent && d.intent.map && d.intent.map.levels ? d.intent.map.levels.slice(0, 2) : [];
  for (const l of lv) if (num(l.price) != null) out.push(`How price behaves at ${px(l.price)}${l.labels && l.labels[0] ? ' (' + plain(l.labels[0]) + ')' : ''}: defended, attacked, or ignored.`);
  if (c.earnings && num(c.earnings.daysAway) != null && c.earnings.daysAway <= 10) out.push(`The earnings date (${c.earnings.daysAway} day${c.earnings.daysAway === 1 ? '' : 's'} out) and whether the implied move widens into it.`);
  out.push(`${cap(plain(st.scenario.invalidation))}: the line that ends the idea.`);
  return out.slice(0, 5);
}

/* ---------- the modules ---------- */
function modChart(st, c, d, chartEndpoint, imageUrl = '') {
  const levels = [];
  if (c.gamma && c.gamma.callWall && num(c.gamma.callWall.strike) != null) levels.push({ label: 'CALL WALL', price: c.gamma.callWall.strike, kind: 'resistance' });
  if (c.gamma && c.gamma.putWall && num(c.gamma.putWall.strike) != null) levels.push({ label: 'PUT WALL', price: c.gamma.putWall.strike, kind: 'support' });
  if (c.gamma && num(c.gamma.flipStrike) != null && !c.gamma.flipIsApproximate) levels.push({ label: 'GAMMA FLIP', price: c.gamma.flipStrike, kind: 'pivot' });
  if (c.smc && c.smc.sweeps && c.smc.sweeps[0]) levels.push({ label: 'SWEPT ' + (c.smc.sweeps[0].kind === 'EQL' ? 'LOWS' : 'HIGHS'), price: c.smc.sweeps[0].level, kind: c.smc.sweeps[0].kind === 'EQL' ? 'support' : 'resistance' });
  const mapLv = d.intent && d.intent.map && d.intent.map.levels ? d.intent.map.levels.slice(0, 2) : [];
  for (const l of mapLv) if (num(l.price) != null && levels.length < 5) levels.push({ label: (l.labels && l.labels[0] ? plain(l.labels[0]).toUpperCase().slice(0, 18) : 'MAP LEVEL'), price: l.price, kind: l.price > c.price ? 'resistance' : 'support' });
  const ch = chart.candleChart({ symbol: c.symbol, bars: c.daily, price: c.price, target: st.pt, stop: st.stop, levels, path: st.path, lean: st.lean, count: 60, title: `$${c.symbol} daily: the path to ${px(st.pt)}`, subtitle: `${engine.ANGLES[st.angle].label} scenario. Real candles, then the move the setup needs. Speculative, not advice.` });
  if (!ch.ok) return null;
  const embed = chartEndpoint ? chartEndpoint.replace(/\/article-chart(?:\?.*)?$/, '/article-chart-embed') + '?symbol=' + encodeURIComponent(c.symbol) : '';
  const html = `<figure class="mem-chartbox" data-symbol="${esc(c.symbol)}"${chartEndpoint ? ` data-live-endpoint="${esc(chartEndpoint)}"` : ''}>
<div class="mem-chiprow"><span class="mem-chip mem-chip-live"><i></i>LIVE CHART</span><span class="mem-chip">$${esc(c.symbol)} <b data-live="price">${esc(px(c.price))}</b> <em data-live="change" class="${num(c.changePct, 0) >= 0 ? 'up' : 'dn'}">${num(c.changePct) != null ? esc(pct(c.changePct)) : ''}</em></span><span class="mem-chip mem-chip-mut" data-live="updated">as of publication</span></div>
${ch.svg}
${embed ? `<iframe class="mem-chart-embed" title="$${esc(c.symbol)} live price fallback" loading="lazy" src="${esc(embed)}"></iframe>` : ''}
<figcaption>Daily candles with the levels that matter and the scenario path: ${esc((st.path || []).map((p) => p.label.toLowerCase()).concat('target').join(', '))}. The white line is the last price and moves with the tape where the page can run script. Not a forecast.</figcaption></figure>`;
  /* the Loop Letters sanitizer keeps img and drops svg, iframe and script: the letter block carries the uploaded poster
     (the same scenario, drawn as a still) under a chip that says what it is; no poster, no chart block (the GIF image
     block in the body still shows the path) */
  const letter = imageUrl ? `<figure class="mem-chartbox mem-chartimg" data-symbol="${esc(c.symbol)}">
<div class="mem-chiprow"><span class="mem-chip">CHART · AS OF PUBLICATION</span><span class="mem-chip">$${esc(c.symbol)} <b>${esc(px(c.price))}</b> <em class="${num(c.changePct, 0) >= 0 ? 'up' : 'dn'}">${num(c.changePct) != null ? esc(pct(c.changePct)) : ''}</em></span></div>
<img src="${esc(imageUrl)}" alt="$${esc(c.symbol)} daily chart with the scenario path to ${esc(px(st.pt))}" width="1200" height="675" loading="lazy">
<figcaption>The candles as published, the levels that matter and the scenario path to ${esc(px(st.pt))}. Not a forecast.</figcaption></figure>` : '';
  return { html, height: 560, letter, letterHeight: imageUrl ? 760 : 0 };
}
function modBoard(parts, c) {
  const rows = [['PRICE', px(parts.price), '', 'price'], ...(Number.isFinite(parts.changePct) ? [['TODAY', pct(parts.changePct), parts.changePct >= 0 ? 'up' : 'dn', 'change']] : []), ...(Number.isFinite(parts.relVol) ? [['REL VOLUME', parts.relVol.toFixed(1) + 'x', '', '']] : []), ['SCENARIO TARGET', px(parts.pt) + ' (' + pct(parts.ptPct) + ')', parts.ptPct >= 0 ? 'up' : 'dn', ''], ...(Number.isFinite(parts.stop) ? [['INVALIDATION', px(parts.stop), '', '']] : []), ...(parts.keyStat ? [[parts.keyStat.label, parts.keyStat.value, '', '']] : [])];
  const spark = chart.sparkline((c.daily || []).slice(-30).map((b) => b.c));
  return `<div class="mem-board" aria-label="Key figures">${rows.map(([l, v, cls, live]) => `<div><span>${esc(l)}</span><b${cls ? ` class="${cls}"` : ''}${live ? ` data-live="${live}"` : ''}>${esc(v)}</b></div>`).join('')}${spark ? `<div class="mem-sparkcell"><span>30 SESSIONS</span>${spark}</div>` : ''}</div>`;
}
function modMeter(intentSec, shortSec, sentSec) {
  const g = [];
  if (intentSec) g.push(chart.gauge({ score: intentSec.strength, label: 'SMART MONEY', caption: `${cap(intentSec.phase)}${intentSec.side && intentSec.side !== 'neither' ? ' · ' + intentSec.side : ''}` }));
  if (shortSec && shortSec.squeeze != null) g.push(chart.gauge({ score: shortSec.squeeze, label: 'SQUEEZE RISK', caption: shortSec.pressing != null ? 'Shorts pressing ' + Math.round(shortSec.pressing) : '' }));
  if (sentSec) g.push(chart.gauge({ score: sentSec.score, label: 'SENTIMENT', caption: 'Crowd composite' }));
  if (!g.length) return null;
  /* the letter variant: a conic-gradient ring per meter (no svg), the ring's value set by a rule in the block's own css */
  const specs = [];
  if (intentSec) specs.push({ score: intentSec.strength, label: 'SMART MONEY', caption: `${cap(intentSec.phase)}${intentSec.side && intentSec.side !== 'neither' ? ' · ' + intentSec.side : ''}` });
  if (shortSec && shortSec.squeeze != null) specs.push({ score: shortSec.squeeze, label: 'SQUEEZE RISK', caption: shortSec.pressing != null ? 'Shorts pressing ' + Math.round(shortSec.pressing) : '' });
  if (sentSec) specs.push({ score: sentSec.score, label: 'SENTIMENT', caption: 'Crowd composite' });
  const ringCss = specs.map((m, i) => { const v = Math.max(0, Math.min(100, Math.round(num(m.score, 0)))); const col = v >= 70 ? '#19c37d' : v >= 45 ? '#ffb04a' : v >= 25 ? '#5cc8ff' : '#ff5c7a'; return `.mem-ring.r${i}{background:conic-gradient(${col} ${v}%,rgba(255,255,255,.12) 0)}.mem-ring.r${i} b{color:${col}}`; }).join('');
  const letter = `<div class="mem-rings" aria-label="Meters">${specs.map((m, i) => `<div class="mem-ring r${i}"><div class="mem-ring-in"><b>${Math.round(num(m.score, 0))}</b><span>${esc(m.label)}</span></div></div><small>${esc(m.caption || '')}</small>`).map((h, i) => `<div class="mem-ring-cell">${h}</div>`).join('')}</div>`;
  return { html: `<div class="mem-meters" aria-label="Meters">${g.join('')}</div>`, height: 190, letter, letterHeight: 200, css: ringCss };
}
function modTabs(st, c, d, id) {
  const tabs = [];
  const dl = (rows) => `<dl>${rows.filter((r) => r[1] != null && r[1] !== '').map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  if (c.tape || (d.shortInsight && d.shortInsight.tape)) { const t = c.tape || {}, st2 = d.shortInsight && d.shortInsight.tape || {}; tabs.push(['TAPE', dl([['Buy sweeps', num(t.sweepBuy, st2.sweepBuy)], ['Sell sweeps', num(t.sweepSell, st2.sweepSell)], ['Block buys', num(t.blockBuy, st2.blockBuy)], ['Block sells', num(t.blockSell, st2.blockSell)], ['Off-exchange share', num(t.offSharePct) != null ? Math.round(t.offSharePct) + '%' : null], ['Absorption', t.absorption ? 'yes' : null]])]); }
  if (c.short || (d.shortInsight && d.shortInsight.interest)) { const s = c.short || {}, it = d.shortInsight && d.shortInsight.interest || {}; tabs.push(['SHORTS', dl([['Short volume ratio', num(s.ratio) != null ? Math.round(s.ratio * 100) + '%' : null], ['Normal ratio', num(s.baselineRatio) != null ? Math.round(s.baselineRatio * 100) + '%' : null], ['Days to cover', num(s.daysToCover, it.daysToCover) != null ? Number(num(s.daysToCover, it.daysToCover)).toFixed(1) : null], ['Short interest', num(it.shortInterest) != null ? big(num(it.shortInterest)) + ' shares' : (num(s.shortInterestPct) != null ? s.shortInterestPct.toFixed(1) + '% of float' : null)], ['Change since last report', num(it.siChangePct) != null ? pct(it.siChangePct) : null]])]); }
  if (c.gamma && c.gamma.available) { const g = c.gamma; tabs.push(['OPTIONS', dl([['Dealer gamma', g.regime], ['Call wall', g.callWall ? px(g.callWall.strike) : null], ['Put wall', g.putWall ? px(g.putWall.strike) : null], ['Gamma flip', num(g.flipStrike) != null ? px(g.flipStrike) : null], ['Hedge pressure', num(g.pressurePct) != null ? Math.round(g.pressurePct) + '% of ADV' : null], ['Same-day expiries', num(g.zeroDteShare) != null ? Math.round(g.zeroDteShare * 100) + '%' : null]])]); }
  if (c.smc) { const m = c.smc, ev = (m.structure || [])[0], sw = (m.sweeps || [])[0], ob = (m.orderBlocks || [])[0], g = (m.fvgs || [])[0]; tabs.push(['STRUCTURE', dl([['Last event', ev ? `${ev.type} ${ev.dir > 0 ? 'up' : 'down'} at ${px(ev.level)}` : null], ['Last sweep', sw ? `${sw.kind} at ${px(sw.level)}` : null], ['Order block', ob ? `${px(ob.bottom)} to ${px(ob.top)}` : null], ['Open imbalance', g ? `${px(g.bottom)} to ${px(g.top)}` : null], ['Range position', m.range && num(m.range.pos) != null ? Math.round(m.range.pos * 100) + '% up from the low' : null], ['VWAP', m.vwap ? `${px(m.vwap.level)} (${m.vwap.above ? 'above' : 'below'})` : null]])]); }
  if (!tabs.length) return null;
  const name = 'mem-tab-' + id;
  const letter = `<div class="mem-strip" aria-label="The data by desk">${tabs.map(([t, body]) => `<section><h3>${esc(t)}</h3>${body}</section>`).join('')}</div>`;
  return { html: `<div class="mem-tabs" aria-label="The data by desk">${tabs.map(([t], i) => `<input type="radio" name="${name}" id="${name}-${i}"${i === 0 ? ' checked' : ''}><label for="${name}-${i}">${esc(t)}</label>`).join('')}${tabs.map(([, body], i) => `<section class="mem-tabpane" data-i="${i}">${body}</section>`).join('')}</div>`, height: 300, letter, letterHeight: 120 + tabs.length * 150 };
}
function modVs(bb) {
  return { html: `<div class="mem-vs" aria-label="Bull case versus bear case"><div class="mem-vs-col mem-vs-bull"><h3>THE BULL CASE</h3><ul>${bb.bull.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Thin. The data does not make a strong long case here.</li>'}</ul></div><div class="mem-vs-col mem-vs-bear"><h3>THE BEAR CASE</h3><ul>${bb.bear.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Thin. The data does not make a strong short case here.</li>'}</ul></div></div>`, height: 360 };
}
function modTrack(st, c) {
  const stop = num(st.stop), pt = num(st.pt), p = num(c.price); if (stop == null || pt == null || p == null || stop === pt) return null;
  const lo = Math.min(stop, pt), hi = Math.max(stop, pt), pos = Math.max(0, Math.min(100, (p - lo) / (hi - lo) * 100));
  const bearish = st.lean === 'bearish';
  return { html: `<div class="mem-track${bearish ? ' bearish' : ''}" data-stop="${esc(stop)}" data-target="${esc(pt)}" aria-label="Path tracker"><div class="mem-track-head"><span>PATH TRACKER</span><b data-live="price">${esc(px(p))}</b></div><div class="mem-track-bar"><i style="left:${pos.toFixed(1)}%"></i></div><div class="mem-track-ends"><span class="${bearish ? 'tg' : 'st'}">${esc(px(lo))} ${bearish ? 'target' : 'invalidation'}</span><span class="${bearish ? 'st' : 'tg'}">${esc(px(hi))} ${bearish ? 'invalidation' : 'target'}</span></div><p>The marker is the last price between the line that kills the idea and the line where it pays. ${esc(bearish ? 'Lower is the trade working.' : 'Higher is the trade working.')}</p></div>`, height: 150,
    letter: `<div class="mem-track${bearish ? ' bearish' : ''}" aria-label="Path tracker"><div class="mem-track-head"><span>PATH TRACKER · AS OF PUBLICATION</span><b>${esc(px(p))}</b></div><div class="mem-track-bar"><i></i></div><div class="mem-track-ends"><span class="${bearish ? 'tg' : 'st'}">${esc(px(lo))} ${bearish ? 'target' : 'invalidation'}</span><span class="${bearish ? 'st' : 'tg'}">${esc(px(hi))} ${bearish ? 'invalidation' : 'target'}</span></div><p>The marker is the price at publication between the line that kills the idea and the line where it pays. ${esc(bearish ? 'Lower is the trade working.' : 'Higher is the trade working.')}</p></div>`,
    letterHeight: 150, css: `.mem-track-bar i{left:${pos.toFixed(1)}%}` };
}
function modKill(st, c, items) {
  return { html: `<div class="mem-kill" data-key="mem-kill-${esc(c.symbol)}" aria-label="Kill switch checklist"><h3>KILL SWITCH</h3><p>Tick what you have seen. Any one of these and the thesis is over, no averaging down, no renaming it.</p><ul>${items.map((t, i) => `<li><label><input type="checkbox" data-i="${i}"><span>${esc(t)}</span></label></li>`).join('')}</ul></div>`, height: 110 + items.length * 34,
    letter: `<div class="mem-kill" aria-label="Kill switch checklist"><h3>KILL SWITCH</h3><p>Any one of these and the thesis is over, no averaging down, no renaming it.</p><ul class="mem-check">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`, letterHeight: 110 + items.length * 34 };
}
function modCountdown(er, c) {
  if (!er || !er.date || num(er.daysAway) == null || er.daysAway < 0 || er.daysAway > 60) return null;
  return { html: `<div class="mem-count" data-date="${esc(String(er.date).slice(0, 10))}" aria-label="Earnings countdown"><span>EARNINGS COUNTDOWN · $${esc(c.symbol)}</span><b data-count="1">${er.daysAway === 0 ? 'today' : er.daysAway + ' day' + (er.daysAway === 1 ? '' : 's')}</b><small>${esc(String(er.date).slice(0, 10))}${er.timing && er.timing !== 'UNSPECIFIED' ? ' · ' + esc(er.timing) : ''}</small></div>`, height: 110 };
}
function modPoll(st, c, id, discordUrl = '') {
  const name = 'mem-poll-' + id;
  return { html: `<div class="mem-poll" data-key="mem-poll-${esc(c.symbol)}" aria-label="Bull or bear poll"><h3>YOUR CALL ON $${esc(c.symbol)}</h3><p>The desk leans <b>${esc(st.lean)}</b>. Where do you land?</p><div class="mem-poll-row"><input type="radio" name="${name}" id="${name}-bull" value="bull"><label for="${name}-bull">BULL</label><input type="radio" name="${name}" id="${name}-bear" value="bear"><label for="${name}-bear">BEAR</label></div><p class="mem-poll-after" data-after="bull">Noted. You and the desk ${st.lean === 'bullish' ? 'agree; the kill switch above is what keeps agreement from becoming a bag' : 'disagree; the bear case above is what the desk would need to be wrong about'}.</p><p class="mem-poll-after" data-after="bear">Noted. You and the desk ${st.lean === 'bearish' ? 'agree; the invalidation level is still the line' : 'disagree; the bull case above is what you would need to be wrong about'}.</p></div>`, height: 170,
    letter: `<div class="mem-poll" aria-label="Bull or bear"><h3>YOUR CALL ON $${esc(c.symbol)}</h3><p>The desk leans <b>${esc(st.lean)}</b>. ${discordUrl ? `Bull or bear, say so in <a href="${esc(discordUrl)}" rel="noopener" target="_blank">the Making Easy Money Discord</a>, where the alerts land first.` : 'Bull or bear, the kill switch above is what keeps either call honest.'}</p></div>`, letterHeight: 120 };
}
function modShare(url, title) {
  const u = encodeURIComponent(url || ''), t = encodeURIComponent(title || '');
  return `<div class="mem-share" aria-label="Share"><span>SHARE THIS READ</span><a href="https://twitter.com/intent/tweet?text=${t}&amp;url=${u}" rel="noopener" target="_blank">X</a><a href="https://www.reddit.com/submit?url=${u}&amp;title=${t}" rel="noopener" target="_blank">Reddit</a><a href="https://www.linkedin.com/sharing/share-offsite/?url=${u}" rel="noopener" target="_blank">LinkedIn</a><button type="button" data-copy="${esc(url || '')}">Copy link</button></div>`;
}

/* ---------- the stylesheet (namespaced under .mem-article; dark by default, light by data-theme or system) ---------- */
const CSS = [
  '.mem-article{--bg:#0b1119;--ink:#e8eff4;--mut:#8fa3b0;--line:rgba(255,255,255,.1);--card:#101a25;--acc:#19c37d;--acc2:#ff5c7a;--gold:#ffb04a;--hl:rgba(25,195,125,.12);max-width:760px;margin:0 auto;padding:0 18px 72px;color:var(--ink);background:var(--bg);font:400 18px/1.7 Georgia,"Iowan Old Style",Charter,serif;-webkit-text-size-adjust:100%;position:relative}',
  '.mem-article[data-theme="light"]{--bg:#fbfbf8;--ink:#14181d;--mut:#5b6773;--line:#e4e6e0;--card:#fff;--acc:#00a56a;--hl:#d8f7e8}',
  '.mem-article *{box-sizing:border-box}.mem-article a{color:var(--acc);text-decoration-thickness:1px;text-underline-offset:2px}.mem-article p{margin:0 0 16px}.mem-article ul,.mem-article ol{margin:0 0 18px;padding-left:22px}.mem-article li{margin:6px 0}',
  '.mem-article h1{margin:10px 0;font:800 clamp(28px,5.4vw,44px)/1.08 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.025em;color:#fff}.mem-article[data-theme="light"] h1{color:var(--ink)}',
  '.mem-article h2{margin:36px 0 10px;font:800 24px/1.2 system-ui,sans-serif;letter-spacing:-.01em}.mem-article h2:after{content:"";display:block;width:44px;height:4px;margin-top:8px;border-radius:2px;background:var(--acc)}.mem-article h3{margin:0 0 8px;font:800 13px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em;color:var(--mut)}',
  '.mem-progress{position:fixed;left:0;top:0;height:3px;width:100%;z-index:99;background:transparent;pointer-events:none}.mem-progress i{display:block;height:100%;width:0;background:var(--acc)}',
  '.mem-kick{font:800 12px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.16em;color:var(--acc);text-transform:uppercase;margin-top:22px}.mem-dek{margin:0 0 16px;font:500 clamp(18px,2.6vw,22px)/1.4 system-ui,sans-serif;color:var(--mut)}',
  '.mem-by{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font:600 14px/1.3 system-ui,sans-serif;color:var(--mut)}.mem-by b{color:var(--ink)}.mem-by .mem-chip-live{margin-left:auto}',
  '.mem-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card);font:800 11px/1 ui-monospace,monospace;letter-spacing:.08em;color:var(--ink)}.mem-chip b{color:#fff}.mem-article[data-theme="light"] .mem-chip b{color:var(--ink)}.mem-chip em{font-style:normal}.mem-chip .up,.mem-article .up{color:var(--acc)}.mem-chip .dn,.mem-article .dn{color:var(--acc2)}.mem-chip-mut{color:var(--mut);font-weight:600;letter-spacing:.02em}',
  '.mem-chip-live i{width:7px;height:7px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 0 rgba(25,195,125,.6);animation:mem-pulse 1.8s infinite}@keyframes mem-pulse{0%{box-shadow:0 0 0 0 rgba(25,195,125,.6)}70%{box-shadow:0 0 0 8px rgba(25,195,125,0)}100%{box-shadow:0 0 0 0 rgba(25,195,125,0)}}',
  '.mem-board{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:10px;margin:18px 0 6px;font-family:system-ui,sans-serif}.mem-board>div{padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--card)}.mem-board span{display:block;font:800 10.5px/1 ui-monospace,monospace;letter-spacing:.12em;color:var(--mut)}.mem-board b{display:block;margin-top:7px;font:800 20px/1 system-ui,sans-serif}.mem-sparkcell svg{display:block;margin-top:6px}',
  '.mem-lede{font-size:1.08em}.mem-lede p:first-child{font-weight:700}',
  '.mem-chartbox{margin:22px 0;padding:0;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#0b1119}.mem-chartbox svg{display:block;width:100%;height:auto}.mem-chart-embed{display:block;width:100%;min-height:310px;border:0;background:#0b1119}.mem-chartbox.mem-live-ready .mem-chart-embed{display:none}.mem-chiprow{display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}.mem-chartbox figcaption{padding:10px 12px;font:500 13px/1.45 system-ui,sans-serif;color:#9fb2bd}',
  '.mem-meters{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:14px 0 6px;padding:12px;border:1px solid var(--line);border-radius:16px;background:var(--card)}.mem-meters svg{max-width:100%;height:auto}',
  '.mem-tabs{margin:18px 0;border:1px solid var(--line);border-radius:14px;background:var(--card);overflow:hidden;font-family:system-ui,sans-serif}.mem-tabs>input{position:absolute;opacity:0;pointer-events:none}.mem-tabs>label{display:inline-block;padding:10px 14px;font:800 12px/1 ui-monospace,monospace;letter-spacing:.1em;color:var(--mut);cursor:pointer;border-bottom:2px solid transparent}.mem-tabs>input:checked+label{color:var(--acc);border-bottom-color:var(--acc)}.mem-tabpane{display:none;padding:14px 16px;border-top:1px solid var(--line)}',
  '.mem-tabs>input:nth-of-type(1):checked~.mem-tabpane[data-i="0"],.mem-tabs>input:nth-of-type(2):checked~.mem-tabpane[data-i="1"],.mem-tabs>input:nth-of-type(3):checked~.mem-tabpane[data-i="2"],.mem-tabs>input:nth-of-type(4):checked~.mem-tabpane[data-i="3"]{display:block}',
  '.mem-tabpane dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px 16px;margin:0}.mem-tabpane dt{font:800 10.5px/1 ui-monospace,monospace;letter-spacing:.1em;color:var(--mut)}.mem-tabpane dd{margin:4px 0 0;font:700 16px/1.2 system-ui,sans-serif}',
  '.mem-vs{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0;font-family:system-ui,sans-serif;font-size:15px;line-height:1.5}.mem-vs-col{padding:14px 16px;border-radius:14px;border:1px solid var(--line);background:var(--card)}.mem-vs-bull{border-top:4px solid var(--acc)}.mem-vs-bear{border-top:4px solid var(--acc2)}.mem-vs-bear h3{color:var(--acc2)}.mem-vs-bull h3{color:var(--acc)}.mem-vs ul{padding-left:18px;margin:0}',
  '.mem-track{margin:18px 0;padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:var(--card);font-family:system-ui,sans-serif}.mem-track-head{display:flex;justify-content:space-between;font:800 12px/1 ui-monospace,monospace;letter-spacing:.1em;color:var(--mut)}.mem-track-head b{color:#fff;font-size:15px}.mem-article[data-theme="light"] .mem-track-head b{color:var(--ink)}.mem-track-bar{position:relative;height:12px;margin:12px 0 8px;border-radius:999px;background:linear-gradient(90deg,var(--acc2),var(--gold),var(--acc))}.mem-track.bearish .mem-track-bar{background:linear-gradient(90deg,var(--acc),var(--gold),var(--acc2))}.mem-track-bar i{position:absolute;top:-5px;width:22px;height:22px;margin-left:-11px;border-radius:50%;background:#fff;border:3px solid #0b1119;box-shadow:0 0 0 2px rgba(255,255,255,.4)}.mem-track-ends{display:flex;justify-content:space-between;font:700 12px/1.3 ui-monospace,monospace}.mem-track-ends .st{color:var(--acc2)}.mem-track-ends .tg{color:var(--acc)}.mem-track p{margin:8px 0 0;font-size:13px;color:var(--mut)}',
  '.mem-kill{margin:18px 0;padding:14px 16px;border:1px solid var(--acc2);border-radius:14px;background:rgba(255,92,122,.06);font-family:system-ui,sans-serif;font-size:15px}.mem-kill h3{color:var(--acc2)}.mem-kill ul{list-style:none;padding:0;margin:0}.mem-kill li{margin:6px 0}.mem-kill label{display:flex;gap:10px;align-items:flex-start;cursor:pointer}.mem-kill input{margin-top:5px;accent-color:#ff5c7a}.mem-kill input:checked+span{text-decoration:line-through;color:var(--mut)}.mem-kill p{margin:0 0 10px;color:var(--mut);font-size:13px}',
  '.mem-count{display:flex;flex-direction:column;align-items:center;gap:4px;margin:18px 0;padding:14px;border:1px solid var(--gold);border-radius:14px;background:rgba(255,176,74,.07);font-family:system-ui,sans-serif;text-align:center}.mem-count span{font:800 11px/1 ui-monospace,monospace;letter-spacing:.14em;color:var(--gold)}.mem-count b{font:900 30px/1.1 system-ui,sans-serif;color:#fff}.mem-article[data-theme="light"] .mem-count b{color:var(--ink)}.mem-count small{color:var(--mut)}',
  '.mem-poll{margin:18px 0;padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:var(--card);font-family:system-ui,sans-serif;font-size:15px}.mem-poll-row{display:flex;gap:10px}.mem-poll-row input{position:absolute;opacity:0;pointer-events:none}.mem-poll-row label{flex:1;text-align:center;padding:12px;border:1px solid var(--line);border-radius:12px;font:900 14px/1 ui-monospace,monospace;letter-spacing:.12em;cursor:pointer}.mem-poll-row input[value="bull"]:checked+label{border-color:var(--acc);color:var(--acc);background:var(--hl)}.mem-poll-row input[value="bear"]:checked+label{border-color:var(--acc2);color:var(--acc2);background:rgba(255,92,122,.1)}',
  '.mem-poll-after{display:none;margin:10px 0 0;color:var(--mut);font-size:14px}.mem-poll-row:has(input[value="bull"]:checked)~.mem-poll-after[data-after="bull"],.mem-poll-row:has(input[value="bear"]:checked)~.mem-poll-after[data-after="bear"]{display:block}.mem-poll p{margin:0 0 10px}',
  '.mem-take{margin:20px 0;padding:16px 18px;border-left:5px solid var(--acc);background:var(--hl);border-radius:0 14px 14px 0;font-family:system-ui,sans-serif;font-size:16px}.mem-take h3{color:var(--acc)}.mem-take ul{margin:0;padding-left:20px}',
  '.mem-pull{margin:26px 0;padding:6px 0 6px 18px;border-left:4px solid var(--acc);font:700 clamp(20px,3vw,26px)/1.3 system-ui,sans-serif;letter-spacing:-.01em}',
  '.mem-spec{padding:14px 16px;border:1px dashed var(--gold);border-radius:14px;background:rgba(255,176,74,.05)}.mem-spec .mem-label{display:inline-block;margin-bottom:6px;padding:3px 8px;border-radius:6px;background:var(--gold);color:#1a1400;font:900 10.5px/1 ui-monospace,monospace;letter-spacing:.12em}',
  '.mem-path{counter-reset:p;list-style:none;padding:0;margin:0 0 18px}.mem-path li{counter-increment:p;position:relative;padding:8px 10px 8px 44px;margin:6px 0;border-radius:12px;background:var(--card);border:1px solid var(--line);font-family:system-ui,sans-serif;font-size:15.5px}.mem-path li:before{content:counter(p);position:absolute;left:12px;top:9px;width:22px;height:22px;border-radius:50%;background:var(--acc);color:#04140d;font:800 12px/22px system-ui;text-align:center}',
  '.mem-faq details{margin:8px 0;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);font-family:system-ui,sans-serif;font-size:15.5px}.mem-faq summary{cursor:pointer;font-weight:800;list-style:none;display:flex;justify-content:space-between;gap:10px}.mem-faq summary:after{content:"+";color:var(--acc);font-weight:900}.mem-faq details[open] summary:after{content:"\\2013"}.mem-faq details p{margin:10px 0 0;color:var(--ink)}',
  '.mem-share{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:22px 0;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);font-family:system-ui,sans-serif}.mem-share span{font:800 11px/1 ui-monospace,monospace;letter-spacing:.12em;color:var(--mut);margin-right:auto}.mem-share a,.mem-share button{padding:7px 12px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--ink);font:700 12px/1 system-ui,sans-serif;text-decoration:none;cursor:pointer}.mem-share button.done{border-color:var(--acc);color:var(--acc)}',
  '.mem-sources{font-family:system-ui,sans-serif;font-size:14px}.mem-sources li{margin:4px 0}.mem-sources small{color:var(--mut)}.mem-gloss{font-family:system-ui,sans-serif;font-size:14px;color:var(--mut)}.mem-gloss dt{font-weight:800;color:var(--ink);margin-top:8px}.mem-gloss dd{margin:2px 0 0}',
  '.mem-letter{padding:0!important}.mem-chartimg img{display:block;width:100%;height:auto}.mem-rings{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;padding:14px;border:1px solid var(--line);border-radius:16px;background:var(--card);font-family:system-ui,sans-serif}.mem-ring-cell{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:120px}.mem-ring{width:112px;height:112px;border-radius:50%;display:grid;place-items:center}.mem-ring-in{width:86px;height:86px;border-radius:50%;background:var(--card);display:flex;flex-direction:column;align-items:center;justify-content:center}.mem-ring-in b{font:900 26px/1 system-ui,sans-serif}.mem-ring-in span{margin-top:3px;font:800 8.5px/1 ui-monospace,monospace;letter-spacing:.08em;color:var(--mut)}.mem-ring-cell small{color:var(--ink);font-size:12px}',
  '.mem-strip{display:grid;gap:10px;margin:0;font-family:system-ui,sans-serif}.mem-strip section{padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--card)}.mem-strip h3{margin:0 0 8px;color:var(--acc)}.mem-strip dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 16px;margin:0}.mem-strip dt{font:800 10.5px/1 ui-monospace,monospace;letter-spacing:.1em;color:var(--mut)}.mem-strip dd{margin:4px 0 0;font:700 15px/1.2 system-ui,sans-serif}',
  '.mem-check{list-style:none;padding:0;margin:0}.mem-check li{position:relative;padding-left:26px;margin:6px 0}.mem-check li:before{content:"";position:absolute;left:0;top:4px;width:14px;height:14px;border:2px solid var(--acc2);border-radius:4px}',
  '.mem-record{padding:10px 14px;border:1px solid var(--line);border-left:4px solid var(--gold);border-radius:0 12px 12px 0;background:var(--card);font:500 14.5px/1.5 system-ui,sans-serif}',
  '.mem-disclosure{margin-top:34px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--card);font:400 13.5px/1.55 system-ui,sans-serif;color:var(--mut)}',
  '@media(max-width:620px){.mem-article{padding:0 14px 60px;font-size:17px}.mem-vs{grid-template-columns:1fr}.mem-by .mem-chip-live{margin-left:0}.mem-tabs>label{padding:9px 10px;font-size:11px}}',
  '@media(prefers-color-scheme:light){.mem-article:not([data-theme="dark"]){--bg:#fbfbf8;--ink:#14181d;--mut:#5b6773;--line:#e4e6e0;--card:#fff;--acc:#00a56a;--hl:#d8f7e8}.mem-article:not([data-theme="dark"]) h1,.mem-article:not([data-theme="dark"]) .mem-chip b,.mem-article:not([data-theme="dark"]) .mem-count b,.mem-article:not([data-theme="dark"]) .mem-track-head b{color:var(--ink)}}',
  '@media print{.mem-article{background:#fff;color:#000}.mem-progress,.mem-share,.mem-poll{display:none}}'
].join('\n');

/* ---------- the enhancement script: optional, dependency-free, degrades to nothing ---------- */
const JS = `(function(){var root=document.querySelector('.mem-article');if(!root)return;
function $(s,el){return (el||root).querySelector(s)}function $$(s,el){return Array.prototype.slice.call((el||root).querySelectorAll(s))}
var px=function(v){return (Math.abs(v)>=1?'$'+Number(v).toFixed(2):'$'+Number(v).toFixed(4))};
/* reading progress */
var bar=document.createElement('div');bar.className='mem-progress';bar.innerHTML='<i></i>';document.body.appendChild(bar);
function prog(){var r=root.getBoundingClientRect(),h=root.offsetHeight-window.innerHeight,y=Math.min(1,Math.max(0,-r.top/Math.max(1,h)));bar.firstChild.style.width=(y*100).toFixed(1)+'%'}
window.addEventListener('scroll',prog,{passive:true});prog();
/* remembered checklists and the poll */
function store(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}function load(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}}
$$('.mem-kill').forEach(function(k){var key=k.getAttribute('data-key'),saved=load(key)||{};$$('input[type=checkbox]',k).forEach(function(c){var i=c.getAttribute('data-i');if(saved[i])c.checked=true;c.addEventListener('change',function(){saved[i]=c.checked;store(key,saved)})})});
$$('.mem-poll').forEach(function(p){var key=p.getAttribute('data-key'),saved=load(key);$$('input[type=radio]',p).forEach(function(r){if(saved&&r.value===saved)r.checked=true;r.addEventListener('change',function(){store(key,r.value)})})});
/* copy link */
$$('.mem-share button[data-copy]').forEach(function(b){b.addEventListener('click',function(){var u=b.getAttribute('data-copy')||location.href;function done(){b.classList.add('done');b.textContent='Copied';setTimeout(function(){b.classList.remove('done');b.textContent='Copy link'},1800)}if(navigator.clipboard)navigator.clipboard.writeText(u).then(done,function(){});else{var t=document.createElement('textarea');t.value=u;document.body.appendChild(t);t.select();try{document.execCommand('copy');done()}catch(e){}t.remove()}})});
/* earnings countdown */
$$('.mem-count').forEach(function(c){var d=Date.parse(c.getAttribute('data-date')+'T13:30:00Z');if(!isFinite(d))return;var b=$('[data-count]',c);function tick(){var ms=d-Date.now();if(ms<=0){b.textContent='reporting';return}var days=Math.floor(ms/864e5),h=Math.floor(ms%864e5/36e5),m=Math.floor(ms%36e5/6e4);b.textContent=days>0?days+'d '+h+'h':h+'h '+m+'m'}tick();setInterval(tick,60000)});
/* live price: the chart's white line, the chips, the tracker */
var box=$('.mem-chartbox'),ep=box&&box.getAttribute('data-live-endpoint'),sym=box&&box.getAttribute('data-symbol');
function moveLine(price){var svg=$('svg.mem-chart');if(!svg)return;var lo=+svg.getAttribute('data-ymin'),hi=+svg.getAttribute('data-ymax'),top=+svg.getAttribute('data-top'),h=+svg.getAttribute('data-h');if(!(hi>lo))return;var y=top+(hi-Math.min(hi,Math.max(lo,price)))/(hi-lo)*h,g=$('.mem-live',svg);if(!g)return;var ln=g.querySelector('line'),rc=g.querySelector('rect'),tx=g.querySelector('text');if(ln){ln.setAttribute('y1',y.toFixed(1));ln.setAttribute('y2',y.toFixed(1))}if(rc)rc.setAttribute('y',(y-9).toFixed(1));if(tx){tx.setAttribute('y',(y+4).toFixed(1));tx.textContent=px(price)}}
function paint(q){if(!q||!(q.last>0))return;$$('[data-live=price]').forEach(function(e){e.textContent=px(q.last)});if(q.changePct!=null)$$('[data-live=change]').forEach(function(e){e.textContent=(q.changePct>=0?'+':'')+Number(q.changePct).toFixed(2)+'%';e.className=q.changePct>=0?'up':'dn'});$$('[data-live=updated]').forEach(function(e){e.textContent='updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});moveLine(q.last);$$('.mem-track').forEach(function(t){var s=+t.getAttribute('data-stop'),g=+t.getAttribute('data-target'),lo=Math.min(s,g),hi=Math.max(s,g),m=$('.mem-track-bar i',t);if(m&&hi>lo)m.style.left=(Math.max(0,Math.min(100,(q.last-lo)/(hi-lo)*100))).toFixed(1)+'%'})}
function poll(){if(!ep||!sym)return;fetch(ep+(ep.indexOf('?')>0?'&':'?')+'symbol='+encodeURIComponent(sym),{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){if(j&&j.ok&&j.quote){paint(j.quote);if(box)box.classList.add('mem-live-ready')}}).catch(function(){})}
poll();setInterval(poll,30000);
})();`;

/* ---------- the SEO head ---------- */
function headFor({ seo, draft, url, siteUrl, authorUrl, publication, byline, c, faq, imageUrl, asOfIso, section = 'Markets', logoUrl = '' }) {
  const title = esc(seo.meta_title), desc = esc(seo.meta_desc);
  const ld = [
    { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: String(draft.title).slice(0, 110), alternativeHeadline: plain(draft.dek).slice(0, 150), description: plain(seo.meta_desc), mainEntityOfPage: { '@type': 'WebPage', '@id': url || '' }, url: url || undefined, image: imageUrl ? [imageUrl] : undefined, datePublished: asOfIso, dateModified: asOfIso, articleSection: section, keywords: (draft.tags || []).join(', '), inLanguage: 'en-US', isAccessibleForFree: true, wordCount: draft.wordCount || undefined, about: { '@type': 'Corporation', name: c.name || c.symbol, tickerSymbol: c.symbol }, author: { '@type': 'Person', name: byline, url: authorUrl || undefined }, publisher: { '@type': 'Organization', name: publication, url: siteUrl || undefined, logo: logoUrl ? { '@type': 'ImageObject', url: logoUrl } : undefined }, speakable: { '@type': 'SpeakableSpecification', cssSelector: ['h1', '.mem-dek'] } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl }, { '@type': 'ListItem', position: 2, name: 'Markets', item: siteUrl + '/markets/' }, { '@type': 'ListItem', position: 3, name: '$' + c.symbol, item: siteUrl + '/stocks/' + c.symbol.toLowerCase() + '/' }] }
  ];
  const tags = (draft.tags || []).slice(0, 8);
  return '<title>' + title + '</title>\n<meta name="description" content="' + desc + '">\n'
    + (url ? '<link rel="canonical" href="' + esc(url) + '">\n' : '')
    + '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">\n<meta name="author" content="' + esc(byline) + '">\n<meta name="keywords" content="' + esc(tags.join(', ')) + '">\n<meta name="news_keywords" content="' + esc(tags.join(', ')) + '">\n'
    + '<meta property="og:type" content="article">\n<meta property="og:site_name" content="' + esc(publication) + '">\n<meta property="og:title" content="' + esc(seo.og_title || draft.title) + '">\n<meta property="og:description" content="' + desc + '">\n' + (url ? '<meta property="og:url" content="' + esc(url) + '">\n' : '') + (imageUrl ? '<meta property="og:image" content="' + esc(imageUrl) + '">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="675">\n' : '')
    + '<meta property="article:published_time" content="' + esc(asOfIso) + '">\n<meta property="article:modified_time" content="' + esc(asOfIso) + '">\n<meta property="article:author" content="' + esc(byline) + '">\n<meta property="article:section" content="' + esc(section) + '">\n' + tags.map((t) => '<meta property="article:tag" content="' + esc(t) + '">').join('\n') + '\n'
    + '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="' + esc(seo.og_title || draft.title) + '">\n<meta name="twitter:description" content="' + desc + '">\n' + (imageUrl ? '<meta name="twitter:image" content="' + esc(imageUrl) + '">\n' : '')
    + '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>';
}

/* ---------- compose ---------- */
function composeArticle({ story: st, c, dossier = {}, asOf = Date.now(), author = 'Vaughn McNair', publication = 'Making Easy Money', siteUrl = 'https://stockmarketloop.com', authorUrl = '', chartEndpoint = '', discordUrl = '', url = '', imageUrl = '', topic = null, logoUrl = '', record = null } = {}) {
  const d = dossier || {};
  const draft = engine.draftArticle(st, c, { asOf, author, publication });
  const seed = seedOf(c.symbol + st.angle + Math.round(asOf / 3_600_000));
  const S = '$' + c.symbol, label = engine.ANGLES[st.angle].label;
  const src = Object.fromEntries(sourcesFor(c, d, { siteUrl, authorUrl: authorUrl || siteUrl + '/n/grandmasterobi/', discordUrl }).map((s) => [s.key, s]));
  const title = topic ? `${cap(topic)} through ${S}: ${draft.title.replace(/^\$[A-Z0-9.\-]+:?\s*/, '')}`.slice(0, 110) : draft.title;
  const id = String(Math.abs(seedOf(c.symbol + asOf)) % 100000);
  const when = draft.parts.when;
  const readMin = (words) => Math.max(3, Math.round(words / 230));

  /* sections */
  const lede = ledeFor(st, c, d, seed);
  const intentSec = intentSection(d, c, seed), shortSec = shortSection(d, c, seed), dpSec = darkPoolSection(d, seed), erSec = earningsSection(d, c, seed), optSec = optionsSection(c, seed), sentSec = sentimentSection(d, seed), filSec = filingsSection(d, src, seed), patSec = patternsSection(d, seed);
  const bb = bullBear(st, c, d, seed);
  const faq = faqFor(st, c, d, seed);
  const next = nextSession(st, c, d);
  const killItems = [cap(plain(st.scenario.invalidation)) + '.', st.lean === 'bearish' ? 'Buyers absorb the selling at a map level and price reclaims it on volume.' : 'Sellers absorb the buying at a map level and price loses it on volume.', 'The tape flips: the sweeps and blocks start printing on the other side.', c.earnings && num(c.earnings.daysAway) != null && c.earnings.daysAway <= 10 ? 'The earnings print gaps the stock through the invalidation.' : 'Two sessions of price moving against the read with no new fuel.'];

  /* modules */
  const chartMod = modChart(st, c, d, chartEndpoint, imageUrl), meter = modMeter(intentSec, shortSec, sentSec), tabs = modTabs(st, c, d, id), vs = modVs(bb), track = modTrack(st, c), kill = modKill(st, c, killItems), count = modCountdown(c.earnings, c), pollMod = modPoll(st, c, id, discordUrl);
  const board = modBoard(draft.parts, c);
  const takeaways = draft.parts.takeaways || [];

  /* chunks: text (goes to reader blocks as prose) and module (custom code) */
  const chunks = [];
  const text = (html) => chunks.push({ kind: 'text', html });
  const mod = (m, name) => { if (m) chunks.push({ kind: 'module', name, html: m.html, height: m.height || 300, letter: m.letter === undefined ? m.html : m.letter, letterHeight: m.letterHeight || m.height || 300, css: m.css || '' }); };

  const header = `<div class="mem-kick">${esc(draft.parts.kicker)} · ${esc(label.toUpperCase())}</div>
<h1>${esc(title)}</h1>
<p class="mem-dek">${esc(draft.dek)}</p>
<div class="mem-by"><span>By <b>${esc(author)}</b></span><span>${esc(publication)}</span><time datetime="${esc(draft.asOfIso)}">${esc(when)}</time><span>${readMin(1400)} min read</span><span class="mem-chip mem-chip-live"><i></i>LIVE DATA</span></div>`;
  chunks.push({ kind: 'module', name: 'board', html: board, height: 170, letter: board.replace(/<div class="mem-sparkcell">[\s\S]*?<\/div>/, ''), letterHeight: 170, css: '' });
  text(`<div class="mem-lede">${lede.map((p) => `<p>${esc(p)}</p>`).join('\n')}</div>`);
  mod(chartMod, 'chart');
  text(`<aside class="mem-take"><h3>KEY TAKEAWAYS</h3><ul>${takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></aside>`);
  text(`<h2>What the data says</h2><ul>${(st.facts || []).map((f) => `<li>${esc(plain(f))}</li>`).join('')}</ul>${c.direction && c.direction.label ? `<p>Backdrop: the market read is <strong>${esc(c.direction.label)}</strong> (bias ${c.direction.bias >= 0 ? '+' : ''}${esc(c.direction.bias)}), ${c.direction.bias >= 20 ? 'a tailwind for the long case' : c.direction.bias <= -20 ? 'a headwind for any long idea' : 'neither help nor hindrance'}.</p>` : ''}`);
  if (meter) mod(meter, 'meters');
  if (intentSec) text(`<h2>${esc(intentSec.title)}</h2>${intentSec.html}`);
  mod(tabs, 'tabs');
  if (dpSec) text(`<h2>${esc(dpSec.title)}</h2>${dpSec.html}`);
  if (shortSec) text(`<h2>${esc(shortSec.title)}</h2>${shortSec.html}<p class="mem-gloss">Daily short volume comes from ${link(src.finraShort, 'FINRA\'s daily short sale volume files')}; the twice-monthly short interest from ${link(src.finraSi, 'FINRA\'s equity short interest data')} and ${link(src.nasdaqSi, 'Nasdaq\'s short interest page')}. ${link(src.shortSales, 'Investor.gov explains short sales')} for anyone new to the mechanics.</p>`);
  if (optSec) text(`<h2>${esc(optSec.title)}</h2>${optSec.html}<p class="mem-gloss">Live option quotes are on ${link(src.cboe, 'Cboe')}; ${link(src.options, 'Investor.gov covers the basics of options')}.</p>`);
  if (erSec) { text(`<h2>${esc(erSec.title)}</h2>${erSec.html}<p class="mem-gloss">Confirm the date on ${link(src.nasdaqEr, 'the Nasdaq earnings calendar')}${src.ir ? ' or ' + link(src.ir, 'the company\'s investor site') : ''}; the filings land on ${link(src.edgar, 'EDGAR')}.</p>`); mod(count, 'countdown'); }
  text(`<h2>Why it matters: the mechanism</h2>${V.mechanism(st, c, seed).map((t) => `<p>${esc(t)}</p>`).join('')}`);
  text(`<h2>The speculation</h2><div class="mem-spec"><span class="mem-label">LABELLED SPECULATION</span><p><em>This is the speculative part, and it is labelled that way on purpose.</em> ${esc(st.controversy)} ${esc(plain(speculationLine(st, c, seed)))}</p><p>${esc(V.humor(st, c, seed))}</p></div>`);
  text(`<p class="mem-pull">${esc(pullQuote(st, c, seed))}</p>`);
  text(`<h2>The bull case and the bear case</h2><p>${esc(pick([`Every piece here argues with itself before it closes. Here is the fight, laid out so you can pick a side with your eyes open.`, `A thesis you cannot argue against is a belief, not a thesis. Both sides, side by side.`], seed))}</p>`);
  mod(vs, 'bullbear');
  text(`<h2>The path to ${esc(px(st.pt))} (${esc(pct(st.ptPct))})</h2><ol class="mem-path"><li><strong>Trigger:</strong> ${esc(st.scenario.trigger)}.</li><li><strong>Confirmation:</strong> ${esc(st.scenario.confirm)}.</li><li><strong>Target:</strong> ${esc(st.scenario.target)}.</li></ol><p>The chart above draws that exact sequence: real candles, then the move the setup needs. Horizon for the idea: ${esc(st.timeframe)}.</p>`);
  mod(track, 'tracker');
  text(`<h2>What kills it</h2><p>${esc(cap(plain(st.scenario.invalidation)))}. If that happens, the story is wrong and the position should not exist anymore. No averaging down, no hoping, no renaming the thesis after the fact.</p>`);
  mod(kill, 'killswitch');
  text(`<h2>What to watch next session</h2><ul>${next.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`);
  if (sentSec) text(`<h2>${esc(sentSec.title)}</h2>${sentSec.html}`);
  if (filSec) text(`<h2>${esc(filSec.title)}</h2>${filSec.html}`);
  if (patSec) text(`<h2>${esc(patSec.title)}</h2>${patSec.html}`);
  const recordText = require('./academy-article-outcomes').recordLine(record);
  text(`<h2>Bottom line</h2><p>${esc(bottomLine(st, c, seed))}</p>${recordText ? `<p class="mem-record"><strong>Desk record.</strong> ${esc(recordText.replace(/^Desk record: /, ''))}</p>` : ''}`);
  mod(pollMod, 'poll');
  text(`<h2>Questions readers ask</h2><div class="mem-faq">${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>`);
  text(`<h2>Keep reading</h2><ul class="mem-sources"><li>${link(src.stocks, S + ' quote, chart and data')} on StockMarketLoop.</li><li>${link(src.author, 'More from this desk')}.</li>${src.discord ? `<li>${link(src.discord, 'The Making Easy Money Discord')}, where the alerts land first.</li>` : ''}</ul>`);
  const glossary = d.intent && d.intent.glossary ? Object.entries(d.intent.glossary).slice(0, 8) : [];
  if (glossary.length) text(`<h2>Glossary</h2><dl class="mem-gloss">${glossary.map(([k, v]) => `<dt>${esc(k.toUpperCase())}</dt><dd>${esc(plain(v))}</dd></dl>`).join('')}`);
  text(`<h2>Sources</h2><ol class="mem-sources">${['edgar', 'finraShort', 'finraSi', 'nasdaqSi', 'cboe', 'ir', 'shortSales', 'options', 'margin'].filter((k) => src[k]).map((k) => `<li>${link(src[k])} <small>(${esc(src[k].who)})</small></li>`).join('')}</ol>`);
  text(`<p class="mem-disclosure">Data as of ${esc(when)} from the ${esc(publication)} Academy data desk: options positioning, FINRA daily short volume, the off-exchange trade record, the smart-money structure map, SEC filings and the ticker's headlines. Levels are rounded, scenarios are illustrations rather than forecasts, and nothing here is a recommendation. This is speculation and education, not financial advice; ${esc(author)} and the ${esc(publication)} publication may hold or trade positions in the names discussed.</p>`);

  const share = modShare(url || siteUrl + '/stocks/' + c.symbol.toLowerCase() + '/', title);
  const bodyInner = header + '\n<div itemprop="articleBody">\n' + chunks.map((ch) => ch.html).join('\n') + '\n</div>\n' + share;
  const bodyHtml = `<article class="mem-article" data-theme="dark" itemscope itemtype="https://schema.org/NewsArticle" lang="en">\n${bodyInner}\n</article>\n<script>${JS}</script>`;
  const textOnly = chunks.filter((ch) => ch.kind === 'text').map((ch) => ch.html).join('\n');
  const wordCount = plain(bodyInner.replace(/<svg[\s\S]*?<\/svg>/g, ' ')).split(/\s+/).filter(Boolean).length;
  const seo = seoFor({ story: st, c, headline: title, tags: draft.tags, publication, posterUrl: imageUrl, asOf });
  const headHtml = headFor({ seo, draft: { ...draft, title, wordCount }, url, siteUrl, authorUrl: authorUrl || siteUrl + '/n/grandmasterobi/', publication, byline: author, c, faq, imageUrl, asOfIso: draft.asOfIso, logoUrl });
  const document = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n${headHtml}\n<style>${CSS}</style></head><body style="margin:0;background:#0b1119">\n${bodyHtml}\n</body></html>`;
  /* Loop Letters blocks: the prose as reader blocks, each module as custom code with the stylesheet */
  const blocks = [];
  for (const ch of chunks) {
    /* the letter variant of each module: the letters sanitizer keeps markup but drops svg, iframe, script, input and details,
       so each module ships a version that needs none of them (a module with nothing safe to show is left out) */
    if (ch.kind === 'module') { if (ch.letter) blocks.push({ id: 'mod-' + ch.name, type: 'custom_code', html: `<div class="mem-article mem-letter" data-theme="dark">${ch.letter}</div>`, css: CSS + (ch.css ? '\n' + ch.css : ''), height: ch.letterHeight }); }
    else blocks.push(...htmlToBlocks(ch.html.replace(/<(aside|div)[^>]*>|<\/(aside|div)>/g, '').replace(/<details><summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g, '<h3>$1</h3>$2').replace(/<dl[^>]*>([\s\S]*?)<\/dl>/g, (m) => m.replace(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g, '<p><strong>$1:</strong> $2</p>')), { tickers: [c.symbol] }));
  }
  const links = [...bodyInner.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')).filter((h) => /^https?:/.test(h));
  return {
    title, dek: draft.dek, slug: engine.slugify(title), tags: draft.tags, tldr: draft.tldr, keyword: seo.keyword, seo, lean: st.lean, pt: st.pt, ptPct: st.ptPct, angle: st.angle,
    bodyHtml, textHtml: textOnly, css: CSS, js: JS, headHtml, document, blocks, wordCount, readMinutes: readMin(wordCount), links: [...new Set(links)],
    modules: chunks.filter((ch) => ch.kind === 'module').map((ch) => ch.name), sections: [...bodyInner.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => plain(m[1]).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')), parts: draft.parts, asOfIso: draft.asOfIso, faq
  };
}

function speculationLine(st, c, seed) {
  const pt = px(st.pt);
  const L = {
    gamma: [`If price gets through the strike where the calls are stacked, the dealers who sold those calls have to buy stock to stay hedged, and they do not get to pick their price. That is the mechanical bid behind a move to ${pt}.`, `The bet is simple: the hedging math forces buying above the wall, and ${pt} is where the math runs out of fuel.`],
    short: [`Shorts who pressed into strength have to buy to leave, and the volume to leave through is not there. ${pt} is where the first wave of covering would carry it.`, `When a crowded short meets a stock that will not go down, the exit is up. ${pt} is the first place the exits open.`],
    earnings: [`The positioning into the print leans ${st.lean}. If the report cooperates, one implied move lands near ${pt}. If it does not, the imbalance on the chart is where it goes to find buyers.`, `The chart did its positioning before the number. ${pt} is one expected move in the direction the tape already chose.`],
    tape: [`Sweeps and blocks are not how retail trades. Someone with size is building, and ${pt} is the nearest pool of resting orders they would run into.`, `The off-exchange share says the real volume is happening where the public cannot see it. ${pt} is the level the visible chart has not priced.`],
    structure: [`A sweep followed by a break is the textbook smart-money sequence: take the stops, then move. ${pt} is the next liquidity the move would reach for.`, `The stops are gone and the structure has turned. ${pt} is where the next set of resting orders sits.`]
  }[st.angle];
  return pick(L, seed + 7);
}
function pullQuote(st, c, seed) {
  const L = {
    gamma: [`Dealers do not have opinions. They have a hedge ratio, and the hedge ratio has a deadline.`, `The call wall is not resistance. It is an invoice.`],
    short: [`A crowded short is not a bearish signal. It is a queue, and the queue only moves one way.`, `Being short a stock that refuses to fall is a position with a clock on it.`],
    earnings: [`Consensus is the number everybody agrees on until the number prints.`, `The estimate is public. The positioning is the edge.`],
    tape: [`The chart is the rumor. The prints are the receipt.`, `Retail reads candles. Size leaves fingerprints.`],
    structure: [`Stops are IOUs with a trigger price, and sometimes the market comes to collect.`, `A sweep is not noise. It is the market taking what it came for.`]
  }[st.angle] || [`The data is real. The outcome is not written.`];
  return pick(L, seed + 11);
}
function bottomLine(st, c, seed) {
  const L = [
    `${'$' + c.symbol} is a ${st.lean} ${engine.ANGLES[st.angle].label.toLowerCase()} candidate with a measurable path to ${px(st.pt)} and a clear line that says the idea is wrong. Treat it as what it is: a setup, not a promise.`,
    `The numbers are real; the outcome is not written. Watch the trigger, respect the invalidation, and let ${px(st.pt)} be the target rather than the plan.`,
    `This is the kind of ${engine.ANGLES[st.angle].label.toLowerCase()} story that reads obvious in hindsight. Right now it is just data pointing at ${px(st.pt)}, and data has been wrong before.`
  ];
  return pick(L, seed + 13);
}

module.exports = { composeArticle, buildDossier, resolveSubject, sourcesFor, faqFor, bullBear, CSS, JS, TOPICS, headFor };
