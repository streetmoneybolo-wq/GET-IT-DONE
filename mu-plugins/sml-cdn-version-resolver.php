<?php
/**
 * Plugin Name: SML CDN Version Resolver
 * Description: Pins the shared frontend asset revision WITHOUT replacing the real resolver.
 * Version: 1.0.2
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
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'SML_CDN_ASSET_REVISION' ) ) {
	define( 'SML_CDN_ASSET_REVISION', '433c01a1de3dcc864cf99b95276047200f1ad73c' );
}

add_filter( 'pre_transient_sml_cdn_ref', function () {
	return SML_CDN_ASSET_REVISION;
} );
