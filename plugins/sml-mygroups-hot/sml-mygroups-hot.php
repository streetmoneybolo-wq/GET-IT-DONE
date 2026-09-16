<?php
/**
 * Plugin Name: SML My-Groups Hot Posts
 * Description: GET /wp-json/sml-group-landing/v1/my-groups/hot — group CHATS for the signed-in member's home feed: threads they are part of, and hot threads in their groups. Group alerts are never included (not even for paying members). PAID groups are gated SERVER-SIDE; fail-closed.
 * Version: 2.0.0
 * Author: StockMarketLoop
 *
 * OWNER RULE (2026-09-16): "NO PREMIUM GROUP ALERTS will be seen there even if the user is a
 * member — only chats, and only chats the user is in a thread of, or a hot post/thread in a
 * group the user is in."
 *
 * What that means here:
 *   - Source is group chat: wp_sml_group_channel_messages in TEXT channels only. Never
 *     wp_sml_group_posts (those rows are trade alerts), never 'alerts' / 'voice' / 'live' /
 *     'education' channels, never a message tagged as an alert (_sml_alert_id), never a
 *     locked, archived, deleted or admins-only channel.
 *   - A thread is a root message plus its replies (wp_sml_group_message_replies).
 *   - Shown when EITHER the viewer posted in the thread and someone else is in it too
 *     ("your thread"), OR it is hot: 2+ replies from 2+ different people, or 3+ reactions,
 *     with activity in the last 7 days ("hot in your group").
 *   - Only groups the viewer is a member of; paid groups only for paying/staff roles.
 * The response keeps the old shape ({hot:[...], count}) so the feed client needs no new route.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

const SML_MGH_WINDOW_DAYS   = 7;
const SML_MGH_PER_GROUP     = 3;
const SML_MGH_TOTAL         = 8;
const SML_MGH_HOT_REPLIES   = 2;
const SML_MGH_HOT_PEOPLE    = 2;
const SML_MGH_HOT_REACTIONS = 3;

/** Roles that grant read access to a PAID group's content. */
function sml_mgh_paid_roles() {
	return array( 'owner', 'admin', 'analyst', 'mod', 'premium' );
}

function sml_mgh_role( $gid, $uid ) {
	$gid = (int) $gid; $uid = (int) $uid;
	if ( class_exists( 'SML_GCA_Repository' ) && method_exists( 'SML_GCA_Repository', 'user_roles' ) ) {
		$rows = (array) SML_GCA_Repository::user_roles( $gid, $uid );
		$best = ''; $paid = sml_mgh_paid_roles();
		foreach ( $rows as $r ) {
			$slug = is_array( $r ) ? (string) ( $r['slug'] ?? '' ) : '';
			if ( in_array( $slug, $paid, true ) ) { return $slug; }
			if ( '' === $best && '' !== $slug ) { $best = $slug; }
		}
		if ( '' !== $best ) { return $best; }
	}
	global $wpdb;
	return (string) $wpdb->get_var( $wpdb->prepare(
		"SELECT role FROM {$wpdb->prefix}sml_group_members WHERE group_id=%d AND user_id=%d
		  ORDER BY FIELD(role,'owner','admin','analyst','mod','premium','member') LIMIT 1",
		$gid, $uid ) );
}

/** SERVER-SIDE content gate for a group the user is already a member of. Fail-closed. */
function sml_mgh_can_read( array $group, $uid ) {
	$uid = (int) $uid;
	if ( ! $uid ) { return false; }
	if ( (int) ( $group['owner_id'] ?? 0 ) === $uid ) { return true; }
	if ( user_can( $uid, 'manage_options' ) ) { return true; }
	if ( ( $group['access_model'] ?? 'free' ) !== 'paid' ) { return true; }
	return in_array( sml_mgh_role( (int) $group['id'], $uid ), sml_mgh_paid_roles(), true );
}

/** Plain-text preview. Decode BEFORE stripping so encoded tags are removed, never revived. */
function sml_mgh_text( $html, $len = 320 ) {
	$t = wp_strip_all_tags( html_entity_decode( (string) $html, ENT_QUOTES, 'UTF-8' ), true );
	$t = trim( preg_replace( '/\s+/', ' ', $t ) );
	if ( mb_strlen( $t ) > $len ) { $t = mb_substr( $t, 0, $len - 1 ) . '…'; }
	return $t;
}

function sml_mgh_author( $uid ) {
	static $cache = array();
	$uid = (int) $uid;
	if ( isset( $cache[ $uid ] ) ) { return $cache[ $uid ]; }
	$u    = $uid ? get_userdata( $uid ) : null;
	$name = $u ? (string) $u->display_name : 'Member';
	$url  = '';
	if ( $uid && function_exists( 'sml_public_handle' ) ) {
		$h = sml_public_handle( $uid );
		if ( $h ) { $url = home_url( '/' . rawurlencode( (string) $h ) . '/' ); }
	}
	if ( '' === $url && $uid ) { $url = get_author_posts_url( $uid ); }
	return $cache[ $uid ] = array(
		'id'     => $uid,
		'name'   => $name,
		'url'    => esc_url_raw( $url ),
		'avatar' => esc_url_raw( (string) get_avatar_url( $uid, array( 'size' => 96 ) ) ),
	);
}

/** Is this stored message an alert? Alerts are never feed content, in any channel. */
function sml_mgh_is_alert_message( array $m ) {
	return false !== strpos( (string) ( $m['reactions'] ?? '' ), '_sml_alert_id' );
}

/** Real reactions on a message. Handles {emoji: [users]}, {emoji: n}, {emoji: {count}}
 *  and [{emoji, user}] lists; internal keys starting with "_" (e.g. _sml_alert_id) are not reactions. */
function sml_mgh_reaction_count( $raw ) {
	$data = json_decode( (string) $raw, true );
	if ( ! is_array( $data ) || ! $data ) { return 0; }
	$n = 0;
	if ( array_is_list( $data ) ) {
		foreach ( $data as $item ) {
			if ( is_array( $item ) || ( is_string( $item ) && '' !== $item ) ) { $n++; }
		}
		return $n;
	}
	foreach ( $data as $key => $value ) {
		if ( '' === (string) $key || '_' === ( (string) $key )[0] ) { continue; }
		if ( is_numeric( $value ) ) { $n += max( 0, (int) $value ); }
		elseif ( is_array( $value ) && isset( $value['count'] ) ) { $n += max( 0, (int) $value['count'] ); }
		elseif ( is_array( $value ) && isset( $value['users'] ) && is_array( $value['users'] ) ) { $n += count( $value['users'] ); }
		elseif ( is_array( $value ) ) { $n += count( $value ); }
	}
	return $n;
}

/**
 * The selection rule, pure (no database): which threads the viewer should see.
 *
 * @param array $messages  id => [id, channel_id, group_id, user_id, message, created_ts, reactions]
 *                         (only eligible text-channel messages; alerts already excluded)
 * @param array $parents   reply message id => the message id it replies to
 * @param int   $viewer
 * @param int   $now       unix time
 * @return array threads, newest activity first, each
 *               [root, replies[], people[], reactions, last_ts, reason]
 */
function sml_mgh_select_threads( array $messages, array $parents, $viewer, $now ) {
	$viewer = (int) $viewer;
	$root_of = function ( $id ) use ( $parents ) {
		$seen = array();
		while ( isset( $parents[ $id ] ) && ! isset( $seen[ $id ] ) && count( $seen ) < 50 ) {
			$seen[ $id ] = true;
			$id = (int) $parents[ $id ];
		}
		return (int) $id;
	};
	$threads = array();
	foreach ( $messages as $id => $m ) {
		$root = $root_of( (int) $id );
		if ( ! isset( $messages[ $root ] ) ) { continue; }          /* root is not eligible (alert, other channel, deleted) */
		if ( ! isset( $threads[ $root ] ) ) {
			$threads[ $root ] = array( 'root' => $messages[ $root ], 'replies' => array(), 'people' => array(), 'reactions' => 0, 'last_ts' => 0 );
		}
		$t = &$threads[ $root ];
		if ( (int) $id !== $root ) { $t['replies'][] = $m; }
		$t['people'][ (int) $m['user_id'] ] = true;
		$t['reactions'] += sml_mgh_reaction_count( $m['reactions'] ?? '' );
		$t['last_ts'] = max( $t['last_ts'], (int) $m['created_ts'] );
		unset( $t );
	}

	$out    = array();
	$cutoff = $now - SML_MGH_WINDOW_DAYS * DAY_IN_SECONDS;
	foreach ( $threads as $root => $t ) {
		if ( $t['last_ts'] < $cutoff ) { continue; }
		$people   = array_keys( $t['people'] );
		$others   = array_diff( $people, array( $viewer ) );
		$reason = '';
		if ( isset( $t['people'][ $viewer ] ) && $others ) {
			$reason = 'your_thread';
		} elseif ( ( count( $t['replies'] ) >= SML_MGH_HOT_REPLIES && count( $people ) >= SML_MGH_HOT_PEOPLE ) || $t['reactions'] >= SML_MGH_HOT_REACTIONS ) {
			$reason = 'hot';
		}
		if ( '' === $reason ) { continue; }
		$t['people'] = $people;
		$t['reason'] = $reason;
		$out[] = $t;
	}
	usort( $out, function ( $a, $b ) { return $b['last_ts'] <=> $a['last_ts']; } );
	return $out;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-group-landing/v1', '/my-groups/hot', array(
		'methods'             => 'GET',
		'permission_callback' => 'is_user_logged_in',
		'callback'            => 'sml_mgh_rest_hot',
	) );
} );

/** created_at is stored site-local (current_time('mysql')). */
function sml_mgh_local_ts( $mysql ) {
	$gmt = get_gmt_from_date( (string) $mysql );
	return $gmt ? (int) strtotime( $gmt . ' UTC' ) : 0;
}

function sml_mgh_rest_hot( WP_REST_Request $req ) {
	global $wpdb;
	$uid = get_current_user_id();
	if ( ! $uid ) {
		return new WP_Error( 'sml_mgh_auth', 'Sign in required.', array( 'status' => 401 ) );
	}
	$empty = function () {
		$res = new WP_REST_Response( array( 'hot' => array(), 'count' => 0 ) );
		$res->header( 'Cache-Control', 'no-store, private' );
		return $res;
	};
	$p = $wpdb->prefix;

	/* 1) groups the viewer belongs to, gated */
	$allowed = array();
	foreach ( (array) $wpdb->get_results( $wpdb->prepare(
		"SELECT g.id, g.name, g.slug, g.icon_url, g.owner_id, g.access_model
		   FROM {$p}sml_group_members m INNER JOIN {$p}sml_groups g ON g.id = m.group_id
		  WHERE m.user_id = %d GROUP BY g.id LIMIT 100", $uid ), ARRAY_A ) as $g ) {
		if ( sml_mgh_can_read( $g, $uid ) ) { $allowed[ (int) $g['id'] ] = $g; }
	}
	if ( ! $allowed ) { return $empty(); }
	$gids = array_map( 'intval', array_keys( $allowed ) );
	$gin  = implode( ',', $gids );

	/* 2) eligible chat channels: text only; not locked, archived, deleted or admins-only */
	$channels = array();
	foreach ( (array) $wpdb->get_results(
		"SELECT c.id, c.group_id, c.name FROM {$p}sml_group_channels c
		   LEFT JOIN {$p}sml_group_channel_meta cm ON cm.channel_id = c.id
		  WHERE c.group_id IN ($gin) AND c.type = 'text' AND c.is_locked = 0
		    AND ( cm.channel_id IS NULL OR ( ( cm.visibility IS NULL OR cm.visibility <> 'admins' ) AND ( cm.status IS NULL OR cm.status = 'active' ) AND cm.deleted_at IS NULL ) )", ARRAY_A ) as $c ) {
		$channels[ (int) $c['id'] ] = $c;
	}
	if ( ! $channels ) { return $empty(); }
	$cin = implode( ',', array_map( 'intval', array_keys( $channels ) ) );

	/* 3) recent messages in those channels, plus the roots their replies point at */
	$since_local = gmdate( 'Y-m-d H:i:s', time() + (int) ( get_option( 'gmt_offset' ) * HOUR_IN_SECONDS ) - ( SML_MGH_WINDOW_DAYS + 30 ) * DAY_IN_SECONDS );
	$rows = (array) $wpdb->get_results( $wpdb->prepare(
		"SELECT id, channel_id, group_id, user_id, message, media_url, reactions, created_at
		   FROM {$p}sml_group_channel_messages
		  WHERE channel_id IN ($cin) AND created_at >= %s
		  ORDER BY created_at DESC LIMIT 600", $since_local ), ARRAY_A );
	$parents = array();
	foreach ( (array) $wpdb->get_results(
		"SELECT message_id, reply_to_message_id FROM {$p}sml_group_message_replies
		  WHERE context_type = 'channel' AND channel_id IN ($cin)", ARRAY_A ) as $r ) {
		$parents[ (int) $r['message_id'] ] = (int) $r['reply_to_message_id'];
	}
	$messages = array();
	$add = function ( $m ) use ( &$messages, $channels, $allowed ) {
		$cid = (int) $m['channel_id']; $gid = (int) $m['group_id'];
		if ( ! isset( $channels[ $cid ] ) || ! isset( $allowed[ $gid ] ) || (int) $channels[ $cid ]['group_id'] !== $gid ) { return; }
		if ( sml_mgh_is_alert_message( $m ) ) { return; }
		if ( '' === sml_mgh_text( $m['message'] ) && '' === (string) $m['media_url'] ) { return; }
		$m['created_ts'] = sml_mgh_local_ts( $m['created_at'] );
		$messages[ (int) $m['id'] ] = $m;
	};
	foreach ( $rows as $m ) { $add( $m ); }
	$missing = array();
	foreach ( array_keys( $messages ) as $id ) {
		if ( isset( $parents[ $id ] ) && ! isset( $messages[ $parents[ $id ] ] ) ) { $missing[] = (int) $parents[ $id ]; }
	}
	if ( $missing ) {
		$min = implode( ',', array_unique( $missing ) );
		foreach ( (array) $wpdb->get_results( "SELECT id, channel_id, group_id, user_id, message, media_url, reactions, created_at FROM {$p}sml_group_channel_messages WHERE id IN ($min)", ARRAY_A ) as $m ) { $add( $m ); }
	}

	/* 4) the rule */
	$threads = sml_mgh_select_threads( $messages, $parents, $uid, time() );

	$hot = array(); $per = array();
	foreach ( $threads as $t ) {
		$root = $t['root'];
		$gid  = (int) $root['group_id'];
		$cid  = (int) $root['channel_id'];
		if ( ( $per[ $gid ] ?? 0 ) >= SML_MGH_PER_GROUP ) { continue; }
		$per[ $gid ] = ( $per[ $gid ] ?? 0 ) + 1;
		$g       = $allowed[ $gid ];
		$slug    = (string) $g['slug'];
		$g_url   = home_url( '/groups/' . rawurlencode( $slug ) . '/' );
		$chat    = add_query_arg( 'channel', $cid, $g_url );
		$latest  = $t['replies'] ? end( $t['replies'] ) : $root;
		foreach ( $t['replies'] as $r ) { if ( (int) $r['created_ts'] >= (int) $latest['created_ts'] ) { $latest = $r; } }
		$hot[] = array(
			'id'        => 'groupchat-' . (int) $root['id'],
			'kind'      => 'chat',
			'reason'    => $t['reason'],
			'thread_id' => (int) $root['id'],
			'group'     => array(
				'id'           => $gid,
				'name'         => (string) $g['name'],
				'slug'         => $slug,
				'url'          => esc_url_raw( $g_url ),
				'icon_url'     => esc_url_raw( (string) $g['icon_url'] ),
				'access_model' => ( 'paid' === ( $g['access_model'] ?? 'free' ) ) ? 'paid' : 'free',
			),
			'channel'   => array( 'id' => $cid, 'name' => sml_mgh_text( $channels[ $cid ]['name'], 60 ), 'url' => esc_url_raw( $chat ) ),
			'paid'      => 'paid' === ( $g['access_model'] ?? 'free' ),
			'author'    => sml_mgh_author( $root['user_id'] ),
			'body'      => sml_mgh_text( $root['message'] ),
			'latest'    => $t['replies'] ? array( 'author' => sml_mgh_author( $latest['user_id'] ), 'body' => sml_mgh_text( $latest['message'], 160 ) ) : null,
			'replies'   => count( $t['replies'] ),
			'people'    => count( $t['people'] ),
			'reactions' => (int) $t['reactions'],
			'media_url' => esc_url_raw( (string) $root['media_url'] ),
			'url'       => esc_url_raw( $chat ),
			'date'      => (string) $latest['created_at'],
			'date_gmt'  => gmdate( 'Y-m-d H:i:s', (int) $t['last_ts'] ),
		);
		if ( count( $hot ) >= SML_MGH_TOTAL ) { break; }
	}

	$res = new WP_REST_Response( array( 'hot' => $hot, 'count' => count( $hot ) ) );
	$res->header( 'Cache-Control', 'no-store, private' );
	return $res;
}
