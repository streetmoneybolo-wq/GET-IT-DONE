# WPCode Snippet #6262 — backup record (2026-08-26)

- **Title:** `TEMP LoopLetter Studio Installer — DONE, safe to delete`
- **Type:** PHP · **State at record time:** Active · Auto-insert Run Everywhere
- **Size:** 15,378 chars, 15 lines
- **SHA-256(first16) of normalized (LF) source:** `f6a608e8b1b81540`

## Structure / purpose
- Line 1: `/* One-time installer: writes the LoopLetter studio homepage into the uploads dir. */`
- Line 2: `$ll_b64 = '<14,837-char gzip+base64 of an index.html>';`
- Lines 3–15: `base64_decode` → `gzdecode` → write the decoded HTML into `wp-content/uploads/…` (LoopLetter studio homepage), guarded so it only writes once.

**It is a one-time installer that has already run.** The HTML it produced already exists on disk in the uploads directory, so the snippet performs no ongoing work. Its title, set by whoever created it, marks it DONE and safe to delete.

## Why deactivating it helps performance
It contains `base64_decode` (+ gzip blob) which counts toward the WPCode "merged Run-Everywhere eval" flagged-token budget (memory: [[wpcode-merged-eval-trap]] — the site sits at 5/5). Deactivating frees one slot without affecting any live feature.

## Recoverability (backup guarantee)
- **Deactivation ≠ deletion.** WPCode retains the full snippet body; re-toggling *Active* restores it byte-for-byte in place. **Do not delete it** (per instruction).
- A byte-perfect off-site copy could not be exported through this session's tooling (the security classifier blocks emitting the embedded base64/paths). If an off-site copy is wanted, use WPCode's own **Export** on the snippet's row, or copy from the editor manually.
- Identity is verifiable any time via the SHA above.

## Rollback
- To restore: WPCode → snippet #6262 → toggle **Active** on. No other change needed.
