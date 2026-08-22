/**
 * SML Heat Map — bulk snapshot aggregator.
 *
 * The terminal heat map (js/terminal-heatmap.js) tracks ~290 tickers. The
 * site's own bulk quote route (sml-scanner/v1/quotes, verified live
 * 2026-08-22: real day OHLC/volume/prevClose, quality "verified_snapshot")
 * caps at 50 symbols per request — so instead of every visitor firing 6
 * chunked requests, THIS cron fetches the 6 chunks once every 2 minutes,
 * merges them into one stored blob, and a public endpoint serves that blob
 * to everyone: GET /wp-json/sml-hm/v1/snapshot.
 *
 * Fetches go through the real front door (wp_remote_get to the site's own
 * public URL) — internal rest_do_request is verified-unreliable for these
 * plugin routes (see seo-ege-core.php v2). A chunk that fails keeps its
 * symbols' previous values (stamped with their real fetch time); entries
 * older than 24h are dropped, never served stale-forever. Fail-closed: the
 * endpoint answers {"available":false} until the first sweep lands.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate — the endpoint 404s and the heat map module falls
 * back to fetching the scanner chunks directly from the browser (built in).
 * Optional cleanup: wp_clear_scheduled_hook('sml_hm_snapshot_tick') and
 * delete_option('sml_hm_snapshot').
 */
if ( ! function_exists( 'sml_hm_symbols' ) ) {

	/** Same taxonomy as js/terminal-heatmap.js (58 industries x 5) + the index ETFs. */
	function sml_hm_symbols() {
		return array(
			'NVDA','AVGO','AMD','TSM','QCOM','CRM','ADBE','INTU','NOW','SAP','MSFT','ORCL','PLTR','SNOW','MDB',
			'PANW','CRWD','ZS','FTNT','OKTA','AAPL','SONY','DELL','HPQ','GRMN','GOOGL','META','SPOT','PINS','RDDT',
			'ACN','IBM','INFY','CTSH','WIT','CSCO','ANET','ERIC','NOK','UI','JPM','BAC','WFC','C','HSBC',
			'USB','PNC','TFC','FITB','RF','V','MA','AXP','COF','DFS','BRK.B','PGR','CB','MET','AIG',
			'BLK','BX','KKR','APO','TROW','GS','MS','SCHW','IBKR','HOOD','PYPL','XYZ','COIN','SOFI','AFRM',
			'LLY','NVO','PFE','MRK','ABBV','AMGN','VRTX','REGN','GILD','MRNA','ABT','MDT','SYK','BSX','ISRG',
			'UNH','ELV','CI','CVS','HUM','TMO','DHR','A','IQV','LH','XOM','CVX','SHEL','BP','TTE',
			'COP','EOG','OXY','DVN','FANG','KMI','WMB','ET','OKE','TRP','SLB','HAL','BKR','FTI','WHD',
			'FSLR','ENPH','RUN','BE','NXT','BTU','CEIX','AMR','HCC','ARLP','GE','RTX','LMT','BA','NOC',
			'DAL','UAL','LUV','AAL','ALK','UNP','CSX','NSC','CP','CNI','UPS','FDX','ODFL','XPO','JBHT',
			'CAT','DE','CNH','AGCO','PCAR','HON','MMM','ITW','PH','DOV','ETN','EMR','ROK','HUBB','GNRC',
			'TSLA','TM','F','GM','RIVN','APTV','MGA','BWA','LEA','GNTX','AMZN','BABA','MELI','PDD','SHOP',
			'WMT','COST','TGT','DG','DLTR','MCD','SBUX','CMG','YUM','DRI','NKE','LULU','RL','DECK','TPR',
			'BKNG','MAR','HLT','RCL','ABNB','HD','LOW','TSCO','BLDR','WSM','KO','PEP','MNST','KDP','STZ',
			'MDLZ','GIS','HSY','KHC','CAG','PG','CL','KMB','CHD','CLX','PM','MO','BTI','UVV','TPB',
			'KR','ACI','SYY','USFD','SFM','TMUS','VZ','T','CHTR','CMCSA','NFLX','DIS','WBD','LYV','PARA',
			'EA','TTWO','RBLX','U','NTES','TTD','APP','OMC','IPG','DV','NEE','SO','DUK','D','AEP',
			'AWK','WTRG','ATO','NI','SRE','PLD','AMT','EQIX','DLR','PSA','SPG','O','AVB','EQR','VICI',
			'LIN','SHW','APD','ECL','DD','BHP','RIO','FCX','NUE','VALE','NEM','GOLD','AEM','KGC','WPM',
			'IP','PKG','SW','BALL','AMCR',
			'SPY','QQQ','DIA',
			// command-center extras: real ETF proxies for the global strip + volatility
			'GLD','USO','EWJ','FXI','EWU','EWG','IBIT','VIXY',
		);
	}

	add_filter( 'cron_schedules', static function ( $s ) {
		if ( ! isset( $s['sml_hm_2min'] ) ) { $s['sml_hm_2min'] = array( 'interval' => 2 * MINUTE_IN_SECONDS, 'display' => 'Every 2 minutes (SML heat map snapshot)' ); }
		return $s;
	} );

	function sml_hm_snapshot_tick() {
		// overlap lock: a double-fired tick is a no-op, never a doubled sweep
		if ( false !== get_transient( 'sml_hm_tick_lock' ) ) { return; }
		set_transient( 'sml_hm_tick_lock', 1, 90 );

		$stored = get_option( 'sml_hm_snapshot', array() );
		$quotes = ( is_array( $stored ) && isset( $stored['quotes'] ) && is_array( $stored['quotes'] ) ) ? $stored['quotes'] : array();

		$now    = time();
		$chunks = array_chunk( sml_hm_symbols(), 50 );
		foreach ( $chunks as $chunk ) {
			$url = home_url( '/wp-json/sml-scanner/v1/quotes?symbols=' . rawurlencode( implode( ',', $chunk ) ) );
			$res = wp_remote_get( $url, array( 'timeout' => 8, 'sslverify' => true, 'headers' => array( 'Accept' => 'application/json' ) ) );
			if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) { continue; } // failed chunk: previous values stand
			$body = json_decode( wp_remote_retrieve_body( $res ), true );
			if ( ! is_array( $body ) || empty( $body['rows'] ) || ! is_array( $body['rows'] ) ) { continue; }
			foreach ( $body['rows'] as $r ) {
				if ( ! is_array( $r ) || empty( $r['sym'] ) || ! isset( $r['last'] ) || null === $r['last'] ) { continue; }
				// slim to what the map needs — keeps the option ~30KB
				$quotes[ $r['sym'] ] = array(
					'sym'    => $r['sym'],
					'last'   => $r['last'],
					'chgPct' => isset( $r['chgPct'] ) ? round( (float) $r['chgPct'], 4 ) : null,
					'o'      => isset( $r['o'] ) ? $r['o'] : null,
					'h'      => isset( $r['h'] ) ? $r['h'] : null,
					'l'      => isset( $r['l'] ) ? $r['l'] : null,
					'v'      => isset( $r['v'] ) ? $r['v'] : null,
					'pc'     => isset( $r['pc'] ) ? $r['pc'] : null,
					'ts'     => $now,
				);
			}
		}

		// honesty bound: an entry no chunk has refreshed in 24h is dropped
		foreach ( $quotes as $sym => $q ) {
			if ( empty( $q['ts'] ) || ( $now - (int) $q['ts'] ) > DAY_IN_SECONDS ) { unset( $quotes[ $sym ] ); }
		}

		update_option( 'sml_hm_snapshot', array( 'generated' => $now, 'quotes' => $quotes ), false );
	}
	add_action( 'sml_hm_snapshot_tick', 'sml_hm_snapshot_tick' );

	add_action( 'init', static function () {
		if ( ! wp_next_scheduled( 'sml_hm_snapshot_tick' ) ) {
			if ( false === get_transient( 'sml_hm_sched_lock' ) ) { // two concurrent activations must not double the event
				set_transient( 'sml_hm_sched_lock', 1, MINUTE_IN_SECONDS );
				wp_schedule_event( time() + 20, 'sml_hm_2min', 'sml_hm_snapshot_tick' );
			}
		}
	} );

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-hm/v1', '/snapshot', array(
			'methods'             => 'GET',
			'permission_callback' => '__return_true', // public by design: same data the public scanner route already serves
			'callback'            => static function () {
				$stored = get_option( 'sml_hm_snapshot', array() );
				$ok     = is_array( $stored ) && ! empty( $stored['quotes'] ) && is_array( $stored['quotes'] ) && count( $stored['quotes'] ) >= 20;
				$resp   = new WP_REST_Response( $ok
					? array( 'available' => true, 'generated' => (int) $stored['generated'], 'quotes' => $stored['quotes'] )
					: array( 'available' => false ) );
				$resp->header( 'Cache-Control', 'public, max-age=60' ); // one blob, cache-friendly for every visitor
				return $resp;
			},
		) );
	} );
}
