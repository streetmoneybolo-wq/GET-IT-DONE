/* Academy: the Market Direction panel, right under the chart (any signed-in Academy session). */
(() => {
  if (window.__smlAcademyDirection) return;
  window.__smlAcademyDirection = 1;
  const ask = (mode, token) => fetch('/academy-activity/direction?mode=' + mode, { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
  async function load(mode) {
    let token = window.smlAcademySessionToken;
    if (!token) return { ok: false, message: 'Sign in to the Academy to see the market read.' };
    let res = await ask(mode, token);
    if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { token = await window.smlAcademyReauth(); if (token) res = await ask(mode, token); }
    return res.json();
  }
  let root = null;
  (function mount() {
    const host = document.getElementById('academy-below');
    if (!host || !window.SmlMarketDirectionUI) { setTimeout(mount, 300); return; }
    const title = host.querySelector('.below-title');
    root = window.SmlMarketDirectionUI.mount({ host, id: 'academy-direction', before: title ? title.nextSibling : host.firstChild, load });
  })();
  window.addEventListener('sml-academy-session', () => { if (root && root.smdReload) root.smdReload(); });
})();
