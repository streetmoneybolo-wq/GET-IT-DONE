/**
 * SML Pre-paint guard — no more "old layout first" flash on takeover pages.
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet (purely cosmetic; owns no data).
 *
 * Every new SML screen is a client-side takeover: WordPress paints the old
 * theme/plugin page, then a CDN script appended before </body> builds the new
 * shell over it. The visible flash is the gap between those two paints.
 *
 * This starts its output buffer BEFORE the other loaders (init priority -1 →
 * outermost buffer → sees the finished page) and, ONLY when a takeover loader
 * left its marker in the HTML, injects at the top of <head>:
 *   - an inline <style> (server-side, zero CDN dependency) that paints the dark
 *     canvas and hides the old layout (html.sml-pp body{visibility:hidden})
 *   - a pure-CSS failsafe: after 2.5s the body is revealed no matter what
 *     (CDN slow/blocked, JS off, a skin that never calls reveal) — nothing can
 *     stay blank
 *   - <link rel="preload"> for that page's exact CDN JS/CSS so the download
 *     starts while the body is still parsing
 * and adds class="sml-pp" to <html>. Each skin removes that class as soon as
 * its shell has painted (home-feed.js, loop-channel.js …). Pages without a
 * takeover marker are untouched.
 */
if ( ! function_exists( 'sml_pp_markers' ) ) {
	/* marker in the finished HTML  =>  ids of the loader's script/link tags to preload */
	function sml_pp_markers() {
		return array(
			'id="sml-cdn-homefeed"' => array( 'sml-cdn-homefeed' ),                 // home feed shell (signed-in home)
			'id="sml-ch-root"'      => array( 'sml-ch-js', 'sml-ch-css' ),          // Loop Channel
			'id="sml-cc-root"'      => array( 'sml-cc-js', 'sml-cc-css' ),          // Create Loop Channel
			'sml-public-profile-page' => array( 'src:js/immersive-profile.js' ),    // public profile (immersive overlay; matched by src)
		);
	}
	function sml_pp_active() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) || ( defined( 'DOING_CRON' ) && DOING_CRON ) ) { return false; }
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false !== strpos( $uri, '/wp-json/' ) || false !== strpos( $uri, '/wp-login' ) || false !== strpos( $uri, '/wp-admin' ) ) { return false; }
		return true;
	}
	function sml_pp_ob( $html ) {
		if ( ! is_string( $html ) || false !== strpos( $html, 'id="sml-pp-css"' ) ) { return $html; }
		if ( ! preg_match( '/<head(\s[^>]*)?>/i', $html ) ) { return $html; }
		foreach ( headers_list() as $h ) { if ( 0 === stripos( $h, 'content-type:' ) && false === stripos( $h, 'text/html' ) ) { return $html; } }
		$hit = null;
		foreach ( sml_pp_markers() as $marker => $ids ) { if ( false !== strpos( $html, $marker ) ) { $hit = $ids; break; } }
		if ( null === $hit ) { return $html; }

		/* preload the exact CDN assets this page's loader emitted */
		$preload = '';
		foreach ( $hit as $id ) {
			if ( 0 === strpos( $id, 'src:' ) ) { /* match a script by src fragment (tags without an id) */
				$frag = preg_quote( substr( $id, 4 ), '/' );
				if ( preg_match( '/<script[^>]*\bsrc="([^"]*' . $frag . '[^"]*)"/i', $html, $m ) ) { $preload .= '<link rel="preload" as="script" href="' . esc_url( $m[1] ) . '">'; }
				continue;
			}
			if ( preg_match( '/<script[^>]*\bid="' . preg_quote( $id, '/' ) . '"[^>]*\bsrc="([^"]+)"/i', $html, $m ) || preg_match( '/<script[^>]*\bsrc="([^"]+)"[^>]*\bid="' . preg_quote( $id, '/' ) . '"/i', $html, $m ) ) {
				$preload .= '<link rel="preload" as="script" href="' . esc_url( $m[1] ) . '">';
			} elseif ( preg_match( '/<link[^>]*\bid="' . preg_quote( $id, '/' ) . '"[^>]*\bhref="([^"]+)"/i', $html, $m ) || preg_match( '/<link[^>]*\bhref="([^"]+)"[^>]*\bid="' . preg_quote( $id, '/' ) . '"/i', $html, $m ) ) {
				$preload .= '<link rel="preload" as="style" href="' . esc_url( $m[1] ) . '">';
			}
		}
		$style = '<style id="sml-pp-css">'
			. 'html.sml-pp{background:#080d15!important}'
			. 'html.sml-pp body{visibility:hidden;animation:smlPpReveal .01s linear 2.5s forwards}'
			. '@keyframes smlPpReveal{to{visibility:visible}}'
			. '</style>';

		/* class="sml-pp" on <html> (merge into an existing class attribute if present) */
		$html = preg_replace_callback( '/<html(\s[^>]*)?>/i', static function ( $t ) {
			$attrs = isset( $t[1] ) ? $t[1] : '';
			if ( preg_match( '/\sclass="([^"]*)"/i', $attrs ) ) { $attrs = preg_replace( '/\sclass="([^"]*)"/i', ' class="$1 sml-pp"', $attrs, 1 ); }
			else { $attrs .= ' class="sml-pp"'; }
			return '<html' . $attrs . '>';
		}, $html, 1 );

		/* locate <head> AFTER the <html> rewrite above — that rewrite lengthens the
		   string, and an offset captured before it would land inside the class attr */
		if ( ! preg_match( '/<head(\s[^>]*)?>/i', $html, $hm, PREG_OFFSET_CAPTURE ) ) { return $html; }
		$at = $hm[0][1] + strlen( $hm[0][0] );
		return substr( $html, 0, $at ) . $style . $preload . substr( $html, $at );
	}
	add_action( 'init', static function () { if ( sml_pp_active() ) { ob_start( 'sml_pp_ob' ); } }, -1 );
}
