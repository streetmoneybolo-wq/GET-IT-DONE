/*!
 * SML Q&A front-end. CSP-safe: no inline handlers — binds via delegation and
 * calls the first-party REST routes with the wp_rest nonce.
 */
(function () {
  'use strict';
  var C = window.SML_QA || {};
  if (!C.rest) return;

  function post(path, body) {
    return fetch(C.rest + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': C.nonce || '' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); });
  }

  function msg(el, text, isErr) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'sml-qa-msg' + (isErr ? ' err' : (text ? ' ok' : ''));
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('button') : null;
    if (!t) return;

    /* Upvote */
    if (t.hasAttribute('data-vote')) {
      if (t.disabled) return;
      var cid = t.getAttribute('data-vote');
      t.disabled = true;
      post('/vote', { comment_id: cid }).then(function (res) {
        t.disabled = false;
        if (!res.ok) return;
        var countEl = document.querySelector('[data-votecount="' + cid + '"]');
        if (countEl) countEl.textContent = res.j.upvotes;
        t.classList.toggle('voted', !!res.j.voted);
        t.setAttribute('aria-pressed', res.j.voted ? 'true' : 'false');
      }).catch(function () { t.disabled = false; });
      return;
    }

    /* Accept / unaccept */
    if (t.hasAttribute('data-accept')) {
      var acid = t.getAttribute('data-accept');
      var qid = t.getAttribute('data-question');
      t.disabled = true;
      post('/accept', { question_id: qid, comment_id: acid }).then(function (res) {
        t.disabled = false;
        if (res.ok) window.location.reload();
      }).catch(function () { t.disabled = false; });
      return;
    }

    /* Post an answer */
    if (t.classList.contains('sml-qa-submit-answer')) {
      var form = t.closest('[data-answer-form]');
      var wrap = t.closest('.sml-qa');
      var m = form.querySelector('.sml-qa-msg');
      var ta = form.querySelector('.sml-qa-answer-input');
      var body = (ta.value || '').trim();
      if (body.length < 15) { msg(m, 'Add a little more detail (15+ characters).', true); return; }
      t.disabled = true; msg(m, 'Posting…');
      post('/answer', { question_id: wrap.getAttribute('data-question'), body: body }).then(function (res) {
        if (res.ok && res.j.pending) { t.disabled = false; ta.value = ''; msg(m, 'Thanks — your answer is awaiting moderation.'); }
        else if (res.ok) { msg(m, 'Posted.'); window.location.reload(); }
        else { t.disabled = false; msg(m, (res.j && res.j.message) || 'Could not post.', true); }
      }).catch(function () { t.disabled = false; msg(m, 'Network error — try again.', true); });
      return;
    }

    /* Ask a question */
    if (t.classList.contains('sml-qa-submit-ask')) {
      var af = t.closest('[data-ask-form]');
      var am = af.querySelector('.sml-qa-msg');
      var title = (af.querySelector('.sml-qa-ask-title').value || '').trim();
      var ticker = (af.querySelector('.sml-qa-ask-ticker').value || '').trim();
      var qbody = (af.querySelector('.sml-qa-ask-body').value || '').trim();
      if (title.length < 12) { msg(am, 'Give your question a clearer title (12+ characters).', true); return; }
      t.disabled = true; msg(am, 'Posting…');
      post('/ask', { title: title, ticker: ticker, body: qbody }).then(function (res) {
        if (res.ok && res.j.url) { msg(am, 'Posted — taking you there…'); window.location.href = res.j.url; }
        else { t.disabled = false; msg(am, (res.j && res.j.message) || 'Could not post.', true); }
      }).catch(function () { t.disabled = false; msg(am, 'Network error — try again.', true); });
      return;
    }
  });
})();
