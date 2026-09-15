<?php
/**
 * SuperChat Voice Call-In - viewer panel and host dock.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_voice_ice_servers')) {
    /**
     * STUN alone fails for roughly one viewer in seven behind symmetric NAT,
     * so TURN is configurable here. Set the option or hook the filter with
     * credentials from your TURN provider and relays start working with no
     * code change.
     *
     * update_option('sml_voice_ice_servers', array(
     *   array('urls' => 'turn:turn.example.com:3478',
     *         'username' => 'user', 'credential' => 'secret'),
     * ));
     */
    function sml_voice_ice_servers() {
        $servers = array(
            array('urls' => 'stun:stun.l.google.com:19302'),
            array('urls' => 'stun:stun1.l.google.com:19302'),
        );
        $configured = get_option('sml_voice_ice_servers', array());
        if (is_array($configured) && $configured) {
            $servers = array_merge($servers, $configured);
        }
        return apply_filters('sml_voice_ice_servers', $servers);
    }
}

if (!function_exists('sml_voice_ui_config')) {
    function sml_voice_ui_config($room_id = '') {
        $user_id = get_current_user_id();
        return array(
            'iceServers' => sml_voice_ice_servers(),
            'base' => esc_url_raw(rest_url('sml-voice/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
            'roomId' => (string) $room_id,
            'userId' => $user_id,
            'loggedIn' => is_user_logged_in(),
            'loginUrl' => esc_url_raw(add_query_arg('redirect_to', rawurlencode(home_url('/')), home_url('/sign-up-sign-in/'))),
        );
    }
}

if (!function_exists('sml_voice_styles')) {
    function sml_voice_styles() {
        return <<<'SMLVOICECSS'
.vc,.vc *{box-sizing:border-box}
.vc{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#e6edf5;
    background:#0b131f;border:1px solid #182130;border-radius:14px;padding:18px;max-width:520px}
.vc h3{margin:0 0 4px;font-size:17px;font-weight:700}
.vc .vc-sub{margin:0 0 16px;font-size:13px;color:#8798ac;line-height:1.55}
.vc-tiers{display:grid;gap:10px}
.vc-tier{display:flex;align-items:center;gap:12px;padding:13px 14px;border-radius:11px;
    border:1px solid #1e2a3a;background:#0d1622;text-align:left;width:100%;cursor:pointer;color:inherit}
.vc-tier:hover:not([disabled]){border-color:#22d97a;background:#101d2c}
.vc-tier[disabled]{opacity:.45;cursor:not-allowed}
.vc-tier.vc-credit{margin-bottom:10px;border-color:rgba(34,217,122,.42);background:rgba(34,217,122,.07)}
.vc-tier.vc-credit .vc-price b{color:#7cf5b1}
.vc-tier b{display:block;font-size:14px;font-weight:700}
.vc-tier small{display:block;font-size:12px;color:#8798ac;margin-top:2px}
.vc-price{margin-left:auto;text-align:right;flex:0 0 auto}
.vc-price b{font-size:15px;color:#22d97a}
.vc-price small{color:#7b8ca1}
.vc-msg{width:100%;margin-top:12px;background:#0d1622;border:1px solid #1e2a3a;border-radius:10px;
    color:#e6edf5;padding:11px 13px;font-size:13.5px;font-family:inherit;resize:vertical;min-height:56px}
.vc-msg:focus{outline:none;border-color:#22d97a}
.vc-btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;width:100%;height:46px;
    border-radius:10px;border:0;font-weight:700;font-size:14.5px;cursor:pointer;margin-top:12px;
    background:#22d97a;color:#04170d;font-family:inherit}
.vc-btn:hover:not([disabled]){filter:brightness(1.07)}
.vc-btn[disabled]{opacity:.5;cursor:not-allowed}
.vc-btn.vc-ghost{background:#111c2b;color:#dbe6f2;border:1px solid #223146}
.vc-btn.vc-danger{background:#ff566e;color:#1a0409}
.vc-note{margin-top:12px;font-size:12px;color:#7b8ca1;line-height:1.6}
.vc-balance{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#8798ac;margin-bottom:14px}
.vc-balance b{color:#e0a336}
.vc-state{display:flex;align-items:center;gap:12px;padding:14px;border-radius:11px;
    background:#0d1622;border:1px solid #1e2a3a}
.vc-state b{font-size:14px}
.vc-state small{display:block;font-size:12px;color:#8798ac;margin-top:3px}
.vc-ring{position:relative;width:54px;height:54px;flex:0 0 auto}
.vc-ring svg{transform:rotate(-90deg)}
.vc-ring span{position:absolute;inset:0;display:grid;place-items:center;font-size:14px;font-weight:800}
.vc-meter{height:6px;border-radius:999px;background:#182534;overflow:hidden;margin-top:10px}
.vc-meter i{display:block;height:100%;width:0;background:linear-gradient(90deg,#22d97a,#e0a336,#ff566e);
    border-radius:999px;transition:width .08s}
.vc-live{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:800;
    letter-spacing:.8px;color:#ff566e}
.vc-live i{width:8px;height:8px;border-radius:50%;background:#ff566e;display:block;
    animation:vc-pulse 1.6s infinite}
@keyframes vc-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.vc-err{margin-top:12px;padding:11px 13px;border-radius:9px;font-size:13px;line-height:1.5;
    background:rgba(255,86,110,.1);border:1px solid rgba(255,86,110,.3);color:#ffb3bd}
.vc-ok{background:rgba(34,217,122,.1);border-color:rgba(34,217,122,.3);color:#7ee8ae}

/* ---------- host dock ---------- */
.vcd{position:fixed;right:20px;bottom:20px;width:380px;max-height:72vh;z-index:9999;
    display:flex;flex-direction:column;background:#0b131f;border:1px solid #223146;
    border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden;
    font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#e6edf5}
.vcd-head{display:flex;align-items:center;gap:10px;padding:13px 15px;border-bottom:1px solid #182130;
    background:#0d1622}
.vcd-head b{font-size:14.5px;font-weight:700}
.vcd-count{background:#22d97a;color:#04170d;border-radius:999px;padding:1px 8px;font-size:11.5px;font-weight:800}
.vcd-min{margin-left:auto;background:none;border:0;color:#8798ac;cursor:pointer;font-size:18px;line-height:1}
.vcd-body{overflow-y:auto;padding:12px 15px 15px}
.vcd.vc-collapsed .vcd-body{display:none}
.vcd-empty{font-size:13px;color:#7b8ca1;text-align:center;padding:22px 0}
.vcd-item{padding:12px 0;border-top:1px solid #16202e}
.vcd-item:first-child{border-top:0}
.vcd-who{display:flex;align-items:center;gap:10px}
.vcd-who img{width:36px;height:36px;border-radius:50%;object-fit:cover;flex:0 0 auto}
.vcd-who b{font-size:13.5px;font-weight:700;display:block}
.vcd-who small{font-size:11.5px;color:#8798ac}
.vcd-amt{margin-left:auto;font-size:12.5px;font-weight:800;color:#e0a336;flex:0 0 auto}
.vcd-msg{margin:8px 0 0;font-size:12.5px;color:#c2cede;line-height:1.5;font-style:italic}
.vcd-warn{font-size:11.5px;color:#e0a336;margin-top:5px}
.vcd-acts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:10px}
.vcd-acts button{height:32px;border-radius:7px;border:1px solid #223146;background:#111c2b;
    color:#dbe6f2;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit}
.vcd-acts button.ok{background:#22d97a;border-color:#22d97a;color:#04170d}
.vcd-acts button.no{color:#ffb3bd}
.vcd-acts button:hover{filter:brightness(1.12)}
.vcd-active{padding:13px;border-radius:11px;background:rgba(255,86,110,.08);
    border:1px solid rgba(255,86,110,.28);margin-bottom:12px}
.vcd-active-top{display:flex;align-items:center;gap:10px}
.vcd-active-top b{font-size:13.5px}
.vcd-timer{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:800;font-size:15px;color:#ff566e}
.vcd-ctl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:10px}
.vcd-ctl button{height:32px;border-radius:7px;border:1px solid #223146;background:#111c2b;
    color:#dbe6f2;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit}
.vcd-ctl button.end{background:#ff566e;border-color:#ff566e;color:#1a0409}
.vcd-room{font-size:11.5px;color:#7b8ca1;margin-top:10px}
.vcd-room input{width:100%;margin-top:5px;background:#0d1622;border:1px solid #1e2a3a;
    border-radius:7px;color:#dbe6f2;padding:7px 9px;font-size:12px;font-family:inherit}
@media (max-width:640px){ .vcd{right:10px;left:10px;width:auto;bottom:10px} }
SMLVOICECSS;
    }
}

if (!function_exists('sml_voice_script')) {
    function sml_voice_script() {
        return <<<'SMLVOICEJS'
(function () {
  var cfg = window.smlVoiceConfig;
  if (!cfg) { return; }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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
        if (!r.ok) { var e = new Error(p.message || 'Request failed.'); e.status = r.status; e.code = p.code; throw e; }
        return p;
      });
    });
  }

  function clock(s) {
    s = Math.max(0, Math.round(s));
    var m = Math.floor(s / 60);
    return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  var ICE = { iceServers: cfg.iceServers && cfg.iceServers.length
    ? cfg.iceServers
    : [{ urls: 'stun:stun.l.google.com:19302' }] };

  /**
   * One side of a voice call. The caller publishes its mic and the host
   * answers; ICE and SDP travel over the plugin's own signal endpoint so
   * this works whether or not a group live room is running.
   */
  function VoicePeer(sessionUid, role, opts) {
    var pc = new RTCPeerConnection(ICE);
    var cursor = 0;
    var poll = null;
    var closed = false;
    var pendingIce = [];
    var haveRemote = false;

    function send(type, payload) {
      return api('/signal', { method: 'POST', json: {
        session_uid: sessionUid, signal_type: type, payload: payload, role: role
      } }).catch(function () { /* transient */ });
    }

    pc.onicecandidate = function (e) {
      if (e.candidate) { send('ice', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate); }
    };
    pc.onconnectionstatechange = function () {
      if (opts.onState) { opts.onState(pc.connectionState); }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { stop(); }
    };
    if (role === 'host') {
      pc.ontrack = function (e) { if (opts.onTrack) { opts.onTrack(e.streams[0] || new MediaStream([e.track])); } };
    }

    async function drainIce() {
      while (pendingIce.length) {
        var c = pendingIce.shift();
        try { await pc.addIceCandidate(c); } catch (err) { /* ignore stale candidate */ }
      }
    }

    async function handle(sig) {
      try {
        if (sig.signal_type === 'offer' && role === 'host') {
          await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
          haveRemote = true;
          await drainIce();
          var answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send('answer', { type: answer.type, sdp: answer.sdp });
        } else if (sig.signal_type === 'answer' && role === 'caller') {
          await pc.setRemoteDescription(new RTCSessionDescription(sig.payload));
          haveRemote = true;
          await drainIce();
        } else if (sig.signal_type === 'ice') {
          var cand = new RTCIceCandidate(sig.payload);
          if (haveRemote) { try { await pc.addIceCandidate(cand); } catch (e) { /* ignore */ } }
          else { pendingIce.push(cand); }
        } else if (sig.signal_type === 'bye') {
          stop();
        }
      } catch (err) { /* keep polling - a single bad signal should not kill the call */ }
    }

    function startPolling() {
      poll = setInterval(function () {
        if (closed) { return; }
        api('/signal?session_uid=' + encodeURIComponent(sessionUid) + '&after=' + cursor + '&role=' + role)
          .then(function (d) {
            cursor = d.cursor || cursor;
            (d.signals || []).forEach(handle);
            if (opts.onSession && d.session) { opts.onSession(d.session); }
          })
          .catch(function () {});
      }, 1200);
    }

    async function startCaller(stream) {
      stream.getAudioTracks().forEach(function (t) { pc.addTrack(t, stream); });
      var offer = await pc.createOffer({ offerToReceiveAudio: false });
      await pc.setLocalDescription(offer);
      await send('offer', { type: offer.type, sdp: offer.sdp });
      startPolling();
    }

    function startHost() {
      pc.addTransceiver('audio', { direction: 'recvonly' });
      startPolling();
    }

    function stop() {
      if (closed) { return; }
      closed = true;
      if (poll) { clearInterval(poll); poll = null; }
      try { pc.close(); } catch (e) { /* already closed */ }
      if (opts.onClosed) { opts.onClosed(); }
    }

    return { pc: pc, startCaller: startCaller, startHost: startHost, stop: stop, send: send };
  }

  /* ================= viewer panel ================= */

  function mountViewer(root) {
    var roomId = root.getAttribute('data-room') || cfg.roomId;
    var state = { view: 'loading', data: null, token: null, queue: null, session: null, error: '', notice: '',
      rec: null, chunks: [], blob: null, blobUrl: '', blobType: '', recSeconds: 0, recMax: 15, recTimer: null };
    var mic = null, audioCtx = null, analyser = null, raf = null, poll = null, peer = null;

    function refresh() {
      return api('/eligibility?room_id=' + encodeURIComponent(roomId)).then(function (d) {
        state.data = d;
        /* a caller who was waiting and is suddenly neither queued nor holding a pass was declined by the host
           (deny refunds the pass server-side); say so instead of silently showing the tier list again (2026-09-15) */
        if (!state.session && state.view === 'queued' && !d.queue_id && !(d.tokens || []).length) {
          state.notice = d.last_decision === 'approved' ? '🔊 Your voice message was approved and played on the stream. Thank you!' : 'The host did not play your message this time. Your Loop Bucks were refunded.';
        }
        if (state.session) { /* keep */ }
        else if (d.queue_id) { state.view = 'queued'; state.queue = { queue_id: d.queue_id, position: d.queue_position }; }
        else if (d.tokens.length) { state.view = 'holding'; state.token = d.tokens[0]; }
        else { state.view = 'tiers'; }
        render();
      }).catch(function (e) { state.error = e.message; render(); });
    }

    function stopMeter() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      if (audioCtx) { audioCtx.close().catch(function () {}); audioCtx = null; analyser = null; }
    }

    function releaseMic() {
      stopMeter();
      if (peer) { peer.send('bye', {}); peer.stop(); peer = null; }
      if (mic) { mic.getTracks().forEach(function (t) { t.stop(); }); mic = null; }
    }

    function startMeter() {
      if (!mic) { return; }
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { return; }
      audioCtx = new Ctx();
      var src = audioCtx.createMediaStreamSource(mic);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      var buf = new Uint8Array(analyser.frequencyBinCount);
      var over = 0;
      var tick = function () {
        if (!analyser) { return; }
        analyser.getByteTimeDomainData(buf);
        var peak = 0;
        for (var i = 0; i < buf.length; i++) { peak = Math.max(peak, Math.abs(buf[i] - 128) / 128); }
        var bar = root.querySelector('[data-meter]');
        if (bar) { bar.style.width = Math.min(100, Math.round(peak * 150)) + '%'; }
        // Spike guard: report sustained near-clipping so the host sees it.
        var dbfs = 20 * Math.log10(peak || 1e-8);
        if (dbfs > -4) {
          if (++over > 30 && state.session) {
            over = 0;
            api('/session', { method: 'POST', json: {
              session_uid: state.session.session_uid, action: 'flag', kind: 'spike', dbfs: dbfs
            } }).catch(function () {});
          }
        } else if (over > 0) { over--; }
        raf = requestAnimationFrame(tick);
      };
      tick();
    }

    function buy(tier, useMembershipCredit) {
      var msg = (root.querySelector('[data-msg]') || {}).value || '';
      state.notice = '';
      clearClip();
      setBusy(true);
      api('/superchat', { method: 'POST', json: {
        room_id: roomId,
        tier: tier,
        message: msg,
        use_membership_credit: !!useMembershipCredit
      } })
        .then(function (d) {
          state.token = {
            token: d.token,
            tier: d.tier,
            label: d.rail === 'member_credit' ? 'Membership call-in credit' : d.tier,
            seconds: d.seconds
          };
          state.view = 'holding';
          state.error = '';
          render();
        })
        .catch(function (e) { state.error = e.message; setBusy(false); render(); });
    }

    function requestSpeak() {
      setBusy(true);
      var got = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          }).then(function (s) { mic = s; return true; }).catch(function () { return false; })
        : Promise.resolve(false);

      got.then(function (micReady) {
        return api('/request', { method: 'POST', json: { token: state.token.token, mic_ready: micReady } })
          .then(function (d) {
            state.queue = d;
            state.view = 'queued';
            state.error = micReady ? '' : 'Microphone blocked. Allow it before your turn.';
            render();
            startPolling();
          });
      }).catch(function (e) { state.error = e.message; setBusy(false); render(); });
    }

    /* ---- recorded voice Super Chat (owner design 2026-09-15): nothing is live. The viewer records within the
       pass length, previews, sends; the host listens privately and only an approved clip plays on the stream. ---- */
    function recMime() {
      var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
      for (var i = 0; i < list.length; i++) { if (window.MediaRecorder && MediaRecorder.isTypeSupported(list[i])) { return list[i]; } }
      return '';
    }
    function clearClip() {
      if (state.blobUrl) { try { URL.revokeObjectURL(state.blobUrl); } catch (e) {} }
      state.blob = null; state.blobUrl = ''; state.blobType = ''; state.chunks = []; state.recSeconds = 0;
    }
    function startRecording() {
      if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        state.error = 'Voice recording is not supported in this browser.'; render(); return;
      }
      clearClip();
      state.recMax = Math.max(5, Number(state.token && state.token.seconds) || 15);
      state.error = '';
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then(function (s) {
          mic = s;
          var type = recMime();
          var rec = type ? new MediaRecorder(s, { mimeType: type }) : new MediaRecorder(s);
          state.rec = rec; state.chunks = []; state.blobType = rec.mimeType || type || 'audio/webm';
          rec.ondataavailable = function (e) { if (e.data && e.data.size) { state.chunks.push(e.data); } };
          rec.onstop = function () {
            state.blob = new Blob(state.chunks, { type: state.blobType });
            state.blobUrl = URL.createObjectURL(state.blob);
            state.rec = null;
            releaseMic();
            /* auto-send: the message goes straight to the host's queue; the preview view only appears if the upload fails */
            state.view = 'sending';
            render();
            sendClip();
          };
          rec.start(250);
          state.view = 'record';
          state.recSeconds = 0;
          startMeter();
          render();
          if (state.recTimer) { clearInterval(state.recTimer); }
          state.recTimer = setInterval(function () {
            state.recSeconds += 1;
            var t = root.querySelector('[data-rec-clock]'); if (t) { t.textContent = clock(state.recSeconds) + ' / ' + clock(state.recMax); }
            var ring = root.querySelector('[data-rec-ring]');
            if (ring) { var c = 2 * Math.PI * 24; ring.setAttribute('stroke-dashoffset', (c * (1 - Math.min(1, state.recSeconds / state.recMax))).toFixed(1)); }
            if (state.recSeconds >= state.recMax) { stopRecording(); }
          }, 1000);
        })
        .catch(function () { state.error = 'Your mic is blocked. Allow the microphone in your browser, then try again.'; render(); });
    }
    function stopRecording() {
      if (state.recTimer) { clearInterval(state.recTimer); state.recTimer = null; }
      stopMeter();
      if (state.rec && state.rec.state !== 'inactive') { try { state.rec.stop(); } catch (e) { state.rec = null; releaseMic(); } }
    }
    function sendClip() {
      if (!state.blob || !state.token) { return; }
      setBusy(true);
      var fd = new FormData();
      var ext = /mp4/.test(state.blobType) ? 'm4a' : (/ogg/.test(state.blobType) ? 'ogg' : 'webm');
      fd.append('clip', state.blob, 'voice.' + ext);
      fd.append('token', state.token.token);
      fd.append('seconds', String(Math.max(1, state.recSeconds)));
      fd.append('message', (root.querySelector('[data-msg]') || {}).value || '');
      var headers = { 'Accept': 'application/json' };
      if (cfg.nonce) { headers['X-WP-Nonce'] = cfg.nonce; }
      fetch(cfg.base + '/clip', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: headers, body: fd })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (p) { if (!r.ok) { throw new Error(p.message || 'Could not send your message.'); } return p; }); })
        .then(function (d) {
          state.queue = { queue_id: d.queue_id, position: d.position };
          state.view = 'queued';
          state.error = '';
          setBusy(false);
          render();
          startPolling();
        })
        .catch(function (e) { state.error = e.message; state.view = 'preview'; setBusy(false); render(); });
    }
    function cancel() {
      api('/cancel', { method: 'POST', json: { queue_id: state.queue.queue_id } })
        .then(function () { releaseMic(); state.queue = null; state.view = 'holding'; render(); })
        .catch(function (e) { state.error = e.message; render(); });
    }

    function startPolling() {
      if (poll) { clearInterval(poll); }
      poll = setInterval(function () {
        api('/eligibility?room_id=' + encodeURIComponent(roomId)).then(function (d) {
          state.data = d;
          /* declined by the host while waiting (deny refunds server-side): tell the caller (2026-09-15) */
          if (!state.session && state.view === 'queued' && !d.queue_id && !(d.tokens || []).length) {
            state.notice = d.last_decision === 'approved' ? '🔊 Your voice message was approved and played on the stream. Thank you!' : 'The host did not play your message this time. Your Loop Bucks were refunded.';
          }
          var active = d.active_session;
          if (active && active.user_id === cfg.userId && !state.session) {
            state.session = active;
            state.view = 'live';
            startMeter();

            // Publish the mic to the host before telling the server we are on.
            var publish = mic
              ? Promise.resolve(mic)
              : navigator.mediaDevices.getUserMedia({
                  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                }).then(function (s) { mic = s; startMeter(); return s; });

            publish.then(function (stream) {
              peer = VoicePeer(active.session_uid, 'caller', {
                onClosed: function () { peer = null; }
              });
              return peer.startCaller(stream);
            }).then(function () {
              return api('/session', { method: 'POST', json: {
                session_uid: active.session_uid, action: 'connected'
              } });
            }).then(function (r) {
              state.session = r.session; render();
            }).catch(function (e) {
              state.error = 'Could not open the mic: ' + e.message;
              render();
            });
          } else if (state.session) {
            if (!active || active.session_uid !== state.session.session_uid) {
              releaseMic();
              state.session = null; state.queue = null; state.token = null;
              state.view = 'tiers';
              state.error = 'Your turn has ended. Thanks for calling in.';
              clearInterval(poll); poll = null;
            } else {
              state.session = active;
            }
          } else if (state.queue) {
            if (!d.queue_id) {
              state.queue = null;
              state.view = d.tokens.length ? 'holding' : 'tiers';
              if (d.tokens.length) { state.token = d.tokens[0]; }
            } else {
              state.queue.position = d.queue_position;
            }
          }
          render();
        }).catch(function () {});
      }, 10000);
    }

    function setBusy(on) {
      root.querySelectorAll('button').forEach(function (b) { b.disabled = !!on; });
    }

    function render() {
      var d = state.data;
      if (!d) { root.innerHTML = '<div class="vc"><p class="vc-sub">Loading voice call-in...</p></div>'; return; }

      if (!d.logged_in) {
        root.innerHTML = '<div class="vc"><h3>Call in with your voice</h3>'
          + '<p class="vc-sub">Send a SuperChat to request the mic during this stream.</p>'
          + '<a class="vc-btn" href="' + esc(cfg.loginUrl) + '">Sign in to continue</a></div>';
        return;
      }
      if (d.membership_locked) {
        root.innerHTML = '<div class="vc"><h3>Content Members only</h3>'
          + '<p class="vc-sub">Join this creator&apos;s Content Membership to enter this live room and use creator-specific call-in credits.</p></div>';
        return;
      }
      if (!d.enabled) {
        root.innerHTML = '<div class="vc"><h3>Voice call-ins are off</h3>'
          + '<p class="vc-sub">The host has turned voice requests off for this stream.</p></div>';
        return;
      }
      if (d.banned) {
        root.innerHTML = '<div class="vc"><h3>Voice unavailable</h3>'
          + '<p class="vc-sub">You are blocked from voice on this stream.'
          + (d.ban_reason ? ' Reason: ' + esc(d.ban_reason) : '') + '</p></div>';
        return;
      }

      var err = state.error
        ? '<div class="vc-err' + (/ended|Thanks/.test(state.error) ? ' vc-ok' : '') + '">' + esc(state.error) + '</div>'
        : '';
      var bal = '<div class="vc-balance">Balance <b>' + d.balance.toLocaleString() + ' LB</b>'
        + (d.queue_depth ? '<span style="margin-left:auto">' + d.queue_depth + ' in queue</span>' : '') + '</div>';

      if (state.view === 'live' && state.session) {
        var s = state.session;
        var pct = s.granted_seconds ? (s.remaining_seconds / s.granted_seconds) : 0;
        var c = 2 * Math.PI * 24;
        root.innerHTML = '<div class="vc"><span class="vc-live"><i></i>YOU ARE LIVE</span>'
          + '<div class="vc-state" style="margin-top:12px">'
          + '<div class="vc-ring"><svg width="54" height="54"><circle cx="27" cy="27" r="24" fill="none" stroke="#1b2634" stroke-width="5"/>'
          + '<circle cx="27" cy="27" r="24" fill="none" stroke="#ff566e" stroke-width="5" stroke-linecap="round"'
          + ' stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - pct)).toFixed(1) + '"/></svg>'
          + '<span>' + s.remaining_seconds + '</span></div>'
          + '<div style="flex:1"><b>' + (s.muted ? 'Muted by host' : 'Speaking now') + '</b>'
          + '<small>Keep it tight - you have ' + clock(s.remaining_seconds) + ' left.</small>'
          + '<div class="vc-meter"><i data-meter></i></div></div></div>'
          + '<button class="vc-btn vc-danger" data-act="leave">Leave the call</button>'
          + '<p class="vc-note">Wear headphones. Without them the stream will echo back into the broadcast.</p>'
          + err + '</div>';
        return;
      }

      if (state.view === 'record') {
        var rc = 2 * Math.PI * 24;
        root.innerHTML = '<div class="vc"><span class="vc-live"><i></i>RECORDING</span>'
          + '<div class="vc-state" style="margin-top:12px">'
          + '<div class="vc-ring"><svg width="54" height="54"><circle cx="27" cy="27" r="24" fill="none" stroke="#1b2634" stroke-width="5"/>'
          + '<circle data-rec-ring cx="27" cy="27" r="24" fill="none" stroke="#ff566e" stroke-width="5" stroke-linecap="round"'
          + ' stroke-dasharray="' + rc.toFixed(1) + '" stroke-dashoffset="' + rc.toFixed(1) + '"/></svg>'
          + '<span>●</span></div>'
          + '<div style="flex:1"><b data-rec-clock>' + clock(state.recSeconds) + ' / ' + clock(state.recMax) + '</b>'
          + '<small>Say your message. It stops on its own at ' + state.recMax + ' seconds.</small>'
          + '<div class="vc-meter"><i data-meter></i></div></div></div>'
          + '<button class="vc-btn vc-danger" data-act="stop">Stop recording</button>' + err + '</div>';
        return;
      }
      if (state.view === 'sending') {
        root.innerHTML = '<div class="vc"><h3>Sending your message to the host…</h3>'
          + '<p class="vc-sub">' + clock(state.recSeconds) + ' recorded. It goes into the host\'s queue; they listen privately first.</p>' + err + '</div>';
        return;
      }
      if (state.view === 'preview' && state.blobUrl) {
        root.innerHTML = '<div class="vc"><h3>Your message did not send</h3>'
          + '<p class="vc-sub">' + clock(state.recSeconds) + ' recorded. Try sending again, or record a new one.</p>'
          + '<audio controls preload="auto" src="' + esc(state.blobUrl) + '" style="width:100%;margin:6px 0 10px"></audio>'
          + '<button class="vc-btn" data-act="send">Send again</button>'
          + '<button class="vc-btn vc-ghost" data-act="record" style="margin-top:8px">Record again</button>' + err + '</div>';
        return;
      }
      if (state.view === 'queued' && state.queue) {
        root.innerHTML = '<div class="vc"><h3>Your message is with the host</h3>'
          + '<p class="vc-sub">The host listens to it privately first. If approved, it plays on the stream for everyone to hear.</p>' + bal
          + '<div class="vc-state"><div class="vc-ring"><svg width="54" height="54">'
          + '<circle cx="27" cy="27" r="24" fill="none" stroke="#1b2634" stroke-width="5"/></svg>'
          + '<span>#' + (state.queue.position || 1) + '</span></div>'
          + '<div><b>' + (state.queue.position > 1 ? 'Position ' + state.queue.position + ' in line' : 'Next up for the host') + '</b>'
          + '<small>You can leave this page. You keep your pass if you withdraw.</small></div></div>'
          + (state.blobUrl ? '<audio controls preload="none" src="' + esc(state.blobUrl) + '" style="width:100%;margin:10px 0"></audio>' : '')
          + '<button class="vc-btn vc-ghost" data-act="cancel">Withdraw my message</button>' + err + '</div>';
        return;
      }

      if (state.view === 'holding' && state.token) {
        root.innerHTML = '<div class="vc"><h3>Your Voice Super Chat is paid</h3>'
          + '<p class="vc-sub">You have up to ' + state.token.seconds + ' seconds. Tap Record, say your message, tap Stop — it goes straight to the host.</p>' + bal
          + '<button class="vc-btn" data-act="record">🎙 Record your message</button>'
          + '<p class="vc-note">Nothing is live. The host listens privately first; if approved it plays on the stream with your Loop Bucks shown to everyone. Declined messages are refunded.</p>'
          + err + '</div>';
        return;
      }

      var cooling = d.cooldown_until ? true : false;
      var credit = d.membership_credit || {};
      root.innerHTML = '<div class="vc"><h3>Call in with your voice</h3>'
        + '<p class="vc-sub">Use a creator membership credit or send a SuperChat. The host approves every caller before you go on air.</p>'
        + (state.notice ? '<p class="vc-note" style="color:#ffb454;font-weight:700">' + esc(state.notice) + '</p>' : '')
        + bal
        + (credit.available
          ? '<button class="vc-tier vc-credit" data-credit>'
            + '<span><b>Use 1 membership call-in credit</b><small>' + Number(credit.seconds || 30)
            + 's on air with ' + esc(credit.creator_name || 'this creator') + '</small></span>'
            + '<span class="vc-price"><b>' + Number(credit.remaining || 0) + ' left</b><small>Resets at renewal</small></span></button>'
          : '')
        + '<div class="vc-tiers">' + d.tiers.filter(function (t) { return t.loop_bucks > 0 && t.enabled !== false; }).map(function (t) {
            var afford = d.balance >= t.loop_bucks;
            return '<button class="vc-tier" data-tier="' + esc(t.slug) + '"'
              + (afford && !cooling ? '' : ' disabled') + '>'
              + '<span><b>' + esc(t.label) + '</b><small>' + t.seconds + 's on air'
              + (t.priority ? ' - skips the line' : '') + '</small></span>'
              + '<span class="vc-price"><b>' + t.loop_bucks.toLocaleString() + ' LB</b>'
              + '<small>$' + (t.amount_cents / 100).toFixed(2) + '</small></span></button>';
          }).join('') + '</div>'
        + '<textarea class="vc-msg" data-msg maxlength="280" placeholder="Add a message the host will see (optional)"></textarea>'
        + (cooling ? '<div class="vc-err">You called in recently. You can request again shortly.</div>' : '')
        + err + '</div>';
    }

    root.addEventListener('click', function (e) {
      var credit = e.target.closest('[data-credit]');
      if (credit && !credit.disabled) { buy('bronze', true); return; }
      var tier = e.target.closest('[data-tier]');
      if (tier && !tier.disabled) { buy(tier.getAttribute('data-tier'), false); return; }
      var act = e.target.closest('[data-act]');
      if (!act) { return; }
      var kind = act.getAttribute('data-act');
      if (kind === 'request') { requestSpeak(); }
      else if (kind === 'record') { startRecording(); }
      else if (kind === 'stop') { stopRecording(); }
      else if (kind === 'send') { sendClip(); }
      else if (kind === 'cancel') { cancel(); }
      else if (kind === 'leave' && state.session) {
        api('/session', { method: 'POST', json: { session_uid: state.session.session_uid, action: 'end' } })
          .catch(function () {});
        releaseMic();
      }
    });

    window.addEventListener('beforeunload', releaseMic);
    /* the chat gift popover buys a pass too; it asks the widget to re-read eligibility right away */
    document.addEventListener('sml-voice-refresh', function () { refresh(); });
    refresh();
    startPolling();
  }

  document.querySelectorAll('[data-sml-voice-callin]').forEach(mountViewer);

  /* ================= host dock ================= */

  function mountDock() {
    if (!cfg.hostDock) { return; }
    var dock = document.createElement('div');
    dock.className = 'vcd';

    function relocateDock() {
      var slot = document.querySelector('[data-sml-voice-host-dock]');
      if (slot) {
        if (dock.parentNode !== slot) {
          slot.innerHTML = '';
          slot.appendChild(dock);
        }
        dock.classList.add('vcd-inline');
        return;
      }
      if (dock.parentNode !== document.body && document.body) {
        document.body.appendChild(dock);
      }
      dock.classList.remove('vcd-inline');
    }

    window.smlVoiceHostDockBeforeRender = function () {
      if (dock.parentNode && dock.parentNode !== document.body && document.body) {
        document.body.appendChild(dock);
      }
    };
    window.smlVoiceHostDockAfterRender = relocateDock;
    relocateDock();

    /* the page's room wins; the remembered room is only a fallback when the page names none (a stale 'g7' used to hide every caller, 2026-09-15) */
    var roomId = cfg.roomId || window.localStorage.getItem('sml-voice-host-room') || '';
    var data = { queue: [], active_session: null, settings: {} };
    var hostPeer = null, hostUid = null, monitor = null;
    var playing = null; /* { el, name, seconds, startedAt } while a recorded voice Super Chat is on the stream */

    /* ---- broadcast mix bus: caller audio joins the host's outgoing audio ---- */
    var mixer = (function () {
      var ctx = null, bus = null, dest = null, limiter = null;
      var callerGain = null, hostSrc = null;

      function ensure() {
        if (ctx) { return; }
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) { return; }
        ctx = new Ctx({ sampleRate: 48000 });
        bus = ctx.createGain();
        limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -1;   // ceiling so a hot caller cannot clip the mix
        limiter.ratio.value = 20;
        limiter.attack.value = 0.003;
        dest = ctx.createMediaStreamDestination();
        bus.connect(limiter).connect(dest);
      }

      return {
        attachHost: function (stream) {
          ensure();
          if (!ctx || hostSrc) { return; }
          hostSrc = ctx.createMediaStreamSource(stream);
          hostSrc.connect(bus);
        },
        attachCaller: function (stream, muted, gainValue) {
          ensure();
          if (!ctx) { return; }
          this.detachCaller();
          var src = ctx.createMediaStreamSource(stream);
          callerGain = ctx.createGain();
          callerGain.gain.value = muted ? 0 : (gainValue || 1);
          src.connect(callerGain).connect(bus);
          callerGain.__src = src;
        },
        setCallerGain: function (value) {
          if (!callerGain || !ctx) { return; }
          callerGain.gain.setTargetAtTime(value, ctx.currentTime, 0.02);
        },
        detachCaller: function () {
          if (!callerGain) { return; }
          try { callerGain.__src.disconnect(); callerGain.disconnect(); } catch (e) {}
          callerGain = null;
        },
        playClip: function (url, onEnd) {
          ensure();
          var el = document.createElement('audio');
          el.preload = 'auto';
          el.src = url;
          document.body.appendChild(el);
          var finished = false, watchdog = null, lastT = -1, stalls = 0;
          var cleanup = function () {
            if (finished) { return; }
            finished = true;
            if (watchdog) { clearInterval(watchdog); }
            try { if (el.__src) { el.__src.disconnect(); } if (el.__g) { el.__g.disconnect(); } } catch (e) {}
            try { el.pause(); } catch (e) {}
            if (el.parentNode) { el.parentNode.removeChild(el); }
            if (onEnd) { onEnd(); }
          };
          el.onended = cleanup;
          el.onerror = cleanup;
          var route = function () {
            if (!ctx || el.__src) { return; }
            try {
              if (ctx.state === 'suspended') { ctx.resume(); }
              var src = ctx.createMediaElementSource(el);
              var g = ctx.createGain();
              g.gain.value = 1;
              src.connect(g);
              g.connect(bus);              // into the broadcast mix
              g.connect(ctx.destination);  // and to the host's own speakers
              el.__src = src; el.__g = g;
            } catch (e) {}
          };
          var start = function () {
            route();
            el.play().catch(function () { cleanup(); });
            /* MediaRecorder webm has no duration header, so "ended" is the only reliable end signal;
               a watchdog catches a clip that never advances (stalled load) */
            watchdog = setInterval(function () {
              if (finished) { clearInterval(watchdog); return; }
              if (el.currentTime === lastT) { stalls++; } else { stalls = 0; lastT = el.currentTime; }
              if (stalls >= 8) { cleanup(); }
            }, 1000);
          };
          if (el.readyState >= 3) { start(); }
          else {
            var armed = false;
            var go = function () { if (armed) { return; } armed = true; start(); };
            el.addEventListener('canplay', go, { once: true });
            setTimeout(function () { if (!armed && !finished) { go(); } }, 4000);
            el.load();
          }
          return el;
        },
        stream: function () { ensure(); return dest ? dest.stream : null; }
      };
    })();

    // The Go Live studio picks this up when it starts recording/broadcasting.
    window.smlVoiceMix = {
      attachHostStream: function (s) { mixer.attachHost(s); },
      outputStream: function () { return mixer.stream(); },
      hasCaller: function () { return !!hostPeer; }
    };

    function openHostCall(session) {
      if (hostUid === session.session_uid) { return; }
      closeHostCall();
      hostUid = session.session_uid;

      hostPeer = VoicePeer(session.session_uid, 'host', {
        onTrack: function (stream) {
          // Monitor so the host hears the caller, and feed the broadcast mix.
          monitor = document.createElement('audio');
          monitor.autoplay = true;
          monitor.srcObject = stream;
          monitor.volume = 1;
          document.body.appendChild(monitor);
          mixer.attachCaller(stream, session.muted, session.gain);
        },
        onClosed: function () { hostPeer = null; }
      });
      hostPeer.startHost();
    }

    function closeHostCall() {
      if (hostPeer) { hostPeer.stop(); hostPeer = null; }
      hostUid = null;
      mixer.detachCaller();
      if (monitor) { monitor.srcObject = null; monitor.remove(); monitor = null; }
    }

    function load() {
      if (!roomId) { render(); return; }
      api('/queue?room_id=' + encodeURIComponent(roomId))
        .then(function (d) {
          data = d;
          var a = d.active_session;
          if (a && (a.state === 'connecting' || a.state === 'speaking' || a.state === 'muted')) {
            openHostCall(a);
            mixer.setCallerGain(a.muted ? 0 : (a.gain || 1));
          } else {
            closeHostCall();
          }
          render();
        })
        .catch(function (e) {
          data = { queue: [], active_session: null, settings: {}, error: e.message };
          closeHostCall();
          render();
        });
    }

    function act(path, body) {
      return api(path, { method: 'POST', json: body }).then(load)
        .catch(function (e) { window.alert(e.message); });
    }
    /* recorded voice Super Chat: approve = play the clip into the stream (and to the host's speakers) */
    function approveOrPlay(id) {
      if (playing) { window.alert('A voice message is already playing. Stop it first.'); return; }
      api('/approve', { method: 'POST', json: { queue_id: id, start_muted: false } })
        .then(function (d) {
          if (d && d.clip && d.clip_url) {
            playing = { name: d.display_name || 'Viewer', seconds: d.seconds || 0, startedAt: Date.now(), lb: d.loop_bucks || 0, level: d.level || null };
            playing.el = mixer.playClip(d.clip_url, function () { playing = null; render(); });
            /* the queue poll re-renders every 6s; the local clock keeps the countdown honest in between */
            var tick = setInterval(function () {
              if (!playing) { clearInterval(tick); return; }
              var left = Math.max(0, playing.seconds - Math.floor((Date.now() - playing.startedAt) / 1000));
              var t = dock.querySelector('[data-playclock]'); if (t) { t.textContent = clock(left); }
            }, 1000);
          }
          return load();
        })
        .catch(function (e) { window.alert(e.message); });
    }
    function stopClip() {
      if (playing && playing.el) { try { playing.el.pause(); playing.el.currentTime = playing.el.duration || 0; } catch (e) {} if (playing.el.onended) { playing.el.onended(); } }
      playing = null;
      render();
    }

    function render() {
      var a = data.active_session;
      var head = '<div class="vcd-head">' + (a ? '<span class="vc-live"><i></i>ON AIR</span>' : '<b>Voice Queue</b>')
        + '<span class="vcd-count">' + (data.queue ? data.queue.length : 0) + '</span>'
        + '<button class="vcd-min" data-min>' + (dock.classList.contains('vc-collapsed') ? '+' : '–') + '</button></div>';

      var body = '<div class="vcd-body">';

      if (!roomId) {
        body += '<div class="vcd-empty">Set the live room to manage call-ins.</div>';
      } else if (data.error) {
        body += '<div class="vcd-empty">' + esc(data.error) + '</div>';
      } else {
        if (a) {
          body += '<div class="vcd-active"><div class="vcd-active-top">'
            + '<img src="' + esc(a.avatar_url) + '" alt="" style="width:32px;height:32px;border-radius:50%">'
            + '<b>' + esc(a.display_name) + '</b>'
            + '<span class="vcd-timer" data-timer>' + clock(a.remaining_seconds) + '</span></div>'
            + '<div class="vcd-ctl">'
            + '<button data-sess="' + esc(a.session_uid) + '" data-op="' + (a.muted ? 'unmute' : 'mute') + '">'
            + (a.muted ? 'Unmute' : 'Mute') + '</button>'
            + '<button data-sess="' + esc(a.session_uid) + '" data-op="extend">+15s</button>'
            + '<button class="end" data-sess="' + esc(a.session_uid) + '" data-op="end">End</button>'
            + '</div></div>';
        }

        if (playing) {
          body += '<div class="vcd-active"' + (playing.level ? ' style="border-color:' + esc(playing.level.color) + '"' : '') + '><div class="vcd-active-top">'
            + '<span class="vc-live"><i></i>ON STREAM</span>'
            + '<b style="margin-left:8px">' + esc(playing.name) + ' · ' + Number(playing.lb || 0).toLocaleString() + ' LB' + (playing.level ? ' · ' + esc(playing.level.label) : '') + '</b>'
            + '<span class="vcd-timer" data-playclock>' + clock(playing.seconds) + '</span></div>'
            + '<div class="vcd-ctl"><button class="end" data-stopclip>Stop</button></div></div>';
        }
        if (!data.queue || !data.queue.length) {
          body += '<div class="vcd-empty">No one waiting. Voice messages appear here after a viewer sends a voice Super Chat.</div>';
        } else {
          body += data.queue.map(function (q) {
            var clip = !!q.clip_url;
            return '<div class="vcd-item"><div class="vcd-who">'
              + '<img src="' + esc(q.avatar_url) + '" alt="">'
              + '<span><b>' + esc(q.display_name) + '</b>'
              + '<small>' + (clip ? clock(q.clip_seconds) + ' voice message · ' : '') + 'waiting ' + clock(q.waiting_seconds) + '</small></span>'
              + '<span class="vcd-amt">' + q.loop_bucks.toLocaleString() + ' LB' + (q.level ? ' <i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + esc(q.level.color) + ';vertical-align:middle"></i> ' + esc(q.level.label) : '') + '</span></div>'
              + (q.message ? '<p class="vcd-msg">"' + esc(q.message) + '"</p>' : '')
              + (clip
                  ? '<div class="vcd-msg" style="margin-top:6px"><small>Listen privately first (only you hear this):</small>'
                    + '<audio controls preload="none" src="' + esc(q.clip_url) + '" style="width:100%;height:32px;margin-top:4px"></audio></div>'
                  : (q.mic_ready ? '' : '<div class="vcd-warn">Mic not granted yet</div>'))
              + '<div class="vcd-acts"' + (clip ? ' style="grid-template-columns:2fr 1fr 1fr"' : '') + '>'
              + (clip
                  ? '<button class="ok" data-q="' + q.id + '" data-op="approve">▶ Play on stream</button>'
                  : '<button class="ok" data-q="' + q.id + '" data-op="approve">Approve</button>'
                    + '<button data-q="' + q.id + '" data-op="approve-muted">Muted</button>')
              + '<button class="no" data-q="' + q.id + '" data-op="deny">' + (clip ? 'Decline' : 'Deny') + '</button>'
              + '<button class="no" data-q="' + q.id + '" data-u="' + q.user_id + '" data-op="ban">Block</button>'
              + '</div></div>';
          }).join('');
        }
      }

      body += '<div class="vcd-room">Live room id'
        + '<input data-room value="' + esc(roomId) + '" placeholder="e.g. g7 or the room id"></div>';
      body += '</div>';

      dock.innerHTML = head + body;
    }

    dock.addEventListener('click', function (e) {
      if (e.target.closest('[data-min]')) {
        dock.classList.toggle('vc-collapsed');
        render();
        return;
      }
      if (e.target.closest('[data-stopclip]')) { stopClip(); return; }
      var q = e.target.closest('[data-q]');
      if (q) {
        var op = q.getAttribute('data-op');
        var id = Number(q.getAttribute('data-q'));
        if (op === 'approve')        { approveOrPlay(id); }
        else if (op === 'approve-muted') { act('/approve', { queue_id: id, start_muted: true }); }
        else if (op === 'deny')      { act('/deny', { queue_id: id, reason: 'host' }); }
        else if (op === 'ban') {
          if (window.confirm('Block this viewer from voice on this stream?')) {
            act('/ban', { room_id: roomId, user_id: Number(q.getAttribute('data-u')), hours: 24, reason: 'host' });
          }
        }
        return;
      }
      var s = e.target.closest('[data-sess]');
      if (s) {
        var uid = s.getAttribute('data-sess');
        var sop = s.getAttribute('data-op');
        if (sop === 'extend') { act('/session', { session_uid: uid, action: 'extend', seconds: 15 }); }
        else                  { act('/session', { session_uid: uid, action: sop }); }
      }
    });

    dock.addEventListener('change', function (e) {
      if (!e.target.matches('[data-room]')) { return; }
      roomId = e.target.value.trim();
      window.localStorage.setItem('sml-voice-host-room', roomId);
      load();
    });

    // Local countdown between polls so the timer does not look frozen.
    setInterval(function () {
      if (!data.active_session) { return; }
      data.active_session.remaining_seconds = Math.max(0, data.active_session.remaining_seconds - 1);
      var t = dock.querySelector('[data-timer]');
      if (t) { t.textContent = clock(data.active_session.remaining_seconds); }
    }, 1000);

    load();
    var smlQueueTimer=null;
    /* Poll only while the tab is visible. This ran unconditionally every
       3s with no visibilitychange handling, so a backgrounded Go Live tab
       requested the queue ~1,200 times an hour for data nobody was looking
       at. Visible cadence is unchanged; returning refreshes immediately. */
    function smlStartQueuePoll(){ if(!smlQueueTimer){ smlQueueTimer=setInterval(load,6000); } }
    function smlStopQueuePoll(){ if(smlQueueTimer){ clearInterval(smlQueueTimer); smlQueueTimer=null; } }
    document.addEventListener("visibilitychange", function(){
      if(document.hidden){ smlStopQueuePoll(); } else { load(); smlStartQueuePoll(); }
    });
    if(!document.hidden){ smlStartQueuePoll(); }
  }

  mountDock();
})();
SMLVOICEJS;
    }
}

if (!function_exists('sml_voice_enqueue_assets')) {
    function sml_voice_enqueue_assets($room_id = '', $host_dock = false) {
        static $done = false;
        if ($done) {
            return;
        }
        $done = true;
        $config = sml_voice_ui_config($room_id);
        $config['hostDock'] = (bool) $host_dock;

        echo '<style>' . sml_voice_styles() . '</style>';
        echo '<script>window.smlVoiceConfig=' . wp_json_encode($config) . ';</script>';
        echo '<script>' . sml_voice_script() . '</script>';
    }
}

if (!function_exists('sml_voice_shortcode')) {
    function sml_voice_shortcode($atts) {
        $atts = shortcode_atts(array('room_id' => '', 'group_id' => ''), $atts, 'sml_voice_callin');
        $room = $atts['room_id'] ?: ($atts['group_id'] ? 'g' . (int) $atts['group_id'] : '');

        ob_start();
        echo '<div data-sml-voice-callin data-room="' . esc_attr($room) . '"></div>';
        add_action('wp_footer', function () use ($room) {
            sml_voice_enqueue_assets($room, false);
        }, 140);
        return (string) ob_get_clean();
    }
}
add_shortcode('sml_voice_callin', 'sml_voice_shortcode');

/** Host dock is printed directly into the standalone Go Live page. */
if (!function_exists('sml_voice_print_host_dock')) {
    function sml_voice_print_host_dock($room_id = '') {
        if (!is_user_logged_in()) {
            return;
        }
        sml_voice_enqueue_assets($room_id, true);
    }
}
