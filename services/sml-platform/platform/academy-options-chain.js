/* Options chain normalizer shared by the Academy Activity renderer (browser) and
   tests (node). It turns whatever the data bridge returns into paired rows
   { expiry, strike, call, put } and never invents values.

   Shapes it understands:
   - the site's moomoo chain (verified live): { underlying, expirations, contracts:
     [{ strike, type:'call'|'put', expiration, bid, ask, last, volume, open_interest,
        iv, delta, gamma, theta, vega }] }
   - Massive / Polygon v3 snapshot: { results: [{ details:{ strike_price,
     expiration_date, contract_type }, last_quote:{ bid, ask }, day:{ volume },
     open_interest, implied_volatility, greeks:{...}, underlying_asset:{ price } }] }
   - paired rows: [{ strike, expiration, call:{ bid, ask, ... }, put:{ ... } }] or
     flat callBid / putAsk style keys. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmlOptionsChain = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var STRIKE = ['strike', 'strikePrice', 'strike_price', 'exercisePrice'];
  var EXPIRY = ['expiration', 'expirationDate', 'expiration_date', 'expiry', 'expiryDate', 'expiry_date', 'expDate', 'exp_date', 'date'];
  var KIND = ['contractType', 'contract_type', 'optionType', 'option_type', 'right', 'side', 'type', 'putCall', 'put_call'];
  var FIELDS = {
    bid: ['bid', 'bidPrice', 'bid_price'], ask: ['ask', 'askPrice', 'ask_price'], last: ['last', 'lastPrice', 'last_price', 'price', 'mark'],
    volume: ['volume', 'vol', 'dayVolume'], oi: ['openInterest', 'open_interest', 'oi'], iv: ['impliedVolatility', 'implied_volatility', 'iv'],
    delta: ['delta'], gamma: ['gamma'], theta: ['theta'], vega: ['vega']
  };
  function n(v) { if (v == null || v === '') return null; var x = Number(v); return Number.isFinite(x) ? x : null; }
  function pick(o, keys) { if (!o || typeof o !== 'object') return null; for (var i = 0; i < keys.length; i++) { var v = o[keys[i]]; if (v !== undefined && v !== null && v !== '') return v; } return null; }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  /* Reads one side. `prefix` ('call'/'put') enables callBid / call_bid / bidCall
     keys; the bare keys are always tried too, so a type-tagged contract works. */
  function side(o, prefix) {
    if (!isObj(o)) return null;
    var out = {}, any = false;
    var srcs = [o, o.last_quote, o.quote, o.day, o.greeks, o.details].filter(isObj);
    Object.keys(FIELDS).forEach(function (f) {
      var keys = FIELDS[f].slice();
      if (prefix) FIELDS[f].forEach(function (k) { keys.push(prefix + cap(k), prefix + '_' + k, k + cap(prefix), k + '_' + prefix); });
      var v = null;
      for (var i = 0; i < srcs.length && v == null; i++) v = n(pick(srcs[i], keys));
      out[f] = v; if (v != null) any = true;
    });
    return any ? out : null;
  }
  function kindOf(o) {
    var k = String(pick(o, KIND) || (isObj(o.details) ? pick(o.details, KIND) : '') || '').toLowerCase();
    if (k[0] === 'c') return 'call';
    if (k[0] === 'p') return 'put';
    return '';
  }
  function expiryOf(o) {
    var v = pick(o, EXPIRY) || (isObj(o.details) ? pick(o.details, EXPIRY) : null);
    if (v == null) return 'Unknown';
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    var t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : s;
  }
  function strikeOf(o) { var v = n(pick(o, STRIKE)); if (v == null && isObj(o.details)) v = n(pick(o.details, STRIKE)); return v; }

  function normalize(data) {
    var rows = new Map(), seen = new Set();
    function add(o, hint) {
      if (!isObj(o)) return;
      var strike = strikeOf(o); if (strike == null) return;
      var exp = expiryOf(o), key = exp + '|' + strike;
      var row = rows.get(key) || { expiry: exp, strike: strike, call: null, put: null };
      var kind = kindOf(o) || hint || '';
      var nestedCall = isObj(o.call) ? o.call : (isObj(o.calls) ? o.calls : null);
      var nestedPut = isObj(o.put) ? o.put : (isObj(o.puts) ? o.puts : null);
      if (nestedCall) row.call = side(nestedCall, '') || row.call;
      if (nestedPut) row.put = side(nestedPut, '') || row.put;
      if (!nestedCall && !nestedPut) {
        if (kind === 'call') row.call = side(o, '') || row.call || {};
        else if (kind === 'put') row.put = side(o, '') || row.put || {};
        else {
          var c = side(o, 'call'), p = side(o, 'put');
          if (c) row.call = c;
          if (p) row.put = p;
        }
      }
      if (row.call || row.put) rows.set(key, row);
    }
    function walk(node, hint) {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) { node.forEach(function (i) { walk(i, hint); }); return; }
      add(node, hint);
      Object.keys(node).forEach(function (k) {
        var l = k.toLowerCase(), next = l.indexOf('call') >= 0 ? 'call' : (l.indexOf('put') >= 0 ? 'put' : hint);
        if (k === 'details' || k === 'greeks' || k === 'last_quote' || k === 'day' || k === 'underlying_asset') return;
        walk(node[k], next);
      });
    }
    walk(data, '');
    return Array.from(rows.values()).sort(function (a, b) { return a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.strike - b.strike; });
  }

  function findSpot(data) {
    var d = data && data.data && isObj(data.data) && !Array.isArray(data.data) ? data.data : data;
    var cands = [];
    if (isObj(d)) {
      cands.push(d.underlyingPrice, d.underlying_price, d.spotPrice, d.spot, d.price, d.underlying);
      if (isObj(d.underlying)) cands.push(d.underlying.price, d.underlying.last);
      if (isObj(d.quote)) cands.push(d.quote.price, d.quote.last);
      if (Array.isArray(d.results) && isObj(d.results[0]) && isObj(d.results[0].underlying_asset)) cands.push(d.results[0].underlying_asset.price);
    }
    for (var i = 0; i < cands.length; i++) { var v = n(cands[i]); if (v != null && v > 0) return v; }
    return null;
  }

  /* Expirations the feed advertises (so the picker can offer dates whose
     contracts have not been fetched yet), merged with the ones in the rows. */
  function expirations(data, rows) {
    var out = new Set();
    var d = data && data.data && isObj(data.data) ? data.data : data;
    var list = isObj(d) ? (d.expirations || d.expirationDates || d.expiration_dates) : null;
    if (Array.isArray(list)) list.forEach(function (e) { var v = isObj(e) ? pick(e, EXPIRY) : e; if (v) out.add(expiryOf({ expiration: v })); });
    (rows || []).forEach(function (r) { if (r && r.expiry && r.expiry !== 'Unknown') out.add(r.expiry); });
    return Array.from(out).sort();
  }

  return { normalize: normalize, findSpot: findSpot, expirations: expirations };
});
