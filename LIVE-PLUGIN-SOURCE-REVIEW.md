# Live plugin source review

This branch is review-only and must not be merged or deployed as-is.

Included source:

- `plugins/sml-live-studio-real-data/` — real subscriber/chat data plus scheduled-stream poster data.
- `plugins/sml-live-chat-overlay-fix-1.0.2/` — scoped Go Live chat overlay and host controls.
- `plugins/sml-video-upload-studio-v381/` — the locally available production-version `3.8.11` plugin source. The Go Live interface, monetization, Voice Queue, and scheduled-stream implementation live here, especially in:
  - `golive-script.php`
  - `golive-monetization.php`
  - `voice-ui.php`
  - `voice-api.php`
  - `watch-page.php`
  - `sml-video-upload-studio.php`
- `js/live-watch.js` and `css/live-watch.css` — Watch Page Voice Queue, scheduled poster, and live-room presentation.

The branch exists so Claude can inspect the exact local implementation and propose a precise patch. No production settings were changed and this branch was not merged.
