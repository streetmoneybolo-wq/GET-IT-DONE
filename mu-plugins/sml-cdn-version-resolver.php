<?php
/**
 * Plugin Name: SML CDN Version Resolver
 * Description: Pins the shared frontend asset revision WITHOUT replacing the real resolver.
 * Version: 1.0.9
 *
 * 1.0.0 defined sml_cdn_resolve_ref() here. mu-plugins load before WPCode, and
 * WPCode #6873 "SML CDN Loader" declares that same function inside its loader
 * block — so #6873 hit "Cannot redeclare" and its whole block died, taking the
 * immersive-profile.js injection (and every other asset it loads) with it. Public
 * profiles lost the immersive overlay on 2026-09-19.
 *
 * DO NOT define sml_cdn_resolve_ref() in an mu-plugin. To pin a revision, answer
 * the resolver's own cache lookup instead: #6873 reads get_transient('sml_cdn_ref')
 * first, so short-circuiting that transient pins every loader and leaves #6873 intact.
 * To unpin, delete this file (the resolver goes back to "latest commit of main").
 *
 * 1.0.2 (2026-09-19): advance pin e276b60b -> ce7b627. live-watch.js DESK FOCUS
 * carousel now shows only the creator's chosen ticker(s) (from /sml-live/v1/feeds),
 * never a generic SPY/QQQ/NVDA/VIX/TSLA list. Only js/live-watch.js differs between
 * the two commits; the other files in that range are server-deployed PHP, not CDN.
 * 1.0.3 (2026-09-19): advance pin 433c01a -> f9731e7. CDN-served files that differ: js/live-watch.js (Loop-Kick mini button
 * hands a scheduled stream's thumbnail + start time to the phone's countdown), js/loop-channel.js (subscriber wording,
 * #ch-subscribers) and js/home-feed.js (alt text on feed card images). Everything else in the range is server-deployed PHP.
 * 1.0.4 (2026-09-21): advance pin f9731e7 -> 26c74cc. Rich alert box card (terminal-alerts.js), Q&A accordion
 * (terminal-qa.js + terminal-short.js chain-load), group kebab menu position:fixed fix (group-categories.js).
 * 1.0.5 (2026-09-21): advance pin 3a05561 -> 7016d20. Group onboarding v2 (Premium channels, owner-opened channels,
 * edits in the group ⋮ menu) + storefront editor escaping: js/group-onboarding.js, js/group-storefront.js only.
 * 1.0.6 (2026-09-22): advance pin 7016d20 -> 552d2f1. Group Chirp on the group page (js/group-categories.js only): chirps in
 * role-restricted channels arrive as audio-less 'held' stubs (sml-group-kick 1.5.1) and are fetched per member from /chirps,
 * one /chirps request at a time, each chirp plays once, switching Chirp on never replays old chirps, a group's first chirps play.
 * 1.0.7 (2026-09-22): advance pin 552d2f1 -> 52b75c7. Memberships are real money (owner rule): js/group-onboarding.js Unlock opens the
 * owner's checkout link (asks first), shows the price in dollars, links owners to Creator Studio › Groups › Payments for that group;
 * js/creator-analytics.js shows a paid group's price in dollars. Only those two files differ.
 * 1.0.8 (2026-09-22): advance pin 52b75c7 -> bfa6ca3. Header tape (js/site-search.js only): the breaking-news cursor
 * (/sml-signal-news/v1/tape?bootstrap=1) is fetched once per page view instead of on every hidden->visible flip — a flickering
 * tab was firing it ~1/s, each a 1.5 s WP boot. Polls ?after= every 15 s (30 s when quiet), one request in flight, no ?_= buster.
 * 1.0.9 (2026-09-22): advance pin bfa6ca3 -> 5223f7b. js/loop-channel.js only: hands #ch-orbit to window.SML_LCE.mount() — a no-op
 * unless plugin sml-channel-layout 1.1.0 enqueued its script (enabled channels only); the orbit stays unless a valid layout arrives.
 * 2026-09-23: advance pin -> 796efdd (js/live-watch.js: no empty-symbol quote/history/company polls).
 * 2026-09-23: advance pin -> c7d414a (watch pages: per-stream likes, chat lock, live-insights beacon, orbit max 5).
 * 2026-09-23: advance pin -> 744bf0e (js/creator-live-library.js: Manage link to per-stream studio).
 * 2026-09-24: advance pin -> 3c6e547 (js/live-watch.js + css: channel emotes picker/render).
 * 2026-09-24: advance pin -> fcc9f04 (js/creator-analytics.js: admin-only Moderation tab).
 * 2026-09-25: advance pin -> 14a122d (js/vod-watch.js + css: remove watch-page voice cues).
 * 2026-09-25: advance pin -> d4444fd (js/live-watch.js: Boost Arena guardrail client).
 * 2026-09-25: advance pin -> 85480be (Ticker Terminal and Loop Channel use the shared Massive SSE relay).
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'SML_CDN_ASSET_REVISION' ) ) {
	define( 'SML_CDN_ASSET_REVISION', '85480be91a8728ac5295b0493f3a9f187421d966' );
}

add_filter( 'pre_transient_sml_cdn_ref', function () {
	return SML_CDN_ASSET_REVISION;
} );

/* Some long-lived WPCode loaders resolve their ref before the shared loader has
 * initialized. Enforce the same immutable revision at WordPress' final asset URL
 * filter so the Ticker Terminal can never ship a stale shell beside newer assets. */
function sml_cdn_pin_asset_url( $src, $handle ) {
	if ( ! is_string( $src ) || false === strpos( $src, 'streetmoneybolo-wq/GET-IT-DONE@' ) ) {
		return $src;
	}
	if ( ! in_array( $handle, array( 'sml-tv2', 'sml-tv2-shell' ), true ) ) {
		return $src;
	}
	return preg_replace(
		'#(streetmoneybolo-wq/GET-IT-DONE@)[0-9a-z._-]+/#i',
		'${1}' . SML_CDN_ASSET_REVISION . '/',
		$src,
		1
	);
}
add_filter( 'script_loader_src', 'sml_cdn_pin_asset_url', PHP_INT_MAX, 2 );
add_filter( 'style_loader_src', 'sml_cdn_pin_asset_url', PHP_INT_MAX, 2 );

/* WPCode keeps an independently compiled copy of loader snippets. If that copy
 * was compiled with an older ref, normalize only the two terminal asset URLs in
 * the completed document. Starting this buffer first makes it the outermost
 * guard, after every later snippet buffer has finished. */
add_action( 'template_redirect', function () {
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
		return;
	}
	ob_start( function ( $html ) {
		if ( ! is_string( $html ) || false === strpos( $html, 'GET-IT-DONE@' ) ) {
			return $html;
		}
		return preg_replace(
			'#(streetmoneybolo-wq/GET-IT-DONE@)[0-9a-z._-]+/(css/terminal-v2\.css|js/terminal-shell\.js)#i',
			'${1}' . SML_CDN_ASSET_REVISION . '/${2}',
			$html
		);
	} );
}, -PHP_INT_MAX );
