/**
 * SML Home Engagement — batch counts endpoint (performance phase 3).
 *
 * The homepage fired ONE HTTP request per feed card to
 * /sml-home-engagement/v1/counts (18+ concurrent calls, observed queueing to
 * 15s). This route accepts the same lookups in one round-trip:
 *   POST /wp-json/sml-home-engagement/v1/counts-batch  {items:[{item_id,url},…]}
 * Each item is dispatched INTERNALLY to the plugin's existing counts route as
 * the current user, so the plugin's own logic and permission checks stay the
 * single source of truth. Read-only; max 30 items; unknown items return null.
 * ROLLBACK: deactivate — the client falls back to single calls automatically.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_hec_batch' ) ) {

	function sml_hec_batch( WP_REST_Request $req ) {
		$items = $req->get_param( 'items' );
		if ( ! is_array( $items ) || ! $items ) {
			return new WP_Error( 'sml_hec_items', 'items required', array( 'status' => 400 ) );
		}
		$items = array_slice( array_values( $items ), 0, 30 );
		$out   = array();
		foreach ( $items as $it ) {
			if ( ! is_array( $it ) ) { $out[] = null; continue; }
			$r = new WP_REST_Request( 'GET', '/sml-home-engagement/v1/counts' );
			if ( isset( $it['item_id'] ) ) { $r->set_param( 'item_id', sanitize_text_field( (string) $it['item_id'] ) ); }
			if ( isset( $it['url'] ) ) { $r->set_param( 'url', esc_url_raw( (string) $it['url'] ) ); }
			$res   = rest_do_request( $r );
			$out[] = ( $res instanceof WP_REST_Response && ! $res->is_error() ) ? $res->get_data() : null;
		}
		$resp = rest_ensure_response( array( 'ok' => true, 'results' => $out ) );
		$resp->header( 'Cache-Control', 'private, max-age=10' );
		return $resp;
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-home-engagement/v1', '/counts-batch', array(
			'methods'             => 'POST',
			'callback'            => 'sml_hec_batch',
			/* mirrors the underlying public counts route; every internal dispatch
			   re-runs that route's own permission checks as the current user */
			'permission_callback' => '__return_true',
		) );
	} );
}
