/**
 * SML Creator Gate — site-wide account-menu loader and gated-page enforcer.
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet; it owns no stored creator data.
 *
 * 2026-08-18 hardening (adversarial audit):
 *  - Gated-path match now NORMALIZES the URL (decode, lowercase, collapse
 *    slashes) — /Upload-Video/, /go-live//, percent-encoded variants used to
 *    be served with no gate at all.
 *  - The gate no longer depends on the CDN script running. Server-side:
 *      logged-out on a gated path      → redirect to login (and back)
 *      no Channel on /go-live/, /upload-video/ → redirect to /create-channel/
 *      no Channel/Letter on /creator-studio/   → the blocking overlay is
 *        rendered INTO the HTML (works with JS off / CDN blocked); the enforce
 *        script takes over the same #sml-cg-block when it runs.
 *    Entitlement mirrors sml-creator-gate/v1/status: hasChannel = user meta
 *    sml_channel_handle, hasLetter = user meta smll_handle (entitlement only —
 *    per the 2026-08-18 decision no registration data is required).
 *  - REST/AJAX detection at init is by URL (REST_REQUEST is not defined yet
 *    at init) and the buffer callback bails on non-HTML responses.
 */
if ( ! function_exists( 'sml_cg_loader_is_gated_path' ) ) {
	function sml_cg_loader_norm_path() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		$path = strtolower( rawurldecode( $path ) );
		$path = preg_replace( '#/+#', '/', $path );
		return rtrim( $path, '/' ) . '/';
	}
	function sml_cg_loader_gate_kind() {
		$path = sml_cg_loader_norm_path();
		if ( preg_match( '#^/(go-live|upload-video)/#', $path ) ) { return 'channel'; }
		// the analytics dashboard scopes itself per user (group members without a
		// Channel/Letter still see their group analytics) — never gated
		if ( preg_match( '#^/creator-studio/analytics/#', $path ) ) { return ''; }
		if ( preg_match( '#^/creator-studio/#', $path ) ) { return 'either'; }
		return '';
	}
	function sml_cg_loader_is_gated_path() { return '' !== sml_cg_loader_gate_kind(); }

	function sml_cg_loader_is_non_page_request() {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( 0 === strpos( $uri, '/wp-json/' ) || false !== strpos( $uri, '/wp-json/' ) || isset( $_GET['rest_route'] ) ) { return true; }
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) || ( defined( 'DOING_CRON' ) && DOING_CRON ) || ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) ) { return true; }
		if ( false !== strpos( $uri, '/wp-admin/' ) || false !== strpos( $uri, '/xmlrpc.php' ) || false !== strpos( $uri, '/wp-cron.php' ) ) { return true; }
		return false;
	}

	function sml_cg_loader_active() {
		if ( sml_cg_loader_is_non_page_request() ) { return false; }
		return is_user_logged_in() || sml_cg_loader_is_gated_path();
	}

	function sml_cg_loader_ref() {
		return function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main';
	}

	/* entitlement — same meta the status route reads */
	function sml_cg_loader_entitled( $kind ) {
		$uid = get_current_user_id();
		if ( ! $uid ) { return false; }
		$has_channel = '' !== (string) get_user_meta( $uid, 'sml_channel_handle', true );
		if ( 'channel' === $kind ) { return $has_channel; }
		$has_letter = '' !== (string) get_user_meta( $uid, 'smll_handle', true );
		return $has_channel || $has_letter;
	}

	function sml_cg_loader_markup() {
		$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( sml_cg_loader_ref() ) . '/js/';
		$nonce = wp_create_nonce( 'wp_rest' );
		$config = '<script id="sml-cg-config">window.SML_CG_NONCE=' . wp_json_encode( $nonce )
			. ';window.SML_CG_ME=' . ( is_user_logged_in() ? 'true' : 'false' ) . ';</script>';
		$scripts = '<script id="sml-cg-js" data-nonce="' . esc_attr( $nonce ) . '" data-me="'
			. ( is_user_logged_in() ? '1' : '0' ) . '" src="' . esc_url( $base . 'creator-gate.js' ) . '"></script>';
		if ( sml_cg_loader_is_gated_path() ) {
			$scripts .= '<script id="sml-cg-enforce-js" src="' . esc_url( $base . 'creator-gate-enforce.js' ) . '"></script>';
		}
		return $config . $scripts;
	}

	/* server-rendered gate for /creator-studio/ (Channel OR Letter) — no JS needed to block;
	   creator-gate-enforce.js replaces this same #sml-cg-block when it runs. */
	function sml_cg_loader_server_gate() {
		$s_wrap  = 'position:fixed;inset:0;z-index:2147482000;background:#04060a;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Archivo,sans-serif';
		$s_box   = 'max-width:420px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px';
		$s_kick  = 'font:700 9px/1 Archivo,sans-serif;letter-spacing:.14em;color:#5d7085';
		$s_h     = 'font:800 20px/1.3 Archivo,sans-serif;color:#e6edf3;margin:0';
		$s_p     = 'font:400 12px/1.6 Archivo,sans-serif;color:#8fa3b5;margin:0';
		$s_row   = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center';
		$s_cta   = 'display:inline-block;font:700 12px/1 Archivo,sans-serif;color:#04060a;background:#00ff88;border:none;border-radius:8px;padding:14px 22px;cursor:pointer;text-decoration:none';
		$s_cta2  = 'font:700 12px/1 Archivo,sans-serif;color:#e6edf3;background:#101923;border:1px solid #2a3a49;border-radius:8px;padding:14px 22px;cursor:pointer';
		$s_back  = 'font:600 11px/1 Archivo,sans-serif;color:#5d7085;text-decoration:none';
		return '<div id="sml-cg-block" data-sml-cg-server="1" role="dialog" aria-modal="true" aria-label="Creator requirement" style="' . $s_wrap . '">'
			. '<div style="' . $s_box . '">'
			. '<span style="' . $s_kick . '">CREATOR REQUIREMENT</span>'
			. '<h2 style="' . $s_h . '">You need a Loop Channel or Loop Letter to continue</h2>'
			. '<p style="' . $s_p . '">Pick a handle to get started.</p>'
			. '<div style="' . $s_row . '">'
			. '<a id="sml-cg-block-channel" href="' . esc_url( home_url( '/create-channel/' ) ) . '" style="' . $s_cta . '">Create a Loop Channel</a>'
			. '<button id="sml-cg-block-letter" type="button" style="' . $s_cta2 . '">Create a Loop Letter</button>'
			. '</div>'
			. '<a href="' . esc_url( home_url( '/' ) ) . '" style="' . $s_back . '">&larr; Back to home</a>'
			. '<noscript><p style="' . $s_p . '">Enable JavaScript to create a Loop Letter here, or use Create a Loop Channel.</p></noscript>'
			. '</div></div>';
	}

	function sml_cg_loader_ob( $html ) {
		if ( ! is_string( $html ) || false === strripos( $html, '</body>' ) || false !== strpos( $html, 'id="sml-cg-js"' ) ) {
			return $html;
		}
		// non-HTML responses (JSON, feeds, files) must never be touched
		foreach ( headers_list() as $h ) {
			if ( 0 === stripos( $h, 'content-type:' ) && false === stripos( $h, 'text/html' ) ) { return $html; }
		}
		$out = $html;
		$kind = sml_cg_loader_gate_kind();
		if ( 'either' === $kind && is_user_logged_in() && ! sml_cg_loader_entitled( $kind ) && false === strpos( $out, 'data-sml-cg-server="1"' ) ) {
			// server-rendered gate right after <body ...> so it blocks even with JS off
			if ( preg_match( '/<body\b[^>]*>/i', $out, $m, PREG_OFFSET_CAPTURE ) ) {
				$at = $m[0][1] + strlen( $m[0][0] );
				$out = substr( $out, 0, $at ) . sml_cg_loader_server_gate() . substr( $out, $at );
			}
		}
		$pos = strripos( $out, '</body>' );
		return substr( $out, 0, $pos ) . sml_cg_loader_markup() . substr( $out, $pos );
	}

	add_action( 'init', static function () {
		if ( ! sml_cg_loader_active() ) { return; }
		$kind = sml_cg_loader_gate_kind();
		if ( '' !== $kind ) {
			// SERVER-SIDE ENFORCEMENT — does not depend on the CDN script running.
			$path = sml_cg_loader_norm_path();
			if ( ! is_user_logged_in() ) {
				wp_safe_redirect( wp_login_url( home_url( $path ) ) );
				exit;
			}
			if ( 'channel' === $kind && ! sml_cg_loader_entitled( 'channel' ) ) {
				// Go Live / Upload need a Loop Channel: send them to the create page
				// (the create page sends them straight back to /go-live/ when done)
				wp_safe_redirect( home_url( '/create-channel/' ) );
				exit;
			}
			nocache_headers(); // gated pages must never come from a page cache
		}
		ob_start( 'sml_cg_loader_ob' );
	}, 0 );
}
