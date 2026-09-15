<?php
/**
 * Creator Studio upload wizard - client script and page renderer.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_cs_script')) {
    function sml_cs_script() {
        return <<<'SMLSTUDIOJS'
(function () {
  var cfg = window.smlCreatorStudioConfig || {};
  var content = document.getElementById('cs-content');
  var rail = document.getElementById('cs-rail');
  var stepper = document.getElementById('cs-steps');
  var autosaveLabel = document.getElementById('cs-autosave-label');
  if (!content || !rail) { return; }

  var STORAGE_KEY = 'sml-creator-studio-draft-v1';
  var COMING = 'Coming soon - no backend for this yet';

  var STEPS = [
    { label: 'Upload', sub: 'Add your video file' },
    { label: 'Details', sub: 'Video information' },
    { label: 'Enhance', sub: 'Ticker & features' },
    { label: 'Distribute', sub: 'Visibility & audience' },
    { label: 'Review', sub: 'Publish & confirm' }
  ];

  var SURFACES = [
    { key: 'ticker', label: 'Ticker Pages', note: 'Recommended', icon: 'ticker' },
    { key: 'groups', label: 'Group Feeds', note: 'Recommended', icon: 'groups' },
    { key: 'watchlists', label: 'Watchlists', note: 'Recommended', icon: 'list' },
    { key: 'profile', label: 'Creator Profile', note: 'Recommended', icon: 'user' },
    { key: 'movers', label: 'Market Movers', note: 'Optional', icon: 'trend' },
    { key: 'letters', label: 'Loop Letters Newsletter', note: 'Optional', icon: 'mail', disabled: true }
  ];

  function defaults() {
    return {
      step: 0,
      fileName: '', fileSize: 0, uploadPct: 0, uploadState: 'idle',
      uploaded: null,
      title: '', description: '', tags: [],
      contentType: 'Stock Alert / Trade Breakdown',
      language: 'English',
      recordedAt: '',
      thumbUrl: '', thumbName: '',
      chapters: [],
      tickers: [],
      alertImages: [],
      visibility: 'public',
      surfaces: { ticker: true, groups: true, watchlists: true, profile: true, movers: false, letters: false },
      sectors: [], watchInterest: [],
      schedule: 'now', scheduleDate: '', scheduleTime: '10:00',
      push: true,
      publishMode: 'now',
      published: null
    };
  }

  var draft = defaults();
  var file = null;
  var thumbFile = null;
  var xhr = null;
  var publishing = false;
  var publishState = null;

  /* ---------------- utilities ---------------- */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function bytes(size) {
    size = Number(size) || 0;
    if (size >= 1073741824) { return (size / 1073741824).toFixed(2) + ' GB'; }
    if (size >= 1048576) { return (size / 1048576).toFixed(1) + ' MB'; }
    return Math.max(1, Math.round(size / 1024)) + ' KB';
  }

  function compact(n) {
    n = Number(n) || 0;
    if (n >= 1e6) { return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; }
    if (n >= 1e3) { return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; }
    return String(Math.round(n));
  }

  function icon(name, size) {
    var s = size || 19;
    var paths = {
      cloud: '<path d="M7.2 18.4a4.4 4.4 0 0 1-.4-8.8 6 6 0 0 1 11.5 1.4 3.7 3.7 0 0 1-.7 7.4z"/><path d="M12 20V10.4M9 13.2L12 10.2l3 3"/>',
      film: '<rect x="3" y="4.6" width="18" height="14.8" rx="2.4"/><path d="M8 4.6v14.8M16 4.6v14.8M3 12h18"/>',
      check: '<path d="M4.8 12.6l4.6 4.6L19.2 7"/>',
      x: '<path d="M6 6l12 12M18 6L6 18"/>',
      pause: '<rect x="7" y="5.4" width="3.4" height="13.2" rx="1"/><rect x="13.6" y="5.4" width="3.4" height="13.2" rx="1"/>',
      play: '<path d="M8 5.4v13.2L18 12z"/>',
      eye: '<path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.8"/>',
      help: '<circle cx="12" cy="12" r="8.8"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4M12 16.8h.01"/>',
      pencil: '<path d="M4 20l.9-3.8L16.2 4.9a1.9 1.9 0 0 1 2.7 0l.2.2a1.9 1.9 0 0 1 0 2.7L7.8 19.1z"/>',
      arrow: '<path d="M4.8 12h14.4M13.2 6l6 6-6 6"/>',
      back: '<path d="M19.2 12H4.8M10.8 6l-6 6 6 6"/>',
      save: '<path d="M6.4 3.6h11.2v16.8L12 16.4l-5.6 4z"/>',
      share: '<path d="M4 12.6V19a1.6 1.6 0 0 0 1.6 1.6h12.8A1.6 1.6 0 0 0 20 19v-6.4"/><path d="M12 15V3.6M7.6 8L12 3.6 16.4 8"/>',
      plus: '<path d="M12 5.4v13.2M5.4 12h13.2"/>',
      external: '<path d="M14 4.6h5.4V10"/><path d="M19.4 4.6L11 13"/><path d="M18.4 13.6v5a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V7.4a1.8 1.8 0 0 1 1.8-1.8h5"/>',
      ticker: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4v9.2M14.4 9.6c-.6-.8-1.5-1.1-2.5-1.1-1.4 0-2.4.8-2.4 1.9 0 2.7 5.1 1.4 5.1 4.1 0 1.2-1.1 2-2.6 2-1.1 0-2.1-.4-2.7-1.2"/>',
      groups: '<circle cx="8.4" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 18.6c0-2.6 2.4-4.2 5.4-4.2s5.4 1.6 5.4 4.2M15 14.6c3 0 6 1.6 6 4"/>',
      list: '<path d="M6.6 4.6h10.8v15l-5.4-3.6-5.4 3.6z"/>',
      user: '<circle cx="12" cy="8.4" r="3.6"/><path d="M5 20c0-3.4 3.1-5.6 7-5.6s7 2.2 7 5.6"/>',
      trend: '<path d="M4 16.6l5-5.4 3.4 3 6.6-7.2"/><path d="M14.4 6.6h5v5"/>',
      mail: '<rect x="3" y="5.4" width="18" height="13.2" rx="2.4"/><path d="M3.8 7l8.2 6 8.2-6"/>',
      bell: '<path d="M18 15.5V10a6 6 0 1 0-12 0v5.5L4.5 18h15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
      globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.6 12h16.8M12 3.4c2.2 2.4 3.4 5.4 3.4 8.6S14.2 18.2 12 20.6c-2.2-2.4-3.4-5.4-3.4-8.6S9.8 5.8 12 3.4z"/>',
      camera: '<rect x="3" y="6.6" width="18" height="12.8" rx="2.4"/><circle cx="12" cy="13" r="3.4"/><path d="M8.6 6.6l1.2-2.2h4.4l1.2 2.2"/>',
      link: '<path d="M10.4 13.6a3.6 3.6 0 0 0 5.4.4l2.4-2.4a3.6 3.6 0 0 0-5.1-5.1l-1.4 1.3"/><path d="M13.6 10.4a3.6 3.6 0 0 0-5.4-.4l-2.4 2.4a3.6 3.6 0 0 0 5.1 5.1l1.4-1.3"/>',
      live: '<circle cx="12" cy="12" r="2.6"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4M5 5a9.6 9.6 0 0 0 0 14M19 19a9.6 9.6 0 0 0 0-14"/>',
      image: '<rect x="3" y="5" width="18" height="14" rx="2.4"/><circle cx="8.6" cy="10" r="1.6"/><path d="M4.2 17.4l4.8-4.6 3.4 3.2 3-2.8 4.4 4.2"/>',
      cc: '<rect x="2.6" y="5" width="18.8" height="14" rx="3"/><path d="M10 10.4a2.4 2.4 0 1 0 0 3.2M17 10.4a2.4 2.4 0 1 0 0 3.2"/>',
      tag: '<path d="M11.4 3.6H20v8.6l-8.8 8.8a1.6 1.6 0 0 1-2.3 0l-6.3-6.3a1.6 1.6 0 0 1 0-2.3z"/><circle cx="16.4" cy="7.6" r="1.3"/>',
      clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.4l3.4 2"/>',
      chat: '<path d="M20.4 12.4c0 3.9-3.8 7-8.4 7-1 0-2-.2-2.9-.5L4 20.4l1.6-4.2c-.8-1.1-1.3-2.4-1.3-3.8 0-3.9 3.8-7 8.4-7s7.7 3.1 7.7 7z"/>',
      star: '<path d="M12 3.8l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.9l5.8-.8z"/>',
      users: '<circle cx="9" cy="8.4" r="3.4"/><path d="M3 19.4c0-3.1 2.7-5.2 6-5.2s6 2.1 6 5.2"/><path d="M16.4 5.6a3.4 3.4 0 0 1 0 6.4M17.6 14.6c2 .7 3.4 2.4 3.4 4.8"/>',
      rocket: '<path d="M12.4 3.6c3.6 0 7 3.4 7 7 0 4.6-4.4 8.4-7 10-2.6-1.6-7-5.4-7-10 0-3.6 3.4-7 7-7z"/><circle cx="12.4" cy="10" r="2.2"/>',
      scissors: '<circle cx="6.4" cy="6.4" r="2.4"/><circle cx="6.4" cy="17.6" r="2.4"/><path d="M8.4 8L19 18M19 6L8.4 16"/>',
      chart: '<path d="M5 19V11M10.4 19V5M15.8 19v-6M21 19H3"/>'
    };
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || '') + '</svg>';
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

  /* ---------------- persistence ---------------- */

  function save() {
    var copy = {};
    Object.keys(draft).forEach(function (key) { copy[key] = draft[key]; });
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
      if (autosaveLabel) { autosaveLabel.textContent = 'Draft autosaved just now'; }
    } catch (error) { /* storage full or blocked - draft still lives in memory */ }
  }

  function restore() {
    try {
      var stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      if (stored && typeof stored === 'object') {
        Object.keys(defaults()).forEach(function (key) {
          if (stored[key] !== undefined) { draft[key] = stored[key]; }
        });
      }
    } catch (error) { /* corrupt draft - start fresh */ }
    // A File cannot survive a reload, so the upload always restarts.
    if (!file) {
      draft.uploadState = draft.uploaded ? 'done' : 'idle';
      if (!draft.uploaded) { draft.uploadPct = 0; draft.fileName = ''; draft.fileSize = 0; }
    }
  }

  /* ---------------- derived data ---------------- */

  function primaryTicker() { return draft.tickers[0] || ''; }

  function previewTitle() {
    return draft.title || draft.fileName.replace(/\.[a-z0-9]+$/i, '') || 'Untitled video';
  }

  function previewThumb() {
    return draft.thumbUrl || cfg.defaultThumbnail || '';
  }

  function scoreParts() {
    return [
      { label: 'Title is optimized', ok: draft.title.trim().length >= 15 && draft.title.length <= 100 },
      { label: 'Description is valuable', ok: draft.description.trim().length >= 80 },
      { label: 'Tickers are tagged', ok: draft.tickers.length > 0, note: draft.tickers.length + ' tickers' },
      { label: 'Thumbnail is selected', ok: !!draft.thumbUrl },
      { label: 'Chapters added', ok: draft.chapters.length > 0, note: draft.chapters.length + ' chapters' },
      { label: 'Alert images attached', ok: draft.alertImages.length > 0, note: draft.alertImages.length + ' images' },
      { label: 'All required fields complete', ok: errors().length === 0 }
    ];
  }

  function score() {
    var parts = scoreParts();
    var hit = parts.filter(function (p) { return p.ok; }).length;
    return Math.round((hit / parts.length) * 100);
  }

  function distributionParts() {
    var surfaces = Object.keys(draft.surfaces).filter(function (k) { return draft.surfaces[k]; }).length;
    return [
      { label: 'Visibility set to ' + (draft.visibility === 'public' ? 'Public' : draft.visibility), ok: true, note: draft.visibility === 'public' ? 'Great' : 'Limited' },
      { label: 'At least 3 target surfaces selected', ok: surfaces >= 3, note: surfaces + ' selected' },
      { label: 'Relevant tickers added', ok: draft.tickers.length > 0, note: draft.tickers.length ? 'Great' : 'Missing' },
      { label: 'Audience targeting applied', ok: draft.sectors.length > 0 || draft.watchInterest.length > 0, note: (draft.sectors.length + draft.watchInterest.length) ? 'Good' : 'Optional' },
      { label: 'Push notification enabled', ok: draft.push, note: draft.push ? 'Great' : 'Off' },
      { label: 'Scheduled for optimal time', ok: draft.schedule === 'later', note: 'Optional' }
    ];
  }

  function distributionScore() {
    var parts = distributionParts();
    var hit = parts.filter(function (p) { return p.ok; }).length;
    return Math.round((hit / parts.length) * 100);
  }

  function errors() {
    var issues = [];
    if (!draft.uploaded || !draft.uploaded.url) { issues.push('Upload your video file before continuing.'); }
    if (!draft.title.trim()) { issues.push('Add a title before publishing.'); }
    if (draft.title.length > 100) { issues.push('Keep the title under 100 characters.'); }
    if (!draft.description.trim()) { issues.push('Add a description so the watch page is not empty.'); }
    if (!draft.tickers.length) { issues.push('Tag at least one ticker.'); }
    if (draft.schedule === 'later' && (!draft.scheduleDate || !draft.scheduleTime)) { issues.push('Pick a date and time for the scheduled publish.'); }
    return issues;
  }

  function canLeaveStep(step) {
    if (step === 0) { return !!(draft.uploaded && draft.uploaded.url); }
    if (step === 1) { return !!draft.title.trim() && !!draft.description.trim(); }
    return true;
  }

  /* ---------------- upload ---------------- */

  function acceptFile(picked) {
    if (!picked) { return; }
    if (!/^video\//.test(picked.type) && !/\.(mp4|mov|webm|m4v)$/i.test(picked.name)) {
      window.alert('Choose an MP4, MOV or WebM video file.');
      return;
    }
    if (picked.size > cfg.maxBytes) {
      window.alert('That file is larger than the 20GB limit.');
      return;
    }
    file = picked;
    draft.fileName = picked.name;
    draft.fileSize = picked.size;
    draft.uploadPct = 0;
    draft.uploaded = null;
    draft.uploadState = 'uploading';
    if (!draft.title) { draft.title = picked.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '); }
    render();
    startUpload();
  }

  function startUpload() {
    if (!file) { return; }
    var form = new FormData();
    form.append('kind', 'video');
    form.append('media', file, file.name);

    xhr = new XMLHttpRequest();
    xhr.open('POST', cfg.uploadEndpoint, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    if (cfg.nonce) { xhr.setRequestHeader('X-WP-Nonce', cfg.nonce); }

    var started = Date.now();
    xhr.upload.onprogress = function (event) {
      if (!event.lengthComputable) { return; }
      draft.uploadPct = Math.min(99, Math.round((event.loaded / event.total) * 100));
      var elapsed = Math.max(0.4, (Date.now() - started) / 1000);
      var rate = event.loaded / elapsed;
      var remain = rate > 0 ? Math.round((event.total - event.loaded) / rate) : 0;
      paintUploadProgress(bytes(rate) + ' / s', remain);
    };
    xhr.onload = function () {
      var payload = {};
      try { payload = JSON.parse(xhr.responseText || '{}'); } catch (error) { payload = {}; }
      if (xhr.status >= 200 && xhr.status < 300 && payload.url) {
        draft.uploaded = { url: payload.url, name: payload.name || file.name, mime: payload.mime || file.type };
        draft.uploadPct = 100;
        draft.uploadState = 'done';
      } else {
        draft.uploadState = 'error';
        draft.uploadError = payload.message || ('Upload failed (' + xhr.status + ').');
      }
      xhr = null;
      save();
      render();
    };
    xhr.onerror = function () {
      draft.uploadState = 'error';
      draft.uploadError = 'The upload connection dropped.';
      xhr = null;
      render();
    };
    xhr.onabort = function () { xhr = null; };
    xhr.send(form);
  }

  function paintUploadProgress(rateLabel, remainSeconds) {
    var bar = document.querySelector('[data-upload="bar"]');
    var pct = document.querySelector('[data-upload="pct"]');
    var meta = document.querySelector('[data-upload="meta"]');
    if (bar) { bar.style.width = draft.uploadPct + '%'; }
    if (pct) { pct.textContent = draft.uploadPct + '%'; }
    if (meta) {
      var mm = Math.floor(remainSeconds / 60);
      var ss = remainSeconds % 60;
      meta.textContent = 'Uploading... ' + rateLabel + '  •  ' + (mm < 10 ? '0' + mm : mm) + ':' + (ss < 10 ? '0' + ss : ss) + ' remaining';
    }
  }

  function cancelUpload() {
    if (xhr) { xhr.abort(); }
    file = null;
    draft.fileName = '';
    draft.fileSize = 0;
    draft.uploadPct = 0;
    draft.uploaded = null;
    draft.uploadState = 'idle';
    save();
    render();
  }

  function uploadImage(picked, onDone) {
    var form = new FormData();
    form.append('kind', 'photo');
    form.append('media', picked, picked.name);
    return api(cfg.uploadEndpoint, { method: 'POST', body: form }).then(onDone);
  }

  /* ---------------- shared fragments ---------------- */

  function processingRows() {
    var uploaded = draft.uploadState === 'done';
    return [
      { label: 'Upload complete', state: uploaded ? 'ok' : (draft.uploadState === 'uploading' ? 'run' : 'idle') },
      { label: 'Checking file', state: uploaded ? 'ok' : 'idle' },
      { label: 'Processing 1080p', state: 'off' },
      { label: 'Generating preview', state: 'off' },
      { label: 'Extracting audio', state: 'off' },
      { label: 'Generating transcript', state: 'off' },
      { label: 'Analyzing tickers', state: draft.tickers.length ? 'ok' : 'idle' },
      { label: 'Preparing watch page', state: uploaded ? 'ok' : 'idle' }
    ];
  }

  function procMarkup() {
    return '<div class="cs-proc"><b>Processing <span>(this runs in the background)</span></b><div class="cs-proc-grid">'
      + processingRows().map(function (row) {
        var cls = row.state === 'ok' ? 'cs-ok' : (row.state === 'run' ? 'cs-run' : '');
        var title = row.state === 'off' ? ' title="' + COMING + '"' : '';
        var style = row.state === 'off' ? ' style="opacity:.45"' : '';
        var tick = row.state === 'ok' ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#04170d" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.6l4.6 4.6L19 7"/></svg>' : '';
        return '<span class="cs-proc-item ' + cls + '"' + title + style + '><i>' + tick + '</i>' + esc(row.label) + '</span>';
      }).join('')
      + '</div></div>';
  }

  function previewCard(headTitle, link) {
    var thumb = previewThumb();
    return '<div class="cs-rail-card"><div class="cs-rail-head"><b>' + esc(headTitle) + '</b>'
      + (link ? '<button class="cs-rail-link" data-go="4">' + esc(link) + icon('arrow', 14) + '</button>' : '')
      + '</div>'
      + '<div class="cs-prev-art">' + (thumb ? '<img src="' + esc(thumb) + '" alt="">' : '<div style="display:grid;place-items:center;height:100%;color:#3f5570;font-weight:800">' + esc(primaryTicker() ? '$' + primaryTicker() : 'SML') + '</div>') + '</div>'
      + '<div class="cs-prev-title">' + esc(previewTitle()) + '</div>'
      + '<div class="cs-prev-by"><img src="' + esc(cfg.avatar) + '" alt="">'
      + '<div><b>' + esc(cfg.displayName) + '</b><small>@' + esc(cfg.handle) + '</small></div></div></div>';
  }

  function checklistCard(title, parts) {
    return '<div class="cs-rail-card"><div class="cs-rail-head"><b>' + esc(title) + '</b></div>'
      + parts.map(function (part) {
        var mark = part.ok
          ? '<i>' + icon('check', 16) + '</i>'
          : '<i class="cs-warn-i" style="color:#e0a336">' + icon('clock', 16) + '</i>';
        return '<div class="cs-check' + (part.ok ? '' : ' cs-warn') + '">' + mark + esc(part.label)
          + (part.note ? '<span>' + esc(part.note) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
  }

  function ringMarkup(value, color) {
    var r = 32;
    var c = 2 * Math.PI * r;
    var offset = c * (1 - value / 100);
    return '<svg class="cs-ring" viewBox="0 0 78 78"><circle cx="39" cy="39" r="' + r + '" fill="none" stroke="#1b2634" stroke-width="7"/>'
      + '<circle cx="39" cy="39" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" transform="rotate(-90 39 39)"/>'
      + '<text x="39" y="37" text-anchor="middle" fill="#e6edf5" font-size="19" font-weight="800">' + value + '</text>'
      + '<text x="39" y="52" text-anchor="middle" fill="#7b8ca1" font-size="10" font-weight="600">/100</text></svg>';
  }

  function unavailableCard(title, reason) {
    return '<div class="cs-rail-card"><div class="cs-rail-head"><b>' + esc(title) + '</b></div>'
      + '<div style="font-size:13px;color:#7b8ca1;line-height:1.6">' + esc(reason) + '</div></div>';
  }

  /* ---------------- step 1: upload ---------------- */

  function stepUpload() {
    var html = '<section class="cs-card"><h2>Upload Your Video</h2>'
      + '<div class="cs-drop" data-drop>' + icon('cloud', 46)
      + '<b>Drag &amp; drop your video file here</b><div class="cs-or">or</div>'
      + '<button class="cs-drop-btn" data-pick="video">Choose File</button>'
      + '<small>MP4, MOV, WebM &nbsp;&bull;&nbsp; Up to 20GB &nbsp;&bull;&nbsp; Max 6 hours</small></div>'
      + '<input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v" hidden data-input="video">'
      + '<div class="cs-imports">'
      + [['Import from', 'Google Drive', 'link'], ['Import from', 'Dropbox', 'link'], ['Import from', 'URL', 'link'], ['Record from', 'Camera', 'camera'], ['Go Live', 'Instead', 'live']].map(function (item, index) {
        var live = index === 4;
        var tag = live ? 'a' : 'button';
        var attrs = live ? ' href="' + esc(cfg.goLiveUrl) + '"' : ' disabled title="' + COMING + '"';
        return '<' + tag + ' class="cs-import"' + attrs + '><span class="cs-import-ico">' + icon(item[2], 16) + '</span>'
          + '<span>' + esc(item[0]) + '<b>' + esc(item[1]) + '</b></span></' + tag + '>';
      }).join('')
      + '</div>';

    if (draft.fileName) {
      var done = draft.uploadState === 'done';
      var failed = draft.uploadState === 'error';
      html += '<div class="cs-file"><div class="cs-file-top">'
        + '<span class="cs-file-ico">' + icon('film', 22) + '</span>'
        + '<span style="flex:0 0 auto;max-width:280px"><span class="cs-file-name">' + esc(draft.fileName) + '</span>'
        + '<span class="cs-file-size">' + bytes(draft.fileSize) + '</span></span>'
        + '<span class="cs-file-mid"><span class="cs-file-pct" data-upload="pct" style="' + (failed ? 'color:#ff566e' : '') + '">' + (failed ? 'Failed' : draft.uploadPct + '%') + '</span>'
        + '<span class="cs-bar"><i data-upload="bar" style="width:' + draft.uploadPct + '%' + (failed ? ';background:#ff566e' : '') + '"></i></span>'
        + '<span class="cs-file-meta" data-upload="meta">' + esc(failed ? (draft.uploadError || 'Upload failed.') : (done ? 'Upload complete - ready to publish' : 'Preparing upload...')) + '</span></span>';

      if (!done) {
        html += '<button class="cs-icon-btn" data-upload-action="retry" title="' + (failed ? 'Retry upload' : 'Pause is not supported yet') + '"' + (failed ? '' : ' disabled') + '>' + icon(failed ? 'play' : 'pause', 18) + '</button>';
      }
      html += '<button class="cs-icon-btn" data-upload-action="cancel" title="Remove file">' + icon('x', 18) + '</button>';
      html += '</div>' + procMarkup() + '</div>';
    }

    html += '<div class="cs-tip">' + icon('star', 18) + '<div><b>Pro Tip:</b> The more details you add, the more likely your video is to appear in search, ticker pages, and recommended feeds.</div></div>';
    html += '</section>';

    html += '<div class="cs-actions"><button class="cs-btn" data-cancel>Cancel</button>'
      + '<button class="cs-btn cs-btn-primary" data-next' + (canLeaveStep(0) ? '' : ' disabled') + '>Continue to Details' + icon('arrow', 18) + '</button></div>';
    return html;
  }

  function railUpload() {
    var quality = draft.uploaded ? '1080p HD' : 'Waiting for file';
    return previewCard('Watch Page Preview', 'View Full Preview')
      + '<div class="cs-rail-card"><div class="cs-rail-head"><b>Processing Status</b></div>'
      + [
        ['Video Quality', quality, draft.uploaded ? 'cs-green' : ''],
        ['Captions', 'Not available', ''],
        ['Transcript', 'Not available', ''],
        ['Thumbnail', draft.thumbUrl ? 'Selected' : 'Not set', draft.thumbUrl ? 'cs-green' : ''],
        ['Ticker Data', draft.tickers.length ? 'Verified' : 'Not tagged', draft.tickers.length ? 'cs-green' : ''],
        ['Watch Page', draft.uploaded ? 'Ready' : 'Pending', draft.uploaded ? 'cs-green' : '']
      ].map(function (row) {
        var muted = row[1] === 'Not available' ? ' title="' + COMING + '" style="opacity:.55"' : '';
        return '<div class="cs-status-row"' + muted + '><span>' + esc(row[0]) + '</span><b class="' + row[2] + '">' + esc(row[1]) + '</b></div>';
      }).join('') + '</div>'
      + scoreCard()
      + '<div class="cs-rail-card"><div class="cs-rail-head"><b>Visibility</b><button class="cs-edit" data-go="3">Change</button></div>'
      + '<div style="display:flex;align-items:center;gap:11px">' + icon('globe', 22)
      + '<div><b style="display:block;font-size:14px">' + esc(visibilityLabel()) + '</b>'
      + '<small style="color:#8798ac;font-size:12.5px">' + esc(visibilityHint()) + '</small></div></div></div>'
      + '<button class="cs-btn cs-btn-primary cs-btn-wide" data-next' + (canLeaveStep(0) ? '' : ' disabled') + '>Continue to Details' + icon('arrow', 18) + '</button>';
  }

  function scoreCard() {
    var value = score();
    var parts = scoreParts();
    var missing = parts.filter(function (p) { return !p.ok; }).length;
    return '<div class="cs-rail-card"><div class="cs-rail-head"><b>Recommendation Score</b></div>'
      + '<div class="cs-score">' + value + ' <span>/ 100</span></div>'
      + '<div class="cs-bar" style="margin-top:12px"><i style="width:' + value + '%"></i></div>'
      + '<div style="margin-top:10px;font-size:12.5px;color:' + (missing ? '#e0a336' : '#22d97a') + '">'
      + (missing ? missing + ' item' + (missing > 1 ? 's' : '') + ' left to optimize.' : 'Great job! Your video is fully optimized.')
      + '</div><button class="cs-rail-link" style="margin-top:10px" data-go="4">View Score Breakdown' + icon('arrow', 14) + '</button></div>';
  }

  function visibilityLabel() {
    return { public: 'Public', members: 'Members Only', premium: 'Premium' }[draft.visibility] || 'Public';
  }

  function visibilityHint() {
    return {
      public: 'Anyone can watch this video',
      members: 'Visible to registered members only',
      premium: 'Visible to Premium subscribers only'
    }[draft.visibility] || '';
  }

  /* ---------------- step 2: details ---------------- */

  function stepDetails() {
    var html = '<section class="cs-card"><h2>Video Details</h2><p class="cs-sub">Give your video the information viewers and search need.</p>'
      + '<div class="cs-field"><label>Title<span class="cs-count">' + draft.title.length + ' / 100</span></label>'
      + '<input class="cs-input" data-field="title" maxlength="100" value="' + esc(draft.title) + '" placeholder="$INLF Alert Breakdown: 155% Move in Under 30 Minutes"></div>'
      + '<div class="cs-field"><label>Description<span class="cs-count">' + draft.description.length + ' / 5000</span></label>'
      + '<textarea class="cs-area" data-field="description" maxlength="5000" placeholder="Explain the setup, catalyst, targets, risks, or market context.">' + esc(draft.description) + '</textarea></div>'
      + '<div class="cs-field"><label>Tags</label><div class="cs-tags" data-tags="tags">'
      + draft.tags.map(function (tag, index) {
        return '<span class="cs-tag">' + esc(tag) + '<button data-remove-tag="' + index + '" aria-label="Remove">&times;</button></span>';
      }).join('')
      + '<input data-tag-input="tags" placeholder="' + (draft.tags.length ? 'Add another tag' : 'Momentum Play, Day Trading, Discord Alerts') + '"></div>'
      + '<div class="cs-hint">Press Enter or comma to add a tag.</div></div>'
      + '<div class="cs-row-3">'
      + '<div class="cs-field"><label>Content Type</label><select class="cs-select" data-field="contentType">'
      + ['Stock Alert / Trade Breakdown', 'Market Recap', 'Education', 'Technical Analysis', 'News Reaction', 'Interview'].map(function (option) {
        return '<option' + (draft.contentType === option ? ' selected' : '') + '>' + esc(option) + '</option>';
      }).join('') + '</select></div>'
      + '<div class="cs-field"><label>Primary Language</label><select class="cs-select" data-field="language">'
      + ['English', 'Spanish', 'French', 'German', 'Portuguese'].map(function (option) {
        return '<option' + (draft.language === option ? ' selected' : '') + '>' + esc(option) + '</option>';
      }).join('') + '</select></div>'
      + '<div class="cs-field"><label>Recorded</label><input type="date" class="cs-input" data-field="recordedAt" value="' + esc(draft.recordedAt) + '"></div>'
      + '</div></section>';

    html += '<section class="cs-card"><div class="cs-head-row"><h3>Thumbnail &amp; Chapters</h3>'
      + '<button class="cs-edit" data-pick="thumb">' + icon('image', 14) + 'Upload thumbnail</button></div>'
      + '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden data-input="thumb">'
      + '<div class="cs-label">Selected Thumbnail</div><div class="cs-thumb-pick">'
      + '<div class="cs-thumb' + (draft.thumbUrl ? ' cs-on' : '') + '">'
      + (draft.thumbUrl ? '<img src="' + esc(draft.thumbUrl) + '" alt="">' : 'No thumbnail yet')
      + '</div>'
      + '<div class="cs-thumb" title="' + COMING + '" style="opacity:.45">Auto frame 1</div>'
      + '<div class="cs-thumb" title="' + COMING + '" style="opacity:.45">Auto frame 2</div>'
      + '</div>'
      + '<div class="cs-label" style="margin-top:20px">Chapters</div><div class="cs-chapters">'
      + (draft.chapters.length ? draft.chapters.map(function (chapter, index) {
        return '<div class="cs-chapter"><input class="cs-input" data-chapter-time="' + index + '" value="' + esc(chapter.time) + '" placeholder="00:00">'
          + '<input class="cs-input" data-chapter-label="' + index + '" value="' + esc(chapter.label) + '" placeholder="Intro &amp; Alert Setup">'
          + '<button class="cs-icon-btn" data-chapter-remove="' + index + '" aria-label="Remove chapter">' + icon('x', 16) + '</button></div>';
      }).join('') : '<div style="font-size:13px;color:#7b8ca1">No chapters yet. Chapters show as jump links on the watch page.</div>')
      + '</div><button class="cs-add" data-chapter-add>' + icon('plus', 15) + 'Add chapter</button></section>';

    html += navRow('Back to Upload', 'Continue to Enhance');
    return html;
  }

  function railDetails() {
    return previewCard('Watch Page Preview', 'View Full Preview') + scoreCard()
      + checklistCard('Details Checklist', scoreParts().slice(0, 5));
  }

  /* ---------------- step 3: enhance ---------------- */

  function stepEnhance() {
    var html = '<section class="cs-card"><h2>Ticker &amp; Features</h2><p class="cs-sub">Tag the tickers this video covers and attach the alert images that back it up.</p>'
      + '<div class="cs-field"><label>Tagged Tickers</label><div class="cs-tags" data-tags="tickers">'
      + draft.tickers.map(function (ticker, index) {
        return '<span class="cs-tag">$' + esc(ticker) + '<button data-remove-ticker="' + index + '" aria-label="Remove">&times;</button></span>';
      }).join('')
      + '<input data-tag-input="tickers" placeholder="' + (draft.tickers.length ? 'Add another ticker' : 'INLF') + '" style="text-transform:uppercase"></div>'
      + '<div class="cs-hint">The first ticker becomes the primary ticker for the watch page and ticker pages.</div></div>';

    if (draft.tickers.length) {
      html += '<div class="cs-tick-grid" data-ticker-cards>'
        + draft.tickers.slice(0, 6).map(function (ticker) {
          return '<div class="cs-card" style="padding:14px" data-ticker-card="' + esc(ticker) + '">'
            + '<div style="display:flex;align-items:center;justify-content:space-between"><b style="font-size:14.5px">$' + esc(ticker) + '</b>'
            + '<b style="font-size:13px;color:#7b8ca1" data-ticker-change>...</b></div>'
            + '<div style="font-size:12px;color:#8798ac;margin-top:3px" data-ticker-name>Loading...</div>'
            + '<div data-ticker-spark style="margin-top:10px;height:46px"></div></div>';
        }).join('') + '</div>';
    }
    html += '</section>';

    html += '<section class="cs-card"><div class="cs-head-row"><h3>Supporting Media (Alert Images)</h3>'
      + '<button class="cs-edit" data-pick="alert">' + icon('plus', 14) + 'Add image</button></div>'
      + '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden multiple data-input="alert">'
      + (draft.alertImages.length
        ? '<div class="cs-media-grid">' + draft.alertImages.map(function (item, index) {
            return '<div class="cs-media"><div class="cs-media-art"><img src="' + esc(item.url) + '" alt=""></div>'
              + '<div class="cs-media-body"><b>' + esc(item.title || 'Alert image') + '</b>'
              + '<small>' + esc(item.time || '') + '</small>'
              + '<input data-alert-title="' + index + '" value="' + esc(item.title || '') + '" placeholder="$INLF Alert">'
              + '<input data-alert-note="' + index + '" value="' + esc(item.note || '') + '" placeholder="155% Move in Under 30 Minutes">'
              + '<button class="cs-rail-link" style="margin-top:8px;color:#ff566e" data-alert-remove="' + index + '">Remove</button></div></div>';
          }).join('') + '</div>'
        : '<div style="font-size:13px;color:#7b8ca1">No alert images attached yet. These appear on the watch page as supporting evidence.</div>')
      + '</section>';

    html += '<section class="cs-card"><h3>Enhancements</h3><p class="cs-sub">Automatic enhancements are not wired up on this site yet.</p>'
      + '<div class="cs-surface-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">'
      + [['Auto captions', 'cc'], ['Auto transcript', 'list'], ['Auto chapters', 'tag'], ['Noise reduction', 'live'], ['Auto clips', 'scissors'], ['AI title ideas', 'star']].map(function (item) {
        return '<div class="cs-surface" title="' + COMING + '" style="opacity:.45"><span class="cs-surface-ico">' + icon(item[1], 15) + '</span>'
          + '<span><b>' + esc(item[0]) + '</b><small class="cs-opt">Coming soon</small></span><span class="cs-toggle"></span></div>';
      }).join('') + '</div></section>';

    html += navRow('Back to Details', 'Continue to Distribution');
    return html;
  }

  function railEnhance() {
    return previewCard('Watch Page Preview', 'View Full Preview') + scoreCard()
      + checklistCard('Enhance Checklist', scoreParts().slice(2, 6));
  }

  /* ---------------- step 4: distribute ---------------- */

  function stepDistribute() {
    var html = '<section class="cs-card"><h2>Set Distribution &amp; Audience</h2><p class="cs-sub">Choose where your video appears and who will see it.</p>'
      + '<div class="cs-label">1. Visibility</div><div class="cs-hint" style="margin-bottom:12px">Control who can view this video.</div>'
      + '<div class="cs-radio-grid">'
      + [['public', 'Public', 'Anyone on StockMarketLoop can discover and watch.', 'Recommended'],
         ['members', 'Members Only', 'Visible to registered members only.', ''],
         ['premium', 'Premium', 'Visible to Premium subscribers only.', '']].map(function (option) {
        return '<button class="cs-radio' + (draft.visibility === option[0] ? ' cs-on' : '') + '" data-visibility="' + option[0] + '"><i></i>'
          + '<span><b>' + esc(option[1]) + '</b><span>' + esc(option[2]) + '</span>'
          + (option[3] ? '<span class="cs-badge">' + esc(option[3]) + '</span>' : '') + '</span></button>';
      }).join('') + '</div>';

    html += '<div class="cs-head-row" style="margin-top:26px;margin-bottom:6px"><div><div class="cs-label" style="margin:0">2. Target Surfaces</div>'
      + '<div class="cs-hint">Choose where your video will be distributed.</div></div>'
      + '<button class="cs-rail-link" data-select-all>Select All</button></div>'
      + '<div class="cs-surface-grid" style="margin-top:12px">'
      + SURFACES.map(function (surface) {
        var on = !!draft.surfaces[surface.key];
        var attrs = surface.disabled ? ' title="' + COMING + '" style="opacity:.45" disabled' : '';
        return '<button class="cs-surface" data-surface="' + surface.key + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"' + attrs + '>'
          + '<span class="cs-surface-ico">' + icon(surface.icon, 15) + '</span>'
          + '<span><b>' + esc(surface.label) + '</b><small class="' + (surface.note === 'Optional' ? 'cs-opt' : '') + '">' + esc(surface.disabled ? 'Coming soon' : surface.note) + '</small></span>'
          + '<span class="cs-toggle"></span></button>';
      }).join('') + '</div>';

    html += '<div class="cs-row" style="margin-top:26px">'
      + '<div><div class="cs-label">3. Recommended Tickers</div><div class="cs-hint" style="margin-bottom:12px">Show this video on these relevant tickers.</div>'
      + '<div class="cs-tick-grid">'
      + (draft.tickers.length ? draft.tickers.map(function (ticker, index) {
          return '<span class="cs-tick">$' + esc(ticker) + '<button class="cs-x" data-remove-ticker="' + index + '" aria-label="Remove">&times;</button><span class="cs-toggle"></span></span>';
        }).join('') : '<span style="font-size:13px;color:#7b8ca1">Add tickers in the Enhance step.</span>')
      + '</div></div>'
      + '<div><div class="cs-label">4. Audience Targeting</div><div class="cs-hint" style="margin-bottom:12px">Refine who sees your video.</div>'
      + '<div class="cs-row">'
      + '<div><label class="cs-label">Sectors</label><div class="cs-tags" data-tags="sectors">'
      + draft.sectors.map(function (item, index) { return '<span class="cs-tag">' + esc(item) + '<button data-remove-sector="' + index + '">&times;</button></span>'; }).join('')
      + '<input data-tag-input="sectors" placeholder="Technology"></div></div>'
      + '<div><label class="cs-label">Watchlist Interest</label><div class="cs-tags" data-tags="watchInterest">'
      + draft.watchInterest.map(function (item, index) { return '<span class="cs-tag">' + esc(item) + '<button data-remove-interest="' + index + '">&times;</button></span>'; }).join('')
      + '<input data-tag-input="watchInterest" placeholder="Penny Movers"></div></div>'
      + '</div></div></div>';

    html += '<div class="cs-row" style="margin-top:26px">'
      + '<div><div class="cs-label">5. Schedule &amp; Notifications</div><div class="cs-hint" style="margin-bottom:12px">Choose when and how to share.</div>'
      + '<div class="cs-card" style="padding:16px;margin:0"><div class="cs-label" style="margin-bottom:10px">Post Schedule</div>'
      + '<button class="cs-radio' + (draft.schedule === 'now' ? ' cs-on' : '') + '" style="margin-bottom:8px;padding:11px" data-schedule="now"><i></i><span><b>Publish Now</b></span></button>'
      + '<button class="cs-radio' + (draft.schedule === 'later' ? ' cs-on' : '') + '" style="padding:11px" data-schedule="later"><i></i><span><b>Schedule for Later</b></span></button>'
      + '<div class="cs-row" style="margin-top:12px"><input type="date" class="cs-input" data-field="scheduleDate" value="' + esc(draft.scheduleDate) + '"' + (draft.schedule === 'later' ? '' : ' disabled') + '>'
      + '<input type="time" class="cs-input" data-field="scheduleTime" value="' + esc(draft.scheduleTime) + '"' + (draft.schedule === 'later' ? '' : ' disabled') + '></div></div></div>'
      + '<div><div class="cs-label">Push Notification</div><div class="cs-hint" style="margin-bottom:12px">Send a push notification to followers.</div>'
      + '<div class="cs-card" style="padding:16px;margin:0"><button class="cs-surface" data-push role="switch" aria-checked="' + (draft.push ? 'true' : 'false') + '" title="' + COMING + '" style="opacity:.55">'
      + '<span class="cs-surface-ico">' + icon('bell', 15) + '</span><span><b>Notify followers on publish</b><small class="cs-opt">Coming soon</small></span><span class="cs-toggle"></span></button></div></div></div>';

    html += '<div class="cs-label" style="margin-top:26px">6. Social Share Preview</div>'
      + '<div class="cs-hint" style="margin-bottom:12px">How your video appears when shared.</div>'
      + '<div class="cs-surface-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">'
      + [['X (Twitter)', 'x'], ['Facebook', 'f'], ['LinkedIn', 'in'], ['Loop Letter (Preview)', 'mail']].map(function (item) {
        return '<div class="cs-card" style="padding:14px;margin:0"><div style="display:flex;align-items:center;justify-content:space-between">'
          + '<b style="font-size:13px">' + esc(item[0]) + '</b><span class="cs-rail-link" title="' + COMING + '" style="opacity:.5">Edit</span></div>'
          + '<div style="font-size:12.5px;color:#c2cede;margin-top:9px;line-height:1.55">' + esc(previewTitle()) + '</div>'
          + '<div style="font-size:12px;color:#2b6cff;margin-top:7px;word-break:break-all">' + esc(cfg.watchBase) + '...</div></div>';
      }).join('') + '</div></section>';

    html += navRow('Back to Enhance', 'Continue to Review');
    return html;
  }

  function railDistribute() {
    var value = distributionScore();
    return previewCard('Video Preview', 'View full preview')
      + unavailableCard('Estimated Reach', 'Reach estimates need published-video history. This panel fills in once you have analytics on previous uploads.')
      + '<div class="cs-rail-card"><div class="cs-rail-head"><b>Distribution Score</b></div>'
      + '<div style="display:flex;align-items:center;gap:16px">' + ringMarkup(value, '#e0a336')
      + '<div style="font-size:13px;color:#c2cede;line-height:1.55">' + (value >= 80 ? 'Excellent! This video is optimized for maximum distribution.' : 'Turn on more surfaces and tag tickers to widen distribution.') + '</div></div></div>'
      + checklistCard('Distribution Checklist', distributionParts())
      + '<button class="cs-btn cs-btn-primary cs-btn-wide" data-next>Continue to Review' + icon('arrow', 18) + '</button>';
  }

  /* ---------------- step 5: review ---------------- */

  function stepReview() {
    var issues = errors();
    var html = '<section class="cs-card"><h2>Review &amp; Publish Settings</h2><p class="cs-sub">Review everything before you publish your video.</p>'
      + '<div class="cs-review-grid">'
      + '<div class="cs-card" style="margin:0"><div class="cs-head-row"><h3>Video Details</h3><button class="cs-edit" data-go="1">' + icon('pencil', 13) + 'Edit</button></div>'
      + '<dl class="cs-def"><dt>Title</dt><dd>' + esc(draft.title || '—') + '</dd>'
      + '<dt>Description</dt><dd style="font-weight:400;color:#c2cede;line-height:1.6">' + esc(draft.description.slice(0, 260) || '—') + (draft.description.length > 260 ? '...' : '') + '</dd>'
      + '<dt>Tags</dt><dd>' + (draft.tags.length ? esc(draft.tags.join(', ')) : '—') + '</dd>'
      + '<dt>Content Type</dt><dd>' + esc(draft.contentType) + '</dd>'
      + '<dt>Primary Language</dt><dd>' + esc(draft.language) + '</dd>'
      + '<dt>Visibility</dt><dd>' + esc(visibilityLabel()) + '</dd>'
      + '<dt>Recorded</dt><dd>' + esc(draft.recordedAt || '—') + '</dd></dl></div>'

      + '<div class="cs-card" style="margin:0"><div class="cs-head-row"><h3>Thumbnail &amp; Chapters</h3><button class="cs-edit" data-go="1">' + icon('pencil', 13) + 'Edit</button></div>'
      + '<div class="cs-row"><div><div class="cs-label">Selected Thumbnail</div>'
      + '<div class="cs-prev-art">' + (draft.thumbUrl ? '<img src="' + esc(draft.thumbUrl) + '" alt="">' : '<div style="display:grid;place-items:center;height:100%;color:#3f5570;font-size:12px">No thumbnail</div>') + '</div></div>'
      + '<div><div class="cs-label">Chapters</div>'
      + (draft.chapters.length ? draft.chapters.map(function (chapter) {
          return '<div style="display:flex;gap:12px;font-size:13px;padding:4px 0"><span style="color:#7b8ca1;font-variant-numeric:tabular-nums">' + esc(chapter.time) + '</span><span>' + esc(chapter.label) + '</span></div>';
        }).join('') : '<div style="font-size:13px;color:#7b8ca1">None</div>')
      + '</div></div></div>'

      + '<div class="cs-card" style="margin:0"><div class="cs-head-row"><h3>Distribution Summary</h3><button class="cs-edit" data-go="3">' + icon('pencil', 13) + 'Edit</button></div>'
      + '<dl class="cs-def"><dt>Visibility</dt><dd>' + esc(visibilityLabel()) + '</dd>'
      + '<dt>Publish to</dt><dd>StockMarketLoop</dd>'
      + '<dt>Target surfaces</dt><dd>' + esc(SURFACES.filter(function (s) { return draft.surfaces[s.key]; }).map(function (s) { return s.label; }).join(', ') || 'None') + '</dd>'
      + '<dt>Schedule</dt><dd>' + esc(draft.schedule === 'later' ? (draft.scheduleDate + ' ' + draft.scheduleTime) : 'Publish now') + '</dd>'
      + '<dt>Allow embeds</dt><dd>Yes</dd></dl></div>'

      + '<div class="cs-card" style="margin:0"><div class="cs-head-row"><h3>Tagged Tickers</h3><button class="cs-edit" data-go="2">' + icon('pencil', 13) + 'Edit</button></div>'
      + (draft.tickers.length
        ? '<div class="cs-tick-grid" data-ticker-cards>' + draft.tickers.slice(0, 6).map(function (ticker) {
            return '<div class="cs-card" style="padding:12px;margin:0" data-ticker-card="' + esc(ticker) + '">'
              + '<div style="display:flex;align-items:center;justify-content:space-between"><b style="font-size:14px">$' + esc(ticker) + '</b>'
              + '<b style="font-size:12.5px;color:#7b8ca1" data-ticker-change>...</b></div>'
              + '<div style="font-size:11.5px;color:#8798ac;margin-top:2px" data-ticker-name>Loading...</div>'
              + '<div data-ticker-spark style="margin-top:8px;height:40px"></div></div>';
          }).join('') + '</div>'
        : '<div style="font-size:13px;color:#7b8ca1">No tickers tagged.</div>')
      + '</div></div>';

    if (draft.alertImages.length) {
      html += '<div class="cs-card" style="margin-top:18px"><div class="cs-head-row"><h3>Supporting Media (Alert Images)</h3>'
        + '<button class="cs-edit" data-go="2">' + icon('pencil', 13) + 'Edit</button></div>'
        + '<div class="cs-media-grid">' + draft.alertImages.map(function (item) {
          return '<div class="cs-media"><div class="cs-media-art"><img src="' + esc(item.url) + '" alt=""></div>'
            + '<div class="cs-media-body"><b>' + esc(item.title || 'Alert image') + '</b><small>' + esc(item.note || '') + '</small></div></div>';
        }).join('') + '</div></div>';
    }

    html += '<div class="cs-warn-box" style="margin-top:18px">' + icon('help', 18)
      + '<div>Double-check ticker accuracy. Incorrect tickers may reduce discoverability and trust.</div></div>';

    if (issues.length) {
      html += '<div class="cs-warn-box" style="margin-top:12px;background:rgba(255,86,110,.08);border-color:rgba(255,86,110,.28);color:#ffb3bd">'
        + icon('x', 18) + '<div>' + esc(issues[0]) + '</div></div>';
    }
    html += '</section>';

    html += '<div class="cs-actions"><button class="cs-btn" data-back>' + icon('back', 18) + 'Back to Distribution</button>'
      + '<button class="cs-btn cs-btn-gold" data-publish' + (issues.length ? ' disabled' : '') + '>Publish Now ' + icon('rocket', 18) + '</button></div>'
      + '<div class="cs-foot-note">' + icon('save', 14) + 'Your video will be published to StockMarketLoop.</div>';
    return html;
  }

  function railReview() {
    return previewCard('Final Video Preview', 'View full preview')
      + unavailableCard('Estimated Engagement', 'Engagement forecasts need history from your previous uploads. Nothing is estimated here until that data exists.')
      + checklistCard('Pre-Publish Checklist', scoreParts())
      + '<div class="cs-rail-card"><div class="cs-rail-head"><b>Publish Options</b></div>'
      + [['now', 'Publish Now', 'Make your video public immediately'],
         ['schedule', 'Schedule', 'Pick a date and time to publish'],
         ['unlisted', 'Save as Unlisted', 'Share with anyone who has the link']].map(function (option) {
        return '<button class="cs-radio' + (draft.publishMode === option[0] ? ' cs-on' : '') + '" style="margin-bottom:8px;width:100%" data-publish-mode="' + option[0] + '"><i></i>'
          + '<span><b>' + esc(option[1]) + '</b><span>' + esc(option[2]) + '</span></span></button>';
      }).join('') + '</div>'
      + '<button class="cs-btn cs-btn-gold cs-btn-wide" data-publish' + (errors().length ? ' disabled' : '') + '>Publish Now ' + icon('rocket', 18) + '</button>';
  }

  /* ---------------- publishing + success ---------------- */

  var PUB_TASKS = [
    { key: 'details', label: 'Saving Video Details', sub: 'Storing title, description, tags & chapters.', icon: 'save', real: true },
    { key: 'media', label: 'Attaching Media', sub: 'Linking thumbnail and alert images.', icon: 'image', real: true },
    { key: 'watch', label: 'Creating Watch Page', sub: 'Building the public watch page and URL.', icon: 'globe', real: true },
    { key: 'surfaces', label: 'Distribution to Ticker Pages', sub: 'Publishing to relevant ticker pages.', icon: 'ticker', real: true },
    { key: 'encode', label: 'Encoding Video', sub: 'Encoding 1080p HD version for optimal playback.', icon: 'film', real: false },
    { key: 'captions', label: 'Captions Sync', sub: 'Syncing auto-captions and optimizing readability.', icon: 'cc', real: false },
    { key: 'push', label: 'Push Notifications', sub: 'Notifying subscribers and relevant audiences.', icon: 'bell', real: false },
    { key: 'letters', label: 'Loop Letters Placement', sub: 'Including in upcoming Loop Letters.', icon: 'mail', real: false }
  ];

  function stepPublishing() {
    var state = publishState || { pct: 0, done: {}, activity: [] };
    var html = '<section class="cs-card"><div class="cs-head-row"><div><h2>Publishing Your Video</h2>'
      + '<p class="cs-sub" style="margin:0">Hang tight! We are publishing and distributing your video across StockMarketLoop.</p></div></div>'
      + '<div style="display:flex;align-items:center;gap:22px;margin:8px 0 6px">'
      + '<span class="cs-pub-pct">' + state.pct + '%</span>'
      + '<div><b style="font-size:16px">' + esc(state.failed ? 'Publishing failed' : (state.pct >= 100 ? 'Finishing up...' : 'Publishing in progress...')) + '</b>'
      + '<div style="font-size:13px;color:#8798ac;margin-top:4px">' + esc(state.failed ? (state.error || 'Something went wrong.') : 'This page updates automatically') + '</div></div></div>'
      + '<div class="cs-bar cs-blue" style="height:9px"><i class="' + (state.failed ? '' : 'cs-stripe') + '" style="width:' + state.pct + '%' + (state.failed ? ';background:#ff566e' : '') + '"></i></div>'
      + '<h3 style="margin:24px 0 4px">Publishing Tasks</h3>'
      + PUB_TASKS.map(function (task) {
        var status = state.done[task.key] || (task.real ? 'pending' : 'off');
        var pct = status === 'done' ? 100 : (status === 'run' ? 60 : 0);
        var label = { done: 'Completed', run: 'In progress', pending: 'Pending', off: 'Not enabled', fail: 'Failed' }[status];
        var cls = status === 'done' ? 'cs-done' : (status === 'run' ? 'cs-run' : '');
        var dim = status === 'off' ? ' style="opacity:.45" title="' + COMING + '"' : '';
        return '<div class="cs-task"' + dim + '><span class="cs-task-ico">' + icon(task.icon, 19) + '</span>'
          + '<span><b>' + esc(task.label) + '</b><small>' + esc(task.sub) + '</small></span>'
          + '<span class="cs-bar cs-blue"><i class="' + (status === 'run' ? 'cs-stripe' : '') + '" style="width:' + pct + '%"></i></span>'
          + '<span class="cs-task-pct">' + pct + '%</span>'
          + '<span class="cs-task-state ' + cls + '">' + esc(label) + '</span></div>';
      }).join('')
      + '<div class="cs-tip" style="margin-top:18px">' + icon('star', 18) + '<div>You can safely leave this page open. Publishing continues in the background.</div></div>'
      + '</section>';

    if (state.failed) {
      html += '<div class="cs-actions"><button class="cs-btn" data-go="4">' + icon('back', 18) + 'Back to Review</button>'
        + '<button class="cs-btn cs-btn-primary" data-publish>Try publishing again</button></div>';
    }
    return html;
  }

  function railPublishing() {
    var state = publishState || { activity: [] };
    return previewCard('Video Preview', '')
      + '<div class="cs-rail-card"><div class="cs-rail-head"><b>Publishing Activity</b>'
      + '<span style="font-size:12px;color:#22d97a;display:flex;align-items:center;gap:6px"><i style="width:7px;height:7px;border-radius:50%;background:#22d97a;display:block"></i>Live updates</span></div>'
      + (state.activity || []).map(function (row) {
        var cls = row.state === 'run' ? ' cs-run' : (row.state === 'pending' ? ' cs-pending' : '');
        return '<div class="cs-activity"><time>' + esc(row.time || '...') + '</time><span>' + esc(row.label) + '</span>'
          + '<em class="' + cls.trim() + '">' + esc({ done: 'Completed', run: 'In progress', pending: 'Pending', fail: 'Failed' }[row.state] || '') + '</em></div>';
      }).join('') + '</div>';
  }

  function stepComplete() {
    var published = draft.published || {};
    var html = '<div class="cs-hero"><span class="cs-hero-ico">' + icon('check', 24) + '</span>'
      + '<div><b>Video Published Successfully!</b><span>Your video is now live and reaching traders and investors.</span></div>'
      + '<a href="' + esc(published.watch_url || '#') + '">View Live Video' + icon('arrow', 16) + '</a></div>';

    html += '<section class="cs-card"><h2>Your Video is Live</h2>'
      + '<p class="cs-sub">Your content is now live and discoverable across StockMarketLoop.</p>'
      + '<div class="cs-live-grid"><div class="cs-live-art">'
      + (previewThumb() ? '<img src="' + esc(previewThumb()) + '" alt="">' : '') + '</div>'
      + '<div><h3 style="font-size:19px;line-height:1.35">' + esc(published.title || previewTitle()) + '</h3>'
      + '<div style="margin-top:10px"><span class="cs-pill-live">LIVE</span></div>'
      + '<div class="cs-prev-by" style="margin-top:14px"><img src="' + esc(cfg.avatar) + '" alt="">'
      + '<div><b>' + esc(cfg.displayName) + '</b><small>@' + esc(cfg.handle) + '</small></div></div>'
      + '<dl class="cs-def" style="margin-top:16px;grid-template-columns:110px minmax(0,1fr)">'
      + '<dt>Published</dt><dd>' + esc(published.published_label || 'Just now') + '</dd>'
      + '<dt>Visibility</dt><dd>' + esc(visibilityLabel()) + '</dd>'
      + '<dt>Content Type</dt><dd>' + esc(draft.contentType) + '</dd>'
      + '<dt>Watch URL</dt><dd style="word-break:break-all"><a style="color:#2b6cff" href="' + esc(published.watch_url || '#') + '">' + esc(published.watch_url || '') + '</a></dd></dl></div></div>'
      + '<div class="cs-cta-row">'
      + '<a class="cs-cta cs-primary" href="' + esc(published.watch_url || '#') + '">View Live Video' + icon('arrow', 17) + '</a>'
      + '<button class="cs-cta" data-copy="' + esc(published.watch_url || '') + '">' + icon('share', 17) + 'Share</button>'
      + '<a class="cs-cta" href="' + esc(cfg.profileUrl) + '">' + icon('pencil', 17) + 'Create Post</a>'
      + '<button class="cs-cta" data-restart>' + icon('cloud', 17) + 'Upload Another</button>'
      + '</div></section>';

    html += '<section class="cs-card"><h3>Now Live Across StockMarketLoop</h3>'
      + '<p class="cs-sub">Where this video has been distributed.</p><div class="cs-dist-grid">'
      + [['Creator Profile', 'Live on your profile', cfg.profileUrl, 'View Profile', draft.surfaces.profile],
         ['Ticker Pages', primaryTicker() ? 'Featured on $' + primaryTicker() + ' page' : 'No ticker tagged', primaryTicker() ? cfg.watchBase.replace('/watch/', '/ticker/' + primaryTicker().toLowerCase() + '/') : '#', 'View Ticker Page', draft.surfaces.ticker && !!primaryTicker()],
         ['Group Feed', draft.surfaces.groups ? 'Shared in relevant groups' : 'Not shared', cfg.creatorStudioUrl, 'View Groups', draft.surfaces.groups],
         ['Loop Letters', 'Not enabled yet', '#', 'Learn more', false]].map(function (item) {
        return '<div class="cs-dist"' + (item[4] ? '' : ' style="opacity:.5"') + '><div class="cs-dist-top">' + icon('globe', 16) + esc(item[0])
          + (item[4] ? icon('check', 16) : '') + '</div><p>' + esc(item[1]) + '</p>'
          + '<a href="' + esc(item[2]) + '">' + esc(item[3]) + '</a></div>';
      }).join('') + '</div></section>';
    return html;
  }

  function railComplete() {
    var e = (draft.published && draft.published.engagement) || { views: 0, likes: 0, comments: 0 };
    return '<div class="cs-rail-card"><div class="cs-rail-head"><b>Performance Snapshot</b></div>'
      + '<div style="font-size:12.5px;color:#8798ac;margin-bottom:12px">Since publishing</div>'
      + '<div class="cs-metrics">'
      + [['Live Views', compact(e.views), 'eye'], ['Likes', compact(e.likes), 'star'], ['Comments', compact(e.comments), 'chat'], ['Watchlist Saves', compact(e.saves || 0), 'save']].map(function (m) {
        return '<div class="cs-metric"><small>' + icon(m[2], 14) + esc(m[0]) + '</small><b>' + esc(m[1]) + '</b></div>';
      }).join('') + '</div>'
      + '<a class="cs-rail-link" style="margin-top:12px;display:inline-flex" href="' + esc(cfg.creatorStudioUrl) + '">View Full Analytics' + icon('arrow', 14) + '</a></div>'
      + '<div class="cs-rail-card"><div class="cs-rail-head"><b>What\'s Next?</b></div>'
      + [['Post in a group', 'Share and engage with your community', 'groups', cfg.creatorStudioUrl],
         ['Go Live', 'Start a live session and connect in real-time', 'live', cfg.goLiveUrl],
         ['Analyze performance', 'Dive deeper into your video analytics', 'chart', cfg.creatorStudioUrl]].map(function (item) {
        return '<a class="cs-next" href="' + esc(item[3]) + '"><span class="cs-next-ico">' + icon(item[2], 17) + '</span>'
          + '<span><b>' + esc(item[0]) + '</b><small>' + esc(item[1]) + '</small></span>' + icon('arrow', 16) + '</a>';
      }).join('') + '</div>';
  }

  function navRow(backLabel, nextLabel) {
    return '<div class="cs-actions"><button class="cs-btn" data-back>' + icon('back', 18) + esc(backLabel) + '</button>'
      + '<button class="cs-btn cs-btn-primary" data-next>' + esc(nextLabel) + icon('arrow', 18) + '</button></div>';
  }

  /* ---------------- publish flow ---------------- */

  function pushActivity(label, state) {
    var now = new Date();
    publishState.activity.push({
      time: now.getHours() + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes(),
      label: label,
      state: state
    });
  }

  function setTask(key, state, pct) {
    publishState.done[key] = state;
    if (typeof pct === 'number') { publishState.pct = pct; }
    render();
  }

  function publish() {
    if (publishing) { return; }
    var issues = errors();
    if (issues.length) { window.alert(issues[0]); return; }

    publishing = true;
    publishState = { pct: 4, done: {}, activity: [] };
    draft.step = 5;
    pushActivity('Upload received', 'done');
    render();

    var visibility = draft.publishMode === 'unlisted' ? 'unlisted'
      : (draft.publishMode === 'schedule' || draft.schedule === 'later') ? 'scheduled'
      : draft.visibility;

    var payload = {
      title: draft.title,
      seo_title: draft.title,
      description: draft.description,
      ticker: primaryTicker(),
      tickers: draft.tickers,
      visibility: visibility,
      video_url: draft.uploaded.url,
      video_name: draft.uploaded.name,
      video_mime: draft.uploaded.mime,
      thumbnail_url: draft.thumbUrl,
      tags: draft.tags,
      hashtags: draft.tickers.map(function (t) { return '#' + t; }),
      chapters: draft.chapters,
      alert_images: draft.alertImages,
      content_type: draft.contentType,
      language: draft.language,
      recorded_at: draft.recordedAt,
      surfaces: Object.keys(draft.surfaces).filter(function (k) { return draft.surfaces[k]; }),
      sectors: draft.sectors,
      watch_interest: draft.watchInterest,
      schedule_at: draft.schedule === 'later' ? (draft.scheduleDate + 'T' + draft.scheduleTime) : ''
    };

    setTask('details', 'run', 18);
    pushActivity('Video details saved', 'run');

    api(cfg.publishEndpoint, { method: 'POST', json: payload })
      .then(function (response) {
        setTask('details', 'done', 42);
        publishState.activity[publishState.activity.length - 1].state = 'done';
        setTask('media', 'done', 60);
        pushActivity('Media attached', 'done');
        setTask('watch', 'done', 82);
        pushActivity('Watch page created', 'done');
        setTask('surfaces', 'done', 100);
        pushActivity('Distribution complete', 'done');

        draft.published = {
          watch_url: response.watch_url || (response.video && response.video.watch_url) || '',
          title: (response.video && response.video.title) || draft.title,
          published_label: new Date().toLocaleString(),
          engagement: { views: 0, likes: 0, comments: 0, saves: 0 }
        };
        publishing = false;
        draft.step = 6;
        save();
        render();
      })
      .catch(function (error) {
        publishing = false;
        publishState.failed = true;
        publishState.error = error.message || 'Publishing failed.';
        publishState.done.details = 'fail';
        pushActivity('Publishing failed', 'fail');
        render();
      });
  }

  /* ---------------- ticker cards ---------------- */

  function sparkline(values, width, height) {
    if (!values.length) { return ''; }
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = (max - min) || 1;
    var points = values.map(function (value, index) {
      var x = (index / (values.length - 1 || 1)) * width;
      var y = height - 3 - ((value - min) / span) * (height - 8);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var up = values[values.length - 1] >= values[0];
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" style="width:100%;height:100%">'
      + '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + (up ? '#22d97a' : '#ff566e') + '" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  }

  function hydrateTickers() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ticker-card]'), function (card) {
      var symbol = card.getAttribute('data-ticker-card');
      api(cfg.chartEndpoint + '/' + encodeURIComponent(symbol) + '?range=1Y&interval=1d')
        .then(function (payload) {
          var bars = ((payload.data || payload).bars) || [];
          if (!bars.length) { throw new Error('no bars'); }
          var window30 = bars.slice(-30);
          var first = window30[0].close;
          var last = window30[window30.length - 1].close;
          var pct = first ? ((last - first) / first) * 100 : 0;
          var changeEl = card.querySelector('[data-ticker-change]');
          changeEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
          changeEl.style.color = pct >= 0 ? '#22d97a' : '#ff566e';
          card.querySelector('[data-ticker-spark]').innerHTML = sparkline(window30.map(function (b) { return b.close; }), 160, 44);
          return api(cfg.searchEndpoint + '?q=' + encodeURIComponent(symbol));
        })
        .then(function (payload) {
          var rows = payload.results || payload.tickers || payload || [];
          if (!Array.isArray(rows)) { return; }
          var hit = rows.filter(function (row) { return String(row.symbol || row.ticker || '').toUpperCase() === symbol; })[0];
          var name = hit && (hit.name || hit.company || hit.company_name);
          card.querySelector('[data-ticker-name]').textContent = name || symbol;
        })
        .catch(function () {
          var nameEl = card.querySelector('[data-ticker-name]');
          var changeEl = card.querySelector('[data-ticker-change]');
          if (nameEl) { nameEl.textContent = 'No market data'; }
          if (changeEl) { changeEl.textContent = '—'; }
        });
    });
  }

  /* ---------------- render ---------------- */

  function paintStepper() {
    if (!stepper) { return; }
    var current = Math.min(draft.step, 4);
    var publishingNow = draft.step >= 5;
    stepper.innerHTML = STEPS.map(function (step, index) {
      var label = step.label;
      var sub = step.sub;
      if (index === 4 && publishingNow) {
        label = 'Publish';
        sub = draft.step === 6 ? 'Live' : 'Publishing in progress';
      }
      var done = index < current || (draft.step === 6 && index <= 4) || (publishingNow && index < 4);
      var active = !done && index === current;
      var cls = done ? 'cs-done' : (active ? 'cs-active' : '');
      var dot = done ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.6l4.6 4.6L19 7"/></svg>' : String(index + 1);
      return '<button class="cs-step ' + cls + '" data-go="' + index + '"><span class="cs-step-dot">' + dot + '</span>'
        + '<span><b>' + esc(label) + '</b><small>' + esc(done && index < 4 ? 'Completed' : sub) + '</small></span></button>'
        + (index < STEPS.length - 1 ? '<span class="cs-step-line"></span>' : '');
    }).join('');
  }

  function render() {
    var body, side;
    if (draft.step === 6) { body = stepComplete(); side = railComplete(); }
    else if (draft.step === 5) { body = stepPublishing(); side = railPublishing(); }
    else if (draft.step === 4) { body = stepReview(); side = railReview(); }
    else if (draft.step === 3) { body = stepDistribute(); side = railDistribute(); }
    else if (draft.step === 2) { body = stepEnhance(); side = railEnhance(); }
    else if (draft.step === 1) { body = stepDetails(); side = railDetails(); }
    else { body = stepUpload(); side = railUpload(); }

    content.innerHTML = body;
    rail.innerHTML = side;
    paintStepper();
    hydrateTickers();
  }

  /* ---------------- events ---------------- */

  function addTag(kind, value) {
    value = String(value || '').trim().replace(/,+$/, '').trim();
    if (!value) { return; }
    if (kind === 'tickers') {
      value = value.toUpperCase().replace(/[^A-Z]/g, '');
      if (!value) { return; }
    }
    var list = draft[kind];
    if (list.indexOf(value) === -1) { list.push(value); }
    save();
    render();
  }

  content.addEventListener('click', function (event) {
    var target = event.target;

    var go = target.closest('[data-go]');
    if (go) { draft.step = Number(go.getAttribute('data-go')); save(); render(); return; }

    if (target.closest('[data-next]')) {
      if (!canLeaveStep(draft.step)) { window.alert('Finish this step before continuing.'); return; }
      draft.step = Math.min(4, draft.step + 1);
      save(); render(); return;
    }
    if (target.closest('[data-back]')) { draft.step = Math.max(0, draft.step - 1); save(); render(); return; }
    if (target.closest('[data-cancel]')) {
      if (window.confirm('Discard this draft?')) {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) { /* ignore */ }
        draft = defaults(); file = null; save(); render();
      }
      return;
    }
    if (target.closest('[data-publish]')) { publish(); return; }
    if (target.closest('[data-restart]')) {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) { /* ignore */ }
      draft = defaults(); file = null; publishState = null; render(); return;
    }

    var copy = target.closest('[data-copy]');
    if (copy) {
      var url = copy.getAttribute('data-copy');
      if (url && navigator.clipboard) { navigator.clipboard.writeText(url).catch(function () {}); }
      return;
    }

    var pick = target.closest('[data-pick]');
    if (pick) {
      var input = document.querySelector('[data-input="' + pick.getAttribute('data-pick') + '"]');
      if (input) { input.click(); }
      return;
    }

    var action = target.closest('[data-upload-action]');
    if (action) {
      var kind = action.getAttribute('data-upload-action');
      if (kind === 'cancel') { cancelUpload(); }
      else if (kind === 'retry') { draft.uploadState = 'uploading'; draft.uploadPct = 0; render(); startUpload(); }
      return;
    }

    var vis = target.closest('[data-visibility]');
    if (vis) { draft.visibility = vis.getAttribute('data-visibility'); save(); render(); return; }

    var sched = target.closest('[data-schedule]');
    if (sched) { draft.schedule = sched.getAttribute('data-schedule'); save(); render(); return; }

    var mode = target.closest('[data-publish-mode]');
    if (mode) { draft.publishMode = mode.getAttribute('data-publish-mode'); save(); render(); return; }

    var surface = target.closest('[data-surface]');
    if (surface && !surface.disabled) {
      var key = surface.getAttribute('data-surface');
      draft.surfaces[key] = !draft.surfaces[key];
      save(); render(); return;
    }
    if (target.closest('[data-select-all]')) {
      SURFACES.forEach(function (s) { if (!s.disabled) { draft.surfaces[s.key] = true; } });
      save(); render(); return;
    }

    var removeTag = target.closest('[data-remove-tag]');
    if (removeTag) { draft.tags.splice(Number(removeTag.getAttribute('data-remove-tag')), 1); save(); render(); return; }
    var removeTicker = target.closest('[data-remove-ticker]');
    if (removeTicker) { draft.tickers.splice(Number(removeTicker.getAttribute('data-remove-ticker')), 1); save(); render(); return; }
    var removeSector = target.closest('[data-remove-sector]');
    if (removeSector) { draft.sectors.splice(Number(removeSector.getAttribute('data-remove-sector')), 1); save(); render(); return; }
    var removeInterest = target.closest('[data-remove-interest]');
    if (removeInterest) { draft.watchInterest.splice(Number(removeInterest.getAttribute('data-remove-interest')), 1); save(); render(); return; }
    var removeAlert = target.closest('[data-alert-remove]');
    if (removeAlert) { draft.alertImages.splice(Number(removeAlert.getAttribute('data-alert-remove')), 1); save(); render(); return; }

    if (target.closest('[data-chapter-add]')) {
      draft.chapters.push({ time: '00:00', label: '' });
      save(); render(); return;
    }
    var chapterRemove = target.closest('[data-chapter-remove]');
    if (chapterRemove) { draft.chapters.splice(Number(chapterRemove.getAttribute('data-chapter-remove')), 1); save(); render(); return; }

    var tagBox = target.closest('[data-tags]');
    if (tagBox) { var box = tagBox.querySelector('input'); if (box) { box.focus(); } }
  });

  rail.addEventListener('click', function (event) {
    var go = event.target.closest('[data-go]');
    if (go) { draft.step = Number(go.getAttribute('data-go')); save(); render(); return; }
    if (event.target.closest('[data-next]')) { draft.step = Math.min(4, draft.step + 1); save(); render(); return; }
    if (event.target.closest('[data-publish]')) { publish(); return; }
    var mode = event.target.closest('[data-publish-mode]');
    if (mode) { draft.publishMode = mode.getAttribute('data-publish-mode'); save(); render(); }
  });

  if (stepper) {
    stepper.addEventListener('click', function (event) {
      var go = event.target.closest('[data-go]');
      if (!go || draft.step >= 5) { return; }
      var target = Number(go.getAttribute('data-go'));
      for (var i = 0; i < target; i += 1) {
        if (!canLeaveStep(i)) { window.alert('Finish step ' + (i + 1) + ' first.'); return; }
      }
      draft.step = target; save(); render();
    });
  }

  content.addEventListener('input', function (event) {
    var field = event.target.getAttribute('data-field');
    if (field) {
      draft[field] = event.target.value;
      save();
      if (field === 'title' || field === 'description') {
        var counter = event.target.parentNode.querySelector('.cs-count');
        if (counter) { counter.textContent = event.target.value.length + ' / ' + (field === 'title' ? 100 : 5000); }
        rail.innerHTML = draft.step === 0 ? railUpload() : (draft.step === 1 ? railDetails() : rail.innerHTML);
      }
      return;
    }
    var chapterTime = event.target.getAttribute('data-chapter-time');
    if (chapterTime !== null) { draft.chapters[Number(chapterTime)].time = event.target.value; save(); return; }
    var chapterLabel = event.target.getAttribute('data-chapter-label');
    if (chapterLabel !== null) { draft.chapters[Number(chapterLabel)].label = event.target.value; save(); return; }
    var alertTitle = event.target.getAttribute('data-alert-title');
    if (alertTitle !== null) { draft.alertImages[Number(alertTitle)].title = event.target.value; save(); return; }
    var alertNote = event.target.getAttribute('data-alert-note');
    if (alertNote !== null) { draft.alertImages[Number(alertNote)].note = event.target.value; save(); }
  });

  content.addEventListener('change', function (event) {
    var field = event.target.getAttribute('data-field');
    if (field) { draft[field] = event.target.value; save(); return; }

    var input = event.target.getAttribute('data-input');
    if (input === 'video') { acceptFile(event.target.files[0]); return; }
    if (input === 'thumb' && event.target.files[0]) {
      uploadImage(event.target.files[0], function (payload) {
        draft.thumbUrl = payload.url || '';
        draft.thumbName = payload.name || '';
        save(); render();
      }).catch(function (error) { window.alert(error.message); });
      return;
    }
    if (input === 'alert' && event.target.files.length) {
      var queue = Array.prototype.slice.call(event.target.files);
      queue.reduce(function (chain, picked) {
        return chain.then(function () {
          return uploadImage(picked, function (payload) {
            draft.alertImages.push({ url: payload.url || '', title: picked.name.replace(/\.[a-z0-9]+$/i, ''), note: '', time: new Date().toLocaleString() });
          });
        });
      }, Promise.resolve()).then(function () { save(); render(); })
        .catch(function (error) { window.alert(error.message); });
    }
  });

  content.addEventListener('keydown', function (event) {
    var kind = event.target.getAttribute('data-tag-input');
    if (!kind) { return; }
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag(kind, event.target.value);
      event.target.value = '';
    } else if (event.key === 'Backspace' && !event.target.value && draft[kind].length) {
      draft[kind].pop(); save(); render();
    }
  });

  content.addEventListener('blur', function (event) {
    var kind = event.target.getAttribute && event.target.getAttribute('data-tag-input');
    if (kind && event.target.value.trim()) { addTag(kind, event.target.value); event.target.value = ''; }
  }, true);

  content.addEventListener('dragover', function (event) {
    var zone = event.target.closest('[data-drop]');
    if (!zone) { return; }
    event.preventDefault();
    zone.classList.add('cs-over');
  });
  content.addEventListener('dragleave', function (event) {
    var zone = event.target.closest('[data-drop]');
    if (zone) { zone.classList.remove('cs-over'); }
  });
  content.addEventListener('drop', function (event) {
    var zone = event.target.closest('[data-drop]');
    if (!zone) { return; }
    event.preventDefault();
    zone.classList.remove('cs-over');
    if (event.dataTransfer.files && event.dataTransfer.files.length) { acceptFile(event.dataTransfer.files[0]); }
  });

  var saveBtn = document.getElementById('cs-save-draft');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      save();
      saveBtn.textContent = 'Draft saved';
      window.setTimeout(function () { saveBtn.textContent = 'Save Draft'; }, 1600);
    });
  }
  var previewBtn = document.getElementById('cs-preview');
  if (previewBtn) {
    previewBtn.addEventListener('click', function () {
      if (draft.published && draft.published.watch_url) { window.open(draft.published.watch_url, '_blank'); return; }
      window.alert('Publish the video first - the watch page is created on publish.');
    });
  }

  restore();
  render();
  window.setInterval(save, 20000);
})();
SMLSTUDIOJS;
    }
}

if (!function_exists('sml_cs_render_studio')) {
    function sml_cs_render_studio() {
        $config = sml_cs_config();
        $user_id = get_current_user_id();

        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=' . get_bloginfo('charset'));

        echo '<!doctype html><html ' . get_language_attributes() . '><head>';
        echo '<meta charset="' . esc_attr(get_bloginfo('charset')) . '">';
        echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
        echo '<meta name="robots" content="noindex,nofollow">';
        echo '<title>Upload Video - Creator Studio - ' . esc_html(get_bloginfo('name')) . '</title>';
        echo '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
        echo '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
        echo '<style>' . sml_cs_styles() . '</style></head><body>';

        if (!is_user_logged_in()) {
            echo '<div class="cs-gate"><h1>Sign in to upload</h1><p>The Creator Studio upload flow needs an account so your video can be published to your profile.</p>';
            echo '<a class="cs-btn cs-btn-primary" href="' . esc_url($config['loginUrl']) . '">Sign in to continue</a></div></body></html>';
            exit;
        }

        echo '<div class="cs-shell">';

        /* sidebar */
        echo '<aside class="cs-side"><a class="cs-brand" href="' . esc_url(home_url('/')) . '">';
        echo '<svg width="32" height="32" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="#2b6cff" stroke-width="2.4"/><path d="M11 25.5l5.4-6.2 4 3.6 7.4-9" stroke="#2b6cff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        echo '<b>StockMarket<em>Loop</em></b></a>';
        echo '<div class="cs-side-label">CREATOR STUDIO</div><nav class="cs-nav">';
        foreach (sml_cs_nav_items() as $item) {
            $active = $item['key'] === 'upload' ? ' class="cs-on"' : '';
            echo '<a href="' . esc_url($item['url']) . '"' . $active . '>' . sml_cs_nav_icon($item['key']) . esc_html($item['label']) . '</a>';
        }
        echo '</nav>';
        echo '<div class="cs-help"><b>Need help growing?</b><p>Get creator tips, tools and strategies in the Creator Resource Center.</p>';
        echo '<a href="' . esc_url(home_url('/creator-studio/')) . '">Open Resource Center</a></div></aside>';

        /* main */
        echo '<div class="cs-main">';
        echo '<header class="cs-top"><div class="cs-crumb">Creator Studio<span>/</span><b>Upload Video</b></div>';
        echo '<div class="cs-autosave"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.6 2.6L16 9.6"/></svg>';
        echo '<span id="cs-autosave-label">Draft autosaves as you type</span></div>';
        echo '<button class="cs-top-btn" id="cs-save-draft">Save Draft</button>';
        echo '<button class="cs-top-btn" id="cs-preview"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.8"/></svg>Preview</button>';
        echo '<a class="cs-top-btn" href="' . esc_url(home_url('/creator-studio/')) . '"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.8"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4M12 16.8h.01"/></svg>Help</a>';
        echo '<a class="cs-avatar" href="' . esc_url($config['profileUrl']) . '"><img src="' . esc_url($config['avatar']) . '" alt="">';
        echo '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8798ac" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 5.5 6-5.5"/></svg></a>';
        echo '</header>';

        echo '<nav class="cs-steps" id="cs-steps"></nav>';
        echo '<div class="cs-body"><main class="cs-content" id="cs-content"></main><aside class="cs-rail" id="cs-rail"></aside></div>';
        echo '</div></div>';

        echo '<script>window.smlCreatorStudioConfig=' . wp_json_encode($config) . ';</script>';
        echo '<script>' . sml_cs_script() . '</script>';
        echo '</body></html>';
        exit;
    }
}

if (!function_exists('sml_cs_render_locked')) {
    /**
     * Standalone lock page. Creator Studio renders standalone and exits, so
     * this has to be a whole document rather than a notice in a template.
     */
    function sml_cs_render_locked() {
        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=' . get_bloginfo('charset'));

        echo '<!doctype html><html ' . get_language_attributes() . '><head>';
        echo '<meta charset="' . esc_attr(get_bloginfo('charset')) . '">';
        echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
        echo '<title>Creator Studio - ' . esc_html(get_bloginfo('name')) . '</title>';
        echo '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
        echo '<style>*,*::before,*::after{box-sizing:border-box}'
           . 'body{margin:0;background:#070c15;color:#e6edf5;font-family:Inter,-apple-system,'
           . 'BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}'
           . 'a{color:#63a4ff;text-decoration:none}'
           . '.lk-top{display:flex;align-items:center;gap:13px;padding:13px 22px;'
           . 'border-bottom:1px solid #141d2a;background:#080d17}'
           . '.lk-top b{font-size:16px;font-weight:800;letter-spacing:-.3px}'
           . '.lk-top b em{font-style:normal;color:#2b6cff}'
           . '.lk-wrap{max-width:560px;margin:56px auto;padding:0 22px}'
           . '.lk-wrap h1{font-size:23px;font-weight:800;letter-spacing:-.4px;margin:0 0 8px}'
           . '.lk-wrap p.lead{color:#8798ac;font-size:14.5px;line-height:1.7;margin:0 0 20px}'
           . '.lk-back{display:inline-block;margin-top:18px;font-size:13.5px}'
           . sml_lb_lock_styles()
           . '</style></head><body>';

        echo '<header class="lk-top"><a href="' . esc_url(home_url('/')) . '">';
        echo '<svg width="28" height="28" viewBox="0 0 40 40" fill="none" style="display:block">'
           . '<circle cx="20" cy="20" r="18" stroke="#2b6cff" stroke-width="2.4"/>'
           . '<path d="M11 25.5l5.4-6.2 4 3.6 7.4-9" stroke="#2b6cff" stroke-width="2.6" '
           . 'stroke-linecap="round" stroke-linejoin="round"/></svg></a>';
        echo '<b>StockMarket<em>Loop</em></b></header>';

        echo '<div class="lk-wrap"><h1>Creator Studio is not open yet</h1>';
        echo '<p class="lead">Studio access is a membership standard rather than a purchase. '
           . 'You hold the Loop Bucks, you never spend them, and once you have published '
           . 'anything the studio stays yours for good.</p>';
        echo sml_lb_lock_html('creator');
        echo '<a class="lk-back" href="' . esc_url(home_url('/')) . '">Back to StockMarketLoop</a>';
        echo '</div></body></html>';
        exit;
    }
}

if (!function_exists('sml_cs_intercept_upload_page')) {
    function sml_cs_intercept_upload_page() {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        $path = trim((string) wp_parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
        if ($path !== sml_video_upload_studio_page_slug()) {
            return;
        }
        if (isset($_GET['classic'])) {
            return;
        }

        // Creator Studio opens at 200 Loop Bucks. Anyone who has already
        // published keeps it regardless of balance -- see sml_lb_gate_exempt().
        if (function_exists('sml_lb_can') && is_user_logged_in()
            && !sml_lb_can('creator')) {
            sml_cs_render_locked();
            return;
        }

        sml_cs_render_studio();
    }
}
add_action('template_redirect', 'sml_cs_intercept_upload_page', 0);
