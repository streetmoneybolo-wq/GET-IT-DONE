<?php
/**
 * Plugin Name: SML Creator Videos tab (mu)
 * Description: /creator-studio/videos/ — every Loop Channel video the creator owns with its metadata (title, SEO title, description, ticker, tags, hashtags, visibility, duration, thumbnail, published/updated), real performance (views, 7-day views, impressions, click-through, comments, likes) and an SEO audit per video (title/description/keyword/tags/thumbnail/indexability/video sitemap/VideoObject schema on the watch page) with a score, fixes, inline metadata editing, Google/Bing index checks and a "Request indexing" ping (IndexNow + the sitemap pinger). Owner call 2026-09-10.
 * Version: 1.3.0
 * Author: StockMarketLoop
 *
 * 1.3.0 (2026-09-22): thumbnail editing (upload an image or pick a frame from the video) via POST /thumbnail — the upload
 * studio had no way to change a thumbnail after publishing. Removed-video redirects: option sml_cv_redirects {old_id: kept_id}
 * 301s /watch/{old_id}/… (and /video/…) to the kept video, only while old_id is no longer in the library.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

const SML_CV_NS = 'sml-creator-videos/v1';

function sml_cv_library(): array { return function_exists( 'sml_video_upload_studio_library' ) ? (array) sml_video_upload_studio_library() : (array) get_option( 'sml_video_upload_studio_library', array() ); }
function sml_cv_save_library( array $lib ): void { if ( function_exists( 'sml_video_upload_studio_save_library' ) ) { sml_video_upload_studio_save_library( $lib ); } else { update_option( 'sml_video_upload_studio_library', $lib, false ); } }
function sml_cv_clean( $text, int $max = 0 ): string { $t = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( html_entity_decode( (string) $text, ENT_QUOTES, 'UTF-8' ) ) ) ); return $max && mb_strlen( $t ) > $max ? mb_substr( $t, 0, $max ) : $t; }
function sml_cv_list( $v ): array { if ( is_array( $v ) ) { return array_values( array_filter( array_map( 'trim', array_map( 'strval', $v ) ) ) ); } return array_values( array_filter( array_map( 'trim', preg_split( '/[,\s]+/', (string) $v ) ) ) ); }
function sml_cv_watch_url( string $slug, array $v ): string { $u = (string) ( $v['watch_url'] ?? '' ); return $u ?: home_url( '/watch/' . rawurlencode( $slug ) . '/' ); }
function sml_cv_days( $daily, int $days ): int { if ( ! is_array( $daily ) ) { return 0; } $n = 0; $from = gmdate( 'Y-m-d', time() - $days * DAY_IN_SECONDS ); foreach ( $daily as $d => $c ) { if ( (string) $d >= $from ) { $n += (int) $c; } } return $n; }

/** Does the public watch page carry VideoObject JSON-LD? Real HTTP, cached 6 h per video (only public videos are checked). */
function sml_cv_schema_check( string $url, string $slug, bool $fresh ): array {
	$key = 'sml_cv_schema_' . md5( $slug );
	if ( ! $fresh ) { $c = get_transient( $key ); if ( is_array( $c ) ) { return $c; } }
	$out = array( 'checked' => false, 'schema' => false, 'status' => 0, 'noindex' => false, 'canonical' => '' );
	$r = wp_remote_get( $url, array( 'timeout' => 8, 'redirection' => 3, 'user-agent' => 'Mozilla/5.0 (SML Creator Studio SEO audit)', 'headers' => array( 'Cache-Control' => 'no-cache' ) ) );
	if ( ! is_wp_error( $r ) ) {
		$body = (string) wp_remote_retrieve_body( $r );
		$out['checked'] = true;
		$out['status'] = (int) wp_remote_retrieve_response_code( $r );
		$out['schema'] = false !== stripos( $body, '"VideoObject"' ) || false !== stripos( $body, "'VideoObject'" );
		$out['noindex'] = (bool) preg_match( '/<meta[^>]+name=["\']robots["\'][^>]+noindex/i', $body );
		if ( preg_match( '/<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)/i', $body, $m ) ) { $out['canonical'] = $m[1]; }
	}
	set_transient( $key, $out, 6 * HOUR_IN_SECONDS );
	return $out;
}
/** Comments + likes for a video from the real stores. */
function sml_cv_engagement( string $slug, array $v ): array {
	global $wpdb;
	$comments = count( (array) ( $v['comments'] ?? array() ) );
	$likes = 0;
	$idx = function_exists( 'sml_cc_index_id' ) ? sml_cc_index_id( $slug ) : (int) $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$wpdb->prefix}sml_video_index WHERE video_id=%s", $slug ) );
	if ( $idx ) {
		$ct = $wpdb->prefix . 'sml_reaction_comments';
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $ct ) ) ) { $comments += (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$ct} WHERE content_type='long_video' AND content_id=%d AND status='approved'", $idx ) ); }
		$rt = $wpdb->prefix . 'sml_reactions';
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $rt ) ) ) { $likes = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$rt} WHERE content_type='long_video' AND content_id=%d", $idx ) ); }
	}
	return array( 'comments' => $comments, 'likes' => $likes );
}

/** The SEO audit: every check is a real property of the record or the live page; score = passes + half for warnings. */
function sml_cv_audit( string $slug, array $v, bool $fresh ): array {
	$title = sml_cv_clean( $v['title'] ?? '' ); $seo = sml_cv_clean( $v['seo_title'] ?? '' ); $desc = sml_cv_clean( $v['description'] ?? '' );
	$ticker = strtoupper( ltrim( sml_cv_clean( $v['ticker'] ?? '' ), '$' ) ); $tags = sml_cv_list( $v['tags'] ?? array() ); $hashtags = sml_cv_list( $v['hashtags'] ?? array() );
	$vis = (string) ( $v['visibility'] ?? '' ); $sched = strtotime( (string) ( $v['schedule_at'] ?? '' ) ); $future = $sched && $sched > time();
	$thumb = (string) ( $v['thumbnail_url'] ?? '' ); $dur = (int) ( $v['duration'] ?? 0 );
	$url = sml_cv_watch_url( $slug, $v );
	$eff_title = $seo ?: $title;
	$checks = array();
	$add = function ( $key, $label, $status, $tip, $value = '' ) use ( &$checks ) { $checks[] = array( 'key' => $key, 'label' => $label, 'status' => $status, 'tip' => $tip, 'value' => $value ); };
	$tl = mb_strlen( $eff_title );
	$add( 'title', 'Title length', $tl >= 30 && $tl <= 70 ? 'pass' : ( $tl < 15 || $tl > 100 ? 'fail' : 'warn' ), 'Search titles work best at 30–70 characters: the ticker + what the viewer gets.', $tl . ' chars' );
	$add( 'seo_title', 'SEO title', '' === $seo ? 'warn' : ( mb_strlen( $seo ) <= 60 ? 'pass' : 'warn' ), '' === $seo ? 'Add a dedicated SEO title (≤60 chars) — the sitemap and the watch page use it instead of the on-site title.' : 'Keep the SEO title at or under 60 characters so Google shows all of it.', '' === $seo ? 'missing' : mb_strlen( $seo ) . ' chars' );
	$dl = mb_strlen( $desc );
	$add( 'description', 'Description', $dl >= 120 ? 'pass' : ( $dl < 20 ? 'fail' : 'warn' ), 'Write 120+ characters: what the video covers, the tickers, the setup and who it is for. Google and Bing read this for the snippet.', $dl . ' chars' );
	$kw_in_title = $ticker && false !== stripos( $eff_title, $ticker );
	$kw_in_desc = $ticker && false !== stripos( $desc, $ticker );
	$add( 'ticker', 'Ticker keyword', '' === $ticker ? 'warn' : ( $kw_in_title && $kw_in_desc ? 'pass' : 'warn' ), '' === $ticker ? 'Tag the main ticker — it becomes the search keyword and links the video to the ticker pages.' : ( $kw_in_title ? 'Mention $' . $ticker . ' in the description too.' : 'Put $' . $ticker . ' in the title — that is what people search.' ), $ticker ? '$' . $ticker : 'none' );
	$add( 'tags', 'Tags', count( $tags ) >= 3 ? 'pass' : ( count( $tags ) ? 'warn' : 'warn' ), 'Add 3–8 tags: tickers, sector, strategy (e.g. NVDA, semiconductors, earnings play). They feed related-video ranking.', count( $tags ) . ' tags' );
	$add( 'hashtags', 'Hashtags', count( $hashtags ) >= 2 ? 'pass' : 'warn', 'Two or more hashtags (#NVDA #Earnings) help the share cards and social distribution.', count( $hashtags ) . ' hashtags' );
	$add( 'thumbnail', 'Thumbnail', '' !== $thumb ? 'pass' : 'fail', 'A thumbnail is REQUIRED by the video sitemap spec — without it the video cannot be submitted to Google.', $thumb ? 'set' : 'missing' );
	$add( 'duration', 'Duration known', $dur > 0 ? 'pass' : 'warn', 'Duration is written into the VideoObject schema; re-upload or re-process if it is 0.', $dur ? gmdate( $dur >= 3600 ? 'G:i:s' : 'i:s', $dur ) : 'unknown' );
	$indexable = 'public' === $vis && ! $future;
	$add( 'visibility', 'Indexable (public)', $indexable ? 'pass' : 'fail', 'public' !== $vis ? 'Only public videos are crawled, listed in the video sitemap and eligible for search.' : 'Scheduled in the future: it enters the sitemap when it goes live.', $vis . ( $future ? ' · scheduled' : '' ) );
	$in_sitemap = $indexable && '' !== $eff_title && '' !== $thumb;
	$add( 'sitemap', 'In the video sitemap', $in_sitemap ? 'pass' : 'fail', 'The sitemap (/sml-video-sitemap.xml) needs a public video with a title and a thumbnail. Fix the failing items above.', $in_sitemap ? 'listed' : 'not listed' );
	$schema = array( 'checked' => false, 'schema' => false, 'status' => 0, 'noindex' => false, 'canonical' => '' );
	if ( $indexable ) {
		$schema = sml_cv_schema_check( $url, $slug, $fresh );
		$add( 'schema', 'VideoObject schema on the watch page', ! $schema['checked'] ? 'warn' : ( $schema['schema'] && 200 === $schema['status'] && ! $schema['noindex'] ? 'pass' : 'fail' ), ! $schema['checked'] ? 'Could not fetch the watch page right now.' : ( $schema['noindex'] ? 'The watch page carries a noindex robots tag.' : ( 200 !== $schema['status'] ? 'The watch page answered HTTP ' . $schema['status'] . '.' : 'Structured data lets Google show a video rich result; the watch page prints it from this record.' ) ), $schema['checked'] ? ( 'HTTP ' . $schema['status'] . ( $schema['schema'] ? ' · schema ✓' : ' · no schema' ) ) : 'unchecked' );
	}
	$score = 0; $max = 0;
	foreach ( $checks as $c ) { $max += 2; $score += 'pass' === $c['status'] ? 2 : ( 'warn' === $c['status'] ? 1 : 0 ); }
	$pct = $max ? (int) round( 100 * $score / $max ) : 0;
	$fixes = array_values( array_filter( $checks, function ( $c ) { return 'pass' !== $c['status']; } ) );
	usort( $fixes, function ( $a, $b ) { return ( 'fail' === $b['status'] ) - ( 'fail' === $a['status'] ); } );
	return array( 'score' => $pct, 'grade' => $pct >= 85 ? 'A' : ( $pct >= 70 ? 'B' : ( $pct >= 50 ? 'C' : 'D' ) ), 'checks' => $checks, 'fixes' => array_slice( $fixes, 0, 5 ), 'indexable' => $indexable, 'inSitemap' => $in_sitemap, 'schema' => $schema );
}

function sml_cv_video( string $slug, array $v, bool $fresh ): array {
	$views = (int) ( $v['views'] ?? 0 ); $imp = (int) ( $v['impressions'] ?? 0 );
	$eng = sml_cv_engagement( $slug, $v );
	$url = sml_cv_watch_url( $slug, $v );
	return array(
		'id' => $slug, 'title' => (string) ( $v['title'] ?? '' ), 'seo_title' => (string) ( $v['seo_title'] ?? '' ), 'description' => (string) ( $v['description'] ?? '' ),
		'ticker' => (string) ( $v['ticker'] ?? '' ), 'tags' => sml_cv_list( $v['tags'] ?? array() ), 'hashtags' => sml_cv_list( $v['hashtags'] ?? array() ),
		'visibility' => (string) ( $v['visibility'] ?? '' ), 'schedule_at' => (string) ( $v['schedule_at'] ?? '' ), 'thumbnail' => (string) ( $v['thumbnail_url'] ?? '' ),
		'video_url' => (string) ( $v['video_url'] ?? '' ), 'mime' => (string) ( $v['video_mime'] ?? '' ), 'duration' => (int) ( $v['duration'] ?? 0 ),
		'created_at' => (string) ( $v['created_at'] ?? '' ), 'updated_at' => (string) ( $v['updated_at'] ?? '' ), 'url' => $url,
		'stats' => array( 'views' => $views, 'views7' => sml_cv_days( $v['views_daily'] ?? array(), 7 ), 'views30' => sml_cv_days( $v['views_daily'] ?? array(), 30 ), 'impressions' => $imp, 'impressions7' => sml_cv_days( $v['impressions_daily'] ?? array(), 7 ), 'ctr' => $imp ? round( 100 * $views / max( $imp, $views ), 1 ) : 0, 'comments' => $eng['comments'], 'likes' => $eng['likes'] ),
		'seo' => sml_cv_audit( $slug, $v, $fresh ),
		'links' => array( 'google' => 'https://www.google.com/search?q=' . rawurlencode( 'site:' . preg_replace( '#^https?://#', '', $url ) ), 'bing' => 'https://www.bing.com/search?q=' . rawurlencode( 'url:' . $url ), 'edit_studio' => home_url( '/upload-video/' ) ),
	);
}
function sml_cv_all( int $uid, bool $fresh ): array {
	$key = 'sml_cv_all_' . $uid;
	if ( ! $fresh ) { $c = get_transient( $key ); if ( is_array( $c ) ) { return $c; } }
	$out = array();
	foreach ( sml_cv_library() as $slug => $v ) {
		if ( ! is_array( $v ) || (int) ( $v['author_id'] ?? 0 ) !== $uid ) { continue; }
		$out[] = sml_cv_video( (string) $slug, $v, $fresh );
	}
	usort( $out, function ( $a, $b ) { return strcmp( $b['created_at'], $a['created_at'] ); } );
	$avg = $out ? (int) round( array_sum( array_map( function ( $x ) { return $x['seo']['score']; }, $out ) ) / count( $out ) ) : 0;
	$res = array( 'ok' => true, 'creator' => $uid, 'videos' => $out, 'summary' => array( 'count' => count( $out ), 'public' => count( array_filter( $out, function ( $x ) { return 'public' === $x['visibility']; } ) ), 'inSitemap' => count( array_filter( $out, function ( $x ) { return $x['seo']['inSitemap']; } ) ), 'views' => array_sum( array_column( array_column( $out, 'stats' ), 'views' ) ), 'avgSeo' => $avg ), 'generated_at' => gmdate( 'c' ) );
	set_transient( $key, $res, 5 * MINUTE_IN_SECONDS );
	return $res;
}

add_action( 'rest_api_init', function () {
	$own = function ( WP_REST_Request $r ) { return is_user_logged_in(); };
	register_rest_route( SML_CV_NS, '/list', array( 'methods' => 'GET', 'permission_callback' => $own, 'callback' => function ( WP_REST_Request $r ) {
		$creator = (int) ( $r->get_param( 'user_id' ) ?: get_current_user_id() );
		if ( $creator !== get_current_user_id() && ! current_user_can( 'manage_options' ) ) { return new WP_Error( 'sml_cv_forbidden', 'You can only see your own videos.', array( 'status' => 403 ) ); }
		$res = rest_ensure_response( sml_cv_all( $creator, '1' === (string) $r->get_param( 'fresh' ) ) );
		$res->header( 'Cache-Control', 'no-store' );
		return $res;
	} ) );
	register_rest_route( SML_CV_NS, '/update', array( 'methods' => 'POST', 'permission_callback' => $own, 'callback' => function ( WP_REST_Request $r ) {
		$uid = get_current_user_id(); $in = (array) $r->get_json_params() ?: (array) $r->get_body_params();
		$slug = preg_replace( '/[^A-Za-z0-9_-]/', '', (string) ( $in['id'] ?? '' ) );
		$lib = sml_cv_library();
		if ( '' === $slug || empty( $lib[ $slug ] ) || ! is_array( $lib[ $slug ] ) ) { return new WP_Error( 'sml_cv_missing', 'That video is not in the library.', array( 'status' => 404 ) ); }
		if ( (int) ( $lib[ $slug ]['author_id'] ?? 0 ) !== $uid && ! current_user_can( 'manage_options' ) ) { return new WP_Error( 'sml_cv_forbidden', 'Only the creator can edit this video.', array( 'status' => 403 ) ); }
		$v = $lib[ $slug ]; $changed = array();
		if ( isset( $in['title'] ) ) { $t = sml_cv_clean( $in['title'], 160 ); if ( '' !== $t && $t !== ( $v['title'] ?? '' ) ) { $v['title'] = $t; $changed[] = 'title'; } }
		if ( isset( $in['seo_title'] ) ) { $t = sml_cv_clean( $in['seo_title'], 120 ); if ( $t !== (string) ( $v['seo_title'] ?? '' ) ) { $v['seo_title'] = $t; $changed[] = 'seo_title'; } }
		if ( isset( $in['description'] ) ) { $t = trim( wp_kses( (string) $in['description'], array() ) ); if ( mb_strlen( $t ) > 5000 ) { $t = mb_substr( $t, 0, 5000 ); } if ( $t !== (string) ( $v['description'] ?? '' ) ) { $v['description'] = $t; $changed[] = 'description'; } }
		if ( isset( $in['ticker'] ) ) { $t = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', ltrim( (string) $in['ticker'], '$' ) ) ); if ( $t !== (string) ( $v['ticker'] ?? '' ) ) { $v['ticker'] = $t; $changed[] = 'ticker'; } }
		if ( isset( $in['tags'] ) ) { $t = array_slice( array_unique( array_map( function ( $x ) { return sml_cv_clean( $x, 40 ); }, sml_cv_list( $in['tags'] ) ) ), 0, 20 ); if ( $t !== sml_cv_list( $v['tags'] ?? array() ) ) { $v['tags'] = $t; $changed[] = 'tags'; } }
		if ( isset( $in['hashtags'] ) ) { $t = array_slice( array_unique( array_map( function ( $x ) { $x = sml_cv_clean( $x, 40 ); return '' === $x ? '' : '#' . ltrim( $x, '#' ); }, sml_cv_list( $in['hashtags'] ) ) ), 0, 20 ); $t = array_values( array_filter( $t ) ); if ( $t !== sml_cv_list( $v['hashtags'] ?? array() ) ) { $v['hashtags'] = $t; $changed[] = 'hashtags'; } }
		if ( isset( $in['visibility'] ) && in_array( (string) $in['visibility'], array( 'public', 'unlisted', 'private', 'members', 'premium', 'draft' ), true ) && (string) $in['visibility'] !== (string) ( $v['visibility'] ?? '' ) ) { $v['visibility'] = (string) $in['visibility']; $changed[] = 'visibility'; }
		if ( $changed ) {
			$v['updated_at'] = gmdate( DATE_W3C );
			$lib[ $slug ] = $v;
			sml_cv_save_library( $lib );
			if ( class_exists( 'SML_Google_Sitemaps' ) && method_exists( 'SML_Google_Sitemaps', 'invalidate' ) ) { SML_Google_Sitemaps::invalidate(); }
			delete_transient( 'sml_cv_schema_' . md5( $slug ) );
		}
		delete_transient( 'sml_cv_all_' . $uid );
		return array( 'ok' => true, 'changed' => $changed, 'video' => sml_cv_video( $slug, $v, true ) );
	} ) );
	register_rest_route( SML_CV_NS, '/request-index', array( 'methods' => 'POST', 'permission_callback' => $own, 'callback' => function ( WP_REST_Request $r ) {
		$uid = get_current_user_id(); $in = (array) $r->get_json_params() ?: (array) $r->get_body_params();
		$slug = preg_replace( '/[^A-Za-z0-9_-]/', '', (string) ( $in['id'] ?? '' ) );
		$lib = sml_cv_library();
		if ( '' === $slug || empty( $lib[ $slug ] ) ) { return new WP_Error( 'sml_cv_missing', 'That video is not in the library.', array( 'status' => 404 ) ); }
		if ( (int) ( $lib[ $slug ]['author_id'] ?? 0 ) !== $uid && ! current_user_can( 'manage_options' ) ) { return new WP_Error( 'sml_cv_forbidden', 'Only the creator can request indexing.', array( 'status' => 403 ) ); }
		$v = $lib[ $slug ];
		if ( 'public' !== (string) ( $v['visibility'] ?? '' ) ) { return new WP_Error( 'sml_cv_private', 'Make the video public first — search engines only index public watch pages.', array( 'status' => 400 ) ); }
		if ( get_transient( 'sml_cv_ping_' . $slug ) ) { return new WP_Error( 'sml_cv_wait', 'Already requested in the last hour. Search engines pick it up on their own schedule.', array( 'status' => 429 ) ); }
		$url = sml_cv_watch_url( $slug, $v ); $did = array();
		if ( class_exists( 'SML_Google_Sitemaps' ) && method_exists( 'SML_Google_Sitemaps', 'notify_url' ) ) { SML_Google_Sitemaps::notify_url( $url ); $did[] = 'sitemap pinger'; }
		$key = (string) get_option( 'sml_indexnow_key' );
		if ( $key ) {
			$res = wp_remote_post( 'https://api.indexnow.org/indexnow', array( 'timeout' => 8, 'headers' => array( 'Content-Type' => 'application/json; charset=utf-8' ), 'body' => wp_json_encode( array( 'host' => wp_parse_url( home_url(), PHP_URL_HOST ), 'key' => $key, 'keyLocation' => home_url( '/' . $key . '.txt' ), 'urlList' => array( $url ) ) ) ) );
			$did[] = 'IndexNow (Bing/Yandex) ' . ( is_wp_error( $res ) ? 'failed' : 'HTTP ' . wp_remote_retrieve_response_code( $res ) );
		}
		set_transient( 'sml_cv_ping_' . $slug, 1, HOUR_IN_SECONDS );
		return array( 'ok' => true, 'url' => $url, 'did' => $did, 'note' => 'Google reads the video sitemap (' . home_url( '/sml-video-sitemap.xml' ) . ') — it was refreshed; Bing was pinged through IndexNow.' );
	} ) );
	register_rest_route( SML_CV_NS, '/thumbnail', array( 'methods' => 'POST', 'permission_callback' => $own, 'callback' => 'sml_cv_rest_thumbnail' ) );
} );

/**
 * Replace a video's thumbnail (1.3.0). Multipart: id + thumbnail (an uploaded image or a frame the page captured from the
 * video). Stored like the upload studio stores thumbnails — a plain file in uploads/ — and written to the library row.
 */
function sml_cv_rest_thumbnail( WP_REST_Request $r ) {
	$uid  = get_current_user_id();
	$slug = preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $r->get_param( 'id' ) );
	$lib  = sml_cv_library();
	if ( '' === $slug || empty( $lib[ $slug ] ) || ! is_array( $lib[ $slug ] ) ) { return new WP_Error( 'sml_cv_missing', 'That video is not in the library.', array( 'status' => 404 ) ); }
	$author = (int) ( $lib[ $slug ]['author_id'] ?? 0 );
	if ( $author !== $uid && ! current_user_can( 'manage_options' ) ) { return new WP_Error( 'sml_cv_forbidden', 'Only the creator can change this thumbnail.', array( 'status' => 403 ) ); }
	$files = $r->get_file_params();
	$file  = $files['thumbnail'] ?? null;
	if ( ! is_array( $file ) || UPLOAD_ERR_OK !== (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) ) { return new WP_Error( 'sml_cv_no_image', 'Choose an image or a frame first.', array( 'status' => 400 ) ); }
	if ( (int) ( $file['size'] ?? 0 ) > 50 * MB_IN_BYTES ) { return new WP_Error( 'sml_cv_too_big', 'Thumbnails must be 50 MB or smaller.', array( 'status' => 413 ) ); }
	$rl = 'sml_cv_thumb_rl_' . $uid;
	$n  = (int) get_transient( $rl );
	if ( $n >= 20 ) { return new WP_Error( 'sml_cv_slow', 'Too many thumbnail uploads — try again in a few minutes.', array( 'status' => 429 ) ); }
	set_transient( $rl, $n + 1, 10 * MINUTE_IN_SECONDS );

	require_once ABSPATH . 'wp-admin/includes/file.php';
	$mimes = array( 'jpg|jpeg|jpe' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif' );
	$check = wp_check_filetype_and_ext( (string) $file['tmp_name'], (string) ( $file['name'] ?? '' ), $mimes );
	if ( empty( $check['type'] ) || empty( $check['ext'] ) ) { return new WP_Error( 'sml_cv_bad_type', 'Use a JPG, PNG, WebP or GIF image.', array( 'status' => 400 ) ); }
	$size = @getimagesize( (string) $file['tmp_name'] ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
	if ( ! $size || (int) $size[0] < 320 || (int) $size[1] < 180 ) { return new WP_Error( 'sml_cv_small', 'The image must be at least 320×180 (1280×720 works best).', array( 'status' => 400 ) ); }
	$file['name'] = sanitize_file_name( $slug . '-thumbnail.' . $check['ext'] );
	$up = wp_handle_upload( $file, array( 'test_form' => false, 'mimes' => $mimes ) );
	if ( ! empty( $up['error'] ) || empty( $up['url'] ) ) { return new WP_Error( 'sml_cv_upload_failed', 'The upload failed: ' . sanitize_text_field( (string) ( $up['error'] ?? 'unknown error' ) ), array( 'status' => 500 ) ); }

	$lib = sml_cv_library(); // re-read: views and likes read-modify-write the same option
	if ( empty( $lib[ $slug ] ) || ! is_array( $lib[ $slug ] ) ) { return new WP_Error( 'sml_cv_missing', 'That video was removed while uploading.', array( 'status' => 404 ) ); }
	$lib[ $slug ]['thumbnail_url'] = esc_url_raw( (string) $up['url'] );
	$lib[ $slug ]['updated_at']    = gmdate( DATE_W3C );
	sml_cv_save_library( $lib );
	if ( class_exists( 'SML_Google_Sitemaps' ) && method_exists( 'SML_Google_Sitemaps', 'invalidate' ) ) { SML_Google_Sitemaps::invalidate(); }
	delete_transient( 'sml_cv_schema_' . md5( $slug ) );
	delete_transient( 'sml_cv_all_' . $uid );
	delete_transient( 'sml_cv_all_' . $author );
	return array( 'ok' => true, 'video' => sml_cv_video( $slug, $lib[ $slug ], true ) );
}

/**
 * Removed-video redirects (1.3.0). A duplicate that was taken out of the library keeps working links: /watch/{old}/… and
 * /video/{old}/… 301 to the kept video's watch page (query string kept, e.g. ?b= share codes). Runs before the clean-URL
 * router (init -10000) and only while {old} is really gone and the target still exists.
 */
add_action( 'init', function () {
	$method = strtoupper( (string) ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) );
	if ( 'GET' !== $method && 'HEAD' !== $method ) { return; }
	$uri = (string) ( $_SERVER['REQUEST_URI'] ?? '' );
	if ( 0 !== strncmp( $uri, '/watch/', 7 ) && 0 !== strncmp( $uri, '/video/', 7 ) ) { return; }
	if ( ! preg_match( '#^/(?:watch|video)/([A-Za-z0-9_-]{8,32})(?:[/?]|$)#', $uri, $m ) ) { return; }
	$map = get_option( 'sml_cv_redirects', array() );
	if ( ! is_array( $map ) || empty( $map[ $m[1] ] ) ) { return; }
	$lib = sml_cv_library();
	$to  = (string) $map[ $m[1] ];
	if ( ! empty( $lib[ $m[1] ] ) || empty( $lib[ $to ] ) || ! is_array( $lib[ $to ] ) ) { return; }
	$url = sml_cv_watch_url( $to, $lib[ $to ] );
	$q   = strpos( $uri, '?' );
	if ( false !== $q ) { $url .= ( false === strpos( $url, '?' ) ? '?' : '&' ) . substr( $uri, $q + 1 ); }
	wp_safe_redirect( $url, 301, 'SML Creator Videos' );
	exit;
}, -10001 );

/* ------------------------------------------------------ Go live: past + upcoming streams */
/** UTC MySQL time → Unix time. The live-room table is written with current_time('mysql', true), i.e. UTC. */
function sml_cv_utc_ts( $mysql ): int { if ( ! $mysql || '0000-00-00 00:00:00' === $mysql ) { return 0; } $t = strtotime( (string) $mysql . ' UTC' ); return $t ? (int) $t : 0; }
function sml_cv_iso_ts( $iso ): int { $t = $iso ? strtotime( (string) $iso ) : false; return $t ? (int) $t : 0; }

/* ---------- replays: link an uploaded video to a past live stream ---------- */
function sml_cv_words( string $s ): array {
	$s = strtolower( preg_replace( '/[^a-z0-9$ ]+/i', ' ', $s ) );
	$stop = array_flip( array( 'the', 'and', 'for', 'with', 'live', 'stream', 'stock', 'stocks', 'market', 'today', 'you', 'your', 'how', 'what', 'this' ) );
	return array_values( array_unique( array_filter( preg_split( '/\s+/', $s ), function ( $w ) use ( $stop ) { return strlen( $w ) >= 3 && ! isset( $stop[ $w ] ); } ) ) );
}
function sml_cv_similar( string $a, string $b ): float {
	$x = sml_cv_words( $a ); $y = sml_cv_words( $b );
	if ( ! $x || ! $y ) { return 0.0; }
	return count( array_intersect( $x, $y ) ) / count( array_unique( array_merge( $x, $y ) ) );
}
/** The creator's videos, newest first (any visibility: a replay can be unlisted). */
function sml_cv_creator_videos( int $uid ): array {
	$out = array();
	foreach ( sml_cv_library() as $slug => $v ) {
		if ( ! is_array( $v ) || (int) ( $v['author_id'] ?? 0 ) !== $uid ) { continue; }
		$out[] = array( 'id' => (string) $slug, 'title' => sml_cv_clean( $v['title'] ?? '', 160 ) ?: 'Untitled video', 'created_at' => (string) ( $v['created_at'] ?? '' ), 'url' => sml_cv_watch_url( (string) $slug, $v ), 'thumbnail' => esc_url_raw( (string) ( $v['thumbnail_url'] ?? '' ) ), 'visibility' => (string) ( $v['visibility'] ?? '' ), 'duration' => (int) ( $v['duration'] ?? 0 ) );
	}
	usort( $out, function ( $a, $b ) { return strcmp( $b['created_at'], $a['created_at'] ); } );
	return $out;
}
/** Videos that are probably this stream's replay: uploaded from 1 h before the start to 7 days after, ranked by title. */
function sml_cv_replay_candidates( array $stream, array $videos ): array {
	$start = sml_cv_iso_ts( $stream['started_at'] ?: $stream['scheduled_at'] );
	if ( ! $start ) { return array(); }
	$out = array();
	foreach ( $videos as $v ) {
		$t = sml_cv_iso_ts( $v['created_at'] );
		if ( ! $t || $t < $start - HOUR_IN_SECONDS || $t > $start + 7 * DAY_IN_SECONDS ) { continue; }
		$score = sml_cv_similar( (string) $stream['title'], $v['title'] ) + max( 0, 0.2 - ( $t - $start ) / ( 7 * DAY_IN_SECONDS ) * 0.2 );
		$out[] = array( 'id' => $v['id'], 'title' => $v['title'], 'score' => round( $score, 2 ) );
	}
	usort( $out, function ( $a, $b ) { return $b['score'] <=> $a['score']; } );
	return array_slice( $out, 0, 3 );
}
/** Attach (or with '' detach) a video as a stream's replay. Streams keep it in their own record, studio-only rooms in user meta. */
function sml_cv_set_replay( int $uid, string $stream_id, string $video_id ) {
	$lib = sml_cv_library();
	$vid = null;
	if ( '' !== $video_id ) {
		if ( empty( $lib[ $video_id ] ) || (int) ( $lib[ $video_id ]['author_id'] ?? 0 ) !== $uid ) { return new WP_Error( 'sml_cv_replay_video', 'That video is not on your channel.', array( 'status' => 404 ) ); }
		$vid = $lib[ $video_id ];
	}
	if ( 0 === strpos( $stream_id, 'room-' ) ) {
		$map = get_user_meta( $uid, '_sml_cv_room_replays', true ); $map = is_array( $map ) ? $map : array();
		if ( $vid ) { $map[ $stream_id ] = $video_id; } else { unset( $map[ $stream_id ] ); }
		update_user_meta( $uid, '_sml_cv_room_replays', $map );
		return true;
	}
	$rows = (array) get_user_meta( $uid, '_sml_scheduled_live_library', true );
	$row  = $rows[ $stream_id ] ?? null;
	if ( ! is_array( $row ) ) { return new WP_Error( 'sml_cv_replay_stream', 'That live stream is not yours.', array( 'status' => 404 ) ); }
	if ( in_array( (string) ( $row['status'] ?? '' ), array( 'scheduled', 'live', 'cancelled' ), true ) && empty( $row['ended_at'] ) ) { return new WP_Error( 'sml_cv_replay_state', 'A replay can be added once the stream has ended.', array( 'status' => 409 ) ); }
	$row['recording_url']    = $vid ? sml_cv_watch_url( $video_id, $vid ) : '';
	$row['recording_status'] = $vid ? 'ready' : 'not_started';
	$row['replay_video_id']  = $vid ? $video_id : '';
	$row['updated_at']       = gmdate( 'c' );
	if ( function_exists( 'sml_scheduled_live_store' ) ) { sml_scheduled_live_store( $uid, $row, false ); } else { $rows[ $stream_id ] = $row; update_user_meta( $uid, '_sml_scheduled_live_library', $rows ); }
	$cur = get_user_meta( $uid, '_sml_scheduled_live', true );
	if ( is_array( $cur ) && (string) ( $cur['id'] ?? '' ) === $stream_id ) { update_user_meta( $uid, '_sml_scheduled_live', $row ); }
	if ( class_exists( 'SML_Google_Sitemaps' ) && method_exists( 'SML_Google_Sitemaps', 'invalidate' ) ) { SML_Google_Sitemaps::invalidate(); }
	return true;
}
/* A video uploaded soon after a stream, with a matching title, becomes its replay automatically.
   Conservative on purpose: only a single clear match (title similarity ≥ 0.5, uploaded within 72 h
   of the start) is linked; everything else is offered as a suggestion on the Go live tab. */
function sml_cv_auto_link_replays( int $uid ): array {
	$linked = array();
	$videos = sml_cv_creator_videos( $uid );
	$taken  = array();
	foreach ( (array) get_user_meta( $uid, '_sml_scheduled_live_library', true ) as $r ) { if ( is_array( $r ) && ! empty( $r['replay_video_id'] ) ) { $taken[ $r['replay_video_id'] ] = true; } }
	foreach ( (array) get_user_meta( $uid, '_sml_scheduled_live_library', true ) as $id => $r ) {
		if ( ! is_array( $r ) || 'ended' !== (string) ( $r['status'] ?? '' ) || ! empty( $r['recording_url'] ) ) { continue; }
		$start = sml_cv_iso_ts( ( $r['started_at'] ?? '' ) ?: ( $r['scheduled_at'] ?? '' ) );
		if ( ! $start ) { continue; }
		$hits = array();
		foreach ( $videos as $v ) {
			$t = sml_cv_iso_ts( $v['created_at'] );
			if ( isset( $taken[ $v['id'] ] ) || ! $t || $t < $start || $t > $start + 72 * HOUR_IN_SECONDS ) { continue; }
			if ( sml_cv_similar( (string) ( $r['title'] ?? '' ), $v['title'] ) >= 0.5 ) { $hits[] = $v['id']; }
		}
		if ( 1 === count( $hits ) && true === sml_cv_set_replay( $uid, (string) $id, $hits[0] ) ) { $taken[ $hits[0] ] = true; $linked[] = array( 'stream' => (string) $id, 'video' => $hits[0] ); }
	}
	return $linked;
}
add_action( 'update_option_sml_video_upload_studio_library', function ( $old, $new ) {
	if ( ! is_array( $new ) ) { return; }
	$authors = array();
	foreach ( $new as $slug => $v ) { if ( is_array( $v ) && ! isset( $old[ $slug ] ) && ! empty( $v['author_id'] ) ) { $authors[ (int) $v['author_id'] ] = true; } }
	foreach ( array_keys( $authors ) as $uid ) { sml_cv_auto_link_replays( $uid ); }
}, 20, 2 );

/**
 * Every live stream the creator scheduled or ran, from the real stores:
 *  - the scheduled-live library (usermeta _sml_scheduled_live_library + the current pointer,
 *    WPCode #7347): title, thumbnail, schedule, status, watch page, recording;
 *  - live rooms the creator hosted from the Go Live studio (wp_sml_group_live_rooms):
 *    start/end, group, and whether one is on air right now;
 *  - Watch Page chat (wp_sml_live_chat_messages, room "room-stream-<id>"): messages and chatters.
 * Nothing is estimated: a stream that was never closed says so instead of inventing an end time.
 */
function sml_cv_live( int $uid ): array {
	global $wpdb;
	$now  = time();
	$raw  = get_user_meta( $uid, '_sml_scheduled_live_library', true );
	$raw  = is_array( $raw ) ? $raw : array();
	$cur  = get_user_meta( $uid, '_sml_scheduled_live', true );
	if ( is_array( $cur ) && ! empty( $cur['id'] ) && empty( $raw[ $cur['id'] ] ) ) { $raw[ $cur['id'] ] = $cur; }

	/* rooms hosted from the studio */
	$rooms = array(); $active_room = null;
	$rt = $wpdb->prefix . 'sml_group_live_rooms';
	if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $rt ) ) ) {
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$rt} WHERE host_id = %d ORDER BY id DESC LIMIT 100", $uid ), ARRAY_A ) as $r ) {
			$start = sml_cv_utc_ts( $r['started_at'] );
			$end   = sml_cv_utc_ts( $r['ended_at'] );
			$beat  = sml_cv_utc_ts( $r['heartbeat_at'] );
			$on    = 'active' === $r['status'] && $beat > $now - 120;
			$gid   = (int) $r['group_id'];
			$grow  = $gid ? $wpdb->get_row( $wpdb->prepare( "SELECT name, slug FROM {$wpdb->prefix}sml_groups WHERE id = %d", $gid ), ARRAY_A ) : null;
			$gname = (string) ( $grow['name'] ?? '' );
			$gurl  = ! empty( $grow['slug'] ) ? home_url( '/groups/' . rawurlencode( $grow['slug'] ) . '/' ) : '';
			/* the last heartbeat is the last proof the host was on air: rooms left open are closed by a
			   cleanup long after the stream stopped, so ended_at can be days late */
			if ( ! $on && $beat && $start && ( ! $end || $end > $beat + 300 ) ) { $end = $beat; }
			$room  = array( 'id' => (int) $r['id'], 'title' => (string) $r['title'], 'group_id' => $gid, 'group' => $gname, 'group_url' => $gurl, 'start' => $start, 'end' => $on ? 0 : $end, 'on_air' => $on, 'used' => false );
			$rooms[] = $room;
			if ( $on && ! $active_room ) { $active_room = $room; }
		}
	}
	$chat = function ( string $stream_id ) use ( $wpdb ): array {
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT COUNT(*) n, COUNT(DISTINCT user_id) u FROM {$wpdb->prefix}sml_live_chat_messages WHERE room_key = %s", 'room-stream-' . $stream_id ), ARRAY_A );
		return array( 'messages' => (int) ( $row['n'] ?? 0 ), 'chatters' => (int) ( $row['u'] ?? 0 ) );
	};
	$where = function ( array $room ): string { return $room['group_id'] ? ( $room['group'] ?: 'Group #' . $room['group_id'] ) : 'Your channel'; };

	$videos   = sml_cv_creator_videos( $uid );
	$by_id    = array(); foreach ( $videos as $v ) { $by_id[ $v['id'] ] = $v; }
	$room_map = get_user_meta( $uid, '_sml_cv_room_replays', true ); $room_map = is_array( $room_map ) ? $room_map : array();
	/* the linked replay video (by id, else by its watch URL) */
	$replay_of = function ( string $vid, string $url ) use ( $by_id ) {
		if ( '' !== $vid && isset( $by_id[ $vid ] ) ) { return array( 'id' => $vid, 'title' => $by_id[ $vid ]['title'], 'url' => $by_id[ $vid ]['url'] ); }
		foreach ( $by_id as $v ) { if ( '' !== $url && untrailingslashit( $v['url'] ) === untrailingslashit( $url ) ) { return array( 'id' => $v['id'], 'title' => $v['title'], 'url' => $v['url'] ); } }
		return '' !== $url ? array( 'id' => '', 'title' => '', 'url' => $url ) : null;
	};
	$upcoming = array(); $past = array(); $live_now = array(); $cancelled = 0;
	foreach ( $raw as $key => $s ) {
		if ( ! is_array( $s ) ) { continue; }
		$id     = (string) ( $s['id'] ?? $key );
		$status = (string) ( $s['status'] ?? 'scheduled' );
		if ( 'cancelled' === $status ) { $cancelled++; continue; }
		$sched  = sml_cv_iso_ts( $s['scheduled_at'] ?? '' );
		$start  = sml_cv_iso_ts( $s['started_at'] ?? '' );
		$end    = sml_cv_iso_ts( $s['ended_at'] ?? '' );
		$upd    = sml_cv_iso_ts( $s['updated_at'] ?? '' );
		$pay    = function_exists( 'sml_scheduled_live_public_payload' ) ? sml_scheduled_live_public_payload( $uid, true, $id ) : null;
		$item   = array(
			'id'          => $id,
			'title'       => sml_cv_clean( $s['title'] ?? '', 160 ) ?: 'Untitled live stream',
			'description' => sml_cv_clean( $s['description'] ?? '', 280 ),
			'thumbnail'   => esc_url_raw( (string) ( $s['thumbnail_url'] ?? '' ) ),
			'ticker'      => (string) ( $s['ticker'] ?? '' ),
			'visibility'  => (string) ( $s['visibility'] ?? 'public' ),
			'scheduled_at'=> $sched ? gmdate( 'c', $sched ) : '',
			'started_at'  => $start ? gmdate( 'c', $start ) : '',
			'ended_at'    => $end ? gmdate( 'c', $end ) : '',
			'duration'    => ( $start && $end && $end > $start ) ? $end - $start : 0,
			'watch_url'   => is_array( $pay ) && ! empty( $pay['watch_url'] ) ? (string) $pay['watch_url'] : '',
			'recording'   => esc_url_raw( (string) ( $s['recording_url'] ?? '' ) ),
			'chat'        => $chat( $id ),
			'viewers'     => function_exists( 'sml_lv_stream_stats' ) ? sml_lv_stream_stats( $uid, $id ) : null,
			'replay'      => $replay_of( (string) ( $s['replay_video_id'] ?? '' ), (string) ( $s['recording_url'] ?? '' ) ),
			'where'       => 'Your channel',
			'state'       => '',
		);
		/* the studio room that carried this stream (started within 15 minutes of it) */
		$anchor = $start ?: $sched;
		foreach ( $rooms as $i => $room ) {
			if ( $room['used'] || ! $anchor || abs( $room['start'] - $anchor ) > 900 ) { continue; }
			$rooms[ $i ]['used'] = true;
			$item['where'] = $where( $room );
			if ( ! $item['started_at'] ) { $item['started_at'] = gmdate( 'c', $room['start'] ); $start = $room['start']; }
			if ( ! $end && $room['end'] ) { $end = $room['end']; $item['ended_at'] = gmdate( 'c', $end ); }
			if ( $start && $end > $start ) { $item['duration'] = $end - $start; }
			if ( $room['on_air'] ) { $status = 'live'; $upd = $now; }
			break;
		}
		if ( 'ended' === $status || ( $end && 'live' !== $status ) ) {
			$item['state'] = 'ended'; $past[] = $item;
		} elseif ( 'live' === $status ) {
			/* a stream still marked live with no recent activity was never closed; say so */
			if ( ( $active_room && abs( $active_room['start'] - ( $start ?: $sched ) ) <= 900 ) || $upd > $now - 6 * HOUR_IN_SECONDS ) { $item['state'] = 'live'; $live_now[] = $item; }
			else { $item['state'] = 'unclosed'; $past[] = $item; }
		} elseif ( $sched > $now - 2 * HOUR_IN_SECONDS ) {
			$item['state'] = $sched > $now ? 'upcoming' : 'due'; $upcoming[] = $item;
		} else {
			$item['state'] = 'missed'; $past[] = $item;
		}
	}
	/* studio broadcasts that were not tied to a scheduled stream */
	foreach ( $rooms as $room ) {
		if ( $room['used'] ) { continue; }
		$item = array(
			'id' => 'room-' . $room['id'], 'title' => $room['title'] ?: 'Live stream', 'description' => '', 'thumbnail' => '', 'ticker' => '', 'visibility' => $room['group_id'] ? 'group' : 'public',
			'scheduled_at' => '', 'started_at' => $room['start'] ? gmdate( 'c', $room['start'] ) : '', 'ended_at' => $room['end'] ? gmdate( 'c', $room['end'] ) : '',
			'duration' => ( $room['start'] && $room['end'] > $room['start'] ) ? $room['end'] - $room['start'] : 0,
			'watch_url' => $room['group_url'], 'recording' => '', 'chat' => array( 'messages' => 0, 'chatters' => 0 ),
			'where' => $where( $room ), 'state' => $room['on_air'] ? 'live' : 'ended', 'viewers' => null,
			'replay' => $replay_of( (string) ( $room_map[ 'room-' . $room['id'] ] ?? '' ), '' ),
		);
		if ( $room['on_air'] ) { $live_now[] = $item; } else { $past[] = $item; }
	}
	foreach ( $past as $i => $p ) { $past[ $i ]['candidates'] = empty( $p['replay'] ) && 'missed' !== $p['state'] ? sml_cv_replay_candidates( $p, $videos ) : array(); }
	usort( $upcoming, function ( $a, $b ) { return strcmp( $a['scheduled_at'], $b['scheduled_at'] ); } );
	$when = function ( $x ) { return $x['started_at'] ?: $x['scheduled_at']; };
	usort( $past, function ( $a, $b ) use ( $when ) { return strcmp( $when( $b ), $when( $a ) ); } );
	$minutes = 0; $messages = 0;
	$peak = 0;
	foreach ( $past as $p ) { $minutes += (int) floor( $p['duration'] / 60 ); $messages += $p['chat']['messages']; $peak = max( $peak, (int) ( $p['viewers']['peak'] ?? 0 ) ); }
	return array(
		'live_now'  => $live_now,
		'upcoming'  => $upcoming,
		'past'      => $past,
		'cancelled' => $cancelled,
		'videos'    => array_map( function ( $v ) { return array( 'id' => $v['id'], 'title' => $v['title'], 'created_at' => $v['created_at'] ); }, array_slice( $videos, 0, 200 ) ),
		'summary'   => array( 'upcoming' => count( $upcoming ), 'past' => count( $past ), 'minutes' => $minutes, 'chat' => $messages, 'peak' => $peak, 'next' => $upcoming ? $upcoming[0]['scheduled_at'] : '' ),
		'links'     => array( 'go_live' => home_url( '/go-live/' ), 'upload' => home_url( '/upload-video/' ) ),
	);
}
add_action( 'rest_api_init', function () {
	register_rest_route( SML_CV_NS, '/live', array( 'methods' => 'GET', 'permission_callback' => 'is_user_logged_in', 'callback' => function ( WP_REST_Request $r ) {
		$creator = (int) ( $r->get_param( 'user_id' ) ?: get_current_user_id() );
		if ( $creator !== get_current_user_id() && ! current_user_can( 'manage_options' ) ) { return new WP_Error( 'sml_cv_forbidden', 'You can only see your own live streams.', array( 'status' => 403 ) ); }
		$res = rest_ensure_response( sml_cv_live( $creator ) );
		$res->header( 'Cache-Control', 'no-store' );
		return $res;
	} ) );
	register_rest_route( SML_CV_NS, '/live/replay', array( 'methods' => 'POST', 'permission_callback' => 'is_user_logged_in', 'callback' => function ( WP_REST_Request $r ) {
		$in     = (array) $r->get_json_params() ?: (array) $r->get_body_params();
		$stream = preg_replace( '/[^A-Za-z0-9_-]/', '', (string) ( $in['stream_id'] ?? '' ) );
		$video  = preg_replace( '/[^A-Za-z0-9_-]/', '', (string) ( $in['video_id'] ?? '' ) );
		if ( '' === $stream ) { return new WP_Error( 'sml_cv_replay_stream', 'Pick a live stream.', array( 'status' => 400 ) ); }
		$uid = get_current_user_id();
		$ok  = sml_cv_set_replay( $uid, $stream, $video );
		if ( is_wp_error( $ok ) ) { return $ok; }
		return array( 'ok' => true, 'live' => sml_cv_live( $uid ) );
	} ) );
} );

/* ------------------------------------------------------------------ page */
function sml_cv_styles(): string {
	return '.cs-cv{padding:26px;min-width:0}.cs-cv h1{margin:0;font-size:28px;letter-spacing:-.6px}.cs-cv-sub{margin:7px 0 0;color:#8798ac;font-size:14px;max-width:760px}.cs-cv-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:18px}'
		. '.cs-cv-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 18px}.cs-cv-actions a,.cs-cv-actions button{display:flex;align-items:center;justify-content:center;height:44px;border-radius:12px;border:1px solid #223146;background:#0b131f;color:#e6edf5;font:inherit;font-size:14px;font-weight:700;text-decoration:none;cursor:pointer}.cs-cv-actions a:hover,.cs-cv-actions button:hover{border-color:#38f58a}.cs-cv-actions .primary{background:#38f58a;border-color:#38f58a;color:#06120c}'
		. '.cs-cv-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px}.cs-cv-sum div{background:#0b131f;border:1px solid #182130;border-radius:12px;padding:12px 14px}.cs-cv-sum b{display:block;font-size:22px;letter-spacing:-.5px}.cs-cv-sum span{font-size:12px;color:#8798ac}'
		. '.cs-cv-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.cs-cv-tab{height:36px;padding:0 13px;border-radius:999px;border:1px solid #223146;background:#0b131f;color:#dbe6f2;font:inherit;font-size:13px;font-weight:700;cursor:pointer}.cs-cv-tab.on{background:#38f58a;border-color:#38f58a;color:#06120c}.cs-cv-tab b{margin-left:6px;opacity:.7}'
		. '.cs-cv-list{display:flex;flex-direction:column;gap:12px}.cs-v{display:grid;grid-template-columns:220px minmax(0,1fr) 150px;gap:16px;background:#0b131f;border:1px solid #182130;border-radius:14px;padding:16px}.cs-v-thumb{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#06101a}.cs-v-thumb img{width:100%;height:100%;object-fit:cover;display:block}.cs-v-thumb i{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.75);color:#fff;font-style:normal;font-size:11px;padding:2px 6px;border-radius:5px}.cs-v-thumb .vis{position:absolute;left:6px;top:6px;font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;padding:3px 7px;border-radius:5px;background:#1a2a3d;color:#cfe0f2}.cs-v-thumb .vis.public{background:#123a2a;color:#a6ffd2}'
		. '.cs-v h3{margin:0 0 4px;font-size:16px;line-height:1.3}.cs-v h3 a{color:inherit;text-decoration:none}.cs-v-meta{font-size:12px;color:#8798ac;display:flex;gap:10px;flex-wrap:wrap}.cs-v-meta b{color:#dbe6f2;font-weight:600}.cs-v-desc{margin:8px 0 0;font-size:13px;color:#b9c8d8;line-height:1.45;max-height:58px;overflow:hidden}.cs-v-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.cs-v-chips span{font-size:11px;padding:3px 8px;border-radius:999px;background:#14202f;color:#cfe0f2}.cs-v-chips span.t{background:#1b2a1f;color:#a6ffd2}'
		. '.cs-v-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}.cs-v-stats div{background:#08111b;border:1px solid #14202f;border-radius:9px;padding:8px 9px}.cs-v-stats b{display:block;font-size:16px}.cs-v-stats span{font-size:10.5px;color:#8798ac}'
		. '.cs-v-seo{display:flex;flex-direction:column;gap:8px;align-items:stretch}.cs-v-score{display:flex;align-items:center;gap:10px;background:#08111b;border:1px solid #14202f;border-radius:12px;padding:10px}.cs-v-ring{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:15px;background:conic-gradient(var(--c) calc(var(--p)*1%),#182130 0);position:relative}.cs-v-ring::after{content:"";position:absolute;inset:5px;border-radius:50%;background:#08111b}.cs-v-ring b{position:relative;z-index:1}.cs-v-score small{display:block;font-size:11px;color:#8798ac}.cs-v-score strong{font-size:13px}'
		. '.cs-v-btn{height:34px;border-radius:9px;border:1px solid #223146;background:#0e1826;color:#dbe6f2;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px}.cs-v-btn:hover{border-color:#38f58a}.cs-v-btn.primary{background:#38f58a;border-color:#38f58a;color:#06120c}.cs-v-btn[disabled]{opacity:.5;cursor:default}'
		. '.cs-v-detail{grid-column:1/-1;border-top:1px solid #182130;padding-top:14px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.cs-v-checks{display:flex;flex-direction:column;gap:6px}.cs-v-check{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:start;font-size:12.5px;padding:7px 9px;border-radius:9px;background:#08111b}.cs-v-check i{font-style:normal;font-weight:800}.cs-v-check.pass i{color:#38f58a}.cs-v-check.warn i{color:#ffb020}.cs-v-check.fail i{color:#ff5c7a}.cs-v-check small{display:block;color:#8798ac;margin-top:2px;line-height:1.4}.cs-v-check em{font-style:normal;color:#8798ac;font-size:11px;white-space:nowrap}'
		. '.cs-v-form{display:flex;flex-direction:column;gap:8px}.cs-v-form label{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#8798ac}.cs-v-form input,.cs-v-form textarea,.cs-v-form select{width:100%;border-radius:9px;border:1px solid #223146;background:#0b131f;color:#e6edf5;padding:9px 11px;font:inherit;font-size:13px;box-sizing:border-box}.cs-v-form textarea{min-height:110px;resize:vertical}.cs-v-form .row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cs-v-form .cnt{font-size:11px;color:#708399;text-align:right;margin-top:-4px}.cs-v-form .cnt.bad{color:#ff9aa8}.cs-v-form .cnt.ok{color:#8fd6b0}.cs-v-note{font-size:12px;color:#8fd6b0;min-height:16px}.cs-v-note.err{color:#ff9aa8}'
		. '.cs-cv-tab.is-live{border-color:#4a1f28}.cs-cv-tab.is-live.on{background:#ff4d6a;border-color:#ff4d6a;color:#fff}.cs-lv-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;background:linear-gradient(90deg,rgba(255,77,106,.12),rgba(11,19,31,.9));border:1px solid #3a1d27;border-radius:14px;padding:14px 16px;margin-bottom:14px}.cs-lv-bar b{display:block;font-size:17px}.cs-lv-bar span{font-size:13px;color:#a9b8c8}.cs-lv-go{display:flex;gap:8px;flex-wrap:wrap}.cs-lv-go .cs-v-btn{padding:0 16px;height:40px}.cs-lv-go .cs-v-btn.primary{background:#ff4d6a;border-color:#ff4d6a;color:#fff}.cs-lv-sec{margin:0 0 18px}.cs-lv-sec h2{margin:0 0 10px;font-size:15px;letter-spacing:.2px}.cs-lv-sec h2 b{margin-left:6px;color:#8798ac;font-weight:700}.cs-lv-card{display:grid;grid-template-columns:180px minmax(0,1fr) 190px;gap:14px;align-items:center;background:#0b131f;border:1px solid #182130;border-radius:14px;padding:12px;margin-bottom:10px}.cs-lv-card.st-live{border-color:#ff4d6a}.cs-lv-card.st-miss{opacity:.78}.cs-lv-ph{position:absolute;inset:0;display:grid;place-items:center;font-size:30px;color:#3a4b60}.cs-lv-body h3{margin:6px 0 4px;font-size:15.5px;line-height:1.3}.cs-lv-pill{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.3px;padding:3px 8px;border-radius:999px;background:#14202f;color:#cfe0f2}.cs-lv-pill.sch{background:#10263b;color:#8cc9ff}.cs-lv-pill.due{background:#3a2a08;color:#ffcf5c}.cs-lv-pill.live{background:#ff4d6a;color:#fff}.cs-lv-pill.end{background:#16222f;color:#b9c8d8}.cs-lv-pill.warn{background:#2c2410;color:#ffcf5c}.cs-lv-pill.miss{background:#2a1418;color:#ff9aa9}.cs-lv-extra{grid-column:1/-1;display:flex;flex-direction:column;gap:8px}.cs-lv-suggest{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;background:#0d1d17;border:1px solid #1d4a33;border-radius:10px;padding:8px 10px}.cs-lv-suggest b{color:#e6edf5}.cs-lv-suggest .cs-v-btn{padding:0 12px;height:30px}.cs-lv-pick{background:#08111b;border:1px solid #1d2c3e;border-radius:10px;padding:10px}.cs-lv-pick label{display:block;font-size:12px;font-weight:700;color:#a9b8c8;margin-bottom:6px}.cs-lv-pickrow{display:flex;gap:8px;flex-wrap:wrap}.cs-lv-pickrow select{flex:1 1 260px;min-width:0;height:34px;border-radius:9px;border:1px solid #223146;background:#0b131f;color:#e6edf5;padding:0 10px;font:inherit;font-size:13px}.cs-lv-pickrow .cs-v-btn{padding:0 14px}.cs-lv-pill.rep{margin-left:6px;background:#12301f;color:#a6ffd2}.cs-lv-eyes b{color:#e6edf5}.cs-lv-note a{color:#8cc9ff}.cs-lv-count{color:#8cc9ff;font-weight:700}.cs-lv-vis{text-transform:capitalize}.cs-lv-note{margin:6px 0 0;font-size:12.5px;color:#a9b8c8}.cs-lv-acts{display:flex;flex-direction:column;gap:7px}.cs-lv-foot{font-size:12px;color:#708399;margin:4px 0 0}.cs-lv-muted{color:#708399}@media(max-width:980px){.cs-lv-card{grid-template-columns:150px minmax(0,1fr)}.cs-lv-acts{grid-column:1/-1;flex-direction:row;flex-wrap:wrap}.cs-lv-acts .cs-v-btn{padding:0 12px}}@media(max-width:620px){.cs-lv-card{grid-template-columns:minmax(0,1fr)}}'
		. '.cs-cv-empty{padding:34px 12px;text-align:center;color:#708399;font-size:13.5px;border:1px dashed #26384c;border-radius:12px}'
		. '.cs-v-thumbed{display:flex;flex-direction:column;gap:9px;background:#08111b;border:1px solid #14202f;border-radius:12px;padding:12px;margin-bottom:12px}.cs-v-thumbed [hidden]{display:none!important}.cs-v-thumbed .lbl{font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#8798ac}'
		. '.cs-v-thumbrow{display:grid;grid-template-columns:200px minmax(0,1fr);gap:12px;align-items:start}.cs-v-thumbprev{position:relative;aspect-ratio:16/9;border-radius:9px;overflow:hidden;background:#06101a;border:1px solid #1d2c3e}.cs-v-thumbprev img{width:100%;height:100%;object-fit:cover;display:block}.cs-v-thumbprev .none{position:absolute;inset:0;display:grid;place-items:center;font-size:12px;color:#ff9aa8;text-align:center;padding:10px;line-height:1.35}.cs-v-thumbprev .new{position:absolute;left:6px;top:6px;font-size:10px;font-weight:800;letter-spacing:.3px;padding:3px 7px;border-radius:5px;background:#38f58a;color:#06120c}'
		. '.cs-v-thumbacts{display:flex;flex-direction:column;gap:7px}.cs-v-thumbacts .cs-v-btn{padding:0 12px}.cs-v-thumbacts small{font-size:11.5px;color:#708399;line-height:1.4}.cs-v-frame{display:flex;flex-direction:column;gap:8px}.cs-v-frame video{width:100%;max-height:280px;border-radius:9px;background:#000}.cs-v-frame input[type=range]{width:100%;accent-color:#38f58a}.cs-v-frame .row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:#a9b8c8}.cs-v-frame .row .cs-v-btn{padding:0 14px}.cs-v-thumbsave{display:flex;gap:8px;align-items:center}'
		. '@media(max-width:720px){.cs-v-thumbrow{grid-template-columns:minmax(0,1fr)}}'
		. '@media(max-width:980px){.cs-v{grid-template-columns:160px minmax(0,1fr)}.cs-v-seo{grid-column:1/-1;flex-direction:row;flex-wrap:wrap}.cs-v-seo .cs-v-score{flex:1 1 200px}.cs-v-detail{grid-template-columns:minmax(0,1fr)}}@media(max-width:720px){.cs-cv{padding:16px}.cs-v{grid-template-columns:minmax(0,1fr)}.cs-v-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}';
}
function sml_cv_script(): string {
	return <<<'JS'
(function(){
  'use strict';
  var cfg=window.smlCreatorVideosConfig||{};var root=document.getElementById('cs-videos');if(!root)return;
  var list=root.querySelector('[data-cv-list]'),tabsEl=root.querySelector('[data-cv-tabs]'),sum=root.querySelector('[data-cv-sum]');var data=null,tab='all',open={},pendingThumb={};
  function esc(v){var d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML;}
  function n(x){return Number(x||0).toLocaleString();}
  function hms(s){s=Math.max(0,s|0);var h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0');}
  function when(iso){var t=Date.parse(iso||'');return isNaN(t)?'':new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});}
  function col(p){return p>=85?'#38f58a':p>=70?'#9be15d':p>=50?'#ffb020':'#ff5c7a';}
  function rows(){if(!data)return [];var v=data.videos||[];if(tab==='public')return v.filter(function(x){return x.visibility==='public';});if(tab==='drafts')return v.filter(function(x){return x.visibility!=='public';});if(tab==='fix')return v.filter(function(x){return x.seo.score<85;});return v;}
  function paintTabs(){var v=(data&&data.videos)||[];var c={all:v.length,public:v.filter(function(x){return x.visibility==='public';}).length,drafts:v.filter(function(x){return x.visibility!=='public';}).length,fix:v.filter(function(x){return x.seo.score<85;}).length};
    sum.style.display=tab==='live'?'none':'';c.live=live?(live.live_now.length+live.upcoming.length+live.past.length):'…';tabsEl.innerHTML=[['all','All videos'],['public','Public'],['drafts','Drafts & private'],['fix','Needs SEO work'],['live','● Go live']].map(function(t){return '<button type="button" class="cs-cv-tab'+(tab===t[0]?' on':'')+(t[0]==='live'?' is-live':'')+'" data-cv-tab="'+t[0]+'">'+t[1]+'<b>'+c[t[0]]+'</b></button>';}).join('');
    var s=(data&&data.summary)||{};sum.innerHTML='<div><b>'+n(s.count)+'</b><span>videos on your Loop Channel</span></div><div><b>'+n(s.public)+'</b><span>public · '+n(s.inSitemap)+' in the video sitemap</span></div><div><b>'+n(s.views)+'</b><span>lifetime views</span></div><div><b style="color:'+col(s.avgSeo||0)+'">'+(s.avgSeo||0)+'</b><span>average SEO score</span></div>';}
  function card(v){var s=v.stats||{},seo=v.seo||{},o=!!open[v.id];
    var chips=(v.ticker?'<span class="t">$'+esc(v.ticker)+'</span>':'')+(v.tags||[]).slice(0,6).map(function(t){return '<span>'+esc(t)+'</span>';}).join('')+(v.hashtags||[]).slice(0,4).map(function(t){return '<span>'+esc(t)+'</span>';}).join('');
    return '<article class="cs-v" data-id="'+esc(v.id)+'">'
      +'<a class="cs-v-thumb" href="'+esc(v.url)+'" target="_blank" rel="noopener">'+(v.thumbnail?'<img src="'+esc(v.thumbnail)+'" alt="" loading="lazy">':'')+'<span class="vis '+esc(v.visibility)+'">'+esc(v.visibility||'draft')+'</span>'+(v.duration?'<i>'+hms(v.duration)+'</i>':'')+'</a>'
      +'<div><h3><a href="'+esc(v.url)+'" target="_blank" rel="noopener">'+esc(v.title||'Untitled video')+'</a></h3>'
      +'<div class="cs-v-meta"><span>Published <b>'+esc(when(v.created_at)||'—')+'</b></span>'+(v.updated_at?'<span>Updated <b>'+esc(when(v.updated_at))+'</b></span>':'')+(v.seo_title?'<span>SEO title <b>'+esc(v.seo_title)+'</b></span>':'<span style="color:#ffb020">No SEO title</span>')+'</div>'
      +'<p class="cs-v-desc">'+esc(v.description||'No description yet — this is what Google shows under the title.')+'</p>'
      +(chips?'<div class="cs-v-chips">'+chips+'</div>':'')
      +'<div class="cs-v-stats"><div><b>'+n(s.views)+'</b><span>views · '+n(s.views7)+' last 7d</span></div><div><b>'+n(s.impressions)+'</b><span>impressions · '+n(s.impressions7)+' 7d</span></div><div><b>'+(s.ctr||0)+'%</b><span>click-through</span></div><div><b>'+n(s.comments)+' / '+n(s.likes)+'</b><span>comments / likes</span></div></div></div>'
      +'<div class="cs-v-seo"><div class="cs-v-score"><div class="cs-v-ring" style="--p:'+(seo.score|0)+';--c:'+col(seo.score|0)+'"><b>'+esc(seo.grade)+'</b></div><div><strong>SEO '+(seo.score|0)+'/100</strong><small>'+(seo.inSitemap?'In the video sitemap':'Not in the sitemap')+(seo.schema&&seo.schema.checked?(seo.schema.schema?' · schema ✓':' · no schema'):'')+'</small></div></div>'
      +'<button type="button" class="cs-v-btn primary" data-open="'+esc(v.id)+'">'+(o?'Close':'✎ Metadata & SEO')+'</button>'
      +'<a class="cs-v-btn" href="'+esc(v.links.google)+'" target="_blank" rel="noopener">Google index check ↗</a><a class="cs-v-btn" href="'+esc(v.links.bing)+'" target="_blank" rel="noopener">Bing index check ↗</a>'
      +'<button type="button" class="cs-v-btn" data-index="'+esc(v.id)+'"'+(v.visibility==='public'?'':' disabled title="Public videos only"')+'>Request indexing</button><div class="cs-v-note" data-note="'+esc(v.id)+'"></div></div>'
      +(o?detail(v):'')+'</article>';}
  function detail(v){var seo=v.seo||{};
    var checks=(seo.checks||[]).map(function(c){return '<div class="cs-v-check '+c.status+'"><i>'+(c.status==='pass'?'✓':c.status==='warn'?'!':'✕')+'</i><div>'+esc(c.label)+(c.status!=='pass'?'<small>'+esc(c.tip)+'</small>':'')+'</div><em>'+esc(c.value||'')+'</em></div>';}).join('');
    return '<div class="cs-v-detail"><div><div style="font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#8798ac;margin-bottom:8px">SEO audit · '+(seo.fixes&&seo.fixes.length?seo.fixes.length+' thing'+(seo.fixes.length>1?'s':'')+' to fix':'all clear')+'</div><div class="cs-v-checks">'+checks+'</div></div>'
      +'<div>'+thumbEditor(v)+'<form class="cs-v-form" data-form="'+esc(v.id)+'"><div style="font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#8798ac">Edit metadata</div>'
      +'<label>Title</label><input name="title" maxlength="160" value="'+esc(v.title)+'"><div class="cnt" data-cnt="title"></div>'
      +'<label>SEO title (search result headline, ≤60)</label><input name="seo_title" maxlength="120" value="'+esc(v.seo_title)+'" placeholder="$'+esc(v.ticker||'TICKER')+' — what the viewer learns | StockMarketLoop"><div class="cnt" data-cnt="seo_title"></div>'
      +'<label>Description (120+ characters, mention the tickers)</label><textarea name="description">'+esc(v.description)+'</textarea><div class="cnt" data-cnt="description"></div>'
      +'<div class="row"><div><label>Main ticker</label><input name="ticker" value="'+esc(v.ticker)+'" placeholder="NVDA"></div><div><label>Visibility</label><select name="visibility">'+['public','unlisted','members','premium','private','draft'].map(function(x){return '<option value="'+x+'"'+(v.visibility===x?' selected':'')+'>'+x+'</option>';}).join('')+'</select></div></div>'
      +'<label>Tags (comma separated)</label><input name="tags" value="'+esc((v.tags||[]).join(', '))+'" placeholder="NVDA, semiconductors, earnings play">'
      +'<label>Hashtags</label><input name="hashtags" value="'+esc((v.hashtags||[]).join(' '))+'" placeholder="#NVDA #Earnings">'
      +'<div style="display:flex;gap:8px;align-items:center"><button type="submit" class="cs-v-btn primary" style="padding:0 16px">Save metadata</button><a class="cs-v-btn" style="padding:0 12px" href="'+esc(v.links.edit_studio)+'">Open Upload Studio</a><span class="cs-v-note" data-fnote="'+esc(v.id)+'"></span></div></form></div></div>';}
  /* ---------- thumbnail editor (1.3.0): upload an image or capture a frame from the video ---------- */
  var NOTHUMB='<span class="none">No thumbnail — Google can’t list this video without one</span>';
  function thumbInner(v,p){var src=p?p.url:(v&&v.thumbnail);return (src?'<img src="'+esc(src)+'" alt="">':NOTHUMB)+(p?'<span class="new">New · not saved</span>':'');}
  function thumbEditor(v){var p=pendingThumb[v.id],can=!!v.video_url;
    return '<div class="cs-v-thumbed" data-thumbed="'+esc(v.id)+'"><div class="lbl">Thumbnail</div>'
      +'<div class="cs-v-thumbrow"><div class="cs-v-thumbprev">'+thumbInner(v,p)+'</div>'
      +'<div class="cs-v-thumbacts"><label class="cs-v-btn" style="cursor:pointer">⬆ Upload an image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-thumbfile="'+esc(v.id)+'" hidden></label>'
      +(can?'<button type="button" class="cs-v-btn" data-frameopen="'+esc(v.id)+'">🎞 Pick a frame from the video</button>':'')
      +'<small>16:9 at 1280×720 looks best. JPG, PNG, WebP or GIF, at least 320×180.</small></div></div>'
      +(can?'<div class="cs-v-frame" data-frame="'+esc(v.id)+'" hidden><video crossorigin="anonymous" muted playsinline preload="none" data-src="'+esc(v.video_url)+'"></video><input type="range" data-frameseek min="0" max="'+Math.max(1,v.duration|0)+'" step="0.1" value="0" aria-label="Scrub the video to choose a frame"><div class="row"><span data-frametime>0:00</span><button type="button" class="cs-v-btn" data-frameuse>Use this frame</button></div></div>':'')
      +'<div class="cs-v-thumbsave" data-thumbsave'+(p?'':' hidden')+'><button type="button" class="cs-v-btn primary" data-thumbsavebtn="'+esc(v.id)+'" style="padding:0 16px">Save thumbnail</button><button type="button" class="cs-v-btn" data-thumbcancel="'+esc(v.id)+'" style="padding:0 12px">Cancel</button></div>'
      +'<div class="cs-v-note" data-tnote="'+esc(v.id)+'"></div></div>';}
  function thumbBox(id){return list.querySelector('[data-thumbed="'+CSS.escape(id)+'"]');}
  function tnote(id,t,err){var el=list.querySelector('[data-tnote="'+CSS.escape(id)+'"]');if(el){el.textContent=t;el.className='cs-v-note'+(err?' err':'');}}
  function refreshThumb(id){var box=thumbBox(id);if(!box)return;var p=pendingThumb[id];box.querySelector('.cs-v-thumbprev').innerHTML=thumbInner(find(id),p);box.querySelector('[data-thumbsave]').hidden=!p;}
  function setPending(id,blob,name){if(pendingThumb[id])URL.revokeObjectURL(pendingThumb[id].url);pendingThumb[id]={blob:blob,name:name,url:URL.createObjectURL(blob)};refreshThumb(id);tnote(id,'Preview only — press Save thumbnail to publish it.');}
  function dropPending(id){if(pendingThumb[id]){URL.revokeObjectURL(pendingThumb[id].url);delete pendingThumb[id];}}
  function recount(){var sc=data.videos.map(function(v){return v.seo.score;});data.summary.avgSeo=sc.length?Math.round(sc.reduce(function(a,b){return a+b;},0)/sc.length):0;data.summary.public=data.videos.filter(function(v){return v.visibility==='public';}).length;data.summary.inSitemap=data.videos.filter(function(v){return v.seo.inSitemap;}).length;}
  list.addEventListener('change',function(e){var inp=e.target.closest('[data-thumbfile]');if(!inp||!inp.files||!inp.files[0])return;var id=inp.getAttribute('data-thumbfile'),f=inp.files[0];inp.value='';
    if(!/^image\/(jpeg|png|webp|gif)$/.test(f.type)){tnote(id,'Use a JPG, PNG, WebP or GIF image.',true);return;}
    if(f.size>50*1024*1024){tnote(id,'That image is over 50 MB.',true);return;}
    setPending(id,f,f.name);});
  list.addEventListener('input',function(e){var r=e.target.closest('[data-frameseek]');if(!r)return;var v=r.closest('[data-frame]').querySelector('video');if(v.readyState>=1)v.currentTime=Number(r.value);});
  list.addEventListener('click',function(e){
    var fo=e.target.closest('[data-frameopen]');
    if(fo){var box=list.querySelector('[data-frame="'+CSS.escape(fo.getAttribute('data-frameopen'))+'"]');if(!box)return;box.hidden=!box.hidden;var vid=box.querySelector('video');
      if(!box.hidden&&!vid.getAttribute('src')){var seek=box.querySelector('[data-frameseek]'),tm=box.querySelector('[data-frametime]');
        vid.addEventListener('loadedmetadata',function(){if(isFinite(vid.duration)&&vid.duration>0){seek.max=vid.duration;vid.currentTime=Math.min(3,vid.duration/10);}});
        vid.addEventListener('seeked',function(){tm.textContent=hms(vid.currentTime);seek.value=vid.currentTime;});
        vid.preload='auto';vid.src=vid.getAttribute('data-src');}
      return;}
    var fu=e.target.closest('[data-frameuse]');
    if(fu){var fb=fu.closest('[data-frame]'),fid=fb.getAttribute('data-frame'),fv=fb.querySelector('video');
      if(!fv.videoWidth){tnote(fid,'The video is still loading — try again in a moment.',true);return;}
      try{var w=Math.min(1920,fv.videoWidth),h=Math.round(w*fv.videoHeight/fv.videoWidth),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(fv,0,0,w,h);
        c.toBlob(function(b){if(!b){tnote(fid,'Could not capture that frame.',true);return;}setPending(fid,b,'frame-'+Math.round(fv.currentTime)+'s.jpg');},'image/jpeg',0.9);}
      catch(err){tnote(fid,'This video can’t be captured here — upload an image instead.',true);}
      return;}
    var sv=e.target.closest('[data-thumbsavebtn]');
    if(sv){var sid=sv.getAttribute('data-thumbsavebtn'),p=pendingThumb[sid];if(!p)return;sv.disabled=true;tnote(sid,'Uploading…');var fd=new FormData();fd.append('id',sid);fd.append('thumbnail',p.blob,p.name||'thumbnail.jpg');
      fetch(cfg.thumb,{method:'POST',credentials:'same-origin',headers:{'X-WP-Nonce':cfg.nonce||''},body:fd}).then(function(r){return r.json().then(function(j){if(!r.ok||j.code)throw new Error(j.message||'Could not save the thumbnail.');return j;});})
        .then(function(j){dropPending(sid);var i=data.videos.findIndex(function(v){return v.id===sid;});if(i>-1)data.videos[i]=j.video;recount();paintTabs();paint();tnote(sid,'Thumbnail saved. SEO score now '+j.video.seo.score+'/100.');})
        .catch(function(err){sv.disabled=false;tnote(sid,err.message,true);});
      return;}
    var cc=e.target.closest('[data-thumbcancel]');
    if(cc){var cid=cc.getAttribute('data-thumbcancel');dropPending(cid);refreshThumb(cid);tnote(cid,'');}});
  function counters(form){var f=form;[['title',30,70],['seo_title',1,60],['description',120,5000]].forEach(function(x){var el=f.querySelector('[name="'+x[0]+'"]'),c=f.querySelector('[data-cnt="'+x[0]+'"]');if(!el||!c)return;var L=el.value.trim().length;c.textContent=L+' chars'+(L<x[1]?' · aim for '+x[1]+'+':L>x[2]?' · over '+x[2]:' · good');c.className='cnt '+(L>=x[1]&&L<=x[2]?'ok':'bad');});}
  function paint(){if(tab==='live'){paintLive();return;}var s=rows();if(!s.length){list.innerHTML='<div class="cs-cv-empty">'+(data?(tab==='all'?'No videos on your Loop Channel yet. Upload your first video and it shows up here with its SEO audit.':'Nothing in this view.'):'Loading…')+'</div>';return;}
    list.innerHTML=s.map(card).join('');Array.prototype.forEach.call(list.querySelectorAll('form[data-form]'),function(f){counters(f);f.addEventListener('input',function(){counters(f);});});}
  function find(id){return ((data&&data.videos)||[]).filter(function(v){return v.id===id;})[0];}
  function note(id,t,err,fn){var el=list.querySelector('['+(fn?'data-fnote':'data-note')+'="'+CSS.escape(id)+'"]');if(el){el.textContent=t;el.className='cs-v-note'+(err?' err':'');}}
  function post(url,body){return fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-WP-Nonce':cfg.nonce||''},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){if(!r.ok||j.code)throw new Error(j.message||'That did not work.');return j;});});}
  list.addEventListener('click',function(e){var b=e.target.closest('[data-open],[data-index]');if(!b)return;
    if(b.hasAttribute('data-open')){var id=b.getAttribute('data-open');open[id]=!open[id];paint();return;}
    var vid=b.getAttribute('data-index');b.disabled=true;note(vid,'Requesting…');
    post(cfg.index,{id:vid}).then(function(j){note(vid,'Requested · '+(j.did||[]).join(' · ')+'. '+(j.note||''));}).catch(function(err){b.disabled=false;note(vid,err.message,true);});});
  list.addEventListener('submit',function(e){var f=e.target.closest('form[data-form]');if(!f)return;e.preventDefault();var id=f.getAttribute('data-form');var body={id:id};['title','seo_title','description','ticker','visibility','tags','hashtags'].forEach(function(k){var el=f.querySelector('[name="'+k+'"]');if(el)body[k]=el.value;});
    note(id,'Saving…',false,true);post(cfg.update,body).then(function(j){var i=data.videos.findIndex(function(v){return v.id===id;});if(i>-1)data.videos[i]=j.video;var sc=data.videos.map(function(v){return v.seo.score;});data.summary.avgSeo=sc.length?Math.round(sc.reduce(function(a,b){return a+b;},0)/sc.length):0;data.summary.public=data.videos.filter(function(v){return v.visibility==='public';}).length;data.summary.inSitemap=data.videos.filter(function(v){return v.seo.inSitemap;}).length;paintTabs();paint();note(id,(j.changed&&j.changed.length?'Saved: '+j.changed.join(', ')+'. SEO score now '+j.video.seo.score+'/100.':'Nothing changed.'),false,true);}).catch(function(err){note(id,err.message,true,true);});});
  function load(fresh){if(!data)list.innerHTML='<div class="cs-cv-empty">Loading your videos and running the SEO audit…</div>';
    fetch(cfg.endpoint+(fresh?'?fresh=1':''),{credentials:'same-origin',cache:'no-store',headers:{'X-WP-Nonce':cfg.nonce||''}}).then(function(r){return r.json().then(function(j){if(!r.ok||j.code)throw new Error(j.message||'Could not load videos.');return j;});})
      .then(function(j){data=j;paintTabs();paint();}).catch(function(e){list.innerHTML='<div class="cs-cv-empty">'+esc(e.message)+'</div>';});}
  tabsEl.addEventListener('click',function(e){var b=e.target.closest('[data-cv-tab]');if(!b)return;tab=b.getAttribute('data-cv-tab');paintTabs();paint();try{history.replaceState(null,'',tab==='live'?'#live':location.pathname+location.search)}catch(x){}});
  var rf=root.querySelector('[data-cv-refresh]');if(rf)rf.addEventListener('click',function(e){e.preventDefault();data=null;load(true);});
  var dr=root.querySelector('[data-cv-drafts]');if(dr)dr.addEventListener('click',function(e){e.preventDefault();tab='drafts';paintTabs();paint();});
  /* ---------- Go live tab: live now, upcoming scheduled streams, past streams ---------- */
  var live=null,liveErr='';
  function dt(iso){var t=Date.parse(iso||'');return isNaN(t)?'':new Date(t).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
  function dur(s){s=s|0;if(!s)return'';var h=Math.floor(s/3600),m=Math.round(s%3600/60);return h?h+'h '+m+'m':(m||1)+'m';}
  function until(iso){var t=Date.parse(iso||'')-Date.now();if(isNaN(t))return'';if(t<=0)return'starting now';var d=Math.floor(t/864e5),h=Math.floor(t%864e5/36e5),m=Math.floor(t%36e5/6e4);return 'in '+(d?d+'d '+h+'h':h?h+'h '+m+'m':m+'m');}
  var LSTATE={upcoming:['Scheduled','sch'],due:['Starting now','due'],live:['● Live now','live'],ended:['Ended','end'],unclosed:['Ended · not closed','warn'],missed:['Didn’t go live','miss']};
  function studio(s){var u=String(s.watch_url||''),m=u.match(/\/live\/([^\/?#]+)\/([^\/?#]+)/);if(m)return '/go-live/'+m[1]+'/'+m[2]+'/';return /^[A-Za-z0-9]{8,32}$/.test(String(s.id||''))&&String(s.id).indexOf('room-')!==0?'/go-live/'+encodeURIComponent(s.handle||'me')+'/'+s.id+'/':live.links.go_live;}
  function liveCard(s){var st=LSTATE[s.state]||['',''],meta=[],acts=[],note='';
    if(s.state==='upcoming'||s.state==='due'){meta.push('<span>'+(s.state==='due'?'Was set for ':'Starts ')+'<b>'+esc(dt(s.scheduled_at))+'</b></span>');if(s.state==='upcoming')meta.push('<span class="cs-lv-count" data-until="'+esc(s.scheduled_at)+'">'+esc(until(s.scheduled_at))+'</span>');}
    else if(s.state==='missed'){meta.push('<span>Was scheduled for <b>'+esc(dt(s.scheduled_at))+'</b></span>');note='This stream never started, so there is nothing to replay.';}
    else{meta.push('<span>'+(s.state==='live'?'Went live ':'Streamed ')+'<b>'+esc(dt(s.started_at||s.scheduled_at))+'</b></span>');if(s.duration)meta.push('<span>Length <b>'+esc(dur(s.duration))+'</b></span>');else if(s.state==='ended')meta.push('<span class="cs-lv-muted">Length not recorded</span>');if(s.state==='unclosed')note='It was never ended from the Go Live studio, so its length wasn’t recorded.';}
    meta.push('<span>'+esc(s.where)+'</span>');meta.push('<span class="cs-lv-vis">'+esc(s.visibility)+'</span>');
    if(s.chat&&s.chat.messages)meta.push('<span><b>'+n(s.chat.messages)+'</b> chat message'+(s.chat.messages===1?'':'s')+' · '+n(s.chat.chatters)+' chatter'+(s.chat.chatters===1?'':'s')+'</span>');
    if(s.state==='upcoming'||s.state==='due'){if(s.watch_url){acts.push('<a class="cs-v-btn primary" href="'+esc(s.watch_url)+'" target="_blank" rel="noopener">Open watch page ↗</a>');acts.push('<button type="button" class="cs-v-btn" data-copy="'+esc(s.watch_url)+'">Copy link</button>');}acts.push('<a class="cs-v-btn" href="'+esc(studio(s))+'">'+(s.state==='due'?'● Go live now':'Manage in Go Live')+'</a>');}
    else if(s.state==='live'){if(s.watch_url)acts.push('<a class="cs-v-btn primary" href="'+esc(s.watch_url)+'" target="_blank" rel="noopener">Open watch page ↗</a>');acts.push('<a class="cs-v-btn" href="'+esc(studio(s))+'">Open Go Live studio</a>');}
    var vw=s.viewers;
    if(vw&&vw.tracked){if(s.state==='live')meta.push('<span class="cs-lv-eyes"><b>'+n(vw.now)+'</b> watching now · peak '+n(vw.peak)+'</span>');else meta.push('<span class="cs-lv-eyes">Peak <b>'+n(vw.peak)+'</b> viewer'+(vw.peak===1?'':'s')+' · '+n(vw.unique)+' unique</span>');}
    else if(s.state!=='missed'&&s.state!=='upcoming'&&s.state!=='due'&&s.id.indexOf('room-')!==0)meta.push('<span class="cs-lv-muted">Viewers not tracked for this stream</span>');
    var extra='';
    if(s.state!=='upcoming'&&s.state!=='due'&&s.state!=='live'&&s.state!=='missed'){
      if(s.replay)acts.push('<a class="cs-v-btn primary" href="'+esc(s.replay.url)+'" target="_blank" rel="noopener">▶ Watch replay</a><button type="button" class="cs-v-btn" data-pick="'+esc(s.id)+'">Change replay</button>');
      else{
        if(s.watch_url)acts.push('<a class="cs-v-btn" href="'+esc(s.watch_url)+'" target="_blank" rel="noopener">'+(s.visibility==='group'?'Group page ↗':'Stream page ↗')+'</a>');
        if((live.videos||[]).length)acts.push('<button type="button" class="cs-v-btn" data-pick="'+esc(s.id)+'">🔗 Pick the replay</button>');
        acts.push('<a class="cs-v-btn" href="'+esc(live.links.upload)+'">⬆ Upload the replay</a>');
        var c=(s.candidates||[])[0];
        if(c&&c.score>=0.35)extra='<div class="cs-lv-suggest">Is this the replay? <b>'+esc(c.title)+'</b><button type="button" class="cs-v-btn primary" data-link="'+esc(s.id)+'" data-video="'+esc(c.id)+'">Link it</button></div>';
      }
      if(pickOpen===s.id)extra+=pickerHtml(s);
    }
    return '<article class="cs-lv-card st-'+st[1]+'" data-stream="'+esc(s.id)+'"><div class="cs-v-thumb">'+(s.thumbnail?'<img src="'+esc(s.thumbnail)+'" alt="" loading="lazy">':'<span class="cs-lv-ph">◉</span>')+'</div>'
      +'<div class="cs-lv-body"><span class="cs-lv-pill '+st[1]+'">'+esc(st[0])+'</span>'+(s.replay?'<span class="cs-lv-pill rep">▶ Replay linked</span>':'')+'<h3>'+esc(s.title)+'</h3><div class="cs-v-meta">'+meta.join('')+'</div>'+(note?'<p class="cs-lv-note">'+esc(note)+'</p>':'')+(s.replay&&s.replay.title?'<p class="cs-lv-note">Replay: <a href="'+esc(s.replay.url)+'" target="_blank" rel="noopener">'+esc(s.replay.title)+'</a></p>':'')+'</div>'
      +'<div class="cs-lv-acts">'+acts.join('')+'<div class="cs-v-note" data-copied></div></div>'+(extra?'<div class="cs-lv-extra">'+extra+'</div>':'')+'</article>';}
  var pickOpen='';
  function pickerHtml(s){var cur=s.replay&&s.replay.id||'',cands={};(s.candidates||[]).forEach(function(c){cands[c.id]=1;});
    var opts=(live.videos||[]).map(function(v){return '<option value="'+esc(v.id)+'"'+(v.id===cur?' selected':'')+'>'+(cands[v.id]?'★ ':'')+esc(v.title)+' · '+esc(when(v.created_at))+'</option>';}).join('');
    return '<form class="cs-lv-pick" data-pickform="'+esc(s.id)+'"><label for="pk-'+esc(s.id)+'">Which of your videos is the replay of this stream?</label><div class="cs-lv-pickrow"><select id="pk-'+esc(s.id)+'" name="video">'+(cur?'':'<option value="">Choose a video…</option>')+opts+'</select><button type="submit" class="cs-v-btn primary">Save</button>'+(cur?'<button type="button" class="cs-v-btn" data-unlink="'+esc(s.id)+'">Remove replay</button>':'')+'<button type="button" class="cs-v-btn" data-pickclose>Cancel</button></div><div class="cs-v-note" data-picknote></div></form>';}
  function saveReplay(stream,video,noteEl){if(noteEl){noteEl.textContent='Saving…';noteEl.className='cs-v-note';}
    return fetch(cfg.live+'/replay',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-WP-Nonce':cfg.nonce||''},body:JSON.stringify({stream_id:stream,video_id:video})})
      .then(function(r){return r.json().then(function(j){if(!r.ok||j.code)throw new Error(j.message||'Could not save the replay.');return j;});})
      .then(function(j){live=j.live;pickOpen='';paintTabs();paint();var card=list.querySelector('[data-stream="'+CSS.escape(stream)+'"] [data-copied]');if(card)card.textContent=video?'Replay linked.':'Replay removed.';})
      .catch(function(e){if(noteEl){noteEl.textContent=e.message;noteEl.className='cs-v-note err';}else alert(e.message);});}
  function liveSection(title,items,empty){return '<section class="cs-lv-sec"><h2>'+esc(title)+' <b>'+items.length+'</b></h2>'+(items.length?items.map(liveCard).join(''):'<div class="cs-cv-empty">'+empty+'</div>')+'</section>';}
  function paintLive(){
    if(!live){list.innerHTML='<div class="cs-cv-empty">'+(liveErr?esc(liveErr):'Loading your live streams…')+'</div>';return;}
    var s=live.summary||{};
    var h='<div class="cs-lv-bar"><div><b>Go live</b><span>Start a stream now or schedule one. A scheduled stream gets its own watch page and countdown right away.</span></div><div class="cs-lv-go"><a class="cs-v-btn primary" href="'+esc(live.links.go_live)+'">● Go live now</a><a class="cs-v-btn" href="'+esc(live.links.go_live)+'">📅 Schedule a stream</a></div></div>'
      +'<div class="cs-cv-sum"><div><b>'+n(s.upcoming)+'</b><span>upcoming'+(s.next?' · next '+esc(until(s.next)):'')+'</span></div><div><b>'+n(s.past)+'</b><span>past streams</span></div><div><b>'+(!s.minutes?'—':s.minutes>=60?Math.floor(s.minutes/60)+'h '+(s.minutes%60)+'m':n(s.minutes)+'m')+'</b><span>streamed (recorded lengths)</span></div><div><b>'+n(s.chat)+'</b><span>live chat messages</span></div><div><b>'+(s.peak?n(s.peak):'—')+'</b><span>best peak viewers</span></div></div>';
    if(live.live_now.length)h+=liveSection('Live now',live.live_now,'');
    h+=liveSection('Upcoming',live.upcoming,'No streams scheduled. Schedule one in Go Live and it shows here with a countdown.');
    h+=liveSection('Past streams',live.past,'No past live streams yet. When you go live, each stream shows up here.');
    if(live.cancelled)h+='<p class="cs-lv-foot">'+n(live.cancelled)+' cancelled stream'+(live.cancelled===1?' is':'s are')+' not shown.</p>';
    list.innerHTML='<div class="cs-lv">'+h+'</div>';}
  function loadLive(){fetch(cfg.live,{credentials:'same-origin',cache:'no-store',headers:{'X-WP-Nonce':cfg.nonce||''}}).then(function(r){return r.json().then(function(j){if(!r.ok||j.code)throw new Error(j.message||'Could not load your live streams.');return j;});})
    .then(function(j){live=j;liveErr='';paintTabs();if(tab==='live')paint();}).catch(function(e){liveErr=e.message;if(tab==='live')paint();});}
  function showLive(where){tab='live';paintTabs();paint();try{history.replaceState(null,'','#live')}catch(x){}
    var el=where==='past'?list.querySelector('.cs-lv-sec:last-of-type'):null;(el||tabsEl).scrollIntoView({behavior:'smooth',block:'start'});}
  setInterval(function(){if(tab!=='live')return;Array.prototype.forEach.call(list.querySelectorAll('[data-until]'),function(e){e.textContent=until(e.getAttribute('data-until'));});},30000);
  list.addEventListener('click',function(e){
    var p=e.target.closest('[data-pick]');if(p){pickOpen=pickOpen===p.getAttribute('data-pick')?'':p.getAttribute('data-pick');paint();var sel=list.querySelector('[data-pickform] select');if(sel)sel.focus();return;}
    if(e.target.closest('[data-pickclose]')){pickOpen='';paint();return;}
    var l=e.target.closest('[data-link]');if(l){l.disabled=true;saveReplay(l.getAttribute('data-link'),l.getAttribute('data-video'),null);return;}
    var u=e.target.closest('[data-unlink]');if(u){saveReplay(u.getAttribute('data-unlink'),'',u.closest('form').querySelector('[data-picknote]'));}});
  list.addEventListener('submit',function(e){var f=e.target.closest('[data-pickform]');if(!f)return;e.preventDefault();var v=f.querySelector('select').value;var note=f.querySelector('[data-picknote]');if(!v){note.textContent='Choose a video first.';note.className='cs-v-note err';return;}saveReplay(f.getAttribute('data-pickform'),v,note);});
  list.addEventListener('click',function(e){var c=e.target.closest('[data-copy]');if(!c)return;var url=c.getAttribute('data-copy'),out=c.parentNode.querySelector('[data-copied]');
    (navigator.clipboard?navigator.clipboard.writeText(url):Promise.reject()).then(function(){if(out)out.textContent='Link copied.';}).catch(function(){if(out)out.textContent=url;});});
  root.addEventListener('click',function(e){var b=e.target.closest('[data-cv-live]');if(!b)return;e.preventDefault();showLive(b.getAttribute('data-cv-live'));});
  if(location.hash==='#live'||/[?&]view=live\b/.test(location.search))tab='live';
  load(false);loadLive();
  var rf2=root.querySelector('[data-cv-refresh]');if(rf2)rf2.addEventListener('click',function(){live=null;loadLive();});
})();
JS;
}
function sml_cv_render_page(): void {
	status_header( 200 ); nocache_headers();
	header( 'Content-Type: text/html; charset=' . get_bloginfo( 'charset' ) );
	$uid = get_current_user_id();
	echo '<!doctype html><html ' . get_language_attributes() . '><head><meta charset="' . esc_attr( get_bloginfo( 'charset' ) ) . '"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Videos - Creator Studio - ' . esc_html( get_bloginfo( 'name' ) ) . '</title><style>' . ( function_exists( 'sml_cs_styles' ) ? sml_cs_styles() : '' ) . sml_cv_styles() . '</style></head><body>';
	if ( ! $uid ) {
		echo '<div class="cs-gate"><h1>Sign in to Creator Studio</h1><p>Your videos are available after you sign in.</p><a class="cs-btn cs-btn-primary" href="' . esc_url( wp_login_url( home_url( '/creator-studio/videos/' ) ) ) . '">Sign in</a></div></body></html>';
		exit;
	}
	echo '<div class="cs-shell">';
	if ( function_exists( 'sml_cs_render_sidebar' ) ) { sml_cs_render_sidebar( 'videos', false ); }
	echo '<div class="cs-main"><header class="cs-top"><div class="cs-crumb">Creator Studio<span>/</span><b>Videos</b></div><div class="cs-autosave">Live library + SEO audit</div><a class="cs-top-btn" href="#" data-cv-refresh>Refresh</a></header>';
	echo '<section class="cs-cv" id="cs-videos" aria-label="Videos">';
	echo '<div class="cs-cv-head"><div><h1>Videos</h1><p class="cs-cv-sub">Every video on your Loop Channel with its metadata, how it performs and an SEO audit for Google and Bing: title and description length, ticker keyword, tags, thumbnail, indexability, the video sitemap and the VideoObject schema on the watch page. Fix metadata right here and request indexing.</p></div></div>';
	echo '<div class="cs-cv-actions"><a class="primary" href="' . esc_url( home_url( '/upload-video/' ) ) . '">⬆ Upload video</a><button type="button" data-cv-live="top">● Go live</button><button type="button" data-cv-drafts>Drafts &amp; private</button><button type="button" data-cv-live="past">Live replays</button></div>';
	echo '<div class="cs-cv-sum" data-cv-sum></div><div class="cs-cv-tabs" data-cv-tabs></div><div class="cs-cv-list" data-cv-list></div>';
	echo '</section></div></div>';
	echo '<script>window.smlCreatorVideosConfig=' . wp_json_encode( array( 'endpoint' => esc_url_raw( rest_url( SML_CV_NS . '/list' ) ), 'update' => esc_url_raw( rest_url( SML_CV_NS . '/update' ) ), 'index' => esc_url_raw( rest_url( SML_CV_NS . '/request-index' ) ), 'thumb' => esc_url_raw( rest_url( SML_CV_NS . '/thumbnail' ) ), 'live' => esc_url_raw( rest_url( SML_CV_NS . '/live' ) ), 'nonce' => wp_create_nonce( 'wp_rest' ) ) ) . ';</script><script>' . sml_cv_script() . '</script></body></html>';
	exit;
}
add_action( 'template_redirect', function () {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return; }
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	if ( 'creator-studio/videos' !== $path ) { return; }
	sml_cv_render_page();
}, 0 );
