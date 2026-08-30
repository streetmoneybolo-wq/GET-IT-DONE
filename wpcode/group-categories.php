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
 *   POST /channel?slug={slug} -> rename { channel_id, name }
 *        The engine has create/delete endpoints (sml/v1/group/channel/create)
 *        but NO rename — this fills that one gap, updating ONLY the `name`
 *        column of {prefix}sml_group_channels (VARCHAR(120), sanitized the
 *        same way the engine's create sanitizes). Same manager gate. NOTE:
 *        the engine restricts posting in any channel whose name or type
 *        contains "alert" — a rename can change who may post, by design.
 *   POST /reorder?slug={slug} -> { order: [channel_id, ...] }
 *        Persists the manager's ↑/↓ channel order into the ENGINE's own
 *        order_index column — its sidebar and channels endpoint both sort
 *        ORDER BY order_index ASC, id ASC, and its create endpoint appends
 *        at MAX(order_index)+1, so writing the list position as the index
 *        is exactly the engine's own scheme. Every submitted id must belong
 *        to THIS group (same cross-group guard as rename); channels not in
 *        the list (e.g. created after the panel loaded) keep their index.
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

	/** Raw membership-row role, or null when the user has no row at all. */
	function sml_gcat_member_role( $group ) {
		if ( ! is_array( $group ) || empty( $group['id'] ) ) { return null; }
		$uid = get_current_user_id();
		if ( ! $uid ) { return null; }
		global $wpdb;
		$role = $wpdb->get_var( $wpdb->prepare(
			"SELECT role FROM {$wpdb->prefix}sml_group_members WHERE group_id = %d AND user_id = %d",
			(int) $group['id'], $uid
		) );
		return null === $role ? null : strtolower( trim( (string) $role ) );
	}

	/** Mirrors the ENGINE's manage rule (verified live: sml/v1/group grants
	 *  can_manage to site admins even when owner_id is another account —
	 *  a row-owner-only check locks the admin out of the gear). Order:
	 *  site admin -> engine's own function when exposed -> row owner ->
	 *  owner/admin membership role. Moderators/members never manage. */
	function sml_gcat_can_manage( $group ) {
		if ( ! is_array( $group ) || empty( $group['id'] ) ) { return false; }
		$uid = get_current_user_id();
		if ( ! $uid ) { return false; }
		if ( current_user_can( 'manage_options' ) ) { return true; }
		if ( function_exists( 'sml_groups_current_user_can_manage' ) && sml_groups_current_user_can_manage( (int) $group['id'], $uid ) ) { return true; }
		if ( ! empty( $group['owner_id'] ) && (int) $group['owner_id'] === $uid ) { return true; }
		return in_array( (string) sml_gcat_member_role( $group ), array( 'owner', 'admin' ), true );
	}

	/** Category names may describe paid/private group structure — only people
	 *  who can actually see the sidebar may read them. ANY membership row
	 *  counts (don't interpret the role string — an unexpected value must not
	 *  blind a real member), plus managers. Everyone else gets empty arrays,
	 *  never an error. */
	function sml_gcat_can_view( $group ) {
		if ( null !== sml_gcat_member_role( $group ) ) { return true; }
		return sml_gcat_can_manage( $group );
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

	/**
	 * Canonical channel sequence from the groups engine. The client uses this
	 * to give every channel ID a unique CSS order; DOM insertion timing is never
	 * allowed to break an ordering tie.
	 */
	function sml_gcat_channel_order( $group_id ) {
		global $wpdb;
		$rows = $wpdb->get_col( $wpdb->prepare(
			"SELECT id FROM {$wpdb->prefix}sml_group_channels
			 WHERE group_id = %d ORDER BY order_index ASC, id ASC",
			(int) $group_id
		) );
		return array_values( array_map( 'intval', (array) $rows ) );
	}

	/** Optimistic-lock token for one complete sidebar layout snapshot. */
	function sml_gcat_layout_revision( $group_id ) {
		return hash( 'sha256', wp_json_encode( array(
			'layout' => sml_gcat_read( $group_id ),
			'order'  => sml_gcat_channel_order( $group_id ),
		) ) );
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
						return array( 'categories' => array(), 'assignments' => (object) array(), 'channel_order' => array(), 'can_manage' => false );
					}
					$out               = sml_gcat_read( $group['id'] );
					$out['channel_order'] = sml_gcat_channel_order( $group['id'] );
					$out['layout_revision'] = sml_gcat_layout_revision( $group['id'] );
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

					return array(
						'saved'        => true,
						'categories'   => $cats,
						'assignments'  => $asgn,
						'channel_order'=> sml_gcat_channel_order( $group['id'] ),
					);
				},
			),
		) );

		/*
		 * Atomic Discord-style layout save. Categories, assignments and the
		 * canonical channel sequence are one unit; no split-brain partial save.
		 */
		register_rest_route( 'sml-gcat/v1', '/layout', array(
			array(
				'methods'             => 'POST',
				'permission_callback' => static function ( $req ) {
					$group = sml_gcat_group_by_slug( $req->get_param( 'slug' ) );
					return $group && sml_gcat_can_manage( $group );
				},
				'callback'            => static function ( $req ) {
					global $wpdb;
					$group = sml_gcat_group_by_slug( $req->get_param( 'slug' ) );
					if ( ! $group ) { return new WP_Error( 'sml_gcat_no_group', 'Unknown group.', array( 'status' => 404 ) ); }
					$body = $req->get_json_params();
					if ( ! is_array( $body ) ) { $body = array(); }
					$lock_name = 'sml_gcat_layout_' . (int) $group['id'];
					$locked = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 5)', $lock_name ) );
					if ( 1 !== $locked ) {
						return new WP_Error( 'sml_gcat_layout_busy', 'Another layout save is still running. Try again.', array( 'status' => 409 ) );
					}

					try {

					$base = isset( $body['base_revision'] ) ? (string) $body['base_revision'] : '';
					// Recompute only AFTER acquiring the per-group lock. Two owners
					// clicking Save together are serialized, and the second request
					// sees the first request's new revision instead of overwriting it.
					$now  = sml_gcat_layout_revision( $group['id'] );
					if ( '' === $base || ! hash_equals( $now, $base ) ) {
						return new WP_Error( 'sml_gcat_layout_conflict', 'The channel layout changed in another session. Reload before saving.', array( 'status' => 409, 'revision' => $now ) );
					}

					$cats = array();
					foreach ( ( isset( $body['categories'] ) && is_array( $body['categories'] ) ) ? $body['categories'] : array() as $name ) {
						$name = sml_gcat_clean_name( $name );
						if ( '' === $name || in_array( $name, $cats, true ) ) { continue; }
						$cats[] = $name;
						if ( count( $cats ) >= 30 ) { break; }
					}

					$current = sml_gcat_channel_order( $group['id'] );
					$order   = array();
					foreach ( ( isset( $body['order'] ) && is_array( $body['order'] ) ) ? $body['order'] : array() as $cid ) {
						$cid = (int) $cid;
						if ( $cid > 0 && ! in_array( $cid, $order, true ) ) { $order[] = $cid; }
					}
					$expect = $current; $got = $order;
					sort( $expect, SORT_NUMERIC ); sort( $got, SORT_NUMERIC );
					if ( $expect !== $got ) {
						return new WP_Error( 'sml_gcat_incomplete_layout', 'The saved layout must contain every current channel exactly once.', array( 'status' => 409 ) );
					}

					$allowed = array_fill_keys( array_map( 'strval', $current ), true );
					$asgn    = array();
					foreach ( ( isset( $body['assignments'] ) && is_array( $body['assignments'] ) ) ? $body['assignments'] : array() as $cid => $cat ) {
						$cid = (int) $cid;
						$cat = sml_gcat_clean_name( $cat );
						if ( isset( $allowed[ (string) $cid ] ) && in_array( $cat, $cats, true ) ) { $asgn[ (string) $cid ] = $cat; }
					}

					if ( false === $wpdb->query( 'START TRANSACTION' ) ) {
						return new WP_Error( 'sml_gcat_layout_transaction', 'The layout transaction could not start.', array( 'status' => 500 ) );
					}
					foreach ( $order as $position => $cid ) {
						$ok = $wpdb->update(
							$wpdb->prefix . 'sml_group_channels',
							array( 'order_index' => $position ),
							array( 'id' => $cid, 'group_id' => (int) $group['id'] ),
							array( '%d' ), array( '%d', '%d' )
						);
						if ( false === $ok ) {
							$wpdb->query( 'ROLLBACK' );
							return new WP_Error( 'sml_gcat_layout_write', 'The layout could not be saved.', array( 'status' => 500 ) );
						}
					}
					update_option( 'sml_gcat_' . $group['id'], array(
						'categories' => $cats, 'assignments' => $asgn, 'updated' => time(),
					), false );
					if ( false === $wpdb->query( 'COMMIT' ) ) {
						$wpdb->query( 'ROLLBACK' );
						return new WP_Error( 'sml_gcat_layout_commit', 'The layout could not be committed.', array( 'status' => 500 ) );
					}

					return array(
						'saved'          => true,
						'categories'     => $cats,
						'assignments'    => $asgn,
						'channel_order'  => $order,
						'layout_revision'=> sml_gcat_layout_revision( $group['id'] ),
					);
					} finally {
						$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
					}
				},
			),
		) );

		register_rest_route( 'sml-gcat/v1', '/channel', array(
			array(
				'methods'             => 'POST',
				'permission_callback' => static function ( $req ) {
					$group = sml_gcat_group_by_slug( $req->get_param( 'slug' ) );
					return $group && sml_gcat_can_manage( $group );
				},
				'callback'            => static function ( $req ) {
					global $wpdb;
					$group = sml_gcat_group_by_slug( $req->get_param( 'slug' ) );
					if ( ! $group ) { return new WP_Error( 'sml_gcat_no_group', 'Unknown group.', array( 'status' => 404 ) ); }
					$cid  = absint( $req->get_param( 'channel_id' ) );
					$name = sanitize_text_field( (string) $req->get_param( 'name' ) );
					$name = trim( function_exists( 'mb_substr' ) ? mb_substr( $name, 0, 120 ) : substr( $name, 0, 120 ) );
					if ( ! $cid || '' === $name ) { return new WP_Error( 'sml_gcat_bad_input', 'Channel id and a non-empty name are required.', array( 'status' => 400 ) ); }
					// the channel must belong to THIS group — the manager gate
					// above is per-slug, so without this an admin of group A
					// could rename channels in group B by mixing parameters
					$owner_gid = (int) $wpdb->get_var( $wpdb->prepare(
						"SELECT group_id FROM {$wpdb->prefix}sml_group_channels WHERE id = %d", $cid
					) );
					if ( $owner_gid !== (int) $group['id'] ) { return new WP_Error( 'sml_gcat_wrong_group', 'That channel is not in this group.', array( 'status' => 404 ) ); }
					$wpdb->update(
						$wpdb->prefix . 'sml_group_channels',
						array( 'name' => $name ),
						array( 'id' => $cid ),
						array( '%s' ),
						array( '%d' )
					);
					return array( 'saved' => true, 'id' => $cid, 'name' => $name );
				},
			),
		) );

		register_rest_route( 'sml-gcat/v1', '/reorder', array(
			array(
				'methods'             => 'POST',
				'permission_callback' => static function ( $req ) {
					$group = sml_gcat_group_by_slug( $req->get_param( 'slug' ) );
					return $group && sml_gcat_can_manage( $group );
				},
				'callback'            => static function ( $req ) {
					global $wpdb;
					$group = sml_gcat_group_by_slug( $req->get_param( 'slug' ) );
					if ( ! $group ) { return new WP_Error( 'sml_gcat_no_group', 'Unknown group.', array( 'status' => 404 ) ); }
					$body = $req->get_json_params();
					$in   = ( is_array( $body ) && isset( $body['order'] ) && is_array( $body['order'] ) ) ? $body['order'] : null;
					if ( null === $in || count( $in ) > 300 ) { return new WP_Error( 'sml_gcat_bad_input', 'order must be an array of channel ids (max 300).', array( 'status' => 400 ) ); }
					$ids = array();
					foreach ( $in as $v ) {
						$v = (int) $v;
						if ( $v > 0 && ! in_array( $v, $ids, true ) ) { $ids[] = $v; }
					}
					// every id must be one of THIS group's channels — the manager
					// gate above is per-slug, so without this an admin of group A
					// could reorder channels in group B by mixing parameters
					$rows    = $wpdb->get_results( $wpdb->prepare(
						"SELECT id, order_index FROM {$wpdb->prefix}sml_group_channels WHERE group_id = %d",
						(int) $group['id']
					), ARRAY_A );
					$current = array();
					foreach ( (array) $rows as $r ) { $current[ (int) $r['id'] ] = (int) $r['order_index']; }
					foreach ( $ids as $cid ) {
						if ( ! array_key_exists( $cid, $current ) ) {
							return new WP_Error( 'sml_gcat_wrong_group', 'A channel in the order list is not in this group.', array( 'status' => 400 ) );
						}
					}
					foreach ( $ids as $i => $cid ) {
						if ( $current[ $cid ] === $i ) { continue; } // no-op rows skip the write
						$wpdb->update(
							$wpdb->prefix . 'sml_group_channels',
							array( 'order_index' => $i ),
							array( 'id' => $cid ),
							array( '%d' ),
							array( '%d' )
						);
					}
					return array( 'saved' => true, 'order' => $ids );
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
