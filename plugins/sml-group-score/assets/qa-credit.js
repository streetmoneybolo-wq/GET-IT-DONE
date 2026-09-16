/* SML Group Score — Q&A credit picker + group credit chips.
   The member chooses, per question/answer: keep the credit (earn Loop Bucks) or give one of
   their groups the credit (the group earns Q&A score). The choice rides along with the Q&A
   plugin's own ask/answer request; the server validates membership. */
(function () {
  'use strict';
  var C = window.SML_GS || {};
  if (!C.rest) return;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function get(path) {
    return fetch(C.rest + path, { credentials: 'same-origin', headers: { 'X-WP-Nonce': C.nonce } }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); });
  }

  /* ------------------------------------------------------------ the picker */
  var pickers = { ask: null, answer: null };
  var me = null;

  function picker(kind) {
    var wrap = el('div', 'sml-gs-credit');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Who gets credit for this ' + (kind === 'ask' ? 'question' : 'answer'));
    var name = 'sml-gs-credit-' + kind + '-' + Math.random().toString(36).slice(2, 7);
    var amounts = me.amounts || {};

    var selfOpt = el('label', 'sml-gs-opt');
    var selfIn = el('input'); selfIn.type = 'radio'; selfIn.name = name; selfIn.value = 'self'; selfIn.checked = true;
    selfOpt.appendChild(selfIn);
    selfOpt.appendChild(el('span', 'sml-gs-opt-t', 'Keep the credit'));
    selfOpt.appendChild(el('span', 'sml-gs-opt-s', me.earning ? 'You earn Loop Bucks' : 'Loop Bucks unlock once your account is 7 days old and verified'));
    wrap.appendChild(selfOpt);

    var groupOpt = el('label', 'sml-gs-opt');
    var groupIn = el('input'); groupIn.type = 'radio'; groupIn.name = name; groupIn.value = 'group';
    groupOpt.appendChild(groupIn);
    groupOpt.appendChild(el('span', 'sml-gs-opt-t', 'Give my group the credit'));
    var sel = el('select', 'sml-gs-group');
    sel.setAttribute('aria-label', 'Group to credit');
    var eligible = 0;
    me.groups.forEach(function (g) {
      var o = el('option', null, g.name + (g.can_credit ? '' : ' — available ' + new Date(g.credit_from).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })));
      o.value = String(g.id); o.disabled = !g.can_credit; if (g.can_credit) eligible++;
      sel.appendChild(o);
    });
    var firstOk = me.groups.filter(function (g) { return g.can_credit; })[0];
    if (firstOk) sel.value = String(firstOk.id);
    groupOpt.appendChild(sel);
    groupOpt.appendChild(el('span', 'sml-gs-opt-s', 'Your group earns Q&A score instead'));
    if (!eligible) { groupIn.disabled = true; sel.disabled = true; groupOpt.classList.add('is-off'); }
    sel.addEventListener('change', function () { groupIn.checked = true; });
    sel.addEventListener('focus', function () { if (!groupIn.disabled) groupIn.checked = true; });
    wrap.appendChild(groupOpt);

    var how = kind === 'ask'
      ? 'A good question (2+ answers from others and an accepted answer or 3+ upvotes) earns ' + (amounts.question_good || 5) + ' LB.'
      : 'Accepted by the asker: ' + (amounts.answer_accepted || 25) + ' LB · 3+ upvotes: ' + (amounts.answer_voted || 10) + ' LB.';
    wrap.appendChild(el('p', 'sml-gs-how', how + ' Paid 24 h after it qualifies, up to ' + (me.daily_cap || 100) + ' LB a day.'));

    wrap.value = function () { return groupIn.checked && !groupIn.disabled && sel.value ? 'group:' + sel.value : 'self'; };
    return wrap;
  }

  function mount() {
    if (!me || !me.groups || !me.groups.length) return;
    var answer = document.querySelector('[data-answer-form]');
    if (answer && !answer.querySelector('.sml-gs-credit') && answer.querySelector('textarea:not([readonly])')) {
      var p = picker('answer'); pickers.answer = p;
      var row = answer.querySelector('.sml-qa-form-row') || answer.lastElementChild;
      answer.insertBefore(p, row);
    }
    var ask = document.querySelector('[data-ask-form]') || document.getElementById('qh-ask');
    if (ask && !ask.querySelector('.sml-gs-credit')) {
      var q = picker('ask'); pickers.ask = q;
      var btn = ask.querySelector('.sml-qa-form-row') || ask.querySelector('button');
      var anchor = btn && btn.parentNode === ask ? btn : (btn ? btn.closest('div') : null);
      if (anchor && anchor.parentNode === ask) ask.insertBefore(q, anchor); else ask.appendChild(q);
    }
  }

  /* the choice travels with the Q&A plugin's own request */
  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var kind = /\/sml-qa\/v1\/ask(?:\?|$)/.test(url) ? 'ask' : (/\/sml-qa\/v1\/answer(?:\?|$)/.test(url) ? 'answer' : '');
      if (kind && pickers[kind] && init && typeof init.body === 'string' && String(init.method || '').toUpperCase() === 'POST') {
        var body = JSON.parse(init.body);
        body.credit = pickers[kind].value();
        init = Object.assign({}, init, { body: JSON.stringify(body) });
      }
    } catch (e) { /* never break posting */ }
    return realFetch.call(this, input, init);
  };

  /* ------------------------------------------------------ credit chips */
  function chip(group, prefix) {
    var a = el('a', 'sml-gs-chip');
    a.href = group.url;
    a.appendChild(el('span', 'sml-gs-chip-i', '👥'));
    a.appendChild(document.createTextNode((prefix || 'for ') + group.name));
    return a;
  }
  function paintChips() {
    if (!C.questionId) return;
    get('qa-credits?question_id=' + C.questionId).then(function (d) {
      if (d.question) {
        var h = document.querySelector('.sml-qa-question h1, article h1, h1');
        if (h && !h.parentNode.querySelector('.sml-gs-chip-q')) { var c = chip(d.question, 'Asked for '); c.classList.add('sml-gs-chip-q'); h.insertAdjacentElement('afterend', c); }
      }
      Object.keys(d.answers || {}).forEach(function (cid) {
        var meta = document.querySelector('#answer-' + cid + ' .sml-qa-answer-meta');
        if (meta && !meta.querySelector('.sml-gs-chip')) meta.appendChild(chip(d.answers[cid], 'Answered for '));
      });
    }).catch(function () {});
  }

  function start() {
    paintChips();
    if (!C.loggedIn) return;
    get('me').then(function (d) { me = d; mount(); }).catch(function () {});
    /* the /q/ home opens its ask box on demand; mount again when it appears */
    if ('MutationObserver' in window) {
      var t = 0;
      new MutationObserver(function () { clearTimeout(t); t = setTimeout(mount, 150); }).observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
