(function () {
  "use strict";

  var badges = new Set();
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var observer = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      entry.target.classList.toggle("is-paused", document.hidden || !entry.isIntersecting);
    });
  }, { rootMargin: "100px" }) : null;

  function ensureShine(badge) {
    if (badge.querySelector(".sml-verify-shine")) return;
    var shine = document.createElement("span");
    shine.className = "sml-verify-shine";
    shine.setAttribute("aria-hidden", "true");
    badge.appendChild(shine);
  }

  function register(root) {
    var scope = root || document;
    scope.querySelectorAll(".sml-verify-badge").forEach(function (badge) {
      if (badges.has(badge)) return;
      badges.add(badge);
      ensureShine(badge);
      if (observer) observer.observe(badge);
    });
  }

  function award(target) {
    var badge = typeof target === "string" ? document.querySelector(target) : target;
    if (!badge || reduced.matches) return;
    badge.classList.remove("is-newly-verified");
    void badge.offsetWidth;
    badge.classList.add("is-newly-verified");
    window.setTimeout(function () { badge.classList.remove("is-newly-verified"); }, 1550);
  }

  function sync() {
    badges.forEach(function (badge) { badge.classList.toggle("is-paused", document.hidden || reduced.matches); });
  }

  register(document);
  document.addEventListener("visibilitychange", sync);
  new MutationObserver(function (records) {
    records.forEach(function (record) {
      record.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        register(node.matches(".sml-verify-badge") ? node.parentNode : node);
      });
    });
  }).observe(document.documentElement, { childList:true, subtree:true });

  window.SMLVerificationBadgeMotion = { register:register, award:award };
}());
