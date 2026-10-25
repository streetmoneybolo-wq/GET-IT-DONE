<?php
/**
 * Health checks: what is off, slow or quietly broken, checked from the outside the way a visitor or a crawler meets it.
 * Runs hourly from cron and on demand from the panel. Every fetch is bounded (8 s), the whole run is bounded (about 60 s),
 * and the result is one array in an option: id, title, status (ok|warn|fail), detail, fix, ms.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_wd_http( $url, $args = array() ) {
	$t0 = microtime( true );
	$r = wp_remote_get( $url, array_merge( array( 'timeout' => 8, 'redirection' => 3, 'user-agent' => 'Mozilla/5.0 (compatible; SML-Website-Dev/' . SML_WD_VERSION . '; +' . home_url( '/' ) . ')', 'headers' => array( 'Accept' => 'text/html,application/xml,application/json;q=0.9,*/*;q=0.8' ) ), $args ) );
	$ms = (int) round( ( microtime( true ) - $t0 ) * 1000 );
	if ( is_wp_error( $r ) ) { return array( 'ok' => false, 'status' => 0, 'ms' => $ms, 'body' => '', 'error' => $r->get_error_message(), 'headers' => array() ); }
	return array( 'ok' => true, 'status' => (int) wp_remote_retrieve_response_code( $r ), 'ms' => $ms, 'body' => (string) wp_remote_retrieve_body( $r ), 'headers' => wp_remote_retrieve_headers( $r ), 'error' => '' );
}
function sml_wd_locs( $xml ) { preg_match_all( '~<loc>\s*([^<\s]+)\s*</loc>~', (string) $xml, $m ); return array_values( array_unique( $m[1] ) ); }
function sml_wd_html_robots( $html ) { preg_match_all( '~<meta[^>]+name=["\']robots["\'][^>]*content=["\']([^"\']+)["\']~i', (string) $html, $m ); if ( ! $m[1] ) { preg_match_all( '~<meta[^>]+content=["\']([^"\']+)["\'][^>]*name=["\']robots["\']~i', (string) $html, $m ); } return $m[1]; }
function sml_wd_html_canonical( $html ) { return preg_match( '~<link[^>]+rel=["\']canonical["\'][^>]*href=["\']([^"\']+)["\']~i', (string) $html, $m ) ? $m[1] : ''; }
function sml_wd_html_ld_types( $html ) {
	$types = array();
	if ( preg_match_all( '~<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>~is', (string) $html, $m ) ) {
		foreach ( $m[1] as $json ) { $d = json_decode( trim( $json ), true ); if ( ! is_array( $d ) ) { $types[] = 'INVALID'; continue; } $items = isset( $d['@graph'] ) ? $d['@graph'] : array( $d ); foreach ( $items as $it ) { if ( isset( $it['@type'] ) ) { foreach ( (array) $it['@type'] as $t ) { $types[] = (string) $t; } } } }
	}
	return array_values( array_unique( $types ) );
}

function sml_wd_run_checks( $reason = 'manual' ) {
	if ( get_transient( 'sml_wd_checks_lock' ) ) { return get_option( 'sml_wd_checks', array() ); }
	set_transient( 'sml_wd_checks_lock', 1, 120 );
	if ( function_exists( 'set_time_limit' ) ) { @set_time_limit( 150 ); }
	$t0 = microtime( true ); $deadline = $t0 + 75;
	$rows = array(); $settings = sml_wd_settings(); $home = home_url( '/' ); $host = wp_parse_url( $home, PHP_URL_HOST );
	$add = function ( $id, $title, $status, $detail, $fix = '', $ms = 0, $data = null ) use ( &$rows ) { $rows[] = array( 'id' => $id, 'title' => $title, 'status' => $status, 'detail' => $detail, 'fix' => $fix, 'ms' => (int) $ms, 'data' => $data ); };

	/* 1. the pages visitors land on: status, time to first byte, size, robots, mixed content */
	$pins = array(); $home_html = '';
	foreach ( (array) $settings['watch_pages'] as $path ) {
		if ( microtime( true ) > $deadline ) { break; }
		$r = sml_wd_http( $home . ltrim( $path, '/' ) );
		if ( '/' === $path ) { $home_html = $r['body']; }
		$kb = (int) round( strlen( $r['body'] ) / 1024 );
		$robots = sml_wd_html_robots( $r['body'] );
		$noindex = (bool) preg_grep( '/noindex/i', $robots );
		$mixed = preg_match_all( '~\s(?:src|href)=["\']http://[^"\']+~i', $r['body'] );
		if ( ! $r['ok'] || $r['status'] >= 500 ) { $add( 'page' . $path, 'Page ' . $path, 'fail', 'HTTP ' . $r['status'] . ' ' . $r['error'], 'Open the page; check the PHP fatal list on the Live tab.', $r['ms'] ); }
		elseif ( $r['status'] >= 400 ) { $add( 'page' . $path, 'Page ' . $path, 'warn', 'HTTP ' . $r['status'] . ' from the server (' . $kb . ' KB)', 'If this page should be public, fix the rule that blocks it; if it is gated, remove it from the watch list in Settings.', $r['ms'] ); }
		elseif ( $noindex && '/' === $path ) { $add( 'page' . $path, 'Home page is noindex', 'fail', 'robots: ' . implode( ' | ', $robots ), 'Remove the noindex from the home page.', $r['ms'] ); }
		elseif ( $r['ms'] > 3000 ) { $add( 'page' . $path, 'Page ' . $path . ' is slow', 'warn', $r['ms'] . ' ms to first byte, ' . $kb . ' KB', 'Look at the Speed tab for this route: queries and memory on the server side.', $r['ms'] ); }
		elseif ( $mixed ) { $add( 'page' . $path, 'Page ' . $path . ' loads http:// assets', 'warn', $mixed . ' insecure asset URLs', 'Switch them to https:// so the browser does not block or warn.', $r['ms'] ); }
		else { $add( 'page' . $path, 'Page ' . $path, 'ok', 'HTTP ' . $r['status'] . ', ' . $r['ms'] . ' ms, ' . $kb . ' KB' . ( $robots ? ', robots: ' . $robots[0] : '' ), '', $r['ms'] ); }
		if ( preg_match_all( '~cdn\.jsdelivr\.net/gh/([^/]+/[^@]+)@([0-9a-f]{7,40})/([^"\'\s]+)~', $r['body'], $m, PREG_SET_ORDER ) ) { foreach ( $m as $hit ) { $pins[ $hit[2] ][] = $hit[3]; } }
	}

	/* 2. the CDN pins: every pinned asset must answer, and the number of different pins says how much drift the site carries */
	if ( $pins ) {
		$bad = array(); $checked = 0;
		foreach ( $pins as $sha => $files ) { foreach ( array_slice( array_unique( $files ), 0, 3 ) as $f ) { if ( microtime( true ) > $deadline ) { break 2; } $checked++; $r = sml_wd_http( 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . $sha . '/' . $f, array( 'method' => 'HEAD', 'timeout' => 6 ) ); if ( ! $r['ok'] || $r['status'] >= 400 ) { $bad[] = substr( $sha, 0, 7 ) . '/' . $f . ' → ' . $r['status']; } } }
		$add( 'cdn-pins', 'CDN asset pins (jsDelivr)', $bad ? 'fail' : ( count( $pins ) > 3 ? 'warn' : 'ok' ), count( $pins ) . ' distinct pinned revisions across the watched pages, ' . $checked . ' assets checked' . ( $bad ? '; failing: ' . implode( ', ', $bad ) : '' ), $bad ? 'Advance SML_CDN_ASSET_REVISION (or the plugin that prints the URL) to a commit that has the file.' : ( count( $pins ) > 3 ? 'Several loaders pin different commits; move them to one revision so a fix ships everywhere at once.' : '' ), 0, array_map( function ( $f ) { return array_values( array_unique( $f ) ); }, $pins ) );
	}

	/* 3. robots.txt and the sitemaps it names: each must answer, each must hold URLs, and a sample of those URLs must be indexable */
	$r = sml_wd_http( $home . 'robots.txt' );
	$maps = array(); $disallow_all = false;
	if ( $r['ok'] && 200 === $r['status'] ) {
		if ( preg_match_all( '~^Sitemap:\s*(\S+)~mi', $r['body'], $m ) ) { $maps = $m[1]; }
		$disallow_all = (bool) preg_match( '~^User-agent:\s*\*\s*(?:\r?\n(?!User-agent)[^\n]*)*?\r?\nDisallow:\s*/\s*$~mi', $r['body'] );
		$add( 'robots', 'robots.txt', $disallow_all ? 'fail' : 'ok', $disallow_all ? 'Disallow: / for every crawler' : count( $maps ) . ' sitemaps listed', $disallow_all ? 'Remove the blanket Disallow.' : '', $r['ms'] );
	} else { $add( 'robots', 'robots.txt', 'warn', 'HTTP ' . $r['status'], 'Serve a robots.txt that lists the sitemaps.', $r['ms'] ); }
	$index = sml_wd_http( $home . 'sitemap_index.xml' );
	if ( $index['ok'] && 200 === $index['status'] ) { $maps = array_merge( $maps, sml_wd_locs( $index['body'] ) ); }
	$maps[] = $home . 'sml-video-sitemap.xml';
	$maps = array_values( array_unique( array_filter( $maps, function ( $u ) use ( $host ) { return wp_parse_url( $u, PHP_URL_HOST ) === $host; } ) ) );
	$sample_n = (int) sml_wd_knob( 'sitemapSample' );
	$conflicts = array(); $empty = array(); $broken = array(); $checked_urls = 0; $video_ok = null;
	foreach ( $maps as $map ) {
		if ( microtime( true ) > $deadline ) { break; }
		if ( preg_match( '~sitemap_index\.xml$~', $map ) ) { continue; }
		$r = sml_wd_http( $map );
		if ( ! $r['ok'] || 200 !== $r['status'] ) { $broken[] = basename( $map ) . ' → HTTP ' . $r['status']; continue; }
		$urls = array_values( array_filter( sml_wd_locs( $r['body'] ), function ( $u ) { return ! preg_match( '~\.xml(\?|$)~', $u ); } ) );
		if ( preg_match( '~<sitemapindex~', $r['body'] ) ) { continue; } /* a nested index: its children are already in $maps from robots.txt */
		if ( ! $urls ) { $empty[] = basename( $map ); continue; }
		$is_video = false !== strpos( $map, 'video' );
		$n = $is_video ? min( count( $urls ), $sample_n ) : min( count( $urls ), max( 2, (int) ceil( $sample_n / 2 ) ) );
		$pick = array(); for ( $i = 0; $i < $n; $i++ ) { $pick[] = $urls[ $n > 1 ? (int) floor( $i * ( count( $urls ) - 1 ) / ( $n - 1 ) ) : 0 ]; }
		foreach ( array_unique( $pick ) as $u ) {
			if ( microtime( true ) > $deadline ) { break 2; }
			$p = sml_wd_http( $u, array( 'timeout' => 10 ) ); $checked_urls++;
			if ( ! $p['ok'] || 200 !== $p['status'] ) { $conflicts[] = array( 'url' => sml_wd_path( $u ), 'map' => basename( $map ), 'why' => 'HTTP ' . $p['status'] ); continue; }
			$robots = sml_wd_html_robots( $p['body'] ); $xr = isset( $p['headers']['x-robots-tag'] ) ? (string) $p['headers']['x-robots-tag'] : '';
			$noindex = (bool) preg_grep( '/noindex/i', $robots ) || false !== stripos( $xr, 'noindex' );
			$canon = sml_wd_html_canonical( $p['body'] );
			$types = sml_wd_html_ld_types( $p['body'] );
			if ( $noindex ) { $conflicts[] = array( 'url' => sml_wd_path( $u ), 'map' => basename( $map ), 'why' => 'in the sitemap but the page says noindex (' . implode( ' | ', $robots ) . ( $xr ? ' / X-Robots-Tag ' . $xr : '' ) . ')' ); if ( $is_video ) { $video_ok = false; } }
			elseif ( $canon && untrailingslashit( $canon ) !== untrailingslashit( $u ) && wp_parse_url( $canon, PHP_URL_HOST ) === $host ) { $conflicts[] = array( 'url' => sml_wd_path( $u ), 'map' => basename( $map ), 'why' => 'canonical points elsewhere: ' . sml_wd_path( $canon ) ); }
			elseif ( $is_video && ! in_array( 'VideoObject', $types, true ) ) { $conflicts[] = array( 'url' => sml_wd_path( $u ), 'map' => basename( $map ), 'why' => 'video sitemap URL without VideoObject schema (found: ' . ( $types ? implode( ', ', $types ) : 'none' ) . ')' ); $video_ok = false; }
			elseif ( $is_video && null === $video_ok ) { $video_ok = true; }
		}
	}
	$add( 'sitemaps', 'Sitemaps answer and hold URLs', ( $broken ? 'fail' : ( $empty ? 'warn' : 'ok' ) ), count( $maps ) . ' sitemaps' . ( $broken ? '; broken: ' . implode( ', ', $broken ) : '' ) . ( $empty ? '; empty: ' . implode( ', ', $empty ) : '' ), $broken ? 'A sitemap that 404s or 500s is a plugin that died or a rewrite that was never flushed.' : ( $empty ? 'Empty sitemaps are fine for new sections; stale ones mean the generator stopped seeing content.' : '' ), $index['ms'] );
	$add( 'indexability', 'Sitemap URLs are indexable', $conflicts ? 'fail' : 'ok', $checked_urls . ' sampled URLs fetched' . ( $conflicts ? '; ' . count( $conflicts ) . ' conflicts, e.g. ' . $conflicts[0]['url'] . ': ' . $conflicts[0]['why'] : ', all indexable with a self canonical' ), $conflicts ? 'A URL listed in a sitemap must not say noindex and must canonicalise to itself, or Google drops it and "Request indexing" does nothing. Find the plugin printing the robots meta on that template.' : '', 0, $conflicts );
	if ( null !== $video_ok ) { $add( 'video-seo', 'Video pages: indexable with VideoObject schema', $video_ok ? 'ok' : 'fail', $video_ok ? 'the sampled /watch/ pages are indexable and carry VideoObject' : 'the video sitemap lists pages that are noindex or lack VideoObject; the Creator Studio "Request indexing" button cannot work until this is fixed', $video_ok ? '' : 'Remove the noindex from public /watch/ pages (keep it only for unlisted or private videos) and confirm VideoObject is printed on each.', 0 ); }

	/* 4. the REST layer: every namespace still registered (a missing one is a plugin that died), and the WPCode diagnostic route */
	$r = sml_wd_http( $home . 'wp-json/' );
	$ns = array();
	if ( $r['ok'] && 200 === $r['status'] ) {
		$d = json_decode( $r['body'], true ); $ns = is_array( $d ) && isset( $d['namespaces'] ) ? array_values( (array) $d['namespaces'] ) : array();
		$prev = get_option( 'sml_wd_namespaces', array() );
		$missing = $prev ? array_values( array_diff( $prev, $ns ) ) : array();
		update_option( 'sml_wd_namespaces', $ns, false );
		$add( 'rest-namespaces', 'REST namespaces', $missing ? 'fail' : 'ok', count( $ns ) . ' namespaces registered' . ( $missing ? '; gone since last run: ' . implode( ', ', array_slice( $missing, 0, 6 ) ) : '' ), $missing ? 'A namespace that vanished means its plugin or WPCode snippet stopped loading. If it is a WPCode route, the merged snippet eval is dead: deactivate the newest snippet.' : '', $r['ms'], $ns );
	} else { $add( 'rest-namespaces', 'REST index', 'fail', 'HTTP ' . $r['status'] . ' ' . $r['error'], 'The REST API is down: every app screen on the site depends on it.', $r['ms'] ); }
	if ( microtime( true ) < $deadline ) {
		$r = sml_wd_http( $home . 'wp-json/sml-channel/v1/channel/grandmasterobi' );
		$add( 'wpcode-routes', 'WPCode-registered routes alive (sml-channel/v1)', ( $r['ok'] && 200 === $r['status'] ) ? 'ok' : 'fail', 'HTTP ' . $r['status'] . ' in ' . $r['ms'] . ' ms', ( $r['ok'] && 200 === $r['status'] ) ? '' : 'The documented outage signature: WPCode merged every "Run Everywhere" snippet into one eval and it died. Deactivate the newest snippet (see wpcode/README.md).', $r['ms'] );
	}

	/* 5. IndexNow: the key file the engines verify must be served and match */
	$key = (string) get_option( 'sml_lls_indexnow_key', '' );
	if ( $key && microtime( true ) < $deadline ) {
		$r = sml_wd_http( $home . $key . '.txt' );
		$add( 'indexnow-key', 'IndexNow key file', ( $r['ok'] && 200 === $r['status'] && trim( $r['body'] ) === $key ) ? 'ok' : 'fail', 'HTTP ' . $r['status'] . ( trim( $r['body'] ) === $key ? ', key matches' : ', body does not match the key' ), 'Bing ignores every ping until /{key}.txt serves the key. The Loop Letters Studio plugin serves it on init.', $r['ms'] );
	}

	/* 6. cron: scheduled work that never runs is why sitemaps go stale and briefs never arrive */
	$crons = _get_cron_array(); $overdue = 0; $total = 0;
	if ( is_array( $crons ) ) { foreach ( $crons as $ts => $hooks ) { foreach ( (array) $hooks as $h => $_ ) { $total++; if ( $ts < time() - 1800 ) { $overdue++; } } } }
	$add( 'cron', 'WP-Cron', $overdue > 5 ? 'fail' : ( $overdue ? 'warn' : 'ok' ), $total . ' scheduled events, ' . $overdue . ' overdue by 30+ min' . ( defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON ? ' (DISABLE_WP_CRON is on: a system cron must call wp-cron.php)' : '' ), $overdue ? 'Overdue events mean cron is not firing: check DISABLE_WP_CRON and the host\'s cron runner.' : '' );

	/* 7. duplicates and drift in the plugin list */
	if ( ! function_exists( 'get_plugins' ) ) { require_once ABSPATH . 'wp-admin/includes/plugin.php'; }
	$all = get_plugins(); $active = (array) get_option( 'active_plugins', array() ); $names = array(); $dups = array();
	foreach ( $active as $file ) { if ( isset( $all[ $file ] ) ) { $n = $all[ $file ]['Name']; if ( isset( $names[ $n ] ) ) { $dups[] = $n . ' (' . $all[ $file ]['Version'] . ' and ' . $names[ $n ] . ')'; } else { $names[ $n ] = $all[ $file ]['Version']; } } }
	$add( 'plugins', 'Active plugins', $dups ? 'fail' : ( count( $active ) > 150 ? 'warn' : 'ok' ), count( $active ) . ' active of ' . count( $all ) . ' installed' . ( $dups ? '; the same plugin active twice: ' . implode( '; ', array_slice( $dups, 0, 4 ) ) : '' ), $dups ? 'Two copies of one plugin fight over the same hooks and tables. Deactivate the older copy.' : ( count( $active ) > 150 ? 'Every active plugin runs on every request; retire the hotfix copies that are no longer needed.' : '' ) );

	/* 8. PHP and WordPress runtime */
	$mem = wp_convert_hr_to_bytes( ini_get( 'memory_limit' ) );
	$debug_display = defined( 'WP_DEBUG_DISPLAY' ) && WP_DEBUG_DISPLAY && defined( 'WP_DEBUG' ) && WP_DEBUG;
	$add( 'runtime', 'PHP ' . PHP_VERSION . ', WordPress ' . get_bloginfo( 'version' ), $debug_display ? 'fail' : ( $mem && $mem < 256 * 1048576 ? 'warn' : 'ok' ), 'memory_limit ' . ini_get( 'memory_limit' ) . ', max_execution_time ' . ini_get( 'max_execution_time' ) . 's' . ( $debug_display ? ', WP_DEBUG_DISPLAY is on (errors print on public pages)' : '' ), $debug_display ? 'Turn WP_DEBUG_DISPLAY off in wp-config.php; this panel records the errors instead.' : '' );

	/* 9. the database: the last error WordPress saw, and this plugin's own table */
	global $wpdb;
	$count = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . sml_wd_table() ); // phpcs:ignore
	$add( 'database', 'Database', $wpdb->last_error ? 'warn' : 'ok', $wpdb->last_error ? 'last error: ' . substr( $wpdb->last_error, 0, 160 ) : 'no errors on this request; ' . $count . ' telemetry rows', '' );

	$summary = array( 'ok' => 0, 'warn' => 0, 'fail' => 0 );
	foreach ( $rows as $row ) { $summary[ $row['status'] ]++; }
	$result = array( 'at' => gmdate( 'c' ), 'reason' => $reason, 'ms' => (int) round( ( microtime( true ) - $t0 ) * 1000 ), 'summary' => $summary, 'rows' => $rows );
	$history = get_option( 'sml_wd_checks_history', array() ); if ( ! is_array( $history ) ) { $history = array(); }
	$history[] = array( 'at' => $result['at'], 'summary' => $summary, 'ms' => $result['ms'] ); if ( count( $history ) > 168 ) { $history = array_slice( $history, -168 ); }
	update_option( 'sml_wd_checks_history', $history, false );
	update_option( 'sml_wd_checks', $result, false );
	delete_transient( 'sml_wd_checks_lock' );
	return $result;
}
