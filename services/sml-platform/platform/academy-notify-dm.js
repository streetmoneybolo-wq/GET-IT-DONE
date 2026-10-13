'use strict';

/* Discord DMs for the things a member wants to hear about away from the Academy: a buy signal from the radar (owner),
 * their own alert hitting its target, and a new target the engine set on their own alert. Web push cannot reach anyone
 * inside the Discord app (no service worker there), a DM from the Academy bot can.
 *
 * recipientsFor(kind, payload) -> [discordUserId]. Each recipient gets at most maxPerHour DMs an hour (the rest are
 * dropped and counted), and a DM never throws. The DM client is dispute-notifier's createDiscordDmClient (allowed_mentions
 * none, so nothing pings). */

const px = (v) => (Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(4));
const ID_RE = /^\d{15,25}$/;

function signalText(sig) {
  const why = (sig.why || []).slice(0, 3).map((w) => '• ' + w).join('\n');
  return `🟢 **BUY SIGNAL ${sig.symbol}** · ${sig.label || sig.style} · grade ${sig.grade} (${sig.score})\n`
    + `Entry $${px(sig.entry)} → PT $${px(sig.target)} (+${sig.pct}%) · stop $${px(sig.stop)}`
    + (sig.relVolume ? ` · volume ${Number(sig.relVolume).toFixed(1)}x` : '') + '\n' + (why ? why + '\n' : '')
    + 'Open the Academy → SIGNALS → ⚡ Click to Alert to post it. Educational, not financial advice.';
}
/* one DM for everything a sweep found: the symbols on one line each, biggest grade first, capped so Discord's 2000 characters hold */
function signalsText(list) {
  const sigs = (Array.isArray(list) ? list : []).filter((s) => s && s.symbol).sort((a, b) => (b.score || 0) - (a.score || 0));
  if (sigs.length === 1) return signalText(sigs[0]);
  const lines = sigs.slice(0, 12).map((s) => `• **${s.symbol}** ${s.label || s.style} · ${s.grade} (${s.score}) · entry $${px(s.entry)} → PT $${px(s.target)} (+${s.pct}%) · stop $${px(s.stop)}${s.relVolume ? ` · vol ${Number(s.relVolume).toFixed(1)}x` : ''}`);
  return `🟢 **${sigs.length} BUY SIGNALS**\n${lines.join('\n')}${sigs.length > 12 ? `\n…and ${sigs.length - 12} more in the Academy` : ''}\nOpen the Academy → SIGNALS → ⚡ Click to Alert. Educational, not financial advice.`;
}
function targetHitText(u) {
  return `🎯 **${u.symbol} hit your price target $${px(u.target)}** (entry $${px(u.entry)}${Number(u.price) > 0 ? `, high $${px(u.price)}` : ''}).\n`
    + (Number(u.suggested) > 0 ? `MEM ALGO suggests a new target of $${px(u.suggested)}. ` : '') + 'Open the Academy to post a new price target.';
}
function newTargetText(u) {
  const up = u.side !== 'short';
  return `🎯 **${u.symbol} new price target $${px(u.target)}** (${up ? '+' : '−'}${u.pct}%) · PT ${u.n} $${px(u.previous)} smashed.`
    + (u.stopRange ? ` Stop ${up ? 'raised to below' : 'lowered to above'} $${px(u.stopRange.low)}–$${px(u.stopRange.high)}.` : '')
    + (u.why && u.why[0] ? `\n• ${u.why.slice(0, 2).join('\n• ')}` : '') + '\nOpen the Academy to post it to Discord.';
}

function createDmNotifier({ dm = null, recipientsFor = () => [], logger = () => {}, now = Date.now, maxPerHour = 30 } = {}) {
  const sent = new Map(); // recipient -> [times within the hour]
  function allowed(id) {
    const t = now(), list = (sent.get(id) || []).filter((x) => t - x < 3_600_000);
    if (list.length >= maxPerHour) { sent.set(id, list); return false; }
    list.push(t); sent.set(id, list); return true;
  }
  async function deliver(kind, payload, text) {
    const out = { sent: [], skipped: [] };
    if (!dm || typeof dm.send !== 'function') return out;
    let ids = [];
    try { ids = [...new Set((await recipientsFor(kind, payload)) || [])].map(String).filter((id) => ID_RE.test(id)); } catch (error) { logger('warn', 'academy_dm_recipients_failed', { kind, error: String(error && error.message || error) }); return out; }
    for (const id of ids) {
      if (!allowed(id)) { out.skipped.push(id); continue; }
      try {
        const res = await dm.send(id, text);
        if (res && res.ok) out.sent.push(id); else { out.skipped.push(id); logger('warn', 'academy_dm_failed', { kind, recipient: id, code: res && res.code }); }
      } catch (error) { out.skipped.push(id); logger('warn', 'academy_dm_failed', { kind, recipient: id, error: String(error && error.message || error) }); }
    }
    if (out.sent.length || out.skipped.length) logger('info', 'academy_dm', { kind, symbol: payload && payload.symbol, sent: out.sent.length, skipped: out.skipped.length });
    return out;
  }
  return {
    signal: (sig) => deliver('signal', sig, signalText(sig)),
    signals: (list) => { const sigs = (Array.isArray(list) ? list : []).filter((s) => s && s.symbol); return sigs.length ? deliver('signal', { symbol: sigs.map((s) => s.symbol).join(',') }, signalsText(sigs)) : Promise.resolve({ sent: [], skipped: [] }); },
    targetHit: (u) => deliver('target_hit', u, targetHitText(u)),
    newTarget: (u) => deliver('new_target', u, newTargetText(u))
  };
}

module.exports = { createDmNotifier, signalText, signalsText, targetHitText, newTargetText };
