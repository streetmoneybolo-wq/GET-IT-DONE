<?php
/**
 * Live video slots.
 *
 * The creator picks how many live video feeds they are running - 1, 2 or 3 -
 * from the Go Live page. The watch page then shows exactly that many players:
 * slot 1 is the main stage, slot 2 sits at the top of the right rail, slot 3
 * goes directly under slot 2, and everything that was already in the rail
 * moves down to make room.
 *
 * All three slots are video. Nothing else goes in them.
 */

if (!defined('ABSPATH')) {
    exit;
}

/* ==================================================================
 * Feed keys
 *
 * One rotatable base key. Slot 2 publishes to {key}-b, slot 3 to {key}-c.
 * They resolve back to the same row, so rotating once revokes all three.
 * ================================================================== */

if (!function_exists('sml_slots_feed_suffixes')) {
    function sml_slots_feed_suffixes() {
        return array(1 => '', 2 => '-b', 3 => '-c');
    }
}

if (!function_exists('sml_slots_split_key')) {
    /** @return array [base_key, slot_number] */
    function sml_slots_split_key($key) {
        $key = trim((string) $key);
        foreach (sml_slots_feed_suffixes() as $slot => $suffix) {
            if ($suffix !== '' && substr($key, -strlen($suffix)) === $suffix) {
                return array(substr($key, 0, -strlen($suffix)), $slot);
            }
        }
        return array($key, 1);
    }
}

/** Lets {key}-b and {key}-c authenticate against the base key's row. */
if (!function_exists('sml_slots_resolve_key')) {
    function sml_slots_resolve_key($row, $key) {
        if ($row) {
            return $row;
        }
        global $wpdb;
        list($base, $slot) = sml_slots_split_key($key);
        if ($slot === 1 || $base === '') {
            return $row;
        }
        $found = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_rtmp_table() . " WHERE stream_key = %s AND status = 'active'",
            $base
        ), ARRAY_A);
        if ($found) {
            $found['_feed'] = $slot;
        }
        return $found;
    }
}
add_filter('sml_rtmp_resolve_key', 'sml_slots_resolve_key', 10, 2);

if (!function_exists('sml_slots_feed_state')) {
    function sml_slots_feed_state($user_id) {
        $state = get_user_meta((int) $user_id, 'sml_slots_feeds', true);
        return is_array($state) ? $state : array();
    }
}

if (!function_exists('sml_slots_mark_feed')) {
    function sml_slots_mark_feed($user_id, $slot, $live) {
        $slot = (int) $slot ?: 1;
        $state = sml_slots_feed_state($user_id);
        if ($live) {
            $state[$slot] = array('live' => true, 'since' => gmdate('c'));
        } else {
            unset($state[$slot]);
        }
        update_user_meta((int) $user_id, 'sml_slots_feeds', $state);
    }
}

/* ==================================================================
 * Slot count - the creator's choice
 * ================================================================== */

if (!function_exists('sml_slots_count')) {
    function sml_slots_count($user_id) {
        $n = (int) get_user_meta((int) $user_id, 'sml_slots_count', true);
        return ($n >= 1 && $n <= 3) ? $n : 1;
    }
}

if (!function_exists('sml_slots_set_count')) {
    function sml_slots_set_count($user_id, $n) {
        $n = max(1, min(3, (int) $n));
        update_user_meta((int) $user_id, 'sml_slots_count', $n);
        return $n;
    }
}

/* ==================================================================
 * REST
 * ================================================================== */

if (!function_exists('sml_slots_routes')) {
    function sml_slots_routes() {
        register_rest_route('sml-live/v1', '/feeds/(?P<handle>[A-Za-z0-9\-_]+)', array(
            'methods' => 'GET',
            'permission_callback' => '__return_true',
            'callback' => 'sml_slots_rest_feeds',
        ));
        register_rest_route('sml-live/v1', '/slots', array(
            array('methods' => 'GET',
                  'permission_callback' => function () { return is_user_logged_in(); },
                  'callback' => 'sml_slots_rest_get'),
            array('methods' => 'POST',
                  'permission_callback' => function () { return is_user_logged_in(); },
                  'callback' => 'sml_slots_rest_save'),
        ));
    }
}
add_action('rest_api_init', 'sml_slots_routes');

if (!function_exists('sml_slots_keys_for')) {
    function sml_slots_keys_for($base_key, $count) {
        $out = array();
        foreach (sml_slots_feed_suffixes() as $slot => $suffix) {
            if ($slot > $count) {
                break;
            }
            $out[] = array(
                'slot'  => $slot,
                'label' => $slot === 1 ? 'Main' : ('Slot ' . $slot),
                'key'   => $base_key . $suffix,
            );
        }
        return $out;
    }
}

if (!function_exists('sml_slots_rest_get')) {
    function sml_slots_rest_get() {
        $user_id = get_current_user_id();
        $row = sml_rtmp_get_key($user_id, false);
        $base = $row && !empty($row['stream_key']) ? $row['stream_key'] : '';
        $count = sml_slots_count($user_id);

        return array(
            'count' => $count,
            'keys'  => $base ? sml_slots_keys_for($base, $count) : array(),
            'live'  => array_keys(sml_slots_feed_state($user_id)),
        );
    }
}

if (!function_exists('sml_slots_rest_save')) {
    function sml_slots_rest_save(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        $count = sml_slots_set_count($user_id, (int) $request->get_param('count'));
        $row = sml_rtmp_get_key($user_id, false);
        $base = $row && !empty($row['stream_key']) ? $row['stream_key'] : '';

        return array(
            'ok'    => true,
            'count' => $count,
            'keys'  => $base ? sml_slots_keys_for($base, $count) : array(),
        );
    }
}

if (!function_exists('sml_slots_rest_feeds')) {
    function sml_slots_rest_feeds(WP_REST_Request $request) {
        global $wpdb;
        $handle = sanitize_title((string) $request->get_param('handle'));
        $user = get_user_by('slug', $handle);
        if (!$user) {
            return new WP_Error('no_user', 'No such creator.', array('status' => 404));
        }

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_rtmp_table() . " WHERE user_id = %d AND status = 'active'",
            $user->ID
        ), ARRAY_A);

        $count = sml_slots_count($user->ID);

        // The creator's chosen tickers for this stream: PRIMARY first, then the related tickers they picked
        // at go-live / schedule (sidecar meta _sml_live_desk_tickers, written by sml-live-desk-tickers.php on
        // both start routes). The live desk module shows ONLY these — never a generic/global "top" list. When
        // the creator picked nothing the desk stays neutral rather than inventing tickers. Falls back to the
        // scheduled-live primary alone for streams started before the sidecar existed (no regression).
        $sched = get_user_meta($user->ID, '_sml_scheduled_live', true);
        $sched_primary = is_array($sched) ? strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($sched['ticker'] ?? ''))) : '';

        $desk_tickers = array();
        $desk_list = get_user_meta($user->ID, '_sml_live_desk_tickers', true);
        if (is_array($desk_list)) {
            foreach ($desk_list as $desk_sym) {
                $desk_sym = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $desk_sym));
                if ($desk_sym === '' || strlen($desk_sym) > 5) { continue; }
                if (in_array($desk_sym, $desk_tickers, true)) { continue; }
                $desk_tickers[] = $desk_sym;
                if (count($desk_tickers) >= 5) { break; }
            }
        }
        // Fall back to the scheduled-live primary ONLY when the sidecar was never written (old stream / OBS
        // go-live). An explicit empty sidecar array means the creator deliberately picked no ticker — honor it
        // as a neutral desk rather than resurrecting a stale scheduled primary.
        if (empty($desk_tickers) && !is_array($desk_list) && $sched_primary !== '' && strlen($sched_primary) <= 5) {
            $desk_tickers = array($sched_primary);
        }
        $desk_ticker = isset($desk_tickers[0]) ? $desk_tickers[0] : '';

        if (!$row) {
            return array('live' => false, 'count' => $count, 'slots' => array(), 'ticker' => $desk_ticker, 'tickers' => $desk_tickers);
        }

        $settings = sml_rtmp_settings();
        $state = sml_slots_feed_state($user->ID);
        $slots = array();

        foreach (sml_slots_feed_suffixes() as $slot => $suffix) {
            if ($slot > $count) {
                break;
            }
            $is_live = ($slot === 1) ? (bool) $row['is_live'] : !empty($state[$slot]['live']);
            $slots[] = array(
                'slot'     => $slot,
                'live'     => $is_live,
                'playback' => $is_live ? sml_rtmp_playback_url($row['stream_key'] . $suffix, $settings) : '',
            );
        }

        return array(
            'live'    => (bool) $row['is_live'],
            'count'   => $count,
            'slots'   => $slots,
            'ticker'  => $desk_ticker,
            'tickers' => $desk_tickers,
            'creator' => array(
                'id'     => (int) $user->ID,
                'name'   => $user->display_name ?: $user->user_login,
                'handle' => $user->user_nicename,
            ),
        );
    }
}

/* ==================================================================
 * Viewer
 * ================================================================== */

if (!function_exists('sml_slots_styles')) {
    function sml_slots_styles() {
        return <<<'SMLSLOTCSS'
.sl-stage{display:grid;gap:14px;align-items:start}
.sl-stage[data-count="1"]{grid-template-columns:1fr}
.sl-stage[data-count="2"],.sl-stage[data-count="3"]{grid-template-columns:minmax(0,1fr) 380px}
.sl-main{min-width:0}
.sl-rail{display:flex;flex-direction:column;gap:14px;min-width:0}

.sl-video{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:12px;
    overflow:hidden;border:1px solid #16202e}
.sl-video video{width:100%;height:100%;display:block;object-fit:contain;background:#000}
.sl-tag{position:absolute;top:9px;left:9px;z-index:3;height:24px;display:inline-flex;align-items:center;
    gap:6px;padding:0 9px;border-radius:7px;background:rgba(5,9,15,.82);border:1px solid #223146;
    font-size:11px;font-weight:800;letter-spacing:.5px;color:#a9b8ca;backdrop-filter:blur(6px)}
.sl-tag .dot{width:7px;height:7px;border-radius:50%;background:#ff2d4b}
.sl-expand{position:absolute;top:9px;right:9px;z-index:3;height:24px;padding:0 9px;border-radius:7px;
    background:rgba(5,9,15,.82);border:1px solid #223146;color:#a9b8ca;font-size:11px;font-weight:700;
    cursor:pointer;font-family:inherit;backdrop-filter:blur(6px)}
.sl-expand:hover{color:#fff;border-color:#2b6cff}
.sl-off{display:grid;place-items:center;width:100%;height:100%;color:#41546b;font-size:13px;
    text-align:center;padding:18px;line-height:1.6}
.sl-sync{font-size:11.5px;color:#5d7189;padding:2px 2px 0}
.sl-sync b{color:#22d97a;font-weight:700}
.sl-sync.drift b{color:#e0a336}

.sl-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.sl-seg{display:inline-flex;background:#0d1725;border:1px solid #1e2a3a;border-radius:10px;padding:3px}
.sl-seg button{border:0;background:transparent;color:#8798ac;font-family:inherit;font-size:12.5px;
    font-weight:700;padding:6px 14px;border-radius:7px;cursor:pointer}
.sl-seg button[aria-pressed="true"]{background:#2b6cff;color:#fff}
.sl-seg button[disabled]{opacity:.35;cursor:default}
.sl-barlabel{font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#5d7189}
.sl-hint{font-size:12.5px;color:#8798ac;margin-left:auto}
.sl-hint b{color:#e0a336;font-weight:700}
.sl-mute{position:absolute;bottom:9px;right:9px;z-index:3;height:24px;padding:0 9px;border-radius:7px;
    background:rgba(5,9,15,.82);border:1px solid #223146;color:#a9b8ca;font-size:11px;font-weight:700;
    cursor:pointer;font-family:inherit;backdrop-filter:blur(6px)}
.sl-mute:hover{color:#fff;border-color:#2b6cff}
.sl-nudge{display:flex;align-items:center;gap:11px;margin-top:14px;padding:12px 15px;border-radius:12px;
    background:#101c2e;border:1px solid #1e3352;font-size:13px;color:#c8d5e4}
.sl-nudge button{margin-left:auto;border:0;background:#2b6cff;color:#fff;font-family:inherit;
    font-size:12.5px;font-weight:700;padding:7px 14px;border-radius:8px;cursor:pointer}
.sl-nudge a{color:#7b8ca1;font-size:12px;cursor:pointer}

@media (max-width:1100px){
  .sl-stage[data-count="2"],.sl-stage[data-count="3"]{grid-template-columns:1fr}
}
SMLSLOTCSS;
    }
}

if (!function_exists('sml_slots_script')) {
    function sml_slots_script() {
        return <<<'SMLSLOTJS'
(function () {
  var cfg = window.smlSlots;
  var root = document.getElementById('sl-root');
  if (!cfg || !root) { return; }

  var HLS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js';
  var slots = [];
  var players = {};
  var clock = null;
  var drift = 0;

  /* ---- viewer-side meta-logic ----
     The creator decides how many slots exist. The viewer decides how many of
     them their machine and connection actually render. */
  var MOBILE = window.matchMedia('(max-width: 820px)').matches;
  var HARD_CAP = MOBILE ? 2 : 3;   // device logic: phones never get three
  var want = readWant();           // what the viewer asked for
  var advice = '';                 // bandwidth nudge text, if any
  var lastInput = Date.now();
  var nudged = false;

  function readWant() {
    try {
      var v = parseInt(window.localStorage.getItem('smlSlotWant'), 10);
      if (v >= 1 && v <= 3) { return v; }
    } catch (e) {}
    return HARD_CAP;
  }
  function saveWant(v) {
    try { window.localStorage.setItem('smlSlotWant', String(v)); } catch (e) {}
  }
  function visibleCount() {
    return Math.max(1, Math.min(want, HARD_CAP, slots.length || 1));
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function loadHls() {
    if (window.Hls) { return Promise.resolve(window.Hls); }
    if (loadHls.p) { return loadHls.p; }
    loadHls.p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = HLS_SRC;
      s.onload = function () { resolve(window.Hls); };
      s.onerror = function () { reject(new Error('hls.js failed')); };
      document.head.appendChild(s);
    });
    return loadHls.p;
  }

  function fetchSlots() {
    return fetch(cfg.feedsEndpoint, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) { slots = (d && d.slots) || []; return d; })
      .catch(function () { slots = []; return null; });
  }

  function videoHtml(s) {
    var main = s.slot === 1;
    if (!s.live) {
      return '<div class="sl-video"><div class="sl-off">'
        + (main ? 'Not live right now.' : 'Slot ' + s.slot + ' is not publishing.')
        + '<br><span style="color:#5d7189;font-size:11.5px">'
        + (main ? 'Starts automatically when OBS connects.'
                : 'Send an OBS output to this key with <b>' + (s.slot === 2 ? '-b' : '-c') + '</b> on the end.')
        + '</span></div></div>';
    }
    return '<div class="sl-video" data-slot="' + s.slot + '">'
      + '<span class="sl-tag"><i class="dot"></i>' + (main ? 'LIVE' : 'SLOT ' + s.slot) + '</span>'
      + (main ? '' : '<button class="sl-expand" data-expand="' + s.slot + '">Swap</button>')
      + (main ? '' : '<button class="sl-mute" data-mute="' + s.slot + '">Unmute</button>')
      + '<video playsinline ' + (main ? 'controls' : 'muted') + '></video></div>';
  }

  function barHtml() {
    var offered = slots.length || 1;
    if (offered < 2) { return ''; }
    var shown = visibleCount();
    var h = '<div class="sl-bar"><span class="sl-barlabel">Video slots</span><div class="sl-seg">';
    for (var n = 1; n <= 3; n++) {
      var blocked = n > offered || n > HARD_CAP;
      h += '<button type="button" data-want="' + n + '"'
        + ' aria-pressed="' + (n === shown ? 'true' : 'false') + '"'
        + (blocked ? ' disabled' : '')
        + ' title="' + (n > offered ? 'The creator is only sending ' + offered
                        : (n > HARD_CAP ? 'Three slots needs a bigger screen' : 'Show ' + n)) + '">'
        + n + '</button>';
    }
    h += '</div>';
    if (advice) { h += '<span class="sl-hint">' + esc(advice) + '</span>'; }
    return h + '</div>';
  }

  function render() {
    var shown = visibleCount();
    var live = slots.slice(0, shown);
    var main = live[0] || { slot: 1, live: false };
    var rail = live.slice(1);

    var html = barHtml()
      + '<div class="sl-stage" data-count="' + shown + '">'
      + '<div class="sl-main">' + videoHtml(main) + '</div>';

    if (rail.length) {
      html += '<div class="sl-rail">'
        + rail.map(videoHtml).join('')
        + '<div class="sl-sync" id="sl-sync"></div>'
        + '</div>';
    }
    html += '</div><div id="sl-nudge"></div>';

    root.innerHTML = html;
    mount();
  }

  function teardown() {
    Object.keys(players).forEach(function (k) {
      var p = players[k];
      try { if (p.hls) { p.hls.destroy(); } } catch (e) {}
      try { if (p.video) { p.video.pause(); p.video.removeAttribute('src'); p.video.load(); } } catch (e) {}
    });
    players = {};
    clock = null;
  }

  function mount() {
    teardown();
    var nodes = root.querySelectorAll('.sl-video[data-slot]');
    if (!nodes.length) { return; }

    loadHls().then(function (Hls) {
      Array.prototype.forEach.call(nodes, function (node) {
        var n = Number(node.getAttribute('data-slot'));
        var s = null;
        slots.forEach(function (x) { if (x.slot === n) { s = x; } });
        var video = node.querySelector('video');
        if (!s || !s.playback || !video) { return; }

        if (Hls && Hls.isSupported()) {
          var hls = new Hls({ lowLatencyMode: true, backBufferLength: 30, maxBufferLength: 12 });
          hls.loadSource(s.playback);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, function () { video.play().catch(function () {}); });
          players[n] = { video: video, hls: hls };
        } else {
          video.src = s.playback;
          video.addEventListener('loadedmetadata', function () { video.play().catch(function () {}); });
          players[n] = { video: video, hls: null };
        }
        if (n === 1) { clock = video; }
      });
      sync();
    }).catch(function () {});
  }

  /**
   * Slot 1 is the clock; the others chase it. Separate OBS outputs drift, and
   * a chart running ahead of the narration is worse than no chart. Small drift
   * is eased out by nudging playback rate so nobody hears it; large drift gets
   * a hard seek because slewing would take too long.
   */
  function sync() {
    if (sync.t) { window.clearInterval(sync.t); }
    sync.t = window.setInterval(function () {
      if (!clock) { return; }
      var master = clock.currentTime, worst = 0;
      Object.keys(players).forEach(function (k) {
        if (Number(k) === 1) { return; }
        var v = players[k].video;
        if (!v || v.readyState < 2) { return; }
        var d = v.currentTime - master;
        if (Math.abs(d) > Math.abs(worst)) { worst = d; }
        if (Math.abs(d) > 2) { v.currentTime = master; v.playbackRate = 1; }
        else if (Math.abs(d) > 0.15) { v.playbackRate = d > 0 ? 0.97 : 1.03; }
        else { v.playbackRate = 1; }
      });
      drift = worst;
      var el = document.getElementById('sl-sync');
      if (el && Object.keys(players).length > 1) {
        var ms = Math.round(Math.abs(drift) * 1000);
        el.className = 'sl-sync' + (ms < 300 ? '' : ' drift');
        el.innerHTML = 'slots in sync <b>&plusmn;' + ms + 'ms</b>';
      }
    }, 1000);
  }

  root.addEventListener('click', function (e) {
    lastInput = Date.now();

    // Viewer picks how many slots to render. No page reload: render() tears
    // down the hls.js instances it no longer needs and builds the rest.
    var w = e.target.closest('[data-want]');
    if (w && !w.disabled) {
      want = Number(w.getAttribute('data-want'));
      saveWant(want);
      advice = '';
      render();
      return;
    }

    // Per-slot audio. Only one rail slot unmuted at a time or it is chaos.
    var m = e.target.closest('[data-mute]');
    if (m) {
      var slot = Number(m.getAttribute('data-mute'));
      var node = root.querySelector('.sl-video[data-slot="' + slot + '"] video');
      if (node) {
        var turningOn = node.muted;
        if (turningOn) {
          Array.prototype.forEach.call(root.querySelectorAll('.sl-video[data-slot] video'), function (v) {
            if (v !== node) { v.muted = true; }
          });
          Array.prototype.forEach.call(root.querySelectorAll('[data-mute]'), function (b) {
            b.textContent = 'Unmute';
          });
        }
        node.muted = !turningOn;
        m.textContent = node.muted ? 'Unmute' : 'Mute';
      }
      return;
    }

    // Swap a rail slot into the main stage.
    var b = e.target.closest('[data-expand]');
    if (!b) { return; }
    var n = Number(b.getAttribute('data-expand'));
    var i = -1;
    slots.forEach(function (s, idx) { if (s.slot === n) { i = idx; } });
    if (i > 0) {
      var tmp = slots[0]; slots[0] = slots[i]; slots[i] = tmp;
      render();
    }
  });

  /* ---- bandwidth logic ----
     hls.js already measures throughput per fragment. Compare the estimate
     against what the visible slots actually need and advise, never force --
     yanking a stream out from under someone mid-sentence is worse than
     buffering. */
  function bandwidthWatch() {
    window.setInterval(function () {
      var keys = Object.keys(players);
      if (keys.length < 2) { advice = ''; return; }

      var estimate = 0;
      var demand = 0;
      keys.forEach(function (k) {
        var p = players[k];
        if (!p || !p.hls) { return; }
        var bw = p.hls.bandwidthEstimate || 0;
        estimate = Math.max(estimate, bw);
        var lvl = p.hls.levels && p.hls.levels[p.hls.currentLevel];
        demand += (lvl && lvl.bitrate) || 2500000;
      });
      if (!estimate) { return; }

      var was = advice;
      if (demand > estimate * 0.85 && visibleCount() > 1) {
        advice = 'Connection is tight - try ' + (visibleCount() - 1) + ' slot'
               + (visibleCount() - 1 === 1 ? '' : 's');
      } else if (advice && demand < estimate * 0.55) {
        advice = '';
      } else if (!advice && visibleCount() < Math.min(slots.length, HARD_CAP)
                 && estimate > demand * 2.2) {
        advice = 'Plenty of headroom - room for another slot';
      }
      if (was !== advice) {
        var bar = root.querySelector('.sl-hint');
        if (bar) { bar.textContent = advice; }
        else { render(); }
      }
    }, 8000);
  }

  /* ---- engagement logic ----
     Idle viewer gets one nudge toward the Game Panel, then never again. */
  ['mousemove', 'keydown', 'touchstart', 'scroll'].forEach(function (evt) {
    window.addEventListener(evt, function () { lastInput = Date.now(); }, { passive: true });
  });

  function idleWatch() {
    window.setInterval(function () {
      if (nudged || document.hidden) { return; }
      if (Date.now() - lastInput < 150000) { return; }
      var panel = document.getElementById('sml-game-panel');
      var host = document.getElementById('sl-nudge');
      if (!panel || !host) { return; }
      nudged = true;
      host.innerHTML = '<div class="sl-nudge"><span>Still here? Play a quick game while you watch.</span>'
        + '<button type="button" data-nudge="open">Open games</button>'
        + '<a data-nudge="close">Dismiss</a></div>';
    }, 30000);
  }

  document.addEventListener('click', function (e) {
    var n = e.target.closest('[data-nudge]');
    if (!n) { return; }
    var host = document.getElementById('sl-nudge');
    if (host) { host.innerHTML = ''; }
    if (n.getAttribute('data-nudge') === 'open') {
      var panel = document.getElementById('sml-game-panel');
      if (panel) {
        if (panel.getAttribute('data-open') !== '1') {
          var head = panel.querySelector('[data-gp="toggle"]');
          if (head) { head.click(); }
        }
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });

  window.addEventListener('beforeunload', teardown);

  fetchSlots().then(function () {
    render();
    bandwidthWatch();
    idleWatch();
    window.setInterval(function () {
      var before = JSON.stringify(slots.map(function (s) { return s.slot + ':' + s.live; }));
      fetchSlots().then(function () {
        var after = JSON.stringify(slots.map(function (s) { return s.slot + ':' + s.live; }));
        if (before !== after) { render(); }
      });
    }, 15000);
  });
})();
SMLSLOTJS;
    }
}

if (!function_exists('sml_slots_render')) {
    function sml_slots_render($handle) {
        $config = array(
            'feedsEndpoint' => esc_url_raw(rest_url('sml-live/v1/feeds/' . rawurlencode($handle))),
        );
        $out  = '<style>' . sml_slots_styles() . '</style>';
        $out .= '<div id="sl-root"></div>';
        $out .= '<script>window.smlSlots=' . wp_json_encode($config) . ';</script>';
        $out .= '<script>' . sml_slots_script() . '</script>';
        return $out;
    }
}

if (!function_exists('sml_slots_shortcode')) {
    function sml_slots_shortcode($atts) {
        $atts = shortcode_atts(array('handle' => ''), $atts);
        $handle = $atts['handle'];
        if (!$handle) {
            $user = wp_get_current_user();
            $handle = $user->exists() ? $user->user_nicename : '';
        }
        return $handle ? sml_slots_render($handle) : '';
    }
}
add_shortcode('sml_live_slots', 'sml_slots_shortcode');

/* ==================================================================
 * The creator's control, injected into the Go Live OBS panel
 * ================================================================== */

if (!function_exists('sml_slots_print_control')) {
    /**
     * Called directly by the Go Live page, which renders standalone and never
     * fires wp_footer.
     */
    function sml_slots_print_control() {
        if (!is_user_logged_in()) {
            return;
        }

        $config = array(
            'endpoint'  => esc_url_raw(rest_url('sml-live/v1/slots')),
            'diagnose'  => esc_url_raw(rest_url('sml-voice/v1/rtmp/diagnose')),
            'pair'      => esc_url_raw(rest_url('sml-voice/v1/rtmp/pair')),
            'isAdmin'   => current_user_can('manage_options'),
            'nonce'     => wp_create_nonce('wp_rest'),
        );

        echo '<style>'
           . '.sc-box{background:#0b131f;border:1px solid #182130;border-radius:14px;padding:20px;margin-top:16px}'
           . '.sc-box h3{margin:0 0 4px;font-size:16px;font-weight:700}'
           . '.sc-box p.sub{margin:0 0 15px;font-size:13px;color:#8798ac;line-height:1.6}'
           . '.sc-pick{display:flex;gap:9px;margin-bottom:16px}'
           . '.sc-pick button{flex:1;height:76px;border-radius:11px;border:1px solid #223146;background:#0d1622;'
           . 'color:#a9b8ca;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;'
           . 'align-items:center;justify-content:center;gap:5px}'
           . '.sc-pick button.on{border-color:#2b6cff;background:#132238;color:#fff}'
           . '.sc-pick b{font-size:19px;font-weight:800}'
           . '.sc-pick small{font-size:11px;color:#5d7189}'
           . '.sc-pick button.on small{color:#8fb4ff}'
           . '.sc-key{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:9px;'
           . 'border:1px solid #1e2a3a;background:#0a1018;margin-bottom:7px;font-size:12.5px}'
           . '.sc-key i{font-style:normal;font-weight:800;color:#63a4ff;flex:0 0 52px}'
           . '.sc-key code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
           . 'font-family:ui-monospace,Menlo,Consolas,monospace;color:#c2cede}'
           . '.sc-key button{height:28px;padding:0 11px;border-radius:7px;border:1px solid #223146;'
           . 'background:#0d1622;color:#a9b8ca;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit}'
           . '.sc-key button:hover{color:#fff;border-color:#2b6cff}'
           . '.sc-note{font-size:12px;color:#5d7189;line-height:1.65;margin-top:11px}'
           . '.sc-diag{margin-top:14px;padding-top:14px;border-top:1px solid #16202e}'
           . '.sc-verdict{padding:11px 13px;border-radius:9px;font-size:12.5px;line-height:1.6;margin-bottom:10px}'
           . '.sc-verdict.bad{background:rgba(255,86,110,.08);border:1px solid rgba(255,86,110,.28);color:#ffb3bd}'
           . '.sc-verdict.good{background:rgba(34,217,122,.08);border:1px solid rgba(34,217,122,.28);color:#7ee8ae}'
           . '.sc-verdict.wait{background:rgba(224,163,54,.07);border:1px solid rgba(224,163,54,.26);color:#e6c98e}'
           . '.sc-verdict b{display:block;margin-bottom:3px;color:#fff}'
           . '.sc-act{height:38px;padding:0 17px;border-radius:9px;border:0;background:#2b6cff;color:#fff;'
           . 'font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-right:8px}'
           . '.sc-act.ghost{background:#0d1622;border:1px solid #223146;color:#c2cede}'
           . '.sc-row{display:flex;gap:14px;font-size:11.5px;color:#5d7189;padding:5px 0;'
           . 'border-bottom:1px solid #131c28;font-family:ui-monospace,Menlo,Consolas,monospace}'
           . '.sc-row:last-child{border-bottom:0}'
           . '.sc-row em{font-style:normal;font-weight:700;flex:0 0 84px}'
           . '.sc-row em.ok{color:#22d97a} .sc-row em.bad{color:#ff8a9b}'
           . '</style>';

        echo '<script>window.smlSlotCfg=' . wp_json_encode($config) . ';</script>';
        echo '<script>' . sml_slots_control_script() . '</script>';
    }
}

if (!function_exists('sml_slots_control_script')) {
    function sml_slots_control_script() {
        return <<<'SMLCTRLJS'
(function () {
  var cfg = window.smlSlotCfg;
  if (!cfg) { return; }

  var state = { count: 1, keys: [], loaded: false };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(opts) {
    opts = opts || {};
    return fetch(cfg.endpoint, {
      method: opts.json ? 'POST' : 'GET',
      credentials: 'same-origin', cache: 'no-store',
      headers: Object.assign({ 'Accept': 'application/json', 'X-WP-Nonce': cfg.nonce },
                             opts.json ? { 'Content-Type': 'application/json' } : {}),
      body: opts.json ? JSON.stringify(opts.json) : undefined
    }).then(function (r) { return r.json(); });
  }

  var LABELS = { 1: 'Just the stream', 2: 'Stream plus one', 3: 'Stream plus two' };

  function markup() {
    var html = '<div class="sc-box"><h3>Live video slots</h3>'
      + '<p class="sub">How many live videos viewers see. Slot 2 sits beside the main player, '
      + 'slot 3 goes under slot 2, and everything else on the page moves down.</p>'
      + '<div class="sc-pick">'
      + [1, 2, 3].map(function (n) {
          return '<button data-count="' + n + '" class="' + (state.count === n ? 'on' : '') + '">'
            + '<b>' + n + '</b><small>' + LABELS[n] + '</small></button>';
        }).join('')
      + '</div>';

    if (state.keys.length) {
      html += state.keys.map(function (k) {
        return '<div class="sc-key"><i>' + esc(k.label) + '</i>'
          + '<code data-key="' + esc(k.key) + '">' + esc(k.key) + '</code>'
          + '<button data-copy="' + esc(k.key) + '">Copy</button></div>';
      }).join('');
      html += '<div class="sc-note">Each slot is its own OBS output to the same server. '
        + 'They all share one key, so resetting it revokes every slot at once. '
        + 'A slot dropping mid-stream will not end your broadcast.</div>';
    }

    html += diagnostics();
    html += '</div>';
    return html;
  }

  function diagnostics() {
    if (!cfg.isAdmin) { return ''; }
    var d = state.diag;
    if (!d) { return '<div class="sc-diag"><div class="sc-note">Checking ingest connection…</div></div>'; }

    var tone = 'wait';
    if (d.attempts && d.attempts.length) {
      tone = (d.attempts[0].result === 'ok' || d.attempts[0].result === 'paired') ? 'good' : 'bad';
    }

    var html = '<div class="sc-diag">'
      + '<div class="sc-verdict ' + tone + '"><b>' + esc(d.verdict) + '</b>' + esc(d.fix) + '</div>';

    html += d.pairing_open
      ? '<button class="sc-act" data-pair="cancel">Pairing open — cancel</button>'
      : '<button class="sc-act" data-pair="start">Pair with ingest server</button>';
    html += '<button class="sc-act ghost" data-recheck>Re-check</button>';

    if (d.attempts && d.attempts.length) {
      html += '<div style="margin-top:12px">'
        + d.attempts.slice(0, 5).map(function (a) {
            var ok = (a.result === 'ok' || a.result === 'paired');
            return '<div class="sc-row"><em class="' + (ok ? 'ok' : 'bad') + '">' + esc(a.result) + '</em>'
              + '<span>' + esc(a.at.slice(5, 16)) + '</span>'
              + '<span>sent ' + esc(a.sent_prefix) + '… (' + a.sent_len + ')</span>'
              + '<span>stored ' + esc(a.stored_prefix) + '… (' + a.stored_len + ')</span></div>';
          }).join('')
        + '</div>';
    }

    return html + '</div>';
  }

  function loadDiag() {
    if (!cfg.isAdmin) { return Promise.resolve(); }
    return fetch(cfg.diagnose, { credentials: 'same-origin', cache: 'no-store',
                                headers: { 'X-WP-Nonce': cfg.nonce } })
      .then(function (r) { return r.json(); })
      .then(function (d) { state.diag = d; paint(); })
      .catch(function () {});
  }

  function paint() {
    var mount = document.getElementById('sc-root');
    if (mount) { mount.innerHTML = markup(); }
  }

  // The OBS panel repaints whenever its data reloads, which wipes whatever is
  // inside it. Rather than fight that, just repaint into the empty container.
  window.setInterval(function () {
    var mount = document.getElementById('sc-root');
    if (state.loaded && mount && !mount.firstChild) { paint(); }
  }, 500);

  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#sc-root')) { return; }
    var c = e.target.closest('[data-count]');
    if (c) {
      state.count = Number(c.getAttribute('data-count'));
      paint();
      api({ json: { count: state.count } }).then(function (d) {
        if (d && d.keys) { state.keys = d.keys; paint(); }
      });
      return;
    }
    var pr = e.target.closest('[data-pair]');
    if (pr) {
      var cancel = pr.getAttribute('data-pair') === 'cancel';
      fetch(cfg.pair, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        body: JSON.stringify({ cancel: cancel })
      }).then(function () { return loadDiag(); });
      return;
    }
    if (e.target.closest('[data-recheck]')) { loadDiag(); return; }

    var cp = e.target.closest('[data-copy]');
    if (cp) {
      var text = cp.getAttribute('data-copy');
      var done = function () {
        var was = cp.textContent;
        cp.textContent = 'Copied';
        window.setTimeout(function () { cp.textContent = was; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (err) {}
        document.body.removeChild(ta);
        done();
      }
    }
  });

  api().then(function (d) {
    if (d) { state.count = d.count || 1; state.keys = d.keys || []; }
    state.loaded = true;
    paint();
    loadDiag();
  });

  // While pairing is open, poll so the panel flips to "accepted" the moment
  // OBS connects, rather than making anyone hunt for a Re-check button.
  window.setInterval(function () {
    if (state.diag && state.diag.pairing_open) { loadDiag(); }
  }, 5000);
})();
SMLCTRLJS;
    }
}

/* ==================================================================
 * /live/{handle}/
 * ================================================================== */

if (!function_exists('sml_slots_intercept_page')) {
    function sml_slots_intercept_page() {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        $path = trim((string) wp_parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
        $parts = array_values(array_filter(explode('/', $path)));
        if (!$parts || $parts[0] !== 'live' || count($parts) > 2) {
            return;
        }
        $handle = isset($parts[1]) ? sanitize_title($parts[1]) : sml_slots_first_live_handle();
        if (!$handle) {
            return;
        }
        $user = get_user_by('slug', $handle);
        if (!$user) {
            return;
        }
        sml_slots_render_page($user);
    }
}
add_action('template_redirect', 'sml_slots_intercept_page', 0);

if (!function_exists('sml_slots_first_live_handle')) {
    function sml_slots_first_live_handle() {
        global $wpdb;
        $uid = $wpdb->get_var(
            "SELECT user_id FROM " . sml_rtmp_table() . "
              WHERE is_live = 1 AND status = 'active'
              ORDER BY live_started_at DESC LIMIT 1"
        );
        if (!$uid) {
            return '';
        }
        $user = get_userdata((int) $uid);
        return $user ? $user->user_nicename : '';
    }
}

if (!function_exists('sml_slots_render_page')) {
    function sml_slots_render_page($user) {
        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=' . get_bloginfo('charset'));

        $name = $user->display_name ?: $user->user_login;

        echo '<!doctype html><html ' . get_language_attributes() . '><head>';
        echo '<meta charset="' . esc_attr(get_bloginfo('charset')) . '">';
        echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
        echo '<title>' . esc_html($name) . ' live - ' . esc_html(get_bloginfo('name')) . '</title>';
        echo '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
        echo '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
        echo '<style>*,*::before,*::after{box-sizing:border-box}'
           . 'body{margin:0;background:#070c15;color:#e6edf5;'
           . 'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}'
           . 'a{color:inherit;text-decoration:none}'
           . '.lv-top{display:flex;align-items:center;gap:13px;padding:13px 22px;border-bottom:1px solid #141d2a;background:#080d17}'
           . '.lv-top b{font-size:16px;font-weight:800;letter-spacing:-.3px}'
           . '.lv-top b em{font-style:normal;color:#2b6cff}'
           . '.lv-who{margin-left:auto;font-size:13.5px;color:#8798ac}'
           . '.lv-who span{color:#e6edf5;font-weight:700}'
           . '.lv-body{max-width:1560px;margin:0 auto;padding:18px 22px 60px}'
           . '</style></head><body>';

        echo '<header class="lv-top"><a href="' . esc_url(home_url('/')) . '">';
        echo '<svg width="28" height="28" viewBox="0 0 40 40" fill="none" style="display:block"><circle cx="20" cy="20" r="18" stroke="#2b6cff" stroke-width="2.4"/><path d="M11 25.5l5.4-6.2 4 3.6 7.4-9" stroke="#2b6cff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a>';
        echo '<b>StockMarket<em>Loop</em></b>';
        echo '<div class="lv-who">Watching <span>' . esc_html($name) . '</span></div></header>';

        echo '<div class="lv-body">' . sml_slots_render($user->user_nicename);

        // Game Panel under the stream, same slot as on the watch page.
        if (function_exists('sml_game_panel_markup')) {
            echo sml_game_panel_markup('live', $user->user_nicename);
            echo sml_game_panel_assets();
        }
        echo '</div>';
        echo '</body></html>';
        exit;
    }
}
