'use strict';

/* US equity market clock in America/New_York: daylight-saving aware, NYSE full-day holidays and 1 pm early closes.
 * Pure functions of a timestamp, so they are trivially testable. Sessions: pre 04:00-09:30, regular 09:30-16:00 (13:00 on early
 * closes), post until 20:00 (17:00 on early closes), otherwise closed. */

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short'
});
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function etParts(ms) {
  const o = {};
  for (const p of ET.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = p.value;
  return { y: Number(o.year), m: Number(o.month), d: Number(o.day), hh: Number(o.hour), mm: Number(o.minute), ss: Number(o.second), dow: WEEKDAYS[o.weekday] };
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dowOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

function nthWeekday(y, m, weekday, n) { // n-th (1-based) weekday of month
  const first = dowOf(y, m, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}
function lastWeekday(y, m, weekday) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - ((dowOf(y, m, last) - weekday + 7) % 7);
}
function easterSunday(y) { // anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}
function shiftDay(y, m, d, delta) { const t = new Date(Date.UTC(y, m - 1, d + delta)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }

/* a fixed-date holiday: Saturday -> observed Friday, Sunday -> observed Monday (New Year's on a Saturday is NOT observed by NYSE) */
function observed(y, m, d, { newYear = false } = {}) {
  const w = dowOf(y, m, d);
  if (w === 6) return newYear ? null : shiftDay(y, m, d, -1);
  if (w === 0) return shiftDay(y, m, d, 1);
  return { y, m, d };
}

const cache = new Map();
function yearTable(y) {
  if (cache.has(y)) return cache.get(y);
  const hol = new Map(), early = new Set();
  const add = (o, name) => { if (o) hol.set(ymd(o.y, o.m, o.d), name); };
  add(observed(y, 1, 1, { newYear: true }), "New Year's Day");
  add({ y, m: 1, d: nthWeekday(y, 1, 1, 3) }, 'Martin Luther King Jr. Day');
  add({ y, m: 2, d: nthWeekday(y, 2, 1, 3) }, "Washington's Birthday");
  const e = easterSunday(y); add(shiftDay(y, e.m, e.d, -2), 'Good Friday');
  add({ y, m: 5, d: lastWeekday(y, 5, 1) }, 'Memorial Day');
  if (y >= 2022) add(observed(y, 6, 19), 'Juneteenth');
  add(observed(y, 7, 4), 'Independence Day');
  add({ y, m: 9, d: nthWeekday(y, 9, 1, 1) }, 'Labor Day');
  const tg = nthWeekday(y, 11, 4, 4); add({ y, m: 11, d: tg }, 'Thanksgiving Day');
  add(observed(y, 12, 25), 'Christmas Day');
  early.add(ymd(y, 11, tg + 1));
  for (const [m, d] of [[7, 3], [12, 24]]) {
    const k = ymd(y, m, d), w = dowOf(y, m, d);
    if (w >= 1 && w <= 5 && !hol.has(k)) early.add(k);
  }
  const t = { hol, early }; cache.set(y, t); return t;
}

function dayInfo(y, m, d) {
  const key = ymd(y, m, d), w = dowOf(y, m, d), t = yearTable(y);
  if (w === 0 || w === 6) return { key, tradingDay: false, reason: 'weekend' };
  if (t.hol.has(key)) return { key, tradingDay: false, reason: t.hol.get(key) };
  return { key, tradingDay: true, early: t.early.has(key) };
}

/* -> { session: 'pre'|'regular'|'post'|'closed', tradingDay, early, reason, et: 'YYYY-MM-DD HH:MM', open, nextOpenMs } */
function marketState(ms = Date.now()) {
  const p = etParts(ms), info = dayInfo(p.y, p.m, p.d), minutes = p.hh * 60 + p.mm;
  let session = 'closed';
  if (info.tradingDay) {
    const closeMin = info.early ? 13 * 60 : 16 * 60, postEnd = info.early ? 17 * 60 : 20 * 60;
    if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) session = 'pre';
    else if (minutes >= 9 * 60 + 30 && minutes < closeMin) session = 'regular';
    else if (minutes >= closeMin && minutes < postEnd) session = 'post';
  }
  return { session, open: session === 'regular', tradingDay: info.tradingDay, early: !!info.early, reason: info.reason || '', et: `${ymd(p.y, p.m, p.d)} ${pad(p.hh)}:${pad(p.mm)}` };
}

function isMarketOpen(ms = Date.now()) { return marketState(ms).open; }
/* regular session OR extended hours: is a price print plausible right now */
function isTradingHours(ms = Date.now()) { return marketState(ms).session !== 'closed'; }

/* Session label of a bar open time, for tagging candles */
function sessionOf(ms) { return marketState(ms).session; }

module.exports = { marketState, isMarketOpen, isTradingHours, sessionOf, etParts, yearTable, dayInfo };
