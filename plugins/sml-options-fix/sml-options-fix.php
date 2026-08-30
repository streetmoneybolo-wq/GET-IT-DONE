<?php
/**
 * Plugin Name: SML Options Fix
 * Description: Patches two defects on the /options/{TICKER}/ pages (WPCode #7372) without re-saving that 25KB snippet: (1) an unknown ticker now returns a real 404 instead of a 200-shaped shell, and (2) the already-working options sitemap (?sml_opt_sitemap=1) is made discoverable via robots.txt and the Rank Math sitemap index. Additive + reversible; does not touch #7372.
 * Version: 1.0.0
 * Author: StockMarketLoop
 *
 * Context: SML/ memory sml-options-data-pages. The repo's options-pages.php already
 * carries both fixes, but the live snippet couldn't be re-saved (host firewall 406s
 * a ~25KB WPCode POST). This tiny plugin lands the same behavior via the reliable
 * plugin-ZIP path instead. Kill: deactivate this plugin.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * The launch set — the only /options/ pages with real content. Mirrors #7372's
 * sml_opt_config()['tickers'] when that snippet is loaded; falls back to the
 * documented hardcoded list otherwise so the 404 gate never depends on load order.
 */
function sml_optfix_valid_tickers() {
	if ( function_exists( 'sml_opt_config' ) ) {
		$c = sml_opt_config();
		if ( is_array( $c ) && ! empty( $c['tickers'] ) && is_array( $c['tickers'] ) ) {
			return array_map( 'strtolower', $c['tickers'] );
		}
	}
	return array( 'spy', 'qqq', 'nvda', 'tsla', 'aapl', 'amd', 'meta', 'amzn' );
}

/**
 * (1) Unknown /options/{ticker}/ must be a real 404, not a 200-shaped shell — thin
 * auto-generated pages are exactly what pooled in "crawled, not indexed". Runs at
 * priority -20, BEFORE #7372's template_redirect router (priority 0), so the 404
 * state stands (verified: the live snippet returns for unknown tickers, so it does
 * not overwrite this). Path-matched (not query-var) so it is independent of routing.
 */
add_action( 'template_redirect', function () {
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return; }
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	if ( ! preg_match( '#^/options/([A-Za-z]{1,6})/?$#', $path, $m ) ) { return; }
	if ( in_array( strtolower( $m[1] ), sml_optfix_valid_tickers(), true ) ) { return; }
	global $wp_query;
	if ( $wp_query ) { $wp_query->set_404(); }
	status_header( 404 );
	nocache_headers();
}, -20 );

/**
 * (2) Discovery for the working ?sml_opt_sitemap=1 sitemap (its pretty-URL rewrite
 * never persisted, and a {name}-sitemap.xml root name is intercepted by Rank Math —
 * so point crawlers at the query-var URL, which returns valid XML today). Both hooks
 * are additive + idempotent.
 */
add_filter( 'robots_txt', function ( $out, $public ) {
	if ( ! $public ) { return $out; }
	if ( false !== strpos( (string) $out, 'sml_opt_sitemap' ) ) { return $out; }
	return rtrim( (string) $out ) . "\nSitemap: " . home_url( '/?sml_opt_sitemap=1' ) . "\n";
}, 23, 2 );

add_filter( 'rank_math/sitemap/index', function ( $links ) {
	if ( is_string( $links ) && false !== strpos( $links, 'sml_opt_sitemap' ) ) { return $links; }
	return (string) $links . '<sitemap><loc>' . esc_url( home_url( '/?sml_opt_sitemap=1' ) ) . '</loc><lastmod>' . esc_html( gmdate( 'c' ) ) . '</lastmod></sitemap>' . "\n";
} );
