/**
 * SML Heat Map — /heat-map/ page: the MARKET COMMAND CENTER.
 *
 * Renders the owner's Market Command Center design 1:1 as the heat map's
 * dedicated page — header with live clock, mood gauge, breadth, sector
 * rotation quadrant, the sector treemap hero, global strip, gainers/losers,
 * volume leaders, watchlist, live wire — ALL server-rendered from the
 * sml_hm_snapshot blob (written by the heatmap-data snippet's cron), plus a
 * full 58-industry breakdown with ~290 links into /stocks/{ticker}/ entity
 * pages underneath. Crawlers get everything with zero JavaScript (the only
 * script is the clock).
 *
 * HONESTY ADAPTATIONS from the design mock (its figures were sample):
 *  - every number is computed from the real snapshot; sections the data
 *    can't back were RELABELED, not faked: the gauge is "MARKET MOOD · SML"
 *    (a transparent breadth+momentum composite, formula in code), breadth is
 *    "TRACKED xxx" (our universe, not NYSE), day-high/low counts replace
 *    new-52w-highs/lows, index chips show real SPY/QQQ/DIA ETF quotes, the
 *    global strip shows real ETF proxies (EWJ/FXI/EWU/EWG/GLD/USO/IBIT),
 *    volatility is real VIXY, the treemap's tile sizes are a fixed editorial
 *    layout (the "index weight" claim is gone), and LIVE WIRE lines are
 *    generated from the snapshot's own facts, timestamped to it.
 *  - the terminal's rotating heat map module is untouched by this page.
 *
 * FAIL-CLOSED SEO: snapshot missing or older than 2 hours -> noindex AND the
 * URL drops from the hub sitemap (see seo-sitemaps), so signals always agree.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * Depends on the heatmap-data snippet (#7300) for the data option.
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

	/** 58 design industries -> the command center's 11 sector buckets */
	function sml_hmp_sector_of( $industry ) {
		static $map = null;
		if ( null === $map ) {
			$map = array(
				'TECHNOLOGY'  => array( 'Semiconductors', 'Software - Application', 'Software - Infrastructure', 'Cybersecurity', 'Consumer Electronics', 'IT Services', 'Communication Equipment' ),
				'COMM SVCS'   => array( 'Internet Content', 'Telecom Services', 'Entertainment', 'Gaming', 'Advertising' ),
				'FINANCIALS'  => array( 'Banks - Diversified', 'Banks - Regional', 'Credit Services', 'Insurance', 'Asset Management', 'Capital Markets', 'Fintech' ),
				'HEALTH CARE' => array( 'Drug Manufacturers', 'Biotechnology', 'Medical Devices', 'Healthcare Plans', 'Diagnostics & Research' ),
				'ENERGY'      => array( 'Oil & Gas Integrated', 'Oil & Gas E&P', 'Oil & Gas Midstream', 'Oilfield Services', 'Renewable Energy', 'Coal' ),
				'INDUSTRIALS' => array( 'Aerospace & Defense', 'Airlines', 'Railroads', 'Freight & Logistics', 'Farm & Heavy Machinery', 'Industrial Conglomerates', 'Electrical Equipment' ),
				'CONS DISC'   => array( 'Auto Manufacturers', 'Auto Components', 'Internet Retail', 'Restaurants', 'Apparel & Luxury', 'Travel & Lodging', 'Home Improvement' ),
				'STAPLES'     => array( 'Discount Stores', 'Beverages', 'Food Products', 'Household Products', 'Tobacco', 'Food Distribution' ),
				'UTIL'        => array( 'Utilities - Electric', 'Utilities - Gas & Water' ),
				'REIT'        => array( 'REIT - Industrial & Data', 'REIT - Retail & Residential' ),
				'MATL'        => array( 'Chemicals', 'Metals & Mining', 'Gold', 'Paper & Packaging' ),
			);
		}
		foreach ( $map as $sector => $inds ) { if ( in_array( $industry, $inds, true ) ) { return $sector; } }
		return 'TECHNOLOGY';
	}

	function sml_hmp_esc( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES, 'UTF-8' ); }
	function sml_hmp_pct( $p ) { return sprintf( '%+.2f%%', (float) $p ); }
	function sml_hmp_col( $p ) { $p = (float) $p; return $p >= 0.5 ? '#00ff88' : ( $p >= 0 ? '#7dffc0' : ( $p > -0.5 ? '#ff8a96' : '#ff4d5e' ) ); }
	function sml_hmp_stock_url( $sym ) { return home_url( '/stocks/' . strtolower( $sym ) . '/' ); }

	/** one ticker chip row (initial box + sym + price + pct), linked to the entity page */
	function sml_hmp_chip( $r, $box, $symw, $pctw, $fs ) {
		$c = sml_hmp_col( $r['chgPct'] );
		return '<a href="' . sml_hmp_esc( sml_hmp_stock_url( $r['sym'] ) ) . '" style="display:grid;grid-template-columns:' . $box . 'px ' . $symw . 'px 1fr ' . $pctw . 'px;gap:7px;align-items:center;text-decoration:none;">'
			. '<span style="width:' . $box . 'px;height:' . $box . 'px;border-radius:3px;background:#0d2a1c;border:1px solid rgba(0,255,136,0.6);color:#00ff88;font-size:' . max( 7, $box - 9 ) . 'px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' . sml_hmp_esc( substr( $r['sym'], 0, 1 ) ) . '</span>'
			. '<span style="font-size:' . $fs . 'px;font-weight:700;color:#f2fff8;">' . sml_hmp_esc( $r['sym'] ) . '</span>'
			. '<span style="font-size:' . ( $fs - 1 ) . 'px;color:#8fa89b;text-align:right;">' . number_format( (float) $r['last'], 2 ) . '</span>'
			. '<span style="font-size:' . $fs . 'px;font-weight:700;color:' . $c . ';text-align:right;">' . sml_hmp_pct( $r['chgPct'] ) . '</span></a>';
	}

	function sml_hmp_render() {
		$snap  = get_option( 'sml_hm_snapshot', array() );
		$q     = ( is_array( $snap ) && isset( $snap['quotes'] ) && is_array( $snap['quotes'] ) ) ? $snap['quotes'] : array();
		$gen   = isset( $snap['generated'] ) ? (int) $snap['generated'] : 0;
		$fresh = count( $q ) >= 20 && $gen && ( time() - $gen ) < 2 * HOUR_IN_SECONDS;
		$robots = $fresh ? 'index, follow, max-image-preview:large' : 'noindex, follow';
		$url    = home_url( '/heat-map/' );
		$asof   = $gen ? wp_date( 'M j, g:ia T', $gen ) : '';

		/* ---------- compute everything (REAL numbers only) ---------- */
		$industries = array(); $uni = array(); $secbucket = array();
		foreach ( sml_hmp_taxonomy() as $industry => $list ) {
			$rows = array();
			foreach ( explode( ',', $list ) as $ent ) {
				$p = explode( '|', $ent );
				if ( isset( $q[ $p[0] ]['chgPct'] ) && null !== $q[ $p[0] ]['chgPct'] ) {
					$r = $q[ $p[0] ]; $r['name'] = $p[1];
					$rows[] = $r; $uni[] = $r;
					$secbucket[ sml_hmp_sector_of( $industry ) ][] = $r;
				}
			}
			if ( $rows ) {
				usort( $rows, static function ( $a, $b ) { return $b['chgPct'] <=> $a['chgPct']; } );
				$industries[] = array( 'name' => $industry, 'avg' => array_sum( array_map( static function ( $r ) { return (float) $r['chgPct']; }, $rows ) ) / count( $rows ), 'rows' => $rows );
			}
		}
		usort( $industries, static function ( $a, $b ) { return $b['avg'] <=> $a['avg']; } );

		$adv = 0; $dec = 0; $athigh = 0; $atlow = 0; $upv = 0.0; $totv = 0.0; $avgp = 0.0;
		foreach ( $uni as $r ) {
			$p = (float) $r['chgPct']; $avgp += $p;
			if ( $p >= 0 ) { $adv++; } else { $dec++; }
			if ( isset( $r['h'], $r['l'] ) && null !== $r['h'] && $r['h'] > $r['l'] ) {
				if ( $r['last'] >= $r['h'] * 0.999 ) { $athigh++; }
				if ( $r['last'] <= $r['l'] * 1.001 ) { $atlow++; }
			}
			$v = isset( $r['v'] ) ? (float) $r['v'] : 0; $totv += $v; if ( $p >= 0 ) { $upv += $v; }
		}
		$n     = max( 1, count( $uni ) );
		$avgp  = $avgp / $n;
		$advsh = $adv / max( 1, $adv + $dec );
		$upvsh = $totv > 0 ? $upv / $totv : 0.5;

		/* MARKET MOOD: transparent composite — 70% breadth share, 30% momentum
		   (avg move mapped so +/-5% universe move saturates the scale). */
		$mood = (int) max( 0, min( 100, round( $advsh * 100 * 0.7 + ( 50 + $avgp * 10 ) * 0.3 ) ) );
		$zone = $mood > 65 ? 'GREED' : ( $mood < 35 ? 'FEAR' : 'NEUTRAL' );
		$zcol = $mood > 65 ? '#00ff88' : ( $mood < 35 ? '#ff4d5e' : '#ffb800' );
		$ang  = M_PI * ( 1 - $mood / 100 );
		$nx   = 110 + (int) round( 66 * cos( $ang ) );
		$ny   = 118 - (int) round( 66 * sin( $ang ) );

		$sectors = array();
		foreach ( $secbucket as $sec => $rows ) {
			usort( $rows, static function ( $a, $b ) { return $b['chgPct'] <=> $a['chgPct']; } );
			$sadv = 0; foreach ( $rows as $r ) { if ( $r['chgPct'] >= 0 ) { $sadv++; } }
			$sectors[ $sec ] = array(
				'avg' => array_sum( array_map( static function ( $r ) { return (float) $r['chgPct']; }, $rows ) ) / count( $rows ),
				'rows' => $rows, 'n' => count( $rows ), 'brd' => $sadv / count( $rows ),
			);
		}

		$movers = $uni;
		usort( $movers, static function ( $a, $b ) { return $b['chgPct'] <=> $a['chgPct']; } );
		$gainers = array_slice( $movers, 0, 4 );
		$losers  = array_reverse( array_slice( $movers, -4 ) );
		$byvol   = $uni;
		usort( $byvol, static function ( $a, $b ) { return ( isset( $b['v'] ) ? $b['v'] : 0 ) <=> ( isset( $a['v'] ) ? $a['v'] : 0 ); } );
		$vol5    = array_slice( $byvol, 0, 5 );
		$maxv    = $vol5 ? max( 1.0, (float) $vol5[0]['v'] ) : 1.0;

		$spy = isset( $q['SPY'] ) ? $q['SPY'] : null;
		$qqq = isset( $q['QQQ'] ) ? $q['QQQ'] : null;
		$dia = isset( $q['DIA'] ) ? $q['DIA'] : null;
		$spyp = $spy ? (float) $spy['chgPct'] : 0;
		$vixy = isset( $q['VIXY'] ) ? $q['VIXY'] : null;
		$glob = array();
		foreach ( array( 'EWJ' => 'JAPAN', 'FXI' => 'CHINA', 'EWU' => 'UK', 'EWG' => 'GERMANY', 'GLD' => 'GOLD', 'USO' => 'CRUDE', 'IBIT' => 'BITCOIN' ) as $gs => $gl ) {
			if ( isset( $q[ $gs ]['chgPct'] ) ) { $glob[] = array( 'label' => $gl, 'sym' => $gs, 'pct' => $q[ $gs ]['chgPct'] ); }
		}
		$watch = array();
		foreach ( array( 'AAPL', 'NVDA', 'MSFT', 'AMZN', 'META', 'GOOGL' ) as $ws ) {
			if ( isset( $q[ $ws ]['chgPct'] ) ) { $r = $q[ $ws ]; $watch[] = $r; }
		}

		$inames = array_keys( $sectors );
		$bestsec  = ''; $worstsec = ''; $ba = -999; $wa = 999;
		foreach ( $sectors as $sname => $sd ) { if ( $sd['avg'] > $ba ) { $ba = $sd['avg']; $bestsec = $sname; } if ( $sd['avg'] < $wa ) { $wa = $sd['avg']; $worstsec = $sname; } }

		$wire = array();
		if ( $fresh && $movers ) {
			$tg = $movers[0]; $tl = $movers[ count( $movers ) - 1 ];
			$wire[] = $bestsec . ' leads the tape: sector average ' . sml_hmp_pct( $ba ) . ' across ' . $sectors[ $bestsec ]['n'] . ' tracked names';
			$wire[] = $worstsec . ' is the laggard at ' . sml_hmp_pct( $wa ) . ' average';
			$wire[] = 'Top gainer among tracked large caps: ' . $tg['sym'] . ' (' . $tg['name'] . ') ' . sml_hmp_pct( $tg['chgPct'] );
			$wire[] = 'Biggest decliner: ' . $tl['sym'] . ' (' . $tl['name'] . ') ' . sml_hmp_pct( $tl['chgPct'] );
			if ( $vol5 ) { $wire[] = 'Volume leader: ' . $vol5[0]['sym'] . ' at ' . number_format( $vol5[0]['v'] / 1e6, 0 ) . 'M shares'; }
			$wire[] = 'Breadth: ' . $adv . ' advancers vs ' . $dec . ' decliners (' . round( $advsh * 100 ) . '% positive), up-volume share ' . round( $upvsh * 100 ) . '%';
			if ( isset( $q['GLD'], $q['USO'] ) ) { $wire[] = 'Gold (GLD) ' . sml_hmp_pct( $q['GLD']['chgPct'] ) . ' · Crude (USO) ' . sml_hmp_pct( $q['USO']['chgPct'] ); }
			if ( isset( $q['IBIT'] ) ) { $wire[] = 'Bitcoin (IBIT) ' . sml_hmp_pct( $q['IBIT']['chgPct'] ) . ( $vixy ? ' · Volatility (VIXY) ' . sml_hmp_pct( $vixy['chgPct'] ) : '' ); }
		}

		$sum = '';
		if ( $fresh && $movers ) {
			$tg = $movers[0]; $tl = $movers[ count( $movers ) - 1 ];
			$sum = 'As of ' . $asof . ', the strongest sector is ' . $bestsec . ' (' . sml_hmp_pct( $ba ) . ' average) and the weakest is ' . $worstsec . ' (' . sml_hmp_pct( $wa ) . '). Among ' . $n . ' tracked large-cap stocks, ' . $adv . ' are advancing and ' . $dec . ' declining; the biggest gainer is ' . $tg['sym'] . ' (' . $tg['name'] . ') at ' . sml_hmp_pct( $tg['chgPct'] ) . ' and the biggest decliner is ' . $tl['sym'] . ' at ' . sml_hmp_pct( $tl['chgPct'] ) . '. Quotes are delayed.';
		}

		$ld   = array();
		$ld[] = array( '@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => array(
			array( '@type' => 'ListItem', 'position' => 1, 'name' => 'Markets', 'item' => home_url( '/markets/' ) ),
			array( '@type' => 'ListItem', 'position' => 2, 'name' => 'Heat Map', 'item' => $url ),
		) );
		if ( $fresh ) {
			$items = array(); $pos = 1;
			foreach ( array_slice( $movers, 0, 10 ) as $m ) {
				$items[] = array( '@type' => 'ListItem', 'position' => $pos++, 'name' => $m['sym'] . ' (' . $m['name'] . ') ' . sml_hmp_pct( $m['chgPct'] ), 'url' => sml_hmp_stock_url( $m['sym'] ) );
			}
			$ld[] = array( '@context' => 'https://schema.org', '@type' => 'ItemList', 'name' => 'Top performers right now', 'dateModified' => gmdate( 'c', $gen ), 'itemListElement' => $items );
		}
		$desc = $fresh ? ( 'Market command center: live sector heat map of ' . $n . ' large-cap US stocks, market breadth, sector rotation, gainers, losers and volume leaders. Delayed quotes, updated every few minutes.' ) : 'Stock market sector heat map and market command center.';

		/* ---------- render ---------- */
		$B = '#123524'; $P = '#0a120e'; $MUT = '#5a7a6a';
		$card = 'border:1px solid ' . $B . ';border-radius:10px;background:' . $P . ';padding:14px;';
		$lab  = 'font-size:10px;letter-spacing:3px;color:' . $MUT . ';margin-bottom:10px;';

		$h  = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
		$h .= '<title>Stock Market Heat Map — Market Command Center | StockMarketLoop</title>';
		$h .= '<meta name="description" content="' . sml_hmp_esc( $desc ) . '"><meta name="robots" content="' . $robots . '"><link rel="canonical" href="' . sml_hmp_esc( $url ) . '">';
		$h .= '<meta property="og:title" content="Market Command Center | StockMarketLoop"><meta property="og:description" content="' . sml_hmp_esc( $desc ) . '"><meta property="og:url" content="' . sml_hmp_esc( $url ) . '"><meta property="og:type" content="website">';
		foreach ( $ld as $blob ) { $h .= '<script type="application/ld+json">' . wp_json_encode( $blob ) . '</script>'; }
		$h .= '<style>html,body{margin:0;padding:0;background:#05080a}a{color:#00ff88}a:hover{color:#7dffc0}@keyframes flicker{0%,100%{opacity:.55}92%{opacity:.55}93%{opacity:.38}94%{opacity:.55}97%{opacity:.48}}@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:.15}}@keyframes pulse{0%,100%{box-shadow:0 0 6px rgba(0,255,136,.8)}50%{box-shadow:0 0 14px rgba(0,255,136,1)}}.brk{margin:26px 0 8px;font-size:17px;border-left:3px solid #00ff88;padding-left:10px;color:#e6f2ea;font-family:-apple-system,sans-serif}.brk small{color:#8fa89b;font-weight:400;margin-left:8px}.btiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}.bt{display:block;background:#0a120e;border:1px solid #1c2b23;border-radius:10px;padding:11px 13px;text-decoration:none}.bt b{font-size:17px;letter-spacing:1px;color:#f2fff8}.bt span{display:block;font-size:11px;color:#8fa89b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bt em{font-style:normal;font-weight:700;float:right;font-size:15px}.bt i{display:block;font-style:normal;font-size:10px;color:#5c7a6b;margin-top:4px}.bt.up em{color:#00ff88}.bt.dn em{color:#ff4d5e}.bt:hover{border-color:#00ff88}</style></head><body>';
		$h .= '<div style="overflow-x:auto"><div style="min-height:100vh;min-width:1440px;background:#05080a;color:#c8dcd2;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;position:relative;">';

		/* HEADER */
		$h .= '<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 28px 14px 28px;border-bottom:1px solid ' . $B . ';"><div>';
		$h .= '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;font-weight:900;font-size:30px;letter-spacing:8px;color:#f2fff8;">MARKET <span style="color:#00ff88;text-shadow:0 0 18px rgba(0,255,136,0.6);">COMMAND</span> <span style="color:#ff4d5e;text-shadow:0 0 18px rgba(255,77,94,0.5);">CENTER</span></div>';
		$h .= '<div style="font-size:11px;letter-spacing:5px;color:' . $MUT . ';margin-top:6px;">SECTOR HEAT · ROTATION · BREADTH · TAPE · AS OF ' . sml_hmp_esc( strtoupper( $asof ) ) . '</div></div>';
		$h .= '<div style="display:flex;align-items:center;gap:28px;"><div style="display:flex;gap:22px;font-size:12px;letter-spacing:1px;">';
		foreach ( array( array( 'SPY', $spy ), array( 'QQQ', $qqq ), array( 'DIA', $dia ) ) as $ix ) {
			if ( $ix[1] ) { $h .= '<div>' . $ix[0] . ' <span style="color:' . sml_hmp_col( $ix[1]['chgPct'] ) . ';font-weight:700;">' . number_format( (float) $ix[1]['last'], 1 ) . ' ' . sml_hmp_pct( $ix[1]['chgPct'] ) . '</span></div>'; }
		}
		$h .= '</div><div style="display:flex;align-items:center;gap:10px;border:1px solid ' . $B . ';border-radius:6px;padding:8px 14px;background:' . $P . ';"><div style="width:8px;height:8px;border-radius:50%;background:#00ff88;animation:pulse 1.6s infinite;"></div><div id="mcc-clock" style="font-size:13px;color:#00ff88;letter-spacing:2px;min-width:96px;">--:--:-- ET</div></div></div></div>';

		/* MAIN GRID */
		$h .= '<div style="display:grid;grid-template-columns:300px 1fr 300px;gap:14px;padding:14px 28px;">';

		/* LEFT */
		$h .= '<div style="display:flex;flex-direction:column;gap:14px;">';
		$h .= '<div style="' . $card . '"><div style="' . $lab . '">MARKET MOOD · SML</div><div style="display:flex;justify-content:center;">';
		$h .= '<svg width="220" height="128" viewBox="0 0 220 128"><path d="M 20 118 A 90 90 0 0 1 56 46" fill="none" stroke="#ff4d5e" stroke-width="14" stroke-linecap="round" opacity="0.85"></path><path d="M 64 39 A 90 90 0 0 1 156 39" fill="none" stroke="#ffb800" stroke-width="14" stroke-linecap="round" opacity="0.85"></path><path d="M 164 46 A 90 90 0 0 1 200 118" fill="none" stroke="#00ff88" stroke-width="14" stroke-linecap="round" opacity="0.85"></path>';
		$h .= '<line x1="110" y1="118" x2="' . $nx . '" y2="' . $ny . '" stroke="#f2fff8" stroke-width="3" stroke-linecap="round"></line><circle cx="110" cy="118" r="7" fill="#f2fff8"></circle><text x="110" y="102" text-anchor="middle" fill="' . $zcol . '" font-size="30" font-weight="700" font-family="ui-monospace, monospace">' . $mood . '</text></svg></div>';
		$h .= '<div style="text-align:center;font-size:14px;font-weight:700;letter-spacing:6px;color:' . $zcol . ';text-shadow:0 0 12px rgba(0,255,136,0.5);">' . $zone . '</div>';
		$h .= '<div style="display:flex;justify-content:space-between;font-size:10px;color:' . $MUT . ';margin-top:8px;"><span>' . ( $vixy ? 'VIXY ' . number_format( (float) $vixy['last'], 1 ) . ' <b style="color:' . sml_hmp_col( $vixy['chgPct'] ) . ';">' . sml_hmp_pct( $vixy['chgPct'] ) . '</b>' : '' ) . '</span><span>BREADTH ' . round( $advsh * 100 ) . '% + MOMENTUM</span></div></div>';

		$h .= '<div style="' . $card . '"><div style="' . $lab . 'margin-bottom:12px;">MARKET BREADTH · TRACKED ' . $n . '</div>';
		$h .= '<div style="display:flex;height:14px;border-radius:4px;overflow:hidden;gap:2px;"><div style="flex:' . max( 1, $adv ) . ';background:linear-gradient(90deg,#00b360,#00ff88);box-shadow:0 0 10px rgba(0,255,136,0.4);"></div><div style="flex:' . max( 1, $dec ) . ';background:linear-gradient(90deg,#ff4d5e,#a12630);"></div></div>';
		$h .= '<div style="display:flex;justify-content:space-between;font-size:11px;margin-top:8px;"><span style="color:#00ff88;">ADV ' . $adv . '</span><span style="color:#ff4d5e;">DEC ' . $dec . '</span></div>';
		$h .= '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">';
		$h .= '<div style="border:1px solid ' . $B . ';border-radius:6px;padding:8px;text-align:center;"><div style="font-size:9px;letter-spacing:2px;color:' . $MUT . ';">AT DAY HIGH</div><div style="font-size:18px;font-weight:700;color:#00ff88;">' . $athigh . '</div></div>';
		$h .= '<div style="border:1px solid ' . $B . ';border-radius:6px;padding:8px;text-align:center;"><div style="font-size:9px;letter-spacing:2px;color:' . $MUT . ';">AT DAY LOW</div><div style="font-size:18px;font-weight:700;color:#ff4d5e;">' . $atlow . '</div></div>';
		$h .= '<div style="border:1px solid ' . $B . ';border-radius:6px;padding:7px 8px;display:flex;justify-content:space-between;align-items:center;"><span style="font-size:9px;letter-spacing:1px;color:' . $MUT . ';">AVG MOVE</span><b style="font-size:12px;color:' . sml_hmp_col( $avgp ) . ';">' . sml_hmp_pct( $avgp ) . '</b></div>';
		$h .= '<div style="border:1px solid ' . $B . ';border-radius:6px;padding:7px 8px;display:flex;justify-content:space-between;align-items:center;"><span style="font-size:9px;letter-spacing:1px;color:' . $MUT . ';">UP VOLUME</span><b style="font-size:12px;color:' . ( $upvsh >= 0.5 ? '#00ff88' : '#ff4d5e' ) . ';">' . round( $upvsh * 100 ) . '%</b></div>';
		$h .= '<div style="border:1px solid ' . $B . ';border-radius:6px;padding:7px 8px;display:flex;justify-content:space-between;align-items:center;"><span style="font-size:9px;letter-spacing:1px;color:' . $MUT . ';">BEST</span><b style="font-size:11px;color:#00ff88;">' . sml_hmp_esc( $bestsec ) . '</b></div>';
		$h .= '<div style="border:1px solid ' . $B . ';border-radius:6px;padding:7px 8px;display:flex;justify-content:space-between;align-items:center;"><span style="font-size:9px;letter-spacing:1px;color:' . $MUT . ';">WORST</span><b style="font-size:11px;color:#ff4d5e;">' . sml_hmp_esc( $worstsec ) . '</b></div>';
		$h .= '</div></div>';

		$h .= '<div style="' . $card . 'flex:1;"><div style="' . $lab . '">SECTOR ROTATION · TODAY</div><div style="position:relative;height:190px;border:1px solid ' . $B . ';border-radius:6px;background:linear-gradient(135deg,rgba(0,255,136,0.05),rgba(255,77,94,0.05));">';
		$h .= '<div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:' . $B . ';"></div><div style="position:absolute;top:50%;left:0;right:0;height:1px;background:' . $B . ';"></div>';
		$h .= '<div style="position:absolute;top:6px;right:8px;font-size:8px;letter-spacing:2px;color:#00ff88;">LEADING</div><div style="position:absolute;top:6px;left:8px;font-size:8px;letter-spacing:2px;color:#ffb800;">IMPROVING</div><div style="position:absolute;bottom:6px;left:8px;font-size:8px;letter-spacing:2px;color:#ff4d5e;">LAGGING</div><div style="position:absolute;bottom:6px;right:8px;font-size:8px;letter-spacing:2px;color:#ffb800;">WEAKENING</div>';
		$short = array( 'TECHNOLOGY' => 'TECH', 'COMM SVCS' => 'COMM', 'FINANCIALS' => 'FIN', 'HEALTH CARE' => 'HLTH', 'ENERGY' => 'ENRG', 'INDUSTRIALS' => 'INDU', 'CONS DISC' => 'DISC', 'STAPLES' => 'STPL', 'UTIL' => 'UTIL', 'REIT' => 'REIT', 'MATL' => 'MATL' );
		foreach ( $sectors as $sname => $sd ) {
			$x = max( 6, min( 86, 50 + ( $sd['avg'] - $spyp ) * 22 ) );
			$y = max( 12, min( 78, 50 - ( $sd['brd'] - 0.5 ) * 70 ) );
			$dc = $sd['avg'] > 0.15 ? '#00ff88' : ( $sd['avg'] < -0.15 ? '#ff4d5e' : '#ffb800' );
			$h .= '<div style="position:absolute;top:' . round( $y ) . '%;left:' . round( $x ) . '%;width:8px;height:8px;border-radius:50%;background:' . $dc . ';box-shadow:0 0 8px ' . $dc . ';" title="' . sml_hmp_esc( $sname ) . ' ' . sml_hmp_pct( $sd['avg'] ) . '"></div>';
			$h .= '<div style="position:absolute;top:' . round( $y - 1 ) . '%;left:' . round( min( 88, $x + 3 ) ) . '%;font-size:8px;color:' . $dc . ';">' . $short[ $sname ] . '</div>';
		}
		$h .= '</div></div></div>';

		/* CENTER: TREEMAP */
		$slots = array(
			'TECHNOLOGY'  => array( '1 / span 4', '1 / span 10', 44, 3 ),
			'FINANCIALS'  => array( '5 / span 3', '1 / span 4', 26, 1 ),
			'HEALTH CARE' => array( '8 / span 3', '1 / span 4', 26, 1 ),
			'CONS DISC'   => array( '5 / span 2', '5 / span 4', 24, 1 ),
			'COMM SVCS'   => array( '7 / span 2', '5 / span 4', 24, 1 ),
			'INDUSTRIALS' => array( '9 / span 2', '5 / span 4', 24, 1 ),
			'STAPLES'     => array( '5 / span 2', '9 / span 2', 17, 1 ),
			'ENERGY'      => array( '7', '9 / span 2', 15, 1 ),
			'UTIL'        => array( '8', '9 / span 2', 15, 1 ),
			'REIT'        => array( '9', '9 / span 2', 15, 1 ),
			'MATL'        => array( '10', '9 / span 2', 15, 1 ),
		);
		$h .= '<div style="display:flex;flex-direction:column;gap:10px;">';
		$h .= '<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid ' . $B . ';border-radius:8px;background:' . $P . ';padding:10px 16px;"><div style="font-size:11px;letter-spacing:3px;"><span style="color:' . $MUT . ';">SECTOR HEAT MAP · </span><span style="color:#00ff88;font-weight:700;">TRACKED LARGE CAPS</span></div><div style="font-size:10px;color:' . $MUT . ';letter-spacing:2px;">FIXED TILE LAYOUT · COLOR = TODAY\'S MOVE</div></div>';
		$h .= '<div style="display:grid;grid-template-columns:repeat(10,1fr);grid-template-rows:repeat(10,62px);gap:6px;">';
		foreach ( $slots as $sname => $cfg ) {
			if ( ! isset( $sectors[ $sname ] ) ) { continue; }
			$sd  = $sectors[ $sname ];
			$pos = $sd['avg'] >= 0;
			$mag = min( 0.22, 0.06 + abs( $sd['avg'] ) * 0.10 );
			$bgc = $pos ? 'rgba(0,255,136,' . round( $mag, 2 ) . ')' : 'rgba(255,77,94,' . round( $mag, 2 ) . ')';
			$brc = $pos ? 'rgba(0,255,136,' . round( $mag + 0.28, 2 ) . ')' : 'rgba(255,77,94,' . round( $mag + 0.28, 2 ) . ')';
			$pcol = sml_hmp_col( $sd['avg'] );
			$h .= '<div style="grid-column:' . $cfg[0] . ';grid-row:' . $cfg[1] . ';border-radius:8px;background:' . $bgc . ';border:1px solid ' . $brc . ';padding:' . ( 44 === $cfg[2] ? '16px' : '12px' ) . ';display:flex;flex-direction:column;justify-content:space-between;' . ( 44 === $cfg[2] ? 'box-shadow:inset 0 0 40px rgba(0,255,136,0.08);' : '' ) . '">';
			$h .= '<div><div style="font-size:' . ( 44 === $cfg[2] ? 13 : 10 ) . 'px;letter-spacing:2px;color:' . ( $pos ? '#b8e8d0' : '#e8c0c4' ) . ';">' . sml_hmp_esc( $sname ) . ' <span style="color:' . $MUT . ';">' . $sd['n'] . ' NAMES</span></div></div>';
			$h .= '<div><div style="font-size:' . $cfg[2] . 'px;font-weight:700;color:' . $pcol . ';' . ( abs( $sd['avg'] ) > 0.8 ? 'text-shadow:0 0 24px ' . $pcol . '55;' : '' ) . '">' . sml_hmp_pct( $sd['avg'] ) . '</div>';
			if ( $cfg[3] > 0 && $sd['rows'] ) {
				if ( 3 === $cfg[3] ) { $h .= '<div style="font-size:9px;letter-spacing:2px;color:' . $MUT . ';margin:14px 0 8px 0;">SECTOR LEADERS</div>'; }
				$h .= '<div style="display:flex;flex-direction:column;gap:' . ( 3 === $cfg[3] ? 8 : 6 ) . 'px;margin-top:' . ( 3 === $cfg[3] ? 0 : 6 ) . 'px;">';
				for ( $i = 0; $i < min( $cfg[3], count( $sd['rows'] ) ); $i++ ) {
					$h .= sml_hmp_chip( $sd['rows'][ $i ], 3 === $cfg[3] ? 18 : 15, 3 === $cfg[3] ? 56 : 48, 62, 3 === $cfg[3] ? 12 : 11 );
				}
				$h .= '</div>';
				$worst = $sd['rows'][ count( $sd['rows'] ) - 1 ];
				if ( 'HEALTH CARE' === $sname && $worst['chgPct'] < 0 ) { $h .= '<div style="font-size:9px;color:#ff8a96;margin-top:4px;">DRAG: ' . sml_hmp_esc( $worst['sym'] ) . ' ' . sml_hmp_pct( $worst['chgPct'] ) . '</div>'; }
			}
			$h .= '</div></div>';
		}
		$h .= '</div>';
		$h .= '<div style="border:1px solid ' . $B . ';border-radius:8px;background:' . $P . ';padding:10px 16px;display:flex;align-items:center;gap:8px;"><div style="font-size:9px;letter-spacing:3px;color:' . $MUT . ';flex-shrink:0;">GLOBAL · ETF PROXIES</div><div style="display:flex;gap:8px;flex-wrap:wrap;flex:1;justify-content:flex-end;">';
		foreach ( $glob as $g ) { $h .= '<a href="' . sml_hmp_esc( sml_hmp_stock_url( $g['sym'] ) ) . '" style="border:1px solid ' . $B . ';border-radius:5px;padding:5px 10px;font-size:10px;color:#c8dcd2;text-decoration:none;">' . $g['label'] . ' (' . $g['sym'] . ') <b style="color:' . sml_hmp_col( $g['pct'] ) . ';">' . sml_hmp_pct( $g['pct'] ) . '</b></a>'; }
		$h .= '</div></div></div>';

		/* RIGHT */
		$h .= '<div style="display:flex;flex-direction:column;gap:14px;">';
		$h .= '<div style="' . $card . '"><div style="' . $lab . '">TOP GAINERS</div><div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">';
		foreach ( $gainers as $r ) { $h .= sml_hmp_chip( $r, 16, 48, 58, 12 ); }
		$h .= '</div><div style="height:1px;background:' . $B . ';margin:12px 0 10px 0;"></div><div style="' . $lab . '">TOP LOSERS</div><div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">';
		foreach ( $losers as $r ) { $h .= sml_hmp_chip( $r, 16, 48, 58, 12 ); }
		$h .= '</div></div>';
		$h .= '<div style="' . $card . '"><div style="' . $lab . '">VOLUME LEADERS</div><div style="display:flex;flex-direction:column;gap:7px;font-size:11px;">';
		foreach ( $vol5 as $r ) {
			$w = max( 8, round( (float) $r['v'] / $maxv * 100 ) );
			$up = $r['chgPct'] >= 0;
			$h .= '<a href="' . sml_hmp_esc( sml_hmp_stock_url( $r['sym'] ) ) . '" style="display:grid;grid-template-columns:46px 1fr 78px;gap:8px;align-items:center;text-decoration:none;"><span style="font-weight:700;color:#f2fff8;">' . sml_hmp_esc( $r['sym'] ) . '</span><span style="height:6px;border-radius:3px;background:' . $B . ';display:block;"><span style="width:' . $w . '%;height:100%;border-radius:3px;background:linear-gradient(90deg,' . ( $up ? '#00b360,#00ff88' : '#a12630,#ff4d5e' ) . ');display:block;"></span></span><span style="color:' . ( $up ? '#7dffc0' : '#ff8a96' ) . ';text-align:right;font-size:10px;">' . number_format( $r['v'] / 1e6, 0 ) . 'M</span></a>';
		}
		$h .= '</div></div>';
		$h .= '<div style="' . $card . 'flex:1;"><div style="' . $lab . '">WATCHLIST</div><div style="display:flex;flex-direction:column;gap:8px;font-size:11px;">';
		foreach ( $watch as $r ) { $h .= sml_hmp_chip( $r, 16, 46, 58, 11 ); }
		$h .= '</div></div></div></div>';

		/* LIVE WIRE */
		if ( $wire ) {
			$h .= '<div style="margin:0 28px 20px 28px;border:1px solid ' . $B . ';border-radius:10px;background:' . $P . ';padding:14px 16px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;"><div style="width:7px;height:7px;border-radius:50%;background:#ff4d5e;animation:blink 1.2s infinite;"></div><div style="font-size:10px;letter-spacing:3px;color:' . $MUT . ';">LIVE WIRE · FROM THE TAPE · ' . sml_hmp_esc( strtoupper( $asof ) ) . '</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 28px;font-size:12px;">';
			$wt = $gen ? wp_date( 'H:i', $gen ) : '';
			foreach ( $wire as $line ) { $h .= '<div style="display:flex;gap:12px;"><span style="color:#00ff88;flex-shrink:0;">' . $wt . '</span><span style="color:#c8dcd2;">' . sml_hmp_esc( $line ) . '</span></div>'; }
			$h .= '</div></div>';
		}

		/* AI summary + FULL BREAKDOWN (the entity-link layer) */
		$h .= '<div style="margin:0 28px 40px 28px;">';
		if ( $sum ) { $h .= '<section id="sml-hm-summary" style="border:1px solid #1c2b23;border-radius:12px;background:' . $P . ';padding:14px 18px;font:15px/1.6 -apple-system,sans-serif;color:#e6f2ea;">' . sml_hmp_esc( $sum ) . '</section>'; }
		$h .= '<h2 class="brk" style="margin-top:30px;font-size:20px;">Full Industry Breakdown<small>all 58 industries · every name links to its stock page</small></h2>';
		if ( $fresh ) {
			foreach ( $industries as $ind ) {
				$h .= '<h3 class="brk">' . sml_hmp_esc( $ind['name'] ) . '<small>' . sml_hmp_pct( $ind['avg'] ) . ' avg</small></h3><div class="btiles">';
				foreach ( $ind['rows'] as $r ) {
					$cls = $r['chgPct'] >= 0 ? 'up' : 'dn';
					$h  .= '<a class="bt ' . $cls . '" href="' . sml_hmp_esc( sml_hmp_stock_url( $r['sym'] ) ) . '"><b>' . sml_hmp_esc( $r['sym'] ) . '</b><em>' . sml_hmp_pct( $r['chgPct'] ) . '</em><span>' . sml_hmp_esc( $r['name'] ) . '</span>' . ( isset( $r['pc'] ) && null !== $r['pc'] ? '<i>prev close $' . number_format( (float) $r['pc'], 2 ) . '</i>' : '' ) . '</a>';
				}
				$h .= '</div>';
			}
		} else {
			$h .= '<p style="color:#8fa89b;font-family:-apple-system,sans-serif;">Market data is being refreshed — check back in a few minutes.</p>';
		}
		$h .= '<div style="margin-top:34px;color:#5c7a6b;font-size:12px;font-family:-apple-system,sans-serif;">Data is delayed and provided for information only — not investment advice. See the full <a href="' . sml_hmp_esc( home_url( '/stock-chart/' ) ) . '">Ticker Terminal</a> or <a href="' . sml_hmp_esc( home_url( '/markets/' ) ) . '">Markets</a>.</div></div>';

		/* CRT overlay */
		$h .= '<div style="position:fixed;inset:0;pointer-events:none;z-index:50;background:repeating-linear-gradient(0deg,rgba(0,0,0,0.18) 0px,rgba(0,0,0,0.18) 1px,transparent 1px,transparent 3px);animation:flicker 6s infinite;"></div>';
		$h .= '<div style="position:fixed;inset:0;pointer-events:none;z-index:51;background:radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,0.5) 100%);"></div>';
		$h .= '</div></div>';

		/* live ET clock — the page\'s only JS */
		$h .= '<script>(function(){var el=document.getElementById("mcc-clock");if(!el)return;function t(){try{el.textContent=new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour12:false})+" ET";}catch(e){}}t();setInterval(t,1000);})();</script>';
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
