/* ===========================================================================
 * SML Meet Traders  —  js/meet-traders.js   (mounts on /meet/)
 *
 * Transparent, opt-in trader networking directory. Nobody is listed until they
 * turn on "Open to connecting" (and confirm 18+). Renders an opt-in card + a
 * browsable directory of opted-in members (affinity-ordered server-side), with an
 * optional city filter, Follow, View profile, and Block. All privacy/age/block
 * rules are enforced server-side (sml-meet/v1); this is the UI.
 * ======================================================================== */
(function () {
  "use strict";
  var ROOT = document.getElementById("sml-meet-root");
  if (!ROOT || ROOT.getAttribute("data-booted")) { return; }
  ROOT.setAttribute("data-booted", "1");

  var SC = document.getElementById("sml-meet-js");
  var NONCE = window.SML_MEET_NONCE || (SC && SC.getAttribute("data-nonce")) || "";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function api(path, opts) {
    opts = opts || {}; opts.credentials = "same-origin";
    opts.headers = Object.assign({ "X-WP-Nonce": NONCE }, opts.headers || {});
    return fetch("/wp-json" + path, opts).then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw j; } return j; }); });
  }
  function postJSON(path, body) { return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

  var CARD = "background:linear-gradient(168deg,#1A2431,#121A26 45%,#0C121C);border:1px solid rgba(255,255,255,.07);border-top-color:rgba(255,255,255,.18);border-radius:16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.13),0 14px 28px -12px rgba(0,0,0,.6);";
  var GBTN = "border:1px solid rgba(20,170,90,.9);background:linear-gradient(180deg,#6BFFB0,#38F58A 46%,#17BC64);color:#03120A;font-weight:700;cursor:pointer;";
  var GHOST = "border:1px solid rgba(255,255,255,.14);background:linear-gradient(180deg,#1D2836,#111926);color:#E6EDF5;cursor:pointer;text-decoration:none;";
  var INP = "background:linear-gradient(180deg,#070C14,#111926);border:1px solid rgba(0,0,0,.6);border-bottom-color:rgba(255,255,255,.08);border-radius:10px;padding:10px 13px;color:#E6EDF5;font-size:13.5px;outline:none;width:100%;box-sizing:border-box;";
  var MUTE = "color:#93A4B8;";

  var prefs = { optin: false, adult: false, bio: "", city: "" };
  var items = [], offset = 0, hasMore = false, cityFilter = "", loading = false, booted = false;

  function initials(n) { n = String(n || "").trim(); if (!n) { return "?"; } return n.split(/\s+/).map(function (w) { return w[0] || ""; }).slice(0, 2).join("").toUpperCase(); }

  function avatar(it, size) {
    if (it.avatar) { return '<img src="' + esc(it.avatar) + '" width="' + size + '" height="' + size + '" alt="' + esc(it.name) + '" referrerpolicy="no-referrer" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;flex:none;box-shadow:0 0 0 2px #0B131F,0 0 0 3px rgba(34,224,122,.5)">'; }
    return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:linear-gradient(160deg,#24323F,#0E1620);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:' + Math.round(size * 0.36) + 'px;color:#38F58A;flex:none;box-shadow:0 0 0 2px #0B131F,0 0 0 3px rgba(34,224,122,.5)">' + esc(initials(it.name)) + "</div>";
  }

  function optinCard() {
    if (prefs.optin) {
      return '<div style="' + CARD + 'padding:18px 20px;margin-bottom:22px">'
        + '<div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14.5px;color:#38F58A;margin-bottom:4px"><span style="width:8px;height:8px;border-radius:50%;background:#38F58A"></span>You’re open to connecting</div>'
        + '<div style="' + MUTE + 'font-size:12.5px;margin-bottom:14px">Other traders can find you here. Edit how you show up, or leave anytime.</div>'
        + '<div style="display:grid;gap:10px;max-width:520px">'
        + '<input id="sml-meet-bio" maxlength="160" placeholder="One line — what you trade (e.g. options + small caps, swing)" value="' + esc(prefs.bio) + '" style="' + INP + '">'
        + '<input id="sml-meet-city" maxlength="60" placeholder="City (optional — shown to enable ‘in my city’)" value="' + esc(prefs.city) + '" style="' + INP + '">'
        + '<div style="display:flex;gap:10px"><button type="button" data-act="save-edit" style="' + GBTN + 'padding:9px 18px;border-radius:999px;font-size:12.5px">Save</button>'
        + '<button type="button" data-act="leave" style="' + GHOST + 'padding:9px 18px;border-radius:999px;font-size:12.5px">Leave directory</button>'
        + '<span id="sml-meet-msg" style="' + MUTE + 'font-size:12px;align-self:center"></span></div>'
        + "</div></div>";
    }
    return '<div style="' + CARD + 'padding:18px 20px;margin-bottom:22px">'
      + '<div style="font-weight:700;font-size:15px;margin-bottom:4px">Open to meeting other traders?</div>'
      + '<div style="' + MUTE + 'font-size:12.5px;margin-bottom:14px">Turn this on to be listed here and discover others. You choose what to share. Off by default; leave anytime.</div>'
      + '<div style="display:grid;gap:10px;max-width:520px">'
      + '<input id="sml-meet-bio" maxlength="160" placeholder="One line — what you trade (e.g. options + small caps, swing)" style="' + INP + '">'
      + '<input id="sml-meet-city" maxlength="60" placeholder="City (optional)" style="' + INP + '">'
      + '<label style="display:flex;align-items:flex-start;gap:9px;' + MUTE + 'font-size:12.5px;cursor:pointer"><input type="checkbox" id="sml-meet-adult" style="margin-top:2px;accent-color:#38F58A"> I confirm I’m 18 or older and want to be listed for trader networking.</label>'
      + '<div style="display:flex;gap:10px;align-items:center"><button type="button" data-act="save-optin" style="' + GBTN + 'padding:10px 20px;border-radius:999px;font-size:13px">Open to connecting</button>'
      + '<span id="sml-meet-msg" style="' + MUTE + 'font-size:12px"></span></div>'
      + "</div></div>";
  }

  function personCard(it) {
    var badges = "";
    if (it.mutual_groups > 0) { badges += '<span style="font-size:10.5px;color:#38F58A;border:1px solid rgba(56,245,138,.3);border-radius:999px;padding:2px 8px">In ' + it.mutual_groups + " group" + (it.mutual_groups > 1 ? "s" : "") + " together</span>"; }
    if (it.follows_you) { badges += '<span style="font-size:10.5px;' + MUTE + 'border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:2px 8px">Follows you</span>'; }
    var followBtn = it.following
      ? '<button type="button" disabled style="' + GHOST + 'padding:7px 14px;border-radius:999px;font-size:12px;opacity:.7;cursor:default">Following</button>'
      : '<button type="button" data-act="follow" data-uid="' + it.user_id + '" style="' + GBTN + 'padding:7px 16px;border-radius:999px;font-size:12px">Follow</button>';
    return '<div data-card="' + it.user_id + '" style="' + CARD + 'padding:16px;display:flex;flex-direction:column;gap:11px">'
      + '<div style="display:flex;align-items:center;gap:12px">'
      + '<a href="' + esc(it.profile_url) + '" style="flex:none;text-decoration:none">' + avatar(it, 52) + "</a>"
      + '<div style="min-width:0;flex:1">'
      + '<a href="' + esc(it.profile_url) + '" style="display:block;font-weight:700;font-size:14px;color:#E6EDF5;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.name) + "</a>"
      + (it.city ? '<div style="' + MUTE + 'font-size:11.5px">📍 ' + esc(it.city) + "</div>" : "")
      + "</div>"
      + '<button type="button" data-act="block" data-uid="' + it.user_id + '" title="Block" style="flex:none;width:26px;height:26px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:transparent;color:#6B7C90;font-size:13px;cursor:pointer">⊘</button>'
      + "</div>"
      + (it.bio ? '<div style="font-size:12.5px;color:#C6D2DE;line-height:1.5;overflow-wrap:anywhere">' + esc(it.bio) + "</div>" : "")
      + (badges ? '<div style="display:flex;flex-wrap:wrap;gap:6px">' + badges + "</div>" : "")
      + '<div style="display:flex;gap:8px;margin-top:2px">' + followBtn + '<a href="' + esc(it.profile_url) + '" style="' + GHOST + 'padding:7px 16px;border-radius:999px;font-size:12px">View profile</a></div>'
      + "</div>";
  }

  function render() {
    var grid = "";
    if (loading && !items.length) {
      grid = '<div style="' + MUTE + 'padding:30px 4px">Loading traders…</div>';
    } else if (!items.length) {
      grid = '<div style="' + CARD + 'padding:26px;text-align:center;' + MUTE + '">' + (cityFilter ? "No opted-in traders in “" + esc(cityFilter) + "” yet." : "No one’s open to connecting yet — be the first, or check back soon.") + "</div>";
    } else {
      grid = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">' + items.map(personCard).join("") + "</div>"
        + (hasMore ? '<div style="text-align:center;margin-top:18px"><button type="button" data-act="more" style="' + GHOST + 'padding:10px 26px;border-radius:999px;font-size:13px">' + (loading ? "Loading…" : "Load more") + "</button></div>" : "");
    }
    ROOT.innerHTML =
      '<div style="max-width:1000px;margin:0 auto;padding:26px 20px 60px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#E6EDF5">'
      + '<div style="margin-bottom:6px;font-family:\'Space Grotesk\',sans-serif;font-weight:800;font-size:clamp(26px,4vw,38px);letter-spacing:-.02em">Meet Traders</div>'
      + '<div style="' + MUTE + 'font-size:14px;margin-bottom:22px">Connect with other traders who share your markets and communities. Opt-in only — you control what you share.</div>'
      + optinCard()
      + '<div style="display:flex;align-items:center;gap:10px;margin:8px 0 16px">'
      + '<input id="sml-meet-cityf" placeholder="Filter by city…" value="' + esc(cityFilter) + '" style="' + INP + 'max-width:240px">'
      + '<button type="button" data-act="filter" style="' + GHOST + 'padding:10px 18px;border-radius:10px;font-size:13px">Filter</button>'
      + (cityFilter ? '<button type="button" data-act="clearfilter" style="background:none;border:none;' + MUTE + 'font-size:12px;cursor:pointer">clear</button>' : "")
      + "</div>"
      + grid
      + "</div>";
  }

  function msg(t, ok) { var el = document.getElementById("sml-meet-msg"); if (el) { el.textContent = t || ""; el.style.color = ok ? "#38F58A" : "#93A4B8"; } }

  function loadPrefs() { return api("/sml-meet/v1/prefs").then(function (p) { if (p) { prefs = p; } }).catch(function () {}); }
  function loadDir(reset) {
    if (loading) { return; }
    loading = true; if (reset) { offset = 0; items = []; } render();
    return api("/sml-meet/v1/directory?limit=18&offset=" + offset + (cityFilter ? "&city=" + encodeURIComponent(cityFilter) : ""))
      .then(function (d) { items = items.concat((d && d.items) || []); hasMore = !!(d && d.has_more); offset += ((d && d.items) || []).length; loading = false; render(); })
      .catch(function () { loading = false; render(); });
  }

  ROOT.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-act]") : null; if (!b) { return; }
    var act = b.getAttribute("data-act");
    if (act === "save-optin") {
      var adult = (document.getElementById("sml-meet-adult") || {}).checked;
      if (!adult) { msg("Please confirm you’re 18 or older."); return; }
      b.disabled = true; msg("Saving…", true);
      postJSON("/sml-meet/v1/prefs", { optin: true, adult: true, bio: (document.getElementById("sml-meet-bio") || {}).value || "", city: (document.getElementById("sml-meet-city") || {}).value || "" })
        .then(function (p) { prefs = p; render(); loadDir(true); }).catch(function () { b.disabled = false; msg("Couldn’t save — try again."); });
    } else if (act === "save-edit") {
      b.disabled = true; msg("Saving…", true);
      postJSON("/sml-meet/v1/prefs", { optin: true, adult: true, bio: (document.getElementById("sml-meet-bio") || {}).value || "", city: (document.getElementById("sml-meet-city") || {}).value || "" })
        .then(function (p) { prefs = p; msg("Saved.", true); b.disabled = false; }).catch(function () { b.disabled = false; msg("Couldn’t save."); });
    } else if (act === "leave") {
      b.disabled = true;
      postJSON("/sml-meet/v1/prefs", { optin: false, bio: prefs.bio, city: prefs.city }).then(function (p) { prefs = p; render(); }).catch(function () { b.disabled = false; });
    } else if (act === "follow") {
      var uid = parseInt(b.getAttribute("data-uid"), 10) || 0; if (!uid) { return; }
      b.textContent = "…";
      postJSON("/sml-members/v1/follow", { user_id: uid, action: "follow" })
        .then(function () { var it = items.filter(function (x) { return x.user_id === uid; })[0]; if (it) { it.following = true; } render(); })
        .catch(function () { b.textContent = "Follow"; });
    } else if (act === "block") {
      var buid = parseInt(b.getAttribute("data-uid"), 10) || 0; if (!buid) { return; }
      if (!window.confirm("Block this member? They won’t see you here and you won’t see them.")) { return; }
      postJSON("/sml-meet/v1/block", { user_id: buid, action: "block" }).catch(function () {});
      items = items.filter(function (x) { return x.user_id !== buid; }); render();
    } else if (act === "more") {
      loadDir(false);
    } else if (act === "filter") {
      cityFilter = String((document.getElementById("sml-meet-cityf") || {}).value || "").trim(); loadDir(true);
    } else if (act === "clearfilter") {
      cityFilter = ""; loadDir(true);
    }
  });
  ROOT.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target && e.target.id === "sml-meet-cityf") { e.preventDefault(); cityFilter = String(e.target.value || "").trim(); loadDir(true); }
  });

  render();
  loadPrefs().then(function () { render(); return loadDir(true); });
})();
