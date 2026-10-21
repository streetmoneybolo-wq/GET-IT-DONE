(function () {
  'use strict';
  var ua = navigator.userAgent || '', plat = navigator.platform || '';
  var touchMac = /Mac/.test(plat) && navigator.maxTouchPoints > 1;
  var isIOS = /iPhone|iPad|iPod/.test(ua) || touchMac;
  var isAndroid = /Android/.test(ua);
  var isWin = /Windows/.test(ua), isMac = /Mac/.test(plat) && !touchMac, isLinux = /Linux/.test(plat) && !isAndroid;
  var inApp = /FBAN|FBAV|Instagram|TikTok|musical_ly|Line\/|Snapchat|Twitter|LinkedInApp|; wv\)/i.test(ua) || (isIOS && !/Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua));
  var isFirefox = /Firefox|FxiOS/.test(ua), isSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/.test(ua), isEdge = /Edg\//.test(ua), isChromium = /Chrome|Chromium|CriOS/.test(ua) && !isEdge;
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var $ = function (id) { return document.getElementById(id); };
  var deferred = null, status = $('status');
  var APP = location.origin + '/app/';
  function h(html) { status.innerHTML = html; }
  function steps(list) { return '<ol>' + list.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>'; }
  function installBtn(label) { return '<button id="install" class="btn" type="button">' + label + '</button>'; }
  function wireInstall() {
    var b = $('install'); if (!b) return;
    b.addEventListener('click', function () {
      if (!deferred) return; deferred.prompt();
      deferred.userChoice.then(function (c) { deferred = null; if (c && c.outcome === 'accepted') h('<h2>INSTALLED</h2><p class="ok">StockMarketLoop is installing. Find it on your home screen or in your apps.</p><a class="btn" href="/app/">Open the app</a>'); });
    });
  }

  function render() {
    if (standalone) { h('<h2>YOU ARE IN THE APP</h2><p class="ok">StockMarketLoop is installed on this device.</p><a class="btn" href="/app/">Open the app</a>'); return; }
    if (inApp) {
      h('<h2>OPEN IN YOUR BROWSER</h2><p class="warn">This in-app browser cannot install apps.</p>' + steps(isIOS ? ['Tap the <span class="ic">⋯</span> or share button in this window.', 'Choose <b>Open in Safari</b>.', 'Come back to this page and follow the steps.'] : ['Tap the <span class="ic">⋮</span> menu in this window.', 'Choose <b>Open in Chrome</b> (or your browser).', 'Come back to this page and tap Install.']));
      return;
    }
    if (isIOS) {
      var safariHint = isSafari ? '' : '<p class="warn">Tip: Safari is the most reliable way to add apps on iPhone and iPad.</p>';
      h('<h2>INSTALL ON IPHONE / IPAD</h2>' + safariHint + steps(['Tap the <b>Share</b> button <span class="ic">⬆︎</span> at the bottom (iPad: top right) of the browser.', 'Scroll and tap <b>Add to Home Screen</b>.', 'Keep the name <b>StockMarketLoop</b> and tap <b>Add</b>.', 'Open it from your home screen. Turn on notifications when it asks.']) + '<a class="btn alt" href="/app/">Preview the app first</a>');
      return;
    }
    if (isAndroid) {
      h('<h2>INSTALL ON ANDROID</h2>' + (deferred ? '<p>One tap and it is on your home screen.</p>' + installBtn('Install StockMarketLoop') : '<p>' + (isChromium || isEdge ? 'Your browser did not offer the install button yet. Use the menu:' : 'For the best install, open this page in Chrome. Or use the menu:') + '</p>' + steps(['Tap the <span class="ic">⋮</span> menu.', 'Tap <b>Install app</b> or <b>Add to Home screen</b>.', 'Tap <b>Install</b>.'])) + '<a class="btn alt" href="/app/">Preview the app first</a>');
      wireInstall(); return;
    }
    // desktop
    var where = isWin ? 'Windows' : isMac ? 'Mac' : isLinux ? 'Linux' : 'your computer';
    var body;
    if (deferred) body = '<p>Installs as its own window with its own icon.</p>' + installBtn('Install on ' + where);
    else if (isSafari && isMac) body = steps(['In the menu bar choose <b>File</b>, then <b>Add to Dock…</b>.', 'Click <b>Add</b>.']);
    else if (isFirefox) body = '<p class="warn">Firefox cannot install web apps. Open this page in Chrome or Edge, or use a download below.</p>';
    else body = '<p>Look for the install icon <span class="ic">⊕</span> at the right end of the address bar, or open the browser menu and choose <b>Install StockMarketLoop</b>.</p>';
    h('<h2>INSTALL ON ' + where.toUpperCase() + '</h2>' + body + '<a class="btn alt" href="/app/">Open in the browser</a>');
    wireInstall();
  }

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; render(); });
  window.addEventListener('appinstalled', function () { standalone = true; render(); });
  render();

  // the other devices, so a phone link can be opened from a laptop and the reverse
  var others = $('others');
  [['iPhone / iPad', 'ios'], ['Android', 'android'], ['Windows', 'win'], ['Mac', 'mac']].forEach(function (d) {
    var a = document.createElement('a'); a.href = '#'; a.textContent = d[0]; a.addEventListener('click', function (e) { e.preventDefault(); force(d[1]); }); others.appendChild(a);
  });
  function force(kind) {
    isIOS = kind === 'ios'; isAndroid = kind === 'android'; isWin = kind === 'win'; isMac = kind === 'mac'; isLinux = false; touchMac = false; inApp = false; standalone = false; deferred = isIOS ? null : deferred;
    if (kind === 'win' || kind === 'mac') { isSafari = kind === 'mac' && /Safari/.test(ua) && !/Chrome/.test(ua); }
    render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // native downloads the owner has published (SML_APP_*_URL); the list is empty until then
  fetch('/app/downloads.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
    var items = [['ios', 'App Store (iPhone / iPad)'], ['android', 'Android app (APK)'], ['windows', 'Windows installer'], ['mac', 'Mac app'], ['linux', 'Linux app']].filter(function (x) { return d && d[x[0]]; });
    if (!items.length) return;
    $('native').hidden = false;
    $('native-list').innerHTML = items.map(function (x) { return '<a class="btn alt" href="' + String(d[x[0]]).replace(/"/g, '&quot;') + '" rel="noopener">' + x[1] + '</a>'; }).join('');
  }).catch(function () { /* the web install above always works */ });

  var link = location.origin + '/app/get';
  $('copy').addEventListener('click', function () {
    var done = function () { $('copy').textContent = 'Link copied'; setTimeout(function () { $('copy').textContent = 'Copy link'; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { window.prompt('Copy this link', link); }); else window.prompt('Copy this link', link);
  });
  if (navigator.share) { $('share').hidden = false; $('share').addEventListener('click', function () { navigator.share({ title: 'StockMarketLoop app', text: 'Get the StockMarketLoop app', url: link }).catch(function () {}); }); }
})();
