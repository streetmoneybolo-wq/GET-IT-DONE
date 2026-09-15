<?php
/**
 * Loop Distribution - the /distribute/ page in the Creator Studio shell.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_dist_page_config')) {
    function sml_dist_page_config() {
        $user = wp_get_current_user();
        $user_id = get_current_user_id();
        return array(
            'base'      => esc_url_raw(rest_url('sml-dist/v1')),
            'letters'   => esc_url_raw(rest_url('sml-letters/v1')),
            'nonce'     => wp_create_nonce('wp_rest'),
            'userId'    => $user_id,
            'avatar'    => $user->exists() ? get_avatar_url($user_id, array('size' => 96)) : '',
            'loginUrl'  => esc_url_raw(add_query_arg('redirect_to', rawurlencode(home_url('/distribute/')), home_url('/sign-up-sign-in/'))),
            'studioUrl' => esc_url_raw(home_url('/creator-studio/')),
            'jetpackUrl'=> esc_url_raw(admin_url('admin.php?page=jetpack-social')),
        );
    }
}

if (!function_exists('sml_dist_page_styles')) {
    function sml_dist_page_styles() {
        return <<<'SMLDISTCSS'
.cs-hint{font-size:12.5px;color:#8798ac;line-height:1.65}
.cs-hint b{color:#c2cede}
a.cs-btn{text-decoration:none}
.cs-btn[disabled]{opacity:.45;cursor:not-allowed}

.dx-body{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:20px;padding:22px 26px 60px;align-items:start}
.dx-main{min-width:0;display:flex;flex-direction:column;gap:18px}
.dx-side{display:flex;flex-direction:column;gap:16px;position:sticky;top:88px}

.dx-card{background:#0b131f;border:1px solid #182130;border-radius:14px;padding:20px}
.dx-card h3{margin:0 0 4px;font-size:17px;font-weight:700;letter-spacing:-.2px}
.dx-card h4{margin:0 0 12px;font-size:13px;font-weight:800;letter-spacing:.5px;color:#8798ac;text-transform:uppercase}
.dx-card p.sub{margin:0 0 16px;font-size:13px;color:#8798ac;line-height:1.6}

.dx-banner{display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:12px;
    border:1px solid rgba(224,163,54,.3);background:rgba(224,163,54,.07);color:#e6c98e;font-size:13.5px;line-height:1.55}
.dx-banner.bad{border-color:rgba(255,86,110,.3);background:rgba(255,86,110,.07);color:#ffb3bd}
.dx-banner.ok{border-color:rgba(34,217,122,.3);background:rgba(34,217,122,.07);color:#7ee8ae}
.dx-banner b{display:block;color:#fff;margin-bottom:3px;font-size:14px}

.dx-acct{display:flex;align-items:center;gap:13px;padding:13px 15px;border-radius:11px;
    border:1px solid #1e2a3a;background:#0d1622;margin-bottom:9px}
.dx-acct .av{width:36px;height:36px;border-radius:9px;background:#152234;display:grid;place-items:center;
    font-size:15px;font-weight:800;color:#63a4ff;flex:0 0 auto}
.dx-acct b{display:block;font-size:14px;font-weight:700}
.dx-acct small{display:block;font-size:12px;color:#8798ac;margin-top:2px}
.dx-acct .grow{flex:1;min-width:0}
.dx-dot{width:8px;height:8px;border-radius:50%;background:#22d97a;flex:0 0 auto}
.dx-dot.warn{background:#e0a336}
.dx-dot.bad{background:#ff566e}
.dx-unlink{height:30px;padding:0 12px;border-radius:7px;border:1px solid #2a1620;background:#180f14;
    color:#ff8a9b;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}

.dx-field{margin-bottom:13px}
.dx-field label{display:block;font-size:12px;color:#a9b8ca;margin-bottom:6px;font-weight:600}
.dx-in{width:100%;background:#0a1018;border:1px solid #1e2a3a;border-radius:8px;color:#e6edf5;
    padding:10px 12px;font-size:13.5px;font-family:inherit}
.dx-in:focus{outline:none;border-color:#2b6cff}

.dx-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.dx-tab{height:32px;padding:0 13px;border-radius:8px;border:1px solid #223146;background:#0d1622;
    color:#a9b8ca;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:7px}
.dx-tab.on{border-color:#2b6cff;background:#132238;color:#fff}
.dx-tab .tier{font-size:9.5px;font-weight:800;letter-spacing:.5px;padding:1px 5px;border-radius:4px;background:#1a2534;color:#5d7189}
.dx-tab .tier.A{background:rgba(34,217,122,.16);color:#22d97a}
.dx-tab .tier.C{background:rgba(255,86,110,.14);color:#ff8a9b}

.dx-post{border:1px solid #1e2a3a;border-radius:12px;background:#0a111c;overflow:hidden}
.dx-post-head{display:flex;align-items:center;gap:10px;padding:11px 15px;background:#0d1622;
    border-bottom:1px solid #1e2a3a;font-size:12.5px;color:#8798ac}
.dx-post-head b{color:#e6edf5;font-size:13.5px;font-weight:700}
.dx-post-head .count{margin-left:auto;font-variant-numeric:tabular-nums}
.dx-post-head .count.over{color:#ff566e}
.dx-post pre{margin:0;padding:16px;font-family:inherit;font-size:14px;line-height:1.65;
    color:#dbe6f2;white-space:pre-wrap;word-break:break-word}
.dx-post-foot{display:flex;align-items:center;gap:8px;padding:11px 15px;border-top:1px solid #16202e}
.dx-copy{height:32px;padding:0 14px;border-radius:8px;border:1px solid #2b6cff;background:#132238;
    color:#63a4ff;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit}
.dx-copy.done{border-color:#22d97a;color:#22d97a;background:rgba(34,217,122,.1)}
.dx-open{height:32px;padding:0 14px;border-radius:8px;border:1px solid #223146;background:#0d1622;
    color:#c2cede;font-size:12.5px;font-weight:600;font-family:inherit;display:inline-flex;align-items:center}
.dx-note{font-size:11.5px;color:#5d7189;margin-left:auto;text-align:right;max-width:56%;line-height:1.45}
.dx-seeds{display:flex;gap:6px;margin-bottom:10px}
.dx-seed{height:28px;padding:0 11px;border-radius:7px;border:1px solid #223146;background:#0d1622;
    color:#8798ac;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit}
.dx-seed.on{border-color:#22d97a;color:#22d97a;background:rgba(34,217,122,.08)}

.dx-cardimg{width:100%;border-radius:10px;border:1px solid #1e2a3a;display:block}
.dx-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.dx-chip{height:25px;display:inline-flex;align-items:center;padding:0 9px;border-radius:7px;
    background:#152234;border:1px solid #223146;font-size:12px;font-weight:700;color:#63a4ff}
.dx-chip.grey{color:#a9b8ca;border-color:#1e2a3a}

.dx-row{display:flex;align-items:center;justify-content:space-between;padding:9px 0;
    border-bottom:1px solid #16202e;font-size:13.5px}
.dx-row:last-child{border-bottom:0}
.dx-row b{font-variant-numeric:tabular-nums;font-size:15px}
.dx-row span{color:#8798ac}

.dx-q{display:flex;align-items:center;gap:11px;padding:11px 14px;border-radius:10px;
    border:1px solid #182130;background:#0a111c;margin-bottom:8px;font-size:13px}
.dx-q .grow{flex:1;min-width:0}
.dx-q small{display:block;color:#5d7189;font-size:11.5px;margin-top:2px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dx-pill{font-size:10.5px;font-weight:800;letter-spacing:.5px;padding:3px 8px;border-radius:999px;flex:0 0 auto}
.dx-pill.sent{background:rgba(34,217,122,.14);color:#22d97a}
.dx-pill.queued{background:#1a2534;color:#8798ac}
.dx-pill.failed{background:rgba(255,86,110,.14);color:#ff8a9b}
.dx-pill.skipped{background:#151d29;color:#5d7189}
.dx-pill.sending{background:rgba(43,108,255,.16);color:#63a4ff}

.dx-empty{padding:30px;text-align:center;font-size:13.5px;color:#5d7189;
    border:1px dashed #1e2a3a;border-radius:12px}
.dx-sel{width:100%;background:#0a1018;border:1px solid #1e2a3a;border-radius:8px;color:#e6edf5;
    padding:10px 12px;font-size:13.5px;font-family:inherit}

.dx-platform-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
.dx-platform-head .sub{max-width:720px}
.dx-platform-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.dx-platform{display:flex;flex-direction:column;min-width:0;padding:16px;border:1px solid #1e2a3a;
    border-radius:12px;background:linear-gradient(145deg,#0d1622,#0a111b)}
.dx-platform-top{display:flex;align-items:center;gap:11px;margin-bottom:10px}
.dx-platform-icon{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;flex:0 0 auto;
    color:#fff;font-size:14px;font-weight:900;letter-spacing:-.3px;background:#172539;border:1px solid #263a52}
.dx-platform-name{min-width:0;flex:1}.dx-platform-name b{display:block;font-size:14px}.dx-platform-name small{color:#71849b;font-size:11.5px}
.dx-connect-state{font-size:9.5px;font-weight:900;letter-spacing:.55px;padding:4px 7px;border-radius:999px;
    color:#8fa1b6;background:#172231;border:1px solid #233247;white-space:nowrap}
.dx-connect-state.on{color:#50e99b;background:rgba(34,217,122,.1);border-color:rgba(34,217,122,.28)}
.dx-connect-state.wait{color:#e9c06b;background:rgba(224,163,54,.09);border-color:rgba(224,163,54,.25)}
.dx-platform p{margin:0 0 10px;color:#a6b5c7;font-size:12.5px;line-height:1.55}
.dx-platform ol{margin:0 0 14px;padding-left:18px;color:#71849b;font-size:11.75px;line-height:1.6}
.dx-platform-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:auto}
.dx-platform-actions .cs-btn,.dx-platform-actions .dx-open{height:34px;justify-content:center;padding:0 12px;font-size:11.75px}
.dx-platform-note{margin-top:9px;color:#5d7189;font-size:10.75px;line-height:1.45}
.dx-dist-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;align-items:center;
    padding:11px 0;border-bottom:1px solid #16202e}
.dx-dist-row:last-child{border-bottom:0}
.dx-dist-row b{display:block;color:#e6edf5;font-size:13px}
.dx-dist-row small{display:block;color:#8798ac;font-size:11px;margin-top:2px;line-height:1.35}
.dx-dist-row em{font-style:normal;color:#22d97a;font-size:12px;font-weight:800}
.dx-dist-actions{grid-column:1/-1;display:flex;gap:7px;flex-wrap:wrap}
.dx-dist-actions .dx-open{height:28px;font-size:11px}

@media (max-width:1100px){ .dx-body{grid-template-columns:minmax(0,1fr)} .dx-side{position:static} }
@media (max-width:760px){
  .dx-body{padding:14px 12px 42px}.dx-card{padding:16px}.dx-platform-grid{grid-template-columns:1fr}
  .dx-platform-head{display:block}.dx-connect-state{font-size:9px}
}
SMLDISTCSS;
    }
}

if (!function_exists('sml_dist_page_script')) {
    function sml_dist_page_script() {
        return <<<'SMLDISTJS'
(function () {
  var cfg = window.smlDistConfig;
  var root = document.getElementById('dx-root');
  var side = document.getElementById('dx-side');
  if (!cfg || !root || !side) { return; }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(base, path, options) {
    options = options || {};
    var headers = { 'Accept': 'application/json' };
    if (options.json) { headers['Content-Type'] = 'application/json'; }
    if (cfg.nonce) { headers['X-WP-Nonce'] = cfg.nonce; }
    return fetch(base + path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: headers,
      body: options.json ? JSON.stringify(options.json) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (p) {
        if (!r.ok) { var e = new Error(p.message || 'Request failed.'); e.status = r.status; throw e; }
        return p;
      });
    });
  }
  function dist(path, o) { return api(cfg.base, path, o); }

  var state = {
    status: null, accounts: [], jetpack: null, content: [], queue: [], stats: null,
    selectedType: '', selectedId: 0, preview: null, detail: null, platform: '', seed: 0, loading: true
  };

  function eventFor(type) {
    if (type === 'video') { return 'video.publish'; }
    if (type === 'stream') { return 'stream.start'; }
    return 'letter.publish';
  }

  function typeLabel(type) {
    if (type === 'video') { return 'Video'; }
    if (type === 'stream') { return 'Live Stream'; }
    return 'Loop Letter';
  }

  function boot() {
    Promise.all([
      dist('/status'),
      dist('/accounts'),
      dist('/content').catch(function () { return { content: [] }; }),
      dist('/queue').catch(function () { return { queue: [] }; }),
      dist('/stats').catch(function () { return null; }),
      dist('/jetpack').catch(function () { return { active: false, connections: [] }; })
    ]).then(function (r) {
      state.status = r[0];
      state.accounts = r[1].accounts || [];
      state.content = r[2].content || [];
      state.queue = r[3].queue || [];
      state.stats = r[4];
      state.jetpack = r[5];
      state.loading = false;
      if (state.content.length) { selectContent(state.content[0].type, state.content[0].id); }
      else { render(); }
    }).catch(function (e) {
      root.innerHTML = '<div class="dx-card"><h3>Distribution</h3><p class="sub">' + esc(e.message) + '</p></div>';
    });
  }

  function selectContent(type, id) {
    state.selectedType = type || 'letter';
    state.selectedId = Number(id || 0);
    state.preview = null;
    state.detail = null;
    render();
    dist('/preview', { method: 'POST', json: {
      entity_type: state.selectedType, entity_id: state.selectedId, event_type: eventFor(state.selectedType)
    } }).then(function (p) {
      state.preview = p;
      if (!state.platform && p.handoff && p.handoff.length) {
        state.platform = p.handoff[0].platform;
      }
      render();
    }).catch(function (e) {
      state.preview = { error: e.message };
      render();
    });
    dist('/content/' + encodeURIComponent(state.selectedType) + '/' + encodeURIComponent(state.selectedId))
      .then(function (d) {
        state.detail = d;
        render();
      }).catch(function () {
        state.detail = null;
        render();
      });
  }

  /* ---------------- render ---------------- */

  function renderBanners() {
    var out = '';
    var s = state.status;
    if (!s) { return ''; }

    if (!s.secrets_ok) {
      out += '<div class="dx-banner bad"><div><b>Account linking is disabled</b>'
        + 'Token encryption is not configured. Add <b>SML_DIST_KEY</b> to wp-config.php '
        + '(any random 32+ character string) before linking social accounts.</div></div>';
    }
    var e = s.entitlements;
    if (e.tier === 'trial' && e.trial_days_left !== null) {
      var cls = e.trial_days_left <= 7 ? '' : 'ok';
      out += '<div class="dx-banner ' + cls + '"><div><b>'
        + e.trial_days_left + ' days left on your trial</b>'
        + 'Auto-share, scheduling and analytics are all on. Nothing gets deleted when it ends '
        + '— only automatic sending pauses.</div></div>';
    } else if (e.tier === 'free' && state.stats && state.stats.recap.posts_sent > 0) {
      out += '<div class="dx-banner"><div><b>Auto-share is paused</b>'
        + 'Your posts are still generated — copy them from the panel below. '
        + 'Reconnecting a plan turns sending back on instantly.</div></div>';
    }
    return out;
  }

  function renderAccounts() {
    var s = state.status;
    var rows = state.accounts.map(function (a) {
      var dot = a.status === 'active' ? '' : (a.status === 'expired' ? 'warn' : 'bad');
      return '<div class="dx-acct"><span class="av">' + esc(a.label.charAt(0)) + '</span>'
        + '<span class="grow"><b>' + esc(a.display_name || a.handle) + '</b>'
        + '<small>' + esc(a.label) + ' · @' + esc(a.handle)
        + (a.status !== 'active' ? ' · ' + esc(a.status) : '') + '</small></span>'
        + '<span class="dx-dot ' + dot + '"></span>'
        + '<button type="button" class="dx-unlink" data-unlink="' + a.id + '">Unlink</button></div>';
    }).join('');

    var form = '';
    if (s && s.secrets_ok) {
      form = '<div id="dx-connect-bluesky" style="scroll-margin-top:90px;margin-top:14px;padding-top:16px;border-top:1px solid #16202e">'
        + '<h4 style="margin-bottom:10px">Link Bluesky</h4>'
        + '<div class="cs-hint" style="margin-bottom:12px">Bluesky is the one major platform that lets a tool '
        + 'post for you with no approval and no fee. In Bluesky go to '
        + '<b>Settings → App Passwords</b>, create one, and paste it here. '
        + 'Never your account password.</div>'
        + '<div class="dx-field"><label>Handle</label>'
        + '<input class="dx-in" id="dx-handle" placeholder="you.bsky.social"></div>'
        + '<div class="dx-field"><label>App password</label>'
        + '<input class="dx-in" id="dx-apppw" placeholder="xxxx-xxxx-xxxx-xxxx" autocomplete="off"></div>'
        + '<button type="button" class="cs-btn cs-btn-primary cs-btn-wide" id="dx-link">Link account</button>'
        + '<div id="dx-linkerr" class="cs-hint" style="margin-top:9px;color:#ff8a9b"></div></div>';

      var integrations = s.integrations || {};
      if (integrations.meta || integrations.threads) {
        form += '<div id="dx-connect-meta" style="scroll-margin-top:90px;margin-top:14px;padding-top:16px;border-top:1px solid #16202e">'
          + '<h4 style="margin-bottom:10px">Connect Meta accounts</h4>'
          + '<div class="cs-hint" style="margin-bottom:12px">Authorize only the Pages and professional accounts you want StockMarketLoop to publish to. You can unlink them here at any time.</div>';
        if (integrations.meta) {
          form += '<button type="button" class="cs-btn cs-btn-primary cs-btn-wide" data-meta-connect="facebook">Connect Facebook &amp; Instagram</button>';
        }
        if (integrations.threads) {
          form += '<button type="button" class="cs-btn cs-btn-wide" style="margin-top:8px" data-meta-connect="threads">Connect Threads</button>';
        }
        form += '<div id="dx-metaerr" class="cs-hint" style="margin-top:9px;color:#ff8a9b"></div></div>';
      }
    }

    return '<div class="dx-card"><h3>Connected accounts</h3>'
      + '<p class="sub">Posts go out automatically when you publish a letter, upload a video or go live.</p>'
      + (rows || '<div class="dx-empty">No accounts linked yet.</div>')
      + form + '</div>';
  }

  function jetpackConnectionsFor(services) {
    var rows = (state.jetpack && state.jetpack.connections) || [];
    return rows.filter(function (c) { return services.indexOf(c.service) !== -1; });
  }

  function platformIsConnected(platform, services) {
    var direct = state.accounts.some(function (a) {
      return a.platform === platform && a.status === 'active';
    });
    return direct || jetpackConnectionsFor(services || [platform]).length > 0;
  }

  function connectionCatalog() {
    return [
      { key:'bluesky', label:'Bluesky', icon:'BS', method:'Direct or Jetpack', services:['bluesky'],
        desc:'Fast, free publishing for market commentary, article cards and ticker posts.',
        steps:['Create a Bluesky account','Create an App Password in Settings','Link it here or through Jetpack'],
        action:'anchor', href:'#dx-connect-bluesky', actionLabel:'Connect Bluesky', signup:'https://bsky.app/', signupLabel:'Create account' },
      { key:'facebook', label:'Facebook Pages', icon:'f', method:'Meta or Jetpack', services:['facebook'],
        desc:'Publish article cards, videos and live announcements to an approved Facebook Page.',
        steps:['Create or choose a Facebook Page','Authorize only the Pages you manage','Meta approval may be required for automatic posting'],
        action:'meta', meta:'facebook', actionLabel:'Connect Facebook', signup:'https://www.facebook.com/pages/create', signupLabel:'Create Page' },
      { key:'instagram', label:'Instagram Business', icon:'IG', method:'Meta or Jetpack', services:['instagram-business','instagram'],
        desc:'Send images, videos and optimized captions to a professional Instagram account.',
        steps:['Use a Business or Creator account','Connect it to a Facebook Page','Authorize it through Meta'],
        action:'meta', meta:'facebook', actionLabel:'Connect Instagram', signup:'https://www.instagram.com/accounts/emailsignup/', signupLabel:'Create account' },
      { key:'threads', label:'Threads', icon:'@', method:'Meta or Jetpack', services:['threads'],
        desc:'Publish short ticker-focused posts, article links, images and videos to Threads.',
        steps:['Create a Threads profile','Accept any app tester invitation','Authorize publishing access'],
        action:'meta', meta:'threads', actionLabel:'Connect Threads', signup:'https://www.threads.com/', signupLabel:'Create profile' },
      { key:'linkedin', label:'LinkedIn', icon:'in', method:'Jetpack', services:['linkedin'],
        desc:'Share market articles and professional updates to profiles or company Pages.',
        steps:['Open Jetpack Social','Choose Add account','Select the LinkedIn profile or company Page'],
        action:'jetpack', actionLabel:'Manage LinkedIn', signup:'https://www.linkedin.com/signup', signupLabel:'Create account' },
      { key:'mastodon', label:'Mastodon', icon:'M', method:'Jetpack', services:['mastodon'],
        desc:'Reach decentralized finance communities from the Mastodon server you choose.',
        steps:['Join a Mastodon server','Open Jetpack Social','Authorize that Mastodon account'],
        action:'jetpack', actionLabel:'Connect Mastodon', signup:'https://joinmastodon.org/servers', signupLabel:'Find a server' },
      { key:'tumblr', label:'Tumblr', icon:'t', method:'Jetpack', services:['tumblr'],
        desc:'Republish visual market stories and longer article previews to a Tumblr blog.',
        steps:['Create or choose a Tumblr blog','Open Jetpack Social','Authorize the blog'],
        action:'jetpack', actionLabel:'Connect Tumblr', signup:'https://www.tumblr.com/register', signupLabel:'Create blog' },
      { key:'nextdoor', label:'Nextdoor', icon:'N', method:'Jetpack', services:['nextdoor'],
        desc:'Share appropriate local-business announcements through an eligible Nextdoor account.',
        steps:['Create an eligible Nextdoor account','Open Jetpack Social','Authorize the available profile'],
        action:'jetpack', actionLabel:'Connect Nextdoor', signup:'https://nextdoor.com/', signupLabel:'Create account' },
      { key:'reddit', label:'Reddit', icon:'r/', method:'Approval or guided', services:[],
        desc:'Start ticker discussions and share useful analysis in communities where the topic fits.',
        steps:['Create a Reddit account','Choose a relevant subreddit and read its rules','Use the generated title and link, or request approved API access'],
        action:'external', href:'https://www.reddit.com/submit', actionLabel:'Create Reddit post', signup:'https://www.reddit.com/register/', signupLabel:'Create account',
        note:'Commercial API use can require Reddit review or a separate agreement. StockMarketLoop will not mass-post or bypass subreddit rules.' },
      { key:'moomoo', label:'moomoo Community', icon:'moo', method:'Guided publishing', services:[],
        desc:'Publish market analysis, watch-page articles and video links to an investing-focused community.',
        steps:['Create or sign in to moomoo','Copy the moomoo-ready caption and add native ticker tags','Attach a video or paste its YouTube link in the Community editor'],
        action:'external', href:'https://www.moomoo.com/community', actionLabel:'Open moomoo Community', signup:'https://www.moomoo.com/us', signupLabel:'Create account',
        note:'OpenD provides market and trading data, not a documented Community publishing API; posting remains a guided handoff until moomoo approves access.' },
      { key:'yahoo_finance', label:'Yahoo Finance Community', icon:'YF', method:'Guided publishing', services:[],
        desc:'Send the prepared market post to the StockMarketLoop Yahoo Finance Community profile.',
        steps:['Sign in to Yahoo Finance Community','Copy the Yahoo-ready post from Distribute','Open the profile, select Create, paste, review and send'],
        action:'external', href:'https://finance.yahoo.com/community/u/stockmarketloop/#posts', actionLabel:'Open Yahoo profile', signup:'https://login.yahoo.com/account/create', signupLabel:'Create Yahoo account',
        note:'Yahoo Community requires a completed user profile. Publishing remains a guided handoff because Yahoo does not provide a documented Community write API.' },
      { key:'webull', label:'Webull Community', icon:'WB', method:'Guided publishing', services:[],
        desc:'Publish an attention-led market thesis with sector tickers and substantive analysis, without an external link.',
        steps:['Sign in to Webull','Copy the Webull-ready title, subtitle and analysis','Open Community from WebTrade, paste, review and publish'],
        action:'external', href:'https://app.webull.com/stocks', actionLabel:'Open Webull', signup:'https://www.webull.com/', signupLabel:'Create account',
        note:'Webull posts contain no URL. StockMarketLoop is credited once as the market-data and trader-discussion source.' },
      { key:'etoro', label:'eToro News Feed', icon:'eT', method:'Guided publishing', services:[],
        desc:'Share a constructive market thesis designed for discussion while respecting eToro community rules.',
        steps:['Sign in to eToro','Copy the eToro-ready analysis from Distribute','Open the News Feed, paste, review and publish'],
        action:'external', href:'https://www.etoro.com/feed/', actionLabel:'Open eToro feed', signup:'https://www.etoro.com/', signupLabel:'Create account',
        note:'The eToro variant removes external links, third-party promotion and direct trading instructions. It ends with a relevant discussion question.' },
      { key:'quora', label:'Quora Profile', icon:'Q', method:'Guided publishing', services:[],
        desc:'Publish a standalone, search-focused market post to the user\'s Quora profile or personal Space without attaching it to a question.',
        steps:['Sign in to Quora','Copy the original Quora-ready post from Distribute','Open the profile, choose Create post (or a personal Space), paste, review and publish'],
        action:'external', href:'https://www.quora.com/profile/StockMarketLoop', actionLabel:'Open Quora profile', signup:'https://www.quora.com/', signupLabel:'Create account',
        note:'Each version is written as a complete standalone post with no hashtags, no promotional template labels, no more than three relevant cashtags, one affiliation disclosure, and one source link.' },
      { key:'pinterest', label:'Pinterest', icon:'P', method:'Pinterest API or guided', services:[],
        desc:'Turn evergreen articles, charts, calendars and educational market content into searchable vertical Pins that link to StockMarketLoop.',
        steps:['Create or switch to a Pinterest business account','Claim stockmarketloop.com and organize topic boards','Use the generated vertical card, title, description, destination link and alt text'],
        action:'external', href:'https://www.pinterest.com/pin-creation-tool/', actionLabel:'Create Pinterest Pin', signup:'https://www.pinterest.com/business/create/', signupLabel:'Create business account',
        note:'Guided publishing works now. Automatic Pin and Board publishing can be enabled after Pinterest OAuth credentials with pins:write and boards:write are connected.' },
      { key:'facebook_groups', label:'Facebook Groups', icon:'FG', method:'Guided publishing', services:[],
        desc:'Share selected articles, videos and live announcements into Groups you own or manage.',
        steps:['Open a Group where you are allowed to post','Copy the generated Group variant','Paste, review and publish from Facebook'],
        action:'external', href:'https://www.facebook.com/groups/feed/', actionLabel:'Open Facebook Groups', signup:'https://www.facebook.com/groups/create/', signupLabel:'Create Group',
        note:'Meta removed its official Groups publishing API in 2024, so third-party automatic posting is not supported.' },
      { key:'stocktwits', label:'Stocktwits', icon:'ST', method:'Guided publishing', services:[],
        desc:'A high-value finance audience for ticker-tagged articles, charts and videos.',
        steps:['Create a Stocktwits account','Distribute generates the ticker post','Copy and publish while API registration is closed'],
        action:'external', href:'https://stocktwits.com/', actionLabel:'Open Stocktwits', signup:'https://stocktwits.com/signup', signupLabel:'Create account',
        note:'Automatic API onboarding is currently closed; StockMarketLoop will use a compliant handoff until approved.' },
      { key:'x', label:'X', icon:'X', method:'Developer access', services:[],
        desc:'Publish compact breaking-market posts, video clips and article links.',
        steps:['Create an X account','Enable developer access and billing','Add approved API credentials to StockMarketLoop'],
        action:'external', href:'https://developer.x.com/en/portal/dashboard', actionLabel:'Developer portal', signup:'https://x.com/i/flow/signup', signupLabel:'Create account',
        note:'Automatic posts may incur X API charges; configure a monthly spend cap before enabling.' },
      { key:'tiktok', label:'TikTok', icon:'♪', method:'Approval required', services:[],
        desc:'Distribute vertical market explainers, chart clips and live-stream highlights.',
        steps:['Create a TikTok account','Create a developer app','Request Content Posting API approval'],
        action:'external', href:'https://developers.tiktok.com/', actionLabel:'Developer setup', signup:'https://www.tiktok.com/signup', signupLabel:'Create account' },
      { key:'youtube_description', label:'YouTube', icon:'▶', method:'Google OAuth', services:[],
        desc:'Upload videos and optimize titles, descriptions, tickers, links and hashtags.',
        steps:['Create a YouTube channel','Authorize Google/YouTube access','Choose videos or livestreams to distribute'],
        action:'external', href:'https://studio.youtube.com/', actionLabel:'Open YouTube Studio', signup:'https://www.youtube.com/create_channel', signupLabel:'Create channel' },
      { key:'youtube_community', label:'YouTube Community', icon:'YC', method:'Guided publishing', services:[],
        desc:'Turn each article or video into a ready-to-paste Community post with its image.',
        steps:['Meet YouTube Community eligibility','Copy the generated Community variant','Open Studio and publish it manually'],
        action:'external', href:'https://studio.youtube.com/', actionLabel:'Open Community tools', signup:'https://www.youtube.com/create_channel', signupLabel:'Create channel',
        note:'YouTube does not provide an official API for Community-post publishing.' }
    ];
  }

  function renderConnectionAction(p, connected) {
    if (connected && (p.action === 'jetpack' || p.services.length)) {
      return '<a class="dx-open" href="' + esc(cfg.jetpackUrl) + '" target="_blank" rel="noopener">Manage connection</a>';
    }
    if (p.action === 'meta') {
      var available = state.status && state.status.integrations &&
        (p.meta === 'threads' ? state.status.integrations.threads : state.status.integrations.meta);
      return available
        ? '<button type="button" class="cs-btn cs-btn-primary" data-meta-connect="' + esc(p.meta) + '">' + esc(p.actionLabel) + '</button>'
        : '<a class="dx-open" href="' + esc(cfg.jetpackUrl) + '" target="_blank" rel="noopener">Connect with Jetpack</a>';
    }
    if (p.action === 'jetpack') {
      return '<a class="cs-btn cs-btn-primary" href="' + esc(cfg.jetpackUrl) + '" target="_blank" rel="noopener">' + esc(p.actionLabel) + '</a>';
    }
    return '<a class="cs-btn cs-btn-primary" href="' + esc(p.href) + '" target="_blank" rel="noopener">' + esc(p.actionLabel) + '</a>';
  }

  function renderConnectionDirectory() {
    var cards = connectionCatalog().map(function (p) {
      var connected = platformIsConnected(p.key, p.services);
      var waiting = !connected && (p.method === 'Approval required' || p.method === 'Developer access');
      var status = connected ? 'CONNECTED' : (waiting ? 'SETUP NEEDED' : 'AVAILABLE');
      var names = connected ? jetpackConnectionsFor(p.services).map(function (c) { return c.name; }).filter(Boolean) : [];
      return '<article class="dx-platform">'
        + '<div class="dx-platform-top"><span class="dx-platform-icon">' + esc(p.icon) + '</span>'
        + '<span class="dx-platform-name"><b>' + esc(p.label) + '</b><small>' + esc(p.method) + '</small></span>'
        + '<span class="dx-connect-state' + (connected ? ' on' : (waiting ? ' wait' : '')) + '">' + status + '</span></div>'
        + '<p>' + esc(p.desc) + '</p><ol>' + p.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'
        + (names.length ? '<div class="dx-platform-note">Connected: ' + esc(names.join(', ')) + '</div>' : '')
        + '<div class="dx-platform-actions">' + renderConnectionAction(p, connected)
        + '<a class="dx-open" href="' + esc(p.signup) + '" target="_blank" rel="noopener">' + esc(p.signupLabel) + '</a></div>'
        + (p.note ? '<div class="dx-platform-note">' + esc(p.note) + '</div>' : '') + '</article>';
    }).join('');
    return '<section class="dx-card"><div class="dx-platform-head"><div><h3>Connect every platform</h3>'
      + '<p class="sub">See every publishing option in one place. Connect accounts you already use or open a new platform to expand your reach.</p></div>'
      + '<a class="dx-open" href="' + esc(cfg.jetpackUrl) + '" target="_blank" rel="noopener">Open Jetpack Social</a></div>'
      + '<div class="dx-platform-grid">' + cards + '</div></section>';
  }

  function renderPicker() {
    if (!state.content.length) {
      return '<div class="dx-card"><h3>Generated posts</h3>'
        + '<div class="dx-empty">Publish a Loop Letter, upload a video, or start a public live stream — then its posts appear here, '
        + 'written for every platform.</div></div>';
    }
    var opts = state.content.map(function (item) {
      var value = item.type + ':' + item.id;
      var selected = item.type === state.selectedType && Number(item.id) === Number(state.selectedId);
      return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>'
        + esc(typeLabel(item.type) + ' · ' + item.title) + '</option>';
    }).join('');
    return '<div class="dx-card"><h3>Generated posts</h3>'
      + '<p class="sub">Pick any Loop Letter, uploaded video, or live stream. One post per platform is written to that platform\'s conventions. '
      + 'Edit before you post if you want — these are a starting point, not a mandate.</p>'
      + '<select class="dx-sel" id="dx-content">' + opts + '</select></div>';
  }

  function renderPosts() {
    if (!state.content.length) { return ''; }
    if (!state.preview) {
      return '<div class="dx-card"><div class="dx-empty">Generating posts…</div></div>';
    }
    if (state.preview.error) {
      return '<div class="dx-card"><div class="dx-empty">' + esc(state.preview.error) + '</div></div>';
    }

    var handoff = state.preview.handoff || [];
    var tabs = handoff.map(function (h) {
      return '<button type="button" class="dx-tab' + (h.platform === state.platform ? ' on' : '') + '" '
        + 'data-plat="' + esc(h.platform) + '">' + esc(h.label)
        + '<span class="tier ' + esc(h.tier) + '">' + (h.tier === 'A' ? 'AUTO' : (h.tier === 'C' ? 'COPY' : 'SOON'))
        + '</span></button>';
    }).join('');

    var current = null;
    for (var i = 0; i < handoff.length; i++) {
      if (handoff[i].platform === state.platform) { current = handoff[i]; }
    }
    if (!current && handoff.length) { current = handoff[0]; }
    if (!current) { return ''; }

    // Seed switcher reads from the full variant set when we have it.
    var variants = (state.preview.variants || {})[current.platform] || [];
    var caption = current.caption;
    if (variants[state.seed] && variants[state.seed].caption) {
      caption = variants[state.seed].caption;
    }
    var count = caption.length;
    var over = count > current.budget;

    var seeds = variants.length > 1
      ? '<div class="dx-seeds">'
        + ['Contrarian', 'Specific', 'Question'].map(function (label, i) {
            return '<button type="button" class="dx-seed' + (i === state.seed ? ' on' : '') + '" '
              + 'data-seed="' + i + '">' + label + '</button>';
          }).join('')
        + '</div>'
      : '';

    var body = '<div class="dx-card"><div class="dx-tabs">' + tabs + '</div>' + seeds
      + '<div class="dx-post">'
      + '<div class="dx-post-head"><b>' + esc(current.label) + '</b>'
      + (current.needs_image ? '<span>image required</span>' : '')
      + '<span class="count' + (over ? ' over' : '') + '">' + count + ' / ' + current.budget + '</span></div>'
      + '<pre id="dx-caption">' + esc(caption) + '</pre>'
      + '<div class="dx-post-foot">'
      + '<button type="button" class="dx-copy" data-copy>Copy post</button>'
      + (current.compose_url
          ? '<a class="dx-open" href="' + esc(current.compose_url) + '" target="_blank" rel="noopener">Open ' + esc(current.label) + '</a>'
          : '')
      + '<span class="dx-note">' + esc(current.note) + '</span>'
      + '</div></div>';

    if (current.first_comment) {
      body += '<div class="dx-post" style="margin-top:10px">'
        + '<div class="dx-post-head"><b>First comment</b><span>hashtags go here, not the caption</span></div>'
        + '<pre id="dx-firstcomment">' + esc(current.first_comment) + '</pre>'
        + '<div class="dx-post-foot"><button type="button" class="dx-copy" data-copy-tags>Copy hashtags</button></div></div>';
    }

    if (current.alt_text) {
      body += '<div class="dx-post" style="margin-top:10px">'
        + '<div class="dx-post-head"><b>Image alt text</b><span>accessibility and image context</span></div>'
        + '<pre id="dx-alttext">' + esc(current.alt_text) + '</pre>'
        + '<div class="dx-post-foot"><button type="button" class="dx-copy" data-copy-alt>Copy alt text</button></div></div>';
    }

    body += '</div>';
    return body;
  }

  function renderQueue() {
    if (!state.queue.length) { return ''; }
    var rows = state.queue.slice(0, 12).map(function (q) {
      return '<div class="dx-q"><span class="grow"><b>' + esc(sml_label(q.platform)) + '</b>'
        + '<small>' + esc(q.caption.slice(0, 90)) + '</small></span>'
        + (q.permalink ? '<a class="dx-open" href="' + esc(q.permalink) + '" target="_blank" rel="noopener">View</a>' : '')
        + (q.status === 'failed' ? '<button type="button" class="dx-unlink" data-retry="' + q.id + '">Retry</button>' : '')
        + '<span class="dx-pill ' + esc(q.status) + '">' + esc(q.status.toUpperCase()) + '</span></div>';
    }).join('');
    return '<div class="dx-card"><h3>Recent sends</h3>'
      + '<p class="sub">Every failure shows its reason. Nothing fails silently.</p>' + rows + '</div>';
  }

  function sml_label(platform) {
    var p = (state.status && state.status.platforms) || {};
    return (p[platform] && p[platform].label) || platform;
  }

  function renderDistributionDetail() {
    var d = state.detail;
    if (!d || !d.content) { return ''; }
    var platforms = d.platforms || [];
    var rows = platforms.length ? platforms.map(function (p) {
      var open = p.permalink
        ? '<a class="dx-open" href="' + esc(p.permalink) + '" target="_blank" rel="noopener">Post</a>'
        : '';
      var track = p.tracking_link
        ? '<a class="dx-open" href="' + esc(p.tracking_link) + '" target="_blank" rel="noopener">Track</a>'
        : '';
      var status = String(p.status || 'pending').toUpperCase();
      return '<div class="dx-dist-row"><span><b>' + esc(p.label || p.platform) + '</b>'
        + '<small>' + esc(status) + (p.error ? ' · ' + esc(p.error) : '') + '</small></span>'
        + '<em>' + Number(p.clicks || 0) + ' clicks</em>'
        + ((open || track) ? '<span class="dx-dist-actions">' + open + track + '</span>' : '')
        + '</div>';
    }).join('') : '<div class="dx-empty">No sends or handoff links yet. Generate posts or connect a platform to start tracking.</div>';

    var totals = d.totals || {};
    return '<div class="dx-card"><h4>Selected content distribution</h4>'
      + '<div class="dx-row"><span>Content</span><b style="font-size:13px">' + esc(typeLabel(d.content.type)) + '</b></div>'
      + '<div class="dx-row"><span>Total clicks</span><b>' + Number(totals.clicks || 0) + '</b></div>'
      + '<div class="dx-row"><span>Sent / queued</span><b>' + Number(totals.sent || 0) + ' / ' + Number(totals.queued || 0) + '</b></div>'
      + rows + '</div>';
  }

  function renderSide() {
    var out = '';
    var p = state.preview;

    out += renderDistributionDetail();

    if (p && p.seo && !p.error) {
      out += '<div class="dx-card"><h4>What we read</h4>'
        + '<div class="dx-row"><span>Type</span><b style="font-size:13.5px">' + esc(p.seo.content_type) + '</b></div>'
        + '<div class="dx-row"><span>Primary</span><b style="font-size:13.5px">'
        + (p.seo.primary ? '$' + esc(p.seo.primary) : '—') + '</b></div>'
        + (p.seo.optimal_time
            ? '<div class="dx-row"><span>Best send time</span><b style="font-size:13px">'
              + esc(p.seo.optimal_time.slice(5, 16).replace(' ', ' · ')) + ' UTC</b></div>'
            : '')
        + '<div class="dx-chips">'
        + (p.seo.symbols || []).map(function (s) {
            return '<span class="dx-chip">$' + esc(s.symbol) + '</span>';
          }).join('')
        + '</div>'
        + '<div class="dx-chips">'
        + (p.seo.keywords || []).slice(0, 6).map(function (k) {
            return '<span class="dx-chip grey">' + esc(k) + '</span>';
          }).join('')
        + '</div></div>';

      out += '<div class="dx-card"><h4>Meta description</h4>'
        + '<div class="cs-hint" style="color:#c2cede">' + esc(p.seo.meta_desc) + '</div>'
        + '<div class="cs-hint" style="margin-top:8px">' + p.seo.meta_desc.length + ' / 155 characters</div></div>';

      if (p.card && p.card.url) {
        out += '<div class="dx-card"><h4>Preview card</h4>'
          + '<img class="dx-cardimg" src="' + esc(p.card.url) + '" alt=""></div>';
      }
    }

    if (state.stats) {
      var t = state.stats.totals;
      out += '<div class="dx-card"><h4>Last ' + state.stats.days + ' days</h4>'
        + '<div class="dx-row"><span>Posts sent</span><b>' + t.sent + '</b></div>'
        + '<div class="dx-row"><span>Clicks back</span><b>' + t.clicks + '</b></div>'
        + (t.failed ? '<div class="dx-row"><span>Failed</span><b style="color:#ff8a9b">' + t.failed + '</b></div>' : '')
        + (state.stats.by_platform || []).map(function (b) {
            return '<div class="dx-row"><span>' + esc(b.label) + '</span><b>' + b.clicks + '</b></div>';
          }).join('')
        + '</div>';
    }

    return out;
  }

  function render() {
    if (state.loading) {
      root.innerHTML = '<div class="dx-card"><div class="dx-empty">Loading…</div></div>';
      return;
    }
    root.innerHTML = renderBanners() + renderAccounts() + renderConnectionDirectory() + renderPicker() + renderPosts() + renderQueue();
    side.innerHTML = renderSide();
  }

  /* ---------------- events ---------------- */

  root.addEventListener('change', function (e) {
    if (e.target.id === 'dx-content') {
      var parts = String(e.target.value || '').split(':');
      state.seed = 0;
      state.platform = '';
      selectContent(parts[0] || 'letter', Number(parts[1] || 0));
    }
  });

  root.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-plat]');
    if (tab) { state.platform = tab.getAttribute('data-plat'); state.seed = 0; render(); return; }

    var seed = e.target.closest('[data-seed]');
    if (seed) { state.seed = Number(seed.getAttribute('data-seed')); render(); return; }

    var copy = e.target.closest('[data-copy]');
    if (copy) { copyFrom('dx-caption', copy); return; }

    var tags = e.target.closest('[data-copy-tags]');
    if (tags) { copyFrom('dx-firstcomment', tags); return; }

    var alt = e.target.closest('[data-copy-alt]');
    if (alt) { copyFrom('dx-alttext', alt); return; }

    var unlink = e.target.closest('[data-unlink]');
    if (unlink) {
      if (!window.confirm('Unlink this account? Your rules and history are kept.')) { return; }
      dist('/accounts/' + unlink.getAttribute('data-unlink') + '/delete', { method: 'POST', json: {} })
        .then(function () { return dist('/accounts'); })
        .then(function (r) { state.accounts = r.accounts || []; render(); })
        .catch(function (err) { window.alert(err.message); });
      return;
    }

    var retry = e.target.closest('[data-retry]');
    if (retry) {
      dist('/queue/' + retry.getAttribute('data-retry') + '/retry', { method: 'POST', json: {} })
        .then(function () { return dist('/drain', { method: 'POST', json: {} }); })
        .then(function () { return dist('/queue'); })
        .then(function (r) { state.queue = r.queue || []; render(); })
        .catch(function (err) { window.alert(err.message); });
      return;
    }

    var metaConnect = e.target.closest('[data-meta-connect]');
    if (metaConnect) {
      connectMeta(metaConnect.getAttribute('data-meta-connect'), metaConnect);
      return;
    }

    if (e.target.id === 'dx-link') { linkBluesky(); }
  });

  function copyFrom(id, btn) {
    var el = document.getElementById(id);
    if (!el) { return; }
    var text = el.textContent;
    var done = function () {
      var label = btn.textContent;
      btn.classList.add('done');
      btn.textContent = 'Copied';
      window.setTimeout(function () { btn.classList.remove('done'); btn.textContent = label; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing more to try */ }
    document.body.removeChild(ta);
  }

  function connectMeta(platform, btn) {
    var err = document.getElementById('dx-metaerr');
    if (btn) { btn.disabled = true; }
    if (err) { err.textContent = ''; }
    dist('/meta/connect/' + encodeURIComponent(platform))
      .then(function (r) {
        if (!r.authorize_url) { throw new Error('Meta did not return a connection URL.'); }
        window.location.assign(r.authorize_url);
      })
      .catch(function (e) {
        if (btn) { btn.disabled = false; }
        if (err) { err.textContent = e.message; }
      });
  }

  function linkBluesky() {
    var handle = (document.getElementById('dx-handle') || {}).value || '';
    var pw = (document.getElementById('dx-apppw') || {}).value || '';
    var err = document.getElementById('dx-linkerr');
    var btn = document.getElementById('dx-link');
    if (!handle.trim() || !pw.trim()) {
      if (err) { err.textContent = 'Both fields are needed.'; }
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Linking…'; }
    if (err) { err.textContent = ''; }

    dist('/accounts/bluesky', { method: 'POST', json: { handle: handle.trim(), app_password: pw.trim() } })
      .then(function () { return Promise.all([dist('/accounts'), dist('/status')]); })
      .then(function (r) {
        state.accounts = r[0].accounts || [];
        state.status = r[1];
        render();
      })
      .catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Link account'; }
        if (err) { err.textContent = e.message; }
      });
  }

  boot();
})();
SMLDISTJS;
    }
}

if (!function_exists('sml_dist_render_page')) {
    function sml_dist_render_page() {
        $config = sml_dist_page_config();

        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=' . get_bloginfo('charset'));

        echo '<!doctype html><html ' . get_language_attributes() . '><head>';
        echo '<meta charset="' . esc_attr(get_bloginfo('charset')) . '">';
        echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
        echo '<meta name="robots" content="noindex,nofollow">';
        echo '<title>Distribution - Creator Studio - ' . esc_html(get_bloginfo('name')) . '</title>';
        echo '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
        echo '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
        echo '<style>' . sml_cs_styles() . sml_dist_page_styles() . '</style></head><body>';

        if (!is_user_logged_in()) {
            echo '<div class="cs-gate"><h1>Sign in to distribute</h1>';
            echo '<p>Auto-share posts to your linked accounts whenever you publish.</p>';
            echo '<a class="cs-btn cs-btn-primary" href="' . esc_url($config['loginUrl']) . '">Sign in to continue</a>';
            echo '</div></body></html>';
            exit;
        }

        echo '<div class="cs-shell">';

        echo '<aside class="cs-side"><a class="cs-brand" href="' . esc_url(home_url('/')) . '">';
        echo '<svg width="32" height="32" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="#2b6cff" stroke-width="2.4"/><path d="M11 25.5l5.4-6.2 4 3.6 7.4-9" stroke="#2b6cff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        echo '<b>StockMarket<em>Loop</em></b></a>';
        echo '<div class="cs-side-label">CREATOR STUDIO</div><nav class="cs-nav">';
        foreach (sml_cs_nav_items() as $item) {
            $active = $item['key'] === 'distribute' ? ' class="cs-on"' : '';
            echo '<a href="' . esc_url($item['url']) . '"' . $active . '>' . sml_cs_nav_icon($item['key']) . esc_html($item['label']) . '</a>';
        }
        echo '</nav>';
        echo '<div class="cs-help"><b>Create once, land everywhere</b>';
        echo '<p>Loop Letters, uploaded videos, and public live streams become platform-ready posts with click tracking.</p>';
        echo '<a href="' . esc_url(home_url('/loop-letters/')) . '">Create content</a></div></aside>';

        echo '<div class="cs-main">';
        echo '<header class="cs-top"><div class="cs-crumb">Creator Studio<span>/</span><b>Distribution</b></div>';
        echo '<div class="cs-autosave"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.6 2.6L16 9.6"/></svg>';
        echo '<span>Connected content can send within a few minutes of publishing</span></div>';
        echo '<a class="cs-top-btn" href="' . esc_url(home_url('/loop-letters/')) . '">Create</a>';
        echo '<a class="cs-avatar" href="' . esc_url(home_url('/creator-studio/')) . '"><img src="' . esc_url($config['avatar']) . '" alt="">';
        echo '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8798ac" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 5.5 6-5.5"/></svg></a>';
        echo '</header>';

        echo '<div class="dx-body"><main class="dx-main" id="dx-root"></main><aside class="dx-side" id="dx-side"></aside></div>';
        echo '</div></div>';

        echo '<script>window.smlDistConfig=' . wp_json_encode($config) . ';</script>';
        echo '<script>' . sml_dist_page_script() . '</script>';
        echo '</body></html>';
        exit;
    }
}

if (!function_exists('sml_dist_intercept_page')) {
    function sml_dist_intercept_page() {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        $path = trim((string) wp_parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
        if ($path !== 'distribute' || isset($_GET['classic'])) {
            return;
        }
        sml_dist_render_page();
    }
}
add_action('template_redirect', 'sml_dist_intercept_page', 0);

if (!function_exists('sml_dist_nav_item')) {
    function sml_dist_nav_item($items) {
        $out = array();
        foreach ($items as $item) {
            $out[] = $item;
            if ($item['key'] === 'letters') {
                $out[] = array('key' => 'distribute', 'label' => 'Distribution', 'url' => home_url('/distribute/'));
            }
        }
        return $out;
    }
}
