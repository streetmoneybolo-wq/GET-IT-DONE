<?php
/**
 * Game Panel: renders below the description / details + comments module on
 * the watch page and on /live/{handle}/.
 *
 * Load order matters. The markup ships with the page but the panel does no
 * network work until requestIdleCallback fires or the viewer opens it, so a
 * cold stream start is never waiting on a lobby fetch.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_game_panel_styles')) {
    function sml_game_panel_styles() {
        return <<<'SMLGPCSS'
.gp-wrap{margin-top:16px;background:#0b131f;border:1px solid #182130;border-radius:14px;overflow:hidden}
.gp-head{display:flex;align-items:center;gap:12px;padding:15px 18px;cursor:pointer;user-select:none}
.gp-head:hover{background:#0d1725}
.gp-head svg{flex:0 0 auto;color:#2b6cff}
.gp-title{font-size:15px;font-weight:800;letter-spacing:-.2px}
.gp-sub{font-size:12.5px;color:#7b8ca1;margin-left:2px}
.gp-badge{margin-left:auto;display:flex;align-items:center;gap:9px}
.gp-pill{font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:99px;background:#132238;color:#63a4ff;border:1px solid #1e3352}
.gp-chev{transition:transform .18s ease;color:#7b8ca1}
.gp-wrap[data-open="1"] .gp-chev{transform:rotate(180deg)}
.gp-body{display:none;border-top:1px solid #16202e;padding:16px 18px 20px}
.gp-wrap[data-open="1"] .gp-body{display:block}

.gp-games{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:11px;margin-bottom:18px}
.gp-game{background:#0d1725;border:1px solid #1e2a3a;border-radius:12px;padding:13px 14px;text-align:left;color:#e6edf5;cursor:pointer;transition:border-color .15s,transform .1s}
.gp-game:hover{border-color:#2b6cff;transform:translateY(-1px)}
.gp-game b{display:block;font-size:14px;font-weight:700;margin-bottom:4px}
.gp-game span{display:block;font-size:12px;color:#7b8ca1;line-height:1.5}
.gp-game em{display:block;font-style:normal;font-size:11.5px;color:#4f9d5f;font-weight:700;margin-top:7px}

.gp-sect{font-size:12px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#7b8ca1;margin:0 0 10px}
.gp-tables{display:flex;flex-direction:column;gap:9px}
.gp-table{display:flex;align-items:center;gap:11px;background:#0d1725;border:1px solid #1e2a3a;border-radius:11px;padding:11px 13px}
.gp-table img{width:30px;height:30px;border-radius:50%;object-fit:cover;border:1px solid #26364a}
.gp-table .gp-t-main{flex:1;min-width:0}
.gp-table .gp-t-main b{display:block;font-size:13.5px;font-weight:700}
.gp-table .gp-t-main span{display:block;font-size:12px;color:#7b8ca1;margin-top:2px}
.gp-btn{border:0;border-radius:9px;padding:8px 15px;font-size:12.5px;font-weight:700;cursor:pointer;background:#2b6cff;color:#fff;white-space:nowrap}
.gp-btn:hover{background:#1f5ae0}
.gp-btn[disabled]{opacity:.45;cursor:default}
.gp-btn.gp-ghost{background:#16202e;color:#c8d5e4;border:1px solid #26364a}
.gp-btn.gp-ghost:hover{background:#1c2838}
.gp-btn.gp-danger{background:#2a1620;color:#ff7b8a;border:1px solid #40202c}

.gp-empty{font-size:13px;color:#7b8ca1;padding:14px 0;text-align:center}
.gp-note{font-size:12.5px;color:#7b8ca1;margin-top:12px}
.gp-err{font-size:12.5px;color:#ff8f9c;margin-top:10px;min-height:16px}

/* ---- match view ---- */
.gp-match-top{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.gp-seat{display:flex;align-items:center;gap:8px;background:#0d1725;border:1px solid #1e2a3a;border-radius:99px;padding:5px 13px 5px 5px}
.gp-seat img{width:26px;height:26px;border-radius:50%;object-fit:cover}
.gp-seat b{font-size:12.5px;font-weight:700}
.gp-seat.gp-active{border-color:#2b6cff;box-shadow:0 0 0 1px #2b6cff inset}
.gp-vs{font-size:11.5px;font-weight:800;color:#4a5b70;letter-spacing:1px}
.gp-status{margin-left:auto;font-size:13px;font-weight:700;color:#63a4ff}
.gp-status.gp-win{color:#4f9d5f}
.gp-status.gp-lose{color:#ff7b8a}

.gp-board-wrap{display:flex;justify-content:center;padding:6px 0 14px}
.gp-board{display:grid;gap:6px;touch-action:manipulation}
.gp-cell{background:#0d1725;border:1px solid #1e2a3a;border-radius:9px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:background .12s,border-color .12s}
.gp-cell:hover:not([disabled]){border-color:#2b6cff}
.gp-cell[disabled]{cursor:default}
.gp-cell.gp-hit{border-color:#4f9d5f;background:#12251a}
.gp-mark{font-weight:800;line-height:1}
.gp-mark.gp-p1{color:#63a4ff}
.gp-mark.gp-p2{color:#ffb454}

/* tic-tac-toe */
.gp-board.gp-ttt{grid-template-columns:repeat(3,72px);grid-auto-rows:72px}
.gp-board.gp-ttt .gp-mark{font-size:34px}

/* connect four */
.gp-board.gp-c4{grid-template-columns:repeat(7,46px);grid-auto-rows:46px;background:#101c2e;padding:8px;border-radius:12px}
.gp-board.gp-c4 .gp-cell{border-radius:50%}
.gp-board.gp-c4 .gp-disc{width:28px;height:28px;border-radius:50%}
.gp-disc.gp-p1{background:#2b6cff}
.gp-disc.gp-p2{background:#ffb454}

/* checkers */
.gp-board.gp-ck{grid-template-columns:repeat(8,44px);grid-auto-rows:44px;gap:0;border:2px solid #1e2a3a;border-radius:10px;overflow:hidden}
.gp-board.gp-ck .gp-cell{border:0;border-radius:0}
.gp-sq-light{background:#1b2739}
.gp-sq-dark{background:#0d1725}
.gp-board.gp-ck .gp-cell.gp-sel{box-shadow:0 0 0 3px #2b6cff inset}
.gp-board.gp-ck .gp-cell.gp-hint{box-shadow:0 0 0 3px #4f9d5f inset}
.gp-pc{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800}
.gp-pc.gp-p1{background:#2b6cff;color:#fff}
.gp-pc.gp-p2{background:#ffb454;color:#241503}

/* chess */
.gp-board.gp-ch{grid-template-columns:repeat(8,52px);grid-auto-rows:52px;gap:0;border:2px solid #1e2a3a;border-radius:10px;overflow:hidden}
.gp-board.gp-ch .gp-cell{border:0;border-radius:0;font-size:34px;line-height:1}
.gp-board.gp-ch .gp-cell.gp-sel{box-shadow:0 0 0 3px #2b6cff inset}
.gp-board.gp-ch .gp-cell.gp-hint{box-shadow:0 0 0 3px rgba(79,157,95,.85) inset}
.gp-board.gp-ch .gp-cell.gp-last{background:#1d2b1f}
.gp-board.gp-ch .gp-cell.gp-danger{box-shadow:0 0 0 3px #c4384a inset}
.gp-ch-w{color:#f2f6fb;text-shadow:0 1px 2px rgba(0,0,0,.7)}
.gp-ch-b{color:#1b2330;text-shadow:0 1px 0 rgba(255,255,255,.25)}
.gp-promo{display:flex;gap:8px;align-items:center;justify-content:center;padding:8px 0}
.gp-promo button{width:44px;height:44px;font-size:26px;background:#0d1725;border:1px solid #2b6cff;border-radius:9px;color:#e6edf5;cursor:pointer}

/* cards */
.gp-hand{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:10px 0}
.gp-card{min-width:42px;height:60px;border-radius:8px;background:#f4f7fb;color:#101a28;border:1px solid #c7d3e0;
    font-size:15px;font-weight:800;display:flex;flex-direction:column;align-items:center;justify-content:center;
    cursor:pointer;padding:0 6px;line-height:1.1}
.gp-card:hover:not([disabled]){transform:translateY(-3px)}
.gp-card[disabled]{opacity:.4;cursor:default}
.gp-card.gp-red{color:#c02638}
.gp-card.gp-back{background:linear-gradient(135deg,#1c3358,#122036);border-color:#254069;color:transparent}
.gp-trick{display:flex;gap:10px;justify-content:center;align-items:center;min-height:74px;padding:8px 0}
.gp-trick .gp-slot{text-align:center;font-size:11px;color:#7b8ca1}
.gp-bids{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px 0}
.gp-bids button{min-width:38px;padding:8px 0;background:#0d1725;border:1px solid #1e2a3a;border-radius:8px;
    color:#e6edf5;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer}
.gp-bids button:hover{border-color:#2b6cff}
.gp-score{display:flex;gap:14px;justify-content:center;font-size:12.5px;color:#8798ac;padding:4px 0 10px}
.gp-score b{color:#e6edf5}
.gp-seats4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
.gp-seats4 .gp-seat{justify-content:flex-start;border-radius:10px}
.gp-dealer{text-align:center;padding:6px 0 2px;font-size:12px;font-weight:800;letter-spacing:.6px;
    text-transform:uppercase;color:#7b8ca1}
.gp-acts{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:8px 0}
.gp-chiprow{text-align:center;font-size:12.5px;color:#8798ac;padding-bottom:6px}
.gp-chiprow b{color:#ffb454}

/* stakes */
.gp-bank{display:flex;align-items:center;gap:9px;margin-bottom:14px;padding:10px 13px;
    background:#111a0c;border:1px solid #24361a;border-radius:11px;font-size:12.5px;color:#a9c095}
.gp-bank b{color:#ffb454;font-weight:800}
.gp-bank .gp-vault{margin-left:auto;color:#6f8560;font-size:11.5px}
.gp-stakes{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:0 0 16px}
.gp-stakes span.gp-lbl{font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#7b8ca1}
.gp-stakes button{min-width:46px;padding:7px 11px;background:#0d1725;border:1px solid #1e2a3a;
    border-radius:8px;color:#c8d5e4;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
.gp-stakes button[aria-pressed="true"]{background:#2b6cff;border-color:#2b6cff;color:#fff}
.gp-stakes button[disabled]{opacity:.35;cursor:default}
.gp-pot{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;
    background:#1d1706;border:1px solid #3d3210;color:#ffb454;font-size:11.5px;font-weight:800}
.gp-swing{font-size:13px;font-weight:800}
.gp-swing.up{color:#4f9d5f}
.gp-swing.down{color:#ff7b8a}
.gp-free{font-size:11.5px;color:#7b8ca1;font-weight:700}

.gp-match-foot{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
.gp-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#0d1725;border:1px solid #1e2a3a;border-radius:8px;padding:6px 11px;letter-spacing:2px;color:#63a4ff}

@media (max-width:640px){
  .gp-board.gp-ttt{grid-template-columns:repeat(3,60px);grid-auto-rows:60px}
  .gp-board.gp-c4{grid-template-columns:repeat(7,38px);grid-auto-rows:38px}
  .gp-board.gp-c4 .gp-disc{width:23px;height:23px}
  .gp-board.gp-ck{grid-template-columns:repeat(8,36px);grid-auto-rows:36px}
  .gp-pc{width:23px;height:23px;font-size:11px}
  .gp-games{grid-template-columns:1fr 1fr}
}
SMLGPCSS;
    }
}

if (!function_exists('sml_game_panel_markup')) {
    function sml_game_panel_markup($context, $context_id) {
        $config = array(
            'base'      => esc_url_raw(rest_url(sml_game_ns())),
            'nonce'     => wp_create_nonce('wp_rest'),
            'context'   => sanitize_key($context),
            'contextId' => (string) $context_id,
            'loggedIn'  => is_user_logged_in(),
            'loginUrl'  => add_query_arg('redirect_to', rawurlencode(home_url(add_query_arg(array()))), home_url('/sign-up-sign-in/')),
            'userId'    => get_current_user_id(),
        );

        $html  = '<section class="gp-wrap" data-open="0" id="sml-game-panel">';
        $html .= '<div class="gp-head" data-gp="toggle" role="button" tabindex="0" aria-expanded="false">';
        $html .= '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">'
               . '<rect x="2.5" y="6.5" width="19" height="11" rx="3.5"/><path d="M7 10v4M5 12h4" stroke-linecap="round"/>'
               . '<circle cx="16" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="18.4" cy="13.6" r="1.1" fill="currentColor" stroke="none"/></svg>';
        $html .= '<div><div class="gp-title">Play a Game</div>';
        $html .= '<div class="gp-sub">Head-to-head while you watch. Your stream keeps running.</div></div>';
        $html .= '<div class="gp-badge"><span class="gp-pill" data-gp="count" hidden>0 live</span>';
        $html .= '<svg class="gp-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"/></svg></div></div>';
        $html .= '<div class="gp-body" data-gp="body"><div class="gp-empty">Loading games...</div></div>';
        $html .= '</section>';

        $html .= '<script>window.smlGameCfg=' . wp_json_encode($config) . ';</script>';
        return $html;
    }
}

if (!function_exists('sml_game_panel_script')) {
    function sml_game_panel_script() {
        return <<<'SMLGPJS'
(function () {
  var cfg = window.smlGameCfg;
  var wrap = document.getElementById('sml-game-panel');
  if (!cfg || !wrap) { return; }

  var body = wrap.querySelector('[data-gp="body"]');
  var head = wrap.querySelector('[data-gp="toggle"]');
  var pill = wrap.querySelector('[data-gp="count"]');

  var view = 'lobby';      // 'lobby' | 'match'
  var current = null;      // active table object
  var lobby = { tables: [], catalogue: [], scores: {}, you: null };
  var timer = null;
  var selected = -1;       // checkers: selected origin square
  var err = '';
  var busy = false;
  var stake = readStake();

  function readStake() {
    try {
      var v = parseInt(window.localStorage.getItem('smlGameStake'), 10);
      if (v >= 0) { return v; }
    } catch (e) {}
    return 10;
  }
  function saveStake(v) {
    try { window.localStorage.setItem('smlGameStake', String(v)); } catch (e) {}
  }
  function fmt(n) { return Number(n || 0).toLocaleString(); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { 'X-WP-Nonce': cfg.nonce }
    };
    if (opts.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(cfg.base + path, init).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) { throw new Error((j && j.message) || 'Something went wrong.'); }
        return j;
      });
    });
  }

  /* ---------------- polling ----------------
     Transport shim. Everything above this line talks to pump(); replacing
     polling with a WebSocket means rewriting pump() alone. */
  function pump() {
    stop();
    if (document.hidden) { return; }
    var every = view === 'match' ? 1500 : 6000;
    timer = setInterval(tick, every);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  function tick() {
    if (busy) { return; }
    if (view === 'match' && current) {
      api('/tables/' + current.id + '?since=' + current.version)
        .then(function (res) {
          if (res.unchanged) { return; }
          if (res.table) { current = res.table; render(); }
        })
        .catch(function () {});
      return;
    }
    loadLobby();
  }

  function loadLobby() {
    var q = '?context=' + encodeURIComponent(cfg.context)
          + '&context_id=' + encodeURIComponent(cfg.contextId);
    return api('/lobby' + q).then(function (res) {
      lobby = res;
      // If we are seated at something already in play, jump straight in.
      if (view === 'lobby') {
        for (var i = 0; i < res.tables.length; i++) {
          if (res.tables[i].yourSeat > 0 && res.tables[i].status === 'playing') {
            current = res.tables[i];
            view = 'match';
            pump();
            break;
          }
        }
      }
      paintCount();
      render();
    }).catch(function () {});
  }

  function paintCount() {
    var n = (lobby.tables || []).length;
    if (!pill) { return; }
    pill.hidden = n === 0;
    pill.textContent = n + (n === 1 ? ' table' : ' tables');
  }

  /* ---------------- actions ---------------- */
  function guard() {
    if (cfg.loggedIn) { return true; }
    err = 'Sign in to play.';
    render();
    return false;
  }

  function act(promise) {
    busy = true;
    err = '';
    render();
    return promise
      .then(function (res) {
        if (res && res.table) { current = res.table; view = 'match'; selected = -1; }
        busy = false;
        render();
        pump();
        refreshBank();
      })
      .catch(function (e) {
        busy = false;
        err = e.message || 'That did not work.';
        render();
      });
  }

  function quickPlay(game) {
    if (!guard()) { return; }
    act(api('/matchmake', { method: 'POST', body: {
      game: game, context: cfg.context, context_id: cfg.contextId, stake: stake
    }}));
  }

  function joinTable(id) {
    if (!guard()) { return; }
    act(api('/tables/' + id + '/join', { method: 'POST', body: {} }));
  }

  function watchTable(id) {
    api('/tables/' + id).then(function (res) {
      if (res.table) { current = res.table; view = 'match'; render(); pump(); }
    }).catch(function () {});
  }

  function leaveMatch() {
    if (!current) { backToLobby(); return; }
    if (current.yourSeat === 0) { backToLobby(); return; }
    var live = current.status === 'playing';
    if (live && !window.confirm('Leaving forfeits the match. Sure?')) { return; }
    api('/tables/' + current.id + '/leave', { method: 'POST', body: {} })
      .then(backToLobby).catch(backToLobby);
  }

  function refreshBank() {
    // Balance moves whenever a stake is escrowed or a pot lands, so re-read it
    // rather than trusting whatever the last lobby payload said.
    api('/lobby?context=' + encodeURIComponent(cfg.context)
        + '&context_id=' + encodeURIComponent(cfg.contextId))
      .then(function (res) { lobby.bank = res.bank; render(); })
      .catch(function () {});
  }

  function backToLobby() {
    view = 'lobby';
    current = null;
    selected = -1;
    promoPending = null;
    err = '';
    loadLobby();
    pump();
  }

  function sendMove(move) {
    if (!current || !current.yourTurn || busy) { return; }
    busy = true;
    err = '';
    api('/tables/' + current.id + '/move', {
      method: 'POST',
      body: { move: move, version: current.version }
    }).then(function (res) {
      busy = false;
      if (res.table) { current = res.table; }
      selected = -1;
      promoPending = null;
      render();
      if (res.table && (res.table.status === 'finished'
          || (res.table.state && res.table.state.phase === 'settled'))) {
        refreshBank();
      }
    }).catch(function (e) {
      busy = false;
      err = e.message || 'Illegal move.';
      // The server is the authority. Whatever it says the board is, take it.
      api('/tables/' + current.id).then(function (res) {
        if (res.table) { current = res.table; }
        render();
      }).catch(function () { render(); });
    });
  }

  /* ---------------- render: lobby ---------------- */
  function lockHtml(g, earn) {
    var pct = g.need > 0 ? Math.min(100, Math.round((g.have / g.need) * 100)) : 100;
    var h = '<div class="lbg-lock"><div class="lbg-head">'
      + '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">'
      + '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/>'
      + '<path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" stroke-linecap="round"/></svg>'
      + '<b>' + esc(g.label) + '</b></div>'
      + '<p class="lbg-why">' + esc(g.why) + '</p>'
      + '<div class="lbg-bar"><i style="width:' + pct + '%"></i></div>'
      + '<div class="lbg-nums"><span><b>' + fmt(g.have) + '</b> of ' + fmt(g.need) + ' LB</span>'
      + '<span>' + fmt(g.short) + ' to go</span></div>';
    if (earn && earn.ways && earn.ways.length) {
      h += '<div class="lbg-ways"><span class="lbg-lbl">Fastest ways to earn</span><ul>';
      earn.ways.slice(0, 5).forEach(function (w) {
        h += '<li><span>' + esc(w.label) + '</span><b>+' + w.amount + '</b></li>';
      });
      h += '</ul></div>';
    }
    return h + '</div>';
  }

  function renderLobby() {
    var h = '';
    var bank = lobby.bank || {};
    var gate = (lobby.gate && lobby.gate.games) || null;

    if (!cfg.loggedIn) {
      return '<div class="gp-empty"><a href="' + esc(cfg.loginUrl)
        + '" style="color:#63a4ff;font-weight:700">Sign in</a> to play.</div>';
    }
    if (gate && !gate.open) {
      // Locked. Show the catalogue anyway so people know what they are
      // working toward, but with nothing clickable.
      h += lockHtml(gate, lobby.earn);
      h += '<div class="gp-sect" style="margin-top:18px">Waiting for you</div>';
      h += '<div class="gp-games">';
      (lobby.catalogue || []).forEach(function (g) {
        h += '<div class="gp-game" style="opacity:.5;cursor:default">'
           + '<b>' + esc(g.label) + '</b><span>' + esc(g.blurb) + '</span></div>';
      });
      return h + '</div>';
    }

    if (cfg.loggedIn) {
      h += '<div class="gp-bank"><span>Your balance</span>'
         + '<b>' + fmt(bank.balance) + ' LB</b>'
         + (bank.rank ? '<span class="gp-free">&middot; rank #' + bank.rank + '</span>' : '')
         + '<span class="gp-vault">Vault ' + fmt(bank.vault) + ' of '
         + fmt(bank.supply) + ' LB</span></div>';
    }

    if (!bank.wagering) {
      h += '<div class="gp-stakes"><span class="gp-free">'
         + 'Every game is free to play. Nothing is staked and nothing is lost.'
         + '</span></div>';
      stake = 0;
    }
    if (bank.wagering) {
      h += '<div class="gp-stakes"><span class="gp-lbl">Stake</span>';
      (bank.steps || [10, 25, 50, 100]).forEach(function (v) {
        var afford = !cfg.loggedIn || (bank.balance | 0) >= v;
        h += '<button data-stake="' + v + '" aria-pressed="' + (stake === v ? 'true' : 'false') + '"'
           + (afford ? '' : ' disabled title="Not enough Loop Bucks"') + '>' + v + '</button>';
      });
      h += '<button data-stake="0" aria-pressed="' + (stake === 0 ? 'true' : 'false') + '">Free</button>';
      h += '<span class="gp-free">' + (stake > 0
            ? 'Winner takes the pot. No cut taken.'
            : 'Practice table, nothing staked.') + '</span></div>';
    }

    h += '<div class="gp-games">';
    (lobby.catalogue || []).forEach(function (g) {
      var s = (lobby.scores || {})[g.key];
      h += '<button class="gp-game" data-play="' + esc(g.key) + '">'
         + '<b>' + esc(g.label) + '</b><span>' + esc(g.blurb) + '</span>'
         + (s ? '<em>' + s.wins + 'W &middot; ' + s.points + ' pts'
               + (s.streak > 1 ? ' &middot; ' + s.streak + ' streak' : '') + '</em>' : '')
         + '</button>';
    });
    h += '</div>';

    h += '<div class="gp-sect">Open Tables</div><div class="gp-tables">';
    var tables = lobby.tables || [];
    if (!tables.length) {
      h += '<div class="gp-empty">No tables yet. Pick a game above and one opens for you.</div>';
    }
    tables.forEach(function (t) {
      var host = t.players[1] || t.players['1'];
      var guest = t.players[2] || t.players['2'];
      var who = host ? host.name : 'Someone';
      var seated = 0, total = t.seatCount || 2;
      for (var n = 1; n <= total; n++) { if (t.players[n] || t.players[String(n)]) { seated++; } }
      var line = t.status === 'waiting'
        ? 'Waiting for players (' + seated + '/' + total + ')'
        : (total > 2 ? seated + ' players, in progress'
                     : who + ' vs ' + (guest ? guest.name : '?'));
      var w = t.wager || {};
      h += '<div class="gp-table">'
         + '<img src="' + esc(host ? host.avatar : '') + '" alt="">'
         + '<div class="gp-t-main"><b>' + esc(t.label) + '</b><span>' + esc(line) + '</span></div>'
         + (w.stake > 0
            ? '<span class="gp-pot">' + w.stake + ' LB &middot; pot ' + w.pot + '</span>'
            : '<span class="gp-free">FREE</span>');
      if (t.yourSeat > 0) {
        h += '<button class="gp-btn" data-resume="' + t.id + '">Resume</button>';
      } else if (t.status === 'waiting') {
        h += '<button class="gp-btn" data-join="' + t.id + '">Join</button>';
      } else {
        h += '<button class="gp-btn gp-ghost" data-watch="' + t.id + '">Spectate</button>';
      }
      h += '</div>';
    });
    h += '</div>';

    if (!cfg.loggedIn) {
      h += '<div class="gp-note"><a href="' + esc(cfg.loginUrl) + '" style="color:#63a4ff;font-weight:700">Sign in</a> to take a seat. You can spectate without an account.</div>';
    }
    h += '<div class="gp-err">' + esc(err) + '</div>';
    return h;
  }

  /* ---------------- render: boards ---------------- */
  function boardTTT(t) {
    var b = (t.state && t.state.board) || [];
    var marks = { 1: 'X', 2: 'O' };
    var h = '<div class="gp-board gp-ttt">';
    for (var i = 0; i < 9; i++) {
      var v = b[i] | 0;
      var can = t.yourTurn && !v;
      h += '<button class="gp-cell" data-cell="' + i + '"' + (can ? '' : ' disabled') + '>'
         + (v ? '<span class="gp-mark gp-p' + v + '">' + marks[v] + '</span>' : '')
         + '</button>';
    }
    return h + '</div>';
  }

  function boardC4(t) {
    var b = (t.state && t.state.board) || [];
    var h = '<div class="gp-board gp-c4">';
    for (var r = 0; r < 6; r++) {
      for (var c = 0; c < 7; c++) {
        var v = b[(r * 7) + c] | 0;
        var colFull = (b[c] | 0) !== 0;
        var can = t.yourTurn && !colFull;
        h += '<button class="gp-cell" data-col="' + c + '"' + (can ? '' : ' disabled') + '>'
           + (v ? '<span class="gp-disc gp-p' + v + '"></span>' : '')
           + '</button>';
      }
    }
    return h + '</div>';
  }

  function boardCK(t) {
    var b = (t.state && t.state.board) || [];
    var kings = (t.state && t.state.kings) || [];
    var h = '<div class="gp-board gp-ck">';
    for (var i = 0; i < 64; i++) {
      var row = Math.floor(i / 8), col = i % 8;
      var dark = ((row + col) % 2) === 1;
      var v = b[i] | 0;
      var mine = t.yourTurn && v === t.yourSeat;
      var target = t.yourTurn && selected >= 0 && !v && dark;
      var cls = 'gp-cell ' + (dark ? 'gp-sq-dark' : 'gp-sq-light');
      if (i === selected) { cls += ' gp-sel'; }
      else if (target) { cls += ' gp-hint'; }
      var can = mine || target;
      h += '<button class="' + cls + '" data-sq="' + i + '"' + (can ? '' : ' disabled') + '>'
         + (v ? '<span class="gp-pc gp-p' + v + '">' + (kings.indexOf(i) >= 0 ? 'K' : '') + '</span>' : '')
         + '</button>';
    }
    return h + '</div>';
  }

  /* ---------------- chess ---------------- */
  var GLYPH = { K:'\u265A', Q:'\u265B', R:'\u265C', B:'\u265D', N:'\u265E', P:'\u265F' };
  var promoPending = null;

  function boardCH(t) {
    var b = (t.state && t.state.board) || [];
    var last = (t.state && t.state.last) || [];
    var flip = t.yourSeat === 2;
    var mine = t.yourSeat === 1 ? 'w' : 'b';
    var h = '<div class="gp-board gp-ch">';
    for (var v = 0; v < 64; v++) {
      var i = flip ? 63 - v : v;
      var row = Math.floor(i / 8), col = i % 8;
      var lightSq = ((row + col) % 2) === 0;
      var piece = b[i] || '';
      var cls = 'gp-cell ' + (lightSq ? 'gp-sq-light' : 'gp-sq-dark');
      if (last.length === 2 && (i === last[0] || i === last[1])) { cls += ' gp-last'; }
      if (i === selected) { cls += ' gp-sel'; }
      if (t.state && t.state.check && piece === mine + 'K') { cls += ' gp-danger'; }
      var isMine = piece && piece.charAt(0) === mine;
      // Any empty or enemy square is offerable once a piece is picked up; the
      // server is the one that decides whether the move is actually legal.
      var can = t.yourTurn && (isMine || selected >= 0);
      h += '<button class="' + cls + '" data-ch="' + i + '"' + (can ? '' : ' disabled') + '>'
         + (piece ? '<span class="' + (piece.charAt(0) === 'w' ? 'gp-ch-w' : 'gp-ch-b') + '">'
                    + GLYPH[piece.charAt(1)] + '</span>' : '')
         + '</button>';
    }
    h += '</div>';
    if (promoPending) {
      h += '<div class="gp-promo"><span class="gp-sub">Promote to</span>';
      ['Q','R','B','N'].forEach(function (p) {
        h += '<button data-promo="' + p + '">' + GLYPH[p] + '</button>';
      });
      h += '</div>';
    }
    return h;
  }

  function isPromotion(t, from, to) {
    var b = (t.state && t.state.board) || [];
    var piece = b[from] || '';
    if (piece.charAt(1) !== 'P') { return false; }
    var toRow = Math.floor(to / 8);
    return (piece.charAt(0) === 'w' && toRow === 0) || (piece.charAt(0) === 'b' && toRow === 7);
  }

  /* ---------------- cards ---------------- */
  var SUIT = { S:'\u2660', H:'\u2665', D:'\u2666', C:'\u2663' };

  function cardFace(card) {
    var rank = card.slice(0, -1);
    var suit = card.slice(-1);
    if (rank === 'T') { rank = '10'; }
    var red = suit === 'H' || suit === 'D';
    return { rank: rank, suit: SUIT[suit] || suit, red: red };
  }

  function cardHtml(card, attrs, disabled) {
    var f = cardFace(card);
    return '<button class="gp-card' + (f.red ? ' gp-red' : '') + '" ' + (attrs || '')
      + (disabled ? ' disabled' : '') + '><span>' + f.rank + '</span><span>' + f.suit + '</span></button>';
  }

  function faceDown(n) {
    var h = '';
    for (var i = 0; i < n; i++) { h += '<span class="gp-card gp-back">x</span>'; }
    return h;
  }

  /* ---------------- spades ---------------- */
  function boardSpades(t) {
    var st = t.state || {};
    var h = '';

    h += '<div class="gp-score">'
       + '<span>Us (seats 1 &amp; 3) <b>' + ((st.scores && st.scores.A) | 0) + '</b>'
       + ' <span class="gp-sub">' + ((st.bags && st.bags.A) | 0) + ' bags</span></span>'
       + '<span>Them (2 &amp; 4) <b>' + ((st.scores && st.scores.B) | 0) + '</b>'
       + ' <span class="gp-sub">' + ((st.bags && st.bags.B) | 0) + ' bags</span></span>'
       + '<span>Hand <b>' + ((st.hand) | 0) + '</b></span></div>';

    if (st.phase === 'bidding') {
      var bids = st.bids || {};
      var made = [];
      [1,2,3,4].forEach(function (n) {
        if (bids[n] !== undefined) {
          var p = t.players[n] || t.players[String(n)];
          made.push((p ? p.name : 'Seat ' + n) + ': ' + (bids[n] === 0 ? 'nil' : bids[n]));
        }
      });
      if (made.length) { h += '<div class="gp-score"><span>' + esc(made.join('  |  ')) + '</span></div>'; }
      if (t.yourTurn) {
        h += '<div class="gp-sect" style="text-align:center">How many tricks?</div><div class="gp-bids">';
        for (var b = 0; b <= 13; b++) {
          h += '<button data-bid="' + b + '">' + (b === 0 ? 'Nil' : b) + '</button>';
        }
        h += '</div>';
      }
    } else {
      var trick = st.trick || {};
      h += '<div class="gp-trick">';
      var any = false;
      [1,2,3,4].forEach(function (n) {
        if (!trick[n]) { return; }
        any = true;
        var p = t.players[n] || t.players[String(n)];
        h += '<div><div>' + cardHtml(trick[n], '', true) + '</div>'
           + '<div class="gp-slot">' + esc(p ? p.name.split(' ')[0] : 'Seat ' + n) + '</div></div>';
      });
      if (!any) {
        var lt = st.lastTrick;
        h += lt && lt.winner
          ? '<div class="gp-slot">Last trick taken by seat ' + lt.winner + '</div>'
          : '<div class="gp-slot">Lead a card</div>';
      }
      h += '</div>';

      var won = st.won || {};
      var bidsP = st.bids || {};
      var tally = [1,2,3,4].map(function (n) {
        return 'S' + n + ' ' + ((won[n]) | 0) + '/' + (bidsP[n] === 0 ? 'nil' : (bidsP[n] | 0));
      }).join('   ');
      h += '<div class="gp-score"><span>' + esc(tally) + '</span></div>';
    }

    var hand = (st.hand_cards) || [];
    if (hand.length) {
      h += '<div class="gp-hand">';
      hand.forEach(function (c) {
        h += cardHtml(c, 'data-card="' + esc(c) + '"', !(t.yourTurn && st.phase === 'playing'));
      });
      h += '</div>';
    } else if (t.spectating) {
      h += '<div class="gp-empty">Hands are hidden from spectators.</div>';
    }
    return h;
  }

  /* ---------------- blackjack ---------------- */
  function boardBJ(t) {
    var st = t.state || {};
    var d = st.dealer || { cards: [] };
    var h = '<div class="gp-dealer">Dealer' + (d.down ? '' : ' &middot; ' + (d.total | 0)) + '</div>';
    h += '<div class="gp-hand">';
    (d.cards || []).forEach(function (c) { h += cardHtml(c, '', true); });
    if (d.down) { h += faceDown(1); }
    h += '</div>';

    var order = st.order || [];
    order.forEach(function (seat) {
      var pl = (st.players || {})[seat] || (st.players || {})[String(seat)];
      if (!pl) { return; }
      var who = t.players[seat] || t.players[String(seat)];
      var isYou = Number(seat) === t.yourSeat;
      h += '<div class="gp-dealer" style="text-transform:none;letter-spacing:0">'
         + esc(who ? who.name : 'Seat ' + seat) + (isYou ? ' (you)' : '')
         + ' &middot; <span style="color:#ffb454">' + (pl.chips | 0) + ' chips</span></div>';
      (pl.hands || []).forEach(function (hand, i) {
        var total = 0;
        h += '<div class="gp-hand">';
        (hand.cards || []).forEach(function (c) { h += cardHtml(c, '', true); });
        total = bjTotal(hand.cards || []);
        h += '<div class="gp-slot" style="align-self:center;padding-left:8px">' + total
           + (hand.result ? ' &middot; ' + esc(hand.result) : '')
           + (hand.payout ? ' (' + (hand.payout > 0 ? '+' : '') + hand.payout + ')' : '')
           + '</div></div>';
      });
    });

    if (st.phase === 'player' && t.yourTurn) {
      var me = (st.players || {})[t.yourSeat] || (st.players || {})[String(t.yourSeat)];
      var hand = me && me.hands[me.active | 0];
      var two = hand && (hand.cards || []).length === 2;
      var pair = two && bjPairKey(hand.cards[0]) === bjPairKey(hand.cards[1]);
      h += '<div class="gp-acts">'
         + '<button class="gp-btn" data-bj="hit">Hit</button>'
         + '<button class="gp-btn gp-ghost" data-bj="stand">Stand</button>'
         + (two ? '<button class="gp-btn gp-ghost" data-bj="double">Double</button>' : '')
         + (pair && me.hands.length < 2 ? '<button class="gp-btn gp-ghost" data-bj="split">Split</button>' : '')
         + '</div>';
    }
    if (st.phase === 'settled') {
      h += '<div class="gp-acts"><button class="gp-btn" data-bj="again">Deal again</button></div>';
    }
    h += '<div class="gp-chiprow">Chips are for scorekeeping only &mdash; they have no cash value.</div>';
    return h;
  }

  function bjTotal(cards) {
    var total = 0, aces = 0;
    cards.forEach(function (c) {
      var r = c.slice(0, -1);
      if (r === 'A') { aces++; total += 11; }
      else if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') { total += 10; }
      else { total += parseInt(r, 10); }
    });
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  }
  function bjPairKey(c) {
    var r = c.slice(0, -1);
    return (r === 'J' || r === 'Q' || r === 'K') ? 'T' : r;
  }

  function statusLine(t) {
    if (t.status === 'waiting') {
      var seated = 0, total = t.seatCount || 2;
      for (var n = 1; n <= total; n++) { if (t.players[n] || t.players[String(n)]) { seated++; } }
      return { text: 'Waiting for players (' + seated + '/' + total + ')...', cls: '' };
    }
    if (t.status === 'finished') {
      if (t.winner === 0) { return { text: 'Draw.', cls: '' }; }
      if (t.yourSeat === 0) {
        var w = t.players[t.winner] || t.players[String(t.winner)];
        return { text: (w ? w.name : 'Player ' + t.winner) + ' wins.', cls: 'gp-win' };
      }
      return t.winner === t.yourSeat
        ? { text: 'You win. +3 points.', cls: 'gp-win' }
        : { text: 'You lost that one.', cls: 'gp-lose' };
    }
    if (t.status === 'abandoned') { return { text: 'Table closed.', cls: '' }; }
    if (t.yourSeat === 0) {
      var p = t.players[t.turn] || t.players[String(t.turn)];
      return { text: (p ? p.name : 'Player ' + t.turn) + ' to move', cls: '' };
    }
    return t.yourTurn
      ? { text: 'Your move', cls: '' }
      : { text: 'Waiting on your opponent...', cls: '' };
  }

  function seatChip(t, seat) {
    var p = t.players[seat] || t.players[String(seat)];
    var active = t.status === 'playing' && t.turn === seat;
    if (!p) {
      return '<div class="gp-seat"><b style="padding-left:8px;color:#7b8ca1">Open seat</b></div>';
    }
    return '<div class="gp-seat' + (active ? ' gp-active' : '') + '">'
         + '<img src="' + esc(p.avatar) + '" alt=""><b>' + esc(p.name) + '</b></div>';
  }

  function renderMatch() {
    var t = current;
    var st = statusLine(t);
    var seats = t.seatCount || 2;
    var h = '';

    if (seats > 2) {
      h += '<div class="gp-seats4">';
      for (var n = 1; n <= seats; n++) { h += seatChip(t, n); }
      h += '</div><div class="gp-match-top">'
         + '<span class="gp-status ' + st.cls + '" style="margin-left:0">' + esc(st.text) + '</span></div>';
    } else {
      h += '<div class="gp-match-top">'
         + seatChip(t, 1) + '<span class="gp-vs">VS</span>' + seatChip(t, 2)
         + '<span class="gp-status ' + st.cls + '">' + esc(st.text) + '</span></div>';
    }

    var w = t.wager || {};
    if (w.stake > 0) {
      var mySwing = t.swing && t.swing[t.yourSeat];
      h += '<div class="gp-match-top" style="margin-top:-4px">'
         + '<span class="gp-pot">Pot ' + fmt(w.pot) + ' LB</span>'
         + '<span class="gp-free">' + w.stake + ' LB each</span>';
      if (t.status === 'finished' && mySwing !== undefined && mySwing !== null) {
        h += '<span class="gp-swing ' + (mySwing >= 0 ? 'up' : 'down') + '" style="margin-left:auto">'
           + (mySwing > 0 ? '+' : '') + fmt(mySwing) + ' LB</span>';
      } else if (cfg.loggedIn) {
        h += '<span class="gp-free" style="margin-left:auto">Balance '
           + fmt((lobby.bank && lobby.bank.balance) || 0) + ' LB</span>';
      }
      h += '</div>';
    }

    h += '<div class="gp-board-wrap"><div>';
    if (t.game === 'tictactoe') { h += boardTTT(t); }
    else if (t.game === 'connect4') { h += boardC4(t); }
    else if (t.game === 'checkers') { h += boardCK(t); }
    else if (t.game === 'chess') { h += boardCH(t); }
    else if (t.game === 'spades') { h += boardSpades(t); }
    else if (t.game === 'blackjack') { h += boardBJ(t); }
    h += '</div></div>';

    h += '<div class="gp-match-foot">';
    if (t.canStart) {
      h += '<button class="gp-btn" data-start="1">Deal now</button>';
    }
    h += '<button class="gp-btn gp-ghost" data-back="1">Back to lobby</button>';
    if (t.yourSeat > 0 && (t.status === 'playing' || t.status === 'waiting')) {
      h += '<button class="gp-btn gp-danger" data-leave="1">'
         + (t.status === 'playing' ? 'Forfeit' : 'Close table') + '</button>';
    }
    if (t.joinCode) {
      h += '<span class="gp-code">' + esc(t.joinCode) + '</span>'
         + '<span class="gp-sub">Share this code for a private table</span>';
    }
    if (t.spectating) {
      h += '<span class="gp-sub">Spectating</span>';
    }
    h += '</div>';
    h += '<div class="gp-err">' + esc(err) + '</div>';
    return h;
  }

  function render() {
    if (wrap.getAttribute('data-open') !== '1') { return; }
    body.innerHTML = view === 'match' && current ? renderMatch() : renderLobby();
  }

  /* ---------------- events (delegated: markup is replaced wholesale) ------ */
  body.addEventListener('click', function (e) {
    var el = e.target.closest('[data-play],[data-join],[data-watch],[data-resume],[data-back],'
      + '[data-leave],[data-start],[data-stake],[data-cell],[data-col],[data-sq],[data-ch],'
      + '[data-promo],[data-bid],[data-card],[data-bj]');
    if (!el) { return; }

    if (el.hasAttribute('data-stake')) {
      stake = parseInt(el.getAttribute('data-stake'), 10);
      saveStake(stake);
      render();
      return;
    }
    if (el.hasAttribute('data-play')) { quickPlay(el.getAttribute('data-play')); return; }
    if (el.hasAttribute('data-join')) { joinTable(el.getAttribute('data-join')); return; }
    if (el.hasAttribute('data-watch')) { watchTable(el.getAttribute('data-watch')); return; }
    if (el.hasAttribute('data-resume')) { watchTable(el.getAttribute('data-resume')); return; }
    if (el.hasAttribute('data-back')) { backToLobby(); return; }
    if (el.hasAttribute('data-leave')) { leaveMatch(); return; }
    if (el.hasAttribute('data-start')) {
      act(api('/tables/' + current.id + '/start', { method: 'POST', body: {} }));
      return;
    }

    // Spades
    if (el.hasAttribute('data-bid')) {
      sendMove({ action: 'bid', bid: parseInt(el.getAttribute('data-bid'), 10) });
      return;
    }
    if (el.hasAttribute('data-card')) {
      sendMove({ action: 'play', card: el.getAttribute('data-card') });
      return;
    }

    // Blackjack
    if (el.hasAttribute('data-bj')) {
      sendMove({ action: el.getAttribute('data-bj') });
      return;
    }

    // Chess promotion picker
    if (el.hasAttribute('data-promo')) {
      var pick = promoPending;
      promoPending = null;
      if (pick) { sendMove({ from: pick.from, to: pick.to, promo: el.getAttribute('data-promo') }); }
      return;
    }

    // Chess board
    if (el.hasAttribute('data-ch')) {
      var sq = parseInt(el.getAttribute('data-ch'), 10);
      var cb = (current.state && current.state.board) || [];
      var myColour = current.yourSeat === 1 ? 'w' : 'b';
      var occupant = cb[sq] || '';
      if (occupant && occupant.charAt(0) === myColour) {
        selected = selected === sq ? -1 : sq;
        render();
      } else if (selected >= 0) {
        if (isPromotion(current, selected, sq)) {
          promoPending = { from: selected, to: sq };
          render();
        } else {
          sendMove({ from: selected, to: sq });
        }
      }
      return;
    }

    if (el.hasAttribute('data-cell')) { sendMove({ cell: parseInt(el.getAttribute('data-cell'), 10) }); return; }
    if (el.hasAttribute('data-col')) { sendMove({ col: parseInt(el.getAttribute('data-col'), 10) }); return; }

    if (el.hasAttribute('data-sq')) {
      var sq = parseInt(el.getAttribute('data-sq'), 10);
      var board = (current.state && current.state.board) || [];
      if ((board[sq] | 0) === current.yourSeat) {
        selected = selected === sq ? -1 : sq;
        render();
      } else if (selected >= 0) {
        sendMove({ from: selected, to: sq });
      }
    }
  });

  function toggle() {
    var open = wrap.getAttribute('data-open') === '1';
    wrap.setAttribute('data-open', open ? '0' : '1');
    head.setAttribute('aria-expanded', open ? 'false' : 'true');
    if (!open) {
      body.innerHTML = '<div class="gp-empty">Loading games...</div>';
      loadLobby();
      pump();
    } else {
      stop();
    }
  }
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stop(); }
    else if (wrap.getAttribute('data-open') === '1') { tick(); pump(); }
  });

  // Count badge only. Deliberately after the page settles so the video
  // element never competes with a lobby fetch for the connection pool.
  var warm = function () {
    loadLobby();
    setInterval(function () { if (wrap.getAttribute('data-open') !== '1') { loadLobby(); } }, 45000);
  };
  if (window.requestIdleCallback) { requestIdleCallback(warm, { timeout: 4000 }); }
  else { setTimeout(warm, 2500); }
})();
SMLGPJS;
    }
}

if (!function_exists('sml_game_panel_assets')) {
    /**
     * Style + script blob. Standalone pages exit before wp_footer, so callers
     * echo this themselves rather than relying on an enqueue.
     */
    function sml_game_panel_assets() {
        return '<style>' . sml_game_panel_styles()
             . (function_exists('sml_lb_lock_styles') ? sml_lb_lock_styles() : '') . '</style>'
             . '<script>' . sml_game_panel_script() . '</script>';
    }
}
