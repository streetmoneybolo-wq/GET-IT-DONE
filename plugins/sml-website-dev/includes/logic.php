<?php
/**
 * Pure functions: no WordPress, no database. Everything here runs in tests/harness.php as-is.
 *   - normalising and fingerprinting incoming events (so one bug is one row, however many times it fires)
 *   - sanitising the public beacon payload
 *   - percentiles and the digest the Evolve engine reasons over
 *   - the rules brief (what the engine proposes when no model is configured, and the floor under the model's answer)
 *   - knob rails and the learning weights
 *   - turning a competitor headline into an idea for this site
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** Event kinds the store accepts. Anything else from the beacon is dropped. */
function sml_wd_kinds() {
	return array( 'js_error', 'js_rejection', 'resource', 'fetch', 'php_error', 'php_fatal', 'rest_error', 'http_404', 'vitals', 'timing', 'rest_timing', 'a11y' );
}
function sml_wd_error_kinds() { return array( 'js_error', 'js_rejection', 'resource', 'fetch', 'php_error', 'php_fatal', 'rest_error', 'http_404', 'a11y' ); }

/** A URL becomes its path (query strings carry tokens and nonces; they are never stored). */
function sml_wd_path( $url ) {
	$url = (string) $url;
	if ( '' === $url ) { return '/'; }
	$p = parse_url( $url, PHP_URL_PATH );
	if ( null === $p || false === $p || '/' !== substr( (string) $p, 0, 1 ) ) { $p = ( '/' === substr( $url, 0, 1 ) ) ? $url : '/'; }
	$p = preg_replace( '~/+~', '/', (string) $p );
	return substr( $p, 0, 255 );
}

/** Paths with ids collapse to one route so a slow /watch/{id}/ is one row, not a thousand. */
function sml_wd_route_key( $path ) {
	$p = sml_wd_path( $path );
	$p = preg_replace( '~^/wp-json/~', '', $p );
	$p = preg_replace( '~/\d{3,}(?=/|$)~', '/:id', $p );
	$p = preg_replace( '~/[A-Za-z0-9_-]{10,}(?=/|$)~', '/:slug', $p );
	$p = preg_replace( '~/[A-Z]{1,6}(?=/|$)~', '/:sym', $p );
	return substr( $p ?: '/', 0, 160 );
}

/** Messages lose the parts that differ per occurrence: numbers, hashes, quoted ids, line/column pairs. */
function sml_wd_normalise_message( $m ) {
	$m = trim( preg_replace( '/\s+/', ' ', (string) $m ) );
	$m = preg_replace( '/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/i', '#', $m );
	$m = preg_replace( '/:\d+:\d+\b/', ':n:n', $m );
	$m = preg_replace( '/\b\d{3,}\b/', 'N', $m );
	$m = preg_replace( '/(["\'])[^"\']{20,}\1/', '$1…$1', $m );
	return substr( $m, 0, 500 );
}

function sml_wd_fingerprint( $kind, $message, $route = '' ) {
	return md5( $kind . '|' . strtolower( sml_wd_normalise_message( $message ) ) . '|' . $route );
}

/** One beacon event from the browser, checked field by field. Returns null for anything that is not an event we record. */
function sml_wd_sanitize_beacon_event( $e, $page_path ) {
	if ( ! is_array( $e ) ) { return null; }
	$kind = isset( $e['kind'] ) ? (string) $e['kind'] : '';
	if ( ! in_array( $kind, array( 'js_error', 'js_rejection', 'resource', 'fetch', 'vitals', 'a11y' ), true ) ) { return null; }
	$url = sml_wd_path( isset( $e['url'] ) && $e['url'] ? $e['url'] : $page_path );
	$meta = array();
	if ( 'vitals' === $kind ) {
		foreach ( array( 'lcp', 'cls', 'inp', 'ttfb', 'fcp', 'longTasks', 'transfer', 'resources', 'domMs', 'loadMs' ) as $k ) {
			if ( isset( $e[ $k ] ) && is_numeric( $e[ $k ] ) ) { $meta[ $k ] = 'cls' === $k ? round( min( 10, max( 0, (float) $e[ $k ] ) ), 3 ) : (int) min( 600000, max( 0, (float) $e[ $k ] ) ); }
		}
		if ( ! $meta ) { return null; }
		$meta['device'] = ( isset( $e['device'] ) && 'phone' === $e['device'] ) ? 'phone' : 'desktop';
		$meta['con'] = isset( $e['con'] ) ? substr( preg_replace( '/[^a-z0-9-]/', '', strtolower( (string) $e['con'] ) ), 0, 8 ) : '';
		return array( 'kind' => 'vitals', 'level' => 'info', 'url' => $url, 'route' => sml_wd_route_key( $url ), 'message' => 'vitals', 'meta' => $meta );
	}
	$message = sml_wd_normalise_message( isset( $e['message'] ) ? $e['message'] : '' );
	if ( '' === $message ) { return null; }
	/* browser-extension noise is not a site bug */
	if ( preg_match( '~(chrome|moz|safari)-extension://|ResizeObserver loop|Script error\.$~i', $message . ' ' . ( isset( $e['source'] ) ? $e['source'] : '' ) ) ) { return null; }
	if ( isset( $e['source'] ) ) { $meta['source'] = substr( sml_wd_path( (string) $e['source'] ), 0, 200 ); $host = parse_url( (string) $e['source'], PHP_URL_HOST ); if ( $host ) { $meta['host'] = substr( (string) $host, 0, 80 ); } }
	if ( isset( $e['line'] ) ) { $meta['line'] = (int) $e['line']; }
	if ( isset( $e['stack'] ) ) { $meta['stack'] = substr( preg_replace( '/\s+/', ' ', (string) $e['stack'] ), 0, 400 ); }
	if ( isset( $e['status'] ) ) { $meta['status'] = (int) $e['status']; }
	if ( isset( $e['target'] ) ) { $meta['target'] = substr( sml_wd_path( (string) $e['target'] ), 0, 200 ); }
	if ( isset( $e['count'] ) ) { $meta['count'] = (int) min( 500, max( 1, (int) $e['count'] ) ); }
	$meta['device'] = ( isset( $e['device'] ) && 'phone' === $e['device'] ) ? 'phone' : 'desktop';
	$route = 'fetch' === $kind && ! empty( $meta['target'] ) ? sml_wd_route_key( $meta['target'] ) : sml_wd_route_key( $url );
	$level = 'a11y' === $kind ? 'warn' : ( 'fetch' === $kind && ! empty( $meta['status'] ) && $meta['status'] < 500 ? 'warn' : 'error' );
	return array( 'kind' => $kind, 'level' => $level, 'url' => $url, 'route' => $route, 'message' => $message, 'meta' => $meta );
}

/* ---------- numbers ---------- */
function sml_wd_percentile( array $values, $p ) {
	if ( ! $values ) { return 0; }
	sort( $values );
	$i = (int) min( count( $values ) - 1, floor( ( $p / 100 ) * count( $values ) ) );
	return $values[ $i ];
}

/** Web Vitals thresholds (Google's "good" / "poor" lines) so the panel can say good, needs work or poor. */
function sml_wd_vital_grade( $metric, $v ) {
	$lines = array( 'lcp' => array( 2500, 4000 ), 'cls' => array( 0.1, 0.25 ), 'inp' => array( 200, 500 ), 'ttfb' => array( 800, 1800 ), 'fcp' => array( 1800, 3000 ) );
	if ( ! isset( $lines[ $metric ] ) || null === $v ) { return 'n/a'; }
	return $v <= $lines[ $metric ][0] ? 'good' : ( $v <= $lines[ $metric ][1] ? 'needs-work' : 'poor' );
}

/**
 * A health score from 0 to 100: starts full and loses points for failing checks, error volume, poor vitals and slow server time.
 * It is a headline, not a verdict; the rows under it are the verdict.
 */
function sml_wd_health_score( array $d ) {
	$s = 100;
	$s -= 12 * (int) ( isset( $d['checks']['fail'] ) ? $d['checks']['fail'] : 0 );
	$s -= 4 * (int) ( isset( $d['checks']['warn'] ) ? $d['checks']['warn'] : 0 );
	$errors = (int) ( isset( $d['errors']['total'] ) ? $d['errors']['total'] : 0 );
	$s -= min( 25, (int) floor( $errors / 10 ) );
	if ( ! empty( $d['errors']['fatals'] ) ) { $s -= 15; }
	foreach ( array( 'lcp', 'inp', 'cls' ) as $m ) {
		$g = isset( $d['vitals'][ $m ]['grade'] ) ? $d['vitals'][ $m ]['grade'] : 'n/a';
		if ( 'poor' === $g ) { $s -= 8; } elseif ( 'needs-work' === $g ) { $s -= 3; }
	}
	if ( isset( $d['server']['p95'] ) && $d['server']['p95'] > 2500 ) { $s -= 8; } elseif ( isset( $d['server']['p95'] ) && $d['server']['p95'] > 1200 ) { $s -= 3; }
	return max( 0, min( 100, (int) $s ) );
}

/* ---------- knobs: the settings the engine may turn, each on a rail ---------- */
function sml_wd_knob_defaults() {
	return array(
		'beaconSampleRate'    => array( 'min' => 5, 'max' => 100, 'step' => 5, 'value' => 25, 'unit' => '%', 'about' => 'share of visitor page views that report Web Vitals (errors are always reported)' ),
		'checkIntervalMin'    => array( 'min' => 30, 'max' => 240, 'step' => 30, 'value' => 60, 'unit' => 'min', 'about' => 'how often the health checks run' ),
		'retentionDays'       => array( 'min' => 3, 'max' => 30, 'step' => 1, 'value' => 14, 'unit' => 'days', 'about' => 'how long raw events are kept' ),
		'competitorScanHours' => array( 'min' => 6, 'max' => 48, 'step' => 6, 'value' => 12, 'unit' => 'h', 'about' => 'how often the competitor feeds are read' ),
		'sitemapSample'       => array( 'min' => 3, 'max' => 20, 'step' => 1, 'value' => 6, 'unit' => 'urls', 'about' => 'how many URLs from each sitemap the indexability check fetches' ),
	);
}
function sml_wd_clamp_knob( array $k, $v ) {
	$v = is_numeric( $v ) ? (float) $v : $k['value'];
	$v = max( $k['min'], min( $k['max'], $v ) );
	$v = round( $v / $k['step'] ) * $k['step'];
	return (int) $v;
}

/**
 * The learning weights: one per proposal area. A shipped proposal whose measured effect was good raises its area's weight,
 * a shipped one that changed nothing lowers it. Proposals are ordered by impact × weight, so the engine leans toward what
 * has actually paid off on this site. Rails: 0.5 to 2.0, and every change is small.
 */
function sml_wd_weight_defaults() {
	return array( 'speed' => 1.0, 'errors' => 1.0, 'seo' => 1.0, 'reliability' => 1.0, 'navigation' => 1.0, 'competition' => 1.0, 'a11y' => 1.0 );
}
function sml_wd_learn( array $weights, $area, $impact ) {
	if ( ! isset( $weights[ $area ] ) ) { return $weights; }
	$delta = $impact > 0.05 ? 0.1 : ( $impact < -0.05 ? -0.1 : -0.03 );
	$weights[ $area ] = round( max( 0.5, min( 2.0, $weights[ $area ] + $delta ) ), 2 );
	return $weights;
}

/**
 * The rules brief. Reads the digest and writes proposals grounded in its numbers. This is what the owner sees when no
 * model key is configured, and it always runs so that a model's answer is appended to a floor of facts, not replacing them.
 */
function sml_wd_rules_brief( array $d, array $weights ) {
	$lines = array(); $props = array();
	$v = isset( $d['vitals'] ) ? $d['vitals'] : array();
	$e = isset( $d['errors'] ) ? $d['errors'] : array();
	$s = isset( $d['server'] ) ? $d['server'] : array();
	$c = isset( $d['checks'] ) ? $d['checks'] : array();
	$lines[] = sprintf( '%d page views sampled, %d errors (%d distinct) in the window; health %d/100.', (int) ( isset( $d['views'] ) ? $d['views'] : 0 ), (int) ( isset( $e['total'] ) ? $e['total'] : 0 ), (int) ( isset( $e['distinct'] ) ? $e['distinct'] : 0 ), (int) ( isset( $d['score'] ) ? $d['score'] : 0 ) );
	if ( isset( $v['lcp']['p75'] ) ) { $lines[] = sprintf( 'Web Vitals p75: LCP %d ms (%s), INP %s ms (%s), CLS %s (%s), TTFB %d ms (%s).', $v['lcp']['p75'], $v['lcp']['grade'], isset( $v['inp']['p75'] ) ? $v['inp']['p75'] : '–', isset( $v['inp']['grade'] ) ? $v['inp']['grade'] : 'n/a', isset( $v['cls']['p75'] ) ? $v['cls']['p75'] : '–', isset( $v['cls']['grade'] ) ? $v['cls']['grade'] : 'n/a', isset( $v['ttfb']['p75'] ) ? $v['ttfb']['p75'] : 0, isset( $v['ttfb']['grade'] ) ? $v['ttfb']['grade'] : 'n/a' ); }
	if ( isset( $s['p95'] ) ) { $lines[] = sprintf( 'Server: p50 %d ms, p95 %d ms, up to %d queries on one page.', $s['p50'], $s['p95'], isset( $s['maxQueries'] ) ? $s['maxQueries'] : 0 ); }
	if ( ! empty( $c['fail'] ) || ! empty( $c['warn'] ) ) { $lines[] = sprintf( 'Health checks: %d failing, %d warnings.', (int) $c['fail'], (int) $c['warn'] ); }

	foreach ( ( isset( $c['failing'] ) ? $c['failing'] : array() ) as $f ) {
		$area = ( false !== stripos( $f['id'], 'index' ) || false !== stripos( $f['id'], 'sitemap' ) || false !== stripos( $f['id'], 'seo' ) ) ? 'seo' : 'reliability';
		$props[] = array( 'title' => 'Fix: ' . $f['title'], 'evidence' => $f['detail'], 'change' => isset( $f['fix'] ) ? $f['fix'] : 'Resolve the failing check and re-run it.', 'effect' => 'the check turns green and what it protects works again', 'risk' => 'low', 'size' => 'S', 'area' => $area, 'auto' => false, 'impact' => 0.9 );
	}
	if ( ! empty( $e['fatals'] ) ) { $props[] = array( 'title' => 'Stop the PHP fatal on ' . $e['fatals'][0]['route'], 'evidence' => $e['fatals'][0]['message'] . ' × ' . $e['fatals'][0]['n'], 'change' => 'Open the file and line in the fatal, guard the call, and add the case to that plugin\'s tests.', 'effect' => 'the page renders instead of a white screen', 'risk' => 'low', 'size' => 'S', 'area' => 'errors', 'auto' => false, 'impact' => 1.0 ); }
	foreach ( array_slice( isset( $e['top'] ) ? $e['top'] : array(), 0, 3 ) as $t ) {
		if ( 'http_404' === $t['kind'] ) { $props[] = array( 'title' => 'Redirect the 404 at ' . $t['url'], 'evidence' => $t['n'] . ' hits in the window' . ( ! empty( $t['referer'] ) ? ', linked from ' . $t['referer'] : '' ), 'change' => 'Add a 301 to the right page, or fix the link that points here.', 'effect' => 'visitors land on content instead of a 500 KB 404 page', 'risk' => 'low', 'size' => 'S', 'area' => 'navigation', 'auto' => true, 'impact' => 0.5 + min( 0.4, $t['n'] / 200 ) ); }
		elseif ( in_array( $t['kind'], array( 'js_error', 'js_rejection' ), true ) ) { $props[] = array( 'title' => 'Fix the script error on ' . $t['route'], 'evidence' => $t['message'] . ' × ' . $t['n'] . ( ! empty( $t['source'] ) ? ' in ' . $t['source'] : '' ), 'change' => 'Reproduce on ' . $t['url'] . ', find the throw in ' . ( ! empty( $t['source'] ) ? $t['source'] : 'the page scripts' ) . ' and guard it.', 'effect' => 'the feature behind it works for everyone, not just when the race is won', 'risk' => 'low', 'size' => 'S', 'area' => 'errors', 'auto' => false, 'impact' => 0.6 + min( 0.4, $t['n'] / 100 ) ); }
		elseif ( 'fetch' === $t['kind'] || 'rest_error' === $t['kind'] ) { $props[] = array( 'title' => 'Stop ' . $t['route'] . ' failing', 'evidence' => $t['message'] . ' × ' . $t['n'], 'change' => 'Root-cause the failing route and return a bounded fallback instead of an error.', 'effect' => 'fewer dead buttons and spinners', 'risk' => 'medium', 'size' => 'M', 'area' => 'reliability', 'auto' => false, 'impact' => 0.6 + min( 0.3, $t['n'] / 100 ) ); }
		elseif ( 'resource' === $t['kind'] ) { $props[] = array( 'title' => 'Fix the missing asset ' . ( ! empty( $t['target'] ) ? $t['target'] : '' ), 'evidence' => $t['message'] . ' × ' . $t['n'], 'change' => 'Repoint or restore the asset; if it is a CDN pin, advance the pin.', 'effect' => 'no broken images or styles', 'risk' => 'low', 'size' => 'S', 'area' => 'reliability', 'auto' => true, 'impact' => 0.5 ); }
	}
	if ( isset( $v['lcp']['grade'] ) && 'good' !== $v['lcp']['grade'] ) {
		$worst = isset( $v['lcp']['worst'] ) ? $v['lcp']['worst'] : null;
		$props[] = array( 'title' => 'Bring LCP under 2.5 s' . ( $worst ? ' on ' . $worst['route'] : '' ), 'evidence' => 'p75 LCP ' . $v['lcp']['p75'] . ' ms' . ( $worst ? '; worst route ' . $worst['route'] . ' at ' . $worst['p75'] . ' ms' : '' ), 'change' => 'Preload the hero image or video poster, defer non-critical scripts, and cut the third-party weight on that template.', 'effect' => 'faster first view; a Core Web Vitals pass', 'risk' => 'low', 'size' => 'M', 'area' => 'speed', 'auto' => false, 'impact' => 'poor' === $v['lcp']['grade'] ? 0.9 : 0.6 );
	}
	if ( isset( $v['inp']['grade'] ) && 'good' !== $v['inp']['grade'] ) { $props[] = array( 'title' => 'Cut input delay (INP)', 'evidence' => 'p75 INP ' . $v['inp']['p75'] . ' ms; long tasks per view ' . ( isset( $v['longTasks'] ) ? $v['longTasks'] : '–' ), 'change' => 'Break the long tasks on the busiest template into idle-time chunks and move polling off the main thread.', 'effect' => 'taps and clicks answer at once', 'risk' => 'medium', 'size' => 'M', 'area' => 'speed', 'auto' => false, 'impact' => 0.7 ); }
	if ( isset( $v['cls']['grade'] ) && 'good' !== $v['cls']['grade'] ) { $props[] = array( 'title' => 'Stop the layout shifting (CLS)', 'evidence' => 'p75 CLS ' . $v['cls']['p75'], 'change' => 'Reserve space for banners, ads, embeds and late-loaded headers with explicit sizes.', 'effect' => 'nothing jumps under the reader\'s finger', 'risk' => 'low', 'size' => 'S', 'area' => 'speed', 'auto' => true, 'impact' => 0.5 );
	}
	if ( isset( $s['p95'] ) && $s['p95'] > 1200 ) {
		$slow = isset( $s['slowest'][0] ) ? $s['slowest'][0] : null;
		$props[] = array( 'title' => 'Speed up the server on ' . ( $slow ? $slow['route'] : 'the slowest route' ), 'evidence' => $slow ? sprintf( 'p95 %d ms, %d queries, %d MB', $slow['p95'], $slow['queries'], $slow['mem'] ) : 'p95 ' . $s['p95'] . ' ms', 'change' => 'Cache the expensive query behind a short transient and trim the plugins that run on that route.', 'effect' => 'TTFB drops for every visitor to that template', 'risk' => 'medium', 'size' => 'M', 'area' => 'speed', 'auto' => false, 'impact' => 0.7 );
	}
	if ( ! empty( $d['a11y'] ) ) { $props[] = array( 'title' => 'Label the unlabeled controls', 'evidence' => $d['a11y'] . ' pages reported buttons without a name or images without alt text', 'change' => 'Add aria-labels and alt text in the templates the beacon named.', 'effect' => 'screen readers and search engines understand the page', 'risk' => 'low', 'size' => 'S', 'area' => 'a11y', 'auto' => true, 'impact' => 0.4 ); }
	foreach ( array_slice( isset( $d['competitors']['gaps'] ) ? $d['competitors']['gaps'] : array(), 0, 2 ) as $g ) {
		$props[] = array( 'title' => $g['idea'], 'evidence' => $g['source'] . ': ' . $g['title'], 'change' => $g['change'], 'effect' => 'a feature the competition has that this site does not, done the StockMarketLoop way', 'risk' => 'medium', 'size' => 'L', 'area' => 'competition', 'auto' => false, 'impact' => 0.55 );
	}
	foreach ( $props as &$p ) { $w = isset( $weights[ $p['area'] ] ) ? $weights[ $p['area'] ] : 1.0; $p['score'] = round( $p['impact'] * $w, 3 ); }
	unset( $p );
	usort( $props, function ( $a, $b ) { return $b['score'] <=> $a['score']; } );
	return array( 'summary' => implode( ' ', $lines ), 'proposals' => array_slice( $props, 0, 7 ), 'model' => 'rules' );
}

/* ---------- competitors: a headline becomes an idea ---------- */
/** What this site can already do, by the REST namespaces its plugins register. Used to tell "we have this" from "a gap". */
function sml_wd_capability_map() {
	return array(
		'live streaming'   => array( 'ns' => array( 'sml-live', 'sml-live-chat', 'sml-live-control' ), 'words' => array( 'live stream', 'livestream', 'go live', 'streaming', 'broadcast' ) ),
		'live chat'        => array( 'ns' => array( 'sml-live-chat', 'sml-live-chat-threads' ), 'words' => array( 'chat', 'live chat' ) ),
		'super chat'       => array( 'ns' => array( 'sml-superchat' ), 'words' => array( 'super chat', 'tipping', 'tips', 'cheer', 'bits' ) ),
		'subscriptions'    => array( 'ns' => array( 'sml-sub', 'sml-subscribers', 'sml-creator-tiers' ), 'words' => array( 'subscription', 'membership', 'paid tier', 'premium' ) ),
		'newsletters'      => array( 'ns' => array( 'sml-letters', 'sml-letter-studio', 'sml-personal-letters' ), 'words' => array( 'newsletter', 'publication', 'post', 'article', 'writing' ) ),
		'alerts'           => array( 'ns' => array( 'sml-alert-router', 'sml-cues' ), 'words' => array( 'alert', 'notification', 'price target', 'signal' ) ),
		'charts'           => array( 'ns' => array( 'sml-massive', 'sml-scan', 'sml-scanner' ), 'words' => array( 'chart', 'indicator', 'screener', 'scanner', 'technical' ) ),
		'options'          => array( 'ns' => array( 'sml-options', 'sml-options-intelligence' ), 'words' => array( 'options', 'option chain', 'greeks' ) ),
		'groups'           => array( 'ns' => array( 'sml-group-shell', 'sml-group-live', 'sml-group-tools' ), 'words' => array( 'community', 'group', 'server', 'club', 'forum' ) ),
		'video on demand'  => array( 'ns' => array( 'sml-watch', 'sml-watch-index', 'sml-video-upload-studio' ), 'words' => array( 'video', 'vod', 'clip', 'upload' ) ),
		'short video'      => array( 'ns' => array( 'sml-short' ), 'words' => array( 'shorts', 'short-form', 'reels', 'vertical video' ) ),
		'playlists'        => array( 'ns' => array( 'sml-playlists' ), 'words' => array( 'playlist', 'series', 'collection' ) ),
		'voice rooms'      => array( 'ns' => array( 'sml-voice-rooms', 'sml-voice' ), 'words' => array( 'voice', 'audio room', 'spaces', 'podcast' ) ),
		'emotes'           => array( 'ns' => array( 'sml-emotes' ), 'words' => array( 'emote', 'emoji', 'sticker' ) ),
		'gifts'            => array( 'ns' => array( 'sml-gifts', 'sml-lb' ), 'words' => array( 'gift', 'virtual currency', 'coins', 'bucks' ) ),
		'messaging'        => array( 'ns' => array( 'sml-loopletters', 'sml-mhub', 'sml-friends' ), 'words' => array( 'messag', 'dm', 'inbox', 'friends' ) ),
		'games'            => array( 'ns' => array( 'sml-games', 'sml-arcade' ), 'words' => array( 'game', 'arcade', 'quiz', 'challenge' ) ),
		'ai assistant'     => array( 'ns' => array( 'sml-creator-coach', 'sml-engines' ), 'words' => array( ' ai ', 'assistant', 'copilot', 'gpt', 'claude', 'llm', 'machine learning' ) ),
		'mobile app'       => array( 'ns' => array( 'sml-dist' ), 'words' => array( 'mobile app', 'ios', 'android', 'app store', 'play store' ) ),
		'paper trading'    => array( 'ns' => array( 'sml-trading-floor' ), 'words' => array( 'paper trad', 'simulat', 'practice' ) ),
		'search'           => array( 'ns' => array( 'sml-site-search' ), 'words' => array( 'search', 'discover' ) ),
		'analytics'        => array( 'ns' => array( 'sml-creator-analytics', 'sml-site-analytics' ), 'words' => array( 'analytics', 'insights', 'dashboard' ) ),
		'earnings'         => array( 'ns' => array( 'sml-intel' ), 'words' => array( 'earnings', 'calendar', 'fundamental' ) ),
		'watchlists'       => array( 'ns' => array( 'sml-feed', 'sml-ticker-community' ), 'words' => array( 'watchlist', 'portfolio', 'track' ) ),
	);
}
/**
 * Given a headline and the site's live namespaces, say which of our capabilities it touches and whether that is a gap.
 * Returns null for headlines that are not about product (funding, hiring, outages, holidays).
 */
function sml_wd_competitor_idea( $source, $title, array $namespaces ) {
	$t = ' ' . strtolower( html_entity_decode( (string) $title ) ) . ' ';
	if ( preg_match( '/\b(hiring|we.re hiring|funding|series [abc]|valuation|layoff|outage|holiday|closed|earnings call|quarterly results|q[1-4] results)\b/', $t ) ) { return null; }
	$have = array(); $touch = array(); $strength = array();
	foreach ( sml_wd_capability_map() as $cap => $def ) {
		$hit = 0;
		foreach ( $def['words'] as $w ) { if ( false !== strpos( $t, $w ) ) { $hit = max( $hit, strlen( trim( $w ) ) ); } }
		if ( ! $hit ) { continue; }
		$touch[] = $cap; $strength[ $cap ] = $hit;
		foreach ( $def['ns'] as $ns ) { foreach ( $namespaces as $live ) { if ( 0 === strpos( $live, $ns . '/' ) || $live === $ns ) { $have[] = $cap; break 2; } } }
	}
	$touch = array_values( array_unique( $touch ) ); $have = array_values( array_unique( $have ) );
	if ( ! $touch ) { return null; }
	/* the most specific match leads: "live chat" over "chat", "shorts" over "video" */
	usort( $touch, function ( $a, $b ) use ( $strength ) { return $strength[ $b ] <=> $strength[ $a ]; } );
	$gap = array_values( array_diff( $touch, $have ) );
	$focus = $gap ? $gap[0] : $touch[0];
	$kind = $gap ? 'gap' : 'parity';
	$idea = $gap
		? sprintf( 'Build %s for StockMarketLoop', $focus )
		: sprintf( 'Go further than %s on %s', $source, $focus );
	$change = $gap
		? sprintf( '%s just shipped work on %s ("%s"). This site has no %s layer yet; design one that fits the Loop Channel, Loop Letters and the Academy, and ship it behind a feature flag.', $source, $focus, trim( (string) $title ), $focus )
		: sprintf( '%s shipped "%s". This site already has %s (%s); read what they did, pick the one detail members would notice, and do it better with the data this site already has (live charts, alerts, the Academy).', $source, trim( (string) $title ), $focus, implode( ', ', $have ) );
	return array( 'kind' => $kind, 'focus' => $focus, 'touches' => $touch, 'have' => $have, 'idea' => $idea, 'change' => $change, 'source' => $source, 'title' => trim( (string) $title ) );
}
