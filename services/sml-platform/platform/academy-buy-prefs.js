'use strict';

/* Buy-button preferences for the Academy. A member picks, in Settings (the button beside Customize), whether every Buy spot
 * on the page (the chart toolbar, the options chain, the contract mini chart, the hedge ideas) shows ONE button for their own
 * broker or one button per broker they use. Pure logic here (normalize, which brokers to show, the links), so node can test it;
 * the page keeps the prefs in localStorage and repaints on 'sml-buy-prefs'. Quote pages only: nothing is ever traded from the
 * Academy, every order is reviewed and placed by the member inside their broker. */

const LAUNCH = 'https://sml-platform-api.onrender.com/academy-activity/open';
/* key -> display name, short tag for tight spots, and the colour the buttons already use elsewhere on the page */
const BROKERS = Object.freeze([
  Object.freeze({ key: 'moomoo', name: 'moomoo', tag: 'MM', color: '#ffb877', bg: '#2e1707', border: '#ff7a1a' }),
  Object.freeze({ key: 'webull', name: 'Webull', tag: 'WB', color: '#8fc8ff', bg: '#0d2238', border: '#1f8fff' }),
  Object.freeze({ key: 'robinhood', name: 'Robinhood', tag: 'RH', color: '#9ff0b0', bg: '#0f2a17', border: '#2fbf4f' }),
  Object.freeze({ key: 'etoro', name: 'eToro', tag: 'eT', color: '#8ff0a6', bg: '#0c2a14', border: '#13c636' })
]);
const KEYS = BROKERS.map((b) => b.key);
const DEFAULTS = Object.freeze({ mode: 'each', platforms: KEYS.slice(), primary: 'moomoo', sell: true });
const STORAGE_KEY = 'sml-buy-prefs-v1';

const brokerOf = (key) => BROKERS.find((b) => b.key === key) || null;

/* Any saved or posted value -> a complete, valid preference object. An empty platform list falls back to every broker
   (a member who unticks everything still gets a Buy button) and the primary is always one of the chosen platforms. */
function normalize(input) {
  const o = input && typeof input === 'object' ? input : {};
  const mode = o.mode === 'one' ? 'one' : 'each';
  let platforms = Array.isArray(o.platforms) ? KEYS.filter((k) => o.platforms.includes(k)) : KEYS.slice();
  if (!platforms.length) platforms = KEYS.slice();
  const primary = platforms.includes(o.primary) ? o.primary : platforms[0];
  return { mode, platforms, primary, sell: o.sell !== false };
}

/* The brokers a Buy spot shows for these prefs: the primary alone in "one" mode, the chosen platforms otherwise. */
function brokersFor(prefs) {
  const p = normalize(prefs);
  return (p.mode === 'one' ? [p.primary] : p.platforms).map(brokerOf).filter(Boolean);
}

/* Where a button sends the member. A stock opens the broker on that stock. A contract opens the broker as close as it allows
   (moomoo and Webull on the stock through the launcher, Robinhood on the stock's chain, eToro on the stock) and the caller copies
   the OCC symbol so pasting it into the broker's search lands on the contract. `side` only changes the words: the broker page is
   the same, and the order (buy to open, sell to close, sell to open) is the member's to place there. */
function linkFor(key, { symbol, contract = null, side = 'buy' } = {}) {
  const b = brokerOf(key); if (!b) return null;
  const sym = String((contract && contract.symbol) || symbol || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return null;
  const enc = encodeURIComponent(sym);
  let url, note;
  if (key === 'moomoo') { url = LAUNCH + '?b=moomoo&symbol=' + enc; note = 'Opens moomoo on ' + sym; }
  else if (key === 'webull') { url = LAUNCH + '?b=webull&symbol=' + enc; note = 'Opens Webull on ' + sym; }
  else if (key === 'robinhood') { url = contract ? 'https://robinhood.com/options/chains/' + enc : 'https://robinhood.com/stocks/' + enc; note = contract ? 'Opens the ' + sym + ' options chain on Robinhood' : 'Opens ' + sym + ' on Robinhood'; }
  else { url = 'https://www.etoro.com/markets/' + encodeURIComponent(sym.toLowerCase()); note = 'Opens ' + sym + ' on eToro' + (contract ? ' (eToro lists the stock, not this contract)' : ''); }
  const action = side === 'sell' ? (contract ? 'sell to close or sell to open' : 'sell') : (contract ? 'buy to open' : 'buy');
  return { key, name: b.name, url, note: note + '. Place the ' + action + ' order there yourself' + (contract ? '; the contract symbol is copied for its search.' : '.'), symbol: sym, side, exact: false };
}

module.exports = { BROKERS, KEYS, DEFAULTS, STORAGE_KEY, LAUNCH, normalize, brokersFor, linkFor, brokerOf };
