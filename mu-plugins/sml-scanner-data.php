<?php
/**
 * Plugin Name: SML Scanner Data
 * Description: Real, complete rows for the Live Market Scanner (Analyst Dashboard + group tools): one moomoo OpenD snapshot for the whole universe, multi-day changes and rankings from Massive's market-wide daily bars, and a measured 5-minute change.
 * Version: 1.4.0
 *
 * WHY THIS EXISTS. The scanner table has ~36 columns but its feed (/sml-scanner/v1/live)
 * only carried price, change and the Massive day bar. Everything else was computed in the
 * browser from fields that were not there — so Volume read 0 and % Volume / Pre-Mkt read
 * -100% before the open (Massive's day bar resets to zero), and 52-week, P/E, P/B, turnover,
 * 5D-250D and YTD were permanently "--".
 *
 * SOURCES, all real:
 *   - moomoo OpenD get_market_snapshot via the bridge route /scanner-snapshot: price by
 *     session (pre / regular / after / overnight), volume, turnover, turnover rate, volume
 *     ratio, amplitude, 52-week range, market cap, P/E TTM + LYR, P/B, dividend yield, ROE,
 *     bid/ask. One call covers up to 400 symbols; shared across all viewers for 2s.
 *   - Massive grouped daily bars (stocks plan is unmetered): the closes N sessions back for
 *     5D/10D/20D/60D/120D/250D and YTD, and prior-session volume for % Volume. Past sessions
 *     never change, so each date is fetched once and stored.
 *   - 5M: the latest price against the shared snapshot from ~5 minutes earlier (kept here),
 *     falling back to moomoo's own 5-minute-ago price in the regular session.
 * If the bridge is down, rows come from the Massive snapshot and any field without a real
 * value is null ("--"), never 0.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

const SML_SD_VERSION   = '1.4.0';
const SML_SD_GROUP     = 'sml_scanner_data';
const SML_SD_DAY_OPT   = 'sml_sd_day_';          /* + Ymd: compact "SYM c v" per session */
const SML_SD_WINDOWS   = array( 5, 10, 20, 60, 120, 250 );

function sml_sd_stocks() {
	return array( 'NVDA','TSLA','AMD','AAPL','MSFT','AMZN','META','GOOGL','NFLX','AVGO','SMCI','PLTR','SOFI','RIVN','COIN','MSTR','INTC','MU','CRM','ORCL','ADBE','UBER','ABNB','SHOP','PYPL','HOOD','DKNG','BA','CAT','DIS','NKE','SBUX','MCD','WMT','COST','TGT','HD','JPM','BAC','WFC','GS','MS','V','MA','XOM','CVX','OXY','COP','PFE','MRNA','JNJ','LLY','UNH','ABBV','AMGN','T','VZ','TMUS','F','GM','NIO','LCID','CCL','AAL','UAL','DAL','MARA','RIOT','CLSK','GME','AMC','SOUN','BBAI','IONQ','RGTI','QUBT','ARM','SNOW','NET','DDOG','CRWD','PANW','ROKU','SPOT' );
}

function sml_sd_etfs() {
	return array( 'SPY','QQQ','IWM','DIA','VTI','VOO','XLF','XLE','XLK','XLV','XLI','XLY','XLP','XLU','XLB','SMH','SOXL','SOXS','TQQQ','SQQQ','UVXY','ARKK','GLD','SLV','USO','TLT','HYG','EEM','BITO','IBIT' );
}

function sml_sd_clean( $sym ) {
	$sym = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $sym ) );
	return ( '' !== $sym && strlen( $sym ) <= 10 ) ? $sym : '';
}

function sml_sd_num( $v ) {
	if ( null === $v || '' === $v || ! is_numeric( $v ) ) return null;
	$f = (float) $v;
	return is_finite( $f ) ? $f : null;
}

function sml_sd_massive( $path, $params = array(), $ttl = 30 ) {
	if ( function_exists( 'sml_als_massive' ) ) return sml_als_massive( $path, $params, $ttl );
	return new WP_Error( 'sml_sd_no_provider', 'Market-data provider is not available.' );
}

/* =============================================================== clock */

function sml_sd_et_now() {
	return new DateTimeImmutable( 'now', new DateTimeZone( 'America/New_York' ) );
}

/** PRE | REGULAR | AFTER | OVERNIGHT | CLOSED — same boundaries as the bridge and the client. */
function sml_sd_session( ?DateTimeImmutable $now = null ) {
	$now = $now ?: sml_sd_et_now();
	if ( (int) $now->format( 'N' ) >= 6 ) return 'CLOSED';
	$m = (int) $now->format( 'G' ) * 60 + (int) $now->format( 'i' );
	if ( $m >= 240 && $m < 570 ) return 'PRE';
	if ( $m >= 570 && $m < 960 ) return 'REGULAR';
	if ( $m >= 960 && $m < 1200 ) return 'AFTER';
	return 'OVERNIGHT';
}

/**
 * Has today's regular session started? If so, "today" is day 0 and N-day changes compare
 * with the close N sessions before it; if not (premarket, weekend, after midnight), the last
 * completed session is day 0.
 */
function sml_sd_today_is_day0( ?DateTimeImmutable $now = null ) {
	$now = $now ?: sml_sd_et_now();
	if ( (int) $now->format( 'N' ) >= 6 ) return false;
	return ( (int) $now->format( 'G' ) * 60 + (int) $now->format( 'i' ) ) >= 570;
}

/* ============================================================= history */

/** Completed US sessions before today (ET), ascending, from SPY's daily bars. */
function sml_sd_sessions() {
	$today  = sml_sd_et_now()->format( 'Y-m-d' );
	$cached = get_transient( 'sml_sd_sessions' );
	if ( is_array( $cached ) && ( $cached['today'] ?? '' ) === $today && ! empty( $cached['dates'] ) ) return $cached['dates'];

	$from = sml_sd_et_now()->modify( '-420 days' )->format( 'Y-m-d' );
	$to   = sml_sd_et_now()->modify( '-1 day' )->format( 'Y-m-d' );
	$data = sml_sd_massive( '/v2/aggs/ticker/SPY/range/1/day/' . $from . '/' . $to, array( 'adjusted' => 'true', 'sort' => 'asc', 'limit' => 5000 ), 3600 );
	if ( is_wp_error( $data ) || empty( $data['results'] ) ) return is_array( $cached ) ? (array) ( $cached['dates'] ?? array() ) : array();
	$dates = array();
	foreach ( $data['results'] as $bar ) {
		if ( ! isset( $bar['t'] ) ) continue;
		$d = ( new DateTimeImmutable( '@' . (int) floor( $bar['t'] / 1000 ) ) )->setTimezone( new DateTimeZone( 'America/New_York' ) )->format( 'Y-m-d' );
		if ( $d < $today ) $dates[] = $d;
	}
	$dates = array_values( array_unique( $dates ) );
	set_transient( 'sml_sd_sessions', array( 'today' => $today, 'dates' => $dates ), 6 * HOUR_IN_SECONDS );
	return $dates;
}

/** The session dates the history columns need, keyed by role. */
function sml_sd_needed_dates( array $dates, $today_is_day0 ) {
	$n = count( $dates );
	if ( ! $n ) return array();
	$shift = $today_is_day0 ? 0 : 1;          /* day 0 = today, or the last completed session */
	$need  = array();
	foreach ( SML_SD_WINDOWS as $w ) {
		$i = $n - $w - $shift;
		if ( $i >= 0 ) $need[ 'c' . $w ] = $dates[ $i ];
	}
	/* volume of the session before day 0, for % Volume */
	$i = $n - 1 - $shift;
	if ( $i >= 0 ) $need['vprev'] = $dates[ $i ];
	/* YTD: last session of the year before day 0's year */
	$day0_year = $today_is_day0 ? sml_sd_et_now()->format( 'Y' ) : substr( $dates[ $n - 1 ], 0, 4 );
	for ( $j = $n - 1; $j >= 0; $j-- ) {
		if ( substr( $dates[ $j ], 0, 4 ) < $day0_year ) { $need['ytd'] = $dates[ $j ]; break; }
	}
	return $need;
}

/** Stored grouped bars for one session: array sym => [close, volume], or null if not fetched yet. */
function sml_sd_day( $date ) {
	static $memo = array();
	if ( isset( $memo[ $date ] ) ) return $memo[ $date ];
	$name = SML_SD_DAY_OPT . str_replace( '-', '', $date );
	$raw  = get_option( $name, null );
	if ( ! is_string( $raw ) || '' === $raw ) {
		/* a stale notoptions entry can hide a row that exists — ask the table before believing it */
		global $wpdb;
		$raw = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $name ) );
		if ( ! is_string( $raw ) || '' === $raw ) return null;
	}
	$parsed = array();
	foreach ( explode( ';', $raw ) as $item ) {
		$parts = explode( ' ', $item );
		if ( 3 === count( $parts ) ) $parsed[ $parts[0] ] = array( (float) $parts[1], (float) $parts[2] );
	}
	return $memo[ $date ] = $parsed;
}

/** Fetch and store one session's market-wide daily bars. */
function sml_sd_fetch_day( $date ) {
	$data = sml_sd_massive( '/v2/aggs/grouped/locale/us/market/stocks/' . $date, array( 'adjusted' => 'true', 'include_otc' => 'false' ), 3600 );
	if ( is_wp_error( $data ) || empty( $data['results'] ) ) return false;
	$parts = array();
	foreach ( $data['results'] as $bar ) {
		$sym = sml_sd_clean( $bar['T'] ?? '' );
		$c   = sml_sd_num( $bar['c'] ?? null );
		$v   = sml_sd_num( $bar['v'] ?? null );
		if ( '' === $sym || null === $c || $c <= 0 ) continue;
		$parts[] = $sym . ' ' . round( $c, 4 ) . ' ' . (int) ( $v ?? 0 );
	}
	if ( ! $parts ) return false;
	update_option( SML_SD_DAY_OPT . str_replace( '-', '', $date ), implode( ';', $parts ), false );
	wp_cache_delete( 'bases', SML_SD_GROUP );
	return true;
}

/**
 * Make sure every needed session is stored. Runs in cron, a few dates per run, never in a
 * viewer's request. Also removes stored sessions nothing needs any more.
 */
function sml_sd_build_history() {
	$dates = sml_sd_sessions();
	if ( ! $dates ) return;
	$wanted = array_values( array_unique( array_merge(
		array_values( sml_sd_needed_dates( $dates, true ) ),
		array_values( sml_sd_needed_dates( $dates, false ) )
	) ) );
	$fetched = 0;
	foreach ( $wanted as $date ) {
		if ( null !== sml_sd_day( $date ) ) continue;
		if ( $fetched >= 4 ) {
			wp_schedule_single_event( time() + 30, 'sml_sd_build_history' );
			break;
		}
		sml_sd_fetch_day( $date );
		$fetched++;
	}
	global $wpdb;
	$keep = array_map( function ( $d ) { return SML_SD_DAY_OPT . str_replace( '-', '', $d ); }, $wanted );
	foreach ( (array) $wpdb->get_col( $wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( SML_SD_DAY_OPT ) . '%' ) ) as $name ) {
		if ( ! in_array( $name, $keep, true ) ) delete_option( $name );
	}
}
add_action( 'sml_sd_build_history', 'sml_sd_build_history' );

add_action( 'init', function () {
	if ( ! wp_next_scheduled( 'sml_sd_build_history_daily' ) ) {
		wp_schedule_event( time() + 60, 'hourly', 'sml_sd_build_history_daily' );
	}
} );
add_action( 'sml_sd_build_history_daily', 'sml_sd_build_history' );

/**
 * Per-symbol bases for the history columns, for the current day-0 definition — trimmed to
 * the symbols asked for and cached, so a scanner refresh never loads market-wide bars.
 */
function sml_sd_bases( array $symbols ) {
	$day0  = sml_sd_today_is_day0();
	$dates = sml_sd_sessions();
	$need  = sml_sd_needed_dates( $dates, $day0 );
	$sig   = md5( wp_json_encode( $need ) . '|' . implode( ',', $symbols ) );
	$hit   = wp_cache_get( 'bases', SML_SD_GROUP );
	if ( is_array( $hit ) && ( $hit['sig'] ?? '' ) === $sig ) return $hit;
	$out   = array( 'sig' => $sig, 'need' => $need, 'days' => array(), 'missing' => array() );
	foreach ( $need as $role => $date ) {
		$day = sml_sd_day( $date );
		if ( null === $day ) { $out['missing'][] = $date; continue; }
		$out['days'][ $role ] = array_intersect_key( $day, array_flip( $symbols ) );
	}
	if ( ! $out['missing'] ) wp_cache_set( 'bases', $out, SML_SD_GROUP, 10 * MINUTE_IN_SECONDS );
	if ( $out['missing'] && ! wp_next_scheduled( 'sml_sd_build_history' ) ) {
		wp_schedule_single_event( time() + 5, 'sml_sd_build_history' );
	}
	return $out;
}

/* ====================================================== 5-minute memory */

/** Keep one shared price snapshot about every 20s for the last 8 minutes. */
function sml_sd_remember_prices( array $rows, $asof_ms ) {
	$ring = wp_cache_get( 'ring', SML_SD_GROUP );
	$ring = is_array( $ring ) ? $ring : array();
	$last = end( $ring );
	if ( $last && $asof_ms - $last['t'] < 20000 ) return $ring;
	$prices = array();
	foreach ( $rows as $r ) if ( null !== $r['last'] ) $prices[ $r['sym'] ] = $r['last'];
	$ring[] = array( 't' => $asof_ms, 'p' => $prices );
	$ring   = array_values( array_filter( $ring, function ( $s ) use ( $asof_ms ) { return $asof_ms - $s['t'] <= 480000; } ) );
	wp_cache_set( 'ring', $ring, SML_SD_GROUP, 900 );
	return $ring;
}

function sml_sd_price_5m_ago( array $ring, $sym, $asof_ms ) {
	foreach ( $ring as $snap ) {                       /* oldest first */
		$age = $asof_ms - $snap['t'];
		if ( $age >= 270000 && $age <= 420000 && isset( $snap['p'][ $sym ] ) ) return (float) $snap['p'][ $sym ];
	}
	return null;
}

/* ============================================================== rows */

function sml_sd_universe_symbols() {
	$movers = wp_cache_get( 'movers', SML_SD_GROUP );
	if ( ! is_array( $movers ) ) {
		$movers = array();
		foreach ( array( 'gainers', 'losers' ) as $set ) {
			$data = sml_sd_massive( '/v2/snapshot/locale/us/markets/stocks/' . $set, array(), 30 );
			if ( is_wp_error( $data ) ) continue;
			foreach ( array_slice( (array) ( $data['tickers'] ?? array() ), 0, 25 ) as $t ) {
				$sym = sml_sd_clean( $t['ticker'] ?? '' );
				$px  = sml_sd_num( $t['lastTrade']['p'] ?? ( $t['min']['c'] ?? null ) );
				if ( $sym && null !== $px && $px >= 1 ) $movers[] = $sym;
			}
		}
		wp_cache_set( 'movers', $movers, SML_SD_GROUP, 60 );
	}
	return array(
		'stocks' => sml_sd_stocks(),
		'etfs'   => sml_sd_etfs(),
		'movers' => array_values( array_diff( array_unique( $movers ), sml_sd_stocks(), sml_sd_etfs() ) ),
	);
}

/** One shared moomoo snapshot for the whole universe (every tab reads the same one). */
function sml_sd_moomoo_rows( array $symbols ) {
	if ( ! function_exists( 'sml_moomoo_cached_request' ) ) return null;
	$data = sml_moomoo_cached_request( SML_SD_GROUP, 'universe', '/scanner-snapshot', array( 'symbols' => implode( ',', array_slice( $symbols, 0, 400 ) ) ), array(
		'live_ttl' => 2, 'hold_ttl' => 45, 'fresh_ms' => 2500, 'timeout' => 8, 'retries' => 1, 'backoff_ms' => array( 250 ),
		'validator' => function ( $payload ) {
			if ( empty( $payload['available'] ) || ! is_array( $payload['rows'] ?? null ) || ! $payload['rows'] ) return new WP_Error( 'sml_sd_empty', (string) ( $payload['reason'] ?? 'No scanner rows.' ) );
			return $payload;
		},
	) );
	return ( is_array( $data ) && ! empty( $data['available'] ) ) ? $data : null;
}

/** Fallback when the bridge is down: Massive snapshots, with missing values left null. */
function sml_sd_massive_rows( array $symbols ) {
	$data = sml_sd_massive( '/v2/snapshot/locale/us/markets/stocks/tickers', array( 'tickers' => implode( ',', $symbols ) ), 4 );
	if ( is_wp_error( $data ) || ! function_exists( 'sml_als_snapshot_row' ) ) return null;
	$session = sml_sd_session();
	$rows    = array();
	foreach ( (array) ( $data['tickers'] ?? array() ) as $t ) {
		$r = sml_als_snapshot_row( $t );
		if ( ! $r['sym'] ) continue;
		$day_started = sml_sd_num( $t['day']['v'] ?? null ) > 0;
		if ( ! $day_started ) {           /* before the open Massive's day bar is all zeros */
			$r['v'] = null; $r['o'] = null; $r['h'] = null; $r['l'] = null; $r['c'] = null; $r['postPct'] = null;
		}
		$r['session']  = $session;
		$r['turnover'] = ( null !== $r['last'] && null !== $r['v'] ) ? $r['last'] * $r['v'] : null;
		$rows[] = $r;
	}
	return array( 'rows' => $rows, 'asof' => (int) round( microtime( true ) * 1000 ), 'session' => $session );
}

function sml_sd_pct( $now, $base ) {
	return ( null !== $now && null !== $base && $base > 0 ) ? ( $now - $base ) / $base * 100 : null;
}

/** Everything the scanner shows, for one tab. */
function sml_sd_live( $tab ) {
	$tab = in_array( $tab, array( 'stocks', 'etfs', 'premarket', 'afterhours', 'options' ), true ) ? $tab : 'stocks';
	$cache_key = 'live_' . $tab;
	$hit = wp_cache_get( $cache_key, SML_SD_GROUP );
	if ( is_array( $hit ) && ( microtime( true ) * 1000 - $hit['asof_ms'] ) < 1800 ) return $hit;

	$u   = sml_sd_universe_symbols();
	$all = array_values( array_unique( array_merge( $u['stocks'], $u['etfs'], $u['movers'] ) ) );

	$source = 'moomoo_opend';
	$feed   = sml_sd_moomoo_rows( $all );
	if ( ! $feed ) {
		$source = 'massive_fallback';
		$feed   = sml_sd_massive_rows( $all );
	}
	if ( ! $feed || empty( $feed['rows'] ) ) {
		return array( 'available' => false, 'reason' => 'Live market data is reconnecting.', 'rows' => array(), 'asof' => time() );
	}

	$asof_ms = (int) ( $feed['asof'] ?? round( microtime( true ) * 1000 ) );
	$session = (string) ( $feed['session'] ?? sml_sd_session() );
	$ring    = sml_sd_remember_prices( $feed['rows'], $asof_ms );
	$bases   = sml_sd_bases( $all );
	$day0    = sml_sd_today_is_day0();

	$want = 'etfs' === $tab ? $u['etfs'] : ( 'stocks' === $tab ? array_merge( $u['stocks'], $u['movers'] ) : $all );
	$want = array_flip( $want );

	$rows = array();
	foreach ( $feed['rows'] as $r ) {
		$sym = sml_sd_clean( $r['sym'] ?? '' );
		if ( '' === $sym || ! isset( $want[ $sym ] ) ) continue;
		$r['sym']  = $sym;
		$r['full'] = 'moomoo_opend' === $source;
		$last      = sml_sd_num( $r['last'] ?? null );

		/* change bases are regular-session closes; compare the regular price when today counts, else the latest */
		$ref = $day0 ? ( sml_sd_num( $r['regLast'] ?? null ) ?? $last ) : $last;
		foreach ( SML_SD_WINDOWS as $w ) {
			$base = $bases['days'][ 'c' . $w ][ $sym ][0] ?? null;
			$r[ 'chg' . $w . 'dPct' ] = sml_sd_pct( $ref, $base );
		}
		$r['ytdPct'] = sml_sd_pct( $ref, $bases['days']['ytd'][ $sym ][0] ?? null );

		$prev_volume = $bases['days']['vprev'][ $sym ][1] ?? null;
		$volume      = sml_sd_num( $r['v'] ?? null );
		$r['pv']     = $prev_volume ?: ( $r['pv'] ?? null );
		$r['volPct'] = ( null !== $volume && $prev_volume ) ? ( $volume - $prev_volume ) / $prev_volume * 100 : null;
		$r['chgAbs'] = sml_sd_num( $r['chg'] ?? null );

		$old = sml_sd_price_5m_ago( $ring, $sym, $asof_ms );
		if ( null === $old && 'REGULAR' === $session ) $old = sml_sd_num( $r['close5m'] ?? null );
		$r['chg5mPct'] = sml_sd_pct( $last, $old );

		/* regular-session opening gap, once the session has opened */
		$r['gapPct'] = $day0 ? sml_sd_pct( sml_sd_num( $r['o'] ?? null ), sml_sd_num( $r['pc'] ?? null ) ) : null;
		$rows[] = $r;
	}

	/* rankings within the universe, best change = 1 */
	foreach ( array( 'rank5d' => 'chg5dPct', 'rank10d' => 'chg10dPct', 'rank20d' => 'chg20dPct' ) as $rank_key => $field ) {
		$order = array();
		foreach ( $rows as $i => $r ) if ( null !== $r[ $field ] ) $order[ $i ] = $r[ $field ];
		arsort( $order );
		$pos = 0;
		foreach ( array_keys( $order ) as $i ) $rows[ $i ][ $rank_key ] = ++$pos;
		foreach ( $rows as $i => $r ) if ( ! isset( $rows[ $i ][ $rank_key ] ) ) $rows[ $i ][ $rank_key ] = null;
	}

	$out = array(
		'available' => true,
		'rows'      => $rows,
		'asof'      => (int) floor( $asof_ms / 1000 ),
		'asof_ms'   => $asof_ms,
		'session'   => $session,
		'source'    => $source,
		'history'   => array( 'ready' => empty( $bases['missing'] ), 'sessions' => $bases['need'] ),
	);
	wp_cache_set( $cache_key, $out, SML_SD_GROUP, 5 );
	return $out;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-scanner/v1', '/live', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function ( WP_REST_Request $request ) {
			$res = rest_ensure_response( sml_sd_live( sanitize_key( (string) $request->get_param( 'tab' ) ) ) );
			$res->header( 'Cache-Control', 'no-store' );
			return $res;
		},
	), true );   /* replaces the plugin's movers-only feed */
}, 99 );

/* ======================================================= index cards */

/**
 * The dashboard's index strip, from ETFs we are licensed to show.
 *
 * 2026-09-16: the strip briefly used Cboe's public delayed-quote JSON for real index levels.
 * Cboe's delayed-quotes site strictly prohibits downloading that data with programs (and
 * blocks the IPs that do), and its market-data policies bar redistribution without a data
 * agreement. moomoo does not carry US indices ("US stock indices are not supported") and the
 * Massive plan has no indices entitlement, so the owner chose ETFs:
 *   S&P 500 → SPY, NASDAQ → QQQ, DOW JONES → DIA, RUSSELL 2000 → IWM (the base feed's rows)
 *   VIX → VIXY (short-term VIX futures ETF) — Massive snapshot
 * Every card says which ETF it shows ("via SPY"). A real index needs a paid indices feed.
 */
function sml_sd_index_etfs() {
	return array( 'S&P 500' => 'SPY', 'NASDAQ' => 'QQQ', 'DOW JONES' => 'DIA', 'RUSSELL 2000' => 'IWM', 'VIX' => 'VIXY' );
}

function sml_sd_vix_etf_row() {
	$hit = get_transient( 'sml_sd_vixy_row' );
	if ( is_array( $hit ) ) return $hit;
	$data = sml_sd_massive( '/v2/snapshot/locale/us/markets/stocks/tickers', array( 'tickers' => 'VIXY' ), 4 );
	$row  = null;
	if ( ! is_wp_error( $data ) && function_exists( 'sml_als_snapshot_row' ) && ! empty( $data['tickers'][0] ) ) {
		$r = sml_als_snapshot_row( $data['tickers'][0] );
		if ( null !== ( $r['last'] ?? null ) && $r['last'] > 0 ) {
			$row = array( 'name' => 'VIX', 'sym' => 'VIXY', 'proxy' => 'VIXY', 'last' => round( (float) $r['last'], 2 ), 'chg' => null === $r['chg'] ? null : round( (float) $r['chg'], 2 ), 'chgPct' => $r['chgPct'] );
		}
	}
	if ( $row ) update_option( 'sml_sd_vixy_last', $row, false );
	else $row = get_option( 'sml_sd_vixy_last' ) ?: null;
	set_transient( 'sml_sd_vixy_row', $row ?: array(), $row ? 20 : 30 );
	return $row;
}

/* Add the VIX card (VIXY) to /sml/v1/dash-idx; the four index cards keep their ETF rows. */
add_filter( 'rest_request_after_callbacks', function ( $response, $handler, $request ) {
	if ( ! $request instanceof WP_REST_Request || '/sml/v1/dash-idx' !== $request->get_route() ) return $response;
	$is_obj = $response instanceof WP_REST_Response;
	$data   = $is_obj ? $response->get_data() : $response;
	if ( ! is_array( $data ) ) return $response;
	$vix = sml_sd_vix_etf_row();
	if ( ! $vix ) return $response;
	$rows = array_values( array_filter( (array) ( $data['rows'] ?? array() ), function ( $r ) { return 'VIX' !== ( $r['name'] ?? '' ); } ) );
	$rows[] = $vix;
	$data['rows'] = $rows;
	$data['available'] = true;
	if ( $is_obj ) { $response->set_data( $data ); return $response; }
	return $data;
}, 10, 3 );

/* ======================================================= index sparklines */

/**
 * How long card lines are reused: refresh on every dashboard ask (60s) during the session
 * and the first half hour after, 10 minutes otherwise, 30s after a failure.
 */
function sml_sd_index_ttl( $ok ) {
	if ( ! $ok ) return 30;
	$session = sml_sd_session();
	if ( 'REGULAR' === $session ) return 50;
	$now = sml_sd_et_now();
	$m   = (int) $now->format( 'G' ) * 60 + (int) $now->format( 'i' );
	return ( 'AFTER' === $session && $m < 990 ) ? 50 : 600;
}

/** Each card's line: its ETF's 5-minute closes for the latest trading day (VIX card = VIXY). */
function sml_sd_index_sparks() {
	$hit = get_transient( 'sml_sd_idx_spark_etf' );
	if ( is_array( $hit ) ) return $hit;
	$out = array( 'available' => false, 'series' => array(), 'up' => array(), 'session' => array(), 'proxy' => sml_sd_index_etfs(), 'source' => 'etf' );
	$tz  = new DateTimeZone( 'America/New_York' );
	foreach ( sml_sd_index_etfs() as $name => $sym ) {
		$req = new WP_REST_Request( 'GET', '/sml/v1/dash-bars' );
		foreach ( array( 'symbol' => $sym, 'mult' => 5, 'unit' => 'minute', 'days' => 2 ) as $k => $v ) $req->set_param( $k, $v );
		$d = rest_do_request( $req )->get_data();
		if ( empty( $d['available'] ) || empty( $d['bars'] ) ) continue;
		$by_day = array();
		foreach ( $d['bars'] as $b ) {
			$c = sml_sd_num( $b['c'] ?? null );
			if ( null === $c || $c <= 0 || empty( $b['t'] ) ) continue;
			$day = ( new DateTimeImmutable( '@' . intdiv( (int) $b['t'], 1000 ) ) )->setTimezone( $tz )->format( 'Y-m-d' );
			$by_day[ $day ][] = round( $c, 2 );
		}
		if ( ! $by_day ) continue;
		ksort( $by_day );
		$day    = array_key_last( $by_day );
		$series = count( $by_day[ $day ] ) >= 2 ? $by_day[ $day ] : array_slice( array_merge( ...array_values( $by_day ) ), -78 );
		if ( count( $series ) < 2 ) continue;
		$out['series'][ $name ]  = $series;
		$out['session'][ $name ] = $day;
		$out['up'][ $name ]      = end( $series ) >= $series[0];
	}
	/* colour like the card: against the previous close */
	$idx = rest_do_request( new WP_REST_Request( 'GET', '/sml/v1/dash-idx' ) )->get_data();
	foreach ( (array) ( $idx['rows'] ?? array() ) as $r ) {
		if ( isset( $out['series'][ $r['name'] ?? '' ] ) && null !== ( $r['chg'] ?? null ) ) $out['up'][ $r['name'] ] = $r['chg'] >= 0;
	}
	$out['available'] = ! empty( $out['series'] );
	set_transient( 'sml_sd_idx_spark_etf', $out, sml_sd_index_ttl( $out['available'] ) );
	return $out;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml/v1', '/dash-idx-spark', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function () { return rest_ensure_response( sml_sd_index_sparks() ); },
	) );
} );
