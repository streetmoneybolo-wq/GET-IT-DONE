# SML PWA

Makes stockmarketloop.com itself installable as an app: the app *is* the site.

- `/sml-manifest.webmanifest`: name, icons (from the site's own app icon), standalone display, shortcuts to Groups, News, Academy and Store.
- `/sml-sw.js`: service worker at the site root. Pages go to the network first with an offline page as the fallback; theme and plugin assets are cached stale-while-revalidate; admin, REST, AJAX, login and every non-GET request are never touched. Shows web push notifications when the site sends them.
- Head tags on every front-end page (manifest, theme colour, iPhone home-screen tags, apple-touch-icon) and a footer script that registers the worker, shows the install bar when the browser offers it (Android, Chrome/Edge desktop) and the "Add to Home Screen" hint in Safari on iPhone/iPad. Dismissing either hides it for a week.

Install: zip the folder, upload through Plugins → Add New → Upload, activate. Nothing to configure. Verify: `curl -I https://stockmarketloop.com/sml-sw.js` (text/javascript, `Service-Worker-Allowed: /`) and `curl https://stockmarketloop.com/sml-manifest.webmanifest`.
