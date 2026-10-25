<?php
/**
 * Plugin Name: SML Markets Desk Index
 * Description: A fast public /markets/ index for published Loop Letters, grouped by ticker with cached price chips.
 * Version: 1.0.1
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_MARKETS_DESK_VERSION', '1.0.1' );

function sml_markets_desk_data() {
	$cached = get_transient( 'sml_markets_desk_index_v1' );
	if ( is_array( $cached ) ) { return $cached; }
	$rows = function_exists( 'sml_lls_published' ) ? sml_lls_published( 120 ) : array();
	$groups = array(); $symbols = array();
	foreach ( (array) $rows as $row ) {
		$tickers = function_exists( 'sml_lls_tickers' ) ? sml_lls_tickers( $row ) : array();
		if ( ! $tickers ) { continue; }
		foreach ( array_slice( $tickers, 0, 4 ) as $symbol ) {
			$symbol = strtoupper( preg_replace( '/[^A-Z0-9.\-]/', '', $symbol ) );
			if ( ! $symbol ) { continue; }
			if ( ! isset( $groups[ $symbol ] ) ) { $groups[ $symbol ] = array( 'symbol' => $symbol, 'letters' => array() ); $symbols[] = $symbol; }
			$groups[ $symbol ]['letters'][] = array(
				'title' => (string) $row['title'],
				'dek' => (string) ( $row['subtitle'] ?: $row['tldr'] ),
				'url' => function_exists( 'sml_lls_letter_url' ) ? sml_lls_letter_url( $row ) : home_url( '/' ),
				'cover' => esc_url_raw( (string) $row['cover_url'] ),
				'published' => (string) $row['published_at'],
				'minutes' => max( 1, (int) $row['read_minutes'] ),
			);
		}
	}
	$prices = function_exists( 'sml_lls_card_prices' ) ? sml_lls_card_prices( array_slice( $symbols, 0, 48 ) ) : array();
	foreach ( $groups as $symbol => &$group ) { $group['price'] = $prices[ $symbol ] ?? null; }
	unset( $group );
	$data = array_values( $groups );
	usort( $data, function( $a, $b ) { return strcmp( $a['symbol'], $b['symbol'] ); } );
	set_transient( 'sml_markets_desk_index_v1', $data, MINUTE_IN_SECONDS );
	return $data;
}

function sml_markets_desk_render() {
	$groups = sml_markets_desk_data();
	?><main class="sml-markets-desk"><header><p class="eyebrow">STOCKMARKETLOOP · MARKET DESK</p><h1>Markets</h1><p class="intro">Every published desk letter, organized by ticker. Prices are delayed or live according to the data source and are not trading advice.</p></header><?php
	if ( ! $groups ) { echo '<p class="empty">The desk has not published any ticker letters yet.</p>'; }
	foreach ( $groups as $group ) { $p = $group['price']; ?><section class="ticker" id="<?php echo esc_attr( strtolower( $group['symbol'] ) ); ?>"><div class="ticker-head"><h2><a href="<?php echo esc_url( home_url( '/stocks/' . strtolower( $group['symbol'] ) . '/' ) ); ?>">$<?php echo esc_html( $group['symbol'] ); ?></a></h2><?php if ( is_array( $p ) && isset( $p['last'] ) ) { $pct = (float) ( $p['pct'] ?? 0 ); ?><span class="price <?php echo $pct >= 0 ? 'up' : 'down'; ?>">$<?php echo esc_html( number_format_i18n( (float) $p['last'], abs( (float) $p['last'] ) < 1 ? 4 : 2 ) ); ?> <small><?php echo esc_html( ( $pct >= 0 ? '+' : '' ) . number_format_i18n( $pct, 2 ) . '%' ); ?></small></span><?php } ?></div><div class="letters"><?php foreach ( array_slice( $group['letters'], 0, 6 ) as $letter ) { ?><article><a class="letter" href="<?php echo esc_url( $letter['url'] ); ?>"><?php if ( $letter['cover'] ) { ?><img loading="lazy" src="<?php echo esc_url( $letter['cover'] ); ?>" alt="<?php echo esc_attr( $letter['title'] ); ?>"><?php } ?><div><time datetime="<?php echo esc_attr( mysql2date( 'c', $letter['published'], false ) ); ?>"><?php echo esc_html( mysql2date( get_option( 'date_format' ), $letter['published'] ) ); ?></time><h3><?php echo esc_html( $letter['title'] ); ?></h3><p><?php echo esc_html( wp_trim_words( wp_strip_all_tags( $letter['dek'] ), 28 ) ); ?></p><span><?php echo esc_html( $letter['minutes'] ); ?> min read</span></div></a></article><?php } ?></div></section><?php }
	?></main><style>.sml-markets-desk{max-width:1120px;margin:0 auto;padding:42px 18px 72px;color:#e9eef4}.sml-markets-desk .eyebrow{margin:0;color:#19c37d;font:800 12px/1 ui-monospace,monospace;letter-spacing:.13em}.sml-markets-desk h1{font:800 clamp(34px,6vw,62px)/1 system-ui,sans-serif;margin:12px 0}.sml-markets-desk .intro{max-width:680px;color:#9eafbd;font:17px/1.5 system-ui,sans-serif}.sml-markets-desk .ticker{border-top:1px solid rgba(255,255,255,.12);padding:24px 0}.sml-markets-desk .ticker-head{display:flex;align-items:center;justify-content:space-between;gap:14px}.sml-markets-desk h2{margin:0;font:800 28px/1 system-ui,sans-serif}.sml-markets-desk h2 a,.sml-markets-desk .letter{color:inherit;text-decoration:none}.sml-markets-desk .price{font:800 15px/1 ui-monospace,monospace;padding:8px 10px;border:1px solid rgba(255,255,255,.16);border-radius:99px}.sml-markets-desk .up{color:#19c37d}.sml-markets-desk .down{color:#ff5c7a}.sml-markets-desk .letters{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:13px;margin-top:15px}.sml-markets-desk article{background:#101a25;border:1px solid rgba(255,255,255,.09);border-radius:14px;overflow:hidden}.sml-markets-desk .letter{display:block;height:100%}.sml-markets-desk img{width:100%;aspect-ratio:1.91;object-fit:cover;display:block;background:#0b1119}.sml-markets-desk article div{padding:14px}.sml-markets-desk time,.sml-markets-desk article span{color:#8fa3b0;font:700 11px/1.2 ui-monospace,monospace;letter-spacing:.06em}.sml-markets-desk h3{font:800 18px/1.2 system-ui,sans-serif;margin:7px 0}.sml-markets-desk article p{color:#adbbc6;font:14px/1.45 system-ui,sans-serif;margin:0 0 10px}.sml-markets-desk .empty{color:#9eafbd}@media(max-width:540px){.sml-markets-desk{padding-top:28px}.sml-markets-desk .letters{grid-template-columns:1fr}}</style><?php
}

function sml_markets_desk_route() {
	if ( is_admin() || ! is_page( 'markets' ) ) { return; }
	status_header( 200 ); nocache_headers();
	get_header(); sml_markets_desk_render(); get_footer(); exit;
}
add_action( 'template_redirect', 'sml_markets_desk_route', 1 );

function sml_markets_desk_purge( $post_id = 0 ) { delete_transient( 'sml_markets_desk_index_v1' ); }
add_action( 'sml_letters_published', 'sml_markets_desk_purge', 20 );
add_action( 'sml_letters_updated', 'sml_markets_desk_purge', 20 );
