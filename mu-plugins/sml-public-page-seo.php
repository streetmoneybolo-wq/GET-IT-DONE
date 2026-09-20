<?php
/**
 * Plugin Name: SML Public Page SEO (groups + Loop Letters)
 * Description: Two public surfaces were invisible or duplicated in search. Group pages (/groups/{slug}/) resolve through WordPress's 404 route, so Rank Math stamped them "noindex" and they had no canonical — no group page could ever be indexed. Loop Letters publication homes (/n/{handle}/) canonicalised to the generic /n/ hub with the generic title "Letters", so every publication told Google it was a duplicate. This gives both a self canonical, a real title and description, and honest robots (private/hidden groups and non-public publications stay out). 2026-09-19.
 * Version: 1.0.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_pps_clean( $text, $max = 0 ) {
	$t = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( html_entity_decode( (string) $text, ENT_QUOTES, 'UTF-8' ) ) ) );
	return $max && mb_strlen( $t ) > $max ? rtrim( mb_substr( $t, 0, $max - 1 ) ) . '…' : $t;
}

/** What public page is this, and how should search engines treat it? null = not ours. */
function sml_pps_context() {
	global $wpdb;
	static $ctx = false;
	if ( false !== $ctx ) { return $ctx; }
	$ctx = null;
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return $ctx; }
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );

	if ( preg_match( '#^groups/([^/]+)$#', $path, $m ) ) {
		$slug = rawurldecode( $m[1] );
		$g    = $wpdb->get_row( $wpdb->prepare( "SELECT id, name, slug, type, description FROM {$wpdb->prefix}sml_groups WHERE slug = %s", $slug ), ARRAY_A );
		if ( ! $g ) { return $ctx; }
		$banned = defined( 'SML_BANNED_GROUP_SLUGS' ) ? array_map( 'trim', explode( ',', (string) SML_BANNED_GROUP_SLUGS ) ) : array();
		$name   = sml_pps_clean( $g['name'] );
		$desc   = sml_pps_clean( $g['description'], 155 );
		$ctx    = array(
			'url'      => home_url( '/groups/' . rawurlencode( $g['slug'] ) . '/' ),
			'title'    => $name . ' | StockMarketLoop Group',
			'desc'     => '' !== $desc ? $desc : 'Join ' . $name . ' on StockMarketLoop: live chat, alerts and market discussion with the group.',
			/* private groups and groups hidden from the directory stay out of search */
			'index'    => 'private' !== (string) $g['type'] && ! in_array( $g['slug'], $banned, true ),
		);
		return $ctx;
	}

	if ( preg_match( '#^n/([^/]+)$#', $path, $m ) ) {
		$handle = rawurldecode( $m[1] );
		$uid    = (int) $wpdb->get_var( $wpdb->prepare( "SELECT user_id FROM {$wpdb->usermeta} WHERE meta_key = 'smll_handle' AND meta_value = %s LIMIT 1", $handle ) );
		if ( ! $uid ) { return $ctx; }
		$name    = sml_pps_clean( get_user_meta( $uid, 'smll_name', true ) );
		$tagline = sml_pps_clean( get_user_meta( $uid, 'smll_tagline', true ), 155 );
		$author  = get_userdata( $uid );
		if ( '' === $name ) { $name = $author ? $author->display_name : $handle; }
		$ctx = array(
			'url'   => home_url( '/n/' . rawurlencode( $handle ) . '/' ),
			'title' => $name . ' — Loop Letters | StockMarketLoop',
			'desc'  => '' !== $tagline ? $tagline : 'Market letters from ' . $name . ' on StockMarketLoop: issues, tickers and analysis, free to read.',
			'index' => 'public' === ( (string) get_user_meta( $uid, 'smll_visibility', true ) ?: 'public' ),
		);
	}
	return $ctx;
}

/* Rank Math owns the head on this site. */
add_filter( 'rank_math/frontend/canonical', function ( $canonical ) { $c = sml_pps_context(); return $c ? $c['url'] : $canonical; }, 20 );
add_filter( 'rank_math/opengraph/url', function ( $url ) { $c = sml_pps_context(); return $c ? $c['url'] : $url; }, 20 );
add_filter( 'rank_math/frontend/title', function ( $title ) { $c = sml_pps_context(); return $c ? $c['title'] : $title; }, 20 );
add_filter( 'rank_math/frontend/description', function ( $desc ) { $c = sml_pps_context(); return $c ? $c['desc'] : $desc; }, 20 );
add_filter( 'rank_math/opengraph/facebook/og_description', function ( $desc ) { $c = sml_pps_context(); return $c ? $c['desc'] : $desc; }, 20 );
add_filter( 'rank_math/opengraph/twitter/twitter_description', function ( $desc ) { $c = sml_pps_context(); return $c ? $c['desc'] : $desc; }, 20 );
/* A group page is served through the 404 route, which is where the noindex came from. */
add_filter( 'rank_math/frontend/robots', function ( $robots ) {
	$c = sml_pps_context();
	if ( ! $c ) { return $robots; }
	unset( $robots['noindex'] );
	$robots['index']  = $c['index'] ? 'index' : 'noindex';
	$robots['follow'] = 'follow';
	return $robots;
}, 30 );
add_filter( 'wp_robots', function ( $robots ) {
	$c = sml_pps_context();
	if ( ! $c ) { return $robots; }
	if ( $c['index'] ) { unset( $robots['noindex'] ); $robots['index'] = true; } else { unset( $robots['index'] ); $robots['noindex'] = true; }
	$robots['follow'] = true;
	return $robots;
}, 30 );
add_filter( 'pre_get_document_title', function ( $title ) { $c = sml_pps_context(); return $c ? $c['title'] : $title; }, 20 );

/* Last resort: some of these pages are custom renders that print their own head. Fix the final HTML. */
add_action( 'template_redirect', function () {
	$c = sml_pps_context();
	if ( ! $c ) { return; }
	ob_start( function ( $html ) use ( $c ) {
		if ( ! is_string( $html ) || false === stripos( $html, '</head>' ) ) { return $html; }
		$canonical = '<link rel="canonical" href="' . esc_url( $c['url'] ) . '" />';
		$robots    = '<meta name="robots" content="' . ( $c['index'] ? 'index, follow, max-image-preview:large' : 'noindex, follow' ) . '" />';
		/* replace what is there, or add it */
		$html = preg_replace( '#<link[^>]+rel=["\']canonical["\'][^>]*>#i', $canonical, $html, 1, $had_canonical );
		$html = preg_replace( '#<meta[^>]+name=["\']robots["\'][^>]*>#i', $robots, $html, 1, $had_robots );
		$html = preg_replace( '#(<meta[^>]+property=["\']og:url["\'][^>]+content=["\'])[^"\']*#i', '$1' . esc_url( $c['url'] ), $html, 1 );
		/* the group page prints its own description (the /groups/ directory blurb) outside Rank Math */
		$desc = esc_attr( $c['desc'] );
		foreach ( array( 'name', 'property' ) as $kind ) {
			foreach ( array( 'description', 'og:description', 'twitter:description' ) as $key ) {
				$html = preg_replace( '#(<meta[^>]+' . $kind . '=["\']' . preg_quote( $key, '#' ) . '["\'][^>]+content=["\'])[^"\']*#i', '${1}' . $desc, $html, 1 );
			}
		}
		$add  = ( $had_canonical ? '' : $canonical ) . ( $had_robots ? '' : $robots );
		return '' === $add ? $html : preg_replace( '#</head>#i', $add . '</head>', $html, 1 );
	} );
}, -1000 );

/* ---------------------------------------------------------- discovery */
/**
 * Group pages are already listed in sml-groups-sitemap.xml (entity-graph SEO), but Loop Letters
 * publication homes are in no sitemap at all — they are not WordPress posts, so Rank Math never
 * lists them. This file lists the public ones, and robots.txt points to it.
 */
function sml_pps_sitemap_urls() {
	global $wpdb;
	$out = array();
	foreach ( (array) $wpdb->get_results( "SELECT user_id, meta_value FROM {$wpdb->usermeta} WHERE meta_key = 'smll_handle' AND meta_value <> ''", ARRAY_A ) as $p ) {
		if ( 'public' !== ( (string) get_user_meta( (int) $p['user_id'], 'smll_visibility', true ) ?: 'public' ) ) { continue; }
		$out[] = home_url( '/n/' . rawurlencode( $p['meta_value'] ) . '/' );
	}
	return array_values( array_unique( $out ) );
}
add_action( 'template_redirect', function () {
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	if ( 'sml-letters-sitemap.xml' !== $path ) { return; }
	$urls = sml_pps_sitemap_urls();
	status_header( 200 );
	header( 'Content-Type: application/xml; charset=UTF-8' );
	header( 'X-Robots-Tag: noindex' );
	echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
	foreach ( $urls as $u ) { echo '<url><loc>' . esc_url( $u ) . '</loc><changefreq>daily</changefreq></url>' . "\n"; }
	echo '</urlset>';
	exit;
}, 0 );
/* Registered from wp_loaded on purpose: SML_Google_Sitemaps::robots_txt (a plugin, so it hooks
   after this mu-plugin) strips every Sitemap: line and rewrites the block, which swallowed this
   line when it was added earlier. Same priority, later registration = runs after it. */
add_action( 'wp_loaded', function () {
	add_filter( 'robots_txt', function ( $txt ) {
		return false === strpos( $txt, 'sml-letters-sitemap.xml' ) ? rtrim( $txt ) . "\nSitemap: " . home_url( '/sml-letters-sitemap.xml' ) . "\n" : $txt;
	}, PHP_INT_MAX );
} );
