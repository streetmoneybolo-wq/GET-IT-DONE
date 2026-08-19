/**
 * SML Creator Analytics — Google AdSense page attribution (shadow only).
 *
 * Accepts the official AdSense Management API ReportResult shape using
 * DATE + PAGE_URL + ESTIMATED_EARNINGS. Rows are mapped only when the page is
 * a verified StockMarketLoop watch URL whose owner can be resolved from the
 * canonical video index. Everything else is retained in quarantine.
 *
 * This module never writes to Loop Wallet, payout tables, or the verified
 * revenue ledger. AdSense estimated earnings can change after invalid-traffic
 * adjustments, so they remain reporting-only until a separate finalized
 * settlement process is built and approved.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }
if ( defined( 'SML_CREATOR_ADSENSE_ATTRIBUTION_LOADED' ) ) { return; }
define( 'SML_CREATOR_ADSENSE_ATTRIBUTION_LOADED', true );
define( 'SML_CREATOR_ADSENSE_ATTRIBUTION_DB_VERSION', '1.0.0' );

if ( ! function_exists( 'sml_creator_adsense_table' ) ) {
	function sml_creator_adsense_table() {
		global $wpdb;
		return $wpdb->prefix . 'sml_creator_adsense_attribution';
	}

	function sml_creator_adsense_install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table = sml_creator_adsense_table();
		$charset = $wpdb->get_charset_collate();
		dbDelta( "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			account_id varchar(100) NOT NULL,
			report_date date NOT NULL,
			page_url text NOT NULL,
			page_url_hash char(64) NOT NULL,
			creator_id bigint(20) unsigned NOT NULL DEFAULT 0,
			content_kind varchar(32) NOT NULL DEFAULT '',
			content_id varchar(100) NOT NULL DEFAULT '',
			gross_micros bigint(20) NOT NULL DEFAULT 0,
			currency char(3) NOT NULL DEFAULT 'USD',
			impressions bigint(20) unsigned NOT NULL DEFAULT 0,
			page_views bigint(20) unsigned NOT NULL DEFAULT 0,
			clicks bigint(20) unsigned NOT NULL DEFAULT 0,
			mapping_status varchar(32) NOT NULL DEFAULT 'quarantined',
			mapping_reason varchar(100) NOT NULL DEFAULT '',
			payload_hash char(64) NOT NULL,
			imported_by bigint(20) unsigned NOT NULL,
			imported_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY report_revision (account_id,report_date,page_url_hash,payload_hash),
			KEY creator_date (creator_id,report_date),
			KEY mapping_date (mapping_status,report_date),
			KEY content_lookup (content_kind,content_id)
		) {$charset};" );
		update_option( 'sml_creator_adsense_attribution_db_version', SML_CREATOR_ADSENSE_ATTRIBUTION_DB_VERSION, false );
	}

	function sml_creator_adsense_maybe_install() {
		if ( SML_CREATOR_ADSENSE_ATTRIBUTION_DB_VERSION !== get_option( 'sml_creator_adsense_attribution_db_version' ) ) {
			sml_creator_adsense_install();
		}
	}

	function sml_creator_adsense_normalize_url( $raw_url ) {
		$url = esc_url_raw( (string) $raw_url, array( 'http', 'https' ) );
		if ( '' === $url ) { return new WP_Error( 'invalid_page_url', 'The report contains an invalid PAGE_URL.' ); }
		$parts = wp_parse_url( $url );
		$host = strtolower( (string) ( $parts['host'] ?? '' ) );
		if ( 'www.stockmarketloop.com' === $host ) { $host = 'stockmarketloop.com'; }
		if ( 'stockmarketloop.com' !== $host ) { return new WP_Error( 'foreign_domain', 'The PAGE_URL does not belong to stockmarketloop.com.' ); }
		$path = '/' . ltrim( (string) ( $parts['path'] ?? '/' ), '/' );
		$path = preg_replace( '#/+#', '/', $path );
		if ( '/' !== $path ) { $path = rtrim( $path, '/' ) . '/'; }
		return 'https://stockmarketloop.com' . $path;
	}

	function sml_creator_adsense_resolve_watch_owner( $page_url ) {
		global $wpdb;
		$url = sml_creator_adsense_normalize_url( $page_url );
		if ( is_wp_error( $url ) ) {
			return array( 'creator_id' => 0, 'content_kind' => '', 'content_id' => '', 'status' => 'quarantined', 'reason' => $url->get_error_code() );
		}
		$path = (string) wp_parse_url( $url, PHP_URL_PATH );
		if ( ! preg_match( '#^/watch/([A-Za-z0-9_-]+)/?$#', $path, $match ) ) {
			return array( 'creator_id' => 0, 'content_kind' => '', 'content_id' => '', 'status' => 'quarantined', 'reason' => 'unsupported_page_type' );
		}
		$video_id = sanitize_text_field( $match[1] );
		$creator_id = 0;
		$index = $wpdb->prefix . 'sml_video_index';
		if ( function_exists( 'sml_creator_shadow_table_exists' ) ? sml_creator_shadow_table_exists( $index ) : ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $index ) ) === $index ) ) {
			$creator_id = (int) $wpdb->get_var( $wpdb->prepare( "SELECT author_id FROM {$index} WHERE video_id=%s LIMIT 1", $video_id ) );
		}
		if ( ! $creator_id && ctype_digit( $video_id ) ) {
			$post = get_post( (int) $video_id );
			$creator_id = $post ? (int) $post->post_author : 0;
		}
		if ( ! $creator_id || ! get_userdata( $creator_id ) ) {
			return array( 'creator_id' => 0, 'content_kind' => 'video', 'content_id' => $video_id, 'status' => 'quarantined', 'reason' => 'unresolved_video_owner' );
		}
		return array( 'creator_id' => $creator_id, 'content_kind' => 'video', 'content_id' => $video_id, 'status' => 'mapped_estimate', 'reason' => 'canonical_watch_owner' );
	}

	function sml_creator_adsense_header_map( $report ) {
		$headers = is_array( $report['headers'] ?? null ) ? $report['headers'] : array();
		$map = array();
		foreach ( $headers as $index => $header ) {
			$name = sanitize_key( (string) ( $header['name'] ?? '' ) );
			if ( '' !== $name ) { $map[ $name ] = (int) $index; }
		}
		foreach ( array( 'date', 'page_url', 'estimated_earnings' ) as $required ) {
			if ( ! array_key_exists( $required, $map ) ) {
				return new WP_Error( 'missing_report_column', 'AdSense report must include DATE, PAGE_URL, and ESTIMATED_EARNINGS.', array( 'status' => 400 ) );
			}
		}
		return $map;
	}

	function sml_creator_adsense_cell_value( $cells, $index ) {
		if ( ! isset( $cells[ $index ] ) || ! is_array( $cells[ $index ] ) ) { return ''; }
		return (string) ( $cells[ $index ]['value'] ?? '' );
	}

	function sml_creator_adsense_decimal_to_micros( $value ) {
		$value = trim( (string) $value );
		if ( ! preg_match( '/^-?\d+(?:\.\d+)?$/', $value ) ) { return null; }
		$negative = '-' === substr( $value, 0, 1 );
		$value = ltrim( $value, '+-' );
		$parts = explode( '.', $value, 2 );
		$whole = (int) $parts[0];
		$fraction = str_pad( substr( (string) ( $parts[1] ?? '' ), 0, 6 ), 6, '0' );
		$micros = ( $whole * 1000000 ) + (int) $fraction;
		return $negative ? -$micros : $micros;
	}

	function sml_creator_adsense_parse_report( $report, $account_id ) {
		$report = is_array( $report ) ? $report : array();
		$account_id = sanitize_text_field( (string) $account_id );
		if ( ! preg_match( '/^accounts\/[A-Za-z0-9_-]+$/', $account_id ) ) {
			return new WP_Error( 'invalid_adsense_account', 'Use the AdSense API account resource name (accounts/…).', array( 'status' => 400 ) );
		}
		$map = sml_creator_adsense_header_map( $report );
		if ( is_wp_error( $map ) ) { return $map; }
		$earnings_header = $report['headers'][ $map['estimated_earnings'] ] ?? array();
		$currency = strtoupper( sanitize_text_field( (string) ( $earnings_header['currencyCode'] ?? ( $report['total']['cells'][ $map['estimated_earnings'] ]['currencyCode'] ?? 'USD' ) ) ) );
		if ( 'USD' !== $currency ) { return new WP_Error( 'unsupported_currency', 'Only USD AdSense reports are accepted in this phase.', array( 'status' => 400 ) ); }
		$rows = is_array( $report['rows'] ?? null ) ? $report['rows'] : array();
		if ( count( $rows ) > 100000 ) { return new WP_Error( 'report_too_large', 'The report exceeds the 100,000-row safety limit.', array( 'status' => 413 ) ); }
		$normalized = array();
		foreach ( $rows as $position => $row ) {
			$cells = is_array( $row['cells'] ?? null ) ? $row['cells'] : array();
			$date = sanitize_text_field( sml_creator_adsense_cell_value( $cells, $map['date'] ) );
			$date_obj = DateTimeImmutable::createFromFormat( '!Y-m-d', $date, new DateTimeZone( 'UTC' ) );
			if ( ! $date_obj || $date_obj->format( 'Y-m-d' ) !== $date || $date_obj->getTimestamp() > strtotime( 'today UTC' ) ) {
				return new WP_Error( 'invalid_report_date', 'Row ' . ( $position + 1 ) . ' contains an invalid DATE.', array( 'status' => 400 ) );
			}
			$raw_url = sml_creator_adsense_cell_value( $cells, $map['page_url'] );
			$url = sml_creator_adsense_normalize_url( $raw_url );
			$stored_url = is_wp_error( $url ) ? esc_url_raw( $raw_url, array( 'http', 'https' ) ) : $url;
			if ( '' === $stored_url ) { $stored_url = 'invalid://' . substr( hash( 'sha256', $raw_url ), 0, 24 ); }
			$micros = sml_creator_adsense_decimal_to_micros( sml_creator_adsense_cell_value( $cells, $map['estimated_earnings'] ) );
			if ( null === $micros ) { return new WP_Error( 'invalid_estimated_earnings', 'Row ' . ( $position + 1 ) . ' contains invalid ESTIMATED_EARNINGS.', array( 'status' => 400 ) ); }
			$owner = sml_creator_adsense_resolve_watch_owner( $raw_url );
			$get_count = static function ( $metric ) use ( $cells, $map ) {
				if ( ! isset( $map[ $metric ] ) ) { return 0; }
				$value = filter_var( sml_creator_adsense_cell_value( $cells, $map[ $metric ] ), FILTER_VALIDATE_INT );
				return false === $value ? 0 : max( 0, (int) $value );
			};
			$record = array(
				'account_id' => $account_id,
				'report_date' => $date,
				'page_url' => $stored_url,
				'page_url_hash' => hash( 'sha256', strtolower( $stored_url ) ),
				'creator_id' => (int) $owner['creator_id'],
				'content_kind' => $owner['content_kind'],
				'content_id' => $owner['content_id'],
				'gross_micros' => (int) $micros,
				'currency' => 'USD',
				'impressions' => $get_count( 'impressions' ),
				'page_views' => $get_count( 'page_views' ),
				'clicks' => $get_count( 'clicks' ),
				'mapping_status' => $owner['status'],
				'mapping_reason' => $owner['reason'],
			);
			$record['payload_hash'] = hash( 'sha256', wp_json_encode( $record ) );
			$normalized[] = $record;
		}
		return $normalized;
	}

	function sml_creator_adsense_import_report( $report, $account_id, $commit = false, $confirmation = '' ) {
		global $wpdb;
		sml_creator_adsense_maybe_install();
		$rows = sml_creator_adsense_parse_report( $report, $account_id );
		if ( is_wp_error( $rows ) ) { return $rows; }
		if ( $commit && 'IMPORT ADSENSE SHADOW REPORT' !== (string) $confirmation ) {
			return new WP_Error( 'adsense_import_confirmation_required', 'Explicit shadow-report confirmation is required.', array( 'status' => 400 ) );
		}
		$summary = array( 'mode' => $commit ? 'committed_shadow' : 'dry_run', 'rows' => count( $rows ), 'mapped' => 0, 'quarantined' => 0, 'duplicates' => 0, 'grossEstimatedUsd' => 0.0, 'mappedEstimatedUsd' => 0.0, 'payoutsEnabled' => false, 'walletWritesEnabled' => false );
		foreach ( $rows as $row ) {
			$summary[ 'mapped_estimate' === $row['mapping_status'] ? 'mapped' : 'quarantined' ]++;
			$summary['grossEstimatedUsd'] += $row['gross_micros'] / 1000000;
			if ( 'mapped_estimate' === $row['mapping_status'] ) { $summary['mappedEstimatedUsd'] += $row['gross_micros'] / 1000000; }
		}
		$summary['grossEstimatedUsd'] = round( $summary['grossEstimatedUsd'], 6 );
		$summary['mappedEstimatedUsd'] = round( $summary['mappedEstimatedUsd'], 6 );
		if ( ! $commit ) { return $summary; }
		$table = sml_creator_adsense_table();
		$wpdb->query( 'START TRANSACTION' );
		$inserted = 0;
		foreach ( $rows as $row ) {
			$exists = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$table} WHERE account_id=%s AND report_date=%s AND page_url_hash=%s AND payload_hash=%s LIMIT 1", $row['account_id'], $row['report_date'], $row['page_url_hash'], $row['payload_hash'] ) );
			if ( $exists ) { $summary['duplicates']++; continue; }
			$row['imported_by'] = get_current_user_id();
			$row['imported_at'] = gmdate( 'Y-m-d H:i:s' );
			$ok = $wpdb->insert( $table, $row, array( '%s','%s','%s','%s','%d','%s','%s','%d','%s','%d','%d','%d','%s','%s','%s','%d','%s' ) );
			if ( false === $ok ) { $wpdb->query( 'ROLLBACK' ); return new WP_Error( 'adsense_shadow_import_failed', 'No rows were imported because the report could not be stored atomically.', array( 'status' => 409 ) ); }
			$inserted++;
		}
		$wpdb->query( 'COMMIT' );
		$summary['inserted'] = $inserted;
		update_option( 'sml_creator_adsense_last_import', array( 'at' => gmdate( 'c' ), 'account' => sanitize_text_field( $account_id ), 'inserted' => $inserted, 'mapped' => $summary['mapped'], 'quarantined' => $summary['quarantined'] ), false );
		return $summary;
	}

	function sml_creator_adsense_summary( $creator_id = 0 ) {
		global $wpdb;
		sml_creator_adsense_maybe_install();
		$table = sml_creator_adsense_table();
		$where = $creator_id ? $wpdb->prepare( 'WHERE row_current.creator_id=%d', absint( $creator_id ) ) : '';
		$row = $wpdb->get_row( "SELECT COUNT(*) rows_count, SUM(row_current.mapping_status='mapped_estimate') mapped_count, SUM(row_current.mapping_status='quarantined') quarantined_count, COALESCE(SUM(row_current.gross_micros),0) gross_micros, COALESCE(SUM(CASE WHEN row_current.mapping_status='mapped_estimate' THEN row_current.gross_micros ELSE 0 END),0) mapped_micros, MAX(row_current.imported_at) last_imported_at
			FROM {$table} row_current
			INNER JOIN (SELECT MAX(id) id FROM {$table} GROUP BY account_id,report_date,page_url_hash) latest ON latest.id=row_current.id
			{$where}", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$gross = (int) ( $row['gross_micros'] ?? 0 );
		$mapped = (int) ( $row['mapped_micros'] ?? 0 );
		$share = function_exists( 'sml_creator_shadow_share_percent' ) ? sml_creator_shadow_share_percent() : 80.0;
		$last_imported_at = (string) ( $row['last_imported_at'] ?? '' );
		return array(
			'mode' => 'shadow_estimate', 'provider' => 'google_adsense', 'connected' => '' !== $last_imported_at,
			'connectionStatus' => '' !== $last_imported_at ? 'report_imported' : 'oauth_not_configured', 'reportDimension' => 'PAGE_URL',
			'rows' => (int) ( $row['rows_count'] ?? 0 ), 'mappedRows' => (int) ( $row['mapped_count'] ?? 0 ), 'quarantinedRows' => (int) ( $row['quarantined_count'] ?? 0 ),
			'grossEstimatedUsd' => round( $gross / 1000000, 6 ), 'mappedEstimatedUsd' => round( $mapped / 1000000, 6 ),
			'shadowCreatorPercent' => $share, 'shadowCreatorEstimatedUsd' => round( ( $mapped / 1000000 ) * ( $share / 100 ), 6 ),
			'lastImportedAt' => $last_imported_at, 'lastImport' => get_option( 'sml_creator_adsense_last_import', array() ),
			'payoutsEnabled' => false, 'walletWritesEnabled' => false,
			'note' => 'AdSense estimated earnings are attribution-only. Unmapped pages are quarantined and no row can enter payouts.',
		);
	}

	add_action( 'init', 'sml_creator_adsense_maybe_install', 8 );
	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-creator-analytics/v1', '/adsense-attribution/me', array(
			'methods' => WP_REST_Server::READABLE,
			'permission_callback' => 'is_user_logged_in',
			'callback' => static function () { return rest_ensure_response( sml_creator_adsense_summary( get_current_user_id() ) ); },
		) );
		register_rest_route( 'sml-creator-analytics/v1', '/adsense-attribution/status', array(
			'methods' => WP_REST_Server::READABLE,
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
			'callback' => static function () { return rest_ensure_response( sml_creator_adsense_summary() ); },
		) );
		register_rest_route( 'sml-creator-analytics/v1', '/adsense-attribution/import', array(
			'methods' => WP_REST_Server::CREATABLE,
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
			'callback' => static function ( WP_REST_Request $request ) {
				return sml_creator_adsense_import_report( $request->get_param( 'report' ), $request->get_param( 'account' ), (bool) $request->get_param( 'commit' ), $request->get_param( 'confirmation' ) );
			},
		) );
	} );
}
