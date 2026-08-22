/* SML Go Live — camera / microphone picker.

   The Go Live page captures through the BROWSER (getUserMedia + MediaRecorder +
   RTCPeerConnection), not through the RTMP ingest, and it shipped with no device
   selector — it just took whatever the browser handed back as the default camera.
   For anyone driving the stream from OBS that is the whole ballgame: OBS Virtual
   Camera is running, the page never asks for it, so the creator's scene and
   overlays never reach the stream and they see their bare webcam instead.

   The capture calls live in two unnamed inline scripts printed by the plugin that
   renders this page, and plugin edits get reverted on this site, so this does not
   try to patch them. It wraps navigator.mediaDevices.getUserMedia and folds the
   saved deviceId into whatever constraints the page asks for. Any capture path on
   the page — preview, test stream, go live — inherits the choice for free.

   A saved device that is later unplugged must never block going live, so an
   OverconstrainedError/NotFoundError clears the saved id and retries with the
   page's original constraints. */
(function () {
  'use strict';
  if (window.__smlGlDevicesBooted) { return; }
  window.__smlGlDevicesBooted = true;

  var LS = 'sml_gl_devices';

  function load() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {} }

  /* ---------- 1. constraint shim ---------- */
  var md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) { return; }

  if (!md.__smlGlPatched) {
    md.__smlGlPatched = true;
    var native = md.getUserMedia.bind(md);

    var owns = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    var clone = function (o) { var out = {}; for (var k in o) { if (owns(o, k)) { out[k] = o[k]; } } return out; };

    /* Returns a COPY carrying the saved deviceId. Never mutates what the caller
       passed: the retry below has to be able to fall back to the untouched
       original, and the page is free to reuse its own constraints object. */
    var withDevice = function (want, id) {
      if (!want || !id) { return want; }
      if (want === true) { return { deviceId: { exact: id } }; }
      if (typeof want !== 'object' || want.deviceId) { return want; } /* page pinned one: it knows better */
      var out = clone(want);
      out.deviceId = { exact: id };
      return out;
    };

    md.getUserMedia = function (constraints) {
      var original = constraints;
      var pref = load();
      var c = clone(constraints || {});

      if (c.video) { c.video = withDevice(c.video, pref.videoId); }
      if (c.audio) { c.audio = withDevice(c.audio, pref.audioId); }

      return native(c).then(function (stream) { paint(); return stream; }, function (err) {
        var name = err && err.name;
        if (name === 'OverconstrainedError' || name === 'NotFoundError') {
          var p = load(); delete p.videoId; delete p.audioId; save(p);
          paint();
          return native(original); /* stale pick must not stop the broadcast */
        }
        throw err;
      });
    };
  }

  /* ---------- 2. picker UI ---------- */
  var wrap, camSel, micSel, note;

  function host() {
    /* the Studio Preview card — matched by heading, never by position */
    var mid = document.getElementById('gl-middle');
    if (!mid) { return null; }
    var k = mid.children;
    for (var i = 0; i < k.length; i++) {
      if (k[i].tagName !== 'SECTION') { continue; }
      var h = k[i].querySelector('h1,h2,h3,h4');
      if (h && /^\s*Studio Preview\s*$/i.test(h.textContent || '')) { return k[i]; }
    }
    return null;
  }

  function build() {
    if (wrap && wrap.isConnected) { return wrap; }
    var h = host();
    if (!h) { return null; }

    wrap = document.createElement('div');
    wrap.id = 'sml-gl-devices';
    wrap.style.cssText = 'margin:12px 0 0;padding:12px 14px;border:1px solid #1c2833;border-radius:10px;background:#0b1119;display:flex;flex-direction:column;gap:8px;font:500 12px/1.4 inherit;color:#8fa3b5';

    var row = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    var sel = 'flex:1 1 180px;min-width:0;padding:6px 8px;border-radius:8px;border:1px solid #1c2833;background:#131c26;color:#e6edf3;font:inherit';
    var lab = 'flex:0 0 62px;color:#8fa3b5';

    var r1 = document.createElement('div'); r1.style.cssText = row;
    var l1 = document.createElement('span'); l1.textContent = 'Camera'; l1.style.cssText = lab;
    camSel = document.createElement('select'); camSel.style.cssText = sel;
    r1.appendChild(l1); r1.appendChild(camSel);

    var r2 = document.createElement('div'); r2.style.cssText = row;
    var l2 = document.createElement('span'); l2.textContent = 'Mic'; l2.style.cssText = lab;
    micSel = document.createElement('select'); micSel.style.cssText = sel;
    r2.appendChild(l2); r2.appendChild(micSel);

    note = document.createElement('small');
    note.style.cssText = 'color:#5d7085;font:400 11px/1.5 inherit';

    wrap.appendChild(r1); wrap.appendChild(r2); wrap.appendChild(note);
    h.appendChild(wrap);

    camSel.onchange = function () { var p = load(); p.videoId = camSel.value || ''; if (!p.videoId) { delete p.videoId; } save(p); hint(); };
    micSel.onchange = function () { var p = load(); p.audioId = micSel.value || ''; if (!p.audioId) { delete p.audioId; } save(p); hint(); };

    return wrap;
  }

  function fill(select, list, savedId, fallbackLabel) {
    var cur = savedId || '';
    select.innerHTML = '';
    var def = document.createElement('option');
    def.value = ''; def.textContent = 'Browser default';
    select.appendChild(def);
    for (var i = 0; i < list.length; i++) {
      var o = document.createElement('option');
      o.value = list[i].deviceId;
      o.textContent = list[i].label || (fallbackLabel + ' ' + (i + 1));
      select.appendChild(o);
    }
    /* a saved device that has since gone away falls back to Browser default */
    select.value = cur;
    if (select.value !== cur) { select.value = ''; }
  }

  function hint() {
    if (!note) { return; }
    var p = load();
    if (p.videoId && /obs|virtual/i.test((camSel.selectedOptions[0] || {}).textContent || '')) {
      note.textContent = 'Streaming your OBS scene — overlays included.';
    } else if (p.videoId) {
      note.textContent = 'Using the selected camera. Pick "OBS Virtual Camera" to stream your OBS scene and overlays.';
    } else {
      note.textContent = 'Using the browser default. Running OBS? Pick "OBS Virtual Camera" so your scene and overlays go out.';
    }
  }

  function paint() {
    if (!build()) { return; }
    md.enumerateDevices().then(function (devs) {
      var cams = devs.filter(function (d) { return d.kind === 'videoinput'; });
      var mics = devs.filter(function (d) { return d.kind === 'audioinput'; });
      var p = load();
      fill(camSel, cams, p.videoId, 'Camera');
      fill(micSel, mics, p.audioId, 'Microphone');
      /* labels stay blank until the user has granted permission once */
      if (cams.length && !cams[0].label) {
        note.textContent = 'Start the camera preview once to see device names.';
      } else {
        hint();
      }
    }, function () {});
  }

  function mounted() { return !!(wrap && wrap.isConnected); }

  paint();
  try { md.addEventListener('devicechange', paint); } catch (e) {}

  /* The Studio Preview card can appear well after load — this page's own API calls
     have been measured taking 10s+ — and Creator Studio re-renders its middle
     column afterwards, which would silently drop an already-mounted picker. A
     fixed retry window loses both races (the first version used 40x500ms and
     never mounted at all), so watch the DOM instead and re-mount whenever the
     picker is missing. The guard keeps this a cheap no-op once it is in place. */
  try {
    new MutationObserver(function () { if (!mounted()) { paint(); } })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  /* backstop for the no-MutationObserver case; stops as soon as it is mounted */
  var n = 0, t = setInterval(function () {
    if (mounted() || ++n > 240) { clearInterval(t); return; }
    paint();
  }, 500);
})();
