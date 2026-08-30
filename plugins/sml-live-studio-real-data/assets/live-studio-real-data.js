(function () {
  'use strict';

  var cfg = window.smlGoLiveConfig || {};
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
    return creatorId ? '/wp-json/sml-video-upload-studio/v1/creator-relationship?creator_id=' + encodeURIComponent(creatorId) + '&_=' + Date.now() : '';
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
    if (!counter && state.subscriberTemplate) {
      counter = state.subscriberTemplate.cloneNode(true);
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
    schedulePaint();
    pollChat();
    pollSubscribers();
    window.setInterval(pollChat, 2500);
    window.setInterval(pollSubscribers, 5000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { pollChat(); pollSubscribers(); }
    });
    new MutationObserver(schedulePaint).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start, { once: true }); }
  else { start(); }
})();
