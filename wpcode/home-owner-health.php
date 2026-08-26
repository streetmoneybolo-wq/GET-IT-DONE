/**
 * SML Home Owner Health — admin-only homepage-ownership diagnostic.
 *
 *   GET /wp-json/sml-home/v2/health   (manage_options only)
 *
 * Answers, with runtime evidence, WHO currently owns the optimized homepage:
 * for each critical function it reports whether the live definition comes from
 * a real plugin file ("plugin:<dir>") or from a WPCode snippet ("wpcode-snippet"
 * — WPCode executes snippet bodies from class-wpcode-* so the reflected file
 * name contains "wpcode"). `single_owner` is true only when the whole
 * sml_oh_* trio is defined by exactly one source and none are missing.
 *
 * Born from the 2026-08 incident where the optimized-home plugin vanished from
 * the plugin list and recovery snippet 7387 silently took over: this route
 * makes that state visible instead of guessable. Read-only; no secrets, no
 * absolute paths, never publicly cached. Rollback: deactivate this snippet.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_home_owner_health' ) ) {

	function sml_home_owner_health() {
		$fns = array(
			'sml_oh_is_home',              // homepage gate
			'sml_oh_render',               // renderer
			'sml_oh_standalone_response',  // standalone document + controller tag
			'sml_sth_feed_payload',        // feed data provider (Social Trading Home)
		);
		$owner = array();
		foreach ( $fns as $fn ) {
			if ( ! function_exists( $fn ) ) { $owner[ $fn ] = 'missing'; continue; }
			try {
				$rf   = new ReflectionFunction( $fn );
				$file = (string) $rf->getFileName();
				if ( false !== stripos( $file, 'wpcode' ) ) {
					$owner[ $fn ] = 'wpcode-snippet';
				} elseif ( false !== strpos( $file, DIRECTORY_SEPARATOR . 'plugins' . DIRECTORY_SEPARATOR )
					|| false !== strpos( $file, '/plugins/' ) ) {
					$owner[ $fn ] = 'plugin:' . basename( dirname( $file ) );
				} else {
					$owner[ $fn ] = 'other';
				}
			} catch ( \Throwable $e ) {
				$owner[ $fn ] = 'unknown';
			}
		}
		/* single-owner assertion over the renderer trio (payload provider is a
		   separate, legitimate owner — the data layer) */
		$trio    = array( $owner['sml_oh_is_home'], $owner['sml_oh_render'], $owner['sml_oh_standalone_response'] );
		$sources = array_values( array_unique( $trio ) );
		$single  = ( 1 === count( $sources ) && 'missing' !== $sources[0] );

		$resp = rest_ensure_response( array(
			'ok'           => true,
			'generated'    => gmdate( 'c' ),
			'owner'        => $owner,
			'single_owner' => $single,
			'renderer'     => $single ? $sources[0] : 'SPLIT: ' . implode( ' + ', $sources ),
		) );
		$resp->header( 'Cache-Control', 'private, no-store' );
		return $resp;
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-home/v2', '/health', array(
			'methods'             => 'GET',
			'callback'            => 'sml_home_owner_health',
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
		) );
	} );
}
