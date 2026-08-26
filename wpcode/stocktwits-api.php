/**
 * SML StockTwits — per-ticker community feed (Layers 1 + 2 + health + cron)
 *
 * WPCode: PHP Snippet / Auto Insert / RUN EVERYWHERE.
 * Do NOT add an opening PHP tag in WPCode.
 *
 * Routes registered:
 *   GET /wp-json/sml-stocktwits/v1/feed?symbol=NVDA[&limit=30]
 *   GET /wp-json/sml-stocktwits/v1/status
 *
 * SOURCE: StockTwits' documented public stream endpoint. No account, no token,
 * no session to replay. That is the whole reason this module is short — there
 * is nothing to refresh, nothing to rotate, and no per-device identity to keep
 * alive, so the usual failure modes of a replayed-session scraper cannot occur.
 *
 * CACHING is stale-while-revalidate. A hit inside the fresh window returns
 * immediately; a hit inside the stale window ALSO returns immediately and
 * schedules a background refresh. Readers therefore never wait on StockTwits,
 * and an upstream outage degrades to slightly old comments rather than an
 * empty tab.
 *
 * LOGGING goes to a bounded option, not a file. WordPress.com Atomic gives no
 * writable /logs directory, and an unbounded log in an autoloaded option would
 * be its own outage.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'sml_st_config' ) ) {

	function sml_st_config() {
		return array(
			'endpoint'    => 'https://api.stocktwits.com/api/2/streams/symbol/%s.json',
			'fresh_ttl'   => 45,    // serve without revalidating
			'stale_ttl'   => 900,   // serve stale + refresh behind the request
			'timeout'     => 8,
			'max_retries' => 3,
			'user_agent'  => 'StockMarketLoop/1.0 (+https://stockmarketloop.com)',
			'log_option'  => 'sml_st_error_log',
			'log_max'     => 50,
			'meta_option' => 'sml_st_meta',
			'warm'        => array( 'SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'MSFT', 'AMZN', 'META', 'PLTR' ),
		);
	}

	/** Uppercase ticker, or '' when the input is not one. */
	function sml_st_symbol( $raw ) {
		$s = strtoupper( trim( (string) $raw ) );
		return preg_match( '/^[A-Z0-9.\-]{1,12}$/', $s ) ? $s : '';
	}

	function sml_st_cache_key( $symbol ) {
		return 'sml_st_' . strtolower( str_replace( array( '.', '-' ), '_', $symbol ) );
	}

	/* ---------------------------------------------------------------------
	 * Logging — bounded ring buffer, newest first, autoload off.
	 * ------------------------------------------------------------------- */
	function sml_st_log( $symbol, $code, $body, $attempt ) {
		$cfg = sml_st_config();
		$log = get_option( $cfg['log_option'], array() );
		if ( ! is_array( $log ) ) {
			$log = array();
		}
		array_unshift( $log, array(
			'time'    => gmdate( 'c' ),
			'symbol'  => (string) $symbol,
			'code'    => (string) $code,
			'attempt' => (int) $attempt,
			// Truncated: a rate-limit HTML body can be enormous and the first
			// line is always the part that identifies the failure.
			'body'    => substr( wp_strip_all_tags( (string) $body ), 0, 300 ),
		) );
		update_option( $cfg['log_option'], array_slice( $log, 0, $cfg['log_max'] ), false );
	}

	function sml_st_meta_update( $patch ) {
		$cfg  = sml_st_config();
		$meta = get_option( $cfg['meta_option'], array() );
		if ( ! is_array( $meta ) ) {
			$meta = array();
		}
		update_option( $cfg['meta_option'], array_merge( $meta, $patch ), false );
	}

	/* ---------------------------------------------------------------------
	 * Optional proxy. Define SML_ST_PROXY in wp-config.php as host:port to
	 * route only THIS module's calls through it; everything else on the site
	 * is untouched.
	 * ------------------------------------------------------------------- */
	add_action( 'http_api_curl', function ( $handle, $args ) {
		if ( empty( $args['sml_st'] ) || ! defined( 'SML_ST_PROXY' ) || ! SML_ST_PROXY ) {
			return;
		}
		curl_setopt( $handle, CURLOPT_PROXY, SML_ST_PROXY );
		if ( defined( 'SML_ST_PROXY_AUTH' ) && SML_ST_PROXY_AUTH ) {
			curl_setopt( $handle, CURLOPT_PROXYUSERPWD, SML_ST_PROXY_AUTH );
		}
	}, 10, 2 );

	/* ---------------------------------------------------------------------
	 * Layer 1 — the fetch. Retries with jitter; backs off hard on 429.
	 * ------------------------------------------------------------------- */
	function sml_st_request( $symbol ) {
		$cfg     = sml_st_config();
		$url     = sprintf( $cfg['endpoint'], rawurlencode( $symbol ) );
		$attempt = 0;
		$last    = '';

		while ( $attempt < $cfg['max_retries'] ) {
			$attempt++;

			$res = wp_remote_get( $url, array(
				'timeout'    => $cfg['timeout'],
				'user-agent' => $cfg['user_agent'],
				'headers'    => array( 'Accept' => 'application/json' ),
				'sml_st'     => true, // picked up by the proxy hook above
			) );

			if ( is_wp_error( $res ) ) {
				$last = $res->get_error_message();
				sml_st_log( $symbol, 'transport', $last, $attempt );
				usleep( ( 250 + wp_rand( 0, 250 ) ) * 1000 );
				continue;
			}

			$code    = (int) wp_remote_retrieve_response_code( $res );
			$body    = wp_remote_retrieve_body( $res );
			$headers = wp_remote_retrieve_headers( $res );

			// Rate-limit telemetry is worth keeping even on success — it is what
			// /status reports, and it is the early warning before 429s start.
			$remaining = isset( $headers['x-ratelimit-remaining'] ) ? (int) $headers['x-ratelimit-remaining'] : null;
			$reset     = isset( $headers['x-ratelimit-reset'] ) ? (int) $headers['x-ratelimit-reset'] : null;
			if ( null !== $remaining ) {
				sml_st_meta_update( array( 'rate_remaining' => $remaining, 'rate_reset' => $reset ) );
			}

			if ( 200 === $code ) {
				$json = json_decode( $body, true );
				if ( is_array( $json ) && isset( $json['messages'] ) ) {
					return array( 'ok' => true, 'json' => $json, 'attempts' => $attempt );
				}
				$last = 'malformed json';
				sml_st_log( $symbol, '200-malformed', $body, $attempt );
			} elseif ( 429 === $code ) {
				// Honour the reset when given; otherwise widen the gap each try.
				$wait = ( null !== $reset && $reset > 0 && $reset < 30 ) ? $reset : min( 8, $attempt * 2 );
				sml_st_log( $symbol, 429, 'rate limited; waiting ' . $wait . 's', $attempt );
				sml_st_meta_update( array( 'last_429' => gmdate( 'c' ) ) );
				sleep( $wait );
				continue;
			} elseif ( 404 === $code ) {
				// Unknown ticker is a real answer, not a failure to retry.
				sml_st_log( $symbol, 404, 'symbol not on stocktwits', $attempt );
				return array( 'ok' => false, 'permanent' => true, 'error' => 'unknown_symbol', 'attempts' => $attempt );
			} else {
				$last = 'http ' . $code;
				sml_st_log( $symbol, $code, $body, $attempt );
			}

			usleep( ( 250 + wp_rand( 0, 250 ) ) * 1000 );
		}

		return array( 'ok' => false, 'permanent' => false, 'error' => $last ?: 'exhausted', 'attempts' => $attempt );
	}

	/* ---------------------------------------------------------------------
	 * Normalization — the contract the front end and the moomoo feed share.
	 * ------------------------------------------------------------------- */
	function sml_st_normalize( $json, $symbol ) {
		$out = array();
		foreach ( (array) ( $json['messages'] ?? array() ) as $m ) {
			$user = isset( $m['user'] ) && is_array( $m['user'] ) ? $m['user'] : array();
			$body = trim( (string) ( $m['body'] ?? '' ) );
			if ( '' === $body ) {
				continue;
			}

			/* The symbol stream carries reply COUNTS but not reply bodies, so
			   'replies' stays an empty array for shape stability and the count
			   is exposed separately. Fetching each conversation would be one
			   request per message. */
			$discussion = isset( $m['discussion'] ) && is_array( $m['discussion'] ) ? $m['discussion'] : array();

			$out[] = array(
				'username'    => (string) ( $user['username'] ?? 'stocktwits_user' ),
				'display'     => (string) ( $user['name'] ?? ( $user['username'] ?? '' ) ),
				'avatar_url'  => esc_url_raw( (string) ( $user['avatar_url_ssl'] ?? $user['avatar_url'] ?? '' ) ),
				'profile_url' => ! empty( $user['username'] ) ? 'https://stocktwits.com/' . rawurlencode( $user['username'] ) : '',
				'timestamp'   => (string) ( $m['created_at'] ?? '' ),
				'comment'     => $body,
				'replies'     => array(),
				'reply_count' => (int) ( $discussion['replies'] ?? 0 ),
				'likes'       => (int) ( $m['likes']['total'] ?? 0 ),
				// StockTwits' own tag. The moomoo feed has no equivalent, which
				// is why it is optional rather than part of the shared shape.
				'sentiment'   => (string) ( $m['entities']['sentiment']['basic'] ?? '' ),
				'symbols'     => array_values( array_filter( array_map( function ( $s ) {
					return isset( $s['symbol'] ) ? strtoupper( (string) $s['symbol'] ) : '';
				}, (array) ( $m['symbols'] ?? array() ) ) ) ),
				'source_url'  => 'https://stocktwits.com/message/' . (int) ( $m['id'] ?? 0 ),
				'source'      => 'stocktwits',
				'symbol'      => $symbol,
				'id'          => 'st_' . (int) ( $m['id'] ?? 0 ),
			);
		}
		return $out;
	}

	/* ---------------------------------------------------------------------
	 * Layer 1 entry point — cache-first, stale-while-revalidate.
	 * ------------------------------------------------------------------- */
	function sml_st_get( $symbol, $force = false ) {
		$cfg   = sml_st_config();
		$key   = sml_st_cache_key( $symbol );
		$entry = $force ? false : get_transient( $key );

		if ( is_array( $entry ) && isset( $entry['at'], $entry['posts'] ) ) {
			$age = time() - (int) $entry['at'];
			if ( $age <= $cfg['fresh_ttl'] ) {
				$entry['cache'] = 'fresh';
				return $entry;
			}
			// Stale but usable: hand it back now, refresh behind the reader.
			$entry['cache'] = 'stale';
			if ( ! wp_next_scheduled( 'sml_st_refresh_one', array( $symbol ) ) ) {
				wp_schedule_single_event( time() + 1, 'sml_st_refresh_one', array( $symbol ) );
			}
			return $entry;
		}

		$res = sml_st_request( $symbol );
		if ( empty( $res['ok'] ) ) {
			sml_st_meta_update( array( 'last_error' => gmdate( 'c' ), 'last_error_symbol' => $symbol ) );
			return array( 'posts' => array(), 'at' => time(), 'cache' => 'miss', 'error' => $res['error'] ?? 'failed' );
		}

		$entry = array(
			'posts'    => sml_st_normalize( $res['json'], $symbol ),
			'at'       => time(),
			'cache'    => 'miss',
			'attempts' => $res['attempts'],
		);
		set_transient( $key, $entry, $cfg['stale_ttl'] );
		sml_st_meta_update( array( 'last_success' => gmdate( 'c' ), 'last_success_symbol' => $symbol ) );
		return $entry;
	}

	add_action( 'sml_st_refresh_one', function ( $symbol ) {
		$symbol = sml_st_symbol( $symbol );
		if ( $symbol ) {
			sml_st_get( $symbol, true );
		}
	} );

	/* ---------------------------------------------------------------------
	 * Layers 2 + health — REST routes.
	 * ------------------------------------------------------------------- */
	add_action( 'rest_api_init', function () {
		register_rest_route( 'sml-stocktwits/v1', '/feed', array(
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => function ( $request ) {
				$symbol = sml_st_symbol( $request->get_param( 'symbol' ) );
				if ( '' === $symbol ) {
					return new WP_Error( 'sml_st_symbol', 'Provide a ticker symbol.', array( 'status' => 400 ) );
				}
				$limit = (int) $request->get_param( 'limit' );
				$limit = ( $limit > 0 && $limit <= 50 ) ? $limit : 30;

				$entry = sml_st_get( $symbol );
				$posts = array_slice( (array) $entry['posts'], 0, $limit );

				$response = rest_ensure_response( array(
					'symbol'          => $symbol,
					'source'          => 'stocktwits',
					'posts'           => $posts,
					'count'           => count( $posts ),
					'cache'           => $entry['cache'] ?? 'miss',
					'age_seconds'     => max( 0, time() - (int) ( $entry['at'] ?? time() ) ),
					'refresh_seconds' => sml_st_config()['fresh_ttl'],
					'error'           => $entry['error'] ?? null,
				) );
				// Let the edge hold it for the fresh window too.
				$response->header( 'Cache-Control', 'public, max-age=' . sml_st_config()['fresh_ttl'] );
				return $response;
			},
		) );

		register_rest_route( 'sml-stocktwits/v1', '/status', array(
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => function () {
				$cfg  = sml_st_config();
				$meta = get_option( $cfg['meta_option'], array() );
				$log  = get_option( $cfg['log_option'], array() );
				$next = wp_next_scheduled( 'sml_st_warm_cache' );

				$warm = array();
				foreach ( $cfg['warm'] as $sym ) {
					$e = get_transient( sml_st_cache_key( $sym ) );
					$warm[ $sym ] = is_array( $e ) && isset( $e['at'] )
						? array( 'cached' => true, 'age' => time() - (int) $e['at'], 'posts' => count( (array) $e['posts'] ) )
						: array( 'cached' => false );
				}

				return rest_ensure_response( array(
					'source'           => 'stocktwits',
					'auth_required'    => false, // public endpoint: nothing to expire
					'rate_remaining'   => $meta['rate_remaining'] ?? null,
					'rate_reset'       => $meta['rate_reset'] ?? null,
					'last_429'         => $meta['last_429'] ?? null,
					'last_success'     => $meta['last_success'] ?? null,
					'last_success_sym' => $meta['last_success_symbol'] ?? null,
					'last_error'       => $meta['last_error'] ?? null,
					'next_warm'        => $next ? gmdate( 'c', $next ) : null,
					'recent_errors'    => array_slice( (array) $log, 0, 10 ),
					'warm_cache'       => $warm,
					'healthy'          => empty( $meta['last_error'] ) || ( ! empty( $meta['last_success'] ) && $meta['last_success'] > $meta['last_error'] ),
				) );
			},
		) );
	} );

	/* ---------------------------------------------------------------------
	 * Cron — WP-Cron, because Atomic gives no shell crontab. Warming the top
	 * tickers means the tab is instant for the symbols people actually open.
	 * ------------------------------------------------------------------- */
	add_filter( 'cron_schedules', function ( $s ) {
		$s['sml_st_2min'] = array( 'interval' => 120, 'display' => 'SML StockTwits (2 min)' );
		return $s;
	} );

	add_action( 'init', function () {
		if ( ! wp_next_scheduled( 'sml_st_warm_cache' ) ) {
			wp_schedule_event( time() + 60, 'sml_st_2min', 'sml_st_warm_cache' );
		}
	} );

	add_action( 'sml_st_warm_cache', function () {
		$cfg = sml_st_config();
		foreach ( $cfg['warm'] as $sym ) {
			sml_st_get( $sym, true );
			// Spread the calls: ten back-to-back requests is how you earn a 429.
			usleep( 400000 );
		}
		sml_st_meta_update( array( 'last_warm' => gmdate( 'c' ) ) );
	} );
}
