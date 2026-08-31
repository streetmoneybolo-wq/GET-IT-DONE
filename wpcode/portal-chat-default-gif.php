/**
 * SML Portal Chat — site-wide default animated background.
 *
 * WPCode PHP snippet; Auto Insert / Run Everywhere.
 * Intentionally intercepts only the group shell's bundled Portal asset.
 * Group banners and normal channel backgrounds are never changed.
 */
if ( ! function_exists( 'sml_portal_default_gif_url' ) ) {
	function sml_portal_default_gif_url( $url, $path, $plugin ) {
		if ( ! is_string( $url ) || ! is_string( $path ) ) {
			return $url;
		}
		if ( false === strpos( $path, 'portal-watermark.gif' ) || false === strpos( $url, 'sml-group-shell' ) ) {
			return $url;
		}
		return 'https://stockmarketloop.com/wp-content/uploads/2026/08/Untitled-800-x-800-px-2.gif';
	}
}

if ( ! has_filter( 'plugins_url', 'sml_portal_default_gif_url' ) ) {
	add_filter( 'plugins_url', 'sml_portal_default_gif_url', PHP_INT_MAX, 3 );
}
