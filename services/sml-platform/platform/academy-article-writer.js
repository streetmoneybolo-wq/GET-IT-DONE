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

const ANGLE_LABEL = { gamma: 'gamma squeeze', short: 'short squeeze', earnings: 'earnings', tape: 'tape', structure: 'structure' };
const BANNED = /\b(delve|tapestry|landscape|in conclusion|it is important to note|as an ai|game.?changer|unlock|next level|navigate the|in today's|dive into|robust|seamless|leverage(?!d)|synerg)/i;

/* ---------- the fact sheet: everything the writer may say, and every number it may use ---------- */
function factSheet({ story: st, c, dossier = {}, record = null } = {}) {
  const d = dossier || {}, S = '$' + c.symbol, name = c.name && c.name !== c.symbol ? c.name : '';
  const lines = [];
  const add = (k, text) => { if (text) lines.push({ k, text: plain(text) }); };
  add('price', `${S} trades at ${px(c.price)}${num(c.changePct) != null ? `, ${pct(c.changePct)} on the session` : ''}${num(c.relVol) != null ? `, volume ${Number(c.relVol).toFixed(1)}x normal` : ''}.`);
  if (num(c.marketCap) != null) add('cap', `Market cap about $${big(c.marketCap)}.`);
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
function validate(narrative, sheet, { minWords = 550, maxWords = 1300 } = {}) {
  const reasons = [];
  if (!narrative || typeof narrative !== 'object') return { ok: false, reasons: ['not_an_object'] };
  const secs = Array.isArray(narrative.sections) ? narrative.sections : [];
  if (secs.length < 3 || secs.length > 6) reasons.push('sections_' + secs.length);
  const all = [narrative.title, narrative.dek, ...(narrative.lede || []), ...secs.flatMap((s) => [s.heading, ...(s.paragraphs || [])]), narrative.bottom, ...(narrative.bull || []), ...(narrative.bear || []), ...(narrative.kill || [])].filter(Boolean).map(plain).join('\n');
  const words = all.split(/\s+/).filter(Boolean).length;
  if (words < minWords) reasons.push('too_short_' + words); if (words > maxWords) reasons.push('too_long_' + words);
  if (/—|–/.test(all)) reasons.push('dash');
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

/* ---------- the house writer: the same shape, from the same sheet, in the same voice, with seeded variation ---------- */
function housePiece(sheet, seed = 0) {
  const S = sheet.S, who = sheet.name || S, L = Object.fromEntries(sheet.lines.map((l) => [l.k, l.text]));
  const facts = sheet.lines.filter((l) => l.k === 'fact').map((l) => l.text);
  const up = sheet.lean !== 'bearish';
  const pt = px(sheet.pt), stop = sheet.stop != null ? px(sheet.stop) : null;
  const titles = {
    gamma: [`${S}: the call wall is the whole story, and dealers are the ones who have to buy`, `Dealers are short gamma in ${S}. That is the trade, not the chart`, `${S} has an options book problem, and ${pt} is where it shows`],
    short: [`The shorts in ${S} have a problem, and ${pt} is where it shows`, `${S} is a crowded short that refuses to fall. I know how that usually ends`, `Someone is still shorting ${S} into this. The tape says that is a mistake`],
    earnings: [`${S} into earnings: forget the estimate, watch what the tape already did`, `The positioning into ${S} earnings is the story. The number is the sideshow`, `${S} reports soon. Here is what the smart money did before anyone was looking`],
    tape: [`The chart on ${S} looks ordinary. The prints behind it are not`, `Somebody with size is working ${S} where you cannot see it`, `${S}: the tape is telling a story the chart has not caught up to`],
    structure: [`${S} just took the stops. Now it owes a move to ${pt}`, `${S} swept the lows, closed back inside, and that is not noise`, `Stops taken, structure broken: ${S} has a path to ${pt}`]
  }[sheet.angle] || [`${S}: a read from the desk`];
  const title = pick(titles, seed);
  const deks = {
    gamma: [`Hedging flows do not have opinions. On ${who} they have a deadline, and the strike is already known.`, `The people who will move ${S} this week are not traders. They are dealers hedging a book they did not choose.`],
    short: [`A crowded short against a stock that will not go down is a position with a clock on it.`, `Shorts can be right and still get run over. ${who} is where that math gets tested.`],
    earnings: [`Every preview quotes consensus. Almost none shows you where the stops were taken before the print.`, `The report is binary. The positioning going into it is not, and it leans one way.`],
    tape: [`Sweeps and blocks are not how retail trades. Someone wants ${who} in size, and they want it now.`, `Retail reads candles. The prints show who is actually in the stock.`],
    structure: [`A sweep followed by a break is the one sequence I wait weeks for. ${who} just printed it.`, `Price visited the stops, collected them, and left. The question is where it goes with the money.`]
  }[sheet.angle] || [`A read on ${S} from the desk.`];
  const dek = pick(deks, seed + 1);
  /* lede: the hook, the number, the stake */
  const hook = pick({
    gamma: [`I have watched this movie before. A stock drifts up into a strike where the calls are stacked, everyone calls it resistance, and then the dealers who sold those calls start buying because they have to, not because they want to.`, `Here is the thing about ${who} right now: the chart is not the trade. The options book is.`],
    short: [`Somebody is still shorting ${who} into this, and the FINRA tape does not have opinions. It just counts.`, `I do not love crowded shorts as a long thesis. Usually. This one is different because the stock refuses to do the one thing a short needs it to do.`],
    earnings: [`${who} reports soon and I could not care less about the estimate. The estimate is public. What the tape did last week is not.`, `Earnings previews are astrology with ticker symbols. This one at least shows its work, because the positioning left fingerprints.`],
    tape: [`The daily chart on ${who} looks like a Tuesday. The prints underneath it do not.`, `Size leaves fingerprints. Someone has been leaving a lot of them on ${who}.`],
    structure: [`${who} just did the thing I wait weeks for: ran the obvious level, took the stops, closed back inside.`, `Price in ${who} went where the stops were, collected them, and reversed. That is not noise. That is a sweep, and sweeps have a sequel.`]
  }[sheet.angle] || [`A read on ${who}.`], seed + 2);
  const lede = [hook, `${L.price || ''}${L.market ? ' ' + L.market.replace('Market backdrop: ', 'The broader tape reads ') : ''}`.trim(), `My read: ${up ? 'long' : 'short'} bias, ${pt} as the place this runs out of fuel if it works, ${stop ? stop + ' as the line that says I am wrong' : 'and a clear line that says I am wrong'}. ${pick([`Here is why.`, `Let me walk through it.`, `Stay with me, the mechanics matter.`], seed + 3)}`];
  /* section one: what I'm watching, the facts as narrative with the reads folded in */
  const connectors = [`Start with the part the headlines keep missing.`, `The first thing that caught my eye:`, `What matters most here:`, `The number I keep coming back to:`];
  const s1 = [];
  if (facts[0]) s1.push(`${pick(connectors, seed + 4)} ${lower(facts[0])}`);
  if (facts[1]) s1.push(`${pick([`On top of that, `, `Then there is the second piece: `, `Add to it: `], seed + 5)}${lower(facts[1])}`);
  if (facts[2]) s1.push(`${cap(facts[2])}${facts[3] ? ' ' + cap(facts[3]) : ''}`);
  if (L.intent) s1.push(`${pick([`Now the part I actually trade off.`, `The tape read is the part I trust most.`, `Here is what the prints say.`], seed + 6)} ${L.intent.replace('Smart-money read: ', 'The smart-money read calls it ')}`);
  if (L.dark) s1.push(L.dark.replace('Dark pool: ', 'Off exchange, '));
  if (L.gamma && sheet.angle !== 'gamma') s1.push(L.gamma.replace('Options: ', 'On the options side, '));
  if (L.dtc) s1.push(`${pick([`Short side: `, `For the shorts, the fuel is real: `, `The short book: `], seed + 7)}${lower(L.dtc)}`);
  if (L.earnings) s1.push(`${pick([`One wrinkle: `, `And the calendar matters: `, `Do not forget the date: `], seed + 8)}${lower(L.earnings)}`);
  if (L.crowd) s1.push(`${L.crowd.replace('Crowd sentiment: ', 'The crowd reads ')} ${pick([`I use that number at the edges and ignore it in the middle.`, `Sentiment only matters when it is extreme, and this is not extreme.`, `Crowded is a warning, not a signal.`], seed + 9)}`);
  if (L.insiders) s1.push(L.insiders);
  if (L.pattern) s1.push(L.pattern.replace('Chart patterns on the daily: ', 'For the pattern crowd, the daily shows ') + ` ${pick([`Patterns matter because other people trade them, which puts their stops where I can see them.`, `I do not trade patterns, but I like knowing where the pattern traders put their stops.`], seed + 10)}`);
  const s2 = [
    `${pick([`If this works, it goes like this.`, `The path, as I see it.`, `Here is the sequence I need to see.`], seed + 11)} ${cap(sheet.scenario.trigger)}. Then ${lower(sheet.scenario.confirm)}. ${pick([`That gets you to`, `Hold that and the target is`, `From there the move reaches for`], seed + 12)} ${lower(sheet.scenario.target)}.`,
    `${pick([`Horizon: ${sheet.timeframe}. I am not married to the timing.`, `Give it ${sheet.timeframe}. Longer than that and the thesis is stale.`, `Timing is the thing I am least sure about; ${sheet.timeframe} is my window.`], seed + 13)} ${pick([`What I will not do is chase the first green candle. The entry is at the trigger or it is not an entry.`, `The chart module above draws this exact sequence, real candles first, then the move the setup needs.`, `Levels are rounded. The idea is the shape, not the cents.`], seed + 14)}`
  ];
  const counter = pick({
    gamma: [`The honest objection is that open interest shows contracts, not who holds which side, so every gamma map is an inference. Walls get passed without a ripple all the time.`, `Skeptics will say dealer positioning is a story told after the fact. Fair. The data cannot see the hedges themselves, only the strikes.`],
    short: [`The honest objection is that short volume is not a position. A high ratio is routine in liquid names, and sometimes the shorts are simply right.`, `Days to cover is a lagging, twice-a-month number, and borrow cost decides who leaves before price does.`],
    earnings: [`The honest objection: one binary print outweighs any structure. Guidance can gap through every level on this page.`, `Earnings reactions are driven by guidance and tone, and no chart contains either.`],
    tape: [`The honest objection is that prints do not carry intent. Size can be a hedge, a rebalance or a mistake.`, `The tick rule misreads direction often enough to matter. A busy tape can mean a decision or a transition.`],
    structure: [`The honest objection is selection bias: the sweeps that worked get remembered and the ones that failed do not.`, `Any chart can be annotated to tell any story after the fact. The discipline is committing to the level that proves it wrong, in advance.`]
  }[sheet.angle] || [`Every read has limits.`], seed + 15);
  const s3 = [
    `${pick([`Now the part where I argue with myself.`, `Here is what would make me wrong, and I mean it.`, `I do not publish a read without the exit.`], seed + 16)} ${cap(sheet.scenario.invalidation)}. ${pick([`If that prints, the idea is dead and the position should not exist anymore. No averaging down, no hoping, no renaming the thesis.`, `When that happens I am out, and I do not get to explain why the stock is wrong.`, `That is the line. Below it there is no story, only a loss I chose to take early.`], seed + 17)}`,
    `${counter} ${pick([`I hold the read anyway, with the stop, because the asymmetry is on my side.`, `I can live with that, because the invalidation is close and the target is not.`, `That is why the stop sits where it does.`], seed + 18)}`
  ];
  const bottom = pick([
    `${S} is a ${up ? 'long' : 'short'} on a ${sheet.angleLabel} setup with a real path to ${pt} and a clear line that says I am wrong. Treat it as what it is: a setup, not a promise.`,
    `The numbers are real; the outcome is not written. Watch the trigger, respect the line, and let ${pt} be the target rather than the plan.`,
    `This is the kind of ${sheet.angleLabel} story that reads obvious in hindsight. Right now it is data pointing at ${pt}, and data has been wrong before.`
  ], seed + 19);
  const bull = [], bear = [];
  (up ? bull : bear).push(`${cap(sheet.angleLabel)} setup with a path to ${pt}`);
  if (L.intent) (/buyers|accumulation|markup/.test(L.intent) ? bull : /sellers|distribution|markdown/.test(L.intent) ? bear : bear).push(L.intent.split('.')[0].replace('Smart-money read: ', 'Intent read: '));
  if (L.market) (/bullish/i.test(L.market) ? bull : /bearish/i.test(L.market) ? bear : bear).push(L.market.replace('Market backdrop: ', 'Backdrop: ').split('.')[0]);
  if (L.earnings) bear.push('A binary print inside the window');
  if (L.crowd && /crowded/.test(L.crowd)) bear.push('Crowded long: the bar is high');
  (up ? bear : bull).push(pick({ gamma: ['Gamma maps are inferences, not mechanisms', 'Walls get passed without a ripple'], short: ['High short volume is routine in liquid names', 'Borrow cost decides who leaves, not price'], earnings: ['Guidance can gap through every level', 'A binary print outweighs structure'], tape: ['Prints do not carry intent', 'Size can be a hedge or a mistake'], structure: ['Sweeps that failed are not remembered', 'Any chart can be annotated after the fact'] }[sheet.angle] || ['Every read has limits'], seed + 23));
  const kill = [stop ? `A close through ${stop}, whatever the excuse.` : 'The invalidation level breaks, whatever the excuse.', up ? 'Sellers absorb the buying at a key level and price loses it on volume.' : 'Buyers absorb the selling at a key level and price reclaims it on volume.', 'The tape flips: the sweeps and blocks start printing on the other side.', L.earnings ? 'The print gaps the stock through the line.' : 'Two sessions against the read with no new fuel.'];
  return { title, dek, lede: lede.filter(Boolean), sections: [
    { heading: pick([`What I am watching`, `What the tape is telling me`, `The setup, as I read it`], seed + 20), paragraphs: s1 },
    { heading: pick([`Where this goes if it works`, `The path to ${pt}`, `How it plays out`], seed + 21), paragraphs: s2 },
    { heading: pick([`What would make me wrong`, `The exit, before the entry`, `Where I am wrong`], seed + 22), paragraphs: s3 }
  ], bottom, bull: bull.slice(0, 4), bear: bear.slice(0, 4), kill: kill.slice(0, 4), source: 'house' };
}

/* ---------- the model writer ---------- */
const SYSTEM = `You are Vaughn McNair, a trader who writes a markets letter for other traders at Making Easy Money. You write the way you talk: direct, confident, a little dry, honest about doubt. First person. Varied rhythm: short punches after long sentences, a fragment now and then, an aside, a rhetorical question when it earns its place. You have opinions ("I don't trust this", "this reminds me of") and you say what you are watching and why. You tell the story of the setup, not the dataset.
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

function createArticleWriter({ ai = null, fetchImpl = globalThis.fetch, logger = () => {}, now = Date.now, timeoutMs = 75_000, maxTokens = 2600 } = {}) {
  const enabled = !!(ai && ai.apiKey);
  async function callModel(sheet) {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ai.model || 'claude-sonnet-5-5', max_tokens: maxTokens, system: SYSTEM, messages: [{ role: 'user', content: userPrompt(sheet) }] }), signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('anthropic_' + res.status);
    return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }
  /* the model's draft, checked; a failed check gets one retry with the reasons; then the house writer */
  async function write(sheet, { attempts = 2 } = {}) {
    const seed = seedOf(sheet.symbol + sheet.angle + Math.floor(now() / 3_600_000));
    if (!enabled) return { ...housePiece(sheet, seed), checked: { ok: true, reasons: ['ai_off'] } };
    let last = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const text = await callModel(sheet);
        const n = normalize(parseJson(text));
        const v = validate(n, sheet);
        if (v.ok) return { ...n, checked: v };
        last = v; logger('warn', 'article_writer_rejected', { symbol: sheet.symbol, attempt: i + 1, reasons: v.reasons.slice(0, 4) });
      } catch (error) { last = { ok: false, reasons: [String(error && error.message || error)] }; logger('warn', 'article_writer_failed', { symbol: sheet.symbol, attempt: i + 1, error: String(error && error.message || error) }); }
    }
    return { ...housePiece(sheet, seed), checked: { ok: true, reasons: ['house_fallback', ...(last ? last.reasons.slice(0, 3) : [])] } };
  }
  return { enabled, write };
}

module.exports = { factSheet, validate, housePiece, createArticleWriter, parseJson, normalize, SYSTEM, userPrompt, BANNED };
