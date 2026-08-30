/**
 * SML Daily Market Activity Report — one substantial, indexed report per day,
 * compiled from the site's OWN data (no LLM, no external provider).
 *
 * This is the "consolidate instead of one thin page per event" answer to the
 * AdSense low-value finding: instead of 30 thin per-ticker signal posts (now
 * noindexed by #7680), it publishes ONE genuinely useful market report per
 * session close, aggregating the day's real options positioning, unusual
 * flows, and movers across the deep-chain names — data the options engine
 * (#7372, sml_opt_snap_{sym}) and the Render quote cache already hold. It is
 * honestly labeled as an automated compilation (no fake human byline) and
 * cross-links the cornerstone education guides.
 *
 * Cadence: once per weekday, in the 16:00-17:00 ET window after the close, via
 * an hourly cron gate. No data (weekend / snapshots absent) -> no post.
 * Category: "Market Reports" (indexed; distinct from the noindexed auto-signal
 * "Markets" bucket). Stays indexed: the title/body carry none of #7680's
 * noindex triggers.
 * Ops:  POST /wp-json/sml-dmr/v1/run     (admin; ?force=1 ignores the clock)
 *       GET  /wp-json/sml-dmr/v1/status  (admin)
 * Kill: option sml_dmr_off = 1, or deactivate.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_dmr_run' ) ) {

	function sml_dmr_tickers() {
		if ( function_exists( 'sml_opt_config' ) ) {
			$c = sml_opt_config();
			if ( is_array( $c ) && ! empty( $c['tickers'] ) ) { return array_values( (array) $c['tickers'] ); }
		}
		return array( 'SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'AMZN' );
	}

	function sml_dmr_money( $v ) {
		$v = abs( (float) $v );
		if ( $v >= 1e9 ) { return '$' . number_format( $v / 1e9, 2 ) . 'B'; }
		if ( $v >= 1e6 ) { return '$' . number_format( $v / 1e6, 2 ) . 'M'; }
		if ( $v >= 1e3 ) { return '$' . number_format( $v / 1e3, 0 ) . 'K'; }
		return '$' . number_format( $v, 0 );
	}

	/* Gather the day's real data into a structured shape. Read-only.
	   $max_age_h bounds snapshot freshness — 8h for a real post (same session),
	   widened only by the admin preview to eyeball the template off-hours. */
	function sml_dmr_gather( $max_age_h = 8 ) {
		$tickers = sml_dmr_tickers();
		$gamma = array(); $flow = array(); $asof = '';

		foreach ( $tickers as $sym ) {
			$snap = get_option( 'sml_opt_snap_' . strtolower( $sym ), null );
			if ( ! is_array( $snap ) || empty( $snap['captured'] ) ) { continue; }
			/* same-session only: reject stale snapshots so a weekend run never
			   dresses stale data as "today" */
			if ( time() - (int) strtotime( (string) $snap['captured'] ) > (int) $max_age_h * HOUR_IN_SECONDS ) { continue; }
			if ( '' === $asof || strtotime( (string) $snap['captured'] ) > strtotime( $asof ) ) { $asof = (string) $snap['captured']; }
			$exp = (string) ( $snap['expiration'] ?? '' );
			$gex = isset( $snap['gex'] ) && is_array( $snap['gex'] ) ? $snap['gex'] : null;
			if ( $gex && isset( $gex['net'] ) && ! empty( $gex['peak']['strike'] ) ) {
				$gamma[] = array(
					'sym' => $sym,
					'peak' => (float) $gex['peak']['strike'],
					'net' => (float) $gex['net'],
					'contracts' => (int) ( $snap['contracts'] ?? 0 ),
					'max_pain' => isset( $snap['max_pain']['strike'] ) ? (float) $snap['max_pain']['strike'] : null,
					'underlying' => (float) ( $snap['underlying'] ?? 0 ),
					'exp' => $exp,
				);
			}
			$un = isset( $snap['unusual'] ) && is_array( $snap['unusual'] ) ? $snap['unusual'] : array();
			if ( ! empty( $un[0]['premium'] ) && (float) $un[0]['premium'] >= 250000 && ! empty( $un[0]['strike'] ) && (int) ( $un[0]['open_interest'] ?? 0 ) >= 1 ) {
				$u = $un[0];
				$flow[] = array(
					'sym' => $sym,
					'strike' => (float) $u['strike'],
					'type' => strtoupper( (string) ( $u['type'] ?? '' ) ),
					'premium' => (float) $u['premium'],
					'volume' => (int) ( $u['volume'] ?? 0 ),
					'oi' => (int) ( $u['open_interest'] ?? 0 ),
					'ratio' => (float) ( $u['ratio'] ?? 0 ),
					'exp' => $exp,
				);
			}
		}

		/* movers from the Render quote cache (one call, no provider cost) */
		$movers = array();
		$r = wp_remote_get( 'https://stockmarketloop-loop-kick.onrender.com/api/quotes?symbols=' . rawurlencode( implode( ',', $tickers ) ), array( 'timeout' => 6 ) );
		$q = ! is_wp_error( $r ) ? json_decode( (string) wp_remote_retrieve_body( $r ), true ) : null;
		if ( is_array( $q ) && ! empty( $q['ok'] ) && isset( $q['quotes'] ) && is_array( $q['quotes'] ) ) {
			foreach ( $tickers as $sym ) {
				$row = $q['quotes'][ $sym ] ?? null;
				if ( is_array( $row ) && isset( $row['last'], $row['pct'] ) && (float) $row['last'] > 0 ) {
					$movers[] = array( 'sym' => $sym, 'last' => (float) $row['last'], 'pct' => (float) $row['pct'], 'vol' => (float) ( $row['vol'] ?? 0 ) );
				}
			}
		}

		usort( $gamma, static function ( $a, $b ) { return abs( $b['net'] ) <=> abs( $a['net'] ); } );
		usort( $flow, static function ( $a, $b ) { return $b['premium'] <=> $a['premium']; } );
		usort( $movers, static function ( $a, $b ) { return abs( $b['pct'] ) <=> abs( $a['pct'] ); } );
		return array( 'gamma' => $gamma, 'flow' => $flow, 'movers' => $movers, 'asof' => $asof );
	}

	function sml_dmr_build_html( $d ) {
		$asof = $d['asof'] ? gmdate( 'M j, Y \a\t H:i', strtotime( $d['asof'] ) ) . ' UTC' : gmdate( 'M j, Y' );
		$n = count( $d['gamma'] ) + count( $d['flow'] );
		$h  = '<p>This report is compiled automatically by the Stock Market Loop market-data engine from the session&rsquo;s options-positioning snapshots and live quotes, last captured ' . esc_html( $asof ) . '. It summarizes where dealer positioning concentrated, the most notable options flows, and the biggest movers across the actively-optioned names we track. Figures reduce the live options chains and refresh intraday.</p>';

		if ( ! empty( $d['movers'] ) ) {
			$h .= '<h2>Biggest movers on the session</h2><ul>';
			foreach ( array_slice( $d['movers'], 0, 8 ) as $m ) {
				$sign = $m['pct'] >= 0 ? '+' : '';
				$h .= '<li><a href="' . esc_url( home_url( '/stocks/' . strtolower( $m['sym'] ) . '/' ) ) . '"><strong>$' . esc_html( $m['sym'] ) . '</strong></a> &mdash; $' . esc_html( number_format( $m['last'], 2 ) ) . ', ' . esc_html( $sign . number_format( $m['pct'], 2 ) ) . '% on the session'
					. ( $m['vol'] > 0 ? ' on ' . esc_html( number_format( $m['vol'] ) ) . ' shares' : '' ) . '.</li>';
			}
			$h .= '</ul>';
		}

		if ( ! empty( $d['gamma'] ) ) {
			$h .= '<h2>Options positioning and gamma concentration</h2>'
				. '<p>Where each name&rsquo;s heaviest options gamma sits, the net signed gamma exposure our engine measured, and max pain. A primer on what this means is in our guide to <a href="' . esc_url( home_url( '/gamma-exposure-dealer-hedging-pinning/' ) ) . '">gamma exposure and dealer hedging</a>.</p><ul>';
			foreach ( array_slice( $d['gamma'], 0, 10 ) as $g ) {
				$net = ( $g['net'] < 0 ? '-' : '' ) . sml_dmr_money( $g['net'] );
				$h .= '<li><a href="' . esc_url( home_url( '/options/' . strtolower( $g['sym'] ) . '/' ) ) . '"><strong>$' . esc_html( $g['sym'] ) . '</strong></a>: heaviest gamma near the $' . esc_html( number_format( $g['peak'], 2 ) ) . ' strike'
					. ( $g['exp'] ? ' into ' . esc_html( $g['exp'] ) : '' ) . '; net signed gamma ' . esc_html( $net ) . ' across ' . esc_html( number_format( $g['contracts'] ) ) . ' contracts'
					. ( $g['max_pain'] ? '; max pain $' . esc_html( number_format( $g['max_pain'], 2 ) ) : '' )
					. ( $g['underlying'] > 0 ? ' (underlying $' . esc_html( number_format( $g['underlying'], 2 ) ) . ' at capture)' : '' ) . '.</li>';
			}
			$h .= '</ul><p><em>Sign convention: dealers assumed short calls and long puts; the opposite assumption inverts the sign. Gamma describes the character of movement, not direction.</em></p>';
		}

		if ( ! empty( $d['flow'] ) ) {
			$h .= '<h2>Notable options flow</h2>'
				. '<p>The session&rsquo;s largest single-strike premium concentrations, with volume against open interest &mdash; a read on positioning built today. See our guide to <a href="' . esc_url( home_url( '/unusual-options-activity-sweeps-blocks-multi-leg/' ) ) . '">reading unusual options activity</a> for how to interpret these.</p><ul>';
			foreach ( array_slice( $d['flow'], 0, 10 ) as $f ) {
				$h .= '<li><a href="' . esc_url( home_url( '/options/' . strtolower( $f['sym'] ) . '/' ) ) . '"><strong>$' . esc_html( $f['sym'] ) . '</strong></a> $' . esc_html( number_format( $f['strike'], 2 ) ) . ' ' . esc_html( $f['type'] )
					. ( $f['exp'] ? ' (' . esc_html( $f['exp'] ) . ')' : '' ) . ' &mdash; ' . esc_html( sml_dmr_money( $f['premium'] ) ) . ' premium, ' . esc_html( number_format( $f['volume'] ) ) . ' contracts vs ' . esc_html( number_format( $f['oi'] ) ) . ' open interest'
					. ( $f['ratio'] > 0 ? ' (' . esc_html( number_format( $f['ratio'], 1 ) ) . 'x)' : '' ) . '.</li>';
			}
			$h .= '</ul>';
		}

		$h .= '<h2>How to read this report</h2><p>Each section links to the underlying ticker terminal and options page, where the live chains update through the session. For the concepts behind the data, see our guides to <a href="' . esc_url( home_url( '/gamma-exposure-dealer-hedging-pinning/' ) ) . '">gamma exposure</a>, <a href="' . esc_url( home_url( '/unusual-options-activity-sweeps-blocks-multi-leg/' ) ) . '">unusual options activity</a>, and <a href="' . esc_url( home_url( '/reading-order-flow-sweeps-blocks-dark-pool-prints/' ) ) . '">reading order flow</a>.</p>';
		$h .= '<p><em>Automatically compiled by the Stock Market Loop market-data engine. For educational and informational purposes only &mdash; not investment advice. See our <a href="' . esc_url( home_url( '/financial-disclaimer/' ) ) . '">financial disclaimer</a>.</em></p>';
		return $h;
	}

	function sml_dmr_run( $force = false ) {
		if ( get_option( 'sml_dmr_off' ) ) { return array( 'skipped' => 'disabled' ); }
		$today = gmdate( 'Y-m-d' );
		if ( ! $force && get_option( 'sml_dmr_last' ) === $today ) { return array( 'skipped' => 'already posted today' ); }

		$d = sml_dmr_gather();
		/* honesty gate: need real positioning data or the report is empty filler */
		if ( count( $d['gamma'] ) + count( $d['flow'] ) < 2 ) { return array( 'skipped' => 'insufficient data', 'gamma' => count( $d['gamma'] ), 'flow' => count( $d['flow'] ) ); }

		if ( ! $force && get_option( 'sml_dmr_last' ) === $today ) { return array( 'skipped' => 'race' ); }

		try { $et = new DateTime( 'now', new DateTimeZone( 'America/New_York' ) ); $label = $et->format( 'F j, Y' ); }
		catch ( Exception $e ) { $label = gmdate( 'F j, Y' ); }

		$cat = (int) get_cat_ID( 'Market Reports' );
		if ( ! $cat ) {
			$term = wp_insert_term( 'Market Reports', 'category', array( 'slug' => 'market-reports' ) );
			$cat  = is_array( $term ) && ! empty( $term['term_id'] ) ? (int) $term['term_id'] : 0;
		}
		$title = sprintf( 'Market Activity Report — %s: Options Positioning, Unusual Flow, and Movers', $label );
		$id = wp_insert_post( array(
			'post_title'    => $title,
			'post_name'     => 'market-activity-report-' . $today,
			'post_content'  => sml_dmr_build_html( $d ),
			'post_excerpt'  => sprintf( 'A daily roundup of options gamma concentration, notable flow, and the biggest movers across the names Stock Market Loop tracks — compiled %s.', $label ),
			'post_status'   => 'publish',
			'post_author'   => 258456543,
			'post_type'     => 'post',
			'post_category' => $cat ? array( $cat ) : array(),
		), true );
		if ( is_wp_error( $id ) || ! $id ) { return array( 'error' => is_wp_error( $id ) ? $id->get_error_message() : 'insert failed' ); }
		update_option( 'sml_dmr_last', $today, false );
		return array( 'posted' => (int) $id, 'day' => $today, 'gamma' => count( $d['gamma'] ), 'flow' => count( $d['flow'] ), 'movers' => count( $d['movers'] ) );
	}

	/* hourly gate -> fires once/day in the 16:00-17:00 ET post-close window */
	add_filter( 'cron_schedules', static function ( $s ) {
		if ( ! isset( $s['hourly'] ) ) { $s['hourly'] = array( 'interval' => 3600, 'display' => 'Hourly' ); }
		return $s;
	} );
	add_action( 'init', static function () {
		if ( add_option( 'sml_dmr_scheduled_v1', '1', '', false ) ) {
			wp_schedule_event( time() + 300, 'hourly', 'sml_dmr_tick_event' );
		}
	}, 20 );
	add_action( 'sml_dmr_tick_event', static function () {
		if ( get_option( 'sml_dmr_off' ) ) { return; }
		try { $et = new DateTime( 'now', new DateTimeZone( 'America/New_York' ) ); } catch ( Exception $e ) { return; }
		if ( (int) $et->format( 'N' ) > 5 ) { return; }         /* weekdays only */
		if ( (int) $et->format( 'G' ) !== 16 ) { return; }       /* 4:00-4:59pm ET */
		sml_dmr_run( false );
	} );

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-dmr/v1', '/run', array(
			'methods'             => 'POST',
			'callback'            => static function ( WP_REST_Request $q ) {
				if ( '1' === (string) $q->get_param( 'preview' ) ) {
					$d = sml_dmr_gather( (int) ( $q->get_param( 'age' ) ?: 72 ) );
					return rest_ensure_response( array( 'preview' => true, 'counts' => array( 'gamma' => count( $d['gamma'] ), 'flow' => count( $d['flow'] ), 'movers' => count( $d['movers'] ) ), 'asof' => $d['asof'], 'html' => sml_dmr_build_html( $d ) ) );
				}
				return rest_ensure_response( sml_dmr_run( '1' === (string) $q->get_param( 'force' ) ) );
			},
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
		) );
		register_rest_route( 'sml-dmr/v1', '/status', array(
			'methods'             => 'GET',
			'callback'            => static function () {
				$d = sml_dmr_gather();
				$raw = array();
				foreach ( sml_dmr_tickers() as $sym ) {
					$s = get_option( 'sml_opt_snap_' . strtolower( $sym ), null );
					$raw[ $sym ] = is_array( $s )
						? array( 'keys' => array_keys( $s ), 'captured' => (string) ( $s['captured'] ?? '' ), 'age_h' => ! empty( $s['captured'] ) ? round( ( time() - strtotime( (string) $s['captured'] ) ) / 3600, 1 ) : null, 'has_gex' => isset( $s['gex']['net'], $s['gex']['peak']['strike'] ), 'unusual_n' => is_array( $s['unusual'] ?? null ) ? count( $s['unusual'] ) : 0 )
						: ( null === $s ? 'absent' : gettype( $s ) );
				}
				return rest_ensure_response( array( 'ok' => true, 'last' => get_option( 'sml_dmr_last' ), 'has_opt_config' => function_exists( 'sml_opt_config' ), 'tickers' => sml_dmr_tickers(), 'next_cron' => wp_next_scheduled( 'sml_dmr_tick_event' ), 'available' => array( 'gamma' => count( $d['gamma'] ), 'flow' => count( $d['flow'] ), 'movers' => count( $d['movers'] ), 'asof' => $d['asof'] ), 'raw_snapshots' => $raw ) );
			},
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
		) );
	} );
}
