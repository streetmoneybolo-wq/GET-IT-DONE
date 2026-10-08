/* Pop-out window sign-in. Runs first, and only in a window opened with ?popout=<module>.
 * The one-time ticket arrives in the #fragment (never sent to the server in a URL); it is read and wiped from the
 * address bar at once, then traded for a session. Later renewals use a renewal key kept in this browser only, and
 * every renewal re-checks the member's access, so a window closes itself out when a membership ends. */
(() => {
  const params = new URLSearchParams(location.search);
  const mod = params.get('popout');
  if (!mod || !/^[a-z0-9-]{2,24}$/.test(mod)) return;
  window.smlAcademyPopout = mod;
  document.documentElement.classList.add('sml-popout');
  const KEY = 'sml-academy-popout-v1';
  let ticket = '';
  const match = /(?:^#|&)pt=([A-Za-z0-9_-]{20,90})/.exec(location.hash || '');
  if (match) {
    ticket = match[1];
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* keep going */ }
  }
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* private window: this window still works until it closes */ } };
  let memoryRenew = '';
  const fail = (code) => Object.assign(new Error(code), { academyCode: code });
  window.smlAcademyPopoutSignIn = async () => {
    let response;
    if (ticket) {
      const t = ticket; ticket = '';
      response = await fetch('/academy-activity/popout/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: t }), cache: 'no-store' });
    } else {
      const saved = read();
      const renew = memoryRenew || (saved && saved.renew) || '';
      if (!renew) throw fail('popout_expired');
      response = await fetch('/academy-activity/popout/renew', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ renew }), cache: 'no-store' });
    }
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok || !payload.ok || !payload.sessionToken) throw fail(payload.error === 'access_ended' ? 'access_ended' : (response.status >= 500 ? 'temporary_unavailable' : 'popout_expired'));
    memoryRenew = payload.renew || memoryRenew;
    write({ renew: memoryRenew, at: Date.now() });
    window.smlAcademyTier = payload.tier || 'member';
    return { sessionToken: payload.sessionToken, displayName: String(payload.displayName || '') };
  };
})();
