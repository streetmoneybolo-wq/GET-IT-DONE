(function () {
  'use strict';

  var cfg = window.smlGoLiveConfig || {};
  // The standalone /go-live/ renderer can leave its config script inert.
  // Recover only the JSON assigned to smlGoLiveConfig, stopping before the
  // adjacent dashboard assignment instead of parsing the whole script.
  if (!cfg.userId) {
    try {
      var configNode = Array.prototype.slice.call(document.scripts).find(function (script) {
        return (script.textContent || '').indexOf('window.smlGoLiveConfig=') === 0;
      });
      var raw = configNode && (configNode.textContent || '');
      var start = raw.indexOf('window.smlGoLiveConfig=');
      var end = raw.indexOf(';window.smlCreatorDashboardConfig=', start);
      if (start >= 0) {
        var json = raw.slice(start + 'window.smlGoLiveConfig='.length, end > start ? end : undefined).replace(/;\s*$/, '');
        var recovered = JSON.parse(json);
        if (recovered && typeof recovered === 'object') { cfg = recovered; }
      }
    } catch (e) {}
  }
  var state = {
    messages: [],
    chatLoaded: false,
    subscriberCount: null,
    subscriberLoaded: false,
    chatBusy: false,
    subscriberBusy: false,
    template: null,
    subscriberTemplate: null,
    paintQueued: false,
    lastSignature: ''
  };
  var upcoming = { rows: [], busy: false, loadedAt: 0 };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function compact(value) {
    var n = Math.max(0, Number(value) || 0);
    if (n >= 1000000) { return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'; }
    if (n >= 1000) { return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'; }
    return String(Math.round(n));
  }

  function roomHandle() {
    return String(cfg.watchChatHandle || cfg.handle || '')
      .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60);
  }

  function chatUrl() {
    var room = roomHandle();
    return room ? '/wp-json/sml-live-chat/v1/room/' + encodeURIComponent(room) + '/messages?limit=50&_=' + Date.now() : '';
  }

  function relationshipUrl() {
    var creatorId = Number(cfg.userId || 0);
    return creatorId ? '/wp-json/sml-live-studio-real-data/v1/creator-status?creator_id=' + encodeURIComponent(creatorId) + '&_=' + Date.now() : '';
  }

  function upcomingUrl() {
    return '/wp-json/sml-scheduled-live/v1/creator?_=' + Date.now();
  }

  function deleteUpcomingUrl(streamId) {
    return '/wp-json/sml-live-studio-real-data/v1/upcoming/' + encodeURIComponent(streamId);
  }

  function fetchJson(url) {
    var headers = { Accept: 'application/json' };
    if (cfg.nonce) { headers['X-WP-Nonce'] = cfg.nonce; }
    return fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: headers })
      .then(function (response) {
        if (!response.ok) { throw new Error('Request failed'); }
        return response.json();
      });
  }

  function normalizeMessage(raw) {
    raw = raw || {};
    var text = String(raw.body || raw.message || raw.text || '').trim();
    var name = String(raw.display_name || raw.channel_name || raw.handle || raw.user || raw.name || 'Member').replace(/^@/, '');
    var kind = String(raw.kind || raw.type || '').toLowerCase();
    var badge = String(raw.badge || raw.role_label || raw.role || '');
    if (!badge && (kind === 'superchat' || kind === 'super_chat' || raw.super_chat)) { badge = 'Super Chat'; }
    return {
      id: String(raw.id != null ? raw.id : (raw.created_at || raw.created || '') + '-' + (raw.user_id || name)),
      name: name,
      text: text,
      avatar: String(raw.avatar_url || raw.channel_avatar || raw.avatar || ''),
      badge: badge,
      created: raw.created_at || raw.created || raw.time || ''
    };
  }

  function clock(value) {
    var date = new Date(value || '');
    if (!isFinite(date.getTime())) { return ''; }
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function rememberTemplates(root) {
    if (!state.template) {
      var sample = root.querySelector('article');
      if (sample) { state.template = sample.cloneNode(true); }
    }
    if (!state.subscriberTemplate) {
      var count = root.querySelector('.gl-overlay-subscriber-count');
      if (count) { state.subscriberTemplate = count.cloneNode(true); }
    }
  }

  function realArticle(message) {
    var article = state.template ? state.template.cloneNode(true) : document.createElement('article');
    article.setAttribute('data-sml-real-chat', message.id);
    var image = article.querySelector('img');
    if (image) {
      if (/^https:\/\//i.test(message.avatar)) { image.src = message.avatar; image.hidden = false; }
      else { image.remove(); article.classList.add('no-avatar'); }
    }
    var name = article.querySelector('b');
    if (name) { name.textContent = message.name; }
    var body = article.querySelector('p');
    if (body) { body.textContent = message.text; }
    var badge = article.querySelector('small.badge');
    if (badge) {
      if (message.badge) { badge.textContent = message.badge; badge.hidden = false; }
      else { badge.remove(); }
    }
    var smalls = article.querySelectorAll('small:not(.badge)');
    if (smalls.length) {
      var stamp = clock(message.created);
      if (stamp) { smalls[smalls.length - 1].textContent = stamp; }
      else { smalls[smalls.length - 1].remove(); }
    }
    return article;
  }

  function paintRoot(root) {
    rememberTemplates(root);

    var signature = JSON.stringify({
      messages: state.messages.map(function (message) { return [message.id, message.name, message.text, message.avatar, message.badge, message.created]; }),
      subscriberLoaded: state.subscriberLoaded,
      subscriberCount: state.subscriberCount
    });
    if (root.getAttribute('data-sml-real-signature') === signature && !root.querySelector('article:not([data-sml-real-chat])')) { return; }
    root.setAttribute('data-sml-real-signature', signature);

    root.querySelectorAll('article:not([data-sml-real-chat])').forEach(function (node) { node.remove(); });
    root.querySelectorAll('[data-sml-real-chat]').forEach(function (node) { node.remove(); });

    var limit = Math.max(1, Number((cfg.chatOverlaySettings || {}).max_messages) || 5);
    state.messages.slice(-limit).forEach(function (message) { root.appendChild(realArticle(message)); });

    var counter = root.querySelector('.gl-overlay-subscriber-count');
    if (!counter && state.subscriberLoaded) {
      counter = state.subscriberTemplate ? state.subscriberTemplate.cloneNode(true) : document.createElement('div');
      counter.classList.add('gl-overlay-subscriber-count');
      root.insertBefore(counter, root.firstChild);
    }
    if (counter) {
      if (state.subscriberLoaded) {
        counter.textContent = compact(state.subscriberCount) + (Number(state.subscriberCount) === 1 ? ' subscriber' : ' subscribers');
        counter.hidden = false;
      } else {
        counter.hidden = true;
      }
    }
  }

  function paint() {
    state.paintQueued = false;
    document.querySelectorAll('.gl-chat-overlay-preview').forEach(paintRoot);
  }

  function schedulePaint() {
    if (state.paintQueued) { return; }
    state.paintQueued = true;
    window.requestAnimationFrame(paint);
  }

  function normalizeUrl(value) {
    try { return new URL(String(value || ''), window.location.origin).href.replace(/\/$/, ''); }
    catch (e) { return String(value || '').replace(/\/$/, ''); }
  }

  function enhanceUpcomingLibrary() {
    var section = document.querySelector('[data-cs-live-library]');
    if (!section || !upcoming.rows.length) { return; }
    section.querySelectorAll('.cs-live-library-card').forEach(function (card) {
      if (card.querySelector('[data-delete-upcoming]')) { return; }
      var copy = card.querySelector('[data-copy-stream]');
      var url = normalizeUrl(copy && copy.getAttribute('data-copy-stream'));
      var row = upcoming.rows.find(function (item) {
        return item && item.status === 'scheduled' && Date.parse(item.scheduled_at || '') > Date.now() && normalizeUrl(item.watch_url) === url;
      });
      if (!row || !row.id) { return; }
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sml-delete-upcoming';
      button.setAttribute('data-delete-upcoming', String(row.id));
      button.setAttribute('data-stream-title', String(row.title || 'this stream'));
      button.textContent = 'Delete';
      var actions = card.querySelector('.cs-live-library-copy');
      if (actions) { actions.appendChild(button); }
    });
  }

  function loadUpcomingIndex(force) {
    if (upcoming.busy || (!force && Date.now() - upcoming.loadedAt < 15000)) { enhanceUpcomingLibrary(); return; }
    upcoming.busy = true;
    fetchJson(upcomingUrl()).then(function (payload) {
      upcoming.rows = Array.isArray(payload && payload.streams) ? payload.streams : [];
      upcoming.loadedAt = Date.now();
      enhanceUpcomingLibrary();
    }).catch(function () {
      upcoming.rows = [];
    }).then(function () { upcoming.busy = false; });
  }

  function removeUpcomingCard(button, streamId) {
    upcoming.rows = upcoming.rows.filter(function (row) { return String(row && row.id) !== String(streamId); });
    var card = button.closest('.cs-live-library-card');
    var list = card && card.parentElement;
    if (card) { card.remove(); }
    if (list && !list.querySelector('.cs-live-library-card')) {
      var empty = document.createElement('div');
      empty.className = 'cs-dash-empty';
      empty.textContent = 'No upcoming stream is scheduled yet.';
      list.replaceWith(empty);
    }
  }

  function deleteUpcoming(button) {
    var streamId = button.getAttribute('data-delete-upcoming') || '';
    var title = button.getAttribute('data-stream-title') || 'this stream';
    if (!streamId || !window.confirm('Delete "' + title + '"? This cannot be undone.')) { return; }
    button.disabled = true;
    button.textContent = 'Deleting...';
    fetchJsonDelete(deleteUpcomingUrl(streamId)).then(function () {
      removeUpcomingCard(button, streamId);
    }).catch(function (error) {
      button.disabled = false;
      button.textContent = 'Delete';
      window.alert(error && error.message ? error.message : 'The stream could not be deleted.');
    });
  }

  function fetchJsonDelete(url) {
    var headers = { Accept: 'application/json' };
    if (cfg.nonce) { headers['X-WP-Nonce'] = cfg.nonce; }
    return fetch(url, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', headers: headers })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (!response.ok || payload.code) { throw new Error(payload.message || 'The stream could not be deleted.'); }
          return payload;
        });
      });
  }

  function pollChat() {
    var url = chatUrl();
    if (!url || document.hidden || state.chatBusy) { return; }
    state.chatBusy = true;
    fetchJson(url).then(function (payload) {
      var rows = (payload && (payload.messages || payload.items)) || [];
      var seen = {};
      state.messages = [];
      (Array.isArray(rows) ? rows : []).forEach(function (raw) {
        var message = normalizeMessage(raw);
        if (!message.text || seen[message.id]) { return; }
        seen[message.id] = true;
        state.messages.push(message);
      });
      state.chatLoaded = true;
      schedulePaint();
    }).catch(function () {
      state.messages = [];
      state.chatLoaded = false;
      schedulePaint();
    }).then(function () { state.chatBusy = false; });
  }

  function pollSubscribers() {
    var url = relationshipUrl();
    if (!url || document.hidden || state.subscriberBusy) { return; }
    state.subscriberBusy = true;
    fetchJson(url).then(function (payload) {
      state.subscriberCount = Math.max(0, Number(payload && payload.subscriber_count) || 0);
      state.subscriberLoaded = true;
      schedulePaint();
    }).catch(function () {
      state.subscriberLoaded = false;
      schedulePaint();
    }).then(function () { state.subscriberBusy = false; });
  }

  function start() {
    var style = document.createElement('style');
    style.textContent = '.cs-live-library-copy .sml-delete-upcoming{height:34px;border:1px solid #ff566e;border-radius:7px;background:rgba(255,86,110,.1);color:#ff8c9d;font-size:11px;font-weight:850;padding:0 12px;cursor:pointer}.cs-live-library-copy .sml-delete-upcoming:hover{background:#ff566e;color:#fff}.cs-live-library-copy .sml-delete-upcoming:disabled{opacity:.6;cursor:wait}';
    document.head.appendChild(style);
    schedulePaint();
    pollChat();
    pollSubscribers();
    loadUpcomingIndex(true);
    window.setInterval(pollChat, 2500);
    window.setInterval(pollSubscribers, 5000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { pollChat(); pollSubscribers(); }
    });
    document.addEventListener('click', function (event) {
      var button = event.target.closest('[data-delete-upcoming]');
      if (button) { event.preventDefault(); deleteUpcoming(button); }
    });
    new MutationObserver(function () { schedulePaint(); enhanceUpcomingLibrary(); loadUpcomingIndex(false); }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start, { once: true }); }
  else { start(); }
})();
