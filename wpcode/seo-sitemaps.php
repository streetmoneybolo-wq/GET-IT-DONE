/**
 * SML SEO — new sitemap files. Part 3 of the entity-graph architecture.
 * New URLs only — nothing here touches the existing /sml-sitemap.xml,
 * /sml-ticker-sitemap.xml, or Rank Math's /sitemap_index.xml. Discovery
 * happens via robots.txt Sitemap: lines, so no existing index needs editing.
 *
 * v2, 2026-08-22 — the empty-sitemap fix. v1 scored all 67 seed tickers
 * synchronously inside the sitemap request via internal REST dispatch; that
 * failed live (every ticker logged "temporarily unavailable", sitemap shipped
 * empty). v2 moves scoring to a WP-Cron sweep: every 5 minutes a batch of 5
 * tickers is re-scored through the real front door (see seo-ege-core.php v2
 * for why front-door) and the verdicts are stored in an option; the sitemap
 * renders instantly from that stored state. The first full pass over the 67
 * seed tickers takes 14 sweeps (~70 minutes); after that every symbol
 * refreshes on the same ~70-minute rotation.
 *
 * OUTAGE RESILIENCE, deliberately: a ticker that was eligible does NOT get
 * dropped because one sweep couldn't fetch data (the provider has real,
 * observed outage windows) — its last good verdict is kept for up to 24h of
 * consecutive failures before it's honestly dropped. And a "confirmed
 * nonexistent" verdict is only trusted when the same sweep proved the
 * upstream can answer at all (at least one symbol scored valid), so a total
 * outage can never mass-evict the sitemap.
 *
 * SCOPE, HONESTLY: still a bounded v1 seed list, not full-directory coverage —
 * the full symbol-directory (thousands of tickers) and groups/channels
 * sitemaps remain future work with real, documented blockers (no enumeration
 * endpoints for groups/channels; the full directory just needs this same
 * cron pattern with a much longer rotation).
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * Depends on wpcode/seo-ege-core.php (load before this one).
 * ROLLBACK: deactivate this snippet — both new URLs 404, robots.txt Sitemap:
 * lines become dead references (harmless). Optional cleanup after
 * deactivation: wp_clear_scheduled_hook('sml_seo_stocks_score_tick') and
 * delete_option('sml_seo_stocks_state') — both harmless to leave.
 */
if ( ! function_exists( 'sml_seo_sitemap_seed_tickers' ) ) {

	/** Documented v1 seed — real, liquid, well-known tickers. */
	function sml_seo_sitemap_seed_tickers() {
		return array(
			'SPY', 'QQQ', 'DIA', 'IWM', 'SMH',
			'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'AVGO', 'AMD',
			'NFLX', 'ADBE', 'CRM', 'ORCL', 'CSCO', 'INTC', 'QCOM', 'TXN', 'AMAT', 'MU',
			'PLTR', 'SOFI', 'COIN', 'RBLX', 'SNAP', 'UBER', 'ABNB', 'SHOP', 'SQ', 'PYPL',
			'JPM', 'BAC', 'WFC', 'GS', 'MS', 'V', 'MA', 'AXP',
			'JNJ', 'PFE', 'UNH', 'LLY', 'ABBV', 'MRK',
			'XOM', 'CVX', 'COP',
			'WMT', 'COST', 'HD', 'NKE', 'MCD', 'SBUX', 'DIS',
			'BA', 'CAT', 'GE', 'F', 'GM',
			'T', 'VZ', 'TMUS',
			/* Phase 3 expansion (2026-08-29): these mostly have NO static page —
			   the stocks-dynamic snippet renders vouched entity pages for them,
			   which the next sweep then marks eligible. Same 5-per-5-min sweep
			   budget; only the rotation lengthens (~170 symbols ≈ 2.8h). */
			'KO', 'PEP', 'LOW', 'TGT', 'CVS', 'ABT', 'TMO', 'GILD', 'AMGN', 'HON', 'MMM', 'PG', 'IBM',
			'CRWD', 'NET', 'DDOG', 'SNOW', 'ARM', 'SMCI', 'MSTR', 'ZS', 'OKTA', 'TWLO', 'TEAM', 'MDB', 'DOCU', 'ZM',
			'MARA', 'RIOT', 'CLSK', 'HOOD', 'GME', 'AMC', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI',
			'DKNG', 'ROKU', 'PINS', 'ETSY', 'CHWY', 'CELH', 'ELF', 'DUOL', 'ONON', 'RDDT', 'DJT',
			'SOUN', 'BBAI', 'IONQ', 'RGTI', 'QUBT', 'AI', 'PATH', 'U',
			'SMR', 'OKLO', 'NNE', 'ACHR', 'JOBY', 'RKLB', 'ASTS', 'LUNR', 'SPCE',
			'TSM', 'BABA', 'JD', 'PDD', 'BIDU', 'SE', 'MELI',
			'XLF', 'XLE', 'XLK', 'XLV', 'XLI', 'XLU', 'XLY', 'XLP', 'XLB',
			'VOO', 'VTI', 'ARKK', 'TQQQ', 'SQQQ', 'SOXL', 'SOXS',
			'GLD', 'SLV', 'USO', 'TLT', 'HYG', 'XBI', 'IBB', 'KRE', 'EEM', 'EFA', 'UVXY', 'VXX',
		);
	}

	function sml_seo_sitemap_path() {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		return (string) wp_parse_url( $uri, PHP_URL_PATH );
	}

	function sml_seo_xml_head() { return '<?xml version="1.0" encoding="UTF-8"?>' . "\n"; }
	function sml_esc_xml( $s ) { return htmlspecialchars( (string) $s, ENT_XML1 | ENT_QUOTES, 'UTF-8' ); }

	/* ---------- background pre-scoring state ----------
	   symbol => array(
	     'eligible'   => bool,      // include in the sitemap?
	     'verdict'    => string,    // index|selective|noindex
	     'score'      => int,
	     'why'        => 'scored'|'no-data'|'unavailable'|'kept-last-good',
	     'checked'    => int,       // unix ts of last sweep that touched it
	     'fail_since' => int,       // 0, or unix ts when consecutive failures began
	   ) */
	function sml_seo_stocks_state() {
		$s = get_option( 'sml_seo_stocks_state', array() );
		return is_array( $s ) ? $s : array();
	}

	add_filter( 'cron_schedules', static function ( $s ) {
		if ( ! isset( $s['sml_seo_5min'] ) ) { $s['sml_seo_5min'] = array( 'interval' => 5 * MINUTE_IN_SECONDS, 'display' => 'Every 5 minutes (SML SEO scoring sweep)' ); }
		return $s;
	} );

	function sml_seo_stocks_score_tick() {
		if ( ! function_exists( 'sml_ege_score_ticker' ) ) { return; } // engine off — change nothing, fail closed at render
		// overlap lock: WP-Cron can double-fire an event under load, and a
		// duplicate scheduled event would otherwise double the sweep's network
		// budget forever — a second tick inside 4 minutes is a no-op instead
		if ( false !== get_transient( 'sml_seo_tick_lock' ) ) { return; }
		set_transient( 'sml_seo_tick_lock', 1, 4 * MINUTE_IN_SECONDS );

		$state = sml_seo_stocks_state();
		$seed  = sml_seo_sitemap_seed_tickers();

		// oldest-checked first (never-checked = 0 sorts first) — a simple
		// rotation that both completes the first pass and keeps refreshing
		usort( $seed, static function ( $a, $b ) use ( $state ) {
			$ca = isset( $state[ $a ]['checked'] ) ? (int) $state[ $a ]['checked'] : 0;
			$cb = isset( $state[ $b ]['checked'] ) ? (int) $state[ $b ]['checked'] : 0;
			return $ca <=> $cb;
		} );
		$batch = array_slice( $seed, 0, 5 ); // 5 symbols x (4 parallel data calls + 1 mostly-cached page check), 3s timeouts — bounded well under cron exec limits

		// advance the rotation BEFORE fetching: if this tick is killed by an
		// exec limit mid-batch, the next tick moves on to other symbols
		// instead of livelocking on this same batch forever. The entries'
		// verdicts/data are untouched here — only 'checked' moves.
		$now   = time();
		$prevs = array();
		foreach ( $batch as $sym ) {
			$prevs[ $sym ] = isset( $state[ $sym ] ) && is_array( $state[ $sym ] ) ? $state[ $sym ] : null;
			if ( null !== $prevs[ $sym ] ) {
				$state[ $sym ]['checked'] = $now;
			} else {
				$state[ $sym ] = array( 'eligible' => false, 'verdict' => 'noindex', 'score' => 0, 'why' => 'in-progress', 'checked' => $now, 'fail_since' => 0 );
			}
		}
		update_option( 'sml_seo_stocks_state', $state, false );

		$results   = array();
		$any_valid = false;
		foreach ( $batch as $sym ) {
			$r = sml_ege_score_ticker( $sym, true ); // force: sweeps always re-measure
			$results[ $sym ] = $r;
			if ( ! empty( $r['valid'] ) ) { $any_valid = true; }
		}

		foreach ( $results as $sym => $r ) {
			$prev = $prevs[ $sym ];

			if ( ! empty( $r['valid'] ) ) {
				// a DEGRADED score (aux endpoints failed rather than answered —
				// see seo-ege-core.php) is artificially depressed and must never
				// demote a previously-good ticker; route it through the same
				// keep-last-good grace as a fetch failure. With no good prior
				// state it's still the best available measurement — store it.
				if ( ! empty( $r['degraded'] ) && ! empty( $prev['eligible'] ) ) {
					$since = ! empty( $prev['fail_since'] ) ? (int) $prev['fail_since'] : $now;
					if ( ( $now - $since ) < DAY_IN_SECONDS ) {
						$prev['why']        = 'kept-last-good';
						$prev['checked']    = $now;
						$prev['fail_since'] = $since;
						$state[ $sym ]      = $prev;
						continue;
					}
				}
				// valid data is not enough — the /stocks/{x}/ page itself must
				// exist before the sitemap may advertise it (verified live: KO
				// has full real data yet /stocks/ko/ is an HTTP 404). null =
				// the existence check couldn't get a definitive answer — fall
				// through to keep-last-good rather than evicting on a blip.
				$page = function_exists( 'sml_ege_stocks_page_exists' ) ? sml_ege_stocks_page_exists( $sym ) : null;
				if ( false === $page ) {
					$state[ $sym ] = array(
						'eligible' => false, 'verdict' => $r['verdict'], 'score' => (int) $r['score'],
						'why'      => 'no-page', 'checked' => $now, 'fail_since' => 0,
					);
					continue;
				}
				if ( true === $page ) {
					$state[ $sym ] = array(
						'eligible' => in_array( $r['verdict'], array( 'index', 'selective' ), true ),
						'verdict'  => $r['verdict'], 'score' => (int) $r['score'],
						'why'      => 'scored', 'checked' => $now, 'fail_since' => 0,
					);
					continue;
				}
			}

			if ( ! empty( $r['confirmed_invalid'] ) && ( $any_valid || empty( $prev['eligible'] ) ) ) {
				// trust a confirmed negative only when this same sweep proved the
				// upstream can answer at all, or when there's no good prior state
				// to protect — a total-outage sweep must never evict tickers
				$state[ $sym ] = array(
					'eligible' => false, 'verdict' => 'noindex', 'score' => 0,
					'why'      => 'no-data', 'checked' => $now, 'fail_since' => 0,
				);
				continue;
			}

			// fetch failed this sweep (or a confirmed-negative arrived during a
			// suspect all-fail sweep): keep a previously-good verdict for up to
			// 24h of consecutive failures, then drop honestly
			$since = ! empty( $prev['fail_since'] ) ? (int) $prev['fail_since'] : $now;
			if ( ! empty( $prev['eligible'] ) && ( $now - $since ) < DAY_IN_SECONDS ) {
				$prev['why']        = 'kept-last-good';
				$prev['checked']    = $now;
				$prev['fail_since'] = $since;
				$state[ $sym ]      = $prev;
			} else {
				$state[ $sym ] = array(
					'eligible' => false, 'verdict' => 'noindex', 'score' => 0,
					'why'      => 'unavailable', 'checked' => $now, 'fail_since' => $since,
				);
			}
		}

		update_option( 'sml_seo_stocks_state', $state, false ); // autoload off: only sitemap requests + this cron read it
	}
	add_action( 'sml_seo_stocks_score_tick', 'sml_seo_stocks_score_tick' );

	add_action( 'init', static function () {
		if ( ! wp_next_scheduled( 'sml_seo_stocks_score_tick' ) ) {
			// wp_schedule_event has no duplicate-event guard, so two concurrent
			// requests in the activation window could each register a recurring
			// event and permanently double the sweep — a short lock closes that
			if ( false === get_transient( 'sml_seo_sched_lock' ) ) {
				set_transient( 'sml_seo_sched_lock', 1, MINUTE_IN_SECONDS );
				wp_schedule_event( time() + 30, 'sml_seo_5min', 'sml_seo_stocks_score_tick' );
			}
		}
	} );

	/* ---------- rendering: instant, from stored state — no scoring inline ---------- */
	function sml_seo_render_stocks_sitemap() {
		if ( ! function_exists( 'sml_ege_score_ticker' ) ) {
			// engine not loaded — fail closed: an empty-but-valid sitemap, never
			// stale state served against the engine's documented rollback contract
			return sml_seo_xml_head() . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><!-- eligibility engine inactive; failing closed --></urlset>';
		}

		$state = sml_seo_stocks_state();
		$xml   = sml_seo_xml_head() . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
		$included = 0; $held = 0; $ineligible = array(); $unavailable = array(); $nopage = array(); $pending = array();

		$now = time();
		foreach ( sml_seo_sitemap_seed_tickers() as $sym ) {
			$st = isset( $state[ $sym ] ) && is_array( $state[ $sym ] ) ? $state[ $sym ] : null;
			if ( null === $st || 'in-progress' === ( isset( $st['why'] ) ? $st['why'] : '' ) ) { $pending[] = $sym; continue; }
			// render-side staleness bound: the 24h keep-last-good grace is
			// enforced inside cron ticks, but a dead cron would otherwise serve
			// last-good URLs forever — cap any entry at 26h regardless
			if ( ! isset( $st['checked'] ) || ( $now - (int) $st['checked'] ) > 26 * HOUR_IN_SECONDS ) { $unavailable[] = $sym; continue; }
			if ( ! empty( $st['eligible'] ) ) {
				$xml .= '<url><loc>' . sml_esc_xml( home_url( '/stocks/' . strtolower( $sym ) . '/' ) ) . '</loc>'
					. '<changefreq>hourly</changefreq><priority>' . ( 'index' === $st['verdict'] ? '0.8' : '0.5' ) . '</priority></url>' . "\n";
				$included++;
				if ( 'kept-last-good' === $st['why'] ) { $held++; }
				continue;
			}
			if ( 'unavailable' === $st['why'] ) { $unavailable[] = $sym; }
			elseif ( 'no-page' === $st['why'] ) { $nopage[] = $sym; }
			else { $ineligible[] = $sym; }
		}

		$xml .= "<!-- {$included} included ({$held} held on last good verdict through a data outage); "
			. count( $ineligible ) . ' below eligibility or confirmed no data: ' . sml_esc_xml( implode( ',', $ineligible ) ) . '; '
			. count( $nopage ) . ' valid ticker but /stocks/ page missing (404): ' . sml_esc_xml( implode( ',', $nopage ) ) . '; '
			. count( $unavailable ) . ' unavailable (will retry): ' . sml_esc_xml( implode( ',', $unavailable ) ) . '; '
			. count( $pending ) . ' awaiting first scoring pass: ' . sml_esc_xml( implode( ',', $pending ) ) . " -->\n";
		$xml .= '</urlset>';
		return $xml;
	}

	function sml_seo_render_hub_sitemap() {
		// /markets/ — real, always-valid. Sector/theme hub URLs join once
		// their own routes exist and their backing data is confirmed broad enough.
		$xml = sml_seo_xml_head() . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
		$xml .= '<url><loc>' . sml_esc_xml( home_url( '/markets/' ) ) . '</loc><changefreq>daily</changefreq><priority>0.6</priority></url>' . "\n";
		// /heat-map/ joins only while its real-data snapshot is live and fresh —
		// the page itself serves noindex in that same condition, so sitemap and
		// robots signals always agree (see wpcode/heatmap-page.php)
		$snap = get_option( 'sml_hm_snapshot', array() );
		if ( is_array( $snap ) && ! empty( $snap['quotes'] ) && is_array( $snap['quotes'] ) && count( $snap['quotes'] ) >= 20
			&& ! empty( $snap['generated'] ) && ( time() - (int) $snap['generated'] ) < 2 * HOUR_IN_SECONDS ) {
			$xml .= '<url><loc>' . sml_esc_xml( home_url( '/heat-map/' ) ) . '</loc><changefreq>hourly</changefreq><priority>0.7</priority></url>' . "\n";
		}
		$xml .= '</urlset>';
		return $xml;
	}

	add_action( 'init', static function () {
		$path = sml_seo_sitemap_path();
		if ( '/sml-stocks-sitemap.xml' !== $path && '/sml-hub-sitemap.xml' !== $path ) { return; }
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return; }

		add_action( 'template_redirect', static function () use ( $path ) {
			global $wp_query;
			if ( $wp_query ) { $wp_query->is_404 = false; }
			status_header( 200 );
			header( 'Content-Type: application/xml; charset=UTF-8' );
			nocache_headers();
			echo '/sml-stocks-sitemap.xml' === $path ? sml_seo_render_stocks_sitemap() : sml_seo_render_hub_sitemap(); // phpcs:ignore
			exit;
		}, 0 );
	}, 1 );

	// discovery: append both new files as robots.txt Sitemap: lines (additive,
	// doesn't touch the existing Sitemap: lines already there)
	add_filter( 'robots_txt', static function ( $output, $public ) {
		if ( ! $public ) { return $output; }
		if ( false !== strpos( $output, 'sml-stocks-sitemap.xml' ) ) { return $output; }
		$output = rtrim( $output ) . "\nSitemap: " . home_url( '/sml-stocks-sitemap.xml' )
			. "\nSitemap: " . home_url( '/sml-hub-sitemap.xml' ) . "\n";
		return $output;
	}, 21, 2 );
}
