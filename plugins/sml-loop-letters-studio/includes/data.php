<?php
/**
 * Storage and shared helpers. Letters themselves live in the Video Upload Studio's
 * tables ({prefix}sml_letter_posts and friends); this plugin adds one row per letter
 * with its studio settings, and one table for reader reactions.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_lls_table( $name ) { global $wpdb; return $wpdb->prefix . 'sml_letter_' . $name; }

function sml_lls_install() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$charset = $wpdb->get_charset_collate();
	$studio  = sml_lls_table( 'studio' );
	$react   = sml_lls_table( 'reactions' );
	dbDelta( "CREATE TABLE $studio (
		letter_id BIGINT UNSIGNED NOT NULL,
		data LONGTEXT NULL,
		updated_at DATETIME NULL,
		PRIMARY KEY  (letter_id)
	) $charset;" );
	dbDelta( "CREATE TABLE $react (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		letter_id BIGINT UNSIGNED NOT NULL,
		kind VARCHAR(16) NOT NULL,
		fingerprint CHAR(40) NOT NULL,
		created_at DATETIME NOT NULL,
		PRIMARY KEY  (id),
		UNIQUE KEY letter_fp (letter_id, fingerprint),
		KEY letter_kind (letter_id, kind)
	) $charset;" );
	if ( ! get_option( 'sml_lls_indexnow_key' ) ) {
		update_option( 'sml_lls_indexnow_key', strtolower( wp_generate_password( 32, false, false ) ), false );
	}
	update_option( 'sml_lls_db_version', SML_LLS_VERSION, false );
}

/** Every setting the studio can hold, with its default. */
function sml_lls_defaults() {
	return array(
		'cover'     => array( 'url' => '', 'id' => 0 ),
		'intro'     => array( 'url' => '', 'id' => 0, 'poster' => '', 'seconds' => 0, 'enabled' => false ),
		'audio'     => array( 'mode' => 'none', 'url' => '', 'id' => 0, 'youtube' => '', 'title' => '', 'seconds' => 0, 'autoplay' => false ),
		'immersive' => array(
			'level' => 'off', 'effects' => array(), 'shapes' => array(), 'objects' => array(), 'texture' => 'none',
			'accent' => '', 'bg_mode' => 'none', 'bg_url' => '', 'bg_id' => 0, 'pulse' => true,
		),
		'card'      => array(
			'template' => 'headline', 'theme' => 'dark', 'kicker' => '', 'title' => '', 'subtitle' => '', 'accent' => '',
			'bg' => 'cover', 'bg_url' => '', 'bg_id' => 0, 'show_tickers' => true, 'show_avatar' => true, 'show_price' => false,
			'images' => array( 'wide' => '', 'standard' => '', 'square' => '' ), 'generated_at' => '', 'hash' => '',
		),
		'seo'       => array(
			'meta_title' => '', 'meta_desc' => '', 'keyword' => '', 'news_keywords' => '', 'schema_type' => 'NewsArticle',
			'noindex' => false, 'og_title' => '', 'og_desc' => '',
		),
		'reader'    => array( 'toc' => true, 'levels_card' => true, 'reactions' => true, 'highlights' => true, 'subscribe_box' => true, 'next_issue' => true, 'share_bar' => true ),
	);
}

function sml_lls_merge( $base, $patch ) {
	foreach ( (array) $patch as $k => $v ) {
		if ( is_array( $v ) && isset( $base[ $k ] ) && is_array( $base[ $k ] ) && ! isset( $v[0] ) && ! isset( $base[ $k ][0] ) ) {
			$base[ $k ] = sml_lls_merge( $base[ $k ], $v );
		} else {
			$base[ $k ] = $v;
		}
	}
	return $base;
}

$GLOBALS['sml_lls_cache'] = array();

function sml_lls_get( $letter_id ) {
	global $wpdb;
	$letter_id = (int) $letter_id;
	if ( isset( $GLOBALS['sml_lls_cache'][ $letter_id ] ) ) { return $GLOBALS['sml_lls_cache'][ $letter_id ]; }
	$json = $wpdb->get_var( $wpdb->prepare( 'SELECT data FROM ' . sml_lls_table( 'studio' ) . ' WHERE letter_id = %d', $letter_id ) );
	$data = $json ? json_decode( $json, true ) : array();
	$GLOBALS['sml_lls_cache'][ $letter_id ] = sml_lls_merge( sml_lls_defaults(), is_array( $data ) ? $data : array() );
	return $GLOBALS['sml_lls_cache'][ $letter_id ];
}

function sml_lls_put( $letter_id, $patch ) {
	global $wpdb;
	$letter_id = (int) $letter_id;
	$data = sml_lls_merge( sml_lls_get( $letter_id ), $patch );
	$wpdb->replace( sml_lls_table( 'studio' ), array(
		'letter_id'  => $letter_id,
		'data'       => wp_json_encode( $data ),
		'updated_at' => gmdate( 'Y-m-d H:i:s' ),
	), array( '%d', '%s', '%s' ) );
	$GLOBALS['sml_lls_cache'][ $letter_id ] = $data;
	return $data;
}
function sml_lls_forget( $letter_id ) { unset( $GLOBALS['sml_lls_cache'][ (int) $letter_id ] ); }

/* ---------------- letters ---------------- */

function sml_lls_letters_ready() { return function_exists( 'sml_letters_table' ) && function_exists( 'sml_letters_public' ) && function_exists( 'sml_letters_render_html' ); }

function sml_lls_letter_by_slug( $slug ) {
	global $wpdb;
	if ( ! sml_lls_letters_ready() ) { return null; }
	return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . sml_letters_table( 'posts' ) . ' WHERE slug = %s', sanitize_title( $slug ) ), ARRAY_A );
}
function sml_lls_letter_by_id( $id ) {
	global $wpdb;
	if ( ! sml_lls_letters_ready() ) { return null; }
	return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . sml_letters_table( 'posts' ) . ' WHERE id = %d', (int) $id ), ARRAY_A );
}
function sml_lls_can_edit( $letter_id, $user_id = 0 ) {
	$user_id = $user_id ?: get_current_user_id();
	if ( ! $user_id ) { return false; }
	if ( user_can( $user_id, 'manage_options' ) ) { return true; }
	$row = sml_lls_letter_by_id( $letter_id );
	return $row && (int) $row['author_id'] === (int) $user_id;
}
function sml_lls_blocks( $row ) {
	$blocks = json_decode( (string) ( $row['blocks'] ?? '' ), true );
	return is_array( $blocks ) ? $blocks : array();
}

/** The handle every public URL uses: the publication handle, else the display name. */
function sml_lls_handle( $user_id ) {
	$handle = sanitize_title( (string) get_user_meta( (int) $user_id, 'smll_handle', true ) );
	if ( $handle ) { return $handle; }
	$user = get_userdata( (int) $user_id );
	return $user ? sanitize_title( $user->display_name ?: $user->user_nicename ) : 'author';
}
/** Every handle that may appear in an old link for this author. */
function sml_lls_handle_aliases( $user_id ) {
	$user = get_userdata( (int) $user_id );
	$out  = array( sml_lls_handle( $user_id ) );
	if ( $user ) {
		$out[] = sanitize_title( $user->display_name ?: $user->user_nicename );
		$out[] = sanitize_title( $user->user_nicename );
		$out[] = sanitize_title( (string) get_user_meta( (int) $user_id, 'smll_handle_raw', true ) );
	}
	return array_values( array_unique( array_filter( $out ) ) );
}
function sml_lls_letter_url( $row ) { return home_url( '/n/' . sml_lls_handle( $row['author_id'] ) . '/' . $row['slug'] . '/' ); }
function sml_lls_publication_url( $user_id ) { return home_url( '/n/' . sml_lls_handle( $user_id ) . '/' ); }

function sml_lls_publication( $user_id ) {
	$user_id  = (int) $user_id;
	$user     = get_userdata( $user_id );
	$settings = function_exists( 'sml_letters_publication_settings' ) ? sml_letters_publication_settings( $user_id ) : array();
	$name     = (string) get_user_meta( $user_id, 'smll_name', true ) ?: (string) ( $settings['publication_name'] ?? '' );
	$logo_id  = absint( get_user_meta( $user_id, 'smll_logo_image_id', true ) );
	$social   = array_filter( array(
		'x'       => (string) get_user_meta( $user_id, 'smll_social_x', true ),
		'youtube' => (string) get_user_meta( $user_id, 'smll_social_youtube', true ),
		'discord' => (string) get_user_meta( $user_id, 'smll_social_discord', true ),
	) );
	return array(
		'id'          => $user_id,
		'handle'      => sml_lls_handle( $user_id ),
		'name'        => $name ?: ( $user ? $user->display_name : 'Loop Letter' ),
		'tagline'     => (string) get_user_meta( $user_id, 'smll_tagline', true ) ?: (string) ( $settings['description'] ?? '' ),
		'accent'      => (string) get_user_meta( $user_id, 'smll_accent', true ) ?: (string) ( $settings['brand_color'] ?? '' ) ?: '#38f58a',
		'logo'        => $logo_id ? (string) wp_get_attachment_image_url( $logo_id, 'medium' ) : '',
		'url'         => sml_lls_publication_url( $user_id ),
		'feed'        => add_query_arg( 'feed', 'rss', sml_lls_publication_url( $user_id ) ),
		'author_name' => (string) ( $settings['byline_name'] ?? '' ) ?: ( $user ? $user->display_name : '' ),
		'author_url'  => $user ? home_url( '/members/' . $user->user_nicename . '/' ) : home_url( '/' ),
		'avatar'      => get_avatar_url( $user_id, array( 'size' => 160 ) ),
		'social'      => $social,
		'signup_copy' => (string) get_user_meta( $user_id, 'smll_signup_copy', true ) ?: 'New issues land in your inbox the moment they publish. Free, one click to leave.',
		'signup_button' => (string) get_user_meta( $user_id, 'smll_signup_button', true ) ?: 'Subscribe',
	);
}

function sml_lls_levels( $blocks ) {
	$out = array();
	foreach ( $blocks as $b ) {
		if ( ( $b['type'] ?? '' ) !== 'levels' ) { continue; }
		$symbol = strtoupper( preg_replace( '/[^A-Za-z]/', '', (string) ( $b['symbol'] ?? '' ) ) );
		if ( ! $symbol ) { continue; }
		$t = array_values( (array) ( $b['targets'] ?? array() ) );
		$out[] = array( 'symbol' => $symbol, 'entry' => (string) ( $b['entry'] ?? '' ), 'stop' => (string) ( $b['stop'] ?? '' ), 'target1' => (string) ( $t[0] ?? '' ), 'target2' => (string) ( $t[1] ?? '' ), 'timeframe' => (string) ( $b['timeframe'] ?? '' ) );
	}
	return $out;
}
function sml_lls_tickers( $row ) {
	$out = array();
	if ( function_exists( 'sml_letters_ticker_rows' ) ) {
		foreach ( (array) sml_letters_ticker_rows( (int) $row['id'] ) as $t ) { if ( ! empty( $t['symbol'] ) ) { $out[] = strtoupper( $t['symbol'] ); } }
	}
	if ( ! $out && function_exists( 'sml_letters_symbols_in_blocks' ) ) { $out = (array) sml_letters_symbols_in_blocks( sml_lls_blocks( $row ) ); }
	return array_values( array_unique( array_filter( array_map( 'strtoupper', $out ) ) ) );
}

function sml_lls_trim( $text, $max ) {
	$text = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( (string) $text ) ) );
	if ( mb_strlen( $text ) <= $max ) { return $text; }
	$cut = mb_substr( $text, 0, $max - 1 );
	$sp  = mb_strrpos( $cut, ' ' );
	return rtrim( $sp ? mb_substr( $cut, 0, $sp ) : $cut, ' ,;:.' ) . '…';
}
function sml_lls_title( $row, $data ) { return (string) ( $data['seo']['meta_title'] ?: $row['title'] ); }
function sml_lls_description( $row, $data ) {
	$d = $data['seo']['meta_desc'] ?: ( $row['tldr'] ?: ( $row['subtitle'] ?: ( $row['plaintext'] ?: '' ) ) );
	return sml_lls_trim( $d, 158 );
}
function sml_lls_cover( $row, $data ) { return (string) ( $data['cover']['url'] ?: $row['cover_url'] ); }
function sml_lls_is_public( $row ) { return ( $row['status'] ?? '' ) === 'published' && ( $row['visibility'] ?? 'public' ) === 'public'; }
function sml_lls_is_indexable( $row, $data ) { return ( $row['status'] ?? '' ) === 'published' && empty( $data['seo']['noindex'] ) && in_array( $row['visibility'] ?? 'public', array( 'public', 'members', 'subscribers' ), true ); }

function sml_lls_reaction_counts( $letter_id ) {
	global $wpdb;
	$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT kind, COUNT(*) AS n FROM ' . sml_lls_table( 'reactions' ) . ' WHERE letter_id = %d GROUP BY kind', (int) $letter_id ), ARRAY_A );
	$out  = array( 'bull' => 0, 'bear' => 0, 'fire' => 0, 'mind' => 0 );
	foreach ( (array) $rows as $r ) { if ( isset( $out[ $r['kind'] ] ) ) { $out[ $r['kind'] ] = (int) $r['n']; } }
	return $out;
}
function sml_lls_fingerprint( $client_id = '' ) {
	$uid = get_current_user_id();
	if ( $uid ) { return sha1( 'u' . $uid ); }
	/* an anonymous reader carries a random id the page keeps for them; it beats an IP that changes between requests */
	if ( preg_match( '/^[a-z0-9]{16,40}$/', (string) $client_id ) ) { return sha1( 'c' . $client_id . wp_salt( 'nonce' ) ); }
	$ip = (string) ( $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '' );
	$ip = trim( explode( ',', $ip )[0] );
	return sha1( 'v' . $ip . '|' . (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' ) . '|' . wp_salt( 'nonce' ) );
}

/** Published letters for sitemaps and feeds: newest first. */
function sml_lls_published( $limit = 1000, $since_hours = 0 ) {
	global $wpdb;
	if ( ! sml_lls_letters_ready() ) { return array(); }
	$sql = 'SELECT id, author_id, slug, title, subtitle, tldr, cover_url, tags, content_type, visibility, published_at, updated_at, plaintext, html, word_count, read_minutes FROM ' . sml_letters_table( 'posts' ) . " WHERE status = 'published' AND visibility = 'public'";
	if ( $since_hours ) { $sql .= $wpdb->prepare( ' AND published_at >= %s', gmdate( 'Y-m-d H:i:s', time() - $since_hours * 3600 ) ); }
	$sql .= $wpdb->prepare( ' ORDER BY published_at DESC LIMIT %d', (int) $limit );
	return (array) $wpdb->get_results( $sql, ARRAY_A ); // phpcs:ignore WordPress.DB
}
function sml_lls_neighbours( $row ) {
	global $wpdb;
	$t = sml_letters_table( 'posts' );
	$prev = $wpdb->get_row( $wpdb->prepare( "SELECT id, slug, title, read_minutes, cover_url, published_at, author_id FROM $t WHERE author_id = %d AND status = 'published' AND published_at < %s ORDER BY published_at DESC LIMIT 1", $row['author_id'], $row['published_at'] ), ARRAY_A );
	$next = $wpdb->get_row( $wpdb->prepare( "SELECT id, slug, title, read_minutes, cover_url, published_at, author_id FROM $t WHERE author_id = %d AND status = 'published' AND published_at > %s ORDER BY published_at ASC LIMIT 1", $row['author_id'], $row['published_at'] ), ARRAY_A );
	return array( 'prev' => $prev, 'next' => $next );
}
function sml_lls_more_from( $row, $limit = 5 ) {
	global $wpdb;
	$t = sml_letters_table( 'posts' );
	return (array) $wpdb->get_results( $wpdb->prepare( "SELECT id, slug, title, read_minutes, cover_url, published_at, author_id FROM $t WHERE author_id = %d AND status = 'published' AND id <> %d ORDER BY published_at DESC LIMIT %d", $row['author_id'], $row['id'], $limit ), ARRAY_A );
}
function sml_lls_iso( $mysql ) { return $mysql ? gmdate( 'c', strtotime( $mysql . ' UTC' ) ) : gmdate( 'c' ); }
