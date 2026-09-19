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
  function questionHeading() { return document.querySelector('.sml-qa-question h1, article h1, h1'); }
  function answerMeta(cid) { return document.querySelector('#answer-' + cid + ' .sml-qa-answer-meta'); }

  function setChip(host, group, prefix, cls, after) {
    if (!host) return;
    var old = (after ? host.parentNode : host).querySelector('.' + cls);
    if (old) old.remove();
    if (!group) return;
    var c = chip(group, prefix); c.classList.add(cls);
    if (after) host.insertAdjacentElement('afterend', c); else host.appendChild(c);
  }

  function paintChips() {
    if (!C.questionId) return;
    get('qa-credits?question_id=' + C.questionId).then(function (d) {
      setChip(questionHeading(), d.question, 'Asked for ', 'sml-gs-chip-q', true);
      Object.keys(d.answers || {}).forEach(function (cid) { setChip(answerMeta(cid), d.answers[cid], 'Answered for ', 'sml-gs-chip-a', false); });
      var mine = d.mine || {};
      if (mine.question) manage('question', C.questionId, mine.question);
      Object.keys(mine.answers || {}).forEach(function (cid) { manage('answer', cid, mine.answers[cid]); });
    }).catch(function () {});
  }

  /* ------------------------------------- change the credit on your own posts */
  var openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.menu.remove(); openMenu.btn.setAttribute('aria-expanded', 'false'); openMenu = null; } }
  document.addEventListener('click', function (e) { if (openMenu && !openMenu.menu.contains(e.target) && e.target !== openMenu.btn) closeMenu(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openMenu) { var b = openMenu.btn; closeMenu(); b.focus(); } });

  function manage(type, id, state) {
    var noun = type === 'question' ? 'question' : 'answer';
    var host = type === 'question' ? questionHeading() : answerMeta(id);
    if (!host) return;
    var box = (type === 'question' ? host.parentNode : host).querySelector('.sml-gs-manage[data-id="' + id + '"]');
    if (box) box.remove();
    box = el('span', 'sml-gs-manage'); box.setAttribute('data-id', id);

    var label = state.credit === 'group' && state.group ? 'Credit: ' + state.group.name : 'Credit: you';
    if (state.locked) {
      var lk = el('span', 'sml-gs-credit-btn is-locked', '🔒 ' + label);
      lk.title = 'This ' + noun + ' already earned its reward, so the credit can’t change.';
      box.appendChild(lk);
    } else {
      var btn = el('button', 'sml-gs-credit-btn', label + ' ▾');
      btn.type = 'button';
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');
      btn.title = 'Choose who gets credit for this ' + noun;
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (openMenu && openMenu.btn === btn) { closeMenu(); return; }
        closeMenu();
        var menu = menuFor(type, id, state, btn);
        box.appendChild(menu);
        btn.setAttribute('aria-expanded', 'true');
        openMenu = { menu: menu, btn: btn };
        var first = menu.querySelector('button:not([disabled])'); if (first) first.focus();
      });
      box.appendChild(btn);
    }
    if (type === 'question') { box.classList.add('is-q'); var qc = host.parentNode.querySelector('.sml-gs-chip-q'); (qc || host).insertAdjacentElement('afterend', box); } else host.appendChild(box);
  }

  function menuFor(type, id, state, btn) {
    var menu = el('div', 'sml-gs-menu');
    menu.setAttribute('role', 'menu');
    var current = state.credit === 'group' && state.group ? 'group:' + state.group.id : 'self';
    var status = el('p', 'sml-gs-menu-msg');
    status.setAttribute('role', 'status');

    function item(value, title, sub, disabled) {
      var b = el('button', 'sml-gs-menu-item' + (value === current ? ' is-current' : ''));
      b.type = 'button'; b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', value === current ? 'true' : 'false');
      b.disabled = !!disabled;
      b.appendChild(el('span', 'sml-gs-menu-t', title));
      if (sub) b.appendChild(el('span', 'sml-gs-menu-s', sub));
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (value === current) { closeMenu(); btn.focus(); return; }
        [].forEach.call(menu.querySelectorAll('button'), function (x) { x.disabled = true; });
        status.textContent = 'Saving…';
        fetch(C.rest + 'qa-credit', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': C.nonce },
          body: JSON.stringify({ object_type: type, object_id: Number(id), credit: value })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res) {
          if (!res.ok) {
            status.textContent = (res.j && res.j.message) || 'Couldn’t change the credit. Try again.';
            status.classList.add('is-error');
            [].forEach.call(menu.querySelectorAll('button'), function (x) { x.disabled = x.hasAttribute('data-off'); });
            return;
          }
          closeMenu();
          var group = res.j.credit === 'group' ? res.j.group : null;
          if (type === 'question') setChip(questionHeading(), group, 'Asked for ', 'sml-gs-chip-q', true);
          else setChip(answerMeta(id), group, 'Answered for ', 'sml-gs-chip-a', false);
          manage(type, id, res.j);
          var nb = (type === 'question' ? questionHeading().parentNode : answerMeta(id)).querySelector('.sml-gs-manage[data-id="' + id + '"] .sml-gs-credit-btn');
          if (nb) { nb.focus(); nb.classList.add('is-saved'); setTimeout(function () { nb.classList.remove('is-saved'); }, 1600); }
        }).catch(function () {
          status.textContent = 'Network error. Try again.'; status.classList.add('is-error');
          [].forEach.call(menu.querySelectorAll('button'), function (x) { x.disabled = x.hasAttribute('data-off'); });
        });
      });
      if (disabled) b.setAttribute('data-off', '');
      menu.appendChild(b);
    }

    item('self', 'Keep the credit', 'You earn the Loop Bucks');
    (state.groups || []).forEach(function (g) {
      item('group:' + g.id, 'Give ' + g.name + ' the credit', g.eligible ? 'Your group earns Q&A score' : 'You joined less than 24 h before posting', !g.eligible);
    });
    menu.appendChild(el('p', 'sml-gs-menu-note', 'You can change this until the reward is paid.'));
    menu.appendChild(status);
    menu.addEventListener('click', function (e) { e.stopPropagation(); });
    return menu;
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
