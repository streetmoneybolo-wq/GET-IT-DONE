/* Group Score badge in the group page header, beside the member count. The group shell
   re-renders its header, so the badge is re-inserted whenever it goes missing. */
(function () {
  'use strict';
  var S = window.SML_GS_GROUP;
  if (!S || !S.groupId) return;

  function badge() {
    var a = document.createElement('a');
    a.className = 'sml-gs-score';
    a.href = S.leaderboard;
    var n = Number(S.lifetime) || 0;
    a.setAttribute('aria-label', 'Group Score ' + n.toLocaleString() + (S.rank ? ', ranked number ' + S.rank : '') + '. Open the group leaderboard.');
    a.title = 'Group Score · +' + (Number(S.last30) || 0).toLocaleString() + ' in the last 30 days';
    var b = document.createElement('b');
    b.textContent = n.toLocaleString();
    a.appendChild(b);
    a.appendChild(document.createTextNode(' SCORE' + (S.rank ? ' · #' + S.rank : '')));
    return a;
  }

  function place() {
    var actions = document.querySelector('.sml-gshell__side-head .sml-gshell__side-actions');
    if (!actions || actions.querySelector('.sml-gs-score')) return;
    var count = actions.querySelector('.sml-gshell__member-count');
    if (count && count.nextSibling) actions.insertBefore(badge(), count.nextSibling);
    else actions.appendChild(badge());
  }

  place();
  if ('MutationObserver' in window) {
    var t = 0;
    /* a timer, not requestAnimationFrame: rAF never fires in a background tab, where the
       shell still renders its header */
    new MutationObserver(function () { if (t) return; t = setTimeout(function () { t = 0; place(); }, 80); })
      .observe(document.body, { childList: true, subtree: true });
  }
})();
