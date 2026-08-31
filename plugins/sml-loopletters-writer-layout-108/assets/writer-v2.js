/* Loop Letters Writer v2 — 4-step workflow shell (Phase 1: look + flow).
   Non-invasive: wraps the Studio's core editor (#le-root / #le-side) in a
   Write→SEO→Meta→Publish stepper. Does NOT move/recreate core nodes (only
   toggles visibility), so the core editor keeps working. SEO/Meta fields are
   UI-only in Phase 1 (persistence + real-SEO hook come in a later phase). */
(function () {
  'use strict';
  if (window.__llw2Booted) { return; }
  window.__llw2Booted = true;

  var STEPS = [
    { key: 'write', n: '01', label: 'Write' },
    { key: 'seo', n: '02', label: 'SEO' },
    { key: 'meta', n: '03', label: 'Meta' },
    { key: 'publish', n: '04', label: 'Publish' }
  ];
  var state = { step: 'write', mounted: false };

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (html != null) { n.innerHTML = html; }
    return n;
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isWriterView() { return !!$('#le-root [data-title]'); }
  function editorCard() { return $('#le-root .cs-card') || $('#le-root'); }
  function rail() { return document.getElementById('le-side'); }

  /* ---- data helpers (read what the core editor already has) ---- */
  function titleVal() { var t = $('[data-title]'); return t ? (t.value || '').trim() : ''; }
  function subtitleVal() { var s = $('[data-subtitle]'); return s ? (s.value || '').trim() : ''; }
  function bodyText() {
    return Array.prototype.map.call(document.querySelectorAll('#le-root [data-txt]'), function (t) {
      return t.value || t.textContent || '';
    }).join(' ');
  }
  function wordCount() { var w = bodyText().trim(); return w ? w.split(/\s+/).length : 0; }
  function readMinutes() { return Math.max(1, Math.round(wordCount() / 200)); }
  function tickersFound() {
    var m = (titleVal() + ' ' + subtitleVal() + ' ' + bodyText()).match(/\$[A-Za-z]{1,6}/g) || [];
    var seen = {}, out = [];
    m.forEach(function (t) { t = t.toUpperCase(); if (!seen[t]) { seen[t] = 1; out.push(t); } });
    return out;
  }
  function slugify(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  /* ---- stepper ---- */
  function stepperEl() {
    var wrap = el('nav', 'llw2-stepper', '');
    STEPS.forEach(function (s, i) {
      var done = STEPS.findIndex(function (x) { return x.key === state.step; }) > i;
      var active = s.key === state.step;
      var node = el('button', 'llw2-step' + (active ? ' is-active' : '') + (done ? ' is-done' : ''));
      node.type = 'button';
      node.setAttribute('data-step', s.key);
      node.innerHTML = '<span class="llw2-step-dot">' + (done ? '✓' : (i + 1)) + '</span>'
        + '<span class="llw2-step-txt"><small>STEP ' + s.n + '</small><b>' + s.label + '</b></span>';
      wrap.appendChild(node);
      if (i < STEPS.length - 1) { wrap.appendChild(el('span', 'llw2-step-line' + (done ? ' is-done' : ''))); }
    });
    return wrap;
  }

  /* ---- SEO / Meta / Publish panes (Phase 1: UI + derived data) ---- */
  function paneSEO() {
    var t = titleVal() || 'Untitled letter';
    var slug = slugify(t);
    var p = el('div', 'llw2-pane llw2-grid', '');
    p.innerHTML =
      '<div class="llw2-col">'
      + card('Search appearance', 'How this letter looks on Google, and its indexing basics.',
          field('Meta title', '<input class="llw2-in" data-seo="meta_title" maxlength="60" placeholder="' + esc(t + ' — $' + (tickersFound()[0] || '').replace('$', '')) + '">', '<span class="llw2-count" data-count="meta_title">0/60</span>')
        + field('Meta description', '<textarea class="llw2-in llw2-ta" data-seo="meta_desc" maxlength="160" placeholder="A concise summary that shows under the headline in search results and social shares."></textarea>', '<span class="llw2-count" data-count="meta_desc">0/160</span>')
        + '<div class="llw2-row2">' + field('URL slug', '<input class="llw2-in" data-seo="slug" value="/letters/' + esc(slug) + '">')
          + field('Canonical URL', '<input class="llw2-in" data-seo="canonical" placeholder="https://stockmarketloop.com/n/…">') + '</div>')
      + card('Targeting & taxonomy', '',
          field('Focus keyword', '<input class="llw2-in" data-seo="keyword" placeholder="' + esc((tickersFound()[0] || '$NVDA').replace('$', '').toLowerCase() + ' stock') + '">')
        + '<div class="llw2-row2">' + field('Category', select('category', ['Markets', 'Earnings', 'Macro', 'Crypto', 'Options', 'Technical']))
          + field('Schema.org type', select('schema', ['NewsArticle', 'Article', 'AnalysisNewsArticle', 'OpinionNewsArticle', 'BlogPosting'])) + '</div>'
        + field('Tags (comma separated)', '<input class="llw2-in" data-seo="tags" placeholder="earnings, nvda, ai, semis">')
        + field('Primary ticker & sentiment', '<div class="llw2-sent"><span class="llw2-tk">$ ' + esc((tickersFound()[0] || 'NVDA').replace('$', '')) + '</span>'
          + '<button type="button" class="llw2-seg" data-sent="bullish">Bullish</button>'
          + '<button type="button" class="llw2-seg is-on" data-sent="neutral">Neutral</button>'
          + '<button type="button" class="llw2-seg is-bear" data-sent="bearish">Bearish</button></div>'))
      + '</div>'
      + '<div class="llw2-col">' + railSEO(t, slug) + navRow('write', 'seo') + '</div>';
    return p;
  }

  function railSEO(t, slug) {
    return '<div class="llw2-card llw2-score">'
      + '<div class="llw2-score-ring" data-ring>12</div>'
      + '<div><b>SEO score</b><span>Needs work — fill the essentials.</span></div></div>'
      + '<div class="llw2-card llw2-meters"><div><small>Keyword</small><b class="bad">0/100</b></div><div><small>Readability</small><b class="good">100/100</b></div></div>'
      + '<div class="llw2-card"><div class="llw2-label">GOOGLE PREVIEW</div>'
      + '<div class="llw2-gp"><div class="llw2-gp-site"><i></i><span>Stock Market Loop<br><small>stockmarketloop.com › letters › ' + esc(slug) + '</small></span></div>'
      + '<div class="llw2-gp-title">' + esc(t) + ' — Stock Market Loop</div>'
      + '<div class="llw2-gp-desc" data-gp-desc>Your meta description preview will appear here as you type. Aim for 70–160 characters.</div></div></div>';
  }

  function paneMeta() {
    var p = el('div', 'llw2-pane llw2-grid', '');
    p.innerHTML =
      '<div class="llw2-col">'
      + card('Social cards', 'Open Graph & X/Twitter metadata for shared links.',
          field('OG title', '<input class="llw2-in" data-meta="og_title" placeholder="Falls back to meta title">')
        + field('OG description', '<textarea class="llw2-in llw2-ta" data-meta="og_desc" placeholder="Falls back to meta description"></textarea>')
        + field('X/Twitter card type', select('twitter', ['summary_large_image', 'summary']))
        + field('Social preview image (1200×630)', '<label class="llw2-drop"><input type="file" accept="image/*" hidden><span>🖼️<br>drop social preview image</span></label>'))
      + card('Newsletter & scheduling', '',
          field('Email subject line', '<input class="llw2-in" data-meta="subject" placeholder="✉️ ' + esc(titleVal() || 'Your letter title') + '">')
        + '<div class="llw2-row2">' + field('Publish date', '<input class="llw2-in" type="date" data-meta="date">') + field('Time', '<input class="llw2-in" type="time" data-meta="time">') + '</div>'
        + '<div class="llw2-row2">' + statBox('Reading time', readMinutes() + ' min') + statBox('Word count', String(wordCount())) + '</div>')
      + '</div>'
      + '<div class="llw2-col">' + railMeta() + navRow('seo', 'meta') + '</div>';
    return p;
  }

  function railMeta() {
    var t = titleVal() || 'Untitled letter';
    var jsonld = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'NewsArticle', headline: t, description: '',
      articleSection: 'Markets', keywords: ['earnings', 'nvda', 'ai', 'semis']
    }, null, 2);
    return '<div class="llw2-card"><div class="llw2-label">SOCIAL CARD PREVIEW</div>'
      + '<div class="llw2-social"><div class="llw2-social-img">1200 × 630 preview</div>'
      + '<div class="llw2-social-b"><small>STOCKMARKETLOOP.COM</small><b>' + esc(t) + ' — Stock Market Loop</b>'
      + '<span>Your meta description preview will appear here as you type. Aim for 70–160 characters.</span></div></div></div>'
      + '<div class="llw2-card"><div class="llw2-label">SCHEMA.ORG JSON-LD</div><pre class="llw2-jsonld" data-jsonld>' + esc(jsonld) + '</pre></div>';
  }

  function panePublish() {
    var checks = [
      { ok: !!titleVal(), label: 'Title set' },
      { ok: false, label: 'Meta description (70–160 chars)' },
      { ok: tickersFound().length > 0, label: 'Primary ticker tagged' },
      { ok: /disclosure/i.test(bodyText()) || !!$('#le-root [data-block] [data-txt]'), label: 'Disclosure included' },
      { ok: false, label: 'SEO score above 70' }
    ];
    var p = el('div', 'llw2-pane', '');
    p.innerHTML = '<div class="llw2-publish">'
      + '<div class="llw2-card llw2-pub-card"><h3>Ready to publish</h3>'
      + '<p class="llw2-pub-sub">' + wordCount() + ' words · ' + readMinutes() + ' min read · ' + esc(visibilityLabel()) + '</p>'
      + '<div class="llw2-checks">' + checks.map(function (c) {
          return '<div class="llw2-check"><span class="llw2-ci ' + (c.ok ? 'ok' : 'warn') + '">' + (c.ok ? '✓' : '!') + '</span>'
            + '<span class="llw2-cl">' + esc(c.label) + '</span><span class="llw2-cs ' + (c.ok ? 'ok' : 'opt') + '">' + (c.ok ? 'Done' : 'Optional') + '</span></div>';
        }).join('') + '</div>'
      + '<div class="llw2-paywall"><div><b>Paywall</b><small>Gate content below the paywall block</small></div>'
      + '<button type="button" class="llw2-switch" data-paywall aria-pressed="false"><span></span></button></div>'
      + '<button type="button" class="llw2-btn llw2-btn-primary llw2-pub-go" data-publish-proxy>Publish letter</button>'
      + '<button type="button" class="llw2-btn llw2-btn-ghost" data-goto="meta">← Back to Meta</button></div>'
      + '<button type="button" class="llw2-btn llw2-btn-ghost llw2-back-letters" data-back-letters>Back to letters</button>'
      + '</div>';
    return p;
  }

  function visibilityLabel() {
    var on = $('#le-side [aria-pressed="true"], #le-side .is-on, #le-side .is-active');
    var t = on ? on.textContent.trim() : 'Public';
    return /member/i.test(t) ? 'Members only' : /follow/i.test(t) ? 'Followers' : 'Public';
  }

  /* ---- small UI builders ---- */
  function card(title, sub, body) {
    return '<div class="llw2-card"><div class="llw2-card-h"><h3>' + esc(title) + '</h3>'
      + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' + body + '</div>';
  }
  function field(label, input, extra) {
    return '<div class="llw2-field"><label>' + esc(label) + (extra || '') + '</label>' + input + '</div>';
  }
  function select(key, opts) {
    return '<select class="llw2-in" data-seo="' + key + '">' + opts.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select>';
  }
  function statBox(label, val) { return '<div class="llw2-statbox"><small>' + esc(label) + '</small><b>' + esc(val) + '</b></div>'; }
  function stepLabel(key) { var s = STEPS.filter(function (x) { return x.key === key; })[0]; return s ? s.label : key; }
  function navRow(back, cur) {
    var nextIdx = STEPS.findIndex(function (s) { return s.key === cur; }) + 1;
    var next = STEPS[nextIdx];
    return '<div class="llw2-nav">'
      + '<button type="button" class="llw2-btn llw2-btn-ghost" data-goto="' + back + '">← ' + esc(stepLabel(back)) + '</button>'
      + (next ? '<button type="button" class="llw2-btn llw2-btn-primary" data-goto="' + next.key + '">Next: ' + esc(next.label) + ' →</button>' : '') + '</div>';
  }

  /* ---- mount / render ---- */
  function mount() {
    if (state.mounted && document.getElementById('llw2')) { return; }
    var root = document.getElementById('le-root');
    var host = root && root.parentElement; // .le-body (the editor+rail grid)
    if (!host) { return; }
    document.body.classList.add('llw2-mode');

    var wrap = el('div', 'llw2');
    wrap.id = 'llw2';
    var stepHost = el('div', 'llw2-stepwrap');
    wrap.appendChild(el('div', 'llw2-stepbar'));
    wrap.appendChild(stepHost);
    host.insertBefore(wrap, root); // full-width row above the editor + rail
    state.mounted = true;
    render();
  }

  function render() {
    var wrap = document.getElementById('llw2');
    if (!wrap) { return; }
    // stepper
    var bar = wrap.querySelector('.llw2-stepbar');
    bar.innerHTML = ''; bar.appendChild(stepperEl());
    // panes host
    var host = wrap.querySelector('.llw2-stepwrap');
    host.innerHTML = '';
    // Write = show core editor + rail; other steps hide them and render a pane
    var writeOn = state.step === 'write';
    var ed = document.getElementById('le-root'); var rl = rail();
    // Off-screen (not display:none) so the core Publish button stays clickable for
    // the step-4 proxy (display:none would null its offsetParent and the handler bails).
    if (ed) { ed.classList.toggle('llw2-off', !writeOn); }
    if (rl) { rl.classList.toggle('llw2-off', !writeOn); }
    if (writeOn) {
      restyleWriteRail();
    } else if (state.step === 'seo') {
      host.appendChild(paneSEO());
    } else if (state.step === 'meta') {
      host.appendChild(paneMeta());
    } else if (state.step === 'publish') {
      host.appendChild(panePublish());
    }
    wireCounts();
  }

  // Replace the core rail's publish panel with a "Draft · N words · Next: SEO" card.
  function restyleWriteRail() {
    var rl = rail(); if (!rl) { return; }
    // Hide the core Publish panel — the design moves publishing to step 4 (proxied).
    var pubBtn = rl.querySelector('[data-publish]');
    var pubPanel = pubBtn ? pubBtn.closest('.le-card') : null;
    if (pubPanel) { pubPanel.classList.add('llw2-off'); }
    var draft = rl.querySelector('.llw2-draftcard');
    if (!draft) {
      draft = el('div', 'llw2-card llw2-draftcard');
      rl.appendChild(draft);
    }
    draft.innerHTML = '<div class="llw2-draft-h"><b>Draft</b><span>' + wordCount() + ' words · ' + readMinutes() + 'm</span></div>'
      + '<button type="button" class="llw2-btn llw2-btn-primary" data-goto="seo">Next: SEO →</button>';
  }

  function wireCounts() {
    document.querySelectorAll('[data-seo="meta_title"],[data-seo="meta_desc"]').forEach(function (inp) {
      var key = inp.getAttribute('data-seo');
      var counter = document.querySelector('[data-count="' + key + '"]');
      var max = inp.getAttribute('maxlength');
      function upd() { if (counter) { counter.textContent = (inp.value.length) + '/' + max; } if (key === 'meta_desc') { var d = document.querySelector('[data-gp-desc]'); if (d && inp.value) { d.textContent = inp.value; } } }
      inp.addEventListener('input', upd); upd();
    });
  }

  function goto(step) {
    if (!STEPS.some(function (s) { return s.key === step; })) { return; }
    state.step = step; render();
    var w = document.getElementById('llw2'); if (w) { w.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  document.addEventListener('click', function (ev) {
    var s = ev.target.closest('[data-step]'); if (s) { goto(s.getAttribute('data-step')); return; }
    var g = ev.target.closest('[data-goto]'); if (g) { ev.preventDefault(); goto(g.getAttribute('data-goto')); return; }
    var sw = ev.target.closest('[data-paywall]'); if (sw) { var on = sw.getAttribute('aria-pressed') === 'true'; sw.setAttribute('aria-pressed', on ? 'false' : 'true'); sw.classList.toggle('is-on', !on); return; }
    var seg = ev.target.closest('[data-sent]'); if (seg) { seg.parentElement.querySelectorAll('[data-sent]').forEach(function (b) { b.classList.remove('is-on'); }); seg.classList.add('is-on'); return; }
    var pub = ev.target.closest('[data-publish-proxy]');
    if (pub) {
      var real = $('#le-side [data-publish], #le-side button.le-publish') || Array.prototype.filter.call(document.querySelectorAll('#le-side button'), function (b) { return /^publish$/i.test(b.textContent.trim()); })[0];
      if (real) { real.click(); }
      return;
    }
    var bl = ev.target.closest('[data-back-letters]');
    if (bl) { var back = document.querySelector('#le-root [data-back]') || document.querySelector('[data-back]'); if (back) { back.click(); } else { window.location.assign(window.location.pathname); } }
  });

  // Boot: mount when the writer view is present; keep in sync as the core editor mutates.
  function tick() {
    if (isWriterView()) { mount(); if (state.step === 'write') { restyleWriteRail(); } }
    else { var w = document.getElementById('llw2'); if (w) { w.remove(); state.mounted = false; document.body.classList.remove('llw2-mode'); } }
  }
  var root = document.getElementById('le-root');
  if (root) { new MutationObserver(function () { window.clearTimeout(tick._t); tick._t = window.setTimeout(tick, 60); }).observe(root, { childList: true, subtree: true }); }
  tick();
})();
