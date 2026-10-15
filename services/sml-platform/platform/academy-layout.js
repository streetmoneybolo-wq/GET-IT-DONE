'use strict';

/* Member layouts for the Academy Activity. Two scopes share one storage route:
 *   desk     — the Trading Desk browser window (academy-desk.js): panels only.
 *   activity — windows floating inside the Activity plus per-module customization (academy-customize.js).
 * Everything a member sends is reduced to the fields the page understands, with every value clamped, so a stored
 * layout can never carry markup, unknown keys or a size that breaks the page. */

const MODULE_ID = /^[a-z0-9-]{2,24}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const HEIGHTS = new Set([240, 360, 520, 720]);
const MAX_PANELS = 20;
const MAX_MODULES = 40;

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r4 = (v) => Math.round(v * 10000) / 10000;

function cleanPanels(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const p of list.slice(0, MAX_PANELS)) {
    if (!p || typeof p !== 'object') continue;
    const id = String(p.id || '').slice(0, 24);
    if (!MODULE_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      x: r4(clamp(num(p.x, 0), -0.9, 1)),
      y: r4(clamp(num(p.y, 0), 0, 1)),
      w: r4(clamp(num(p.w, 0.5), 0.05, 2)),
      h: r4(clamp(num(p.h, 0.5), 0.05, 2))
    });
  }
  return out;
}

function cleanModule(m) {
  if (!m || typeof m !== 'object') return null;
  const o = {};
  if (typeof m.accent === 'string' && HEX.test(m.accent)) o.accent = m.accent.toLowerCase();
  const size = Math.round(num(m.size, 100) / 5) * 5;
  if (size !== 100 && size >= 70 && size <= 150) o.size = size;
  const height = Math.round(num(m.height, 0));
  if (HEIGHTS.has(height)) o.height = height;
  if (m.width === 'full') o.width = 'full';
  if (m.hidden === true) o.hidden = true;
  const order = Math.round(num(m.order, -1));
  if (order >= 0 && order <= 99) o.order = order;
  return Object.keys(o).length ? o : null;
}

function cleanModules(map) {
  const out = {};
  if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
  for (const [id, m] of Object.entries(map).slice(0, MAX_MODULES)) {
    if (!MODULE_ID.test(id)) continue;
    const c = cleanModule(m);
    if (c) out[id] = c;
  }
  return out;
}

/* Returns the stored shape, or null when the body is not a layout at all. */
function cleanLayout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const hasPanels = Array.isArray(input.panels);
  const hasModules = !!input.modules && typeof input.modules === 'object' && !Array.isArray(input.modules);
  if (!hasPanels && !hasModules) return null;
  return { v: 2, panels: cleanPanels(input.panels), modules: cleanModules(input.modules) };
}

function cleanScope(value) { return String(value || '') === 'activity' ? 'activity' : 'desk'; }

/* The desk key is unchanged so layouts saved before the activity scope existed still load. */
function layoutKey(userId, scope) { return 'desk:layout:' + String(userId) + (cleanScope(scope) === 'activity' ? ':activity' : ''); }

module.exports = { cleanLayout, cleanScope, layoutKey, HEIGHTS: [...HEIGHTS] };
