/*!
 * SML Create Channel — /create-channel/ page, rebuilt from the "Create Loop
 * Channel" design as REAL markup on REAL endpoints (no prototype runtime):
 *   · NO name/DOB/phone/address here (2026-08-18 decision): creation collects only
 *     a verified email, channel name, handle, about, links and agreements
 *   · channel name → handle auto-slug using THIS site's handle rules
 *     (letters, numbers, underscores, periods — the channel API rejects dashes)
 *   · live handle availability  → sml-channel/v1/handle-availability
 *   · email → 6-digit code by email → verify   → sml-create-channel/v1
 *   · tagline · about (280) · avatar/banner upload → sml-create-channel/v1/media
 *   · links · agreements · submit disabled until valid ("Still needed: …")
 *   · sticky live-preview rail · success card → /go-live/
 * All handlers are bound in JS (no inline onclick — CSP-safe).
 */
(function () {
  'use strict';
  if (window.__smlCreateChannelBooted) return;
  window.__smlCreateChannelBooted = true;

  var loader = document.getElementById('sml-cc-js');
  var NONCE = window.SML_CC_NONCE || (loader && loader.dataset.nonce) || (window.wpApiSettings && window.wpApiSettings.nonce) || '';
  var LOGO = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@3560eef3c519/img/loop-logo.png';
  var HOST = 'stockmarketloop.com';

  function api(path, opts) {
    opts = opts || {}; opts.credentials = 'same-origin'; opts.headers = opts.headers || {};
    if (NONCE) opts.headers['X-WP-Nonce'] = NONCE;
    if (opts.body && !(opts.body instanceof FormData) && !opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    opts.cache = 'no-store';
    return fetch('/wp-json' + path, opts).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; });
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_.]+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 30); }
  function msgOf(res, fallback) { return (res && res.j && res.j.message) ? res.j.message : fallback; }
  function loginRedirect() { window.location.href = '/wp-login.php?redirect_to=' + encodeURIComponent('/create-channel/'); }

  /* ---------- state ---------- */
  var S = {
    channelName: '', handle: '', handleEdited: false, hOk: false, hMsg: '', hKind: '', hSeq: 0,
    email: '', emailVerified: false, codeSent: false, code: '', codeErr: '', sending: false, verifying: false, sendNote: '',
    tagline: '', about: '', avatar: '', banner: '', links: { site: '', x: '', youtube: '' },
    agreeTerms: false, agreeDisclaimer: false, submitting: false, submitErr: '', next: '/go-live/'
  };

  /* ---------- shell ---------- */
  var root = document.getElementById('sml-cc-root');
  if (!root) return;
  document.documentElement.classList.add('smlcc-on');
  document.body.classList.add('smlcc-on');
  if (!document.getElementById('sml-cc-font')) {
    var f = document.createElement('link'); f.id = 'sml-cc-font'; f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap'; document.head.appendChild(f);
  }
  function header() {
    return '<header class="cc-header"><div class="cc-brand"><img src="' + LOGO + '" alt="Stock Market Loop">' +
      '<span class="cc-crumb">/ Creator Studio / Create channel</span></div><div class="cc-sp"></div>' +
      '<a class="cc-pill" href="/" id="cc-back">← Back</a></header>';
  }
  root.innerHTML = '<div class="cc-wrap">' + header() + '<div class="cc-loading">Loading your creator status…</div></div>';
  /* pre-paint guard (wpcode/prepaint-guard.php): reveal once our stylesheet is in */
  (function () { var l = document.getElementById('sml-cc-css'), d = false; var go = function () { if (d) return; d = true; document.documentElement.classList.remove('sml-pp'); }; if (!l || l.sheet) { go(); return; } l.addEventListener('load', go, { once: true }); l.addEventListener('error', go, { once: true }); setTimeout(go, 1500); })();

  /* ---------- boot ---------- */
  api('/sml-create-channel/v1/state').then(function (res) {
    if (res.status === 401) { loginRedirect(); return; }
    if (!res.ok || !res.j) {
      q('.cc-loading').innerHTML = 'We couldn’t load your creator status. <a href="/create-channel/">Try again</a>.';
      return;
    }
    var j = res.j;
    if (j.hasChannel) { window.location.href = j.channelUrl || j.next || '/go-live/'; return; } // already a creator — their channel
    S.email = j.email || '';
    S.emailVerified = !!(j.verifiedEmail && j.verifiedEmail.toLowerCase() === S.email.toLowerCase());
    if (j.channel) {
      S.channelName = j.channel.name || ''; S.tagline = j.channel.tagline || ''; S.about = j.channel.about || '';
      S.avatar = j.channel.avatar || ''; S.banner = j.channel.banner || '';
      if (j.channel.links) { S.links.site = j.channel.links.site || ''; S.links.x = j.channel.links.x || ''; S.links.youtube = j.channel.links.youtube || ''; }
    }
    if (j.next) S.next = j.next;
    renderForm();
  });

  /* ---------- form ---------- */
  function renderForm() {
    var n = 1;
    var identity =
      '<div class="cc-card"><div class="cc-card-t">' + (n++) + ' · Channel identity</div>' +
      '<div class="cc-2">' +
        '<label class="cc-f">Channel name *<input id="cc-name" value="' + esc(S.channelName) + '" placeholder="e.g. Vaughn\'s Market Loop" maxlength="60"></label>' +
        '<label class="cc-f">Handle *<input id="cc-handle" value="' + esc(S.handle) + '" placeholder="your_handle" maxlength="30" autocapitalize="off" autocorrect="off" spellcheck="false"><span class="cc-help" id="cc-hmsg">Letters, numbers, underscores and periods. Min 3 characters.</span></label>' +
      '</div>' +
      '<div class="cc-f mt">Email *<div id="cc-email-block"></div></div>' +
      '<label class="cc-f mt">Tagline<input id="cc-tag" value="' + esc(S.tagline) + '" maxlength="120" placeholder="One line under your channel name — e.g. Daily market opens, zero hype"></label>' +
      '<label class="cc-f mt">About this channel *<textarea id="cc-about" rows="4" maxlength="280" placeholder="What you cover, how often, and who it\'s for. Shows on your channel page and in search.">' + esc(S.about) + '</textarea><span class="cc-count"><span id="cc-cnt">' + S.about.length + '</span> / 280</span></label>' +
      '<div class="cc-2" style="margin-top:4px">' +
        '<div class="cc-f">Avatar<div class="cc-up" id="cc-up-avatar"><div class="cc-mono" id="cc-av-slot">?</div><div class="cc-help">PNG or JPG, square, ≥ 400×400.<br><a href="#upload" data-pick="avatar">Upload image</a><span id="cc-av-err" class="cc-err"></span></div></div><input class="cc-file" type="file" id="cc-file-avatar" accept="image/png,image/jpeg,image/webp"></div>' +
        '<div class="cc-f">Banner<div class="cc-up banner" id="cc-up-banner"><div class="cc-help" id="cc-bn-slot">1600×400 recommended.<br><a href="#upload" data-pick="banner">Upload image</a><span id="cc-bn-err" class="cc-err"></span></div></div><input class="cc-file" type="file" id="cc-file-banner" accept="image/png,image/jpeg,image/webp"></div>' +
      '</div></div>';

    var links =
      '<div class="cc-card"><div class="cc-card-t">' + (n++) + ' · Links (optional)</div><div class="cc-3">' +
        '<input id="cc-l-site" value="' + esc(S.links.site) + '" placeholder="Website">' +
        '<input id="cc-l-x" value="' + esc(S.links.x) + '" placeholder="X / Twitter">' +
        '<input id="cc-l-yt" value="' + esc(S.links.youtube) + '" placeholder="YouTube">' +
      '</div></div>';

    var agree =
      '<div class="cc-card" style="display:flex;flex-direction:column;gap:12px">' +
        '<label class="cc-agree"><input type="checkbox" id="cc-a-terms"' + (S.agreeTerms ? ' checked' : '') + '><span>I agree to the <a href="/terms/" target="_blank" rel="noopener">Creator Terms</a>. *</span></label>' +
        '<label class="cc-agree"><input type="checkbox" id="cc-a-disc"' + (S.agreeDisclaimer ? ' checked' : '') + '><span>I understand my content is not financial advice and I’ll display the required disclaimer on trade-related posts. *</span></label>' +
        '<div class="cc-submit-row"><button class="cc-submit" id="cc-submit" disabled>Create my channel</button><span class="cc-hint" id="cc-hint"></span></div>' +
        '<div class="cc-err" id="cc-submit-err"></div>' +
      '</div>';

    var rail =
      '<aside class="cc-rail"><div class="cc-prev">' +
        '<div class="cc-prev-banner" id="cc-pv-banner"></div><div class="cc-prev-body">' +
        '<div class="cc-prev-av" id="cc-pv-av">?</div>' +
        '<div class="cc-prev-name" id="cc-pv-name">Your channel name</div>' +
        '<div class="cc-prev-url" id="cc-pv-url">' + HOST + '/channel/your_handle/</div>' +
        '<div class="cc-prev-tag" id="cc-pv-tag">Your tagline appears here</div></div>' +
        '<div class="cc-prev-foot">Live preview</div></div>' +
        '<div class="cc-card"><div class="cc-card-t">After you create it</div><div class="cc-list">' +
          '<span>1 · Go live or upload your first video</span>' +
          '<span>2 · Post to your channel feed</span>' +
          '<span>3 · Share <span id="cc-pv-url2">' + HOST + '/channel/your_handle/</span></span>' +
          '<span>4 · Manage everything from <a href="/creator-studio/">Creator Studio</a></span>' +
        '</div></div></aside>';

    root.innerHTML = '<div class="cc-wrap">' + header() + '<div class="cc-grid"><div class="cc-form">' + identity + links + agree + '</div>' + rail + '</div></div>';
    bind();
    renderEmail();
    refresh();
  }

  /* ---------- email block (structural — re-rendered on state change) ---------- */
  function renderEmail() {
    var b = q('#cc-email-block'); if (!b) return;
    var okEmail = /.+@.+\..+/.test(S.email);
    var html = '<div class="cc-row"><input type="email" id="cc-email" autocomplete="email" value="' + esc(S.email) + '" placeholder="you@example.com"' + (S.emailVerified ? ' disabled' : '') + '>';
    if (S.emailVerified) html += '<span class="cc-verified">✓ Verified <a href="#change" id="cc-email-change">Change</a></span>';
    else html += '<button class="cc-btn2" id="cc-send"' + (S.sending || !okEmail ? ' disabled' : '') + '>' + (S.sending ? 'Sending…' : (S.codeSent ? 'Resend code' : 'Send code')) + '</button>';
    html += '</div>';
    if (!S.emailVerified && S.codeSent) {
      html += '<div class="cc-code"><div class="cc-code-t">Enter the 6-digit code we emailed to ' + esc(S.email) + '</div>' +
        '<div class="cc-code-s">It expires in 10 minutes. Check spam if it isn’t in your inbox.</div>' +
        '<div class="cc-code-row"><input id="cc-code" inputmode="numeric" maxlength="6" placeholder="000000" value="' + esc(S.code) + '" autocomplete="one-time-code">' +
        '<button class="cc-btn-acc" id="cc-verify"' + (S.verifying || S.code.length !== 6 ? ' disabled' : '') + '>' + (S.verifying ? 'Checking…' : 'Verify') + '</button>' +
        '<a href="#resend" id="cc-resend">Resend code</a></div>' +
        '<div class="cc-err" id="cc-code-err">' + esc(S.codeErr) + '</div></div>';
    }
    var m = S.emailVerified ? 'This is where subscriber notifications go.'
      : !S.email ? 'We’ll send a 6-digit code to verify it’s yours.'
      : !okEmail ? 'Enter a valid email address.'
      : S.sendNote ? S.sendNote
      : S.codeSent ? '' : 'Click Send code to verify this address.';
    html += '<span class="cc-help' + (S.sendNote && /could not|too soon|wait/i.test(S.sendNote) ? ' bad' : '') + '" id="cc-email-msg">' + esc(m) + '</span>';
    b.innerHTML = html;

    var ei = q('#cc-email'); if (ei) ei.addEventListener('input', function () { S.email = ei.value.trim(); S.codeSent = false; S.code = ''; S.codeErr = ''; S.sendNote = ''; renderEmail(); refresh(); if (q('#cc-email')) { q('#cc-email').focus(); var v = q('#cc-email').value; q('#cc-email').setSelectionRange(v.length, v.length); } });
    var sb = q('#cc-send'); if (sb) sb.addEventListener('click', sendCode);
    var rs = q('#cc-resend'); if (rs) rs.addEventListener('click', function (e) { e.preventDefault(); sendCode(); });
    var ci = q('#cc-code'); if (ci) ci.addEventListener('input', function () { S.code = ci.value.replace(/\D/g, '').slice(0, 6); S.codeErr = ''; ci.value = S.code; var vb = q('#cc-verify'); if (vb) vb.disabled = S.code.length !== 6; var ce = q('#cc-code-err'); if (ce) ce.textContent = ''; });
    if (ci) ci.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); verifyCode(); } });
    var vb = q('#cc-verify'); if (vb) vb.addEventListener('click', verifyCode);
    var ch = q('#cc-email-change'); if (ch) ch.addEventListener('click', function (e) { e.preventDefault(); S.emailVerified = false; S.codeSent = false; S.code = ''; renderEmail(); refresh(); if (q('#cc-email')) q('#cc-email').focus(); });
  }
  function sendCode() {
    if (S.sending || !/.+@.+\..+/.test(S.email)) return;
    S.sending = true; S.sendNote = ''; renderEmail();
    api('/sml-create-channel/v1/email-code', { method: 'POST', body: JSON.stringify({ email: S.email }) }).then(function (res) {
      S.sending = false;
      if (res.status === 401) { loginRedirect(); return; }
      if (res.ok) { S.codeSent = true; S.code = ''; S.codeErr = ''; S.sendNote = ''; renderEmail(); var ci = q('#cc-code'); if (ci) ci.focus(); }
      else { S.sendNote = msgOf(res, 'We could not send the code right now.'); renderEmail(); }
      refresh();
    });
  }
  function verifyCode() {
    if (S.verifying || S.code.length !== 6) return;
    S.verifying = true; renderEmail();
    api('/sml-create-channel/v1/email-verify', { method: 'POST', body: JSON.stringify({ email: S.email, code: S.code }) }).then(function (res) {
      S.verifying = false;
      if (res.status === 401) { loginRedirect(); return; }
      if (res.ok && res.j && res.j.verified) { S.emailVerified = true; S.codeSent = false; S.code = ''; S.codeErr = ''; }
      else { S.codeErr = msgOf(res, "That code doesn't match — check the email and try again."); }
      renderEmail(); refresh();
    });
  }

  /* ---------- bindings ---------- */
  function on(id, ev, fn) { var e = q('#' + id); if (e) e.addEventListener(ev, fn); }
  function bind() {
    on('cc-back', 'click', function (e) { if (history.length > 1 && document.referrer && document.referrer.indexOf(location.host) > -1) { e.preventDefault(); history.back(); } });
    on('cc-name', 'input', function () {
      S.channelName = this.value;
      if (!S.handleEdited) { S.handle = slug(S.channelName); var h = q('#cc-handle'); if (h) h.value = S.handle; checkHandle(); }
      refresh();
    });
    on('cc-handle', 'input', function () { var v = slug(this.value); S.handle = v; S.handleEdited = v.length > 0; if (this.value !== v) this.value = v; checkHandle(); refresh(); });
    on('cc-tag', 'input', function () { S.tagline = this.value; refresh(); });
    on('cc-about', 'input', function () { S.about = this.value.slice(0, 280); if (this.value !== S.about) this.value = S.about; refresh(); });
    on('cc-l-site', 'input', function () { S.links.site = this.value; });
    on('cc-l-x', 'input', function () { S.links.x = this.value; });
    on('cc-l-yt', 'input', function () { S.links.youtube = this.value; });
    on('cc-a-terms', 'change', function () { S.agreeTerms = this.checked; refresh(); });
    on('cc-a-disc', 'change', function () { S.agreeDisclaimer = this.checked; refresh(); });
    on('cc-submit', 'click', submit);
    ['avatar', 'banner'].forEach(function (kind) {
      var link = q('[data-pick="' + kind + '"]'), input = q('#cc-file-' + kind);
      if (link && input) {
        link.addEventListener('click', function (e) { e.preventDefault(); input.click(); });
        input.addEventListener('change', function () { if (input.files && input.files[0]) upload(kind, input.files[0]); input.value = ''; });
      }
    });
    if (S.avatar) paintUpload('avatar', S.avatar);
    if (S.banner) paintUpload('banner', S.banner);
  }

  var hTimer = null;
  function checkHandle() {
    clearTimeout(hTimer);
    var h = S.handle, seq = ++S.hSeq;
    S.hOk = false;
    if (!h) { S.hMsg = 'Letters, numbers, underscores and periods. Min 3 characters.'; S.hKind = ''; return paintHandle(); }
    if (h.length < 3) { S.hMsg = 'Too short — 3 characters minimum.'; S.hKind = 'bad'; return paintHandle(); }
    S.hMsg = 'Checking availability…'; S.hKind = ''; paintHandle();
    hTimer = setTimeout(function () {
      api('/sml-channel/v1/handle-availability?handle=' + encodeURIComponent(h)).then(function (res) {
        if (seq !== S.hSeq) return; // a newer keystroke superseded this check
        if (res.status === 401) { loginRedirect(); return; }
        if (!res.ok) { S.hMsg = msgOf(res, 'Could not check that handle right now.'); S.hKind = 'bad'; S.hOk = false; }
        else {
          var j = res.j || {}; var av = j.available != null ? j.available : j.is_available;
          S.hOk = !!av;
          S.hMsg = av ? '✓ ' + HOST + '/channel/' + h + '/ is available' : '@' + h + ' is taken. Try another.';
          S.hKind = av ? 'ok' : 'bad';
        }
        paintHandle(); refresh();
      });
    }, 400);
  }
  function paintHandle() { var m = q('#cc-hmsg'); if (m) { m.textContent = S.hMsg; m.className = 'cc-help' + (S.hKind ? ' ' + S.hKind : ''); } }

  function upload(kind, file) {
    var err = q('#cc-' + (kind === 'avatar' ? 'av' : 'bn') + '-err'); if (err) err.textContent = '';
    if (file.size > 4 * 1024 * 1024) { if (err) err.textContent = 'Images must be 4 MB or smaller.'; return; }
    var fd = new FormData(); fd.append('file', file, file.name); fd.append('kind', kind);
    var slot = q('#cc-' + (kind === 'avatar' ? 'av' : 'bn') + '-slot'); if (slot && kind === 'banner') slot.innerHTML = 'Uploading…';
    api('/sml-create-channel/v1/media', { method: 'POST', body: fd }).then(function (res) {
      if (res.status === 401) { loginRedirect(); return; }
      if (res.ok && res.j && res.j.url) { S[kind] = res.j.url; paintUpload(kind, res.j.url); refresh(); }
      else { if (err) err.textContent = msgOf(res, 'Upload failed — try a smaller PNG or JPG.'); if (kind === 'banner') paintUpload('banner', S.banner); }
    });
  }
  function paintUpload(kind, url) {
    if (kind === 'avatar') { var s = q('#cc-av-slot'); if (s) s.innerHTML = url ? '<img src="' + esc(url) + '" alt="">' : esc(initial()); }
    else {
      var b = q('#cc-bn-slot'); if (!b) return;
      b.innerHTML = (url ? '<img src="' + esc(url) + '" alt="">' : '1600×400 recommended.') + '<br><a href="#upload" data-pick="banner">' + (url ? 'Replace image' : 'Upload image') + '</a><span id="cc-bn-err" class="cc-err"></span>';
      var link = q('[data-pick="banner"]'), input = q('#cc-file-banner');
      if (link && input) link.addEventListener('click', function (e) { e.preventDefault(); input.click(); });
    }
  }
  function initial() { return ((S.channelName || '?').trim().charAt(0) || '?').toUpperCase(); }

  /* ---------- derived UI ---------- */
  function missing() {
    var m = [];
    if (!S.channelName.trim()) m.push('name');
    if (!S.hOk) m.push('handle');
    if (!S.about.trim()) m.push('about');
    if (!S.emailVerified) m.push('verified email');
    if (!S.agreeTerms || !S.agreeDisclaimer) m.push('agreements');
    return m;
  }
  function refresh() {
    var cnt = q('#cc-cnt'); if (cnt) cnt.textContent = String(S.about.length);
    var av = q('#cc-av-slot'); if (av && !S.avatar) av.textContent = initial();
    var pvAv = q('#cc-pv-av'); if (pvAv) pvAv.innerHTML = S.avatar ? '<img src="' + esc(S.avatar) + '" alt="">' : esc(initial());
    var pvB = q('#cc-pv-banner'); if (pvB) pvB.style.backgroundImage = S.banner ? 'url("' + S.banner.replace(/"/g, '') + '")' : '';
    var pvN = q('#cc-pv-name'); if (pvN) pvN.textContent = S.channelName.trim() || 'Your channel name';
    var url = HOST + '/channel/' + (S.handle || 'your_handle') + '/';
    var pvU = q('#cc-pv-url'); if (pvU) pvU.textContent = url;
    var pvU2 = q('#cc-pv-url2'); if (pvU2) pvU2.textContent = url;
    var pvT = q('#cc-pv-tag'); if (pvT) pvT.textContent = S.tagline.trim() || 'Your tagline appears here';
    var m = missing(), ready = m.length === 0 && !S.submitting;
    var btn = q('#cc-submit'); if (btn) { btn.disabled = !ready; btn.className = 'cc-submit' + (ready ? ' ready' : ''); btn.textContent = S.submitting ? 'Creating…' : 'Create my channel'; }
    var hint = q('#cc-hint'); if (hint) { hint.textContent = m.length ? 'Still needed: ' + m.join(', ') : 'Everything checks out.'; hint.className = 'cc-hint' + (m.length ? '' : ' ok'); }
    var se = q('#cc-submit-err'); if (se) se.textContent = S.submitErr;
  }

  /* ---------- submit ---------- */
  function submit() {
    if (missing().length || S.submitting) return;
    S.submitting = true; S.submitErr = ''; refresh();
    var body = {
      channelName: S.channelName.trim(), handle: S.handle, email: S.email, tagline: S.tagline.trim(), about: S.about.trim(),
      links: { site: S.links.site.trim(), x: S.links.x.trim(), youtube: S.links.youtube.trim() },
      agreeTerms: S.agreeTerms, agreeDisclaimer: S.agreeDisclaimer
    };
    api('/sml-create-channel/v1/create', { method: 'POST', body: JSON.stringify(body) }).then(function (res) {
      S.submitting = false;
      if (res.status === 401) { loginRedirect(); return; }
      if (res.ok && res.j && res.j.ok) { renderDone(res.j); return; }
      S.submitErr = msgOf(res, 'Could not create your channel — the server said: ' + (res.status || 'unknown error') + '.');
      // a taken handle should re-check so the button state is honest
      if (res.j && /handle/i.test(res.j.code || '')) { S.hOk = false; checkHandle(); }
      refresh();
    });
  }
  function renderDone(j) {
    var next = j.next || S.next || '/go-live/';
    var url = (j.url || '').replace(/^https?:\/\//, '');
    root.innerHTML = '<div class="cc-wrap">' + header() +
      '<div class="cc-done"><div class="cc-done-tile">✓</div><div class="cc-done-t">Your channel is live</div>' +
      '<div class="cc-done-s"><b>' + esc(url) + '</b> is ready. Taking you to Go Live so you can start your first stream…</div>' +
      '<div class="cc-done-btns"><a class="cc-btn2" href="' + esc(j.url || '#') + '">View channel</a><a class="cc-btn-acc" id="cc-go" href="' + esc(next) + '">Go live now →</a></div>' +
      '<div class="cc-progress"><i id="cc-prog"></i></div></div></div>';
    requestAnimationFrame(function () { var p = q('#cc-prog'); if (p) p.style.width = '100%'; });
    setTimeout(function () { window.location.href = next; }, 2600);
  }
})();
