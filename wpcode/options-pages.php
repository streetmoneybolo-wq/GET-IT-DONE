/**
 * SML Options Data Pages — /options/{TICKER}/
 *
 * WPCode: PHP Snippet / Auto Insert / RUN EVERYWHERE.
 * Do NOT add an opening PHP tag in WPCode.
 *
 * Free, citable, server-rendered options analytics per ticker: max pain, net
 * gamma exposure, the approximate gamma flip, IV skew and unusual activity.
 *
 * WHY SERVER-RENDERED: the whole point is to be indexed and cited. A crawler
 * must see the numbers in the HTML, so nothing here depends on JavaScript.
 *
 * WHY A STORED SNAPSHOT: sml-options-intelligence/v1/chain returns 503
 * (sml_oi_no_truthful_chain) outside market hours and requires an authenticated
 * user. So the chain is pulled and REDUCED on a schedule, and the page renders
 * whatever was last computed, stamped with its own "as of". That also means a
 * crawl storm cannot touch a rate-limited upstream, and an upstream outage
 * degrades to older numbers rather than a broken page.
 *
 * HONESTY RULES, deliberate and load-bearing for a data page that invites
 * citation:
 *   - a stale chain is never used to derive signals; the snapshot keeps its
 *     original timestamp and the page says how old it is
 *   - the gamma flip is labelled APPROXIMATE, because computing it exactly
 *     means repricing the chain at each candidate spot
 *   - the dealer sign convention is printed on the page, since flipping it
 *     inverts every GEX number and there is no universal standard
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'sml_opt_config' ) ) {

	function sml_opt_config() {
		return array(
			/* Heavily-searched, deep-chain names. Deep chains matter: max pain and
			   GEX are meaningless on a thin one. */
			'tickers'    => array( 'SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'AMZN' ),
			'snap_opt'   => 'sml_opt_snap_',   // + lowercase symbol
			'meta_opt'   => 'sml_opt_meta',
			'max_age'    => 172800,            // 48h: past this the page says so loudly
			'multiplier' => 100,
			'min_volume' => 500,               // unusual-activity floor
			'min_ratio'  => 2.0,               // volume / open interest
		);
	}

	function sml_opt_symbol( $raw ) {
		$s = strtoupper( trim( (string) $raw ) );
		return preg_match( '/^[A-Z]{1,6}$/', $s ) ? $s : '';
	}

	function sml_opt_is_launch( $symbol ) {
		return in_array( $symbol, sml_opt_config()['tickers'], true );
	}

	/* =====================================================================
	 * DECODER
	 *
	 * The chain ships contracts as compact positional arrays to save bytes:
	 *
	 *   [ type, strike, volume, open_interest, gamma, iv, bid, ask ]
	 *
	 * That mapping is not documented upstream; it was derived from a live NVDA
	 * capture and confirmed three independent ways, which is worth recording
	 * because a silent re-ordering upstream would corrupt every number here:
	 *
	 *   pos4 is gamma  - it peaks at 0.0922 on the 215 strike with spot at
	 *                    214.72 and decays symmetrically either side. Nothing
	 *                    else in an option chain has that shape.
	 *   pos5 is IV     - 0.25 at the money rising to 1.28 on the wings: the smile.
	 *   pos6/7 are bid/ask - on the deep-ITM 180 call, intrinsic was 34.72 and
	 *                    the mid of those two was 34.88.
	 *   pos2 is volume - it peaks on the at-the-money strikes; pos3 (open
	 *                    interest) does not.
	 * ================================================================== */
	function sml_opt_decode( $chain ) {
		$rows = isset( $chain['c'] ) && is_array( $chain['c'] ) ? $chain['c'] : array();
		$out  = array();
		foreach ( $rows as $r ) {
			if ( ! is_array( $r ) || count( $r ) < 8 ) {
				continue;
			}
			$out[] = array(
				'type'          => strtolower( (string) $r[0] ) === 'put' ? 'put' : 'call',
				'strike'        => (float) $r[1],
				'volume'        => (int) $r[2],
				'open_interest' => (int) $r[3],
				'gamma'         => (float) $r[4],
				'iv'            => (float) $r[5],
				'bid'           => (float) $r[6],
				'ask'           => (float) $r[7],
			);
		}
		return $out;
	}

	/* =====================================================================
	 * ANALYTICS — mirrors the Node implementation in news-engine so the two
	 * can never disagree about a published number.
	 * ================================================================== */

	/** Strike at which the total intrinsic value of all open contracts is least. */
	function sml_opt_max_pain( $contracts ) {
		$strikes = array();
		foreach ( $contracts as $c ) {
			$strikes[ (string) $c['strike'] ] = $c['strike'];
		}
		if ( count( $strikes ) < 3 ) {
			return null;
		}
		$best = null;
		$best_pain = null;
		foreach ( $strikes as $candidate ) {
			$pain = 0.0;
			foreach ( $contracts as $c ) {
				$oi = $c['open_interest'];
				if ( $oi <= 0 ) {
					continue;
				}
				if ( 'call' === $c['type'] && $candidate > $c['strike'] ) {
					$pain += ( $candidate - $c['strike'] ) * $oi;
				} elseif ( 'put' === $c['type'] && $candidate < $c['strike'] ) {
					$pain += ( $c['strike'] - $candidate ) * $oi;
				}
			}
			if ( null === $best_pain || $pain < $best_pain ) {
				$best_pain = $pain;
				$best      = $candidate;
			}
		}
		return array( 'strike' => $best, 'total_pain' => $best_pain );
	}

	/**
	 * Dealer gamma exposure per strike.
	 *
	 * Convention: dealers are assumed SHORT calls and LONG puts, so call gamma
	 * is positive and put gamma negative. There is no universal standard here —
	 * the opposite convention inverts every number — so the page prints which
	 * one produced it.
	 */
	function sml_opt_gex( $contracts, $underlying ) {
		$s = (float) $underlying;
		if ( $s <= 0 ) {
			return null;
		}
		$mult = sml_opt_config()['multiplier'];
		$by   = array();
		foreach ( $contracts as $c ) {
			if ( $c['gamma'] <= 0 || $c['open_interest'] <= 0 ) {
				continue;
			}
			$k   = (string) $c['strike'];
			$mag = $c['gamma'] * $c['open_interest'] * $mult * $s * $s * 0.01;
			$signed = ( 'call' === $c['type'] ) ? $mag : -$mag;
			if ( ! isset( $by[ $k ] ) ) {
				$by[ $k ] = array( 'strike' => $c['strike'], 'net' => 0.0, 'call_oi' => 0, 'put_oi' => 0 );
			}
			$by[ $k ]['net'] += $signed;
			if ( 'call' === $c['type'] ) {
				$by[ $k ]['call_oi'] += $c['open_interest'];
			} else {
				$by[ $k ]['put_oi'] += $c['open_interest'];
			}
		}
		if ( ! $by ) {
			return null;
		}
		usort( $by, function ( $a, $b ) {
			return $a['strike'] <=> $b['strike'];
		} );

		$net  = 0.0;
		$peak = null;
		foreach ( $by as $row ) {
			$net += $row['net'];
			if ( null === $peak || abs( $row['net'] ) > abs( $peak['net'] ) ) {
				$peak = $row;
			}
		}

		/* Approximate flip: where cumulative GEX crosses zero. The true level
		   requires repricing the chain at each candidate spot, so this is
		   labelled approximate everywhere it is shown. */
		$cum  = 0.0;
		$flip = null;
		foreach ( $by as $row ) {
			$prev = $cum;
			$cum += $row['net'];
			if ( ( $prev < 0 && $cum >= 0 ) || ( $prev > 0 && $cum <= 0 ) ) {
				$flip = $row['strike'];
				break;
			}
		}

		return array(
			'net'        => $net,
			'flip'       => $flip,
			'peak'       => $peak,
			'by_strike'  => array_slice( $by, 0, 40 ),
			'regime'     => $net >= 0 ? 'positive' : 'negative',
		);
	}

	/** 25-delta-ish proxy: IV of OTM puts vs OTM calls at comparable distance. */
	function sml_opt_iv_skew( $contracts, $underlying ) {
		$s = (float) $underlying;
		if ( $s <= 0 ) {
			return null;
		}
		$put_iv = array();
		$call_iv = array();
		foreach ( $contracts as $c ) {
			if ( $c['iv'] <= 0 ) {
				continue;
			}
			$dist = abs( $c['strike'] - $s ) / $s;
			if ( $dist < 0.02 || $dist > 0.12 ) {
				continue;
			}
			if ( 'put' === $c['type'] && $c['strike'] < $s ) {
				$put_iv[] = $c['iv'];
			} elseif ( 'call' === $c['type'] && $c['strike'] > $s ) {
				$call_iv[] = $c['iv'];
			}
		}
		if ( ! $put_iv || ! $call_iv ) {
			return null;
		}
		$p = array_sum( $put_iv ) / count( $put_iv );
		$c = array_sum( $call_iv ) / count( $call_iv );
		return array(
			'put_iv'  => $p,
			'call_iv' => $c,
			'skew'    => $p - $c,
			'bias'    => ( $p - $c ) > 0 ? 'downside' : 'upside',
		);
	}

	/** Contracts trading well above their own open interest. */
	function sml_opt_unusual( $contracts ) {
		$cfg = sml_opt_config();
		$hits = array();
		foreach ( $contracts as $c ) {
			$oi = max( 1, $c['open_interest'] );
			$ratio = $c['volume'] / $oi;
			if ( $c['volume'] < $cfg['min_volume'] || $ratio < $cfg['min_ratio'] ) {
				continue;
			}
			$mid = ( $c['bid'] + $c['ask'] ) / 2;
			$hits[] = array(
				'type'          => $c['type'],
				'strike'        => $c['strike'],
				'volume'        => $c['volume'],
				'open_interest' => $c['open_interest'],
				'ratio'         => $ratio,
				'premium'       => $mid * $c['volume'] * $cfg['multiplier'],
			);
		}
		usort( $hits, function ( $a, $b ) {
			return $b['premium'] <=> $a['premium'];
		} );
		return array_slice( $hits, 0, 10 );
	}

	/* =====================================================================
	 * INGEST
	 * ================================================================== */
	function sml_opt_snapshot( $symbol ) {
		$opt = sml_opt_config()['snap_opt'] . strtolower( $symbol );
		$s   = get_option( $opt, null );
		return is_array( $s ) ? $s : null;
	}

	function sml_opt_ingest( $symbol ) {
		$symbol = sml_opt_symbol( $symbol );
		if ( '' === $symbol ) {
			return false;
		}

		/* The chain route requires a logged-in user and cron has none, so the
		   request is dispatched in-process with capabilities borrowed for the
		   duration and restored immediately. No HTTP, no stored credential. */
		$previous = get_current_user_id();
		$admins   = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) );
		if ( ! empty( $admins[0] ) ) {
			wp_set_current_user( (int) $admins[0] );
		}

		$req = new WP_REST_Request( 'GET', '/sml-options-intelligence/v1/chain' );
		$req->set_param( 'symbol', $symbol );
		$res = rest_do_request( $req );

		wp_set_current_user( $previous );

		if ( is_wp_error( $res ) || $res->is_error() ) {
			sml_opt_note( $symbol, 'chain unavailable' );
			return false;
		}
		$chain = $res->get_data();
		if ( ! is_array( $chain ) ) {
			sml_opt_note( $symbol, 'chain not an array' );
			return false;
		}

		/* Never derive published numbers from a chain the upstream itself flags
		   as stale — the old snapshot, honestly dated, is better than a fresh
		   wrong one. */
		if ( ! empty( $chain['stale'] ) || ( isset( $chain['freshness'] ) && 'stale' === $chain['freshness'] ) ) {
			sml_opt_note( $symbol, 'upstream reports stale chain; keeping previous snapshot' );
			return false;
		}

		$contracts = sml_opt_decode( $chain );
		if ( count( $contracts ) < 10 ) {
			sml_opt_note( $symbol, 'chain too thin to analyse (' . count( $contracts ) . ')' );
			return false;
		}

		$underlying = isset( $chain['underlying'] ) ? (float) $chain['underlying'] : 0.0;

		$snap = array(
			'symbol'     => $symbol,
			'underlying' => $underlying,
			'expiration' => isset( $chain['expiration'] ) ? (string) $chain['expiration'] : '',
			'contracts'  => count( $contracts ),
			'max_pain'   => sml_opt_max_pain( $contracts ),
			'gex'        => sml_opt_gex( $contracts, $underlying ),
			'skew'       => sml_opt_iv_skew( $contracts, $underlying ),
			'unusual'    => sml_opt_unusual( $contracts ),
			'captured'   => gmdate( 'c' ),
		);

		update_option( sml_opt_config()['snap_opt'] . strtolower( $symbol ), $snap, false );
		sml_opt_note( $symbol, 'ok' );
		return true;
	}

	function sml_opt_note( $symbol, $msg ) {
		$cfg  = sml_opt_config();
		$meta = get_option( $cfg['meta_opt'], array() );
		if ( ! is_array( $meta ) ) {
			$meta = array();
		}
		$meta[ $symbol ] = array( 'at' => gmdate( 'c' ), 'msg' => (string) $msg );
		update_option( $cfg['meta_opt'], $meta, false );
	}

	add_filter( 'cron_schedules', function ( $s ) {
		$s['sml_opt_15min'] = array( 'interval' => 900, 'display' => 'SML Options (15 min)' );
		return $s;
	} );

	add_action( 'init', function () {
		if ( ! wp_next_scheduled( 'sml_opt_ingest_all' ) ) {
			wp_schedule_event( time() + 300, 'sml_opt_15min', 'sml_opt_ingest_all' );
		}
	} );

	add_action( 'sml_opt_ingest_all', function () {
		foreach ( sml_opt_config()['tickers'] as $sym ) {
			sml_opt_ingest( $sym );
			/* Spaced deliberately: the upstream provider rate-limits, and eight
			   back-to-back chain pulls is exactly how that gets triggered. */
			sleep( 2 );
		}
	} );

	/* =====================================================================
	 * ROUTING + RENDER  ->  /options/{TICKER}/
	 * ================================================================== */
	add_action( 'init', function () {
		add_rewrite_rule( '^options/([A-Za-z]{1,6})/?$', 'index.php?sml_opt_sym=$matches[1]', 'top' );
		add_rewrite_rule( '^options/?$', 'index.php?sml_opt_index=1', 'top' );
		add_rewrite_rule( '^options-sitemap\.xml$', 'index.php?sml_opt_sitemap=1', 'top' );
		/* Flushed once per rule revision. Flushing on every load is expensive
		   enough to be a self-inflicted outage. */
		if ( get_option( 'sml_opt_rules' ) !== 'v2' ) {
			flush_rewrite_rules( false );
			update_option( 'sml_opt_rules', 'v2', false );
		}
	}, 5 );

	add_filter( 'query_vars', function ( $v ) {
		$v[] = 'sml_opt_sym';
		$v[] = 'sml_opt_index';
		$v[] = 'sml_opt_sitemap';
		return $v;
	} );

	function sml_opt_money( $n, $dp = 2 ) {
		return number_format( (float) $n, $dp );
	}

	function sml_opt_big( $n ) {
		$a    = abs( (float) $n );
		$sign = $n < 0 ? '-' : '';
		if ( $a >= 1e9 ) {
			return $sign . number_format( $a / 1e9, 2 ) . 'B';
		}
		if ( $a >= 1e6 ) {
			return $sign . number_format( $a / 1e6, 1 ) . 'M';
		}
		if ( $a >= 1e3 ) {
			return $sign . number_format( $a / 1e3, 1 ) . 'K';
		}
		return $sign . number_format( $a, 0 );
	}

	function sml_opt_age_label( $iso ) {
		$t = strtotime( (string) $iso );
		if ( ! $t ) {
			return 'unknown';
		}
		$d = time() - $t;
		if ( $d < 3600 ) {
			return max( 1, (int) ( $d / 60 ) ) . ' minutes ago';
		}
		if ( $d < 86400 ) {
			return (int) ( $d / 3600 ) . ' hours ago';
		}
		return (int) ( $d / 86400 ) . ' days ago';
	}

	function sml_opt_css() {
		return 'body{margin:0;background:#080d15;color:#E6EDF5;font:15px/1.55 Inter,system-ui,sans-serif}'
			. '.w{max-width:900px;margin:0 auto;padding:28px 18px 70px}'
			. 'h1{font-size:26px;margin:0 0 4px}'
			. 'h2{font-size:13px;margin:30px 0 10px;letter-spacing:.1em;text-transform:uppercase;color:#8fa3b5}'
			. '.sub{color:#7E8A96;font-size:13px;margin:0 0 22px}'
			. '.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}'
			. '.c{background:#0d1520;border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:14px 16px}'
			. '.k{font:600 10px/1 "IBM Plex Mono",monospace;letter-spacing:.1em;text-transform:uppercase;color:#7E8A96}'
			. '.v{font:700 24px/1.2 "IBM Plex Mono",monospace;margin-top:7px}'
			. '.pos{color:#38F58A}.neg{color:#F2495C}'
			. 'table{width:100%;border-collapse:collapse;margin-top:8px;font:13px/1.5 "IBM Plex Mono",monospace}'
			. 'th,td{text-align:right;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.07)}'
			. 'th:first-child,td:first-child{text-align:left}'
			. 'th{color:#7E8A96;font-weight:600;font-size:11px;text-transform:uppercase}'
			. 'a{color:#7ae6ff}.note{color:#8fa3b5;font-size:12.5px;line-height:1.65}'
			. '.stale{background:#2a1b12;border:1px solid #7a4a1f;color:#ffcf9e;padding:11px 14px;border-radius:10px;margin:0 0 20px;font-size:13px}';
	}

	function sml_opt_render( $symbol ) {
		$snap = sml_opt_snapshot( $symbol );
		$cfg  = sml_opt_config();
		$url  = home_url( '/options/' . strtolower( $symbol ) . '/' );

		$title = $symbol . ' Options: Max Pain, Gamma Exposure and Unusual Activity';
		if ( $snap && ! empty( $snap['max_pain']['strike'] ) ) {
			$desc = sprintf(
				'%s max pain %s, net gamma exposure %s (%s regime). Free options positioning data with the methodology stated.',
				$symbol,
				sml_opt_money( $snap['max_pain']['strike'] ),
				sml_opt_big( isset( $snap['gex']['net'] ) ? $snap['gex']['net'] : 0 ),
				isset( $snap['gex']['regime'] ) ? $snap['gex']['regime'] : 'unknown'
			);
		} else {
			$desc = sprintf( '%s options positioning: max pain, gamma exposure, IV skew and unusual activity.', $symbol );
		}

		status_header( 200 );
		header( 'Content-Type: text/html; charset=utf-8' );
		header( 'Cache-Control: public, max-age=300' );

		echo '<!doctype html><html lang="en"><head><meta charset="utf-8">';
		echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
		echo '<title>' . esc_html( $title ) . ' | Stock Market Loop</title>';
		echo '<meta name="description" content="' . esc_attr( $desc ) . '">';
		echo '<link rel="canonical" href="' . esc_url( $url ) . '">';
		echo '<meta property="og:type" content="website">';
		echo '<meta property="og:title" content="' . esc_attr( $title ) . '">';
		echo '<meta property="og:description" content="' . esc_attr( $desc ) . '">';
		echo '<meta property="og:url" content="' . esc_url( $url ) . '">';
		echo '<meta property="og:site_name" content="Stock Market Loop">';
		echo '<meta name="twitter:card" content="summary_large_image">';
		echo '<meta name="twitter:title" content="' . esc_attr( $title ) . '">';
		echo '<meta name="twitter:description" content="' . esc_attr( $desc ) . '">';

		if ( $snap ) {
			/* Dataset, not Article. This page IS the data, and Dataset is the type
			   that makes it eligible to be surfaced and cited as a source. */
			$ld = array(
				'@context'            => 'https://schema.org',
				'@type'               => 'Dataset',
				'name'                => $symbol . ' options positioning',
				'description'         => $desc,
				'url'                 => $url,
				'dateModified'        => $snap['captured'],
				'isAccessibleForFree' => true,
				'license'             => 'https://creativecommons.org/licenses/by/4.0/',
				'creator'             => array(
					'@type' => 'Organization',
					'name'  => 'Stock Market Loop',
					'url'   => home_url( '/' ),
				),
				'variableMeasured'    => array( 'max pain', 'net gamma exposure', 'gamma flip', 'IV skew', 'unusual options activity' ),
			);
			echo '<script type="application/ld+json">' . wp_json_encode( $ld, JSON_UNESCAPED_SLASHES ) . '</script>';
		}

		echo '<style>' . sml_opt_css() . '</style></head><body><div class="w">';
		echo '<h1>$' . esc_html( $symbol ) . ' Options Positioning</h1>';

		if ( ! $snap ) {
			echo '<p class="sub">No snapshot has been captured for this ticker yet. Chains are pulled during market hours.</p>';
			echo '<p><a href="' . esc_url( home_url( '/options/' ) ) . '">All options pages</a></p>';
			echo '</div></body></html>';
			return;
		}

		echo '<p class="sub">Underlying $' . esc_html( sml_opt_money( $snap['underlying'] ) )
			. ' &middot; expiration ' . esc_html( $snap['expiration'] )
			. ' &middot; ' . (int) $snap['contracts'] . ' contracts &middot; as of '
			. esc_html( sml_opt_age_label( $snap['captured'] ) ) . '</p>';

		if ( ( time() - strtotime( $snap['captured'] ) ) > $cfg['max_age'] ) {
			echo '<p class="stale">This snapshot is more than 48 hours old. Treat these levels as historical, not current.</p>';
		}

		$gex = isset( $snap['gex'] ) && is_array( $snap['gex'] ) ? $snap['gex'] : array();
		$mp  = isset( $snap['max_pain'] ) && is_array( $snap['max_pain'] ) ? $snap['max_pain'] : array();
		$net = isset( $gex['net'] ) ? $gex['net'] : 0;

		echo '<div class="g">';
		echo '<div class="c"><div class="k">Max pain</div><div class="v">$'
			. esc_html( sml_opt_money( isset( $mp['strike'] ) ? $mp['strike'] : 0 ) ) . '</div></div>';
		echo '<div class="c"><div class="k">Net gamma exposure</div><div class="v ' . ( $net >= 0 ? 'pos' : 'neg' ) . '">'
			. esc_html( sml_opt_big( $net ) ) . '</div></div>';
		echo '<div class="c"><div class="k">Gamma flip (approx)</div><div class="v">'
			. ( isset( $gex['flip'] ) && null !== $gex['flip'] ? '$' . esc_html( sml_opt_money( $gex['flip'] ) ) : '&mdash;' )
			. '</div></div>';
		echo '<div class="c"><div class="k">Peak gamma strike</div><div class="v">$'
			. esc_html( sml_opt_money( isset( $gex['peak']['strike'] ) ? $gex['peak']['strike'] : 0 ) ) . '</div></div>';
		if ( ! empty( $snap['skew'] ) ) {
			echo '<div class="c"><div class="k">IV skew (' . esc_html( $snap['skew']['bias'] ) . ')</div><div class="v">'
				. esc_html( number_format( $snap['skew']['skew'] * 100, 1 ) ) . ' pts</div></div>';
		}
		echo '</div>';

		if ( ! empty( $snap['unusual'] ) ) {
			echo '<h2>Unusual activity</h2><table><thead><tr><th>Contract</th><th>Volume</th>'
				. '<th>Open interest</th><th>Vol/OI</th><th>Premium</th></tr></thead><tbody>';
			foreach ( $snap['unusual'] as $u ) {
				echo '<tr><td>' . esc_html( strtoupper( $u['type'] ) ) . ' $' . esc_html( sml_opt_money( $u['strike'] ) ) . '</td>'
					. '<td>' . esc_html( number_format( $u['volume'] ) ) . '</td>'
					. '<td>' . esc_html( number_format( $u['open_interest'] ) ) . '</td>'
					. '<td>' . esc_html( number_format( $u['ratio'], 1 ) ) . 'x</td>'
					. '<td>$' . esc_html( sml_opt_big( $u['premium'] ) ) . '</td></tr>';
			}
			echo '</tbody></table>';
		}

		echo '<h2>Methodology</h2><p class="note">'
			. '<strong>Max pain</strong> is the strike at which the total intrinsic value of all open contracts is lowest. '
			. '<strong>Gamma exposure</strong> is computed per strike as gamma &times; open interest &times; 100 &times; spot&sup2; &times; 0.01, '
			. 'then summed across the chain. <strong>Dealers are assumed short calls and long puts</strong>, so call gamma is positive '
			. 'and put gamma negative &mdash; there is no universal convention, and the opposite assumption inverts every figure above. '
			. 'The <strong>gamma flip is approximate</strong>: it is the strike where cumulative exposure crosses zero, not a repriced level. '
			. '<strong>IV skew</strong> compares average implied volatility of out-of-the-money puts against calls 2&ndash;12% from spot. '
			. '<strong>Unusual activity</strong> lists contracts trading at least ' . (int) $cfg['min_volume'] . ' lots and at least '
			. esc_html( $cfg['min_ratio'] ) . '&times; their own open interest. '
			. 'Figures derive from a single expiration chain, are provided free for reference and citation, and are not investment advice.</p>';

		echo '<h2>More</h2><p><a href="' . esc_url( home_url( '/stock-chart/?symbol=' . rawurlencode( $symbol ) ) ) . '">$'
			. esc_html( $symbol ) . ' chart, quotes and news</a> &middot; <a href="'
			. esc_url( home_url( '/options/' ) ) . '">all options pages</a></p>';

		echo '</div></body></html>';
	}

	function sml_opt_render_index() {
		status_header( 200 );
		header( 'Content-Type: text/html; charset=utf-8' );
		header( 'Cache-Control: public, max-age=600' );
		$url = home_url( '/options/' );
		echo '<!doctype html><html lang="en"><head><meta charset="utf-8">';
		echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
		echo '<title>Options Positioning Data | Stock Market Loop</title>';
		echo '<meta name="description" content="Free options positioning data: max pain, gamma exposure, IV skew and unusual activity, with the methodology stated.">';
		echo '<link rel="canonical" href="' . esc_url( $url ) . '">';
		echo '<style>' . sml_opt_css() . 'li{margin:8px 0}a{text-decoration:none}</style>';
		echo '</head><body><div class="w"><h1>Options positioning</h1>';
		echo '<p class="sub">Max pain, gamma exposure, IV skew and unusual activity &mdash; free, with the methodology stated.</p><ul>';
		foreach ( sml_opt_config()['tickers'] as $sym ) {
			echo '<li><a href="' . esc_url( home_url( '/options/' . strtolower( $sym ) . '/' ) ) . '">$'
				. esc_html( $sym ) . ' options</a></li>';
		}
		echo '</ul></div></body></html>';
	}

	add_action( 'template_redirect', function () {
		if ( get_query_var( 'sml_opt_sitemap' ) ) {
			status_header( 200 );
			header( 'Content-Type: application/xml; charset=utf-8' );
			echo '<?xml version="1.0" encoding="UTF-8"?>';
			echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
			echo '<url><loc>' . esc_url( home_url( '/options/' ) ) . '</loc><changefreq>daily</changefreq><priority>0.6</priority></url>';
			foreach ( sml_opt_config()['tickers'] as $sym ) {
				$snap = sml_opt_snapshot( $sym );
				echo '<url><loc>' . esc_url( home_url( '/options/' . strtolower( $sym ) . '/' ) ) . '</loc>';
				if ( $snap && ! empty( $snap['captured'] ) ) {
					echo '<lastmod>' . esc_html( gmdate( 'Y-m-d', strtotime( $snap['captured'] ) ) ) . '</lastmod>';
				}
				echo '<changefreq>daily</changefreq><priority>0.7</priority></url>';
			}
			echo '</urlset>';
			exit;
		}

		if ( get_query_var( 'sml_opt_index' ) ) {
			sml_opt_render_index();
			exit;
		}

		$sym = sml_opt_symbol( get_query_var( 'sml_opt_sym' ) );
		if ( '' === $sym ) {
			return;
		}
		/* Only the launch set renders. An unknown ticker must 404 rather than
		   generate a thin empty page - thin auto-generated pages are exactly
		   what put 1.9k URLs into "crawled, not indexed" in the first place. */
		if ( ! sml_opt_is_launch( $sym ) ) {
			/* A bare status_header leaves WordPress rendering a 200-shaped body.
			   set_404() makes it a real not-found for crawlers. */
			global $wp_query;
			$wp_query->set_404();
			status_header( 404 );
			nocache_headers();
			return;
		}
		sml_opt_render( $sym );
		exit;
	}, 0 );

}
