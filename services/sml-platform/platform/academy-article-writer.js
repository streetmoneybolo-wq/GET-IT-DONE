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
/* the piece is Vaughn McNair's own letter: nothing in it names the Academy or its tools. Anything that slips through from a data line or a model draft is turned into plain wording. */
const noBrand = (s) => { const put = (word, whole) => (m, ...r) => { const off = r[r.length - 2], str = r[r.length - 1]; const start = off === 0 || /[.!?]\s+$/.test(str.slice(0, off)); return start ? word.charAt(0).toUpperCase() + word.slice(1) : word; }; return String(s).replace(/\b(?:the\s+)?(?:Making Easy Money\s+)?Academy(?:'s|\u2019s)?\s+(?:data\s+)?desk(?:'s)?/gi, put('the desk')).replace(/\b(?:the\s+)?(?:Making Easy Money\s+)?Academy(?:'s|\u2019s)?\s+(?:data|tools?|scanner|engine|lab)\b/gi, put('the data')).replace(/\b(?:the\s+)?(?:Making Easy Money\s+)?Academy\b/gi, put('the desk')); };
const plain = (s) => noBrand(String(s == null ? '' : s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
const seedOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const lower = (s) => String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1);

const ANGLE_LABEL = { gamma: 'gamma squeeze', short: 'short squeeze', earnings: 'earnings', tape: 'tape', structure: 'structure', narrative: 'market narrative' };
const BANNED = /\b(delve|tapestry|landscape|in conclusion|it is important to note|as an ai|game.?changer|unlock|next level|navigate the|in today's|dive into|robust|seamless|leverage(?!d)|synerg|it remains to be seen|only time will tell|rapidly evolving|underscores the importance|a testament to|unprecedented|stunning|massive)/i;


/* ---------- context from the price history itself: where the stock sits against its own recent past, nothing from outside the data ---------- */
const etDay = (t) => new Date(Number(t)).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
function barContext(c, angle = '') {
  const d = Array.isArray(c && c.daily) ? c.daily.filter((b) => b && num(b.c) != null) : [];
  if (d.length < 25) return [];
  const n = d.length, S = '$' + c.symbol, p = num(c.price) || num(d[n - 1].c), out = [];
  const win = Math.min(60, n), seg = d.slice(n - win);
  const hiBar = seg.reduce((m, b, i) => (num(b.h, b.c) >= num(seg[m].h, seg[m].c) ? i : m), 0), loBar = seg.reduce((m, b, i) => (num(b.l, b.c) <= num(seg[m].l, seg[m].c) ? i : m), 0);
  const hi = num(seg[hiBar].h, seg[hiBar].c), lo = num(seg[loBar].l, seg[loBar].c);
  if (hi > 0 && lo > 0) out.push(['ctxrange', `Against its own ${win}-session range, ${S} is ${Math.abs((p / hi - 1) * 100).toFixed(1)}% ${p <= hi ? 'below' : 'above'} the high of ${px(hi)} (${etDay(seg[hiBar].t)}) and ${Math.abs((p / lo - 1) * 100).toFixed(1)}% above the low of ${px(lo)} (${etDay(seg[loBar].t)}).`]);
  /* the quotable line and the numbers the narrative is built from: the close against the 20-day high and low */
  const w20 = d.slice(n - 20), hi20 = Math.max(...w20.map((b) => num(b.h, b.c))), lo20 = Math.min(...w20.map((b) => num(b.l, b.c)));
  const atrOf = (from, to) => { let t = 0, k = 0; for (let i = Math.max(1, from); i < to; i++) { t += Math.max(num(d[i].h, d[i].c) - num(d[i].l, d[i].c), Math.abs(num(d[i].h, d[i].c) - num(d[i - 1].c)), Math.abs(num(d[i].l, d[i].c) - num(d[i - 1].c))); k += 1; } return k ? t / k : 0; };
  const atrNow = atrOf(n - 14, n), atrPrev = n >= 45 ? atrOf(n - 44, n - 30) : 0;
  let upRun = 0; for (let i = n - 1; i > 0 && num(d[i].c) > num(d[i - 1].c); i--) upRun += 1;
  const gap = (v) => (v >= 1 || p < 1 ? px(v) : '$' + v.toFixed(2));
  out.push(['ctxquote', `${S} sits at ${px(p)}, ${gap(Math.abs(hi20 - p))} ${p <= hi20 ? 'below' : 'above'} its 20-day high of ${px(hi20)} and ${gap(Math.abs(p - lo20))} above its 20-day low of ${px(lo20)}.`]);
  const last10 = d.slice(n - 10); let up = 0; for (let i = 1; i < last10.length; i++) if (num(last10[i].c) > num(last10[i - 1].c)) up += 1;
  out.push(['ctxstreak', up === last10.length - 1 ? `${S} has closed higher in each of its last ${up} sessions.` : up === 0 ? `${S} has closed lower in each of its last ${last10.length - 1} sessions.` : `${S} closed higher in ${up} of its last ${last10.length - 1} sessions.`]);
  const v5 = d.slice(n - 5).map((b) => num(b.v, 0)), v20 = d.slice(n - 25, n - 5).map((b) => num(b.v, 0)), a5 = v5.reduce((x, y) => x + y, 0) / 5, a20 = v20.reduce((x, y) => x + y, 0) / Math.max(1, v20.length);
  if (a20 > 0 && a5 > 0) { const r = a5 / a20; out.push(['ctxvol', r >= 0.95 && r <= 1.05 ? `Volume over the last five sessions was in line with the twenty sessions before them (${r.toFixed(1)}x).` : `Volume over the last five sessions averaged ${r.toFixed(1)}x the twenty sessions before them.`]); }
  /* the average and the recent change are already facts of the narrative angle; the other angles get them here */
  if (angle !== 'narrative') {
    const avg20 = d.slice(n - 20).reduce((x, b) => x + num(b.c, 0), 0) / 20;
    if (avg20 > 0) out.push(['ctxtrend', `Price is ${p >= avg20 ? 'above' : 'below'} its 20-day average of ${px(avg20)} by ${Math.abs((p / avg20 - 1) * 100).toFixed(1)}%.`]);
    if (n > 21 && num(d[n - 21].c) > 0) out.push(['ctxchg', `Over the last twenty sessions the stock has moved ${pct((p / num(d[n - 21].c) - 1) * 100)}.`]);
  }
  let big = null; for (let i = Math.max(1, n - 20); i < n; i++) { const m = (num(d[i].c) / num(d[i - 1].c) - 1) * 100; if (!big || Math.abs(m) > Math.abs(big.m)) big = { m, t: d[i].t }; }
  if (big && Number.isFinite(big.m)) out.push(['ctxmove', `The largest one-day move in the past twenty sessions was ${pct(big.m)} on ${etDay(big.t)}.`]);
  const v5b = d.slice(n - 5).map((b) => num(b.v, 0)), v20b = d.slice(n - 25, n - 5).map((b) => num(b.v, 0));
  out.metrics = { hi20, lo20, gapHi: p <= hi20 ? hi20 - p : 0, distHighPct: hi20 > 0 && p <= hi20 ? (hi20 - p) / hi20 * 100 : 0, distLowPct: lo20 > 0 ? (p - lo20) / lo20 * 100 : null, upRun, volRatio: v20b.length && v20b.reduce((x, y) => x + y, 0) > 0 ? (v5b.reduce((x, y) => x + y, 0) / 5) / (v20b.reduce((x, y) => x + y, 0) / v20b.length) : null, squeeze: atrPrev > 0 ? atrNow / atrPrev : null, relVol: num(c.relVol), changePct: num(c.changePct) };
  return out;
}

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
  const bc = barContext(c, st.angle); for (const [k, text] of bc) add(k, text);
  const metrics = bc.metrics || null;
  const numbers = new Set();
  const harvest = (text) => { for (const m of String(text).matchAll(/\$?\d[\d,]*\.?\d*%?[KMBx]?/g)) { const t = m[0].replace(/[$,%]/g, '').replace(/[KMBx]$/, ''); numbers.add(t); if (t.includes('.')) numbers.add(t.replace(/\.?0+$/, '')); } };
  for (const l of lines) harvest(l.text);
  for (const v of [c.price, st.pt, st.stop, st.ptPct, c.changePct, c.relVol]) if (num(v) != null) { harvest(String(v)); harvest(Number(v).toFixed(2)); harvest(Number(v).toFixed(1)); harvest(Math.round(v)); }
  return { metrics, earningsDays: er && num(er.daysAway) != null ? Number(er.daysAway) : null, symbol: c.symbol, name, S, price: c.price, pt: st.pt, ptPct: st.ptPct, stop: num(st.stop), lean: st.lean, angle: st.angle, angleLabel: ANGLE_LABEL[st.angle] || st.angle, timeframe: st.timeframe, lines, numbers, record: record && record.showable ? record : null, scenario: st.scenario, path: st.path || [] };
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
  if (/\bAcademy\b/i.test(all)) reasons.push('brand_mention');
  /* Grandmaster-Obi writes with an opinion: a stance, a question, a conditional call and the line that proves him wrong; he does not invent a past, a feeling or an anecdote */
  if (/\b(?:you won'?t believe|shocking|insane|crazy|explod\w*|to the moon|guaranteed|can'?t lose|secret|one weird)\b/i.test(String(narrative.title || ''))) reasons.push('clickbait_title');
  if (!STANCES.includes(narrative.stance)) reasons.push('no_stance');
  if (!/\?\s*$/.test(String(narrative.question || ''))) reasons.push('no_question');
  if (!/\bif\b/i.test(String(narrative.ifRight || ''))) reasons.push('no_conditional_call');
  if (!/\b(wrong|invalid|thesis (?:is )?(?:dead|over))/i.test(String(narrative.wrongIf || ''))) reasons.push('no_invalidation');
  if (!/\b(I|I'm|I'd|I'll|my)\b/.test(all)) reasons.push('no_opinion');
  if (/\b(last (?:week|month|year) I|years? ago|in my experience|I remember|I've (?:seen|traded|watched) (?:this|it) before|reminds me of|my (?:last|first) trade|when I was|I feel|I'm (?:excited|nervous|scared|thrilled)|I love|I hate)\b/i.test(all)) reasons.push('invented_experience');
  /* the machine cadence ("X happens, which means Y, and that causes Z") and the textbook aside (the reader knows the basics) */
  if (/,\s+which (?:means|implies|suggests)[^.]{3,140},\s+and (?:that|this|it) (?:causes|leads|creates|results|drives)/i.test(all)) reasons.push('ai_cadence');
  if (/\b(?:is a term for|is defined as|refers to|simply put|in other words|put simply|to put it simply)\b/i.test(all)) reasons.push('glossary_aside');
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

/* ---------- the house writer: the Grandmaster-Obi narrative, from the fact sheet, with seeded variation ---------- */
/* Data -> anomaly -> question -> thesis -> evidence -> counterargument -> conditional prediction -> invalidation -> a closing line.
   First person where it is an opinion ("my read", "I think", "I'm wrong"), plain statements where it is a fact; nothing is invented: every number comes from
   the sheet, no anecdote, no feeling the data does not carry. */
const STANCES = ['Bullish', 'Lean bullish', 'Neutral, waiting on confirmation', 'Lean bearish', 'Bearish', 'Binary, event-driven'];
function stanceFor(sheet) {
  const m = sheet.metrics || {}, up = sheet.lean !== 'bearish';
  if (sheet.earningsDays != null && sheet.earningsDays >= 0 && sheet.earningsDays <= 7) return 'Binary, event-driven';
  const confirmed = (m.volRatio != null && m.volRatio >= 1.1) || (num(m.relVol) != null && m.relVol >= 1.3);
  const near = up ? (m.distHighPct != null && m.distHighPct <= 3) : (m.distLowPct != null && m.distLowPct <= 3);
  if (up) return confirmed && near ? 'Bullish' : near ? 'Lean bullish' : confirmed ? 'Lean bullish' : 'Neutral, waiting on confirmation';
  return confirmed && near ? 'Bearish' : near ? 'Lean bearish' : confirmed ? 'Lean bearish' : 'Neutral, waiting on confirmation';
}
/* the one unusual thing in the data, and the question it raises */
function anomalyFor(sheet) {
  const m = sheet.metrics || {}, up = sheet.lean !== 'bearish';
  if (m.upRun != null && up && m.upRun >= 5 && m.volRatio != null && m.volRatio <= 1.05) return { kind: 'quietclimb', heading: ['A climb nobody seems to be chasing', 'Up every day, and quietly', 'The volume is not following the price'] };
  if (up && m.distHighPct != null && m.distHighPct <= 3 && m.gapHi != null && m.gapHi > 0) return { kind: 'nearhigh', heading: ['The level it keeps stopping at', 'Stuck just under the high', 'One level between here and open air'] };
  if (!up && m.distLowPct != null && m.distLowPct <= 3) return { kind: 'nearlow', heading: ['Support that has to hold', 'Sitting on the floor', 'What happens if the floor gives'] };
  if ((num(m.relVol) != null && m.relVol >= 1.8) || (num(m.changePct) != null && Math.abs(m.changePct) >= 3)) return { kind: 'surge', heading: ['A move that needs explaining', 'Busy tape, open question', 'What the volume is saying'] };
  if (m.squeeze != null && m.squeeze < 0.85) return { kind: 'compress', heading: ['Quiet is not the same as nothing', 'The range keeps shrinking', 'A stock holding its breath'] };
  return { kind: 'range', heading: ['What stands out', 'The thing I keep coming back to', 'Where the stock actually sits'] };
}
/* the angles that carry their own story (the data found something specific); the narrative angle uses the anomaly instead */
const ANGLE_STORY = {
  gamma: { heading: ['The hedging nobody is looking at', 'What the options book is doing', 'Dealers have a deadline'], dek: [`Dealers who sold the calls have to hedge as price moves, and that can matter more than the chart. My read on where it leads.`, `The options book can push a stock further than opinion can. My read on the level it is pointing at.`], lede: [`The chart on {who} looks ordinary. The options book does not.`, `The people who may move {who} this week aren't traders. They're dealers hedging a book they didn't choose.`], mean1: `What I make of it: when the hedging runs the same direction as the price, it stops being background noise and starts being the move.` },
  short: { heading: ['A short that will not fall', 'The shorts have a problem', 'Pressing into strength'], dek: [`A crowded short against a stock that refuses to fall is a position with a deadline. My read on how it ends.`, `Short volume is a clue, not a confession. My read on what it does and doesn't say about {who}.`], lede: [`Somebody is still shorting {who} into this, and the FINRA data doesn't care about anyone's opinion. It counts.`, `{who} keeps going up and the short keeps pressing. One of those has to give.`], mean1: `What I make of it: a crowded short matters only if the stock stops falling, and then covering becomes buying. Whether that starts here is the whole question.` },
  earnings: { heading: ['The report is the story', 'Positioned before the number', 'What the tape did first'], dek: [`The estimate is public and the positioning isn't. My read on which way it leans into the {who} report.`], lede: [`{who} reports soon, and the estimate is the least interesting thing about it. The positioning going into it is what I'm watching.`, `Every preview of {who} will quote consensus. Almost none will say what the tape did before anyone was looking.`], mean1: `What I make of it: positioning going into a report shapes the reaction as much as the number does, because the market trades against what it already expects.` },
  tape: { heading: ['Size on the tape', 'Who is working this stock', 'What the prints show'], dek: [`Sweeps and blocks aren't how retail trades. My read on who is in {who} and how big they are.`], lede: [`The chart on {who} looks ordinary. The prints behind it don't.`, `Someone is working {who} in size, and the tape is the only place it shows.`], mean1: `What I make of it: large orders are slow to hide, and a buyer working size leaves a trail in the prints before it shows up on the chart.` },
  structure: { heading: ['The stops that got taken', 'A sweep and a reversal', 'What the sweep left behind'], dek: [`Price visited the stops, collected them and came back. My read on what that sequence implies for {who}.`], lede: [`{who} just ran the obvious level, took the stops and reversed.`, `Price in {who} went where the stops were, then left. That isn't noise.`], mean1: `What I make of it: stops sit at obvious levels, and a sweep shows they were collected. What price does next shows whether the move was a trap or a start.` }
};
function housePiece(sheet, seed = 0) {
  /* "NVIDIA Corporation" reads as a filing; the letter says "NVIDIA" */
  const shortName = (n) => String(n || '').replace(/[,.]?\s+(?:Corporation|Corp\.?|Incorporated|Inc\.?|Company|Co\.?|Ltd\.?|Limited|PLC|N\.V\.|Holdings?|Group)\s*$/i, '').trim();
  const S = sheet.S, who = shortName(sheet.name) || S, L = Object.fromEntries(sheet.lines.map((l) => [l.k, l.text]));
  const m = sheet.metrics || {};
  const facts = sheet.lines.filter((l) => l.k === 'fact').map((l) => l.text);
  const up = sheet.lean !== 'bearish';
  const pt = px(sheet.pt), stop = sheet.stop != null ? px(sheet.stop) : null;
  const stance = stanceFor(sheet), an = anomalyFor(sheet);
  const gapTxt = m.gapHi != null ? (m.gapHi >= 1 || sheet.price < 1 ? px(m.gapHi) : '$' + m.gapHi.toFixed(2)) : null, hi20 = m.hi20 != null ? px(m.hi20) : null, lo20 = m.lo20 != null ? px(m.lo20) : null;
  const trig = sheet.scenario.trigger, conf = sheet.scenario.confirm;
  /* the headline: a curiosity gap that the article actually delivers on */
  const trigNum = Number((String(trig).match(/\$([\d.]+)/) || [])[1]), trigPx = trigNum ? px(trigNum) : pt;
  const chgTxt = num(m.changePct) != null ? pct(m.changePct) : null, runN = m.upRun != null && m.upRun >= 3 && m.upRun <= 30 ? m.upRun : null;
  const byKind = {
    quietclimb: [`${S} Keeps Climbing and Almost Nobody Is Chasing It. That's What Has My Attention`, `${S} Is Rising Without a Crowd. Who Is Buying, and Why Now?`, ...(runN ? [`${S} Has Closed Higher ${runN} Days in a Row. Why the Volume Isn't Following`] : []), `A Quiet Climb in ${S}: Accumulation or Exhaustion?`],
    nearhigh: gapTxt && hi20 ? [`${S} Is Only ${gapTxt} From Its 20-Day High. Here's the Level That Changes Everything`, `${S} Is Knocking on ${hi20}. Why I'm Watching ${pt} Next`, `One Level Stands Between ${S} and ${pt}. Here's What Happens If It Breaks`, `${S} Keeps Stalling at ${hi20}. Buyers or Sellers: Who Blinks First?`] : [],
    nearlow: lo20 ? [`${S} Is Sitting on ${lo20}. What Happens If It Gives?`, `${S} Keeps Testing ${lo20}. Is Someone Defending It, or Is It About to Break?`, `The Floor Under ${S} Is ${lo20}. Here's Why It Matters More Than the Price`] : [],
    surge: [`${S} Is Moving on ${num(m.relVol) != null ? Number(m.relVol).toFixed(1) + 'x' : 'Heavy'} Volume. What Is the Market Pricing In?`, `Something Is Happening in ${S}, and the Tape Noticed First. Here's What It Shows`, ...(chgTxt ? [`${S} Just Moved ${chgTxt}. Here's Why I Don't Trust the Easy Explanation`] : [])],
    compress: [`${S} Has Gone Quiet. Is the Market Waiting for ${trigPx}?`, `${S} Is Coiling Tight and Tight Ranges Don't Last. Is ${pt} Where This One Breaks?`, `The Range in ${S} Keeps Shrinking. Which Way Does It Break?`],
    range: [`${S} Looks Ordinary. Here's the Detail That Makes It Worth a Second Look`, `${S}: The Quiet Chart That Might Be Hiding a Setup`, `${S}: What the Tape Is Saying Before the Next Move`]
  };
  const byAngle = {
    gamma: [`Dealers Are Short Gamma in ${S}. Is ${pt} the Number They Hedge Toward?`, `The Options Book in ${S} Is Doing Something the Chart Isn't Showing`, `${S} Has an Options Problem, and ${pt} Is Where It Shows`],
    short: [`The Shorts in ${S} Keep Pressing. What If That's the Mistake?`, `${S} Won't Fall, and the Shorts Are Running Out of Time. How Does This End?`, `Somebody Is Still Shorting ${S}. The Data Says They May Regret It`],
    earnings: [`${S} Reports Soon. The Positioning Tells a Different Story Than the Estimate`, `Before ${S} Reports, the Tape Has Already Picked a Side. Which One?`, `The ${S} Report Isn't the Story. What Happened Before It Is`],
    tape: [`Someone Is Quietly Working Size in ${S}. Here's What the Prints Show`, `${S}: The Tape Is Saying Something the Chart Isn't`, `Who Is Buying ${S}? Sweeps, Blocks and the Path to ${pt}`],
    structure: [`${S} Took the Lows, Then Took Them Back. What Comes Next Points to ${pt}`, `${S} Just Swept the Stops. Is ${pt} the Next Stop?`, `Stops Taken in ${S}: Why I Think the Next Leg Targets ${pt}`]
  };
  const pool = (byAngle[sheet.angle] || byKind[an.kind] || []).filter(Boolean);
  const title = pick(pool.length ? pool : [`${S}: What the Tape Is Saying Before the Next Move`], seed).slice(0, 110);
  const question = (title.match(/[^.?!]*\?/) || [''])[0].trim() || ({ quietclimb: `Is the climb real if the volume isn't following?`, nearhigh: `Does ${S} clear the level, or does it back away?`, nearlow: `Does the floor in ${S} hold?`, surge: `Who is on the other side of this move?`, compress: `Which way does ${S} break?`, range: `What is ${S} telling us before the next move?` })[an.kind];
  const AS = ANGLE_STORY[sheet.angle] || null; const fillWho = (t) => t.replace(/\{who\}/g, who);
  const dek = AS ? fillWho(pick(AS.dek, seed + 1)) : pick({
    quietclimb: [`The price is doing one thing and the volume another. My read on what that gap means, and the level that would prove me wrong.`, `A steady climb with no crowd behind it is either a head start or a trap. Here is which one I think this is.`],
    nearhigh: [`The stock is close enough to force the issue. My read on whether it does, and what I need to see first.`, `One level stands between ${who} and open air. Here is what I think happens at it.`],
    nearlow: [`Support is only support until it isn't. My read on ${who}, and the line that tells me I'm wrong.`],
    surge: [`A move this size usually has a reason, and the reason is rarely the one in the headlines. My read on ${who}.`],
    compress: [`The range keeps tightening, and tight ranges end. My read on which way ${who} breaks, and what would change my mind.`],
    range: [`No headline, no catalyst. Just a stock doing something worth reading. My read on ${who}.`]
  }[an.kind] || [`My read on ${who}, the evidence behind it, and what would prove it wrong.`], seed + 1);
  /* the lede: the anomaly as a story, then a clean factual line a reader (or a search engine) can quote, then the stance */
  const lede = [
    AS ? fillWho(pick(AS.lede, seed + 2)) : pick({
      quietclimb: [`${who} has been rising day after day, and almost nobody seems to be chasing it. That is the strange part. The price is moving and the volume is not.`, `The price on ${who} says buyers are in control. The volume says they are not in a hurry. I don't think both can be true for long.`],
      nearhigh: [`${who} is sitting just beneath a level buyers haven't cleared, and the interesting part isn't the price. It's how quietly the stock got there.`, `${who} has run up to a ceiling and stopped. Whether it breaks through or backs away is the whole story.`],
      nearlow: [`${who} is leaning on a floor it has already tested. How that floor holds is the story, not the price.`, `Support on ${who} is being asked a question it may not have a good answer to.`],
      surge: [`${who} is moving, and the move is bigger than the news around it. When that happens I want to know who is on the other side.`, `Something changed in ${who}, and the tape noticed before the headlines did.`],
      compress: [`${who} has gone quiet, and I don't read that as nothing. Ranges this tight don't last.`, `The swings in ${who} keep getting smaller. That is usually the setup, not the end of the story.`],
      range: [`${who} doesn't look like much at first glance. That's the reason to look twice.`, `No catalyst, no headline, and ${who} is still worth a second look.`]
    }[an.kind], seed + 2),
    L.ctxquote || (L.price || ''),
    `My read: ${stance.toLowerCase()}. ${{ 'Bullish': `Buyers are in control and the evidence backs it, though I still want the level to clear on volume.`, 'Lean bullish': `Buyers are close enough to force the issue, but I want volume before I call it a breakout.`, 'Neutral, waiting on confirmation': `I want confirmation before I call a direction.`, 'Lean bearish': `Sellers have the edge for now, but I want the floor to give before I say more.`, 'Bearish': `The weight of the evidence points down.`, 'Binary, event-driven': `This one belongs to the calendar more than the chart.` }[stance]}`
  ].filter(Boolean);
  /* section one: the anomaly, with the quotable facts and then what I make of them */
  const ev1 = [];
  for (const k of ['ctxrange', 'ctxstreak', 'ctxvol', 'ctxmove']) if (L[k]) ev1.push(L[k]);
  for (const f of facts.filter((x) => !/\b(?:trades|sits) at\b/.test(x)).slice(0, 2)) ev1.push(f);
  const mean1 = { quietclimb: `What I make of it: a climb on ordinary volume can be accumulation that hasn't been noticed yet, or it can be a market with nobody left to sell. The volume is the tiebreaker, and so far it hasn't picked a side.`, nearhigh: `What I make of it: when a stock stalls under a high without selling off, the sellers up there are either exhausted or being absorbed. Either way the next push decides it.`, nearlow: `What I make of it: a floor that holds on falling volume is a good sign, and a floor that holds only because nobody has pushed it yet is not.`, surge: `What I make of it: heavy volume says someone has a view with size behind it. What I don't know yet is whether that view is right.`, compress: `What I make of it: a shrinking range stores energy, and the break tells you where it goes. I won't guess the direction from the squeeze alone.`, range: `What I make of it: nothing here is loud, and that's the point. The loud setups get crowded. This one hasn't been.` }[an.kind];
  const s1 = [...fold2(ev1, seed), AS ? AS.mean1 : mean1];
  /* section two: what the market looks to be pricing in */
  const ev2 = [];
  if (L.intent) ev2.push(L.intent.replace('Smart-money read: ', 'Order-flow analysis classifies the activity as '));
  if (L.dark) ev2.push(L.dark.replace('Dark pool: ', 'Off-exchange trading: '));
  if (L.gamma && sheet.angle !== 'gamma') ev2.push(L.gamma.replace('Options: ', 'In options, '));
  if (L.gamma && sheet.angle === 'gamma') ev2.push(L.gamma.replace('Options: ', 'In options, '));
  if (L.dtc) ev2.push(L.dtc); if (L.shortscore) ev2.push(L.shortscore);
  if (L.earnings) ev2.push(L.earnings);
  if (L.market) ev2.push(L.market.replace('Market backdrop: ', 'Across the broader market, the read is '));
  if (L.crowd) ev2.push(L.crowd.replace('Crowd sentiment: ', 'Sentiment readings show '));
  if (L.insiders) ev2.push(L.insiders);
  if (L.pattern) ev2.push(L.pattern.replace('Chart patterns on the daily: ', 'On the daily chart, technical patterns include '));
  if (L.news) ev2.push(L.news.replace('Recent headline: ', 'A recent headline reads: ').replace(/\.$/, '') + '. I am reporting it as context, not as the reason for the move.');
  for (const k of ['ctxtrend', 'ctxchg']) if (L[k]) ev2.push(L[k]);
  const mean2 = ev2.length > 1 ? `What I make of it: ${pick([`the pieces mostly point the same way as the price, which is more than I can say for most setups. None of them is proof.`, `the data agrees with itself more than it argues, and that counts for something. It still falls short of proof.`], seed + 4)}` : `What I make of it: the options and flow data are quiet on this one. That is itself information. It means the move, if it comes, hasn't been positioned for.`;
  const s2 = ev2.length ? [...fold2(ev2.slice(0, 6), seed + 1), mean2] : [mean2];
  /* section three: the thing traders are overlooking, chosen from what the data shows */
  const lookP = (m.volRatio != null && m.volRatio < 1.05) ? `What I think traders are overlooking is the volume. Price can drift to a level on almost nothing, and what it does there needs real participation. Without it, a break is easy to fade.` : (L.gamma && /call wall/i.test(L.gamma)) ? `What I think traders are overlooking is how close the call wall sits to my target. The strike where the calls are stacked can pull price toward it or pin it there, and that makes it a level to watch, not a prediction.` : (L.earnings) ? `What I think traders are overlooking is the calendar. A setup that looks clean on the chart can be rearranged by a report, and the date is already on it.` : `What I think traders are overlooking is how little room the thesis needs. The line that proves it wrong is close and the level it points to is not, which is the kind of imbalance I like to see.`;
  const s3 = [lookP, pick([`That part doesn't show up on the chart.`, `None of that is visible in the candles.`, `The price alone doesn't show it.`], seed + 5)];
  /* section four: the conditional call, the invalidation, the counterargument */
  const ifRight = `If ${S} ${up ? 'posts' : 'prints'} ${lower(String(trig).split(',')[0])} and volume expands, I think ${pt} becomes the next serious test.`;
  const wrongIf = stop ? `${up ? 'Under' : 'Above'} ${stop}, I'm wrong.` : `If the invalidation level breaks, I'm wrong.`;
  const counter = pick({
    gamma: [`The honest objection is that open interest shows contracts, not who holds which side, so any dealer map is an inference. Strikes with heavy interest get crossed without a ripple more often than people admit.`],
    short: [`The honest objection is that short volume is not a short position. A high ratio is routine in liquid names, and sometimes the shorts are simply right.`],
    earnings: [`The honest objection is that one report can outweigh everything above. Guidance can move a stock through every level on this page.`],
    tape: [`The honest objection is that prints don't carry intent. Large trades can be hedges or rebalances, and the tick rule misreads direction often enough to matter.`],
    structure: [`The honest objection is selection bias. Sweeps that worked get remembered and the ones that failed don't, so any chart can be annotated into a story afterward.`],
    narrative: [`The honest objection is that a build-up is obvious in hindsight and ambiguous in real time. Plenty of quiet ranges stay quiet, and nothing here is a catalyst.`, `The honest objection is that this reads on price and volume alone. With no event to force the move, the thesis is a hypothesis with a stop, not a conclusion.`]
  }[sheet.angle] || [`The honest objection is that every read like this has limits, and mine rests on what the data showed at the time of writing.`], seed + 15);
  const s4 = [`${ifRight} ${wrongIf}`, counter, `${pick([`That's the whole trade: a level to clear, a line that proves me wrong, and not much in between.`, `So the plan is simple. Wait for the level, wait for the volume, and respect the line.`, `Clear the level on volume and I'm interested. Fail below the line and I'm out of the idea.`], seed + 6)}`];
  const bottom = pick({
    'Bullish': [`I'm leaning on the side of the buyers here. The evidence supports it, and the line that proves me wrong is close enough to respect.`, `Of everything on the page, one thing decides it: whether volume shows up at ${hi20 || 'the level'}. I'm betting it does.`],
    'Lean bullish': [`I lean higher, not loudly. The setup earns the lean and not the conviction, and it gets the conviction only when volume shows up.`, `Buyers are close enough to force the issue. I want the volume before I call it anything more than a lean.`],
    'Neutral, waiting on confirmation': [`I'm neutral until the stock gives me a reason. The level is clear and so is the line that proves me wrong, so there's nothing to do until one of them gets tested.`, `No edge yet, and I'd rather say so than invent one. The confirmation is the trade.`],
    'Lean bearish': [`I lean lower, and I'd want the floor to give before I'd say more than that.`, `Sellers have the edge for now. The edge is thin, and the line that proves me wrong is close.`],
    'Bearish': [`I think the weight of the evidence points down, and the line that proves me wrong is near enough to trade against.`],
    'Binary, event-driven': [`This one belongs to the calendar, not the chart. Whatever I think of the setup, the report gets a vote, and I'd size accordingly.`]
  }[stance], seed + 19);
  const bottomHeading = pick(['Where I land', 'My read', 'What I\'m watching'], seed + 8);
  const bull = [], bear = [];
  (up ? bull : bear).push(`${cap(sheet.angleLabel)} setup with a measured path to ${pt}`);
  if (L.intent) (/buyers|accumulation|markup/.test(L.intent) ? bull : /sellers|distribution|markdown/.test(L.intent) ? bear : bear).push(L.intent.split('.')[0].replace('Smart-money read: ', 'Order-flow read: '));
  if (L.market) (/bullish/i.test(L.market) ? bull : /bearish/i.test(L.market) ? bear : bear).push(L.market.replace('Market backdrop: ', 'Backdrop: ').split('.')[0]);
  if (L.earnings && sheet.earningsDays != null && sheet.earningsDays >= 0 && sheet.earningsDays <= 21) bear.push('A binary earnings event inside the window');
  if (L.crowd && /crowded/.test(L.crowd)) bear.push('Crowded positioning raises the bar');
  (up ? bear : bull).push(pick({ gamma: ['Dealer positioning is inferred, not observed', 'Strikes are often crossed without a reaction'], short: ['High short volume is routine in liquid names', 'Borrow cost decides who exits first'], earnings: ['Guidance can override structure', 'Implied moves differ from realized ones'], tape: ['Prints do not carry intent', 'Large trades can be hedges'], narrative: ['No catalyst identified', 'Quiet ranges often stay quiet'], structure: ['Failed sweeps are not remembered', 'Charts can be annotated after the fact'] }[sheet.angle] || ['Every read has limits'], seed + 23));
  const kill = [stop ? `A close through ${stop}.` : 'A break of the invalidation level.', up ? 'Selling absorbs the buying at a key level and price loses it on volume.' : 'Buying absorbs the selling at a key level and price reclaims it on volume.', 'Order flow reverses: the sweeps and blocks turn to the other side.', 'A scheduled event changes the picture before the trigger is reached.'];
  return { title, question, stance, dek, lede, sections: [
    { heading: pick(AS ? AS.heading : an.heading, seed + 20), paragraphs: s1 },
    { heading: pick([`What the market looks to be pricing in`, `What is already in the price`, `Who is positioned for what`], seed + 21), paragraphs: s2 },
    { heading: pick([`What I think traders are overlooking`, `The part nobody is talking about`, `The detail that changes the read`], seed + 22), paragraphs: s3 },
    { heading: pick([`If I'm right, and what proves me wrong`, `The call, and the line that breaks it`, `What happens next, and when I'm out`], seed + 24), paragraphs: s4 }
  ], ifRight, wrongIf, bottom, bottomHeading, bull: bull.slice(0, 4), bear: bear.slice(0, 4), kill: kill.slice(0, 4), source: 'house' };
}
/* paragraphs of uneven length: items folded into groups of two, one, three... */
function fold2(items, seed = 0) { const sizes = [2, 1, 3, 1, 2]; const out = []; let i = 0, k = Math.abs(seed) % sizes.length; while (i < items.length) { const n2 = sizes[k % sizes.length]; out.push(items.slice(i, i + n2).join(' ')); i += n2; k += 1; } return out; }

/* ---------- the fast path (on demand): the house writer is the body, the model only writes the front ---------- */
/* A whole piece from the model is 2,500 tokens and a minute. The house writer composes the same shape in milliseconds from the same
 * fact sheet; the model is asked only for the part a reader meets first (headline, standfirst, lede: about 300 tokens, two or three
 * seconds), under the same checks, and loses the race to a clock. Whatever the model does or does not return, the piece is whole. */
const LEDE_SYSTEM = `GRANDMASTER-OBI MARKET NARRATIVE ENGINE, front only. You write for Vaughn McNair (Grandmaster-Obi) for Loop Letters, and you rewrite only the front of a piece: the headline, the one-sentence standfirst and the two or three paragraph lede. Never mention the Academy, a Discord app, a data service or any tool by name. Start with the story, not the statistics: what is unusual about this stock, what the market seems to be pricing in, what could happen next. Keep fact, interpretation and speculation apart: state a fact plainly and cleanly, then give his read in a separate sentence ("My read: ..."). First person only where it is opinion. Never invent evidence, quotes, anecdotes, memories or emotions; never claim a cause the sheet does not establish. The headline is compelling and specific: two facts in tension, or the one level the letter is about, plus an implied question or a promise the letter keeps; it uses a real number from the sheet, 40 to 100 characters, with the ticker's dollar sign, and no clickbait ("you won't believe", "shocking", "insane", "guaranteed"). Keep the stance given. Compress data into insight, each number once, no symmetrical sentence patterns, no glossary asides, no em dashes, no canned phrases or exaggeration.
HARD RULES. Use only numbers that appear in the FACT SHEET, exactly as written.
OUTPUT exactly one JSON object: {"title": string, "dek": string, "lede": [string, string, optional string]}. Nothing before or after it.`;

async function polishFront({ ai, fetchImpl, sheet, piece, deadlineMs }) {
  const body = {
    model: ai.fastModel || 'claude-haiku-5-5', max_tokens: 700, system: LEDE_SYSTEM,
    messages: [{ role: 'user', content: `STANCE (keep it): ${piece.stance}\nTICKER: ${sheet.S}\nANGLE: ${sheet.angleLabel}\nLEAN: ${sheet.lean}\nTARGET: ${px(sheet.pt)} (${pct(sheet.ptPct)}) over ${sheet.timeframe}${sheet.stop != null ? `\nINVALIDATION: ${px(sheet.stop)}` : ''}\n\nFACT SHEET:\n${sheetText(sheet)}\n\nCURRENT FRONT (rewrite it in your voice, keep every fact):\nTITLE: ${piece.title}\nDEK: ${piece.dek}\nLEDE:\n${piece.lede.join('\n')}` }]
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
const SYSTEM = `GRANDMASTER-OBI MARKET NARRATIVE ENGINE. You write market letters for Vaughn McNair, whose trading identity is Grandmaster-Obi, for Loop Letters. The letter is his own thinking: never mention the Academy, a Discord app, a data service or any tool or product by name.
The letter must not summarize market data. It uses verified facts to build one original thesis, prediction or narrative that gives the reader a reason to keep reading. Before writing, decide: what is unusual about this stock today; what the market appears to be pricing in; what could happen next; what evidence supports that reading; what evidence would prove it wrong; what would catch traders off guard. Then choose ONE central narrative and let the structure follow the story. Do not produce the same dashboard sections every time (no "Reading the data / Context / Bull case / Bear case / Scenario / Risks / Bottom line"); the widgets carry the raw numbers, the letter carries the interpretation.
FACT, INTERPRETATION, SPECULATION. Classify every important statement. FACT is supported by the fact sheet; state it plainly and cleanly, as a sentence a reader or a search engine could quote ("NVIDIA sits at $191.77, $1.15 below its 20-day high of $192.92"), then give the commentary in a separate sentence ("My read: buyers are close enough to force the issue, but I want volume before I call it a breakout"). INTERPRETATION is what Grandmaster-Obi believes the fact means; mark it as his ("my read", "I think", "what I make of it"). SPECULATION is what could happen next if that is right; say that it is speculation. Never invent evidence to strengthen the story.
OPINION. Give a directional stance, exactly one of: "Bullish", "Lean bullish", "Neutral, waiting on confirmation", "Lean bearish", "Bearish", "Binary, event-driven". Never end on "it could go either way". Uncertainty is fine; meaninglessness is not. Make the prediction conditional ("If NVIDIA clears $192.92 and volume finally expands, I think $199 to $200 becomes the next serious test") and name the line that proves it wrong ("Under $187.94, I'm wrong").
HIERARCHY. What happened, what matters, what are traders overlooking, what does Grandmaster-Obi think it means, what happens if he is right, what proves him wrong. Original information gain: combine price action, volume, options positioning, gamma, flow, support and resistance, the market backdrop, the stock's own history and any catalyst into one conclusion nobody else has written; do not restate what is available everywhere.
HEADLINE. Compelling, intriguing, specific. Put two facts in tension (the price climbs and the volume doesn't), or name the one level or number the letter is about, and promise the one thing the letter reveals ("Here's the Level That Changes Everything", "Why I'm Watching $200 Next", "What Happens If It Gives?"). A ticker plus an unusual observation plus an implied question, or an unexpected development plus a possible consequence. Use a real number from the sheet. Write it so a trader would stop scrolling, then make sure the letter delivers exactly what the headline implies. No fake catalyst, no fake institutional activity, no exaggerated certainty, no clickbait ("you won't believe", "shocking", "insane", "to the moon", "guaranteed"). 40 to 100 characters, the ticker with its dollar sign.
VOICE. One consistent voice, first person where it is opinion, confident, plain, specific. Vary sentence length; let one paragraph be a single sentence. Do not open consecutive paragraphs the same way. No filler, no padding, no glossary or explanation of basics, one disclaimer at most (the publisher adds it), no symmetrical sentence patterns or "X happens, which means Y, and that causes Z". Do NOT invent mistakes, slang, anecdotes, memories, past trades, emotions or personal experience, and do not try to sound human on purpose: make editorial decisions instead. Never invent quotes, analysts, sources, motives or statistics, and never claim an event caused a price move unless the sheet establishes it. Use the context lines (range, recent sessions, volume, largest move) when they sharpen the story. Avoid canned phrases and exaggeration (it remains to be seen, only time will tell, landscape, testament, massive, stunning, unprecedented).
HARD RULES. Use only numbers that appear in the FACT SHEET, written exactly as given; never add a number, a level, a date or a statistic that is not there. Never repeat a sentence or a phrase. No em dashes. No headings like "What the data says", "Key takeaways", "Bottom line" or "Sources". Write plain text, no markdown. Between 600 and 1000 words in total, three to five sections each with a short story-led heading.
OUTPUT exactly one JSON object with these keys: "title", "question" (the one provocative question the letter answers, ending with a question mark), "stance" (one of the six values above), "dek" (one sentence), "lede" (array of 2 or 3 short paragraphs that start with the story, not the statistics), "sections" (array of 3 to 5 objects with "heading" and "paragraphs", an array of 1 to 4 paragraphs), "ifRight" (the conditional prediction, containing "if"), "wrongIf" (the line that proves the thesis wrong, containing "wrong"), "bottomHeading" (2 to 5 words), "bottom" (a memorable closing paragraph of 2 or 3 sentences), "bull" (2 to 4 short phrases), "bear" (2 to 4 short phrases), "kill" (3 or 4 short lines, each one thing that would end the thesis). No text outside the JSON.`;

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
  return { title: plain(n.title), dek: plain(n.dek), lede: arr(n.lede), sections: (Array.isArray(n.sections) ? n.sections : []).map((s) => ({ heading: plain(s && s.heading), paragraphs: arr(s && s.paragraphs) })).filter((s) => s.heading && s.paragraphs.length), bottom: plain(n.bottom), stance: plain(n.stance), question: plain(n.question), ifRight: plain(n.ifRight), wrongIf: plain(n.wrongIf), bottomHeading: plain(n.bottomHeading), bull: arr(n.bull).slice(0, 4), bear: arr(n.bear).slice(0, 4), kill: arr(n.kill).slice(0, 4), source: 'ai' };
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

module.exports = { STANCES, stanceFor, anomalyFor, factSheet, validate, housePiece, createArticleWriter, parseJson, normalize, SYSTEM, userPrompt, BANNED };
