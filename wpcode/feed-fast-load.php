/**
 * SML Feed Fast Load — visually-lossless speed for the signed-in homepage.
 *
 * Two transforms on the final homepage document (marker-gated, output buffer):
 *  1. IMAGES VIA CDN AT RENDER SIZE — card images referenced full-size from
 *     /wp-content/uploads/ are rewritten to the Jetpack Photon CDN capped at
 *     w=1200 (2x the rendered column width, so nothing changes visually;
 *     Photon never upscales). The browser's preload scanner then downloads
 *     the small CDN file from the first byte — no double-fetch, no origin
 *     round trip (~1s each observed). GIF/SVG and avatar imgs are skipped
 *     (animation safety; avatars are separately sized client-side).
 *  2. EARLY CONTROLLER FETCH — the home-feed.js tag sits at the end of the
 *     body while the pre-paint guard holds the page invisible until it boots.
 *     A <link rel="preload"> for the exact same src plus preconnects for the
 *     CDN hosts go into <head>, so the script is already in cache when the
 *     parser reaches its tag and the page reveals sooner.
 *
 * Read-only transform of the response — no data, no routes, no mutations.
 * Rollback: deactivate this snippet; the page renders exactly as before.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_ffl_buffer' ) ) {

	function sml_ffl_photon( $src ) {
		if ( false !== stripos( $src, 'i0.wp.com' ) ) { return $src; }
		if ( ! preg_match( '~^https?://([^/]+)(/wp-content/uploads/[^?"]+)~i', $src, $m ) ) { return $src; }
		if ( preg_match( '~\.(gif|svg)$~i', $m[2] ) ) { return $src; }
		return 'https://i0.wp.com/' . $m[1] . $m[2] . '?w=1200&ssl=1';
	}

	function sml_ffl_buffer( $html ) {
		if ( ! is_string( $html ) || false === strpos( $html, 'id="sml-optimized-home"' ) ) { return $html; }

		$out = preg_replace_callback( '~<img\b[^>]*>~i', static function ( $m ) {
			$tag = $m[0];
			if ( false !== stripos( $tag, 'oh-post-avatar' ) ) { return $tag; }
			return preg_replace_callback( '~\bsrc="([^"]+)"~i', static function ( $s ) {
				return 'src="' . esc_url( sml_ffl_photon( html_entity_decode( $s[1], ENT_QUOTES, 'UTF-8' ) ) ) . '"';
			}, $tag, 1 );
		}, $html );
		if ( is_string( $out ) ) { $html = $out; }

		/* head hints: preload the controller + warm both CDN connections */
		if ( preg_match( '~<script\b[^>]*\bsrc="([^"]*home-feed\.js[^"]*)"~i', $html, $tag ) ) {
			$hints  = '<link rel="preconnect" href="https://cdn.jsdelivr.net">';
			$hints .= '<link rel="preconnect" href="https://i0.wp.com">';
			$hints .= '<link rel="preload" as="script" href="' . esc_url( html_entity_decode( $tag[1], ENT_QUOTES, 'UTF-8' ) ) . '">';
			$pos = stripos( $html, '<head>' );
			if ( false !== $pos ) { $html = substr( $html, 0, $pos + 6 ) . $hints . substr( $html, $pos + 6 ); }
		}
		return $html;
	}

	add_action( 'init', static function () {
		if ( is_admin() || ! is_user_logged_in() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return; }
		$path = trim( (string) parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
		if ( '' === $path ) { ob_start( 'sml_ffl_buffer' ); }
	}, 2 );
}
