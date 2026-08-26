# WPCode #7387 — "SML Optimized Homepage Recovery" (verified backup record)

- **Status:** ACTIVE (emergency owner of the signed-in optimized homepage since the
  `sml-optimized-home-direct` plugin vanished from the plugin list, 2026-08).
- **Saved body:** 16,797 chars (LF-normalized), SHA-256 first16 = `5b46e5d8bcfb798d`.
- **Byte-exact backup:** [`wpcode/optimized-home-recovery-7387.php`](../optimized-home-recovery-7387.php)
  — reconstructed 2026-08-26 from the validated plugin source
  (`sml-optimized-home.php`, sha `b2ad5a6338f10dd3`, v1.1.0) by stripping `<?php`
  and wrapping the body in `if (!function_exists('sml_oh_is_home')) { … }`;
  reconstruction hash **matches the live saved body exactly** → the persisted
  snippet is precisely the intended wrapper, no corruption, no drift.
- **Lint:** `php -l` clean; `node scripts/check-wpcode.js` passes with this file
  included (0 flagged tokens — does not consume merged-eval budget).
- **Guard semantics:** the `function_exists` wrapper means that the moment a real
  plugin defining `sml_oh_is_home` is active (plugins load before WPCode runs
  snippets), this snippet becomes a no-op automatically. It is therefore safe to
  leave active as a hot-fallback while the recognized plugin owns the homepage,
  and deactivating it later is cosmetic.
- **Rollback:** if the recognized plugin ever fails again, re-activating (or
  simply keeping) #7387 restores the homepage on the next request. Its body can
  be re-pasted from the backup file above via the standard WPCode deploy recipe.
- **historical `message=2&error` notice:** transient admin-notice state from the
  original save; fresh editor loads show no error and the persisted body is
  correct (verified 2026-08-26).
