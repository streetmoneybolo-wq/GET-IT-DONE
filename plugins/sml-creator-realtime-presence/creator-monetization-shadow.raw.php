/**
 * SML Creator Monetization — shadow ledger and reconciliation.
 *
 * Shadow mode only: this code never calls wallet, Loop Bucks, Stripe, PayPal,
 * or payout functions. It mirrors verified source events into an immutable,
 * idempotent audit ledger and compares the source split with the intended
 * 80% creator / 20% platform policy.
 */
if ( ! defined( 'SML_CREATOR_SHADOW_DB_VERSION' ) ) {
	define( 'SML_CREATOR_SHADOW_DB_VERSION', '1.2.0' );
}

if ( ! function_exists( 'sml_creator_shadow_table' ) ) {
	function sml_creator_shadow_table() {
		global $wpdb;
		return $wpdb->prefix . 'sml_creator_revenue_shadow';
	}

	function sml_creator_shadow_review_table() {
		global $wpdb;
		return $wpdb->prefix . 'sml_creator_revenue_reviews';
	}

	function sml_creator_shadow_review_item_table() {
		global $wpdb;
		return $wpdb->prefix . 'sml_creator_revenue_review_items';
	}

	function sml_creator_shadow_review_action_table() {
		global $wpdb;
		return $wpdb->prefix . 'sml_creator_revenue_review_actions';
	}

	function sml_creator_shadow_share_percent() {
		return min( 100, max( 0, (float) apply_filters( 'sml_creator_shadow_share_percent', 80.0 ) ) );
	}

	function sml_creator_verified_revenue_table() {
		global $wpdb;
		return $wpdb->prefix . 'sml_creator_verified_revenue_events';
	}

	function sml_creator_shadow_table_exists( $table ) {
		global $wpdb;
		return $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) === $table;
	}

	function sml_creator_shadow_source_readiness() {
		global $wpdb;
		$group = sml_creator_shadow_group_table();
		$video = $wpdb->prefix . 'sml_video_daily_metrics';
		$internal = $wpdb->prefix . 'sml_revenue_records';
		$verified = sml_creator_verified_revenue_table();
		$group_exists = sml_creator_shadow_table_exists( $group );
		$video_exists = sml_creator_shadow_table_exists( $video );
		$internal_exists = sml_creator_shadow_table_exists( $internal );
		$verified_exists = sml_creator_shadow_table_exists( $verified );
		$verified_group = $group_exists ? (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$group} WHERE is_verified=1" ) : 0; // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$video_rows = $video_exists ? (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$video} WHERE revenue<>0" ) : 0; // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$video_total = $video_exists ? (float) $wpdb->get_var( "SELECT COALESCE(SUM(revenue),0) FROM {$video}" ) : 0; // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$internal_rows = $internal_exists ? (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$internal}" ) : 0; // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$internal_total = $internal_exists ? (int) $wpdb->get_var( "SELECT COALESCE(SUM(revenue_cents),0) FROM {$internal}" ) : 0; // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$verified_video = $verified_exists ? (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$verified} WHERE source_type='video_ad' AND traffic_status='valid'" ) : 0; // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$verified_internal = $verified_exists ? (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$verified} WHERE source_type='internal_ad' AND traffic_status='valid'" ) : 0; // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return array(
			'checkedAt' => gmdate( 'c' ),
			'groupAds' => array( 'supported' => $group_exists, 'status' => $group_exists ? 'connected' : 'missing', 'verifiedEvents' => $verified_group, 'reason' => $group_exists ? 'Verified event-level contract is active.' : 'Verified group event table is missing.' ),
			'videoAds' => array( 'supported' => $verified_exists, 'status' => $verified_video > 0 ? 'connected' : ( $video_rows > 0 ? 'aggregate_quarantined' : 'ready_no_verified_events' ), 'verifiedEvents' => $verified_video, 'unverifiedRevenueRows' => $video_rows, 'unverifiedRevenueUsd' => round( $video_total, 2 ), 'reason' => 'Only canonical events with provider identity, ownership, valid traffic, and verification evidence enter the ledger.' ),
			'internalAds' => array( 'supported' => $verified_exists, 'status' => $verified_internal > 0 ? 'connected' : ( $internal_rows > 0 ? 'legacy_quarantined' : 'ready_no_verified_events' ), 'verifiedEvents' => $verified_internal, 'unverifiedRecords' => $internal_rows, 'unverifiedRevenueUsd' => round( $internal_total / 100, 2 ), 'reason' => 'Legacy aggregates remain excluded; only canonical provider-verified events enter the ledger.' ),
			'quarantineActive' => $video_rows > 0 || $internal_rows > 0,
		);
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
		$reviews = sml_creator_shadow_review_table();
		dbDelta( "CREATE TABLE {$reviews} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			creator_id bigint(20) unsigned NOT NULL,
			cutoff_at datetime NOT NULL,
			entry_count bigint(20) unsigned NOT NULL DEFAULT 0,
			shadow_creator_cents bigint(20) NOT NULL DEFAULT 0,
			discrepancy_cents bigint(20) NOT NULL DEFAULT 0,
			ledger_hash char(64) NOT NULL,
			status varchar(32) NOT NULL DEFAULT 'review_pending',
			prepared_by bigint(20) unsigned NOT NULL,
			decided_by bigint(20) unsigned NOT NULL DEFAULT 0,
			decision_note varchar(500) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			decided_at datetime NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY ledger_hash (ledger_hash),
			KEY creator_status (creator_id,status)
		) {$charset};" );
		$items = sml_creator_shadow_review_item_table();
		dbDelta( "CREATE TABLE {$items} (
			review_id bigint(20) unsigned NOT NULL,
			ledger_id bigint(20) unsigned NOT NULL,
			PRIMARY KEY  (review_id,ledger_id),
			UNIQUE KEY ledger_id (ledger_id)
		) {$charset};" );
		$actions = sml_creator_shadow_review_action_table();
		dbDelta( "CREATE TABLE {$actions} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			review_id bigint(20) unsigned NOT NULL,
			action varchar(32) NOT NULL,
			actor_id bigint(20) unsigned NOT NULL,
			note varchar(500) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY review_action (review_id,action)
		) {$charset};" );
		$verified = sml_creator_verified_revenue_table();
		dbDelta( "CREATE TABLE {$verified} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			provider varchar(64) NOT NULL,
			provider_event_id varchar(191) NOT NULL,
			verification_id varchar(191) NOT NULL,
			source_type varchar(32) NOT NULL,
			creator_id bigint(20) unsigned NOT NULL,
			content_id varchar(100) NOT NULL,
			actor_user_id bigint(20) unsigned NOT NULL DEFAULT 0,
			provider_no_self_attested tinyint(1) unsigned NOT NULL DEFAULT 0,
			gross_cents bigint(20) NOT NULL,
			currency char(3) NOT NULL DEFAULT 'USD',
			status varchar(24) NOT NULL,
			traffic_status varchar(24) NOT NULL,
			occurred_at datetime NOT NULL,
			verified_at datetime NOT NULL,
			payload_hash char(64) NOT NULL,
			imported_by bigint(20) unsigned NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY provider_event (provider,provider_event_id),
			KEY creator_source (creator_id,source_type),
			KEY occurred_at (occurred_at)
		) {$charset};" );
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

	function sml_creator_verified_revenue_validate_event( $raw ) {
		global $wpdb;
		$raw = is_array( $raw ) ? $raw : array();
		$provider = sanitize_key( (string) ( $raw['provider'] ?? '' ) );
		$provider_event_id = sanitize_text_field( (string) ( $raw['providerEventId'] ?? '' ) );
		$verification_id = sanitize_text_field( (string) ( $raw['verificationId'] ?? '' ) );
		$source_type = sanitize_key( (string) ( $raw['sourceType'] ?? '' ) );
		$creator_id = absint( $raw['creatorId'] ?? 0 );
		$content_id = sanitize_text_field( (string) ( $raw['contentId'] ?? '' ) );
		$actor_user_id = absint( $raw['actorUserId'] ?? 0 );
		$no_self_attested = ! empty( $raw['providerAttestedNoSelfActivity'] );
		$currency = strtoupper( sanitize_text_field( (string) ( $raw['currency'] ?? '' ) ) );
		$status = sanitize_key( (string) ( $raw['status'] ?? '' ) );
		$traffic_status = sanitize_key( (string) ( $raw['trafficStatus'] ?? '' ) );
		$gross_value = $raw['grossCents'] ?? null;
		$gross_cents = filter_var( $gross_value, FILTER_VALIDATE_INT );
		$occurred_raw = sanitize_text_field( (string) ( $raw['occurredAt'] ?? '' ) );
		$occurred_ts = strtotime( $occurred_raw );
		if ( ! $provider || strlen( $provider ) > 64 || ! $provider_event_id || strlen( $provider_event_id ) > 191 || ! $verification_id || strlen( $verification_id ) > 191 ) { return new WP_Error( 'invalid_provider_identity', 'Provider, providerEventId, and verificationId are required.', array( 'status' => 400 ) ); }
		if ( ! in_array( $source_type, array( 'video_ad', 'internal_ad' ), true ) ) { return new WP_Error( 'invalid_source_type', 'sourceType must be video_ad or internal_ad.', array( 'status' => 400 ) ); }
		if ( ! $creator_id || ! get_userdata( $creator_id ) || '' === $content_id ) { return new WP_Error( 'invalid_ownership_identity', 'A valid creatorId and contentId are required.', array( 'status' => 400 ) ); }
		if ( 'USD' !== $currency ) { return new WP_Error( 'unsupported_currency', 'Only USD revenue is accepted in this phase.', array( 'status' => 400 ) ); }
		if ( ! in_array( $status, array( 'verified', 'reversed' ), true ) || 'valid' !== $traffic_status ) { return new WP_Error( 'unverified_event', 'The event must have verified/reversed status and valid traffic.', array( 'status' => 400 ) ); }
		if ( false === $gross_cents || 0 === (int) $gross_cents || ( 'verified' === $status && $gross_cents < 0 ) || ( 'reversed' === $status && $gross_cents > 0 ) ) { return new WP_Error( 'invalid_amount', 'grossCents must be a non-zero signed integer matching the event status.', array( 'status' => 400 ) ); }
		if ( false === $occurred_ts || $occurred_ts > time() + 300 ) { return new WP_Error( 'invalid_occurred_at', 'occurredAt must be a valid timestamp that is not in the future.', array( 'status' => 400 ) ); }
		if ( $actor_user_id === $creator_id || ( ! $actor_user_id && ! $no_self_attested ) ) { return new WP_Error( 'self_activity_unverified', 'Provide a different actorUserId or providerAttestedNoSelfActivity=true.', array( 'status' => 400 ) ); }
		$owner_id = 0;
		if ( ctype_digit( $content_id ) ) { $post = get_post( (int) $content_id ); $owner_id = $post ? (int) $post->post_author : 0; }
		if ( ! $owner_id && 'video_ad' === $source_type ) {
			$index = $wpdb->prefix . 'sml_video_index';
			if ( sml_creator_shadow_table_exists( $index ) ) { $owner_id = (int) $wpdb->get_var( $wpdb->prepare( "SELECT author_id FROM {$index} WHERE video_id=%s LIMIT 1", $content_id ) ); }
			if ( ! $owner_id && sml_creator_shadow_table_exists( 'videos' ) ) { $owner_id = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT creator_id FROM videos WHERE id=%s LIMIT 1', $content_id ) ); }
		}
		if ( $owner_id !== $creator_id ) { return new WP_Error( 'content_ownership_failed', 'The content does not belong to the supplied creator.', array( 'status' => 409 ) ); }
		$event = array( 'provider' => $provider, 'provider_event_id' => $provider_event_id, 'verification_id' => $verification_id, 'source_type' => $source_type, 'creator_id' => $creator_id, 'content_id' => $content_id, 'actor_user_id' => $actor_user_id, 'provider_no_self_attested' => $no_self_attested ? 1 : 0, 'gross_cents' => (int) $gross_cents, 'currency' => 'USD', 'status' => $status, 'traffic_status' => 'valid', 'occurred_at' => gmdate( 'Y-m-d H:i:s', $occurred_ts ) );
		$event['payload_hash'] = hash( 'sha256', wp_json_encode( $event ) );
		return $event;
	}

	function sml_creator_verified_revenue_import( $events, $commit = false, $confirmation = '' ) {
		global $wpdb;
		$events = is_array( $events ) ? array_values( $events ) : array();
		if ( empty( $events ) || count( $events ) > 250 ) { return new WP_Error( 'invalid_event_batch', 'Provide between 1 and 250 events.', array( 'status' => 400 ) ); }
		if ( $commit && 'IMPORT VERIFIED REVENUE' !== (string) $confirmation ) { return new WP_Error( 'import_confirmation_required', 'Explicit verified-revenue import confirmation is required.', array( 'status' => 400 ) ); }
		$table = sml_creator_verified_revenue_table(); $normalized = array(); $duplicates = 0; $batch_seen = array();
		foreach ( $events as $index => $raw ) {
			$event = sml_creator_verified_revenue_validate_event( $raw );
			if ( is_wp_error( $event ) ) { return new WP_Error( $event->get_error_code(), 'Event ' . ( $index + 1 ) . ': ' . $event->get_error_message(), $event->get_error_data() ); }
			$batch_key = $event['provider'] . ':' . $event['provider_event_id'];
			if ( isset( $batch_seen[ $batch_key ] ) ) { if ( ! hash_equals( $batch_seen[ $batch_key ], $event['payload_hash'] ) ) { return new WP_Error( 'batch_event_conflict', 'Event ' . ( $index + 1 ) . ' conflicts with another event in this batch.', array( 'status' => 409 ) ); } $duplicates++; continue; }
			$batch_seen[ $batch_key ] = $event['payload_hash'];
			$existing = $wpdb->get_var( $wpdb->prepare( "SELECT payload_hash FROM {$table} WHERE provider=%s AND provider_event_id=%s LIMIT 1", $event['provider'], $event['provider_event_id'] ) );
			if ( null !== $existing ) { if ( ! hash_equals( (string) $existing, $event['payload_hash'] ) ) { return new WP_Error( 'provider_event_conflict', 'Event ' . ( $index + 1 ) . ' conflicts with an existing provider event.', array( 'status' => 409 ) ); } $duplicates++; continue; }
			$normalized[] = $event;
		}
		if ( ! $commit ) { return array( 'mode' => 'dry_run', 'valid' => count( $normalized ), 'duplicates' => $duplicates, 'errors' => 0, 'payoutsEnabled' => false ); }
		$wpdb->query( 'START TRANSACTION' ); $inserted = 0; $now = gmdate( 'Y-m-d H:i:s' );
		foreach ( $normalized as $event ) {
			$event['verified_at'] = $now; $event['imported_by'] = get_current_user_id(); $event['created_at'] = $now;
			$ok = $wpdb->insert( $table, $event, array( '%s','%s','%s','%s','%d','%s','%d','%d','%d','%s','%s','%s','%s','%s','%s','%d','%s' ) );
			if ( false === $ok ) { $wpdb->query( 'ROLLBACK' ); return new WP_Error( 'verified_import_failed', 'No events were imported because the batch could not be saved atomically.', array( 'status' => 409 ) ); }
			$inserted++;
		}
		$wpdb->query( 'COMMIT' );
		$sync = sml_creator_shadow_sync_verified_events();
		return array( 'mode' => 'committed', 'inserted' => $inserted, 'duplicates' => $duplicates, 'shadowSync' => $sync, 'payoutsEnabled' => false, 'walletWritesEnabled' => false );
	}

	function sml_creator_shadow_sync_verified_events( $limit = 5000 ) {
		global $wpdb;
		$source = sml_creator_verified_revenue_table(); $ledger = sml_creator_shadow_table();
		if ( ! sml_creator_shadow_table_exists( $source ) ) { return array( 'available' => false, 'scanned' => 0, 'inserted' => 0, 'duplicates' => 0, 'conflicts' => 0 ); }
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$source} WHERE traffic_status='valid' AND status IN ('verified','reversed') ORDER BY id ASC LIMIT %d", min( 20000, max( 1, absint( $limit ) ) ) ), ARRAY_A );
		$stats = array( 'available' => true, 'scanned' => count( $rows ), 'inserted' => 0, 'duplicates' => 0, 'conflicts' => 0 ); $share = sml_creator_shadow_share_percent();
		foreach ( $rows as $row ) {
			$gross = (int) $row['gross_cents']; $creator = (int) round( $gross * ( $share / 100 ) ); $platform = $gross - $creator; $source_ref = $row['provider'] . ':' . $row['provider_event_id'];
			$fingerprint = hash( 'sha256', wp_json_encode( array( $row['payload_hash'], $creator, $platform ) ) );
			$existing = $wpdb->get_var( $wpdb->prepare( "SELECT source_fingerprint FROM {$ledger} WHERE source_type=%s AND source_ref=%s LIMIT 1", $row['source_type'], $source_ref ) );
			if ( null !== $existing ) { if ( hash_equals( (string) $existing, $fingerprint ) ) { $stats['duplicates']++; } else { $stats['conflicts']++; } continue; }
			$ok = $wpdb->insert( $ledger, array( 'creator_id' => (int) $row['creator_id'], 'source_type' => $row['source_type'], 'source_ref' => $source_ref, 'content_kind' => 'video_ad' === $row['source_type'] ? 'video' : 'content', 'content_id' => $row['content_id'], 'gross_cents' => $gross, 'source_creator_cents' => $creator, 'shadow_creator_cents' => $creator, 'shadow_platform_cents' => $platform, 'discrepancy_cents' => 0, 'status' => 'reversed' === $row['status'] ? 'shadow_reversal' : 'shadow_verified', 'exclusion_reason' => '', 'source_fingerprint' => $fingerprint, 'source_created_at' => $row['occurred_at'], 'created_at' => gmdate( 'Y-m-d H:i:s' ) ), array( '%d','%s','%s','%s','%s','%d','%d','%d','%d','%d','%s','%s','%s','%s','%s' ) );
			if ( false !== $ok ) { $stats['inserted']++; }
		}
		return $stats;
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
		update_option( 'sml_creator_shadow_source_readiness', sml_creator_shadow_source_readiness(), false );
		return $stats;
	}

	function sml_creator_shadow_maybe_sync() {
		if ( get_transient( 'sml_creator_shadow_sync_lock' ) ) { return; }
		set_transient( 'sml_creator_shadow_sync_lock', 1, 5 * MINUTE_IN_SECONDS );
		sml_creator_shadow_sync_group_events();
		sml_creator_shadow_sync_verified_events();
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
		$reviews = sml_creator_shadow_review_table();
		$review = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT
				 COALESCE(SUM(CASE WHEN status = 'review_pending' THEN shadow_creator_cents ELSE 0 END),0) pending_cents,
				 COALESCE(SUM(CASE WHEN status = 'shadow_approved' THEN shadow_creator_cents ELSE 0 END),0) approved_cents,
				 SUM(CASE WHEN status = 'review_pending' THEN 1 ELSE 0 END) pending_reviews,
				 SUM(CASE WHEN status = 'shadow_approved' THEN 1 ELSE 0 END) approved_reviews
				 FROM {$reviews} WHERE creator_id = %d",
				absint( $creator_id )
			), ARRAY_A
		);
		$review = is_array( $review ) ? array_map( 'intval', $review ) : array();
		$last = get_option( 'sml_creator_shadow_last_sync', array() );
		$source_readiness = sml_creator_shadow_source_readiness();
		return array(
			'mode' => 'shadow', 'payoutsEnabled' => false, 'walletWritesEnabled' => false,
			'creatorSharePercent' => sml_creator_shadow_share_percent(), 'platformSharePercent' => 100 - sml_creator_shadow_share_percent(),
			'coverage' => array( 'groupAds' => true, 'videoAds' => ! empty( $source_readiness['videoAds']['supported'] ), 'internalAds' => ! empty( $source_readiness['internalAds']['supported'] ) ),
			'sourceReadiness' => $source_readiness,
			'entries' => (int) ( $row['entries'] ?? 0 ), 'excluded' => (int) ( $row['excluded'] ?? 0 ), 'reversals' => (int) ( $row['reversals'] ?? 0 ),
			'grossUsd' => round( (int) ( $row['gross_cents'] ?? 0 ) / 100, 2 ),
			'sourceCreatorUsd' => round( (int) ( $row['source_creator_cents'] ?? 0 ) / 100, 2 ),
			'shadowCreatorUsd' => round( (int) ( $row['shadow_creator_cents'] ?? 0 ) / 100, 2 ),
			'shadowPlatformUsd' => round( (int) ( $row['shadow_platform_cents'] ?? 0 ) / 100, 2 ),
			'discrepancyUsd' => round( (int) ( $row['discrepancy_cents'] ?? 0 ) / 100, 2 ),
			'lifecycle' => array(
				'estimatedUsd' => round( (int) ( $row['shadow_creator_cents'] ?? 0 ) / 100, 2 ),
				'pendingUsd' => round( (int) ( $review['pending_cents'] ?? 0 ) / 100, 2 ),
				'approvedUsd' => round( (int) ( $review['approved_cents'] ?? 0 ) / 100, 2 ),
				'reversedUsd' => round( abs( (int) ( $row['reversal_cents'] ?? 0 ) ) / 100, 2 ), 'paidUsd' => 0,
				'pendingReviews' => (int) ( $review['pending_reviews'] ?? 0 ), 'approvedReviews' => (int) ( $review['approved_reviews'] ?? 0 ),
			),
			'reconciled' => 0 === (int) ( $row['discrepancy_cents'] ?? 0 ),
			'safeguards' => array( 'verifiedSourceOnly' => true, 'uniqueSourceKey' => true, 'selfActivityExcluded' => true, 'walletWritesDisabled' => true ),
			'lastSync' => is_array( $last ) ? $last : array(),
			'note' => 'Shadow calculations are audit-only and cannot change a wallet or issue a payout.',
		);
	}

	function sml_creator_shadow_prepare_review( $creator_id, $cutoff_at = '' ) {
		global $wpdb;
		$creator_id = absint( $creator_id );
		if ( ! $creator_id || ! get_userdata( $creator_id ) ) { return new WP_Error( 'invalid_creator', 'A valid creator is required.', array( 'status' => 400 ) ); }
		$cutoff_at = sanitize_text_field( (string) $cutoff_at );
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $cutoff_at ) ) { $cutoff_at = gmdate( 'Y-m-d H:i:s' ); }
		$ledger = sml_creator_shadow_table(); $items = sml_creator_shadow_review_item_table();
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT l.id, l.source_fingerprint, l.shadow_creator_cents, l.discrepancy_cents
			 FROM {$ledger} l LEFT JOIN {$items} i ON i.ledger_id = l.id
			 WHERE l.creator_id = %d AND l.status IN ('shadow_verified','shadow_reversal')
			 AND l.source_created_at <= %s AND i.ledger_id IS NULL ORDER BY l.id ASC",
			$creator_id, $cutoff_at
		), ARRAY_A );
		if ( empty( $rows ) ) { return new WP_Error( 'nothing_to_review', 'No unreviewed verified entries are available.', array( 'status' => 409 ) ); }
		$hash_parts = array(); $creator_cents = 0; $discrepancy_cents = 0;
		foreach ( $rows as $row ) { $hash_parts[] = (int) $row['id'] . ':' . (string) $row['source_fingerprint']; $creator_cents += (int) $row['shadow_creator_cents']; $discrepancy_cents += (int) $row['discrepancy_cents']; }
		$ledger_hash = hash( 'sha256', implode( '|', $hash_parts ) );
		$reviews = sml_creator_shadow_review_table(); $actions = sml_creator_shadow_review_action_table(); $now = gmdate( 'Y-m-d H:i:s' );
		$wpdb->query( 'START TRANSACTION' );
		$ok = $wpdb->insert( $reviews, array( 'creator_id' => $creator_id, 'cutoff_at' => $cutoff_at, 'entry_count' => count( $rows ), 'shadow_creator_cents' => $creator_cents, 'discrepancy_cents' => $discrepancy_cents, 'ledger_hash' => $ledger_hash, 'status' => 'review_pending', 'prepared_by' => get_current_user_id(), 'created_at' => $now ), array( '%d','%s','%d','%d','%d','%s','%s','%d','%s' ) );
		$review_id = $ok ? (int) $wpdb->insert_id : 0;
		if ( $review_id ) { foreach ( $rows as $row ) { if ( false === $wpdb->insert( $items, array( 'review_id' => $review_id, 'ledger_id' => (int) $row['id'] ), array( '%d','%d' ) ) ) { $ok = false; break; } } }
		if ( $ok && false === $wpdb->insert( $actions, array( 'review_id' => $review_id, 'action' => 'prepared', 'actor_id' => get_current_user_id(), 'created_at' => $now ), array( '%d','%s','%d','%s' ) ) ) { $ok = false; }
		$wpdb->query( $ok ? 'COMMIT' : 'ROLLBACK' );
		if ( ! $ok ) { return new WP_Error( 'review_prepare_failed', 'The review snapshot could not be created safely.', array( 'status' => 409 ) ); }
		return array( 'reviewId' => $review_id, 'status' => 'review_pending', 'entries' => count( $rows ), 'shadowCreatorUsd' => round( $creator_cents / 100, 2 ), 'discrepancyUsd' => round( $discrepancy_cents / 100, 2 ), 'ledgerHash' => $ledger_hash, 'payoutsEnabled' => false );
	}

	function sml_creator_shadow_decide_review( $review_id, $decision, $note = '', $confirmation = '' ) {
		global $wpdb;
		$review_id = absint( $review_id ); $decision = sanitize_key( $decision ); $note = sanitize_text_field( (string) $note );
		if ( ! in_array( $decision, array( 'approve', 'reject' ), true ) ) { return new WP_Error( 'invalid_decision', 'Decision must be approve or reject.', array( 'status' => 400 ) ); }
		if ( 'approve' === $decision && 'APPROVE SHADOW REVIEW' !== (string) $confirmation ) { return new WP_Error( 'approval_confirmation_required', 'Explicit shadow approval confirmation is required.', array( 'status' => 400 ) ); }
		$reviews = sml_creator_shadow_review_table(); $actions = sml_creator_shadow_review_action_table(); $items = sml_creator_shadow_review_item_table(); $ledger = sml_creator_shadow_table();
		$review = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$reviews} WHERE id = %d", $review_id ), ARRAY_A );
		if ( ! $review || 'review_pending' !== $review['status'] ) { return new WP_Error( 'review_not_pending', 'Only a pending review can be decided.', array( 'status' => 409 ) ); }
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT l.id,l.source_fingerprint,l.shadow_creator_cents,l.discrepancy_cents FROM {$ledger} l INNER JOIN {$items} i ON i.ledger_id=l.id WHERE i.review_id=%d ORDER BY l.id ASC", $review_id ), ARRAY_A );
		$parts = array(); $creator_cents = 0; $discrepancy_cents = 0;
		foreach ( $rows as $row ) { $parts[] = (int) $row['id'] . ':' . (string) $row['source_fingerprint']; $creator_cents += (int) $row['shadow_creator_cents']; $discrepancy_cents += (int) $row['discrepancy_cents']; }
		$valid = count( $rows ) === (int) $review['entry_count'] && hash_equals( (string) $review['ledger_hash'], hash( 'sha256', implode( '|', $parts ) ) ) && $creator_cents === (int) $review['shadow_creator_cents'] && $discrepancy_cents === (int) $review['discrepancy_cents'];
		if ( ! $valid ) { return new WP_Error( 'review_integrity_failed', 'The ledger changed or the review snapshot failed integrity checks.', array( 'status' => 409 ) ); }
		$status = 'approve' === $decision ? 'shadow_approved' : 'shadow_rejected'; $now = gmdate( 'Y-m-d H:i:s' );
		$wpdb->query( 'START TRANSACTION' );
		$ok = 1 === $wpdb->update( $reviews, array( 'status' => $status, 'decided_by' => get_current_user_id(), 'decision_note' => mb_substr( $note, 0, 500 ), 'decided_at' => $now ), array( 'id' => $review_id, 'status' => 'review_pending' ), array( '%s','%d','%s','%s' ), array( '%d','%s' ) );
		if ( $ok && false === $wpdb->insert( $actions, array( 'review_id' => $review_id, 'action' => $decision, 'actor_id' => get_current_user_id(), 'note' => mb_substr( $note, 0, 500 ), 'created_at' => $now ), array( '%d','%s','%d','%s','%s' ) ) ) { $ok = false; }
		$wpdb->query( $ok ? 'COMMIT' : 'ROLLBACK' );
		if ( ! $ok ) { return new WP_Error( 'review_decision_failed', 'The decision was not saved.', array( 'status' => 409 ) ); }
		return array( 'reviewId' => $review_id, 'status' => $status, 'shadowCreatorUsd' => round( $creator_cents / 100, 2 ), 'payoutsEnabled' => false, 'walletWritesEnabled' => false );
	}

	function sml_creator_shadow_admin_url( $notice = '', $detail = '' ) {
		$url = admin_url( 'tools.php?page=sml-creator-revenue-review' );
		if ( $notice ) { $url = add_query_arg( array( 'sml_shadow_notice' => sanitize_key( $notice ), 'sml_shadow_detail' => mb_substr( (string) $detail, 0, 180 ) ), $url ); }
		return $url;
	}

	function sml_creator_shadow_admin_page() {
		if ( ! current_user_can( 'manage_options' ) ) { wp_die( esc_html__( 'You are not allowed to view this page.' ) ); }
		global $wpdb;
		sml_creator_shadow_maybe_sync();
		$ledger = sml_creator_shadow_table(); $reviews = sml_creator_shadow_review_table(); $items = sml_creator_shadow_review_item_table();
		$readiness = sml_creator_shadow_source_readiness();
		$creators = $wpdb->get_results( "SELECT l.creator_id, COUNT(*) ledger_entries,
			SUM(CASE WHEN i.ledger_id IS NULL AND l.status IN ('shadow_verified','shadow_reversal') THEN 1 ELSE 0 END) unreviewed_entries,
			COALESCE(SUM(CASE WHEN i.ledger_id IS NULL AND l.status IN ('shadow_verified','shadow_reversal') THEN l.shadow_creator_cents ELSE 0 END),0) unreviewed_cents,
			COALESCE(SUM(CASE WHEN i.ledger_id IS NULL AND l.status IN ('shadow_verified','shadow_reversal') THEN l.discrepancy_cents ELSE 0 END),0) unreviewed_discrepancy_cents
			FROM {$ledger} l LEFT JOIN {$items} i ON i.ledger_id=l.id GROUP BY l.creator_id ORDER BY unreviewed_cents DESC LIMIT 500", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$review_rows = $wpdb->get_results( "SELECT * FROM {$reviews} ORDER BY id DESC LIMIT 200", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$notice = sanitize_key( wp_unslash( $_GET['sml_shadow_notice'] ?? '' ) ); $detail = sanitize_text_field( wp_unslash( $_GET['sml_shadow_detail'] ?? '' ) );
		?>
		<div class="wrap sml-shadow-admin"><h1>Creator Revenue Review</h1>
			<style>.sml-shadow-admin .sml-lock{padding:14px 16px;border-left:4px solid #d63638;background:#fff;margin:14px 0}.sml-shadow-admin .sml-ok{border-left-color:#00a32a}.sml-shadow-admin table{margin-top:16px}.sml-shadow-admin td,.sml-shadow-admin th{vertical-align:middle}.sml-shadow-admin .money{font-variant-numeric:tabular-nums;text-align:right}.sml-shadow-admin .danger{color:#b32d2e;font-weight:700}.sml-shadow-admin .actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.sml-shadow-admin input[type=text]{max-width:260px}</style>
			<div class="sml-lock"><strong>Shadow mode:</strong> approvals on this screen are audit decisions only. They cannot send money, credit Loop Bucks, or modify a wallet.</div>
			<?php if ( $notice ) : ?><div class="notice <?php echo 'error' === $notice ? 'notice-error' : 'notice-success'; ?> is-dismissible"><p><?php echo esc_html( $detail ?: $notice ); ?></p></div><?php endif; ?>
			<h2>Revenue source readiness</h2>
			<table class="widefat striped"><thead><tr><th>Source</th><th>Status</th><th>Observed data</th><th>Safety decision</th></tr></thead><tbody>
			<tr><td><strong>Group ads</strong></td><td><?php echo esc_html( $readiness['groupAds']['status'] ); ?></td><td><?php echo (int) $readiness['groupAds']['verifiedEvents']; ?> verified events</td><td><?php echo esc_html( $readiness['groupAds']['reason'] ); ?></td></tr>
			<tr><td><strong>Video/live ads</strong></td><td class="<?php echo false !== strpos( $readiness['videoAds']['status'], 'quarantined' ) ? 'danger' : ''; ?>"><?php echo esc_html( $readiness['videoAds']['status'] ); ?></td><td><?php echo (int) $readiness['videoAds']['unverifiedRevenueRows']; ?> unverified revenue rows · $<?php echo esc_html( number_format( (float) $readiness['videoAds']['unverifiedRevenueUsd'], 2 ) ); ?></td><td><?php echo esc_html( $readiness['videoAds']['reason'] ); ?></td></tr>
			<tr><td><strong>Internal ads</strong></td><td class="<?php echo false !== strpos( $readiness['internalAds']['status'], 'quarantined' ) ? 'danger' : ''; ?>"><?php echo esc_html( $readiness['internalAds']['status'] ); ?></td><td><?php echo (int) $readiness['internalAds']['unverifiedRecords']; ?> unverified records · $<?php echo esc_html( number_format( (float) $readiness['internalAds']['unverifiedRevenueUsd'], 2 ) ); ?></td><td><?php echo esc_html( $readiness['internalAds']['reason'] ); ?></td></tr>
			</tbody></table>
			<h2>Verified provider import</h2>
			<p>Paste a JSON array of provider settlement events. Always run a dry validation first. No import can issue payment.</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><?php wp_nonce_field( 'sml_verified_revenue_import' ); ?><input type="hidden" name="action" value="sml_creator_verified_revenue_import"><textarea name="payload_json" rows="10" class="large-text code" placeholder='[{"provider":"provider-name","providerEventId":"evt-123","verificationId":"settlement-456","sourceType":"video_ad","creatorId":123,"contentId":"video-id","grossCents":1000,"currency":"USD","status":"verified","trafficStatus":"valid","occurredAt":"2026-08-19T12:00:00Z","providerAttestedNoSelfActivity":true}]'></textarea><p><label><input type="checkbox" name="confirmed" value="1"> I confirm this payload comes from verified provider settlement data.</label></p><p><button class="button" name="import_mode" value="dry_run">Dry validation</button> <button class="button button-primary" name="import_mode" value="commit">Import verified events</button></p></form>
			<h2>Unreviewed verified revenue</h2>
			<table class="widefat striped"><thead><tr><th>Creator</th><th>Ledger entries</th><th>Unreviewed</th><th class="money">80% shadow value</th><th class="money">Difference</th><th>Action</th></tr></thead><tbody>
			<?php if ( empty( $creators ) ) : ?><tr><td colspan="6">No verified revenue events are available yet.</td></tr><?php endif; ?>
			<?php foreach ( $creators as $creator ) : $user = get_userdata( (int) $creator['creator_id'] ); ?>
			<tr><td><strong><?php echo esc_html( $user ? $user->display_name : 'User #' . (int) $creator['creator_id'] ); ?></strong><br><small>ID <?php echo (int) $creator['creator_id']; ?></small></td><td><?php echo (int) $creator['ledger_entries']; ?></td><td><?php echo (int) $creator['unreviewed_entries']; ?></td><td class="money">$<?php echo esc_html( number_format( (int) $creator['unreviewed_cents'] / 100, 2 ) ); ?></td><td class="money <?php echo 0 !== (int) $creator['unreviewed_discrepancy_cents'] ? 'danger' : ''; ?>">$<?php echo esc_html( number_format( (int) $creator['unreviewed_discrepancy_cents'] / 100, 2 ) ); ?></td><td>
			<?php if ( (int) $creator['unreviewed_entries'] > 0 ) : ?><form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><?php wp_nonce_field( 'sml_shadow_prepare_' . (int) $creator['creator_id'] ); ?><input type="hidden" name="action" value="sml_creator_shadow_prepare"><input type="hidden" name="creator_id" value="<?php echo (int) $creator['creator_id']; ?>"><button class="button">Prepare locked review</button></form><?php else : ?>—<?php endif; ?></td></tr>
			<?php endforeach; ?></tbody></table>
			<h2>Review history</h2>
			<table class="widefat striped"><thead><tr><th>ID</th><th>Creator</th><th>Status</th><th>Entries</th><th class="money">Shadow value</th><th class="money">Difference</th><th>Integrity</th><th>Decision</th></tr></thead><tbody>
			<?php if ( empty( $review_rows ) ) : ?><tr><td colspan="8">No review snapshots have been prepared.</td></tr><?php endif; ?>
			<?php foreach ( $review_rows as $review ) : $user = get_userdata( (int) $review['creator_id'] ); ?>
			<tr><td>#<?php echo (int) $review['id']; ?></td><td><?php echo esc_html( $user ? $user->display_name : 'User #' . (int) $review['creator_id'] ); ?></td><td><strong><?php echo esc_html( $review['status'] ); ?></strong></td><td><?php echo (int) $review['entry_count']; ?></td><td class="money">$<?php echo esc_html( number_format( (int) $review['shadow_creator_cents'] / 100, 2 ) ); ?></td><td class="money <?php echo 0 !== (int) $review['discrepancy_cents'] ? 'danger' : ''; ?>">$<?php echo esc_html( number_format( (int) $review['discrepancy_cents'] / 100, 2 ) ); ?></td><td><code><?php echo esc_html( substr( $review['ledger_hash'], 0, 12 ) ); ?>…</code></td><td>
			<?php if ( 'review_pending' === $review['status'] ) : ?><form class="actions" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><?php wp_nonce_field( 'sml_shadow_decide_' . (int) $review['id'] ); ?><input type="hidden" name="action" value="sml_creator_shadow_decide"><input type="hidden" name="review_id" value="<?php echo (int) $review['id']; ?>"><input type="text" name="note" placeholder="Decision note" maxlength="500"><label><input type="checkbox" name="confirmed" value="1"> Confirm shadow only</label><button class="button button-primary" name="decision" value="approve">Approve</button><button class="button" name="decision" value="reject">Reject</button></form><?php else : echo esc_html( $review['decision_note'] ?: 'Complete' ); endif; ?></td></tr>
			<?php endforeach; ?></tbody></table>
		</div>
		<?php
	}

	add_action( 'init', static function () {
		if ( SML_CREATOR_SHADOW_DB_VERSION !== get_option( 'sml_creator_shadow_db_version' ) ) { sml_creator_shadow_install(); }
		if ( ! wp_next_scheduled( 'sml_creator_shadow_hourly_sync' ) ) { wp_schedule_event( time() + 300, 'hourly', 'sml_creator_shadow_hourly_sync' ); }
	}, 20 );
	add_action( 'sml_creator_shadow_hourly_sync', static function () { sml_creator_shadow_sync_group_events(); sml_creator_shadow_sync_verified_events(); } );
	add_action( 'admin_menu', static function () { add_management_page( 'Creator Revenue Review', 'Creator Revenue Review', 'manage_options', 'sml-creator-revenue-review', 'sml_creator_shadow_admin_page' ); } );
	add_action( 'admin_post_sml_creator_shadow_prepare', static function () {
		if ( ! current_user_can( 'manage_options' ) ) { wp_die( 'Forbidden', 'Forbidden', array( 'response' => 403 ) ); }
		$creator_id = absint( $_POST['creator_id'] ?? 0 ); check_admin_referer( 'sml_shadow_prepare_' . $creator_id );
		$result = sml_creator_shadow_prepare_review( $creator_id ); $error = is_wp_error( $result );
		wp_safe_redirect( sml_creator_shadow_admin_url( $error ? 'error' : 'success', $error ? $result->get_error_message() : 'Locked review snapshot prepared.' ) ); exit;
	} );
	add_action( 'admin_post_sml_creator_shadow_decide', static function () {
		if ( ! current_user_can( 'manage_options' ) ) { wp_die( 'Forbidden', 'Forbidden', array( 'response' => 403 ) ); }
		$review_id = absint( $_POST['review_id'] ?? 0 ); check_admin_referer( 'sml_shadow_decide_' . $review_id );
		$decision = sanitize_key( wp_unslash( $_POST['decision'] ?? '' ) ); $confirmed = ! empty( $_POST['confirmed'] );
		if ( 'approve' === $decision && ! $confirmed ) { wp_safe_redirect( sml_creator_shadow_admin_url( 'error', 'Approval requires the shadow-only confirmation checkbox.' ) ); exit; }
		$result = sml_creator_shadow_decide_review( $review_id, $decision, wp_unslash( $_POST['note'] ?? '' ), $confirmed ? 'APPROVE SHADOW REVIEW' : '' ); $error = is_wp_error( $result );
		wp_safe_redirect( sml_creator_shadow_admin_url( $error ? 'error' : 'success', $error ? $result->get_error_message() : 'Review decision saved. No payout was issued.' ) ); exit;
	} );
	add_action( 'admin_post_sml_creator_verified_revenue_import', static function () {
		if ( ! current_user_can( 'manage_options' ) ) { wp_die( 'Forbidden', 'Forbidden', array( 'response' => 403 ) ); }
		check_admin_referer( 'sml_verified_revenue_import' );
		$payload = json_decode( wp_unslash( $_POST['payload_json'] ?? '' ), true ); $commit = 'commit' === sanitize_key( wp_unslash( $_POST['import_mode'] ?? '' ) ); $confirmed = ! empty( $_POST['confirmed'] );
		if ( $commit && ! $confirmed ) { wp_safe_redirect( sml_creator_shadow_admin_url( 'error', 'Verified import requires the confirmation checkbox.' ) ); exit; }
		$result = sml_creator_verified_revenue_import( $payload, $commit, $confirmed ? 'IMPORT VERIFIED REVENUE' : '' ); $error = is_wp_error( $result );
		$detail = $error ? $result->get_error_message() : ( $commit ? sprintf( 'Imported %d verified events; %d duplicates. No payout was issued.', (int) $result['inserted'], (int) $result['duplicates'] ) : sprintf( 'Dry validation passed: %d new events, %d duplicates.', (int) $result['valid'], (int) $result['duplicates'] ) );
		wp_safe_redirect( sml_creator_shadow_admin_url( $error ? 'error' : 'success', $detail ) ); exit;
	} );

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
				return rest_ensure_response( array( 'mode' => 'shadow', 'payoutsEnabled' => false, 'creators' => $rows, 'sourceReadiness' => sml_creator_shadow_source_readiness(), 'lastSync' => get_option( 'sml_creator_shadow_last_sync', array() ) ) );
			},
		) );
		register_rest_route( 'sml-creator-analytics/v1', '/monetization-shadow/reviews', array(
			array( 'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => static function () { return current_user_can( 'manage_options' ); }, 'callback' => static function ( WP_REST_Request $request ) { return sml_creator_shadow_prepare_review( $request->get_param( 'creatorId' ), $request->get_param( 'cutoffAt' ) ); } ),
		) );
		register_rest_route( 'sml-creator-analytics/v1', '/monetization-shadow/reviews/(?P<id>\d+)', array(
			array( 'methods' => WP_REST_Server::EDITABLE, 'permission_callback' => static function () { return current_user_can( 'manage_options' ); }, 'callback' => static function ( WP_REST_Request $request ) { return sml_creator_shadow_decide_review( $request['id'], $request->get_param( 'decision' ), $request->get_param( 'note' ), $request->get_param( 'confirmation' ) ); } ),
		) );
		register_rest_route( 'sml-creator-analytics/v1', '/verified-revenue/import', array(
			array( 'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => static function () { return current_user_can( 'manage_options' ); }, 'callback' => static function ( WP_REST_Request $request ) { return sml_creator_verified_revenue_import( $request->get_param( 'events' ), (bool) $request->get_param( 'commit' ), $request->get_param( 'confirmation' ) ); } ),
		) );
	} );
}
