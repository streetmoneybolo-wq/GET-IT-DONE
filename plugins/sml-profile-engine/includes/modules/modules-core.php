<?php
/**
 * Module definitions.
 *
 * Each module is data + a render callback. `data_cb` is lazy — the renderer
 * calls it only when the module is going to appear, so hidden modules cost
 * nothing.
 *
 * Markup deliberately reuses the site's existing class names
 * (`sml-pfe-module`, `sml-profile-hero`, `sml-profile-stat`, …) so the current
 * stylesheet applies and the Phase 2 output diff is meaningful.
 *
 * @package SML\ProfileEngine
 */

declare( strict_types = 1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Shared card wrapper so every module has the same shell and heading. */
/**
 * Open a module panel.
 *
 * `$surface` is how a module opts out of looking like a panel. `floating`
 * removes the chrome and visually hides the heading — the heading stays in the
 * document, because a screen reader still needs to know what this section is,
 * and only its pixels go. Hiding it with `display:none` would take it from
 * both audiences at once.
 */
function sml_profile_card_open( string $title, string $extra_class = '', string $surface = 'card' ): void {
	$floating = 'card' !== $surface;

	printf(
		'<section class="sml-pfe-module %1$s%2$s"><h2%3$s>%4$s</h2>',
		esc_attr( $extra_class ),
		$floating ? ' is-surface-' . esc_attr( $surface ) : '',
		$floating ? ' class="sml-pfe-visually-hidden"' : '',
		esc_html( $title )
	);
}
function sml_profile_card_close(): void {
	echo '</section>';
}

/** Responsive image from an attachment ID, or nothing. Never an empty <img>. */
function sml_profile_image( ?int $attachment_id, string $size, string $class, string $alt = '' ): void {
	if ( ! $attachment_id ) {
		return;
	}
	echo wp_get_attachment_image( // phpcs:ignore WordPress.Security.EscapeOutput
		$attachment_id,
		$size,
		false,
		array(
			'class'   => $class,
			'loading' => 'lazy',
			'decoding' => 'async',
			'alt'     => $alt,
		)
	);
}

add_filter(
	'sml_profile_modules',
	static function ( array $m ): array {

		// -----------------------------------------------------------------
		// CORE
		// -----------------------------------------------------------------

		$m['profile_hero'] = array(
			'label'           => __( 'Profile hero', 'sml-profile-engine' ),
			'group'           => 'core',
			'locked'          => true,   // identity is not optional
			'hide_when_empty' => false,
			'zones'           => array( 'hero', 'rail_left', 'rail_center' ),
			'data_cb'         => 'sml_profile_data_identity',
			'render_cb'       => 'sml_profile_render_hero',
		);

		$m['profile_hero_compact'] = array(
			'label'           => __( 'Profile hero (compact)', 'sml-profile-engine' ),
			'group'           => 'core',
			'locked'          => true,
			'hide_when_empty' => false,
			'zones'           => array( 'hero' ),
			'data_cb'         => 'sml_profile_data_identity',
			'render_cb'       => 'sml_profile_render_hero_compact',
		);

		$m['profile_hero_wide'] = array(
			'label'           => __( 'Profile hero (billboard)', 'sml-profile-engine' ),
			'group'           => 'core',
			'locked'          => true,
			'hide_when_empty' => false,
			'zones'           => array( 'hero' ),
			'data_cb'         => 'sml_profile_data_identity',
			'render_cb'       => 'sml_profile_render_hero_wide',
		);

		$m['stats_ribbon'] = array(
			'label'     => __( 'Stats ribbon', 'sml-profile-engine' ),
			'group'     => 'core',
			'zones'     => array( 'hero', 'rail_center' ),
			'data_cb'   => 'sml_profile_data_stats',
			'render_cb' => 'sml_profile_render_stats',
		);

		$m['about'] = array(
			'label'     => __( 'About', 'sml-profile-engine' ),
			'group'     => 'core',
			'zones'     => array( 'rail_left', 'rail_right', 'grid_lower' ),
			'data_cb'   => 'sml_profile_data_about',
			'render_cb' => 'sml_profile_render_about',
		);

		// -----------------------------------------------------------------
		// LIFESTYLE — the expressive set
		// -----------------------------------------------------------------

		$m['pinned_carousel'] = array(
			'label'     => __( 'Pinned moments', 'sml-profile-engine' ),
			'group'     => 'lifestyle',
			'zones'     => array( 'rail_center', 'grid_lower', 'hero' ),
			'data_cb'   => 'sml_profile_data_carousel',
			'render_cb' => 'sml_profile_render_carousel',
		);

		$m['photo_strip'] = array(
			'label'     => __( 'Photo strip', 'sml-profile-engine' ),
			'group'     => 'lifestyle',
			'zones'     => array( 'rail_left', 'rail_right' ),
			'data_cb'   => 'sml_profile_data_strip',
			'render_cb' => 'sml_profile_render_strip',
		);

		$m['my_cars'] = array(
			'label'     => __( 'My cars', 'sml-profile-engine' ),
			'group'     => 'lifestyle',
			'zones'     => array( 'rail_center', 'rail_left', 'rail_right', 'grid_lower' ),
			'data_cb'   => 'sml_profile_data_vehicles',
			'render_cb' => 'sml_profile_render_vehicles',
		);

		$m['lifestyle_summary'] = array(
			'label'     => __( 'Lifestyle summary', 'sml-profile-engine' ),
			'group'     => 'lifestyle',
			'zones'     => array( 'rail_right', 'rail_left' ),
			'data_cb'   => 'sml_profile_data_social_prefs',
			'render_cb' => 'sml_profile_render_lifestyle_summary',
		);

		// -----------------------------------------------------------------
		// SOCIAL
		// -----------------------------------------------------------------

		$m['top_friends'] = array(
			'label'     => __( 'Top friends', 'sml-profile-engine' ),
			'group'     => 'social',
			'zones'     => array( 'rail_left', 'rail_right', 'grid_lower' ),
			'data_cb'   => 'sml_profile_data_favorites',
			'render_cb' => 'sml_profile_render_people',
		);

		$m['suggested_people'] = array(
			'label'     => __( 'Suggested people', 'sml-profile-engine' ),
			'group'     => 'social',
			'zones'     => array( 'rail_left', 'rail_right' ),
			'data_cb'   => 'sml_profile_data_suggested',
			'render_cb' => 'sml_profile_render_people',
		);

		$m['share_profile'] = array(
			'label'           => __( 'Share profile', 'sml-profile-engine' ),
			'group'           => 'social',
			'hide_when_empty' => false,
			'zones'           => array( 'rail_left', 'rail_right' ),
			'data_cb'         => 'sml_profile_data_identity',
			'render_cb'       => 'sml_profile_render_share',
		);

		return $m;
	}
);

// =====================================================================
// DATA CALLBACKS — lazy, only invoked for modules that will render
// =====================================================================

/**
 * Prefer the avatar a member explicitly saved in their StockMarketLoop
 * profile.  Gravatar remains a fallback when no site avatar exists.
 */
function sml_profile_avatar_url( int $user_id, int $size = 96 ): string {
	$custom_avatar = esc_url_raw( (string) get_user_meta( $user_id, 'sml_avatar_url', true ) );
	return $custom_avatar ?: get_avatar_url( $user_id, array( 'size' => $size ) );
}

function sml_profile_data_identity( int $user_id, array $bundle ): array {
	$user = get_userdata( $user_id );
	if ( ! $user ) {
		return array();
	}
	$custom = $bundle['customization'];
	return array(
		'user_id'      => $user_id,
		'display_name' => $user->display_name,
		'handle'       => SML_Profile_Repository::handle_for( $user_id ),
		'tagline'      => (string) get_user_meta( $user_id, 'sml_tagline', true ),
		'bio'          => (string) get_user_meta( $user_id, 'description', true ),
		'avatar'       => sml_profile_avatar_url( $user_id, 192 ),
		'banner_id'    => $custom['banner_id'] ?? null,
		// Resolved here rather than in the render callback so the module keeps
		// its data/render split: the callback prints what it was handed and
		// asks nothing.
		'banner'       => SML_Profile_Banner::resolve( $custom ),
		// The viewer, not the profile. Resolved per request and never cached —
		// see `viewer_is_owner()`; a cached owner flag once published a
		// member's owner-only modules to everybody for the length of a TTL.
		'is_owner'     => ! empty( $bundle['is_owner'] ),
		'editor_url'   => class_exists( 'SML_Profile_Editor' ) ? SML_Profile_Editor::page_url() : '',
		'follow'       => sml_profile_follow_state( $user_id, ! empty( $bundle['is_owner'] ) ),
		'profile_url'  => sml_profile_url_for( $user_id ),
	);
}

function sml_profile_url_for( int $user_id ): string {
	$handle = SML_Profile_Repository::handle_for( $user_id );
	return $handle ? home_url( '/' . rawurlencode( $handle ) . '/' ) : home_url( '/' );
}

/**
 * Stat tiles.
 *
 * Values come through a filter so the Members plugin supplies the real
 * numbers. Returning nothing renders nothing — no zeroed placeholder ribbon.
 */
function sml_profile_data_stats( int $user_id, array $bundle ): array {
	return array_values( array_filter( (array) apply_filters( 'sml_profile_stats', array(), $user_id ) ) );
}

function sml_profile_data_about( int $user_id, array $bundle ): array {
	$rows = array();
	$id   = sml_profile_data_identity( $user_id, $bundle );
	if ( ! empty( $id['display_name'] ) ) {
		$rows[] = array( 'label' => __( 'Creator', 'sml-profile-engine' ), 'value' => $id['display_name'] );
	}
	if ( ! empty( $id['handle'] ) ) {
		$rows[] = array( 'label' => __( 'Handle', 'sml-profile-engine' ), 'value' => '@' . $id['handle'] );
	}
	$social = $bundle['social'] ?? array();
	if ( ! empty( $social['trading_style'] ) ) {
		$rows[] = array( 'label' => __( 'Style', 'sml-profile-engine' ), 'value' => $social['trading_style'] );
	}
	if ( ! empty( $id['bio'] ) ) {
		$rows[] = array( 'label' => __( 'Profile', 'sml-profile-engine' ), 'value' => $id['bio'] );
	}
	return $rows;
}

function sml_profile_data_carousel( int $user_id, array $bundle ): array {
	return $bundle['media']['pinned_carousel'] ?? array();
}

function sml_profile_data_strip( int $user_id, array $bundle ): array {
	return $bundle['media']['vertical_strip'] ?? array();
}

function sml_profile_data_vehicles( int $user_id, array $bundle ): array {
	return $bundle['vehicles'] ?? array();
}

function sml_profile_data_favorites( int $user_id, array $bundle ): array {
	return $bundle['favorites'] ?? array();
}

function sml_profile_data_suggested( int $user_id, array $bundle ): array {
	if ( ! is_user_logged_in() ) {
		return array();
	}
	$ids = (array) apply_filters( 'sml_profile_suggested_user_ids', array(), get_current_user_id(), 6 );
	$out = array();
	foreach ( array_slice( $ids, 0, 6 ) as $id ) {
		$u = get_userdata( absint( $id ) );
		if ( $u ) {
			$out[] = array(
				'user_id'      => (int) $u->ID,
				'display_name' => $u->display_name,
				'handle'       => SML_Profile_Repository::handle_for( (int) $u->ID ),
				'avatar'       => sml_profile_avatar_url( (int) $u->ID, 96 ),
			);
		}
	}
	return $out;
}

function sml_profile_data_social_prefs( int $user_id, array $bundle ): array {
	$s    = $bundle['social'] ?? array();
	$rows = array();
	foreach ( array(
		'looking_for'   => __( 'Looking for', 'sml-profile-engine' ),
		'trading_style' => __( 'Trading style', 'sml-profile-engine' ),
	) as $k => $label ) {
		if ( ! empty( $s[ $k ] ) ) {
			$rows[] = array( 'label' => $label, 'value' => $s[ $k ] );
		}
	}
	if ( ! empty( $s['markets'] ) ) {
		$rows[] = array( 'label' => __( 'Markets', 'sml-profile-engine' ), 'value' => implode( ', ', array_map( 'strval', $s['markets'] ) ) );
	}
	return $rows;
}

// =====================================================================
// RENDER CALLBACKS — everything escaped at the point of output
// =====================================================================

/**
 * Can this viewer follow this member, and do they already?
 *
 * ---------------------------------------------------------------------------
 * READ FROM THE HOST'S OWN STORE, WRITE THROUGH THE HOST'S OWN ENDPOINT
 * ---------------------------------------------------------------------------
 * Following is not the engine's data. It lives in two user meta keys the
 * Members plugin owns — `sml_following` on the follower and `sml_followers` on
 * the followed — and it is written by
 * `POST /wp-json/sml-members/v1/follow` with `user_id` and an `action` of
 * `follow` or `unfollow`, which answers `{following, followers_count,
 * following_count}`.
 *
 * The engine reads that store to render the right label and posts to that
 * endpoint to change it. It does not keep its own copy. A second follower
 * table that drifts from the first is a worse outcome than no follow button at
 * all, and the counts on this profile are read from the same meta by the stats
 * ribbon a few lines above.
 *
 * Returns an empty array whenever there is nothing to offer — a logged-out
 * visitor, the owner looking at themselves, or a Members build without the
 * endpoint. The caller renders nothing rather than a button that cannot work.
 */
function sml_profile_follow_state( int $user_id, bool $is_owner ): array {
	// One condition, because the three cases collapse into it: the owner is by
	// definition the viewer, and a logged-out viewer has no id. Two guards
	// looked more careful and meant one of them could never fail on its own,
	// which is a branch no test can hold to account.
	$viewer = get_current_user_id();
	if ( $is_owner || $viewer <= 0 || $viewer === $user_id ) {
		return array();
	}

	// No endpoint, no button. This is the same `function_exists` discipline the
	// rest of the bindings use: a Members build that cannot follow should not
	// be given a control that pretends otherwise.
	if ( ! function_exists( 'sml_members_id_list' ) ) {
		return array();
	}

	$following = (array) sml_members_id_list( get_user_meta( $viewer, 'sml_following', true ) );
	$followers = (array) sml_members_id_list( get_user_meta( $user_id, 'sml_followers', true ) );

	return array(
		'user_id'   => $user_id,
		'following' => in_array( $user_id, array_map( 'absint', $following ), true ),
		'count'     => count( $followers ),
		'endpoint'  => rest_url( 'sml-members/v1/follow' ),
		'nonce'     => wp_create_nonce( 'wp_rest' ),
	);
}

/**
 * The follow button.
 *
 * A real `<button>` rather than an anchor, because this one genuinely does
 * something on click and there is nowhere to navigate to. It carries
 * everything the script needs in data attributes, so `follow.js` holds no
 * knowledge of who is on the page.
 *
 * With scripting off it is a button that does nothing, which is the one place
 * in this file that compromise is unavoidable: following is a state change and
 * there is no host endpoint that accepts a plain form post. It is marked
 * `hidden` until the script claims it, so a member without JavaScript sees no
 * button rather than a broken one.
 */
function sml_profile_render_follow( array $follow ): void {
	if ( empty( $follow['user_id'] ) ) {
		return;
	}

	$is_following = ! empty( $follow['following'] );

	printf(
		'<button type="button" class="sml-pfe-action%1$s" hidden' .
		' data-sml-follow="%2$d" data-following="%3$s" data-endpoint="%4$s" data-nonce="%5$s"' .
		' data-label-follow="%6$s" data-label-following="%7$s" aria-pressed="%3$s">%8$s</button>',
		$is_following ? '' : ' sml-pfe-action--primary',
		(int) $follow['user_id'],
		$is_following ? 'true' : 'false',
		esc_url( (string) $follow['endpoint'] ),
		esc_attr( (string) $follow['nonce'] ),
		esc_attr__( 'Follow', 'sml-profile-engine' ),
		esc_attr__( 'Following', 'sml-profile-engine' ),
		esc_html( $is_following ? __( 'Following', 'sml-profile-engine' ) : __( 'Follow', 'sml-profile-engine' ) )
	);

	sml_profile_follow_enqueue();
}

/** Loaded only on a profile that actually shows the button. */
function sml_profile_follow_enqueue(): void {
	if ( ! function_exists( 'wp_script_is' ) || wp_script_is( 'sml-profile-follow', 'done' ) ) {
		return;
	}
	if ( ! wp_script_is( 'sml-profile-follow', 'registered' ) ) {
		wp_register_script(
			'sml-profile-follow',
			SML_PROFILE_ENGINE_URL . 'assets/follow.js',
			array(),
			SML_PROFILE_ENGINE_VERSION,
			true
		);
	}
	wp_enqueue_script( 'sml-profile-follow' );
	wp_print_scripts( 'sml-profile-follow' );
}

/**
 * Profile actions — the way out of a profile, and the way to follow one.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE LINKS AND NOT THE HOST'S BUTTONS
 * ---------------------------------------------------------------------------
 * The host's renderer emits an action bar of its own:
 *
 *     .sml-profile-actions
 *       button[data-follow-button]        button[data-preview-follow]
 *       button[data-preview-profile]      button[data-edit-profile]
 *       button[data-copy-profile]
 *
 * Copying that markup was the obvious move and it is the wrong one. Nothing in
 * the host's `profile.js` binds a single one of those attributes — checked, all
 * five — so the code that makes them do anything is inline script printed by
 * `sml_members_render_profile_page()`, which is precisely the function the
 * engine replaces. Reproducing the markup would produce five buttons that look
 * right and do nothing, which is worse than no buttons: a member clicks Edit,
 * nothing happens, and they conclude their profile is broken.
 *
 * So these are anchors with real `href`s. No script has to load, nothing has to
 * bind, and both of them work with JavaScript switched off entirely.
 *
 * `?sml_view=visitor` is the parameter the host renderer already honoured and
 * the engine honours too, so "view as visitor" is a link to the same page and
 * costs nothing to implement or maintain.
 *
 * NOT INCLUDED, deliberately: Follow. It needs the relationship endpoint and a
 * request, and half-building it would put a dead button back on the page —
 * the exact mistake this comment is about. It is a gap at cutover and it is
 * recorded as one in the runbook.
 */
function sml_profile_render_owner_actions( array $d ): void {
	$follow = (array) ( $d['follow'] ?? array() );

	// A visitor gets one control and it is the important one.
	if ( empty( $d['is_owner'] ) ) {
		if ( ! empty( $follow['user_id'] ) ) {
			echo '<div class="sml-pfe-actions">';
			sml_profile_render_follow( $follow );
			echo '</div>';
		}
		return;
	}

	$viewing_as_visitor = isset( $_GET['sml_view'] ) && 'visitor' === $_GET['sml_view']; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

	$links = array();

	// No editor page configured means no link. A button pointing at a 404 is
	// how a member decides the feature does not work.
	if ( ! empty( $d['editor_url'] ) ) {
		$links[] = array(
			'url'   => (string) $d['editor_url'],
			'label' => __( 'Edit profile', 'sml-profile-engine' ),
			'class' => 'sml-pfe-action sml-pfe-action--primary',
		);
	}

	$profile_url = (string) ( $d['profile_url'] ?? '' );
	if ( '' !== $profile_url ) {
		$links[] = $viewing_as_visitor
			? array(
				'url'   => $profile_url,
				'label' => __( 'Back to your view', 'sml-profile-engine' ),
				'class' => 'sml-pfe-action',
			)
			: array(
				'url'   => add_query_arg( 'sml_view', 'visitor', $profile_url ),
				'label' => __( 'View as visitor', 'sml-profile-engine' ),
				'class' => 'sml-pfe-action',
			);
	}

	if ( ! $links ) {
		return;
	}

	echo '<div class="sml-pfe-actions">';
	foreach ( $links as $link ) {
		printf(
			'<a class="%s" href="%s">%s</a>',
			esc_attr( $link['class'] ),
			esc_url( $link['url'] ),
			esc_html( $link['label'] )
		);
	}
	echo '</div>';
}

function sml_profile_render_hero( array $d, array $bundle ): void {
	if ( ! $d ) {
		return;
	}
	echo '<section class="sml-profile-hero"><div class="sml-profile-banner">';
	// The banner surface goes INSIDE the host's positioned banner box. See
	// class-sml-profile-banner.php — that box already has the position and the
	// minimum height, and `.sml-profile-card` above it already has the
	// z-index, so nothing about the host's contract has to move.
	SML_Profile_Banner::render_resolved( $d['banner'] ?? array() );
	echo '<div class="sml-profile-card">';
	printf(
		'<img class="sml-profile-avatar" src="%s" alt="%s" width="96" height="96" loading="eager" decoding="async" />',
		esc_url( $d['avatar'] ),
		esc_attr( $d['display_name'] )
	);
	echo '<div>';
	printf( '<h1>%s</h1>', esc_html( $d['display_name'] ) );
	if ( ! empty( $d['handle'] ) ) {
		printf( '<div class="sml-profile-identity"><span>@%s</span></div>', esc_html( $d['handle'] ) );
	}
	if ( ! empty( $d['tagline'] ) ) {
		printf( '<div class="sml-profile-tagline">%s</div>', esc_html( $d['tagline'] ) );
	}
	if ( ! empty( $d['bio'] ) ) {
		printf( '<p>%s</p>', esc_html( $d['bio'] ) );
	}
	echo '</div>';
	// Inside the card, which the host stylesheet already positions above the
	// banner media at z-index 2 — so the links are reachable whatever the
	// member put behind them.
	sml_profile_render_owner_actions( $d );
	echo '</div></div></section>';
}

/**
 * Compact and wide heroes are ENGINE-OWNED markup. Read this before "fixing"
 * them to match the default hero.
 *
 * `sml_profile_render_hero` above reuses the host's `.sml-profile-hero >
 * .sml-profile-banner > .sml-profile-card` structure, and that is correct:
 * the host has exactly one hero and it looks right for free.
 *
 * These two variants do not exist on the host. Reusing `.sml-profile-card`
 * inside them broke badly, because the host stylesheet carries
 * `body.sml-public-profile-page .sml-profile-card{position:absolute
 * !important}` — that rule assumes a positioned banner above it. With no
 * banner the section collapsed to 1px and the identity block escaped to the
 * bottom of the page, on top of the footer.
 *
 * The lesson is narrower than "don't share markup": share it only where the
 * host has the whole structure the host's CSS assumes. Half of a contract is
 * not a contract. So these two carry `sml-pfe-*` classes and this plugin
 * styles them.
 */
function sml_profile_render_hero_compact( array $d, array $bundle ): void {
	if ( ! $d ) {
		return;
	}
	echo '<section class="sml-pfe-hero sml-pfe-hero--compact">';
	printf(
		'<img class="sml-pfe-hero-avatar" src="%s" alt="%s" width="64" height="64" loading="eager" decoding="async" />',
		esc_url( $d['avatar'] ),
		esc_attr( $d['display_name'] )
	);
	echo '<div class="sml-pfe-hero-identity">';
	printf( '<h1>%s</h1>', esc_html( $d['display_name'] ) );
	if ( ! empty( $d['handle'] ) ) {
		printf( '<span class="sml-pfe-hero-handle">@%s</span>', esc_html( $d['handle'] ) );
	}
	echo '</div>';
	sml_profile_render_owner_actions( $d );
	echo '</section>';
}

function sml_profile_render_hero_wide( array $d, array $bundle ): void {
	if ( ! $d ) {
		return;
	}
	echo '<section class="sml-pfe-hero sml-pfe-hero--wide">';
	SML_Profile_Banner::render_resolved( $d['banner'] ?? array() );
	echo '<div class="sml-pfe-hero-identity">';
	printf(
		'<img class="sml-pfe-hero-avatar" src="%s" alt="%s" width="128" height="128" loading="eager" decoding="async" />',
		esc_url( $d['avatar'] ),
		esc_attr( $d['display_name'] )
	);
	printf( '<h1>%s</h1>', esc_html( $d['display_name'] ) );
	if ( ! empty( $d['tagline'] ) ) {
		printf( '<p class="sml-pfe-hero-tagline">%s</p>', esc_html( $d['tagline'] ) );
	}
	sml_profile_render_owner_actions( $d );
	echo '</div></section>';
}

function sml_profile_render_stats( array $rows, array $bundle ): void {
	if ( ! $rows ) {
		return;
	}
	echo '<div class="sml-profile-stats">';
	foreach ( $rows as $row ) {
		printf(
			'<div class="sml-profile-stat"><span>%s</span><strong>%s</strong></div>',
			esc_html( (string) ( $row['label'] ?? '' ) ),
			esc_html( (string) ( $row['value'] ?? '' ) )
		);
	}
	echo '</div>';
}

function sml_profile_render_about( array $rows, array $bundle ): void {
	if ( ! $rows ) {
		return;
	}
	sml_profile_card_open( __( 'About', 'sml-profile-engine' ), 'sml-pfe-about' );
	foreach ( $rows as $row ) {
		printf(
			'<div class="sml-pfe-about-row"><span>%s</span><strong>%s</strong></div>',
			esc_html( (string) $row['label'] ),
			esc_html( (string) $row['value'] )
		);
	}
	sml_profile_card_close();
}

/**
 * Pinned carousel.
 *
 * First image eager (it is above the fold in the lifestyle layout), the rest
 * lazy. Renders correctly with 1, 2 or 3 images — no empty slots, no jump.
 */
function sml_profile_render_carousel( array $items, array $bundle ): void {
	if ( ! $items ) {
		return;
	}
	sml_profile_card_open( __( 'Pinned moments', 'sml-profile-engine' ), 'sml-pfe-pinned' );
	printf(
		'<div class="sml-pfe-carousel" data-count="%d" role="list">',
		count( $items )
	);
	foreach ( $items as $i => $item ) {
		echo '<figure class="sml-pfe-carousel-item" role="listitem">';
		if ( ! empty( $item['attachment_id'] ) ) {
			echo wp_get_attachment_image( // phpcs:ignore WordPress.Security.EscapeOutput
				(int) $item['attachment_id'],
				'large',
				false,
				array(
					'class'    => 'sml-pfe-carousel-img',
					'loading'  => 0 === $i ? 'eager' : 'lazy',
					'decoding' => 'async',
					'alt'      => $item['caption'] ?: '',
				)
			);
		}
		if ( ! empty( $item['caption'] ) ) {
			printf( '<figcaption>%s</figcaption>', esc_html( $item['caption'] ) );
		}
		echo '</figure>';
	}
	echo '</div>';
	sml_profile_card_close();
}

function sml_profile_render_strip( array $items, array $bundle ): void {
	if ( ! $items ) {
		return;
	}
	sml_profile_card_open( __( 'Moments', 'sml-profile-engine' ), 'sml-pfe-strip' );
	echo '<div class="sml-pfe-strip-grid" role="list">';
	foreach ( $items as $item ) {
		echo '<div class="sml-pfe-strip-item" role="listitem">';
		sml_profile_image(
			! empty( $item['attachment_id'] ) ? (int) $item['attachment_id'] : null,
			'medium',
			'sml-pfe-strip-img',
			(string) ( $item['caption'] ?? '' )
		);
		echo '</div>';
	}
	echo '</div>';
	sml_profile_card_close();
}

function sml_profile_render_vehicles( array $items, array $bundle ): void {
	if ( ! $items ) {
		return;
	}
	// Reuse the shell the site already ships (.sml-pfe-garage, gated by
	// .sml-pfe-lifestyle-only) so existing CSS applies and there is exactly one
	// My Cars module on the page rather than ours plus theirs.
	sml_profile_card_open( __( 'My Cars', 'sml-profile-engine' ), 'sml-pfe-lifestyle-only sml-pfe-garage' );
	echo '<div class="sml-pfe-car-grid" role="list">';
	foreach ( $items as $car ) {
		$title = trim( (string) ( $car['title'] ?? '' ) );
		if ( '' === $title ) {
			$title = trim( implode( ' ', array_filter( array( $car['year'] ?? '', $car['make'] ?? '', $car['model'] ?? '' ) ) ) );
		}
		echo '<figure class="sml-pfe-car" role="listitem">';
		sml_profile_image(
			! empty( $car['attachment_id'] ) ? (int) $car['attachment_id'] : null,
			'medium_large',
			'sml-pfe-car-img',
			$title
		);
		echo '<figcaption>';
		if ( '' !== $title ) {
			printf( '<strong>%s</strong>', esc_html( $title ) );
		}
		if ( ! empty( $car['caption'] ) ) {
			printf( '<span>%s</span>', esc_html( $car['caption'] ) );
		}
		echo '</figcaption></figure>';
	}
	echo '</div>';
	sml_profile_card_close();
}

/** Shared by top_friends and suggested_people — same shape, same markup. */
function sml_profile_render_people( array $people, array $bundle, array $mod = array() ): void {
	if ( ! $people ) {
		return;
	}
	// Same reasoning as My Cars: the site already renders friends into
	// .sml-pfe-connections with .sml-pfe-person-row children.
	sml_profile_card_open(
		(string) ( $mod['label'] ?? __( 'Friends', 'sml-profile-engine' ) ),
		'sml-pfe-lifestyle-only sml-pfe-connections'
	);
	echo '<div class="sml-pfe-person-grid" role="list">';
	foreach ( $people as $p ) {
		printf(
			'<a class="sml-pfe-person-row" role="listitem" href="%s"><img class="sml-pfe-person-avatar" src="%s" alt="%s" width="48" height="48" loading="lazy" decoding="async" /><span><strong>%s</strong></span></a>',
			esc_url( sml_profile_url_for( (int) $p['user_id'] ) ),
			esc_url( (string) $p['avatar'] ),
			esc_attr( (string) $p['display_name'] ),
			esc_html( (string) $p['display_name'] )
		);
	}
	echo '</div>';
	sml_profile_card_close();
}

function sml_profile_render_share( array $d, array $bundle ): void {
	if ( empty( $d['profile_url'] ) ) {
		return;
	}
	sml_profile_card_open( __( 'Share profile', 'sml-profile-engine' ), 'sml-pfe-social' );
	printf(
		'<div class="sml-pfe-social-row"><input type="text" readonly value="%s" class="sml-pfe-share-url" aria-label="%s" /></div>',
		esc_attr( $d['profile_url'] ),
		esc_attr__( 'Profile link', 'sml-profile-engine' )
	);
	sml_profile_card_close();
}

function sml_profile_render_lifestyle_summary( array $rows, array $bundle ): void {
	if ( ! $rows ) {
		return;
	}
	sml_profile_card_open( __( 'Lifestyle', 'sml-profile-engine' ), 'sml-pfe-lifestyle' );
	foreach ( $rows as $row ) {
		printf(
			'<div class="sml-pfe-about-row"><span>%s</span><strong>%s</strong></div>',
			esc_html( (string) $row['label'] ),
			esc_html( (string) $row['value'] )
		);
	}
	sml_profile_card_close();
}
