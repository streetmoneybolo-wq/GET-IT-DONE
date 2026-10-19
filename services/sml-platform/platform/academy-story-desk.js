'use strict';

/* The story desk: every half hour of the trading day it reads the Academy's data on the names in play (the wide scanner, the
 * alerts desk, the earnings window, the catalyst radar), scores the five story angles, checks what Google News and Bing already
 * carry on each name and which angles nobody has written, ranks, drafts the piece in the engine's voice (optionally polished
 * by the newsroom model under strict no-new-facts rules), animates the path to the price target as a GIF, uploads it, and
 * files the article as a Loop Letter under the owner's byline. Letters are created as drafts unless autopublish is on and the
 * signed-in WordPress account really is the byline's account. The owner gets a DM with every result. */

const engine = require('./academy-story-engine');
const gifs = require('./academy-scenario-gif');
const desk2 = require('./academy-article-desk');
const outcomes = require('./academy-article-outcomes');

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function etNow(ms) { const p = {}; for (const x of ET.formatToParts(new Date(ms))) p[x.type] = x.value; return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour === '24' ? 0 : p.hour) * 60 + Number(p.minute) }; }
const etDate = (ms) => etNow(ms).date;
const timed = (fn, ms) => Promise.race([Promise.resolve().then(fn), new Promise((r) => { const t = setTimeout(() => r(null), ms); if (t.unref) t.unref(); })]).catch(() => null);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/* ---------- WordPress: media upload, Loop Letters, identity ---------- */
/* Two ways in: an application password (Basic auth), and the signed service request the Academy data bridge plugin
   (0.4.0) accepts, because the site ignores Basic auth on its REST API. The signature binds the clock, the exact path and
   a hash of the exact body to the shared bridge secret (SML_ACADEMY_BRIDGE_SECRET), and names the site user to act as
   (the byline); the plugin allows only the byline and the service user, and only on the letters, SEO, media and
   users/me routes. When both are configured both are sent; whichever the site honours signs the request in. */
function createLettersPublisher({ siteUrl, username, appPassword, authorId, secret = '', serviceUserId = null, fetchImpl = fetch, logger = () => {}, now = Date.now, minIntervalMs = 0, retryCount = 2, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const base = String(siteUrl || 'https://stockmarketloop.com').replace(/\/$/, '');
  const crypto = require('node:crypto');
  const auth = () => 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
  const signed = () => !!(secret && String(secret).length >= 32 && (Number(serviceUserId) || Number(authorId)));
  const configured = () => !!(username && appPassword) || signed();
  function signHeaders(path, payload) {
    if (!signed()) return {};
    const ts = String(Math.floor(now() / 1000)), user = String(Number(serviceUserId) || Number(authorId));
    const pathname = path.split('?')[0];
    const bodyHash = crypto.createHash('sha256').update(payload == null ? '' : payload).digest('hex');
    const sig = crypto.createHmac('sha256', String(secret)).update(`${ts}.${pathname}.${bodyHash}`).digest('hex');
    return { 'x-sml-letters-timestamp': ts, 'x-sml-letters-user': user, 'x-sml-letters-signature': `sha256=${sig}` };
  }
  let nextRequestAt = 0;
  async function api(path, { method = 'GET', body = null, raw = null, headers = {} } = {}) {
    let payload = null;
    const h = { accept: 'application/json', ...headers };
    if (username && appPassword) h.authorization = auth();
    if (raw) payload = raw; else if (body) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    for (let attempt = 0; attempt <= Math.max(0, retryCount); attempt++) {
      const wait = Math.max(0, nextRequestAt - now()); if (wait) await sleep(wait);
      /* Sign just before sending: a queued request must not carry a stale timestamp. */
      const requestHeaders = { ...h, ...signHeaders(path, payload) };
      const res = await fetchImpl(base + path, { method, headers: requestHeaders, body: payload, signal: AbortSignal.timeout(30_000) });
      const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (_) { json = null; }
      nextRequestAt = now() + Math.max(0, Number(minIntervalMs) || 0);
      if (res.ok) return json;
      if (res.status === 429 && attempt < Math.max(0, retryCount)) {
        const retryAfter = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        const retryMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.max(2000, Number(minIntervalMs) || 0) * (attempt + 1);
        nextRequestAt = Math.max(nextRequestAt, now() + retryMs);
        logger('warn', 'story_letter_rate_limited', { path, attempt: attempt + 1, retryMs });
        continue;
      }
      const e = new Error(`wp_${res.status}`); e.status = res.status; e.body = json || text.slice(0, 300); throw e;
    }
    throw new Error('wp_retry_exhausted');
  }
  let who = null;
  async function identity() { if (who) return who; const me = await api('/wp-json/wp/v2/users/me?context=edit'); who = { id: Number(me.id), name: me.name, slug: me.slug }; return who; }
  async function uploadMedia({ bytes, filename, contentType, title = '', alt = '', caption = '' }) {
    const m = await api('/wp-json/wp/v2/media', { method: 'POST', raw: bytes, headers: { 'content-type': contentType, 'content-disposition': `attachment; filename="${filename}"` } });
    try { await api(`/wp-json/wp/v2/media/${m.id}`, { method: 'POST', body: { title, alt_text: alt, caption } }); } catch (_) { /* the file is up; the labels are a nicety */ }
    return { id: Number(m.id), url: m.source_url };
  }
  /* letters-api.php: POST /letters takes the title only and answers { ok, letter_id, slug } under the signed-in author;
     everything else (subtitle, tldr, cover, tags, visibility, the blocks) goes through POST /letters/{id}. */
  const updateLetter = (id, letter) => api(`/wp-json/sml-letters/v1/letters/${id}`, { method: 'POST', body: letter });
  async function createLetter(letter) {
    const out = await api('/wp-json/sml-letters/v1/letters', { method: 'POST', body: { title: letter.title } });
    const id = Number(out && (out.letter_id || out.id || (out.letter && out.letter.id)));
    if (!Number.isFinite(id) || id <= 0) return { id: null, raw: out };
    const patch = {};
    for (const k of ['subtitle', 'tldr', 'cover_url', 'content_type', 'tags', 'visibility', 'blocks']) if (letter[k] !== undefined && letter[k] !== null) patch[k] = letter[k];
    if (Object.keys(patch).length) await updateLetter(id, patch);
    return { id, slug: out && out.slug ? String(out.slug) : '', raw: out };
  }
  async function getLetter(id) { const out = await api(`/wp-json/sml-letters/v1/letters/${id}`); return { id: Number(out && out.id) || Number(id), url: out && out.url ? String(out.url) : '', slug: out && out.slug ? String(out.slug) : '', status: out && out.status ? String(out.status) : '' }; }
  async function publishLetter(id) { const out = await api(`/wp-json/sml-letters/v1/letters/${id}/publish`, { method: 'POST', body: {} }); return { ok: !!(out && out.ok), status: out && out.status, url: out && out.letter && out.letter.url ? String(out.letter.url) : '' }; }
  /* loop-letters-seo.php keeps { seo: { meta_title, meta_desc, keyword, schema, tags, sentiment, og_title, og_desc, twitter, social_image, category } } */
  async function saveSeo(id, seo) { try { return await api(`/wp-json/sml-letters-seo/v1/letter/${id}`, { method: 'POST', body: { seo } }); } catch (error) { logger('warn', 'story_seo_save_failed', { id, error: String(error && error.message || error) }); return null; } }
  return { configured, signed, identity, uploadMedia, createLetter, updateLetter, getLetter, publishLetter, saveSeo, authorId: Number(authorId) || null, base };
}

/* ---------- optional polish by the newsroom model: voice only, never new facts ---------- */
function createPolisher({ apiKey = '', model = 'gpt-5-mini', fetchImpl = fetch, logger = () => {} } = {}) {
  const enabled = !!apiKey;
  async function polish(draft, facts) {
    if (!enabled) return null;
    const rules = 'You are the lead writer of a markets desk read by people who studied finance and also live online. Rewrite the article HTML below to the house voice. VOICE: graduate-level analysis (name the mechanism, say what forces what and why, hedge claims honestly, use the proper term and explain it in the same breath) delivered in a modern, urban register: short punchy sentences after long analytical ones, contemporary phrasing, trader vernacular used sparingly, and at most two dry, light jokes that never target a person and never imply certainty. Confident, never breathless. HARD RULES: keep every number, price, percentage, level and ticker exactly as given and add none; keep the same H2 sections in the same order with the same headings; keep the labelled speculation sentence and the closing disclosure paragraph verbatim; keep every list; you may tighten or deepen sentences but do not drop an idea; no em dashes; no phrases like "in conclusion", "delve", "landscape", "tapestry", "it is important to note", "as an AI"; no guarantees, no "shorts are trapped", no "going to"; do not mention automation, models or data desks beyond what the text already says; return only the HTML.';
    try {
      const res = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, store: false, reasoning: { effort: 'low' }, input: [{ role: 'system', content: rules }, { role: 'user', content: 'FACTS (the only numbers allowed):\n' + facts.join('\n') + '\n\nARTICLE HTML:\n' + draft }] }), signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error('openai_' + res.status);
      const j = await res.json();
      const text = (j.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('') || j.output_text || '';
      const html = String(text).replace(/^```html\s*|```\s*$/g, '').trim();
      if (html.length < draft.length * 0.6 || html.length > draft.length * 1.7 || !/<h2>/.test(html) || /—/.test(html)) return null;
      const heads = (x) => (x.match(/<h2>[\s\S]*?<\/h2>/g) || []).map((h) => h.replace(/<[^>]+>/g, '').trim()).join('|');
      if (heads(html) !== heads(draft)) return null; // the same sections, in the same order, under the same headings
      // every number in the draft must survive and nothing new may appear
      const nums = (s) => new Set((s.replace(/<[^>]+>/g, ' ').match(/\$?\d[\d,]*\.?\d*%?/g) || []).map((x) => x.replace(/,/g, '')));
      const a = nums(draft), b = nums(html);
      for (const n of b) if (!a.has(n) && !/^\d{1,2}$/.test(n)) return null;
      return html;
    } catch (error) { logger('warn', 'story_polish_failed', { error: String(error && error.message || error) }); return null; }
  }
  return { enabled, polish };
}

/* ---------- the desk ---------- */
function createStoryDesk({
  universe, candles, gamma = null, shortData = null, finra = null, institutional = null, darkPool = null, smc = null, sentiment = null, earnings = null, playbook = null, direction = null, runner = null, company = null,
  heat = null, publisher = null, polisher = null, dm = null, ownerIds = [], store = null, marketState = null, now = Date.now, logger = () => {},
  perTick = 18, maxPerTick = 3, maxPerDay = 12, dedupeDays = 3, autopublish = false, windowFrom = 420, windowTo = 990, siteUrl = 'https://stockmarketloop.com', byline = 'Vaughn McNair', publication = 'Making Easy Money',
  insights = {}, chartEndpoint = '', discordUrl = '', authorPath = '/n/grandmasterobi/', writer = null,
  /* scheduled pieces: [{ at: minutes into the ET day, subjects: ['the market', 'nasdaq'] }], each slot once per trading
     day in the hour after its time (the market-open and the market-close reads) */
  schedule = [], settlePerTick = 20,
  /* the process shares a 512 MB box with everything else: a piece (its dossier, its GIF, its model draft) is written only while memory has room */
  memoryOk = () => true
} = {}) {
  const authorUrl = siteUrl + authorPath;
  let state = null, busy = false, cursor = 0;
  async function load() { if (!state) { try { state = (store && await store.read()) || null; } catch (_) { state = null; } if (!state || !state.written) state = { written: {}, log: [], day: '', count: 0 }; } if (!Array.isArray(state.outcomes)) state.outcomes = []; if (!state.sched || typeof state.sched !== 'object') state.sched = {}; return state; }
  /* the record: one ledger entry per piece written, settled from the daily bars that follow (academy-article-outcomes.js) */
  const recordNow = () => outcomes.record(state ? state.outcomes : []);
  function logOutcome(story, c, { filed = false, letterId = null, url = '' } = {}) {
    const e = outcomes.openEntry({ id: `${c.symbol}:${story.angle}:${now()}`, symbol: c.symbol, angle: story.angle, lean: story.lean, price: c.price, pt: story.pt, stop: story.stop, timeframe: story.timeframe, earningsDaysAway: c.earnings ? c.earnings.daysAway : null, at: now(), filed, letterId, url });
    if (!e) return;
    state.outcomes.push(e); if (state.outcomes.length > 400) state.outcomes.splice(0, state.outcomes.length - 400);
  }
  async function settle() {
    const open = state.outcomes.filter((e) => e.status === 'open').slice(0, settlePerTick);
    let changed = 0;
    for (const e of open) {
      const bars = await bars1d(e.symbol); if (!bars.length) continue;
      const s = outcomes.settleEntry(e, bars, now());
      const i = state.outcomes.indexOf(e); if (i >= 0) state.outcomes[i] = s;
      if (s.status !== e.status) { changed += 1; note(`${e.symbol} ${e.angle} PT $${e.pt}: ${s.result} (${s.returnPct == null ? 'n/a' : (s.returnPct >= 0 ? '+' : '') + s.returnPct + '%'} in ${s.days} days)`, { symbol: e.symbol, angle: e.angle, result: s.result }); }
    }
    return changed;
  }
  /* the scheduled slots: each fires once per ET day, in the hour after its time */
  async function runSchedule(et, t) {
    const out = [];
    for (const slot of schedule) {
      const at = Number(slot.at); if (!Number.isFinite(at) || !Array.isArray(slot.subjects)) continue;
      const key = `${et.date}:${at}`;
      if (state.sched[key] || et.minutes < at || et.minutes > at + 60) continue;
      if (!memoryOk()) { logger('warn', 'story_desk_memory_pause', { slot: at }); continue; } // the slot stays open for the next tick inside its hour
      state.sched[key] = t; for (const k of Object.keys(state.sched)) if (!k.startsWith(et.date)) delete state.sched[k];
      for (const subject of slot.subjects) { try { const r = await write(subject, { file: true, scheduled: true }); out.push({ subject, ok: r.ok, error: r.error || (r.filed && r.filed.error) || '', url: r.filed ? r.filed.url : '' }); } catch (error) { out.push({ subject, ok: false, error: String(error && error.message || error) }); } }
    }
    return out;
  }
  const save = async () => { if (store) { try { await store.write(state); } catch (error) { logger('warn', 'story_state_save_failed', { error: String(error && error.message || error) }); } } };
  const note = (text, extra = {}) => { state.log.push({ t: now(), text, ...extra }); if (state.log.length > 200) state.log.splice(0, state.log.length - 200); };

  async function bars1d(symbol) { const p = await timed(() => candles(symbol, '1D'), 10_000); return p && Array.isArray(p.bars) ? p.bars : []; }

  /* everything the engine scores for one symbol, from the Academy's services (each read raced against a timeout) */
  async function candidate(row, { withHeat = true, withDarkPool = true } = {}) {
    const symbol = String(row.symbol).toUpperCase();
    const daily = await bars1d(symbol); if (daily.length < 30) return null;
    const last = daily[daily.length - 1];
    const price = num(row.price) || num(last.c); if (!(price > 0)) return null;
    const vols = daily.slice(-21, -1).map((b) => Number(b.v) || 0), adv = avg(vols);
    const relVol = num(row.relVol) || (num(row.volume) && adv ? num(row.volume) / adv : null);
    const [gx, sd, fin, inst, dp, sent, earn, pb, co] = await Promise.all([
      gamma ? timed(() => gamma.get(symbol), 15_000) : null,
      shortData ? timed(() => shortData(symbol), 8_000) : null,
      finra ? timed(() => finra.forSymbol(symbol, daily.slice(-3).map((b) => etDate(Number(b.t)))), 12_000) : null,
      institutional ? timed(() => institutional.get(symbol), 8_000) : null,
      darkPool && withDarkPool ? timed(() => darkPool(symbol), 12_000) : null,
      sentiment ? timed(() => sentiment.get(symbol), 10_000) : null,
      earnings ? timed(() => earnings(symbol), 6_000) : null,
      playbook ? timed(() => playbook(symbol), 10_000) : null,
      company ? timed(() => company(symbol), 6_000) : null
    ]);
    let m = null;
    if (smc) { try { const a = smc.analyze(daily); if (a) { const last = daily.length - 1; m = { structure: a.structure.events.filter((e) => e.idx >= last - 3).map((e) => ({ type: e.type, dir: e.dir, level: r2(e.level) })).reverse(), sweeps: a.liquidity.filter((l) => l.sweptAt != null && l.sweptAt >= last - 5).map((l) => ({ kind: l.kind, level: r2(l.level) })), fvgs: a.fvg.filter((g) => g.filledAt == null && last - g.i <= 60).map((g) => ({ dir: g.dir, top: r2(g.top), bottom: r2(g.bottom), filled: false })).reverse(), orderBlocks: a.structure.orderBlocks.filter((o) => o.invalidAt == null).slice(-2).map((o) => ({ dir: o.dir, top: r2(o.top), bottom: r2(o.bottom) })).reverse(), range: a.range ? { hi: r2(a.range.hi), lo: r2(a.range.lo), pos: a.range.pos } : null, vwap: a.vwap[last] ? { level: r2(a.vwap[last].vwap), above: last >= 0 && daily[last].c >= a.vwap[last].vwap } : null, openLiquidity: a.liquidity.filter((l) => l.takenAt == null && l.sweptAt == null).slice(-6).map((l) => ({ kind: l.kind, level: r2(l.level), count: l.count })) }; } } catch (_) { m = null; } }
    const fRow = fin && fin.length ? fin[fin.length - 1] : null;
    const feedRatio = sd && Array.isArray(sd.volume) && sd.volume.length ? (() => { const x = sd.volume[sd.volume.length - 1]; const r = num(x.ratio); return r == null ? (num(x.total) > 0 ? num(x.short) / num(x.total) : null) : (r > 1 ? r / 100 : r); })() : null;
    const baseline = sd && Array.isArray(sd.volume) && sd.volume.length >= 6 ? avg(sd.volume.slice(0, -1).map((x) => { const r = num(x.ratio); return r == null ? (num(x.total) > 0 ? num(x.short) / num(x.total) : null) : (r > 1 ? r / 100 : r); }).filter((x) => x != null)) : null;
    const interest = sd && Array.isArray(sd.interest) && sd.interest[0] ? sd.interest[0] : null;
    const short = (fRow || feedRatio != null || interest) ? { ratio: fRow ? fRow.shortRatio : feedRatio, baselineRatio: baseline, daysToCover: interest ? num(interest.days_to_cover ?? interest.daysToCover) : null, shortInterestPct: interest ? num(interest.short_percent_float ?? interest.shortPercentFloat ?? interest.percent_float) : null } : null;
    const tapeStats = inst && inst.tape ? inst.tape : null;
    const tape = (tapeStats || dp) ? { sweepBuy: tapeStats && tapeStats.sweeps ? num(tapeStats.sweeps.buy, 0) : 0, sweepSell: tapeStats && tapeStats.sweeps ? num(tapeStats.sweeps.sell, 0) : 0, blockBuy: dp && dp.blocks ? dp.blocks.list.filter((b) => b.dir > 0).length : (tapeStats && tapeStats.blocks ? num(tapeStats.blocks.buy, 0) : 0), blockSell: dp && dp.blocks ? dp.blocks.list.filter((b) => b.dir < 0).length : (tapeStats && tapeStats.blocks ? num(tapeStats.blocks.sell, 0) : 0), offSharePct: dp ? num(dp.offSharePct) : null, typicalSharePct: dp ? num(dp.typicalSharePct, 42) : 42, absorption: !!(inst && Array.isArray(inst.notes) && inst.notes.some((n) => /absorption/i.test(n))) } : null;
    const earningsIn = earn && num(earn.daysAway) != null ? { daysAway: Number(earn.daysAway), date: earn.date || null, timing: pb && pb.timing || null, impliedPct: pb && pb.implied ? num(pb.implied.impliedPct) : null, histAvgMovePct: pb && pb.history && num(pb.history.avgMovePct) != null ? num(pb.history.avgMovePct) : (pb && Array.isArray(pb.history) && pb.history.length ? avg(pb.history.map((h) => Math.abs(num(h.movePct, 0)))) : null) } : null;
    const sentIn = sent && sent.ok && sent.available !== false ? { score: num(sent.score), label: sent.label, crowdedLong: !!(sent.components && sent.components.options && sent.components.options.crowdedLong) } : null;
    let run = null; if (runner && daily.length > 25) { try { run = runner.trailFor({ daily, entry: daily[daily.length - 21].c, sinceT: daily[daily.length - 21].t }); } catch (_) { run = null; } }
    const dir = direction ? await timed(() => direction(), 8_000) : null;
    const name = (co && (co.name || co.company_name)) || row.name || '';
    const h = heat && withHeat ? await timed(() => heat.heatFor(symbol, name), 25_000) : null;
    return { symbol, name, price, changePct: num(row.changePct), relVol: relVol != null ? r2(relVol) : null, adv, marketCap: co ? num(co.market_cap) : null, daily, gamma: gx && gx.available ? gx : null, short, tape, smc: m, earnings: earningsIn, sentiment: sentIn, institutional: inst && inst.available ? { bias: num(inst.bias), label: inst.label } : null, runner: run, direction: dir && dir.ok ? { bias: dir.bias, label: dir.label } : null, heat: h || null };
  }

  /* the piece: the dossier (every insight the Academy has on the name) and, when the piece is being filed, the GIF and the
     poster uploaded first so the social image is known; then the composer (academy-article-desk.js) writes the article with
     its modules, backlinks, stylesheet and head. compose() is pure, so the package is re-made with the final letter URL. */
  async function produce(story, c, { file = true, topic = null } = {}) {
    const asOf = now();
    const upload = file && publisher && publisher.configured();
    const [dossier, gif] = await Promise.all([
      desk2.buildDossier(c.symbol, insights).catch((error) => { logger('warn', 'story_dossier_failed', { symbol: c.symbol, error: String(error && error.message || error) }); return {}; }),
      (async () => {
        // the GIF: the last 40 daily candles, then the path (trigger, confirmation, target)
        let media = null, gifInfo = null, posterMedia = null;
        if (!upload || !memoryOk()) { if (upload) logger('info', 'story_gif_skipped_memory', { symbol: c.symbol }); return { media, gifInfo, posterMedia }; }
        try {
          const gifOpts = { symbol: c.symbol, bars: c.daily.slice(-40), last: c.price, target: story.pt, stop: story.stop, levels: (c.gamma && c.gamma.callWall ? [{ label: 'Call wall', price: c.gamma.callWall.strike }] : []).concat(c.smc && c.smc.range ? [{ label: 'Range high', price: c.smc.range.hi }] : []), waypoints: story.path || [], count: 12, lean: story.lean, title: `$${c.symbol}: the path to $${story.pt}`, subtitle: `${engine.ANGLES[story.angle].label} scenario. Speculative, not advice.` };
          gifInfo = await gifs.gifAsync(gifOpts);
          if (gifInfo && gifInfo.gif) media = await publisher.uploadMedia({ bytes: gifInfo.gif, filename: `${c.symbol.toLowerCase()}-path-to-${String(story.pt).replace('.', '-')}.gif`, contentType: 'image/gif', title: `$${c.symbol} path to $${story.pt}`, alt: `${c.symbol} price-action scenario: real candles, then the move to $${story.pt}`, caption: 'Speculative scenario built from the Academy data desk. Not advice.' });
          if (typeof gifs.poster === 'function') {
            // the still the search engines and social cards use: a 1200 pixel PNG of the finished scenario
            const poster = gifs.poster(gifOpts, 1200);
            if (poster && poster.png) posterMedia = await publisher.uploadMedia({ bytes: poster.png, filename: `${c.symbol.toLowerCase()}-scenario-poster.png`, contentType: 'image/png', title: `$${c.symbol} scenario: the path to $${story.pt}`, alt: `${c.symbol} price-action scenario to $${story.pt}`, caption: 'Speculative scenario from the Academy data desk. Not advice.' });
          }
        } catch (error) { logger('warn', 'story_gif_failed', { symbol: c.symbol, error: String(error && error.message || error) }); }
        return { media, gifInfo, posterMedia };
      })()
    ]);
    const { media, gifInfo, posterMedia } = gif;
    const coverUrl = posterMedia && posterMedia.url ? posterMedia.url : (media && media.url ? media.url : '');
    /* the prose: the model writes as the byline from the fact sheet (checked: no new numbers, no repeats, no padding); the house writer otherwise */
    let narrative = null;
    if (writer && typeof writer.write === 'function') { try { narrative = await writer.write(desk2.factSheet({ story, c, dossier, record: recordNow() })); } catch (error) { logger('warn', 'story_writer_failed', { symbol: c.symbol, error: String(error && error.message || error) }); narrative = null; } }
    const compose = (url) => desk2.composeArticle({ story, c, dossier, asOf, author: byline, publication, siteUrl, authorUrl, chartEndpoint, discordUrl, url, imageUrl: coverUrl, topic, record: recordNow(), narrative });
    const guess = compose('');
    const pkg = file ? compose(`${siteUrl}${authorPath}${guess.slug}/`) : guess;
    const symLine = `${c.symbol} price-action scenario to $${story.pt}`;
    /* the figures lead as the composer's one tight frame (no second card repeating them), and the animated path replaces the still chart */
    const body = [...pkg.blocks.filter((b) => !(media && media.url && b.id === 'img-chart')), { id: 'd1', type: 'disclosure', position: 'educational scenario from the Academy data desk; the author may hold or trade positions in the names discussed' }];
    // the animated path sits right after the opening paragraphs
    let at = 0, seen = 0;
    for (let i = 0; i < body.length; i++) { if (body[i].type === 'paragraph') { seen += 1; if (seen === 2) { at = i + 1; break; } } }
    if (media && media.url) body.splice(at, 0, { id: 'gif1', type: 'image', url: media.url, alt: symLine, caption: 'Speculative scenario: real candles, then the path the setup needs. Not a forecast.' });
    const blocks = body;
    const letter = { title: pkg.title, subtitle: pkg.dek, tldr: pkg.tldr, html: pkg.bodyHtml, blocks, content_type: 'Analysis', tags: pkg.tags, cover_url: coverUrl || undefined, visibility: 'public', slug: pkg.slug };
    return { draft: { ...pkg, html: pkg.bodyHtml, parts: pkg.parts, asOfIso: pkg.asOfIso }, pkg, compose, html: pkg.bodyHtml, letter, media, posterMedia, seo: pkg.seo, dossier, gifFrames: gifInfo ? gifInfo.frames : 0 };
  }

  async function file(story, c, built) {
    const out = { symbol: c.symbol, angle: story.angle, title: built.draft.title, pt: story.pt, ptPct: story.ptPct, rank: story.rank, letterId: null, url: '', published: false, asByline: null, error: '' };
    if (!publisher || !publisher.configured()) { out.error = 'letters_unconfigured'; return out; }
    try {
      const me = await publisher.identity();
      out.asByline = publisher.authorId ? me.id === publisher.authorId : null;
      const created = await publisher.createLetter(built.letter);
      out.letterId = created.id; out.rawKeys = created.raw && typeof created.raw === 'object' ? Object.keys(created.raw).slice(0, 12) : null;
      if (!created.id) { out.error = 'letter_id_missing'; logger('warn', 'story_letter_create_unknown_shape', { symbol: c.symbol, raw: JSON.stringify(created.raw).slice(0, 400) }); return out; }
      await publisher.saveSeo(created.id, built.seo);
      if (autopublish && out.asByline) { const pub = await publisher.publishLetter(created.id); out.published = true; if (pub && pub.url) out.url = pub.url; }
      if (!out.url) { try { const got = typeof publisher.getLetter === 'function' ? await publisher.getLetter(created.id) : null; if (got && got.url) out.url = got.url; } catch (_) { /* the id is enough */ } }
      if (!out.url) out.url = `${siteUrl}/n/grandmasterobi/${created.slug || built.draft.slug}/`;
    } catch (error) { out.error = String(error && error.message || error); logger('warn', 'story_letter_failed', { symbol: c.symbol, error: out.error, body: error && error.body ? JSON.stringify(error.body).slice(0, 300) : '' }); }
    return out;
  }

  /* the package the owner copies from: re-made with the final letter URL once the piece is filed (compose is pure) */
  function packageFor(built, url = '') {
    const pkg = url ? built.compose(url) : built.pkg;
    return { title: pkg.title, dek: pkg.dek, slug: pkg.slug, tags: pkg.tags, keyword: pkg.keyword, lean: pkg.lean, pt: pkg.pt, ptPct: pkg.ptPct, angle: pkg.angle, wordCount: pkg.wordCount, readMinutes: pkg.readMinutes,
      modules: pkg.modules, sections: pkg.sections, links: pkg.links, faq: pkg.faq, seo: pkg.seo, html: pkg.bodyHtml, css: pkg.css, js: pkg.js, head: pkg.headHtml, document: pkg.document, blocks: pkg.blocks, url };
  }

  async function tell(results) {
    if (!dm || !ownerIds.length || !results.length) return;
    const lines = ['📰 **Article Desk** · ' + results.length + ' piece' + (results.length === 1 ? '' : 's')];
    for (const r of results) lines.push(`• $${r.symbol} · ${engine.ANGLES[r.angle].label} · PT $${r.pt} (${r.ptPct >= 0 ? '+' : ''}${r.ptPct}%) · rank ${r.rank}\n  ${r.title}\n  ${r.error ? '⚠️ ' + r.error : (r.published ? '✅ published' : '📝 draft' + (r.asByline === false ? ' (signed-in account is not the byline: add the byline account\'s app password to publish)' : '')) + (r.url ? ' · ' + r.url : '')}`);
    for (const id of ownerIds) { try { await dm(id, lines.join('\n').slice(0, 1900)); } catch (_) { /* best effort */ } }
  }

  async function tick(force = false) {
    if (busy) return null; busy = true;
    try {
      await load();
      const t = now(), et = etNow(t), ms = marketState ? marketState(t) : null;
      if (!force) { if (ms && ms.tradingDay === false) return { skipped: 'holiday' }; if (et.minutes < windowFrom || et.minutes > windowTo) return { skipped: 'outside_window' }; }
      if (state.day !== et.date) { state.day = et.date; state.count = 0; }
      /* first the record (open pieces scored against the bars since), then the scheduled reads, then the scan */
      let settled = 0; try { settled = await settle(); } catch (error) { logger('warn', 'story_settle_failed', { error: String(error && error.message || error) }); }
      let scheduled = []; try { scheduled = await runSchedule(et, t); } catch (error) { logger('warn', 'story_schedule_failed', { error: String(error && error.message || error) }); }
      if (settled || scheduled.length) await save();
      if (state.count >= maxPerDay) return { skipped: 'daily_cap', settled, scheduled };
      let rows = []; try { rows = (await universe()) || []; } catch (error) { logger('warn', 'story_universe_failed', { error: String(error && error.message || error) }); }
      rows = rows.filter((r) => r && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(String(r.symbol || '').toUpperCase()));
      if (!rows.length) return { skipped: 'no_universe' };
      const slice = []; for (let k = 0; k < Math.min(perTick, rows.length); k++) slice.push(rows[(cursor + k) % rows.length]); cursor = (cursor + perTick) % Math.max(1, rows.length);
      /* the data read first (fast, local), the news-heat check (a dozen RSS fetches per name) only for the ten strongest setups:
         a full-universe heat check took longer than the gap between deploys and never finished */
      logger('info', 'story_desk_scan', { symbols: slice.length });
      const cands = [];
      // gentle on the API's half core: one symbol at a time with a pause between, the trade-record read (50k prints) and the
      // news-heat check only for the ten strongest setups, and the loop given a turn after each
      for (const r of slice) { const c = await candidate(r, { withHeat: false, withDarkPool: false }).catch((error) => { logger('warn', 'story_candidate_failed', { symbol: r.symbol, error: String(error && error.message || error) }); return null; }); if (c) cands.push(c); await new Promise((res) => setTimeout(res, 400)); }
      const strongest = [...new Set(engine.rankStories(cands).map((x) => x.symbol))].slice(0, 10);
      for (const sym of strongest) {
        const i = cands.findIndex((x) => x.symbol === sym); if (i < 0) continue;
        const full = await candidate({ symbol: sym, price: cands[i].price, changePct: cands[i].changePct, relVol: cands[i].relVol, name: cands[i].name }, { withHeat: true, withDarkPool: true }).catch(() => null);
        if (full) cands[i] = full;
        await new Promise((res) => setTimeout(res, 400));
      }
      const cutoff = t - dedupeDays * 86_400_000;
      for (const k of Object.keys(state.written)) if (state.written[k] < cutoff) delete state.written[k];
      const ranked = engine.rankStories(cands).filter((s) => !state.written[s.symbol + ':' + s.angle] && !Object.keys(state.written).some((k) => k.startsWith(s.symbol + ':') && state.written[k] > t - 86_400_000)).slice(0, Math.min(maxPerTick, maxPerDay - state.count));
      const results = [];
      for (const s of ranked) {
        if (s.rank < 60) continue; // a story needs a real setup; the desk would rather publish nothing
        if (!memoryOk()) { logger('warn', 'story_desk_memory_pause', { symbol: s.symbol, written: results.length }); note(`paused for memory before ${s.symbol}`); break; }
        const c = cands.find((x) => x.symbol === s.symbol);
        const built = await produce(s, c);
        const filed = await file(s, c, built);
        results.push({ ...filed, frames: built.gifFrames, writer: built.pkg && built.pkg.narrative ? built.pkg.narrative.source : 'house' });
        // a filing that failed (credential rejected, site down) is not "written": the next tick tries the name again
        if (!filed.error) { state.written[s.symbol + ':' + s.angle] = t; state.count += 1; logOutcome(s, c, { filed: true, letterId: filed.letterId, url: filed.url }); }
        note(`${s.symbol} ${s.angle} PT $${s.pt} rank ${s.rank}: ${filed.error || (filed.published ? 'published' : 'draft')} ${filed.url || ''}`, { symbol: s.symbol, angle: s.angle, letterId: filed.letterId });
      }
      await save();
      await tell(results);
      return { scanned: slice.length, candidates: cands.length, ranked: ranked.length, filed: results.length, results, settled, scheduled };
    } catch (error) { logger('error', 'story_tick_failed', { error: String(error && error.message || error) }); return null; }
    finally { busy = false; }
  }
  /* one subject on demand (the owner's "write about X": a ticker, or a topic the market trades through a proxy): the best
     angle, written in full. file:false composes the package to copy from without touching the site; file:true (the
     default) also files it as a Loop Letter draft (publish:true publishes it when the signed-in account is the byline). */
  async function write(input, { publish = false, file: doFile = true, scheduled = false } = {}) {
    await load();
    const subject = desk2.resolveSubject(input);
    if (!subject) return { ok: false, error: 'invalid_symbol' };
    const c = await candidate({ symbol: subject.symbol });
    if (!c) return { ok: false, error: 'no_data', subject };
    const ranked = engine.rankStories([c]);
    if (!ranked.length) return { ok: false, error: 'no_angle', heat: c.heat, subject };
    const built = await produce(ranked[0], c, { file: doFile, topic: subject.topic });
    let filed = null;
    if (doFile) {
      filed = await file(ranked[0], c, built);
      if (publish && filed.letterId && publisher && !filed.published) { try { const pub = await publisher.publishLetter(filed.letterId); filed.published = true; if (pub && pub.url) filed.url = pub.url; } catch (error) { filed.error = String(error && error.message || error); } }
      if (!filed.error) { state.written[c.symbol + ':' + ranked[0].angle] = now(); logOutcome(ranked[0], c, { filed: true, letterId: filed.letterId, url: filed.url }); }
      note(`${scheduled ? 'scheduled ' : ''}${subject.label} ${ranked[0].angle} PT $${ranked[0].pt}: ${filed.error || (filed.published ? 'published' : 'draft')} ${filed.url || ''}`, { symbol: c.symbol, angle: ranked[0].angle, letterId: filed.letterId });
      await save();
      await tell([filed]);
    } else { logOutcome(ranked[0], c, { filed: false }); await save(); }
    const article = packageFor(built, filed && filed.url ? filed.url : '');
    return { ok: true, subject, story: { ...ranked[0], facts: ranked[0].facts }, dossier: Object.fromEntries(Object.entries(built.dossier || {}).map(([k, v]) => [k, !!(v && (Array.isArray(v) ? v.length : true))])),
      draft: { title: article.title, dek: article.dek, meta: article.seo.meta_desc, tags: article.tags, wordCount: article.wordCount, readMinutes: article.readMinutes, seo: article.seo, document: article.document, modules: article.modules, sections: article.sections, links: article.links },
      article, filed };
  }
  async function status() { await load(); return { day: state.day, count: state.count, written: Object.keys(state.written).length, log: state.log.slice(-20).reverse(), record: recordNow(), schedule: schedule.map((s) => ({ at: s.at, subjects: s.subjects, done: !!state.sched[`${state.day}:${s.at}`] })) }; }
  return { tick, write, status, candidate, load, settle, record: recordNow };
}

module.exports = { createStoryDesk, createLettersPublisher, createPolisher };
