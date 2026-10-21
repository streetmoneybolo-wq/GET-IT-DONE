# StockMarketLoop apps

All three apps are thin shells around the web app at https://sml-platform-api.onrender.com/app/ (source: services/sml-platform/platform/app-shell),
so a fix to the web app reaches every device without a new download.

| Where | What | How to get it |
|---|---|---|
| iPhone / iPad | Add to Home Screen (web app) | https://sml-platform-api.onrender.com/app/get shows the steps |
| Android | Install from the browser, or the APK | the same page; the APK comes from `apps/mobile` |
| Windows / Mac / Linux | Install from Chrome/Edge, or the installers | the same page; installers come from `apps/desktop` |

## Building the downloads
Actions > "Build the StockMarketLoop apps" > Run workflow. It publishes to the rolling release `app-latest`:
`StockMarketLoop.apk`, `StockMarketLoop-win.exe`, `StockMarketLoop-mac.dmg`, `StockMarketLoop-linux.AppImage`.
Then set these on the platform API service in Render so the download page shows the buttons (the file names above can differ, check the release):

```
SML_APP_ANDROID_URL=https://github.com/streetmoneybolo-wq/GET-IT-DONE/releases/download/app-latest/StockMarketLoop.apk
SML_APP_WINDOWS_URL=https://github.com/streetmoneybolo-wq/GET-IT-DONE/releases/download/app-latest/StockMarketLoop-win.exe
SML_APP_MAC_URL=https://github.com/streetmoneybolo-wq/GET-IT-DONE/releases/download/app-latest/StockMarketLoop-mac.dmg
SML_APP_LINUX_URL=https://github.com/streetmoneybolo-wq/GET-IT-DONE/releases/download/app-latest/StockMarketLoop-linux.AppImage
```

## What these builds are, and are not
- The Android APK is a debug-signed build for direct installs (the user allows "install unknown apps"). Google Play needs a release keystore and a Play Console account (one-time fee); add the keystore as a repository secret and switch the workflow to `bundleRelease`.
- The desktop installers are unsigned: Windows SmartScreen and macOS Gatekeeper warn on first run. Signing needs a code-signing certificate (Windows) and an Apple Developer ID (Mac).
- The App Store needs an Apple Developer account ($99/year) and a Mac with Xcode: `cd apps/mobile && npm i && npx cap add ios && npx cap open ios`. Apple rejects apps that are only a website in a frame (guideline 4.2), so a native feature (push notifications, biometric sign-in, widgets) is needed before submitting. Until then iPhone users use Add to Home Screen, which supports web push on iOS 16.4+.
- None of these builds have been run by the person who wrote the workflow. Run it once and install each file before sharing the links.
