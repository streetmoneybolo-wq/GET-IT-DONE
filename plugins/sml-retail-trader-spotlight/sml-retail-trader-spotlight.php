<?php
/**
 * Plugin Name: SML Retail Trader Spotlight
 * Description: Multi-tenant Discord alert monitoring, Loop Bucks subscriptions, and newsroom source records for eligible StockMarketLoop groups.
 * Version: 1.3.2
 * Author: StockMarketLoop
 */

defined( 'ABSPATH' ) || exit;

final class SML_Retail_Trader_Spotlight {
	const VERSION = '1.3.2';
	const DB_VERSION = '3';
	const MIN_MEMBERS = 1000;
	const BASE_MONTHLY_PRICE = 4000;
	const AUTHOR_LOGIN = 'retail-trader-spotlight';
	const CRON_HOOK = 'sml_rts_monthly_renewals';
	const DM_CRON_HOOK = 'sml_rts_deliver_discord_dms';

	private static $instance;

	public static function instance() {
		if ( ! self::$instance ) self::$instance = new self();
		return self::$instance;
	}

	private function __construct() {
		register_activation_hook( __FILE__, array( __CLASS__, 'activate' ) );
		register_deactivation_hook( __FILE__, array( __CLASS__, 'deactivate' ) );
		add_action( 'plugins_loaded', array( $this, 'maybe_upgrade' ) );
		add_action( 'rest_api_init', array( $this, 'routes' ) );
		add_action( self::CRON_HOOK, array( $this, 'renew_due_subscriptions' ) );
		add_filter( 'cron_schedules', array( $this, 'cron_schedules' ) );
		add_action( 'sml_rts_poll_discord', array( $this, 'poll_discord' ) );
		add_action( self::DM_CRON_HOOK, array( $this, 'deliver_discord_dms' ) );
		add_shortcode( 'sml_retail_trader_spotlight', array( $this, 'shortcode' ) );
		add_filter( 'sml_lb_reasons', array( $this, 'ledger_reasons' ) );
		add_filter( 'get_avatar_data', array( $this, 'avatar' ), 30, 2 );
		add_action( 'wp_enqueue_scripts', array( $this, 'group_assets' ) );
		add_action( 'wp_footer', array( $this, 'group_asset_fallback' ), 999 );
	}

	private static function table( $name ) {
		global $wpdb;
		return $wpdb->prefix . 'sml_rts_' . $name;
	}

	public static function activate() {
		self::install();
		self::ensure_author();
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', self::CRON_HOOK );
		if ( ! wp_next_scheduled( 'sml_rts_poll_discord' ) ) wp_schedule_event( time() + 30, 'sml_rts_minute', 'sml_rts_poll_discord' );
		if ( ! wp_next_scheduled( self::DM_CRON_HOOK ) ) wp_schedule_event( time() + 45, 'sml_rts_minute', self::DM_CRON_HOOK );
	}

	public static function deactivate() {
		wp_clear_scheduled_hook( self::CRON_HOOK );
		wp_clear_scheduled_hook( 'sml_rts_poll_discord' );
		wp_clear_scheduled_hook( self::DM_CRON_HOOK );
	}

	public function maybe_upgrade() {
		if ( self::DB_VERSION !== get_option( 'sml_rts_db_version' ) ) self::install();
		self::ensure_author();
		if ( ! wp_next_scheduled( 'sml_rts_poll_discord' ) ) wp_schedule_event( time() + 30, 'sml_rts_minute', 'sml_rts_poll_discord' );
		if ( ! wp_next_scheduled( self::DM_CRON_HOOK ) ) wp_schedule_event( time() + 45, 'sml_rts_minute', self::DM_CRON_HOOK );
	}

	private static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();
		$configs = self::table( 'configs' );
		$events = self::table( 'events' );
		$audit = self::table( 'audit' );
		$optins = self::table( 'dm_optins' );
		$deliveries = self::table( 'dm_deliveries' );
		dbDelta( "CREATE TABLE $configs (
			group_id bigint(20) unsigned NOT NULL,
			owner_user_id bigint(20) unsigned NOT NULL,
			guild_id varchar(32) NOT NULL,
			channel_id varchar(32) NOT NULL,
			channel_ids longtext NULL,
			monitored_users longtext NOT NULL,
			status varchar(20) NOT NULL DEFAULT 'inactive',
			monthly_price bigint(20) unsigned NOT NULL DEFAULT 2000,
			paid_through datetime NULL,
			last_billed_period varchar(7) NOT NULL DEFAULT '',
			last_error varchar(255) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY (group_id),
			KEY status_paid (status,paid_through)
		) $charset;" );
		dbDelta( "CREATE TABLE $optins (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			group_id bigint(20) unsigned NOT NULL,
			user_id bigint(20) unsigned NOT NULL,
			discord_user_id varchar(32) NOT NULL,
			status varchar(20) NOT NULL DEFAULT 'active',
			consented_at datetime NOT NULL,
			revoked_at datetime NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY group_user (group_id,user_id),
			KEY group_status (group_id,status)
		) $charset;" );
		dbDelta( "CREATE TABLE $deliveries (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			event_uuid char(36) NOT NULL,
			optin_id bigint(20) unsigned NOT NULL,
			status varchar(20) NOT NULL DEFAULT 'pending',
			attempts tinyint(3) unsigned NOT NULL DEFAULT 0,
			next_attempt_at datetime NOT NULL,
			last_error varchar(255) NOT NULL DEFAULT '',
			delivered_at datetime NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY event_optin (event_uuid,optin_id),
			KEY due (status,next_attempt_at)
		) $charset;" );
		$wpdb->query( 'UPDATE ' . $configs . " SET channel_ids=CONCAT('[\"',channel_id,'\"]') WHERE (channel_ids IS NULL OR channel_ids='') AND channel_id<>''" );
		dbDelta( "CREATE TABLE $events (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			event_uuid char(36) NOT NULL,
			group_id bigint(20) unsigned NOT NULL,
			guild_id varchar(32) NOT NULL,
			channel_id varchar(32) NOT NULL,
			discord_message_id varchar(32) NOT NULL,
			discord_user_id varchar(32) NOT NULL,
			discord_display_name varchar(190) NOT NULL,
			ticker varchar(12) NOT NULL,
			alert_text text NOT NULL,
			alerted_at datetime NOT NULL,
			payload longtext NULL,
			status varchar(24) NOT NULL DEFAULT 'accepted',
			created_at datetime NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY event_uuid (event_uuid),
			UNIQUE KEY discord_message (guild_id,discord_message_id),
			KEY group_created (group_id,created_at),
			KEY ticker_status_created (ticker,status,created_at)
		) $charset;" );
		dbDelta( "CREATE TABLE $audit (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			group_id bigint(20) unsigned NOT NULL DEFAULT 0,
			user_id bigint(20) unsigned NOT NULL DEFAULT 0,
			event_type varchar(64) NOT NULL,
			detail longtext NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY (id),
			KEY group_created (group_id,created_at)
		) $charset;" );
		update_option( 'sml_rts_db_version', self::DB_VERSION, false );
	}

	private static function ensure_author() {
		$user = get_user_by( 'login', self::AUTHOR_LOGIN );
		if ( ! $user ) {
			$password = wp_generate_password( 40, true, true );
			$id = wp_insert_user( array(
				'user_login' => self::AUTHOR_LOGIN,
				'user_pass' => $password,
				'user_nicename' => self::AUTHOR_LOGIN,
				'display_name' => 'Retail Trader Spotlight',
				'role' => 'author',
				'description' => 'Verified, timestamped retail-trader alert coverage published by StockMarketLoop.',
			) );
			if ( ! is_wp_error( $id ) ) $user = get_user_by( 'id', $id );
		} elseif ( 'Retail Trader Spotlight' !== $user->display_name ) {
			wp_update_user( array( 'ID' => $user->ID, 'display_name' => 'Retail Trader Spotlight' ) );
		}
		if ( $user ) {
			$avatar_url = plugin_dir_url( __FILE__ ) . 'assets/retail-trader-spotlight.png';
			update_user_meta( $user->ID, 'sml_avatar_url', esc_url_raw( $avatar_url ) );
			update_user_meta( $user->ID, 'sml_automated_editorial_desk', '1' );
			update_user_meta( $user->ID, 'sml_editorial_desk_key', 'retail-trader-spotlight' );
			update_user_meta( $user->ID, 'sml_editorial_beat', 'Verified, timestamped alerts from eligible StockMarketLoop group communities.' );
			$ids = get_option( 'sml_newsroom_author_ids', array() );
			$ids = is_array( $ids ) ? $ids : array();
			if ( (int) ( $ids['retail-trader-spotlight'] ?? 0 ) !== (int) $user->ID ) {
				$ids['retail-trader-spotlight'] = (int) $user->ID;
				update_option( 'sml_newsroom_author_ids', $ids, false );
			}
		}
	}

	private static function avatar_user( $id_or_email ) {
		if ( $id_or_email instanceof WP_User ) return $id_or_email;
		if ( $id_or_email instanceof WP_Post ) return get_user_by( 'id', $id_or_email->post_author );
		if ( $id_or_email instanceof WP_Comment && $id_or_email->user_id ) return get_user_by( 'id', $id_or_email->user_id );
		if ( is_numeric( $id_or_email ) ) return get_user_by( 'id', absint( $id_or_email ) );
		if ( is_string( $id_or_email ) && is_email( $id_or_email ) ) return get_user_by( 'email', $id_or_email );
		return false;
	}

	public function avatar( $args, $id_or_email ) {
		$user = self::avatar_user( $id_or_email );
		if ( ! $user || self::AUTHOR_LOGIN !== $user->user_login ) return $args;
		$path = plugin_dir_path( __FILE__ ) . 'assets/retail-trader-spotlight.png';
		if ( ! is_readable( $path ) ) return $args;
		$args['url'] = plugin_dir_url( __FILE__ ) . 'assets/retail-trader-spotlight.png';
		$args['found_avatar'] = true;
		return $args;
	}

	public function ledger_reasons( $reasons ) {
		if ( ! is_array( $reasons ) ) return $reasons;
		$reasons['retail_spotlight_subscription'] = array( 'flow' => 'absorb', 'label' => 'Retail Trader Spotlight subscription' );
		return $reasons;
	}

	public function cron_schedules( $schedules ) {
		$schedules['sml_rts_minute'] = array( 'interval' => 60, 'display' => 'Every minute (Retail Trader Spotlight)' );
		return $schedules;
	}

	private static function snowflake( $value ) {
		$value = preg_replace( '/\D/', '', (string) $value );
		return preg_match( '/^\d{15,24}$/', $value ) ? $value : '';
	}

	private static function now() { return current_time( 'mysql', true ); }

	private static function group_tables() {
		global $wpdb;
		return array(
			'groups' => $wpdb->prefix . 'sml_groups',
			'members' => $wpdb->prefix . 'sml_group_members',
			'connectors' => $wpdb->prefix . 'sml_discord_group_connectors',
		);
	}

	private static function can_manage( $group_id, $user_id = 0 ) {
		global $wpdb;
		$user_id = $user_id ? absint( $user_id ) : get_current_user_id();
		$group_id = absint( $group_id );
		if ( ! $user_id || ! $group_id ) return false;
		if ( function_exists( 'sml_groups_current_user_can_manage' ) && sml_groups_current_user_can_manage( $group_id, $user_id ) ) return true;
		$t = self::group_tables();
		if ( (int) $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$t['groups']} WHERE id=%d", $group_id ) ) === $user_id ) return true;
		$role = (string) $wpdb->get_var( $wpdb->prepare( "SELECT role FROM {$t['members']} WHERE group_id=%d AND user_id=%d", $group_id, $user_id ) );
		return in_array( $role, array( 'owner', 'admin' ), true );
	}

	private static function member_count( $group_id ) {
		global $wpdb;
		$t = self::group_tables();
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(DISTINCT user_id) FROM {$t['members']} WHERE group_id=%d", absint( $group_id ) ) );
	}

	private static function is_group_member( $group_id, $user_id = 0 ) {
		global $wpdb;
		$user_id = $user_id ? absint( $user_id ) : get_current_user_id();
		if ( self::can_manage( $group_id, $user_id ) ) return true;
		$t = self::group_tables();
		return (bool) $wpdb->get_var( $wpdb->prepare( "SELECT user_id FROM {$t['members']} WHERE group_id=%d AND user_id=%d LIMIT 1", absint( $group_id ), $user_id ) );
	}

	private static function linked_discord_user_id( $user_id = 0 ) {
		global $wpdb;
		$user_id = $user_id ? absint( $user_id ) : get_current_user_id();
		$table = $wpdb->prefix . 'sml_discord_site_links';
		if ( function_exists( 'sml_dgc_tables' ) ) {
			$tables = sml_dgc_tables();
			if ( ! empty( $tables['links'] ) ) $table = $tables['links'];
		}
		return self::snowflake( $wpdb->get_var( $wpdb->prepare( "SELECT discord_user_id FROM $table WHERE user_id=%d LIMIT 1", $user_id ) ) );
	}

	private static function connector( $group_id ) {
		global $wpdb;
		$t = self::group_tables();
		return $wpdb->get_row( $wpdb->prepare( "SELECT guild_id,state,created_by_user_id,claimed_by_discord_user_id FROM {$t['connectors']} WHERE group_id=%d", absint( $group_id ) ), ARRAY_A );
	}

	private static function config( $group_id ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table( 'configs' ) . ' WHERE group_id=%d', absint( $group_id ) ), ARRAY_A );
	}

	private static function config_channel_ids( $config ) {
		$ids = is_array( $config ) ? json_decode( (string) ( $config['channel_ids'] ?? '' ), true ) : array();
		if ( ! is_array( $ids ) || ! $ids ) $ids = array( is_array( $config ) ? ( $config['channel_id'] ?? '' ) : '' );
		$out = array();
		foreach ( $ids as $id ) {
			$id = self::snowflake( $id );
			if ( $id ) $out[ $id ] = true;
		}
		return array_keys( $out );
	}

	private static function base_monthly_price() {
		return max( 1, (int) apply_filters( 'sml_rts_base_monthly_price', self::BASE_MONTHLY_PRICE ) );
	}

	private static function monthly_price( $group_id ) {
		$base = self::base_monthly_price();
		return self::member_count( $group_id ) >= self::MIN_MEMBERS ? (int) floor( $base / 2 ) : $base;
	}

	private static function discord_catalog( $guild_id ) {
		$guild_id = self::snowflake( $guild_id );
		if ( ! $guild_id ) return null;
		if ( function_exists( 'sml_dgc_catalog' ) ) {
			$catalog = sml_dgc_catalog( $guild_id );
			if ( is_array( $catalog ) ) return $catalog;
		}
		global $wpdb;
		$table = $wpdb->prefix . 'sml_discord_guild_catalogs';
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT guild_id,guild_name,channels_json,updated_at FROM $table WHERE guild_id=%s", $guild_id ), ARRAY_A );
		if ( ! $row ) return null;
		return array(
			'guild_id' => (string) $row['guild_id'],
			'guild_name' => (string) $row['guild_name'],
			'channels' => json_decode( (string) $row['channels_json'], true ) ?: array(),
			'updated_at' => (string) $row['updated_at'],
		);
	}

	private static function spotlight_channels( $guild_id ) {
		$catalog = self::discord_catalog( $guild_id );
		$out = array();
		foreach ( (array) ( $catalog['channels'] ?? array() ) as $channel ) {
			$type = (int) ( $channel['type'] ?? -1 );
			$id = self::snowflake( $channel['id'] ?? '' );
			if ( ! $id || ! in_array( $type, array( 0, 5 ), true ) ) continue;
			$out[] = array( 'id' => $id, 'name' => sanitize_text_field( $channel['name'] ?? $id ), 'type' => $type );
		}
		return array(
			'guild_id' => self::snowflake( $guild_id ),
			'guild_name' => sanitize_text_field( $catalog['guild_name'] ?? '' ),
			'updated_at' => sanitize_text_field( $catalog['updated_at'] ?? '' ),
			'channels' => $out,
		);
	}

	public static function bot_permission() { return current_user_can( 'manage_options' ); }

	private static function audit( $group_id, $event, $detail = array(), $user_id = 0 ) {
		global $wpdb;
		$wpdb->insert( self::table( 'audit' ), array(
			'group_id' => absint( $group_id ), 'user_id' => $user_id ? absint( $user_id ) : get_current_user_id(),
			'event_type' => sanitize_key( $event ), 'detail' => wp_json_encode( $detail, JSON_UNESCAPED_SLASHES ), 'created_at' => self::now(),
		), array( '%d', '%d', '%s', '%s', '%s' ) );
	}

	private static function public_status( $group_id ) {
		$config = self::config( $group_id );
		$connector = self::connector( $group_id );
		$count = self::member_count( $group_id );
		$discount_eligible = $count >= self::MIN_MEMBERS;
		$base_price = self::base_monthly_price();
		$monthly_price = self::monthly_price( $group_id );
		return array(
			'group_id' => absint( $group_id ), 'member_count' => $count, 'minimum_members' => self::MIN_MEMBERS,
			'eligible' => true, 'discount_eligible' => $discount_eligible, 'base_monthly_price' => $base_price,
			'discount_percent' => 50, 'monthly_price' => $monthly_price,
			'status' => $config ? $config['status'] : 'not_configured',
			'paid_through' => $config ? $config['paid_through'] : null,
			'configured' => (bool) ( $config && self::config_channel_ids( $config ) && json_decode( $config['monitored_users'], true ) ),
			'connector_state' => $connector ? (string) $connector['state'] : 'not_connected',
			'connector_guild_id' => $connector ? (string) $connector['guild_id'] : '',
			'discord_manager_verified' => (bool) ( $connector && 'active' === $connector['state'] && self::snowflake( $connector['claimed_by_discord_user_id'] ?? '' ) ),
			'wallet_balance' => class_exists( 'SML_Store' ) && method_exists( 'SML_Store', 'balance' ) ? (int) SML_Store::balance( get_current_user_id() ) : null,
		);
	}

	public function routes() {
		register_rest_route( 'sml-retail-spotlight/v1', '/group/(?P<group_id>\d+)/status', array( 'methods' => 'GET', 'callback' => array( $this, 'status' ), 'permission_callback' => 'is_user_logged_in' ) );
		register_rest_route( 'sml-retail-spotlight/v1', '/group/(?P<group_id>\d+)/config', array( 'methods' => array( 'GET', 'POST' ), 'callback' => array( $this, 'configuration' ), 'permission_callback' => 'is_user_logged_in' ) );
		register_rest_route( 'sml-retail-spotlight/v1', '/group/(?P<group_id>\d+)/subscribe', array( 'methods' => 'POST', 'callback' => array( $this, 'subscribe' ), 'permission_callback' => 'is_user_logged_in' ) );
		register_rest_route( 'sml-retail-spotlight/v1', '/group/(?P<group_id>\d+)/diagnostic', array( 'methods' => 'POST', 'callback' => array( $this, 'diagnostic' ), 'permission_callback' => 'is_user_logged_in' ) );
		register_rest_route( 'sml-retail-spotlight/v1', '/group/(?P<group_id>\d+)/dm-subscription', array( 'methods' => array( 'GET', 'POST', 'DELETE' ), 'callback' => array( $this, 'dm_subscription' ), 'permission_callback' => 'is_user_logged_in' ) );
		register_rest_route( 'sml-retail-spotlight/v1', '/bot/configured-groups', array( 'methods' => 'GET', 'callback' => array( $this, 'bot_groups' ), 'permission_callback' => array( __CLASS__, 'bot_permission' ) ) );
		register_rest_route( 'sml-retail-spotlight/v1', '/bot/alerts', array( 'methods' => 'POST', 'callback' => array( $this, 'bot_alert' ), 'permission_callback' => array( __CLASS__, 'bot_permission' ) ) );
		register_rest_route( 'sml-retail-spotlight/v1', '/newsroom/pending', array( 'methods' => 'GET', 'callback' => array( $this, 'newsroom_pending' ), 'permission_callback' => static function () { return current_user_can( 'edit_posts' ); } ) );
		register_rest_route( 'sml-retail-spotlight/v1', '/newsroom/ack', array( 'methods' => 'POST', 'callback' => array( $this, 'newsroom_ack' ), 'permission_callback' => static function () { return current_user_can( 'edit_posts' ); } ) );
		register_rest_route( 'sml-retail-spotlight/v1', '/source/(?P<uuid>[a-f0-9-]{36})', array( 'methods' => 'GET', 'callback' => array( $this, 'source' ), 'permission_callback' => '__return_true' ) );
	}

	public function status( WP_REST_Request $request ) {
		$group_id = absint( $request['group_id'] );
		if ( ! self::can_manage( $group_id ) ) return new WP_Error( 'forbidden', 'Only this group’s owner or admin can view Spotlight settings.', array( 'status' => 403 ) );
		return rest_ensure_response( self::public_status( $group_id ) );
	}

	public function configuration( WP_REST_Request $request ) {
		global $wpdb;
		$group_id = absint( $request['group_id'] );
		if ( ! self::can_manage( $group_id ) ) return new WP_Error( 'forbidden', 'Only this group’s owner or admin can configure Spotlight.', array( 'status' => 403 ) );
		if ( 'GET' === $request->get_method() ) {
			$config = self::config( $group_id );
			$connector = self::connector( $group_id );
			return rest_ensure_response( array_merge( self::public_status( $group_id ), array(
				'config' => $config ? array( 'guild_id' => $config['guild_id'], 'channel_id' => $config['channel_id'], 'channel_ids' => self::config_channel_ids( $config ), 'monitored_users' => json_decode( $config['monitored_users'], true ) ?: array() ) : null,
				'catalog' => $connector && 'active' === $connector['state'] ? self::spotlight_channels( $connector['guild_id'] ) : null,
			) ) );
		}
		$connector = self::connector( $group_id );
		if ( ! $connector || 'active' !== $connector['state'] || ! self::snowflake( $connector['guild_id'] ) || ! self::snowflake( $connector['claimed_by_discord_user_id'] ?? '' ) ) return new WP_Error( 'discord_not_connected', 'A Discord owner or admin must connect and verify this server to the StockMarketLoop group first.', array( 'status' => 409 ) );
		$requested_channels = (array) $request->get_param( 'channel_ids' );
		if ( ! $requested_channels ) $requested_channels = array( $request->get_param( 'channel_id' ) );
		$channel_ids = array();
		foreach ( $requested_channels as $candidate ) {
			$id = self::snowflake( $candidate );
			if ( $id ) $channel_ids[ $id ] = true;
		}
		$channel_ids = array_keys( $channel_ids );
		$catalog = self::spotlight_channels( $connector['guild_id'] );
		$catalog_ids = wp_list_pluck( $catalog['channels'], 'id' );
		if ( ! $catalog_ids ) return new WP_Error( 'channel_catalog_unavailable', 'Sync the connected Discord server’s channel catalog before choosing monitored channels.', array( 'status' => 409 ) );
		if ( array_diff( $channel_ids, $catalog_ids ) ) return new WP_Error( 'invalid_channel', 'Choose only message channels supplied by the connected Discord server.', array( 'status' => 422 ) );
		$users = array();
		foreach ( (array) $request->get_param( 'monitored_users' ) as $row ) {
			$id = self::snowflake( is_array( $row ) ? ( $row['id'] ?? '' ) : '' );
			if ( ! $id ) continue;
			$users[ $id ] = array( 'id' => $id, 'display_name' => sanitize_text_field( is_array( $row ) ? ( $row['display_name'] ?? '' ) : '' ) );
		}
		if ( ! $channel_ids || count( $channel_ids ) > 25 || ! $users || count( $users ) > 25 ) return new WP_Error( 'invalid_configuration', 'Choose 1–25 valid Discord channels and 1–25 monitored traders.', array( 'status' => 422 ) );
		$old = self::config( $group_id );
		$current_price = self::monthly_price( $group_id );
		$data = array(
			'owner_user_id' => get_current_user_id(), 'guild_id' => $connector['guild_id'], 'channel_id' => $channel_ids[0],
			'channel_ids' => wp_json_encode( $channel_ids ), 'monitored_users' => wp_json_encode( array_values( $users ) ), 'monthly_price' => $current_price,
			'updated_at' => self::now(),
		);
		if ( $old ) $wpdb->update( self::table( 'configs' ), $data, array( 'group_id' => $group_id ) );
		else { $data['group_id'] = $group_id; $data['status'] = 'inactive'; $data['created_at'] = self::now(); $wpdb->insert( self::table( 'configs' ), $data ); }
		self::audit( $group_id, 'configuration_saved', array( 'channel_ids' => $channel_ids, 'monitored_user_ids' => array_keys( $users ), 'monthly_price' => $current_price ) );
		return rest_ensure_response( array( 'saved' => true ) );
	}

	public function diagnostic( WP_REST_Request $request ) {
		$group_id = absint( $request['group_id'] );
		if ( ! self::can_manage( $group_id ) ) return new WP_Error( 'forbidden', 'Only this group’s owner or admin can run the Spotlight test.', array( 'status' => 403 ) );
		$config = self::config( $group_id );
		$connector = self::connector( $group_id );
		$ticker = strtoupper( ltrim( sanitize_text_field( (string) $request->get_param( 'ticker' ) ), '$' ) );
		$text = trim( wp_strip_all_tags( (string) $request->get_param( 'alert_text' ) ) );
		$checks = array(
			'pricing_resolved' => self::monthly_price( $group_id ) > 0,
			'discord_connected' => (bool) ( $connector && 'active' === $connector['state'] && self::snowflake( $connector['guild_id'] ) ),
			'configuration_saved' => (bool) ( $config && self::snowflake( $config['channel_id'] ) && json_decode( $config['monitored_users'], true ) ),
			'subscription_active' => (bool) ( $config && 'active' === $config['status'] && $config['paid_through'] && strtotime( $config['paid_through'] . ' UTC' ) > time() ),
			'discord_bridge_ready' => function_exists( 'sml_discord_api_request' ) && function_exists( 'sml_discord_option' ),
			'polling_scheduled' => (bool) wp_next_scheduled( 'sml_rts_poll_discord' ),
			'author_ready' => (bool) get_user_by( 'login', self::AUTHOR_LOGIN ),
			'test_alert_valid' => (bool) ( preg_match( '/^[A-Z][A-Z0-9.-]{0,9}$/', $ticker ) && strlen( $text ) >= 10 && strlen( $text ) <= 4000 ),
		);
		global $wpdb;
		$recent = preg_match( '/^[A-Z][A-Z0-9.-]{0,9}$/', $ticker ) ? $wpdb->get_row( $wpdb->prepare( 'SELECT event_uuid,status,created_at FROM ' . self::table( 'events' ) . ' WHERE ticker=%s AND created_at >= %s ORDER BY id DESC LIMIT 1', $ticker, gmdate( 'Y-m-d H:i:s', time() - 30 * MINUTE_IN_SECONDS ) ), ARRAY_A ) : null;
		$checks['ticker_cooldown_clear'] = ! $recent;
		return rest_ensure_response( array(
			'passed' => ! in_array( false, $checks, true ),
			'dry_run' => true,
			'checks' => $checks,
			'preview' => array( 'ticker' => $ticker ? '$' . $ticker : '', 'alert_text' => $text, 'author' => 'Retail Trader Spotlight', 'monthly_price' => self::monthly_price( $group_id ) ),
			'recent_conflict' => $recent,
			'message' => $recent ? 'The test was not queued because this ticker is inside the 30-minute duplicate cooldown.' : 'Dry-run only: no article, post, alert, or Loop Bucks transaction was created.',
		) );
	}

	public function dm_subscription( WP_REST_Request $request ) {
		global $wpdb;
		$group_id = absint( $request['group_id'] );
		$user_id = get_current_user_id();
		$table = self::table( 'dm_optins' );
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT id,discord_user_id,status,consented_at,revoked_at FROM $table WHERE group_id=%d AND user_id=%d", $group_id, $user_id ), ARRAY_A );
		if ( 'DELETE' === $request->get_method() ) {
			if ( $row ) $wpdb->update( $table, array( 'status' => 'revoked', 'revoked_at' => self::now(), 'updated_at' => self::now() ), array( 'id' => $row['id'] ) );
			self::audit( $group_id, 'discord_dm_revoked', array(), $user_id );
			return rest_ensure_response( array( 'active' => false, 'revoked' => true ) );
		}
		if ( ! self::is_group_member( $group_id, $user_id ) ) return new WP_Error( 'not_group_member', 'Join this StockMarketLoop group before enabling Discord alerts.', array( 'status' => 403 ) );
		$config = self::config( $group_id );
		$tool_active = (bool) ( $config && 'active' === $config['status'] && $config['paid_through'] && strtotime( $config['paid_through'] . ' UTC' ) > time() );
		$discord_user_id = self::linked_discord_user_id( $user_id );
		if ( 'POST' === $request->get_method() ) {
			if ( true !== rest_sanitize_boolean( $request->get_param( 'consent' ) ) ) return new WP_Error( 'consent_required', 'Explicit consent is required before StockMarketLoop can send Discord direct messages.', array( 'status' => 422 ) );
			if ( ! $tool_active ) return new WP_Error( 'spotlight_inactive', 'This group’s Retail Trader Spotlight subscription is not active.', array( 'status' => 409 ) );
			if ( ! $discord_user_id ) return new WP_Error( 'discord_link_required', 'Connect your Discord account to StockMarketLoop before enabling direct-message alerts.', array( 'status' => 409 ) );
			$data = array( 'discord_user_id' => $discord_user_id, 'status' => 'active', 'consented_at' => self::now(), 'revoked_at' => null, 'updated_at' => self::now() );
			if ( $row ) $wpdb->update( $table, $data, array( 'id' => $row['id'] ) );
			else { $data['group_id'] = $group_id; $data['user_id'] = $user_id; $wpdb->insert( $table, $data ); }
			self::audit( $group_id, 'discord_dm_consented', array( 'discord_user_id' => $discord_user_id ), $user_id );
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT id,discord_user_id,status,consented_at,revoked_at FROM $table WHERE group_id=%d AND user_id=%d", $group_id, $user_id ), ARRAY_A );
		}
		return rest_ensure_response( array(
			'active' => (bool) ( $row && 'active' === $row['status'] ),
			'linked' => (bool) $discord_user_id,
			'tool_active' => $tool_active,
			'consented_at' => $row ? $row['consented_at'] : null,
			'disclaimer' => 'Discord delivery and sound or vibration depend on each member’s Discord and device notification settings.',
		) );
	}

	private static function charge( $config, $period ) {
		$reference = 'group:' . (int) $config['group_id'] . ':period:' . $period;
		$price = self::monthly_price( $config['group_id'] );
		if ( class_exists( 'SML_Store' ) && method_exists( 'SML_Store', 'transact' ) ) {
			return SML_Store::transact( (int) $config['owner_user_id'], -$price, 'spend', 'retail_spotlight', $reference, 'Retail Trader Spotlight monthly subscription', 0 );
		}
		return new WP_Error( 'ledger_unavailable', 'The verified Loop Bucks ledger bridge is unavailable.' );
	}

	public function subscribe( WP_REST_Request $request ) {
		global $wpdb;
		$group_id = absint( $request['group_id'] );
		if ( ! self::can_manage( $group_id ) ) return new WP_Error( 'forbidden', 'Only this group’s owner or admin can subscribe.', array( 'status' => 403 ) );
		$config = self::config( $group_id );
		if ( ! $config || ! self::config_channel_ids( $config ) || empty( json_decode( $config['monitored_users'], true ) ) ) return new WP_Error( 'configuration_required', 'Choose Discord channels and monitored traders first.', array( 'status' => 409 ) );
		$connector = self::connector( $group_id );
		if ( ! $connector || 'active' !== $connector['state'] || ! self::snowflake( $connector['claimed_by_discord_user_id'] ?? '' ) ) return new WP_Error( 'discord_not_verified', 'The Discord server must remain verified by an owner or administrator.', array( 'status' => 409 ) );
		$config['owner_user_id'] = get_current_user_id();
		$wpdb->update( self::table( 'configs' ), array( 'owner_user_id' => $config['owner_user_id'] ), array( 'group_id' => $group_id ) );
		$period = gmdate( 'Y-m' );
		$result = self::charge( $config, $period );
		if ( is_wp_error( $result ) && 'duplicate_transaction' !== $result->get_error_code() ) return $result;
		$paid = gmdate( 'Y-m-d H:i:s', strtotime( '+1 month' ) );
		$price = self::monthly_price( $group_id );
		$wpdb->update( self::table( 'configs' ), array( 'status' => 'active', 'monthly_price' => $price, 'paid_through' => $paid, 'last_billed_period' => $period, 'last_error' => '', 'updated_at' => self::now() ), array( 'group_id' => $group_id ) );
		self::audit( $group_id, 'subscription_activated', array( 'price' => $price, 'discount_eligible' => self::member_count( $group_id ) >= self::MIN_MEMBERS, 'period' => $period ) );
		return rest_ensure_response( self::public_status( $group_id ) );
	}

	public function renew_due_subscriptions() {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::table( 'configs' ) . " WHERE status='active' AND paid_through <= %s LIMIT 100", self::now() ), ARRAY_A ) ?: array();
		foreach ( $rows as $config ) {
			$error = self::charge( $config, gmdate( 'Y-m' ) );
			if ( is_wp_error( $error ) && 'duplicate_transaction' !== $error->get_error_code() ) {
				$wpdb->update( self::table( 'configs' ), array( 'status' => 'paused', 'last_error' => sanitize_text_field( $error->get_error_message() ), 'updated_at' => self::now() ), array( 'group_id' => $config['group_id'] ) );
				self::audit( $config['group_id'], 'renewal_paused', array( 'reason' => $error->get_error_code() ), $config['owner_user_id'] );
				continue;
			}
			$wpdb->update( self::table( 'configs' ), array( 'monthly_price' => self::monthly_price( $config['group_id'] ), 'paid_through' => gmdate( 'Y-m-d H:i:s', strtotime( '+1 month' ) ), 'last_billed_period' => gmdate( 'Y-m' ), 'last_error' => '', 'updated_at' => self::now() ), array( 'group_id' => $config['group_id'] ) );
		}
	}

	public function bot_groups() {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT group_id,guild_id,channel_id,channel_ids,monitored_users,paid_through FROM ' . self::table( 'configs' ) . " WHERE status='active' AND paid_through > %s", self::now() ), ARRAY_A ) ?: array();
		$groups = array();
		foreach ( $rows as $row ) {
			$row['monitored_users'] = json_decode( $row['monitored_users'], true ) ?: array();
			foreach ( self::config_channel_ids( $row ) as $channel_id ) {
				$copy = $row;
				$copy['channel_id'] = $channel_id;
				unset( $copy['channel_ids'] );
				$groups[] = $copy;
			}
		}
		return rest_ensure_response( array( 'groups' => $groups ) );
	}

	public function bot_alert( WP_REST_Request $request ) {
		global $wpdb;
		$guild = self::snowflake( $request->get_param( 'guild_id' ) );
		$channel = self::snowflake( $request->get_param( 'channel_id' ) );
		$message = self::snowflake( $request->get_param( 'message_id' ) );
		$user = self::snowflake( $request->get_param( 'user_id' ) );
		$config = null;
		$configs = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::table( 'configs' ) . " WHERE guild_id=%s AND status='active' AND paid_through>%s", $guild, self::now() ), ARRAY_A ) ?: array();
		foreach ( $configs as $candidate ) {
			if ( in_array( $channel, self::config_channel_ids( $candidate ), true ) ) { $config = $candidate; break; }
		}
		if ( ! $config ) return new WP_Error( 'not_monitored', 'This channel does not have an active Spotlight subscription.', array( 'status' => 403 ) );
		$allowed = wp_list_pluck( json_decode( $config['monitored_users'], true ) ?: array(), 'id' );
		if ( ! in_array( $user, $allowed, true ) ) return new WP_Error( 'user_not_monitored', 'This Discord user is not monitored for the group.', array( 'status' => 403 ) );
		$text = trim( wp_strip_all_tags( (string) $request->get_param( 'alert_text' ) ) );
		$ticker = strtoupper( ltrim( sanitize_text_field( (string) $request->get_param( 'ticker' ) ), '$' ) );
		if ( ! $message || ! preg_match( '/^[A-Z][A-Z0-9.-]{0,9}$/', $ticker ) || strlen( $text ) < 10 || strlen( $text ) > 4000 ) return new WP_Error( 'invalid_alert', 'A message ID, ticker, and 10–4,000 character alert are required.', array( 'status' => 422 ) );
		$existing_message = $wpdb->get_var( $wpdb->prepare( 'SELECT event_uuid FROM ' . self::table( 'events' ) . ' WHERE guild_id=%s AND discord_message_id=%s', $guild, $message ) );
		if ( $existing_message ) return rest_ensure_response( array( 'accepted' => true, 'duplicate' => true, 'duplicate_reason' => 'discord_message', 'event_uuid' => $existing_message ) );
		$recent_ticker = $wpdb->get_row( $wpdb->prepare( 'SELECT event_uuid,status FROM ' . self::table( 'events' ) . ' WHERE ticker=%s AND created_at >= %s ORDER BY id DESC LIMIT 1', $ticker, gmdate( 'Y-m-d H:i:s', time() - 30 * MINUTE_IN_SECONDS ) ), ARRAY_A );
		if ( $recent_ticker ) return rest_ensure_response( array( 'accepted' => true, 'duplicate' => true, 'duplicate_reason' => 'ticker_cooldown', 'event_uuid' => $recent_ticker['event_uuid'], 'status' => $recent_ticker['status'] ) );
		$uuid = wp_generate_uuid4();
		$inserted = $wpdb->insert( self::table( 'events' ), array(
			'event_uuid' => $uuid, 'group_id' => $config['group_id'], 'guild_id' => $guild, 'channel_id' => $channel,
			'discord_message_id' => $message, 'discord_user_id' => $user,
			'discord_display_name' => sanitize_text_field( (string) $request->get_param( 'display_name' ) ),
			'ticker' => $ticker, 'alert_text' => $text,
			'alerted_at' => gmdate( 'Y-m-d H:i:s', strtotime( (string) $request->get_param( 'alerted_at' ) ) ?: time() ),
			'payload' => wp_json_encode( $request->get_json_params(), JSON_UNESCAPED_SLASHES ), 'status' => 'accepted', 'created_at' => self::now(),
		), array( '%s','%d','%s','%s','%s','%s','%s','%s','%s','%s','%s','%s','%s' ) );
		if ( ! $inserted ) {
			$existing = $wpdb->get_var( $wpdb->prepare( 'SELECT event_uuid FROM ' . self::table( 'events' ) . ' WHERE guild_id=%s AND discord_message_id=%s', $guild, $message ) );
			return rest_ensure_response( array( 'accepted' => true, 'duplicate' => true, 'event_uuid' => $existing ) );
		}
		self::audit( $config['group_id'], 'alert_accepted', array( 'event_uuid' => $uuid, 'discord_message_id' => $message, 'ticker' => $ticker ), $config['owner_user_id'] );
		$this->queue_discord_dms( $uuid, $config['group_id'] );
		return new WP_REST_Response( array( 'accepted' => true, 'duplicate' => false, 'event_uuid' => $uuid, 'source_url' => rest_url( 'sml-retail-spotlight/v1/source/' . $uuid ) ), 201 );
	}

	private function queue_discord_dms( $event_uuid, $group_id ) {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT id FROM ' . self::table( 'dm_optins' ) . " WHERE group_id=%d AND status='active'", absint( $group_id ) ), ARRAY_A ) ?: array();
		$now = self::now();
		foreach ( $rows as $row ) {
			$wpdb->query( $wpdb->prepare( 'INSERT IGNORE INTO ' . self::table( 'dm_deliveries' ) . ' (event_uuid,optin_id,status,attempts,next_attempt_at,last_error,created_at,updated_at) VALUES (%s,%d,%s,0,%s,%s,%s,%s)', $event_uuid, absint( $row['id'] ), 'pending', $now, '', $now, $now ) );
		}
	}

	public function poll_discord() {
		if ( ! function_exists( 'sml_discord_api_request' ) || ! function_exists( 'sml_discord_option' ) ) return;
		global $wpdb;
		$stored_configs = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . self::table( 'configs' ) . " WHERE status='active' AND paid_through>%s", self::now() ), ARRAY_A ) ?: array();
		$configs = array();
		foreach ( $stored_configs as $stored ) {
			foreach ( self::config_channel_ids( $stored ) as $channel_id ) {
				$copy = $stored;
				$copy['channel_id'] = $channel_id;
				$configs[] = $copy;
			}
		}
		$cursors = get_option( 'sml_rts_discord_cursors', array() );
		$cursors = is_array( $cursors ) ? $cursors : array();
		foreach ( $configs as $config ) {
			$key = $config['guild_id'] . ':' . $config['channel_id'];
			$cursor = self::snowflake( $cursors[ $key ] ?? '' );
			$path = '/channels/' . $config['channel_id'] . '/messages?limit=50' . ( $cursor ? '&after=' . rawurlencode( $cursor ) : '' );
			$messages = sml_discord_api_request( 'GET', $path, null, (string) sml_discord_option( 'bot_token', '' ) );
			if ( is_wp_error( $messages ) || ! is_array( $messages ) ) continue;
			usort( $messages, static function ( $a, $b ) { return strlen( (string) ( $a['id'] ?? '' ) ) === strlen( (string) ( $b['id'] ?? '' ) ) ? strcmp( (string) ( $a['id'] ?? '' ), (string) ( $b['id'] ?? '' ) ) : strlen( (string) ( $a['id'] ?? '' ) ) - strlen( (string) ( $b['id'] ?? '' ) ); } );
			$allowed = wp_list_pluck( json_decode( $config['monitored_users'], true ) ?: array(), 'id' );
			foreach ( $messages as $message ) {
				$message_id = self::snowflake( $message['id'] ?? '' );
				if ( ! $message_id ) continue;
				$author_id = self::snowflake( $message['author']['id'] ?? '' );
				if ( empty( $message['author']['bot'] ) && empty( $message['webhook_id'] ) && in_array( $author_id, $allowed, true ) ) {
					$content = trim( (string) ( $message['content'] ?? '' ) );
					preg_match_all( '/\$([A-Z][A-Z0-9.-]{0,9})\b/i', $content, $ticker_matches );
					$tickers = array_values( array_unique( array_map( 'strtoupper', $ticker_matches[1] ?? array() ) ) );
					if ( 1 === count( $tickers ) ) {
						$internal = new WP_REST_Request( 'POST' );
						foreach ( array( 'guild_id' => $config['guild_id'], 'channel_id' => $config['channel_id'], 'message_id' => $message_id, 'user_id' => $author_id, 'display_name' => ( $message['member']['nick'] ?? $message['author']['global_name'] ?? $message['author']['username'] ?? '' ), 'ticker' => $tickers[0], 'alert_text' => $content, 'alerted_at' => ( $message['timestamp'] ?? gmdate( DATE_ATOM ) ) ) as $param => $value ) $internal->set_param( $param, $value );
						$result = $this->bot_alert( $internal );
						if ( is_wp_error( $result ) && (int) ( $result->get_error_data()['status'] ?? 500 ) >= 500 ) break;
					}
				}
				$cursors[ $key ] = $message_id;
			}
		}
		update_option( 'sml_rts_discord_cursors', $cursors, false );
	}

	public function deliver_discord_dms() {
		if ( ! function_exists( 'sml_discord_api_request' ) || ! function_exists( 'sml_discord_option' ) ) return;
		$token = (string) sml_discord_option( 'bot_token', '' );
		if ( '' === $token ) return;
		global $wpdb;
		$deliveries = self::table( 'dm_deliveries' );
		$optins = self::table( 'dm_optins' );
		$events = self::table( 'events' );
		$configs = self::table( 'configs' );
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT d.id,d.attempts,o.discord_user_id,e.event_uuid,e.ticker,e.alert_text,e.discord_display_name
			FROM $deliveries d
			JOIN $optins o ON o.id=d.optin_id AND o.status='active'
			JOIN $events e ON e.event_uuid=d.event_uuid AND e.group_id=o.group_id
			JOIN $configs c ON c.group_id=o.group_id AND c.status='active' AND c.paid_through>%s
			WHERE d.status='pending' AND d.next_attempt_at<=%s ORDER BY d.id ASC LIMIT 50",
			self::now(), self::now()
		), ARRAY_A ) ?: array();
		foreach ( $rows as $row ) {
			$attempts = (int) $row['attempts'] + 1;
			$dm = sml_discord_api_request( 'POST', '/users/@me/channels', array( 'recipient_id' => $row['discord_user_id'] ), $token );
			$result = is_wp_error( $dm ) || empty( $dm['id'] ) ? $dm : sml_discord_api_request( 'POST', '/channels/' . self::snowflake( $dm['id'] ) . '/messages', array(
				'content' => mb_substr( "🔔 **Stock Market Loop · Retail Trader Spotlight**\n**$" . $row['ticker'] . ' alert from ' . $row['discord_display_name'] . "**\n" . $row['alert_text'] . "\nVerified record: " . rest_url( 'sml-retail-spotlight/v1/source/' . $row['event_uuid'] ) . "\n\nYou opted in on StockMarketLoop. Manage or stop these alerts from the group page.", 0, 1950 ),
				'allowed_mentions' => array( 'parse' => array() ),
			), $token );
			if ( ! is_wp_error( $result ) ) {
				$wpdb->update( $deliveries, array( 'status' => 'sent', 'attempts' => $attempts, 'last_error' => '', 'delivered_at' => self::now(), 'updated_at' => self::now() ), array( 'id' => $row['id'] ) );
				continue;
			}
			$final = $attempts >= 3;
			$wpdb->update( $deliveries, array(
				'status' => $final ? 'failed' : 'pending', 'attempts' => $attempts,
				'next_attempt_at' => gmdate( 'Y-m-d H:i:s', time() + ( 60 * pow( 5, $attempts - 1 ) ) ),
				'last_error' => sanitize_text_field( $result->get_error_message() ), 'updated_at' => self::now(),
			), array( 'id' => $row['id'] ) );
		}
	}

	public function newsroom_pending() {
		global $wpdb;
		$table = self::table( 'events' );
		$cooldown = gmdate( 'Y-m-d H:i:s', time() - 30 * MINUTE_IN_SECONDS );
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT e.event_uuid,e.ticker,e.alerted_at,e.group_id,e.guild_id,e.discord_message_id,e.discord_display_name
			FROM $table e
			WHERE e.status='accepted'
			AND e.id=(SELECT MIN(e2.id) FROM $table e2 WHERE e2.status='accepted' AND e2.ticker=e.ticker)
			AND NOT EXISTS (SELECT 1 FROM $table recent WHERE recent.ticker=e.ticker AND recent.status='handed_off' AND recent.created_at >= %s)
			ORDER BY e.created_at ASC LIMIT 20",
			$cooldown
		), ARRAY_A ) ?: array();
		foreach ( $rows as &$row ) {
			$row['source_url'] = rest_url( 'sml-retail-spotlight/v1/source/' . $row['event_uuid'] );
			$row['source_event_key'] = 'discord:' . $row['guild_id'] . ':' . $row['discord_message_id'];
		}
		return rest_ensure_response( array( 'events' => $rows ) );
	}

	public function newsroom_ack( WP_REST_Request $request ) {
		global $wpdb;
		$uuid = sanitize_text_field( (string) $request->get_param( 'event_uuid' ) );
		$updated = $wpdb->update( self::table( 'events' ), array( 'status' => 'handed_off' ), array( 'event_uuid' => $uuid, 'status' => 'accepted' ), array( '%s' ), array( '%s', '%s' ) );
		return rest_ensure_response( array( 'acknowledged' => false !== $updated ) );
	}

	public function source( WP_REST_Request $request ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table( 'events' ) . ' WHERE event_uuid=%s', sanitize_text_field( $request['uuid'] ) ), ARRAY_A );
		if ( ! $row ) return new WP_Error( 'not_found', 'Spotlight alert not found.', array( 'status' => 404 ) );
		return rest_ensure_response( array(
			'schema' => 'sml.retail_trader_alert.v1', 'title' => '$' . $row['ticker'] . ' retail trader alert from ' . $row['discord_display_name'],
			'description' => 'A verified, timestamped Discord alert selected for Retail Trader Spotlight coverage.',
			'text' => $row['alert_text'], 'ticker' => '$' . $row['ticker'], 'event_uuid' => $row['event_uuid'],
			'group_id' => (int) $row['group_id'], 'trader_display_name' => $row['discord_display_name'], 'alerted_at' => gmdate( 'c', strtotime( $row['alerted_at'] . ' UTC' ) ),
		) );
	}

	public function group_assets() {
		if ( is_admin() ) return;
		$path = wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '', PHP_URL_PATH );
		if ( ! preg_match( '#^/groups/[^/]+/?$#i', (string) $path ) ) return;
		$base = plugin_dir_url( __FILE__ ) . 'assets/';
		wp_enqueue_style( 'rts-spotlight-ui', $base . 'retail-trader-spotlight.css', array(), self::VERSION );
		wp_enqueue_style( 'rts-spotlight-v13', $base . 'retail-trader-spotlight-v13.css', array( 'rts-spotlight-ui' ), self::VERSION );
		wp_enqueue_script( 'rts-spotlight-ui', $base . 'retail-trader-spotlight.js', array(), self::VERSION, true );
		wp_localize_script( 'rts-spotlight-ui', 'SMLRetailSpotlight', array(
			'api' => esc_url_raw( rest_url( 'sml-retail-spotlight/v1/' ) ),
			'nonce' => wp_create_nonce( 'wp_rest' ),
			'avatar' => esc_url_raw( $base . 'retail-trader-spotlight.png' ),
		) );
	}

	public function group_asset_fallback() {
		if ( is_admin() ) return;
		$path = wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '', PHP_URL_PATH );
		if ( ! preg_match( '#^/groups/[^/]+/?$#i', (string) $path ) ) return;
		$base = plugin_dir_url( __FILE__ ) . 'assets/';
		$config = array(
			'api' => esc_url_raw( rest_url( 'sml-retail-spotlight/v1/' ) ),
			'nonce' => wp_create_nonce( 'wp_rest' ),
			'avatar' => esc_url_raw( $base . 'retail-trader-spotlight.png' ),
		);
		echo '<link id="rts-spotlight-direct-css" rel="stylesheet" href="' . esc_url( $base . 'retail-trader-spotlight.css?ver=' . self::VERSION ) . '">';
		echo '<link id="rts-spotlight-direct-v13-css" rel="stylesheet" href="' . esc_url( $base . 'retail-trader-spotlight-v13.css?ver=' . self::VERSION ) . '">';
		echo '<script id="rts-spotlight-direct-config">window.SMLRetailSpotlight=' . wp_json_encode( $config ) . ';</script>';
		echo '<script id="rts-spotlight-direct-js" src="' . esc_url( $base . 'retail-trader-spotlight.js?ver=' . self::VERSION ) . '"></script>';
	}

	public function shortcode( $attributes ) {
		$group_id = absint( $attributes['group_id'] ?? 0 );
		if ( ! $group_id || ! self::can_manage( $group_id ) ) return '';
		$status = self::public_status( $group_id );
		$pricing = $status['discount_eligible']
			? '<del>' . number_format_i18n( $status['base_monthly_price'] ) . ' Loop Bucks/month</del> <strong>' . number_format_i18n( $status['monthly_price'] ) . ' Loop Bucks/month — 50% discount active</strong>'
			: '<strong>' . number_format_i18n( $status['monthly_price'] ) . ' Loop Bucks/month</strong> <span>— automatically 50% off at 1,000 members</span>';
		return '<section class="sml-rts-card" data-group-id="' . esc_attr( $group_id ) . '"><h3>Retail Trader Spotlight</h3><p>Monitor selected Discord alert channels and publish verified coverage under the separate Retail Trader Spotlight author.</p><p><strong>' . esc_html( number_format_i18n( $status['member_count'] ) ) . ' members</strong></p><p>' . wp_kses_post( $pricing ) . '</p><p>Status: ' . esc_html( $status['status'] ) . '</p></section>';
	}
}

SML_Retail_Trader_Spotlight::instance();
