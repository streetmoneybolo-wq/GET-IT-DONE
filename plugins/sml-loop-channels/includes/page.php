<?php
/**
 * The channel page. Takes /channel/{handle}/ before WordPress falls into the theme's
 * 404 route (which is how the legacy loader works: a 520 KB 404 page, hidden by CSS,
 * with the channel built on top by script). This prints a small document instead:
 * the channel painted server-side, search metadata, the legacy app mounted on it with
 * every API response it needs already inlined, and the creator's design applied.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_lc_requested_handle() {
	$path = (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH );
	return preg_match( '#^/channel/([A-Za-z0-9_.]+)/?$#', $path, $m ) ? strtolower( $m[1] ) : '';
}

add_action( 'template_redirect', 'sml_lc_route', -5 );
function sml_lc_route() {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return; }
	if ( isset( $_GET['ch'] ) && '0' === $_GET['ch'] ) { return; }   /* the legacy escape hatch still works */
	if ( isset( $_GET['lc'] ) && '0' === $_GET['lc'] ) { return; }   /* and one for this layer */
	if ( ! function_exists( 'sml_channel_user_by_handle' ) || ! function_exists( 'sml_channel_settings' ) || ! function_exists( 'sml_channel_profile' ) ) { return; }
	$handle = sml_lc_requested_handle();
	if ( '' === $handle ) { return; }
	$user = sml_channel_user_by_handle( $handle );
	if ( ! $user ) { return; } /* not a channel: the legacy loader and the theme decide (404 or admin preview) */
	sml_lc_render( $user, $handle );
}

/** Runs a REST route inside this request. Far cheaper than the browser calling it: no second WordPress boot. */
function sml_lc_internal( $route, $params = array() ) {
	$t = microtime( true );
	$req = new WP_REST_Request( 'GET', $route );
	foreach ( $params as $k => $v ) { $req->set_param( $k, $v ); }
	$res = rest_do_request( $req );
	if ( is_wp_error( $res ) || ! ( $res instanceof WP_REST_Response ) || $res->get_status() >= 400 ) { return array( null, round( ( microtime( true ) - $t ) * 1000 ) ); }
	return array( rest_get_server()->response_to_data( $res, false ), round( ( microtime( true ) - $t ) * 1000 ) );
}

function sml_lc_letters( $user_id, $limit = 6 ) {
	global $wpdb;
	if ( ! function_exists( 'sml_letters_table' ) ) { return array(); }
	$t = sml_letters_table( 'posts' );
	$rows = (array) $wpdb->get_results( $wpdb->prepare( "SELECT id, author_id, slug, title, subtitle, read_minutes, published_at, cover_url FROM $t WHERE author_id = %d AND status = 'published' AND visibility = 'public' ORDER BY published_at DESC LIMIT %d", (int) $user_id, (int) $limit ), ARRAY_A );
	foreach ( $rows as &$r ) { $r['url'] = function_exists( 'sml_lls_letter_url' ) ? sml_lls_letter_url( $r ) : home_url( '/n/' . sanitize_title( get_userdata( $user_id )->display_name ) . '/' . $r['slug'] . '/' ); }
	return $rows;
}

function sml_lc_render( $user, $handle ) {
	$t0        = microtime( true );
	$uid       = (int) $user->ID;
	$viewer    = get_current_user_id();
	$is_owner  = $viewer && ( $viewer === $uid || user_can( $viewer, 'manage_options' ) );
	$design    = sml_lc_get( $uid );
	$settings  = sml_channel_settings( $uid );
	$profile   = sml_channel_profile( $user );
	$name      = $profile['name'] ?: $user->display_name;
	$profile_h = function_exists( 'sml_channel_profile_handle_for_user' ) ? sml_channel_profile_handle_for_user( $uid ) : '';
	$canonical = home_url( '/channel/' . $handle . '/' );

	/* the data the app will ask for, answered now */
	$pre = array(); $timing = array();
	list( $channel, $ms ) = sml_lc_internal( '/sml-channel/v1/channel/' . $handle ); $timing['channel'] = $ms;
	if ( $channel ) { $pre[ '/sml-channel/v1/channel/' . $handle ] = $channel; }
	$videos = is_array( $channel['videos'] ?? null ) ? $channel['videos'] : array();
	$posts  = is_array( $channel['posts'] ?? null ) ? $channel['posts'] : array();
	$stats  = is_array( $channel['stats'] ?? null ) ? $channel['stats'] : array( 'videos' => count( $videos ), 'views' => 0, 'posts' => count( $posts ) );
	$budget = function () use ( $t0 ) { return ( microtime( true ) - $t0 ) < 2.2; };
	if ( $budget() ) { list( $d, $ms ) = sml_lc_internal( '/sml-channel/v1/channel/' . $handle . '/community' ); $timing['community'] = $ms; if ( $d !== null ) { $pre[ '/sml-channel/v1/channel/' . $handle . '/community' ] = $d; } }
	if ( $profile_h && $budget() ) { list( $d, $ms ) = sml_lc_internal( '/sml-live/v1/feeds/' . $profile_h ); $timing['feeds'] = $ms; if ( $d !== null ) { $pre[ '/sml-live/v1/feeds/' . $profile_h ] = $d; } }
	if ( $profile_h && $budget() ) { list( $d, $ms ) = sml_lc_internal( '/sml-lb/v1/card/' . $profile_h ); $timing['card'] = $ms; if ( $d !== null ) { $pre[ '/sml-lb/v1/card/' . $profile_h ] = $d; } }
	if ( $profile_h && $budget() ) { list( $d, $ms ) = sml_lc_internal( '/sml-loopletters/v1/issues', array( 'handle' => $profile_h ) ); $timing['issues'] = $ms; if ( $d !== null ) { $pre[ '/sml-loopletters/v1/issues?handle=' . $profile_h ] = $d; } }
	if ( $budget() ) { list( $d, $ms ) = sml_lc_internal( '/sml-playlists/v1/channel', array( 'handle' => $handle ) ); $timing['playlists'] = $ms; if ( $d !== null ) { $pre[ '/sml-playlists/v1/channel?handle=' . $handle ] = $d; } }
	$live = ! empty( $pre[ '/sml-live/v1/feeds/' . $profile_h ]['live'] );
	$letters = sml_lc_letters( $uid, 6 );

	/* search metadata */
	$title = $design['seo']['title'] ?: ( $name . ' (@' . $handle . ') · Loop Channel' );
	$desc  = $design['seo']['description'] ?: ( $profile['tagline'] ?: ( $profile['about'] ? wp_trim_words( $profile['about'], 28, '…' ) : ( $name . ' on Stock Market Loop: live streams, videos, market letters and community posts.' ) ) );
	$desc  = mb_substr( trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( $desc ) ) ), 0, 160 );
	$image = $design['banner']['mode'] === 'image' && $design['banner']['url'] ? $design['banner']['url'] : ( $profile['banner'] ?: ( $profile['backdrop'] ?: ( $profile['avatar'] ?: ( $pre[ '/sml-lb/v1/card/' . $profile_h ]['profile']['photo'] ?? '' ) ) ) );
	$indexable = empty( $design['seo']['noindex'] );
	$same = array();
	foreach ( (array) ( $profile['links'] ?? array() ) as $k => $v ) { if ( ! $v ) { continue; } if ( preg_match( '#^https?://#i', $v ) ) { $same[] = $v; } elseif ( $k === 'x' ) { $same[] = 'https://x.com/' . ltrim( $v, '@' ); } elseif ( $k === 'youtube' ) { $same[] = 'https://youtube.com/@' . ltrim( $v, '@' ); } else { $same[] = 'https://' . $v; } }
	if ( $profile_h ) { $same[] = home_url( '/' . $profile_h . '/' ); }
	$person = array( '@type' => 'Person', '@id' => $canonical . '#creator', 'name' => $name, 'alternateName' => '@' . $handle, 'url' => $canonical, 'description' => $desc );
	if ( $profile['avatar'] ) { $person['image'] = $profile['avatar']; }
	if ( $same ) { $person['sameAs'] = array_values( array_unique( $same ) ); }
	$graph = array(
		array( '@type' => 'ProfilePage', '@id' => $canonical, 'url' => $canonical, 'name' => $title, 'description' => $desc, 'mainEntity' => array( '@id' => $canonical . '#creator' ), 'dateModified' => $design['updated_at'] ?: gmdate( 'c' ), 'isPartOf' => array( '@type' => 'WebSite', 'name' => get_bloginfo( 'name' ), 'url' => home_url( '/' ) ) ),
		$person,
	);
	if ( $videos ) {
		$items = array();
		foreach ( array_slice( $videos, 0, 12 ) as $i => $v ) { $items[] = array( '@type' => 'ListItem', 'position' => $i + 1, 'item' => array_filter( array( '@type' => 'VideoObject', 'name' => $v['title'], 'url' => $v['watch_url'], 'thumbnailUrl' => $v['thumbnail'], 'uploadDate' => $v['created_at'] ?: null, 'description' => $v['description'] ?: $v['title'] ) ) ); }
		$graph[] = array( '@type' => 'ItemList', 'name' => 'Latest videos from ' . $name, 'itemListElement' => $items );
	}
	$graph[] = array( '@type' => 'BreadcrumbList', 'itemListElement' => array( array( '@type' => 'ListItem', 'position' => 1, 'name' => get_bloginfo( 'name' ), 'item' => home_url( '/' ) ), array( '@type' => 'ListItem', 'position' => 2, 'name' => 'Loop Channels', 'item' => home_url( '/watch/' ) ), array( '@type' => 'ListItem', 'position' => 3, 'name' => $name, 'item' => $canonical ) ) );

	/* headers: anonymous pages are shared by the edge for five minutes */
	status_header( 200 );
	nocache_headers(); header_remove( 'Expires' ); header_remove( 'Pragma' );
	header( 'Content-Type: text/html; charset=' . get_bloginfo( 'charset' ) );
	header( 'Cache-Control: ' . ( $viewer ? 'private, no-cache' : 'public, max-age=60, s-maxage=300, stale-while-revalidate=900, stale-if-error=3600' ) );
	header( 'X-Robots-Tag: ' . ( $indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow' ) );
	header( 'X-SML-Loop-Channels: ' . SML_LC_VERSION . '; preload=' . implode( ',', array_map( function ( $k, $v ) { return $k . ':' . $v; }, array_keys( $timing ), $timing ) ) );
	$GLOBALS['sml_lc_final'] = array( 'robots' => '<meta name="robots" content="' . ( $indexable ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' : 'noindex, follow' ) . '">', 'canonical' => '<link rel="canonical" href="' . esc_url( $canonical ) . '">' );

	$cdn = function_exists( 'sml_ch_loader_ref' ) ? 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . sml_ch_loader_ref() . '/' : 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@main/';
	$fx_url = function_exists( 'sml_lls_asset' ) ? sml_lls_asset( 'letter-fx.js' ) : '';

	echo '<!doctype html><html ' . get_language_attributes() . ' class="lc-html"><head><meta charset="' . esc_attr( get_bloginfo( 'charset' ) ) . '"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
	if ( function_exists( 'sml_ds_early_html' ) ) { echo sml_ds_early_html(); } // phpcs:ignore
	echo '<title>' . esc_html( $title ) . '</title>';
	echo '<meta name="description" content="' . esc_attr( $desc ) . '">';
	echo $GLOBALS['sml_lc_final']['canonical'] . $GLOBALS['sml_lc_final']['robots']; // phpcs:ignore
	echo '<meta property="og:type" content="profile"><meta property="og:site_name" content="' . esc_attr( get_bloginfo( 'name' ) ) . '"><meta property="og:url" content="' . esc_url( $canonical ) . '"><meta property="og:title" content="' . esc_attr( $title ) . '"><meta property="og:description" content="' . esc_attr( $desc ) . '">';
	if ( $image ) { echo '<meta property="og:image" content="' . esc_url( $image ) . '"><meta name="twitter:image" content="' . esc_url( $image ) . '">'; }
	echo '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' . esc_attr( $title ) . '"><meta name="twitter:description" content="' . esc_attr( $desc ) . '">';
	if ( $profile_h && function_exists( 'sml_lls_publication_url' ) && $letters ) { echo '<link rel="alternate" type="application/rss+xml" title="' . esc_attr( $name . ' letters' ) . '" href="' . esc_url( add_query_arg( 'feed', 'rss', sml_lls_publication_url( $uid ) ) ) . '">'; }
	echo '<script type="application/ld+json">' . wp_json_encode( array( '@context' => 'https://schema.org', '@graph' => $graph ), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . '</script>';
	echo '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin><link rel="preload" as="style" href="' . esc_url( $cdn . 'css/loop-channel.css' ) . '"><link rel="preload" as="script" href="' . esc_url( $cdn . 'js/loop-channel.js' ) . '">';
	if ( function_exists( 'sml_ds_head_html' ) ) { echo sml_ds_head_html(); } // phpcs:ignore
	else { echo '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Archivo:wght@700;800&family=IBM+Plex+Mono:wght@500;600&display=swap">'; }
	echo sml_lc_font_link( $design, $settings ); // phpcs:ignore
	echo '<link rel="stylesheet" id="sml-lc-css" href="' . esc_url( sml_lc_asset( 'channel.css' ) ) . '">';
	echo '<style id="sml-lc-vars">' . sml_lc_vars_css( $design, $settings ) . '</style>'; // phpcs:ignore
	if ( $image ) { echo '<link rel="preload" as="image" href="' . esc_url( $image ) . '" fetchpriority="high">'; }
	echo '<meta name="theme-color" content="' . esc_attr( sml_lc_presets()[ $design['preset'] ]['bg'] ?? '#04060a' ) . '">';
	echo '</head>';

	$classes = array_merge( array( 'lc-page', 'sml-ds', 'sml-global-header-on' ), sml_lc_body_classes( $design ) );
	echo '<body class="' . esc_attr( implode( ' ', $classes ) ) . '">';

	/* page background and banner are placed by the script once the app has mounted; both also exist here for first paint and crawlers */
	echo sml_lc_background_html( $design ); // phpcs:ignore

	/* server-painted channel: visible until the app replaces it, and what crawlers read */
	echo '<main id="sml-lc-ssr" class="lc-ssr">';
	echo sml_lc_banner_html( $design, $name, $profile ); // phpcs:ignore
	echo '<div class="lc-wrap"><aside class="lc-side"><section class="lc-id">';
	echo $profile['avatar'] ? '<img class="lc-avatar" src="' . esc_url( $profile['avatar'] ) . '" alt="' . esc_attr( $name ) . '" width="112" height="112">' : '<div class="lc-avatar lc-avatar-blank">' . esc_html( mb_strtoupper( mb_substr( $handle, 0, 2 ) ) ) . '</div>';
	if ( $live ) { echo '<span class="lc-live">LIVE</span>'; }
	echo '<h1 class="lc-name">' . esc_html( $name ) . '</h1><span class="lc-handle">@' . esc_html( $handle ) . '</span>';
	if ( $profile['tagline'] ) { echo '<p class="lc-tagline">' . esc_html( $profile['tagline'] ) . '</p>'; }
	echo '<div class="lc-stats"><div><b>' . esc_html( number_format_i18n( (int) ( $stats['videos'] ?? 0 ) ) ) . '</b><span>Videos</span></div><div><b>' . esc_html( number_format_i18n( (int) ( $stats['views'] ?? 0 ) ) ) . '</b><span>Loop views</span></div><div><b>' . esc_html( number_format_i18n( (int) ( $stats['posts'] ?? 0 ) ) ) . '</b><span>Posts</span></div></div>';
	if ( $profile_h ) { echo '<a class="lc-btn" href="' . esc_url( home_url( '/' . $profile_h . '/' ) ) . '">Profile</a>'; }
	echo '</section>';
	$links = array_filter( (array) ( $profile['links'] ?? array() ) );
	if ( $links ) { echo '<section class="lc-card"><h2>Links</h2><ul class="lc-links">'; foreach ( $links as $k => $v ) { $href = preg_match( '#^https?://#i', $v ) ? $v : ( $k === 'x' ? 'https://x.com/' . ltrim( $v, '@' ) : ( $k === 'youtube' ? 'https://youtube.com/@' . ltrim( $v, '@' ) : 'https://' . $v ) ); echo '<li><a href="' . esc_url( $href ) . '" rel="noopener me" target="_blank">' . esc_html( $k === 'x' ? 'X' : ( $k === 'youtube' ? 'YouTube' : 'Website' ) ) . '</a></li>'; } echo '</ul></section>'; }
	if ( ! empty( $settings['home_group']['url'] ) ) { echo '<section class="lc-card"><h2>Home group</h2><a class="lc-btn lc-btn-ghost" href="' . esc_url( $settings['home_group']['url'] ) . '">' . esc_html( $settings['home_group']['name'] ?: 'Open the group' ) . '</a></section>'; }
	echo '</aside><div class="lc-main">';
	if ( $videos ) {
		echo '<section class="lc-sec" id="sml-lc-orbit"><h2>Latest videos</h2><div class="lc-grid">';
		foreach ( array_slice( $videos, 0, 8 ) as $i => $v ) { echo '<a class="lc-video" href="' . esc_url( $v['watch_url'] ) . '"><img src="' . esc_url( $v['thumbnail'] ) . '" alt="" loading="' . ( $i < 2 ? 'eager' : 'lazy' ) . '" decoding="async" width="320" height="180">' . ( $v['duration'] ? '<i>' . esc_html( $v['duration'] ) . '</i>' : '' ) . '<b>' . esc_html( $v['title'] ) . '</b><span>' . esc_html( $v['views_label'] ?? '' ) . '</span></a>'; }
		echo '</div></section>';
	}
	if ( $letters ) {
		echo '<section class="lc-sec" id="sml-lc-nl"><h2>Letters</h2><div class="lc-list">';
		foreach ( $letters as $l ) { echo '<a class="lc-row" href="' . esc_url( $l['url'] ) . '"><b>' . esc_html( $l['title'] ) . '</b><span>' . esc_html( date_i18n( 'M j, Y', strtotime( $l['published_at'] . ' UTC' ) ) ) . ' · ' . (int) max( 1, $l['read_minutes'] ) . ' min read</span></a>'; }
		echo '</div></section>';
	}
	if ( $posts ) {
		echo '<section class="lc-sec" id="sml-lc-community"><h2>Posts</h2><div class="lc-list">';
		foreach ( array_slice( $posts, 0, 6 ) as $p ) { echo '<a class="lc-row" href="' . esc_url( $p['url'] ?: $canonical ) . '"><b>' . esc_html( $p['title'] ?: wp_trim_words( $p['body'] ?? '', 14, '…' ) ) . '</b><span>' . esc_html( $p['date'] ? date_i18n( 'M j, Y', strtotime( $p['date'] ) ) : '' ) . '</span></a>'; }
		echo '</div></section>';
	}
	if ( $profile['about'] ) { echo '<section class="lc-sec" id="sml-lc-about"><h2>About</h2><p class="lc-about">' . nl2br( esc_html( $profile['about'] ) ) . '</p></section>'; }
	echo '</div></div></main>';

	/* the channel app, mounted exactly as the legacy loader mounts it, so its pinned CSS and script keep working */
	$ME = array( 'id' => $viewer, 'handle' => $viewer ? sanitize_key( (string) get_user_meta( $viewer, 'sml_channel_handle', true ) ) : '' );
	echo '<link rel="stylesheet" id="sml-ch-css" href="' . esc_url( $cdn . 'css/loop-channel.css' ) . '">';
	$themed = sml_lc_themed_css( $design['preset'] );
	if ( $themed ) { echo '<style id="sml-lc-theme">' . $themed . '</style>'; } // phpcs:ignore
	echo '<script>window.SML_CH_ADMIN=' . ( current_user_can( 'manage_options' ) ? 1 : 0 ) . ';window.SML_CH_NONCE=' . wp_json_encode( wp_create_nonce( 'wp_rest' ) ) . ';window.SML_CH_ME=' . wp_json_encode( $ME ) . ';';
	echo 'window.SML_LC=' . wp_json_encode( array(
		'version' => SML_LC_VERSION, 'handle' => $handle, 'uid' => $uid, 'owner' => $is_owner, 'base' => esc_url_raw( rest_url( SML_LC_NS ) ), 'nonce' => wp_create_nonce( 'wp_rest' ),
		'design' => $design, 'presets' => sml_lc_presets(), 'fonts' => sml_lc_fonts(), 'sections' => sml_lc_sections(), 'preload' => $pre, 'name' => $name, 'accent' => $settings['accent'] ?? '#00ff88',
		'fx' => $fx_url, 'tickers' => array_values( array_unique( array_filter( array_map( function ( $v ) { return strtoupper( ltrim( (string) ( $v['ticker'] ?? '' ), '$' ) ); }, $videos ) ) ) ),
	) ) . ';</script>';
	echo '<script src="' . esc_url( sml_lc_asset( 'channel.js' ) ) . '"></script>'; /* before the app: it shims fetch with the preloaded answers */
	echo '<div id="sml-ch-root" aria-label="Loop Channel"></div>';
	echo '<script id="sml-ch-js" src="' . esc_url( $cdn . 'js/loop-channel.js' ) . '"></script>';
	if ( function_exists( 'sml_ds_footer_html' ) ) { echo sml_ds_footer_html(); } // phpcs:ignore
	echo '</body></html>';
	exit;
}

function sml_lc_background_html( $design ) {
	$bg = $design['background'];
	if ( $bg['mode'] === 'none' ) { return '<div id="sml-lc-bg" class="lc-bg" aria-hidden="true" hidden></div>'; }
	$inner = '';
	$src = $bg['mode'] === 'banner' ? ( $design['banner']['url'] ?? '' ) : $bg['url'];
	if ( ( $bg['mode'] === 'image' || $bg['mode'] === 'banner' ) && $src ) { $inner = '<div class="lc-bg-media" style="background-image:url(' . esc_url( $src ) . ')"></div>'; }
	elseif ( $bg['mode'] === 'video' && $src ) { $inner = '<video class="lc-bg-media" autoplay muted loop playsinline preload="metadata" src="' . esc_url( $src ) . '"></video>'; }
	elseif ( $bg['mode'] === 'pattern' ) { $inner = '<div class="lc-bg-media lc-pattern-' . esc_attr( $bg['pattern'] ) . '"></div>'; }
	return '<div id="sml-lc-bg" class="lc-bg lc-bg-' . esc_attr( $bg['mode'] ) . '" aria-hidden="true">' . $inner . '<div class="lc-bg-dim"></div><canvas id="lls-fx-canvas" class="lc-fx-canvas"></canvas></div>';
}

function sml_lc_banner_html( $design, $name, $profile ) {
	$b = $design['banner'];
	if ( $b['mode'] === 'none' ) { return ''; }
	$inner = '';
	if ( $b['mode'] === 'image' && $b['url'] ) { $inner = '<img class="lc-banner-media" src="' . esc_url( $b['url'] ) . '" alt="" fetchpriority="high" decoding="async">'; }
	elseif ( $b['mode'] === 'video' && $b['url'] ) { $inner = '<video class="lc-banner-media" autoplay muted loop playsinline preload="auto"' . ( $b['poster'] ? ' poster="' . esc_url( $b['poster'] ) . '"' : '' ) . ' src="' . esc_url( $b['url'] ) . '"></video>'; }
	elseif ( $b['mode'] === 'gradient' ) { $inner = '<div class="lc-banner-media lc-banner-gradient"></div>'; }
	$text = '';
	if ( ! empty( $b['overlay'] ) ) { $text = '<div class="lc-banner-text"><b>' . esc_html( $b['title'] ?: $name ) . '</b>' . ( $b['subtitle'] || $profile['tagline'] ? '<span>' . esc_html( $b['subtitle'] ?: $profile['tagline'] ) . '</span>' : '' ) . '</div>'; }
	return '<div id="sml-lc-banner" class="lc-banner lc-banner-' . esc_attr( $b['height'] ) . '">' . $inner . '<div class="lc-banner-fade"></div>' . $text . '</div>';
}

/* Other layers rewrite robots tags after the page prints; the outermost buffer puts ours back. */
add_action( 'plugins_loaded', function () {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return; }
	if ( ! preg_match( '#^/channel/[A-Za-z0-9_.]+/?$#', (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ) ) ) { return; }
	ob_start( function ( $html ) {
		if ( ! is_string( $html ) || empty( $GLOBALS['sml_lc_final'] ) || strpos( $html, 'sml-lc-ssr' ) === false ) { return $html; }
		$f = $GLOBALS['sml_lc_final'];
		$html = preg_replace( '#<meta[^>]+name=["\']?robots["\']?[^>]*>\s*#i', '', $html );
		$html = preg_replace( '#<link[^>]+rel=["\']canonical["\'][^>]*>\s*#i', '', $html );
		/* the legacy loader's own buffer appends its markup again when it cannot see the root; strip a second mount if one slipped in */
		$pos = stripos( $html, '</head>' );
		return $pos === false ? $html : substr( $html, 0, $pos ) . $f['robots'] . $f['canonical'] . substr( $html, $pos );
	} );
}, 1 );
