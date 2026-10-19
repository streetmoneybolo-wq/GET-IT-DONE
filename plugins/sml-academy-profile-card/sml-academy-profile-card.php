<?php
/**
 * Plugin Name: SML Academy Profile Card
 * Description: Read-only, HMAC-signed lookup that lets the Making Easy Money Academy chat show a member's StockMarketLoop profile, channel and home group next to their Discord profile. Public fields only, and only for members whose Discord is linked and email-verified.
 * Version: 1.1.1
 * Author: StockMarketLoop
 *
 * Routes: POST /wp-json/sml-loop-kick/v1/discord-profile    body {"discord_user_id": "..."}
 *         POST /wp-json/sml-loop-kick/v1/discord-activity   body {"discord_user_id": "...", "limit": 12}
 *           the member's recent public activity on the site, newest first, for their Academy profile page: published posts (every
 *           public post type), approved comments (with the post they sit on), and the member's own social feed (the Stockmarketloop
 *           Members profile feed, read as that member). Each item carries the page it lives on, so the Academy can open it.
 * Authentication is the LOOP-KICK bridge's own: HMAC-SHA256 over "{ts}.{route}.{sha256(body)}" with the bridge secret, 60 s window, every signature single-use.
 * This plugin reuses that bridge's verification (sml_lkd_verify_signed / sml_lkd_bridge_secret from mu-plugins/sml-loop-kick-discord.php) and fails closed
 * (503) if the bridge is not installed. It writes nothing except a short per-member rate-limit transient.
 *
 * ROLLBACK: deactivate this plugin. The chat then shows Discord profiles only.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sml_apc_https( $url ) {
	$url = trim( (string) $url );
	return ( '' !== $url && 0 === strpos( $url, 'https://' ) ) ? esc_url_raw( $url ) : '';
}

function sml_apc_rest_profile( WP_REST_Request $request ) {
	global $wpdb;
	$data = json_decode( (string) $request->get_body(), true );
	$data = is_array( $data ) ? $data : array();
	$discord_user_id = preg_replace( '/\D/', '', (string) ( $data['discord_user_id'] ?? '' ) );
	if ( ! preg_match( '/^\d{15,24}$/', $discord_user_id ) ) {
		return new WP_Error( 'sml_apc_bad_id', 'A Discord user id is required.', array( 'status' => 400 ) );
	}
	$rate_key = 'sml_apc_rate_' . $discord_user_id;
	$rate     = (int) get_transient( $rate_key );
	if ( $rate >= 60 ) {
		return new WP_Error( 'sml_apc_rate', 'Too many requests.', array( 'status' => 429 ) );
	}
	set_transient( $rate_key, $rate + 1, MINUTE_IN_SECONDS );

	$links = $wpdb->prefix . 'sml_discord_site_links';
	$link  = $wpdb->get_row( $wpdb->prepare( "SELECT user_id FROM {$links} WHERE discord_user_id=%s", $discord_user_id ), ARRAY_A );
	$user_id = $link ? absint( $link['user_id'] ) : 0;
	$user    = $user_id ? get_userdata( $user_id ) : false;
	// not linked, or linked but not email-verified: nothing is shown (fails closed)
	if ( ! $user || '1' !== (string) get_user_meta( $user_id, 'sml_email_verified', true ) ) {
		return new WP_REST_Response( array( 'ok' => true, 'linked' => false ), 200 );
	}

	$handle = function_exists( 'sml_lkd_handle_display' ) ? sml_lkd_handle_display( $user_id ) : (string) $user->user_nicename;
	$card   = array(
		// the member's site user id: lets the Academy's premium Alert Charts bill through the site's marketplace (seller = this user)
		'user_id'      => $user_id,
		'handle'       => sanitize_text_field( $handle ),
		'display_name' => sanitize_text_field( (string) $user->display_name ),
		'avatar'       => sml_apc_https( get_avatar_url( $user_id, array( 'size' => 128 ) ) ),
		'profile_url'  => '' !== $handle ? home_url( '/members/' . rawurlencode( $handle ) . '/' ) : '',
		'channel'      => null,
		'group'        => null,
	);

	if ( function_exists( 'sml_channel_handle_for_user' ) ) {
		$channel = sml_channel_handle_for_user( $user_id );
		if ( '' !== (string) $channel ) {
			$card['channel'] = array( 'handle' => sanitize_text_field( $channel ), 'url' => home_url( '/channel/' . rawurlencode( $channel ) . '/' ) );
			if ( function_exists( 'sml_channel_settings' ) ) {
				$settings = sml_channel_settings( $user_id );
				$hg       = is_array( $settings ) && isset( $settings['home_group'] ) && is_array( $settings['home_group'] ) ? $settings['home_group'] : array();
				$url      = sml_apc_https( $hg['url'] ?? '' );
				if ( '' !== $url ) {
					$card['group'] = array( 'name' => sanitize_text_field( (string) ( $hg['name'] ?? '' ) ), 'url' => $url, 'members' => sanitize_text_field( (string) ( $hg['members'] ?? '' ) ) );
				}
			}
		}
	}
	return new WP_REST_Response( array( 'ok' => true, 'linked' => true, 'card' => $card ), 200 );
}

/* ---------- recent activity on the site, for the Academy profile page ---------- */

function sml_apc_text( $value, $max = 300 ) {
	$text = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( (string) $value ) ) );
	return mb_strlen( $text ) > $max ? mb_substr( $text, 0, $max - 1 ) . '…' : $text;
}
function sml_apc_date( $value ) {
	$t = is_numeric( $value ) ? (int) $value : strtotime( (string) $value );
	return $t ? gmdate( 'c', $t ) : '';
}
/* a value by the first key that is set, for the site feed's own shapes */
function sml_apc_pick( $row, $keys ) {
	foreach ( $keys as $k ) {
		if ( is_array( $row ) && isset( $row[ $k ] ) && '' !== $row[ $k ] && null !== $row[ $k ] ) {
			return $row[ $k ];
		}
	}
	return null;
}

/** The member's own social feed on the site (Stockmarketloop Members: GET /sml-members/v1/profile-feed), read as that member and normalised. */
function sml_apc_stream_items( $user_id, $limit ) {
	if ( ! function_exists( 'rest_do_request' ) ) {
		return array();
	}
	$previous = get_current_user_id();
	wp_set_current_user( $user_id );
	try {
		$req = new WP_REST_Request( 'GET', '/sml-members/v1/profile-feed' );
		$req->set_param( 'user_id', $user_id );
		$req->set_param( 'limit', $limit );
		$req->set_param( 'per_page', $limit );
		$res = rest_do_request( $req );
	} catch ( Throwable $e ) {
		$res = null;
	} finally {
		wp_set_current_user( $previous );
	}
	if ( ! $res || is_wp_error( $res ) ) {
		return array();
	}
	$res  = rest_ensure_response( $res );
	$data = $res->get_data();
	if ( (int) $res->get_status() < 200 || (int) $res->get_status() > 299 || ! is_array( $data ) ) {
		return array();
	}
	$rows = null;
	foreach ( array( 'items', 'posts', 'feed', 'data', 'results' ) as $k ) {
		if ( isset( $data[ $k ] ) && is_array( $data[ $k ] ) ) { $rows = $data[ $k ]; break; }
	}
	if ( null === $rows ) { $rows = array_values( array_filter( $data, 'is_array' ) ); }
	$out = array();
	foreach ( $rows as $row ) {
		if ( ! is_array( $row ) ) { continue; }
		$author = sml_apc_pick( $row, array( 'user_id', 'author_id', 'author', 'uid' ) );
		if ( null !== $author && is_numeric( $author ) && (int) $author !== (int) $user_id ) { continue; }
		$text = sml_apc_text( sml_apc_pick( $row, array( 'text', 'content', 'body', 'message', 'caption', 'title' ) ) );
		$id   = sml_apc_pick( $row, array( 'id', 'post_id', 'ID' ) );
		if ( '' === $text && null === $id ) { continue; }
		$out[] = array(
			'kind'     => 'stream',
			'id'       => (string) $id,
			'text'     => $text,
			'url'      => sml_apc_https( sml_apc_pick( $row, array( 'url', 'permalink', 'link', 'share_url' ) ) ),
			'date'     => sml_apc_date( sml_apc_pick( $row, array( 'created_at', 'date', 'created', 'time', 'published_at', 'timestamp' ) ) ),
			'symbol'   => strtoupper( preg_replace( '/[^A-Za-z0-9.]/', '', (string) sml_apc_pick( $row, array( 'symbol', 'ticker' ) ) ) ),
			'likes'    => (int) sml_apc_pick( $row, array( 'likes', 'like_count', 'upvotes', 'score', 'votes' ) ),
			'comments' => (int) sml_apc_pick( $row, array( 'comments', 'comment_count', 'replies', 'reply_count' ) ),
			'image'    => sml_apc_https( sml_apc_pick( $row, array( 'image', 'image_url', 'thumbnail', 'media_url' ) ) ),
		);
		if ( count( $out ) >= $limit ) { break; }
	}
	return $out;
}

function sml_apc_rest_activity( WP_REST_Request $request ) {
	global $wpdb;
	$data = json_decode( (string) $request->get_body(), true );
	$data = is_array( $data ) ? $data : array();
	$discord_user_id = preg_replace( '/\D/', '', (string) ( $data['discord_user_id'] ?? '' ) );
	if ( ! preg_match( '/^\d{15,24}$/', $discord_user_id ) ) {
		return new WP_Error( 'sml_apc_bad_id', 'A Discord user id is required.', array( 'status' => 400 ) );
	}
	$limit = max( 1, min( 20, (int) ( $data['limit'] ?? 12 ) ) );
	$rate_key = 'sml_apc_arate_' . $discord_user_id;
	$rate     = (int) get_transient( $rate_key );
	if ( $rate >= 30 ) {
		return new WP_Error( 'sml_apc_rate', 'Too many requests.', array( 'status' => 429 ) );
	}
	set_transient( $rate_key, $rate + 1, MINUTE_IN_SECONDS );

	$links = $wpdb->prefix . 'sml_discord_site_links';
	$link  = $wpdb->get_row( $wpdb->prepare( "SELECT user_id FROM {$links} WHERE discord_user_id=%s", $discord_user_id ), ARRAY_A );
	$user_id = $link ? absint( $link['user_id'] ) : 0;
	$user    = $user_id ? get_userdata( $user_id ) : false;
	if ( ! $user || '1' !== (string) get_user_meta( $user_id, 'sml_email_verified', true ) ) {
		return new WP_REST_Response( array( 'ok' => true, 'linked' => false ), 200 );
	}
	$cache_key = 'sml_apc_act_' . $user_id . '_' . $limit;
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) ) {
		return new WP_REST_Response( $cached, 200 );
	}

	$handle = function_exists( 'sml_lkd_handle_display' ) ? sml_lkd_handle_display( $user_id ) : (string) $user->user_nicename;
	$items  = array();

	/* published posts of every public type (articles, Loop Letters, videos... whatever the site publishes under the member's name) */
	$types = array_values( array_diff( get_post_types( array( 'public' => true ), 'names' ), array( 'attachment', 'page', 'wp_block', 'wp_navigation' ) ) );
	$posts = $types ? get_posts( array( 'author' => $user_id, 'post_status' => 'publish', 'post_type' => $types, 'numberposts' => $limit, 'orderby' => 'date', 'order' => 'DESC', 'suppress_filters' => false ) ) : array();
	foreach ( $posts as $post ) {
		$excerpt = has_excerpt( $post ) ? $post->post_excerpt : $post->post_content;
		$type    = get_post_type_object( $post->post_type );
		$items[] = array(
			'kind'     => 'post',
			'id'       => (string) $post->ID,
			'type'     => $post->post_type,
			'typeName' => $type ? sanitize_text_field( (string) $type->labels->singular_name ) : $post->post_type,
			'title'    => sml_apc_text( get_the_title( $post ), 160 ),
			'text'     => sml_apc_text( $excerpt, 240 ),
			'url'      => sml_apc_https( get_permalink( $post ) ),
			'date'     => sml_apc_date( $post->post_date_gmt . ' UTC' ),
			'comments' => (int) $post->comment_count,
			'image'    => sml_apc_https( get_the_post_thumbnail_url( $post, 'medium' ) ),
		);
	}
	/* approved comments, with the post they sit on */
	$comments = get_comments( array( 'user_id' => $user_id, 'status' => 'approve', 'type' => 'comment', 'number' => $limit, 'orderby' => 'comment_date_gmt', 'order' => 'DESC' ) );
	foreach ( $comments as $c ) {
		$post    = get_post( $c->comment_post_ID );
		$items[] = array(
			'kind'   => 'comment',
			'id'     => (string) $c->comment_ID,
			'text'   => sml_apc_text( $c->comment_content, 300 ),
			'url'    => sml_apc_https( get_comment_link( $c ) ),
			'date'   => sml_apc_date( $c->comment_date_gmt . ' UTC' ),
			'reply'  => (int) $c->comment_parent > 0,
			'post'   => $post ? array( 'id' => (string) $post->ID, 'title' => sml_apc_text( get_the_title( $post ), 160 ), 'url' => sml_apc_https( get_permalink( $post ) ) ) : null,
		);
	}
	/* the member's own social feed on the site */
	foreach ( sml_apc_stream_items( $user_id, $limit ) as $it ) { $items[] = $it; }
	/* other site features may add their own (polls answered, lives, letters...) */
	$items = apply_filters( 'sml_academy_member_activity', $items, $user_id, $limit );
	$items = array_values( array_filter( (array) $items, 'is_array' ) );
	usort( $items, static function ( $a, $b ) { return strcmp( (string) ( $b['date'] ?? '' ), (string) ( $a['date'] ?? '' ) ); } );
	$items = array_slice( $items, 0, $limit );

	$out = array(
		'ok'     => true,
		'linked' => true,
		'user'   => array(
			'id'           => $user_id,
			'handle'       => sanitize_text_field( $handle ),
			'display_name' => sanitize_text_field( (string) $user->display_name ),
			'avatar'       => sml_apc_https( get_avatar_url( $user_id, array( 'size' => 128 ) ) ),
			'profile_url'  => '' !== $handle ? home_url( '/members/' . rawurlencode( $handle ) . '/' ) : '',
		),
		'items'  => $items,
		'asOf'   => gmdate( 'c' ),
	);
	set_transient( $cache_key, $out, 2 * MINUTE_IN_SECONDS );
	return new WP_REST_Response( $out, 200 );
}

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml-loop-kick/v1', '/discord-profile', array(
		'methods'             => 'POST',
		'permission_callback' => static function ( WP_REST_Request $request ) {
			if ( ! function_exists( 'sml_lkd_verify_signed' ) || ! function_exists( 'sml_lkd_bridge_secret' ) ) {
				return new WP_Error( 'sml_apc_unconfigured', 'Not configured.', array( 'status' => 503 ) );
			}
			return sml_lkd_verify_signed( $request, sml_lkd_bridge_secret(), 'x-sml-lk-timestamp', 'x-sml-lk-signature' );
		},
		'callback'            => 'sml_apc_rest_profile',
	) );
	register_rest_route( 'sml-loop-kick/v1', '/discord-activity', array(
		'methods'             => 'POST',
		'permission_callback' => static function ( WP_REST_Request $request ) {
			if ( ! function_exists( 'sml_lkd_verify_signed' ) || ! function_exists( 'sml_lkd_bridge_secret' ) ) {
				return new WP_Error( 'sml_apc_unconfigured', 'Not configured.', array( 'status' => 503 ) );
			}
			return sml_lkd_verify_signed( $request, sml_lkd_bridge_secret(), 'x-sml-lk-timestamp', 'x-sml-lk-signature' );
		},
		'callback'            => 'sml_apc_rest_activity',
	) );
} );
