<?php
/**
 * Go Live studio - client script and page renderer.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_gl_script')) {
    function sml_gl_script() {
        return <<<'SMLGLJS'
(function () {
  var cfg = window.smlGoLiveConfig || {};
  // Some cached custom-page renderers insert the config script as inert HTML.
  // Recover the JSON before falling back so nonce, user and source URLs survive.
  if (!window.smlGoLiveConfig) {
    try {
      var inertConfigScript = Array.prototype.slice.call(document.scripts).find(function (script) {
        return (script.textContent || '').indexOf('window.smlGoLiveConfig=') >= 0;
      });
      var configText = inertConfigScript && (inertConfigScript.textContent || '').replace(/^\s*window\.smlGoLiveConfig=/, '').replace(/;\s*$/, '');
      var parsedConfig = configText ? JSON.parse(configText) : null;
      if (parsedConfig && typeof parsedConfig === 'object') { cfg = parsedConfig; }
    } catch (e) {}
  }
  // Keep the chat editor usable while an older cached page config expires.
  if (!cfg.nonce) {
    try {
      var configScript = Array.prototype.slice.call(document.scripts).find(function (script) {
        return (script.textContent || '').indexOf('window.smlGoLiveConfig=') >= 0;
      });
      var nonceMatch = configScript && (configScript.textContent || '').match(/"nonce":"([^"]+)"/);
      if (nonceMatch) { cfg.nonce = nonceMatch[1]; }
    } catch (e) {}
  }
  cfg.chatOverlayEndpoint = cfg.chatOverlayEndpoint || '/wp-json/sml-video-upload-studio/v1/chat-overlay-settings';
  cfg.chatOverlaySettings = cfg.chatOverlaySettings || {};
  cfg.chatOverlayFonts = cfg.chatOverlayFonts || ['Inter'];
  var content = document.getElementById('gl-setup');
  var middle = document.getElementById('gl-middle');
  var rail = document.getElementById('gl-rail');
  var stepper = document.getElementById('gl-steps');
  var autosave = document.getElementById('gl-autosave-label');
  if (!content) { return; }

  var KEY = 'sml-go-live-draft-v1';
  var FRESH_AFTER_SCHEDULE_KEY = 'sml-go-live-fresh-after-schedule-v1';
  var COMING = 'Coming soon - no backend for this yet';

  var STEPS = [
    { label: 'Stream Setup', sub: 'Create your live stream' },
    { label: 'Scene & Sources', sub: 'Configure your scenes' },
    { label: 'Stream Settings', sub: 'Audio, video & quality' },
    { label: 'Audience & Options', sub: 'Chat, polls & alerts' },
    { label: 'Go Live', sub: 'Start streaming' }
  ];

  var AUDIENCES = [
    { key: 'public', label: 'Public', sub: 'Anyone can watch', icon: 'globe' },
    { key: 'unlisted', label: 'Unlisted', sub: 'Only people with the link', icon: 'eye' },
    { key: 'followers', label: 'Followers', sub: 'Only your followers', icon: 'user' },
    { key: 'subscribers', label: 'Subscribers', sub: 'Free subscribers only', icon: 'users' },
    { key: 'premium', label: 'Premium Members', sub: 'Paid members only', icon: 'star' },
    { key: 'group', label: 'Group Only', sub: 'Selected groups', icon: 'groups' }
  ];

  var ENGAGEMENT = [
    { key: 'chat', label: 'Live Chat', icon: 'chat' },
    { key: 'polls', label: 'Live Polls', icon: 'poll' },
    { key: 'emotes', label: 'Emotes', icon: 'smile' },
    { key: 'qa', label: 'Live Q&A', icon: 'help' },
    { key: 'viewers', label: 'Viewer Count', icon: 'eye' }
  ];

  var MONETIZATION = [
    { key: 'superchat', label: 'Super Chat', icon: 'chat' },
    { key: 'stickers', label: 'Super Stickers', icon: 'smile' },
    { key: 'memberships', label: 'Memberships', icon: 'star' },
    { key: 'affiliate', label: 'Affiliate Links', icon: 'link' }
  ];

  function defaults() {
    return {
      step: 0,
      title: '', description: '',
      category: 'Finance / Stock Market',
      contentType: 'Live Market Analysis',
      ticker: '', tickerName: '', related: [],
      thumbUrl: '',
      schedule: 'now', scheduleDate: '', scheduleTime: '',
      audience: 'public',
      groupId: 0, groupName: '',
      scene: 'camera',
      videoDeviceId: '', audioDeviceId: '',
      resolution: '1280x720', framerate: 30,
      echoCancel: true, noiseSuppress: true,
      engagement: { chat: true, polls: true, emotes: true, qa: true, viewers: true },
      monetization: { superchat: false, stickers: false, memberships: false, affiliate: false },
      orbitCards: Array.isArray(cfg.orbitSettings && cfg.orbitSettings.items) ? cfg.orbitSettings.items.slice(0, 3) : [],
      orbitEnabled: !!(cfg.orbitSettings && cfg.orbitSettings.enabled),
      live: null
    };
  }

  var draft = defaults();
  var stream = null;
  var recorder = null;
  var recordedChunks = [];
  var devices = { video: [], audio: [] };
  var groups = [];
  var quote = null;
  var movers = [];
  // Market cards update independently of the studio preview.  Never use a
  // full render for timed refreshes: that would replace <video>, detach the
  // active MediaStream and make the camera flash.
  var previewMarketRefreshTimer = null;
  var lastMoversRefreshAt = 0;
  var audioCtx = null, analyser = null, meterRaf = null;
  var pollTimer = null;
  var liveStats = { viewers: 0, startedAt: 0 };
  var moneySettings = cfg.monetizationSettings || null;
  var moneyCapabilities = { superchat: true, stickers: false, memberships: true, affiliate: true };
  var overlaySettings = normalizeOverlay(cfg.chatOverlaySettings || {});
  /* The dashboard and the Watch Page deliberately use one creator-handle room. */
  var creatorChat = { items: [], seen: {}, timer: null, busy: false, loaded: false };

  /* ---------------- utils ---------------- */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function compact(n) {
    n = Number(n) || 0;
    if (n >= 1e6) { return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; }
    if (n >= 1e3) { return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; }
    return String(Math.round(n));
  }

  function clock(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    var pad = function (v) { return v < 10 ? '0' + v : String(v); };
    return (h ? h + ':' : '') + pad(m) + ':' + pad(s);
  }

  function money(v) {
    return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function overlayDefaults() {
    return {
      enabled: false, position: 'bottom_left', x: 4, y: 64, width: 430,
      max_messages: 5, font_family: 'Inter', font_size: 18, font_weight: 600,
      text_color: '#f4f7fb', name_color: '#5eead4', accent_color: '#22d97a',
      background_color: '#07111c', background_opacity: 82, corner_radius: 16,
      padding: 14, message_gap: 8, animation: 'slide', display_seconds: 14,
      show_avatars: true, show_timestamps: false, show_badges: true,
      show_superchats: true, show_subscriber_count: false, auto_contrast: true, compact_mode: false, hide_links: false
    };
  }

  function normalizeOverlay(value) {
    var result = overlayDefaults();
    value = value && typeof value === 'object' ? value : {};
    Object.keys(result).forEach(function (key) {
      if (value[key] !== undefined && value[key] !== null) { result[key] = value[key]; }
    });
    return result;
  }

  function overlayRgba(hex, opacity) {
    var clean = String(hex || '#07111c').replace('#', '');
    var n = parseInt(clean, 16);
    if (!isFinite(n)) { n = 0x07111c; }
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (Number(opacity) / 100) + ')';
  }

  function overlaySafeText(settings) {
    if (!settings.auto_contrast || Number(settings.background_opacity) < 45) { return settings.text_color; }
    var n = parseInt(String(settings.background_color || '#07111c').replace('#', ''), 16);
    var lum = ((((n >> 16) & 255) * 299) + (((n >> 8) & 255) * 587) + ((n & 255) * 114)) / 255000;
    return lum > .62 ? '#07111c' : '#f7fbff';
  }

  function overlayPlacement(settings) {
    var map = {
      top_left: [4, 4], top_center: [50, 4], top_right: [96, 4],
      middle_left: [4, 42], middle_right: [96, 42],
      bottom_left: [4, 64], bottom_center: [50, 64], bottom_right: [96, 64]
    };
    var point = settings.position === 'custom' ? [settings.x, settings.y] : (map[settings.position] || map.bottom_left);
    return {
      left: point[0],
      top: point[1],
      tx: point[0] === 50 ? -50 : (point[0] > 50 ? -100 : 0),
      ty: point[1] > 50 ? -100 : 0
    };
  }

  function ensureOverlayFont(font) {
    var id = 'sml-overlay-font-' + String(font).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (document.getElementById(id)) { return; }
    var link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(String(font)).replace(/%20/g, '+') + ':wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }

  function overlayPreviewMarkup(stage) {
    if (!overlaySettings.enabled && !stage) { return ''; }
    ensureOverlayFont(overlaySettings.font_family);
    var s = overlaySettings;
    var p = overlayPlacement(s);
    var avatar = cfg.avatar || cfg.defaultThumbnail || '';
    var samples = [
      { name: cfg.displayName || 'Host', text: 'Welcome to the live market breakdown.', badge: 'Host' },
      { name: 'MarketWatcher', text: '$NVDA is testing the key level now.', badge: '' },
      { name: 'TopSupporter', text: 'Great explanation - watching volume here.', badge: 'Super Chat' }
    ];
    var safeText = overlaySafeText(s);
    var rootStyle = 'left:' + p.left + '%;top:' + p.top + '%;transform:translate(' + p.tx + '%,' + p.ty + '%);'
      + 'width:min(' + Number(s.width) + 'px,92%);gap:' + Number(s.message_gap) + 'px;'
      + 'font-family:&quot;' + esc(s.font_family) + '&quot;,sans-serif;font-size:' + Number(s.font_size) + 'px;font-weight:' + Number(s.font_weight) + ';';
    return '<div class="gl-chat-overlay-preview" data-overlay-live-preview style="' + rootStyle + '">'
      + (s.show_subscriber_count ? '<div class="gl-overlay-subscriber-count">12,480 subscribers</div>' : '')
      + samples.slice(-Number(s.max_messages)).map(function (message, index) {
        var showAvatar = s.show_avatars && avatar;
        var isSuper = index === samples.length - 1;
        return '<article class="' + (showAvatar ? '' : 'no-avatar') + '" style="gap:' + (s.compact_mode ? 7 : 10) + 'px;padding:' + Number(s.padding)
          + 'px;border-radius:' + Number(s.corner_radius) + 'px;background:' + overlayRgba(s.background_color, s.background_opacity)
          + ';color:' + esc(safeText) + ';border-left:' + (isSuper ? '3px solid ' + esc(s.accent_color) : '0') + '">'
          + (showAvatar ? '<img src="' + esc(avatar) + '" width="' + (s.compact_mode ? 30 : 38) + '" height="' + (s.compact_mode ? 30 : 38) + '" alt="">' : '')
          + '<div><div><b style="color:' + esc(s.name_color) + '">' + esc(message.name) + '</b>'
          + (s.show_badges && message.badge ? '<small class="badge" style="color:' + esc(s.accent_color) + '">' + esc(message.badge) + '</small>' : '')
          + (s.show_timestamps ? '<small style="opacity:.7;margin-left:7px">9:42 PM</small>' : '') + '</div>'
          + '<p>' + esc(message.text) + '</p></div></article>';
      }).join('') + '</div>';
  }

  function icon(name, size) {
    var s = size || 18;
    var p = {
      globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.6 12h16.8M12 3.4c2.2 2.4 3.4 5.4 3.4 8.6S14.2 18.2 12 20.6c-2.2-2.4-3.4-5.4-3.4-8.6S9.8 5.8 12 3.4z"/>',
      eye: '<path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.8"/>',
      user: '<circle cx="12" cy="8.4" r="3.6"/><path d="M5 20c0-3.4 3.1-5.6 7-5.6s7 2.2 7 5.6"/>',
      users: '<circle cx="9" cy="8.4" r="3.4"/><path d="M3 19.4c0-3.1 2.7-5.2 6-5.2s6 2.1 6 5.2"/><path d="M16.4 5.6a3.4 3.4 0 0 1 0 6.4M17.6 14.6c2 .7 3.4 2.4 3.4 4.8"/>',
      star: '<path d="M12 3.8l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.9l5.8-.8z"/>',
      groups: '<circle cx="8.4" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 18.6c0-2.6 2.4-4.2 5.4-4.2s5.4 1.6 5.4 4.2M15 14.6c3 0 6 1.6 6 4"/>',
      chat: '<path d="M20.4 12.4c0 3.9-3.8 7-8.4 7-1 0-2-.2-2.9-.5L4 20.4l1.6-4.2c-.8-1.1-1.3-2.4-1.3-3.8 0-3.9 3.8-7 8.4-7s7.7 3.1 7.7 7z"/>',
      poll: '<path d="M5 19V5M9.6 19v-7M14.2 19V8.6M18.8 19v-4.4M4 20.4h16"/>',
      smile: '<circle cx="12" cy="12" r="8.6"/><path d="M8.6 14.2a4.4 4.4 0 0 0 6.8 0M9.4 9.6h.01M14.6 9.6h.01"/>',
      help: '<circle cx="12" cy="12" r="8.8"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4M12 16.8h.01"/>',
      link: '<path d="M10.4 13.6a3.6 3.6 0 0 0 5.4.4l2.4-2.4a3.6 3.6 0 0 0-5.1-5.1l-1.4 1.3"/><path d="M13.6 10.4a3.6 3.6 0 0 0-5.4-.4l-2.4 2.4a3.6 3.6 0 0 0 5.1 5.1l1.4-1.3"/>',
      check: '<path d="M4.8 12.6l4.6 4.6L19.2 7"/>',
      checkCircle: '<circle cx="12" cy="12" r="8.8"/><path d="M8.2 12.4l2.6 2.6 5-5.2"/>',
      arrow: '<path d="M4.8 12h14.4M13.2 6l6 6-6 6"/>',
      back: '<path d="M19.2 12H4.8M10.8 6l-6 6 6 6"/>',
      cam: '<rect x="2.8" y="6" width="13" height="12" rx="2.4"/><path d="M16.4 11l4.8-3v8l-4.8-3z"/>',
      mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.4 11.6a6.6 6.6 0 0 0 13.2 0M12 18.2V21"/>',
      screen: '<rect x="2.8" y="4.6" width="18.4" height="12.6" rx="2.4"/><path d="M8.4 20.4h7.2"/>',
      upload: '<path d="M12 15.6V4.4M8 8.4L12 4.4l4 4"/><path d="M4.4 15.2v3.2a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6v-3.2"/>',
      frame: '<rect x="3" y="5" width="18" height="14" rx="2.4"/><circle cx="8.6" cy="10" r="1.6"/><path d="M4.2 17.4l4.8-4.6 3.4 3.2 3-2.8 4.4 4.2"/>',
      wand: '<path d="M4 20l9.6-9.6M15.2 4.2l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9zM19.4 12.6l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
      rocket: '<path d="M12.4 3.6c3.6 0 7 3.4 7 7 0 4.6-4.4 8.4-7 10-2.6-1.6-7-5.4-7-10 0-3.6 3.4-7 7-7z"/><circle cx="12.4" cy="10" r="2.2"/>',
      key: '<circle cx="8" cy="15" r="3.6"/><path d="M10.6 12.4L20 3M17.2 5.8l2 2M15 8l2 2"/>',
      rec: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.4" fill="currentColor"/>',
      test: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.6v8.8M7.6 12h8.8"/>',
      bell: '<path d="M18 15.5V10a6 6 0 1 0-12 0v5.5L4.5 18h15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
      stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
      signal: '<path d="M4 18v-3M9.4 18V11M14.8 18V7M20.2 18V4"/>',
      clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.4l3.4 2"/>',
      settings: '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1v-.2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1z"/>'
    };
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (p[name] || '') + '</svg>';
  }

  function api(url, options) {
    options = options || {};
    var headers = { 'Accept': 'application/json' };
    if (options.json) { headers['Content-Type'] = 'application/json'; }
    if (cfg.nonce) { headers['X-WP-Nonce'] = cfg.nonce; }
    return fetch(url, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: headers,
      body: options.json ? JSON.stringify(options.json) : options.body
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          var error = new Error(payload.message || 'Request failed.');
          error.status = response.status;
          throw error;
        }
        return payload;
      });
    });
  }

  function save() {
    var copy = {};
    Object.keys(draft).forEach(function (k) {
      if (k === 'orbitCards') {
        copy[k] = (draft[k] || []).map(function (item) { return { url: item.url || '', title: item.title || '', subtitle: item.subtitle || '', link: item.link || '' }; });
      } else {
        copy[k] = draft[k];
      }
    });
    try {
      window.localStorage.setItem(KEY, JSON.stringify(copy));
      if (autosave) { autosave.textContent = 'Draft saved just now'; }
    } catch (error) { /* storage blocked */ }
  }

  function clearSavedSetup() {
    try { window.localStorage.removeItem(KEY); } catch (error) { /* storage blocked */ }
  }

  function markFreshSetupRequired() {
    clearSavedSetup();
    try { window.sessionStorage.setItem(FRESH_AFTER_SCHEDULE_KEY, '1'); } catch (error) { /* storage blocked */ }
  }

  function resetNewStreamSetup() {
    if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null; }
    stopCreatorChat();
    stopStream();
    clearSavedSetup();
    draft = defaults();
    liveStats = { viewers: 0, startedAt: 0 };
    if (autosave) { autosave.textContent = 'New stream setup'; }
    render();
  }

  function consumeFreshSetupRequirement() {
    var required = false;
    try {
      required = window.sessionStorage.getItem(FRESH_AFTER_SCHEDULE_KEY) === '1';
      if (required) { window.sessionStorage.removeItem(FRESH_AFTER_SCHEDULE_KEY); }
    } catch (error) { /* storage blocked */ }
    if (!required) { return false; }
    resetNewStreamSetup();
    return true;
  }

  function clearSetupIfServerHasScheduledStream() {
    return api(scheduledLiveEndpoint() + '?_fresh_setup=' + Date.now())
      .then(function (payload) {
        var scheduled = payload && payload.scheduled_live;
        if (scheduled && scheduled.status === 'scheduled') {
          try { window.sessionStorage.removeItem(FRESH_AFTER_SCHEDULE_KEY); } catch (error) { /* storage blocked */ }
          resetNewStreamSetup();
          return true;
        }
        return false;
      })
      .catch(function () { return false; });
  }

  function syncOrbitSettings() {
    if (!cfg.orbitEndpoint) { return Promise.resolve(null); }
    var items = (draft.orbitCards || []).filter(function (item) { return item && item.url; }).slice(0, 3).map(function (item) {
      return { url: item.url, title: item.title || '', subtitle: item.subtitle || '', link: item.link || '' };
    });
    return api(cfg.orbitEndpoint, { method: 'POST', json: { enabled: !!draft.orbitEnabled && items.length > 0, items: items } });
  }

  function moneyEnabled(key) {
    if (!moneySettings) { return !!draft.monetization[key]; }
    var map = {
      superchat: 'superchat_enabled',
      stickers: 'stickers_enabled',
      memberships: 'memberships_enabled',
      affiliate: 'affiliate_enabled'
    };
    return !!moneySettings[map[key]];
  }

  function loadMonetizationSettings(openAfter) {
    if (!cfg.monetizationEndpoint) { return Promise.resolve(null); }
    return api(cfg.monetizationEndpoint).then(function (payload) {
      moneySettings = payload.settings || {};
      moneyCapabilities = payload.capabilities || moneyCapabilities;
      MONETIZATION.forEach(function (item) {
        draft.monetization[item.key] = moneyEnabled(item.key);
      });
      save();
      render();
      if (openAfter) { openMonetization(); }
      return payload;
    }).catch(function (error) {
      if (openAfter) { window.alert('Could not load monetization settings: ' + error.message); }
      return null;
    });
  }

  /* Voice Super Chat prices + YouTube-style levels (owner design 2026-09-15) */
  var LEVEL_DEFAULTS = [[1, 'Blue', '#1e88e5'], [20, 'Cyan', '#00bcd4'], [50, 'Green', '#1de9b6'], [100, 'Yellow', '#ffca28'], [250, 'Orange', '#f57c00'], [500, 'Magenta', '#e91e63'], [1000, 'Red', '#e62117']];
  function levelRowsMarkup() {
    var levels = (moneySettings && Array.isArray(moneySettings.superchat_levels) && moneySettings.superchat_levels.length)
      ? moneySettings.superchat_levels
      : LEVEL_DEFAULTS.map(function (l) { return { min: l[0], label: l[1], color: l[2] }; });
    var rows = '';
    for (var i = 0; i < 10; i++) {
      var lv = levels[i] || { min: '', label: '', color: '#1e88e5' };
      rows += '<div class="gl-level-row" style="display:grid;grid-template-columns:1fr 1.4fr 64px;gap:8px;align-items:end">'
        + '<label>From LB<input type="number" name="level_min_' + i + '" min="1" max="1000000" value="' + esc(lv.min) + '" placeholder="' + (i < LEVEL_DEFAULTS.length ? LEVEL_DEFAULTS[i][0] : 'blank = unused') + '"></label>'
        + '<label>Level name<input name="level_label_' + i + '" maxlength="24" value="' + esc(lv.label) + '"></label>'
        + '<label>Color<input type="color" name="level_color_' + i + '" value="' + esc(lv.color || '#1e88e5') + '"></label></div>';
    }
    return '<div class="gl-wide" style="display:flex;flex-direction:column;gap:6px">' + rows + '</div>';
  }
  function levelsPayload(data) {
    var out = [];
    for (var i = 0; i < 10; i++) {
      var min = Number(data.get('level_min_' + i) || 0);
      if (!min) { continue; }
      out.push({ min: min, label: String(data.get('level_label_' + i) || '').trim(), color: String(data.get('level_color_' + i) || '#1e88e5') });
    }
    return out;
  }
  function moneyValue(key, fallback) {
    if (!moneySettings || moneySettings[key] === undefined || moneySettings[key] === null) {
      return fallback || '';
    }
    return moneySettings[key];
  }

  function membershipValue(category, key, fallback) {
    var section = moneySettings && moneySettings[category + '_membership'];
    if (!section || section[key] === undefined || section[key] === null) { return fallback; }
    return section[key];
  }

  function membershipPlan(category, slug) {
    var section = moneySettings && moneySettings[category + '_membership'];
    var plans = section && section.plans;
    return plans && plans[slug] ? plans[slug] : {};
  }

  function membershipPlansMarkup(category) {
    var plans = [
      ['month_1', '1 month', 'Required minimum'],
      ['month_3', '3 months', ''],
      ['month_6', '6 months', ''],
      ['year_1', '1 year', ''],
      ['lifetime', 'Lifetime', 'One-time access']
    ];
    return '<div class="gl-membership-plans"><div class="gl-membership-plan-head"><b>Duration</b><b>Offer</b><b>Price (USD)</b></div>'
      + plans.map(function (item) {
        var plan = membershipPlan(category, item[0]);
        var checked = item[0] === 'month_1' || !!plan.enabled;
        var dollars = Number(plan.price_cents || 0) / 100;
        return '<div class="gl-membership-plan">'
          + '<span><b>' + esc(item[1]) + '</b>' + (item[2] ? '<small>' + esc(item[2]) + '</small>' : '') + '</span>'
          + '<label class="gl-money-toggle"><input type="checkbox" name="' + category + '_plan_' + item[0] + '_enabled"'
          + (checked ? ' checked' : '') + (item[0] === 'month_1' ? ' disabled' : '') + '>Enabled</label>'
          + '<label class="gl-price-input"><span>$</span><input type="number" name="' + category + '_plan_' + item[0] + '_price" min="0.50" max="1000000" step="0.01" value="' + esc(dollars.toFixed(2)) + '"></label>'
          + '</div>';
      }).join('') + '</div>';
  }

  function membershipCategoryMarkup(category, title, description) {
    var isContent = category === 'content';
    var enabled = !!membershipValue(category, 'enabled', false);
    return '<section class="gl-money-module gl-membership-category' + (enabled ? ' is-active' : '') + '">'
      + '<div class="gl-money-module-head">' + icon(isContent ? 'cam' : 'users', 21) + '<span><b>' + esc(title) + '</b>'
      + '<small>' + esc(description) + '</small></span>'
      + '<label class="gl-money-toggle"><input type="checkbox" name="' + category + '_membership_enabled"' + (enabled ? ' checked' : '') + '>Enabled</label></div>'
      + '<div class="gl-money-fields"><label>Membership name<input name="' + category + '_membership_name" maxlength="80" value="'
      + esc(membershipValue(category, 'name', title)) + '"></label>'
      + '<label>Checkout URL<input type="url" name="' + category + '_membership_checkout_url" value="'
      + esc(membershipValue(category, 'checkout_url', '')) + '" placeholder="https://stockmarketloop.com/..."></label>'
      + '<label class="gl-wide">Public description<textarea name="' + category + '_membership_description" maxlength="400">'
      + esc(membershipValue(category, 'description', '')) + '</textarea></label></div>'
      + (isContent
        ? '<div class="gl-benefit-grid">'
          + '<label><input type="checkbox" name="content_members_only_live"' + (membershipValue('content', 'members_only_live', true) ? ' checked' : '') + '>Members-only live streams</label>'
          + '<label><input type="checkbox" name="content_members_only_videos"' + (membershipValue('content', 'members_only_videos', true) ? ' checked' : '') + '>Members-only videos</label>'
          + '<label><input type="checkbox" name="content_callin_credits_enabled"' + (membershipValue('content', 'callin_credits_enabled', false) ? ' checked' : '') + '>Include creator call-in credits</label>'
          + '<label>Credits per renewal<input type="number" name="content_callin_credits_per_renewal" min="1" max="100" value="' + esc(membershipValue('content', 'callin_credits_per_renewal', 1)) + '"></label>'
          + '<label>Seconds per credit<input type="number" name="content_callin_seconds_per_credit" min="15" max="300" step="5" value="' + esc(membershipValue('content', 'callin_seconds_per_credit', 30)) + '"></label>'
          + '<p class="gl-wide gl-credit-rule">Credits reset to this amount on every renewal. They never stack, transfer, or work in another creator&apos;s live room. Lifetime plans receive the allowance once.</p></div>'
        : '')
      + membershipPlansMarkup(category) + '</section>';
  }

  function closeMonetization() {
    var modal = document.getElementById('gl-money-modal');
    if (modal) { modal.remove(); }
  }

  function openMonetization() {
    if (!moneySettings) { loadMonetizationSettings(true); return; }
    closeMonetization();

    var modal = document.createElement('div');
    modal.id = 'gl-money-modal';
    modal.className = 'gl-money-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'gl-money-title');
    modal.innerHTML = '<div class="gl-money-dialog">'
      + '<div class="gl-money-head"><div><h2 id="gl-money-title">Manage Monetization</h2>'
      + '<p>Choose how this creator account earns during live streams. Changes become the default for new streams.</p></div>'
      + '<button type="button" class="gl-money-close" data-money-close aria-label="Close monetization settings">&times;</button></div>'
      + '<form class="gl-money-form" data-money-form>'
      + '<section class="gl-money-module' + (moneyEnabled('superchat') ? ' is-active' : '') + '">'
      + '<div class="gl-money-module-head">' + icon('chat', 21) + '<span><b>Super Chat</b>'
      + '<small>Viewers highlight messages with Loop Bucks. Payments are recorded in the live-room ledger.</small></span>'
      + '<label class="gl-money-toggle"><input type="checkbox" name="superchat_enabled"' + (moneyEnabled('superchat') ? ' checked' : '') + '>Enabled</label></div>'
      + '<div class="gl-money-fields"><label>Minimum Loop Bucks<input type="number" name="superchat_min_loop_bucks" min="1" max="1000" value="' + esc(moneyValue('superchat_min_loop_bucks', 5)) + '"></label>'
      + '<label>Maximum Loop Bucks<input type="number" name="superchat_max_loop_bucks" min="1" max="10000" value="' + esc(moneyValue('superchat_max_loop_bucks', 500)) + '"></label>'
      + '<label class="gl-wide">Message character limit<input type="number" name="superchat_message_limit" min="40" max="500" value="' + esc(moneyValue('superchat_message_limit', 200)) + '"></label></div></section>'
      + '<section class="gl-money-module' + (moneyValue('voice_enabled', true) ? ' is-active' : '') + '">'
      + '<div class="gl-money-module-head">' + icon('chat', 21) + '<span><b>Voice Super Chat</b>'
      + '<small>Viewers record a voice message. You listen privately in the Voice Queue; approve it and it plays on the stream with the amount shown to everyone. Set the price for each length.</small></span>'
      + '<label class="gl-money-toggle"><input type="checkbox" name="voice_enabled"' + (moneyValue('voice_enabled', true) ? ' checked' : '') + '>Enabled</label></div>'
      + '<div class="gl-money-fields"><label>15 seconds · Loop Bucks<input type="number" name="voice_price_15" min="1" max="100000" value="' + esc(moneyValue('voice_price_15', 500)) + '"></label>'
      + '<label>20 seconds · Loop Bucks<input type="number" name="voice_price_20" min="1" max="100000" value="' + esc(moneyValue('voice_price_20', 2000)) + '"></label>'
      + '<label>30 seconds · Loop Bucks<input type="number" name="voice_price_30" min="1" max="100000" value="' + esc(moneyValue('voice_price_30', 5000)) + '"></label></div></section>'
      + '<section class="gl-money-module is-active"><div class="gl-money-module-head">' + icon('chat', 21) + '<span><b>Super Chat levels</b>'
      + '<small>Like YouTube: the Loop Bucks amount decides the level. The level name and color show in chat and on the stream when a Super Chat plays. Leave a row blank to drop it.</small></span></div>'
      + '<div class="gl-money-fields">' + levelRowsMarkup() + '</div></section>'
      + '<section class="gl-money-module is-soon"><div class="gl-money-module-head">' + icon('smile', 21)
      + '<span><b>Super Stickers</b><small>Sticker purchasing is not active yet. This stays off until fulfillment and refund handling are connected.</small></span>'
      + '<label class="gl-money-toggle"><input type="checkbox" disabled>Unavailable</label></div></section>'
      + '<div class="gl-membership-intro"><b>Membership products</b><span>Content access and group access are separate products. Set each duration and price directly.</span></div>'
      + membershipCategoryMarkup('content', 'Content Membership', 'Sell members-only live streams and videos, with optional creator-specific call-in credits.')
      + membershipCategoryMarkup('server_group', 'Server / Group Membership', 'Sell access to a creator server or StockMarketLoop group separately from content access.')
      + '<section class="gl-money-module' + (moneyEnabled('affiliate') ? ' is-active' : '') + '">'
      + '<div class="gl-money-module-head">' + icon('link', 21) + '<span><b>Affiliate Link</b>'
      + '<small>Add one clearly disclosed sponsor or affiliate destination to the live watch experience.</small></span>'
      + '<label class="gl-money-toggle"><input type="checkbox" name="affiliate_enabled"' + (moneyEnabled('affiliate') ? ' checked' : '') + '>Enabled</label></div>'
      + '<div class="gl-money-fields"><label>Link label<input name="affiliate_label" maxlength="80" value="' + esc(moneyValue('affiliate_label', '')) + '" placeholder="Open my broker offer"></label>'
      + '<label>Destination URL<input type="url" name="affiliate_url" value="' + esc(moneyValue('affiliate_url', '')) + '" placeholder="https://"></label>'
      + '<label class="gl-wide">Disclosure<textarea name="affiliate_disclosure" maxlength="300">' + esc(moneyValue('affiliate_disclosure', 'I may earn a commission from qualifying purchases.')) + '</textarea></label></div></section>'
      + '<div class="gl-money-split"><span>Creator revenue share on monetized earnings</span><b>'
      + esc(moneyValue('creator_revenue_percent', 75)) + '% creator / ' + esc(moneyValue('platform_revenue_percent', 25)) + '% platform</b></div>'
      + '<div class="gl-money-feedback" data-money-feedback aria-live="polite"></div>'
      + '<div class="gl-money-actions"><button type="button" class="cs-btn" data-money-close>Cancel</button>'
      + '<button type="submit" class="cs-btn cs-btn-primary">Save Monetization</button></div></form></div>';

    document.body.appendChild(modal);
    var first = modal.querySelector('input:not([disabled])');
    if (first) { first.focus(); }
    modal.addEventListener('click', function (event) {
      if (event.target === modal || event.target.closest('[data-money-close]')) { closeMonetization(); }
    });
    modal.querySelector('[data-money-form]').addEventListener('submit', saveMonetization);
  }

  function membershipPayload(data, category) {
    var slugs = ['month_1', 'month_3', 'month_6', 'year_1', 'lifetime'];
    var plans = {};
    slugs.forEach(function (slug) {
      var dollars = Math.max(0, Number(data.get(category + '_plan_' + slug + '_price') || 0));
      plans[slug] = {
        enabled: slug === 'month_1' || data.has(category + '_plan_' + slug + '_enabled'),
        price_cents: Math.round(dollars * 100)
      };
    });
    var content = category === 'content';
    return {
      enabled: data.has(category + '_membership_enabled'),
      name: String(data.get(category + '_membership_name') || '').trim(),
      description: String(data.get(category + '_membership_description') || '').trim(),
      checkout_url: String(data.get(category + '_membership_checkout_url') || '').trim(),
      members_only_live: content && data.has('content_members_only_live'),
      members_only_videos: content && data.has('content_members_only_videos'),
      callin_credits_enabled: content && data.has('content_callin_credits_enabled'),
      callin_credits_per_renewal: content ? Number(data.get('content_callin_credits_per_renewal') || 1) : 0,
      callin_seconds_per_credit: content ? Number(data.get('content_callin_seconds_per_credit') || 30) : 30,
      plans: plans
    };
  }

  function saveMonetization(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var feedback = form.querySelector('[data-money-feedback]');
    var submit = form.querySelector('[type="submit"]');
    var data = new FormData(form);
    var payload = {
      superchat_enabled: data.has('superchat_enabled'),
      superchat_min_loop_bucks: Number(data.get('superchat_min_loop_bucks') || 5),
      superchat_max_loop_bucks: Number(data.get('superchat_max_loop_bucks') || 500),
      superchat_message_limit: Number(data.get('superchat_message_limit') || 200),
      voice_enabled: data.has('voice_enabled'),
      voice_price_15: Number(data.get('voice_price_15') || 500),
      voice_price_20: Number(data.get('voice_price_20') || 2000),
      voice_price_30: Number(data.get('voice_price_30') || 5000),
      superchat_levels: levelsPayload(data),
      stickers_enabled: false,
      memberships_enabled: data.has('content_membership_enabled') || data.has('server_group_membership_enabled'),
      content_membership: membershipPayload(data, 'content'),
      server_group_membership: membershipPayload(data, 'server_group'),
      affiliate_enabled: data.has('affiliate_enabled'),
      affiliate_label: String(data.get('affiliate_label') || '').trim(),
      affiliate_url: String(data.get('affiliate_url') || '').trim(),
      affiliate_disclosure: String(data.get('affiliate_disclosure') || '').trim()
    };
    submit.disabled = true;
    submit.textContent = 'Saving...';
    feedback.className = 'gl-money-feedback';
    feedback.textContent = 'Saving creator monetization settings...';
    api(cfg.monetizationEndpoint, { method: 'POST', json: payload }).then(function (result) {
      moneySettings = result.settings || payload;
      MONETIZATION.forEach(function (item) { draft.monetization[item.key] = moneyEnabled(item.key); });
      save();
      feedback.textContent = 'Monetization settings saved.';
      submit.textContent = 'Saved';
      render();
      window.setTimeout(closeMonetization, 650);
    }).catch(function (error) {
      feedback.className = 'gl-money-feedback is-error';
      feedback.textContent = error.message;
      submit.disabled = false;
      submit.textContent = 'Save Monetization';
    });
  }

  function closeChatOverlayEditor() {
    var modal = document.getElementById('gl-chat-overlay-modal');
    if (modal) { modal.remove(); }
  }

  function overlayField(label, name, type, min, max, step) {
    var value = overlaySettings[name];
    return '<label class="gl-overlay-field">' + esc(label) + '<input type="' + esc(type) + '" name="' + esc(name) + '" value="' + esc(value)
      + '"' + (min !== '' ? ' min="' + esc(min) + '"' : '') + (max !== '' ? ' max="' + esc(max) + '"' : '')
      + (step !== '' ? ' step="' + esc(step) + '"' : '') + '></label>';
  }

  function overlayCheck(label, name) {
    return '<label><input type="checkbox" name="' + esc(name) + '"' + (overlaySettings[name] ? ' checked' : '') + '>' + esc(label) + '</label>';
  }

  function overlayPositionButtons() {
    var positions = [
      ['top_left', '↖'], ['top_center', '↑'], ['top_right', '↗'],
      ['middle_left', '←'], ['custom', '•'], ['middle_right', '→'],
      ['bottom_left', '↙'], ['bottom_center', '↓'], ['bottom_right', '↘']
    ];
    return '<div class="gl-position-grid">' + positions.map(function (item) {
      return '<button type="button" data-overlay-position="' + item[0] + '" class="' + (overlaySettings.position === item[0] ? 'gl-on' : '')
        + '" title="' + esc(item[0].replace(/_/g, ' ')) + '">' + item[1] + '</button>';
    }).join('') + '</div>';
  }

  function readOverlayForm(form) {
    var data = new FormData(form);
    var numbers = ['x', 'y', 'width', 'max_messages', 'font_size', 'font_weight', 'background_opacity', 'corner_radius', 'padding', 'message_gap', 'display_seconds'];
    var next = normalizeOverlay(overlaySettings);
    ['position', 'font_family', 'text_color', 'name_color', 'accent_color', 'background_color', 'animation'].forEach(function (key) {
      if (data.get(key) !== null) { next[key] = String(data.get(key)); }
    });
    numbers.forEach(function (key) { next[key] = Number(data.get(key) || next[key]); });
    ['enabled', 'show_avatars', 'show_timestamps', 'show_badges', 'show_superchats', 'show_subscriber_count', 'auto_contrast', 'compact_mode', 'hide_links'].forEach(function (key) {
      next[key] = data.has(key);
    });
    overlaySettings = normalizeOverlay(next);
  }

  function paintOverlayEditor(modal) {
    var stage = modal && modal.querySelector('[data-overlay-stage]');
    if (stage) {
      stage.innerHTML = '<div class="gl-overlay-stage-grid"></div>' + overlayPreviewMarkup(true);
      bindOverlayDrag(modal);
    }
    var status = document.querySelector('[data-overlay-status]');
    if (status) {
      status.textContent = overlaySettings.enabled ? 'On' : 'Off';
      status.className = overlaySettings.enabled ? '' : 'gl-off';
    }
  }

  function bindOverlayDrag(modal) {
    var stage = modal.querySelector('[data-overlay-stage]');
    var preview = stage && stage.querySelector('[data-overlay-live-preview]');
    if (!stage || !preview) { return; }
    preview.onpointerdown = function (event) {
      event.preventDefault();
      preview.setPointerCapture(event.pointerId);
      var move = function (moveEvent) {
        var rect = stage.getBoundingClientRect();
        overlaySettings.position = 'custom';
        overlaySettings.x = Math.max(0, Math.min(100, ((moveEvent.clientX - rect.left) / rect.width) * 100));
        overlaySettings.y = Math.max(0, Math.min(100, ((moveEvent.clientY - rect.top) / rect.height) * 100));
        var form = modal.querySelector('[data-overlay-form]');
        form.elements.position.value = 'custom';
        form.elements.x.value = overlaySettings.x.toFixed(1);
        form.elements.y.value = overlaySettings.y.toFixed(1);
        modal.querySelectorAll('[data-overlay-position]').forEach(function (button) {
          button.classList.toggle('gl-on', button.getAttribute('data-overlay-position') === 'custom');
        });
        var p = overlayPlacement(overlaySettings);
        preview.style.left = p.left + '%';
        preview.style.top = p.top + '%';
        preview.style.transform = 'translate(' + p.tx + '%,' + p.ty + '%)';
      };
      var done = function () {
        preview.removeEventListener('pointermove', move);
        preview.removeEventListener('pointerup', done);
        preview.removeEventListener('pointercancel', done);
      };
      preview.addEventListener('pointermove', move);
      preview.addEventListener('pointerup', done);
      preview.addEventListener('pointercancel', done);
    };
  }

  function openChatOverlayEditor() {
    closeChatOverlayEditor();
    var modal = document.createElement('div');
    modal.id = 'gl-chat-overlay-modal';
    modal.className = 'gl-money-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<div class="gl-money-dialog gl-overlay-dialog">'
      + '<div class="gl-money-head"><div><h2>On-Screen Live Chat</h2><p>Design the live chat overlay, preview it, and use the signed browser source in OBS.</p></div>'
      + '<button type="button" class="gl-money-close" data-overlay-close aria-label="Close live chat overlay settings">&times;</button></div>'
      + '<form data-overlay-form><div class="gl-overlay-layout"><div class="gl-overlay-controls">'
      + '<section class="gl-overlay-section"><div class="gl-money-module-head" style="margin:0"><span><b>Show chat on stream</b><small>Only active, moderated messages are rendered.</small></span>'
      + '<label class="gl-money-toggle"><input type="checkbox" name="enabled"' + (overlaySettings.enabled ? ' checked' : '') + '>Enabled</label></div></section>'
      + '<section class="gl-overlay-section"><h3>Placement</h3><p>Choose a safe-area preset or drag the preview anywhere.</p><div class="gl-overlay-grid">'
      + '<div>' + overlayPositionButtons() + '<input type="hidden" name="position" value="' + esc(overlaySettings.position) + '"></div>'
      + '<div class="gl-overlay-grid">' + overlayField('Horizontal %', 'x', 'number', 0, 100, .1) + overlayField('Vertical %', 'y', 'number', 0, 100, .1) + '</div></div></section>'
      + '<section class="gl-overlay-section"><h3>Typography</h3><div class="gl-overlay-grid gl-three">'
      + '<label class="gl-overlay-field">Font<select name="font_family">' + (cfg.chatOverlayFonts || ['Inter']).map(function (font) {
        return '<option' + (overlaySettings.font_family === font ? ' selected' : '') + '>' + esc(font) + '</option>';
      }).join('') + '</select></label>'
      + overlayField('Size', 'font_size', 'number', 2, 72, 1)
      + '<label class="gl-overlay-field">Weight<select name="font_weight">' + [400, 500, 600, 700, 800].map(function (weight) {
        return '<option value="' + weight + '"' + (Number(overlaySettings.font_weight) === weight ? ' selected' : '') + '>' + weight + '</option>';
      }).join('') + '</select></label></div></section>'
      + '<section class="gl-overlay-section"><h3>Color &amp; surface</h3><div class="gl-overlay-grid gl-three">'
      + overlayField('Message text', 'text_color', 'color', '', '', '')
      + overlayField('User names', 'name_color', 'color', '', '', '')
      + overlayField('Accent', 'accent_color', 'color', '', '', '')
      + overlayField('Background', 'background_color', 'color', '', '', '')
      + overlayField('Opacity %', 'background_opacity', 'range', 0, 100, 1)
      + overlayField('Corners', 'corner_radius', 'number', 0, 40, 1) + '</div></section>'
      + '<section class="gl-overlay-section"><h3>Layout &amp; motion</h3><div class="gl-overlay-grid gl-three">'
      + overlayField('Width', 'width', 'number', 280, 760, 10)
      + overlayField('Messages', 'max_messages', 'number', 1, 12, 1)
      + overlayField('Display seconds', 'display_seconds', 'number', 3, 120, 1)
      + overlayField('Padding', 'padding', 'number', 6, 32, 1)
      + overlayField('Message gap', 'message_gap', 'number', 0, 24, 1)
      + '<label class="gl-overlay-field">Entrance<select name="animation">' + ['slide', 'fade', 'pop', 'none'].map(function (name) {
        return '<option value="' + name + '"' + (overlaySettings.animation === name ? ' selected' : '') + '>' + esc(name.charAt(0).toUpperCase() + name.slice(1)) + '</option>';
      }).join('') + '</select></label></div></section>'
      + '<section class="gl-overlay-section"><h3>Message intelligence</h3><div class="gl-overlay-checks">'
      + overlayCheck('Show avatars', 'show_avatars') + overlayCheck('Show timestamps', 'show_timestamps')
      + overlayCheck('Show role badges', 'show_badges') + overlayCheck('Highlight Super Chats', 'show_superchats')
      + overlayCheck('Show current subscriber count', 'show_subscriber_count')
      + overlayCheck('Automatic contrast protection', 'auto_contrast') + overlayCheck('Compact mode', 'compact_mode')
      + overlayCheck('Hide links from broadcast', 'hide_links') + '</div></section>'
      + '<div class="gl-overlay-source"><b>OBS Browser Source</b><p>Replace ROOM_ID automatically by starting a stream, then add this URL as a transparent 1920 x 1080 Browser Source.</p>'
      + '<div class="gl-overlay-copy"><input readonly data-overlay-url value="' + esc(String(cfg.chatOverlayUrl || '').replace('ROOM_ID', (draft.live && (draft.live.id || draft.live.room_id)) || 'ROOM_ID')) + '">'
      + '<button type="button" class="cs-btn" data-overlay-copy>Copy URL</button></div></div>'
      + '<div class="gl-overlay-feedback" data-overlay-feedback aria-live="polite"></div>'
      + '<div class="gl-money-actions"><button type="button" class="cs-btn" data-overlay-close>Cancel</button><button type="submit" class="cs-btn cs-btn-primary">Save Overlay</button></div>'
      + '</div><aside class="gl-overlay-stage-wrap"><div class="gl-overlay-stage" data-overlay-stage></div>'
      + '<div class="cs-tip" style="margin-top:12px">Drag the chat stack in the preview. Safe-area limits prevent it from leaving the video frame.</div></aside></div></form></div>';
    document.body.appendChild(modal);
    paintOverlayEditor(modal);

    var form = modal.querySelector('[data-overlay-form]');
    form.addEventListener('input', function () { readOverlayForm(form); paintOverlayEditor(modal); });
    form.addEventListener('change', function () { readOverlayForm(form); paintOverlayEditor(modal); });
    modal.addEventListener('click', function (event) {
      if (event.target === modal || event.target.closest('[data-overlay-close]')) { closeChatOverlayEditor(); return; }
      var position = event.target.closest('[data-overlay-position]');
      if (position) {
        overlaySettings.position = position.getAttribute('data-overlay-position');
        form.elements.position.value = overlaySettings.position;
        modal.querySelectorAll('[data-overlay-position]').forEach(function (button) {
          button.classList.toggle('gl-on', button === position);
        });
        paintOverlayEditor(modal);
        return;
      }
      if (event.target.closest('[data-overlay-copy]')) {
        var input = modal.querySelector('[data-overlay-url]');
        if (navigator.clipboard && input) {
          navigator.clipboard.writeText(input.value).then(function () {
            event.target.closest('[data-overlay-copy]').textContent = 'Copied';
          }).catch(function () {});
        }
      }
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      readOverlayForm(form);
      var feedback = modal.querySelector('[data-overlay-feedback]');
      var submit = form.querySelector('[type="submit"]');
      feedback.textContent = 'Saving live chat overlay...';
      submit.disabled = true;
      api(cfg.chatOverlayEndpoint, { method: 'POST', json: overlaySettings }).then(function (payload) {
        overlaySettings = normalizeOverlay(payload.settings || overlaySettings);
        feedback.textContent = 'Overlay saved. Your preview and OBS source now use these settings.';
        submit.textContent = 'Saved';
        render();
        window.setTimeout(closeChatOverlayEditor, 800);
      }).catch(function (error) {
        feedback.className = 'gl-overlay-feedback is-error';
        feedback.textContent = error.message;
        submit.disabled = false;
        submit.textContent = 'Save Overlay';
      });
    });
  }

  function syncRoomMonetization() {
    if (!draft.live || !cfg.voiceSettingsEndpoint) { return Promise.resolve(); }
    var roomId = draft.live.id || draft.live.room_id || draft.live.roomId || '';
    if (!roomId) { return Promise.resolve(); }
    return api(cfg.voiceSettingsEndpoint, {
      method: 'POST',
      json: {
        room_id: String(roomId),
        text_chat_enabled: !!draft.engagement.chat,
        super_chat_enabled: moneyEnabled('superchat'),
        members_only: draft.audience === 'premium'
      }
    }).catch(function () { /* room can still continue if settings sync is delayed */ });
  }

  function restore() {
    try {
      var stored = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      if (stored && typeof stored === 'object') {
        Object.keys(defaults()).forEach(function (k) { if (stored[k] !== undefined) { draft[k] = stored[k]; } });
      }
    } catch (error) { /* corrupt draft */ }
    // Drafts survive releases in the browser. Validate their shape before the
    // first render so an old value (for example a string in `related`) cannot
    // prevent the entire Go Live wizard from mounting.
    var fallback = defaults();
    [
      'title', 'description', 'category', 'contentType', 'ticker', 'tickerName',
      'thumbUrl', 'schedule', 'scheduleDate', 'scheduleTime', 'audience',
      'groupName', 'scene', 'videoDeviceId', 'audioDeviceId', 'resolution'
    ].forEach(function (key) {
      if (typeof draft[key] !== 'string') { draft[key] = fallback[key]; }
    });
    draft.step = Math.max(0, Math.min(4, Number.isFinite(Number(draft.step)) ? Math.floor(Number(draft.step)) : 0));
    draft.groupId = Number.isFinite(Number(draft.groupId)) ? Number(draft.groupId) : 0;
    draft.framerate = Number.isFinite(Number(draft.framerate)) ? Number(draft.framerate) : fallback.framerate;
    draft.related = Array.isArray(draft.related)
      ? draft.related.map(function (ticker) { return String(ticker || '').toUpperCase().replace(/[^A-Z]/g, ''); }).filter(Boolean).slice(0, 12)
      : [];
    draft.orbitCards = Array.isArray(draft.orbitCards)
      ? draft.orbitCards.filter(function (card) { return card && typeof card === 'object'; }).slice(0, 3)
      : [];
    draft.orbitEnabled = !!draft.orbitEnabled;
    draft.engagement = (draft.engagement && typeof draft.engagement === 'object')
      ? Object.assign({}, fallback.engagement, draft.engagement)
      : fallback.engagement;
    draft.monetization = (draft.monetization && typeof draft.monetization === 'object')
      ? Object.assign({}, fallback.monetization, draft.monetization)
      : fallback.monetization;
    draft.live = null;
  }

  /* ---------------- capture ---------------- */

  function stopMeter() {
    if (meterRaf) { window.cancelAnimationFrame(meterRaf); meterRaf = null; }
    if (audioCtx) { audioCtx.close().catch(function () {}); audioCtx = null; analyser = null; }
  }

  function attachMeter() {
    stopMeter();
    if (!stream || !stream.getAudioTracks().length) { return; }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { return; }
    audioCtx = new Ctx();
    var source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    var buffer = new Uint8Array(analyser.frequencyBinCount);
    var tick = function () {
      if (!analyser) { return; }
      analyser.getByteTimeDomainData(buffer);
      var peak = 0;
      for (var i = 0; i < buffer.length; i += 1) {
        peak = Math.max(peak, Math.abs(buffer[i] - 128) / 128);
      }
      var bar = document.querySelector('[data-meter]');
      if (bar) { bar.style.width = Math.min(100, Math.round(peak * 140)) + '%'; }
      meterRaf = window.requestAnimationFrame(tick);
    };
    tick();
  }

  function stopStream() {
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    stopMeter();
  }

  function constraints() {
    var parts = String(draft.resolution).split('x');
    var video = {
      width: { ideal: Number(parts[0]) || 1280 },
      height: { ideal: Number(parts[1]) || 720 },
      frameRate: { ideal: Number(draft.framerate) || 30 }
    };
    if (draft.videoDeviceId) { video.deviceId = { exact: draft.videoDeviceId }; }
    var audio = {
      echoCancellation: !!draft.echoCancel,
      noiseSuppression: !!draft.noiseSuppress
    };
    if (draft.audioDeviceId) { audio.deviceId = { exact: draft.audioDeviceId }; }
    return { video: video, audio: audio };
  }

  function startCapture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      window.alert('This browser cannot access a camera.');
      return Promise.resolve(null);
    }
    stopStream();
    var request = draft.scene === 'screen'
      ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      : navigator.mediaDevices.getUserMedia(constraints());

    return request.then(function (media) {
      stream = media;
      return navigator.mediaDevices.enumerateDevices();
    }).then(function (list) {
      devices.video = list.filter(function (d) { return d.kind === 'videoinput'; });
      devices.audio = list.filter(function (d) { return d.kind === 'audioinput'; });
      var track = stream.getVideoTracks()[0];
      if (track && !draft.videoDeviceId) { draft.videoDeviceId = track.getSettings().deviceId || ''; }
      render();
      attachMeter();
      return stream;
    }).catch(function (error) {
      window.alert('Camera or microphone unavailable: ' + error.message);
      render();
      return null;
    });
  }

  function bindVideo() {
    var el = document.querySelector('[data-preview]');
    if (!el) { return; }
    if (stream) {
      el.srcObject = stream;
      el.play().catch(function () {});
      el.classList.toggle('gl-no-mirror', draft.scene === 'screen');
    }
  }

  function trackInfo() {
    if (!stream) { return null; }
    var v = stream.getVideoTracks()[0];
    var a = stream.getAudioTracks()[0];
    var vs = v ? v.getSettings() : null;
    return {
      video: vs ? (vs.width || '?') + 'x' + (vs.height || '?') + (vs.frameRate ? ' / ' + Math.round(vs.frameRate) + 'fps' : '') : '',
      videoOk: !!v && v.readyState === 'live',
      audioOk: !!a && a.readyState === 'live' && !a.muted,
      audioLabel: a ? (a.label ? 'Good' : 'Connected') : ''
    };
  }

  function netInfo() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c || !c.downlink) { return { ok: true, label: 'Unknown', mbps: 0 }; }
    var mbps = c.downlink;
    return {
      ok: mbps >= 5,
      warn: mbps >= 2 && mbps < 5,
      label: (mbps >= 5 ? 'Excellent' : (mbps >= 2 ? 'Fair' : 'Weak')) + ' (' + mbps.toFixed(0) + ' Mbps)',
      mbps: mbps
    };
  }

  function healthScore() {
    var t = trackInfo();
    var n = netInfo();
    var checks = [!!(t && t.videoOk), !!(t && t.audioOk), !!n.ok, !!stream];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }

  /* ---------------- data ---------------- */

  function loadGroups() {
    api(cfg.groupsEndpoint + '?mine=1').then(function (payload) {
      var rows = [].concat(payload.mine || [], payload.trending || [], payload.groups || []);
      var seen = {};
      groups = rows.filter(function (g) {
        if (!g || !g.id || seen[g.id]) { return false; }
        seen[g.id] = 1;
        return true;
      });
      /* A host group is optional (owner call 2026-09-19), so 0 now MEANS "no group" and must never be
         overwritten. This used to auto-pick groups[0] — and since the list is mine + trending, a creator with
         no groups of their own was silently put into a trending group they had not joined, and Go Live then
         failed with "You must be a member of this group". */
      render();
    }).catch(function () { /* groups optional until Go Live */ });
  }

  function loadMovers() {
    api(cfg.trendingEndpoint).then(function (payload) {
      var rows = payload.tickers || payload.trending || payload.results || payload;
      if (!Array.isArray(rows)) { return; }
      movers = rows.slice(0, 4).map(function (row) {
        return { symbol: String(row.symbol || row.ticker || '').toUpperCase(), pct: null };
      }).filter(function (row) { return row.symbol; });
      movers.forEach(function (mover) {
        api(cfg.chartEndpoint + '/' + encodeURIComponent(mover.symbol) + '?range=1Y&interval=1d')
          .then(function (payload) {
            var bars = ((payload.data || payload).bars) || [];
            if (bars.length < 2) { return; }
            var last = bars[bars.length - 1].close;
            var prev = bars[bars.length - 2].close;
            mover.pct = prev ? ((last - prev) / prev) * 100 : 0;
            paintMovers();
          }).catch(function () {});
      });
      paintMovers();
    }).catch(function () { /* movers optional */ });
  }

  function loadQuote(symbol) {
    if (!symbol) { quote = null; render(); return; }
    api(cfg.chartEndpoint + '/' + encodeURIComponent(symbol) + '?range=1Y&interval=1d')
      .then(function (payload) {
        var bars = ((payload.data || payload).bars) || [];
        if (bars.length < 2) { throw new Error('no bars'); }
        var series = bars.slice(-40).map(function (b) { return b.close; });
        var last = bars[bars.length - 1].close;
        var prev = bars[bars.length - 2].close;
        quote = {
          symbol: symbol,
          price: last,
          change: last - prev,
          pct: prev ? ((last - prev) / prev) * 100 : 0,
          series: series
        };
        paintQuote();
      })
      .catch(function () { quote = null; paintQuote(); });

    api(cfg.searchEndpoint + '?q=' + encodeURIComponent(symbol))
      .then(function (payload) {
        var rows = payload.results || payload.tickers || payload || [];
        if (!Array.isArray(rows)) { return; }
        var hit = rows.filter(function (r) { return String(r.symbol || r.ticker || '').toUpperCase() === symbol; })[0];
        draft.tickerName = (hit && (hit.name || hit.company || hit.company_name)) || '';
        save();
        var box = document.querySelector('[data-ticker-name]');
        if (box) {
          box.innerHTML = '<span>' + esc(draft.tickerName || 'Not recognized') + '</span>'
            + (draft.tickerName ? '<span class="gl-verified" style="margin-left:auto">' + icon('check', 14) + 'Verified</span>' : '');
        }
      })
      .catch(function () {});
  }

  function watchChatHandle() {
    return String(cfg.watchChatHandle || cfg.handle || '')
      .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60);
  }

  function watchPageUrl() {
    if (draft.live && draft.live.watch_url) { return String(draft.live.watch_url); }
    var handle = watchChatHandle();
    /* `s` is WordPress search and can be stripped by canonical redirects. */
    return '/live/' + (handle ? '?room=' + encodeURIComponent(handle) : '');
  }

  function watchChatUrl() {
    var handle = watchChatHandle();
    return handle ? '/wp-json/sml-live-chat/v1/room/' + encodeURIComponent(handle) + '/messages' : '';
  }

  function creatorChatTime(value) {
    var stamp = Date.parse(value || '');
    if (!stamp) { return 'now'; }
    var seconds = Math.max(0, Math.floor((Date.now() - stamp) / 1000));
    if (seconds < 60) { return 'now'; }
    if (seconds < 3600) { return Math.floor(seconds / 60) + 'm'; }
    if (seconds < 86400) { return Math.floor(seconds / 3600) + 'h'; }
    return Math.floor(seconds / 86400) + 'd';
  }

  function mapCreatorChatMessage(raw) {
    raw = raw || {};
    var id = String(raw.id != null ? raw.id : ((raw.created_at || raw.created || Date.now()) + '-' + (raw.user_id || '')));
    return {
      id: id,
      name: String(raw.display_name || raw.handle || raw.user || raw.name || 'Member').replace(/^@/, ''),
      message: String(raw.body || raw.message || raw.text || ''),
      created: raw.created_at || raw.created || raw.time || '',
      avatar: String(raw.avatar_url || raw.avatar || '')
    };
  }

  function renderCreatorChat() {
    var feed = document.querySelector('[data-creator-chat-feed]');
    var empty = document.querySelector('[data-creator-chat-empty]');
    if (!feed || !empty) { return; }
    var items = creatorChat.items.slice(-40);
    empty.style.display = items.length ? 'none' : '';
    feed.innerHTML = items.map(function (m) {
      var avatar = m.avatar && /^https:\/\//i.test(m.avatar)
        ? '<img src="' + esc(m.avatar) + '" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover">'
        : '<span style="width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#17314c;color:#9ce7c0;font-size:10px;font-weight:800">' + esc(m.name.slice(0, 2).toUpperCase()) + '</span>';
      return '<article style="display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;padding:8px 0;border-bottom:1px solid rgba(151,175,200,.10)">'
        + avatar + '<div style="min-width:0"><div style="display:flex;gap:7px;align-items:baseline"><b style="font-size:12px;color:#e6edf5">' + esc(m.name) + '</b><small style="font-size:10px;color:#7e92a8">' + esc(creatorChatTime(m.created)) + '</small></div>'
        + '<p style="margin:2px 0 0;color:#c6d2df;font-size:12.5px;line-height:1.4;overflow-wrap:anywhere">' + esc(m.message) + '</p></div></article>';
    }).join('');
    feed.scrollTop = feed.scrollHeight;
  }

  function pollCreatorChat() {
    var url = watchChatUrl();
    if (!url || document.hidden || creatorChat.busy) { return Promise.resolve(); }
    creatorChat.busy = true;
    return api(url + '?limit=50')
      .then(function (payload) {
        var list = (payload && (payload.messages || payload.items)) || [];
        creatorChat.items = [];
        creatorChat.seen = {};
        list.forEach(function (raw) {
          var message = mapCreatorChatMessage(raw);
          if (!message.message || creatorChat.seen[message.id]) { return; }
          creatorChat.seen[message.id] = true;
          creatorChat.items.push(message);
        });
        creatorChat.loaded = true;
        renderCreatorChat();
      })
      .catch(function () { /* a temporary chat request failure must not end the broadcast */ })
      .then(function () { creatorChat.busy = false; });
  }

  function startCreatorChat() {
    if (!watchChatUrl()) { return; }
    if (creatorChat.timer) { window.clearInterval(creatorChat.timer); }
    pollCreatorChat();
    creatorChat.timer = window.setInterval(pollCreatorChat, 2500);
  }

  function stopCreatorChat() {
    if (creatorChat.timer) { window.clearInterval(creatorChat.timer); creatorChat.timer = null; }
  }

  function sendCreatorChat() {
    var input = document.querySelector('[data-creator-chat-input]');
    var url = watchChatUrl();
    var body = input ? input.value.trim() : '';
    if (!url || !body || creatorChat.busy) { return; }
    creatorChat.busy = true;
    var button = document.querySelector('[data-send-creator-chat]');
    if (button) { button.disabled = true; button.textContent = 'Sending…'; }
    /* `body` is the canonical server field. The Watch Page accepts message/text
       for compatibility, but the dashboard writes the native shape directly. */
    api(url, { method: 'POST', json: { body: body } })
      .then(function () { if (input) { input.value = ''; } return pollCreatorChat(); })
      .catch(function (error) { window.alert(error.message || 'Chat message could not be sent.'); })
      .then(function () {
        creatorChat.busy = false;
        if (button) { button.disabled = false; button.textContent = 'Send'; }
      });
  }

  function creatorChatMarkup() {
    var handle = watchChatHandle();
    if (!handle) {
      return '<section class="cs-card" style="margin-top:18px"><h3>Shared Watch Page Chat</h3><p class="cs-sub">Set a public profile handle before opening a live chat room.</p></section>';
    }
    return '<section class="cs-card" style="margin-top:18px"><div class="cs-head-row"><div><h3 style="margin-bottom:5px">Shared Watch Page Chat</h3><p class="cs-sub">Messages here and on your Watch Page are one live conversation.</p></div><a class="gl-btn-line" style="text-decoration:none;white-space:nowrap" target="_blank" rel="noopener" href="' + esc(watchPageUrl()) + '">Open Watch Page ↗</a></div>'
      + '<div data-creator-chat-feed style="max-height:260px;overflow:auto;margin-top:10px"></div><div data-creator-chat-empty style="padding:18px 0;color:#7e92a8;font-size:12.5px">Chat is open. Your viewers can start the conversation now.</div>'
      + '<div style="display:flex;gap:9px;margin-top:12px"><input data-creator-chat-input class="cs-input" maxlength="500" autocomplete="off" placeholder="Reply to viewers…"><button type="button" class="cs-btn cs-btn-primary" data-send-creator-chat>Send</button></div></section>';
  }

  function refreshPreviewMarketData() {
    // Do not spend market-data requests while the tab is not visible, and do
    // not refresh the setup preview once a room is already live.
    if (document.hidden || (draft.step === 4 && draft.live)) { return; }

    // These functions only update their own data containers.  In particular,
    // this routine must not call render(), middleMarkup(), or bindVideo().
    if (draft.ticker) { loadQuote(draft.ticker); }

    // The mover rail is less time-sensitive; refreshing it once a minute
    // avoids repeatedly fanning out multiple chart requests.
    var now = Date.now();
    if (now - lastMoversRefreshAt >= 60000) {
      lastMoversRefreshAt = now;
      loadMovers();
    }
  }

  function spark(values, w, h) {
    if (!values || !values.length) { return ''; }
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = (max - min) || 1;
    var pts = values.map(function (v, i) {
      var x = (i / (values.length - 1 || 1)) * w;
      var y = h - 3 - ((v - min) / span) * (h - 8);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var up = values[values.length - 1] >= values[0];
    var color = up ? '#22d97a' : '#ff566e';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
      + '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/></svg>';
  }

  function paintQuote() {
    var host = document.querySelector('[data-quote]');
    if (!host) { return; }
    if (!quote) { host.style.display = 'none'; return; }
    host.style.display = '';
    host.innerHTML = '<b>' + esc(quote.symbol) + '</b>'
      + '<div class="gl-price">$' + money(quote.price) + '</div>'
      + '<div class="gl-chg' + (quote.change < 0 ? ' gl-down' : '') + '">' + (quote.change >= 0 ? '+' : '') + money(quote.change) + ' (' + (quote.change >= 0 ? '+' : '') + quote.pct.toFixed(2) + '%)</div>'
      + '<div class="gl-session"><i></i>' + esc(marketSession()) + '</div>'
      + spark(quote.series, 220, 44);
  }

  function marketSession() {
    var now = new Date();
    var utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;
    var open = 13.5;
    var close = 20;
    if (utcHour >= open && utcHour < close) { return 'Market Open'; }
    if (utcHour >= 9 && utcHour < open) { return 'Pre-Market'; }
    if (utcHour >= close && utcHour < 24) { return 'After Hours'; }
    return 'Closed';
  }

  function paintMovers() {
    var host = document.querySelector('[data-movers]');
    if (!host) { return; }
    if (!movers.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<span class="gl-movers-label">Top movers to watch:</span>'
      + movers.map(function (m) {
        var pct = m.pct == null ? '' : '<em class="' + (m.pct < 0 ? 'gl-down' : '') + '">' + (m.pct >= 0 ? '+' : '') + m.pct.toFixed(2) + '%</em>';
        return '<span class="gl-mover">' + esc(m.symbol) + pct + '</span>';
      }).join('');
  }

  /* ---------------- middle column ---------------- */

  function middleMarkup() {
    var t = trackInfo();
    var n = netInfo();
    var value = healthScore();
    var c = 2 * Math.PI * 34;
    var color = value >= 75 ? '#22d97a' : (value >= 40 ? '#e0a336' : '#ff566e');
    var quality = value >= 75 ? 'Excellent' : (value >= 40 ? 'Fair' : 'Not ready');
    var qcls = value >= 75 ? '' : (value >= 40 ? ' gl-warn' : ' gl-bad');

    var html = '<section class="cs-card"><div class="cs-head-row" style="margin-bottom:14px"><h3>Studio Preview</h3>'
      + '<span class="gl-badge-q' + qcls + '">' + icon('checkCircle', 15) + esc(quality) + icon('signal', 15) + '</span></div>'
      + '<div class="gl-media"><video data-preview playsinline muted autoplay></video>'
      + (stream ? '' : '<div class="gl-media-empty">' + icon('cam', 30) + '<div>Camera preview is off.<br>Start the preview to check your shot before going live.</div>'
        + '<button class="cs-btn cs-btn-primary" data-action="start-preview" style="height:40px">Start camera preview</button></div>')
      + '<div class="gl-quote" data-quote style="display:none"></div>'
      + overlayPreviewMarkup(false) + '</div>'
      + '<div class="gl-movers" data-movers></div></section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:14px">Stream Health</h3><div class="gl-health"><div>'
      + healthRow('Video', t && t.videoOk, t && t.video ? t.video : 'No camera', 'cam')
      + healthRow('Audio', t && t.audioOk, t && t.audioOk ? (t.audioLabel || 'Good') : 'No microphone', 'mic')
      + healthRow('Internet', n.ok, n.label, 'signal', n.warn)
      + healthRow('Encoder', !!stream, stream ? 'Ready' : 'Waiting', 'settings')
      + '<div class="gl-meter"><i data-meter></i></div></div>'
      + '<div class="gl-gauge"><svg viewBox="0 0 84 84" style="width:84px;height:84px;margin:0 auto">'
      + '<circle cx="42" cy="42" r="34" fill="none" stroke="#1b2634" stroke-width="7"/>'
      + '<circle cx="42" cy="42" r="34" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - value / 100)).toFixed(1) + '" transform="rotate(-90 42 42)"/>'
      + '<text x="42" y="40" text-anchor="middle" fill="#e6edf5" font-size="18" font-weight="800">' + value + '%</text>'
      + '<text x="42" y="55" text-anchor="middle" fill="' + color + '" font-size="10" font-weight="700">' + esc(quality) + '</text></svg>'
      + '<small>' + esc(value >= 75 ? 'You are all set to go live!' : 'Start the preview and check your devices.') + '</small></div></div></section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:14px">Quick Tools</h3><div class="gl-tools">'
      + tool('test', 'Test Stream', stream ? 'Preview running' : 'Run a test', 'test', false)
      + tool('record', recorder ? 'Stop Recording' : 'Start Recording', recorder ? 'Recording locally' : 'Record locally', 'rec', !stream, !!recorder)
      + tool('key', 'Stream Key', 'No RTMP server', 'key', true)
      + tool('alerts', 'Alerts', 'Manage alerts', 'bell', true)
      + tool('polls', 'Polls', 'Create poll', 'poll', true)
      + tool('chat', 'Live Chat Overlay', overlaySettings.enabled ? 'Shown on stream' : 'Configure on-screen chat', 'chat', false, overlaySettings.enabled)
      + '</div></section>';

    html += '<div class="cs-tip">' + icon('star', 18) + '<div><b>Pro Tip:</b> Running a test preview helps ensure everything looks and sounds perfect for your audience.</div></div>';
    return html;
  }

  function healthRow(label, ok, value, ico, warn) {
    var cls = ok ? '' : (warn ? ' gl-warn' : ' gl-off');
    var mark = ok ? icon('checkCircle', 16) : icon('clock', 16);
    return '<div class="gl-health-row"><i class="' + cls.trim() + '">' + mark + '</i><span>' + esc(label) + '</span>'
      + '<b class="' + (ok ? '' : (warn ? 'gl-warn' : 'gl-muted')) + '">' + esc(value) + '</b></div>';
  }

  function tool(key, label, sub, ico, disabled, active) {
    return '<button class="gl-tool' + (active ? ' gl-on' : '') + '" data-tool="' + key + '"'
      + (disabled ? ' disabled title="' + (key === 'test' ? 'Start the preview first' : COMING) + '"' : '') + '>'
      + icon(ico, 19) + '<span><b>' + esc(label) + '</b><small>' + esc(sub) + '</small></span></button>';
  }

  /* ---------------- right rail ---------------- */

  function railMarkup() {
    var html = '<section class="cs-card"><h3 style="margin-bottom:8px">Audience</h3>'
      + AUDIENCES.map(function (a) {
        var on = draft.audience === a.key;
        return '<button class="gl-choice' + (on ? ' gl-on' : '') + '" data-audience="' + a.key + '">'
          + '<span class="gl-choice-ico">' + icon(a.icon, 18) + '</span>'
          + '<span><b>' + esc(a.label) + '</b><small>' + esc(a.sub) + '</small></span><span class="gl-dot"></span></button>';
      }).join('') + '</section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:8px">Engagement Tools</h3>'
      + ENGAGEMENT.map(function (e) {
        var on = !!draft.engagement[e.key];
        return '<button class="gl-switchrow" data-engagement="' + e.key + '">' + icon(e.icon, 17)
          + '<b>' + esc(e.label) + '</b><em class="' + (on ? '' : 'gl-off') + '">' + (on ? 'On' : 'Off') + '</em></button>';
      }).join('')
      + '<button class="gl-btn-line" style="margin-top:12px" data-engage-toggle>Customize Tools</button>'
      + '<div id="ge-root"></div></section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:8px">Monetization</h3>'
      + MONETIZATION.map(function (m) {
        var available = moneyCapabilities[m.key] !== false;
        var on = available && moneyEnabled(m.key);
        var state = available ? (on ? 'On' : 'Off') : 'Soon';
        return '<button class="gl-switchrow gl-money-row" data-monetization="' + m.key + '"'
          + (!available ? ' aria-disabled="true" title="This monetization method is not connected yet."' : '') + '>'
          + icon(m.icon, 17) + '<b>' + esc(m.label) + '</b><em class="gl-money-status '
          + (available ? (on ? '' : 'gl-off') : 'gl-soon') + '">' + state + '</em></button>';
      }).join('')
      + '<a class="gl-btn-line" style="margin-top:12px" id="manage-monetization" href="'
      + esc(cfg.monetizationUrl || '?monetization=1#manage-monetization') + '" data-manage-monetization>'
      + icon('settings', 16) + 'Manage Monetization</a></section>';

    var last = draft.step >= 4;
    html += '<button class="cs-btn ' + (last ? 'cs-btn-gold' : 'cs-btn-primary') + ' cs-btn-wide" data-' + (last ? 'golive' : 'next') + '>'
      + (last ? 'Go Live Now ' + icon('rocket', 18) : 'Continue to ' + esc(STEPS[Math.min(4, draft.step + 1)].label) + icon('arrow', 18)) + '</button>';
    return html;
  }

  /* ---------------- steps ---------------- */

  function orbitMarkup() {
    var cards = draft.orbitCards || [];
    var slots = [];
    for (var i = 0; i < 3; i += 1) {
      var item = cards[i] || {};
      var image = item.preview || item.url || '';
      slots.push(''
        + '<article style="border:1px solid #203246;border-radius:12px;padding:12px;background:rgba(7,15,25,.72);min-width:0">'
        + '<div style="aspect-ratio:16/10;border-radius:9px;overflow:hidden;background:#07111c;display:grid;place-items:center;margin-bottom:10px">'
        + (image ? '<img src="' + esc(image) + '" alt="Orbit image ' + (i + 1) + '" style="width:100%;height:100%;object-fit:cover">' : '<span style="color:#7e92a8;font-size:12px">Orbit image ' + (i + 1) + '</span>')
        + '</div><button type="button" class="gl-btn-line" data-orbit-pick="' + i + '" style="width:100%;margin-bottom:8px">' + (item.url ? 'Replace image' : 'Upload image') + '</button>'
        + '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-orbit-file="' + i + '" hidden>'
        + '<input class="cs-input" maxlength="80" data-orbit-title="' + i + '" value="' + esc(item.title || '') + '" placeholder="Card title" style="margin-bottom:8px">'
        + '<input class="cs-input" maxlength="120" data-orbit-subtitle="' + i + '" value="' + esc(item.subtitle || '') + '" placeholder="Short call to action" style="margin-bottom:8px">'
        + '<input class="cs-input" type="url" data-orbit-link="' + i + '" value="' + esc(item.link || '') + '" placeholder="Double-click destination URL">'
        + '<small style="display:block;color:#7e92a8;margin-top:7px">Single click enlarges; double-click opens the link.</small></article>');
    }
    return '<section class="cs-card"><div class="cs-head-row"><div><h3 style="margin-bottom:5px">3D Orbit Photos <span style="font-size:11px;color:#22d97a">OPTIONAL</span></h3><p class="cs-sub">Add up to three linked images for the live watch page. This is separate from your thumbnail and overlays.</p></div>'
      + '<label class="gl-switchrow" style="width:auto;padding:8px 0;border:0"><input type="checkbox" data-orbit-enabled' + (draft.orbitEnabled ? ' checked' : '') + '> <b>Show on live page</b></label></div>'
      + '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px">' + slots.join('') + '</div>'
      + '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap"><small style="color:#7e92a8">Maximum 3 images. HTTPS links only. Existing stream settings remain unchanged.</small><button type="button" class="gl-btn-line" data-action="save-orbit">Save orbit setup</button></div></section>';
  }

  function stepSetup() {
    var html = '<section class="cs-card"><div class="cs-head-row"><h3>Stream Title &amp; Info</h3>'
      + '<button class="cs-edit" disabled title="' + COMING + '">' + icon('wand', 14) + 'AI Assist</button></div>'
      + '<div class="cs-field"><label>Stream Title <span class="gl-req">*</span><span class="cs-count">' + draft.title.length + '/100</span></label>'
      + '<input class="cs-input" data-field="title" maxlength="100" value="' + esc(draft.title) + '" placeholder="Pre-Market Breakdown: NVDA Key Levels, News &amp; What to Watch"></div>'
      + '<div class="cs-field"><label>Description</label>'
      + '<textarea class="cs-area" data-field="description" maxlength="5000" placeholder="Join me for a pre-market analysis, key support &amp; resistance levels, options activity, and the biggest catalysts to watch today.">' + esc(draft.description) + '</textarea>'
      + '<div class="cs-hint" style="text-align:right">' + draft.description.length + '/5000</div></div>'
      + '<div class="cs-row">'
      + '<div class="cs-field"><label>Category</label><select class="cs-select" data-field="category">'
      + ['Finance / Stock Market', 'Education', 'News & Politics', 'Entertainment'].map(function (o) {
        return '<option' + (draft.category === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') + '</select></div>'
      + '<div class="cs-field"><label>Content Type</label><select class="cs-select" data-field="contentType">'
      + ['Live Market Analysis', 'Trade Alerts', 'Q&A Session', 'Education Session', 'Market Recap'].map(function (o) {
        return '<option' + (draft.contentType === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') + '</select></div>'
      + '</div></section>';

    html += '<section class="cs-card"><h3>Primary Ticker <span style="font-weight:400;font-size:12.5px;color:#8798ac">(Helps us display live data &amp; categorize your stream)</span></h3>'
      + '<div class="gl-ticker-row" style="margin-top:14px">'
      + '<input class="cs-input" data-field="ticker" value="' + esc(draft.ticker) + '" placeholder="NVDA" style="text-transform:uppercase">'
      + '<div class="gl-resolved" data-ticker-name><span>' + esc(draft.tickerName || (draft.ticker ? 'Looking up...' : 'Enter a ticker symbol')) + '</span>'
      + (draft.tickerName ? '<span class="gl-verified" style="margin-left:auto">' + icon('check', 14) + 'Verified</span>' : '') + '</div>'
      + '<button class="cs-edit" style="height:44px" data-action="refresh-ticker">Refresh</button></div>'
      + '<div class="cs-field" style="margin-top:16px"><label>Related Tickers (optional)</label>'
      + '<div class="cs-tags" data-tags="related">'
      + draft.related.map(function (t, i) { return '<span class="cs-tag">' + esc(t) + '<button data-remove-related="' + i + '">&times;</button></span>'; }).join('')
      + '<input data-tag-input="related" placeholder="AMD" style="text-transform:uppercase"></div></div></section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:14px">Stream Thumbnail</h3><div class="gl-thumb-row">'
      + '<div class="gl-thumb-art">' + (draft.thumbUrl ? '<img src="' + esc(draft.thumbUrl) + '" alt="">' : 'No thumbnail yet') + '</div>'
      + '<div class="gl-thumb-side"><p>Recommended size: 1280x720 (16:9)<br>Max file size: 50MB &middot; animated GIFs keep moving</p>'
      + '<button class="gl-btn-line" data-action="pick-thumb">' + icon('upload', 17) + 'Upload Thumbnail</button>'
      + '<button class="gl-btn-line" data-action="grab-frame"' + (stream ? '' : ' disabled title="Start the camera preview first"') + '>' + icon('frame', 17) + 'Choose Frame</button>'
      + '<div class="gl-ai"><button class="cs-edit" disabled title="' + COMING + '">' + icon('wand', 14) + 'AI Thumbnail Generator</button>'
      + '<small>Generate thumbnails with AI</small></div></div></div>'
      + '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden data-input="thumb"></section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:12px">Schedule</h3>'
      + '<div style="display:flex;gap:22px;flex-wrap:wrap;align-items:center">'
      + [['now', 'Go Live Now'], ['later', 'Schedule for Later'], ['recurring', 'Recurring Stream']].map(function (o) {
        var disabled = o[0] === 'recurring';
        return '<button class="gl-choice' + (draft.schedule === o[0] ? ' gl-on' : '') + '" style="width:auto;padding:8px 0;border:0" data-schedule="' + o[0] + '"'
          + (disabled ? ' disabled title="' + COMING + '"' : '') + '><span class="gl-dot" style="margin:0"></span>'
          + '<b style="font-size:13.5px">' + esc(o[1]) + '</b></button>';
      }).join('')
      + '<div style="margin-left:auto;font-size:12.5px;color:#8798ac">Estimated Start<br><b style="color:#e6edf5;font-size:13.5px">'
      + esc(draft.schedule === 'later' && draft.scheduleDate ? (draft.scheduleDate + ' ' + draft.scheduleTime) : 'Now') + '</b></div></div>'
      + (draft.schedule === 'later'
        ? '<div class="cs-row" style="margin-top:14px"><input type="date" class="cs-input" data-field="scheduleDate" value="' + esc(draft.scheduleDate) + '">'
          + '<input type="time" class="cs-input" data-field="scheduleTime" value="' + esc(draft.scheduleTime) + '"></div>'
        : '')
      + '</section>';

    // The live workflow already has a separate 3D model editor. Do not render
    // the legacy Orbit Photos editor here; two controls edited the same feature.

    html += footer('Cancel', 'Continue to Scene & Sources', true);
    return html;
  }

  function stepScene() {
    var html = '<section class="cs-card"><h3 style="margin-bottom:6px">Scene Layout</h3>'
      + '<p class="cs-sub">Choose what your viewers see.</p><div class="gl-scene-grid">'
      + [['camera', 'Camera only', 'Just your webcam'],
         ['screen', 'Screen share', 'Share a chart or window'],
         ['both', 'Screen + camera', 'Screen with camera inset']].map(function (o) {
        var art = o[0] === 'camera'
          ? '<i style="inset:12% 22%"></i>'
          : (o[0] === 'screen' ? '<i style="inset:10%"></i>' : '<i style="inset:10%"></i><i style="right:8%;bottom:9%;width:28%;height:34%;background:#2b6cff"></i>');
        var disabled = o[0] === 'both';
        return '<button class="gl-scene' + (draft.scene === o[0] ? ' gl-on' : '') + '" data-scene="' + o[0] + '"'
          + (disabled ? ' disabled title="' + COMING + '"' : '') + '>'
          + '<div class="gl-scene-art">' + art + '</div><b>' + esc(o[1]) + '</b><small>' + esc(o[2]) + '</small></button>';
      }).join('') + '</div></section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:6px">Sources</h3><p class="cs-sub">Pick the camera and microphone this stream uses.</p>'
      + '<div class="cs-row">'
      + '<div class="cs-field"><label>Camera</label><select class="cs-select" data-field="videoDeviceId">'
      + (devices.video.length
        ? devices.video.map(function (d) { return '<option value="' + esc(d.deviceId) + '"' + (draft.videoDeviceId === d.deviceId ? ' selected' : '') + '>' + esc(d.label || 'Camera') + '</option>'; }).join('')
        : '<option value="">Start the preview to list cameras</option>') + '</select></div>'
      + '<div class="cs-field"><label>Microphone</label><select class="cs-select" data-field="audioDeviceId">'
      + (devices.audio.length
        ? devices.audio.map(function (d) { return '<option value="' + esc(d.deviceId) + '"' + (draft.audioDeviceId === d.deviceId ? ' selected' : '') + '>' + esc(d.label || 'Microphone') + '</option>'; }).join('')
        : '<option value="">Start the preview to list microphones</option>') + '</select></div>'
      + '</div>'
      + '<button class="gl-btn-line" style="width:auto;padding:0 20px" data-action="start-preview">' + icon('cam', 17) + (stream ? 'Restart preview with these devices' : 'Start camera preview') + '</button>'
      + '</section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:6px">Overlays</h3><p class="cs-sub">Layer live market data and moderated chat over your stream.</p>'
      + '<button class="gl-switchrow" data-action="refresh-ticker">' + icon('signal', 17) + '<b>Live ticker card' + (draft.ticker ? ' - $' + esc(draft.ticker) : '') + '</b>'
      + '<em class="' + (quote ? '' : 'gl-off') + '">' + (quote ? 'On' : 'No ticker') + '</em></button>'
      + '<a class="gl-switchrow" id="chat-overlay" href="' + esc(cfg.chatOverlayEditorUrl || '?chat_overlay=1#chat-overlay') + '" data-manage-chat-overlay>'
      + icon('chat', 17) + '<b>On-Screen Live Chat</b><em data-overlay-status class="' + (overlaySettings.enabled ? '' : 'gl-off') + '">'
      + (overlaySettings.enabled ? 'On' : 'Off') + '</em></a>'
      + '<button class="gl-switchrow" disabled title="' + COMING + '">' + icon('poll', 17) + '<b>Lower third &amp; alert overlays</b><em class="gl-off">Off</em></button>'
      + '</section>';

    html += footer('Back to Stream Setup', 'Continue to Stream Settings');
    return html;
  }

  /* ---------------- OBS / RTMP stream key ---------------- */

  var streamKey = null;
  var streamKeyError = '';
  var keyRevealed = false;

  function loadStreamKey(reveal) {
    return api(cfg.streamKeyEndpoint + (reveal ? '?reveal=1' : ''))
      .then(function (d) {
        streamKey = d.key;
        streamKeyError = '';
        keyRevealed = !!(d.key && d.key.stream_key);
        paintObsPanel();
        return d;
      })
      .catch(function (e) {
        streamKeyError = e.message;
        paintObsPanel();
      });
  }

  function paintObsPanel() {
    var host = document.querySelector('[data-obs-panel]');
    if (host) { host.innerHTML = obsPanelMarkup(); }
  }

  function field(label, value, action, hint) {
    return '<div class="cs-field" style="margin-bottom:14px"><label>' + esc(label) + '</label>'
      + '<div style="display:flex;gap:8px">'
      + '<input class="cs-input" readonly value="' + esc(value) + '" data-copy-src>'
      + (action || '')
      + '</div>' + (hint ? '<div class="cs-hint">' + hint + '</div>' : '') + '</div>';
  }

  function obsPanelMarkup() {
    if (streamKeyError) {
      return '<div class="cs-warn-box">' + icon('help', 18) + '<div>' + esc(streamKeyError) + '</div></div>';
    }
    if (!streamKey) {
      return '<div class="cs-hint">Loading your stream key...</div>';
    }

    var html = '';

    if (!streamKey.configured) {
      html += '<div class="cs-warn-box" style="margin-bottom:14px">' + icon('help', 18)
        + '<div>No ingest server is connected yet, so OBS has nowhere to publish. '
        + 'Your key below is already valid and will start working the moment an ingest URL is set.</div></div>';
    }

    html += field('Server', streamKey.ingest_url || 'Not set yet',
      '<button class="gl-btn-line" style="width:auto;padding:0 16px" data-obs="copy-server">Copy</button>',
      'In OBS pick Service: Custom, then paste this as the Server.');

    html += field('Stream Key',
      keyRevealed && streamKey.stream_key ? streamKey.stream_key : streamKey.masked_key,
      '<button class="gl-btn-line" style="width:auto;padding:0 16px" data-obs="'
        + (keyRevealed ? 'copy-key' : 'reveal') + '">' + (keyRevealed ? 'Copy' : 'Reveal') + '</button>'
      + '<button class="gl-btn-line" style="width:auto;padding:0 16px" data-obs="rotate">Reset</button>',
      'Treat this like a password. Anyone with it can broadcast as you. Reset invalidates the old key immediately.');

    if (streamKey.playback_url) {
      html += field('Playback URL', streamKey.playback_url,
        '<button class="gl-btn-line" style="width:auto;padding:0 16px" data-obs="copy-playback">Copy</button>',
        'Where viewers watch. Filled in automatically by your ingest provider.');
    }

    html += '<div class="gl-switchrow" style="border-top:1px solid #16202e;padding-top:12px">'
      + icon('signal', 17) + '<b>Encoder status</b>'
      + '<em class="' + (streamKey.is_live ? '' : 'gl-off') + '">'
      + (streamKey.is_live ? 'Live' : 'Not connected') + '</em></div>';

    if (streamKey.last_used_at) {
      html += '<div class="cs-hint">Last publish: ' + esc(streamKey.last_used_at) + ' UTC</div>';
    }

    html += '<div class="cs-hint" style="margin-top:12px;line-height:1.7">'
      + '<b style="color:#c2cede">Recommended OBS settings</b><br>'
      + 'Output mode Advanced &middot; Encoder x264 or NVENC &middot; Rate control CBR<br>'
      + 'Bitrate 4500 Kbps for 1080p30, 6000 for 1080p60 &middot; Keyframe interval 2s<br>'
      + 'Audio 128 Kbps &middot; 48 kHz stereo</div>';

    // Live video slot picker paints itself in here. Declared as part of this
    // markup so it survives the panel repainting.
    html += '<div id="sc-root"></div>';

    return html;
  }

  /* ---------------- admin: ingest server settings ---------------- */

  var ingest = null;

  function loadIngest() {
    if (!cfg.isAdmin) { return Promise.resolve(); }
    return api(cfg.rtmpSettingsEndpoint)
      .then(function (d) { ingest = d.settings || {}; paintIngestPanel(); })
      .catch(function () { /* non-admin or not reachable */ });
  }

  function paintIngestPanel() {
    var host = document.querySelector('[data-ingest-panel]');
    if (host) { host.innerHTML = ingestPanelMarkup(); }
  }

  function ingestPanelMarkup() {
    if (!ingest) { return '<div class="cs-hint">Loading ingest settings...</div>'; }
    var on = !!ingest.enabled;

    return '<div class="cs-row">'
      + '<div class="cs-field"><label>Server URL</label>'
      + '<input class="cs-input" data-ingest="ingest_url" value="' + esc(ingest.ingest_url || '') + '"'
      + ' placeholder="rtmp://live.stockmarketloop.com/live"></div>'
      + '<div class="cs-field"><label>Playback template</label>'
      + '<input class="cs-input" data-ingest="playback_template" value="' + esc(ingest.playback_template || '') + '"'
      + ' placeholder="https://live.stockmarketloop.com/hls/{key}/index.m3u8"></div>'
      + '</div>'
      + '<div class="cs-field"><label>Auth secret'
      + (ingest.auth_secret_set ? '<span class="cs-count" style="color:#22d97a">set</span>' : '') + '</label>'
      + '<div style="display:flex;gap:8px">'
      + '<input class="cs-input" data-ingest="auth_secret" value="" placeholder="'
      + (ingest.auth_secret_set ? 'Saved - type to replace' : 'Paste the secret the installer printed') + '">'
      + '<button class="gl-btn-line" style="width:auto;padding:0 16px" data-ingest-act="generate">Generate</button>'
      + '</div><div class="cs-hint">Must match the secret in your nginx on_publish URL. '
      + 'Without it, anyone who can reach your site can flip a stream live.</div></div>'
      + '<div class="cs-row"><div class="cs-field"><label>Provider</label>'
      + '<select class="cs-select" data-ingest="provider">'
      + ['generic', 'nginx', 'cloudflare', 'mux'].map(function (p) {
          return '<option value="' + p + '"' + (ingest.provider === p ? ' selected' : '') + '>' + p + '</option>';
        }).join('') + '</select></div>'
      + '<div class="cs-field"><label>Status</label>'
      + '<button class="gl-switchrow" style="margin-top:4px" data-ingest-act="toggle">'
      + icon('signal', 17) + '<b>Ingest enabled</b>'
      + '<em class="' + (on ? '' : 'gl-off') + '">' + (on ? 'On' : 'Off') + '</em></button></div></div>'
      + '<button class="cs-btn cs-btn-primary" style="height:42px" data-ingest-act="save">Save ingest settings</button>';
  }

  function saveIngest(patch) {
    var body = patch || {};
    document.querySelectorAll('[data-ingest]').forEach(function (el) {
      var key = el.getAttribute('data-ingest');
      if (key === 'auth_secret' && !el.value) { return; }   // blank means keep
      body[key] = el.value;
    });
    return api(cfg.rtmpSettingsEndpoint, { method: 'POST', json: body })
      .then(function (d) {
        ingest = d.settings || ingest;
        paintIngestPanel();
        return loadStreamKey(false);
      })
      .catch(function (e) { window.alert(e.message); });
  }

  function stepSettings() {
    var html = '<section class="cs-card"><h3 style="margin-bottom:6px">Video Quality</h3><p class="cs-sub">Applied to your camera when the preview restarts.</p>'
      + '<div class="cs-row">'
      + '<div class="cs-field"><label>Resolution</label><select class="cs-select" data-field="resolution">'
      + ['640x360', '854x480', '1280x720', '1920x1080'].map(function (o) {
        return '<option' + (draft.resolution === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') + '</select></div>'
      + '<div class="cs-field"><label>Frame rate</label><select class="cs-select" data-field="framerate">'
      + [24, 30, 60].map(function (o) {
        return '<option value="' + o + '"' + (Number(draft.framerate) === o ? ' selected' : '') + '>' + o + ' fps</option>';
      }).join('') + '</select></div></div>'
      + '<button class="gl-btn-line" style="width:auto;padding:0 20px" data-action="start-preview">Apply and restart preview</button></section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:6px">Audio</h3><p class="cs-sub">Speak to check your levels.</p>'
      + '<button class="gl-switchrow" data-toggle="echoCancel">' + icon('mic', 17) + '<b>Echo cancellation</b>'
      + '<em class="' + (draft.echoCancel ? '' : 'gl-off') + '">' + (draft.echoCancel ? 'On' : 'Off') + '</em></button>'
      + '<button class="gl-switchrow" data-toggle="noiseSuppress">' + icon('signal', 17) + '<b>Noise suppression</b>'
      + '<em class="' + (draft.noiseSuppress ? '' : 'gl-off') + '">' + (draft.noiseSuppress ? 'On' : 'Off') + '</em></button>'
      + '<div class="cs-label" style="margin-top:16px">Input level</div><div class="gl-meter"><i data-meter></i></div></section>';

    html += '<section class="cs-card"><div class="cs-head-row"><h3>Stream to OBS</h3>'
      + '<span class="gl-badge-q' + (streamKey && streamKey.is_live ? '' : ' gl-warn') + '">'
      + (streamKey && streamKey.is_live ? 'Receiving stream' : 'Waiting for encoder') + '</span></div>'
      + '<p class="cs-sub">Paste these into OBS under Settings &rarr; Stream, choosing Custom as the service.</p>'
      + '<div data-obs-panel>' + obsPanelMarkup() + '</div></section>';

    if (cfg.isAdmin) {
      html += '<section class="cs-card"><h3 style="margin-bottom:6px">Ingest Server <span style="font-weight:400;font-size:12px;color:#8798ac">(admin only)</span></h3>'
        + '<p class="cs-sub">Paste the three values the installer printed, then switch it on. '
        + 'Every streamer picks these up immediately.</p>'
        + '<div data-ingest-panel>' + ingestPanelMarkup() + '</div></section>';
    }

    html += footer('Back to Scene & Sources', 'Continue to Audience & Options');
    return html;
  }

  function stepAudience() {
    var html = '<section class="cs-card"><h3 style="margin-bottom:6px">Where does this stream go?</h3>'
      + '<p class="cs-sub">Your stream always goes to your public Watch Page. You can also host it inside one of your groups — that part is optional.</p>'
      + '<div class="cs-field"><label>Host group <span style="font-weight:400;opacity:.7">(optional)</span></label><select class="cs-select" data-field="groupId">'
      + '<option value="0"' + (Number(draft.groupId) ? '' : ' selected') + '>No group — my Watch Page only</option>'
      + groups.map(function (g) {
          return '<option value="' + esc(g.id) + '"' + (Number(draft.groupId) === Number(g.id) ? ' selected' : '') + '>' + esc(g.name) + '</option>';
        }).join('')
      /* a saved group that is not in the loaded list still has to show as the selection, or the menu would
         read "No group" while Go Live quietly sent the old id */
      + (Number(draft.groupId) && !groups.some(function (g) { return Number(g.id) === Number(draft.groupId); })
        ? '<option value="' + esc(draft.groupId) + '" selected>' + esc(groupName()) + '</option>' : '')
      + '</select>'
      + '<div class="cs-hint">Pick a group to open a live room there and notify its members — you must be a member of it. '
      + 'Leave it on “No group” to go live on your channel only. '
      + '<a style="color:#2b6cff" href="' + esc(cfg.groupsUrl) + '">Browse groups</a></div></div></section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:6px">Engagement</h3><p class="cs-sub">Toggle what viewers can do during the stream.</p>'
      + ENGAGEMENT.map(function (e) {
        var on = !!draft.engagement[e.key];
        return '<button class="gl-switchrow" data-engagement="' + e.key + '">' + icon(e.icon, 17)
          + '<b>' + esc(e.label) + '</b><em class="' + (on ? '' : 'gl-off') + '">' + (on ? 'On' : 'Off') + '</em></button>';
      }).join('') + '</section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:6px">Alerts &amp; Notifications</h3>'
      + '<p class="cs-sub">Posting alerts into the group during a stream is part of the group live system.</p>'
      + '<button class="gl-switchrow" disabled title="' + COMING + '">' + icon('bell', 17) + '<b>Notify followers when I go live</b><em class="gl-off">Off</em></button>'
      + '<button class="gl-switchrow" disabled title="' + COMING + '">' + icon('poll', 17) + '<b>Auto-post stock alerts to the group</b><em class="gl-off">Off</em></button></section>';

    html += footer('Back to Stream Settings', 'Continue to Go Live');
    return html;
  }

  function stepGoLive() {
    if (draft.live) { return stepLiveDashboard(); }
    var ready = readiness();
    var isScheduled = draft.schedule === 'later';
    var html = '<section class="cs-card"><h3 style="margin-bottom:6px">Ready to go live</h3>'
      + '<p class="cs-sub">Scheduling opens your Watch Page and its shared live chat now. Video appears only when your real stream starts.</p>'
      + ready.map(function (r) {
        return '<div class="cs-check' + (r.ok ? '' : ' cs-warn') + '"><i>' + icon(r.ok ? 'check' : 'clock', 16) + '</i>' + esc(r.label)
          + (r.note ? '<span>' + esc(r.note) + '</span>' : '') + '</div>';
      }).join('') + '</section>';

    html += '<section class="cs-card"><h3 style="margin-bottom:14px">Stream summary</h3><dl class="cs-def">'
      + '<dt>Title</dt><dd>' + esc(draft.title || '—') + '</dd>'
      + '<dt>Primary ticker</dt><dd>' + esc(draft.ticker ? '$' + draft.ticker + (draft.tickerName ? ' - ' + draft.tickerName : '') : '—') + '</dd>'
      + '<dt>Category</dt><dd>' + esc(draft.category) + '</dd>'
      + '<dt>Content type</dt><dd>' + esc(draft.contentType) + '</dd>'
      + '<dt>Audience</dt><dd>' + esc((AUDIENCES.filter(function (a) { return a.key === draft.audience; })[0] || {}).label || '') + '</dd>'
      + '<dt>Host group</dt><dd>' + esc(groupName() || 'None — Watch Page only') + '</dd>'
      + '<dt>Scene</dt><dd>' + esc(draft.scene === 'screen' ? 'Screen share' : 'Camera only') + '</dd>'
      + '<dt>Watch Page</dt><dd>' + (watchChatHandle() ? '<a style="color:#2b6cff" href="' + esc(watchPageUrl()) + '" target="_blank" rel="noopener">' + esc(watchPageUrl()) + '</a>' : 'Set a public profile handle first') + '</dd>'
      + '</dl></section>';

    var blocked = ready.filter(function (r) { return !r.ok; }).length;
    html += '<div class="cs-actions"><button class="cs-btn" data-back>' + icon('back', 18) + 'Back to Audience &amp; Options</button>'
      + '<button class="cs-btn cs-btn-gold" data-golive' + (blocked ? ' disabled' : '') + '>' + (isScheduled ? 'Schedule &amp; Open Chat' : 'Go Live Now') + ' ' + icon('rocket', 18) + '</button></div>';
    return html;
  }

  function stepLiveDashboard() {
    if (draft.live && draft.live.status === 'scheduled') {
    var scheduled = !!(draft.live && draft.live.status === 'scheduled');
    var startLabel = scheduledStartLabel(draft.live && draft.live.scheduled_at);
    return '<div class="gl-live-banner"><span class="gl-live-dot"></span>'
      + '<div><b>' + (scheduled ? 'WATCH PAGE OPEN' : 'LIVE') + '</b><span style="display:block">' + esc(draft.title) + '</span></div>'
      + '<button class="cs-btn" style="margin-left:auto;border-color:rgba(255,86,110,.4);color:#ff566e" data-endlive>' + icon('stop', 17) + (scheduled ? 'Cancel scheduled stream' : 'Close Watch Page') + '</button></div>'
      + '<section class="cs-card" style="margin-top:18px"><h3 style="margin-bottom:14px">' + (scheduled ? 'Scheduled stream' : 'Live status') + '</h3><div class="gl-live-stats">'
      + '<div class="gl-stat"><small>' + icon('clock', 14) + (scheduled ? 'Scheduled for' : 'Opened') + '</small><b data-live="scheduled" style="font-size:16px;line-height:1.35">' + esc(startLabel) + '</b></div>'
      + '<div class="gl-stat"><small>' + icon('chat', 14) + 'Shared chat</small><b style="font-size:16px">Open now</b></div>'
      + '<div class="gl-stat"><small>' + icon('cam', 14) + 'Video</small><b style="font-size:16px">' + (scheduled ? 'Waiting to start' : 'Check Watch Page') + '</b></div>'
      + '</div>'
      + '<div class="cs-hint" style="margin-top:14px">Your Watch Page is available now. It shows your thumbnail or GIF until the real stream reports live; this control does not pretend the video is live before then.</div></section>'
      + creatorChatMarkup();
    }

    var elapsed = liveStats.startedAt ? Math.floor((Date.now() - liveStats.startedAt) / 1000) : 0;
    return '<div class="gl-live-banner"><span class="gl-live-dot"></span>'
      + '<div><b>LIVE</b><span style="display:block">' + esc(draft.title) + '</span></div>'
      + '<button class="cs-btn" style="margin-left:auto;border-color:rgba(255,86,110,.4);color:#ff566e" data-endlive>' + icon('stop', 17) + 'End stream</button></div>'
      + '<section class="cs-card" style="margin-top:18px"><h3 style="margin-bottom:14px">Live stats</h3><div class="gl-live-stats">'
      + '<div class="gl-stat"><small>' + icon('clock', 14) + 'Elapsed</small><b data-live="elapsed">' + clock(elapsed) + '</b></div>'
      + '<div class="gl-stat"><small>' + icon('users', 14) + 'Viewers</small><b data-live="viewers">' + compact(liveStats.viewers) + '</b></div>'
      + '<div class="gl-stat"><small>' + icon('signal', 14) + 'Health</small><b>' + healthScore() + '%</b></div>'
      + '</div>'
      + (Number(draft.groupId)
        ? '<div class="cs-hint" style="margin-top:14px">Your live room is open in <b>' + esc(groupName()) + '</b>. '
          + '<a style="color:#2b6cff" href="' + esc(cfg.groupsUrl) + '">Open the group</a> to see chat and viewers.</div>'
        : '<div class="cs-hint" style="margin-top:14px">You are live on your Watch Page — no host group. '
          + '<a style="color:#2b6cff" href="' + esc(watchPageUrl()) + '" target="_blank" rel="noopener">Open your Watch Page</a> to see what viewers see.</div>')
      + '</section>' + creatorChatMarkup();
  }

  function groupName() {
    var id = Number(draft.groupId);
    if (!id) { return ''; }
    var hit = groups.filter(function (g) { return Number(g.id) === id; })[0];
    if (hit) { return hit.name; }
    /* the draft's saved name only counts if it was saved for THIS id — otherwise a stale name from a
       previously picked group showed under the wrong id (2026-09-15) */
    if (draft.groupName && Number(draft.groupNameFor) === id) { return draft.groupName; }
    return 'Group #' + id;
  }

  function readiness() {
    var t = trackInfo();
    var scheduled = draft.schedule === 'later';
    var rows = [
      { label: 'Stream title added', ok: !!draft.title.trim() },
      /* informational only: a host group is optional, so this row can never block Go Live or Schedule */
      { label: Number(draft.groupId) ? 'Host group selected' : 'No host group — Watch Page only', ok: true, note: groupName() || '' },
      { label: 'Public Watch Page handle available', ok: !!watchChatHandle(), note: watchChatHandle() ? '@' + watchChatHandle() : 'Set this in your profile first' }
    ];
    if (scheduled) {
      rows.push({ label: 'Future start date and time selected', ok: !!(draft.scheduleDate && draft.scheduleTime) });
      rows.push({ label: 'Thumbnail or GIF uploaded', ok: !!draft.thumbUrl, note: draft.thumbUrl ? '' : 'Viewers see this before video starts' });
    } else {
      rows.push({ label: 'Camera and microphone running', ok: !!(t && t.videoOk && t.audioOk), note: stream ? '' : 'Preview off' });
      rows.push({ label: 'Connection is good enough', ok: netInfo().ok !== false });
    }
    return rows;
  }

  function footer(backLabel, nextLabel, isCancel) {
    return '<div class="cs-actions"><button class="cs-btn" data-' + (isCancel ? 'cancel' : 'back') + '>'
      + (isCancel ? '' : icon('back', 18)) + esc(backLabel) + '</button>'
      + '<button class="cs-btn cs-btn-primary" data-next>' + esc(nextLabel) + icon('arrow', 18) + '</button></div>';
  }

  /* ---------------- go live ---------------- */

  function scheduledStartLabel(value) {
    var at = Date.parse(value || '');
    if (!at) { return 'Starts when you begin streaming'; }
    return new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function scheduledStartInput() {
    return draft.schedule === 'later' && draft.scheduleDate && draft.scheduleTime
      ? draft.scheduleDate + 'T' + draft.scheduleTime
      : '';
  }

  function scheduledLiveEndpoint() {
    return '/wp-json/sml-scheduled-live/v1/creator';
  }

  function scheduleWatchPage() {
    var blocked = readiness().filter(function (r) { return !r.ok; });
    if (blocked.length) { window.alert(blocked[0].label + ' is still needed.'); return; }

    api(scheduledLiveEndpoint(), {
      method: 'POST',
      json: {
        mode: draft.schedule === 'later' ? 'later' : 'now',
        starts_at: scheduledStartInput(),
        title: draft.title,
        description: draft.description,
        ticker: draft.ticker,
        visibility: draft.audience,
        thumbnail_url: draft.thumbUrl
      }
    }).then(function (payload) {
      if (!payload || !payload.scheduled_live) { throw new Error('The scheduled Watch Page was not created.'); }
      draft.live = payload.scheduled_live;
      if (!draft.live.watch_url) { draft.live.watch_url = watchPageUrl(); }
      liveStats.startedAt = Date.parse(draft.live.scheduled_at || '') || Date.now();
      liveStats.viewers = 0;
      // The scheduled stream now belongs to the server-backed Creator
      // Dashboard. Do not preserve its title, description, thumbnail, date or
      // options as the next Go Live draft.
      markFreshSetupRequired();
      render();
      startCreatorChat();
      startPolling();
    }).catch(function (error) {
      window.alert('Could not open the scheduled Watch Page: ' + error.message);
    });
  }

  function goLive() {
    if (draft.schedule === 'later') { scheduleWatchPage(); return; }
    var blocked = readiness().filter(function (r) { return !r.ok; });
    if (blocked.length) { window.alert(blocked[0].label + ' is still needed.'); return; }

    api(cfg.liveStartEndpoint, {
      method: 'POST',
      json: {
        group_id: Number(draft.groupId),
        kind: draft.scene === 'screen' ? 'screen' : 'video',
        title: draft.title,
        description: draft.description,
        ticker: draft.ticker,
        tickers: [draft.ticker].concat(draft.related || []).filter(Boolean),
        visibility: draft.audience
      }
    }).then(function (payload) {
      draft.live = payload.room || payload || {};
      liveStats.startedAt = Date.now();
      liveStats.viewers = 0;
      save();
      render();
      syncRoomMonetization();
      startCreatorChat();
      startPolling();
    }).catch(function (error) {
      window.alert('Could not start the live room: ' + error.message);
    });
  }

  function endLive() {
    if (draft.live && draft.live.status === 'scheduled') {
      api(scheduledLiveEndpoint(), { method: 'DELETE' })
        .catch(function () { /* a saved record may already be gone */ })
        .then(function () {
          draft.live = null;
          if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null; }
          stopCreatorChat();
          save();
          render();
        });
      return;
    }
    api(cfg.liveStopEndpoint, { method: 'POST', json: { group_id: Number(draft.groupId) } })
      .catch(function () { /* room may already be closed */ })
      .then(function () {
        draft.live = null;
        if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null; }
        stopCreatorChat();
        save();
        render();
      });
  }

  function startPolling() {
    if (pollTimer) { window.clearInterval(pollTimer); }
    if (draft.live && draft.live.status === 'scheduled') { return; }
    pollTimer = window.setInterval(function () {
      var elapsedEl = document.querySelector('[data-live="elapsed"]');
      if (elapsedEl) { elapsedEl.textContent = clock(Math.floor((Date.now() - liveStats.startedAt) / 1000)); }
      api(cfg.liveRoomsEndpoint + '?group_id=' + encodeURIComponent(draft.groupId))
        .then(function (payload) {
          var rooms = payload.rooms || [];
          var mine = rooms.filter(function (r) { return Number(r.host_id || r.owner_id || 0) === Number(cfg.userId); })[0] || rooms[0];
          liveStats.viewers = mine ? Number(mine.viewer_count || mine.viewers || mine.count || 0) : 0;
          var el = document.querySelector('[data-live="viewers"]');
          if (el) { el.textContent = compact(liveStats.viewers); }
        })
        .catch(function () { /* transient */ });
    }, 5000);
  }

  /* ---------------- render ---------------- */

  function paintStepper() {
    if (!stepper) { return; }
    stepper.innerHTML = STEPS.map(function (step, index) {
      var done = index < draft.step;
      var active = index === draft.step;
      var cls = done ? 'cs-done' : (active ? 'cs-active' : '');
      var dot = done ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.6l4.6 4.6L19 7"/></svg>' : String(index + 1);
      return '<button class="cs-step ' + cls + '" data-go="' + index + '"><span class="cs-step-dot">' + dot + '</span>'
        + '<span><b>' + esc(step.label) + '</b><small>' + esc(done ? 'Completed' : step.sub) + '</small></span></button>'
        + (index < STEPS.length - 1 ? '<span class="cs-step-line"></span>' : '');
    }).join('');
  }

  function render() {
    var body;
    if (draft.step === 4) { body = stepGoLive(); }
    else if (draft.step === 3) { body = stepAudience(); }
    else if (draft.step === 2) { body = stepSettings(); }
    else if (draft.step === 1) { body = stepScene(); }
    else { body = stepSetup(); }

    if (window.smlVoiceHostDockBeforeRender) { window.smlVoiceHostDockBeforeRender(); }
    content.innerHTML = body;
    middle.innerHTML = middleMarkup();
    rail.innerHTML = railMarkup();
    paintStepper();
    bindVideo();
    paintQuote();
    paintMovers();
    if (draft.live) { startCreatorChat(); } else { stopCreatorChat(); }
    if (window.smlVoiceHostDockAfterRender) { window.smlVoiceHostDockAfterRender(); }
  }

  /* ---------------- events ---------------- */

  function onClick(event) {
    var target = event.target;

    var go = target.closest('[data-go]');
    if (go) { draft.step = Number(go.getAttribute('data-go')); save(); render(); return; }
    if (target.closest('[data-next]')) {
      if (draft.step === 0 && !draft.title.trim()) { window.alert('Add a stream title first.'); return; }
      draft.step = Math.min(4, draft.step + 1); save(); render(); return;
    }
    if (target.closest('[data-back]')) { draft.step = Math.max(0, draft.step - 1); save(); render(); return; }
    if (target.closest('[data-cancel]')) {
      if (window.confirm('Discard this stream setup?')) {
        try { window.localStorage.removeItem(KEY); } catch (error) { /* ignore */ }
        stopStream(); draft = defaults(); render();
      }
      return;
    }
    if (target.closest('[data-golive]')) { goLive(); return; }
    if (target.closest('[data-endlive]')) { endLive(); return; }
    if (target.closest('[data-send-creator-chat]')) { sendCreatorChat(); return; }

    var audience = target.closest('[data-audience]');
    if (audience) { draft.audience = audience.getAttribute('data-audience'); save(); render(); return; }

    var engagement = target.closest('[data-engagement]');
    if (engagement) {
      var ek = engagement.getAttribute('data-engagement');
      draft.engagement[ek] = !draft.engagement[ek];
      save(); render(); return;
    }

    var manageMoney = target.closest('[data-manage-monetization],[data-monetization]');
    if (manageMoney) {
      if (manageMoney.getAttribute('aria-disabled') === 'true') { return; }
      event.preventDefault();
      openMonetization();
      return;
    }

    if (target.closest('[data-manage-chat-overlay]')) {
      event.preventDefault();
      openChatOverlayEditor();
      return;
    }

    var toggle = target.closest('[data-toggle]');
    if (toggle) {
      var tk = toggle.getAttribute('data-toggle');
      draft[tk] = !draft[tk];
      save(); render();
      if (stream) { startCapture(); }
      return;
    }

    var scene = target.closest('[data-scene]');
    if (scene && !scene.disabled) {
      draft.scene = scene.getAttribute('data-scene');
      save(); render();
      if (stream) { startCapture(); }
      return;
    }

    var schedule = target.closest('[data-schedule]');
    if (schedule && !schedule.disabled) { draft.schedule = schedule.getAttribute('data-schedule'); save(); render(); return; }

    var removeRelated = target.closest('[data-remove-related]');
    if (removeRelated) { draft.related.splice(Number(removeRelated.getAttribute('data-remove-related')), 1); save(); render(); return; }

    var action = target.closest('[data-action]');
    if (action && !action.disabled) {
      var kind = action.getAttribute('data-action');
      if (kind === 'start-preview') { startCapture(); }
      else if (kind === 'refresh-ticker') { loadQuote(draft.ticker); }
      else if (kind === 'pick-thumb') { var input = document.querySelector('[data-input="thumb"]'); if (input) { input.click(); } }
      else if (kind === 'save-orbit') {
        syncOrbitSettings().then(function () { window.alert('Orbit setup saved for your live pages.'); }).catch(function (error) { window.alert(error.message || 'Orbit setup could not be saved.'); });
      }
      else if (kind === 'grab-frame') { grabFrame(); }
      return;
    }

    var orbitPick = target.closest('[data-orbit-pick]');
    if (orbitPick) {
      var orbitInput = document.querySelector('[data-orbit-file="' + orbitPick.getAttribute('data-orbit-pick') + '"]');
      if (orbitInput) { orbitInput.click(); }
      return;
    }

    var ing = target.closest('[data-ingest-act]');
    if (ing) {
      var iop = ing.getAttribute('data-ingest-act');
      if (iop === 'generate') {
        var bytes = new Uint8Array(32);
        window.crypto.getRandomValues(bytes);
        var secret = Array.prototype.map.call(bytes, function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
        var box = document.querySelector('[data-ingest="auth_secret"]');
        if (box) { box.value = secret; }
        window.alert('Secret generated. Put this same value in your nginx on_publish URL, then Save.');
      } else if (iop === 'toggle') {
        saveIngest({ enabled: !(ingest && ingest.enabled) });
      } else if (iop === 'save') {
        saveIngest({}).then(function () { ing.textContent = 'Saved';
          window.setTimeout(function () { paintIngestPanel(); }, 1400); });
      }
      return;
    }

    var obs = target.closest('[data-obs]');
    if (obs) {
      var op = obs.getAttribute('data-obs');
      if (op === 'reveal') {
        loadStreamKey(true);
      } else if (op === 'rotate') {
        if (window.confirm('Reset your stream key? OBS will stop publishing until you paste the new one.')) {
          api(cfg.streamKeyRotateEndpoint, { method: 'POST', json: {} })
            .then(function (d) { streamKey = d.key; keyRevealed = true; paintObsPanel(); })
            .catch(function (e) { window.alert(e.message); });
        }
      } else {
        var value = op === 'copy-server' ? (streamKey && streamKey.ingest_url)
          : op === 'copy-playback' ? (streamKey && streamKey.playback_url)
          : (streamKey && streamKey.stream_key);
        if (value && navigator.clipboard) {
          navigator.clipboard.writeText(value).then(function () {
            obs.textContent = 'Copied';
            window.setTimeout(function () { paintObsPanel(); }, 1400);
          }).catch(function () {});
        }
      }
      return;
    }

    var tool = target.closest('[data-tool]');
    if (tool && !tool.disabled) {
      var tkey = tool.getAttribute('data-tool');
      if (tkey === 'test') { startCapture(); }
      else if (tkey === 'record') { toggleRecording(); }
      else if (tkey === 'chat') { openChatOverlayEditor(); }
      return;
    }
  }

  function grabFrame() {
    var video = document.querySelector('[data-preview]');
    if (!video || !video.videoWidth) { window.alert('Start the camera preview first.'); return; }
    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(function (blob) {
      if (!blob) { return; }
      var form = new FormData();
      form.append('kind', 'photo');
      form.append('purpose', 'thumbnail');
      form.append('media', blob, 'stream-frame.png');
      api(cfg.uploadEndpoint, { method: 'POST', body: form })
        .then(function (payload) { draft.thumbUrl = payload.url || ''; save(); render(); })
        .catch(function (error) { window.alert(error.message); });
    }, 'image/png');
  }

  function toggleRecording() {
    if (recorder) {
      recorder.stop();
      return;
    }
    if (!stream || !window.MediaRecorder) { window.alert('Start the preview first.'); return; }
    recordedChunks = [];

    // If a SuperChat caller is on the line, record the mixed bus so their
    // voice is in the output rather than only in the host's headphones.
    var target = stream;
    if (window.smlVoiceMix) {
      try {
        window.smlVoiceMix.attachHostStream(stream);
        var mixed = window.smlVoiceMix.outputStream();
        if (mixed && window.smlVoiceMix.hasCaller()) {
          target = new MediaStream(
            stream.getVideoTracks().concat(mixed.getAudioTracks())
          );
        }
      } catch (error) { /* fall back to the raw stream */ }
    }

    try {
      recorder = new MediaRecorder(target, { mimeType: 'video/webm' });
    } catch (error) {
      window.alert('Local recording is not supported in this browser.');
      return;
    }
    recorder.ondataavailable = function (event) { if (event.data && event.data.size) { recordedChunks.push(event.data); } };
    recorder.onstop = function () {
      var blob = new Blob(recordedChunks, { type: 'video/webm' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'stockmarketloop-stream-' + Date.now() + '.webm';
      a.click();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      recorder = null;
      render();
    };
    recorder.start();
    render();
  }

  [content, middle, rail].forEach(function (host) { host.addEventListener('click', onClick); });
  if (stepper) { stepper.addEventListener('click', onClick); }

  content.addEventListener('input', function (event) {
    var orbitTitle = event.target.getAttribute('data-orbit-title');
    var orbitSubtitle = event.target.getAttribute('data-orbit-subtitle');
    var orbitLink = event.target.getAttribute('data-orbit-link');
    if (orbitTitle !== null || orbitSubtitle !== null || orbitLink !== null) {
      var orbitIndex = Number(orbitTitle !== null ? orbitTitle : (orbitSubtitle !== null ? orbitSubtitle : orbitLink));
      draft.orbitCards[orbitIndex] = draft.orbitCards[orbitIndex] || {};
      if (orbitTitle !== null) { draft.orbitCards[orbitIndex].title = event.target.value; }
      if (orbitSubtitle !== null) { draft.orbitCards[orbitIndex].subtitle = event.target.value; }
      if (orbitLink !== null) { draft.orbitCards[orbitIndex].link = event.target.value; }
      save();
      return;
    }
    if (event.target.matches('[data-orbit-enabled]')) {
      draft.orbitEnabled = !!event.target.checked;
      save();
      return;
    }
    var field = event.target.getAttribute('data-field');
    if (!field) { return; }
    if (field === 'ticker') {
      draft.ticker = event.target.value.toUpperCase().replace(/[^A-Z]/g, '');
      save();
      window.clearTimeout(window.__glTickerTimer);
      window.__glTickerTimer = window.setTimeout(function () { loadQuote(draft.ticker); }, 500);
      return;
    }
    draft[field] = event.target.value;
    save();
    var counter = event.target.parentNode.querySelector('.cs-count');
    if (counter) { counter.textContent = event.target.value.length + '/100'; }
  });

  content.addEventListener('change', function (event) {
    var orbitFile = event.target.getAttribute('data-orbit-file');
    if (orbitFile !== null && event.target.files && event.target.files[0]) {
      var orbitIndex = Number(orbitFile);
      var file = event.target.files[0];
      if (!/^image\//i.test(file.type || '') || file.size > 20 * 1024 * 1024) {
        window.alert('Orbit cards accept images up to 20 MB each.');
        return;
      }
      draft.orbitCards[orbitIndex] = draft.orbitCards[orbitIndex] || {};
      draft.orbitCards[orbitIndex].preview = URL.createObjectURL(file);
      draft.orbitCards[orbitIndex].uploading = true;
      render();
      var orbitForm = new FormData();
      orbitForm.append('kind', 'photo');
      orbitForm.append('purpose', 'orbit');
      orbitForm.append('media', file, file.name);
      api(cfg.uploadEndpoint, { method: 'POST', body: orbitForm }).then(function (payload) {
        draft.orbitCards[orbitIndex].url = payload.url || '';
        draft.orbitCards[orbitIndex].preview = '';
        draft.orbitCards[orbitIndex].uploading = false;
        save();
        return syncOrbitSettings();
      }).then(function () { render(); }).catch(function (error) {
        draft.orbitCards[orbitIndex].uploading = false;
        window.alert(error.message || 'Orbit image upload failed.');
        render();
      });
      return;
    }
    var field = event.target.getAttribute('data-field');
    if (field) {
      draft[field] = field === 'framerate' || field === 'groupId' ? Number(event.target.value) : event.target.value;
      if (field === 'groupId') {
        var hit = groups.filter(function (g) { return Number(g.id) === Number(draft.groupId); })[0];
        draft.groupName = hit ? hit.name : '';
        draft.groupNameFor = hit ? Number(hit.id) : 0;
      }
      save();
      if (field === 'videoDeviceId' || field === 'audioDeviceId') { startCapture(); }
      else { render(); }
      return;
    }
    if (event.target.getAttribute('data-input') === 'thumb' && event.target.files[0]) {
            var __thumbFile = event.target.files[0];
            if (__thumbFile && (!/^image\/(jpeg|png|webp|gif)$/i.test(__thumbFile.type || '') || __thumbFile.size > 50 * 1024 * 1024)) {
                window.alert('Thumbnails must be a JPEG, PNG, WebP, or GIF file no larger than 50 MB.');
                event.target.value = '';
                return;
            }
      var form = new FormData();
      form.append('kind', 'photo');
      form.append('purpose', 'thumbnail');
      form.append('media', event.target.files[0], event.target.files[0].name);
      api(cfg.uploadEndpoint, { method: 'POST', body: form })
        .then(function (payload) { draft.thumbUrl = payload.url || ''; save(); render(); })
        .catch(function (error) { window.alert(error.message); });
    }
  });

  content.addEventListener('keydown', function (event) {
    if (event.target.getAttribute('data-creator-chat-input') !== null) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendCreatorChat();
      }
      return;
    }
    if (event.target.getAttribute('data-tag-input') !== 'related') { return; }
    if (event.key !== 'Enter' && event.key !== ',') { return; }
    event.preventDefault();
    var value = event.target.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (value && draft.related.indexOf(value) === -1) { draft.related.push(value); }
    event.target.value = '';
    save(); render();
  });

  var saveBtn = document.getElementById('gl-save-draft');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      save();
      saveBtn.textContent = 'Draft saved';
      window.setTimeout(function () { saveBtn.textContent = 'Save Draft'; }, 1600);
    });
  }
  var previewBtn = document.getElementById('gl-preview');
  if (previewBtn) { previewBtn.addEventListener('click', function () { startCapture(); }); }

  // Creator Dashboard swaps views without reloading the page. Consume the
  // one-time reset before it reveals Go Live, so browser history/bfcache can
  // never resurrect the stream that was just scheduled.
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-cs-live-view],[data-cs-view="live"]')) {
      consumeFreshSetupRequirement();
    }
  }, true);
  window.addEventListener('pageshow', function () {
    if (location.hash !== '#creator-dashboard') { consumeFreshSetupRequirement(); }
  });

  window.addEventListener('beforeunload', function () {
    if (previewMarketRefreshTimer) { window.clearInterval(previewMarketRefreshTimer); }
    stopCreatorChat();
    stopStream();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && document.getElementById('gl-money-modal')) { closeMonetization(); }
  });

  restore();
  render();
  // Also catches streams scheduled before this release. The server record is
  // authoritative; if it exists, the browser must not reuse its old setup as
  // the next stream draft.
  clearSetupIfServerHasScheduledStream();
  if (cfg.openMonetization) { openMonetization(); }
  if (cfg.openChatOverlay) { openChatOverlayEditor(); }
  loadMonetizationSettings(false);
  loadGroups();
  loadMovers();
  loadStreamKey(false);
  loadIngest();
  if (draft.ticker) { loadQuote(draft.ticker); }
  // Timed data refreshes deliberately leave the camera preview in place.
  // Keeping the DOM node stable prevents recurring MediaStream flashes.
  previewMarketRefreshTimer = window.setInterval(refreshPreviewMarketData, 15000);
})();
SMLGLJS;
    }
}

if (!function_exists('sml_gl_render_page')) {
    function sml_gl_render_page() {
        $config = sml_gl_config();

        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=' . get_bloginfo('charset'));

        echo '<!doctype html><html ' . get_language_attributes() . '><head>';
        echo '<meta charset="' . esc_attr(get_bloginfo('charset')) . '">';
        echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
        echo '<meta name="robots" content="noindex,nofollow">';
        echo '<title>Go Live - Creator Studio - ' . esc_html(get_bloginfo('name')) . '</title>';
        echo '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
        echo '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
        echo '<style>' . sml_cs_styles() . sml_gl_styles() . sml_vus_dashboard_styles() . '</style></head><body>';

        if (!is_user_logged_in()) {
            echo '<div class="cs-gate"><h1>Sign in to go live</h1><p>Live streaming runs inside your groups, so you need an account before you can start a broadcast.</p>';
            echo '<a class="cs-btn cs-btn-primary" href="' . esc_url($config['loginUrl']) . '">Sign in to continue</a></div></body></html>';
            exit;
        }

        echo '<div class="cs-shell">';

        sml_cs_render_sidebar('live', true);

        echo '<div class="cs-main">';
        echo '<header class="cs-top"><div class="cs-crumb">Creator Studio<span>/</span><b>Go Live</b></div>';
        echo '<div class="cs-autosave"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.6 2.6L16 9.6"/></svg>';
        echo '<span id="gl-autosave-label">Draft saves as you type</span></div>';
        echo '<button class="cs-top-btn" id="gl-save-draft">Save Draft</button>';
        echo '<button class="cs-top-btn" id="gl-preview"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.8"/></svg>Preview</button>';
        echo '<a class="cs-top-btn" href="' . esc_url(home_url('/creator-studio/')) . '"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.8"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4M12 16.8h.01"/></svg>Help</a>';
        echo '<a class="cs-avatar" href="' . esc_url($config['profileUrl']) . '"><img src="' . esc_url($config['avatar']) . '" alt="">';
        echo '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8798ac" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 5.5 6-5.5"/></svg></a>';
        echo '</header>';

        sml_vus_dashboard_markup(true);
        echo '<nav class="cs-steps" id="gl-steps"></nav>';
        echo '<div class="gl-body"><div class="gl-col" id="gl-setup"></div><div class="gl-col" id="gl-middle"></div>';
        echo '<div class="gl-col gl-rail" id="gl-rail"></div></div>';
        echo '</div></div>';

        echo '<script>window.smlGoLiveConfig=' . wp_json_encode($config) . ';window.smlCreatorDashboardConfig=' . wp_json_encode(sml_vus_dashboard_config()) . ';</script>';
        echo '<script>' . sml_gl_script() . '</script>';
        echo '<script>' . sml_vus_dashboard_script() . '</script>';
        echo '<script>(function(){var moving=false;function removeShare(){var n=document.getElementById("sml-live-share");if(!n){return;}n.remove();}function placeVoice(){if(moving){return;}var slot=document.querySelector("[data-sml-voice-host-dock]"),dock=document.querySelector(".vcd");if(!slot||!dock||dock.parentNode===slot){return;}moving=true;slot.innerHTML="";slot.appendChild(dock);dock.classList.add("vcd-inline");moving=false;}function sync(){removeShare();placeVoice();}sync();if(!window.MutationObserver){return;}var o=new MutationObserver(sync);if(document.documentElement){o.observe(document.documentElement,{childList:true,subtree:true});}})();</script>';

        // SuperChat voice call-in dock for the host.
        if (function_exists('sml_voice_print_host_dock') && apply_filters('sml_voice_host_dock_on_go_live', false)) { // owner call 2026-09-09: the Voice Queue dock lives on the live watch page (creator only), not here
            sml_voice_print_host_dock( $config['watchChatHandle'] );
        }

        // How many live video slots viewers get. Sits under the OBS panel,
        // which is where the stream keys already are.
        if (function_exists('sml_slots_print_control')) {
            sml_slots_print_control();
        }

        // Poll and Q&A builder behind the Customize Tools button.
        if (function_exists('sml_engage_print_studio')) {
            sml_engage_print_studio();
        }

        echo '</body></html>';
        exit;
    }
}

if (!function_exists('sml_gl_intercept')) {
    function sml_gl_intercept() {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        $path = trim((string) wp_parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
        if ($path !== 'go-live') {
            return;
        }
        if (isset($_GET['mode']) || isset($_GET['classic'])) {
            return;
        }
        sml_gl_render_page();
    }
}
add_action('template_redirect', 'sml_gl_intercept', 0);
