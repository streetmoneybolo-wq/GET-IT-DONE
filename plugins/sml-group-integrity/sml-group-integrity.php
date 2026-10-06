<?php
/**
 * Plugin Name: StockMarketLoop Group Integrity
 * Description: Safe group-content ownership controls and immutable 30-day alert performance records.
 * Version: 1.3.1
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_GI_VERSION', '1.3.1' );
define( 'SML_GI_DIR', plugin_dir_path( __FILE__ ) );
define( 'SML_GI_URL', plugin_dir_url( __FILE__ ) );

register_activation_hook( __FILE__, 'sml_gi_activate' );
add_action( 'plugins_loaded', 'sml_gi_maybe_upgrade' );
add_action( 'rest_api_init', 'sml_gi_register_routes', PHP_INT_MAX );
add_filter( 'rest_request_after_callbacks', 'sml_gi_capture_dashboard_alert', 20, 3 );
add_action( 'sml_gi_refresh_performance', 'sml_gi_refresh_all' );
add_action( 'wp_enqueue_scripts', 'sml_gi_enqueue_assets', 50 );
add_action( 'wp_footer', 'sml_gi_inline_loader', 3 );

function sml_gi_table() {
    global $wpdb;
    return $wpdb->prefix . 'sml_group_alert_performance';
}

function sml_gi_activate() {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $charset = $wpdb->get_charset_collate();
    $table = sml_gi_table();
    dbDelta( "CREATE TABLE {$table} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        alert_key varchar(64) NOT NULL,
        group_id bigint(20) unsigned NOT NULL,
        channel_id bigint(20) unsigned NOT NULL DEFAULT 0,
        message_id bigint(20) unsigned NOT NULL DEFAULT 0,
        author_id bigint(20) unsigned NOT NULL DEFAULT 0,
        symbol varchar(24) NOT NULL,
        direction varchar(12) NOT NULL DEFAULT 'long',
        entry_price decimal(18,6) NOT NULL,
        target_price decimal(18,6) DEFAULT NULL,
        alert_at_utc datetime NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'tracking',
        sessions_seen smallint unsigned NOT NULL DEFAULT 0,
        last_price decimal(18,6) DEFAULT NULL,
        last_price_at_utc datetime DEFAULT NULL,
        current_return_pct decimal(12,4) DEFAULT NULL,
        peak_gain_pct decimal(12,4) DEFAULT NULL,
        peak_at_utc datetime DEFAULT NULL,
        final_return_pct decimal(12,4) DEFAULT NULL,
        target_hit tinyint(1) NOT NULL DEFAULT 0,
        outcome varchar(12) NOT NULL DEFAULT 'open',
        settled_at_utc datetime DEFAULT NULL,
        source_deleted tinyint(1) NOT NULL DEFAULT 0,
        source_payload longtext DEFAULT NULL,
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY alert_group (alert_key,group_id),
        KEY group_status (group_id,status),
        KEY group_alert_time (group_id,alert_at_utc),
        KEY symbol_status (symbol,status)
    ) {$charset};" );

    update_option( 'sml_gi_db_version', SML_GI_VERSION, false );
    if ( ! wp_next_scheduled( 'sml_gi_refresh_performance' ) ) {
        wp_schedule_event( time() + 60, 'sml_gi_five_minutes', 'sml_gi_refresh_performance' );
    }
    sml_gi_backfill_option_alerts();
}

add_filter( 'cron_schedules', function( $schedules ) {
    $schedules['sml_gi_five_minutes'] = array( 'interval' => 300, 'display' => 'Every five minutes' );
    return $schedules;
} );

function sml_gi_maybe_upgrade() {
    if ( get_option( 'sml_gi_db_version' ) !== SML_GI_VERSION ) {
        sml_gi_activate();
    }
}

function sml_gi_enqueue_assets() {
    if ( ! preg_match( '#^/groups/[^/]+/?#', (string) wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ) ) ) {
        return;
    }
    wp_enqueue_style( 'sml-group-integrity', SML_GI_URL . 'assets/group-integrity.css', array(), SML_GI_VERSION );
    wp_enqueue_script( 'sml-group-integrity', SML_GI_URL . 'assets/group-integrity.js', array(), SML_GI_VERSION, true );
}

function sml_gi_inline_loader() {
    if ( ! preg_match( '#^/groups/[^/]+/?#', (string) wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ) ) ) return;
    echo '<link rel="stylesheet" data-sml-integrity-style="1" href="' . esc_url( SML_GI_URL . 'assets/group-integrity.css?ver=' . SML_GI_VERSION ) . '">';
    echo '<script data-sml-integrity-loader="1" src="' . esc_url( SML_GI_URL . 'assets/group-integrity.js?ver=' . SML_GI_VERSION ) . '"></script>';
}

function sml_gi_register_routes() {
    register_rest_route( 'sml/v1', '/group/performance', array(
        'methods' => WP_REST_Server::READABLE,
        'permission_callback' => '__return_true',
        'callback' => 'sml_gi_rest_performance',
        'args' => array( 'group_id' => array( 'required' => true, 'sanitize_callback' => 'absint' ) ),
    ), true );
    register_rest_route( 'sml/v1', '/group/performance-v2', array(
        'methods' => WP_REST_Server::READABLE,
        'permission_callback' => '__return_true',
        'callback' => 'sml_gi_rest_performance',
        'args' => array( 'group_id' => array( 'required' => true, 'sanitize_callback' => 'absint' ) ),
    ), true );

    foreach ( array(
        '/group/post/edit' => 'sml_gi_edit_post',
        '/group/chat/edit' => 'sml_gi_edit_chat',
        '/group/channel/message/edit' => 'sml_gi_edit_channel_message',
        '/group/post/delete' => 'sml_gi_delete_post',
        '/group/chat/delete' => 'sml_gi_delete_chat',
        '/group/channel/message/delete' => 'sml_gi_delete_channel_message',
    ) as $route => $callback ) {
        register_rest_route( 'sml/v1', $route, array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => 'is_user_logged_in',
            'callback' => $callback,
        ), true );
    }
}

function sml_gi_group_tables() {
    if ( function_exists( 'sml_groups_tables' ) ) { return sml_groups_tables(); }
    global $wpdb;
    return array(
        'posts' => $wpdb->prefix . 'sml_group_posts',
        'chat' => $wpdb->prefix . 'sml_group_chat',
        'channel_messages' => $wpdb->prefix . 'sml_group_channel_messages',
        'channels' => $wpdb->prefix . 'sml_group_channels',
    );
}

function sml_gi_can_manage( $group_id ) {
    return current_user_can( 'manage_options' ) || ( function_exists( 'sml_groups_current_user_can_manage' ) && sml_groups_current_user_can_manage( (int) $group_id ) );
}

function sml_gi_author_only( $row ) {
    return $row && get_current_user_id() > 0 && (int) $row['user_id'] === get_current_user_id();
}

function sml_gi_can_delete( $row ) {
    return sml_gi_author_only( $row ) || ( $row && sml_gi_can_manage( (int) $row['group_id'] ) );
}

function sml_gi_row( $table, $id ) {
    global $wpdb;
    return $id ? $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id=%d", $id ), ARRAY_A ) : null;
}

function sml_gi_edit_post( WP_REST_Request $request ) {
    global $wpdb;
    $t = sml_gi_group_tables(); $id = absint( $request['post_id'] ); $row = sml_gi_row( $t['posts'], $id );
    if ( ! $row ) return new WP_Error( 'sml_group_post_missing', 'Group post not found.', array( 'status' => 404 ) );
    if ( ! sml_gi_author_only( $row ) ) return new WP_Error( 'sml_edit_denied', 'Only the author can edit this post.', array( 'status' => 403 ) );
    $content = wp_kses_post( (string) $request['content'] );
    if ( '' === trim( wp_strip_all_tags( $content ) ) ) return new WP_Error( 'sml_empty_group_post', 'Write something before saving.', array( 'status' => 400 ) );
    $wpdb->update( $t['posts'], array( 'content' => $content, 'chart_url' => esc_url_raw( (string) $request['chart_url'] ) ), array( 'id' => $id ), array( '%s', '%s' ), array( '%d' ) );
    return array( 'updated' => true, 'post_id' => $id );
}

function sml_gi_edit_chat( WP_REST_Request $request ) {
    global $wpdb;
    $t = sml_gi_group_tables(); $id = absint( $request['chat_id'] ); $row = sml_gi_row( $t['chat'], $id );
    if ( ! $row ) return new WP_Error( 'sml_group_chat_missing', 'Group chat message not found.', array( 'status' => 404 ) );
    if ( ! sml_gi_author_only( $row ) ) return new WP_Error( 'sml_edit_denied', 'Only the author can edit this message.', array( 'status' => 403 ) );
    $message = sanitize_textarea_field( (string) $request['message'] );
    if ( '' === $message ) return new WP_Error( 'sml_empty_group_chat', 'Write a message before saving.', array( 'status' => 400 ) );
    $wpdb->update( $t['chat'], array( 'message' => $message ), array( 'id' => $id ), array( '%s' ), array( '%d' ) );
    return array( 'updated' => true, 'chat_id' => $id );
}

function sml_gi_edit_channel_message( WP_REST_Request $request ) {
    global $wpdb;
    $t = sml_gi_group_tables(); $id = absint( $request['message_id'] ); $row = sml_gi_row( $t['channel_messages'], $id );
    if ( ! $row ) return new WP_Error( 'sml_group_channel_message_missing', 'Channel message not found.', array( 'status' => 404 ) );
    if ( ! sml_gi_author_only( $row ) ) return new WP_Error( 'sml_edit_denied', 'Only the author can edit this message.', array( 'status' => 403 ) );
    $message = sanitize_textarea_field( (string) $request['message'] );
    $media = esc_url_raw( (string) $request['media_url'] );
    if ( '' === $message && '' === $media ) return new WP_Error( 'sml_empty_channel_message', 'Write a message or keep its media before saving.', array( 'status' => 400 ) );
    $tags = function_exists( 'sml_groups_extract_tickers' ) ? sml_groups_extract_tickers( $message ) : array();
    $wpdb->update( $t['channel_messages'], array( 'message' => $message, 'media_url' => $media, 'ticker_tags' => wp_json_encode( $tags ) ), array( 'id' => $id ), array( '%s', '%s', '%s' ), array( '%d' ) );
    return array( 'updated' => true, 'message_id' => $id );
}

function sml_gi_delete_generic( $table, $id, $label, $response_key ) {
    global $wpdb;
    $row = sml_gi_row( $table, $id );
    if ( ! $row ) return new WP_Error( 'sml_content_missing', $label . ' not found.', array( 'status' => 404 ) );
    if ( ! sml_gi_can_delete( $row ) ) return new WP_Error( 'sml_delete_denied', 'Only the author or a group manager can delete this content.', array( 'status' => 403 ) );
    sml_gi_mark_alert_source_deleted( $row );
    $wpdb->delete( $table, array( 'id' => $id ), array( '%d' ) );
    return array( 'deleted' => true, $response_key => $id );
}

function sml_gi_delete_post( WP_REST_Request $r ) { $t=sml_gi_group_tables(); return sml_gi_delete_generic( $t['posts'], absint($r['post_id']), 'Group post', 'post_id' ); }
function sml_gi_delete_chat( WP_REST_Request $r ) { $t=sml_gi_group_tables(); return sml_gi_delete_generic( $t['chat'], absint($r['chat_id']), 'Group chat message', 'chat_id' ); }
function sml_gi_delete_channel_message( WP_REST_Request $r ) { $t=sml_gi_group_tables(); return sml_gi_delete_generic( $t['channel_messages'], absint($r['message_id']), 'Channel message', 'message_id' ); }

function sml_gi_mark_alert_source_deleted( $row ) {
    global $wpdb;
    if ( empty( $row['reactions'] ) ) return;
    $meta = json_decode( (string) $row['reactions'], true );
    $key = is_array( $meta ) ? sanitize_text_field( (string) ( $meta['_sml_alert_id'] ?? '' ) ) : '';
    if ( $key ) $wpdb->update( sml_gi_table(), array( 'source_deleted' => 1, 'updated_at' => current_time( 'mysql', true ) ), array( 'alert_key' => $key, 'group_id' => (int) $row['group_id'] ), array( '%d', '%s' ), array( '%s', '%d' ) );
}

function sml_gi_capture_dashboard_alert( $response, $handler, $request ) {
    if ( '/sml/v1/dash-alerts' !== $request->get_route() || 'POST' !== $request->get_method() ) return $response;
    $params = $request->get_json_params();
    if ( ! is_array( $params ) ) return $response;
    if ( ( $params['action'] ?? 'create' ) === 'delete' ) {
        global $wpdb;
        $wpdb->update( sml_gi_table(), array( 'source_deleted' => 1, 'updated_at' => current_time( 'mysql', true ) ), array( 'alert_key' => sanitize_text_field( (string) ( $params['id'] ?? '' ) ) ), array( '%d', '%s' ), array( '%s' ) );
        return $response;
    }
    $server = rest_ensure_response( $response );
    if ( $server->get_status() >= 300 ) return $response;
    $data = $server->get_data();
    $alert = is_array( $data ) && isset( $data['alert'] ) && is_array( $data['alert'] ) ? $data['alert'] : array();
    if ( $alert ) sml_gi_store_alert( $alert );
    return $response;
}

function sml_gi_store_alert( $alert ) {
    global $wpdb;
    if ( ( $alert['instrument'] ?? 'equity' ) !== 'equity' || empty( $alert['delivery']['groups']['group_id'] ) ) return false;
    $entry = (float) ( $alert['entryPrice'] ?? 0 );
    if ( $entry <= 0 ) return false;
    $delivery = $alert['delivery']['groups'];
    $exists = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . sml_gi_table() . ' WHERE alert_key=%s AND group_id=%d', sanitize_text_field( (string) $alert['id'] ), absint( $delivery['group_id'] ) ) );
    if ( $exists ) return true;
    $side = strtolower( (string) ( $alert['side'] ?? 'buy' ) );
    $now = current_time( 'mysql', true );
    return false !== $wpdb->insert( sml_gi_table(), array(
        'alert_key' => sanitize_text_field( (string) $alert['id'] ),
        'group_id' => absint( $delivery['group_id'] ), 'channel_id' => absint( $delivery['channel_id'] ?? 0 ), 'message_id' => absint( $delivery['message_id'] ?? 0 ),
        'author_id' => absint( $alert['authorId'] ?? 0 ), 'symbol' => strtoupper( sanitize_text_field( (string) $alert['symbol'] ) ),
        'direction' => 'sell' === $side ? 'short' : 'long', 'entry_price' => $entry, 'target_price' => (float) ( $alert['targetPrice'] ?? 0 ),
        'alert_at_utc' => gmdate( 'Y-m-d H:i:s', absint( $alert['created'] ?? time() ) ), 'status' => 'tracking', 'outcome' => 'open',
        'source_payload' => wp_json_encode( $alert ), 'created_at' => $now, 'updated_at' => $now,
    ), array( '%s','%d','%d','%d','%d','%s','%s','%f','%f','%s','%s','%s','%s','%s','%s' ) );
}

function sml_gi_backfill_option_alerts() {
    $alerts = get_option( 'sml_chart_alerts', array() );
    if ( ! is_array( $alerts ) ) return;
    foreach ( $alerts as $alert ) {
        if ( is_array( $alert ) ) sml_gi_store_alert( $alert );
    }
}

function sml_gi_history( $symbol ) {
    $request = new WP_REST_Request( 'GET', '/sml/v1/history' );
    $request->set_param( 'symbol', $symbol ); $request->set_param( 'tf', '1m' );
    $response = rest_do_request( $request );
    if ( is_wp_error( $response ) || $response->get_status() >= 300 ) return array();
    $data = $response->get_data();
    return is_array( $data ) && ( $data['quality'] ?? '' ) === 'authoritative' && is_array( $data['bars'] ?? null ) ? $data['bars'] : array();
}

/**
 * Accept only chronologically unique, internally consistent, authoritative
 * candles. This prevents malformed, demo, provisional, duplicate, or
 * out-of-window bars from changing an alert's permanent record.
 */
function sml_gi_valid_market_bars( $bars, $start_ms, $end_ms ) {
    $valid = array();
    foreach ( is_array( $bars ) ? $bars : array() as $bar ) {
        if ( ! is_array( $bar ) || ! isset( $bar['t'], $bar['o'], $bar['h'], $bar['l'], $bar['c'] ) ) continue;
        if ( isset( $bar['quality'] ) && 'authoritative' !== strtolower( (string) $bar['quality'] ) ) continue;
        $stamp = (float) $bar['t'];
        if ( $stamp > 1e17 ) $stamp = floor( $stamp / 1e6 );
        elseif ( $stamp > 1e14 ) $stamp = floor( $stamp / 1e3 );
        elseif ( $stamp < 1e11 ) $stamp = floor( $stamp * 1000 );
        $open=(float)$bar['o']; $high=(float)$bar['h']; $low=(float)$bar['l']; $close=(float)$bar['c'];
        if ( ! is_finite($stamp) || ! is_finite($open) || ! is_finite($high) || ! is_finite($low) || ! is_finite($close) ) continue;
        if ( $stamp < $start_ms || $stamp > $end_ms || $open <= 0 || $high <= 0 || $low <= 0 || $close <= 0 ) continue;
        if ( $high < max($open,$close,$low) || $low > min($open,$close,$high) ) continue;
        $bar['t']=(int)$stamp; $bar['o']=$open; $bar['h']=$high; $bar['l']=$low; $bar['c']=$close;
        $valid[(string)(int)$stamp]=$bar;
    }
    ksort($valid, SORT_NUMERIC);
    return array_values($valid);
}

/**
 * A target is a defined exit condition, so record its return at the target
 * price rather than at a later, unrelated close. This keeps immediate wins
 * comparable with alerts that settle at the end of the 30-day window.
 */
function sml_gi_target_return_pct( $entry, $target, $direction ) {
    $entry = (float) $entry;
    $target = (float) $target;
    if ( $entry <= 0 || $target <= 0 ) return null;
    return 'short' === $direction
        ? ( ( $entry - $target ) / $entry * 100 )
        : ( ( $target - $entry ) / $entry * 100 );
}

function sml_gi_should_settle( $target_hit, $now, $end_ts ) {
    return (bool) $target_hit || (int) $now >= (int) $end_ts;
}

function sml_gi_outcome_for_settlement( $target_hit, $current_return ) {
    if ( $target_hit || (float) $current_return > 0 ) return 'win';
    if ( (float) $current_return < 0 ) return 'loss';
    return 'flat';
}

/**
 * Deduplicate mirrored delivery records in the public record without deleting
 * either audit row. A real re-alert remains distinct when its entry, target,
 * direction, author, or five-minute alert window differs.
 */
function sml_gi_logical_alert_key( $row ) {
    $at = strtotime( (string) ( $row['alert_at_utc'] ?? '' ) . ' UTC' );
    $bucket = $at ? (int) floor( $at / 300 ) : 0;
    return implode( '|', array(
        (int) ( $row['group_id'] ?? 0 ),
        (int) ( $row['author_id'] ?? 0 ),
        strtoupper( (string) ( $row['symbol'] ?? '' ) ),
        strtolower( (string) ( $row['direction'] ?? 'long' ) ),
        number_format( (float) ( $row['entry_price'] ?? 0 ), 6, '.', '' ),
        number_format( (float) ( $row['target_price'] ?? 0 ), 6, '.', '' ),
        $bucket,
    ) );
}

function sml_gi_unique_logical_rows( $rows ) {
    $unique = array();
    foreach ( (array) $rows as $row ) {
        $key = sml_gi_logical_alert_key( $row );
        // Prefer the earliest database row, which is the original delivery.
        if ( ! isset( $unique[ $key ] ) || (int) $row['id'] < (int) $unique[ $key ]['id'] ) $unique[ $key ] = $row;
    }
    return array_values( $unique );
}

function sml_gi_refresh_all() {
    global $wpdb;
    if ( get_transient( 'sml_gi_refresh_lock' ) ) return;
    set_transient( 'sml_gi_refresh_lock', 1, 45 );
    sml_gi_backfill_option_alerts();
    $rows = $wpdb->get_results( "SELECT * FROM " . sml_gi_table() . " WHERE status='tracking' ORDER BY alert_at_utc ASC LIMIT 100", ARRAY_A );
    foreach ( $rows ?: array() as $row ) sml_gi_refresh_row( $row );
    $groups = $wpdb->get_col( "SELECT DISTINCT group_id FROM " . sml_gi_table() );
    foreach ( $groups ?: array() as $group_id ) sml_gi_update_summary( (int) $group_id );
}

function sml_gi_refresh_row( $row ) {
    global $wpdb;
    $entry = is_numeric($row['entry_price']) ? (float)$row['entry_price'] : 0.0;
    if ( ! is_finite($entry) || $entry <= 0 ) {
        $wpdb->update(sml_gi_table(),array('status'=>'unverified','outcome'=>'excluded','updated_at'=>current_time('mysql',true)),array('id'=>(int)$row['id']),array('%s','%s','%s'),array('%d'));
        return;
    }
    $bars = sml_gi_history( $row['symbol'] );
    $start_ms = strtotime( $row['alert_at_utc'] . ' UTC' ) * 1000;
    $end_ts = strtotime( $row['alert_at_utc'] . ' UTC' ) + ( 30 * DAY_IN_SECONDS );
    $end_ms = $end_ts * 1000;
    $bars = sml_gi_valid_market_bars( $bars, $start_ms, $end_ms );
    if ( ! $bars ) {
        if ( null === $row['peak_gain_pct'] && time() > $end_ts + ( 3 * DAY_IN_SECONDS ) ) {
            $wpdb->update( sml_gi_table(), array( 'status'=>'unverified', 'outcome'=>'excluded', 'updated_at'=>current_time('mysql',true) ), array( 'id'=>(int)$row['id'] ), array('%s','%s','%s'), array('%d') );
        }
        return;
    }
    $first_bar_ms = (float) $bars[0]['t'];
    if ( $first_bar_ms - $start_ms > 4 * DAY_IN_SECONDS * 1000 ) {
        // A proof-backed imported alert may predate the one-minute history window.
        // Preserve its audited peak instead of destroying verified evidence.
        if ( null !== $row['peak_gain_pct'] ) return;
        $wpdb->update( sml_gi_table(), array( 'status'=>'unverified', 'outcome'=>'excluded', 'sessions_seen'=>0, 'last_price'=>null, 'last_price_at_utc'=>null, 'current_return_pct'=>null, 'peak_gain_pct'=>null, 'peak_at_utc'=>null, 'updated_at'=>current_time('mysql',true) ), array( 'id'=>(int)$row['id'] ) );
        return;
    }
    $tz = new DateTimeZone( 'America/New_York' ); $sessions = array();
    foreach ( $bars as $bar ) { $dt=(new DateTimeImmutable('@'.(int)floor($bar['t']/1000)))->setTimezone($tz); $sessions[$dt->format('Y-m-d')]=true; }
    $session_dates = array_keys( $sessions ); sort( $session_dates );
    $short='short'===$row['direction']; $peak=null===$row['peak_gain_pct']?null:(float)$row['peak_gain_pct']; $peak_at=$row['peak_at_utc']?strtotime($row['peak_at_utc'].' UTC'):null; $target_hit=!empty($row['target_hit']);
    if ( null !== $peak && ( ! is_finite($peak) || !$peak_at || $peak_at < (int)floor($start_ms/1000) || $peak_at > $end_ts ) ) { $peak=null; $peak_at=null; }
    foreach($bars as $bar){$candidate=$short?(float)$bar['l']:(float)$bar['h'];$gain=$short?(($entry-$candidate)/$entry*100):(($candidate-$entry)/$entry*100);if(is_finite($gain)&&abs($gain)<=10000000&&(null===$peak||$gain>$peak)){$peak=$gain;$peak_at=(int)floor($bar['t']/1000);} $target=(float)$row['target_price'];if($target>0&&(($short&&(float)$bar['l']<=$target)||(!$short&&(float)$bar['h']>=$target)))$target_hit=true;}
    $last=end($bars); $last_price=(float)$last['c']; $current=$short?(($entry-$last_price)/$entry*100):(($last_price-$entry)/$entry*100);
    // A target hit is a win immediately. Losses still wait for the 30-day
    // window unless an explicit stop-out is later recorded.
    $settle = sml_gi_should_settle( $target_hit, time(), $end_ts );
    $outcome = $settle ? sml_gi_outcome_for_settlement( $target_hit, $current ) : 'open';
    $data=array('sessions_seen'=>min(30,count($session_dates)),'last_price'=>$last_price,'last_price_at_utc'=>gmdate('Y-m-d H:i:s',(int)floor($last['t']/1000)),'current_return_pct'=>$current,'peak_gain_pct'=>$peak,'peak_at_utc'=>$peak_at?gmdate('Y-m-d H:i:s',$peak_at):null,'target_hit'=>$target_hit?1:0,'updated_at'=>current_time('mysql',true));
    $formats=array('%d','%f','%s','%f','%f','%s','%d','%s');
    if ( $settle ) {
        $final_return = $target_hit ? sml_gi_target_return_pct( $entry, (float) $row['target_price'], $row['direction'] ) : $current;
        $data['status']='settled'; $data['outcome']=$outcome; $data['final_return_pct']=null === $final_return ? $current : $final_return; $data['settled_at_utc']=current_time('mysql',true);
        $formats=array_merge($formats,array('%s','%s','%f','%s'));
    }
    $wpdb->update(sml_gi_table(),$data,array('id'=>(int)$row['id']),$formats,array('%d'));
}

function sml_gi_stats( $group_id, $channel_id = 0 ) {
    global $wpdb; $table=sml_gi_table();
    $rows=$channel_id
        ? ( $wpdb->get_results($wpdb->prepare("SELECT * FROM {$table} WHERE group_id=%d AND channel_id=%d ORDER BY alert_at_utc DESC",$group_id,$channel_id),ARRAY_A) ?: array() )
        : ( $wpdb->get_results($wpdb->prepare("SELECT * FROM {$table} WHERE group_id=%d ORDER BY alert_at_utc DESC",$group_id),ARRAY_A) ?: array() );
    $audit_rows = $rows;
    $rows = sml_gi_unique_logical_rows( $rows );
    $settled=array_values(array_filter($rows,function($r){return 'settled'===$r['status']&&in_array($r['outcome'],array('win','loss'),true);}));
    $wins=count(array_filter($settled,function($r){return 'win'===$r['outcome'];}));$losses=count($settled)-$wins;$count=count($settled);
    $open=array_values(array_filter($rows,function($r){return 'tracking'===$r['status'];}));
    $recent_loss=null;foreach($settled as $r){if('loss'===$r['outcome']){$recent_loss=array('symbol'=>$r['symbol'],'return_pct'=>(float)$r['final_return_pct'],'settled_at'=>$r['settled_at_utc']);break;}}
    $avg=$count?array_sum(array_map(function($r){return(float)$r['final_return_pct'];},$settled))/$count:null;
    $best_peak_row=null;foreach($rows as $r){if(null===$r['peak_gain_pct'])continue;if(null===$best_peak_row||(float)$r['peak_gain_pct']>(float)$best_peak_row['peak_gain_pct'])$best_peak_row=$r;}
    $peak=$best_peak_row?(float)$best_peak_row['peak_gain_pct']:null;
    $best_peak=$best_peak_row?array('symbol'=>$best_peak_row['symbol'],'peak_gain_pct'=>round((float)$best_peak_row['peak_gain_pct'],2),'alert_at'=>$best_peak_row['alert_at_utc'],'entry_price'=>(float)$best_peak_row['entry_price'],'peak_at'=>$best_peak_row['peak_at_utc']):null;
    $recent_alerts=array_slice(array_map(function($r){$start=strtotime($r['alert_at_utc'].' UTC');$peak_at=$r['peak_at_utc']?strtotime($r['peak_at_utc'].' UTC'):0;return array('symbol'=>$r['symbol'],'direction'=>$r['direction'],'status'=>$r['status'],'outcome'=>$r['outcome'],'entry_price'=>(float)$r['entry_price'],'current_return_pct'=>null===$r['current_return_pct']?null:(float)$r['current_return_pct'],'peak_gain_pct'=>null===$r['peak_gain_pct']?null:(float)$r['peak_gain_pct'],'time_to_peak_seconds'=>$peak_at?max(0,$peak_at-$start):null,'sessions_seen'=>(int)$r['sessions_seen'],'alert_at'=>$r['alert_at_utc'],'source_deleted'=>(bool)$r['source_deleted']);},$rows),0,8);
    return array('group_id'=>$group_id,'channel_id'=>(int)$channel_id,'record_scope'=>'all_time','tracking_window_days'=>30,'sample_size'=>$count,'audit_row_count'=>count($audit_rows),'mirrored_delivery_rows'=>max(0,count($audit_rows)-count($rows)),'wins'=>$wins,'losses'=>$losses,'win_rate'=>$count?round($wins/$count*100,2):null,'open_alerts'=>count($open),'average_final_return_pct'=>null===$avg?null:round($avg,2),'best_peak_gain_pct'=>null===$peak?null:round($peak,2),'best_peak'=>$best_peak,'recent_loss'=>$recent_loss,'recent_alerts'=>$recent_alerts,'methodology'=>'This alert channel is scored independently. Each equity alert is tracked for 30 calendar days from its immutable alert timestamp and entry price. A target hit is recorded as a win when it is first observed; otherwise, at the end of day 30, a positive final return is a win and a negative final return is a loss. Open alerts are excluded from win rate. Mirrored delivery rows are retained in the permanent audit but counted once in the public record. Alerts without authoritative source bars are marked unverified and excluded. Every alert record remains in the permanent audit even if its source message is later deleted.','updated_at'=>gmdate(DATE_ATOM));
}

function sml_gi_update_summary($group_id){global$wpdb;$s=sml_gi_stats($group_id);$table=$wpdb->prefix.'sml_group_performance';$now=current_time('mysql');$exists=$wpdb->get_var($wpdb->prepare("SELECT id FROM {$table} WHERE group_id=%d",$group_id));$data=array('show_pnl'=>1,'stock_win_rate'=>$s['win_rate'],'stock_wins'=>$s['wins'],'stock_losses'=>$s['losses'],'score'=>$s['win_rate']??0,'period_start'=>gmdate('Y-m-d',time()-90*DAY_IN_SECONDS),'period_end'=>gmdate('Y-m-d'),'updated_at'=>$now);if($exists)$wpdb->update($table,$data,array('group_id'=>$group_id));else{$data['group_id']=$group_id;$wpdb->insert($table,$data);}}

function sml_gi_channel_context( $group_id, $channel_id ) {
    $channels_request = new WP_REST_Request( 'GET', '/sml/v1/group/channels' );
    $channels_request->set_param( 'group_id', absint( $group_id ) );
    $channels_response = rest_do_request( $channels_request );
    if ( is_wp_error( $channels_response ) || $channels_response->get_status() >= 400 ) return null;
    $data = $channels_response->get_data();
    foreach ( (array) ( $data['channels'] ?? array() ) as $channel ) {
        if ( absint( $channel['id'] ?? 0 ) !== absint( $channel_id ) ) continue;
        $category = trim( (string) ( $channel['category'] ?? '' ) );
        $is_alert = false !== strpos( strtolower( $category ), 'alert' ) || ! empty( $channel['is_alert_channel'] ) || false !== strpos( sanitize_key( (string) ( $channel['type'] ?? '' ) ), 'alert' );
        return array( 'id' => absint( $channel['id'] ), 'name' => sanitize_text_field( (string) ( $channel['name'] ?? '' ) ), 'category' => $category ?: ( $is_alert ? 'Alerts' : 'Channels' ), 'is_alert' => $is_alert );
    }
    return null;
}

function sml_gi_rest_performance(WP_REST_Request $request){$group_id=absint($request['group_id']);$channel_id=absint($request['channel_id']);if(!$group_id)return new WP_Error('sml_group_required','A group is required.',array('status'=>400));$channel=$channel_id?sml_gi_channel_context($group_id,$channel_id):null;if($channel&&empty($channel['is_alert']))return new WP_Error('sml_alert_channel_required','Performance is only available inside Alert channels.',array('status'=>400));sml_gi_refresh_all();$performance=sml_gi_stats($group_id,$channel_id);if($channel_id)$performance['channel']=$channel?array('id'=>(int)$channel['id'],'name'=>(string)$channel['name'],'category'=>(string)$channel['category']):array('id'=>$channel_id,'name'=>'','category'=>'Alerts');$response=new WP_REST_Response(array('performance'=>$performance),200);$response->header('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');$response->header('X-SML-Integrity-Version',SML_GI_VERSION);return $response;}
