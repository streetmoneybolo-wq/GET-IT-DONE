/* One options contract, written the ways the brokers want it: the standard OCC symbol (SPY251219C00600000), a plain-English line (SPY Dec 19 2025 600 Call), and the links
   that open each broker as close to that contract as the broker allows.
   No broker publishes a link to a single contract, so none can be opened exactly: moomoo and Webull open the app on the stock, Robinhood opens the stock's options chain,
   eToro opens the stock's page. The member pastes the OCC symbol (copied for them) into the broker's search to land on the contract. Quote pages only, never an order ticket.
   Works in node (module.exports) and in the page (window.SmlOptionContract). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmlOptionContract = api;
})(typeof window !== 'undefined' ? window : this, function () {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LAUNCH = 'https://sml-platform-api.onrender.com/academy-activity/open';
  const cleanSymbol = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 6);

  /* { symbol, expiry: 'YYYY-MM-DD', strike: number, side: 'call' | 'put' } -> a normalized contract, or null if any part is unusable */
  function contract({ symbol, expiry, strike, side } = {}) {
    const sym = cleanSymbol(symbol), m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(expiry || '')), k = Number(strike);
    const s = String(side || '').toLowerCase().startsWith('p') ? 'put' : String(side || '').toLowerCase().startsWith('c') ? 'call' : '';
    if (!sym || !m || !(k > 0) || !s) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || k * 1000 > 99999999) return null;
    return { symbol: sym, year: y, month: mo, day: d, strike: k, side: s };
  }
  const pad = (n, w) => String(n).padStart(w, '0');
  const occSymbol = (c) => c.symbol + pad(c.year % 100, 2) + pad(c.month, 2) + pad(c.day, 2) + (c.side === 'put' ? 'P' : 'C') + pad(Math.round(c.strike * 1000), 8);
  const strikeText = (k) => (Number.isInteger(k) ? String(k) : String(+k.toFixed(3)));
  const describe = (c) => c.symbol + ' ' + MONTHS[c.month - 1] + ' ' + c.day + ' ' + c.year + ' ' + strikeText(c.strike) + ' ' + (c.side === 'put' ? 'Put' : 'Call');

  /* broker -> { label, url, note, exact } for one contract. exact is always false: see the header. */
  function links(c) {
    if (!c) return [];
    const sym = encodeURIComponent(c.symbol);
    return [
      { key: 'moomoo', label: 'moomoo', url: LAUNCH + '?b=moomoo&symbol=' + sym, note: 'Opens moomoo on ' + c.symbol + '. Search for the contract symbol to jump to it.', exact: false },
      { key: 'webull', label: 'Webull', url: LAUNCH + '?b=webull&symbol=' + sym, note: 'Opens Webull on ' + c.symbol + '. Search for the contract symbol to jump to it.', exact: false },
      { key: 'robinhood', label: 'Robinhood', url: 'https://robinhood.com/options/chains/' + sym, note: 'Opens the ' + c.symbol + ' options chain on Robinhood.', exact: false },
      { key: 'etoro', label: 'eToro', url: 'https://www.etoro.com/markets/' + encodeURIComponent(c.symbol.toLowerCase()), note: 'Opens ' + c.symbol + ' on eToro. eToro lists the stock, not this contract.', exact: false }
    ];
  }
  return { contract, occSymbol, describe, links, LAUNCH };
});
