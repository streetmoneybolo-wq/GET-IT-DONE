<?php
/**
 * Loop Letters - editor client script and page renderer for /loop-letters/.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_letters_editor_script')) {
    function sml_letters_editor_script() {
        return <<<'SMLLEJS'
(function () {
  var cfg = window.smlLettersConfig;
  var root = document.getElementById('le-root');
  var side = document.getElementById('le-side');
  var crumb = document.getElementById('le-crumb');
  var saveState = document.getElementById('le-savestate');
  var settingsButton = document.getElementById('le-settings');
  if (!cfg || !root || !side) { return; }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function checked(v) { return v ? ' checked' : ''; }
  function setVal(sel) {
    var el = root.querySelector(sel);
    return el ? el.value : '';
  }
  function setCheck(sel) {
    var el = root.querySelector(sel);
    return !!(el && el.checked);
  }

  function api(path, options) {
    options = options || {};
    var headers = { 'Accept': 'application/json' };
    if (options.json) { headers['Content-Type'] = 'application/json'; }
    if (cfg.nonce) { headers['X-WP-Nonce'] = cfg.nonce; }
    return fetch(cfg.base + path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: headers,
      body: options.json ? JSON.stringify(options.json) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (p) {
        if (!r.ok) { var e = new Error(p.message || 'Request failed.'); e.status = r.status; throw e; }
        return p;
      });
    });
  }

  var view = 'list';
  var letters = [];
  var doc = null;
  var issues = [];
  var publicationSettings = null;
  var publicationStatus = null;
  var saveTimer = null;
  var uid = 0;
  function nextId() { uid += 1; return 'b' + Date.now().toString(36) + uid; }

  /* ---------------- data ---------------- */

  function loadList() {
    return api('/mine').then(function (d) {
      letters = d.letters || [];
      view = 'list';
      doc = null;
      render();
    }).catch(function (e) {
      root.innerHTML = '<section class="cs-card"><h2>Loop Letters</h2><p class="cs-sub">'
        + esc(e.message) + '</p></section>';
      side.innerHTML = '';
    });
  }

  function loadSettings() {
    if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = null; }
    var pending = doc ? save() : Promise.resolve();
    return pending.then(function () { return api('/settings'); }).then(function (d) {
      publicationSettings = d.settings || {};
      publicationStatus = d.status || {};
      view = 'settings';
      doc = null;
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, '', window.location.pathname + '?view=settings');
      }
      render();
    }).catch(function (e) { window.alert(e.message); });
  }

  function saveSettings() {
    var payload = {
      publication_name: setVal('[data-set="publication_name"]'),
      byline_name: setVal('[data-set="byline_name"]'),
      description: setVal('[data-set="description"]'),
      brand_color: setVal('[data-set="brand_color"]'),
      default_visibility: setVal('[data-set="default_visibility"]'),
      default_disclosure: setVal('[data-set="default_disclosure"]'),
      email_delivery: {
        enabled: setCheck('[data-set="email_enabled"]'),
        provider: setVal('[data-set="email_provider"]'),
        from_name: setVal('[data-set="email_from_name"]'),
        from_email: setVal('[data-set="email_from_email"]'),
        reply_to: setVal('[data-set="email_reply_to"]'),
        header_html: setVal('[data-set="email_header_html"]'),
        footer_html: setVal('[data-set="email_footer_html"]'),
        opt_out_url: setVal('[data-set="email_opt_out_url"]'),
        require_confirmation: setCheck('[data-set="email_require_confirmation"]'),
        welcome_free: setVal('[data-set="email_welcome_free"]'),
        welcome_paid: setVal('[data-set="email_welcome_paid"]'),
        expired_email: setVal('[data-set="email_expired"]'),
        renewal_email: setVal('[data-set="email_renewal"]')
      },
      stripe_import: {
        connected: setCheck('[data-set="stripe_connected"]'),
        account_label: setVal('[data-set="stripe_account_label"]'),
        mode: setVal('[data-set="stripe_mode"]'),
        price_ids: setVal('[data-set="stripe_price_ids"]')
      },
      plans: {
        free_enabled: setCheck('[data-set="plan_free_enabled"]'),
        monthly_enabled: setCheck('[data-set="plan_monthly_enabled"]'),
        monthly_name: setVal('[data-set="plan_monthly_name"]'),
        monthly_price: setVal('[data-set="plan_monthly_price"]'),
        monthly_price_id: setVal('[data-set="plan_monthly_price_id"]'),
        annual_enabled: setCheck('[data-set="plan_annual_enabled"]'),
        annual_name: setVal('[data-set="plan_annual_name"]'),
        annual_price: setVal('[data-set="plan_annual_price"]'),
        annual_price_id: setVal('[data-set="plan_annual_price_id"]'),
        founding_enabled: setCheck('[data-set="plan_founding_enabled"]'),
        founding_name: setVal('[data-set="plan_founding_name"]'),
        founding_price: setVal('[data-set="plan_founding_price"]'),
        founding_price_id: setVal('[data-set="plan_founding_price_id"]')
      },
      paywalling: {
        default_paywall: setVal('[data-set="paywall_default"]'),
        allow_search_excerpt: setCheck('[data-set="paywall_search_excerpt"]'),
        paid_preview_words: setVal('[data-set="paywall_preview_words"]')
      },
      billing: {
        tax_region: setVal('[data-set="billing_tax_region"]'),
        vat_note: setVal('[data-set="billing_vat_note"]')
      }
    };
    if (saveState) { saveState.textContent = 'Saving settings...'; }
    return api('/settings', { method: 'POST', json: payload }).then(function (d) {
      publicationSettings = d.settings || payload;
      publicationStatus = d.status || publicationStatus;
      if (saveState) { saveState.textContent = 'Settings saved'; }
      renderSettings();
    }).catch(function (e) {
      if (saveState) { saveState.textContent = 'Settings not saved'; }
      window.alert(e.message);
    });
  }

  function readCsvInput(selector) {
    return new Promise(function (resolve, reject) {
      var input = root.querySelector(selector);
      var file = input && input.files && input.files[0];
      if (!file) { reject(new Error('Choose a CSV file first.')); return; }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.readAsText(file);
    });
  }

  function importSubscriberList() {
    if (saveState) { saveState.textContent = 'Importing subscribers...'; }
    return readCsvInput('[data-subscriber-csv]').then(function (csv) {
      return api('/settings/subscribers/import', { method: 'POST', json: { csv: csv } });
    }).then(function (d) {
      if (saveState) { saveState.textContent = 'Imported ' + Number(d.imported || 0) + ' subscribers'; }
      return loadSettings();
    }).catch(function (e) {
      if (saveState) { saveState.textContent = 'Import failed'; }
      window.alert(e.message);
    });
  }

  function connectStripeImport() {
    if (saveState) { saveState.textContent = 'Saving Stripe connection...'; }
    return saveSettings().then(function () {
      return api('/settings/stripe/connect', {
        method: 'POST',
        json: {
          account_label: setVal('[data-set="stripe_account_label"]'),
          mode: setVal('[data-set="stripe_mode"]')
        }
      });
    }).then(function () {
      if (saveState) { saveState.textContent = 'Stripe import connected'; }
      return loadSettings();
    }).catch(function (e) {
      if (saveState) { saveState.textContent = 'Stripe connection failed'; }
      window.alert(e.message);
    });
  }

  function importStripePaid() {
    if (saveState) { saveState.textContent = 'Importing paid subscriptions...'; }
    return readCsvInput('[data-stripe-csv]').then(function (csv) {
      return api('/settings/stripe/import-paid', { method: 'POST', json: { csv: csv } });
    }).then(function (d) {
      if (saveState) { saveState.textContent = 'Imported ' + Number(d.imported || 0) + ' paid subscriptions'; }
      return loadSettings();
    }).catch(function (e) {
      if (saveState) { saveState.textContent = 'Stripe import failed'; }
      window.alert(e.message);
    });
  }

  function requestInvoiceReport() {
    if (saveState) { saveState.textContent = 'Requesting report...'; }
    return saveSettings().then(function () {
      return api('/settings/invoice-report', {
        method: 'POST',
        json: {
          from: setVal('[data-invoice-from]'),
          to: setVal('[data-invoice-to]')
        }
      });
    }).then(function () {
      if (saveState) { saveState.textContent = 'Invoice report requested'; }
      return loadSettings();
    }).catch(function (e) {
      if (saveState) { saveState.textContent = 'Report request failed'; }
      window.alert(e.message);
    });
  }

  function openLetter(id) {
    return api('/letters/' + id).then(function (d) {
      doc = {
        id: d.id,
        title: d.title || '',
        subtitle: d.subtitle || '',
        blocks: (d.blocks && d.blocks.length) ? d.blocks : [blank('paragraph')],
        visibility: d.visibility === 'paid' ? 'subscribers' : (d.visibility || 'public'),
        status: d.status,
        url: d.url
      };
      doc.blocks.forEach(function (b) { if (!b.id) { b.id = nextId(); } });
      view = 'edit';
      render();
    }).catch(function (e) { window.alert(e.message); });
  }

  function createLetter() {
    api('/letters', { method: 'POST', json: { title: 'Untitled letter' } })
      .then(function (d) { return openLetter(d.letter_id); })
      .catch(function (e) { window.alert(e.message); });
  }

  function markDirty() {
    if (saveState) { saveState.textContent = 'Saving...'; }
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () { saveTimer = null; save(); }, 900);
  }

  function save() {
    if (!doc) { return Promise.resolve(); }
    return api('/letters/' + doc.id, { method: 'POST', json: {
      title: doc.title,
      subtitle: doc.subtitle,
      blocks: doc.blocks,
      visibility: doc.visibility
    } }).then(function () {
      if (saveState) { saveState.textContent = 'Saved'; }
    }).catch(function () {
      if (saveState) { saveState.textContent = 'Save failed - will retry on next edit'; }
    });
  }

  function publish() {
    if (saveState) { saveState.textContent = 'Publishing...'; }
    save().then(function () {
      return api('/letters/' + doc.id + '/publish', { method: 'POST', json: {} });
    }).then(function (d) {
      issues = [];
      doc.status = d.status || 'published';
      if (d.letter && d.letter.url) { doc.url = d.letter.url; }
      if (saveState) { saveState.textContent = 'Published'; }
      renderEditSide();
      if (doc.url) { window.open(doc.url, '_blank'); }
    }).catch(function (e) {
      if (saveState) { saveState.textContent = 'Not published'; }
      issues = [e.message];
      renderEditSide();
    });
  }

  function removeLetter(id, status) {
    var msg = status === 'published'
      ? 'Archive this letter? Published letters keep their performance record.'
      : 'Delete this draft? This cannot be undone.';
    if (!window.confirm(msg)) { return; }
    api('/letters/' + id + '/delete', { method: 'POST', json: {} })
      .then(loadList)
      .catch(function (e) { window.alert(e.message); });
  }

  /* ---------------- blocks ---------------- */

  function blank(type) {
    var b = { id: nextId(), type: type };
    if (type === 'paragraph') { b.spans = [{ text: '' }]; }
    else if (type === 'heading') { b.level = 2; b.text = ''; }
    else if (type === 'quote') { b.text = ''; }
    else if (type === 'list') { b.style = 'bullet'; b.items = ['']; }
    else if (type === 'ticker_card') { b.symbol = ''; }
    else if (type === 'chart') { b.symbol = ''; b.range = '3M'; }
    else if (type === 'levels') { b.symbol = ''; b.entry = ''; b.stop = ''; b.targets = ['', '']; b.timeframe = 'swing'; }
    else if (type === 'watchlist_button') { b.symbols = []; }
    else if (type === 'alert_button') { b.symbol = ''; b.trigger = 'above'; b.price = ''; }
    else if (type === 'disclosure') { b.position = ''; b.size = ''; }
    else if (type === 'custom_code') {
      b.html = '<section class="article-hero">\n  <h2>Your custom section</h2>\n  <p>Build this part of your article with HTML and CSS.</p>\n</section>';
      b.css = '.article-hero { padding: 40px; border-radius: 18px; background: #101820; color: #f7fbff; }\n.article-hero h2 { margin: 0 0 12px; color: #00ff88; }';
      b.height = 720;
    }
    return b;
  }

  function blockText(b) {
    if (b.type === 'paragraph') {
      return (b.spans || []).map(function (s) { return s.text || ''; }).join('');
    }
    if (b.type === 'custom_code') {
      var holder = document.createElement('div');
      holder.innerHTML = b.html || '';
      return holder.textContent || '';
    }
    return b.text || '';
  }

  /** Re-parse $TICKER mentions on every keystroke so bindings track the prose. */
  function parseSpans(text) {
    var spans = [];
    var re = /\$([A-Za-z]{1,6})\b/g;
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) { spans.push({ text: text.slice(last, m.index) }); }
      spans.push({ text: m[0], mark: 'ticker', symbol: m[1].toUpperCase() });
      last = m.index + m[0].length;
    }
    if (last < text.length) { spans.push({ text: text.slice(last) }); }
    return spans.length ? spans : [{ text: text }];
  }

  function setBlockText(b, value) {
    if (b.type === 'paragraph') { b.spans = parseSpans(value); }
    else { b.text = value; }
  }

  function addBlock(type, afterIndex) {
    var b = blank(type);
    if (afterIndex === undefined || afterIndex < 0 || afterIndex >= doc.blocks.length - 1) {
      doc.blocks.push(b);
    } else {
      doc.blocks.splice(afterIndex + 1, 0, b);
    }
    markDirty();
    render();
    var el = root.querySelector('[data-bid="' + b.id + '"] textarea, [data-bid="' + b.id + '"] input');
    if (el) { el.focus(); }
  }

  function moveBlock(index, delta) {
    var to = index + delta;
    if (to < 0 || to >= doc.blocks.length) { return; }
    doc.blocks.splice(to, 0, doc.blocks.splice(index, 1)[0]);
    markDirty();
    render();
  }

  function deleteBlock(index) {
    doc.blocks.splice(index, 1);
    if (!doc.blocks.length) { doc.blocks.push(blank('paragraph')); }
    markDirty();
    render();
  }

  function symbolsInDoc() {
    var out = [];
    doc.blocks.forEach(function (b) {
      if (b.symbol) { out.push(String(b.symbol).toUpperCase()); }
      (b.symbols || []).forEach(function (s) { if (s) { out.push(String(s).toUpperCase()); } });
      (b.spans || []).forEach(function (s) { if (s.mark === 'ticker' && s.symbol) { out.push(s.symbol); } });
      if (b.type === 'custom_code' && b.html) {
        var holder = document.createElement('div');
        holder.innerHTML = b.html;
        var matches = (holder.textContent || '').match(/\$[A-Za-z]{1,6}\b/g) || [];
        matches.forEach(function (s) { out.push(s.slice(1).toUpperCase()); });
      }
    });
    return out.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  }

  function hasBlock(type) {
    return doc.blocks.some(function (b) { return b.type === type; });
  }

  function paywallIndex() {
    for (var i = 0; i < doc.blocks.length; i++) {
      if (doc.blocks[i].type === 'paywall_marker') { return i; }
    }
    return doc.blocks.length;
  }

  function previewWords() {
    return doc.blocks.slice(0, paywallIndex()).reduce(function (n, b) {
      var t = blockText(b) || (b.items || []).join(' ');
      return n + (t ? t.trim().split(/\s+/).filter(Boolean).length : 0);
    }, 0);
  }

  /** Mirrors the server preflight so problems surface before the publish call. */
  function preflight() {
    var out = [];
    if (doc.title.trim().length < 10) { out.push('Give the letter a title of at least 10 characters.'); }
    var customBody = doc.blocks.some(function (b) {
      return b.type === 'custom_code' && blockText(b).trim().length > 0;
    });
    if (!hasBlock('paragraph') && !customBody) { out.push('Add at least one paragraph or HTML & CSS block.'); }
    if (hasBlock('levels') && !hasBlock('disclosure')) {
      out.push('Letters with entry/stop/target levels need a disclosure block stating your position.');
    }
    return out;
  }

  /* ---------------- render: list ---------------- */

  function renderList() {
    if (!cfg.canPublish) {
      root.innerHTML = '<section class="cs-card"><h2>Loop Letters</h2>'
        + '<p class="cs-sub">Loop Letters are open to group owners and admins. '
        + 'Create a group to start publishing.</p>'
        + '<a class="cs-btn cs-btn-primary" href="' + esc(cfg.creatorStudioUrl) + '">Back to Creator Studio</a></section>';
      side.innerHTML = '';
      return;
    }

    var rows = letters.length
      ? letters.map(function (l) {
          var when = String(l.published_at || l.updated_at || '').slice(0, 16).replace('T', ' ');
          var syms = (l.tickers || []).map(function (t) { return '$' + t.symbol; }).join(' ');
          var reads = (l.stats && l.stats.reads) || 0;
          return '<div class="le-item" data-open="' + l.id + '">'
            + '<span class="le-item-main"><b>' + esc(l.title || 'Untitled') + '</b>'
            + '<small>' + esc(when) + (syms ? ' &middot; ' + esc(syms) : '')
            + ' &middot; ' + l.read_minutes + ' min &middot; ' + reads + ' reads</small></span>'
            + '<span class="le-pill ' + esc(l.status) + '">' + esc(String(l.status).toUpperCase()) + '</span>'
            + '<button type="button" class="le-kill" data-del="' + l.id + '" data-status="' + esc(l.status) + '">'
            + (l.status === 'published' ? 'Archive' : 'Delete') + '</button>'
            + '</div>';
        }).join('')
      : '<div class="le-empty">No letters yet. Write your first one.</div>';

    root.innerHTML = '<section class="cs-card">'
      + '<div class="cs-head-row"><div><h2>Loop Letters</h2>'
      + '<p class="cs-sub" style="margin:0">Long-form analysis bound to the tickers you mention.</p></div>'
      + '<button type="button" class="cs-btn cs-btn-primary" data-new>Write a letter</button></div>'
      + '<div class="le-list">' + rows + '</div></section>';

    side.innerHTML = '<div class="le-card"><h4>How distribution works</h4>'
      + '<div class="cs-hint">Type <b>$NVDA</b> anywhere in a letter and it binds to that ticker. '
      + 'Published letters surface on those ticker pages automatically, and each symbol\'s price is '
      + 'recorded at publish time so the call can be scored later.</div></div>'
      + '<div class="le-card"><h4>Visibility options</h4><div class="cs-hint">'
      + '<b>Public</b> - anyone.<br><b>Members only</b> - signed-in users.<br>'
      + '<b>Subscribers</b> - people subscribed to your Loop Letters.'
      + '</div></div>';
  }

  /* ---------------- render: editor ---------------- */

  function blockHtml(b, i) {
    var body = '';
    var label = '';

    switch (b.type) {
      case 'heading':
        body = '<textarea class="le-text h2" data-txt rows="1" placeholder="Heading">' + esc(b.text) + '</textarea>';
        break;
      case 'paragraph':
        body = '<textarea class="le-text" data-txt rows="1" placeholder="Write something. Type $NVDA to tag a ticker.">'
          + esc(blockText(b)) + '</textarea>';
        break;
      case 'quote':
        body = '<textarea class="le-text quote" data-txt rows="1" placeholder="Quote">' + esc(b.text) + '</textarea>';
        break;
      case 'list':
        label = 'LIST - one item per line';
        body = '<textarea class="le-text" data-list rows="1" placeholder="First point">'
          + esc((b.items || []).join('\n')) + '</textarea>';
        break;
      case 'paywall_marker':
        body = '<div class="le-paywall">PAYWALL - everything below is for paying readers</div>';
        break;
      case 'ticker_card':
        label = 'TICKER CARD';
        body = '<div class="le-grid"><div><label>Symbol</label>'
          + '<input class="le-in" data-f="symbol" value="' + esc(b.symbol) + '" placeholder="NVDA"></div></div>';
        break;
      case 'chart':
        label = 'CHART';
        body = '<div class="le-grid">'
          + '<div><label>Symbol</label><input class="le-in" data-f="symbol" value="' + esc(b.symbol) + '" placeholder="NVDA"></div>'
          + '<div><label>Range</label><input class="le-in" data-f="range" value="' + esc(b.range) + '" placeholder="3M"></div>'
          + '</div>';
        break;
      case 'levels':
        label = 'LEVELS - needs a disclosure block';
        body = '<div class="le-grid">'
          + '<div><label>Symbol</label><input class="le-in" data-f="symbol" value="' + esc(b.symbol) + '" placeholder="NVDA"></div>'
          + '<div><label>Entry</label><input class="le-in" data-f="entry" value="' + esc(b.entry) + '"></div>'
          + '<div><label>Stop</label><input class="le-in" data-f="stop" value="' + esc(b.stop) + '"></div>'
          + '<div><label>Timeframe</label><input class="le-in" data-f="timeframe" value="' + esc(b.timeframe) + '"></div>'
          + '<div><label>Target 1</label><input class="le-in" data-t="0" value="' + esc((b.targets || [])[0] || '') + '"></div>'
          + '<div><label>Target 2</label><input class="le-in" data-t="1" value="' + esc((b.targets || [])[1] || '') + '"></div>'
          + '</div>';
        break;
      case 'watchlist_button':
        label = 'WATCHLIST BUTTON';
        body = '<div class="le-grid"><div style="grid-column:span 4"><label>Symbols (comma separated)</label>'
          + '<input class="le-in" data-symbols value="' + esc((b.symbols || []).join(', ')) + '" placeholder="NVDA, AMD"></div></div>';
        break;
      case 'alert_button':
        label = 'ALERT BUTTON';
        body = '<div class="le-grid">'
          + '<div><label>Symbol</label><input class="le-in" data-f="symbol" value="' + esc(b.symbol) + '"></div>'
          + '<div><label>Trigger</label><input class="le-in" data-f="trigger" value="' + esc(b.trigger) + '" placeholder="above"></div>'
          + '<div><label>Price</label><input class="le-in" data-f="price" value="' + esc(b.price) + '"></div>'
          + '</div>';
        break;
      case 'disclosure':
        label = 'DISCLOSURE';
        body = '<div class="le-grid">'
          + '<div style="grid-column:span 3"><label>Your position</label>'
          + '<input class="le-in" data-f="position" value="' + esc(b.position) + '" placeholder="long NVDA / no position"></div>'
          + '<div><label>Size</label><input class="le-in" data-f="size" value="' + esc(b.size) + '" placeholder="starter"></div>'
          + '</div>';
        break;
      case 'custom_code':
        label = 'HTML & CSS — isolated to this article; scripts are disabled';
        body = '<div class="le-code-grid">'
          + '<div><label>HTML</label><textarea class="le-code" data-code="html" spellcheck="false" rows="12" placeholder="<section>...</section>">' + esc(b.html || '') + '</textarea></div>'
          + '<div><label>CSS</label><textarea class="le-code" data-code="css" spellcheck="false" rows="12" placeholder=".your-class { ... }">' + esc(b.css || '') + '</textarea></div>'
          + '</div>'
          + '<div class="le-code-controls"><label>Published block height <input class="le-in" data-code-height type="number" min="320" max="1600" step="20" value="' + esc(b.height || 720) + '"> px</label>'
          + '<span>Preview is sandboxed; JavaScript, forms, embeds, and external CSS imports are not published.</span></div>'
          + '<iframe class="le-code-preview" title="Custom article preview" sandbox="" srcdoc="' + esc(codePreviewDoc(b)) + '"></iframe>';
        break;
      default:
        body = '<div class="le-paywall">' + esc(b.type) + '</div>';
    }

    var boxed = ['ticker_card','chart','levels','watchlist_button','alert_button','disclosure','list','custom_code'].indexOf(b.type) > -1;
    var inner = boxed
      ? '<div class="le-special">' + (label ? '<div class="le-special-head">' + esc(label) + '</div>' : '') + body + '</div>'
      : body;

    return '<div class="le-block" data-bid="' + esc(b.id) + '" data-i="' + i + '">'
      + '<span class="le-handle">'
      + '<button type="button" data-op="up" title="Move up">&#9650;</button>'
      + '<button type="button" data-op="down" title="Move down">&#9660;</button>'
      + '<button type="button" data-op="del" title="Delete">&#10005;</button>'
      + '</span>' + inner + '</div>';
  }

  function codePreviewDoc(b) {
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<style>html,body{margin:0;min-height:100%;background:#071019;color:#e6edf5;font-family:Inter,sans-serif}*{box-sizing:border-box}img,video{max-width:100%;height:auto}'
      + String(b.css || '').replace(/<\/style/gi, '') + '</style></' + 'head><body>' + (b.html || '') + '</' + 'body></' + 'html>';
  }

  function refreshCodePreview(host, b) {
    window.clearTimeout(refreshCodePreview.t);
    refreshCodePreview.t = window.setTimeout(function () {
      var frame = host && host.querySelector('.le-code-preview');
      if (frame) { frame.srcdoc = codePreviewDoc(b); }
    }, 180);
  }

  function renderEditMain() {
    var adds = [['paragraph','Text'],['heading','Heading'],['list','List'],['quote','Quote'],
                ['custom_code','HTML & CSS'],
                ['ticker_card','Ticker card'],['chart','Chart'],['levels','Levels'],
                ['watchlist_button','Watchlist'],['alert_button','Alert'],
                ['disclosure','Disclosure'],['paywall_marker','Paywall']];

    root.innerHTML = '<section class="cs-card">'
      + '<input class="le-title-input" data-title placeholder="Letter title" value="' + esc(doc.title) + '">'
      + '<input class="le-sub-input" data-subtitle placeholder="Optional subtitle" value="' + esc(doc.subtitle) + '">'
      + '<div class="le-blocks">' + doc.blocks.map(blockHtml).join('') + '</div>'
      + '<div class="le-add">'
      + adds.map(function (t) { return '<button type="button" data-add="' + t[0] + '">+ ' + t[1] + '</button>'; }).join('')
      + '</div></section>';

    Array.prototype.forEach.call(root.querySelectorAll('textarea'), autosize);
  }

  function renderEditSide() {
    issues = preflight();
    var syms = symbolsInDoc();
    var vis = [['public','Public'],['members','Members only'],['subscribers','Subscribers']];

    side.innerHTML = '<div class="le-card"><h4>Tickers</h4>'
      + (syms.length
          ? '<div class="le-chips">' + syms.map(function (s, i) {
              return '<span class="le-chip' + (i === 0 ? ' primary' : '') + '">$' + esc(s) + '</span>';
            }).join('') + '</div>'
          : '<div class="cs-hint">Type $NVDA in your text or add a ticker block. The first symbol becomes primary.</div>')
      + '</div>'

      + '<div class="le-card"><h4>Visibility</h4><div class="le-vis">'
      + vis.map(function (v) {
          return '<button type="button" data-vis="' + v[0] + '" class="' + (doc.visibility === v[0] ? 'on' : '') + '">'
            + v[1] + '</button>';
        }).join('') + '</div></div>'

      + '<div class="le-card"><h4>Publish</h4>'
      + '<div class="cs-hint">' + previewWords() + ' words</div>'
      + (issues.length
          ? '<div class="le-issues">' + issues.map(esc).join('<br>') + '</div>'
          : '<div class="le-issues le-ok">Ready to publish.</div>')
      + '<button type="button" class="cs-btn cs-btn-primary cs-btn-wide" style="margin-top:12px" data-publish'
      + (issues.length ? ' disabled' : '') + '>'
      + (doc.status === 'published' ? 'Update letter' : 'Publish') + '</button>'
      + (doc.status === 'published' && doc.url
          ? '<a class="cs-btn cs-btn-wide" style="margin-top:8px" href="' + esc(doc.url) + '" target="_blank" rel="noopener">View live</a>'
          : '')
      + '<button type="button" class="cs-btn cs-btn-wide" style="margin-top:8px" data-back>Back to letters</button>'
      + '</div>';
  }

  function autosize(t) {
    t.style.height = 'auto';
    t.style.height = (t.scrollHeight + 2) + 'px';
  }

  function renderSettings() {
    var s = publicationSettings || {};
    var st = publicationStatus || {};
    var email = s.email_delivery || {};
    var stripe = s.stripe_import || {};
    var plans = s.plans || {};
    var paywall = s.paywalling || {};
    var billing = s.billing || {};
    var reports = (s.invoice_reports && s.invoice_reports.requests) ? s.invoice_reports.requests : [];
    if (crumb) { crumb.textContent = 'Newsletter Settings'; }
    root.innerHTML = '<section class="cs-card"><div class="cs-head-row"><div><h2>Newsletter Settings</h2>'
      + '<p class="cs-sub" style="margin:0">Control publication branding, email delivery, subscriber imports, paid plans, paywalls, and billing reports.</p></div>'
      + '<button type="button" class="cs-btn" data-settings-back>Back to letters</button></div>'
      + '<div class="le-settings-section"><h3>Publication</h3>'
      + '<div class="le-settings-grid">'
      + '<div class="le-settings-field"><label>Publication name</label><input data-set="publication_name" maxlength="100" value="' + esc(s.publication_name) + '"></div>'
      + '<div class="le-settings-field"><label>Author byline</label><input data-set="byline_name" maxlength="100" value="' + esc(s.byline_name) + '"></div>'
      + '<div class="le-settings-field wide"><label>Publication description</label><textarea data-set="description" maxlength="500" placeholder="Tell readers what your publication covers.">' + esc(s.description) + '</textarea></div>'
      + '<div class="le-settings-field"><label>Brand color</label><input data-set="brand_color" type="color" value="' + esc(s.brand_color || '#2b6cff') + '"></div>'
      + '<div class="le-settings-field"><label>Default audience for new letters</label><select data-set="default_visibility">'
      + [['public','Public'],['members','Members only'],['subscribers','Subscribers']].map(function (v) { return '<option value="' + v[0] + '"' + (s.default_visibility === v[0] ? ' selected' : '') + '>' + v[1] + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="le-settings-field wide"><label>Default disclosure</label><textarea data-set="default_disclosure" maxlength="500" placeholder="Example: No current position. This is not financial advice.">' + esc(s.default_disclosure) + '</textarea><div class="cs-hint">Added automatically as a disclosure block when you create a new letter.</div></div>'
      + '</div></div>'
      + '<div class="le-settings-section"><h3>Email delivery</h3><p class="cs-hint">Connect the newsletter delivery profile, import an audience list, and set the message templates readers receive.</p>'
      + '<div class="le-settings-grid">'
      + '<label class="le-check wide"><input type="checkbox" data-set="email_enabled"' + checked(email.enabled) + '> Enable email delivery for Loop Letters</label>'
      + '<div class="le-settings-field"><label>Delivery provider</label><select data-set="email_provider">'
      + [['manual','Manual / pending'],['mailchimp','Mailchimp'],['sendgrid','SendGrid'],['resend','Resend'],['smtp','SMTP']].map(function (v) { return '<option value="' + v[0] + '"' + ((email.provider || 'manual') === v[0] ? ' selected' : '') + '>' + v[1] + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="le-settings-field"><label>Email sender name</label><input data-set="email_from_name" value="' + esc(email.from_name) + '" placeholder="Publication or creator name"></div>'
      + '<div class="le-settings-field"><label>From email</label><input data-set="email_from_email" type="email" value="' + esc(email.from_email) + '" placeholder="name@example.com"></div>'
      + '<div class="le-settings-field"><label>Reply-to email</label><input data-set="email_reply_to" type="email" value="' + esc(email.reply_to) + '" placeholder="reply@example.com"></div>'
      + '<div class="le-settings-field wide"><label>Opt-out / unsubscribe page</label><input data-set="email_opt_out_url" value="' + esc(email.opt_out_url) + '" placeholder="https://stockmarketloop.com/newsletter-opt-out/"></div>'
      + '<label class="le-check wide"><input type="checkbox" data-set="email_require_confirmation"' + checked(email.require_confirmation !== false) + '> Require confirmation before adding uploaded contacts</label>'
      + '<div class="le-settings-field wide"><label>Email header HTML</label><textarea data-set="email_header_html" placeholder="Optional branded header shown above the letter.">' + esc(email.header_html) + '</textarea></div>'
      + '<div class="le-settings-field wide"><label>Email footer HTML</label><textarea data-set="email_footer_html" placeholder="Required legal footer, unsubscribe wording, and support links.">' + esc(email.footer_html) + '</textarea></div>'
      + '<div class="le-settings-field wide"><label>Welcome email for free readers</label><textarea data-set="email_welcome_free" placeholder="Thanks for subscribing — here is what to expect.">' + esc(email.welcome_free) + '</textarea></div>'
      + '<div class="le-settings-field wide"><label>Welcome email for paid subscribers</label><textarea data-set="email_welcome_paid" placeholder="Thanks for becoming a paid subscriber.">' + esc(email.welcome_paid) + '</textarea></div>'
      + '<div class="le-settings-field wide"><label>Expired subscription email</label><textarea data-set="email_expired" placeholder="Your subscription expired — here is how to restore access.">' + esc(email.expired_email) + '</textarea></div>'
      + '<div class="le-settings-field wide"><label>Renewal reminder email</label><textarea data-set="email_renewal" placeholder="Your subscription renewal is coming up.">' + esc(email.renewal_email) + '</textarea></div>'
      + '<div class="le-settings-field wide"><label>Upload subscriber CSV</label><input type="file" accept=".csv,text/csv" data-subscriber-csv><div class="cs-hint">Accepted columns: email, name. Imported contacts are saved to this publication audience.</div><button type="button" class="cs-btn" data-import-subscribers>Import uploaded list</button></div>'
      + '</div></div>'
      + '<div class="le-settings-section"><h3>Stripe paid subscriptions</h3><p class="cs-hint">Connect a Stripe account label, map your price IDs, then import paid subscribers from a Stripe export.</p>'
      + '<div class="le-settings-grid">'
      + '<label class="le-check wide"><input type="checkbox" data-set="stripe_connected"' + checked(stripe.connected) + '> Stripe import connected</label>'
      + '<div class="le-settings-field"><label>Stripe account label</label><input data-set="stripe_account_label" value="' + esc(stripe.account_label) + '" placeholder="Creator Stripe account"></div>'
      + '<div class="le-settings-field"><label>Mode</label><select data-set="stripe_mode"><option value="test"' + ((stripe.mode || 'test') === 'test' ? ' selected' : '') + '>Test</option><option value="live"' + (stripe.mode === 'live' ? ' selected' : '') + '>Live</option></select></div>'
      + '<div class="le-settings-field wide"><label>Stripe price IDs</label><textarea data-set="stripe_price_ids" placeholder="price_... one per line, or paste labels next to each price ID.">' + esc(stripe.price_ids) + '</textarea></div>'
      + '<div class="le-settings-field wide"><button type="button" class="cs-btn" data-connect-stripe>Save Stripe connection</button></div>'
      + '<div class="le-settings-field wide"><label>Import paid subscriptions CSV</label><input type="file" accept=".csv,text/csv" data-stripe-csv><div class="cs-hint">Use a Stripe customer/subscription export with email/name columns. Imported rows become paid publication subscribers.</div><button type="button" class="cs-btn" data-import-stripe-paid>Import paid subscriptions</button></div>'
      + '</div></div>'
      + '<div class="le-settings-section"><h3>Plans, billing, and paywalling</h3>'
      + '<div class="le-settings-grid">'
      + '<label class="le-check wide"><input type="checkbox" data-set="plan_free_enabled"' + checked(plans.free_enabled !== false) + '> Free reader plan enabled</label>'
      + '<label class="le-check"><input type="checkbox" data-set="plan_monthly_enabled"' + checked(plans.monthly_enabled) + '> Monthly plan</label>'
      + '<label class="le-check"><input type="checkbox" data-set="plan_annual_enabled"' + checked(plans.annual_enabled) + '> Annual plan</label>'
      + '<div class="le-settings-field"><label>Monthly name</label><input data-set="plan_monthly_name" value="' + esc(plans.monthly_name || 'Monthly') + '"></div>'
      + '<div class="le-settings-field"><label>Monthly price</label><input data-set="plan_monthly_price" value="' + esc(plans.monthly_price) + '" placeholder="$9.99"></div>'
      + '<div class="le-settings-field wide"><label>Monthly Stripe price ID</label><input data-set="plan_monthly_price_id" value="' + esc(plans.monthly_price_id) + '" placeholder="price_..."></div>'
      + '<div class="le-settings-field"><label>Annual name</label><input data-set="plan_annual_name" value="' + esc(plans.annual_name || 'Annual') + '"></div>'
      + '<div class="le-settings-field"><label>Annual price</label><input data-set="plan_annual_price" value="' + esc(plans.annual_price) + '" placeholder="$99"></div>'
      + '<div class="le-settings-field wide"><label>Annual Stripe price ID</label><input data-set="plan_annual_price_id" value="' + esc(plans.annual_price_id) + '" placeholder="price_..."></div>'
      + '<label class="le-check wide"><input type="checkbox" data-set="plan_founding_enabled"' + checked(plans.founding_enabled) + '> Founding / lifetime-style plan enabled</label>'
      + '<div class="le-settings-field"><label>Founding plan name</label><input data-set="plan_founding_name" value="' + esc(plans.founding_name || 'Founding Member') + '"></div>'
      + '<div class="le-settings-field"><label>Founding price</label><input data-set="plan_founding_price" value="' + esc(plans.founding_price) + '"></div>'
      + '<div class="le-settings-field wide"><label>Founding Stripe price ID</label><input data-set="plan_founding_price_id" value="' + esc(plans.founding_price_id) + '"></div>'
      + '<div class="le-settings-field"><label>Default paywall</label><select data-set="paywall_default">'
      + [['preview_then_subscribe','Preview then subscribe'],['intro_only','Intro only'],['locked_until_paid','Locked until paid']].map(function (v) { return '<option value="' + v[0] + '"' + ((paywall.default_paywall || 'preview_then_subscribe') === v[0] ? ' selected' : '') + '>' + v[1] + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="le-settings-field"><label>Paid preview words</label><input data-set="paywall_preview_words" type="number" min="0" max="1500" value="' + esc(paywall.paid_preview_words == null ? 250 : paywall.paid_preview_words) + '"></div>'
      + '<label class="le-check wide"><input type="checkbox" data-set="paywall_search_excerpt"' + checked(paywall.allow_search_excerpt !== false) + '> Allow search engines to see public excerpts</label>'
      + '<div class="le-settings-field"><label>Tax / VAT region</label><input data-set="billing_tax_region" value="' + esc(billing.tax_region) + '" placeholder="United States, EU, UK..."></div>'
      + '<div class="le-settings-field wide"><label>Billing notes for tax/VAT</label><textarea data-set="billing_vat_note" placeholder="Internal notes for tax and VAT reporting.">' + esc(billing.vat_note) + '</textarea></div>'
      + '</div></div>'
      + '<div class="le-settings-section"><h3>Subscription invoice reports</h3><p class="cs-hint">Request invoice reports over a chosen period to help with sales tax and VAT obligations.</p>'
      + '<div class="le-settings-grid">'
      + '<div class="le-settings-field"><label>Start date</label><input type="date" data-invoice-from></div>'
      + '<div class="le-settings-field"><label>End date</label><input type="date" data-invoice-to></div>'
      + '<div class="le-settings-field wide"><button type="button" class="cs-btn" data-request-invoice-report>Request new report</button></div>'
      + '<div class="le-settings-field wide"><label>Recent report requests</label><div class="le-report-list">'
      + (reports.length ? reports.slice(0, 6).map(function (r) { return '<div><b>' + esc(r.from) + ' → ' + esc(r.to) + '</b><span>' + esc(r.status || 'requested') + '</span></div>'; }).join('') : '<em>No reports requested yet.</em>')
      + '</div></div>'
      + '</div></div>'
      + '<button type="button" class="cs-btn cs-btn-primary" style="margin-top:18px" data-settings-save>Save newsletter settings</button></section>';

    side.innerHTML = '<div class="le-card"><h4>Newsletter readiness</h4>'
      + '<div class="le-status"><span>Website and ticker delivery</span><b class="ok">Active</b></div>'
      + '<div class="le-status"><span>Audience source</span><b>Subscribers</b></div>'
      + '<div class="le-status"><span>Current subscribers</span><b>' + Number(st.subscriber_count || 0) + '</b></div>'
      + '<div class="le-status"><span>Uploaded subscribers</span><b>' + Number(st.imported_subscriber_count || 0) + '</b></div>'
      + '<div class="le-status"><span>Email delivery</span><b class="' + (st.email_delivery ? 'ok' : 'off') + '">' + (st.email_delivery ? 'Enabled' : 'Not connected') + '</b></div>'
      + '<div class="le-status"><span>Provider</span><b>' + esc(st.email_provider || 'manual') + '</b></div>'
      + '<div class="le-status"><span>Stripe import</span><b class="' + (st.stripe_connected ? 'ok' : 'off') + '">' + (st.stripe_connected ? 'Connected' : 'Not connected') + '</b></div>'
      + '<div class="le-status"><span>Invoice reports</span><b>' + Number(st.invoice_report_count || 0) + '</b></div></div>'
      + '<div class="le-card"><h4>Workflow</h4><div class="cs-hint">1) Set sender details. 2) Upload a reader list or import paid subscribers. 3) Map Stripe price IDs to plans. 4) Use paywalls on paid letters. 5) Request invoice reports when needed.</div></div>';
  }

  function render() {
    if (view === 'settings') {
      renderSettings();
    } else if (view === 'edit' && doc) {
      if (crumb) { crumb.textContent = doc.title || 'Untitled'; }
      renderEditMain();
      renderEditSide();
    } else {
      if (crumb) { crumb.textContent = 'Loop Letters'; }
      renderList();
    }
  }

  /* ---------------- events ---------------- */

  if (settingsButton) {
    settingsButton.addEventListener('click', function () { loadSettings(); });
  }

  root.addEventListener('click', function (e) {
    if (e.target.closest('[data-settings-back]')) {
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      loadList(); return;
    }
    if (e.target.closest('[data-settings-save]')) { saveSettings(); return; }
    if (e.target.closest('[data-import-subscribers]')) { importSubscriberList(); return; }
    if (e.target.closest('[data-connect-stripe]')) { connectStripeImport(); return; }
    if (e.target.closest('[data-import-stripe-paid]')) { importStripePaid(); return; }
    if (e.target.closest('[data-request-invoice-report]')) { requestInvoiceReport(); return; }
    if (e.target.closest('[data-new]')) { createLetter(); return; }

    var del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      removeLetter(Number(del.getAttribute('data-del')), del.getAttribute('data-status'));
      return;
    }
    var open = e.target.closest('[data-open]');
    if (open) { openLetter(Number(open.getAttribute('data-open'))); return; }

    var add = e.target.closest('[data-add]');
    if (add) { addBlock(add.getAttribute('data-add'), doc.blocks.length - 1); return; }

    var op = e.target.closest('[data-op]');
    if (op) {
      var host = op.closest('[data-i]');
      if (!host) { return; }
      var i = Number(host.getAttribute('data-i'));
      var kind = op.getAttribute('data-op');
      if (kind === 'up') { moveBlock(i, -1); }
      else if (kind === 'down') { moveBlock(i, 1); }
      else { deleteBlock(i); }
    }
  });

  side.addEventListener('click', function (e) {
    if (e.target.closest('[data-back]')) { save().then(loadList); return; }
    if (e.target.closest('[data-publish]')) { publish(); return; }
    var v = e.target.closest('[data-vis]');
    if (v) {
      doc.visibility = v.getAttribute('data-vis');
      markDirty();
      renderEditSide();
    }
  });

  // Only the sidebar is repainted while typing, so caret and focus in the body survive.
  function queueSide() {
    window.clearTimeout(queueSide.t);
    queueSide.t = window.setTimeout(function () {
      if (view === 'edit' && doc) { renderEditSide(); }
    }, 350);
  }

  root.addEventListener('input', function (e) {
    var t = e.target;
    if (!doc) { return; }

    if (t.matches('[data-title]')) { doc.title = t.value; markDirty(); queueSide(); return; }
    if (t.matches('[data-subtitle]')) { doc.subtitle = t.value; markDirty(); return; }

    var host = t.closest('[data-i]');
    if (!host) { return; }
    var b = doc.blocks[Number(host.getAttribute('data-i'))];
    if (!b) { return; }

    if (t.matches('[data-txt]')) { setBlockText(b, t.value); autosize(t); markDirty(); queueSide(); return; }
    if (t.matches('[data-list]')) { b.items = t.value.split('\n'); autosize(t); markDirty(); queueSide(); return; }
    if (t.matches('[data-code]')) {
      b[t.getAttribute('data-code')] = t.value;
      markDirty(); refreshCodePreview(host, b); queueSide(); return;
    }
    if (t.matches('[data-code-height]')) {
      b.height = Math.max(320, Math.min(1600, Number(t.value) || 720));
      markDirty(); return;
    }
    if (t.matches('[data-symbols]')) {
      b.symbols = t.value.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
      markDirty(); queueSide(); return;
    }
    var tIdx = t.getAttribute('data-t');
    if (tIdx !== null) {
      b.targets = b.targets || [];
      b.targets[Number(tIdx)] = t.value;
      markDirty(); return;
    }
    var f = t.getAttribute('data-f');
    if (f) {
      b[f] = (f === 'symbol') ? t.value.toUpperCase() : t.value;
      markDirty(); queueSide(); return;
    }
  });

  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey || !doc) { return; }
    if (!e.target.matches('[data-txt]')) { return; }
    var host = e.target.closest('[data-i]');
    if (!host) { return; }
    var i = Number(host.getAttribute('data-i'));
    var b = doc.blocks[i];
    if (b && (b.type === 'paragraph' || b.type === 'heading')) {
      e.preventDefault();
      addBlock('paragraph', i);
    }
  });

  window.addEventListener('beforeunload', function () {
    if (saveTimer) { window.clearTimeout(saveTimer); save(); }
  });

  if (new URLSearchParams(window.location.search).get('view') === 'settings') {
    loadSettings();
  } else {
    loadList();
  }
})();
SMLLEJS;
    }
}

if (!function_exists('sml_letters_render_editor')) {
    function sml_letters_render_editor() {
        $config = sml_letters_editor_config();

        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=' . get_bloginfo('charset'));

        echo '<!doctype html><html ' . get_language_attributes() . '><head>';
        echo '<meta charset="' . esc_attr(get_bloginfo('charset')) . '">';
        echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
        echo '<meta name="robots" content="noindex,nofollow">';
        echo '<title>Loop Letters - Creator Studio - ' . esc_html(get_bloginfo('name')) . '</title>';
        echo '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
        echo '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
        echo '<style>' . sml_cs_styles() . sml_letters_editor_styles() . '</style></head><body>';

        if (!is_user_logged_in()) {
            echo '<div class="cs-gate"><h1>Sign in to write</h1>';
            echo '<p>Loop Letters publish to your profile and to the ticker pages you mention, so they need an account.</p>';
            echo '<a class="cs-btn cs-btn-primary" href="' . esc_url($config['loginUrl']) . '">Sign in to continue</a>';
            echo '</div></body></html>';
            exit;
        }

        echo '<div class="cs-shell">';

        echo '<aside class="cs-side"><a class="cs-brand" href="' . esc_url(home_url('/')) . '">';
        echo '<svg width="32" height="32" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="#2b6cff" stroke-width="2.4"/><path d="M11 25.5l5.4-6.2 4 3.6 7.4-9" stroke="#2b6cff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        echo '<b>StockMarket<em>Loop</em></b></a>';
        echo '<div class="cs-side-label">CREATOR STUDIO</div><nav class="cs-nav">';
        $newsletter_settings_open = isset($_GET['view']) && sanitize_key((string) $_GET['view']) === 'settings';
        foreach (sml_cs_nav_items() as $item) {
            $item_url = $item['key'] === 'settings'
                ? add_query_arg('view', 'settings', home_url('/creator-studio/loop-letters/write/'))
                : $item['url'];
            $active = (($item['key'] === 'settings' && $newsletter_settings_open)
                || ($item['key'] === 'letters' && !$newsletter_settings_open)) ? ' class="cs-on"' : '';
            echo '<a href="' . esc_url($item_url) . '"' . $active . '>' . sml_cs_nav_icon($item['key']) . esc_html($item['label']) . '</a>';
        }
        echo '</nav>';
        echo '<div class="cs-help"><b>Write what you trade</b>';
        echo '<p>Letters bind to the tickers you mention and land on those ticker pages automatically.</p>';
        echo '<a href="' . esc_url(home_url('/creator-studio/')) . '">Open Creator Studio</a></div></aside>';

        echo '<div class="cs-main">';
        echo '<header class="cs-top"><div class="cs-crumb">Creator Studio<span>/</span><b id="le-crumb">Loop Letters</b></div>';
        echo '<div class="cs-autosave"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.6 2.6L16 9.6"/></svg>';
        echo '<span id="le-savestate">Autosaves as you type</span></div>';
        echo '<button type="button" class="cs-top-btn" id="le-settings">Newsletter settings</button>';
        echo '<a class="cs-top-btn" href="' . esc_url(home_url('/upload-video/')) . '">Upload video</a>';
        echo '<a class="cs-avatar" href="' . esc_url(home_url('/creator-studio/')) . '"><img src="' . esc_url($config['avatar']) . '" alt="">';
        echo '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8798ac" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 5.5 6-5.5"/></svg></a>';
        echo '</header>';

        echo '<div class="le-body"><main class="le-main" id="le-root"></main><aside class="le-side" id="le-side"></aside></div>';
        echo '</div></div>';

        echo '<script>window.smlLettersConfig=' . wp_json_encode($config) . ';</script>';
        echo '<script>' . sml_letters_editor_script() . '</script>';
        echo '</body></html>';
        exit;
    }
}

if (!function_exists('sml_letters_intercept_editor')) {
    function sml_letters_intercept_editor() {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        $path = trim((string) wp_parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
        if ($path !== 'loop-letters' || isset($_GET['classic'])) {
            return;
        }
        sml_letters_render_editor();
    }
}
add_action('template_redirect', 'sml_letters_intercept_editor', 0);
