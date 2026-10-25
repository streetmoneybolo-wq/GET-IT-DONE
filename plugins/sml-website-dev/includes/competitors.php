<?php
/**
 * Competitor watch. Reads the public product feeds of the platforms this site competes with (what they ship, in their
 * own words), keeps the latest items, and turns each one into an idea for StockMarketLoop: a gap when it is something this
 * site has no layer for, parity-plus when this site already has it and should go further. The site's own capabilities
 * are read from the REST namespaces its plugins register, so the comparison updates itself as plugins come and go.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** name|feed URL. Public RSS/Atom feeds only; a feed that stops answering is skipped, never retried in a loop. */
function sml_wd_default_competitors() {
	return array(
		'TradingView|https://www.tradingview.com/blog/en/feed/',
		'Discord|https://discord.com/blog/rss.xml',
		'Robinhood|https://newsroom.aboutrobinhood.com/feed/',
		'Twitch|https://blog.twitch.tv/en/rss/',
		'YouTube|https://blog.youtube/rss/',
		'Substack|https://on.substack.com/feed',
		'Patreon|https://news.patreon.com/feed',
		'Public.com|https://public.com/learn/feed',
		'Webull|https://www.webull.com/blog/rss',
		'StockTwits|https://stocktwits.com/blog/feed',
	);
}

function sml_wd_competitors_due() {
	$s = get_option( 'sml_wd_competitors', array() );
	$last = isset( $s['at'] ) ? strtotime( $s['at'] ) : 0;
	return ( time() - $last ) > (int) sml_wd_knob( 'competitorScanHours' ) * HOUR_IN_SECONDS;
}

function sml_wd_parse_feed( $xml ) {
	$items = array();
	$xml = (string) $xml;
	if ( '' === $xml ) { return $items; }
	libxml_use_internal_errors( true );
	$doc = simplexml_load_string( $xml, 'SimpleXMLElement', LIBXML_NOCDATA | LIBXML_NONET );
	if ( ! $doc ) { return $items; }
	$nodes = array();
	if ( isset( $doc->channel->item ) ) { foreach ( $doc->channel->item as $it ) { $nodes[] = array( 'title' => (string) $it->title, 'link' => (string) $it->link, 'date' => (string) $it->pubDate, 'summary' => (string) $it->description ); } }
	elseif ( isset( $doc->entry ) ) { foreach ( $doc->entry as $it ) { $link = ''; foreach ( $it->link as $l ) { $a = $l->attributes(); if ( ! isset( $a['rel'] ) || 'alternate' === (string) $a['rel'] ) { $link = (string) $a['href']; break; } } $nodes[] = array( 'title' => (string) $it->title, 'link' => $link, 'date' => (string) ( $it->updated ?: $it->published ), 'summary' => (string) ( $it->summary ?: $it->content ) ); } }
	foreach ( array_slice( $nodes, 0, 12 ) as $n ) {
		$title = trim( wp_strip_all_tags( html_entity_decode( $n['title'], ENT_QUOTES | ENT_HTML5 ) ) );
		if ( '' === $title ) { continue; }
		$items[] = array( 'title' => substr( $title, 0, 180 ), 'link' => esc_url_raw( $n['link'] ), 'at' => $n['date'] ? gmdate( 'c', (int) strtotime( $n['date'] ) ) : '', 'summary' => substr( trim( wp_strip_all_tags( html_entity_decode( $n['summary'], ENT_QUOTES | ENT_HTML5 ) ) ), 0, 240 ) );
	}
	return $items;
}

function sml_wd_scan_competitors( $reason = 'manual' ) {
	if ( get_transient( 'sml_wd_comp_lock' ) ) { return get_option( 'sml_wd_competitors', array() ); }
	set_transient( 'sml_wd_comp_lock', 1, 120 );
	$t0 = microtime( true ); $deadline = $t0 + 50;
	$ns = (array) get_option( 'sml_wd_namespaces', array() );
	if ( ! $ns ) { $r = sml_wd_http( home_url( '/wp-json/' ) ); $d = $r['ok'] ? json_decode( $r['body'], true ) : null; $ns = is_array( $d ) && isset( $d['namespaces'] ) ? (array) $d['namespaces'] : array(); if ( $ns ) { update_option( 'sml_wd_namespaces', $ns, false ); } }
	$prev = get_option( 'sml_wd_competitors', array() ); $seen = isset( $prev['seen'] ) && is_array( $prev['seen'] ) ? $prev['seen'] : array();
	$sources = array(); $items = array(); $gaps = array(); $parity = array(); $errors = array();
	foreach ( (array) sml_wd_settings()['competitors'] as $line ) {
		if ( microtime( true ) > $deadline ) { break; }
		$parts = explode( '|', $line, 2 ); if ( 2 !== count( $parts ) ) { continue; }
		$name = trim( $parts[0] ); $url = trim( $parts[1] );
		$r = sml_wd_http( $url, array( 'timeout' => 7, 'headers' => array( 'Accept' => 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' ) ) );
		if ( ! $r['ok'] || 200 !== $r['status'] ) { $errors[] = $name . ' → HTTP ' . $r['status']; $sources[] = array( 'name' => $name, 'ok' => false, 'items' => 0, 'ms' => $r['ms'] ); continue; }
		$feed = sml_wd_parse_feed( $r['body'] );
		$sources[] = array( 'name' => $name, 'ok' => true, 'items' => count( $feed ), 'ms' => $r['ms'] );
		foreach ( $feed as $it ) {
			$idea = sml_wd_competitor_idea( $name, $it['title'], $ns );
			$row = array_merge( $it, array( 'source' => $name, 'idea' => $idea, 'new' => ! isset( $seen[ md5( $name . $it['title'] ) ] ) ) );
			$seen[ md5( $name . $it['title'] ) ] = time();
			$items[] = $row;
			if ( $idea && 'gap' === $idea['kind'] ) { $gaps[] = $idea + array( 'link' => $it['link'], 'at' => $it['at'] ); }
			elseif ( $idea ) { $parity[] = $idea + array( 'link' => $it['link'], 'at' => $it['at'] ); }
		}
	}
	usort( $items, function ( $a, $b ) { return strcmp( $b['at'], $a['at'] ); } );
	/* the seen list is bounded: forget titles older than sixty days */
	$seen = array_filter( $seen, function ( $t ) { return $t > time() - 60 * DAY_IN_SECONDS; } );
	$result = array( 'at' => gmdate( 'c' ), 'reason' => $reason, 'ms' => (int) round( ( microtime( true ) - $t0 ) * 1000 ), 'sources' => $sources, 'errors' => $errors, 'items' => array_slice( $items, 0, 80 ), 'gaps' => array_slice( $gaps, 0, 20 ), 'parity' => array_slice( $parity, 0, 20 ), 'capabilities' => sml_wd_site_capabilities( $ns ), 'seen' => $seen );
	update_option( 'sml_wd_competitors', $result, false );
	delete_transient( 'sml_wd_comp_lock' );
	return $result;
}

/** What this site can do today, by namespace: the list the panel shows beside the competitors. */
function sml_wd_site_capabilities( array $ns ) {
	$out = array();
	foreach ( sml_wd_capability_map() as $cap => $def ) {
		$have = false;
		foreach ( $def['ns'] as $n ) { foreach ( $ns as $live ) { if ( 0 === strpos( $live, $n . '/' ) || $live === $n ) { $have = true; break 2; } } }
		$out[] = array( 'capability' => $cap, 'have' => $have );
	}
	return $out;
}
