(function () {
  "use strict";

  var gifts = new Set();
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var observer = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      entry.target.classList.toggle("is-paused", !entry.isIntersecting || document.hidden);
    });
  }, { rootMargin: "120px" }) : null;

  function register(root) {
    (root || document).querySelectorAll(".sml-premium-gift").forEach(function (gift) {
      if (gifts.has(gift)) return;
      gifts.add(gift);
      if (observer) observer.observe(gift);
    });
  }

  function syncVisibility() {
    gifts.forEach(function (gift) {
      gift.classList.toggle("is-paused", document.hidden || reduced.matches);
    });
  }

  function playReceived(target) {
    var gift = typeof target === "string" ? document.querySelector(target) : target;
    if (!gift || reduced.matches) return;
    gift.classList.remove("is-received");
    void gift.offsetWidth;
    gift.classList.add("is-received");
    window.setTimeout(function () { gift.classList.remove("is-received"); }, 1300);
  }

  register(document);
  document.addEventListener("visibilitychange", syncVisibility);
  new MutationObserver(function (records) {
    records.forEach(function (record) {
      record.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) register(node.matches(".sml-premium-gift") ? node.parentNode : node);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.SMLPremiumGiftMotion = { register: register, playReceived: playReceived };
}());
