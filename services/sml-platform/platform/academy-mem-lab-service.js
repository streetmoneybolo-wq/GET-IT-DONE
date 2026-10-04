'use strict';
/* MEM LAB service: pulls candles from registered data sources, runs the optimizer, and keeps a champion/challenger record.
   Promotion is gated twice (the optimizer's bootstrap gate, then a confirmation run on a different seed) and never automatic unless autoPromote is on. */
const fs = require('fs');
const path = require('path');
const lab = require('./academy-mem-lab.js');

/* A source is { name, load() -> [{symbol, bars:[{t,o,h,l,c,v}]}] }. Anything with a licence or credential is the operator's to register. */
function csvDirSource(dir) {
  return {
    name: 'csv:' + dir,
    async load() {
      const out = [];
      for (const f of fs.readdirSync(dir)) {
        if (!/\.csv$/i.test(f)) continue;
        const rows = fs.readFileSync(path.join(dir, f), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
        const bars = rows.map((r) => ({ t: Date.parse(r[0]) || +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] || 0 }));
        out.push({ symbol: f.replace(/\.csv$/i, '').toUpperCase(), bars });
      }
      return out;
    },
  };
}

function memoryStore() {
  const s = { champion: null, pending: null, runs: [] };
  return { async read() { return JSON.parse(JSON.stringify(s)); }, async write(n) { Object.assign(s, JSON.parse(JSON.stringify(n))); } };
}
function fileStore(file) {
  return {
    async read() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { champion: null, pending: null, runs: [] }; } },
    async write(n) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(n, null, 1)); },
  };
}

function createMemLab({ sources = [], store = memoryStore(), mode = 'swing', tf = '1D', budget = 48, autoPromote = false, now = () => new Date().toISOString(), log = () => {}, minTestTrades = 150 } = {}) {
  async function gather() {
    const merged = new Map(), errors = [];
    for (const src of sources) {
      try {
        for (const item of await src.load()) {
          const bars = lab.cleanBars(item.bars);
          const prev = merged.get(item.symbol);
          if (!prev || bars.length > prev.bars.length) merged.set(item.symbol, { symbol: item.symbol, bars, source: src.name });
        }
      } catch (e) { errors.push(src.name + ': ' + (e && e.message)); }
    }
    return { dataset: [...merged.values()].filter((d) => d.bars.length >= 250), errors };
  }

  async function cycle({ seed = Math.floor(Date.now() / 864e5) } = {}) {
    const st = await store.read();
    const { dataset, errors } = await gather();
    const run = { at: now(), seed, symbols: dataset.length, errors, outcome: 'skipped' };
    if (dataset.length < 5) { run.reason = 'need at least 5 symbols with 250+ candles'; st.runs = [run, ...st.runs].slice(0, 50); await store.write(st); return run; }
    const champion = st.champion ? st.champion.cfg : null;
    const base = { dataset, mode, tf, champion, budget, minTestTrades };
    const r = lab.optimize({ ...base, seed });
    run.gate = r.gate; run.ok = r.ok;
    if (r.ok && r.gate.pass) {
      const confirm = lab.optimize({ ...base, seed: seed + 1009 });
      if (confirm.ok && confirm.gate.pass) {
        const rec = { cfg: r.winner.cfg, found: now(), seed, test: r.winner.test, diff: r.gate.diff, confirmed: confirm.gate.diff };
        if (autoPromote) { st.champion = rec; st.pending = null; run.outcome = 'promoted'; } else { st.pending = rec; run.outcome = 'pending-approval'; }
      } else run.outcome = 'failed-confirmation';
    } else run.outcome = r.ok ? 'no-improvement' : 'not-run';
    st.runs = [run, ...st.runs].slice(0, 50);
    await store.write(st); log('mem-lab', run.outcome);
    return run;
  }
  async function approve() { const st = await store.read(); if (!st.pending) return null; st.champion = { ...st.pending, approved: now() }; st.pending = null; await store.write(st); return st.champion; }
  async function report() { const st = await store.read(); return { champion: st.champion, pending: st.pending, lastRuns: st.runs.slice(0, 10) }; }
  function schedule(everyMs = 864e5) { const t = setInterval(() => cycle().catch((e) => log('mem-lab-error', e && e.message)), everyMs); if (t.unref) t.unref(); return () => clearInterval(t); }
  return { cycle, approve, report, schedule, gather };
}

module.exports = { createMemLab, csvDirSource, memoryStore, fileStore };
