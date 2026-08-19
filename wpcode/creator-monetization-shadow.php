/**
 * SML Creator Monetization — shadow ledger and reconciliation.
 *
 * Shadow mode only: this code never calls wallet, Loop Bucks, Stripe, PayPal,
 * or payout functions. It mirrors verified source events into an immutable,
 * idempotent audit ledger and compares the source split with the intended
 * 80% creator / 20% platform policy.
 */
if ( ! defined( 'SML_CREATOR_SHADOW_DB_VERSION' ) ) {
	define( 'SML_CREATOR_SHADOW_DB_VERSION', '1.0.0' );
}

if ( ! function_exists( 'sml_creator_shadow_table' ) ) {
	function sml_creator_shadow_table() {
		global $wpdb;
		return $wpdb->prefix . 'sml_creator_revenue_shadow';
	}

	function sml_creator_shadow_share_percent() {
		return min( 100, max( 0, (float) apply_filters( 'sml_creator_shadow_share_percent', 80.0 ) ) );
	}

	function sml_creator_shadow_install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = sml_creator_shadow_table();
		$charset = $wpdb->get_charset_collate();
		$sql = "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			creator_id bigint(20) unsigned NOT NULL,
			source_type varchar(32) NOT NULL,
			source_ref varchar(191) NOT NULL,
			content_kind varchar(32) NOT NULL DEFAULT '',
			content_id varchar(100) NOT NULL DEFAULT '',
			gross_cents bigint(20) NOT NULL DEFAULT 0,
			source_creator_cents bigint(20) NOT NULL DEFAULT 0,
			shadow_creator_cents bigint(20) NOT NULL DEFAULT 0,
			shadow_platform_cents bigint(20) NOT NULL DEFAULT 0,
			discrepancy_cents bigint(20) NOT NULL DEFAULT 0,
			status varchar(32) NOT NULL DEFAULT 'shadow_verified',
			exclusion_reason varchar(80) NOT NULL DEFAULT '',
			source_fingerprint char(64) NOT NULL,
			source_created_at datetime NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY source_identity (source_type,source_ref),
			KEY creator_status (creator_id,status),
			KEY content_lookup (content_kind,content_id),
			KEY source_created_at (source_created_at)
		) {$charset};";
		dbDelta( $sql );
		update_option( 'sml_creator_shadow_db_version', SML_CREATOR_SHADOW_DB_VERSION, false );
	}

	function sml_creator_shadow_group_table() {
		global $wpdb;
		if ( function_exists( 'sml_gcm_tables' ) ) {
			$tables = sml_gcm_tables();
			if ( ! empty( $tables['group_ad_events'] ) ) { return (string) $tables['group_ad_events']; }
		}
		return $wpdb->prefix . 'sml_group_ad_events';
	}

	function sml_creator_shadow_sync_group_events( $limit = 5000 ) {
		global $wpdb;
		$table = sml_creator_shadow_table();
		$source = sml_creator_shadow_group_table();
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $source ) ) !== $source ) {
			return array( 'available' => false, 'scanned' => 0, 'inserted' => 0, 'duplicates' => 0, 'conflicts' => 0, 'excluded' => 0 );
		}
		$limit = min( 20000, max( 1, absint( $limit ) ) );
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, group_id, owner_id, user_id, gross_cents, creator_cents, platform_cents, event_type, provider_event_key, created_at
				 FROM {$source} WHERE is_verified = 1 ORDER BY id ASC LIMIT %d",
				$limit
			),
			ARRAY_A
		);
		$stats = array( 'available' => true, 'scanned' => count( (array) $rows ), 'inserted' => 0, 'duplicates' => 0, 'conflicts' => 0, 'excluded' => 0 );
		$share = sml_creator_shadow_share_percent();
		foreach ( (array) $rows as $row ) {
			$event_id  = absint( $row['id'] ?? 0 );
			$creator_id = absint( $row['owner_id'] ?? 0 );
			if ( ! $event_id || ! $creator_id || ! get_userdata( $creator_id ) ) { continue; }
			$gross = (int) ( $row['gross_cents'] ?? 0 );
			$source_creator = (int) ( $row['creator_cents'] ?? 0 );
			$shadow_creator = (int) round( $gross * ( $share / 100 ) );
			$shadow_platform = $gross - $shadow_creator;
			$reason = '';
			if ( absint( $row['user_id'] ?? 0 ) === $creator_id ) { $reason = 'self_activity'; }
			$reason = sanitize_key( (string) apply_filters( 'sml_creator_shadow_exclusion_reason', $reason, $row ) );
			$status = $reason ? 'excluded' : ( $gross < 0 ? 'shadow_reversal' : 'shadow_verified' );
			if ( $reason ) { $shadow_creator = 0; $shadow_platform = 0; $stats['excluded']++; }
			$source_ref = 'group_ad:' . $event_id;
			$source_created_at = sanitize_text_field( (string) ( $row['created_at'] ?? '' ) );
			if ( ! preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $source_created_at ) ) { $source_created_at = null; }
			$fingerprint = hash( 'sha256', wp_json_encode( array( $creator_id, $gross, $source_creator, (int) ( $row['platform_cents'] ?? 0 ), $status, $reason ) ) );
			$existing = $wpdb->get_var( $wpdb->prepare( "SELECT source_fingerprint FROM {$table} WHERE source_type = %s AND source_ref = %s LIMIT 1", 'group_ad', $source_ref ) );
			if ( null !== $existing ) {
				if ( hash_equals( (string) $existing, $fingerprint ) ) { $stats['duplicates']++; }
				else { $stats['conflicts']++; }
				continue;
			}
			$inserted = $wpdb->insert(
				$table,
				array(
					'creator_id' => $creator_id, 'source_type' => 'group_ad', 'source_ref' => $source_ref,
					'content_kind' => 'group', 'content_id' => (string) absint( $row['group_id'] ?? 0 ),
					'gross_cents' => $gross, 'source_creator_cents' => $source_creator,
					'shadow_creator_cents' => $shadow_creator, 'shadow_platform_cents' => $shadow_platform,
					'discrepancy_cents' => $shadow_creator - $source_creator, 'status' => $status,
					'exclusion_reason' => $reason, 'source_fingerprint' => $fingerprint,
					'source_created_at' => $source_created_at, 'created_at' => gmdate( 'Y-m-d H:i:s' ),
				),
				array( '%d', '%s', '%s', '%s', '%s', '%d', '%d', '%d', '%d', '%d', '%s', '%s', '%s', '%s', '%s' )
			);
			if ( false !== $inserted ) { $stats['inserted']++; }
		}
		$stats['syncedAt'] = gmdate( 'c' );
		update_option( 'sml_creator_shadow_last_sync', $stats, false );
		return $stats;
	}

	function sml_creator_shadow_maybe_sync() {
		if ( get_transient( 'sml_creator_shadow_sync_lock' ) ) { return; }
		set_transient( 'sml_creator_shadow_sync_lock', 1, 5 * MINUTE_IN_SECONDS );
		sml_creator_shadow_sync_group_events();
	}

	function sml_creator_shadow_summary( $creator_id ) {
		global $wpdb;
		$table = sml_creator_shadow_table();
		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT COUNT(*) entries,
				 COALESCE(SUM(CASE WHEN status IN ('shadow_verified','shadow_reversal') THEN gross_cents ELSE 0 END),0) gross_cents,
				 COALESCE(SUM(CASE WHEN status IN ('shadow_verified','shadow_reversal') THEN source_creator_cents ELSE 0 END),0) source_creator_cents,
				 COALESCE(SUM(CASE WHEN status IN ('shadow_verified','shadow_reversal') THEN shadow_creator_cents ELSE 0 END),0) shadow_creator_cents,
				 COALESCE(SUM(CASE WHEN status IN ('shadow_verified','shadow_reversal') THEN shadow_platform_cents ELSE 0 END),0) shadow_platform_cents,
				 COALESCE(SUM(CASE WHEN status IN ('shadow_verified','shadow_reversal') THEN discrepancy_cents ELSE 0 END),0) discrepancy_cents,
				 COALESCE(SUM(CASE WHEN status = 'shadow_reversal' THEN shadow_creator_cents ELSE 0 END),0) reversal_cents,
				 SUM(CASE WHEN status = 'excluded' THEN 1 ELSE 0 END) excluded,
				 SUM(CASE WHEN status = 'shadow_reversal' THEN 1 ELSE 0 END) reversals
				 FROM {$table} WHERE creator_id = %d",
				absint( $creator_id )
			),
			ARRAY_A
		);
		$row = is_array( $row ) ? array_map( 'intval', $row ) : array();
		$last = get_option( 'sml_creator_shadow_last_sync', array() );
		return array(
			'mode' => 'shadow', 'payoutsEnabled' => false, 'walletWritesEnabled' => false,
			'creatorSharePercent' => sml_creator_shadow_share_percent(), 'platformSharePercent' => 100 - sml_creator_shadow_share_percent(),
			'coverage' => array( 'groupAds' => true, 'videoAds' => false, 'internalAds' => false ),
			'entries' => (int) ( $row['entries'] ?? 0 ), 'excluded' => (int) ( $row['excluded'] ?? 0 ), 'reversals' => (int) ( $row['reversals'] ?? 0 ),
			'grossUsd' => round( (int) ( $row['gross_cents'] ?? 0 ) / 100, 2 ),
			'sourceCreatorUsd' => round( (int) ( $row['source_creator_cents'] ?? 0 ) / 100, 2 ),
			'shadowCreatorUsd' => round( (int) ( $row['shadow_creator_cents'] ?? 0 ) / 100, 2 ),
			'shadowPlatformUsd' => round( (int) ( $row['shadow_platform_cents'] ?? 0 ) / 100, 2 ),
			'discrepancyUsd' => round( (int) ( $row['discrepancy_cents'] ?? 0 ) / 100, 2 ),
			'lifecycle' => array(
				'estimatedUsd' => round( (int) ( $row['shadow_creator_cents'] ?? 0 ) / 100, 2 ),
				'pendingUsd' => 0, 'approvedUsd' => 0, 'reversedUsd' => round( abs( (int) ( $row['reversal_cents'] ?? 0 ) ) / 100, 2 ), 'paidUsd' => 0,
			),
			'reconciled' => 0 === (int) ( $row['discrepancy_cents'] ?? 0 ),
			'safeguards' => array( 'verifiedSourceOnly' => true, 'uniqueSourceKey' => true, 'selfActivityExcluded' => true, 'walletWritesDisabled' => true ),
			'lastSync' => is_array( $last ) ? $last : array(),
			'note' => 'Shadow calculations are audit-only and cannot change a wallet or issue a payout.',
		);
	}

	add_action( 'init', static function () {
		if ( SML_CREATOR_SHADOW_DB_VERSION !== get_option( 'sml_creator_shadow_db_version' ) ) { sml_creator_shadow_install(); }
		if ( ! wp_next_scheduled( 'sml_creator_shadow_hourly_sync' ) ) { wp_schedule_event( time() + 300, 'hourly', 'sml_creator_shadow_hourly_sync' ); }
	}, 20 );
	add_action( 'sml_creator_shadow_hourly_sync', 'sml_creator_shadow_sync_group_events' );

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-creator-analytics/v1', '/monetization-shadow', array(
			'methods' => WP_REST_Server::READABLE,
			'permission_callback' => 'is_user_logged_in',
			'callback' => static function () { sml_creator_shadow_maybe_sync(); return rest_ensure_response( sml_creator_shadow_summary( get_current_user_id() ) ); },
		) );
		register_rest_route( 'sml-creator-analytics/v1', '/monetization-shadow/report', array(
			'methods' => WP_REST_Server::READABLE,
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
			'callback' => static function () {
				global $wpdb; sml_creator_shadow_maybe_sync(); $table = sml_creator_shadow_table();
				$rows = $wpdb->get_results( "SELECT creator_id, COUNT(*) entries, SUM(shadow_creator_cents) shadow_creator_cents, SUM(source_creator_cents) source_creator_cents, SUM(discrepancy_cents) discrepancy_cents FROM {$table} WHERE status IN ('shadow_verified','shadow_reversal') GROUP BY creator_id ORDER BY ABS(SUM(discrepancy_cents)) DESC LIMIT 500", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				return rest_ensure_response( array( 'mode' => 'shadow', 'payoutsEnabled' => false, 'creators' => $rows, 'lastSync' => get_option( 'sml_creator_shadow_last_sync', array() ) ) );
			},
		) );
	} );
}
