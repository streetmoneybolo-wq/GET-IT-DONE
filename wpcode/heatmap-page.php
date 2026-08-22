/**
 * SML Heat Map — dedicated page at /heat-map/ (the indexable home).
 *
 * Server-renders the full map from the sml_hm_snapshot option (written by the
 * heatmap-data snippet's 2-min cron): real tiles, real percentages, and ~290
 * links into /stocks/{ticker}/ entity pages — a complete page for crawlers
 * with ZERO JavaScript required. The live rotating module
 * (js/terminal-heatmap.js) hydrates on top for humans and hides the static
 * grid only after real data has painted; if it fails, the SSR content stays.
 *
 * FAIL-CLOSED SEO: the page serves robots "noindex,follow" (and drops out of
 * the hub sitemap) whenever the snapshot is missing or older than 2 hours —
 * a stale or empty map is never presented to crawlers as fresh content. The
 * AI-readable summary, JSON-LD values, and every tile figure are computed
 * from the stored real data; nothing is invented.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * Depends on wpcode/heatmap-data.php (snippet #7300) for the data option.
 * ROLLBACK: deactivate — /heat-map/ 404s again; nothing stateful.
 */
if ( ! function_exists( 'sml_hmp_taxonomy' ) ) {

	function sml_hmp_taxonomy() {
		return array(
			'Semiconductors' => 'NVDA|NVIDIA,AVGO|Broadcom,AMD|AMD,TSM|TSMC,QCOM|Qualcomm',
			'Software - Application' => 'CRM|Salesforce,ADBE|Adobe,INTU|Intuit,NOW|ServiceNow,SAP|SAP SE',
			'Software - Infrastructure' => 'MSFT|Microsoft,ORCL|Oracle,PLTR|Palantir,SNOW|Snowflake,MDB|MongoDB',
			'Cybersecurity' => 'PANW|Palo Alto Networks,CRWD|CrowdStrike,ZS|Zscaler,FTNT|Fortinet,OKTA|Okta',
			'Consumer Electronics' => 'AAPL|Apple,SONY|Sony,DELL|Dell,HPQ|HP Inc,GRMN|Garmin',
			'Internet Content' => 'GOOGL|Alphabet,META|Meta Platforms,SPOT|Spotify,PINS|Pinterest,RDDT|Reddit',
			'IT Services' => 'ACN|Accenture,IBM|IBM,INFY|Infosys,CTSH|Cognizant,WIT|Wipro',
			'Communication Equipment' => 'CSCO|Cisco,ANET|Arista Networks,ERIC|Ericsson,NOK|Nokia,UI|Ubiquiti',
			'Banks - Diversified' => 'JPM|JPMorgan Chase,BAC|Bank of America,WFC|Wells Fargo,C|Citigroup,HSBC|HSBC',
			'Banks - Regional' => 'USB|US Bancorp,PNC|PNC Financial,TFC|Truist,FITB|Fifth Third,RF|Regions Financial',
			'Credit Services' => 'V|Visa,MA|Mastercard,AXP|American Express,COF|Capital One,DFS|Discover',
			'Insurance' => 'BRK.B|Berkshire Hathaway,PGR|Progressive,CB|Chubb,MET|MetLife,AIG|AIG',
			'Asset Management' => 'BLK|BlackRock,BX|Blackstone,KKR|KKR,APO|Apollo Global,TROW|T Rowe Price',
			'Capital Markets' => 'GS|Goldman Sachs,MS|Morgan Stanley,SCHW|Charles Schwab,IBKR|Interactive Brokers,HOOD|Robinhood',
			'Fintech' => 'PYPL|PayPal,XYZ|Block,COIN|Coinbase,SOFI|SoFi,AFRM|Affirm',
			'Drug Manufacturers' => 'LLY|Eli Lilly,NVO|Novo Nordisk,PFE|Pfizer,MRK|Merck,ABBV|AbbVie',
			'Biotechnology' => 'AMGN|Amgen,VRTX|Vertex,REGN|Regeneron,GILD|Gilead,MRNA|Moderna',
			'Medical Devices' => 'ABT|Abbott Labs,MDT|Medtronic,SYK|Stryker,BSX|Boston Scientific,ISRG|Intuitive Surgical',
			'Healthcare Plans' => 'UNH|UnitedHealth,ELV|Elevance,CI|Cigna,CVS|CVS Health,HUM|Humana',
			'Diagnostics & Research' => 'TMO|Thermo Fisher,DHR|Danaher,A|Agilent,IQV|IQVIA,LH|Labcorp',
			'Oil & Gas Integrated' => 'XOM|Exxon Mobil,CVX|Chevron,SHEL|Shell,BP|BP,TTE|TotalEnergies',
			'Oil & Gas E&P' => 'COP|ConocoPhillips,EOG|EOG Resources,OXY|Occidental,DVN|Devon Energy,FANG|Diamondback',
			'Oil & Gas Midstream' => 'KMI|Kinder Morgan,WMB|Williams,ET|Energy Transfer,OKE|ONEOK,TRP|TC Energy',
			'Oilfield Services' => 'SLB|SLB,HAL|Halliburton,BKR|Baker Hughes,FTI|TechnipFMC,WHD|Cactus',
			'Renewable Energy' => 'FSLR|First Solar,ENPH|Enphase,RUN|Sunrun,BE|Bloom Energy,NXT|Nextracker',
			'Coal' => 'BTU|Peabody Energy,CEIX|CONSOL Energy,AMR|Alpha Metallurgical,HCC|Warrior Met,ARLP|Alliance Resource',
			'Aerospace & Defense' => 'GE|GE Aerospace,RTX|RTX Corp,LMT|Lockheed Martin,BA|Boeing,NOC|Northrop Grumman',
			'Airlines' => 'DAL|Delta Air Lines,UAL|United Airlines,LUV|Southwest,AAL|American Airlines,ALK|Alaska Air',
			'Railroads' => 'UNP|Union Pacific,CSX|CSX,NSC|Norfolk Southern,CP|Canadian Pacific,CNI|Canadian National',
			'Freight & Logistics' => 'UPS|UPS,FDX|FedEx,ODFL|Old Dominion,XPO|XPO,JBHT|JB Hunt',
			'Farm & Heavy Machinery' => 'CAT|Caterpillar,DE|John Deere,CNH|CNH Industrial,AGCO|AGCO,PCAR|Paccar',
			'Industrial Conglomerates' => 'HON|Honeywell,MMM|3M,ITW|Illinois Tool Works,PH|Parker Hannifin,DOV|Dover',
			'Electrical Equipment' => 'ETN|Eaton,EMR|Emerson,ROK|Rockwell,HUBB|Hubbell,GNRC|Generac',
			'Auto Manufacturers' => 'TSLA|Tesla,TM|Toyota,F|Ford,GM|General Motors,RIVN|Rivian',
			'Auto Components' => 'APTV|Aptiv,MGA|Magna,BWA|BorgWarner,LEA|Lear,GNTX|Gentex',
			'Internet Retail' => 'AMZN|Amazon,BABA|Alibaba,MELI|MercadoLibre,PDD|PDD Holdings,SHOP|Shopify',
			'Discount Stores' => 'WMT|Walmart,COST|Costco,TGT|Target,DG|Dollar General,DLTR|Dollar Tree',
			'Restaurants' => 'MCD|McDonald\'s,SBUX|Starbucks,CMG|Chipotle,YUM|Yum Brands,DRI|Darden',
			'Apparel & Luxury' => 'NKE|Nike,LULU|Lululemon,RL|Ralph Lauren,DECK|Deckers,TPR|Tapestry',
			'Travel & Lodging' => 'BKNG|Booking Holdings,MAR|Marriott,HLT|Hilton,RCL|Royal Caribbean,ABNB|Airbnb',
			'Home Improvement' => 'HD|Home Depot,LOW|Lowe\'s,TSCO|Tractor Supply,BLDR|Builders FirstSource,WSM|Williams-Sonoma',
			'Beverages' => 'KO|Coca-Cola,PEP|PepsiCo,MNST|Monster,KDP|Keurig Dr Pepper,STZ|Constellation',
			'Food Products' => 'MDLZ|Mondelez,GIS|General Mills,HSY|Hershey,KHC|Kraft Heinz,CAG|Conagra',
			'Household Products' => 'PG|Procter & Gamble,CL|Colgate-Palmolive,KMB|Kimberly-Clark,CHD|Church & Dwight,CLX|Clorox',
			'Tobacco' => 'PM|Philip Morris,MO|Altria,BTI|British American,UVV|Universal,TPB|Turning Point',
			'Food Distribution' => 'KR|Kroger,ACI|Albertsons,SYY|Sysco,USFD|US Foods,SFM|Sprouts',
			'Telecom Services' => 'TMUS|T-Mobile,VZ|Verizon,T|AT&T,CHTR|Charter,CMCSA|Comcast',
			'Entertainment' => 'NFLX|Netflix,DIS|Disney,WBD|Warner Bros Discovery,LYV|Live Nation,PARA|Paramount',
			'Gaming' => 'EA|Electronic Arts,TTWO|Take-Two,RBLX|Roblox,U|Unity,NTES|NetEase',
			'Advertising' => 'TTD|Trade Desk,APP|AppLovin,OMC|Omnicom,IPG|Interpublic,DV|DoubleVerify',
			'Utilities - Electric' => 'NEE|NextEra Energy,SO|Southern Company,DUK|Duke Energy,D|Dominion,AEP|American Electric',
			'Utilities - Gas & Water' => 'AWK|American Water,WTRG|Essential Utilities,ATO|Atmos Energy,NI|NiSource,SRE|Sempra',
			'REIT - Industrial & Data' => 'PLD|Prologis,AMT|American Tower,EQIX|Equinix,DLR|Digital Realty,PSA|Public Storage',
			'REIT - Retail & Residential' => 'SPG|Simon Property,O|Realty Income,AVB|AvalonBay,EQR|Equity Residential,VICI|VICI Properties',
			'Chemicals' => 'LIN|Linde,SHW|Sherwin-Williams,APD|Air Products,ECL|Ecolab,DD|DuPont',
			'Metals & Mining' => 'BHP|BHP Group,RIO|Rio Tinto,FCX|Freeport-McMoRan,NUE|Nucor,VALE|Vale',
			'Gold' => 'NEM|Newmont,GOLD|Barrick,AEM|Agnico Eagle,KGC|Kinross,WPM|Wheaton',
			'Paper & Packaging' => 'IP|International Paper,PKG|Packaging Corp,SW|Smurfit Westrock,BALL|Ball Corp,AMCR|Amcor',
		);
	}

	function sml_hmp_esc( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES, 'UTF-8' ); }

	function sml_hmp_render() {
		$snap  = get_option( 'sml_hm_snapshot', array() );
		$q     = ( is_array( $snap ) && isset( $snap['quotes'] ) && is_array( $snap['quotes'] ) ) ? $snap['quotes'] : array();
		$gen   = isset( $snap['generated'] ) ? (int) $snap['generated'] : 0;
		$fresh = count( $q ) >= 20 && $gen && ( time() - $gen ) < 2 * HOUR_IN_SECONDS;
		$robots = $fresh ? 'index, follow, max-image-preview:large' : 'noindex, follow';
		$url    = home_url( '/heat-map/' );

		$sectors = array(); $movers = array();
		foreach ( sml_hmp_taxonomy() as $sector => $list ) {
			$rows = array();
			foreach ( explode( ',', $list ) as $ent ) {
				$p = explode( '|', $ent );
				if ( isset( $q[ $p[0] ]['chgPct'] ) && null !== $q[ $p[0] ]['chgPct'] ) {
					$r = $q[ $p[0] ]; $r['name'] = $p[1];
					$rows[] = $r; $movers[] = $r;
				}
			}
			if ( $rows ) {
				usort( $rows, static function ( $a, $b ) { return $b['chgPct'] <=> $a['chgPct']; } );
				$avg = array_sum( array_map( static function ( $r ) { return (float) $r['chgPct']; }, $rows ) ) / count( $rows );
				$sectors[] = array( 'sector' => $sector, 'avg' => $avg, 'rows' => $rows );
			}
		}
		usort( $sectors, static function ( $a, $b ) { return $b['avg'] <=> $a['avg']; } );
		usort( $movers, static function ( $a, $b ) { return $b['chgPct'] <=> $a['chgPct']; } );
		$asof = $gen ? wp_date( 'F j, Y g:ia T', $gen ) : '';

		$sum = '';
		if ( $fresh && $sectors && $movers ) {
			$s0 = $sectors[0]; $sl = $sectors[ count( $sectors ) - 1 ];
			$g  = $movers[0];  $l  = $movers[ count( $movers ) - 1 ];
			$sum = 'As of ' . $asof . ', the strongest industry group is ' . $s0['sector'] . ' (' . sprintf( '%+.2f', $s0['avg'] ) . '% average move) and the weakest is ' . $sl['sector'] . ' (' . sprintf( '%+.2f', $sl['avg'] ) . '%). Among the ' . count( $movers ) . ' large-cap stocks tracked, the biggest gainer is ' . $g['sym'] . ' (' . $g['name'] . ') at ' . sprintf( '%+.2f', $g['chgPct'] ) . '% and the biggest decliner is ' . $l['sym'] . ' (' . $l['name'] . ') at ' . sprintf( '%+.2f', $l['chgPct'] ) . '%. Quotes are delayed.';
		}

		$ld   = array();
		$ld[] = array(
			'@context' => 'https://schema.org', '@type' => 'BreadcrumbList',
			'itemListElement' => array(
				array( '@type' => 'ListItem', 'position' => 1, 'name' => 'Markets', 'item' => home_url( '/markets/' ) ),
				array( '@type' => 'ListItem', 'position' => 2, 'name' => 'Heat Map', 'item' => $url ),
			),
		);
		if ( $fresh ) {
			$items = array(); $pos = 1;
			foreach ( array_slice( $movers, 0, 10 ) as $m ) {
				$items[] = array(
					'@type' => 'ListItem', 'position' => $pos++,
					'name'  => $m['sym'] . ' (' . $m['name'] . ') ' . sprintf( '%+.2f', $m['chgPct'] ) . '%',
					'url'   => home_url( '/stocks/' . strtolower( $m['sym'] ) . '/' ),
				);
			}
			$ld[] = array( '@context' => 'https://schema.org', '@type' => 'ItemList', 'name' => 'Top performers right now', 'dateModified' => gmdate( 'c', $gen ), 'itemListElement' => $items );
		}

		$ref  = function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main';
		$desc = $fresh ? ( 'Live sector heat map of ' . count( $movers ) . ' large-cap US stocks across 58 industries: leaders, laggards, and full market rotation. Delayed quotes, updated every few minutes.' ) : 'Stock market sector heat map.';

		$h  = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
		$h .= '<title>Stock Market Heat Map — Sector Leaders &amp; Laggards | StockMarketLoop</title>';
		$h .= '<meta name="description" content="' . sml_hmp_esc( $desc ) . '">';
		$h .= '<meta name="robots" content="' . $robots . '">';
		$h .= '<link rel="canonical" href="' . sml_hmp_esc( $url ) . '">';
		$h .= '<meta property="og:title" content="Stock Market Heat Map | StockMarketLoop"><meta property="og:description" content="' . sml_hmp_esc( $desc ) . '"><meta property="og:url" content="' . sml_hmp_esc( $url ) . '"><meta property="og:type" content="website">';
		foreach ( $ld as $blob ) { $h .= '<script type="application/ld+json">' . wp_json_encode( $blob ) . '</script>'; }
		$h .= '<style>body{margin:0;background:#05080a;color:#e6f2ea;font-family:-apple-system,"IBM Plex Sans","Segoe UI",sans-serif}a{color:inherit;text-decoration:none}.wrap{max-width:1200px;margin:0 auto;padding:26px 18px 60px}h1{font-size:30px;margin:0 0 6px}.sub{color:#8fa89b;font-size:13px;margin-bottom:14px}.sumy{background:#0a1210;border:1px solid #1c2b23;border-radius:12px;padding:14px 18px;font-size:15px;line-height:1.6;margin-bottom:22px}.sec{margin:26px 0 8px;font-size:17px;border-left:3px solid #00ff88;padding-left:10px}.sec small{color:#8fa89b;font-weight:400;margin-left:8px}.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}.t{display:block;background:#0a1210;border:1px solid #1c2b23;border-radius:10px;padding:11px 13px}.t b{font-size:17px;letter-spacing:1px}.t span{display:block;font-size:11px;color:#8fa89b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.t em{font-style:normal;font-weight:700;float:right;font-size:15px}.t i{display:block;font-style:normal;font-size:10px;color:#5c7a6b;margin-top:4px}.up em{color:#00ff88}.down em{color:#ff4d5e}.t:hover{border-color:#00ff88}.foot{margin-top:34px;color:#5c7a6b;font-size:12px}.foot a{color:#8fa89b;text-decoration:underline}</style></head><body>';
		$h .= '<div class="wrap"><h1>Stock Market Heat Map</h1><div class="sub">Sector leaders &amp; laggards · 58 industries · delayed quotes' . ( $asof ? ' · as of ' . sml_hmp_esc( $asof ) : '' ) . '</div>';
		if ( $sum ) { $h .= '<section class="sumy" id="sml-hm-summary">' . sml_hmp_esc( $sum ) . '</section>'; }
		$h .= '<div id="sml-hm-standalone"></div>';
		$h .= '<div id="sml-hm-ssr">';
		if ( $fresh ) {
			foreach ( $sectors as $sec ) {
				$h .= '<h2 class="sec">' . sml_hmp_esc( $sec['sector'] ) . '<small>' . sprintf( '%+.2f', $sec['avg'] ) . '% avg</small></h2><div class="tiles">';
				foreach ( $sec['rows'] as $r ) {
					$cls = ( (float) $r['chgPct'] >= 0 ) ? 'up' : 'down';
					$h  .= '<a class="t ' . $cls . '" href="' . sml_hmp_esc( home_url( '/stocks/' . strtolower( $r['sym'] ) . '/' ) ) . '"><b>' . sml_hmp_esc( $r['sym'] ) . '</b><em>' . sprintf( '%+.2f', $r['chgPct'] ) . '%</em><span>' . sml_hmp_esc( $r['name'] ) . '</span>';
					$h  .= ( isset( $r['pc'] ) && null !== $r['pc'] ) ? '<i>prev close $' . number_format( (float) $r['pc'], 2 ) . '</i>' : '';
					$h  .= '</a>';
				}
				$h .= '</div>';
			}
		} else {
			$h .= '<p>Market data for the heat map is being refreshed — check back in a few minutes.</p>';
		}
		$h .= '</div>';
		$h .= '<div class="foot">Data is delayed and provided for information only — not investment advice. See the full <a href="' . sml_hmp_esc( home_url( '/stock-chart/' ) ) . '">Ticker Terminal</a> or <a href="' . sml_hmp_esc( home_url( '/markets/' ) ) . '">Markets</a>.</div></div>';
		$h .= '<script defer src="https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . sml_hmp_esc( $ref ) . '/js/terminal-heatmap.js"></script>';
		$h .= '</body></html>';
		return $h;
	}

	add_action( 'init', static function () {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		if ( '/' === $path || '/heat-map/' !== rtrim( $path, '/' ) . '/' ) { return; }
		if ( is_admin() || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) || false !== strpos( $uri, '/wp-json/' ) ) { return; }
		add_action( 'template_redirect', static function () {
			global $wp_query;
			if ( $wp_query ) { $wp_query->is_404 = false; }
			status_header( 200 );
			header( 'Content-Type: text/html; charset=UTF-8' );
			echo sml_hmp_render(); // phpcs:ignore
			exit;
		}, 0 );
	}, 1 );
}
