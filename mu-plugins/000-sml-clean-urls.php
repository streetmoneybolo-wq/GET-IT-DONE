<?php
/**
 * Plugin Name: SML Clean URLs (watch + live)
 * Description: Keyword URLs for uploaded videos and live streams without touching the code that renders them. Videos: /watch/{id}/{title-slug}/ (the id stays the key, the slug is decorative and canonicalised; /video/{id}/... is accepted as an alias). Live: /live/{handle}/{title-slug}-{streamid}/ (the stream id stays in the path because chat, Super Chat and the schedule are keyed by it and titles repeat). Owner call 2026-09-19.
 * Version: 1.0.0
 * Author: StockMarketLoop
 *
 * HOW IT WORKS
 *  1. At FILE-INCLUDE time (this file sorts first in mu-plugins, and nothing on this site reads the request
 *     before `init`) a pretty path is recognised and $_SERVER['REQUEST_URI'] / $_GET are rewritten back to the
 *     classic form. Every existing router and gate (upload-studio watch router, WPCode #7044/#7053/#7318/#7348/
 *     #7358, sml-google-sitemaps, playlists, GA4...) keeps working unchanged. It is purely syntactic: no plugin
 *     or WPCode function exists yet at this point.
 *  2. URL SOURCES are switched only when option sml_cu_mode = 'on': the stored watch_url of every video is
 *     recomputed on read (filter option_sml_video_upload_studio_library) and sml_scheduled_live_watch_url() is
 *     pre-defined here (WPCode #7347 declares it inside function_exists(), and WPCode runs at plugins_loaded:5,
 *     after mu-plugins). Canonical, og:url, JSON-LD, sitemaps, IndexNow, notifications and autopost all read
 *     those two sources, so they follow automatically.
 *  3. REDIRECTS (init:-10000, decided from the ORIGINAL uri only, GET/HEAD only): classic -> pretty and
 *     wrong-slug -> current slug when mode = 'on'; the /video/ alias and the id-less live form always.
 *
 * MODES (option sml_cu_mode, or constant SML_CU_MODE): 'off' = inert · 'accept' (default) = pretty URLs resolve
 * but nothing links to them · 'on' = sources + redirects switched. Redirects are 302 until option
 * sml_cu_redirect_code = 301: a browser caches a 301 forever, and if this layer ever had to be removed those
 * visitors would be stuck on 404s.
 *
 * ROLLBACK: set the mode to 'accept' — clean links already shared, indexed or cached keep resolving and nothing new
 * points at them. 'off' / constant SML_CU_DISABLE are the HARD stop: sources go classic AND inbound clean links 404.
 * The database never holds a clean URL (pre_update_option normaliser), so this file can also simply be removed.
 * After switching to 'on', flush the 6-hour video sitemap cache (SML_Google_Sitemaps::invalidate()).
 *
 * DEPLOY ORDER MATTERS: js/live-watch.js must already be live (CDN pin advanced) before clean LIVE urls resolve. The old
 * JS reads the room only from location.search, so on a clean URL it boots the default room and sends chat and paid
 * Super Chats there. The new JS also parses the clean path itself, so it no longer depends on the tag printed below.
 *
 * DO NOT: rename this file so it stops sorting first; move step 1 onto a hook; use sanitize_title() for slugs
 * (emoji become lower-case percent escapes -> infinite redirect when a proxy upper-cases them); put a title slug
 * on a non-public video or stream (the redirect would leak the title to anyone holding the id).
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! defined( 'SML_CU_VERSION' ) ) { define( 'SML_CU_VERSION', '1.0.0' ); }

/* Everything below sits inside this one block on purpose. A second copy of this file in mu-plugins (a backup left with a
   .php suffix) would otherwise redeclare these functions at include time — a fatal before WordPress has loaded, i.e. the
   whole site down. Inside the block a second copy is a complete no-op: no redeclare, no duplicate hooks. Functions
   declared in a block are NOT hoisted, so the boot call must stay the LAST statement. Keep backups as *.php.bak-DATE. */
if ( ! function_exists( 'sml_cu_ctx' ) ) {

/* ------------------------------------------------------------------ state */

function sml_cu_ctx( $set = null ) {
	static $ctx = array(
		'done'    => false,  // include-time pass ran
		'kind'    => '',     // '' | 'vod' | 'live'
		'rewrote' => false,  // REQUEST_URI was rewritten
		'alias'   => false,  // came in through /video/
		'id'      => '',     // video id or stream id
		'handle'  => '',
		'slug'    => '',     // slug as requested
		'idless'  => false,  // pretty live path that named no stream id
		'path'    => '',     // ORIGINAL path
		'query'   => '',     // ORIGINAL query string
		'saved'   => null,   // superglobals before the rewrite, for undo
	);
	if ( is_array( $set ) ) { $ctx = array_merge( $ctx, $set ); }
	return $ctx;
}

function sml_cu_mode( $reset = false ) {
	static $mode = null;
	if ( $reset ) { $mode = null; }
	if ( null !== $mode ) { return $mode; }
	/* A FULL stop, not just the recogniser: with only the recogniser off, the URL sources would keep emitting clean
	   URLs that nothing resolves any more. */
	if ( defined( 'SML_CU_DISABLE' ) ) { return $mode = 'off'; }
	if ( defined( 'SML_CU_MODE' ) ) { $v = SML_CU_MODE; }
	else {
		$v = function_exists( 'get_option' ) ? get_option( 'sml_cu_mode', null ) : null;
		if ( ( null === $v || false === $v || '' === $v ) && isset( $GLOBALS['wpdb'] ) && is_object( $GLOBALS['wpdb'] ) && ! empty( $GLOBALS['wpdb']->options ) ) {
			/* this site's object cache can hold a stale `notoptions` entry that hides a NEW option from fresh requests */
			$wpdb = $GLOBALS['wpdb'];
			$v    = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s LIMIT 1", 'sml_cu_mode' ) );
			if ( null !== $v && function_exists( 'wp_cache_delete' ) ) { wp_cache_delete( 'notoptions', 'options' ); }
		}
	}
	$mode = in_array( $v, array( 'off', 'accept', 'on' ), true ) ? $v : 'accept';
	return $mode;
}

/* ------------------------------------------------------------------- slug */

/**
 * Title -> ASCII slug. Deterministic, [a-z0-9-] only, may be EMPTY only when $fallback is ''.
 * $ticker goes first when the title does not already mention it ("spy-breakout-...").
 */
function sml_cu_slug( $title, $ticker = '', $fallback = '', $max = 60 ) {
	$t = html_entity_decode( (string) $title, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
	$t = str_replace( array( "\xE2\x80\x99", "\xE2\x80\x98", "\xE2\x80\x9C", "\xE2\x80\x9D" ), '', $t ); // curly quotes: don’t -> dont, with or without iconv
	if ( function_exists( 'remove_accents' ) ) { $t = remove_accents( $t ); }
	if ( function_exists( 'iconv' ) ) {
		$x = @iconv( 'UTF-8', 'ASCII//TRANSLIT//IGNORE', $t );
		if ( is_string( $x ) && '' !== $x ) { $t = $x; }
	}
	$t = strtolower( $t );
	$t = str_replace( array( '&', '%', '+', '@' ), array( ' and ', ' percent ', ' plus ', ' at ' ), $t );
	$t = preg_replace( '/[\'`"]/', '', $t );
	$t = trim( (string) preg_replace( '/[^a-z0-9]+/', '-', (string) $t ), '-' );

	$tk = strtolower( (string) preg_replace( '/[^A-Za-z0-9]/', '', (string) $ticker ) );
	if ( '' !== $tk && strlen( $tk ) <= 6 && ! preg_match( '/(^|-)' . preg_quote( $tk, '/' ) . '(-|$)/', $t ) ) {
		$t = '' === $t ? $tk : $tk . '-' . $t;
	}
	if ( '' === $t ) { $t = (string) $fallback; }
	if ( strlen( $t ) > $max ) {
		$cut = substr( $t, 0, $max );
		if ( '-' !== $t[ $max ] ) { // the cut fell inside a word: drop the partial word (a cut ON a boundary keeps its last word)
			$pos = strrpos( $cut, '-' );
			if ( false !== $pos && $pos >= (int) ( $max * 0.5 ) ) { $cut = substr( $cut, 0, $pos ); }
		}
		$t = trim( $cut, '-' );
		/* a truncated slug must not end on a dangling connector ("...strategy-and") */
		while ( preg_match( '/^(.+)-(?:a|an|and|as|at|by|for|from|in|of|on|or|the|to|vs|with)$/', $t, $m ) ) { $t = $m[1]; }
	}
	return $t;
}

function sml_cu_clean_stream_id( $value ) {
	$value = strtolower( (string) preg_replace( '/[^a-zA-Z0-9]/', '', (string) $value ) );
	return ( strlen( $value ) >= 8 && strlen( $value ) <= 32 ) ? $value : '';
}

/** VIDEOS: title slugs only go on content anyone may see; otherwise a redirect would leak the title to whoever holds the id.
    (The watch page already shows an unlisted/scheduled video's title to any link holder, so those count.) */
function sml_cu_is_public_visibility( $visibility ) {
	return in_array( (string) $visibility, array( '', 'public', 'unlisted', 'scheduled' ), true );
}

/** STREAMS are stricter, and deliberately NOT the video rule: every existing surface (#7347 public payload, #7358 cards,
    autopost, sitemap) exposes a stream's metadata only when visibility is exactly 'public'. An unlisted stream's id is
    its secret, so its title must never reach a URL and a title guess must never be answered with the id. */
function sml_cu_stream_is_public( $row ) {
	return is_array( $row )
		&& 'public' === (string) ( $row['visibility'] ?? 'public' )
		&& 'cancelled' !== (string) ( $row['status'] ?? '' );
}

/* ------------------------------------------- 1. include-time recogniser */

function sml_cu_rewrite_request() {
	$ctx = sml_cu_ctx();
	if ( $ctx['done'] ) { return; }
	sml_cu_ctx( array( 'done' => true ) );

	$method = strtoupper( (string) ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) );
	if ( 'GET' !== $method && 'HEAD' !== $method ) { return; }
	$uri = (string) ( $_SERVER['REQUEST_URI'] ?? '' );
	if ( '' === $uri || strlen( $uri ) > 2048 ) { return; }
	if ( 0 !== strncmp( $uri, '/watch/', 7 ) && 0 !== strncmp( $uri, '/video/', 7 ) && 0 !== strncmp( $uri, '/live/', 6 ) && '/live' !== $uri && 0 !== strncmp( $uri, '/live?', 6 ) ) { return; }
	if ( 'off' === sml_cu_mode() ) { return; }

	$qpos  = strpos( $uri, '?' );
	$path  = false === $qpos ? $uri : substr( $uri, 0, $qpos );
	$query = false === $qpos ? '' : (string) substr( $uri, $qpos + 1 );
	if ( false !== strpos( $path, '%' ) || false !== strpos( $path, '//' ) ) { return; } // never one of ours

	/* ---- uploaded video ---- */
	if ( preg_match( '#^/(watch|video)/([A-Za-z0-9_-]{8,32})(?:/([A-Za-z0-9_-]{0,200}))?/?$#', $path, $m ) ) {
		$has_slug = isset( $m[3] ) && '' !== $m[3];
		$alias    = ( 'video' === $m[1] );
		if ( ! $alias && ! $has_slug ) { // classic /watch/{id}/ : nothing to rewrite, remember it for the redirect pass
			sml_cu_ctx( array( 'kind' => 'vod', 'id' => $m[2], 'path' => $path, 'query' => $query ) );
			return;
		}
		/* Only take over a two-segment path when {id} really is a video, so an unrelated /watch/x/y/ keeps its own fate. */
		if ( ! sml_cu_video_exists( $m[2] ) ) { return; }
		sml_cu_ctx( array(
			'kind' => 'vod', 'rewrote' => true, 'alias' => $alias, 'id' => $m[2], 'slug' => $has_slug ? strtolower( $m[3] ) : '',
			'path' => $path, 'query' => $query, 'saved' => array( 'uri' => $uri ),
		) );
		$_SERVER['SML_CU_ORIG_REQUEST_URI'] = $uri;
		$_SERVER['REQUEST_URI']             = '/watch/' . $m[2] . '/' . ( '' !== $query ? '?' . $query : '' );
		return;
	}

	/* ---- live: classic /live/?room=h[&stream=id] (remember it) ---- */
	if ( '/live/' === $path || '/live' === $path ) {
		/* Legacy /live/?s={handle} — which is what EVERY Boost share link is (/live/?b=CODE&s=handle). WPCode #7044 302s it
		   to ?room= and rebuilds the URL from scratch, dropping ?b= and utm_*, so the verified Boost click was never
		   credited. Read `s` as `room` here, before WordPress can take it for a search: no redirect happens at all, the
		   browser keeps ?b=, and live-watch.js (which still accepts ?s=) credits the click. */
		if ( ! isset( $_GET['room'] ) && isset( $_GET['s'] ) && is_string( $_GET['s'] ) ) {
			$legacy = strtolower( (string) preg_replace( '/[^A-Za-z0-9_-]/', '', $_GET['s'] ) );
			if ( '' !== $legacy ) {
				parse_str( $query, $largs );
				$largs = is_array( $largs ) ? $largs : array();
				unset( $largs['s'], $largs['room'] );
				$lfinal = array( 'room' => $legacy ) + $largs;
				$lqs    = http_build_query( $lfinal, '', '&' );
				sml_cu_ctx( array( 'rewrote' => true, 'saved' => array( 'uri' => $uri, 'get' => $_GET, 'request' => $_REQUEST, 'qs' => (string) ( $_SERVER['QUERY_STRING'] ?? '' ) ) ) );
				$_SERVER['SML_CU_ORIG_REQUEST_URI'] = $uri;
				$_SERVER['REQUEST_URI']             = '/live/?' . $lqs;
				$_SERVER['QUERY_STRING']            = $lqs;
				unset( $_GET['s'], $_REQUEST['s'] );
				$_GET['room'] = $legacy; $_REQUEST['room'] = $legacy;
			}
		}
		$room = isset( $_GET['room'] ) && is_string( $_GET['room'] ) ? strtolower( (string) preg_replace( '/[^A-Za-z0-9_\-]/', '', $_GET['room'] ) ) : '';
		if ( '' !== $room ) {
			$sid = isset( $_GET['stream'] ) && is_string( $_GET['stream'] ) ? sml_cu_clean_stream_id( $_GET['stream'] ) : '';
			sml_cu_ctx( array( 'kind' => 'live', 'handle' => $room, 'id' => $sid, 'path' => $path, 'query' => $query ) );
		}
		return;
	}

	/* ---- live: pretty /live/{handle}/{slug}-{id16}/ , /live/{handle}/{id16}/ , or id-less /live/{handle}/{slug}/ ----
	   Exactly three segments: two-segment /live/{handle}/ is the OBS slots page and is never touched. */
	if ( preg_match( '#^/live/([A-Za-z0-9._-]{1,60})/([A-Za-z0-9-]{1,220})/?$#', $path, $m ) ) {
		$handle = strtolower( (string) preg_replace( '/[^A-Za-z0-9_\-]/', '', $m[1] ) ); // mirrors sanitize_key(), as #7347 does
		$seg    = strtolower( $m[2] );
		if ( '' === $handle ) { return; }
		$sid = ''; $slug = $seg;
		if ( preg_match( '#^(?:([a-z0-9-]*?)-)?([a-f0-9]{16})$#', $seg, $s ) ) { $sid = $s[2]; $slug = (string) $s[1]; }

		parse_str( $query, $args );
		$args = is_array( $args ) ? $args : array();
		unset( $args['room'], $args['stream'], $args['s'] ); // the path wins over any ?room= riding along
		$final = array( 'room' => $handle );
		if ( '' !== $sid ) { $final['stream'] = $sid; }
		$final = $final + $args;

		sml_cu_ctx( array(
			'kind' => 'live', 'rewrote' => true, 'idless' => ( '' === $sid ), 'handle' => $handle, 'id' => $sid, 'slug' => $slug, 'path' => $path, 'query' => $query,
			'saved' => array( 'uri' => $uri, 'get' => $_GET, 'request' => $_REQUEST, 'qs' => (string) ( $_SERVER['QUERY_STRING'] ?? '' ) ),
		) );
		$qs = http_build_query( $final, '', '&' );
		$_SERVER['SML_CU_ORIG_REQUEST_URI'] = $uri;
		$_SERVER['REQUEST_URI']             = '/live/?' . $qs;
		$_SERVER['QUERY_STRING']            = $qs;
		unset( $_GET['s'], $_REQUEST['s'] );
		foreach ( array( 'room', 'stream' ) as $k ) {
			if ( isset( $final[ $k ] ) ) { $_GET[ $k ] = $final[ $k ]; $_REQUEST[ $k ] = $final[ $k ]; }
			else { unset( $_GET[ $k ], $_REQUEST[ $k ] ); }
		}
	}
}

/** Put the request back exactly as it arrived (an id-less live path that matched nothing must 404 as before). */
function sml_cu_undo_rewrite() {
	$ctx = sml_cu_ctx();
	if ( ! $ctx['rewrote'] || ! is_array( $ctx['saved'] ) ) { return; }
	$_SERVER['REQUEST_URI'] = $ctx['saved']['uri'];
	if ( isset( $ctx['saved']['get'] ) ) {
		$_GET = $ctx['saved']['get']; $_REQUEST = $ctx['saved']['request']; $_SERVER['QUERY_STRING'] = $ctx['saved']['qs'];
	}
	unset( $_SERVER['SML_CU_ORIG_REQUEST_URI'] );
	sml_cu_ctx( array( 'rewrote' => false, 'idless' => false, 'kind' => '' ) );
}

/* ------------------------------------------------------------ 2. videos */

function sml_cu_library_raw() {
	if ( ! function_exists( 'get_option' ) ) { return array(); }
	$GLOBALS['sml_cu_raw_library'] = true; // tells our own option filter to stand down
	$lib = get_option( 'sml_video_upload_studio_library', array() );
	unset( $GLOBALS['sml_cu_raw_library'] );
	return is_array( $lib ) ? $lib : array();
}

function sml_cu_video_exists( $id ) {
	$lib = sml_cu_library_raw();
	$key = function_exists( 'sanitize_key' ) ? sanitize_key( (string) $id ) : strtolower( (string) $id );
	return isset( $lib[ $key ] ) && is_array( $lib[ $key ] );
}

/** Canonical URL of one video. Falls back to the classic form whenever a slug would be empty or must not be shown. */
function sml_cu_video_url( $id, $row ) {
	static $memo = array(); // the library filter runs on every read of the option; slugging each row once per request is enough
	$id = (string) $id;
	$mk = $id . '|' . sml_cu_mode() . '|' . ( is_array( $row ) ? md5( (string) ( $row['title'] ?? '' ) . '|' . (string) ( $row['ticker'] ?? '' ) . '|' . (string) ( $row['visibility'] ?? '' ) ) : '-' );
	if ( isset( $memo[ $mk ] ) ) { return $memo[ $mk ]; }
	$base = home_url( '/watch/' . rawurlencode( $id ) . '/' );
	if ( 'on' !== sml_cu_mode() || ! is_array( $row ) ) { return $memo[ $mk ] = $base; }
	if ( ! sml_cu_is_public_visibility( $row['visibility'] ?? 'public' ) ) { return $memo[ $mk ] = $base; }
	$slug = sml_cu_slug( (string) ( $row['title'] ?? '' ), (string) ( $row['ticker'] ?? '' ) );
	if ( '' === $slug ) { return $memo[ $mk ] = $base; } // emoji-only / non-latin title: the id-only URL IS the canonical one
	return $memo[ $mk ] = home_url( '/watch/' . rawurlencode( $id ) . '/' . $slug . '/' );
}

/**
 * Every consumer (canonical, og:url, VideoObject, sitemap, rails, search, Distribute...) prints the STORED
 * watch_url, so it is recomputed on every read. It is never trusted back: the whole option is read-modify-written
 * on each view/like, which would otherwise freeze a stale slug after a title edit.
 */
function sml_cu_filter_library( $library ) {
	if ( ! empty( $GLOBALS['sml_cu_raw_library'] ) || ! is_array( $library ) ) { return $library; }
	if ( 'on' !== sml_cu_mode() ) {
		/* Rollback safety. Views and likes read-modify-write the whole option, so a pretty watch_url gets persisted
		   while the mode is 'on'. Outside 'on' nothing may point at a pretty URL, so the classic form is put back on read. */
		foreach ( $library as $id => $row ) {
			if ( is_array( $row ) && isset( $row['watch_url'] ) && preg_match( '#/watch/([A-Za-z0-9_-]{8,32})/[^/?]+/?$#', (string) $row['watch_url'], $m ) ) {
				$library[ $id ]['watch_url'] = home_url( '/watch/' . $m[1] . '/' );
			}
		}
		return $library;
	}
	foreach ( $library as $id => $row ) {
		if ( ! is_array( $row ) ) { continue; }
		$vid = (string) ( $row['id'] ?? $id );
		if ( '' === $vid ) { continue; }
		/* Distribute derives a video's entity id as crc32('video|id|watch_url') unless the row carries a numeric
		   dist_entity_id. Pin today's value BEFORE the url changes, or every already-shared video becomes a new entity. */
		if ( ! isset( $row['dist_entity_id'] ) || ! is_numeric( $row['dist_entity_id'] ) || (int) $row['dist_entity_id'] <= 0 ) {
			$hash                  = sprintf( '%u', crc32( 'video|' . $vid . '|' . (string) ( $row['watch_url'] ?? '' ) ) );
			$row['dist_entity_id'] = max( 1, (int) $hash );
		}
		$row['watch_url'] = sml_cu_video_url( $vid, $row );
		$library[ $id ]   = $row;
	}
	return $library;
}
add_filter( 'option_sml_video_upload_studio_library', 'sml_cu_filter_library', 10, 1 );

/**
 * The DATABASE copy always stays classic. Every view/like/comment read-modify-writes the whole option, so without this
 * the filtered (clean) watch_url would be persisted — and removing this file later would strand every video on a URL
 * the watch router 404s. With it, this file can be removed in any mode and the site simply reverts.
 */
function sml_cu_classic_on_write( $library ) {
	if ( ! is_array( $library ) ) { return $library; }
	foreach ( $library as $id => $row ) {
		if ( is_array( $row ) && isset( $row['watch_url'] ) && is_string( $row['watch_url'] )
			&& preg_match( '#/watch/([A-Za-z0-9_-]{8,32})/[^/?]+/?$#', $row['watch_url'], $m ) ) {
			$library[ $id ]['watch_url'] = home_url( '/watch/' . $m[1] . '/' );
		}
	}
	return $library;
}
add_filter( 'pre_update_option_sml_video_upload_studio_library', 'sml_cu_classic_on_write', 10, 1 );

/* -------------------------------------------------------------- 2. live */

function sml_cu_live_user_id( $handle ) {
	static $memo = array(); // the sitemap calls the URL builder in a loop; one user lookup per handle per request
	$handle = (string) $handle;
	if ( isset( $memo[ $handle ] ) && empty( $GLOBALS['sml_cu_test'] ) ) { return $memo[ $handle ]; }
	if ( ! function_exists( 'sml_scheduled_live_user_for_handle' ) ) { return 0; } // not memoised: WPCode may just not have loaded yet
	$u = sml_scheduled_live_user_for_handle( $handle );
	return $memo[ $handle ] = ( is_object( $u ) && ! empty( $u->ID ) ) ? (int) $u->ID : 0;
}

function sml_cu_live_row( $user_id, $stream_id ) {
	if ( ! $user_id || '' === $stream_id || ! function_exists( 'sml_scheduled_live_row' ) ) { return array(); }
	$row = sml_scheduled_live_row( $user_id, $stream_id );
	return ( is_array( $row ) && ! empty( $row['id'] ) ) ? $row : array();
}

/** Pretty URL for ONE stream, or '' when it cannot be built (unknown record, legacy id shape, helpers missing). */
function sml_cu_live_pretty_url( $handle, $stream_id, $row = null ) {
	$handle    = strtolower( (string) preg_replace( '/[^A-Za-z0-9_\-]/', '', (string) $handle ) );
	$stream_id = sml_cu_clean_stream_id( $stream_id );
	if ( '' === $handle || ! preg_match( '/^[a-f0-9]{16}$/', $stream_id ) ) { return ''; } // the recogniser only knows 16-hex ids
	if ( ! is_array( $row ) ) { $row = sml_cu_live_row( sml_cu_live_user_id( $handle ), $stream_id ); }
	if ( empty( $row ) ) { return ''; }
	$slug = sml_cu_stream_is_public( $row )
		? sml_cu_slug( (string) ( $row['title'] ?? '' ), (string) ( $row['ticker'] ?? '' ), '', 60 )
		: '';
	/* a slug that itself ends in 16 hex chars would be read back as the id */
	if ( '' !== $slug && preg_match( '/(^|-)[a-f0-9]{16}$/', $slug ) ) { $slug = ''; }
	return home_url( '/live/' . $handle . '/' . ( '' !== $slug ? $slug . '-' : '' ) . $stream_id . '/' );
}

/* THE choke point for every live watch URL (canonical, og:url, BroadcastEvent, sitemap, IndexNow, notifications,
   autopost). WPCode #7347 declares it inside function_exists(), so this earlier definition wins. Classic output is
   byte-identical to #7347's whenever the mode is not 'on' or a pretty URL cannot be built. */
if ( ! function_exists( 'sml_scheduled_live_watch_url' ) ) {
	function sml_scheduled_live_watch_url( $handle, $stream_id = '' ) {
		static $busy = false;
		$handle    = sanitize_key( (string) $handle );
		$stream_id = sml_cu_clean_stream_id( $stream_id );
		if ( ! $handle ) { return home_url( '/live/' ); }
		if ( $stream_id && ! $busy && 'on' === sml_cu_mode() ) {
			$busy = true;
			try { $pretty = sml_cu_live_pretty_url( $handle, $stream_id ); } catch ( \Throwable $e ) { $pretty = ''; }
			$busy = false;
			if ( '' !== $pretty ) { return $pretty; }
		}
		$args = array( 'room' => $handle );
		if ( $stream_id ) { $args['stream'] = $stream_id; }
		return add_query_arg( $args, home_url( '/live/' ) );
	}
}

/* ---------------------------------------------------------- 3. redirects */

function sml_cu_redirect( $url ) {
	$code = (int) ( function_exists( 'get_option' ) ? get_option( 'sml_cu_redirect_code', 302 ) : 302 );
	$code = ( 301 === $code ) ? 301 : 302;
	if ( ! empty( $GLOBALS['sml_cu_test'] ) ) { $GLOBALS['sml_cu_test_redirect'] = array( $url, $code ); return; }
	if ( headers_sent() ) { return; }
	if ( ! defined( 'DONOTCACHEPAGE' ) ) { define( 'DONOTCACHEPAGE', true ); }
	if ( function_exists( 'batcache_cancel' ) ) { batcache_cancel(); }
	nocache_headers(); // targets depend on mutable state (title, current handle): never let the edge pin one
	wp_redirect( $url, $code, 'SML Clean URLs' );
	exit;
}

function sml_cu_with_query( $url, $query, $drop = array() ) {
	parse_str( (string) $query, $args );
	$args = is_array( $args ) ? $args : array();
	foreach ( $drop as $k ) { unset( $args[ $k ] ); }
	if ( ! $args ) { return $url; }
	return $url . ( false === strpos( $url, '?' ) ? '?' : '&' ) . http_build_query( $args, '', '&' );
}

function sml_cu_route() {
	$ctx = sml_cu_ctx();
	if ( '' === $ctx['kind'] ) { return; }
	if ( empty( $GLOBALS['sml_cu_test'] ) ) {
		if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'WP_CLI' ) && WP_CLI ) ) { return; }
	}
	$mode = sml_cu_mode();
	$here = rtrim( $ctx['path'], '/' ) . '/';

	if ( 'vod' === $ctx['kind'] ) {
		if ( 'on' !== $mode && ! $ctx['alias'] ) { return; }
		$lib = function_exists( 'get_option' ) ? get_option( 'sml_video_upload_studio_library', array() ) : array(); // filtered: watch_url is canonical
		$key = sanitize_key( $ctx['id'] );
		if ( ! is_array( $lib ) || empty( $lib[ $key ] ) || ! is_array( $lib[ $key ] ) ) { return; } // unknown id: let it 404 on its own
		$target = (string) ( $lib[ $key ]['watch_url'] ?? '' );
		if ( '' === $target ) { $target = home_url( '/watch/' . rawurlencode( $key ) . '/' ); }
		$tpath = (string) wp_parse_url( $target, PHP_URL_PATH );
		if ( '' === $tpath || $tpath === $here ) { return; }
		sml_cu_redirect( sml_cu_with_query( $target, $ctx['query'] ) );
		return;
	}

	/* live */
	$handle = $ctx['handle'];
	$uid    = sml_cu_live_user_id( $handle );

	if ( $ctx['idless'] ) { // id-less pretty form: /live/{handle}/{slug}/
		/* People type the nicename (it is the OBS share URL) as often as the public handle. Send them to the creator's
		   canonical handle in ONE hop — but only when that handle resolves back to the same user (dotted and duplicated
		   handles do not, and a room that cannot resolve is worse than a non-canonical one). */
		if ( $uid && function_exists( 'sml_scheduled_live_handle_for_user' ) ) {
			$canon = (string) sml_scheduled_live_handle_for_user( $uid );
			if ( '' !== $canon && sml_cu_live_user_id( $canon ) === $uid ) { $handle = $canon; }
		}
		$found = '';
		if ( $uid && function_exists( 'sml_scheduled_live_library' ) ) {
			$rank = array( 'live' => 0, 'scheduled' => 1, 'ended' => 2 );
			$best = 99;
			foreach ( (array) sml_scheduled_live_library( $uid ) as $rid => $row ) {
				if ( ! sml_cu_stream_is_public( $row ) ) { continue; } // never an oracle for a private title, never hands out a secret id
				$st = (string) ( $row['status'] ?? '' );
				if ( ! isset( $rank[ $st ] ) ) { continue; }
				if ( sml_cu_slug( (string) ( $row['title'] ?? '' ), (string) ( $row['ticker'] ?? '' ) ) !== $ctx['slug'] ) { continue; }
				if ( $rank[ $st ] < $best ) { $best = $rank[ $st ]; $found = sml_cu_clean_stream_id( $row['id'] ?? $rid ); }
			}
		}
		if ( '' !== $found ) {
			$url = sml_cu_live_pretty_url( $handle, $found );
			if ( '' === $url ) { $url = add_query_arg( array( 'room' => $handle, 'stream' => $found ), home_url( '/live/' ) ); }
			sml_cu_redirect( sml_cu_with_query( $url, $ctx['query'], array( 'room', 'stream', 's' ) ) );
			return;
		}
		if ( $uid ) { // a real creator, but no stream by that name: their room
			sml_cu_redirect( sml_cu_with_query( add_query_arg( array( 'room' => $handle ), home_url( '/live/' ) ), $ctx['query'], array( 'room', 'stream', 's' ) ) );
			return;
		}
		sml_cu_undo_rewrite(); // not a creator at all: 404 exactly as before this layer existed
		return;
	}

	if ( 'on' !== $mode || '' === $ctx['id'] ) { return; }

	$row = sml_cu_live_row( $uid, $ctx['id'] );
	if ( empty( $row ) ) { // the handle may have been renamed since the link was made: find the owner by stream id
		$owner = sml_cu_find_stream_owner( $ctx['id'] );
		if ( $owner && $owner !== $uid ) { $uid = $owner; $row = sml_cu_live_row( $uid, $ctx['id'] ); }
	}
	if ( empty( $row ) || ! function_exists( 'sml_scheduled_live_handle_for_user' ) ) { return; }
	$current = (string) sml_scheduled_live_handle_for_user( $uid );
	$target  = sml_cu_live_pretty_url( '' !== $current ? $current : $handle, $ctx['id'], $row );
	if ( '' === $target ) { return; }
	/* Never redirect to a URL the SOURCE would not emit. For a creator whose handle does not round-trip (a dot that
	   sanitize_key strips, or a handle two users share) the builder stays classic; redirecting anyway would leave the
	   sitemap and canonical pointing at a URL that 302s. */
	if ( $target !== sml_scheduled_live_watch_url( '' !== $current ? $current : $handle, $ctx['id'] ) ) { return; }
	$tpath = (string) wp_parse_url( $target, PHP_URL_PATH );
	if ( '' === $tpath || $tpath === $here ) { return; }
	sml_cu_redirect( sml_cu_with_query( $target, $ctx['query'], array( 'room', 'stream', 's' ) ) );
}
add_action( 'init', 'sml_cu_route', -10000 );

function sml_cu_find_stream_owner( $stream_id ) {
	global $wpdb;
	if ( ! preg_match( '/^[a-f0-9]{16}$/', (string) $stream_id ) || ! is_object( $wpdb ) ) { return 0; }
	$lib = function_exists( 'sml_scheduled_live_library_key' ) ? sml_scheduled_live_library_key() : '_sml_scheduled_live_library';
	$cur = function_exists( 'sml_scheduled_live_meta_key' ) ? sml_scheduled_live_meta_key() : '_sml_scheduled_live';
	return (int) $wpdb->get_var( $wpdb->prepare( // meta_key equality uses the usermeta index; only creators have these rows
		"SELECT user_id FROM {$wpdb->usermeta} WHERE meta_key IN ( %s, %s ) AND meta_value LIKE %s LIMIT 1",
		$lib, $cur, '%' . $wpdb->esc_like( '"' . $stream_id . '"' ) . '%'
	) );
}

/* WordPress must not second-guess a request this layer answered, and must not "guess" a news article for a dead watch/live link. */
add_filter( 'redirect_canonical', function ( $redirect ) {
	$ctx = sml_cu_ctx();
	return $ctx['rewrote'] ? false : $redirect;
}, 1 );
add_filter( 'do_redirect_guess_404_permalink', function ( $do ) {
	$uri = (string) ( $_SERVER['SML_CU_ORIG_REQUEST_URI'] ?? ( $_SERVER['REQUEST_URI'] ?? '' ) );
	return preg_match( '#^/(?:watch|video|live)/#', $uri ) ? false : $do;
} );

/* --------------------------------------------- live page: tell the client */

/* js/live-watch.js and js/stream-countdown.js read the room and stream from location.search, which is EMPTY on a
   pretty URL — without this every pretty live page would boot as the default room and send paid Super Chats to it. */
function sml_cu_live_client_config() {
	$ctx = sml_cu_ctx();
	if ( 'live' !== $ctx['kind'] || '' === $ctx['handle'] ) { return ''; }
	$cfg = array( 'handle' => $ctx['handle'], 'stream' => $ctx['id'], 'url' => sml_scheduled_live_watch_url( $ctx['handle'], $ctx['id'] ) );
	$js  = 'window.SML_LW_ROOM=' . wp_json_encode( $cfg, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES ) . ';'
		. 'window.SML_CD_HANDLE=window.SML_LW_ROOM.handle;window.SML_CD_STREAM=window.SML_LW_ROOM.stream;';
	return '<script id="sml-cu-live-room">' . $js . '</script>';
}
add_action( 'init', function () {
	$ctx = sml_cu_ctx();
	if ( 'live' !== $ctx['kind'] || is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'WP_CLI' ) && WP_CLI ) ) { return; }
	/* started before WPCode #7044's init:0 buffer, so this one is OUTER and sees the finished document */
	ob_start( function ( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '<head' ) || false !== strpos( $html, 'id="sml-cu-live-room"' ) ) { return $html; }
		$tag = sml_cu_live_client_config();
		if ( '' === $tag ) { return $html; }
		$out = preg_replace_callback( '/<head(\s[^>]*)?>/i', function ( $m ) use ( $tag ) { return $m[0] . "\n" . $tag; }, $html, 1 );
		return is_string( $out ) ? $out : $html;
	} );
}, -9999 );

/* WPCode #7358 sets the canonical of any /live/?room= page to the creator's CURRENT stream at PHP_INT_MAX, which can
   override sml-google-sitemaps' per-stream answer (live -> itself, ended -> its recording). When a stream is named, keep
   the per-stream answer WHEN THERE IS ONE: if sitemaps left the value alone (ended with no recording, cancelled,
   non-public, unknown) #7358's value passes through exactly as it does today — otherwise those pages would all
   canonicalise to the bare /live/ hub. (#7358's og:url/title still describe the current stream on an older stream's
   page; that is in the snippet itself and is a follow-up there, not something this layer can fix.) */
add_action( 'wp', function () {
	$ctx = sml_cu_ctx();
	if ( 'live' !== $ctx['kind'] || '' === $ctx['id'] || 'on' !== sml_cu_mode() ) { return; }
	$before = null; $seen = null;
	add_filter( 'rank_math/frontend/canonical', function ( $c ) use ( &$before ) { $before = $c; return $c; }, 19 ); // just before sml-google-sitemaps (20)
	add_filter( 'rank_math/frontend/canonical', function ( $c ) use ( &$seen ) { $seen = $c; return $c; }, 21 );     // just after it
	add_filter( 'rank_math/frontend/canonical', function ( $c ) use ( &$seen, &$before ) {                            // registered after #7358's, so it runs after it
		return ( is_string( $seen ) && '' !== $seen && $seen !== $before ) ? $seen : $c;
	}, PHP_INT_MAX );
}, PHP_INT_MAX );

/* Group portals only accept one-segment /watch/ links in chat; the pretty form has two. */
add_filter( 'sml_portal_allowed_internal_url', function ( $allowed, $url = '', $parts = array() ) {
	if ( $allowed ) { return $allowed; }
	$path = '/' . ltrim( (string) ( is_array( $parts ) ? ( $parts['path'] ?? '' ) : '' ), '/' );
	return (bool) preg_match( '#^/watch/[A-Za-z0-9_-]{8,32}/[a-z0-9-]{1,200}/?$#i', $path );
}, 10, 3 );

/* ------------------------------------------------------------------ boot */

/* Never let a URL nicety take the site down: this runs before WordPress has finished loading. */
if ( 'cli' !== PHP_SAPI && ! ( defined( 'WP_CLI' ) && WP_CLI ) && ! defined( 'SML_CU_DISABLE' ) ) {
	try { sml_cu_rewrite_request(); } catch ( \Throwable $e ) { /* leave the request untouched */ }
}

} // function_exists( 'sml_cu_ctx' )
