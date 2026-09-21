<?php
/**
 * Plugin Name: SML CDN Version Resolver
 * Description: Pins the shared frontend asset revision WITHOUT replacing the real resolver.
 * Version: 1.0.3
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
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'SML_CDN_ASSET_REVISION' ) ) {
	define( 'SML_CDN_ASSET_REVISION', '7016d203c2952b3cc48ea62ec7c22e042d52f1da' );
}

add_filter( 'pre_transient_sml_cdn_ref', function () {
	return SML_CDN_ASSET_REVISION;
} );
