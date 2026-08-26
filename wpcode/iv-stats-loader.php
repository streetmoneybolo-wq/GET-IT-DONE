/**
 * SML Charts: Moomoo interval stats (Shift+drag) — v2 loader.
 *
 * REPLACES the old inline version of snippet #5865. The interval-stats script
 * itself now lives on the CDN (js/iv-stats.js — byte-identical to the old
 * inline copy, host poll extended), so future fixes deploy via git push like
 * every other module.
 *
 * WHY v2: the old snippet only injected when the SERVER HTML contained
 * 'sml-lc-canvas-host' — but the group Analyst Dashboard / Live Chart mounts
 * its LoopCharts host via JavaScript, so the marker is never in the HTML and
 * the feature never reached those pages (verified live: the dashboard has the
 * host and the window.__smlSel bridge at runtime, but no injected script).
 * v2 also injects by URL on /analyst-dashboard/ and /groups/ pages. The
 * script is inert on pages where no LoopCharts host ever appears.
 *
 * HOOK CHOICE: init priority 0, NOT template_redirect — the analyst-dashboard
 * page is itself rendered by a snippet that echoes and exits at
 * template_redirect priority 0, so a later-registered buffer never wraps it
 * (this is the second reason the old version never reached that page).
 * An init-time ob_start wraps everything, including custom-route output.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere (replace #5865's
 * contents with this).
 * ROLLBACK: restore #5865's previous revision from WPCode's revision history.
 */
add_action( 'init', function () {
	if ( is_admin() ) {
		return;
	}
	$uri0 = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
	if ( false !== strpos( $uri0, '/wp-json/' ) || false !== strpos( $uri0, '/wp-admin/' ) ) {
		return;
	}
	if ( defined( 'DOING_AJAX' ) && DOING_AJAX ) {
		return;
	}
	ob_start( function ( $html ) {
		if ( ! is_string( $html ) || stripos( $html, '</body>' ) === false ) {
			return $html;
		}
		if ( false !== strpos( $html, 'id="sml-iv-stats-js"' ) ) {
			return $html; // idempotent
		}
		$uri       = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
		$uri_match = ( false !== stripos( $uri, '/analyst-dashboard' ) ) || ( false !== stripos( $uri, '/groups/' ) );
		if ( ! $uri_match && stripos( $html, 'sml-lc-canvas-host' ) === false && stripos( $html, 'sml-chart' ) === false ) {
			return $html;
		}
		$ref = function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main';
		$js  = '<script id="sml-iv-stats-js" defer src="https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . esc_attr( $ref ) . '/js/iv-stats.js"></script>';
		return str_ireplace( '</body>', $js . '</body>', $html );
	} );
}, 0 );
