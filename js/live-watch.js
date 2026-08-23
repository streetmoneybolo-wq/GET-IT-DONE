/* SML Live Watch — Phase 1 shell controller (admin preview ?lw=1)
   Vanilla-JS recreation of the design prototype's behavior. SAMPLE DATA ONLY —
   every number here is design sample content shown under the preview banner.
   Phases 2+ replace the sims with sml-live / sml-live-chat / sml-lb / sml-voice /
   sml-games / sml-engage wiring per the build plan. */
(function () {
  'use strict';
  var root = document.getElementById('sml-lw-root');
  if (!root || root.__slwBooted) return;
  root.__slwBooted = true;
  /* re-parent to a direct <body> child so the takeover CSS can hide everything else */
  if (root.parentNode !== document.body) document.body.appendChild(root);
  document.body.classList.add('slw-on');
  /* ADMIN: set by the go-live snippet (window.SML_LW_ADMIN); under the old admin-only
     preview snippet the global is absent and every viewer IS an admin. */
  var ADMIN = (typeof window.SML_LW_ADMIN !== 'undefined') ? !!window.SML_LW_ADMIN : true;
  /* ?sim=1 keeps the full design demo (sample chat etc.) — admins only; default is real data.
     window.SML_LW_FORCE_SIM powers the standalone showcase artifact. */
  var SIM = (ADMIN && /[?&]sim=1/.test(location.search)) || !!window.SML_LW_FORCE_SIM;

  /* ---------- sample data (verbatim from the design handoff) ---------- */
  var ACCENTS = ['#00ff88', '#00ccff', '#ffb454', '#ff7a45', '#ff2e66'];
  var TAPE = [['SPY', 772.18, 0.42], ['QQQ', 486.31, 0.61], ['NVDA', 128.44, -1.12], ['AAPL', 231.09, 0.18], ['TSLA', 243.77, 2.04], ['MSFT', 421.55, -0.33], ['AMD', 152.18, 1.27], ['META', 528.42, 0.72], ['AMZN', 198.63, -0.21], ['GOOGL', 174.28, 0.44], ['VIX', 14.82, -3.11], ['DXY', 103.44, 0.09]];
  var SEED = [['MW', 'marketwatchdog', 'Holding above VWAP all session, 772.18 is the line I care about.'], ['TR', 'tapereader', 'Volume drying up into the print. Spread still a penny.'], ['LK', 'loopkick', 'Adds at 771.30 worked. Trailing under 770.56 now.'], ['QV', 'quantvega', 'Short volume near 45% of tape again — mostly hedging.'], ['SB', 'swingbias', 'Fading the gap unless we clear 773.33 on real size.'], ['AF', 'ateflows', 'Ray, can you pull up the 5m order flow again?'], ['DN', 'deltaneutral', 'IV crush after tomorrow, weeklies not worth it here.'], ['CR', 'coreranger', 'Watching 748.22 if this ever rolls over.']];
  var POOL = [['JT', 'jettape', 'CPI in 9 minutes, sizing down.'], ['VX', 'vixwhisper', 'Vol bid but not panicked. 14.8 handle.'], ['GM', 'gammagrind', 'Dealers long gamma above 775, expect the chop.'], ['LN', 'longonly', 'Just here for the read, thanks Ray.'], ['BK', 'breakoutkid', '773.33 gets tagged today, calling it now.'], ['MS', 'micro_scalp', 'Filled 20 lots at the bid. Free money.'], ['ND', 'nodrawdown', 'Stop moved to break even, sleeping fine.'], ['HZ', 'hedgezoo', 'Puts for the print, calls for the drift.'], ['OP', 'openprint', 'That was a 4M share block on the tape.'], ['RT', 'ratiotrader', 'QQQ leading again, watch the spread.']];
  var CHAPTERS = [['0:00', 'Pre-market read', 'OPEN'], ['0:14', 'The open', 'TAPE'], ['0:41', 'Short volume check', 'DATA'], ['1:20', 'Options flow', 'FLOW'], ['1:48', 'Viewer Q&A', 'Q&A'], ['2:12', 'Into CPI', 'LIVE']];
  var TIERS = [['Bronze', 500, 15, 'Standard queue'], ['Silver', 2000, 20, 'Higher queue priority'], ['Gold', 5000, 30, 'Top of the queue'], ['Sponsor', 0, 90, 'Invite only — not yet purchasable']];
  var GAMES = [['Tic-Tac-Toe', '✕◯', '#00ff88', '2 players · 30s match', '14W · 3L · streak 4', '6 tables'], ['Connect Four', '●●', '#00ccff', '2 players · drop discs', '9W · 6L', '4 tables'], ['Checkers', '◉', '#ff7a45', '2 players · forced jumps', '5W · 5L', '3 tables'], ['Chess', '♞', '#c7d6e3', '2 players · full rules', '3W · 4L', '5 tables'], ['Spades', '♠', '#7d8cff', '4 players · teams', '11W · 8L', '2 tables'], ['Blackjack', '♣', '#ffb454', '4 seats vs dealer · chips are score only', '212 chips', '4 tables']];
  var GACC = { '#00ff88': '#0d1a15', '#00ccff': '#07161d', '#ff7a45': '#170d06', '#c7d6e3': '#10141a', '#7d8cff': '#0d0f1d', '#ffb454': '#150f05' };
  var PLATS = [['Reddit', 'R', '#ff5b26'], ['X / Twitter', 'X', '#c7d6e3'], ['Facebook', 'f', '#3f7bff'], ['Bluesky', 'B', '#3aa0ff'], ['Threads', '@', '#e6edf3'], ['Stocktwits', 'S', '#00ccff'], ['LinkedIn', 'in', '#4f9be8'], ['Moomoo', 'M', '#ffb454'], ['Instagram', 'I', '#ff5b8f']];
  var BOOSTERS = ['@breakoutkid', '@micro_scalp', '@vixwhisper', '@ratiotrader', '@openprint'];
  var ORBIT = [['Today’s levels, marked up', 'The $SPY chart I am trading from'], ['Open the CPI playbook', 'Free PDF for the Loop room'], ['Weekday schedule', 'Every broadcast, one page'], ['Order-flow cheat sheet', 'Reading the tape in 5 rules'], ['Yesterday’s recap clip', '90 seconds, the whole session']];
  var QUESTIONS = [[42, 'What invalidates the long above 771.30?', '@loopkick', 'ANSWERING'], [31, 'Do you trade the print or wait for the retest?', '@nodrawdown', 'QUEUED'], [24, 'How do you read short volume vs short interest?', '@quantvega', 'QUEUED'], [18, 'Any read on QQQ leading here?', '@ratiotrader', 'QUEUED'], [11, 'Position size into a CPI day?', '@longonly', 'ANSWERED']];
  var SEATS = [['RD', 'Ray', 'HOST'], ['MW', 'Marcus', 'SPEAKING'], ['QV', 'Vega', 'SPEAKING'], ['LK', 'Kick', 'MUTED'], ['TR', 'Tape', 'MUTED'], ['+9', 'More', 'LISTENING']];
  var REC = [['LIVE', 'Options desk: gamma into the print', '412 watching · Ivy Chen', 1, ''], ['LIVE', 'Small caps room, open mic', '96 watching · Dre Ruiz', 1, ''], ['UPLOAD', 'CPI reaction, unedited desk audio', '41K views · yesterday · Ray Dolo', 0, '58:12'], ['UPLOAD', 'How we read FINRA short volume', '128K views · 2w ago · Ray Dolo', 0, '22:40'], ['UPLOAD', 'Options flow, from scratch — part 4', '76K views · 1m ago · Loop Desk', 0, '31:05'], ['UPLOAD', 'The 748 support level, explained', '19K views · 3d ago · Ivy Chen', 0, '12:26'], ['STARTS 3:00', 'Power hour: the last 60 minutes of tape', 'Starts in 2h 14m · Ray Dolo', 2, ''], ['UPLOAD', 'Sizing down into CPI week', '33K views · 5d ago · Dre Ruiz', 0, '17:48'], ['UPLOAD', 'Reading the open: liquidity in 10 minutes', '52K views · 1w ago · Ray Dolo', 0, '10:04'], ['UPLOAD', 'Bags, bids and nil: Loop game night', '8K views · 2d ago · Loop Desk', 0, '44:19']];
  var TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  var TOM_PRICE = 150, ARENA = { perShare: 250, winnerBonus: 5000, allNine: 1000, duration: '10 minute' };

  var S = {
    me: 0, canMod: false,                     /* live-chat mod tools (sml-lcm/v1) */
    t: 4823, viewers: 2841, playing: true, muted: false, tab: 0, chapter: 3,
    tick: 0, liked: false, likes: 4183, shared: false, shareAnim: 0, affFlash: 0,
    tomLeft: 3, tomWarm: 60, tomStage: 'idle', tomNote: '',
    subd: false, notify: false, vidSet: false, res: 0, speedIdx: 1, saved: false, theater: false, mk: false,
    aboutDeg: 0, aboutAuto: 0,
    msgs: [], thread: null, chatHold: false,
    oIdx: 0, oAngle: 0, oPlaying: true, oHover: false, oLightbox: false,
    vStage: 'idle', tier: 1, queuePos: 3, vWait: 0, vLeft: 0,
    aLeft: 504, aShared: [], aImpr: 0, aClicks: 0,
    aRivals: [[7, 2140, 94], [5, 1533, 71], [4, 1102, 48], [3, 640, 26], [2, 401, 15]],
    gView: 'lobby', gGame: 0, ttt: ['', '', '', '', '', '', '', '', ''], tttTurn: 'X', tttDone: '', tttLine: [], tttLeft: 30,
    recPage: 0, recAt: 0, camScene: 'idle', matchSeq: 0, endedSeq: -1
  };
  if (SIM) {
    SEED.forEach(function (m, i) { S.msgs.push({ id: 'seed' + i, ini: m[0], h: m[1], tx: m[2], at: (28 - i * 3) + 'm', replies: [] }); });
    var addR = function (mi, arr) { S.msgs[mi].replies = arr.map(function (r, j) { return { ini: r[0], h: r[1], tx: r[2], at: (14 - j * 4) + 'm' }; }); };
    addR(2, [['QV', 'quantvega', 'Same fill. That level keeps printing.'], ['JT', 'jettape', 'Trailing under 770.56 too, thanks.'], ['BK', 'breakoutkid', 'Adds working all morning.'], ['HZ', 'hedgezoo', 'Careful into the print though.']]);
    addR(0, [['SB', 'swingbias', 'VWAP hold is the whole story today.'], ['RT', 'ratiotrader', 'Same read on QQQ.']]);
    addR(3, [['MW', 'marketwatchdog', 'Hedging, not conviction. Agreed.'], ['LN', 'longonly', 'Where do you see that data?'], ['QV', 'quantvega', 'FINRA daily files, linked in my bio.']]);
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function hms(n) { var h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60, p = function (v) { return String(v).padStart(2, '0'); }; return h + ':' + p(m) + ':' + p(s); }
  function el(id) { return root.querySelector(id); }
  function cdnBase() {
    var sc = document.querySelector('script[src*="live-watch.js"]');
    return sc ? sc.src.replace(/js\/live-watch\.js.*$/, '') : '';
  }

  /* ---------- markup ---------- */
  function tapeCells() {
    return TAPE.map(function (q) {
      if (!SIM) return '<div class="slw-tq" data-sym="' + q[0] + '"><span class="s">$' + q[0] + '</span><span class="p">—</span><span class="c">—</span></div>';
      return '<div class="slw-tq"><span class="s">$' + q[0] + '</span><span class="p">' + q[1].toFixed(2) + '</span><span class="c' + (q[2] < 0 ? ' dn' : '') + '">' + (q[2] >= 0 ? '+' : '') + q[2].toFixed(2) + '%</span></div>';
    }).join('');
  }
  function tabsHTML(ghost) {
    var names = ['Chat', 'Speak', 'Q&amp;A', '⚡ Boost', '▦ Play'];
    return names.map(function (n, i) {
      return '<button class="slw-tab' + (i === 3 ? ' boost' : '') + '" data-tab="' + i + '">' + n + '</button>';
    }).join('');
  }
  var logo = cdnBase() ? '<img src="' + cdnBase() + 'img/loop-logo.png" alt="Stock Market Loop">' : '<span style="font:800 13px/1 Archivo,sans-serif;color:#00ff88">STOCK MARKET LOOP</span>';

  root.innerHTML =
    '<div class="slw-amb"><div class="slw-amb-g"></div><div class="slw-amb-r"></div></div>' +
    '<div class="slw-nav"><div class="slw-nav-l">' +
      '<a class="slw-logo" href="/" title="StockMarketLoop — home">' + logo + '<span class="slw-logo-div"></span><span class="slw-logo-live"><span class="slw-dot"></span><span>STUDIO</span></span></a>' +
      '<div class="slw-nav-links"><a href="/stock-chart/?symbol=SPY">Terminal</a><a class="on" href="#">Watch</a><a href="/groups/">Rooms</a><a href="#">Alerts</a></div>' +
    '</div><div class="slw-nav-r">' +
      '<div class="slw-search"><span class="q">SEARCH TICKER</span><span class="k">/</span></div>' +
      '<div class="slw-onair"><span class="d"></span><span>ON AIR</span></div>' +
    '</div></div>' +
    '<div class="slw-tape"><div class="slw-tape-track">' + tapeCells() + tapeCells() + '</div></div>' +
    '<div class="slw-content"><div class="slw-stage">' +

    /* ===== main column ===== */
    '<div class="slw-main">' +
      '<div class="slw-player"><div class="slw-frame">' +
        '<div class="slw-media" id="slw-media"></div>' +
        '<div class="slw-frame-ph" id="slw-ph"><span class="t1">CHECKING THE DESK…</span><span class="t2">looking for a live source</span></div>' +
        '<div class="slw-scanlines"></div><div class="slw-vignette"></div><div class="slw-scan"></div>' +
        '<div class="slw-sweepwrap"><div class="slw-sweep"></div></div>' +
        '<div class="slw-topchips"><div class="slw-livechip"><span class="d"></span><span>LIVE</span></div>' +
          '<div class="slw-viewchip"><span class="n" id="slw-viewers">—</span><span class="w">watching</span></div></div>' +
        '<div class="slw-titleblk"><div class="ep"><i></i><span>MARKET OPEN LIVE · EP 214</span></div>' +
          '<h1><span class="sym">$SPY</span> into the CPI print</h1>' +
          '<div class="who"><span class="nm">Ray Dolo · Loop Desk</span><span class="sep"></span><span class="el"><span id="slw-elapsed">0:00:00</span> elapsed</span></div></div>' +
        '<div id="slw-tom-layer"></div>' +
        '<div class="slw-markers" id="slw-markers" style="display:none"><div class="slw-markers-h"><b>LIVE MARKERS</b><span>Paused · click a marker to jump, then snap back to the live edge</span></div><div class="slw-markers-g" id="slw-markers-g"></div></div>' +
        '<div class="slw-ctl">' +
          '<div class="slw-prog"><div class="buf"></div><div class="fill" id="slw-pfill"></div><div class="head" id="slw-phead"></div><span id="slw-pmarks"></span></div>' +
          '<div class="slw-ctl-row"><div class="slw-ctl-l">' +
            '<button class="slw-btn-sq" id="slw-play">❚❚</button>' +
            '<button class="slw-vol" id="slw-vol"><span class="g">◂))</span><span class="bar"><i></i></span></button>' +
            '<div class="slw-loopchip"><span class="d"></span><span>LIVE LOOP</span></div>' +
            '<span class="slw-clock"><span id="slw-clock">0:00:00</span> / LIVE</span>' +
          '</div><div class="slw-ctl-r">' +
            '<button class="slw-btn-term">Open $SPY terminal →</button>' +
            '<button class="slw-like" id="slw-like"><span class="g">👍</span> <span id="slw-likes">4,183</span><span class="slw-facepile" id="slw-likers" style="display:none"><i>QV</i><i>MS</i><i>HZ</i></span></button>' +
            '<button class="slw-tom-btn" id="slw-tom">🍅 <span id="slw-tom-lbl">Toss tomato</span> <span class="slw-tom-count" id="slw-tom-ct">3/3</span></button>' +
            '<button class="slw-share" id="slw-share">⤴ Share</button>' +
            '<button class="slw-gear" id="slw-gear" title="Settings">⚙</button>' +
            '<div id="slw-tom-pop"></div><div id="slw-menu"></div>' +
          '</div></div>' +
        '</div>' +
      '</div></div>' +

      /* info row */
      '<div class="slw-inforow">' +
        '<div class="slw-qcard"><div class="slw-qcard-h"><div class="sy"><span class="sym" id="slw-qsym">$SPY</span><span class="nm" id="slw-qname">SPDR S&amp;P 500 ETF Trust</span></div>' +
          '<div class="slw-vsync"><span class="bars"><i></i><i></i><i></i></span><span>VOICE SYNC</span></div></div>' +
        '<div class="slw-qcard-b"><div class="slw-qcard-top"><div class="slw-qcard-px"><span class="p" id="slw-qpx">—</span><span class="c" id="slw-qchg">—</span></div>' +
          '<div class="slw-qcard-grid"><span class="k">OPEN</span><span class="k">HIGH</span><span class="k">LOW</span><span class="k">VOL</span>' +
          '<span class="v" id="slw-qopen">—</span><span class="v hi" id="slw-qhigh">—</span><span class="v lo" id="slw-qlow">—</span><span class="v" id="slw-qvol">—</span></div></div>' +
          '<svg width="100%" height="52" viewBox="0 0 440 52" preserveAspectRatio="none" aria-hidden="true"><polygon id="slw-qfill" points="" style="opacity:.08"></polygon><polyline id="slw-qline" points="" style="fill:none;stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round"></polyline></svg>' +
          '<div class="slw-qcard-x"><span>9:30</span><span>INTRADAY · LIVE</span><span>NOW</span></div></div>' +
        '<div class="slw-qcard-f"><span class="heard" id="slw-qheard">🎙 Heard "spy" in the stream audio 0s ago</span>' +
          '<div class="dots" id="slw-qdots"></div><span class="mode">TOP 5</span></div></div>' +

        '<div class="slw-aboutwrap"><div class="slw-aboutflip" id="slw-flip">' +
          '<div class="slw-about"><div class="slw-about-h"><div class="slw-avatar">RD</div>' +
            '<div class="slw-about-id"><span class="nm">Ray Dolo <small>· Loop Desk channel · EP 214</small></span><span class="fo">48.2K followers · Streams the open every weekday, 9:15 ET</span></div>' +
            '<button class="slw-sub" id="slw-sub">Subscribe</button></div>' +
          '<span class="slw-about-desc">Live from the Loop Desk every weekday at 9:15 ET. Today: positioning into the <a href="#tag-cpi">#CPI</a> print, where the tape found liquidity at the <a href="#tag-marketopen">#MarketOpen</a>, and the <a href="#tag-shortvolume">#ShortVolume</a> picture on $SPY. Callers get the floor between segments — request the mic in the Speak tab. <a href="#tag-spy">#SPY</a> <a href="#tag-optionsflow">#OptionsFlow</a></span>' +
          '<div class="slw-affrow"><span class="lbl">AFFILIATE</span><a class="slw-aff" id="slw-aff0" href="#" target="_blank" rel="noopener sponsored">LoopKick charts — 20% off</a><a class="slw-aff" id="slw-aff1" href="#" target="_blank" rel="noopener sponsored">moomoo.com/r/loopdesk</a></div>' +
          '<div class="slw-about-f"><span class="cap">ABOUT THIS BROADCAST</span><div class="ctl"><button class="slw-more" id="slw-more">More</button><span class="hint">disclaimer</span><button class="slw-flipbtn" data-flip="-1">‹</button><button class="slw-flipbtn" data-flip="1">›</button></div></div></div>' +
          '<div class="slw-about back"><div class="slw-disc-h"><b>DISCLAIMER</b><span>auto-shows 30s every 15 min</span></div>' +
          '<span class="slw-disc-t">Broadcasts are for education and information only and are not investment advice or a recommendation to buy or sell any security. Quotes may be delayed. Callers speak for themselves. Live audio, including approved callers, is mixed into the stream and may remain in the archive.</span>' +
          '<div class="slw-about-f"><button class="slw-x" id="slw-more2">More</button><div class="ctl"><span class="hint">about</span><button class="slw-flipbtn" data-flip="-1">‹</button><button class="slw-flipbtn" data-flip="1">›</button></div></div></div>' +
        '</div></div>' +
      '</div>' +

      /* orbit */
      '<div class="slw-orbit-sec"><div class="oh"><span class="l">From the host</span><span class="r" id="slw-ocount2">1 / ' + ORBIT.length + '</span></div>' +
        '<div class="slw-orbit" id="slw-orbit" tabindex="0" role="region" aria-label="Host photos — use the left and right arrow keys to rotate">' +
          '<div class="slw-neb1"></div><div class="slw-neb2"></div><div class="slw-stars1"></div><div class="slw-stars2"></div><div class="slw-floor"></div>' +
          '<div class="slw-astroB"></div><div class="slw-astroC"></div>' +
          '<div class="slw-ring-persp"><div class="slw-ring" id="slw-ring"></div></div>' +
          '<div class="slw-astroA"></div>' +
          '<div class="slw-orbit-ctl"><button class="slw-orb-nav" id="slw-oprev" title="Previous image">‹</button>' +
          '<button class="slw-orb-pause" id="slw-opause" title="Pause rotation">❚❚ Pause</button>' +
          '<button class="slw-orb-nav" id="slw-onext" title="Next image">›</button>' +
          '<span class="slw-orb-count" id="slw-ocount">1 / ' + ORBIT.length + '</span></div></div>' +
        '<div class="slw-orbit-cap"><div class="l"><b id="slw-otitle"></b><span id="slw-osub"></span></div>' +
        '<div class="r"><button class="slw-btn2" id="slw-oenlarge">Enlarge</button><a class="slw-openlink" href="#" target="_blank" rel="noopener">Open link ↗</a></div></div>' +
      '</div>' +
    '</div>' +

    /* ===== rail ===== */
    '<div class="slw-rail">' +
      '<div class="slw-panel">' +
        '<div class="slw-cam" id="slw-cam"><div class="fr"><div class="ph"><span>Host cam lives here — off the stream, on the chat</span></div></div>' +
          '<div class="chip"><span class="d"></span><b>HOST CAM</b></div><div class="who"><span>Ray Dolo · off-screen cam</span></div><div class="fade"></div>' +
          '<div class="ghost-tabs" id="slw-tabs-ghost">' + tabsHTML(true) + '</div></div>' +
        '<div class="slw-call" id="slw-call"><div class="gl"></div><div class="row"><div class="av">IC</div><div class="tx">' +
          '<span class="k">📞 INCOMING STREAM CALL</span><span class="nm">Ivy Chen · Options desk</span>' +
          '<span class="st"><span class="rd">●</span> LIVE · <span id="slw-callv">398</span> watching her stream now</span></div>' +
          '<div class="btns"><button class="slw-accept">Accept</button><button class="slw-decline">Decline</button></div></div></div>' +
        '<div class="slw-dial" id="slw-dial"><div class="gl"></div><div class="row"><div class="avw"><div class="ring"></div><div class="av">IC</div></div><div class="tx">' +
          '<span class="k">📞 CALLING<i>…</i></span><span class="nm">Ray is calling Ivy Chen · Options desk</span>' +
          '<span class="st"><span class="rd">●</span> LIVE · <span id="slw-dialv">398</span> watching her stream · ringing <span id="slw-dials">4</span>s</span></div>' +
          '<button class="slw-decline">Cancel</button></div>' +
          '<div class="note"><span>Everyone in chat sees this call go out — if Ivy accepts, both streams link up live.</span></div></div>' +
        '<div class="slw-wait" id="slw-wait"><div class="av">JT</div><span class="tx"><b>@jettape</b> requested to speak · waiting for the host — the stream keeps rolling</span><span class="d"></span></div>' +
        '<div class="slw-tabs" id="slw-tabs-plain">' + tabsHTML(false) + '</div>' +

        /* chat */
        '<div id="slw-pane-0"><div class="slw-pinned"><b>PINNED</b><span>Levels for today: 771.30 / 773.33 / 748.22</span></div>' +
          '<div class="slw-sent"><b>STREAM SENTIMENT</b><span class="bar"><i></i></span><span class="pct">68% bullish</span></div>' +
          '<div class="slw-topthreads" id="slw-tt"><div class="hd"><b>🔥 TOP THREADS</b><span>the 3 busiest conversations, pinned</span></div><div id="slw-tt-rows"></div></div>' +
          '<div class="slw-feed" id="slw-feed"><div class="slw-chat-empty" id="slw-chat-empty" style="display:none">No messages yet — say something to the room.</div><div class="slw-feed-inner" id="slw-feed-inner"></div></div>' +
          '<div class="slw-thread" id="slw-thread"></div>' +
          '<div class="slw-gaterow" id="slw-gaterow" style="display:none"></div>' +
          '<div class="slw-composer" id="slw-composer"><input class="cin" id="slw-cin" type="text" maxlength="500" placeholder="Say something to the room" autocomplete="off"><button class="slw-send" id="slw-csend">Send</button></div></div>' +

        /* speak */
        '<div id="slw-pane-1" style="display:none">' +
          '<div class="slw-voice-h"><div class="eq"><i></i><i></i><i></i></div><div class="tx"><b>On air right now</b><span>3 on the line · 118 listening</span></div></div>' +
          '<div class="slw-seats">' + SEATS.map(function (p) {
            var live = p[2] === 'HOST' || p[2] === 'SPEAKING';
            return '<div class="slw-seat"><div class="rg' + (live ? ' live' : '') + (p[2] === 'SPEAKING' ? ' speaking' : '') + '">' + p[0] + '</div><span class="nm">' + p[1] + '</span><span class="rl ' + p[2].toLowerCase() + '">' + p[2] + '</span></div>';
          }).join('') + '</div>' +
          '<div class="slw-vpass"><b>VOICE PASS</b><div class="bal"><span>Your balance</span><b id="slw-bucks">— LB</b></div></div>' +
          '<div class="slw-vbody" id="slw-vidle"><span class="intro">Buy a timed pass, then request the mic. The host approves one caller at a time and your audio goes straight into the broadcast.</span>' +
            '<div class="slw-tiers" id="slw-tiers"></div>' +
            '<div class="slw-vnote"><span>Add a note for the host (optional)</span></div>' +
            '<button class="slw-vreq" id="slw-vreq">Request to speak · 2,000 LB</button>' +
            '<button class="slw-vlisten">Listen only, no pass</button>' +
            '<span class="slw-vfine">Denied or failed connections are refunded automatically. Your mic stays off until the host approves you. Callers are mixed into the broadcast and may remain in the archive.</span></div>' +
          '<div class="slw-vqueue" id="slw-vqueue"><span class="t">In the host\'s queue</span>' +
            '<div class="card"><span class="pos" id="slw-qpos">#3</span><div class="bd"><b id="slw-qtier">Silver pass · 20s</b><span>Waiting for the host between segments</span></div></div>' +
            '<div class="slw-mic"><span class="l">MIC LEVEL</span><span class="bars" id="slw-micbars"></span></div>' +
            '<div class="slw-checks">' + ['Echo cancellation', 'Noise suppression', 'Auto gain', 'Mic ready'].map(function (c) { return '<div class="c"><b>✓</b><span>' + c + '</span></div>'; }).join('') + '</div>' +
            '<button class="slw-vleave" id="slw-vleave">Leave the queue &amp; refund</button></div></div>' +

        /* Q&A */
        '<div id="slw-pane-2" style="display:none">' + QUESTIONS.map(function (q) {
          return '<div class="slw-q"><div class="vote"><span class="a">▲</span><span class="n">' + q[0] + '</span></div><div class="bd"><span class="tx">' + esc(q[1]) + '</span><div class="mt"><span class="who">' + q[2] + '</span><span class="st ' + q[3].toLowerCase() + '">' + q[3] + '</span></div></div></div>';
        }).join('') +
          '<div class="slw-q-comp"><div class="in"><span>Ask the desk a question</span></div><button class="slw-send">Ask</button></div></div>' +

        /* boost */
        '<div id="slw-pane-3" style="display:none">' +
          '<div class="slw-boost-h"><div class="l"><div class="t"><b>⚡ BOOST ARENA</b><span class="live">LIVE ONLY</span></div>' +
            '<span class="sub">+' + ARENA.perShare + ' LB per verified share · winner +' + ARENA.winnerBonus.toLocaleString() + ' LB</span></div>' +
            '<div class="r"><span class="k" id="slw-atl">TIME LEFT</span><span class="v" id="slw-aclk">8:24</span></div></div>' +
          '<div class="slw-boost-over" id="slw-aover"><b>ROUND OVER</b><span><b id="slw-awin">—</b> takes the bonus.</span></div>' +
          '<div class="slw-boost-share"><div class="hd"><b>SHARE TO EARN</b><span id="slw-actn">0 / 9</span></div>' +
            '<div class="slw-plats" id="slw-plats"></div>' +
            '<div class="slw-allnine"><div class="hd"><span>ALL-9 BONUS</span><b>+1,000 LB</b></div><div class="bar"><i id="slw-a9"></i></div></div>' +
            '<div class="slw-bstats"><div class="slw-bstat"><b id="slw-ashr">0</b><span>SHARES</span></div>' +
            '<div class="slw-bstat"><b class="cy" id="slw-aimp">0</b><span>LINK CLICKS</span></div>' +
            '<div class="slw-bstat gold"><b id="slw-aearn">0</b><span>LB EARNED</span></div></div></div>' +
          '<div class="slw-lead-h"><b>LIVE LEADERBOARD</b><div class="upd"><i></i><span>UPDATING</span></div></div>' +
          '<div class="slw-lead-cols"><span>#</span><span>BOOSTER</span><span class="r">SHR</span><span class="r">CLK</span><span class="r">LB</span></div>' +
          '<div id="slw-aboard"></div>' +
          '<span class="slw-boost-fn">Set by the host: ' + ARENA.duration + ' round. Shares are verified by link tracking before Loop Bucks land. Top 3 paid.</span></div>' +

        /* play */
        '<div id="slw-pane-4" style="display:none"><span aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)" id="slw-glive"></span>' +
          '<div class="slw-play-h"><div class="t"><b>▦ WATCH &amp; PLAY</b><span>24 live tables</span></div>' +
            '<div class="g"><span class="slw-gate" id="slw-pgate">ACCESS UNLOCKED · HOLD 495+ LB</span><span class="rank" id="slw-prank">Rank <b>#214</b> · 31W · streak 4</span></div>' +
            '<span class="fn">Free games while the stream runs — the video never pauses. Nothing is staked or deducted.</span></div>' +
          '<div class="slw-lobby" id="slw-glob"><div class="slw-gtiles">' + GAMES.map(function (g, i) {
            return '<div class="slw-gtile"><div class="top"><span class="slw-gbadge" style="color:' + g[2] + ';background:' + GACC[g[2]] + ';text-shadow:0 0 8px ' + g[2] + '66">' + g[1] + '</span><span class="lv">' + g[5] + '</span></div>' +
              '<span class="nm">' + g[0] + '</span><span class="mt">' + g[3] + '</span><span class="rec">' + g[4] + '</span>' +
              '<button class="slw-gcta' + (i === 0 ? ' primary' : '') + '" data-game="' + i + '">' + (i === 0 ? 'Quick play' : 'Open a table') + '</button></div>';
          }).join('') + '</div>' +
            '<div class="slw-gopen"><div class="hd"><b>OPEN TABLES</b><a href="#">Leaderboard →</a></div>' +
            [[3, '@quantvega · rated 1420', '1/2'], [5, '@hedgezoo table · bidding open', '3/4'], [1, '@openprint · best of 3', '1/2']].map(function (t) {
              var g = GAMES[t[0]];
              return '<div class="slw-gtable"><div class="l"><span class="bg" style="color:' + g[2] + ';background:' + GACC[g[2]] + '">' + g[1] + '</span><div class="bd"><span class="nm">' + g[0] + ' · ' + t[2] + ' seats</span><span class="hs">' + t[1] + '</span></div></div><button class="slw-gjoin" data-game="' + t[0] + '">Join</button></div>';
            }).join('') + '</div></div>' +
          '<div class="slw-gwait" id="slw-gwait"><span class="bg" id="slw-gwbadge"></span><b id="slw-gwname"></b>' +
            '<span class="n">Waiting for an opponent · matchmaking is also looking for you</span>' +
            '<div class="code"><b>SML-4F7K</b><button class="slw-btn2" style="padding:11px 12px;font-size:9px">Copy</button></div>' +
            '<button class="slw-back" id="slw-gwback">Close table</button></div>' +
          '<div class="slw-gmatch" id="slw-gmatch"><div class="slw-gmatch-h"><div class="l"><button class="slw-back" id="slw-gback">← Lobby</button><b>Tic-Tac-Toe</b></div>' +
            '<div class="r"><span class="slw-ttt-clock" id="slw-tclk">30s</span><button class="slw-forfeit" id="slw-gforfeit">Forfeit</button></div></div>' +
            '<div class="slw-vschips"><div class="slw-pchip" id="slw-chipyou"><span class="m">✕</span><span class="n">You</span></div><span class="vs">vs</span>' +
            '<div class="slw-pchip" id="slw-chipopp"><span class="m">◯</span><span class="n">@tapereader</span></div></div>' +
            '<div class="slw-ttt-wrap"><div class="slw-ttt-persp"><div class="slw-ttt" role="grid" aria-label="Tic-tac-toe board" id="slw-ttt"></div></div>' +
            '<span class="slw-ttt-status" id="slw-tstat">Your move — place an ✕</span>' +
            '<div class="slw-ttt-btns" id="slw-tbtns"><button class="slw-rematch" id="slw-trematch">Rematch</button><button class="slw-btn2" id="slw-tlobby">Back to lobby</button></div>' +
            '<span class="slw-play-fn">Free to play. Chips and points are score only — Loop Bucks just unlock access.</span></div></div></div>' +
      '</div>' +

      /* recommended */
      '<div class="slw-rec"><div class="slw-rec-h"><div class="l"><b>Recommended next</b><span>Live channels and uploads, picked from what you watch</span></div>' +
        '<div class="r"><a href="#">Browse all →</a><span id="slw-recmeta">1 / 2 · Next 5 in 3:00</span></div></div>' +
        '<div id="slw-rec-rows"></div></div>' +
    '</div>' +
    '</div></div>' +

    /* lightbox + modal mounts */
    '<div id="slw-lb-mount"></div><div id="slw-modal-mount"></div>' +

    /* admin-only banner (scenario switcher rides along) */
    (ADMIN ? '<div class="slw-banner"><b>LIVE WATCH' + (typeof window.SML_LW_ADMIN !== 'undefined' ? '' : ' PREVIEW') + '</b><span>admin tools</span>' +
      '<select id="slw-scene"><option value="idle">cam: idle (closed)</option><option value="cam">cam: host cam live</option><option value="wait">cam: viewer waiting</option><option value="call">cam: incoming call</option><option value="dial">cam: calling out</option></select>' +
      '<button class="slw-x" id="slw-orbbtn" style="padding:6px 9px;font-size:9px">orbit images</button>' +
      '<a href="?lw=0">exit</a></div>' : '');

  /* pre-paint guard (wpcode/prepaint-guard.php): the shell is in the DOM — reveal */
  document.documentElement.classList.remove('sml-pp');

  /* ---------- module renderers ---------- */
  var feedInner = el('#slw-feed-inner');

  function avStyle(i) { return 'color:' + ACCENTS[i % 5]; }
  function msgHTML(m, i) {
    if (m.sys) {
      return '<div class="slw-msg sys" data-id="' + m.id + '"><div class="av">' + m.ini + '</div><div class="bd">' +
        '<div class="hd"><span class="hn">GAME ARENA</span><span class="at">' + m.at + '</span></div>' +
        '<span class="tx">' + esc(m.tx) + '</span></div></div>';
    }
    var rl = (m.replies || []).length;
    var avExtra = (m.avatar && /^https:\/\//.test(m.avatar)) ? ';background-image:url(' + esc(m.avatar) + ');background-size:cover;background-position:center' : '';
    var canRm = !!(m.rawId != null && (S.canMod || (S.me && m.uid && m.uid === S.me)));
    return '<div class="slw-msg" data-id="' + m.id + '"><div class="av" style="' + avStyle(i) + avExtra + '">' + (avExtra ? '' : m.ini) + '</div><div class="bd">' +
      '<div class="hd"><span class="hn" style="' + avStyle(i) + '">@' + m.h + '</span><span class="at">' + m.at + '</span>' +
      '<button class="rp" data-th="' + m.id + '">↩ Reply</button>' +
      (canRm ? '<button class="rm" data-rm="' + esc(String(m.rawId)) + '" title="' + (S.canMod ? 'Remove (moderator)' : 'Remove my message') + '">✕</button>' : '') + '</div>' +
      '<span class="tx">' + esc(m.tx) + '</span>' +
      (rl ? '<button class="open-th" data-th="' + m.id + '">↳ ' + rl + ' repl' + (rl === 1 ? 'y' : 'ies') + ' — open thread</button>' : '') +
      '</div></div>';
  }
  function renderFeed() {
    var last = S.msgs.slice(-7);
    feedInner.innerHTML = last.map(function (m, i) { return msgHTML(m, i); }).join('');
    /* only the newest row plays the entry animation — re-renders must not replay it */
    for (var k = 0; k < feedInner.children.length - 1; k++) feedInner.children[k].style.animation = 'none';
    renderTop();
  }
  function renderTop() {
    var ranked = S.msgs.filter(function (m) { return (m.replies || []).length > 0 && !m.sys; })
      .sort(function (a, b) { return b.replies.length - a.replies.length; }).slice(0, 3);
    el('#slw-tt-rows').innerHTML = ranked.map(function (m, i) {
      return '<div class="slw-tt' + (i === 0 ? ' first' : '') + '" data-th="' + m.id + '"><span class="rk">' + (i + 1) + '</span>' +
        '<span class="tx"><b>@' + m.h + '</b> · ' + esc(m.tx) + '</span><span class="ct">' + m.replies.length + ' ↩</span></div>';
    }).join('');
  }
  function renderThread() {
    var tw = el('#slw-thread'), fw = el('#slw-feed'), tt = el('#slw-tt'), comp = el('#slw-composer');
    var m = S.msgs.filter(function (x) { return x.id === S.thread; })[0];
    if (!m) { tw.classList.remove('show'); fw.style.display = ''; tt.style.display = ''; comp.style.display = ''; return; }
    fw.style.display = 'none'; tt.style.display = 'none'; comp.style.display = 'none';
    var ti = S.msgs.indexOf(m);
    tw.innerHTML = '<div class="slw-thread-h"><button class="slw-back" id="slw-tback">← All chat</button><b>THREAD</b><span>' + (m.replies || []).length + ' replies</span></div>' +
      '<div class="slw-thread-root"><div class="av" style="' + avStyle(ti) + '">' + m.ini + '</div><div class="bd">' +
      '<span class="hn" style="' + avStyle(ti) + '">@' + m.h + '</span><span class="at">' + m.at + '</span><span class="tx">' + esc(m.tx) + '</span></div></div>' +
      '<div class="slw-thread-list">' + (m.replies || []).slice(-6).map(function (r, j) {
        return '<div class="slw-reply"><div class="av" style="' + avStyle(j + 1) + '">' + r.ini + '</div><div class="bd">' +
          '<span class="hn" style="' + (r.h === 'you' ? 'color:#00ff88' : avStyle(j + 1)) + '">@' + r.h + '</span><span class="at">' + r.at + '</span><span class="tx">' + esc(r.tx) + '</span></div></div>';
      }).join('') + '</div>' +
      '<div class="slw-thread-comp"><input type="text" id="slw-draft" placeholder="Reply to this thread"><button class="slw-reply-send" id="slw-rsend">Reply</button></div>';
    tw.classList.add('show');
    el('#slw-tback').onclick = function () { S.thread = null; renderThread(); };
    var send = function () {
      var v = el('#slw-draft').value.trim();
      if (!v) return;
      m.replies.push({ ini: 'YO', h: 'you', tx: v, at: 'now' });
      renderThread(); renderFeed();
    };
    el('#slw-rsend').onclick = send;
    el('#slw-draft').onkeydown = function (e) { if (e.key === 'Enter') send(); };
  }
  function gameNote(glyph, txt, eid) {
    var id = 'g-' + eid;
    if (S.msgs.some(function (m) { return m.id === id; })) return;
    S.msgs.push({ id: id, sys: true, ini: glyph, h: 'ARENA', tx: txt, at: 'now', replies: [] });
    S.msgs = S.msgs.slice(-24);
    renderFeed();
  }

  /* progress bar marks */
  el('#slw-pmarks').innerHTML = CHAPTERS.map(function (c, i) {
    return '<div class="mk' + (i <= S.chapter ? ' past' : '') + '" style="left:' + (6 + i * 15.5) + '%"></div>';
  }).join('');
  el('#slw-markers-g').innerHTML = CHAPTERS.map(function (c, i) {
    return '<div class="slw-ch' + (i === S.chapter ? ' on' : '') + '" data-ch="' + i + '"><div class="r"><span class="t">' + c[0] + '</span><span class="b">' + c[2] + '</span></div><span class="n">' + c[1] + '</span></div>';
  }).join('');

  /* tiers */
  function renderTiers() {
    el('#slw-tiers').innerHTML = TIERS.map(function (t, i) {
      var locked = i === 3, on = i === S.tier;
      return '<div class="slw-tier' + (on ? ' on' : '') + (locked ? ' locked' : '') + '" data-tier="' + i + '"><div class="l"><span class="dot"></span>' +
        '<div style="display:flex;flex-direction:column;gap:4px"><span class="nm">' + t[0] + '</span><span class="nt">' + t[3] + '</span></div></div>' +
        '<div class="r"><span class="pr">' + (locked ? 'Soon' : t[1].toLocaleString() + ' LB') + '</span><span class="sc">' + t[2] + 's on air</span></div></div>';
    }).join('');
    el('#slw-vreq').textContent = 'Request to speak · ' + TIERS[S.tier][1].toLocaleString() + ' LB';
    Array.prototype.forEach.call(root.querySelectorAll('.slw-tier'), function (n) {
      n.onclick = function () { var i = +n.getAttribute('data-tier'); if (i !== 3) { S.tier = i; renderTiers(); } };
    });
  }
  renderTiers();
  el('#slw-micbars').innerHTML = new Array(19).join('<i></i>') + '<i class="amber"></i><i class="amber"></i>';

  /* boost */
  function renderPlats() {
    var locked = S.aLeft <= 0;
    el('#slw-plats').innerHTML = PLATS.map(function (p, i) {
      var done = S.aShared.indexOf(i) >= 0;
      return '<button class="slw-plat' + (done ? ' done' : '') + '" data-plat="' + i + '"' + (locked && !done ? ' style="opacity:.45;cursor:default"' : '') + '>' +
        '<span class="mk" style="color:' + p[2] + '">' + p[1] + '</span><span class="nm">' + p[0] + '</span>' +
        '<span class="st">' + (done ? '✓ SHARED' : (locked ? 'CLOSED' : '+' + ARENA.perShare + ' LB')) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(root.querySelectorAll('.slw-plat'), function (n) {
      n.onclick = function () {
        var i = +n.getAttribute('data-plat');
        if (S.aLeft <= 0 || S.aShared.indexOf(i) >= 0) return;
        S.aShared.push(i); renderPlats(); renderBoost();
      };
    });
  }
  function renderBoost() {
    var locked = S.aLeft <= 0;
    var myLb = S.aShared.length * ARENA.perShare + (S.aShared.length === 9 ? ARENA.allNine : 0);
    el('#slw-actn').textContent = S.aShared.length + ' / 9';
    el('#slw-a9').style.width = (S.aShared.length / 9 * 100).toFixed(0) + '%';
    el('#slw-ashr').textContent = S.aShared.length;
    el('#slw-aimp').textContent = S.aImpr.toLocaleString();
    el('#slw-aearn').textContent = myLb.toLocaleString();
    var am = Math.floor(S.aLeft / 60), asx = S.aLeft % 60;
    var clk = el('#slw-aclk');
    clk.textContent = locked ? '0:00' : am + ':' + String(asx).padStart(2, '0');
    clk.className = 'v' + (locked ? ' ended' : (S.aLeft < 60 ? ' warn' : ''));
    el('#slw-atl').textContent = locked ? 'ENDED' : 'TIME LEFT';
    var entries = BOOSTERS.map(function (nm, i) {
      var r = S.aRivals[i];
      return { name: nm, sh: r[0], im: r[1], ck: r[2], lb: r[0] * ARENA.perShare, me: false };
    });
    entries.push({ name: 'You', sh: S.aShared.length, im: S.aImpr, ck: S.aClicks, lb: myLb, me: true });
    entries.sort(function (a, b) { return (b.im + b.ck * 8 + b.sh * 120) - (a.im + a.ck * 8 + a.sh * 120); });
    el('#slw-aboard').innerHTML = entries.map(function (e, i) {
      return '<div class="slw-brow' + (e.me ? ' me' : (i % 2 ? ' alt' : '')) + '"><span class="rk' + (i === 0 ? ' top' : (i < 3 ? ' t3' : '')) + '">' + (i + 1) + '</span>' +
        '<span class="nm">' + e.name + '</span><span class="v">' + e.sh + '/9</span><span class="v w">' + e.im.toLocaleString() + '</span><span class="lb">' + e.lb.toLocaleString() + '</span></div>';
    }).join('');
    var over = el('#slw-aover');
    if (locked) { over.classList.add('show'); el('#slw-awin').textContent = entries[0].me ? 'You' : entries[0].name; }
    else over.classList.remove('show');
  }
  renderPlats(); renderBoost();

  /* recommended */
  function renderRec() {
    if (!SIM) return; /* real mode renders via loadRec */
    el('#slw-rec-rows').innerHTML = REC.slice(S.recPage * 5, S.recPage * 5 + 5).map(function (v) {
      var live = v[3] === 1;
      return '<div class="slw-rv"><div class="th"><div class="ar"></div><div class="ph"><span>THUMB</span></div>' +
        (v[3] !== 0 ? '<div class="badge' + (live ? ' live' : '') + '">' + v[0] + '</div>' : '') +
        (v[4] ? '<div class="dur">' + v[4] + '</div>' : '') + '</div>' +
        '<div class="bd"><span class="tt">' + esc(v[1]) + '</span><div class="mt"><span class="d' + (live ? ' live' : (v[3] === 2 ? ' soon' : '')) + '"></span><span>' + esc(v[2]) + '</span></div></div></div>';
    }).join('');
  }
  renderRec();

  /* orbit */
  var ringEl = el('#slw-ring');
  var OITEMS = ORBIT.map(function (o) { return { img: '', title: o[0], sub: o[1], link: '' }; });
  var N = OITEMS.length, R = Math.max(290, N * 56);
  var ocards = ringEl.children;
  function buildOrbit(items) {
    OITEMS = items;
    N = Math.max(1, OITEMS.length);
    R = Math.max(290, N * 56);
    S.oIdx = 0; S.oAngle = 0;
    ringEl.innerHTML = OITEMS.map(function (o, i) {
      var media = o.img
        ? '<img class="oimg" src="' + esc(o.img) + '" alt="' + esc(o.title || 'Host image') + '">' +
          (o.title ? '<span class="ocap">' + esc(o.title) + '</span>' : '')
        : '<div class="ph"><span>Image or GIF ' + (i + 1) + '<br>— creator photo slot —</span></div>' +
          '<div class="cap"><b>' + esc(o.title) + '</b><span>' + esc(o.sub) + '</span></div>';
      return '<div class="slw-ocard' + (o.img ? ' img' : '') + '" data-oi="' + i + '" role="button" aria-label="' + esc(o.title || 'Host image') + ' — image ' + (i + 1) + ' of ' + N + '">' + media + '</div>';
    }).join('');
    ocards = ringEl.children;
    Array.prototype.forEach.call(ocards, function (c) {
      c.onclick = function () {
        var i = +c.getAttribute('data-oi');
        if (i === S.oIdx) { openLightbox(); return; }
        var delta = ((i - S.oIdx) % N + N) % N;
        if (delta > N / 2) delta -= N;
        orbStep(delta);
      };
    });
    orbitPaint(false);
  }
  function orbitPaint(smooth) {
    for (var i = 0; i < N; i++) {
      var a = ((((i * (360 / N) - S.oAngle) % 360) + 540) % 360) - 180;
      var d = (Math.cos(a * Math.PI / 180) + 1) / 2;
      var c = ocards[i];
      c.style.transition = smooth ? 'transform 1.05s linear, opacity 1.05s linear, box-shadow 1.05s linear, filter 1.05s linear' : 'transform .8s cubic-bezier(.22,.7,.25,1), opacity .8s ease, box-shadow .8s ease, filter .8s ease';
      c.style.transform = 'rotateY(' + a.toFixed(2) + 'deg) translateZ(' + R + 'px) rotateY(' + (-a * 0.62).toFixed(2) + 'deg) scale(' + (0.74 + 0.26 * d).toFixed(3) + ')';
      c.style.opacity = (0.22 + 0.78 * d).toFixed(2);
      c.style.filter = 'saturate(' + (0.6 + 0.4 * d).toFixed(2) + ') blur(' + ((1 - d) * 1.1).toFixed(2) + 'px)';
      c.style.zIndex = Math.round(d * 100);
      var active = i === S.oIdx;
      c.classList.toggle('active', active);
      /* boxless image cards carry their own drop-shadow — a box glow would redraw the frame */
      c.style.boxShadow = c.classList.contains('img') ? 'none' : (active ? '0 30px 70px -24px rgba(0,255,136,.45), 0 0 0 1px rgba(0,255,136,.28)' : '0 20px 50px -30px rgba(0,0,0,.9)');
    }
    var cur = OITEMS[S.oIdx] || { title: '', sub: '', link: '' };
    el('#slw-ocount').textContent = (S.oIdx + 1) + ' / ' + N;
    el('#slw-ocount2').textContent = (S.oIdx + 1) + ' / ' + N;
    el('#slw-otitle').textContent = cur.title || '';
    el('#slw-osub').textContent = cur.sub || '';
    var lk = root.querySelector('.slw-orbit-cap .slw-openlink');
    if (lk) { lk.style.display = cur.link ? '' : 'none'; if (cur.link) lk.href = cur.link; }
  }
  function orbStep(dir) {
    var step = 360 / N, k = Math.round(S.oAngle / step) + dir;
    S.oAngle = k * step;
    S.oIdx = ((k % N) + N) % N;
    orbitPaint(false);
  }
  el('#slw-oprev').onclick = function () { orbStep(-1); };
  el('#slw-onext').onclick = function () { orbStep(1); };
  el('#slw-opause').onclick = function () {
    S.oPlaying = !S.oPlaying;
    var b = el('#slw-opause');
    b.classList.toggle('paused', !S.oPlaying);
    b.innerHTML = S.oPlaying ? '❚❚ Pause' : '▶ Play';
  };
  var orbitEl = el('#slw-orbit');
  orbitEl.addEventListener('mouseenter', function () { S.oHover = true; });
  orbitEl.addEventListener('mouseleave', function () { S.oHover = false; });
  orbitEl.addEventListener('wheel', function (e) {
    e.preventDefault();
    orbitEl.__acc = (orbitEl.__acc || 0) + e.deltaY;
    if (Math.abs(orbitEl.__acc) > 55) { orbStep(orbitEl.__acc > 0 ? 1 : -1); orbitEl.__acc = 0; }
  }, { passive: false });
  function openLightbox() {
    S.oLightbox = true;
    var cur = OITEMS[S.oIdx] || { img: '', title: '', sub: '', link: '' };
    var media = cur.img
      ? '<img src="' + esc(cur.img) + '" alt="' + esc(cur.title || 'Host image') + '" style="max-width:min(82vw,900px);max-height:70vh;width:auto;height:auto;display:block;border-radius:12px;filter:drop-shadow(0 30px 60px rgba(0,0,0,.85))">'
      : '<div class="slw-lb-img"><span>Creator image or GIF</span></div>';
    el('#slw-lb-mount').innerHTML = '<div class="slw-lb" id="slw-lb"><div class="slw-lb-row">' +
      '<button class="slw-lb-nav" id="slw-lbp">‹</button>' + media + '<button class="slw-lb-nav" id="slw-lbn">›</button></div>' +
      '<div class="slw-lb-cap"><b>' + esc(cur.title || '') + '</b><span>' + esc(cur.sub || '') + (cur.sub ? ' · ' : '') + (S.oIdx + 1) + ' / ' + N + '</span></div>' +
      '<div class="slw-lb-btns">' + (cur.link ? '<a class="slw-lb-open" href="' + esc(cur.link) + '" target="_blank" rel="noopener">Open link ↗</a>' : '') + '<button class="slw-btn2" id="slw-lbx">Close (Esc)</button></div></div>';
    el('#slw-lbx').onclick = closeLightbox;
    el('#slw-lbp').onclick = function () { orbStep(-1); openLightbox(); };
    el('#slw-lbn').onclick = function () { orbStep(1); openLightbox(); };
  }
  function closeLightbox() { S.oLightbox = false; el('#slw-lb-mount').innerHTML = ''; }
  el('#slw-oenlarge').onclick = openLightbox;
  buildOrbit(OITEMS);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeLightbox(); closeModal(); return; }
    var owns = S.oLightbox || S.oHover || orbitEl.contains(document.activeElement);
    if (!owns) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); orbStep(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); orbStep(1); }
  });

  /* about flip + modal */
  function paintFlip() { el('#slw-flip').style.transform = 'rotateY(' + S.aboutDeg + 'deg)'; }
  Array.prototype.forEach.call(root.querySelectorAll('.slw-flipbtn'), function (b) {
    b.onclick = function () { S.aboutDeg += 180 * (+b.getAttribute('data-flip')); S.aboutAuto = 0; paintFlip(); };
  });
  function openModal() {
    el('#slw-modal-mount').innerHTML = '<div class="slw-modal" id="slw-modal"><div class="slw-modal-c">' +
      '<div class="slw-modal-h"><b>About this broadcast</b><button class="slw-x" id="slw-mx">Close ✕</button></div>' +
      '<span class="slw-modal-t">Live from the Loop Desk every weekday at 9:15 ET. Today: positioning into the <a href="#tag-cpi">#CPI</a> print, where the tape found liquidity at the <a href="#tag-marketopen">#MarketOpen</a>, and the <a href="#tag-shortvolume">#ShortVolume</a> picture on $SPY. Callers get the floor between segments — request the mic in the Speak tab. Voice passes, the Boost Arena, and Watch &amp; Play games are open for this stream; alerts fire through the terminal as levels break.</span>' +
      '<div class="slw-tagrow"><a class="slw-tag" href="#">#SPY</a><a class="slw-tag" href="#">#CPI</a><a class="slw-tag" href="#">#MarketOpen</a><a class="slw-tag" href="#">#ShortVolume</a><a class="slw-tag" href="#">#OptionsFlow</a></div>' +
      '<span class="fn">Hashtags open a feed of every video, post, photo and article using that tag.</span>' +
      '<div class="disc"><b>DISCLAIMER</b><span>Broadcasts are for education and information only and are not investment advice or a recommendation to buy or sell any security. Quotes may be delayed. Callers speak for themselves. Live audio, including approved callers, is mixed into the stream and may remain in the archive.</span></div></div></div>';
    el('#slw-mx').onclick = closeModal;
    el('#slw-modal').onclick = function (e) { if (e.target === el('#slw-modal')) closeModal(); };
  }
  function closeModal() { el('#slw-modal-mount').innerHTML = ''; }
  el('#slw-more').onclick = openModal;
  el('#slw-more2').onclick = openModal;

  /* player controls */
  el('#slw-play').onclick = function () {
    S.playing = !S.playing;
    var b = el('#slw-play');
    b.textContent = S.playing ? '❚❚' : '▶';
    b.classList.toggle('play', !S.playing);
    if (S.playing) { S.mk = false; el('#slw-markers').style.display = 'none'; }
  };
  el('#slw-vol').onclick = function () {
    S.muted = !S.muted;
    el('#slw-vol').className = 'slw-vol' + (S.muted ? ' muted' : '');
    el('#slw-vol').innerHTML = S.muted ? '<span class="g">◂✕</span><span class="ml">MUTED</span>' : '<span class="g">◂))</span><span class="bar"><i></i></span>';
  };
  el('#slw-phead').addEventListener('mouseenter', function () { if (!S.playing) { S.mk = true; el('#slw-markers').style.display = ''; } });
  el('#slw-markers').addEventListener('mouseleave', function () { S.mk = false; el('#slw-markers').style.display = 'none'; });
  Array.prototype.forEach.call(root.querySelectorAll('.slw-ch'), function (n) {
    n.onclick = function () {
      S.chapter = +n.getAttribute('data-ch');
      Array.prototype.forEach.call(root.querySelectorAll('.slw-ch'), function (x) { x.classList.toggle('on', +x.getAttribute('data-ch') === S.chapter); });
      S.mk = false; el('#slw-markers').style.display = 'none';
    };
  });
  el('#slw-like').onclick = function () {
    S.liked = !S.liked;
    el('#slw-like').classList.toggle('on', S.liked);
    el('#slw-likes').textContent = (S.likes + (S.liked ? 1 : 0)).toLocaleString();
    el('#slw-likers').style.display = S.liked ? '' : 'none';
  };
  el('#slw-sub').onclick = function () {
    S.subd = !S.subd;
    var b = el('#slw-sub');
    if (S.subd) { b.className = 'slw-sub notify'; b.textContent = '🔕 Notify me'; }
    else { b.className = 'slw-sub'; b.textContent = 'Subscribe'; }
  };

  /* share */
  function paintShare() {
    var b = el('#slw-share');
    if (S.shared) { b.className = 'slw-share done'; b.innerHTML = '<span class="arm">💪</span> Shared <span class="slw-facepile sharers"><i>JT</i><i>VX</i><i>BK</i></span>'; b.title = 'The creator sees everyone who shared — giveaways run off this list'; }
    else if (S.shareAnim > 0) { b.className = 'slw-share mail'; b.innerHTML = '<span class="box">📬<span class="m1">✉️</span><span class="m2">✉️</span><span class="m3">✉️</span></span> Share it!'; }
    else { b.className = 'slw-share'; b.innerHTML = '⤴ Share'; b.title = ''; }
  }
  el('#slw-share').onclick = function () { S.shared = !S.shared; S.shareAnim = 0; paintShare(); };

  /* tomato */
  function paintTomBtn() {
    if (!SIM) return; /* real mode paints from the sml-lw API (paintTomReal) */
    var active = S.tomWarm > 0 && S.tomLeft > 0;
    var b = el('#slw-tom');
    b.classList.toggle('off', !active);
    el('#slw-tom-lbl').textContent = active ? 'Toss tomato' : '';
    el('#slw-tom-ct').textContent = active ? S.tomLeft + '/3' : (S.tomLeft <= 0 ? 'none left' : 'warm-up over');
    b.title = active ? '' : "Tomatoes open in the 60s warm-up · 3 a stream, 9 a week, they don't stack";
  }
  paintTomBtn();
  el('#slw-tom').onclick = function () {
    if (!(S.tomWarm > 0 && S.tomLeft > 0) || S.tomStage !== 'idle') return;
    S.tomStage = 'compose';
    el('#slw-tom-pop').innerHTML = '<div class="slw-tom-pop"><div class="hd"><b>🍅 TOSS A TOMATO</b><span class="wc" id="slw-twc">warm-up 0:' + String(S.tomWarm).padStart(2, '0') + '</span></div>' +
      '<span class="rules">No sub needed · ' + S.tomLeft + " left this stream · 9 a week max, they don't stack</span>" +
      '<div class="price"><span class="lb">' + TOM_PRICE + ' LB</span><span class="sp">set by the streamer<br>50% to the streamer · 50% to Loop</span></div>' +
      '<input type="text" maxlength="60" id="slw-tnote" placeholder="Pin a note to it — 60 letters max">' +
      '<div class="ft"><span class="cnt" id="slw-tcnt">0/60</span><div class="btns">' +
      '<button class="slw-tom-cancel" id="slw-tcancel">Cancel</button>' +
      '<button class="slw-tom-go" id="slw-tgo">TOSS! 🍅 · ' + TOM_PRICE + ' LB</button></div></div></div>';
    el('#slw-tnote').oninput = function () { el('#slw-tcnt').textContent = el('#slw-tnote').value.length + '/60'; };
    el('#slw-tcancel').onclick = function () { S.tomStage = 'idle'; el('#slw-tom-pop').innerHTML = ''; };
    el('#slw-tgo').onclick = function () {
      S.tomNote = el('#slw-tnote').value.slice(0, 60);
      el('#slw-tom-pop').innerHTML = '';
      S.tomLeft--; S.tomStage = 'fly'; paintTomBtn();
      var layer = el('#slw-tom-layer');
      layer.innerHTML = '<div class="slw-tom-fly"><span>🍅</span></div>';
      setTimeout(function () {
        S.tomStage = 'reveal';
        layer.innerHTML = '<div class="slw-tom-splat"><div class="blob"><div class="b1"></div><div class="d1"></div><div class="d2"></div><span class="tm">🍅</span></div></div>' + tomCard();
        setTimeout(function () {
          var sp = layer.querySelector('.slw-tom-splat');
          if (sp) sp.remove();
        }, 1500);
        setTimeout(function () { S.tomStage = 'idle'; S.tomNote = ''; layer.innerHTML = ''; }, 15000);
      }, 1150);
    };
  };
  function tomCard() {
    var note = S.tomNote.trim() || 'no note — just tomatoes';
    return '<div class="slw-tom-card"><div class="av"><div class="c">YO</div><span class="b">🍅</span></div>' +
      '<div class="tx"><span class="h">@you tossed a tomato</span><span class="n">“' + esc(note) + '”</span></div></div>';
  }

  /* settings menu */
  el('#slw-gear').onclick = function () {
    S.vidSet = !S.vidSet;
    el('#slw-gear').classList.toggle('on', S.vidSet);
    if (!S.vidSet) { el('#slw-menu').innerHTML = ''; return; }
    var resList = [['Auto', 'adaptive'], ['1080p60', 'source'], ['720p60', ''], ['480p', ''], ['360p', '']];
    el('#slw-menu').innerHTML = '<div class="slw-menu"><div class="mh"><b>Settings</b><span>' + (window.__slwSrcNote || 'no source yet') + '</span></div>' +
      '<div class="sec"><span>QUALITY</span></div>' +
      resList.map(function (r, i) {
        return '<div class="row' + (i === S.res ? ' sel' : '') + '" data-res="' + i + '"><span class="ck">✓</span><span class="nm">' + r[0] + '</span><span class="nt">' + r[1] + '</span></div>';
      }).join('') +
      '<div class="sec bt"><span>PLAYBACK</span></div>' +
      '<div class="row2"><span class="l">Playback speed</span><span class="v on">1x</span></div>' +
      '<div class="row2"><span class="l">Captions</span><span class="v">CC off</span></div>' +
      '<div class="row2"><span class="l">Picture-in-picture</span><span class="v">PIP</span></div>' +
      '<div class="sec bt"><span>STREAM</span></div>' +
      '<div class="row2"><span class="l">Save stream</span><span class="v">⊕ Save</span></div>' +
      '<div class="row2"><span class="l">Embed stream</span><span class="v">&lt;/&gt;</span></div>' +
      '<div class="row2"><span class="l">Theater mode</span><span class="v">Off</span></div>' +
      '<div class="row2"><span class="l">Fullscreen</span><span class="v">⛶</span></div></div>';
    Array.prototype.forEach.call(root.querySelectorAll('.slw-menu .row'), function (n) {
      n.onclick = function () { S.res = +n.getAttribute('data-res'); S.vidSet = false; el('#slw-menu').innerHTML = ''; el('#slw-gear').classList.remove('on'); };
    });
  };

  /* tabs */
  function setTab(i) {
    S.tab = i;
    for (var p = 0; p < 5; p++) el('#slw-pane-' + p).style.display = p === i ? '' : 'none';
    Array.prototype.forEach.call(root.querySelectorAll('.slw-tab'), function (b) {
      b.classList.toggle('on', +b.getAttribute('data-tab') === i);
    });
  }
  Array.prototype.forEach.call(root.querySelectorAll('.slw-tab'), function (b) {
    b.addEventListener('click', function () { setTab(+b.getAttribute('data-tab')); });
  });
  setTab(0);

  /* chat interactions */
  var feedEl = el('#slw-feed');
  feedEl.addEventListener('mouseenter', function () { S.chatHold = true; });
  feedEl.addEventListener('mouseleave', function () { S.chatHold = false; });
  root.addEventListener('click', function (e) {
    var rm = e.target.closest && e.target.closest('[data-rm]');
    if (rm) {
      e.preventDefault(); e.stopPropagation();
      var rid = rm.getAttribute('data-rm'); rm.disabled = true; rm.textContent = '…';
      api('/sml-lcm/v1/room/' + HANDLE + '/message/' + encodeURIComponent(rid), { method: 'DELETE' }).then(function (res) {
        if (!res.ok) { rm.disabled = false; rm.textContent = '✕'; rm.title = (res.j && res.j.message) || 'Could not remove'; return; }
        S.msgs = S.msgs.filter(function (m) { return String(m.rawId) !== String(rid); });
        renderFeed();
        el('#slw-chat-empty').style.display = S.msgs.length ? 'none' : '';
      });
      return;
    }
    var th = e.target.closest && e.target.closest('[data-th]');
    if (th) { S.thread = th.getAttribute('data-th'); renderThread(); }
  });

  /* speak flow */
  el('#slw-vreq').onclick = function () {
    S.vStage = 'queued'; S.queuePos = 3; S.vWait = 3;
    el('#slw-vidle').style.display = 'none';
    el('#slw-vqueue').classList.add('show');
    el('#slw-qtier').textContent = TIERS[S.tier][0] + ' pass · ' + TIERS[S.tier][2] + 's';
  };
  el('#slw-vleave').onclick = function () {
    S.vStage = 'idle';
    el('#slw-vidle').style.display = '';
    el('#slw-vqueue').classList.remove('show');
  };

  /* games */
  function paintTTT() {
    var b = el('#slw-ttt');
    b.innerHTML = S.ttt.map(function (m, i) {
      var win = S.tttLine.indexOf(i) >= 0;
      return '<button class="slw-cell' + (m === 'X' ? ' x' : m === 'O' ? ' o' : '') + (win ? ' win' : '') + '" data-cell="' + i + '" aria-label="Cell ' + (i + 1) + (m ? ', taken by ' + m : ', empty') + '">' + (m === 'X' ? '✕' : m === 'O' ? '◯' : '') + '</button>';
    }).join('');
    Array.prototype.forEach.call(b.children, function (c) {
      c.onclick = function () {
        var i = +c.getAttribute('data-cell');
        if (S.gView !== 'match' || S.tttDone || S.tttTurn !== 'X' || S.ttt[i]) return;
        S.ttt[i] = 'X'; S.tttTurn = 'O';
        var r = tttCheck();
        if (r) tttEnd(r); else { paintTTT(); paintTTTStatus(); tttAi(); }
      };
    });
    var yourTurn = S.tttTurn === 'X' && !S.tttDone;
    el('#slw-chipyou').classList.toggle('on', yourTurn);
    el('#slw-chipopp').classList.toggle('on', !yourTurn && !S.tttDone);
  }
  function tttCheck() {
    for (var li = 0; li < TTT_LINES.length; li++) {
      var L = TTT_LINES[li];
      if (S.ttt[L[0]] && S.ttt[L[0]] === S.ttt[L[1]] && S.ttt[L[1]] === S.ttt[L[2]]) return { w: S.ttt[L[0]], line: L };
    }
    if (S.ttt.every(function (x) { return x; })) return { w: 'draw', line: [] };
    return null;
  }
  var gameRecords = { you: [15, 3], tapereader: [9, 7] };
  function tttEnd(r) {
    S.tttDone = r.w; S.tttLine = r.line;
    paintTTT(); paintTTTStatus();
    el('#slw-tbtns').classList.add('show');
    if (S.endedSeq === S.matchSeq) return;
    S.endedSeq = S.matchSeq;
    if (r.w === 'draw') { gameNote('🤝', '@you and @tapereader drew at Tic-Tac-Toe · @you ' + gameRecords.you[0] + 'W–' + gameRecords.you[1] + 'L · @tapereader ' + gameRecords.tapereader[0] + 'W–' + gameRecords.tapereader[1] + 'L', 'm' + S.matchSeq + '-end'); return; }
    if (r.w === 'time') { gameNote('⏱', 'Time! The Tic-Tac-Toe match between @you and @tapereader was voided.', 'm' + S.matchSeq + '-end'); return; }
    var win = r.w === 'X' ? 'you' : 'tapereader', lose = r.w === 'X' ? 'tapereader' : 'you';
    gameRecords[win][0]++; gameRecords[lose][1]++;
    gameNote('🏁', '@' + win + ' beat @' + lose + ' at Tic-Tac-Toe · @you now ' + gameRecords.you[0] + 'W–' + gameRecords.you[1] + 'L · @tapereader ' + gameRecords.tapereader[0] + 'W–' + gameRecords.tapereader[1] + 'L', 'm' + S.matchSeq + '-end');
  }
  function paintTTTStatus() {
    var st = el('#slw-tstat');
    var yourTurn = S.tttTurn === 'X' && !S.tttDone;
    var t = S.tttDone === 'X' ? 'You win the match! 🏁' : S.tttDone === 'O' ? '@tapereader takes it.' : S.tttDone === 'draw' ? 'Draw — nobody blinked.' : S.tttDone === 'time' ? 'Time! Match void.' : (yourTurn ? 'Your move — place an ✕' : '@tapereader is thinking…');
    st.textContent = t;
    st.className = 'slw-ttt-status' + (S.tttDone === 'X' ? ' win' : S.tttDone === 'O' ? ' lose' : '');
    el('#slw-glive').textContent = t;
  }
  function tttAi() {
    setTimeout(function () {
      if (S.gView !== 'match' || S.tttDone || S.tttTurn !== 'O') return;
      var open = [], i;
      for (i = 0; i < 9; i++) if (!S.ttt[i]) open.push(i);
      var pick = -1, marks = ['O', 'X'];
      for (var mi = 0; mi < 2 && pick < 0; mi++) {
        for (var oi = 0; oi < open.length; oi++) {
          var t = S.ttt.slice(); t[open[oi]] = marks[mi];
          for (var li = 0; li < TTT_LINES.length; li++) {
            var L = TTT_LINES[li];
            if (t[L[0] ] && t[L[0]] === t[L[1]] && t[L[1]] === t[L[2]]) { pick = open[oi]; break; }
          }
          if (pick >= 0) break;
        }
      }
      if (pick < 0 && !S.ttt[4]) pick = 4;
      if (pick < 0) pick = open[Math.floor(Math.random() * open.length)];
      S.ttt[pick] = 'O'; S.tttTurn = 'X';
      var r = tttCheck();
      if (r) tttEnd(r); else { paintTTT(); paintTTTStatus(); }
    }, 700);
  }
  function startTTT() {
    S.matchSeq++;
    S.gView = 'match'; S.ttt = ['', '', '', '', '', '', '', '', '']; S.tttTurn = 'X'; S.tttDone = ''; S.tttLine = []; S.tttLeft = 30;
    el('#slw-glob').style.display = 'none';
    el('#slw-gwait').classList.remove('show');
    el('#slw-gmatch').classList.add('show');
    el('#slw-tbtns').classList.remove('show');
    paintTTT(); paintTTTStatus();
    gameNote('▦', '@you challenged @tapereader to Tic-Tac-Toe — 30-second match, live now', 'm' + S.matchSeq + '-start');
  }
  function gLobby() {
    S.gView = 'lobby';
    el('#slw-glob').style.display = '';
    el('#slw-gwait').classList.remove('show');
    el('#slw-gmatch').classList.remove('show');
  }
  Array.prototype.forEach.call(root.querySelectorAll('.slw-gcta, .slw-gjoin'), function (b) {
    b.onclick = function () {
      var i = +b.getAttribute('data-game');
      if (i === 0 && b.classList.contains('slw-gcta')) { startTTT(); return; }
      S.gView = 'wait'; S.gGame = i;
      el('#slw-glob').style.display = 'none';
      el('#slw-gmatch').classList.remove('show');
      el('#slw-gwait').classList.add('show');
      el('#slw-gwname').textContent = GAMES[i][0] + ' table created';
      var bg = el('#slw-gwbadge');
      bg.textContent = GAMES[i][1];
      bg.style.color = GAMES[i][2]; bg.style.background = GACC[GAMES[i][2]];
    };
  });
  el('#slw-gwback').onclick = gLobby;
  el('#slw-gback').onclick = gLobby;
  el('#slw-gforfeit').onclick = gLobby;
  el('#slw-tlobby').onclick = gLobby;
  el('#slw-trematch').onclick = startTTT;

  /* cam scenarios (admin switcher; absent for public viewers) */
  if (el('#slw-scene')) el('#slw-scene').onchange = function () {
    var v = el('#slw-scene').value;
    S.camScene = v;
    el('#slw-cam').classList.toggle('show', v !== 'idle');
    el('#slw-call').classList.toggle('show', v === 'call');
    el('#slw-dial').classList.toggle('show', v === 'dial');
    el('#slw-wait').classList.toggle('show', v === 'wait');
    el('#slw-tabs-plain').style.display = v === 'idle' ? '' : 'none';
  };

  /* qcard sparkline (deterministic series like the design) */
  var Q5 = ['SPY', 'QQQ', 'NVDA', 'VIX', 'TSLA'];
  var QI = { SPY: ['SPDR S&P 500 ETF Trust', 772.18, 0.42, '68.4M'], QQQ: ['Invesco QQQ Trust', 486.31, 0.61, '41.2M'], NVDA: ['NVIDIA Corporation', 128.44, -1.12, '108.7M'], VIX: ['CBOE Volatility Index', 14.82, -3.11, '—'], TSLA: ['Tesla, Inc.', 243.77, 2.04, '92.6M'] };
  var qSym = 'SPY', qHeard = 0;
  el('#slw-qdots').innerHTML = Q5.map(function (s2, i) { return '<button data-q="' + s2 + '"' + (i === 0 ? ' class="on"' : '') + ' title="$' + s2 + '"></button>'; }).join('');
  Array.prototype.forEach.call(root.querySelectorAll('#slw-qdots button'), function (b) {
    b.onclick = function () { qSym = b.getAttribute('data-q'); qHeard = S.tick; paintQ(); };
  });
  function series(sym) {
    var seed = 0, i;
    for (i = 0; i < sym.length; i++) seed = (seed * 31 + sym.charCodeAt(i)) % 997;
    var rnd = function () { seed = (seed * 137 + 71) % 997; return seed / 997 - 0.5; };
    var up = QI[sym][2] >= 0, pts = [], v = 34;
    for (i = 0; i < 40; i++) { v += rnd() * 8 + (up ? -0.28 : 0.28); v = Math.max(6, Math.min(58, v)); pts.push(v); }
    return pts;
  }
  var QR = {}; /* real quote cache per symbol */
  function fmtVol(v) {
    if (v == null || isNaN(v)) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(v);
  }
  function pollQuote() {
    if (SIM || document.hidden) return;
    api('/sml/v1/quote?symbol=' + qSym).then(function (res) {
      var j = res.j || {};
      if (typeof j.current === 'number') { QR[qSym] = j; paintQ(); }
    }).catch(function () {});
  }
  function paintQ() {
    var qi = QI[qSym];
    el('#slw-qsym').textContent = '$' + qSym;
    el('#slw-qname').textContent = qi[0];
    if (!SIM) {
      var r = QR[qSym];
      var up2 = r && r.percentChange >= 0;
      el('#slw-qpx').textContent = r ? r.current.toFixed(2) : '—';
      var c2 = el('#slw-qchg');
      c2.textContent = r ? ((up2 ? '+' : '') + r.percentChange.toFixed(2) + '% ' + (up2 ? '▲' : '▼')) : '—';
      c2.className = 'c' + (r && !up2 ? ' dn' : '');
      el('#slw-qopen').textContent = r && r.open != null ? Number(r.open).toFixed(2) : '—';
      el('#slw-qhigh').textContent = r && r.high != null ? Number(r.high).toFixed(2) : '—';
      el('#slw-qlow').textContent = r && r.low != null ? Number(r.low).toFixed(2) : '—';
      el('#slw-qvol').textContent = r ? fmtVol(r.volume) : '—';
      Array.prototype.forEach.call(root.querySelectorAll('#slw-qdots button'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-q') === qSym);
      });
      return;
    }
    var up = qi[2] >= 0, col = up ? '#00e07a' : '#ff4757';
    var drift = Math.sin(S.tick / 4) * 0.06;
    var px = qi[1] + drift;
    el('#slw-qpx').textContent = px.toFixed(2);
    var chg = el('#slw-qchg');
    chg.textContent = (up ? '+' : '') + qi[2].toFixed(2) + '% ' + (up ? '▲' : '▼');
    chg.className = 'c' + (up ? '' : ' dn');
    el('#slw-qopen').textContent = (px * (1 - qi[2] / 100)).toFixed(2);
    el('#slw-qhigh').textContent = (px * 1.004).toFixed(2);
    el('#slw-qlow').textContent = (px * 0.992).toFixed(2);
    el('#slw-qvol').textContent = qi[3];
    var ser = series(qSym);
    ser[39] = Math.max(6, Math.min(46, ser[39] + Math.sin(S.tick / 1.7) * 3));
    var xy = ser.map(function (v, i) { return (i * (440 / 39)).toFixed(1) + ',' + (v * 0.8).toFixed(1); });
    el('#slw-qline').setAttribute('points', xy.join(' '));
    el('#slw-qline').style.stroke = col;
    el('#slw-qline').style.filter = 'drop-shadow(0 0 4px ' + col + ')';
    el('#slw-qfill').setAttribute('points', xy.join(' ') + ' 440,52 0,52');
    el('#slw-qfill').style.fill = col;
    el('#slw-qheard').textContent = '🎙 Heard "' + qSym.toLowerCase() + '" in the stream audio ' + Math.max(0, S.tick - qHeard) + 's ago';
    Array.prototype.forEach.call(root.querySelectorAll('#slw-qdots button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-q') === qSym);
    });
  }
  paintQ();

  /* ---------- Phase 2: real player (slot playback → YouTube fallback → offline) ---------- */
  var P = { mode: 'none', yt: null, video: null, dur: 0, cur: 0, playing: false, muted: true, ytId: null, hlsUrl: null };
  function qs(name) { var m = location.search.match(new RegExp('[?&]' + name + '=([^&]+)')); return m ? decodeURIComponent(m[1]) : null; }
  var HANDLE = (qs('s') || 'grandmasterobi').replace(/[^A-Za-z0-9_-]/g, '');
  var media = el('#slw-media'), ph = el('#slw-ph');
  /* A schedule is metadata only. It never claims a stream is live; the
     existing feeds endpoint remains the authority for actual playback. */
  var scheduledLive = null;

  /* click shield: clicks on the video toggle play through OUR controls */
  var shield = document.createElement('div');
  shield.style.cssText = 'position:absolute;inset:0;cursor:pointer;z-index:1';
  media.parentNode.insertBefore(shield, media.nextSibling);
  shield.addEventListener('click', function () { if (P.mode !== 'none' && P.mode !== 'multi') togglePlay(); });

  function phState(t1, t2) { ph.classList.remove('hide'); ph.parentNode.classList.remove('clear'); ph.querySelector('.t1').textContent = t1; ph.querySelector('.t2').textContent = t2; }
  function phHide() { ph.classList.add('hide'); ph.parentNode.classList.add('clear'); }
  function clearScheduledPlaceholder() {
    ph.classList.remove('scheduled');
    ph.style.backgroundImage = '';
    ph.style.backgroundSize = '';
    ph.style.backgroundPosition = '';
  }
  function scheduledStartText(value) {
    var at = Date.parse(value || '');
    if (!at) return 'Starting soon';
    return 'Starts ' + new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function showScheduledPlaceholder(info) {
    if (!info || !info.title) return false;
    if (P.mode !== 'none') teardown();
    ph.classList.add('scheduled');
    if (info.thumbnail_url && /^https:\/\//i.test(String(info.thumbnail_url))) {
      ph.style.backgroundImage = 'linear-gradient(180deg,rgba(3,8,14,.28),rgba(3,8,14,.86)),url("' + String(info.thumbnail_url).replace(/"/g, '%22') + '")';
      ph.style.backgroundSize = 'cover';
      ph.style.backgroundPosition = 'center';
    }
    phState('SCHEDULED LIVE', scheduledStartText(info.scheduled_at));
    var heading = root.querySelector('.slw-titleblk h1');
    if (heading) heading.textContent = info.title;
    setSourceNote('scheduled · chat is open');
    el('#slw-viewers').textContent = '—';
    return true;
  }
  function loadScheduledLive() {
    if (!HANDLE) return Promise.resolve(null);
    return fetch('/wp-json/sml-scheduled-live/v1/creator/' + encodeURIComponent(HANDLE), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        scheduledLive = data && data.status === 'scheduled' ? data : null;
        /* A public scheduled room is intentionally open before video starts. */
        paintComposer();
        return scheduledLive;
      })
      .catch(function () { return scheduledLive; });
  }
  function setSourceNote(n) { window.__slwSrcNote = n; var mh = root.querySelector('.slw-menu .mh span'); if (mh) mh.textContent = n; }
  function paintPlayBtn() {
    var b = el('#slw-play');
    b.textContent = P.playing ? '❚❚' : '▶';
    b.classList.toggle('play', !P.playing);
  }
  function paintVolBtn() {
    var v = el('#slw-vol');
    v.className = 'slw-vol' + (P.muted ? ' muted' : '');
    v.innerHTML = P.muted ? '<span class="g">◂✕</span><span class="ml">MUTED · TAP FOR SOUND</span>' : '<span class="g">◂))</span><span class="bar"><i></i></span>';
  }
  function multiCmd(fn) {
    /* drive every screen: postMessage to YT iframes, direct to <video> */
    Array.prototype.forEach.call(media.querySelectorAll('.slw-scr'), function (sc) {
      var isMain = sc.classList.contains('main');
      var ifr = sc.querySelector('iframe'), v = sc.querySelector('video');
      fn(isMain, ifr, v);
    });
  }
  function ytPost(ifr, func, args) {
    if (ifr && ifr.contentWindow) ifr.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*');
  }
  function togglePlay() {
    if (P.mode === 'multi') {
      P.playing = !P.playing;
      multiCmd(function (isMain, ifr, v) { if (ifr) ytPost(ifr, P.playing ? 'playVideo' : 'pauseVideo'); if (v) { P.playing ? v.play().catch(function () {}) : v.pause(); } });
      paintPlayBtn(); return;
    }
    if (P.mode === 'yt' && P.yt) { P.playing ? P.yt.pauseVideo() : P.yt.playVideo(); }
    else if (P.mode === 'slot' && P.video) { P.playing ? P.video.pause() : P.video.play(); }
  }
  function toggleMute() {
    if (P.mode === 'multi') {
      P.muted = !P.muted;
      /* mute toggles the MAIN screen only — side screens stay muted by design */
      multiCmd(function (isMain, ifr, v) { if (!isMain) return; if (ifr) ytPost(ifr, P.muted ? 'mute' : 'unMute'); if (v) v.muted = P.muted; });
      paintVolBtn(); return;
    }
    if (P.mode === 'yt' && P.yt) { P.muted ? P.yt.unMute() : P.yt.mute(); P.muted = !P.muted; }
    else if (P.mode === 'slot' && P.video) { P.video.muted = !P.video.muted; P.muted = P.video.muted; }
    paintVolBtn();
  }
  /* real controls take over the sim buttons once a source mounts */
  el('#slw-play').onclick = function () {
    if (P.mode === 'none') { /* sim */
      S.playing = !S.playing;
      var b = el('#slw-play');
      b.textContent = S.playing ? '❚❚' : '▶';
      b.classList.toggle('play', !S.playing);
      if (S.playing) { S.mk = false; el('#slw-markers').style.display = 'none'; }
      return;
    }
    togglePlay();
  };
  el('#slw-vol').onclick = function () {
    if (P.mode === 'none') {
      S.muted = !S.muted;
      el('#slw-vol').className = 'slw-vol' + (S.muted ? ' muted' : '');
      el('#slw-vol').innerHTML = S.muted ? '<span class="g">◂✕</span><span class="ml">MUTED</span>' : '<span class="g">◂))</span><span class="bar"><i></i></span>';
      return;
    }
    toggleMute();
  };
  /* LIVE LOOP chip snaps to the live edge; progress bar seeks in the DVR window */
  root.querySelector('.slw-loopchip').style.cursor = 'pointer';
  root.querySelector('.slw-loopchip').addEventListener('click', function () {
    if (P.mode === 'yt' && P.yt && P.dur) P.yt.seekTo(P.dur, true);
    else if (P.mode === 'slot' && P.video && P.video.seekable && P.video.seekable.length) P.video.currentTime = P.video.seekable.end(P.video.seekable.length - 1);
  });
  root.querySelector('.slw-prog').addEventListener('click', function (e) {
    if (P.mode === 'none' || !P.dur) return;
    var r = e.currentTarget.getBoundingClientRect();
    var frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    if (P.mode === 'yt' && P.yt) P.yt.seekTo(frac * P.dur, true);
    else if (P.mode === 'slot' && P.video) P.video.currentTime = frac * P.dur;
  });

  function mountYT(id) {
    if (P.mode === 'yt' && P.ytId === id) return;
    teardown();
    clearScheduledPlaceholder();
    P.mode = 'yt'; P.ytId = id;
    media.innerHTML = '<div id="slw-yt"></div>';
    phState('CONNECTING…', 'YouTube Live · ' + id);
    var boot = function () {
      P.yt = new YT.Player('slw-yt', {
        videoId: id,
        playerVars: { autoplay: 1, mute: 1, controls: 0, playsinline: 1, rel: 0, modestbranding: 1, enablejsapi: 1, origin: location.origin },
        events: {
          onReady: function () { phHide(); P.muted = true; paintVolBtn(); setSourceNote('source: YouTube Live'); el('#slw-viewers').textContent = '—'; },
          onStateChange: function (ev) {
            P.playing = ev.data === 1;
            paintPlayBtn();
          },
          onError: function () { teardown(); offline('The stream link did not load.'); }
        }
      });
    };
    if (window.YT && window.YT.Player) boot();
    else {
      window.onYouTubeIframeAPIReady = boot;
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        var s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
      }
    }
  }
  function mountSlot(url) {
    if (P.mode === 'slot' && P.hlsUrl === url) return;
    teardown();
    clearScheduledPlaceholder();
    P.mode = 'slot'; P.hlsUrl = url;
    phState('CONNECTING…', 'Loop stream');
    var v = document.createElement('video');
    v.muted = true; v.autoplay = true; v.playsInline = true;
    media.innerHTML = ''; media.appendChild(v);
    P.video = v;
    v.addEventListener('playing', function () { P.playing = true; phHide(); paintPlayBtn(); setSourceNote('source: Loop stream'); el('#slw-viewers').textContent = '—'; });
    v.addEventListener('pause', function () { P.playing = false; paintPlayBtn(); });
    v.addEventListener('error', function () { teardown(); resolveYT(); });
    var isHls = /\.m3u8($|\?)/.test(url);
    if (isHls && !v.canPlayType('application/vnd.apple.mpegurl')) {
      var go = function () {
        if (window.Hls && window.Hls.isSupported()) { var h = new Hls(); h.loadSource(url); h.attachMedia(v); }
        else v.src = url;
      };
      if (window.Hls) go();
      else { var hs = document.createElement('script'); hs.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js'; hs.onload = go; document.head.appendChild(hs); }
    } else v.src = url;
    P.muted = true; paintVolBtn();
  }
  function teardown() {
    if (P.yt && P.yt.destroy) try { P.yt.destroy(); } catch (e) {}
    P.yt = null; P.video = null; P.mode = 'none'; P.dur = 0; P.playing = false;
    media.innerHTML = '';
  }
  function offline(reason) {
    clearScheduledPlaceholder();
    phState('NOT LIVE RIGHT NOW', (reason ? reason + ' ' : '') + 'Latest streams are below — follow to get the next alert.');
    el('#slw-viewers').textContent = '—';
  }
  var ytResolved = null, ytResolving = false;
  function resolveYT() {
    var forced = qs('yt');
    if (forced) { mountYT(forced.replace(/[^A-Za-z0-9_-]/g, '')); return; }
    if (ytResolved) { mountYT(ytResolved); return; }
    if (ytResolving) return;
    ytResolving = true;
    /* the SEO watch page carries the host's current YouTube Live link — reuse it */
    fetch('/watch/', { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (t) {
      ytResolving = false;
      var m = t.match(/youtube\.com\/(?:live\/|watch\?v=|embed\/)([A-Za-z0-9_-]{8,14})/);
      if (m) {
        ytResolved = m[1];
        /* creator-pinned extra screens ride alongside the resolved primary */
        var extra = (typeof extraScreens === 'function') ? extraScreens() : [];
        if (extra.length) { mountMulti([{ kind: 'yt', id: m[1], label: 'SCREEN 1' }].concat(extra).slice(0, 3)); return; }
        mountYT(m[1]);
      }
      else offline('');
    }).catch(function () { ytResolving = false; offline(''); });
  }
  /* ---------- multi-screen (2–3 sources): one owns audio, tap a side screen to promote ---------- */
  var MS = { on: false, sources: [], mainIdx: 0, layout: 3, key: '' };
  var frameEl = root.querySelector('.slw-frame');
  var LAYOUTS = [3, 2, 1];
  function screenHTML(src, i, isMain) {
    var media = src.kind === 'yt'
      ? '<iframe src="https://www.youtube-nocookie.com/embed/' + esc(src.id) + '?autoplay=1&mute=' + (isMain ? 0 : 1) + '&controls=0&playsinline=1&rel=0&modestbranding=1&enablejsapi=1" allow="autoplay; encrypted-media; picture-in-picture" title="' + esc(src.label) + '"></iframe>'
      : '<video src="' + esc(src.url) + '" autoplay playsinline ' + (isMain ? '' : 'muted ') + '></video>';
    var sideClass = '';
    if (!isMain) { var sideN = 0; for (var k = 0; k < MS.sources.length; k++) { if (k === MS.mainIdx) continue; if (k === i) break; sideN++; } sideClass = sideN === 1 ? ' side2' : ' side1'; }
    return '<div class="slw-scr' + (isMain ? ' main' : sideClass) + '" data-scr="' + i + '">' + media +
      '<span class="tag">' + (isMain ? '<i></i>' : '') + esc(src.label) + '</span>' +
      '<span class="aud">' + (isMain ? '◂)) audio' : 'muted') + '</span>' +
      (isMain ? '' : '<button class="promote" title="Watch this screen big"><span>WATCH BIG ↗</span></button>') + '</div>';
  }
  function mountMulti(sources) {
    var key = sources.map(function (s2) { return s2.kind + ':' + (s2.id || s2.url); }).join('|');
    if (MS.on && MS.key === key) return;
    teardown();
    P.mode = 'multi';
    MS.on = true; MS.key = key; MS.sources = sources;
    if (MS.mainIdx >= sources.length) MS.mainIdx = 0;
    paintMulti();
    phHide();
    setSourceNote('source: ' + sources.length + '-screen stream');
    var lb = el('#slw-laybtn'); if (lb) { lb.classList.add('show'); lb.textContent = 'LAYOUT ' + MS.layout + '-UP'; }
    S.playing = true; P.playing = true; paintPlayBtn();
    /* main starts with audio on (a user gesture opened the page); browsers may still gate it —
       the volume button reads the truth and unmutes on tap */
    P.muted = false; paintVolBtn();
    /* the click shield must not sit over the promote buttons */
    shield.style.display = 'none';
  }
  var _unmountMultiExtra = function () { shield.style.display = ''; };
  function paintMulti() {
    frameEl.classList.add('multi', 'clear');
    frameEl.classList.remove('lay1', 'lay2', 'lay3');
    frameEl.classList.add('lay' + Math.min(MS.layout, MS.sources.length));
    media.innerHTML = MS.sources.map(function (s2, i) { return screenHTML(s2, i, i === MS.mainIdx); }).join('');
    Array.prototype.forEach.call(media.querySelectorAll('.promote'), function (b) {
      b.onclick = function () {
        MS.mainIdx = +b.parentNode.getAttribute('data-scr');
        paintMulti();
      };
    });
  }
  function unmountMulti() {
    if (!MS.on) return;
    MS.on = false; MS.key = '';
    _unmountMultiExtra();
    frameEl.classList.remove('multi', 'lay1', 'lay2', 'lay3');
    var lb = el('#slw-laybtn'); if (lb) lb.classList.remove('show');
    media.innerHTML = '';
    P.mode = 'none';
  }
  /* layout cycle button rides in the control bar */
  (function () {
    var host = root.querySelector('.slw-ctl-l');
    if (!host) return;
    var b = document.createElement('button');
    b.className = 'slw-laybtn'; b.id = 'slw-laybtn'; b.textContent = 'LAYOUT 3-UP';
    host.appendChild(b);
    b.onclick = function () {
      var i = LAYOUTS.indexOf(MS.layout);
      MS.layout = LAYOUTS[(i + 1) % LAYOUTS.length];
      b.textContent = 'LAYOUT ' + MS.layout + '-UP';
      if (MS.on) paintMulti();
    };
  })();
  /* creator-pinned extra screens: media-library-free, stored as WP option via the orbit-style tag trick is
     overkill — for now ?screens=ytid1,ytid2 (admin testing) + slot playbacks; the settings UI lands with P7 */
  function extraScreens() {
    var q2 = qs('screens');
    if (!q2) return [];
    return q2.split(',').map(function (x, i) { x = x.replace(/[^A-Za-z0-9_-]/g, ''); return x ? { kind: 'yt', id: x, label: 'SCREEN ' + (i + 2) } : null; }).filter(Boolean).slice(0, 2);
  }
  var _origTeardown = teardown;
  teardown = function () { unmountMulti(); _origTeardown(); };

  function pollFeeds() {
    fetch('/wp-json/sml-live/v1/feeds/' + HANDLE, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var live = (d && d.live) ? (d.slots || []).filter(function (s2) { return s2.live && s2.playback; }) : [];
        var extra = extraScreens();
        /* multi-screen: 2+ live slots, or a primary + creator-pinned screens */
        if (live.length >= 2 || (live.length >= 1 && extra.length) || (extra.length && (ytResolved || qs('yt')))) {
          var sources = live.slice(0, 3).map(function (s2, i) { return { kind: 'slot', url: s2.playback, label: 'SCREEN ' + (i + 1) }; });
          if (!sources.length) { var yid = qs('yt') || ytResolved; if (yid) sources.push({ kind: 'yt', id: yid.replace(/[^A-Za-z0-9_-]/g, ''), label: 'SCREEN 1' }); }
          sources = sources.concat(extra).slice(0, 3);
          if (sources.length >= 2) { mountMulti(sources); return; }
        }
        if (MS.on) unmountMulti();
        var slot = live[0];
        if (slot) { mountSlot(slot.playback); return; }
        if (P.mode === 'slot') { teardown(); }
        if (showScheduledPlaceholder(scheduledLive)) return;
        clearScheduledPlaceholder();
        if (P.mode === 'none') resolveYT();
      })
      .catch(function () {
        if (showScheduledPlaceholder(scheduledLive)) return;
        clearScheduledPlaceholder();
        if (P.mode === 'none') resolveYT();
      });
  }
  if (window.SML_LW_FORCE_SIM) {
    phState('LIVE STREAM', 'demo frame — the live page at stockmarketloop.com/live carries the real broadcast');
  } else {
    loadScheduledLive().then(pollFeeds);
    setInterval(function () { loadScheduledLive().then(pollFeeds); }, 20000);
  }
  /* real clock + progress once a source is mounted */
  setInterval(function () {
    if (P.mode === 'none') return;
    if (P.mode === 'multi') {
      /* multi: no single seekable timeline — show elapsed watch time, live-edge progress */
      MS.t = (MS.t || 0) + (P.playing ? 1 : 0);
      el('#slw-clock').textContent = hms(MS.t);
      el('#slw-elapsed').textContent = hms(MS.t);
      el('#slw-pfill').style.width = '96%';
      el('#slw-phead').style.left = '96%';
      return;
    }
    var cur = 0, dur = 0;
    if (P.mode === 'yt' && P.yt && P.yt.getCurrentTime) {
      cur = P.yt.getCurrentTime() || 0; dur = P.yt.getDuration() || 0;
      if (!SIM && !P.titleSet && P.yt.getVideoData) {
        var vd = P.yt.getVideoData();
        if (vd && vd.title) { root.querySelector('.slw-titleblk h1').textContent = vd.title; P.titleSet = true; }
      }
    }
    else if (P.mode === 'slot' && P.video) { cur = P.video.currentTime || 0; dur = (P.video.seekable && P.video.seekable.length) ? P.video.seekable.end(P.video.seekable.length - 1) : (P.video.duration || 0); }
    P.cur = cur; P.dur = dur;
    el('#slw-clock').textContent = hms(Math.floor(cur));
    el('#slw-elapsed').textContent = hms(Math.floor(cur));
    if (dur > 0) {
      var pct = Math.max(0, Math.min(100, cur / dur * 100)) * 0.96;
      el('#slw-pfill').style.width = pct.toFixed(2) + '%';
      el('#slw-phead').style.left = pct.toFixed(2) + '%';
    }
  }, 1000);

  /* ---------- Phase 3: real chat + wallet + gates + Q&A ---------- */
  var NONCE = (window.wpApiSettings || {}).nonce || '';
  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = opts.headers || {};
    if (NONCE) opts.headers['X-WP-Nonce'] = NONCE;
    if (opts.body && !opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    return fetch('/wp-json' + path, opts).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; });
    });
  }
  function relTime(s2) {
    var t = Date.parse(String(s2).replace(' ', 'T'));
    if (isNaN(t)) return 'now';
    var d = Math.max(0, (Date.now() - t) / 1000);
    if (d < 60) return 'now';
    if (d < 3600) return Math.floor(d / 60) + 'm';
    if (d < 86400) return Math.floor(d / 3600) + 'h';
    return Math.floor(d / 86400) + 'd';
  }
  if (!SIM) {
    root.classList.add('slw-real');           /* hides sim-only reply/thread affordances */
    el('#slw-tt').style.display = 'none';     /* top threads return when the room has them */
    root.querySelector('.slw-sent').style.display = 'none'; /* sentiment lands with the economy phase */
    el('#slw-chat-empty').style.display = '';
  }
  var seen = {}, chatCursor = '';
  if (!SIM) {
    api('/sml-lcm/v1/room/' + HANDLE + '/me').then(function (res) {
      if (res.ok && res.j) { S.me = parseInt(res.j.uid || 0, 10) || 0; S.canMod = !!res.j.can_moderate; if (S.msgs.length) renderFeed(); }
    }).catch(function () {});
  }
  function mapMsg(m) {
    var name = String(m.handle || m.user || m.name || m.author || 'member').replace(/^@/, '');
    var text = String(m.message || m.text || m.body || '');
    var id = 'r' + String(m.id != null ? m.id : (m.at || m.time || m.created || '') + name + text.slice(0, 12));
    return { id: id, rawId: m.id, uid: parseInt(m.user_id || m.uid || 0, 10) || 0, ini: (m.initials || name.slice(0, 2)).toUpperCase(), h: name, tx: text, at: relTime(m.at || m.time || m.created || ''), replies: [], avatar: m.avatar || m.avatar_url || '' };
  }
  function pollChat() {
    if (SIM || document.hidden || S.chatHold) return;
    /* full-window fetch + client dedupe — the `after` param's semantics are unverified,
       and 50 rows every 2.5s is a trivial payload */
    api('/sml-live-chat/v1/room/' + HANDLE + '/messages?limit=50').then(function (res) {
      var list = (res.j && (res.j.messages || res.j.items)) || [];
      var added = false, liveIds = {}, minId = Infinity;
      list.forEach(function (raw) { if (raw.id != null) { liveIds[String(raw.id)] = 1; var n = parseInt(raw.id, 10); if (n < minId) minId = n; } });
      /* a message that should be inside the server window but isn't any more was removed */
      var beforeN = S.msgs.length;
      S.msgs = S.msgs.filter(function (m) { if (m.rawId == null || m.sys) return true; var n = parseInt(m.rawId, 10); if (!(n >= minId)) return true; return !!liveIds[String(m.rawId)]; });
      if (S.msgs.length !== beforeN) added = true;
      list.forEach(function (raw) {
        var m = mapMsg(raw);
        if (seen[m.id]) return;
        seen[m.id] = 1;
        S.msgs.push(m);
        added = true;
        if (raw.id != null) chatCursor = String(raw.id);
      });
      if (added) { S.msgs = S.msgs.slice(-24); renderFeed(); }
      el('#slw-chat-empty').style.display = S.msgs.length ? 'none' : '';
    }).catch(function () {});
  }
  /* composer: live gate states from the wallet */
  var gateState = null;
  function paintComposer() {
    if (SIM) return;
    var row = el('#slw-gaterow'), input = el('#slw-cin'), btn = el('#slw-csend');
    var g = gateState;
    if (!g) { input.disabled = true; btn.disabled = true; return; }
    if (!g.loggedIn) {
      row.style.display = '';
      row.innerHTML = 'Sign in to join live chat. <a href="/wp-login.php?redirect_to=' + encodeURIComponent(location.pathname + location.search) + '">Sign in</a>';
      input.disabled = true; btn.disabled = true; return;
    }
    /* Scheduling creates an open Watch Page room; Loop Bucks gates still apply
       to the normal non-scheduled Watch Page chat experience. */
    if (scheduledLive) {
      row.style.display = 'none';
      input.disabled = false; btn.disabled = false; return;
    }
    var c = g.chat;
    if (c && !c.open) {
      row.style.display = '';
      row.innerHTML = 'Live chat opens at ' + c.need + ' Loop Bucks — you’re ' + c.short + ' short. <span title="' + esc(c.why || '') + '">How to earn</span>';
      input.disabled = true; btn.disabled = true; return;
    }
    row.style.display = 'none';
    input.disabled = false; btn.disabled = false;
  }
  var sendBusy = false;
  function sendChat() {
    if (SIM || sendBusy) return;
    var input = el('#slw-cin'), v = input.value.trim();
    if (!v) return;
    sendBusy = true;
    el('#slw-csend').textContent = '…';
    var done = function (ok, msg) {
      sendBusy = false;
      el('#slw-csend').textContent = 'Send';
      if (ok) { input.value = ''; chatCursor = ''; pollChat(); }
      else if (msg) {
        var row = el('#slw-gaterow');
        row.style.display = '';
        row.textContent = msg;
        setTimeout(function () { paintComposer(); }, 4000);
      }
    };
    var post = function (body) {
      return api('/sml-live-chat/v1/room/' + HANDLE + '/messages', { method: 'POST', body: JSON.stringify(body) });
    };
    /* `body` is the canonical shared-room field. Older room plugins are
       supported below only as a fallback while they are upgraded. */
    post({ body: v }).then(function (res) {
      if (res.ok) return done(true);
      /* field-name fallback for an older live-chat installation */
      if (res.j && res.j.code === 'sml_empty_message') {
        return post({ message: v }).then(function (r2) {
          if (r2.ok) return done(true);
          return post({ text: v }).then(function (r3) { done(r3.ok, r3.ok ? null : (r3.j && r3.j.message) || 'Message did not send — try again.'); });
        });
      }
      done(false, (res.j && res.j.message) || 'Message did not send — try again.');
    }).catch(function () { done(false, 'Message did not send — check your connection.'); });
  }
  el('#slw-csend').onclick = sendChat;
  el('#slw-cin').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChat(); });
  /* wallet chip + gates (Speak balance, chat gate, Play gate) */
  function loadWallet() {
    api('/sml-lb/v1/gates').then(function (res) {
      var g = res.j || {};
      gateState = { loggedIn: !!g.loggedIn, chat: g.gates && g.gates.live_comment, games: g.gates && g.gates.games };
      paintComposer();
      var pg = el('#slw-pgate');
      if (gateState.games) {
        if (gateState.games.open) { pg.textContent = 'ACCESS UNLOCKED · HOLD 495+ LB'; }
        else {
          pg.textContent = 'HOLD ' + gateState.games.need + '+ LB TO UNLOCK · you’re ' + gateState.games.short + ' short';
          pg.style.color = '#ffb454'; pg.style.borderColor = '#3a2c12'; pg.style.background = '#150f05';
        }
      }
      if (!gateState.loggedIn) { el('#slw-bucks').textContent = '— LB'; return; }
      /* balance AFTER the gate resolves — the /me shape can't distinguish anon from broke */
      api('/sml-lb/v1/me').then(function (res2) {
        if (res2.j && typeof res2.j.balance === 'number') {
          el('#slw-bucks').textContent = res2.j.balance.toLocaleString() + ' LB';
          if (res2.j.rank) el('#slw-prank').innerHTML = 'Rank <b>#' + res2.j.rank + '</b> by Loop Bucks';
        }
      }).catch(function () {});
    }).catch(function () {});
  }
  /* Q&A tab on sml-engage */
  function renderQA(list) {
    var pane = el('#slw-pane-2');
    var rows = (list || []).map(function (q3) {
      var votes = q3.votes != null ? q3.votes : (q3.upvotes != null ? q3.upvotes : 0);
      var text = q3.text || q3.question || q3.body || '';
      var who = q3.who || q3.author || q3.handle || '';
      var st = String(q3.state || q3.status || 'QUEUED').toUpperCase();
      return '<div class="slw-q"><div class="vote"><span class="a">▲</span><span class="n">' + votes + '</span></div><div class="bd"><span class="tx">' + esc(text) + '</span><div class="mt"><span class="who">' + esc(who) + '</span><span class="st ' + st.toLowerCase() + '">' + esc(st) + '</span></div></div></div>';
    }).join('');
    if (!rows) rows = '<div class="slw-chat-empty" style="display:block">No questions yet. Ask the first — the host answers between trades.</div>';
    pane.innerHTML = rows +
      '<div class="slw-q-comp"><input class="cin" id="slw-qin" type="text" maxlength="300" placeholder="Ask the desk a question" autocomplete="off"><button class="slw-send" id="slw-qsend">Ask</button></div>';
    el('#slw-qsend').onclick = askQ;
    el('#slw-qin').addEventListener('keydown', function (e) { if (e.key === 'Enter') askQ(); });
  }
  function askQ() {
    var input = el('#slw-qin'), v = input.value.trim();
    if (!v) return;
    var tryBodies = [{ question: v }, { text: v }, { message: v }], i = 0;
    var attempt = function () {
      if (i >= tryBodies.length) return;
      api('/sml-engage/v1/ask/' + HANDLE, { method: 'POST', body: JSON.stringify(tryBodies[i++]) }).then(function (res) {
        if (res.ok) { input.value = ''; pollQA(true); }
        else if (res.status === 400) attempt();
      }).catch(function () {});
    };
    attempt();
  }
  function pollQA(force) {
    if (SIM || (document.hidden && !force)) return;
    if (S.tab !== 2 && !force) return;
    api('/sml-engage/v1/live/' + HANDLE).then(function (res) {
      if (res.j) renderQA(res.j.questions || []);
    }).catch(function () {});
  }
  if (!SIM) {
    renderQA([]);
    loadWallet();
    pollChat();
    setInterval(pollChat, 2500);
    setInterval(pollQA, 15000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { chatCursor = ''; pollChat(); loadWallet(); if (typeof pollTape === 'function') { pollTape(); pollQuote(); } } });
    Array.prototype.forEach.call(root.querySelectorAll('.slw-tab'), function (b) {
      b.addEventListener('click', function () { if (+b.getAttribute('data-tab') === 2) pollQA(true); });
    });
  }

  /* ---------- Phase 4: economy — real like, tomato API, share, presence ---------- */
  var LIVE_PAGE_ID = 3540; /* /live/ WP page — the like/react target for the stream */
  function loadLikes() {
    if (SIM) return;
    api('/sml-reactions/v1/summary?content_type=long_video&content_id=' + LIVE_PAGE_ID).then(function (res) {
      var j = res.j || {};
      var counts = j.counts || j.totals || j.summary || {};
      var likeN = counts.like != null ? counts.like : (typeof j.like === 'number' ? j.like : null);
      if (likeN != null) el('#slw-likes').textContent = Number(likeN).toLocaleString();
      var mine = j.mine || j.my_reaction || j.user_reaction || '';
      S.liked = mine === 'like';
      el('#slw-like').classList.toggle('on', S.liked);
    }).catch(function () {});
  }
  if (!SIM) {
    el('#slw-likes').textContent = '0';
    el('#slw-likers').style.display = 'none';
    el('#slw-like').onclick = function () {
      api('/sml-reactions/v1/react', { method: 'POST', body: JSON.stringify({ content_type: 'long_video', content_id: LIVE_PAGE_ID, reaction: 'like' }) })
        .then(function (res) {
          if (res.ok) { S.liked = !S.liked; el('#slw-like').classList.toggle('on', S.liked); loadLikes(); }
          else if (res.status === 401) flashGate('Sign in to like the stream.');
        }).catch(function () {});
    };
    loadLikes();
  }
  function flashGate(msg) {
    var row = el('#slw-gaterow');
    row.style.display = '';
    row.textContent = msg;
    setTimeout(function () { paintComposer(); }, 4000);
  }
  /* tomato: real allowances + debit through the sml-lw API (deploys with the api snippet) */
  var TOM = { price: TOM_PRICE, open: false, left: 0, ready: false };
  function loadTomato() {
    if (SIM) return;
    api('/sml-lw/v1/tomato/state?handle=' + HANDLE).then(function (res) {
      if (!res.ok || !res.j || res.j.code) { paintTomReal(); return; } /* api snippet not pasted yet */
      TOM.ready = true;
      TOM.price = res.j.price || TOM_PRICE;
      TOM.open = !!res.j.open;
      TOM.left = res.j.leftStream || 0;
      TOM.leftWeek = res.j.leftWeek;
      TOM.loggedIn = !!res.j.loggedIn;
      paintTomReal();
    }).catch(function () { paintTomReal(); });
  }
  function paintTomReal() {
    if (SIM) return;
    var b = el('#slw-tom');
    if (!TOM.ready) {
      b.classList.add('off');
      el('#slw-tom-lbl').textContent = '';
      el('#slw-tom-ct').textContent = 'soon';
      b.title = 'Tomatoes arrive with the API snippet.';
      return;
    }
    b.classList.toggle('off', !TOM.open);
    el('#slw-tom-lbl').textContent = TOM.open ? 'Toss tomato' : '';
    el('#slw-tom-ct').textContent = TOM.open ? TOM.left + '/3' : (TOM.leftWeek === 0 ? '9/9 this week' : (TOM.loggedIn ? 'none left · 3 of 3 tossed' : 'sign in'));
    b.title = TOM.open ? '' : "3 a stream, 9 a week, they don't stack";
  }
  if (!SIM) {
    el('#slw-tom').onclick = function () {
      if (!TOM.ready || !TOM.open || S.tomStage !== 'idle') return;
      S.tomStage = 'compose';
      el('#slw-tom-pop').innerHTML = '<div class="slw-tom-pop"><div class="hd"><b>🍅 TOSS A TOMATO</b><span class="wc">' + TOM.left + ' left</span></div>' +
        '<span class="rules">No sub needed · ' + TOM.left + " left this stream · 9 a week max, they don't stack</span>" +
        '<div class="price"><span class="lb">' + TOM.price.toLocaleString() + ' LB</span><span class="sp">set by the streamer<br>50% to the streamer · 50% to Loop</span></div>' +
        '<input type="text" maxlength="60" id="slw-tnote" placeholder="Pin a note to it — 60 letters max">' +
        '<div class="ft"><span class="cnt" id="slw-tcnt">0/60</span><div class="btns">' +
        '<button class="slw-tom-cancel" id="slw-tcancel">Cancel</button>' +
        '<button class="slw-tom-go" id="slw-tgo">TOSS! 🍅 · ' + TOM.price.toLocaleString() + ' LB</button></div></div></div>';
      el('#slw-tnote').oninput = function () { el('#slw-tcnt').textContent = el('#slw-tnote').value.length + '/60'; };
      el('#slw-tcancel').onclick = function () { S.tomStage = 'idle'; el('#slw-tom-pop').innerHTML = ''; };
      el('#slw-tgo').onclick = function () {
        var note = el('#slw-tnote').value.slice(0, 60);
        el('#slw-tgo').disabled = true;
        api('/sml-lw/v1/tomato', { method: 'POST', body: JSON.stringify({ handle: HANDLE, note: note }) }).then(function (res) {
          el('#slw-tom-pop').innerHTML = '';
          S.tomStage = 'idle';
          if (res.ok && res.j && res.j.ok) {
            TOM.left = res.j.leftStream; TOM.open = TOM.left > 0 && res.j.leftWeek > 0;
            paintTomReal();
            S.tomNote = note;
            playTomato(note);
            el('#slw-bucks').textContent = Number(res.j.balance).toLocaleString() + ' LB';
            pollChat();
          } else {
            flashGate((res.j && res.j.message) || 'The tomato did not fly — try again.');
          }
        }).catch(function () { el('#slw-tom-pop').innerHTML = ''; S.tomStage = 'idle'; flashGate('The tomato did not fly — check your connection.'); });
      };
    };
    loadTomato();
  }
  function playTomato(note) {
    var layer = el('#slw-tom-layer');
    layer.innerHTML = '<div class="slw-tom-fly"><span>🍅</span></div>';
    setTimeout(function () {
      layer.innerHTML = '<div class="slw-tom-splat"><div class="blob"><div class="b1"></div><div class="d1"></div><div class="d2"></div><span class="tm">🍅</span></div></div>' + tomCard();
      setTimeout(function () { var sp = layer.querySelector('.slw-tom-splat'); if (sp) sp.remove(); }, 1500);
      setTimeout(function () { layer.innerHTML = ''; S.tomNote = ''; }, 15000);
    }, 1150);
  }
  /* share: web-share / copy-link, morph animation preserved */
  if (!SIM) {
    el('#slw-share').onclick = function () {
      var url = location.origin + '/live/';
      var after = function () { S.shared = true; S.shareAnim = 0; paintShare(); el('#slw-share').querySelector('.slw-facepile') && (el('#slw-share').querySelector('.slw-facepile').style.display = 'none'); };
      if (navigator.share) navigator.share({ title: 'Live on Stock Market Loop', url: url }).then(after).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { after(); flashGate('Stream link copied — paste it anywhere.'); });
    };
  }
  /* presence: heartbeat while watching; real viewer count */
  function beat() {
    if (SIM || document.hidden) return;
    api('/sml-lw/v1/presence', { method: 'POST', body: JSON.stringify({ handle: HANDLE }) }).then(function (res) {
      if (res.ok && res.j && typeof res.j.count === 'number' && res.j.count > 0) el('#slw-viewers').textContent = res.j.count.toLocaleString();
    }).catch(function () {});
  }
  function pollPresence() {
    if (SIM || document.hidden) return;
    api('/sml-lw/v1/presence?handle=' + HANDLE).then(function (res) {
      if (res.ok && res.j && typeof res.j.count === 'number' && res.j.count > 0) el('#slw-viewers').textContent = res.j.count.toLocaleString();
    }).catch(function () {});
  }
  if (!SIM) {
    beat();
    setInterval(beat, 45000);
    setInterval(pollPresence, 20000);
  }

  /* ---------- Phase 5: Speak tab on the real voice engine (sml-voice) ---------- */
  var VC = { elig: null, tierSlug: 'silver', busy: false, micStream: null, micRaf: 0 };
  function vErr(msg) {
    var b = el('#slw-vidle');
    var e2 = b.querySelector('.slw-verr');
    if (!e2) { e2 = document.createElement('div'); e2.className = 'slw-verr'; b.insertBefore(e2, b.firstChild); }
    e2.textContent = msg;
    setTimeout(function () { if (e2.parentNode) e2.parentNode.removeChild(e2); }, 6000);
  }
  function vForm(bodyObj, path) {
    var body = Object.keys(bodyObj).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(bodyObj[k]); }).join('&');
    return fetch('/wp-json' + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-WP-Nonce': NONCE }, body: body })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); });
  }
  function renderSpeakReal() {
    var e2 = VC.elig;
    if (!e2) return;
    /* tier rows from the live engine */
    var wrap = el('#slw-tiers');
    wrap.innerHTML = (e2.tiers || []).map(function (t) {
      var locked = !t.loop_bucks; /* sponsor tier: cash-priced, invite only */
      var on = t.slug === VC.tierSlug;
      var note = (t.priority ? 'Priority ' + t.priority : 'Standard queue') + (t.members_only ? ' · members only' : '');
      var cost = locked ? ('$' + Math.round((t.amount_cents || 0) / 100) + ' · invite only') : t.loop_bucks.toLocaleString() + ' LB';
      return '<div class="slw-tier' + (on ? ' on' : '') + (locked ? ' locked' : '') + '" data-slug="' + t.slug + '"><div class="l"><span class="dot"></span>' +
        '<div style="display:flex;flex-direction:column;gap:4px"><span class="nm">' + esc(t.label) + '</span><span class="nt">' + esc(note) + '</span></div></div>' +
        '<div class="r"><span class="pr">' + cost + '</span><span class="sc">' + t.seconds + 's on air</span></div></div>';
    }).join('');
    Array.prototype.forEach.call(wrap.children, function (n) {
      n.onclick = function () {
        var slug = n.getAttribute('data-slug');
        var t = (e2.tiers || []).filter(function (x) { return x.slug === slug; })[0];
        if (!t || !t.loop_bucks) return;
        VC.tierSlug = slug;
        renderSpeakReal();
      };
    });
    var t = (e2.tiers || []).filter(function (x) { return x.slug === VC.tierSlug; })[0];
    if (t) el('#slw-vreq').textContent = 'Request to speak · ' + t.loop_bucks.toLocaleString() + ' LB';
    /* stage */
    var idle = el('#slw-vidle'), qv = el('#slw-vqueue');
    if (e2.banned) { idle.style.display = ''; qv.classList.remove('show'); vErr('You are blocked from the voice line' + (e2.ban_reason ? ': ' + e2.ban_reason : '.')); return; }
    if (e2.queue_position > 0) {
      idle.style.display = 'none';
      qv.classList.add('show');
      el('#slw-qpos').textContent = '#' + e2.queue_position;
      var tt = (e2.tiers || []).filter(function (x) { return x.slug === VC.tierSlug; })[0];
      el('#slw-qtier').textContent = (tt ? tt.label : 'Voice') + ' pass' + (tt ? ' · ' + tt.seconds + 's' : '');
      startMic();
    } else {
      idle.style.display = '';
      qv.classList.remove('show');
      stopMic();
    }
  }
  function loadElig() {
    if (SIM || document.hidden) return;
    api('/sml-voice/v1/eligibility?room_id=' + HANDLE).then(function (res) {
      if (res.j && typeof res.j.logged_in !== 'undefined') { VC.elig = res.j; renderSpeakReal(); }
    }).catch(function () {});
  }
  function buyAndRequest() {
    if (VC.busy || !VC.elig) return;
    if (!VC.elig.logged_in) { vErr('Sign in to request the mic.'); return; }
    VC.busy = true;
    el('#slw-vreq').disabled = true;
    var finish = function (msg) {
      VC.busy = false;
      el('#slw-vreq').disabled = false;
      if (msg) vErr(msg);
      loadElig();
    };
    /* reuse an unused pass when one exists, else buy the tier pass */
    var tok = (VC.elig.tokens || []).filter(function (x) { return (x.tier || x.slug) === VC.tierSlug && !x.used; })[0];
    var reqWith = function (token) {
      vForm({ room_id: HANDLE, token: token || '', pass: token || '' }, '/sml-voice/v1/request').then(function (res) {
        if (res.ok) finish();
        else finish((res.j && res.j.message) || 'The request did not go through.');
      }).catch(function () { finish('The request did not go through — check your connection.'); });
    };
    if (tok && (tok.token || tok.key || tok.id)) { reqWith(tok.token || tok.key || tok.id); return; }
    vForm({ room_id: HANDLE, tier: VC.tierSlug }, '/sml-voice/v1/superchat').then(function (res) {
      if (!res.ok) { finish((res.j && res.j.message) || 'Could not buy the pass.'); return; }
      var j = res.j || {};
      var token = j.token || j.pass || (j.pass_id != null ? j.pass_id : '') || (j.id != null ? j.id : '');
      loadWallet();
      reqWith(token);
    }).catch(function () { finish('Could not buy the pass — check your connection.'); });
  }
  function cancelVoice() {
    vForm({ room_id: HANDLE, queue_id: (VC.elig && VC.elig.queue_id) || '' }, '/sml-voice/v1/cancel').then(function () { stopMic(); loadElig(); loadWallet(); });
  }
  /* real mic meter + readiness */
  function startMic() {
    if (VC.micStream || !navigator.mediaDevices) return;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
      VC.micStream = stream;
      vForm({ room_id: HANDLE, ready: 1 }, '/sml-voice/v1/mic-ready');
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var src = ctx.createMediaStreamSource(stream);
      var an = ctx.createAnalyser();
      an.fftSize = 64;
      src.connect(an);
      var data = new Uint8Array(an.frequencyBinCount);
      var bars = root.querySelectorAll('#slw-micbars i');
      var tick2 = function () {
        if (!VC.micStream) return;
        an.getByteFrequencyData(data);
        for (var i = 0; i < bars.length; i++) {
          var v = data[Math.floor(i * data.length / bars.length)] / 255;
          bars[i].style.height = (4 + v * 18).toFixed(1) + 'px';
        }
        VC.micRaf = requestAnimationFrame(tick2);
      };
      tick2();
    }).catch(function () {
      vErr('Your mic is blocked. Allow the microphone in your browser, then request again.');
    });
  }
  function stopMic() {
    if (VC.micRaf) cancelAnimationFrame(VC.micRaf);
    VC.micRaf = 0;
    if (VC.micStream) { VC.micStream.getTracks().forEach(function (t) { t.stop(); }); VC.micStream = null; }
  }
  /* queue-driven "requested to speak" strip — visible to every viewer, per the design */
  function pollVoiceQueue() {
    if (SIM || document.hidden) return;
    api('/sml-voice/v1/queue?room_id=' + HANDLE).then(function (res) {
      var q2 = (res.j && res.j.queue) || [];
      var w = el('#slw-wait');
      if (q2.length && S.camScene === 'idle') {
        var first = q2[0] || {};
        var who = first.handle || first.user || first.name || 'a viewer';
        w.querySelector('.tx').innerHTML = '<b>@' + esc(String(who).replace(/^@/, '')) + '</b> requested to speak · waiting for the host — the stream keeps rolling';
        w.querySelector('.av').textContent = String(who).replace(/^@/, '').slice(0, 2).toUpperCase();
        w.classList.add('show');
      } else if (S.camScene === 'idle') {
        w.classList.remove('show');
      }
    }).catch(function () {});
  }
  if (!SIM) {
    el('#slw-vreq').onclick = buyAndRequest;
    el('#slw-vleave').onclick = function () { cancelVoice(); };
    loadElig();
    setInterval(loadElig, 6000);
    setInterval(pollVoiceQueue, 6000);
    pollVoiceQueue();
  }

  /* ---------- Phase 6: Play tab on the real games service (sml-games) ---------- */
  var G = { mode: 'lobby', tableId: 0, version: -1, game: '', practice: false, catalogue: [], pollT: 0 };
  var GLYPHS = { tictactoe: ['✕◯', '#00ff88'], connect4: ['●●', '#00ccff'], checkers: ['◉', '#ff7a45'], chess: ['♞', '#c7d6e3'], spades: ['♠', '#7d8cff'], blackjack: ['♣', '#ffb454'] };
  function sendArena(glyph, text, eid) {
    /* one deterministic poster per event id keeps the room single-voiced */
    if (!gateState || !gateState.loggedIn) return;
    api('/sml-live-chat/v1/room/' + HANDLE + '/messages', { method: 'POST', body: JSON.stringify({ message: glyph + ' ' + text }) }).then(function () { pollChat(); }).catch(function () {});
  }
  function renderLobbyReal(j) {
    G.catalogue = j.catalogue || [];
    var scoresYou = {};
    (j.scores || []).forEach(function (s2) { if (s2 && s2.game) scoresYou[s2.game] = s2; });
    el('#slw-glob').innerHTML =
      '<div class="slw-gtiles">' + G.catalogue.map(function (g) {
        var gl = GLYPHS[g.key] || ['▦', '#8fa3b5'];
        var rec = scoresYou[g.key];
        var recTx = rec ? ((rec.wins || 0) + 'W · ' + (rec.losses || 0) + 'L') : 'no matches yet';
        return '<div class="slw-gtile"><div class="top"><span class="slw-gbadge" style="color:' + gl[1] + ';background:' + (GACC[gl[1]] || '#0b1119') + ';text-shadow:0 0 8px ' + gl[1] + '66">' + gl[0] + '</span><span class="lv">' + g.seats + ' seats</span></div>' +
          '<span class="nm">' + esc(g.label) + '</span><span class="mt">' + esc(g.blurb || '') + '</span><span class="rec">' + recTx + '</span>' +
          '<button class="slw-gcta' + (g.key === 'tictactoe' ? ' primary' : '') + '" data-gkey="' + g.key + '">' + (g.key === 'tictactoe' ? 'Quick play' : 'Open a table') + '</button></div>';
      }).join('') + '</div>' +
      '<div class="slw-gopen"><div class="hd"><b>OPEN TABLES</b><span style="font:500 9px/1 \'IBM Plex Mono\',monospace;color:#5d7085">' + (j.tables || []).length + ' open</span></div>' +
      ((j.tables || []).filter(function (t) { return t.status === 'waiting'; }).map(function (t) {
        var gl = GLYPHS[t.game] || ['▦', '#8fa3b5'];
        var host = (t.players || []).map(function (p) { return p && (p.handle || p.name); }).filter(Boolean)[0] || 'open seat';
        return '<div class="slw-gtable"><div class="l"><span class="bg" style="color:' + gl[1] + ';background:' + (GACC[gl[1]] || '#0b1119') + '">' + gl[0] + '</span><div class="bd"><span class="nm">' + esc(t.label || t.game) + ' · ' + (t.players || []).length + '/' + (t.seatCount || 2) + ' seats</span><span class="hs">@' + esc(String(host).replace(/^@/, '')) + '</span></div></div><button class="slw-gjoin" data-join="' + t.id + '">Join</button></div>';
      }).join('') || '<div class="slw-chat-empty" style="display:block">No open tables — start one and the room sees it.</div>') + '</div>';
    Array.prototype.forEach.call(el('#slw-glob').querySelectorAll('.slw-gcta'), function (b) {
      b.onclick = function () { startServerGame(b.getAttribute('data-gkey')); };
    });
    Array.prototype.forEach.call(el('#slw-glob').querySelectorAll('.slw-gjoin'), function (b) {
      b.onclick = function () { joinTable(+b.getAttribute('data-join')); };
    });
  }
  function loadLobby() {
    if (SIM || document.hidden || S.tab !== 4 || G.mode !== 'lobby') return;
    api('/sml-games/v1/lobby').then(function (res) { if (res.j && res.j.catalogue) renderLobbyReal(res.j); }).catch(function () {});
  }
  function gShow(view) {
    el('#slw-glob').style.display = view === 'lobby' ? '' : 'none';
    el('#slw-gwait').classList.toggle('show', view === 'wait');
    el('#slw-gmatch').classList.toggle('show', view === 'match');
    G.mode = view;
  }
  function startServerGame(key) {
    vFormG('/sml-games/v1/matchmake', { game: key }).then(function (res) {
      if (!res.ok) { gErr((res.j && res.j.message) || 'Could not open a table.'); return; }
      var t = (res.j && (res.j.table || res.j)) || {};
      if (t.id) { adoptTable(t); }
      else { api('/sml-games/v1/lobby').then(function (r2) {
        var mine = ((r2.j && r2.j.tables) || []).filter(function (x) { return x.yourSeat != null && x.yourSeat !== false; })[0];
        if (mine) adoptTable(mine); else gErr('The table did not open — try again.');
      }); }
    }).catch(function () { gErr('Could not reach the games desk.'); });
  }
  function joinTable(id) {
    vFormG('/sml-games/v1/tables/' + id + '/join', {}).then(function (res) {
      if (!res.ok) { gErr((res.j && res.j.message) || 'Could not join that table.'); return; }
      adoptTable((res.j && (res.j.table || res.j)) || { id: id });
    });
  }
  function vFormG(path, bodyObj) {
    var body = Object.keys(bodyObj).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(bodyObj[k]); }).join('&');
    return fetch('/wp-json' + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-WP-Nonce': NONCE }, body: body })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }, function () { return { ok: r.ok, status: r.status, j: null }; }); });
  }
  function gErr(msg) { el('#slw-glive').textContent = msg; flashGate(msg); }
  function adoptTable(t) {
    G.tableId = t.id; G.game = t.game || G.game; G.version = -1; G.practice = false;
    clearInterval(G.pollT);
    G.pollT = setInterval(pollTable, 1500);
    paintTable(t);
    pollTable();
  }
  function leaveTable() {
    clearInterval(G.pollT);
    if (G.tableId && !G.practice) vFormG('/sml-games/v1/tables/' + G.tableId + '/leave', {});
    G.tableId = 0; G.practice = false;
    gShow('lobby');
    loadLobby();
  }
  function pollTable() {
    if (!G.tableId || document.hidden) return;
    api('/sml-games/v1/tables/' + G.tableId).then(function (res) {
      var t = res.j && (res.j.table || res.j);
      if (!t || !t.id) { leaveTable(); return; }
      if (t.version === G.version) return;
      G.version = t.version;
      paintTable(t);
    }).catch(function () {});
  }
  function paintTable(t) {
    var st = t.status || 'waiting';
    if (st === 'waiting') {
      gShow('wait');
      el('#slw-gwname').textContent = (t.label || t.game || 'Table') + ' table created';
      var gl = GLYPHS[t.game] || ['▦', '#8fa3b5'];
      var bg = el('#slw-gwbadge');
      bg.textContent = gl[0]; bg.style.color = gl[1]; bg.style.background = GACC[gl[1]] || '#0b1119';
      var codeEl = el('#slw-gwait').querySelector('.code b');
      if (codeEl && t.joinCode) codeEl.textContent = t.joinCode;
      if (t.canStart) {
        var wrap = el('#slw-gwait');
        if (!wrap.querySelector('.slw-gstart')) {
          var sb = document.createElement('button');
          sb.className = 'slw-rematch slw-gstart';
          sb.textContent = 'Start the match';
          sb.onclick = function () { vFormG('/sml-games/v1/tables/' + G.tableId + '/start', {}).then(pollTable); };
          wrap.insertBefore(sb, wrap.querySelector('#slw-gwback'));
        }
      }
      return;
    }
    if (t.game === 'tictactoe') { gShow('match'); paintServerTTT(t); return; }
    /* non-TTT boards land next update — the table itself is live */
    gShow('wait');
    el('#slw-gwname').textContent = (t.label || t.game) + ' — match running';
    el('#slw-gwait').querySelector('.n').textContent = 'The board UI for this game lands in the next update. The table is live on the server.';
  }
  function paintServerTTT(t) {
    var cells = [];
    var raw = t.state;
    if (raw && raw.board) raw = raw.board;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    for (var i = 0; i < 9; i++) {
      var v = raw && raw[i] != null ? raw[i] : '';
      if (v === 0 || v === '0') v = t.yourSeat === 0 ? 'X' : 'O';
      else if (v === 1 || v === '1') v = t.yourSeat === 1 ? 'X' : 'O';
      cells.push(v === 'X' || v === 'x' ? 'X' : (v === 'O' || v === 'o' ? 'O' : ''));
    }
    var b = el('#slw-ttt');
    b.innerHTML = cells.map(function (m, i) {
      return '<button class="slw-cell' + (m === 'X' ? ' x' : m === 'O' ? ' o' : '') + '" data-scell="' + i + '">' + (m === 'X' ? '✕' : m === 'O' ? '◯' : '') + '</button>';
    }).join('');
    Array.prototype.forEach.call(b.children, function (c) {
      c.onclick = function () {
        if (!t.yourTurn || t.winner != null && t.winner !== '') return;
        var i = +c.getAttribute('data-scell');
        if (cells[i]) return;
        var attempt = function (names, k) {
          if (k >= names.length) return;
          var body = {}; body[names[k]] = i;
          vFormG('/sml-games/v1/tables/' + G.tableId + '/move', body).then(function (res) {
            if (res.ok) { pollTable(); }
            else if (res.status === 400) attempt(names, k + 1);
            else gErr((res.j && res.j.message) || 'Move refused.');
          });
        };
        attempt(['move', 'cell', 'index', 'position'], 0);
      };
    });
    el('#slw-tclk').style.display = 'none'; /* server owns timing */
    var opp = (t.players || []).filter(function (p) { return p && p.handle && p.handle !== ((VC.elig && VC.elig.handle) || ''); }).map(function (p) { return p.handle; });
    el('#slw-chipopp').querySelector('.n').textContent = '@' + String(opp[opp.length - 1] || 'opponent').replace(/^@/, '');
    var stat = el('#slw-tstat');
    var done = t.winner != null && t.winner !== '';
    el('#slw-tbtns').classList.toggle('show', done);
    el('#slw-chipyou').classList.toggle('on', !!t.yourTurn && !done);
    el('#slw-chipopp').classList.toggle('on', !t.yourTurn && !done);
    if (done) {
      var meWon = t.winner === 'you' || t.winner === t.yourSeat || (t.winner && t.winner.id && VC.elig && t.winner.id === VC.elig.user_id);
      stat.textContent = t.winner === 'draw' ? 'Draw — nobody blinked.' : (meWon ? 'You win the match! 🏁' : 'They take it.');
      stat.className = 'slw-ttt-status' + (meWon ? ' win' : t.winner === 'draw' ? '' : ' lose');
      if (meWon) sendArena('🏁', 'won a Tic-Tac-Toe match in the arena', 'm' + G.tableId + '-end');
      clearInterval(G.pollT);
      api('/sml-games/v1/scores').then(function () {});
    } else {
      stat.textContent = t.yourTurn ? 'Your move — place an ✕' : 'Waiting on the other seat…';
      stat.className = 'slw-ttt-status';
    }
  }
  if (!SIM) {
    /* rebind lobby/match chrome; practice bot stays available through the sim engine */
    el('#slw-gwback').onclick = leaveTable;
    el('#slw-gback').onclick = leaveTable;
    el('#slw-gforfeit').onclick = leaveTable;
    el('#slw-tlobby').onclick = leaveTable;
    el('#slw-trematch').onclick = function () { if (G.game) startServerGame(G.game); };
    Array.prototype.forEach.call(root.querySelectorAll('.slw-tab'), function (b) {
      b.addEventListener('click', function () { if (+b.getAttribute('data-tab') === 4) loadLobby(); });
    });
    setInterval(loadLobby, 10000);
  }

  /* ---------- Phase 7: public hardening — no sample content in real mode ---------- */
  var QUOTES_URL = 'https://stockmarketloop-loop-kick.onrender.com/api/quotes';
  function pollTape() {
    if (SIM || document.hidden) return;
    var syms = TAPE.map(function (q) { return q[0]; });
    fetch(QUOTES_URL + '?symbols=' + encodeURIComponent(syms.join(',')), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.quotes) return;
      Array.prototype.forEach.call(root.querySelectorAll('.slw-tq[data-sym]'), function (cell) {
        var q = d.quotes[cell.getAttribute('data-sym')];
        if (!q) return;
        /* the Render service serves a flat {last,pct}; raw polygon nests lastTrade.p */
        var last = q.last != null ? q.last : (q.lastTrade && q.lastTrade.p);
        var pct = q.pct != null ? q.pct : q.todaysChangePerc;
        if (last != null) cell.querySelector('.p').textContent = Number(last).toFixed(2);
        if (pct != null) {
          var c = cell.querySelector('.c');
          c.textContent = (pct >= 0 ? '+' : '') + Number(pct).toFixed(2) + '%';
          c.className = 'c' + (pct < 0 ? ' dn' : '');
        }
      });
    }).catch(function () {});
  }
  function hardenPublic() {
    if (SIM) return;
    /* sample-only modules go dark until their real sources exist */
    root.querySelector('.slw-pinned').style.display = 'none';               /* no pin backend yet */
    el('#slw-pmarks').style.display = 'none';                              /* sample chapter marks */
    root.querySelector('.slw-orbit-sec').style.display = 'none';           /* photos land with creator settings */
    /* qcard: honest fields only */
    root.querySelector('.slw-qcard svg').style.display = 'none';           /* synthetic sparkline */
    root.querySelector('.slw-qcard-x').style.display = 'none';
    root.querySelector('.slw-qcard').style.height = 'auto';
    root.querySelector('.slw-vsync span:last-child').textContent = 'DESK FOCUS';
    el('#slw-qheard').textContent = '🎙 Tap a dot to switch the desk ticker';
    /* title block: real identity, no sample episode */
    root.querySelector('.slw-titleblk .ep span').textContent = 'LIVE FROM THE DESK';
    root.querySelector('.slw-titleblk h1').textContent = 'Live on Stock Market Loop';
    root.querySelector('.slw-titleblk .who .nm').textContent = '';
    /* about card: real creator fills in; sample bio/followers/affiliates hidden */
    root.querySelector('.slw-about-desc').style.display = 'none';
    root.querySelector('.slw-affrow').style.display = 'none';
    el('#slw-sub').style.display = 'none';                                 /* follow backend lands with P7 settings */
    root.querySelector('.slw-about-id .fo').textContent = '';
    /* boost: live arena on the sml-lw boost routes */
    initBoostReal();
    /* recommended: real uploads or nothing */
    loadRec();
    pollTape();
    pollQuote();
    setInterval(pollTape, 15000);
    setInterval(pollQuote, 8000);
    Array.prototype.forEach.call(root.querySelectorAll('#slw-qdots button'), function (b) {
      b.addEventListener('click', pollQuote);
    });
  }
  function loadRec() {
    var mount = el('#slw-rec-rows');
    el('#slw-recmeta').textContent = '';
    api('/sml-media/v1/feed').then(function (res) {
      var items = (res.j && (res.j.items || res.j.feed || res.j.media)) || [];
      if (!items.length) throw new Error('empty');
      renderRecReal(items.slice(0, 5).map(function (it) {
        return { title: it.title || it.caption || 'Watch', url: it.url || it.link || it.permalink || '#', thumb: it.thumbnail || it.thumb || it.image || '', meta: it.author || it.handle || '' };
      }));
    }).catch(function () {
      fetch('/wp-json/wp/v2/posts?per_page=5&_fields=title,link,date', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (posts) {
        if (!posts || !posts.length) { root.querySelector('.slw-rec').style.display = 'none'; return; }
        renderRecReal(posts.map(function (p) {
          return { title: (p.title && p.title.rendered) || 'Read', url: p.link, thumb: '', meta: (p.date || '').slice(0, 10) };
        }));
      }).catch(function () { root.querySelector('.slw-rec').style.display = 'none'; });
    });
  }
  function renderRecReal(items) {
    el('#slw-rec-rows').innerHTML = items.map(function (v) {
      return '<a class="slw-rv" href="' + esc(v.url) + '" style="text-decoration:none"><div class="th"><div class="ar"></div><div class="ph"' + (v.thumb && /^https:/.test(v.thumb) ? ' style="background-image:url(' + esc(v.thumb) + ');background-size:cover;background-position:center"' : '') + '>' + (v.thumb ? '' : '<span>LOOP</span>') + '</div></div>' +
        '<div class="bd"><span class="tt">' + esc(String(v.title).replace(/<[^>]*>/g, '')) + '</span><div class="mt"><span class="d"></span><span>' + esc(v.meta) + '</span></div></div></a>';
    }).join('');
  }
  /* real creator identity for the title + about blocks */
  function loadCreator() {
    if (SIM) return;
    api('/sml-live/v1/feeds/' + HANDLE).then(function (res) {
      var c = res.j && res.j.creator;
      if (!c) return;
      root.querySelector('.slw-titleblk .who .nm').textContent = c.name + ' · @' + c.handle;
      root.querySelector('.slw-about-id .nm').innerHTML = esc(c.name) + ' <small>· @' + esc(c.handle) + '</small>';
      var av = root.querySelector('.slw-avatar');
      av.textContent = (c.name || c.handle || 'SL').slice(0, 2).toUpperCase();
    }).catch(function () {});
    api('/sml-lb/v1/card/' + HANDLE).then(function (res) {
      var j = res.j || {};
      var url = (j.profile && j.profile.photo) || j.photo || j.avatar || (j.profile && j.profile.avatar) || '';
      if (url && /^https:/.test(url)) {
        var av = root.querySelector('.slw-avatar');
        av.style.background = '#0d1a15 url(' + url + ') center/cover';
        av.textContent = '';
      }
    }).catch(function () {});
  }
  /* real orbit: creator images live in the MEDIA LIBRARY tagged by title prefix
     "sml-orbit-{handle}" — public wp/v2/media read, zero custom PHP needed.
     caption field = orbit caption, description field = optional link. */
  var ORB_TAG = 'sml-orbit-' + HANDLE;
  function orbStrip(s2) { var d = document.createElement('div'); d.innerHTML = s2 || ''; return (d.textContent || '').trim(); }
  function orbLink(s2) { var m = orbStrip(s2).match(/https:\/\/\S+/); return m ? m[0] : ''; }
  function orbFetch(creds) {
    var opts = { credentials: 'same-origin' };
    if (creds && NONCE) opts.headers = { 'X-WP-Nonce': NONCE };
    return fetch('/wp-json/wp/v2/media?search=' + encodeURIComponent(ORB_TAG) + '&per_page=30&_fields=id,title,caption,description,source_url', opts)
      .then(function (r) { return r.json(); })
      .then(function (list) {
        if (!Array.isArray(list)) return [];
        return list.filter(function (m) { return m && m.source_url && m.title && String(m.title.rendered || '').indexOf(ORB_TAG) === 0; })
          .sort(function (a, b) { return String(a.title.rendered).localeCompare(String(b.title.rendered)); })
          .slice(0, 10)
          .map(function (m) { return { id: m.id, img: m.source_url, title: orbStrip(m.caption && m.caption.rendered), sub: '', link: orbLink(m.description && m.description.rendered) }; });
      });
  }
  function loadOrbit() {
    if (SIM) return;
    orbFetch(false).then(function (items) {
      if (items.length) {
        buildOrbit(items);
        root.querySelector('.slw-orbit-sec').style.display = '';
      } else {
        root.querySelector('.slw-orbit-sec').style.display = 'none';
      }
    }).catch(function () {});
  }
  /* admin orbit manager: upload via wp/v2/media, save the list via sml-lw/v1/orbit */
  function openOrbMgr() {
    var mgr = [];
    var paint = function () {
      var box = el('#slw-omgr-list');
      box.innerHTML = mgr.map(function (m, i) {
        return '<div class="slw-orbmgr-row"><span class="th" style="background-image:url(' + esc(m.img) + ')"></span>' +
          '<input data-f="title" data-i="' + i + '" placeholder="caption (optional)" value="' + esc(m.title || '') + '">' +
          '<input data-f="link" data-i="' + i + '" placeholder="link https:// (optional)" value="' + esc(m.link || '') + '">' +
          '<button class="rm" data-i="' + i + '">✕</button></div>';
      }).join('') || '<span class="slw-orbmgr-note">No orbit images yet — add up to 10. Full image always shows, boxless, GIFs play.</span>';
      Array.prototype.forEach.call(box.querySelectorAll('input'), function (inp) {
        inp.oninput = function () { mgr[+inp.getAttribute('data-i')][inp.getAttribute('data-f')] = inp.value; };
      });
      Array.prototype.forEach.call(box.querySelectorAll('.rm'), function (b) {
        b.onclick = function () { var gone = mgr.splice(+b.getAttribute('data-i'), 1)[0]; if (gone && gone.id) removed.push(gone.id); paint(); };
      });
    };
    el('#slw-modal-mount').innerHTML = '<div class="slw-modal" id="slw-omgr"><div class="slw-modal-c">' +
      '<div class="slw-modal-h"><b>Orbit images</b><button class="slw-x" id="slw-omgr-x">Close ✕</button></div>' +
      '<div id="slw-omgr-list" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow:auto"></div>' +
      '<div style="display:flex;gap:9px;align-items:center"><input type="file" id="slw-omgr-file" accept="image/*" style="color:#8fa3b5;font:400 11px/1 Archivo,sans-serif">' +
      '<span class="slw-orbmgr-note" id="slw-omgr-st"></span></div>' +
      '<div style="display:flex;gap:9px;justify-content:flex-end"><button class="slw-btn2" id="slw-omgr-x2">Cancel</button>' +
      '<button class="slw-rematch" id="slw-omgr-save">Save orbit</button></div></div></div>';
    var removed = [];
    orbFetch(true).then(function (items) { mgr = items; paint(); }).catch(function () { paint(); });
    var close = function () { el('#slw-modal-mount').innerHTML = ''; };
    el('#slw-omgr-x').onclick = close;
    el('#slw-omgr-x2').onclick = close;
    el('#slw-omgr-file').onchange = function () {
      var f = el('#slw-omgr-file').files[0];
      if (!f) return;
      if (mgr.length >= 10) { el('#slw-omgr-st').textContent = '10 is the max — remove one first.'; return; }
      el('#slw-omgr-st').textContent = 'Uploading…';
      var fd = new FormData();
      fd.append('file', f);
      fetch('/wp-json/wp/v2/media', { method: 'POST', credentials: 'same-origin', headers: { 'X-WP-Nonce': NONCE }, body: fd })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.source_url || !j.id) { el('#slw-omgr-st').textContent = (j && j.message) || 'Upload failed.'; return; }
          /* tag the attachment as an orbit slot — the public page finds it by this title */
          return fetch('/wp-json/wp/v2/media/' + j.id, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE }, body: JSON.stringify({ title: ORB_TAG + '-' + Date.now() }) })
            .then(function () { mgr.push({ id: j.id, img: j.source_url, title: '', sub: '', link: '' }); paint(); el('#slw-omgr-st').textContent = ''; });
        }).catch(function () { el('#slw-omgr-st').textContent = 'Upload failed — check your connection.'; });
      el('#slw-omgr-file').value = '';
    };
    el('#slw-omgr-save').onclick = function () {
      el('#slw-omgr-st').textContent = 'Saving…';
      var jobs = [];
      mgr.forEach(function (m) {
        if (!m.id) return;
        jobs.push(fetch('/wp-json/wp/v2/media/' + m.id, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE }, body: JSON.stringify({ caption: m.title || '', description: m.link || '' }) }));
      });
      /* removing a slot just untags the attachment — the file stays in the library */
      removed.forEach(function (id) {
        jobs.push(fetch('/wp-json/wp/v2/media/' + id, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NONCE }, body: JSON.stringify({ title: 'orbit-removed-' + Date.now() }) }));
      });
      Promise.all(jobs).then(function () { close(); loadOrbit(); })
        .catch(function () { el('#slw-omgr-st').textContent = 'Save failed — check your connection.'; });
    };
  }
  if (el('#slw-orbbtn')) el('#slw-orbbtn').onclick = openOrbMgr;

  /* ---------- Boost Arena (real): rounds + tracked links + click-verified payouts ---------- */
  var BOOST = { d: null };
  /* share intent per platform index; null = copy-link mode */
  var INTENTS = [
    function (u, t) { return 'https://www.reddit.com/submit?url=' + encodeURIComponent(u) + '&title=' + encodeURIComponent(t); },
    function (u, t) { return 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(u) + '&text=' + encodeURIComponent(t); },
    function (u) { return 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(u); },
    function (u, t) { return 'https://bsky.app/intent/compose?text=' + encodeURIComponent(t + ' ' + u); },
    function (u, t) { return 'https://www.threads.net/intent/post?text=' + encodeURIComponent(t + ' ' + u); },
    null, /* Stocktwits — copy */
    function (u) { return 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(u); },
    null, /* Moomoo — copy */
    null  /* Instagram — copy */
  ];
  function loadBoost() {
    if (SIM || document.hidden) return;
    api('/sml-lw/v1/boost?handle=' + HANDLE).then(function (res) {
      if (res.j) { BOOST.d = res.j; renderBoostReal(); }
    }).catch(function () {});
  }
  function boostClock() {
    var d = BOOST.d;
    if (!d || !d.open) return '0:00';
    var left = Math.max(0, d.endsAt - Math.floor(Date.now() / 1000));
    return Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  }
  function renderBoostReal() {
    if (SIM) return;
    var d = BOOST.d || { open: false };
    var pane = el('#slw-pane-3');
    var me = d.me || { shares: [], clicks: 0, lb: 0 };
    var head = '<div class="slw-boost-h"><div class="l"><div class="t"><b>⚡ BOOST ARENA</b><span class="live">LIVE ONLY</span></div>' +
      '<span class="sub">' + (d.open ? '+' + d.perShare + ' LB per verified share · winner +' + Number(d.winnerBonus).toLocaleString() + ' LB' : 'Share the stream, earn Loop Bucks') + '</span></div>' +
      '<div class="r"><span class="k">' + (d.open ? 'TIME LEFT' : (d.board ? 'ENDED' : '')) + '</span><span class="v' + (d.open ? '' : ' ended') + '" id="slw-bclk">' + boostClock() + '</span></div></div>';
    var over = (!d.open && d.winnerName) ? '<div class="slw-boost-over show"><b>ROUND OVER</b><span><b>' + esc(d.winnerName) + '</b> takes the bonus.</span></div>' : '';
    var body = '';
    if (d.open || (d.board && d.board.length)) {
      var plats = PLATS.map(function (p, i) {
        var done = me.shares.indexOf(i) >= 0 || me.shares.indexOf(String(i)) >= 0;
        var locked = !d.open;
        return '<button class="slw-plat' + (done ? ' done' : '') + '" data-bplat="' + i + '"' + (locked && !done ? ' style="opacity:.45;cursor:default"' : '') + '>' +
          '<span class="mk" style="color:' + p[2] + '">' + p[1] + '</span><span class="nm">' + p[0] + '</span>' +
          '<span class="st">' + (done ? '✓ SHARED' : (locked ? 'CLOSED' : '+' + d.perShare + ' LB')) + '</span></button>';
      }).join('');
      var rows = (d.board || []).map(function (e, i) {
        return '<div class="slw-brow' + (i % 2 ? ' alt' : '') + '"><span class="rk' + (i === 0 ? ' top' : (i < 3 ? ' t3' : '')) + '">' + (i + 1) + '</span>' +
          '<span class="nm">' + esc(e.name) + '</span><span class="v">' + e.shares + '/9</span><span class="v w">' + Number(e.clicks).toLocaleString() + '</span><span class="lb">' + Number(e.lb).toLocaleString() + '</span></div>';
      }).join('') || '<div class="slw-chat-empty" style="display:block">No boosters yet — first share takes the lead.</div>';
      body = '<div class="slw-boost-share"><div class="hd"><b>SHARE TO EARN</b><span>' + me.shares.length + ' / 9</span></div>' +
        '<div class="slw-plats">' + plats + '</div>' +
        '<div class="slw-bstats"><div class="slw-bstat"><b>' + me.shares.length + '</b><span>SHARES</span></div>' +
        '<div class="slw-bstat"><b class="cy">' + Number(me.clicks).toLocaleString() + '</b><span>LINK CLICKS</span></div>' +
        '<div class="slw-bstat gold"><b>' + Number(me.lb).toLocaleString() + '</b><span>LB EARNED</span></div></div></div>' +
        (function () {
          /* live per-platform click analytics — server counts every tracked arrival by platform */
          var pl = d.platforms || {};
          var tot = 0, rows2 = [];
          PLATS.forEach(function (p, i) {
            var n = +(pl[i] || pl[String(i)] || 0);
            if (n > 0) { rows2.push([p[0], p[2], n]); tot += n; }
          });
          if (!tot) return '';
          rows2.sort(function (a, b) { return b[2] - a[2]; });
          return '<div class="slw-lead-h"><b>WHERE THE CLICKS COME FROM</b><div class="upd"><i></i><span>LIVE</span></div></div>' +
            '<div style="display:flex;flex-direction:column;gap:5px;padding:0 16px 10px">' + rows2.map(function (r2) {
              var pct = Math.round(r2[2] / tot * 100);
              return '<div style="display:flex;align-items:center;gap:8px"><span style="font:600 9px/1 Archivo,sans-serif;color:#c7d6e3;width:74px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r2[0]) + '</span>' +
                '<span style="flex:1;height:5px;border-radius:3px;background:#1a2530;overflow:hidden"><i style="display:block;height:100%;width:' + pct + '%;background:' + r2[1] + '"></i></span>' +
                '<span style="font:600 9px/1 \'IBM Plex Mono\',monospace;color:#8fa3b5;width:52px;text-align:right;flex:none">' + r2[2].toLocaleString() + ' · ' + pct + '%</span></div>';
            }).join('') + '</div>';
        })() +
        '<div class="slw-lead-h"><b>LIVE LEADERBOARD</b><div class="upd"><i></i><span>UPDATING</span></div></div>' +
        '<div class="slw-lead-cols"><span>#</span><span>BOOSTER</span><span class="r">SHR</span><span class="r">CLK</span><span class="r">LB</span></div>' +
        rows +
        '<span class="slw-boost-fn">Loop Bucks land when someone actually opens your link — shares are verified by link tracking. Winner paid at round close.</span>';
    } else {
      body = '<div class="slw-chat-empty" style="display:block;padding:26px 16px">No Boost round is open. When the host starts one, verified shares pay out right here.</div>';
    }
    var adminCtl = '';
    if (ADMIN) {
      adminCtl = d.open
        ? '<div style="display:flex;gap:8px;padding:10px 16px 14px"><button class="slw-forfeit" id="slw-bclose" style="flex:1;padding:11px 0">Close the round &amp; pay the winner</button></div>'
        : '<div style="display:flex;gap:6px;align-items:center;padding:10px 16px 14px;flex-wrap:wrap">' +
          '<input id="slw-bmin" type="number" min="1" max="120" value="10" title="minutes" style="width:52px;border:1px solid #1c2833;border-radius:6px;padding:8px;background:#0b1119;color:#e6edf3;font:500 11px/1 \'IBM Plex Mono\',monospace">' +
          '<span style="font:400 9px/1 Archivo,sans-serif;color:#5d7085">min</span>' +
          '<input id="slw-bper" type="number" min="0" max="5000" value="250" title="LB per share" style="width:62px;border:1px solid #1c2833;border-radius:6px;padding:8px;background:#0b1119;color:#e6edf3;font:500 11px/1 \'IBM Plex Mono\',monospace">' +
          '<span style="font:400 9px/1 Archivo,sans-serif;color:#5d7085">LB/share</span>' +
          '<input id="slw-bwin" type="number" min="0" max="100000" value="5000" title="winner bonus" style="width:70px;border:1px solid #1c2833;border-radius:6px;padding:8px;background:#0b1119;color:#e6edf3;font:500 11px/1 \'IBM Plex Mono\',monospace">' +
          '<span style="font:400 9px/1 Archivo,sans-serif;color:#5d7085">winner</span>' +
          '<button class="slw-rematch" id="slw-bopen" style="flex:1;min-width:110px">⚡ Open a round</button></div>';
    }
    pane.innerHTML = head + over + body + adminCtl;
    Array.prototype.forEach.call(pane.querySelectorAll('[data-bplat]'), function (b) {
      b.onclick = function () { shareBoost(+b.getAttribute('data-bplat')); };
    });
    if (el('#slw-bopen')) el('#slw-bopen').onclick = function () {
      vFormG('/sml-lw/v1/boost/open', { handle: HANDLE, minutes: +el('#slw-bmin').value || 10, per_share: +el('#slw-bper').value || 250, winner: +el('#slw-bwin').value || 5000 }).then(function () { loadBoost(); });
    };
    if (el('#slw-bclose')) el('#slw-bclose').onclick = function () {
      vFormG('/sml-lw/v1/boost/close', { handle: HANDLE }).then(function () { loadBoost(); });
    };
  }
  function shareBoost(i) {
    var d = BOOST.d;
    if (!d || !d.open) return;
    if (!gateState || !gateState.loggedIn) { flashGate('Sign in to boost the stream and earn Loop Bucks.'); return; }
    var UTM_MEDIUM = ['reddit', 'x', 'facebook', 'bluesky', 'threads', 'stocktwits', 'linkedin', 'moomoo', 'instagram'];
    vFormG('/sml-lw/v1/boost/share', { handle: HANDLE, platform: i }).then(function (res) {
      if (!res.ok || !res.j || !res.j.url) { flashGate((res.j && res.j.message) || 'Could not open the share.'); return; }
      /* GA4 (Site Kit) reads these on arrival — Realtime report shows the traffic live,
         full per-round campaign reports consolidate on Google's side */
      res.j.url += '&utm_source=boost&utm_medium=' + UTM_MEDIUM[i] + '&utm_campaign=boost-' + encodeURIComponent((BOOST.d && BOOST.d.roundId) || 'round');
      var intent = INTENTS[i];
      if (intent) {
        window.open(intent(res.j.url, res.j.text), '_blank', 'noopener');
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(res.j.text + ' ' + res.j.url);
        flashGate('Your tracked link is copied — paste it on ' + PLATS[i][0] + '. LB lands when someone opens it.');
      }
      loadBoost();
    }).catch(function () {});
  }
  function initBoostReal() {
    loadBoost();
    setInterval(loadBoost, 10000);
    Array.prototype.forEach.call(root.querySelectorAll('.slw-tab'), function (b) {
      b.addEventListener('click', function () { if (+b.getAttribute('data-tab') === 3) loadBoost(); });
    });
    /* arrivals through a tracked link count as the verified click */
    var bcode = qs('b');
    if (bcode) {
      vFormG('/sml-lw/v1/boost/click', { code: bcode, handle: HANDLE }).catch(function () {});
    }
  }

  if (!SIM) { hardenPublic(); loadCreator(); loadOrbit(); }

  /* ---------- timers ---------- */
  renderFeed();
  setInterval(function () {
    S.tick++;
    if (S.playing) S.t++;
    if (P.mode === 'none') { /* sim clock/progress only until a real source mounts */
      S.viewers = Math.max(1200, S.viewers + Math.round((Math.random() - 0.42) * 14));
      el('#slw-clock').textContent = hms(S.t);
      el('#slw-elapsed').textContent = hms(S.t);
      el('#slw-viewers').textContent = S.viewers.toLocaleString();
      var pct = 62 + (S.t % 240) / 240 * 34;
      el('#slw-pfill').style.width = pct.toFixed(2) + '%';
      el('#slw-phead').style.left = pct.toFixed(2) + '%';
    }
    /* tomato warm-up */
    if (S.tomWarm > 0) {
      S.tomWarm--;
      var wc = el('#slw-twc');
      if (wc) wc.textContent = 'warm-up 0:' + String(S.tomWarm).padStart(2, '0');
      if (S.tomWarm === 0) { paintTomBtn(); var pop = el('#slw-tom-pop'); if (S.tomStage === 'compose') { pop.innerHTML = ''; S.tomStage = 'idle'; } }
    }
    /* share morph every ~60s for 3s */
    if (S.shareAnim > 0) { S.shareAnim--; if (S.shareAnim === 0) paintShare(); }
    else if (S.tick > 0 && S.tick % 60 === 20 && !S.shared) { S.shareAnim = 3; paintShare(); }
    /* affiliate flash every ~45s for 5s */
    if (S.affFlash > 0) { S.affFlash--; if (S.affFlash === 0) { el('#slw-aff0').classList.remove('flash'); el('#slw-aff1').classList.remove('flash'); } }
    else if (S.tick > 0 && S.tick % 45 === 0) { S.affFlash = 5; el('#slw-aff0').classList.add('flash'); el('#slw-aff1').classList.add('flash'); }
    /* about auto-flip: disclaimer 30s every 15min */
    var showingDisc = Math.abs(S.aboutDeg / 180) % 2 === 1;
    if (!showingDisc && S.tick > 0 && S.tick % 900 === 0) { S.aboutDeg += 180; S.aboutAuto = S.tick; paintFlip(); }
    else if (showingDisc && S.aboutAuto > 0 && S.tick - S.aboutAuto >= 30) { S.aboutDeg += 180; S.aboutAuto = 0; paintFlip(); }
    /* voice-synced qcard rotation every 9s — SIM only (real detection isn't built) */
    if (SIM && S.tick - qHeard >= 9) {
      var pool = Q5.filter(function (x) { return x !== qSym; });
      qSym = pool[Math.floor(Math.random() * pool.length)];
      qHeard = S.tick;
    }
    if (SIM) paintQ();
    /* orbit drift: one card every 5s */
    if (S.oPlaying && !S.oHover && !S.oLightbox && !document.hidden) {
      var step = 360 / N;
      S.oAngle += step / 5;
      S.oIdx = ((Math.round(S.oAngle / step) % N) + N) % N;
      orbitPaint(true);
    }
    /* ttt countdown */
    if (S.gView === 'match' && !S.tttDone && S.tttLeft > 0) {
      S.tttLeft--;
      var tc = el('#slw-tclk');
      tc.textContent = S.tttLeft + 's';
      tc.classList.toggle('warn', S.tttLeft <= 5);
      if (S.tttLeft <= 0) tttEnd({ w: 'time', line: [] });
    }
    /* real boost round clock */
    if (!SIM && BOOST.d && BOOST.d.open) {
      var bc = el('#slw-bclk');
      if (bc) {
        bc.textContent = boostClock();
        if (BOOST.d.endsAt - Math.floor(Date.now() / 1000) <= 0) loadBoost();
      }
    }
    /* boost countdown + rival drift (SIM demo) */
    if (S.aLeft > 0) {
      S.aLeft--;
      if (S.tick % 2 === 0) S.aRivals = S.aRivals.map(function (r) { return [r[0], r[1] + Math.floor(Math.random() * 9), r[2] + (Math.random() < 0.3 ? 1 : 0)]; });
      if (S.aShared.length > 0) {
        S.aImpr += Math.floor(Math.random() * 3 * S.aShared.length);
        S.aClicks += (Math.random() < 0.12 * S.aShared.length ? 1 : 0);
      }
      if (S.tab === 3) renderBoost();
      if (S.aLeft === 0) { renderPlats(); renderBoost(); }
    }
    /* voice queue sim */
    if (S.vStage === 'queued') {
      S.vWait--;
      if (S.vWait <= 0 && S.queuePos > 1) { S.queuePos--; S.vWait = 3; el('#slw-qpos').textContent = '#' + S.queuePos; }
    }
    /* mic bars */
    if (S.tab === 1) {
      Array.prototype.forEach.call(root.querySelectorAll('#slw-micbars i'), function (b, i) {
        b.style.height = (4 + Math.abs(Math.sin((S.tick * 1.6 + i * 0.9) / 1.4)) * 10).toFixed(1) + 'px';
      });
    }
    /* call banner counters */
    if (S.camScene === 'call' || S.camScene === 'dial') {
      var cv = (398 + (S.tick % 30)).toLocaleString();
      el('#slw-callv').textContent = cv; el('#slw-dialv').textContent = cv;
      el('#slw-dials').textContent = 4 + (S.tick % 22);
    }
    /* recommended pagination every 3min — SIM only (real rail is loadRec's) */
    if (SIM) {
      if (S.tick - S.recAt >= 180) {
        S.recPage = (S.recPage + 1) % 2; S.recAt = S.tick; renderRec();
      }
      var rl = Math.max(0, 180 - (S.tick - S.recAt));
      el('#slw-recmeta').textContent = (S.recPage + 1) + ' / 2 · Next 5 in ' + Math.floor(rl / 60) + ':' + String(rl % 60).padStart(2, '0');
    }
  }, 1000);

  /* SIM ONLY: sample chat cadence ~2.6s, hold on hover, no back-to-back repeats */
  var lastI = -1, lastTop = -1;
  setInterval(function () {
    if (!SIM) return;
    if (S.chatHold || S.thread !== null) return;
    var toThread = Math.random() < 0.3, i;
    do { i = Math.floor(Math.random() * POOL.length); } while (POOL.length > 1 && (i === lastI || (!toThread && i === lastTop)));
    lastI = i;
    if (!toThread) lastTop = i;
    var p = POOL[i];
    if (toThread && S.msgs.length) {
      var mi = Math.floor(Math.random() * S.msgs.length);
      if (!S.msgs[mi].sys) { S.msgs[mi].replies = (S.msgs[mi].replies || []).concat([{ ini: p[0], h: p[1], tx: p[2], at: 'now' }]); renderTop(); }
      return;
    }
    S.msgs.push({ id: 'm' + Date.now(), ini: p[0], h: p[1], tx: p[2], at: 'now', replies: [] });
    S.msgs = S.msgs.slice(-24);
    renderFeed();
  }, 2600);
})();
