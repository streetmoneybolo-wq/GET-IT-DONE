/**
 * SML SEO — real, data-driven content for /stocks/{ticker}/ pages.
 *
 * Why: ticker pages were ~155 words (a chart shell plus a 2-sentence summary),
 * which AdSense and Google read as low-value. This adds sections built ONLY
 * from data the site already has — company profile, today's trading range,
 * the Market Position cost model, and the site's own recent articles. No
 * filler: a section with no data is omitted, and nothing is invented.
 *
 * Sections (each independent):
 *  - About {company}: the company description + a facts table.
 *  - Today's trading: open/high/low/prev close/volume/VWAP with computed notes.
 *  - Where holders stand: Market Position window, average cost, profit ratio,
 *    70% / 90% cost ranges, support and resistance.
 *  - Latest {SYMBOL} coverage: the site's own recent articles (internal links).
 *  - How to read this page + disclaimer.
 *
 * Self-contained: reads the site's own /sml/v1 REST routes (quote, company2,
 * market-position). Fails closed: adds nothing if the symbol has no live quote.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet — pages return to the 2-sentence summary.
 * WPCode rules: no top-level return/exit; contains none of the five flagged
 * function-name patterns (the site is at the limit).
 */
if ( ! function_exists( 'sml_stc_render' ) ) {

	function sml_stc_symbol_from_path() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		if ( preg_match( '#^/stocks/([a-zA-Z0-9.\-]+)/?$#', $path, $m ) ) { return strtoupper( $m[1] ); }
		return '';
	}

	function sml_stc_rest( $route, $symbol ) {
		$req = new WP_REST_Request( 'GET', $route );
		$req->set_param( 'symbol', $symbol );
		$res = rest_do_request( $req );
		if ( is_wp_error( $res ) || $res->get_status() >= 400 ) { return null; }
		return (array) $res->get_data();
	}

	/** Same data the page's own widgets use; cached 10 minutes. Null when the symbol has no live quote. */
	function sml_stc_data( $symbol ) {
		$key = 'sml_stc_data_' . $symbol;
		$hit = get_transient( $key );
		if ( is_array( $hit ) ) { return empty( $hit['valid'] ) ? null : $hit; }
		$quote = sml_stc_rest( '/sml/v1/quote', $symbol );
		$valid = is_array( $quote ) && isset( $quote['current'] ) && is_numeric( $quote['current'] )
			&& isset( $quote['source'] ) && 'none' !== $quote['source'];
		$out = array( 'valid' => $valid, 'symbol' => $symbol );
		if ( $valid ) {
			$out['quote']    = $quote;
			$out['company']  = sml_stc_rest( '/sml/v1/company2', $symbol );
			$out['position'] = sml_stc_rest( '/sml/v1/market-position', $symbol );
		}
		set_transient( $key, $out, $valid ? 10 * MINUTE_IN_SECONDS : 60 );
		return $valid ? $out : null;
	}

	function sml_stc_num( $v, $d = 2 ) {
		return ( is_numeric( $v ) ) ? number_format_i18n( (float) $v, $d ) : '';
	}
	function sml_stc_money( $v, $d = 2 ) {
		return ( is_numeric( $v ) ) ? '$' . number_format_i18n( (float) $v, $d ) : '';
	}
	function sml_stc_big( $v ) {
		if ( ! is_numeric( $v ) || $v <= 0 ) { return ''; }
		$v = (float) $v;
		if ( $v >= 1e12 ) { return '$' . number_format_i18n( $v / 1e12, 2 ) . ' trillion'; }
		if ( $v >= 1e9 )  { return '$' . number_format_i18n( $v / 1e9, 1 ) . ' billion'; }
		return '$' . number_format_i18n( $v / 1e6, 1 ) . ' million';
	}

	/** The site's own recent articles about this symbol (cached 30 min). */
	function sml_stc_articles( $symbol, $name ) {
		$key = 'sml_stc_news_' . $symbol;
		$hit = get_transient( $key );
		if ( is_array( $hit ) ) { return $hit; }
		$out = array();
		$q = new WP_Query( array(
			's' => $symbol, 'post_type' => 'post', 'post_status' => 'publish',
			'posts_per_page' => 30, 'no_found_rows' => true, 'ignore_sticky_posts' => true,
		) );
		$sym_re  = '/(^|[^A-Za-z0-9])\$?' . preg_quote( $symbol, '/' ) . '([^A-Za-z0-9]|$)/';
		$name_re = '' !== $name ? '/' . preg_quote( preg_replace( '/[,.]?\s+(Inc|Corp|Corporation|Ltd|Co|Company|plc)\.?$/i', '', $name ), '/' ) . '/i' : '';
		foreach ( $q->posts as $p ) {
			$title = wp_strip_all_tags( get_the_title( $p ) );
			if ( preg_match( $sym_re, $title ) || ( '' !== $name_re && preg_match( $name_re, $title ) ) ) {
				$out[] = array(
					'title' => $title,
					'url'   => get_permalink( $p ),
					'date'  => get_the_date( 'M j, Y', $p ),
					'blurb' => wp_trim_words( wp_strip_all_tags( get_the_excerpt( $p ) ), 28, '…' ),
				);
			}
			if ( count( $out ) >= 6 ) { break; }
		}
		wp_reset_postdata();
		set_transient( $key, $out, 30 * MINUTE_IN_SECONDS );
		return $out;
	}

	function sml_stc_render( $s ) {
		$symbol   = $s['symbol'];
		$company  = is_array( $s['company'] ) ? $s['company'] : array();
		$quote    = is_array( $s['quote'] ) ? $s['quote'] : array();
		$position = is_array( $s['position'] ) ? $s['position'] : array();
		$name     = ! empty( $company['name'] ) ? (string) $company['name'] : $symbol;
		$e        = 'esc_html';
		$h        = '';

		/* ---- About ---- */
		$desc = ! empty( $company['description'] ) ? trim( wp_strip_all_tags( (string) $company['description'] ) ) : '';
		$facts = array();
		if ( ! empty( $company['market'] ) )   { $facts['Primary exchange (MIC)'] = (string) $company['market']; }
		if ( ! empty( $company['listDate'] ) ) { $facts['Listed since'] = (string) $company['listDate']; }
		if ( ! empty( $company['marketCap'] ) ) { $facts['Market capitalization'] = sml_stc_big( $company['marketCap'] ); }
		if ( ! empty( $company['shares'] ) )   { $facts['Shares outstanding'] = number_format_i18n( (float) $company['shares'] ); }
		if ( ! empty( $company['employees'] ) ) { $facts['Employees'] = number_format_i18n( (float) $company['employees'] ); }
		$hq = trim( implode( ', ', array_filter( array( $company['city'] ?? '', $company['state'] ?? '', $company['country'] ?? '' ) ) ) );
		if ( '' !== $hq ) { $facts['Headquarters'] = $hq; }
		if ( ! empty( $company['website'] ) ) { $facts['Website'] = preg_replace( '#^https?://#', '', rtrim( (string) $company['website'], '/' ) ); }
		if ( '' !== $desc && ! preg_match( '/[.!?]$/', $desc ) && preg_match( '/^(.*[.!?])\s/s', $desc, $dm ) ) { $desc = $dm[1]; }
		if ( '' !== $desc || $facts ) {
			$h .= '<h2>About ' . $e( $name ) . ' (' . $e( $symbol ) . ')</h2>';
			if ( '' !== $desc ) { $h .= '<p>' . $e( $desc ) . '</p>'; }
			if ( $facts ) {
				$h .= '<table class="sml-stc-facts"><tbody>';
				foreach ( $facts as $k => $v ) { $h .= '<tr><th scope="row">' . $e( $k ) . '</th><td>' . $e( $v ) . '</td></tr>'; }
				$h .= '</tbody></table>';
			}
		}

		/* ---- Today's trading ---- */
		$cur = $quote['current'] ?? null; $hi = $quote['high'] ?? null; $lo = $quote['low'] ?? null;
		$op  = $quote['open'] ?? null;    $pc = $quote['previousClose'] ?? null;
		if ( is_numeric( $cur ) && is_numeric( $hi ) && is_numeric( $lo ) ) {
			$notes = array();
			$notes[] = $e( $symbol ) . ' has traded between ' . sml_stc_money( $lo ) . ' and ' . sml_stc_money( $hi ) . ' in the current session, a range of ' . sml_stc_money( $hi - $lo ) . '.';
			if ( $hi > $lo ) {
				$pos = ( $cur - $lo ) / ( $hi - $lo ) * 100;
				$where = $pos >= 80 ? 'near the top of' : ( $pos <= 20 ? 'near the bottom of' : 'in the middle of' );
				$notes[] = 'The latest price of ' . sml_stc_money( $cur ) . ' sits ' . $where . ' that range (' . number_format_i18n( $pos, 0 ) . '% of the way from low to high).';
			}
			// Feeds can mix extended-hours and regular-session fields; only print an
			// open or VWAP that is consistent with the session's own high/low.
			$op_ok = is_numeric( $op ) && $op >= $lo && $op <= $hi;
			$vw_ok = is_numeric( $quote['vwap'] ?? null ) && $quote['vwap'] >= $lo && $quote['vwap'] <= $hi;
			if ( $op_ok && is_numeric( $pc ) && $pc > 0 ) {
				$gap = ( $op - $pc ) / $pc * 100;
				if ( abs( $gap ) >= 0.05 ) {
					$notes[] = 'It opened at ' . sml_stc_money( $op ) . ', ' . ( $gap > 0 ? 'a gap up of ' : 'a gap down of ' ) . number_format_i18n( abs( $gap ), 2 ) . '% from the prior close of ' . sml_stc_money( $pc ) . '.';
				} else {
					$notes[] = 'It opened at ' . sml_stc_money( $op ) . ', essentially flat to the prior close of ' . sml_stc_money( $pc ) . '.';
				}
			}
			if ( $vw_ok ) {
				$rel = $cur >= $quote['vwap'] ? 'above' : 'below';
				$notes[] = 'The volume-weighted average price is ' . sml_stc_money( $quote['vwap'] ) . ', and the stock is trading ' . $rel . ' it. Traders often use VWAP as a gauge of whether buyers or sellers have had the better average entry today.';
			}
			$h .= '<h2>' . $e( $symbol ) . ' trading today</h2><p>' . implode( ' ', $notes ) . '</p>';
			$rows = array( 'Open' => $op_ok ? sml_stc_money( $op ) : '', 'High' => sml_stc_money( $hi ), 'Low' => sml_stc_money( $lo ), 'Previous close' => sml_stc_money( $pc ), 'Volume' => is_numeric( $quote['volume'] ?? null ) ? number_format_i18n( (float) $quote['volume'] ) : '', 'VWAP' => $vw_ok ? sml_stc_money( $quote['vwap'] ) : '' );
			$h .= '<table class="sml-stc-facts"><tbody>';
			foreach ( $rows as $k => $v ) { if ( '' !== $v ) { $h .= '<tr><th scope="row">' . $e( $k ) . '</th><td>' . $e( $v ) . '</td></tr>'; } }
			$h .= '</tbody></table>';
		}

		/* ---- Where holders stand (Market Position model) ---- */
		if ( isset( $position['profitRatio'], $position['avgCost'] ) && is_numeric( $position['avgCost'] ) && is_numeric( $cur ) ) {
			$pr  = (float) $position['profitRatio'];
			$avg = (float) $position['avgCost'];
			$diff = $avg > 0 ? ( $cur - $avg ) / $avg * 100 : 0;
			$p  = 'StockMarketLoop\'s Market Position model estimates how the shares traded between ' . $e( (string) ( $position['from'] ?? '' ) ) . ' and ' . $e( (string) ( $position['to'] ?? '' ) )
				. ' were bought. Its estimate of the average cost basis is ' . sml_stc_money( $avg ) . '; at ' . sml_stc_money( $cur ) . ' the stock trades '
				. number_format_i18n( abs( $diff ), 1 ) . '% ' . ( $diff >= 0 ? 'above' : 'below' ) . ' that level. About ' . number_format_i18n( $pr, 1 )
				. '% of those shares are estimated to be held at a profit at the current price.';
			if ( $pr >= 80 )      { $p .= ' A high figure means most recent buyers are in the green, which can mean fewer trapped holders overhead, and also more people with gains who might sell.'; }
			elseif ( $pr >= 65 )  { $p .= ' A majority in profit means most recent buyers are in the green: fewer trapped holders overhead, but also more people with gains who might sell.'; }
			elseif ( $pr <= 35 )  { $p .= ' A low figure means most recent buyers are underwater, so rallies can meet selling from holders trying to get back to break even.'; }
			else                  { $p .= ' A figure in the middle means holders are split between gains and losses.'; }
			if ( isset( $position['support'], $position['resistance'] ) && is_numeric( $position['support'] ) && is_numeric( $position['resistance'] ) ) {
				$p .= ' The densest nearby clusters of cost basis sit around ' . sml_stc_money( $position['support'] ) . ' (support) and ' . sml_stc_money( $position['resistance'] ) . ' (resistance).';
			}
			if ( isset( $position['r70'][0], $position['r70'][1] ) ) {
				$p .= ' Roughly 70% of the estimated cost basis lies between ' . sml_stc_money( $position['r70'][0] ) . ' and ' . sml_stc_money( $position['r70'][1] ) . '';
				if ( isset( $position['r90'][0], $position['r90'][1] ) ) { $p .= ', and 90% between ' . sml_stc_money( $position['r90'][0] ) . ' and ' . sml_stc_money( $position['r90'][1] ); }
				$p .= '.';
			}
			$h .= '<h2>Where ' . $e( $symbol ) . ' holders stand</h2><p>' . $p . '</p><p class="sml-stc-note">This is a model estimate built from price and volume history, not a record of actual positions.</p>';
		}

		/* ---- Latest coverage ---- */
		$arts = sml_stc_articles( $symbol, $name );
		if ( $arts ) {
			$h .= '<h2>Latest ' . $e( $symbol ) . ' coverage</h2><ul class="sml-stc-news">';
			foreach ( $arts as $a ) {
				$h .= '<li><a href="' . esc_url( $a['url'] ) . '">' . $e( $a['title'] ) . '</a> <span>' . $e( $a['date'] ) . '</span>'
					. ( '' !== $a['blurb'] ? '<br>' . $e( $a['blurb'] ) : '' ) . '</li>';
			}
			$h .= '</ul>';
		}

		if ( '' === $h ) { return ''; }

		$h .= '<h2>How to read this page</h2><p>Quote figures come from StockMarketLoop\'s market data feed and may be delayed; the timestamp in the summary above shows when they were observed. Company details come from public reference data. The cost-basis section is a statistical model, not a forecast. Nothing here is investment advice; see our <a href="' . esc_url( home_url( '/financial-disclaimer/' ) ) . '">financial disclaimer</a> and <a href="' . esc_url( home_url( '/editorial-policy/' ) ) . '">editorial policy</a>.</p>';

		$css = '<style>#sml-stc{max-width:820px;margin:16px auto;padding:4px 20px 12px;font:15px/1.65 -apple-system,Segoe UI,sans-serif;color:#14191c}#sml-stc h2{font-size:20px;margin:22px 0 8px}#sml-stc table{border-collapse:collapse;width:100%;margin:10px 0}#sml-stc th,#sml-stc td{text-align:left;padding:6px 8px;border-bottom:1px solid #e1e5e1;font-weight:400}#sml-stc th{color:#5c6664;width:46%}#sml-stc .sml-stc-note{font-size:13px;color:#7c8785}#sml-stc ul{padding-left:18px}#sml-stc li{margin:0 0 10px}#sml-stc li span{color:#7c8785;font-size:13px}</style>';
		return $css . '<section id="sml-stc" aria-label="' . esc_attr( $symbol . ' analysis' ) . '">' . $h . '</section>';
	}

	function sml_stc_ob( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '<body' ) || false !== strpos( $html, 'id="sml-stc"' ) ) { return $html; }
		$symbol = sml_stc_symbol_from_path();
		$s      = '' === $symbol ? null : sml_stc_data( $symbol );
		if ( null === $s ) { return $html; }
		if ( ! preg_match( '/<body\b[^>]*>/i', $html, $m, PREG_OFFSET_CAPTURE ) ) { return $html; }
		$block = sml_stc_render( $s );
		if ( '' === $block ) { return $html; }
		$at = $m[0][1] + strlen( $m[0][0] );
		return substr( $html, 0, $at ) . $block . substr( $html, $at );
	}

	add_action( 'send_headers', static function () {
		if ( '' === sml_stc_symbol_from_path() ) { return; }
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return; }
		ob_start( 'sml_stc_ob' );
	}, 1 );
}
