/* Black-Scholes-Merton pricing for the Academy options calculator (European exercise, continuous dividend yield).
   Educational: American-style equity options can be worth slightly more than these values. Works in node (module.exports) and inline in the page (window.SmlOptionsCalc). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmlOptionsCalc = api;
})(typeof window !== 'undefined' ? window : this, function () {
  const SQRT2PI = Math.sqrt(2 * Math.PI);
  const pdf = (x) => Math.exp(-0.5 * x * x) / SQRT2PI;
  // Abramowitz & Stegun 7.1.26 error function, |error| < 1.5e-7
  function erf(x) {
    const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return s * y;
  }
  const cdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /** inputs: type 'call'|'put', S spot, K strike, T years, r rate (0.043), q dividend yield, sigma volatility (0.25). Returns price and Greeks (theta per day, vega/rho per 1 point). */
  function price(type, S, K, T, r, q, sigma) {
    const call = String(type).toLowerCase().startsWith('c');
    if (![S, K, T, r, q, sigma].every(finite) || S <= 0 || K <= 0) return null;
    const intrinsic = call ? Math.max(0, S - K) : Math.max(0, K - S);
    if (T <= 0 || sigma <= 0) return { price: intrinsic, intrinsic, extrinsic: 0, delta: call ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0, rho: 0, d1: null, d2: null, probITM: S === K ? 0.5 : (call ? (S > K ? 1 : 0) : (S < K ? 1 : 0)), expired: true };
    const sq = Math.sqrt(T), d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sq), d2 = d1 - sigma * sq;
    const eq = Math.exp(-q * T), er = Math.exp(-r * T);
    const p = call ? S * eq * cdf(d1) - K * er * cdf(d2) : K * er * cdf(-d2) - S * eq * cdf(-d1);
    const decay = -(S * eq * pdf(d1) * sigma) / (2 * sq);
    const theta = (call ? decay - r * K * er * cdf(d2) + q * S * eq * cdf(d1) : decay + r * K * er * cdf(-d2) - q * S * eq * cdf(-d1)) / 365;
    return {
      price: p, intrinsic, extrinsic: Math.max(0, p - intrinsic),
      delta: call ? eq * cdf(d1) : eq * (cdf(d1) - 1),
      gamma: eq * pdf(d1) / (S * sigma * sq),
      theta,
      vega: S * eq * pdf(d1) * sq / 100,
      rho: (call ? K * T * er * cdf(d2) : -K * T * er * cdf(-d2)) / 100,
      d1, d2, probITM: call ? cdf(d2) : cdf(-d2), expired: false
    };
  }

  /** Implied volatility that reproduces a market price (bisection). Returns null when the price is outside what any volatility can produce. */
  function impliedVol(type, S, K, T, r, q, marketPrice) {
    if (![S, K, T, r, q, marketPrice].every(finite) || T <= 0 || marketPrice <= 0) return null;
    let lo = 0.005, hi = 6;
    const f = (s) => price(type, S, K, T, r, q, s).price - marketPrice;
    if (f(lo) > 0 || f(hi) < 0) return null;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
    return (lo + hi) / 2;
  }

  /** Long-position scenarios: value today (same volatility) and profit/loss held to expiry, for spot moves. */
  function scenarios(type, S, K, T, r, q, sigma, premium, contracts, moves) {
    const call = String(type).toLowerCase().startsWith('c'), mult = 100 * (contracts || 1);
    return (moves || [-0.1, -0.05, -0.025, 0, 0.025, 0.05, 0.1]).map((m) => {
      const s2 = S * (1 + m), now = price(type, s2, K, T, r, q, sigma), atExp = call ? Math.max(0, s2 - K) : Math.max(0, K - s2);
      return { move: m, spot: s2, valueNow: now ? now.price : null, plNow: now ? (now.price - premium) * mult : null, plExpiry: (atExp - premium) * mult };
    });
  }

  const breakeven = (type, K, premium) => (String(type).toLowerCase().startsWith('c') ? K + premium : K - premium);
  return { price, impliedVol, scenarios, breakeven, cdf, pdf };
});
