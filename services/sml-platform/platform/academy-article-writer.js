'use strict';

/* The Article Desk's writer: the prose layer, written the way a trader writes to traders.
 *
 * The desk gathers a lot (the story engine's facts, the smart-money intent, the dark-pool read, the short insight, the
 * dealers' walls, the earnings window, the filings, the crowd). A piece that lists all of it under eighteen headings reads
 * like a report, and a report is the one thing nobody shares. So the numbers are boiled down to a fact sheet, and the
 * sheet is written up as a narrative with a voice: a lede that takes a side, four or five sections at most, every number
 * used once and inside a sentence, opinions and doubt in the first person, no glossary, no FAQ, no stacked disclaimers,
 * no sentence repeated anywhere.
 *
 * Two writers produce that narrative. The model (Claude, when a key is configured) writes from the fact sheet under the
 * house rules and is checked hard: it may not use a number the sheet does not carry, it may not pad, it may not repeat
 * itself, it may not fall into the symmetrical cadence that reads as machine copy. When the model is off, slow or fails
 * the check, the house writer produces the same shape from the same sheet with seeded variation, so no two pieces on the
 * same angle read alike. The composer (academy-article-desk.js) lays either one out with the modules. */

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const px = (v) => (Math.abs(v) >= 1 ? '$' + Number(v).toFixed(2) : '$' + Number(v).toFixed(4));
const pct = (v, d = 1) => (v >= 0 ? '+' : '') + Number(v).toFixed(d) + '%';
const big = (v) => (v == null ? null : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)));
const plain = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
const seedOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const lower = (s) => String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1);

const ANGLE_LABEL = { gamma: 'gamma squeeze', short: 'short squeeze', earnings: 'earnings', tape: 'tape', structure: 'structure', narrative: 'market narrative' };
const BANNED = /\b(delve|tapestry|landscape|in conclusion|it is important to note|as an ai|game.?changer|unlock|next level|navigate the|in today's|dive into|robust|seamless|leverage(?!d)|synerg|it remains to be seen|only time will tell|rapidly evolving|underscores the importance|a testament to|unprecedented|stunning|massive)/i;

/* ---------- the fact sheet: everything the writer may say, and every number it may use ---------- */
function factSheet({ story: st, c, dossier = {}, record = null } = {}) {
  const d = dossier || {}, S = '$' + c.symbol, name = c.name && c.name !== c.symbol ? c.name : '';
  const lines = [];
  const add = (k, text) => { if (text) lines.push({ k, text: plain(text) }); };
  add('price', `${S} trades at ${px(c.price)}${num(c.changePct) != null ? `, ${pct(c.changePct)} on the session` : ''}${num(c.relVol) != null ? `, volume ${Number(c.relVol).toFixed(1)}x normal` : ''}.`);
  if (num(c.marketCap) != null && c.marketCap >= 5e6) add('cap', `Market cap about $${big(c.marketCap)}.`); // a company record under $5M is more often a stale or mis-scaled field than a fact
  for (const f of (st.facts || []).slice(0, 6)) add('fact', f);
  add('scenario', `Scenario target ${px(st.pt)} (${pct(st.ptPct)}) over ${st.timeframe}; the idea is wrong at ${num(st.stop) != null ? px(st.stop) : 'the invalidation level'}.`);
  add('trigger', `Trigger: ${st.scenario.trigger}.`); add('confirm', `Confirmation: ${st.scenario.confirm}.`); add('target', `Target: ${st.scenario.target}.`); add('kill', `Invalidation: ${st.scenario.invalidation}.`);
  if (c.direction && c.direction.label) add('market', `Market backdrop: ${c.direction.label} (bias ${c.direction.bias >= 0 ? '+' : ''}${c.direction.bias}).`);
  const it = d.intent && d.intent.intent;
  if (it && it.phase && it.phase !== 'undecided') { add('intent', `Smart-money read: ${it.phase}${it.side && it.side !== 'neither' ? `, ${it.side} in control` : ''}, strength ${Math.round(num(it.strength, 0))} of 100. ${it.read || ''}`); for (const e of (it.evidence || []).slice(0, 3)) add('intentfact', e && e.text); }
  const lv = d.intent && d.intent.map && d.intent.map.levels ? d.intent.map.levels.slice(0, 4) : [];
  if (lv.length) add('levels', `Liquidity map levels: ${lv.map((l) => px(l.price) + (l.labels && l.labels[0] ? ' (' + plain(l.labels[0]) + ')' : '')).join(', ')}.`);
  const dp = d.darkPool, read = dp && (dp.read || dp.darkRead);
  if (read && read.headline) add('dark', `Dark pool: ${read.headline}. ${read.steps && read.steps[0] ? plain(read.steps[0].text) : ''}`);
  else if (dp && num(dp.offSharePct) != null) add('dark', `Dark pool: ${Math.round(dp.offSharePct)}% of today's volume printed off-exchange against a typical ${Math.round(num(dp.typicalSharePct, 42))}%.`);
  const si = d.shortInsight;
  if (si) {
    const sq = si.model && num(si.model.score) != null ? Math.round(si.model.score) : (si.squeeze && num(si.squeeze.score) != null ? Math.round(si.squeeze.score) : null), pr = si.pressing && num(si.pressing.score) != null ? Math.round(si.pressing.score) : null;
    if (sq != null || pr != null) add('shortscore', `Squeeze risk ${sq != null ? sq + ' of 100' : 'unknown'}; shorts pressing ${pr != null ? pr + ' of 100' : 'unknown'}.`);
    const it2 = si.interest || {};
    if (num(it2.daysToCover) != null) add('dtc', `Days to cover ${Number(it2.daysToCover).toFixed(1)}${num(it2.shortInterest) != null ? `, ${big(num(it2.shortInterest))} shares short` : ''}${num(it2.siChangePct) != null ? `, short interest ${pct(num(it2.siChangePct))} since the last report` : ''}.`);
    if (si.verdict && si.verdict.long && si.verdict.long.call) add('verdictlong', `For a long: ${si.verdict.long.call}.`);
    if (si.verdict && si.verdict.shortSeller && si.verdict.shortSeller.call) add('verdictshort', `For a short seller: ${si.verdict.shortSeller.call}.`);
  }
  const g = c.gamma;
  if (g && g.available) add('gamma', `Options: dealers ${g.regime === 'negative' ? 'short gamma' : 'long gamma'}${g.callWall && num(g.callWall.strike) != null ? `, call wall ${px(g.callWall.strike)}` : ''}${g.putWall && num(g.putWall.strike) != null ? `, put wall ${px(g.putWall.strike)}` : ''}${num(g.flipStrike) != null ? `, gamma flip near ${px(g.flipStrike)}` : ''}${num(g.zeroDteShare) != null && g.zeroDteShare >= 0.2 ? `, ${Math.round(g.zeroDteShare * 100)}% of open options expire today` : ''}${num(g.pressurePct) != null ? `, hedge pressure ${Math.round(g.pressurePct)}% of an average day's volume` : ''}.`);
  const er = c.earnings;
  if (er && num(er.daysAway) != null && er.daysAway >= 0 && er.daysAway <= 45) add('earnings', `Earnings ${er.daysAway === 0 ? 'today' : er.daysAway === 1 ? 'tomorrow' : 'in ' + er.daysAway + ' days'}${er.date ? ' (' + String(er.date).slice(0, 10) + ')' : ''}${num(er.impliedPct) != null ? `; the options market prices a ${Number(er.impliedPct).toFixed(1)}% move` : ''}${num(er.histAvgMovePct) != null ? ` against a ${Number(er.histAvgMovePct).toFixed(1)}% average on past prints` : ''}.`);
  const ei = d.earningsInsight;
  if (ei && Array.isArray(ei.signals)) for (const s of ei.signals.slice(0, 2)) add('earningsfact', s && s.text);
  const se = d.sentiment;
  if (se && se.available !== false && (num(se.scorePct) != null || num(se.score) != null)) add('crowd', `Crowd sentiment: ${se.label || 'mixed'} (${num(se.scorePct, Math.round((num(se.score, 0) + 1) * 50))} of 100)${se.components && se.components.social && se.components.social.crowdedLong ? ', crowded long' : ''}.`);
  const f = d.filings;
  if (f && f.available !== false && f.label) add('insiders', `Insiders: ${f.label}${f.insiders && (num(f.insiders.buys) != null || num(f.insiders.sells) != null) ? ` (${num(f.insiders.buys, 0)} open-market buys, ${num(f.insiders.sells, 0)} sells on Form 4 in ninety days)` : ''}${f.activistRecent ? `, ${f.activistRecent} activist 13D filing${f.activistRecent === 1 ? '' : 's'} in sixty days` : ''}.`);
  const pt = d.patterns;
  if (pt && pt.count) { const names = [...(pt.charts || []), ...(pt.candles || [])].map((x) => x && (x.name || x.type)).filter(Boolean).slice(0, 3); if (names.length) add('pattern', `Chart patterns on the daily: ${names.join(', ')}${pt.trend && pt.trend.dir ? ` in a ${pt.trend.dir} trend` : ''}.`); }
  if (Array.isArray(d.news) && d.news.length) add('news', `Recent headline: ${plain(d.news[0].title || '')}.`);
  if (d.company && d.company.sic_description) add('industry', `Industry: ${plain(d.company.sic_description)}.`);
  const numbers = new Set();
  const harvest = (text) => { for (const m of String(text).matchAll(/\$?\d[\d,]*\.?\d*%?[KMBx]?/g)) { const t = m[0].replace(/[$,%]/g, '').replace(/[KMBx]$/, ''); numbers.add(t); if (t.includes('.')) numbers.add(t.replace(/\.?0+$/, '')); } };
  for (const l of lines) harvest(l.text);
  for (const v of [c.price, st.pt, st.stop, st.ptPct, c.changePct, c.relVol]) if (num(v) != null) { harvest(String(v)); harvest(Number(v).toFixed(2)); harvest(Number(v).toFixed(1)); harvest(Math.round(v)); }
  return { symbol: c.symbol, name, S, price: c.price, pt: st.pt, ptPct: st.ptPct, stop: num(st.stop), lean: st.lean, angle: st.angle, angleLabel: ANGLE_LABEL[st.angle] || st.angle, timeframe: st.timeframe, lines, numbers, record: record && record.showable ? record : null, scenario: st.scenario, path: st.path || [] };
}
const sheetText = (sheet) => sheet.lines.map((l) => `- ${l.text}`).join('\n');

/* ---------- the checks: what the model wrote is accepted only when it keeps the house rules ---------- */
/* sentences, with a line break (a heading, a paragraph end) as a boundary too, so a heading never glues onto the sentence after it */
const sentencesOf = (text) => String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '')).filter((s) => s.split(' ').length >= 6);
function validate(narrative, sheet, { minWords = 450, maxWords = 1300 } = {}) {
  const reasons = [];
  if (!narrative || typeof narrative !== 'object') return { ok: false, reasons: ['not_an_object'] };
  const secs = Array.isArray(narrative.sections) ? narrative.sections : [];
  if (secs.length < 3 || secs.length > 6) reasons.push('sections_' + secs.length);
  const all = [narrative.title, narrative.dek, ...(narrative.lede || []), ...secs.flatMap((s) => [s.heading, ...(s.paragraphs || [])]), narrative.bottom, ...(narrative.bull || []), ...(narrative.bear || []), ...(narrative.kill || [])].filter(Boolean).map(plain).join('\n');
  const words = all.split(/\s+/).filter(Boolean).length;
  if (words < minWords) reasons.push('too_short_' + words); if (words > maxWords) reasons.push('too_long_' + words);
  if (/—|–/.test(all)) reasons.push('dash');
  if (/\b(I|I'm|I've|I'd|I'll|[Mm]e|[Mm]y|[Mm]ine|[Ww]e|[Oo]ur|[Oo]urs|[Yy]ou|[Yy]our|[Yy]ours)\b/.test(all)) reasons.push('first_or_second_person');
  if (BANNED.test(all)) reasons.push('banned_phrase');
  if (/\b(faq|glossary|not financial advice|financial advice|disclaimer|as an ai|language model)\b/i.test(all)) reasons.push('meta_or_disclaimer');
  if (secs.some((s) => /what the data says|key takeaways|questions readers ask|sources|bottom line/i.test(String(s.heading || '')))) reasons.push('template_heading');
  if (!narrative.title || plain(narrative.title).length < 20 || plain(narrative.title).length > 110) reasons.push('title_length');
  if (!narrative.title || !String(narrative.title).includes(sheet.S)) reasons.push('title_symbol');
  const seen = new Set();
  for (const s of sentencesOf(all)) { if (seen.has(s)) { reasons.push('repeated_sentence'); break; } seen.add(s); }
  /* every number must come from the sheet (small counts and the hour of the day aside) */
  for (const m of all.matchAll(/\$?\d[\d,]*\.?\d*%?/g)) {
    const raw = m[0].replace(/[$,%]/g, ''), n = Number(raw);
    if (!Number.isFinite(n)) continue;
    if (Number.isInteger(n) && n >= 0 && n <= 30 && !m[0].startsWith('$')) continue;
    if (/^(19|20)\d\d$/.test(raw)) continue;
    if (sheet.numbers.has(raw) || sheet.numbers.has(raw.replace(/\.?0+$/, '')) || sheet.numbers.has(n.toFixed(2)) || sheet.numbers.has(String(n))) continue;
    reasons.push('new_number_' + m[0]); break;
  }
  return { ok: !reasons.length, reasons };
}

/* ---------- the house writer: a news piece, third person, from the fact sheet, with seeded variation ---------- */
/* News does not have a voice. No first person, no jokes, no asides to the reader: a lead, the verified details, the context, the scenario labelled as
   the desk's speculation, and what would prove it wrong. Every number comes from the sheet. */
function housePiece(sheet, seed = 0) {
  const S = sheet.S, who = sheet.name || S, L = Object.fromEntries(sheet.lines.map((l) => [l.k, l.text]));
  const facts = sheet.lines.filter((l) => l.k === 'fact').map((l) => l.text);
  const up = sheet.lean !== 'bearish';
  const pt = px(sheet.pt), stop = sheet.stop != null ? px(sheet.stop) : null, ptp = pct(sheet.ptPct);
  const titles = {
    gamma: [`${S}: Dealer Hedging May Matter More Than the Chart Near ${pt}`, `Dealers Are Short Gamma in ${S}. What That Means for ${pt}`, `${S} Has an Options Positioning Problem, and ${pt} Is Where It Shows`],
    short: [`Shorts Are Still Pressing ${S}. The Data Says That Is a Risk for Them`, `${S}: A Crowded Short and a Stock That Will Not Fall`, `Who Is Still Shorting ${S}? The FINRA Data and the ${pt} Question`],
    earnings: [`${S} Into Earnings: What the Positioning Shows Before the Report`, `Before ${S} Reports, the Tape Has Already Taken a Side`, `${S} Earnings: The Positioning, the Implied Move and ${pt}`],
    tape: [`Large Orders Are Moving Through ${S}. The Prints Point Toward ${pt}`, `${S}: The Tape Shows Activity the Chart Does Not`, `Who Is Buying ${S}? Sweeps, Blocks and the Path to ${pt}`],
    narrative: [`${S} Is Quiet. Is the Market Deciding Something?`, `Few Are Watching ${S}. The Range Suggests They May Want To`, `${S} Is Leaning on a Level, and ${pt} Is What a Break Would Imply`],
    structure: [`${S} Swept the Stops and Reversed. What Comes Next Points to ${pt}`, `${S}: A Liquidity Sweep, a Structure Break and ${pt} in View`, `Stops Taken in ${S}: Why the Next Leg May Target ${pt}`]
  }[sheet.angle] || [`${S}: What the Data Shows and What It Implies`];
  const title = pick(titles, seed);
  const deks = {
    gamma: [`Dealers who sold calls must hedge as price moves, and ${who} is where that mechanism is most visible this week.`, `Hedging flows follow a schedule set by the options book. For ${who}, the schedule points toward a level the chart alone does not show.`],
    short: [`A heavy short position against a stock that is not falling is a position with a deadline. Here is what the data on ${who} shows.`, `Short volume is a clue, not a confession. What the FINRA data does and does not say about ${who}.`],
    earnings: [`Consensus estimates are public. Positioning is less visible, and it leans one way going into the ${who} report.`, `The report is a binary event. The positioning ahead of it is measurable.`],
    tape: [`Sweeps and block trades are not typical retail activity. The prints in ${who} show who is trading and how large they are.`, `The chart shows price. The tape shows size. A look at what the prints in ${who} suggest.`],
    narrative: [`With no single catalyst on the page, the price, range and volume of ${who} are the evidence. What they suggest, and what would disprove it.`, `Quiet trading is not the absence of a story. A measured look at what ${who} is doing and what would change the picture.`],
    structure: [`A sweep of the lows followed by a break of structure is a recognized sequence. ${who} has just completed it.`, `Price visited the stops, collected them and reversed. What that sequence implies for ${who}, and what would undo it.`]
  }[sheet.angle] || [`A data-driven look at ${S}.`];
  const dek = pick(deks, seed + 1);
  const leadFact = facts[0] ? facts[0].replace(/\.$/, '') : (L.price || '').replace(/\.$/, '');
  const lede = [
    `${leadFact}${leadFact ? '.' : ''}`.trim(),
    `${/trades at/.test(leadFact) ? '' : (L.price || '')}${L.market ? ' ' + L.market.replace('Market backdrop: ', 'The broader market reads ') : ''}`.trim(),
    `The Academy data desk's scenario, which is speculative rather than predictive, has ${S} moving ${up ? 'higher' : 'lower'} toward ${pt} (${ptp}) over ${sheet.timeframe}${stop ? `, with ${stop} as the level that would invalidate it` : ''}.`
  ].filter(Boolean);
  const s1 = [];
  for (const f of facts.slice(1, 4)) s1.push(f);
  if (L.intent) s1.push(L.intent.replace('Smart-money read: ', 'Order-flow analysis classifies the activity as '));
  if (L.dark) s1.push(L.dark.replace('Dark pool: ', 'Off-exchange trading: '));
  if (L.gamma && sheet.angle !== 'gamma') s1.push(L.gamma.replace('Options: ', 'In options, '));
  if (L.dtc) s1.push(L.dtc);
  if (L.shortscore) s1.push(L.shortscore);
  if (L.earnings) s1.push(L.earnings);
  if (L.crowd) s1.push(L.crowd.replace('Crowd sentiment: ', 'Sentiment readings show ') + ' Sentiment tends to matter most at extremes.');
  if (L.insiders) s1.push(L.insiders);
  if (L.pattern) s1.push(L.pattern.replace('Chart patterns on the daily: ', 'On the daily chart, technical patterns include '));
  if (L.news) s1.push(L.news.replace('Recent headline: ', 'A recent headline reads: ').replace(/\.$/, '') + '. The headline is reported here as context; this analysis does not establish that it moved the stock.');
  const s2 = [
    `The scenario depends on a sequence. First, ${lower(sheet.scenario.trigger)}. Confirmation would be ${lower(sheet.scenario.confirm)}. If both occur, the scenario target is ${lower(sheet.scenario.target)}.`,
    `${pick([`The time horizon is ${sheet.timeframe}.`, `The scenario is framed over ${sheet.timeframe}.`, `The window for the scenario is ${sheet.timeframe}.`], seed + 13)} Entries are defined by the trigger rather than by the current price, and the scenario treats a move without volume as unconfirmed.`
  ];
  const counter = pick({
    gamma: [`Open interest shows contracts, not who holds which side, so any dealer positioning map is an inference. Strikes with heavy open interest are also passed without incident often enough that a call wall is a probability, not a barrier.`, `Dealer hedging is estimated, not observed. Flows can be absorbed by ordinary liquidity, and the strongest-looking wall can be crossed without a visible reaction.`],
    short: [`Short volume is not a short position. A high ratio is routine for liquid names, and short sellers are sometimes simply right. Days to cover is a lagging, twice-monthly figure, and borrow costs affect who leaves first.`, `Heavy short interest does not guarantee a squeeze. A stock that fails at resistance on the same volume can fall further, and the shorts can be correct.`],
    earnings: [`A single binary event can outweigh any structure. Guidance can move a stock through every level discussed here, and positioning inferred from price is circumstantial.`, `Earnings reactions are driven by guidance and tone, which no chart contains. Implied moves are estimates and often differ from realized ones.`],
    tape: [`Prints do not carry intent. Large trades can be hedges, rebalances or errors, and the tick rule misclassifies direction often enough to matter. A busy tape can mean a decision or a transition.`, `Off-exchange volume includes ordinary retail flow and market-maker hedging, so a high share is suggestive rather than conclusive.`],
    narrative: [`A build-up is easier to identify in hindsight than in real time. Many quiet ranges stay quiet, and a stock can lean on a level for weeks without breaking it. No catalyst is identified in this analysis.`, `The read depends on price and volume behavior alone. Without an event that forces the move, the scenario is a hypothesis with a defined exit rather than a conclusion.`],
    structure: [`Structure-based readings suffer from selection bias: sweeps that worked are remembered, and those that failed are not. Any chart can be annotated to support a story after the fact.`, `A liquidity sweep is a pattern, not a guarantee. The sequence has failed often enough that the invalidation level matters more than the narrative.`]
  }[sheet.angle] || [`Every read has limits, and this one rests on the data available at the time of writing.`], seed + 15);
  const s3 = [`${cap(sheet.scenario.invalidation)}. If that occurs, the scenario is no longer supported by the data.`, counter];
  const bottom = pick([
    `What to watch next: ${lower(sheet.scenario.trigger)}, followed by ${lower(sheet.scenario.confirm)}. A move through ${stop || 'the invalidation level'} would weaken the scenario. This is an educational analysis, not a prediction.`,
    `The data points toward ${pt} under the conditions described, and away from it if ${stop ? stop : 'the invalidation level'} breaks. The outcome is not determined by any of the readings above.`,
    `Investors watching ${S} will want to see the trigger, the confirmation and the volume behind both. The scenario target is ${pt}; the exit is ${stop || 'the invalidation level'}.`
  ], seed + 19);
  const bull = [], bear = [];
  (up ? bull : bear).push(`${cap(sheet.angleLabel)} setup with a measured path to ${pt}`);
  if (L.intent) (/buyers|accumulation|markup/.test(L.intent) ? bull : /sellers|distribution|markdown/.test(L.intent) ? bear : bear).push(L.intent.split('.')[0].replace('Smart-money read: ', 'Order-flow read: '));
  if (L.market) (/bullish/i.test(L.market) ? bull : /bearish/i.test(L.market) ? bear : bear).push(L.market.replace('Market backdrop: ', 'Backdrop: ').split('.')[0]);
  if (L.earnings) bear.push('A binary earnings event inside the window');
  if (L.crowd && /crowded/.test(L.crowd)) bear.push('Crowded positioning raises the bar');
  (up ? bear : bull).push(pick({ gamma: ['Dealer positioning is inferred, not observed', 'Strikes are often crossed without a reaction'], short: ['High short volume is routine in liquid names', 'Borrow cost decides who exits first'], earnings: ['Guidance can override structure', 'Implied moves differ from realized ones'], tape: ['Prints do not carry intent', 'Large trades can be hedges'], narrative: ['No catalyst identified', 'Quiet ranges often stay quiet'], structure: ['Failed sweeps are not remembered', 'Charts can be annotated after the fact'] }[sheet.angle] || ['Every read has limits'], seed + 23));
  const kill = [stop ? `A close through ${stop}.` : 'A break of the invalidation level.', up ? 'Selling absorbs the buying at a key level and price loses it on volume.' : 'Buying absorbs the selling at a key level and price reclaims it on volume.', 'Order flow reverses: the sweeps and blocks turn to the other side.', 'A scheduled event changes the picture before the trigger is reached.'];
  return { title, dek, lede: lede.filter(Boolean), sections: [
    { heading: pick([`What the data shows`, `The key details`, `Reading the data`], seed + 20), paragraphs: s1.length ? s1 : [L.price || ''] },
    { heading: pick([`The scenario`, `What would have to happen`, `The path to ${pt}`], seed + 21), paragraphs: s2 },
    { heading: pick([`What would change the picture`, `Risks and limits`, `Where the scenario fails`], seed + 22), paragraphs: s3 }
  ], bottom, bull: bull.slice(0, 4), bear: bear.slice(0, 4), kill: kill.slice(0, 4), source: 'house' };
}

/* ---------- the fast path (on demand): the house writer is the body, the model only writes the front ---------- */
/* A whole piece from the model is 2,500 tokens and a minute. The house writer composes the same shape in milliseconds from the same
 * fact sheet; the model is asked only for the part a reader meets first (headline, standfirst, lede: about 300 tokens, two or three
 * seconds), under the same checks, and loses the race to a clock. Whatever the model does or does not return, the piece is whole. */
const LEDE_SYSTEM = `You are a senior financial journalist on the Making Easy Money markets desk (byline: Vaughn McNair). You rewrite only the front of a piece: the headline, the one-sentence standfirst and the two or three paragraph lede. News has no voice: third person only, never I, me, my, we, our or you, no jokes or asides. Lead with the most newsworthy development. Vary sentence length, keep paragraphs short, prefer concrete language, and keep verified facts, interpretation and uncertainty apart. Never claim a cause for a price move the sheet does not establish. Never invent quotes, sources or details. Avoid canned phrases and exaggeration (it remains to be seen, only time will tell, landscape, testament, massive, stunning, unprecedented). The headline is specific, curious and a little contrarian (a question, a tension or a stake) but states nothing the sheet does not support.
HARD RULES. Use only numbers that appear in the FACT SHEET, exactly as written; never add a number, level, date or statistic. No dashes of any kind (use commas or full stops). No filler words (delve, landscape, leverage, unlock, robust, seamless). No disclaimers, no definitions of basics. Never repeat a sentence. The headline is 40 to 100 characters, contains the ticker with its dollar sign and one number from the sheet. The lede takes a side in its first sentence, states the target and the line that says you are wrong, and reads like a person talking.
OUTPUT exactly one JSON object: {"title": string, "dek": string, "lede": [string, string, optional string]}. Nothing before or after it.`;

async function polishFront({ ai, fetchImpl, sheet, piece, deadlineMs }) {
  const body = {
    model: ai.fastModel || 'claude-haiku-5-5', max_tokens: 700, system: LEDE_SYSTEM,
    messages: [{ role: 'user', content: `TICKER: ${sheet.S}\nANGLE: ${sheet.angleLabel}\nLEAN: ${sheet.lean}\nTARGET: ${px(sheet.pt)} (${pct(sheet.ptPct)}) over ${sheet.timeframe}${sheet.stop != null ? `\nINVALIDATION: ${px(sheet.stop)}` : ''}\n\nFACT SHEET:\n${sheetText(sheet)}\n\nCURRENT FRONT (rewrite it in your voice, keep every fact):\nTITLE: ${piece.title}\nDEK: ${piece.dek}\nLEDE:\n${piece.lede.join('\n')}` }]
  };
  /* the clock is enforced twice: the request is aborted at the deadline, and the wait itself is raced so a stalled connection cannot hold the piece */
  let timer = null;
  const clock = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('front_deadline')), deadlineMs + 250); });
  let res, data;
  try {
    res = await Promise.race([fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(deadlineMs) }), clock]);
    data = await Promise.race([res.json().catch(() => ({})), clock]);
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error('anthropic_' + res.status);
  const n = parseJson((data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''));
  if (!n || typeof n !== 'object') throw new Error('front_not_an_object');
  const front = { title: plain(n.title), dek: plain(n.dek), lede: (Array.isArray(n.lede) ? n.lede : []).map(plain).filter(Boolean) };
  if (!front.title || !front.dek || front.lede.length < 2 || front.lede.length > 3) throw new Error('front_shape');
  return front;
}

/* ---------- the model writer ---------- */
const SYSTEM = `You are a senior financial journalist writing for the Making Easy Money markets desk (byline: Vaughn McNair). Write like an experienced reporter explaining a development to an intelligent general reader, not like software producing a market summary. News has no voice. Write in the third person only: never use I, me, my, we, our or you; no jokes, asides, rhetorical questions or opinions presented as the writer's own. The desk may offer a labelled scenario (a build-up, a move nobody agrees on, a rumor already in the tape); attribute it to the Academy data desk's analysis or scenario and say plainly that it is speculation.
JOURNALISM RULES. Lead with the most newsworthy development, not a generic introduction. Vary sentence length: concise sentences beside moderately longer explanatory ones; short paragraphs of uneven length. Prefer specific, concrete language. Explain why a move or development matters instead of listing numbers. Keep three things apart and label them in the prose: verified facts (the fact sheet), interpretation (what traders or the data are read to suggest), and uncertainty (what is not known). Never claim an event caused a price move unless the sheet establishes causation; use cautious attribution ("coincided with", "traders may be reading it as", "the data is consistent with"). Never invent quotes, analysts, sources, motives, statistics or colorful details. Keep numbers, dates and names exactly as given. Avoid canned phrases (it remains to be seen, only time will tell, rapidly evolving landscape, underscores the importance, a testament to) and exaggeration (massive, stunning, game-changing, unprecedented). Do not summarize a point twice. If two paragraphs in a row are built the same way, rewrite one. Edit your draft once before answering: cut filler, awkward transitions, restating sentences and any unnecessary conclusion.
HEADLINE. Specific, curious and a little contrarian: a question, a tension or a stake the reader wants resolved. It may be provocative; it may not state anything the fact sheet does not support. It names the ticker with its dollar sign and one number from the sheet.
STRUCTURE. A strong news lead; the key market and company details; the context investors are reacting to; background or comparison only if the sheet supports it; what investors may watch next, ending on the line that would prove the speculation wrong. Accuracy outranks style: do not add a fact because it would make the story better.
HARD RULES. Use only numbers that appear in the FACT SHEET, written exactly as given; never add a number, a level, a date or a statistic that is not there. Never repeat a sentence or a phrase. No glossary, no definitions of basics (your readers know what gamma, short interest and dark pools are). No FAQ. No disclaimers of any kind (the publisher adds one). No em dashes. No bullet lists inside paragraphs. No headings like "What the data says", "Key takeaways", "Bottom line" or "Sources". Do not write "X happens, which means Y, and that is what causes Z" cadence; break symmetry. Do not describe yourself or the piece ("this piece argues with itself"). Between 650 and 1000 words in total. Three to five sections, each with a short human heading. Write plain text, no markdown.
OUTPUT exactly one JSON object with these keys: "title" (string, 40 to 100 characters, must contain the ticker with its dollar sign, must contain one number from the sheet), "dek" (one sentence), "lede" (array of 2 or 3 paragraphs), "sections" (array of 3 to 5 objects with "heading" and "paragraphs", an array of 1 to 4 paragraphs), "bottom" (one closing paragraph of 2 or 3 sentences), "bull" (array of 2 to 4 short phrases for the bull case), "bear" (array of 2 to 4 short phrases for the bear case), "kill" (array of 3 or 4 short lines, each one thing that would end the thesis). No text outside the JSON.`;

function userPrompt(sheet) {
  return `TICKER: ${sheet.S}${sheet.name ? ' (' + sheet.name + ')' : ''}\nANGLE: ${sheet.angleLabel}\nLEAN: ${sheet.lean}\nTARGET: ${px(sheet.pt)} (${pct(sheet.ptPct)}) over ${sheet.timeframe}${sheet.stop != null ? `\nINVALIDATION: ${px(sheet.stop)}` : ''}\n\nFACT SHEET (the only facts and the only numbers you may use):\n${sheetText(sheet)}\n\nWrite the piece now.`;
}
function parseJson(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*|```\s*$/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { return null; }
}
function normalize(n) {
  if (!n || typeof n !== 'object') return null;
  const arr = (v) => (Array.isArray(v) ? v.map(plain).filter(Boolean) : typeof v === 'string' && v.trim() ? [plain(v)] : []);
  return { title: plain(n.title), dek: plain(n.dek), lede: arr(n.lede), sections: (Array.isArray(n.sections) ? n.sections : []).map((s) => ({ heading: plain(s && s.heading), paragraphs: arr(s && s.paragraphs) })).filter((s) => s.heading && s.paragraphs.length), bottom: plain(n.bottom), bull: arr(n.bull).slice(0, 4), bear: arr(n.bear).slice(0, 4), kill: arr(n.kill).slice(0, 4), source: 'ai' };
}

function createArticleWriter({ ai = null, fetchImpl = globalThis.fetch, logger = () => {}, now = Date.now, timeoutMs = 120_000, maxTokens = 6000 } = {}) {
  const enabled = !!(ai && ai.apiKey);
  /* a full piece plus its JSON frame runs near 2,500 tokens, so the budget leaves wide room: a reply cut off at the limit has no
     closing brace and reads as "not_an_object". A rejected first draft is sent back with the reasons so the retry fixes them. */
  async function callModel(sheet, fix = '') {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ai.model || 'claude-sonnet-5-5', max_tokens: maxTokens, system: SYSTEM, messages: [{ role: 'user', content: userPrompt(sheet) + (fix ? `\n\nYour last draft was rejected for: ${fix}. Fix exactly that and return the complete JSON object only, nothing before or after it.` : '') }] }), signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('anthropic_' + res.status);
    return { text: (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''), stop: data.stop_reason || '' };
  }
  /* the model's draft, checked; a failed check gets one retry with the reasons; then the house writer */
  async function write(sheet, { attempts = 2, fast = false, deadlineMs = 5_000 } = {}) {
    const seed = seedOf(sheet.symbol + sheet.angle + Math.floor(now() / 3_600_000));
    if (!enabled) return { ...housePiece(sheet, seed), checked: { ok: true, reasons: ['ai_off'] } };
    if (fast) {
      /* on demand: the house piece is ready at once; the model's front replaces the house front only when it arrives in time and passes the same checks */
      const house = housePiece(sheet, seed);
      try {
        const front = await polishFront({ ai, fetchImpl, sheet, piece: house, deadlineMs });
        const merged = { ...house, ...front, source: 'house+model' };
        const base = new Set(validate(house, sheet, { minWords: 0, maxWords: 5000 }).reasons);
        const bad = validate(merged, sheet, { minWords: 0, maxWords: 5000 }).reasons.filter((r) => !base.has(r));
        if (!bad.length) return { ...merged, checked: { ok: true, reasons: ['fast_front'] } };
        logger('warn', 'article_front_rejected', { symbol: sheet.symbol, reasons: bad.slice(0, 4) });
        return { ...house, checked: { ok: true, reasons: ['house_front', ...bad.slice(0, 3)] } };
      } catch (error) {
        logger('warn', 'article_front_failed', { symbol: sheet.symbol, error: String(error && error.message || error) });
        return { ...house, checked: { ok: true, reasons: ['house_front', String(error && error.message || error).slice(0, 60)] } };
      }
    }
    let last = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const { text, stop } = await callModel(sheet, last ? last.reasons.slice(0, 4).join(', ') : '');
        const n = normalize(parseJson(text));
        const v = validate(n, sheet);
        if (v.ok) return { ...n, checked: v };
        last = v; logger('warn', 'article_writer_rejected', { symbol: sheet.symbol, attempt: i + 1, reasons: v.reasons.slice(0, 4), stop, chars: String(text || '').length });
      } catch (error) { last = { ok: false, reasons: [String(error && error.message || error)] }; logger('warn', 'article_writer_failed', { symbol: sheet.symbol, attempt: i + 1, error: String(error && error.message || error) }); }
    }
    return { ...housePiece(sheet, seed), checked: { ok: true, reasons: ['house_fallback', ...(last ? last.reasons.slice(0, 3) : [])] } };
  }
  return { enabled, write };
}

module.exports = { factSheet, validate, housePiece, createArticleWriter, parseJson, normalize, SYSTEM, userPrompt, BANNED };
