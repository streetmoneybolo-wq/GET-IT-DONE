# Immersive live editing — deployed 2026-09-11

Live asset revision: `309c349533e3322bace1ab6c43780af15f81686a`.

## Ownership and deployment

- `js/immersive-profile.js`: existing renderer; now exposes owner-only **Edit live** and **Full settings** buttons and cancels pending immersive autosave when live preview begins.
- `js/profile-live-studio.js`: based on the production profile-engine `assets/unified-profile.js`, not a second editor. Retains its authenticated Save, upload and Cancel workflows. Replaces that bridge's script URL; do not load both versions.
- WPCode 6873 points only the immersive renderer at this revision; other CDN assets were not changed.
- Production `sml-profile-engine/includes/class-sml-profile-unified.php` now points `sml-profile-unified-public` to this revision's `profile-live-studio.js`. A future plugin upgrade must preserve or intentionally supersede this URL change.
- Private server backups: `/home/150846796/newsroom-safety-p1kCpiyp/live-studio-loader-before.php` and `live-studio-class-before.php`. No profile database settings were changed during deployment or testing.

## Behavior

- Desktop: 380px editor beside a resized, interactive real profile; no dimming backdrop.
- At <=900px: controls use the bottom 48dvh; profile remains visible and scrollable above them.
- Slider and immersive option previews coalesce via requestAnimationFrame; no HTTP writes per slider event and no full renderer recreation per input.
- Effects/textures/shapes are drawn from the renderer's actual available controls, including its newer library.
- Cancel restores original immersive choices. Save retains the existing persistence/upload flow, then refreshes the saved profile. Arrange first cancels unsaved live-preview changes before entering the existing autosaving layout mode.

## Verification

- Both JavaScript files pass `node --check`; modified production PHP passes `php -l`.
- Signed-in browser loaded both expected versioned CDN assets.
- Actual clicks opened Edit live; desktop editor/profile rectangles abut without overlap.
- Texture Holo -> Glass updated immediately without Save; photo-size keyboard input 200 -> 210 updated the profile control immediately. Cancel restored Holo and 200.
- At 390x844 the profile ended at y438.89 and the editor began at y438.89; screenshot confirmed both visible, with Save/Cancel accessible.
- Cancel closed the editor and removed split layout. Viewport reset to original 2294x769.
- No production save/upload was submitted for testing; persistence is retained from the existing implementation, not newly end-to-end verified. Network upload time is not a frame-rate preview guarantee. Existing two-endpoint Save is not an atomic database transaction.
