/**
 * SML Signal News Autopilot — keeps Signal News flowing all session, every
 * session, with no external process required.
 *
 * The original Signal News articles were posted by an outside job that only
 * ran mornings, so the feed went silent after midday. This snippet generates
 * the same article families ON SITE via WP-cron every 10 minutes during
 * market hours (9:30–16:00 ET, weekdays), from data the site ALREADY ingests:
 *   - options positioning snapshots (#7372 refreshes the 8 deep-chain tickers
 *     every 15 minutes in market hours)  → gamma-cluster + large-flow articles
 *   - the Render quote cache (warmed symbols, no provider calls) → momentum
 * NOTHING here touches an upstream data provider. Every number in an article
 * comes from a captured snapshot or a served quote — no data → no article.
 *
 * Discipline: hard dedup (one gamma article per symbol per peak strike per
 * day; one flow article per contract per day; one momentum per symbol per
 * direction per day), at most 4 articles per tick and 30 autopilot articles
 * per day. Articles post as SML News (258456543), category Markets, with the
 * $SYM tag in title/body so the homepage feed, rabbit hole, and terminal
 * ticker-news module all pick them up automatically.
 *
 * Ops:  POST /wp-json/sml-sn/v1/run     (admin; ?force=1 ignores the clock)
 *       GET  /wp-json/sml-sn/v1/status  (admin; log + next cron)
 * Kill: option sml_sn_off = 1, or deactivate the snippet.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_sn_tick' ) ) {

	function sml_sn_market_open() {
		try { $now = new DateTime( 'now', new DateTimeZone( 'America/New_York' ) ); } catch ( Exception $e ) { return false; }
		if ( (int) $now->format( 'N' ) > 5 ) { return false; }
		$m = (int) $now->format( 'G' ) * 60 + (int) $now->format( 'i' );
		return $m >= 570 && $m < 960;
	}

	function sml_sn_money( $v ) {
		$v = abs( (float) $v );
		if ( $v >= 1e9 ) { return '$' . number_format( $v / 1e9, 2 ) . 'B'; }
		if ( $v >= 1e6 ) { return '$' . number_format( $v / 1e6, 2 ) . 'M'; }
		if ( $v >= 1e3 ) { return '$' . number_format( $v / 1e3, 0 ) . 'K'; }
		return '$' . number_format( $v, 0 );
	}

	function sml_sn_log_load() {
		$d = gmdate( 'Y-m-d' );
		$log = get_option( 'sml_sn_log', array() );
		if ( ! is_array( $log ) || ( $log['day'] ?? '' ) !== $d ) { $log = array( 'day' => $d, 'keys' => array(), 'count' => 0 ); }
		return $log;
	}

	/* Two generators post news now (this autopilot + the external Make-news
	   pipeline). Neither sees the other's dedup keys, so before publishing we
	   check for ANY same-day post already covering this family for the symbol
	   — one indexed LIKE query per pattern, symbol-prefixed so no cross-symbol
	   false positives. */
	function sml_sn_similar_exists( $patterns ) {
		global $wpdb;
		$today = gmdate( 'Y-m-d 00:00:00' );
		foreach ( (array) $patterns as $like ) {
			$found = $wpdb->get_var( $wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts} WHERE post_type='post' AND post_status='publish' AND post_date_gmt >= %s AND post_title LIKE %s LIMIT 1",
				$today, $like
			) );
			if ( $found ) { return true; }
		}
		return false;
	}

	function sml_sn_publish( $title, $excerpt, $body, $key, &$log ) {
		if ( isset( $log['keys'][ $key ] ) || $log['count'] >= 30 ) { return 0; }
		/* re-check against the STORED log right before inserting — a crashed or
		   concurrent tick must never let the same key publish twice */
		$fresh = get_option( 'sml_sn_log', array() );
		if ( is_array( $fresh ) && ( $fresh['day'] ?? '' ) === $log['day'] && isset( $fresh['keys'][ $key ] ) ) {
			$log['keys'][ $key ] = 1;
			return 0;
		}
		$cat = (int) get_cat_ID( 'Markets' );
		if ( ! $cat ) {
			$term = wp_insert_term( 'Markets', 'category' );
			$cat  = is_array( $term ) && ! empty( $term['term_id'] ) ? (int) $term['term_id'] : 0;
		}
		$id  = wp_insert_post( array(
			'post_title'    => $title,
			'post_content'  => $body,
			'post_excerpt'  => $excerpt,
			'post_status'   => 'publish',
			'post_author'   => 258456543,
			'post_type'     => 'post',
			'post_category' => $cat ? array( $cat ) : array(),
		), true );
		if ( is_wp_error( $id ) || ! $id ) { return 0; }
		update_post_meta( $id, '_sml_sn_autopilot', 1 );
		$log['keys'][ $key ] = 1;
		$log['count']++;
		update_option( 'sml_sn_log', $log, false ); /* persist PER article — crash-safe dedup */
		return (int) $id;
	}

	function sml_sn_tick( $force = false ) {
		if ( get_option( 'sml_sn_off' ) ) { return array( 'skipped' => 'disabled' ); }
		if ( ! $force && ! sml_sn_market_open() ) { return array( 'skipped' => 'market closed' ); }
		/* atomic tick lock (add_option INSERTs or fails) — overlapping cron +
		   manual runs must not race the dedup log */
		if ( ! add_option( 'sml_sn_lock', (string) time(), '', false ) ) {
			$t = (int) get_option( 'sml_sn_lock' );
			if ( time() - $t < 300 ) { return array( 'skipped' => 'locked' ); }
			update_option( 'sml_sn_lock', (string) time(), false ); /* stale lock from a dead tick — take over */
		}
		$log = sml_sn_log_load();
		$posted = array();
		$tick_cap = 4;

		$tickers = function_exists( 'sml_opt_config' ) ? sml_opt_config()['tickers'] : array( 'SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'AMZN' );

		/* -- options-derived articles from the EXISTING 15-minute snapshots -- */
		foreach ( $tickers as $sym ) {
			if ( count( $posted ) >= $tick_cap ) { break; }
			$snap = get_option( 'sml_opt_snap_' . strtolower( $sym ), null );
			if ( ! is_array( $snap ) || empty( $snap['captured'] ) ) { continue; }
			if ( time() - (int) strtotime( $snap['captured'] ) > 5400 ) { continue; } /* stale → no article */
			$exp = (string) ( $snap['expiration'] ?? '' );
			$gex = isset( $snap['gex'] ) && is_array( $snap['gex'] ) ? $snap['gex'] : null;

			if ( $gex && isset( $gex['net'] ) && ! empty( $gex['peak']['strike'] ) ) {
				$peak = number_format( (float) $gex['peak']['strike'], 2 );
				$net  = ( (float) $gex['net'] < 0 ? '-' : '' ) . sml_sn_money( $gex['net'] );
				$n    = (int) ( $snap['contracts'] ?? 0 );
				$key  = 'gamma:' . $sym . ':' . $peak;
				$title = sprintf( '$%s Options Gamma Clusters Near $%s%s', $sym, $peak, $exp ? ' Into ' . $exp : '' );
				$ex    = sprintf( 'The engine measured %s of signed gamma exposure across %d live option contracts.', $net, $n );
				$body  = '<p>' . esc_html( sprintf( '$%s option positioning shows its heaviest gamma concentration near the $%s strike%s. Net signed gamma exposure across %d live contracts measured %s, with the underlying at $%s at capture (%s).', $sym, $peak, $exp ? ' into ' . $exp : '', $n, $net, number_format( (float) ( $snap['underlying'] ?? 0 ), 2 ), (string) $snap['captured'] ) ) . '</p>';
				if ( ! empty( $snap['max_pain']['strike'] ) ) {
					$body .= '<p>' . esc_html( sprintf( 'The same snapshot puts max pain at $%s. Figures reduce the live chain and refresh intraday as new snapshots land.', number_format( (float) $snap['max_pain']['strike'], 2 ) ) ) . '</p>';
				}
				$body .= '<p>' . esc_html( 'Sign convention: dealers assumed short calls and long puts (call gamma positive, put gamma negative); the opposite assumption inverts the sign.' ) . '</p>'
					. '<p>' . esc_html( sprintf( 'Live positioning for $%s updates on the Stock Market Loop options page.', $sym ) ) . '</p>';
				if ( ! sml_sn_similar_exists( array( '$' . $sym . ' Options Gamma%' ) ) ) {
					$id = sml_sn_publish( $title, $ex, $body, $key, $log );
					if ( $id ) { $posted[] = $id; }
				}
			}
			if ( count( $posted ) >= $tick_cap ) { break; }

			$un = isset( $snap['unusual'] ) && is_array( $snap['unusual'] ) ? $snap['unusual'] : array();
			/* OI must be >= 1: on a zero-OI strike (newly listed) the stored ratio
			   is volume/1, and printing it as a Vol/OI multiple would be fabricated */
			if ( $un && ! empty( $un[0]['premium'] ) && (float) $un[0]['premium'] >= 250000 && ! empty( $un[0]['strike'] ) && (int) ( $un[0]['open_interest'] ?? 0 ) >= 1 ) {
				$u      = $un[0] + array( 'type' => '', 'volume' => 0, 'open_interest' => 0, 'ratio' => 0 );
				$side   = strtoupper( (string) $u['type'] );
				$strike = number_format( (float) $u['strike'], 2 );
				$prem   = sml_sn_money( $u['premium'] );
				$key    = 'flow:' . $sym . ':' . $side . ':' . $strike;
				$title  = sprintf( '$%s Options Volume Concentrates on the $%s %s as Premium Reaches %s', $sym, $strike, $side, $prem );
				$ex     = sprintf( 'The options tape shows concentrated activity in %s with %s of traded premium.', $sym, $prem );
				$body   = '<p>' . esc_html( sprintf( '$%s options activity concentrated on the $%s strike %s%s, where %s contracts traded against %s open interest — %.1fx — for roughly %s in premium at the mid.', $sym, $strike, $side, $exp ? ' expiring ' . $exp : '', number_format( (int) $u['volume'] ), number_format( (int) $u['open_interest'] ), (float) $u['ratio'], $prem ) ) . '</p>'
					. '<p>' . esc_html( sprintf( 'Volume-to-open-interest of this size flags positioning built TODAY rather than carried over. Data reduces the live $%s chain captured %s.', $sym, (string) $snap['captured'] ) ) . '</p>';
				if ( ! sml_sn_similar_exists( array( '$' . $sym . '%CALL%', '$' . $sym . '%PUT%' ) ) ) {
					$id = sml_sn_publish( $title, $ex, $body, $key, $log );
					if ( $id ) { $posted[] = $id; }
				}
			}
		}

		/* -- momentum from the Render quote cache (one snapshot call for the
		      whole set, ~20/day). Gated on the REAL clock even under force:
		      outside market hours the snapshot's pct is the prior session and
		      an "Intraday" headline would be false. Stale/error responses are
		      rejected outright. -- */
		if ( count( $posted ) < $tick_cap && sml_sn_market_open() ) {
			$r = wp_remote_get( 'https://stockmarketloop-loop-kick.onrender.com/api/quotes?symbols=' . rawurlencode( implode( ',', $tickers ) ), array( 'timeout' => 6 ) );
			$q = ! is_wp_error( $r ) ? json_decode( (string) wp_remote_retrieve_body( $r ), true ) : null;
			$quotes = is_array( $q ) && ! empty( $q['ok'] ) && empty( $q['stale'] ) && isset( $q['quotes'] ) && is_array( $q['quotes'] ) ? $q['quotes'] : array();
			foreach ( $tickers as $sym ) {
				if ( count( $posted ) >= $tick_cap ) { break; }
				$row = $quotes[ $sym ] ?? null;
				if ( ! is_array( $row ) ) { continue; }
				$last = (float) ( $row['last'] ?? 0 );
				$pct  = (float) ( $row['pct'] ?? 0 );
				if ( $last <= 0 || abs( $pct ) < 3 ) { continue; }
				$dir  = $pct > 0 ? 'up' : 'down';
				$key  = 'mom:' . $sym . ':' . $dir;
				$verb = $pct > 0 ? 'Jumps' : 'Slides';
				$title = sprintf( '$%s %s %s%% Intraday to $%s', $sym, $verb, number_format( abs( $pct ), 2 ), number_format( $last, 2 ) );
				$ex    = sprintf( '%s is trading at $%s, %s%s%% on the session.', $sym, number_format( $last, 2 ), $pct > 0 ? '+' : '-', number_format( abs( $pct ), 2 ) );
				$body  = '<p>' . esc_html( sprintf( '$%s moved to $%s intraday, a %s%s%% change on the session%s.', $sym, number_format( $last, 2 ), $pct > 0 ? '+' : '-', number_format( abs( $pct ), 2 ), ! empty( $row['vol'] ) ? ' on ' . number_format( (float) $row['vol'] ) . ' shares of volume' : '' ) ) . '</p>'
					. '<p>' . esc_html( sprintf( 'Quote captured from the live Stock Market Loop feed; track $%s on the ticker terminal for the current tape.', $sym ) ) . '</p>';
				if ( ! sml_sn_similar_exists( array( '$' . $sym . ' Moves%', '$' . $sym . ' Jumps%', '$' . $sym . ' Slides%' ) ) ) {
					$id = sml_sn_publish( $title, $ex, $body, $key, $log );
					if ( $id ) { $posted[] = $id; }
				}
			}
		}

		$log['last'] = gmdate( 'c' );
		update_option( 'sml_sn_log', $log, false );
		delete_option( 'sml_sn_lock' );
		return array( 'posted' => $posted, 'count_today' => $log['count'] );
	}

	add_filter( 'cron_schedules', static function ( $s ) {
		$s['sml_sn_10min'] = array( 'interval' => 600, 'display' => 'Every 10 minutes' );
		return $s;
	} );
	add_action( 'init', static function () {
		/* one-shot atomic flag: two concurrent first requests must not both
		   schedule (duplicate recurring events reschedule themselves forever) */
		if ( add_option( 'sml_sn_scheduled_v2', '1', '', false ) ) {
			wp_clear_scheduled_hook( 'sml_sn_tick_event' ); /* migrate off the 20-min cadence */
			wp_schedule_event( time() + 120, 'sml_sn_10min', 'sml_sn_tick_event' );
		}
	}, 20 );
	add_action( 'sml_sn_tick_event', 'sml_sn_tick' );

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-sn/v1', '/run', array(
			'methods'             => 'POST',
			'callback'            => static function ( WP_REST_Request $q ) { return rest_ensure_response( sml_sn_tick( '1' === (string) $q->get_param( 'force' ) ) ); },
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
		) );
		register_rest_route( 'sml-sn/v1', '/status', array(
			'methods'             => 'GET',
			'callback'            => static function () {
				return rest_ensure_response( array( 'ok' => true, 'market_open' => sml_sn_market_open(), 'log' => get_option( 'sml_sn_log', array() ), 'next_cron' => wp_next_scheduled( 'sml_sn_tick_event' ) ) );
			},
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
		) );
	} );
}
