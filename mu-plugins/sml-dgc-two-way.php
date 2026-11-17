<?php
/**
 * Plugin Name: SML Discord Group Two-Way Sync
 * Description: Group -> Discord half of the Discord channel sync (the Discord -> group half is sml-dgc-message-relay). A group owner picks, per Discord channel, "Discord → group", "Group → Discord" or "Both ways" in Edit Group → Discord Server Channel Sync. Also loads a server's channel list straight from Discord so owners never need /sync-sml-channels.
 * Version: 1.0.1
 *
 * Loop safety: posts go out through a channel webhook (or the bot when the webhook can not be made); the inbound relay already skips
 * bot and webhook messages unless explicitly enabled, and this side skips every message recorded in the inbound provenance log,
 * regardless of which public site account/persona it uses. So nothing echoes back and forth.
 * Abuse limits: @mentions never ping (allowed_mentions parse = []), 2,000-character cap, 20 posts per channel per run, 500 per channel per day,
 * history is never replayed (a new link starts at the newest message). Every post is logged (wp_sml_dgc_out_log) with its site message id.
 * Config: option sml_dgc_out_enabled ('1' default / '0'); token = sml_dgc_relay_bot_token (the Connect bot).
 * ROLLBACK: delete this file. The direction column stays (default 'in' = the original one-way behaviour).
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_DGC_OUT_DB', '1.0.0' );

function sml_dgc_out_log_table() { global $wpdb; return $wpdb->prefix . 'sml_dgc_out_log'; }

add_action( 'init', function () {
	if ( get_option( 'sml_dgc_out_db_version' ) === SML_DGC_OUT_DB || ! function_exists( 'sml_dgc_tables' ) ) { return; }
	global $wpdb;
	$t    = sml_dgc_tables();
	$maps = $t['channel_maps'];
	if ( ! $wpdb->get_var( $wpdb->prepare( "SHOW COLUMNS FROM {$maps} LIKE %s", 'direction' ) ) ) {
		$wpdb->query( "ALTER TABLE {$maps} ADD COLUMN direction VARCHAR(8) NOT NULL DEFAULT 'in'" );
	}
	// several Discord channels may feed one group channel (e.g. every alert channel -> the group's alerts channel)
	if ( $wpdb->get_var( $wpdb->prepare( "SHOW INDEX FROM {$maps} WHERE Key_name = %s", 'group_website_channel' ) ) ) {
		$wpdb->query( "ALTER TABLE {$maps} DROP INDEX group_website_channel" );
	}
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$log = sml_dgc_out_log_table();
	dbDelta( "CREATE TABLE {$log} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		site_message_id BIGINT UNSIGNED NOT NULL,
		discord_channel_id VARCHAR(32) NOT NULL,
		group_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
		site_user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
		discord_message_id VARCHAR(32) NOT NULL DEFAULT '',
		created_at DATETIME NOT NULL,
		PRIMARY KEY (id),
		UNIQUE KEY one_post (site_message_id, discord_channel_id),
		KEY group_recent (group_id, created_at)
	) {$wpdb->get_charset_collate()};" );
	if ( $wpdb->get_var( $wpdb->prepare( "SHOW COLUMNS FROM {$maps} LIKE %s", 'direction' ) ) ) {
		update_option( 'sml_dgc_out_db_version', SML_DGC_OUT_DB, false );
	}
}, 3 );

function sml_dgc_out_token() { return trim( (string) get_option( 'sml_dgc_relay_bot_token', '' ) ); }

function sml_dgc_out_discord( $method, $path, $body = null ) {
	$hold = (int) get_option( 'sml_dgc_out_backoff', 0 );
	if ( $hold > time() ) { return new WP_Error( 'sml_dgc_out_backoff', 'Holding off after a Discord rate limit.' ); }
	$args = array( 'method' => $method, 'timeout' => 15, 'headers' => array( 'Authorization' => 'Bot ' . sml_dgc_out_token(), 'User-Agent' => 'StockMarketLoopSync (https://stockmarketloop.com, 1.0)' ) );
	if ( null !== $body ) { $args['headers']['Content-Type'] = 'application/json'; $args['body'] = wp_json_encode( $body ); }
	$res = wp_remote_request( 'https://discord.com/api/v10' . $path, $args );
	if ( is_wp_error( $res ) ) { return $res; }
	$code = (int) wp_remote_retrieve_response_code( $res );
	$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
	if ( 429 === $code ) {
		update_option( 'sml_dgc_out_backoff', time() + max( 5, (int) ceil( (float) ( $data['retry_after'] ?? 30 ) ) ), false );
		return new WP_Error( 'sml_dgc_out_429', 'Discord rate limited the sync.' );
	}
	if ( $code >= 400 ) { return new WP_Error( 'sml_dgc_out_http', 'Discord answered HTTP ' . $code, array( 'status' => $code ) ); }
	return is_array( $data ) ? $data : array();
}

/* ---------- channel list straight from Discord (replaces /sync-sml-channels) ---------- */

function sml_dgc_out_refresh_catalog( $guild_id ) {
	global $wpdb;
	$guild_id = preg_replace( '/\D+/', '', (string) $guild_id );
	if ( '' === $guild_id || '' === sml_dgc_out_token() ) { return new WP_Error( 'sml_dgc_no_bot', 'The Connect bot is not set up.', array( 'status' => 503 ) ); }
	$guild    = sml_dgc_out_discord( 'GET', '/guilds/' . $guild_id );
	$channels = is_wp_error( $guild ) ? $guild : sml_dgc_out_discord( 'GET', '/guilds/' . $guild_id . '/channels' );
	$roles    = is_wp_error( $channels ) ? $channels : sml_dgc_out_discord( 'GET', '/guilds/' . $guild_id . '/roles' );
	if ( is_wp_error( $roles ) ) { return $roles; }
	$clean = function ( $v ) { return preg_replace( '/\D+/', '', (string) $v ); };
	$r_out = array();
	foreach ( array_slice( $roles, 0, 250 ) as $r ) {
		if ( ! $clean( $r['id'] ?? '' ) ) { continue; }
		$r_out[] = array( 'id' => $clean( $r['id'] ), 'name' => sanitize_text_field( $r['name'] ?? '' ), 'position' => intval( $r['position'] ?? 0 ), 'color' => absint( $r['color'] ?? 0 ), 'managed' => ! empty( $r['managed'] ) );
	}
	$c_out = array();
	foreach ( array_slice( $channels, 0, 500 ) as $c ) {
		if ( ! $clean( $c['id'] ?? '' ) ) { continue; }
		$ow = array();
		foreach ( array_slice( (array) ( $c['permission_overwrites'] ?? array() ), 0, 250 ) as $o ) {
			if ( $clean( $o['id'] ?? '' ) ) { $ow[] = array( 'id' => $clean( $o['id'] ), 'type' => absint( $o['type'] ?? 0 ), 'allow' => (string) ( $o['allow'] ?? '0' ), 'deny' => (string) ( $o['deny'] ?? '0' ) ); }
		}
		$c_out[] = array( 'id' => $clean( $c['id'] ), 'name' => sanitize_text_field( $c['name'] ?? '' ), 'type' => absint( $c['type'] ?? 0 ), 'position' => intval( $c['position'] ?? 0 ), 'parent_id' => $clean( $c['parent_id'] ?? '' ), 'permission_overwrites' => $ow );
	}
	usort( $c_out, function ( $a, $b ) { return $a['position'] <=> $b['position']; } );
	$t    = sml_dgc_tables();
	$icon = ! empty( $guild['icon'] ) && preg_match( '/^[a-z0-9_]+$/i', $guild['icon'] ) ? 'https://cdn.discordapp.com/icons/' . $guild_id . '/' . $guild['icon'] . '.png' : '';
	$data = array( 'guild_name' => sanitize_text_field( $guild['name'] ?? '' ), 'guild_icon_url' => esc_url_raw( $icon ), 'roles_json' => wp_json_encode( $r_out ), 'channels_json' => wp_json_encode( $c_out ), 'updated_at' => sml_dgc_now() );
	if ( $wpdb->get_var( $wpdb->prepare( "SELECT guild_id FROM {$t['catalogs']} WHERE guild_id=%s", $guild_id ) ) ) { $wpdb->update( $t['catalogs'], $data, array( 'guild_id' => $guild_id ) ); }
	else { $data['guild_id'] = $guild_id; $wpdb->insert( $t['catalogs'], $data ); }
	return array( 'channels' => count( $c_out ), 'roles' => count( $r_out ) );
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-discord-site/v2', '/group/(?P<group_id>\d+)/channel-sync/refresh', array(
		'methods'             => 'POST',
		'permission_callback' => function ( WP_REST_Request $r ) { return function_exists( 'sml_dgc_can_manage' ) && sml_dgc_can_manage( absint( $r['group_id'] ) ); },
		'callback'            => function ( WP_REST_Request $r ) {
			$gid    = absint( $r['group_id'] );
			$config = sml_dgc_connector( $gid );
			if ( ! $config || 'active' !== $config['state'] ) { return new WP_Error( 'sml_dgc_not_connected', 'Connect a Discord server first.', array( 'status' => 409 ) ); }
			// at most once a minute per server: the panel calls this every time it opens
			$key = 'sml_dgc_cat_fresh_' . md5( (string) $config['guild_id'] );
			if ( get_transient( $key ) ) { return rest_ensure_response( array( 'ok' => true, 'cached' => true ) ); }
			$out = sml_dgc_out_refresh_catalog( $config['guild_id'] );
			if ( is_wp_error( $out ) ) { return $out; }
			set_transient( $key, 1, 60 );
			return rest_ensure_response( array( 'ok' => true ) + $out );
		},
	) );
} );

/* ---------- group -> Discord ---------- */

/** One webhook per Discord channel (posts show the member's name and picture); null = post as the bot. */
function sml_dgc_out_webhook( $channel_id ) {
	$hooks = get_option( 'sml_dgc_out_webhooks', array() );
	$hooks = is_array( $hooks ) ? $hooks : array();
	if ( isset( $hooks[ $channel_id ] ) ) { return $hooks[ $channel_id ] ?: null; }
	$made = sml_dgc_out_discord( 'POST', '/channels/' . $channel_id . '/webhooks', array( 'name' => 'StockMarketLoop' ) );
	if ( is_wp_error( $made ) ) {
		if ( in_array( $made->get_error_code(), array( 'sml_dgc_out_429', 'sml_dgc_out_backoff' ), true ) ) { return false; }
		$hooks[ $channel_id ] = ''; // no Manage Webhooks: use the bot from now on
	} else {
		$hooks[ $channel_id ] = array( 'id' => (string) $made['id'], 'token' => (string) $made['token'] );
	}
	update_option( 'sml_dgc_out_webhooks', $hooks, false );
	return $hooks[ $channel_id ] ?: null;
}

function sml_dgc_out_text( $row, $group_slug, $as_bot, $name ) {
	$text = wp_strip_all_tags( (string) $row['message'] );
	$text = preg_replace( '/@(everyone|here)/i', "@\u{200B}$1", $text );
	$text = trim( $text );
	if ( ! empty( $row['media_url'] ) ) { $text .= ( '' === $text ? '' : "\n" ) . esc_url_raw( $row['media_url'] ); }
	if ( $as_bot ) { $text = '**' . $name . '** · StockMarketLoop' . "\n" . $text; }
	if ( mb_strlen( $text ) > 1900 ) { $text = mb_substr( $text, 0, 1890 ) . '…'; }
	return $text;
}

add_action( 'sml_dgc_relay_tick', 'sml_dgc_out_tick', 20 );
function sml_dgc_out_tick() {
	if ( '0' === (string) get_option( 'sml_dgc_out_enabled', '1' ) || '' === sml_dgc_out_token() || ! function_exists( 'sml_dgc_tables' ) ) { return; }
	if ( get_option( 'sml_dgc_out_db_version' ) !== SML_DGC_OUT_DB ) { return; }
	if ( get_transient( 'sml_dgc_out_lock' ) ) { set_transient( 'sml_dgc_out_again', 1, 120 ); return; } // the running pass goes round once more
	set_transient( 'sml_dgc_out_lock', 1, 120 );
	try {
		for ( $i = 0; $i < 3; $i++ ) {
			delete_transient( 'sml_dgc_out_again' );
			sml_dgc_out_run();
			if ( ! get_transient( 'sml_dgc_out_again' ) ) { break; }
		}
	} finally { delete_transient( 'sml_dgc_out_lock' ); }
}

/* Instant group -> Discord: many plugins save group posts, so watch the database for any new row in the
   messages table, then send it to Discord right after the poster has their answer (the minute run stays the fallback). */
add_filter( 'query', function ( $q ) {
	if ( empty( $GLOBALS['sml_dgc_out_seen'] ) && is_string( $q ) && 0 === stripos( ltrim( $q ), 'INSERT' ) && false !== strpos( $q, 'sml_group_channel_messages' ) ) {
		$GLOBALS['sml_dgc_out_seen'] = true;
		add_action( 'shutdown', function () {
			if ( function_exists( 'fastcgi_finish_request' ) ) { fastcgi_finish_request(); }
			sml_dgc_out_tick();
		}, 99 );
	}
	return $q;
} );

function sml_dgc_out_run() {
	global $wpdb;
	$t        = sml_dgc_tables();
	$log      = sml_dgc_out_log_table();
	$msgs     = $wpdb->prefix . 'sml_group_channel_messages';
	$inbound_log = $wpdb->prefix . 'sml_dgc_relay_log';
	$has_inbound_log = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $inbound_log ) ) === $inbound_log;
	$relay_id = absint( get_option( 'sml_dgc_relay_user_id', 0 ) );
	$cursors  = get_option( 'sml_dgc_out_cursors', array() );
	$cursors  = is_array( $cursors ) ? $cursors : array();
	$started  = time();
	$status   = array( 'last_run' => gmdate( DATE_ATOM ), 'maps' => array() );
	$day      = gmdate( 'Ymd' );
	$quota    = get_option( 'sml_dgc_out_quota', array() );
	$quota    = array( $day => is_array( $quota ) && isset( $quota[ $day ] ) ? (array) $quota[ $day ] : array() );
	$paused   = array_map( 'strval', (array) get_option( 'sml_dgc_relay_disabled_guilds', array() ) );
	$maps = $wpdb->get_results( "SELECT m.id map_id, m.group_id, m.discord_channel_id, m.website_channel_id, c.guild_id
		FROM {$t['channel_maps']} m INNER JOIN {$t['connectors']} c ON c.group_id = m.group_id AND c.state = 'active'
		INNER JOIN {$t['channels']} sc ON sc.id = m.website_channel_id AND sc.group_id = m.group_id
		WHERE m.direction IN ('out','both') ORDER BY m.id ASC LIMIT 60", ARRAY_A );
	foreach ( (array) $maps as $map ) {
		if ( time() - $started > 40 ) { $status['stopped'] = 'time_budget'; break; }
		$dch  = preg_replace( '/\D+/', '', (string) $map['discord_channel_id'] );
		$sch  = absint( $map['website_channel_id'] );
		$gid  = absint( $map['group_id'] );
		$key  = $sch . ':' . $dch;
		if ( '' === $dch || in_array( (string) $map['guild_id'], $paused, true ) ) { continue; }
		if ( ! isset( $cursors[ $key ] ) ) {
			// a new link starts from now: never replays the channel's history into Discord
			$cursors[ $key ] = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(MAX(id),0) FROM {$msgs} WHERE channel_id=%d", $sch ) );
			$status['maps'][ $key ] = 'baselined';
			continue;
		}
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT id, user_id, message, media_url FROM {$msgs} WHERE channel_id=%d AND id>%d ORDER BY id ASC LIMIT 20", $sch, (int) $cursors[ $key ] ), ARRAY_A );
		$inbound_ids = array();
		if ( $has_inbound_log && $rows ) {
			$row_ids = array_values( array_filter( array_map( 'absint', wp_list_pluck( $rows, 'id' ) ) ) );
			if ( $row_ids ) {
				$inbound_ids = array_flip( array_map( 'intval', $wpdb->get_col( "SELECT site_message_id FROM {$inbound_log} WHERE site_message_id IN (" . implode( ',', $row_ids ) . ')' ) ?: array() ) );
			}
		}
		$used = (int) ( $quota[ $day ][ $key ] ?? 0 );
		$sent = 0;
		foreach ( (array) $rows as $row ) {
			$cursors[ $key ] = (int) $row['id'];
			if ( isset( $inbound_ids[ (int) $row['id'] ] ) || ( $relay_id && (int) $row['user_id'] === $relay_id ) ) { continue; } // came from Discord: never echo it back
			if ( '' === trim( (string) $row['message'] ) && '' === (string) $row['media_url'] ) { continue; }
			if ( $used >= 500 ) { $status['maps'][ $key ] = 'daily_limit'; continue; }
			$wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$log} (site_message_id, discord_channel_id, group_id, site_user_id, created_at) VALUES (%d,%s,%d,%d,%s)", $row['id'], $dch, $gid, $row['user_id'], current_time( 'mysql', true ) ) );
			if ( ! $wpdb->rows_affected ) { continue; }
			$user = get_userdata( (int) $row['user_id'] );
			$name = $user ? sanitize_text_field( $user->display_name ) : 'Member';
			$name = mb_substr( preg_replace( '/discord|clyde/i', '', $name ) ?: 'Member', 0, 60 );
			$hook = sml_dgc_out_webhook( $dch );
			if ( false === $hook ) { $wpdb->delete( $log, array( 'site_message_id' => $row['id'], 'discord_channel_id' => $dch ) ); $cursors[ $key ] = (int) $row['id'] - 1; break; }
			$payload = array( 'content' => sml_dgc_out_text( $row, '', ! $hook, $name ), 'allowed_mentions' => array( 'parse' => array() ) );
			if ( $hook ) {
				$payload['username'] = $name . ' · StockMarketLoop';
				$avatar = get_avatar_url( (int) $row['user_id'], array( 'size' => 128 ) );
				if ( $avatar ) { $payload['avatar_url'] = $avatar; }
				$res = sml_dgc_out_discord( 'POST', '/webhooks/' . $hook['id'] . '/' . $hook['token'] . '?wait=true', $payload );
				if ( is_wp_error( $res ) && 404 === (int) ( $res->get_error_data()['status'] ?? 0 ) ) { // webhook was deleted in Discord: make a new one next run
					$hooks = (array) get_option( 'sml_dgc_out_webhooks', array() ); unset( $hooks[ $dch ] ); update_option( 'sml_dgc_out_webhooks', $hooks, false );
				}
			} else {
				$res = sml_dgc_out_discord( 'POST', '/channels/' . $dch . '/messages', $payload );
			}
			if ( is_wp_error( $res ) ) {
				$wpdb->delete( $log, array( 'site_message_id' => $row['id'], 'discord_channel_id' => $dch ) );
				$status['maps'][ $key ] = 'post_failed: ' . $res->get_error_message();
				if ( in_array( $res->get_error_code(), array( 'sml_dgc_out_429', 'sml_dgc_out_backoff' ), true ) || 404 === (int) ( $res->get_error_data()['status'] ?? 0 ) ) { $cursors[ $key ] = (int) $row['id'] - 1; }
				break;
			}
			$wpdb->update( $log, array( 'discord_message_id' => (string) ( $res['id'] ?? '' ) ), array( 'site_message_id' => $row['id'], 'discord_channel_id' => $dch ) );
			$sent++; $used++;
		}
		$quota[ $day ][ $key ] = $used;
		if ( ! isset( $status['maps'][ $key ] ) ) { $status['maps'][ $key ] = 'ok sent=' . $sent; }
		update_option( 'sml_dgc_out_cursors', $cursors, false );
	}
	update_option( 'sml_dgc_out_cursors', $cursors, false );
	update_option( 'sml_dgc_out_quota', $quota, false );
	update_option( 'sml_dgc_out_status', $status, false );
}

/* ---------- instant Discord -> group: the Connect bot sees each message live and nudges the site ---------- */

add_action( 'rest_api_init', function () {
	$bot = function () { return function_exists( 'sml_dgc_bot_permission' ) && sml_dgc_bot_permission(); };
	// the Discord channels the bot should watch (only ones that feed a group)
	register_rest_route( 'sml-discord-site/v2', '/bot/relay-channels', array(
		'methods' => 'GET', 'permission_callback' => $bot,
		'callback' => function () {
			global $wpdb;
			$t = sml_dgc_tables();
			$ids = $wpdb->get_col( "SELECT DISTINCT m.discord_channel_id FROM {$t['channel_maps']} m INNER JOIN {$t['connectors']} c ON c.group_id = m.group_id AND c.state = 'active' WHERE m.direction IN ('in','both')" );
			return rest_ensure_response( array( 'ok' => true, 'channels' => array_values( array_map( 'strval', (array) $ids ) ) ) );
		},
	) );
	// "a new message is in channel X": pull that one channel now, through the normal relay (same checks, same dedup)
	register_rest_route( 'sml-discord-site/v2', '/bot/relay-nudge', array(
		'methods' => 'POST', 'permission_callback' => $bot,
		'callback' => function ( WP_REST_Request $r ) {
			$ch = preg_replace( '/\D+/', '', (string) $r->get_param( 'channel_id' ) );
			if ( '' === $ch || ! function_exists( 'sml_dgc_relay_poll' ) ) { return new WP_Error( 'sml_dgc_bad_nudge', 'Unknown channel.', array( 'status' => 400 ) ); }
			$GLOBALS['sml_dgc_relay_only'] = $ch;
			$imported = null;
			for ( $i = 0; $i < 8 && null === $imported; $i++ ) { // the minute run may hold the lock for a moment
				if ( $i ) { usleep( 600000 ); }
				$imported = sml_dgc_relay_poll();
			}
			unset( $GLOBALS['sml_dgc_relay_only'] );
			return rest_ensure_response( array( 'ok' => true, 'imported' => null === $imported ? 'queued' : (int) $imported ) );
		},
	) );
} );
