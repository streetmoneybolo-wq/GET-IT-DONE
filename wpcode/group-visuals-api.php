/**
 * SML Group Visuals — the MISSING server half of the group editor's
 * "Group chat watermark" + header-banner controls.
 *
 * The groups front-end (gshell renderer + owner editor) already ships:
 *   POST /sml/v1/group/watermark      {group_id, attachment_id, opacity}
 *   POST /sml/v1/group/header-banner  {group_id, opacity, height}
 * …and renders `group.watermark {url,opacity}` + `group.header_banner
 * {opacity,height}` from GET /sml/v1/group. None of that existed server-side
 * (rest_no_route 404 → "it don't save"). This snippet adds the two save routes
 * (manager-only, verified through the group API's own can_manage) and injects
 * the saved fields into the existing GET /sml/v1/group response.
 *
 * Storage: option sml_group_visuals_{id} — independent of how the groups
 * plugin stores its own data. ROLLBACK: deactivate; nothing else is touched.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_gvz_can_manage' ) ) {

	function sml_gvz_can_manage( $group_id ) {
		if ( ! get_current_user_id() ) { return false; }
		$req = new WP_REST_Request( 'GET', '/sml/v1/group' );
		$req->set_param( 'group_id', $group_id );
		$res = rest_do_request( $req );
		if ( is_wp_error( $res ) || $res->is_error() ) { return false; }
		$data = $res->get_data();
		$g    = ( is_array( $data ) && isset( $data['group'] ) ) ? $data['group'] : $data;
		return is_array( $g ) && ( ! empty( $g['can_manage'] ) || ! empty( $g['can_edit_owner_tools'] ) );
	}

	function sml_gvz_get( $group_id ) {
		$v = get_option( 'sml_group_visuals_' . absint( $group_id ), array() );
		return is_array( $v ) ? $v : array();
	}

	function sml_gvz_rest_watermark( WP_REST_Request $request ) {
		$gid = absint( $request->get_param( 'group_id' ) );
		if ( ! $gid ) { return new WP_Error( 'sml_gvz_group', 'Group is required.', array( 'status' => 400 ) ); }
		if ( ! sml_gvz_can_manage( $gid ) ) { return new WP_Error( 'sml_gvz_forbidden', 'Only group managers can change the watermark.', array( 'status' => 403 ) ); }
		$att     = absint( $request->get_param( 'attachment_id' ) );
		$opacity = max( 0, min( 100, (int) $request->get_param( 'opacity' ) ) );
		$url     = $att ? (string) wp_get_attachment_url( $att ) : '';
		$vis     = sml_gvz_get( $gid );
		if ( $att && $url ) {
			$vis['watermark'] = array( 'attachment_id' => $att, 'url' => esc_url_raw( $url ), 'opacity' => $opacity );
		} else {
			unset( $vis['watermark'] ); // attachment 0 = Remove
		}
		update_option( 'sml_group_visuals_' . $gid, $vis, false );
		return rest_ensure_response( array( 'ok' => true, 'watermark' => isset( $vis['watermark'] ) ? $vis['watermark'] : null ) );
	}

	function sml_gvz_rest_header_banner( WP_REST_Request $request ) {
		$gid = absint( $request->get_param( 'group_id' ) );
		if ( ! $gid ) { return new WP_Error( 'sml_gvz_group', 'Group is required.', array( 'status' => 400 ) ); }
		if ( ! sml_gvz_can_manage( $gid ) ) { return new WP_Error( 'sml_gvz_forbidden', 'Only group managers can change the header banner.', array( 'status' => 403 ) ); }
		$opacity = max( 0, min( 100, (int) $request->get_param( 'opacity' ) ) );
		$height  = max( 53, min( 600, (int) ( $request->get_param( 'height' ) ?: 61 ) ) );
		$vis     = sml_gvz_get( $gid );
		$vis['header_banner'] = array( 'opacity' => $opacity, 'height' => $height );
		update_option( 'sml_group_visuals_' . $gid, $vis, false );
		return rest_ensure_response( array( 'ok' => true, 'header_banner' => $vis['header_banner'] ) );
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml/v1', '/group/watermark', array(
			'methods'             => 'POST',
			'callback'            => 'sml_gvz_rest_watermark',
			'permission_callback' => static function () { return is_user_logged_in(); },
		) );
		register_rest_route( 'sml/v1', '/group/header-banner', array(
			'methods'             => 'POST',
			'callback'            => 'sml_gvz_rest_header_banner',
			'permission_callback' => static function () { return is_user_logged_in(); },
		) );
	} );

	/* READ side: inject the saved visuals into the group payload the chat shell
	   already renders from (GET /sml/v1/group). */
	add_filter( 'rest_post_dispatch', static function ( $result, $server, $request ) {
		if ( ! ( $result instanceof WP_REST_Response ) || ! ( $request instanceof WP_REST_Request ) ) { return $result; }
		if ( 'GET' !== $request->get_method() || '/sml/v1/group' !== $request->get_route() ) { return $result; }
		$data = $result->get_data();
		if ( ! is_array( $data ) ) { return $result; }
		$wrapped = isset( $data['group'] ) && is_array( $data['group'] );
		$g       = $wrapped ? $data['group'] : $data;
		$gid     = isset( $g['id'] ) ? absint( $g['id'] ) : 0;
		if ( ! $gid ) { return $result; }
		$vis                 = sml_gvz_get( $gid );
		$g['watermark']      = isset( $vis['watermark'] ) ? $vis['watermark'] : null;
		$g['header_banner']  = isset( $vis['header_banner'] ) ? $vis['header_banner'] : null;
		if ( $wrapped ) { $data['group'] = $g; } else { $data = $g; }
		$result->set_data( $data );
		return $result;
	}, 10, 3 );
}
