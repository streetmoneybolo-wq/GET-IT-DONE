/* Group Chirp LIVE (owner call 2026-09-10): the analyst / owner talks and every member of the group who has Chirp on
   hears it while they talk — browser-to-browser WebRTC audio (Opus 48 kHz, 128 kbps, no recording in the path),
   signalled through the LOOP-KICK Render service with long-polling (milliseconds, no WordPress boots).
   The recorded chirp still goes out in parallel for members who are not connected (LOOP-KICK elsewhere, phones).

   window.SMLChirpLive
     .listen(gid, { me, wants })        member on the group page with Chirp on → hears live
     .arm(gid)                          speaker (dashboard mic) → connections to every listener are prepared up front
     .talkStart(gid, channelId) / .talkStop()   hold-to-talk: the mic track is swapped into the open connections instantly
     .stop()                            leave everything
     .state()                           { joined, gid, mode, listeners, speakers, talking }
*/
(function () {
  'use strict';
  if (window.SMLChirpLive) return;
  var RENDER = 'https://stockmarketloop-loop-kick.onrender.com';
  var API = RENDER + '/api/chirp-live/';
  var AUDIO_OPTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 };

  function token() {
    var f = document.getElementById('sml-loop-popup-frame');
    var src = f ? (f.getAttribute('src') || f.getAttribute('data-src') || '') : '';
    var m = /#session=([^&]+)/.exec(src) || /[?&]session=([^&#]+)/.exec(src);
    return m ? decodeURIComponent(m[1]) : '';
  }
  var CLIENT = (function () { try { var k = sessionStorage.getItem('sml_cl_client'); if (!k) { k = Math.random().toString(36).slice(2, 12); sessionStorage.setItem('sml_cl_client', k); } return k; } catch (e) { return Math.random().toString(36).slice(2, 12); } })();
  var S = { gid: 0, mode: '', joined: false, self: '', me: 0, wants: null, peers: {}, members: [], polling: false, stream: null, talking: false, channel: 0, ice: null, onchange: null, audios: {}, needTap: [], iceAt: 0 };

  function hdr(json) { var h = { Authorization: 'Bearer ' + token() }; if (json) h['Content-Type'] = 'application/json'; return h; }
  function parse(r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; e.rejoin = !!j.rejoin; throw e; } return j; }); }
  function post(p, b) { b = b || {}; b.client = CLIENT; return fetch(API + p, { method: 'POST', headers: hdr(true), body: JSON.stringify(b) }).then(parse); }
  function ice() {
    if (S.ice && Date.now() - S.iceAt < 240000) return Promise.resolve(S.ice);
    return fetch(RENDER + '/api/ice', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { S.ice = { iceServers: (j && j.iceServers) || [{ urls: 'stun:stun.l.google.com:19302' }] }; S.iceAt = Date.now(); return S.ice; }).catch(function () { return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }; });
  }
  function emit() { try { if (S.onchange) S.onchange(state()); } catch (e) {} }
  function state() {
    var sp = 0, li = 0; S.members.forEach(function (m) { if (m.key === S.self) return; if (m.mode === 'speaker') sp++; else li++; });
    return { joined: S.joined, gid: S.gid, mode: S.mode, self: S.self, speakers: sp, listeners: li, talking: S.talking, members: S.members, connected: Object.keys(S.peers).filter(function (k) { var p = S.peers[k]; return p.pc && p.pc.connectionState === 'connected'; }).length, needTap: S.needTap.length };
  }

  /* ---------------- peers ---------------- */
  function peer(id) { return S.peers[id] || null; }
  function closePeer(id) { var p = S.peers[id]; if (!p) return; try { p.pc.close(); } catch (e) {} delete S.peers[id]; var a = S.audios[id]; if (a) { try { a.pause(); a.srcObject = null; a.remove(); } catch (e) {} delete S.audios[id]; } }
  function newPc(id, outbound) {
    return ice().then(function (cfg) {
      var pc = new RTCPeerConnection(cfg);
      var p = { pc: pc, outbound: outbound, pending: [], sender: null };
      S.peers[id] = p;
      pc.onicecandidate = function (ev) { if (ev.candidate) post('signal', { group: S.gid, to: id, type: 'candidate', payload: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate }).catch(function () {}); };
      pc.onconnectionstatechange = function () { if (pc.connectionState === 'failed') { closePeer(id); if (outbound) offerTo(id); } emit(); };
      if (outbound) {
        var tr = pc.addTransceiver('audio', { direction: 'sendonly' });
        p.sender = tr.sender;
        try { var params = p.sender.getParameters(); params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}]; params.encodings[0].maxBitrate = 128000; p.sender.setParameters(params).catch(function () {}); } catch (e) {}
        if (S.talking && S.stream) { var t = S.stream.getAudioTracks()[0]; if (t) p.sender.replaceTrack(t).catch(function () {}); }
      } else {
        pc.ontrack = function (ev) { attach(id, ev.streams[0] || new MediaStream([ev.track])); };
      }
      return p;
    });
  }
  function attach(id, stream) {
    var a = S.audios[id];
    if (!a) { a = document.createElement('audio'); a.autoplay = true; a.setAttribute('playsinline', ''); a.style.display = 'none'; document.body.appendChild(a); S.audios[id] = a; }
    a.srcObject = stream;
    a.muted = !wantsSpeaker(id);
    a.play().then(function () { S.needTap = S.needTap.filter(function (x) { return x !== id; }); emit(); }).catch(function () { if (S.needTap.indexOf(id) < 0) S.needTap.push(id); emit(); armTapAnywhere(); });
  }
  /* phones refuse audio that no touch started: the very next tap ANYWHERE on the page starts every waiting stream */
  var tapArmed = false;
  function armTapAnywhere() {
    if (tapArmed) return; tapArmed = true;
    var h = function () { tapArmed = false; document.removeEventListener('pointerdown', h, true); document.removeEventListener('touchstart', h, true); api.tapToHear(); };
    document.addEventListener('pointerdown', h, true); document.addEventListener('touchstart', h, true);
  }
  function wantsSpeaker(id) {
    if (!S.wants) return true;
    var m = S.members.filter(function (x) { return x.key === id; })[0];
    return S.wants({ by: { id: m ? m.id : 0 }, channelId: (m && m.channel) || 0 });
  }
  function offerTo(id) {
    if (peer(id)) return Promise.resolve();
    return newPc(id, true).then(function (p) {
      return p.pc.createOffer().then(function (o) { return p.pc.setLocalDescription(o); }).then(function () {
        return post('signal', { group: S.gid, to: id, type: 'offer', payload: { type: p.pc.localDescription.type, sdp: p.pc.localDescription.sdp } });
      });
    }).catch(function () { closePeer(id); });
  }
  function handle(sig) {
    var from = String(sig.from), pl = sig.payload || {};
    if (sig.type === 'offer') {
      closePeer(from);
      return newPc(from, false).then(function (p) {
        return p.pc.setRemoteDescription(new RTCSessionDescription(pl)).then(function () { return p.pc.createAnswer(); }).then(function (a) { return p.pc.setLocalDescription(a); }).then(function () {
          flush(from);
          return post('signal', { group: S.gid, to: from, type: 'answer', payload: { type: p.pc.localDescription.type, sdp: p.pc.localDescription.sdp } });
        });
      });
    }
    var p = peer(from);
    if (sig.type === 'answer') { if (p && p.pc.signalingState === 'have-local-offer') return p.pc.setRemoteDescription(new RTCSessionDescription(pl)).then(function () { flush(from); }); return Promise.resolve(); }
    if (sig.type === 'candidate') { if (!p) return Promise.resolve(); if (p.pc.remoteDescription) return p.pc.addIceCandidate(new RTCIceCandidate(pl)).catch(function () {}); p.pending.push(pl); return Promise.resolve(); }
    if (sig.type === 'talk') { var m = S.members.filter(function (x) { return x.key === from; })[0]; if (m) { m.talking = pl.on ? Date.now() : 0; m.channel = Number(pl.channel) || 0; } var a = S.audios[from]; if (a) a.muted = !wantsSpeaker(from); emit(); return Promise.resolve(); }
    if (sig.type === 'hangup') { closePeer(from); emit(); }
    return Promise.resolve();
  }
  function flush(id) { var p = peer(id); if (!p) return; var q = p.pending.splice(0); q.forEach(function (c) { p.pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {}); }); }

  /* ---------------- room loop ---------------- */
  function sync(members) {
    S.members = members || [];
    if (S.mode === 'speaker') {
      S.members.forEach(function (m) { if (m.key !== S.self && !peer(m.key)) offerTo(m.key); });
    }
    var alive = {}; S.members.forEach(function (m) { alive[m.key] = 1; });
    Object.keys(S.peers).forEach(function (k) { if (!alive[k]) closePeer(k); });
    emit();
  }
  function poll() {
    if (!S.joined || S.polling) return;
    S.polling = true;
    fetch(API + 'poll?group=' + S.gid + '&wait=1&client=' + CLIENT, { headers: hdr(false) }).then(parse).then(function (j) {
      S.polling = false;
      var chain = Promise.resolve();
      (j.signals || []).forEach(function (sig) { chain = chain.then(function () { return handle(sig); }); });
      chain.then(function () { sync(j.members); if (S.joined) poll(); });
    }).catch(function (e) {
      S.polling = false;
      if (!S.joined) return;
      if (e.rejoin || e.status === 409) { join().catch(function () {}); return; }
      setTimeout(poll, 2500);
    });
  }
  function join() {
    if (!token()) return Promise.reject(new Error('no LOOP-KICK session on this page'));
    return post('join', { group: S.gid, mode: S.mode }).then(function (j) {
      S.self = String(j.self || S.self); S.me = Number(j.id) || S.me; S.joined = true; sync(j.members); poll(); return j;
    });
  }

  /* ---------------- public ---------------- */
  var api = {
    listen: function (gid, opts) {
      opts = opts || {};
      if (S.joined && S.gid === gid && S.mode === 'listener') { S.wants = opts.wants || S.wants; S.onchange = opts.onchange || S.onchange; return Promise.resolve(state()); }
      api.stop();
      S.gid = Number(gid); S.mode = 'listener'; S.me = Number(opts.me) || 0; S.wants = opts.wants || null; S.onchange = opts.onchange || null;
      return join();
    },
    arm: function (gid, opts) {
      opts = opts || {};
      if (S.joined && S.gid === gid && S.mode === 'speaker') { S.onchange = opts.onchange || S.onchange; return Promise.resolve(state()); }
      api.stop();
      S.gid = Number(gid); S.mode = 'speaker'; S.onchange = opts.onchange || null;
      return join();
    },
    talkStart: function (gid, channelId) {
      var start = function () {
        return navigator.mediaDevices.getUserMedia({ audio: AUDIO_OPTS }).then(function (stream) {
          S.stream = stream; S.talking = true; S.channel = Number(channelId) || 0;
          var t = stream.getAudioTracks()[0];
          Object.keys(S.peers).forEach(function (k) { var p = S.peers[k]; if (p.outbound && p.sender) p.sender.replaceTrack(t).catch(function () {}); });
          post('signal', { group: S.gid, to: 0, type: 'talk', payload: { on: true, channel: S.channel } }).catch(function () {});
          emit();
          return stream;
        });
      };
      if (S.joined && S.mode === 'speaker' && S.gid === Number(gid)) return start();
      return api.arm(gid).then(start);
    },
    talkStop: function () {
      S.talking = false;
      Object.keys(S.peers).forEach(function (k) { var p = S.peers[k]; if (p.outbound && p.sender) p.sender.replaceTrack(null).catch(function () {}); });
      if (S.stream) { S.stream.getTracks().forEach(function (t) { t.stop(); }); S.stream = null; }
      if (S.joined) post('signal', { group: S.gid, to: 0, type: 'talk', payload: { on: false } }).catch(function () {});
      emit();
    },
    tapToHear: function () { Object.keys(S.audios).forEach(function (k) { S.audios[k].play().then(function () { S.needTap = []; emit(); }).catch(function () {}); }); },
    stop: function () {
      var was = S.joined; var gid = S.gid;
      S.joined = false; api.talkStop();
      Object.keys(S.peers).forEach(closePeer);
      if (was) post('leave', { group: gid }).catch(function () {});
      S.members = []; emit();
    },
    state: state,
    hasSession: function () { return !!token(); }
  };
  window.addEventListener('pagehide', function () { if (S.joined) { try { navigator.sendBeacon && navigator.sendBeacon(API + 'leave', new Blob([JSON.stringify({ group: S.gid })], { type: 'application/json' })); } catch (e) {} } });
  window.SMLChirpLive = api;
})();
