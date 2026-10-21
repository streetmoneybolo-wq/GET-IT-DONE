(function () {
  "use strict";
  if (window.SMLAuth) return;
  var cfg = window.SMLX_AUTH || {};
  var root = document.querySelector("[data-sml-auth-modal]");
  if (!root) return;
  window.SMLGuestLandingRepair = true; // the old script is gone; keep any stray copy from starting

  function qs(s, r) { return (r || root).querySelector(s); }
  function qsa(s, r) { return Array.prototype.slice.call((r || root).querySelectorAll(s)); }
  var card = qs(".smlx-card"), statusEl = qs("[data-auth-status]");
  var forms = { signup: qs("[data-signup-form]"), login: qs("[data-login-form]"), verify: qs("[data-verify-form]") };
  var oauthEl = qs("[data-oauth]"), discordEl = qs("[data-discord]");
  var tabsEl = qs("[data-tabs]"), titleEl = qs("[data-auth-title]"), subEl = qs("[data-auth-sub]");
  var current = "signup", opener = null, failedLogins = 0, cooldownTimer = null;

  /* ---------- small helpers ---------- */
  var params = (function () { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(""); } })();
  function cleanHandle(v) { return String(v || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.]/g, "").slice(0, 30); }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim()); }
  function mask(email) { var p = String(email || "").split("@"); if (p.length !== 2) return email; var a = p[0]; return a.slice(0, Math.min(2, a.length)) + "***@" + p[1]; }
  function afterAuth() {
    var to = params.get("redirect_to") || params.get("redirect") || "";
    try { var u = new URL(to, location.origin); if (u.origin === location.origin && u.pathname.indexOf("wp-login.php") === -1) return u.href; } catch (e) { /* the home page */ }
    return cfg.home || "/";
  }
  /* Continue with Discord: back to the page the member was on (never the sign-in pages themselves, never another site) */
  function returnPath() {
    var to = params.get("redirect_to") || params.get("redirect") || "";
    try { var u = new URL(to, location.origin); if (to && u.origin === location.origin && u.pathname.indexOf("wp-login.php") === -1) return u.pathname + u.search; } catch (e) { /* the page they are on */ }
    var p = location.pathname; return /^\/(login|register|sign-in|sign-up|sign-up-sign-in)\/?$/.test(p) ? "/" : p + location.search;
  }
  if (cfg.discord && discordEl) { discordEl.href = cfg.discord + "?return=" + encodeURIComponent(returnPath()); oauthEl.hidden = false; }
  function setBusy(btn, on) { if (!btn) return; btn.disabled = !!on; btn.dataset.busy = on ? "1" : "0"; }
  function say(msg, bad) { statusEl.hidden = !msg; statusEl.textContent = msg || ""; statusEl.dataset.error = bad ? "1" : "0"; }
  function fieldErr(name, msg, input) {
    var el = qs('[data-err="' + name + '"]'); if (el) el.textContent = msg || "";
    if (input) { if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
  }
  function clearErrs(form) { qsa("[data-err]", form).forEach(function (e) { e.textContent = ""; }); qsa("input", form).forEach(function (i) { i.removeAttribute("aria-invalid"); }); say(""); }

  /* ---------- the API (the guest nonce goes first; a stale cached one is retried without it) ---------- */
  function api(path, body) {
    function go(withNonce) {
      var h = { "Content-Type": "application/json" };
      if (withNonce && cfg.nonce) h["X-WP-Nonce"] = cfg.nonce;
      return fetch(cfg.api + path, { method: "POST", credentials: "same-origin", cache: "no-store", headers: h, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { j = j || {}; j.status = r.status; throw j; } return j; }); });
    }
    return go(true).catch(function (e) { if (e && e.code === "rest_cookie_invalid_nonce") return go(false); throw e; });
  }
  function errText(e, fallback) {
    if (e && e.status === 429) return "Too many attempts. Wait a minute and try again.";
    if (e && typeof e.message === "string" && e.message) return e.message.replace(/<[^>]+>/g, "");
    if (e instanceof TypeError) return "Can't reach the server. Check your connection and try again.";
    return fallback;
  }
  function needsVerification(r) { return !!(r && (r.verification_required || r.needs_verification || r.requires_verification || r.verify || r.email_verification_required)); }

  /* ---------- views ---------- */
  var COPY = {
    signup: ["Create your account", "Free to join. Follow traders, post your ideas, get paid."],
    login: ["Welcome back", "Log in to your StockMarketLoop account."],
    verify: ["Check your email", "Enter the 5-digit code we sent."]
  };
  function view(name, keepStatus) {
    current = forms[name] ? name : "signup";
    Object.keys(forms).forEach(function (k) { forms[k].hidden = k !== current; });
    tabsEl.hidden = current === "verify"; if (oauthEl && cfg.discord) oauthEl.hidden = current === "verify";
    qsa("[data-auth-tab]", tabsEl).forEach(function (b) { var on = b.dataset.authTab === current; b.dataset.active = on ? "1" : "0"; b.setAttribute("aria-selected", on ? "true" : "false"); });
    titleEl.textContent = COPY[current][0]; subEl.textContent = COPY[current][1];
    if (!keepStatus) say("");
  }
  function focusFirst() {
    var el = current === "verify" ? qs("[data-otp] input", forms.verify) : qs("input:not([type=hidden]):not([type=checkbox])", forms[current]);
    if (el) setTimeout(function () { el.focus(); }, 30);
  }
  function open(which) {
    opener = document.activeElement;
    view(which === "login" ? "login" : "signup");
    root.dataset.open = "1"; root.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("smlx-lock");
    focusFirst();
  }
  function close() {
    root.dataset.open = "0"; root.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("smlx-lock");
    if (opener && opener.focus) try { opener.focus(); } catch (e) { /* gone */ }
  }

  /* ---------- sign-up: the handle ---------- */
  var H = { ok: false, value: "", seq: 0, touched: false, timer: null, promise: Promise.resolve(false) };
  var handleIn = qs("input[name=handle]", forms.signup), handleNote = qs("[data-handle-status]"), chips = qs("[data-handle-chips]"), handleBox = qs(".smlx-handle");
  function handleUI(msg, state) { handleNote.textContent = msg; handleNote.dataset.state = state || ""; handleBox.dataset.state = state || ""; }
  function available(h) {
    return fetch(cfg.api + "handle-availability?handle=" + encodeURIComponent(h), { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); }).then(function (row) { return { ok: !!(row && row.available), msg: row && row.message }; });
  }
  function suggest(base) {
    chips.innerHTML = "";
    var tries = [base + "_", base + Math.floor(10 + Math.random() * 90), base + "." + String(new Date().getFullYear()).slice(2), base + Math.floor(100 + Math.random() * 900)]
      .map(cleanHandle).filter(function (x, i, a) { return x.length >= 3 && a.indexOf(x) === i; });
    Promise.all(tries.map(function (t) { return available(t).then(function (r) { return r.ok ? t : null; }).catch(function () { return null; }); })).then(function (list) {
      if (H.value !== base) return;
      list.filter(Boolean).slice(0, 3).forEach(function (t) {
        var b = document.createElement("button"); b.type = "button"; b.textContent = "@" + t;
        b.addEventListener("click", function () { H.touched = true; handleIn.value = t; chips.innerHTML = ""; checkHandle(t); handleIn.focus(); });
        chips.appendChild(b);
      });
    });
  }
  function checkHandle(raw) {
    var h = cleanHandle(raw); H.value = h; H.ok = false; chips.innerHTML = ""; fieldErr("handle", "", handleIn);
    if (h.length < 3) { handleUI("Letters, numbers, dots and underscores, 3 or more.", ""); H.promise = Promise.resolve(false); return H.promise; }
    var seq = ++H.seq; handleUI("Checking @" + h + "...", "");
    H.promise = available(h).then(function (r) {
      if (seq !== H.seq) return false;
      H.ok = r.ok;
      if (r.ok) handleUI("@" + h + " is yours. Your profile: " + (cfg.home || "/") + h + "/", "ok");
      else { handleUI(r.msg || "@" + h + " is taken.", "bad"); suggest(h); }
      return r.ok;
    }).catch(function () { if (seq === H.seq) handleUI("Couldn't check that handle. We'll check again when you submit.", ""); return false; });
    return H.promise;
  }
  handleIn.addEventListener("input", function () {
    var c = cleanHandle(handleIn.value); if (handleIn.value !== c) handleIn.value = c;
    H.touched = true; H.ok = false; clearTimeout(H.timer); H.timer = setTimeout(function () { checkHandle(c); }, 350);
  });
  forms.signup.display_name.addEventListener("input", function () {
    if (H.touched) return; var s = cleanHandle(forms.signup.display_name.value.replace(/\s+/g, "")); handleIn.value = s;
    clearTimeout(H.timer); H.timer = setTimeout(function () { checkHandle(s); }, 450);
  });
  forms.signup.email.addEventListener("blur", function () {
    var v = forms.signup.email.value.trim();
    if (!H.touched && !handleIn.value && validEmail(v)) { handleIn.value = cleanHandle(v.split("@")[0]); checkHandle(handleIn.value); }
  });

  /* ---------- sign-up: email typo hint, password meter ---------- */
  var TYPOS = { "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gnail.com": "gmail.com", "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.con": "yahoo.com", "outlok.com": "outlook.com", "outlook.con": "outlook.com", "icloud.con": "icloud.com", "iclod.com": "icloud.com" };
  var fix = qs("[data-email-fix]");
  forms.signup.email.addEventListener("blur", function () {
    var v = forms.signup.email.value.trim(), p = v.split("@"), better = p.length === 2 && TYPOS[p[1].toLowerCase()];
    if (better) { fix.hidden = false; fix.textContent = "Did you mean " + p[0] + "@" + better + "?"; fix.onclick = function () { forms.signup.email.value = p[0] + "@" + better; fix.hidden = true; }; } else fix.hidden = true;
  });
  var meter = qs("[data-meter]"), passHint = qs("[data-pass-hint]");
  var COMMON = /^(password|passw0rd|12345678|123456789|1234567890|qwertyui|qwerty123|letmein1|iloveyou|11111111|00000000|abcd1234)/i;
  function scorePass(p) {
    var s = 0; if (p.length >= 8) s++; if (p.length >= 12) s++; if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++; if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p) || (/\d/.test(p) && p.length >= 10)) s++;
    var low = p.toLowerCase(), em = forms.signup.email.value.split("@")[0].toLowerCase();
    if (COMMON.test(p) || (em.length >= 4 && low.indexOf(em) !== -1) || (H.value.length >= 4 && low.indexOf(H.value) !== -1)) s = Math.min(s, 1);
    return p.length < 8 ? 0 : Math.max(1, s);
  }
  forms.signup.password.addEventListener("input", function () {
    var p = forms.signup.password.value, s = scorePass(p), L = ["", "Weak", "Okay", "Good", "Strong"], C = ["#ff5c7a", "#ff5c7a", "#ffb04a", "#8fe36a", "#36f08d"];
    meter.style.width = (p ? Math.max(8, s * 25) : 0) + "%"; meter.style.background = C[s];
    passHint.textContent = !p ? "Use 8 or more characters. A longer phrase beats a short, clever one." : p.length < 8 ? (8 - p.length) + " more character" + (8 - p.length === 1 ? "" : "s") + " to go." : s <= 1 ? "Easy to guess. Add length or mix in more." : L[s] + " password.";
    fieldErr("password", "", forms.signup.password);
  });
  qsa("[data-toggle-pass]").forEach(function (b) {
    b.addEventListener("click", function () {
      var input = b.parentNode.querySelector("input"), show = input.type === "password";
      input.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-pressed", show ? "true" : "false"); b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });

  /* ---------- sign-up: submit ---------- */
  forms.signup.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = forms.signup, btn = qs("[data-signup-submit]"), bad = null;
    clearErrs(f);
    var email = f.email.value.trim(), name = f.display_name.value.trim(), handle = cleanHandle(handleIn.value), pw = f.password.value;
    if (!validEmail(email)) { fieldErr("email", "Enter a valid email address.", f.email); bad = bad || f.email; }
    if (name.length < 2) { fieldErr("display_name", "Use at least 2 characters.", f.display_name); bad = bad || f.display_name; }
    if (handle.length < 3) { fieldErr("handle", "Choose a handle with at least 3 characters.", handleIn); bad = bad || handleIn; }
    if (pw.length < 8) { fieldErr("password", "Use at least 8 characters.", f.password); bad = bad || f.password; }
    else if (COMMON.test(pw)) { fieldErr("password", "That password is too common. Pick something longer.", f.password); bad = bad || f.password; }
    if (bad) { bad.focus(); return; }
    setBusy(btn, true);
    var ready = (H.value === handle && H.ok) ? Promise.resolve(true) : checkHandle(handle);
    ready.then(function (ok) {
      if (!ok) { fieldErr("handle", "That handle isn't available. Pick one of the suggestions or try another.", handleIn); handleIn.focus(); setBusy(btn, false); return; }
      return api("register", { email: email, display_name: name, handle: handle, password: pw, remember: !!f.remember.checked, referral_code: params.get("ref") || "" }).then(function (r) {
        if (needsVerification(r) || (r && r.created && !r.logged_in)) { toVerify(email, (r && r.message) || "", r && r.email_sent === false); return; }
        if (r && r.logged_in) { say((r && r.message) || "Welcome to StockMarketLoop. Taking you in...", false); setTimeout(function () { location.href = afterAuth(); }, 500); return; }
        toVerify(email, (r && r.message) || "", false);
      }).catch(function (err) {
        var t = errText(err, "We couldn't create the account. Check the fields and try again.");
        if (/email/i.test(t) && /(already|exists|registered|in use|taken)/i.test(t)) {
          fieldErr("email", "That email already has an account.", f.email);
          say("That email already has an account. ", true);
          var b = document.createElement("button"); b.type = "button"; b.className = "smlx-link"; b.textContent = "Log in instead";
          b.addEventListener("click", function () { forms.login.login.value = email; view("login"); focusFirst(); }); statusEl.appendChild(b);
        } else if (/handle/i.test(t) && /(taken|available|exists|use)/i.test(t)) { H.ok = false; fieldErr("handle", t, handleIn); checkHandle(handle); }
        else say(t, true);
        setBusy(btn, false);
      });
    }).catch(function () { setBusy(btn, false); });
  });

  /* ---------- log in ---------- */
  forms.login.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = forms.login, btn = qs("[data-login-submit]"); clearErrs(f);
    var who = f.login.value.trim(), pw = f.password.value;
    if (!who) { fieldErr("login", "Enter your email or username.", f.login); f.login.focus(); return; }
    if (!pw) { fieldErr("lpassword", "Enter your password.", f.password); f.password.focus(); return; }
    setBusy(btn, true);
    api("login", { login: who, password: pw, remember: !!f.remember.checked }).then(function (r) {
      if (needsVerification(r)) { toVerify((r && r.email) || who, (r && r.message) || "", r && r.email_sent === false); return; }
      if (r && r.two_step && r.redirect) { say("One more step: enter your two-step code.", false); location.href = r.redirect; return; }
      say("Logged in. Taking you in...", false); setTimeout(function () { location.href = afterAuth(); }, 350);
    }).catch(function (err) {
      var t = errText(err, "That email or password didn't match.");
      if (/verif/i.test(t) && /(not|un|pending|confirm)/i.test(t)) { toVerify(validEmail(who) ? who : (err && err.email) || "", t, false); setBusy(btn, false); return; }
      failedLogins++; say(t, true); f.password.value = ""; f.password.focus();
      if (failedLogins >= 2) { var a = qs("[data-forgot]"); a.style.fontWeight = "800"; a.style.textDecoration = "underline"; }
      setBusy(btn, false);
    });
  });
  qs("[data-forgot]").addEventListener("click", function (e) {
    var who = forms.login.login.value.trim(); if (who) { e.preventDefault(); location.href = (cfg.reset || "/wp-login.php?action=lostpassword") + (String(cfg.reset).indexOf("?") === -1 ? "?" : "&") + "user_login=" + encodeURIComponent(who); }
  });

  /* ---------- verify: five boxes, paste, auto-submit, resend cooldown ---------- */
  var otp = qsa("[data-otp] input");
  function code() { return otp.map(function (i) { return i.value; }).join(""); }
  function toVerify(email, msg, emailFailed) {
    forms.verify.email.value = email || "";
    view("verify", true);
    subEl.textContent = email ? "We sent a 5-digit code to " + mask(email) + "." : "Enter the 5-digit code we emailed you.";
    say(emailFailed ? "We couldn't send the email. Tap Resend code in a moment." : (msg && !/^verification email sent/i.test(msg) ? msg : ""), !!emailFailed);
    otp.forEach(function (i) { i.value = ""; }); ["[data-verify-submit]", "[data-signup-submit]", "[data-login-submit]"].forEach(function (s) { setBusy(qs(s), false); });
    cooldown(emailFailed ? 5 : 30); focusFirst();
  }
  function cooldown(sec) {
    var b = qs("[data-resend-code]"), t = qs("[data-cooldown]"); clearInterval(cooldownTimer); b.disabled = true;
    (function tick() { if (sec <= 0) { b.disabled = false; t.textContent = ""; return; } t.textContent = "(" + sec + "s)"; sec--; cooldownTimer = setTimeout(tick, 1000); })();
  }
  function submitVerify() {
    var c = code(), btn = qs("[data-verify-submit]"); if (c.length !== 5) { say("Enter all 5 digits.", true); return; }
    setBusy(btn, true); say("");
    api("verify", { email: forms.verify.email.value.trim(), code: c, remember: true }).then(function (r) {
      if (r && r.two_step && r.redirect) { say("One more step: enter your two-step code.", false); location.href = r.redirect; return; }
      say("Verified. Taking you in...", false); setTimeout(function () { location.href = afterAuth(); }, 400);
    }).catch(function (err) {
      say(errText(err, "That code didn't work. Check it and try again, or resend a new one."), true);
      otp.forEach(function (i) { i.value = ""; }); otp[0].focus(); setBusy(btn, false);
    });
  }
  otp.forEach(function (input, i) {
    input.addEventListener("input", function () {
      var v = input.value.replace(/\D/g, ""); input.value = v.slice(-1);
      if (v && i < otp.length - 1) otp[i + 1].focus();
      if (code().length === 5) submitVerify();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && !input.value && i > 0) { otp[i - 1].focus(); otp[i - 1].value = ""; e.preventDefault(); }
      else if (e.key === "ArrowLeft" && i > 0) otp[i - 1].focus(); else if (e.key === "ArrowRight" && i < otp.length - 1) otp[i + 1].focus();
    });
    input.addEventListener("paste", function (e) {
      var d = ((e.clipboardData || window.clipboardData).getData("text") || "").replace(/\D/g, "").slice(0, 5); if (!d) return; e.preventDefault();
      d.split("").forEach(function (ch, k) { otp[k].value = ch; }); otp[Math.min(d.length, 4)].focus(); if (d.length === 5) submitVerify();
    });
    input.addEventListener("focus", function () { input.select(); });
  });
  forms.verify.addEventListener("submit", function (e) { e.preventDefault(); submitVerify(); });
  qs("[data-resend-code]").addEventListener("click", function () {
    var email = forms.verify.email.value.trim(); if (!email) { say("Enter your email first.", true); return; }
    say("Sending a new code...", false);
    api("resend-code", { email: email }).then(function (r) { say((r && r.message) || "A new code is on its way.", !!(r && r.email_sent === false)); cooldown(30); })
      .catch(function (err) { say(errText(err, "We couldn't resend the code. Try again in a minute."), true); });
  });
  qs("[data-verify-back]").addEventListener("click", function () { view("signup"); focusFirst(); });

  /* ---------- opening, closing, keyboard ---------- */
  qsa("[data-auth-tab]").forEach(function (b) { b.addEventListener("click", function () { view(b.dataset.authTab); focusFirst(); }); });
  qs("[data-sml-auth-close]").addEventListener("click", close);
  root.addEventListener("mousedown", function (e) { if (e.target === root) close(); });
  document.addEventListener("keydown", function (e) {
    if (root.dataset.open !== "1") return;
    if (e.key === "Escape") { close(); return; }
    if (e.key !== "Tab") return;
    var f = qsa("button:not([disabled]),input:not([type=hidden]):not([disabled]),a[href]", card).filter(function (el) { return el.offsetParent !== null; });
    if (!f.length) return; var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });

  /* the links that already open it: [data-sml-guest-open], wp-login.php links, #stockmarketloop-signup / -login */
  function modeFromHref(href) {
    try {
      var u = new URL(href, location.origin);
      if (u.pathname.indexOf("/wp-login.php") === -1) return "";
      var a = (u.searchParams.get("action") || "").toLowerCase();
      if (a === "logout" || a === "lostpassword" || a === "rp" || a === "resetpass" || a === "googlesitekit_auth") return "";
      return a === "register" ? "signup" : "login";
    } catch (e) { return ""; }
  }
  function normalize(scope) {
    qsa('a[href*="wp-login.php"],a[data-login-link],a[data-register-link]', scope || document).forEach(function (a) {
      if (root.contains(a) || (a.closest && a.closest("#wpadminbar,.wp-admin,.admin-bar"))) return;
      var m = a.hasAttribute("data-register-link") ? "signup" : a.hasAttribute("data-login-link") ? "login" : modeFromHref(a.getAttribute("href") || ""); if (!m) return;
      a.setAttribute("data-sml-guest-open", m); a.setAttribute("href", m === "signup" ? "#stockmarketloop-signup" : "#stockmarketloop-login");
    });
  }
  normalize(document);
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("[data-sml-guest-open],a[href^='#stockmarketloop-']") : null;
    if (!a || root.contains(a)) return;
    var m = a.getAttribute("data-sml-guest-open") || (/login/.test(a.getAttribute("href") || "") ? "login" : "signup");
    e.preventDefault(); e.stopPropagation(); open(m);
  }, true);
  if (window.MutationObserver) new MutationObserver(function (muts) { muts.forEach(function (m) { m.addedNodes && m.addedNodes.forEach(function (n) { if (n && n.nodeType === 1) normalize(n); }); }); }).observe(document.documentElement, { childList: true, subtree: true });

  function fromLocation() {
    var h = (location.hash || "").toLowerCase(), m = params.get("mode");
    if (h === "#stockmarketloop-login" || m === "login") open("login"); else if (h === "#stockmarketloop-signup" || m === "signup") open("signup");
  }
  window.addEventListener("hashchange", fromLocation); fromLocation();

  window.SMLAuth = { open: open, close: close, view: view };
})();
