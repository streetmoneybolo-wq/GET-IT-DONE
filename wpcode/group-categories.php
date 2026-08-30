/**
 * SML Group Categories — freely nameable Discord-style channel categories.
 *
 * COMPANION LAYER, deliberately independent of both the groups engine and the
 * dormant Channel Admin 0.2 plugin: the owner/admin names categories
 * (Announcements, Onboarding, Video, News, anything) and assigns channels to
 * them; js/group-categories.js regroups the existing sidebar under those
 * headers. Nothing here alters the engine's tables, channels, or messages —
 * storage is one wp option per group (autoload off), and deleting the option
 * simply restores the native grouping.
 *
 * REST (namespace sml-gcat/v1):
 *   GET  /group?slug={slug}  -> { group_id, can_manage, categories, assignments }
 *        Public read (the sidebar renders for every member); can_manage is
 *        computed for the CURRENT user (owner_id on {prefix}sml_groups, or an
 *        admin row in {prefix}sml_group_members — same tables and role rules
 *        the engine itself uses).
 *   POST /group?slug={slug}  -> save { categories:[names], assignments:{channel_id:name} }
 *        Owner/admin only, cookie auth + X-WP-Nonce (wp_rest). Input is
 *        sanitized hard: <=30 categories, names <=40 chars stripped of tags,
 *        assignment keys forced to ints, values must be declared categories.
 *
 * Also injects (via the same init@0 output-buffer pattern as the site's other
 * loaders) the CDN script tag + a wp_rest nonce on /groups/{slug} pages only.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate — sidebar returns to native grouping; per-group options
 * (sml_gcat_{id}) remain stored but unused; delete them only if asked.
 */
if ( ! function_exists( 'sml_gcat_group_by_slug' ) ) {

	function sml_gcat_group_by_slug( $slug ) {
		global $wpdb;
		$slug = sanitize_title( (string) $slug );
		if ( '' === $slug ) { return null; }
		$row = $wpdb->get_row( $wpdb->prepare(
			"SELECT id, owner_id FROM {$wpdb->prefix}sml_groups WHERE slug = %s LIMIT 1", $slug
		) );
		return $row ? array( 'id' => (int) $row->id, 'owner_id' => (int) $row->owner_id ) : null;
	}

	function sml_gcat_role( $group ) {
		if ( ! is_array( $group ) || empty( $group['id'] ) ) { return ''; }
		$uid = get_current_user_id();
		if ( ! $uid ) { return ''; }
		if ( ! empty( $group['owner_id'] ) && (int) $group['owner_id'] === $uid ) { return 'owner'; }
		global $wpdb;
		$role = strtolower( trim( (string) $wpdb->get_var( $wpdb->prepare(
			"SELECT role FROM {$wpdb->prefix}sml_group_members WHERE group_id = %d AND user_id = %d",
			(int) $group['id'], $uid
		) ) ) );
		if ( 'mod' === $role ) { $role = 'moderator'; }
		return in_array( $role, array( 'owner', 'admin', 'moderator', 'member' ), true ) ? $role : '';
	}

	function sml_gcat_can_manage( $group ) {
		return in_array( sml_gcat_role( $group ), array( 'owner', 'admin' ), true );
	}

	/** Category names may describe paid/private group structure — only people
	 *  who can actually see the sidebar (any member, plus the owner) may read
	 *  them. Everyone else gets empty arrays, never an error. */
	function sml_gcat_can_view( $group ) {
		return '' !== sml_gcat_role( $group );
	}

	/** One sanitation pipeline for category names, applied identically to the
	 *  declared list AND to assignment values so a trim/normalization mismatch
	 *  can never silently orphan assignments. Byte-capped (mb_strcut 160B) on
	 *  top of the 40-code-point cap so emoji names can't balloon the option. */
	function sml_gcat_clean_name( $name ) {
		if ( ! is_string( $name ) ) { return ''; }
		$name = trim( wp_strip_all_tags( $name ) );
		if ( '' === $name ) { return ''; }
		if ( function_exists( 'mb_substr' ) ) { $name = mb_substr( $name, 0, 40 ); } else { $name = substr( $name, 0, 40 ); }
		if ( function_exists( 'mb_strcut' ) && strlen( $name ) > 160 ) { $name = mb_strcut( $name, 0, 160 ); }
		return trim( $name );
	}

	function sml_gcat_read( $group_id ) {
		$data = get_option( 'sml_gcat_' . (int) $group_id, array() );
		if ( ! is_array( $data ) ) { $data = array(); }
		$cats = ( isset( $data['categories'] ) && is_array( $data['categories'] ) ) ? array_values( array_map( 'strval', $data['categories'] ) ) : array();
		$asgn = ( isset( $data['assignments'] ) && is_array( $data['assignments'] ) ) ? $data['assignments'] : array();
		$clean = array();
		foreach ( $asgn as $cid => $cat ) {
			$cid = (int) $cid;
			if ( $cid > 0 && is_string( $cat ) && in_array( $cat, $cats, true ) ) { $clean[ (string) $cid ] = $cat; }
		}
		return array( 'categories' => $cats, 'assignments' => $clean );
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-gcat/v1', '/group', array(
			array(
				'methods'             => 'GET',
				'permission_callback' => '__return_true', // gating happens inside: non-members get empty arrays, not data or a slug oracle
				'callback'            => static function ( $req ) {
					$group = sml_gcat_group_by_slug( $req->get_param( 'slug' ) );
					if ( ! $group || ! sml_gcat_can_view( $group ) ) {
						// unknown slug and non-member look identical on purpose;
						// group_id is deliberately not exposed anywhere
						return array( 'categories' => array(), 'assignments' => (object) array(), 'can_manage' => false );
					}
					$out               = sml_gcat_read( $group['id'] );
					$out['can_manage'] = sml_gcat_can_manage( $group );
					return $out;
				},
			),
			array(
				'methods'             => 'POST',
				'permission_callback' => static function ( $req ) {
					$group = sml_gcat_group_by_slug( $req->get_param( 'slug' ) );
					return $group && sml_gcat_can_manage( $group ); // cookie auth + X-WP-Nonce enforced by core for logged-in writes
				},
				'callback'            => static function ( $req ) {
					$group = sml_gcat_group_by_slug( $req->get_param( 'slug' ) );
					if ( ! $group ) { return new WP_Error( 'sml_gcat_no_group', 'Unknown group.', array( 'status' => 404 ) ); }
					$body = $req->get_json_params();
					if ( ! is_array( $body ) ) { $body = array(); }

					$cats_in = ( isset( $body['categories'] ) && is_array( $body['categories'] ) ) ? $body['categories'] : array();
					$cats    = array();
					foreach ( $cats_in as $name ) {
						$name = sml_gcat_clean_name( $name );
						if ( '' === $name || in_array( $name, $cats, true ) ) { continue; }
						$cats[] = $name;
						if ( count( $cats ) >= 30 ) { break; }
					}

					$asgn_in = ( isset( $body['assignments'] ) && is_array( $body['assignments'] ) ) ? $body['assignments'] : array();
					$asgn    = array();
					foreach ( $asgn_in as $cid => $cat ) {
						$cid = (int) $cid;
						// same cleaning pipeline as the declared names — a client-side
						// trim/normalization difference must never orphan assignments
						$cat = sml_gcat_clean_name( $cat );
						if ( $cid > 0 && $cid < 100000000 && '' !== $cat && in_array( $cat, $cats, true ) && count( $asgn ) < 500 ) {
							$asgn[ (string) $cid ] = $cat;
						}
					}

					update_option( 'sml_gcat_' . $group['id'], array(
						'categories'  => $cats,
						'assignments' => $asgn,
						'updated'     => time(),
					), false );

					return array( 'saved' => true, 'categories' => $cats, 'assignments' => $asgn );
				},
			),
		) );
	} );

	/* ---------- loader: script + nonce on /groups/{slug} pages only ---------- */
	add_action( 'init', static function () {
		if ( is_admin() || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return; }
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false !== strpos( $uri, '/wp-json/' ) || false !== strpos( $uri, '/wp-admin/' ) ) { return; }
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		if ( ! preg_match( '#^/groups/[^/]+/?$#', $path ) ) { return; }
		ob_start( static function ( $html ) {
			if ( ! is_string( $html ) || '' === $html || false === stripos( $html, '</body>' ) ) { return $html; }
			if ( false !== strpos( $html, 'id="sml-gcat-js"' ) ) { return $html; } // idempotent
			foreach ( headers_list() as $hh ) {
				if ( 0 === stripos( $hh, 'content-type:' ) && false === stripos( $hh, 'text/html' ) ) { return $html; }
			}
			$ref = function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main';
			// nonce for EVERY logged-in user (not just managers): the bootstrap
			// GET needs it or core demotes the cookie session to user 0 and even
			// members lose their gated read; it grants nothing they don't have
			$nonce = is_user_logged_in() ? wp_create_nonce( 'wp_rest' ) : '';
			$tag   = '';
			if ( $nonce ) { $tag .= '<script id="sml-gcat-nonce">window.SML_GCAT_NONCE=' . wp_json_encode( $nonce ) . ';</script>'; }
			$tag  .= '<script id="sml-gcat-js" defer src="https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . esc_attr( $ref ) . '/js/group-categories.js"></script>';
			return str_ireplace( '</body>', $tag . '</body>', $html );
		} );
	}, 0 );
}
