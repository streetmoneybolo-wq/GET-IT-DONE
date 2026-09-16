/* ===========================================================================
 * SML Identity Verify — js/identity-verify.js  (mounts on /verify-identity/)
 *
 * Drives the Stripe Identity flow via sml-idv/v1. The site never receives the
 * ID document — Stripe captures it in its own hosted modal; we only read the
 * pass/fail + verified name and gate on it. All state is server-authoritative.
 * ======================================================================== */
(function () {
  "use strict";
  var ROOT = document.getElementById("sml-idv-root");
  if (!ROOT || ROOT.getAttribute("data-booted")) { return; }
  ROOT.setAttribute("data-booted", "1");

  var SC = document.getElementById("sml-idv-js");
  var NONCE = window.SML_IDV_NONCE || (SC && SC.getAttribute("data-nonce")) || "";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function api(path, opts) {
    opts = opts || {}; opts.credentials = "same-origin";
    opts.headers = Object.assign({ "X-WP-Nonce": NONCE }, opts.headers || {});
    return fetch("/wp-json" + path, opts).then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw j; } return j; }); });
  }
  function post(path) { return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); }

  var CARD = "background:linear-gradient(168deg,#1A2431,#121A26 45%,#0C121C);border:1px solid rgba(255,255,255,.08);border-top-color:rgba(255,255,255,.18);border-radius:16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.13),0 14px 28px -12px rgba(0,0,0,.6);";
  var GBTN = "border:1px solid rgba(20,170,90,.9);background:linear-gradient(180deg,#6BFFB0,#38F58A 46%,#17BC64);color:#03120A;font-weight:700;cursor:pointer;";
  var MUTE = "color:#93A4B8;";

  var stripeJsPromise = null;
  function loadStripeJs() {
    if (window.Stripe) { return Promise.resolve(window.Stripe); }
    if (stripeJsPromise) { return stripeJsPromise; }
    stripeJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://js.stripe.com/v3/";
      s.onload = function () { window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe.js failed to load")); };
      s.onerror = function () { reject(new Error("Stripe.js failed to load")); };
      document.head.appendChild(s);
    });
    return stripeJsPromise;
  }

  function shell(inner) {
    ROOT.innerHTML =
      '<div style="max-width:640px;margin:0 auto;padding:30px 20px 70px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#E6EDF5">'
      + '<div style="font-family:\'Space Grotesk\',sans-serif;font-weight:800;font-size:clamp(24px,4vw,34px);letter-spacing:-.02em;margin-bottom:6px">Verify your identity</div>'
      + '<div style="' + MUTE + 'font-size:14px;margin-bottom:22px">A one-time check so other traders know you’re a real, verified person. Your ID is captured securely by Stripe — Stock Market Loop never sees or stores it.</div>'
      + inner + "</div>";
  }

  function render(st, msg, busy) {
    if (!st || !st.configured) {
      shell('<div style="' + CARD + 'padding:22px">' + '<div style="font-weight:700;font-size:15px;margin-bottom:6px">Not available yet</div><div style="' + MUTE + 'font-size:13px">Identity verification isn’t switched on yet. Check back soon.</div></div>');
      return;
    }
    if (st.verified) {
      shell('<div style="' + CARD + 'padding:22px;display:flex;align-items:center;gap:14px">'
        + '<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(180deg,#38F58A,#17BC64);color:#03120A;font-size:24px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none">✓</div>'
        + '<div><div style="font-weight:700;font-size:16px">You’re verified</div><div style="' + MUTE + 'font-size:13px">Your identity is confirmed. You can appear in trader networking.</div></div></div>');
      return;
    }
    var note = "";
    if (st.name_mismatch) { note = '<div style="margin-bottom:14px;padding:11px 14px;border-radius:12px;background:rgba(255,120,120,.08);border:1px solid rgba(255,120,120,.3);color:#FFC2C2;font-size:12.5px">The name on your ID didn’t match your account name. Make sure your profile name matches your legal name, then try again.</div>'; }
    if (msg) { note = '<div style="margin-bottom:14px;padding:11px 14px;border-radius:12px;background:rgba(93,185,255,.08);border:1px solid rgba(93,185,255,.3);color:#CFE6FF;font-size:12.5px">' + esc(msg) + "</div>"; }
    shell('<div style="' + CARD + 'padding:22px">' + note
      + '<div style="font-weight:700;font-size:15px;margin-bottom:6px">What you’ll need</div>'
      + '<ul style="' + MUTE + 'font-size:13px;line-height:1.7;margin:0 0 18px;padding-left:18px"><li>A government photo ID (driver’s license or passport)</li><li>Your device camera for a quick selfie</li><li>Your ID name must match your account name</li></ul>'
      + '<button type="button" data-idv="start" ' + (busy ? "disabled" : "") + ' style="' + GBTN + 'padding:12px 24px;border-radius:999px;font-size:14px;' + (busy ? "opacity:.7" : "") + '">' + (busy ? "Opening secure check…" : "Start verification") + "</button>"
      + '<div style="' + MUTE + 'font-size:11px;margin-top:12px">Powered by Stripe Identity. ' + (st.mode === "test" ? "Test mode — use Stripe’s test documents." : "") + "</div></div>");
  }

  function refresh() { return api("/sml-idv/v1/status").then(function (st) { STATE = st; render(st); return st; }).catch(function () { render({ configured: false }); }); }

  var STATE = null, running = false;

  function start() {
    if (running) { return; }
    running = true; render(STATE, "", true);
    var pk = STATE && STATE.publishable_key;
    if (!pk) { running = false; render(STATE, "Verification isn’t fully configured yet (missing key)."); return; }
    Promise.all([loadStripeJs(), post("/sml-idv/v1/session")]).then(function (arr) {
      var StripeCtor = arr[0], sess = arr[1];
      if (sess && sess.already) { running = false; return refresh(); }
      if (!sess || !sess.client_secret) { throw new Error("Could not start verification."); }
      var stripe = StripeCtor(pk);
      return stripe.verifyIdentity(sess.client_secret).then(function (result) {
        // Whether they finished or closed, ask the server for the authoritative result.
        running = false;
        if (result && result.error) { return post("/sml-idv/v1/finalize").then(function (st) { STATE = st; render(st, "Verification wasn’t completed. You can try again."); }); }
        return post("/sml-idv/v1/finalize").then(function (st) {
          STATE = st;
          if (st.verified) { render(st); }
          else if (st.name_mismatch) { render(st); }
          else { render(st, "We’re still confirming your ID — this can take a moment. Check back shortly."); }
        });
      });
    }).catch(function (e) {
      running = false;
      render(STATE, (e && (e.message || e.error)) ? (e.message || e.error) : "Something went wrong starting verification. Please try again.");
    });
  }

  ROOT.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-idv]") : null;
    if (b && b.getAttribute("data-idv") === "start") { e.preventDefault(); start(); }
  });

  shell('<div style="' + CARD + 'padding:22px;' + MUTE + '">Loading…</div>');
  refresh();
})();
