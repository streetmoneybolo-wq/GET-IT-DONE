<?php
/**
 * The Evolve engine for the website. The same shape as the Academy's (services/sml-platform/platform/academy-evolve.js):
 *
 *  1. The digest: the last 24 hours of errors, speed, checks and competitor reads, in one bounded array.
 *  2. The knobs: a few settings this plugin owns, each on a rail, turned from the evidence and written down with the reason.
 *  3. The brief: once a day in the quiet hour (and on demand) the digest becomes a plain summary and three to seven
 *     proposals, each with evidence, the change, the expected effect, risk and size. The rules brief always runs; when a
 *     model key is configured, Claude's reading of the same digest is added on top. Small, low-risk proposals marked auto
 *     are approved on arrival. The owner approves, dismisses or marks proposals shipped from the panel.
 *  4. The learning loop: a shipped proposal snapshots the metrics of its area; a week later the engine measures the change
 *     and nudges that area's weight up or down, so the ordering of future proposals leans toward what paid off here.
 *
 * State is one option (sml_wd_evolve), bounded everywhere: 30 briefs, 200 proposals, 60 turns.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_wd_evolve_state() {
	$s = get_option( 'sml_wd_evolve', array() );
	if ( ! is_array( $s ) ) { $s = array(); }
	$s += array( 'knobs' => array(), 'turns' => array(), 'briefs' => array(), 'proposals' => array(), 'weights' => sml_wd_weight_defaults(), 'lastBriefAt' => 0, 'measured' => array() );
	foreach ( sml_wd_knob_defaults() as $k => $def ) { if ( ! isset( $s['knobs'][ $k ] ) ) { $s['knobs'][ $k ] = $def; } else { $s['knobs'][ $k ] = array_merge( $def, array_intersect_key( $s['knobs'][ $k ], array( 'value' => 1, 'pinned' => 1 ) ) ); } }
	$s['weights'] = array_merge( sml_wd_weight_defaults(), is_array( $s['weights'] ) ? $s['weights'] : array() );
	return $s;
}
function sml_wd_evolve_save( array $s ) { update_option( 'sml_wd_evolve', $s, false ); }

function sml_wd_knob( $key ) {
	static $cache = null;
	if ( null === $cache ) { $cache = sml_wd_evolve_state(); }
	return isset( $cache['knobs'][ $key ] ) ? $cache['knobs'][ $key ]['value'] : ( isset( sml_wd_knob_defaults()[ $key ] ) ? sml_wd_knob_defaults()[ $key ]['value'] : null );
}
function sml_wd_set_knob( $key, $value, $pinned = null, $reason = 'owner' ) {
	$s = sml_wd_evolve_state();
	if ( ! isset( $s['knobs'][ $key ] ) ) { return null; }
	$k = &$s['knobs'][ $key ];
	if ( null !== $value ) { $v = sml_wd_clamp_knob( $k, $value ); if ( $v !== $k['value'] ) { $s['turns'][] = array( 'at' => gmdate( 'c' ), 'knob' => $key, 'from' => $k['value'], 'to' => $v, 'reason' => $reason ); $k['value'] = $v; } }
	if ( null !== $pinned ) { $k['pinned'] = (bool) $pinned; }
	if ( count( $s['turns'] ) > 60 ) { $s['turns'] = array_slice( $s['turns'], -60 ); }
	unset( $k );
	sml_wd_evolve_save( $s );
	return $s['knobs'][ $key ];
}

/** The engine's own turns, from the evidence, never past a rail and never on a knob the owner pinned. */
function sml_wd_tune( array $d, array &$s ) {
	$turns = array();
	$turn = function ( $key, $to, $why ) use ( &$s, &$turns ) {
		$k = &$s['knobs'][ $key ]; if ( ! empty( $k['pinned'] ) ) { return; }
		$v = sml_wd_clamp_knob( $k, $to ); if ( $v === $k['value'] ) { return; }
		$s['turns'][] = array( 'at' => gmdate( 'c' ), 'knob' => $key, 'from' => $k['value'], 'to' => $v, 'reason' => $why ); $k['value'] = $v; $turns[] = $key;
	};
	$views = (int) ( isset( $d['views'] ) ? $d['views'] : 0 ); $rows = (int) ( isset( $d['rows'] ) ? $d['rows'] : 0 );
	/* sample more while there is too little to reason over, less while the table is filling fast */
	if ( $views < 80 ) { $turn( 'beaconSampleRate', $s['knobs']['beaconSampleRate']['value'] + 10, $views . ' sampled views in 24 h is too few to grade the vitals' ); }
	elseif ( $rows > 40000 ) { $turn( 'beaconSampleRate', $s['knobs']['beaconSampleRate']['value'] - 10, $rows . ' rows in the table; sampling less' ); }
	/* check more often while something is failing, less when all is green */
	$fail = (int) ( isset( $d['checks']['fail'] ) ? $d['checks']['fail'] : 0 );
	if ( $fail > 0 ) { $turn( 'checkIntervalMin', 30, $fail . ' failing checks' ); } elseif ( isset( $d['checks']['fail'] ) ) { $turn( 'checkIntervalMin', 60, 'all checks green' ); }
	/* look at more sitemap URLs while conflicts are found */
	if ( ! empty( $d['checks']['conflicts'] ) ) { $turn( 'sitemapSample', $s['knobs']['sitemapSample']['value'] + 2, $d['checks']['conflicts'] . ' indexability conflicts' ); }
	/* keep rows longer while the table is small, shorter while it is large */
	if ( $rows > 60000 ) { $turn( 'retentionDays', $s['knobs']['retentionDays']['value'] - 2, $rows . ' rows' ); }
	if ( count( $s['turns'] ) > 60 ) { $s['turns'] = array_slice( $s['turns'], -60 ); }
	return $turns;
}

/** Everything the brief reasons over, bounded. */
function sml_wd_digest() {
	global $wpdb;
	$speed = sml_wd_speed( 24 );
	$errors = sml_wd_error_summary( 24 );
	$checks = get_option( 'sml_wd_checks', array() );
	$failing = array(); $conflicts = 0;
	foreach ( ( isset( $checks['rows'] ) ? $checks['rows'] : array() ) as $r ) { if ( 'fail' === $r['status'] ) { $failing[] = array( 'id' => $r['id'], 'title' => $r['title'], 'detail' => $r['detail'], 'fix' => $r['fix'] ); } if ( 'indexability' === $r['id'] && is_array( $r['data'] ) ) { $conflicts = count( $r['data'] ); } }
	$comp = get_option( 'sml_wd_competitors', array() );
	$a11y = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(DISTINCT url) FROM ' . sml_wd_table() . " WHERE kind = 'a11y' AND at >= %s", gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS ) ) ); // phpcs:ignore
	$rows = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . sml_wd_table() ); // phpcs:ignore
	$d = array(
		'day' => gmdate( 'Y-m-d' ), 'views' => $speed['views'], 'phones' => $speed['phones'], 'rows' => $rows,
		'vitals' => $speed['vitals'] + array( 'longTasks' => $speed['longTasksPerView'] ), 'slowRoutes' => array_slice( $speed['routes'], 0, 6 ),
		'server' => $speed['server'], 'rest' => array_slice( $speed['rest'], 0, 6 ),
		'errors' => $errors,
		'checks' => array( 'fail' => isset( $checks['summary']['fail'] ) ? $checks['summary']['fail'] : 0, 'warn' => isset( $checks['summary']['warn'] ) ? $checks['summary']['warn'] : 0, 'ok' => isset( $checks['summary']['ok'] ) ? $checks['summary']['ok'] : 0, 'failing' => array_slice( $failing, 0, 6 ), 'conflicts' => $conflicts, 'at' => isset( $checks['at'] ) ? $checks['at'] : '' ),
		'competitors' => array( 'gaps' => array_slice( isset( $comp['gaps'] ) ? $comp['gaps'] : array(), 0, 6 ), 'parity' => array_slice( isset( $comp['parity'] ) ? $comp['parity'] : array(), 0, 6 ), 'at' => isset( $comp['at'] ) ? $comp['at'] : '' ),
		'a11y' => $a11y,
	);
	$d['score'] = sml_wd_health_score( $d );
	return $d;
}

/** The daily brief is due once in the quiet hour and never twice within twenty hours. */
function sml_wd_evolve_due() {
	$s = sml_wd_evolve_state();
	return ( time() - (int) $s['lastBriefAt'] ) > 20 * HOUR_IN_SECONDS && (int) gmdate( 'G' ) === (int) sml_wd_settings()['brief_hour_utc'];
}

function sml_wd_ask_model( array $d, array $weights ) {
	$key = sml_wd_ai_key();
	if ( ! $key ) { return null; }
	$system = 'You are the engineering lead for stockmarketloop.com, a WordPress platform for retail traders: Loop Channels (creator video and live streams), Loop Letters (market newsletters), groups and alerts, the Making Easy Money Academy, Loop Bucks, and a Discord-first community. You read one day of telemetry (errors, Web Vitals, server timings, health checks, what competitors shipped) and answer ONLY with JSON of this shape: '
		. '{"summary": "<120-220 words: what broke, what was slow, what the checks found, what the competition shipped that matters>", "proposals": [{"title": "<short>", "evidence": "<the numbers>", "change": "<what to change, concretely, naming the page or plugin>", "effect": "<what visitors or the owner gain>", "risk": "low|medium|high", "size": "S|M|L", "area": "speed|errors|seo|reliability|navigation|competition|a11y", "auto": false}]}. '
		. 'Rules: three to seven proposals, each grounded in the telemetry (quote the numbers), ordered by visitor impact per unit of work; favour areas with a higher weight in `weights` (what has paid off on this site before); mark auto true only for size S, risk low changes that touch no money, access or data; include at most two competition proposals and make each one a concrete feature, not a slogan; never propose removing telemetry or checks; no prose outside the JSON.';
	$body = array( 'model' => sml_wd_settings()['anthropic_model'] ?: 'claude-sonnet-5', 'max_tokens' => 1800, 'system' => $system, 'messages' => array( array( 'role' => 'user', 'content' => 'Telemetry for ' . $d['day'] . ":\n" . substr( wp_json_encode( array( 'digest' => $d, 'weights' => $weights ), JSON_UNESCAPED_SLASHES ), 0, 60000 ) ) ) );
	$r = wp_remote_post( 'https://api.anthropic.com/v1/messages', array( 'timeout' => 60, 'headers' => array( 'x-api-key' => $key, 'anthropic-version' => '2023-06-01', 'content-type' => 'application/json' ), 'body' => wp_json_encode( $body ) ) );
	if ( is_wp_error( $r ) ) { throw new RuntimeException( 'anthropic: ' . $r->get_error_message() ); }
	if ( 200 !== (int) wp_remote_retrieve_response_code( $r ) ) { throw new RuntimeException( 'anthropic_' . wp_remote_retrieve_response_code( $r ) ); }
	$j = json_decode( wp_remote_retrieve_body( $r ), true );
	$text = ''; foreach ( ( isset( $j['content'] ) ? (array) $j['content'] : array() ) as $c ) { if ( isset( $c['type'] ) && 'text' === $c['type'] ) { $text .= $c['text']; } }
	$s = trim( preg_replace( '/```(?:json)?/i', '', $text ) ); $a = strpos( $s, '{' ); $z = strrpos( $s, '}' );
	if ( false === $a || false === $z || $z <= $a ) { throw new RuntimeException( 'anthropic_bad_json' ); }
	$p = json_decode( substr( $s, $a, $z - $a + 1 ), true );
	if ( ! is_array( $p ) ) { throw new RuntimeException( 'anthropic_bad_json' ); }
	return array( 'summary' => substr( (string) ( isset( $p['summary'] ) ? $p['summary'] : '' ), 0, 2000 ), 'proposals' => isset( $p['proposals'] ) && is_array( $p['proposals'] ) ? $p['proposals'] : array(), 'model' => $body['model'] );
}

function sml_wd_adopt_proposals( array &$s, array $proposals, $day, $model ) {
	$added = array();
	foreach ( array_slice( $proposals, 0, 9 ) as $p ) {
		if ( ! is_array( $p ) || empty( $p['title'] ) ) { continue; }
		$title = substr( sanitize_text_field( (string) $p['title'] ), 0, 120 );
		$dup = false; foreach ( $s['proposals'] as $q ) { if ( strtolower( $q['title'] ) === strtolower( $title ) && ! in_array( $q['status'], array( 'dismissed', 'shipped' ), true ) ) { $dup = true; break; } }
		if ( $dup ) { continue; }
		$risk = in_array( strtolower( (string) ( isset( $p['risk'] ) ? $p['risk'] : '' ) ), array( 'low', 'medium', 'high' ), true ) ? strtolower( $p['risk'] ) : 'medium';
		$size = in_array( strtoupper( (string) ( isset( $p['size'] ) ? $p['size'] : '' ) ), array( 'S', 'M', 'L' ), true ) ? strtoupper( $p['size'] ) : 'M';
		$area = isset( $p['area'] ) && isset( sml_wd_weight_defaults()[ $p['area'] ] ) ? $p['area'] : 'reliability';
		$auto = ! empty( $p['auto'] ) && 'S' === $size && 'low' === $risk;
		$row = array( 'id' => 'p' . base_convert( (string) time(), 10, 36 ) . wp_generate_password( 4, false, false ), 'day' => $day, 'title' => $title, 'evidence' => substr( sanitize_text_field( (string) ( isset( $p['evidence'] ) ? $p['evidence'] : '' ) ), 0, 400 ), 'change' => substr( sanitize_text_field( (string) ( isset( $p['change'] ) ? $p['change'] : '' ) ), 0, 600 ), 'effect' => substr( sanitize_text_field( (string) ( isset( $p['effect'] ) ? $p['effect'] : '' ) ), 0, 300 ), 'risk' => $risk, 'size' => $size, 'area' => $area, 'model' => $model, 'score' => isset( $p['score'] ) ? (float) $p['score'] : 0.5, 'status' => $auto ? 'approved' : 'proposed', 'createdAt' => gmdate( 'c' ), 'updatedAt' => gmdate( 'c' ) );
		$s['proposals'][] = $row; $added[] = $row;
	}
	if ( count( $s['proposals'] ) > 200 ) { $s['proposals'] = array_slice( $s['proposals'], -200 ); }
	return $added;
}

function sml_wd_run_brief( $reason = 'manual' ) {
	if ( get_transient( 'sml_wd_brief_lock' ) ) { return array( 'ok' => false, 'error' => 'A brief is already running.' ); }
	set_transient( 'sml_wd_brief_lock', 1, 120 );
	$s = sml_wd_evolve_state();
	sml_wd_measure( $s );
	$d = sml_wd_digest();
	$turns = sml_wd_tune( $d, $s );
	$rules = sml_wd_rules_brief( $d, $s['weights'] );
	$model = null; $error = '';
	try { $model = sml_wd_ask_model( $d, $s['weights'] ); } catch ( Exception $e ) { $error = $e->getMessage(); }
	$summary = $rules['summary'] . ( $model && $model['summary'] ? "\n\n" . $model['summary'] : '' );
	$proposals = $model ? array_merge( $model['proposals'], $rules['proposals'] ) : $rules['proposals'];
	$added = sml_wd_adopt_proposals( $s, $proposals, $d['day'], $model ? $model['model'] : 'rules' );
	$row = array( 'day' => $d['day'], 'at' => gmdate( 'c' ), 'reason' => $reason, 'model' => $model ? $model['model'] : 'rules', 'modelError' => $error, 'summary' => $summary, 'proposalIds' => array_column( $added, 'id' ), 'turns' => $turns, 'score' => $d['score'], 'digest' => array( 'views' => $d['views'], 'errors' => $d['errors']['total'], 'distinct' => $d['errors']['distinct'], 'vitals' => $d['vitals'], 'server' => array( 'p50' => $d['server']['p50'], 'p95' => $d['server']['p95'] ), 'checks' => array( 'fail' => $d['checks']['fail'], 'warn' => $d['checks']['warn'] ) ) );
	$s['briefs'][] = $row; if ( count( $s['briefs'] ) > 30 ) { $s['briefs'] = array_slice( $s['briefs'], -30 ); }
	$s['lastBriefAt'] = time();
	sml_wd_evolve_save( $s );
	delete_transient( 'sml_wd_brief_lock' );
	return array( 'ok' => true, 'brief' => $row, 'added' => count( $added ) );
}

function sml_wd_set_proposal( $id, $status ) {
	if ( ! in_array( $status, array( 'proposed', 'approved', 'dismissed', 'building', 'shipped' ), true ) ) { return null; }
	$s = sml_wd_evolve_state();
	foreach ( $s['proposals'] as &$p ) {
		if ( $p['id'] !== $id ) { continue; }
		$p['status'] = $status; $p['updatedAt'] = gmdate( 'c' );
		/* shipped: remember where the metrics stood so the learning loop can measure the change in a week */
		if ( 'shipped' === $status ) { $p['baseline'] = sml_wd_area_metric( $p['area'] ); $p['measureAt'] = gmdate( 'c', time() + 7 * DAY_IN_SECONDS ); }
		sml_wd_evolve_save( $s );
		return $p;
	}
	return null;
}

/** The one number each area is judged by. Lower is better for all of them, so impact = (before - after) / before. */
function sml_wd_area_metric( $area ) {
	$speed = sml_wd_speed( 24 ); $err = sml_wd_error_summary( 24 ); $checks = get_option( 'sml_wd_checks', array() );
	switch ( $area ) {
		case 'speed': return array( 'metric' => 'lcp_p75', 'value' => isset( $speed['vitals']['lcp']['p75'] ) ? (float) $speed['vitals']['lcp']['p75'] : (float) $speed['server']['p95'] );
		case 'errors': return array( 'metric' => 'errors_24h', 'value' => (float) $err['total'] );
		case 'reliability': return array( 'metric' => 'rest_and_fetch_failures', 'value' => (float) ( ( isset( $err['byKind']['fetch'] ) ? $err['byKind']['fetch'] : 0 ) + ( isset( $err['byKind']['rest_error'] ) ? $err['byKind']['rest_error'] : 0 ) ) );
		case 'navigation': return array( 'metric' => '404s_24h', 'value' => (float) ( isset( $err['byKind']['http_404'] ) ? $err['byKind']['http_404'] : 0 ) );
		case 'seo': return array( 'metric' => 'failing_checks', 'value' => (float) ( isset( $checks['summary']['fail'] ) ? $checks['summary']['fail'] : 0 ) );
		case 'a11y': return array( 'metric' => 'a11y_reports', 'value' => (float) ( isset( $err['byKind']['a11y'] ) ? $err['byKind']['a11y'] : 0 ) );
		default: return array( 'metric' => 'health_inverse', 'value' => (float) ( 100 - sml_wd_health_score( sml_wd_digest() ) ) );
	}
}

/** Shipped proposals past their measure date are scored and the area weights nudged. Called before each brief. */
function sml_wd_measure( array &$s ) {
	foreach ( $s['proposals'] as &$p ) {
		if ( 'shipped' !== $p['status'] || empty( $p['measureAt'] ) || ! empty( $p['measured'] ) || strtotime( $p['measureAt'] ) > time() ) { continue; }
		$after = sml_wd_area_metric( $p['area'] ); $before = isset( $p['baseline']['value'] ) ? (float) $p['baseline']['value'] : 0.0;
		$impact = $before > 0 ? ( $before - (float) $after['value'] ) / $before : ( (float) $after['value'] > 0 ? -0.1 : 0.0 );
		$p['measured'] = array( 'at' => gmdate( 'c' ), 'before' => $before, 'after' => $after['value'], 'metric' => $after['metric'], 'impact' => round( $impact, 3 ) );
		$s['weights'] = sml_wd_learn( $s['weights'], $p['area'], $impact );
		$s['measured'][] = array( 'id' => $p['id'], 'title' => $p['title'], 'area' => $p['area'], 'impact' => round( $impact, 3 ), 'at' => gmdate( 'c' ) );
	}
	unset( $p );
	if ( count( $s['measured'] ) > 50 ) { $s['measured'] = array_slice( $s['measured'], -50 ); }
}

/** What the Evolve tab shows. */
function sml_wd_evolve_snapshot() {
	$s = sml_wd_evolve_state();
	$open = array_values( array_filter( $s['proposals'], function ( $p ) { return ! in_array( $p['status'], array( 'dismissed', 'shipped' ), true ); } ) );
	$order = array( 'building' => 0, 'approved' => 1, 'proposed' => 2 );
	usort( $open, function ( $a, $b ) use ( $order ) { $o = $order[ $a['status'] ] <=> $order[ $b['status'] ]; return $o ?: ( ( $b['score'] <=> $a['score'] ) ?: strcmp( $b['createdAt'], $a['createdAt'] ) ); } );
	$shipped = array_values( array_filter( $s['proposals'], function ( $p ) { return 'shipped' === $p['status']; } ) );
	return array(
		'ok' => true, 'asOf' => gmdate( 'c' ), 'lastBriefAt' => $s['lastBriefAt'] ? gmdate( 'c', (int) $s['lastBriefAt'] ) : '', 'aiOn' => (bool) sml_wd_ai_key(), 'model' => sml_wd_settings()['anthropic_model'],
		'brief' => $s['briefs'] ? end( $s['briefs'] ) : null, 'briefs' => array_reverse( array_slice( $s['briefs'], -7 ) ),
		'proposals' => array_slice( $open, 0, 40 ), 'shipped' => array_reverse( array_slice( $shipped, -10 ) ),
		'knobs' => $s['knobs'], 'turns' => array_reverse( array_slice( $s['turns'], -12 ) ), 'weights' => $s['weights'], 'measured' => array_reverse( array_slice( $s['measured'], -10 ) ),
		'today' => sml_wd_digest(),
	);
}
