<?php
/**
 * The events table and the bounded reads over it.
 * One row per distinct bug per hour (fingerprint × hour bucket, counted up), one row per sampled timing or vitals report.
 * Everything the panel shows is read from here with LIMITs; nothing is ever read without a time window.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_wd_table() { global $wpdb; return $wpdb->prefix . 'sml_wd_events'; }

function sml_wd_install_table() {
	global $wpdb;
	$t = sml_wd_table();
	$charset = $wpdb->get_charset_collate();
	$sql = "CREATE TABLE $t (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		at DATETIME NOT NULL,
		bucket DATETIME NOT NULL,
		kind VARCHAR(16) NOT NULL,
		level VARCHAR(8) NOT NULL DEFAULT 'error',
		fp CHAR(32) NOT NULL,
		url VARCHAR(255) NOT NULL DEFAULT '/',
		route VARCHAR(160) NOT NULL DEFAULT '/',
		message VARCHAR(500) NOT NULL DEFAULT '',
		meta LONGTEXT NULL,
		n INT UNSIGNED NOT NULL DEFAULT 1,
		last_at DATETIME NOT NULL,
		resolved_at DATETIME NULL,
		PRIMARY KEY (id),
		UNIQUE KEY fp_bucket (fp, bucket),
		KEY kind_at (kind, at),
		KEY route_at (route(60), at),
		KEY last_at (last_at)
	) $charset;";
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta( $sql );
	update_option( 'sml_wd_db_version', SML_WD_DB_VERSION, false );
}

/** Record one event. Error-like kinds are counted up within their hour; samples get a unique fingerprint and their own row. */
function sml_wd_record( array $e ) {
	global $wpdb;
	if ( ! in_array( $e['kind'], sml_wd_kinds(), true ) ) { return false; }
	$now = current_time( 'mysql', true );
	$bucket = gmdate( 'Y-m-d H:00:00' );
	$is_error = in_array( $e['kind'], sml_wd_error_kinds(), true );
	$route = isset( $e['route'] ) ? substr( (string) $e['route'], 0, 160 ) : sml_wd_route_key( isset( $e['url'] ) ? $e['url'] : '/' );
	$fp = $is_error ? sml_wd_fingerprint( $e['kind'], $e['message'], $route ) : md5( uniqid( $e['kind'], true ) . wp_rand() );
	$n = $is_error && ! empty( $e['meta']['count'] ) ? (int) $e['meta']['count'] : 1;
	$meta = isset( $e['meta'] ) && is_array( $e['meta'] ) ? wp_json_encode( $e['meta'], JSON_UNESCAPED_SLASHES ) : null;
	$sql = $wpdb->prepare(
		"INSERT INTO " . sml_wd_table() . " (at, bucket, kind, level, fp, url, route, message, meta, n, last_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%d,%s)
		 ON DUPLICATE KEY UPDATE n = n + VALUES(n), last_at = VALUES(last_at), meta = COALESCE(VALUES(meta), meta)",
		$now, $bucket, $e['kind'], isset( $e['level'] ) ? substr( (string) $e['level'], 0, 8 ) : 'error', $fp, substr( (string) ( isset( $e['url'] ) ? $e['url'] : '/' ), 0, 255 ), $route, substr( (string) $e['message'], 0, 500 ), $meta, $n, $now
	);
	$ok = $wpdb->query( $sql ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	if ( false === $ok && $wpdb->last_error && false !== stripos( $wpdb->last_error, "doesn't exist" ) ) { sml_wd_install_table(); }
	return false !== $ok;
}

function sml_wd_prune( $days ) {
	global $wpdb;
	$days = max( 3, min( 30, (int) $days ) );
	$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . sml_wd_table() . ' WHERE at < %s LIMIT 20000', gmdate( 'Y-m-d H:i:s', time() - $days * DAY_IN_SECONDS ) ) ); // phpcs:ignore
	/* the samples are heavier than the bugs: keep two days of them */
	$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . sml_wd_table() . " WHERE kind IN ('vitals','timing','rest_timing') AND at < %s LIMIT 20000", gmdate( 'Y-m-d H:i:s', time() - 2 * DAY_IN_SECONDS ) ) ); // phpcs:ignore
}

/** Live bugs: the distinct error fingerprints seen in the window, newest activity first, with their counts summed over the window. */
function sml_wd_errors( $hours = 24, $limit = 80, $include_resolved = false ) {
	global $wpdb;
	$since = gmdate( 'Y-m-d H:i:s', time() - (int) $hours * HOUR_IN_SECONDS );
	$kinds = "'" . implode( "','", array_map( 'esc_sql', sml_wd_error_kinds() ) ) . "'";
	$rows = $wpdb->get_results( $wpdb->prepare(
		"SELECT fp, kind, level, url, route, message, SUM(n) AS n, MIN(at) AS first_at, MAX(last_at) AS last_at, MAX(resolved_at) AS resolved_at, SUBSTRING_INDEX(GROUP_CONCAT(meta ORDER BY last_at DESC SEPARATOR '\n'), '\n', 1) AS meta
		 FROM " . sml_wd_table() . " WHERE kind IN ($kinds) AND last_at >= %s GROUP BY fp, kind, level, url, route, message ORDER BY last_at DESC LIMIT %d", $since, (int) $limit * 2 ), ARRAY_A ); // phpcs:ignore
	$out = array();
	foreach ( (array) $rows as $r ) {
		$resolved = ! empty( $r['resolved_at'] ) && $r['resolved_at'] >= $r['last_at'];
		if ( $resolved && ! $include_resolved ) { continue; }
		$r['n'] = (int) $r['n']; $r['meta'] = $r['meta'] ? json_decode( $r['meta'], true ) : array();
		$r['status'] = $resolved ? 'resolved' : ( ! empty( $r['resolved_at'] ) ? 'regressed' : 'open' );
		$out[] = $r;
		if ( count( $out ) >= $limit ) { break; }
	}
	return $out;
}

function sml_wd_resolve( $fp, $resolve = true ) {
	global $wpdb;
	return false !== $wpdb->query( $wpdb->prepare( 'UPDATE ' . sml_wd_table() . ' SET resolved_at = %s WHERE fp = %s', $resolve ? current_time( 'mysql', true ) : null, $fp ) ); // phpcs:ignore
}

/** The latest rows of a kind (the live stream in the panel). */
function sml_wd_recent( $kinds, $limit = 60, $since_id = 0 ) {
	global $wpdb;
	$kinds = array_values( array_intersect( (array) $kinds, sml_wd_kinds() ) );
	if ( ! $kinds ) { return array(); }
	$in = "'" . implode( "','", array_map( 'esc_sql', $kinds ) ) . "'";
	$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT id, at, kind, level, fp, url, route, message, meta, n, last_at, resolved_at FROM ' . sml_wd_table() . " WHERE kind IN ($in) AND id > %d ORDER BY last_at DESC, id DESC LIMIT %d", (int) $since_id, (int) $limit ), ARRAY_A ); // phpcs:ignore
	foreach ( $rows as &$r ) { $r['id'] = (int) $r['id']; $r['n'] = (int) $r['n']; $r['meta'] = $r['meta'] ? json_decode( $r['meta'], true ) : array(); }
	return $rows;
}

/** Vitals and server timings over the window, aggregated per route (p75 for vitals, p50/p95 for server time). */
function sml_wd_speed( $hours = 24 ) {
	global $wpdb;
	$since = gmdate( 'Y-m-d H:i:s', time() - (int) $hours * HOUR_IN_SECONDS );
	$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT kind, route, url, meta FROM ' . sml_wd_table() . " WHERE kind IN ('vitals','timing','rest_timing') AND at >= %s ORDER BY id DESC LIMIT 6000", $since ), ARRAY_A ); // phpcs:ignore
	$vit = array( 'lcp' => array(), 'cls' => array(), 'inp' => array(), 'ttfb' => array(), 'fcp' => array() ); $by_route = array(); $srv = array(); $rest = array(); $long = 0; $views = 0; $phones = 0;
	foreach ( (array) $rows as $r ) {
		$m = $r['meta'] ? json_decode( $r['meta'], true ) : array(); if ( ! is_array( $m ) ) { continue; }
		if ( 'vitals' === $r['kind'] ) {
			$views++; if ( isset( $m['device'] ) && 'phone' === $m['device'] ) { $phones++; }
			foreach ( $vit as $k => $_ ) { if ( isset( $m[ $k ] ) ) { $vit[ $k ][] = (float) $m[ $k ]; $by_route[ $r['route'] ][ $k ][] = (float) $m[ $k ]; } }
			$long += isset( $m['longTasks'] ) ? (int) $m['longTasks'] : 0;
		} elseif ( 'timing' === $r['kind'] ) {
			$srv[ $r['route'] ][] = array( (int) ( isset( $m['ms'] ) ? $m['ms'] : 0 ), (int) ( isset( $m['queries'] ) ? $m['queries'] : 0 ), (int) ( isset( $m['mem'] ) ? $m['mem'] : 0 ) );
		} else {
			$rest[ $r['route'] ][] = array( (int) ( isset( $m['ms'] ) ? $m['ms'] : 0 ), (int) ( isset( $m['status'] ) ? $m['status'] : 200 ) );
		}
	}
	$vitals = array();
	foreach ( $vit as $k => $vals ) { if ( ! $vals ) { continue; } $p75 = sml_wd_percentile( $vals, 75 ); $vitals[ $k ] = array( 'p75' => 'cls' === $k ? round( $p75, 3 ) : (int) $p75, 'n' => count( $vals ), 'grade' => sml_wd_vital_grade( $k, $p75 ) ); }
	$routes = array();
	foreach ( $by_route as $route => $ms ) { $row = array( 'route' => $route, 'n' => isset( $ms['lcp'] ) ? count( $ms['lcp'] ) : ( isset( $ms['ttfb'] ) ? count( $ms['ttfb'] ) : 0 ) ); foreach ( array( 'lcp', 'inp', 'cls', 'ttfb' ) as $k ) { if ( ! empty( $ms[ $k ] ) ) { $p = sml_wd_percentile( $ms[ $k ], 75 ); $row[ $k ] = 'cls' === $k ? round( $p, 3 ) : (int) $p; $row[ $k . '_grade' ] = sml_wd_vital_grade( $k, $p ); } } $routes[] = $row; }
	usort( $routes, function ( $a, $b ) { return ( isset( $b['lcp'] ) ? $b['lcp'] : 0 ) <=> ( isset( $a['lcp'] ) ? $a['lcp'] : 0 ); } );
	if ( isset( $vitals['lcp'] ) && $routes && isset( $routes[0]['lcp'] ) ) { $vitals['lcp']['worst'] = array( 'route' => $routes[0]['route'], 'p75' => $routes[0]['lcp'] ); }
	$server = array(); $all_ms = array(); $max_q = 0;
	foreach ( $srv as $route => $samples ) { $ms = array_column( $samples, 0 ); $q = array_column( $samples, 1 ); $mem = array_column( $samples, 2 ); $all_ms = array_merge( $all_ms, $ms ); $max_q = max( $max_q, max( $q ) ); $server[] = array( 'route' => $route, 'n' => count( $ms ), 'p50' => (int) sml_wd_percentile( $ms, 50 ), 'p95' => (int) sml_wd_percentile( $ms, 95 ), 'queries' => (int) max( $q ), 'mem' => (int) round( max( $mem ) / 1048576 ) ); }
	usort( $server, function ( $a, $b ) { return $b['p95'] <=> $a['p95']; } );
	$rest_rows = array();
	foreach ( $rest as $route => $samples ) { $ms = array_column( $samples, 0 ); $bad = count( array_filter( array_column( $samples, 1 ), function ( $s ) { return $s >= 500; } ) ); $rest_rows[] = array( 'route' => $route, 'n' => count( $ms ), 'p50' => (int) sml_wd_percentile( $ms, 50 ), 'p95' => (int) sml_wd_percentile( $ms, 95 ), 'errPct' => count( $ms ) ? round( 100 * $bad / count( $ms ), 1 ) : 0 ); }
	usort( $rest_rows, function ( $a, $b ) { return $b['p95'] <=> $a['p95']; } );
	return array(
		'views' => $views, 'phones' => $phones, 'longTasksPerView' => $views ? round( $long / $views, 2 ) : 0,
		'vitals' => $vitals, 'routes' => array_slice( $routes, 0, 40 ),
		'server' => array( 'p50' => (int) sml_wd_percentile( $all_ms, 50 ), 'p95' => (int) sml_wd_percentile( $all_ms, 95 ), 'maxQueries' => $max_q, 'slowest' => array_slice( $server, 0, 25 ), 'n' => count( $all_ms ) ),
		'rest' => array_slice( $rest_rows, 0, 25 ),
	);
}

/** Error counts for the headline and the digest. */
function sml_wd_error_summary( $hours = 24 ) {
	$rows = sml_wd_errors( $hours, 200 );
	$total = 0; $fatals = array(); $by_kind = array();
	foreach ( $rows as $r ) { $total += $r['n']; $by_kind[ $r['kind'] ] = ( isset( $by_kind[ $r['kind'] ] ) ? $by_kind[ $r['kind'] ] : 0 ) + $r['n']; if ( 'php_fatal' === $r['kind'] ) { $fatals[] = $r; } }
	usort( $rows, function ( $a, $b ) { return $b['n'] <=> $a['n']; } );
	$top = array();
	foreach ( array_slice( $rows, 0, 8 ) as $r ) { $top[] = array( 'kind' => $r['kind'], 'route' => $r['route'], 'url' => $r['url'], 'message' => $r['message'], 'n' => $r['n'], 'source' => isset( $r['meta']['source'] ) ? $r['meta']['source'] : '', 'target' => isset( $r['meta']['target'] ) ? $r['meta']['target'] : '', 'referer' => isset( $r['meta']['referer'] ) ? $r['meta']['referer'] : '' ); }
	return array( 'total' => $total, 'distinct' => count( $rows ), 'byKind' => $by_kind, 'fatals' => array_slice( array_map( function ( $f ) { return array( 'route' => $f['route'], 'message' => $f['message'], 'n' => $f['n'] ); }, $fatals ), 0, 3 ), 'top' => $top );
}

/** Hourly error counts for the sparkline. */
function sml_wd_error_series( $hours = 24 ) {
	global $wpdb;
	$since = gmdate( 'Y-m-d H:00:00', time() - (int) $hours * HOUR_IN_SECONDS );
	$kinds = "'" . implode( "','", array_map( 'esc_sql', sml_wd_error_kinds() ) ) . "'";
	$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT bucket, SUM(n) AS n FROM ' . sml_wd_table() . " WHERE kind IN ($kinds) AND bucket >= %s GROUP BY bucket ORDER BY bucket", $since ), ARRAY_A ); // phpcs:ignore
	$map = array(); foreach ( (array) $rows as $r ) { $map[ $r['bucket'] ] = (int) $r['n']; }
	$out = array();
	for ( $i = $hours - 1; $i >= 0; $i-- ) { $b = gmdate( 'Y-m-d H:00:00', time() - $i * HOUR_IN_SECONDS ); $out[] = array( 'h' => substr( $b, 11, 2 ), 'n' => isset( $map[ $b ] ) ? $map[ $b ] : 0 ); }
	return $out;
}
