'use strict';

/* The story desk: every half hour of the trading day it reads the Academy's data on the names in play (the wide scanner, the
 * alerts desk, the earnings window, the catalyst radar), scores the five story angles, checks what Google News and Bing already
 * carry on each name and which angles nobody has written, ranks, drafts the piece in the engine's voice (optionally polished
 * by the newsroom model under strict no-new-facts rules), animates the path to the price target as a GIF, uploads it, and
 * files the article as a Loop Letter under the owner's byline. Letters are created as drafts unless autopublish is on and the
 * signed-in WordPress account really is the byline's account. The owner gets a DM with every result. */

const engine = require('./academy-story-engine');
const gifs = require('./academy-scenario-gif');

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function etNow(ms) { const p = {}; for (const x of ET.formatToParts(new Date(ms))) p[x.type] = x.value; return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour === '24' ? 0 : p.hour) * 60 + Number(p.minute) }; }
const etDate = (ms) => etNow(ms).date;
const timed = (fn, ms) => Promise.race([Promise.resolve().then(fn), new Promise((r) => { const t = setTimeout(() => r(null), ms); if (t.unref) t.unref(); })]).catch(() => null);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/* ---------- WordPress: media upload, Loop Letters, identity ---------- */
function createLettersPublisher({ siteUrl, username, appPassword, authorId, fetchImpl = fetch, logger = () => {} } = {}) {
  const base = String(siteUrl || 'https://stockmarketloop.com').replace(/\/$/, '');
  const auth = () => 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
  const configured = () => !!(username && appPassword);
  async function api(path, { method = 'GET', body = null, raw = null, headers = {} } = {}) {
    const h = { authorization: auth(), accept: 'application/json', ...headers };
    let payload = null;
    if (raw) payload = raw; else if (body) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const res = await fetchImpl(base + path, { method, headers: h, body: payload, signal: AbortSignal.timeout(30_000) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (_) { json = null; }
    if (!res.ok) { const e = new Error(`wp_${res.status}`); e.status = res.status; e.body = json || text.slice(0, 300); throw e; }
    return json;
  }
  let who = null;
  async function identity() { if (who) return who; const me = await api('/wp-json/wp/v2/users/me?context=edit'); who = { id: Number(me.id), name: me.name, slug: me.slug }; return who; }
  async function uploadMedia({ bytes, filename, contentType, title = '', alt = '', caption = '' }) {
    const m = await api('/wp-json/wp/v2/media', { method: 'POST', raw: bytes, headers: { 'content-type': contentType, 'content-disposition': `attachment; filename="${filename}"` } });
    try { await api(`/wp-json/wp/v2/media/${m.id}`, { method: 'POST', body: { title, alt_text: alt, caption } }); } catch (_) { /* the file is up; the labels are a nicety */ }
    return { id: Number(m.id), url: m.source_url };
  }
  async function createLetter(letter) {
    const out = await api('/wp-json/sml-letters/v1/letters', { method: 'POST', body: letter });
    const id = Number(out && (out.id || (out.letter && out.letter.id)));
    return { id: Number.isFinite(id) ? id : null, raw: out };
  }
  const updateLetter = (id, letter) => api(`/wp-json/sml-letters/v1/letters/${id}`, { method: 'POST', body: letter });
  const publishLetter = (id) => api(`/wp-json/sml-letters/v1/letters/${id}/publish`, { method: 'POST', body: {} });
  async function saveSeo(id, seo) { try { return await api(`/wp-json/sml-letters-seo/v1/letter/${id}`, { method: 'POST', body: seo }); } catch (error) { logger('warn', 'story_seo_save_failed', { id, error: String(error && error.message || error) }); return null; } }
  return { configured, identity, uploadMedia, createLetter, updateLetter, publishLetter, saveSeo, authorId: Number(authorId) || null, base };
}

/* ---------- optional polish by the newsroom model: voice only, never new facts ---------- */
function createPolisher({ apiKey = '', model = 'gpt-5-mini', fetchImpl = fetch, logger = () => {} } = {}) {
  const enabled = !!apiKey;
  async function polish(draft, facts) {
    if (!enabled) return null;
    const rules = 'You are an experienced retail-trading newsletter writer with a sharp, confident, slightly provocative voice. Rewrite the article HTML below for flow and punch. HARD RULES: keep every number, price, percentage, level and ticker exactly as given and add none; keep the same H2 sections in the same order; keep the labelled speculation and the closing disclosure paragraph verbatim; no em dashes; no phrases like "in conclusion", "delve", "it is important to note", "as an AI"; no guarantees; do not mention automation, models or data desks beyond what the text already says; return only the HTML.';
    try {
      const res = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, store: false, reasoning: { effort: 'low' }, input: [{ role: 'system', content: rules }, { role: 'user', content: 'FACTS (the only numbers allowed):\n' + facts.join('\n') + '\n\nARTICLE HTML:\n' + draft }] }), signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error('openai_' + res.status);
      const j = await res.json();
      const text = (j.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('') || j.output_text || '';
      const html = String(text).replace(/^```html\s*|```\s*$/g, '').trim();
      if (html.length < draft.length * 0.5 || !/<h2>/.test(html) || /—/.test(html)) return null;
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
  perTick = 36, maxPerTick = 3, maxPerDay = 12, dedupeDays = 3, autopublish = false, windowFrom = 420, windowTo = 990, siteUrl = 'https://stockmarketloop.com', byline = 'Vaughn McNair', publication = 'Making Easy Money'
} = {}) {
  let state = null, busy = false, cursor = 0;
  async function load() { if (!state) { try { state = (store && await store.read()) || null; } catch (_) { state = null; } if (!state || !state.written) state = { written: {}, log: [], day: '', count: 0 }; } return state; }
  const save = async () => { if (store) { try { await store.write(state); } catch (error) { logger('warn', 'story_state_save_failed', { error: String(error && error.message || error) }); } } };
  const note = (text, extra = {}) => { state.log.push({ t: now(), text, ...extra }); if (state.log.length > 200) state.log.splice(0, state.log.length - 200); };

  async function bars1d(symbol) { const p = await timed(() => candles(symbol, '1D'), 10_000); return p && Array.isArray(p.bars) ? p.bars : []; }

  /* everything the engine scores for one symbol, from the Academy's services (each read raced against a timeout) */
  async function candidate(row) {
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
      darkPool ? timed(() => darkPool(symbol), 12_000) : null,
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
    const h = heat ? await timed(() => heat.heatFor(symbol, name), 25_000) : null;
    return { symbol, name, price, changePct: num(row.changePct), relVol: relVol != null ? r2(relVol) : null, adv, marketCap: co ? num(co.market_cap) : null, daily, gamma: gx && gx.available ? gx : null, short, tape, smc: m, earnings: earningsIn, sentiment: sentIn, institutional: inst && inst.available ? { bias: num(inst.bias), label: inst.label } : null, runner: run, direction: dir && dir.ok ? { bias: dir.bias, label: dir.label } : null, heat: h || null };
  }

  async function produce(story, c) {
    const draft = engine.draftArticle(story, c, { asOf: now(), author: byline, publication });
    let html = draft.html;
    if (polisher && polisher.enabled) { const polished = await polisher.polish(html, story.facts); if (polished) html = polished; }
    // the GIF: the last 40 daily candles, then the path (trigger, confirmation, target)
    let media = null, gifInfo = null;
    try {
      gifInfo = gifs.gif({ symbol: c.symbol, bars: c.daily.slice(-40), last: c.price, target: story.pt, stop: story.stop, levels: (c.gamma && c.gamma.callWall ? [{ label: 'Call wall', price: c.gamma.callWall.strike }] : []).concat(c.smc && c.smc.range ? [{ label: 'Range high', price: c.smc.range.hi }] : []), waypoints: story.path || [], count: 16, lean: story.lean, title: `$${c.symbol}: the path to $${story.pt}`, subtitle: `${engine.ANGLES[story.angle].label} scenario. Speculative, not advice.` });
      if (gifInfo && gifInfo.gif && publisher && publisher.configured()) media = await publisher.uploadMedia({ bytes: gifInfo.gif, filename: `${c.symbol.toLowerCase()}-path-to-${String(story.pt).replace('.', '-')}.gif`, contentType: 'image/gif', title: `$${c.symbol} path to $${story.pt}`, alt: `${c.symbol} price-action scenario: real candles, then the move to $${story.pt}`, caption: 'Speculative scenario built from the Academy data desk. Not advice.' });
    } catch (error) { logger('warn', 'story_gif_failed', { symbol: c.symbol, error: String(error && error.message || error) }); }
    if (media && media.url) html = `<figure class="sml-story-gif"><img src="${media.url}" alt="${c.symbol} price-action scenario to $${story.pt}" loading="eager"></figure>\n` + html;
    const letter = { title: draft.title, subtitle: draft.subtitle, tldr: draft.tldr, html, content: html, body: html, content_type: 'Analysis', tags: draft.tags, tickers: [c.symbol], cover_url: media ? media.url : undefined, status: 'draft', visibility: 'public', author_id: publisher ? publisher.authorId : undefined, slug: draft.slug };
    return { draft, html, letter, media, gifFrames: gifInfo ? gifInfo.frames : 0 };
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
      await publisher.saveSeo(created.id, { seo: { title: built.draft.title.slice(0, 65), description: built.draft.meta, slug: built.draft.slug, focusKeyword: `${c.symbol} ${engine.ANGLES[story.angle].keywords[0]}`, tags: built.draft.tags, schemaType: 'NewsArticle', sentiment: story.lean }, meta: { ogTitle: built.draft.title, ogDescription: built.draft.meta, socialImage: built.media ? built.media.url : '' } });
      if (autopublish && out.asByline) { await publisher.publishLetter(created.id); out.published = true; }
      const slugOf = created.raw && (created.raw.slug || (created.raw.letter && created.raw.letter.slug)) || built.draft.slug;
      out.url = created.raw && (created.raw.url || (created.raw.letter && created.raw.letter.url)) || `${siteUrl}/n/vaughn-mcnair-grandmaster-obi/${slugOf}/`;
    } catch (error) { out.error = String(error && error.message || error); logger('warn', 'story_letter_failed', { symbol: c.symbol, error: out.error, body: error && error.body ? JSON.stringify(error.body).slice(0, 300) : '' }); }
    return out;
  }

  async function tell(results) {
    if (!dm || !ownerIds.length || !results.length) return;
    const lines = ['📰 **Story desk** · ' + results.length + ' piece' + (results.length === 1 ? '' : 's')];
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
      if (state.count >= maxPerDay) return { skipped: 'daily_cap' };
      let rows = []; try { rows = (await universe()) || []; } catch (error) { logger('warn', 'story_universe_failed', { error: String(error && error.message || error) }); }
      rows = rows.filter((r) => r && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(String(r.symbol || '').toUpperCase()));
      if (!rows.length) return { skipped: 'no_universe' };
      const slice = []; for (let k = 0; k < Math.min(perTick, rows.length); k++) slice.push(rows[(cursor + k) % rows.length]); cursor = (cursor + perTick) % Math.max(1, rows.length);
      const cands = [];
      for (const r of slice) { const c = await candidate(r).catch((error) => { logger('warn', 'story_candidate_failed', { symbol: r.symbol, error: String(error && error.message || error) }); return null; }); if (c) cands.push(c); }
      const cutoff = t - dedupeDays * 86_400_000;
      for (const k of Object.keys(state.written)) if (state.written[k] < cutoff) delete state.written[k];
      const ranked = engine.rankStories(cands).filter((s) => !state.written[s.symbol + ':' + s.angle] && !Object.keys(state.written).some((k) => k.startsWith(s.symbol + ':') && state.written[k] > t - 86_400_000)).slice(0, Math.min(maxPerTick, maxPerDay - state.count));
      const results = [];
      for (const s of ranked) {
        if (s.rank < 60) continue; // a story needs a real setup; the desk would rather publish nothing
        const c = cands.find((x) => x.symbol === s.symbol);
        const built = await produce(s, c);
        const filed = await file(s, c, built);
        results.push({ ...filed, frames: built.gifFrames });
        state.written[s.symbol + ':' + s.angle] = t; state.count += 1;
        note(`${s.symbol} ${s.angle} PT $${s.pt} rank ${s.rank}: ${filed.error || (filed.published ? 'published' : 'draft')} ${filed.url || ''}`, { symbol: s.symbol, angle: s.angle, letterId: filed.letterId });
      }
      await save();
      await tell(results);
      return { scanned: slice.length, candidates: cands.length, ranked: ranked.length, filed: results.length, results };
    } catch (error) { logger('error', 'story_tick_failed', { error: String(error && error.message || error) }); return null; }
    finally { busy = false; }
  }
  /* one symbol on demand (the owner's "write about X"): the best angle, drafted and filed */
  async function write(symbol, { publish = false } = {}) {
    await load();
    const c = await candidate({ symbol: String(symbol).toUpperCase() });
    if (!c) return { ok: false, error: 'no_data' };
    const ranked = engine.rankStories([c]);
    if (!ranked.length) return { ok: false, error: 'no_angle', heat: c.heat };
    const built = await produce(ranked[0], c);
    const filed = await file(ranked[0], c, built);
    if (publish && filed.letterId && publisher && !filed.published) { try { await publisher.publishLetter(filed.letterId); filed.published = true; } catch (error) { filed.error = String(error && error.message || error); } }
    state.written[c.symbol + ':' + ranked[0].angle] = now(); await save(); await tell([filed]);
    return { ok: true, story: { ...ranked[0], facts: ranked[0].facts }, draft: { title: built.draft.title, meta: built.draft.meta, tags: built.draft.tags, wordCount: built.draft.wordCount }, filed };
  }
  async function status() { await load(); return { day: state.day, count: state.count, written: Object.keys(state.written).length, log: state.log.slice(-20).reverse() }; }
  return { tick, write, status, candidate, load };
}

module.exports = { createStoryDesk, createLettersPublisher, createPolisher };
