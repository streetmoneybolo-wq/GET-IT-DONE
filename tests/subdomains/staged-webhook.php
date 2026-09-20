<?php
/* Webhook tests: signature scheme, routing, activation, refunds, retries. Stripe stubbed; all DB rolled back. */
global $wpdb; $U = 258456581; $bad = 0; $t = sml_sub_t();
$ok = function ( $c, $l ) use ( &$bad ) { echo ( $c ? 'PASS ' : 'FAIL ' ) . $l . "\n"; if ( ! $c ) { $bad++; } };
/* The real signing secret is never touched: the test injects a throwaway one through the plugin's filter. */
$SECRET = 'whsec_test_' . wp_generate_password( 24, false );
add_filter( 'sml_sub_webhook_secret', function () use ( $SECRET ) { return $SECRET; } );
$real_before = md5( (string) $wpdb->get_var( "SELECT option_value FROM {$wpdb->options} WHERE option_name = 'sml_sub_webhook_secret'" ) );

$GLOBALS['fake'] = array( 'sessions' => array(), 'refunds' => array(), 'n' => 0, 'net_down' => false, 'gets' => 0 );
add_filter( 'sml_sub_stripe_pre', function ( $pre, $method, $path, $body ) {
	$f = &$GLOBALS['fake'];
	if ( 'POST' === $method && '/v1/checkout/sessions' === $path ) {
		$id = 'cs_test_wh' . ( ++$f['n'] );
		$f['sessions'][ $id ] = array( 'id' => $id, 'url' => 'https://checkout.stripe.com/c/pay/' . $id, 'status' => 'open', 'payment_status' => 'unpaid', 'amount_total' => $body['line_items'][0]['price_data']['unit_amount'], 'currency' => 'usd', 'metadata' => $body['metadata'], 'payment_intent' => null );
		return $f['sessions'][ $id ];
	}
	if ( 'GET' === $method && 0 === strpos( $path, '/v1/checkout/sessions/' ) ) {
		$f['gets']++;
		if ( $f['net_down'] ) { return new WP_Error( 'sml_sub_stripe_net', 'down', array( 'status' => 502 ) ); }
		$id = rawurldecode( substr( $path, strlen( '/v1/checkout/sessions/' ) ) );
		return $f['sessions'][ $id ] ?? new WP_Error( 'x', 'No such session' );
	}
	if ( 'POST' === $method && '/v1/refunds' === $path ) { $f['refunds'][] = $body['payment_intent']; return array( 'id' => 're_1', 'status' => 'succeeded' ); }
	return new WP_Error( 'x', 'unexpected ' . $method . ' ' . $path );
}, 10, 4 );
$pay = function ( $sid ) { $GLOBALS['fake']['sessions'][ $sid ]['status'] = 'complete'; $GLOBALS['fake']['sessions'][ $sid ]['payment_status'] = 'paid'; $GLOBALS['fake']['sessions'][ $sid ]['payment_intent'] = 'pi_' . $sid; };
$sign = function ( $raw, $secret, $ts = null ) { $ts = $ts ?? time(); return 't=' . $ts . ',v1=' . hash_hmac( 'sha256', $ts . '.' . $raw, $secret ); };
$post = function ( $raw, $header ) {
	$r = new WP_REST_Request( 'POST', '/sml-sub/v1/stripe-webhook' );
	$r->set_body( $raw ); $r->set_header( 'content-type', 'application/json' );
	if ( null !== $header ) { $r->set_header( 'stripe-signature', $header ); }
	$res = rest_do_request( $r );
	return array( $res->get_status(), $res->get_data() );
};
$evt = function ( $type, $obj ) { return wp_json_encode( array( 'id' => 'evt_' . wp_generate_password( 8, false ), 'type' => $type, 'data' => array( 'object' => $obj ) ) ); };

$wpdb->query( 'START TRANSACTION' );
try {
	/* ---- signature scheme (pure) ---- */
	$raw = '{"a":1}'; $now = 1800000000;
	$h = 't=' . $now . ',v1=' . hash_hmac( 'sha256', $now . '.' . $raw, $SECRET );
	$ok( sml_sub_wh_verify( $raw, $h, $SECRET, $now ), 'a correct signature verifies' );
	$ok( ! sml_sub_wh_verify( $raw . ' ', $h, $SECRET, $now ), 'a changed body fails' );
	$ok( ! sml_sub_wh_verify( $raw, $h, $SECRET . 'x', $now ), 'the wrong secret fails' );
	$ok( ! sml_sub_wh_verify( $raw, $h, $SECRET, $now + 301 ), 'a signature older than 5 minutes fails (replay)' );
	$ok( ! sml_sub_wh_verify( $raw, $h, $SECRET, $now - 301 ), 'a timestamp from the future fails' );
	$ok( sml_sub_wh_verify( $raw, 'v1=deadbeef,t=' . $now . ',v1=' . hash_hmac( 'sha256', $now . '.' . $raw, $SECRET ), $SECRET, $now ), 'several v1 values: any matching one passes, order free' );
	$ok( ! sml_sub_wh_verify( $raw, '', $SECRET, $now ) && ! sml_sub_wh_verify( $raw, 'garbage', $SECRET, $now ) && ! sml_sub_wh_verify( $raw, $h, '', $now ), 'empty/garbage header or empty secret fail' );

	/* ---- over REST ---- */
	list( $st ) = $post( '{}', null );                       $ok( 400 === $st, 'no signature header -> 400' );
	list( $st ) = $post( '{}', $sign( '{}', 'whsec_wrong' ) ); $ok( 400 === $st, 'signed with the wrong secret -> 400' );
	$junk = 'not json'; list( $st ) = $post( $junk, $sign( $junk, $SECRET ) ); $ok( 400 === $st, 'a validly signed non-JSON body -> 400' );

	/* a real subdomain checkout (Stripe stubbed) */
	$r1 = sml_sub_start_checkout( $U, 'profile', $U, 'wh-test-one' ); $s1 = basename( $r1['url'] );
	$row = $wpdb->get_row( "SELECT * FROM $t WHERE name = 'wh-test-one'", ARRAY_A );

	/* other integrations' events on the same Stripe account are acknowledged and ignored */
	$body = $evt( 'checkout.session.completed', array( 'id' => 'cs_live_woocommerce_order_1', 'metadata' => array( 'order_id' => '99' ) ) );
	$gets = $GLOBALS['fake']['gets']; list( $st, $d ) = $post( $body, $sign( $body, $SECRET ) );
	$ok( 200 === $st && 'ignored:not-ours' === $d['result'] && $GLOBALS['fake']['gets'] === $gets, 'a WooCommerce checkout event is ignored without calling Stripe' );
	$body = $evt( 'invoice.paid', array( 'id' => 'in_1' ) ); list( $st, $d ) = $post( $body, $sign( $body, $SECRET ) );
	$ok( 200 === $st && 'ignored:type' === $d['result'], 'an unrelated event type is ignored' );

	/* completed but Stripe says unpaid -> stays held (the webhook alone never activates) */
	$body = $evt( 'checkout.session.completed', array( 'id' => $s1, 'metadata' => array( 'sml_sub_id' => $row['id'] ) ) );
	list( $st, $d ) = $post( $body, $sign( $body, $SECRET ) );
	$ok( 200 === $st && 'pending' === $d['result'] && 'hold' === $wpdb->get_var( "SELECT status FROM $t WHERE name = 'wh-test-one'" ), 'a "completed" event for an unpaid session does NOT activate (Stripe is re-read)' );

	/* paid -> active instantly */
	$pay( $s1 );
	list( $st, $d ) = $post( $body, $sign( $body, $SECRET ) );
	$ok( 200 === $st && 'active' === $d['result'] && 'active' === $wpdb->get_var( "SELECT status FROM $t WHERE name = 'wh-test-one'" ), 'paid -> activated the moment the event arrives' );
	$ok( home_url( '/ben/' ) === sml_sub_resolve( 'wh-test-one' ), 'and the subdomain resolves' );

	/* Stripe retries / duplicate delivery are harmless */
	list( $st, $d ) = $post( $body, $sign( $body, $SECRET ) );
	$ok( 200 === $st && 'active' === $d['result'] && 1 === (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t WHERE name = 'wh-test-one'" ) && array() === $GLOBALS['fake']['refunds'], 'the same event delivered twice: still one active row, no refund' );

	/* a forged "paid" event body cannot activate anything: signature required, and Stripe is the source of truth */
	$r2 = sml_sub_start_checkout( $U, 'channel', $U, 'wh-test-two' ); $s2 = basename( $r2['url'] );
	$forged = $evt( 'checkout.session.completed', array( 'id' => $s2, 'payment_status' => 'paid', 'metadata' => array( 'sml_sub_id' => 1 ) ) );
	list( $st ) = $post( $forged, $sign( $forged, 'whsec_attacker' ) );
	$ok( 400 === $st && 'hold' === $wpdb->get_var( "SELECT status FROM $t WHERE name = 'wh-test-two'" ), 'a forged event with the wrong secret is rejected and activates nothing' );
	list( $st, $d ) = $post( $forged, $sign( $forged, $SECRET ) );
	$ok( 200 === $st && 'pending' === $d['result'] && 'hold' === $wpdb->get_var( "SELECT status FROM $t WHERE name = 'wh-test-two'" ), 'even a correctly signed event claiming "paid" activates nothing unless Stripe says so' );

	/* expired checkout releases the name */
	$GLOBALS['fake']['sessions'][ $s2 ]['status'] = 'expired';
	$body = $evt( 'checkout.session.expired', array( 'id' => $s2, 'metadata' => array( 'sml_sub_id' => 1 ) ) );
	list( $st, $d ) = $post( $body, $sign( $body, $SECRET ) );
	$ok( 200 === $st && 'released' === $d['result'] && ! $wpdb->get_var( "SELECT COUNT(*) FROM $t WHERE name = 'wh-test-two'" ), 'checkout.session.expired releases the held name' );

	/* paid for a page that already has one -> refunded through the webhook path too */
	$wpdb->insert( $t, array( 'name' => 'wh-test-dup', 'surface' => 'profile', 'object_id' => $U, 'user_id' => $U, 'status' => 'hold', 'hold_until' => gmdate( 'Y-m-d H:i:s', time() + 600 ), 'created_at' => sml_sub_now(), 'session_id' => 'cs_test_dup' ) );
	$dupid = (int) $wpdb->insert_id;
	$GLOBALS['fake']['sessions']['cs_test_dup'] = array( 'id' => 'cs_test_dup', 'status' => 'complete', 'payment_status' => 'paid', 'amount_total' => 999, 'currency' => 'usd', 'metadata' => array( 'sml_sub_id' => $dupid ), 'payment_intent' => 'pi_dup' );
	$body = $evt( 'checkout.session.completed', array( 'id' => 'cs_test_dup', 'metadata' => array( 'sml_sub_id' => $dupid ) ) );
	list( $st, $d ) = $post( $body, $sign( $body, $SECRET ) );
	$ok( 200 === $st && 'refunded' === $d['result'] && in_array( 'pi_dup', $GLOBALS['fake']['refunds'], true ), 'a second paid subdomain for a page is refunded automatically via the webhook' );

	/* Stripe unreachable -> 503 so Stripe retries later (nothing lost) */
	$r3 = sml_sub_start_checkout( $U, 'letters', $U, 'wh-test-three' ); $s3 = basename( $r3['url'] ); $pay( $s3 );
	$body = $evt( 'checkout.session.completed', array( 'id' => $s3, 'metadata' => array( 'sml_sub_id' => 1 ) ) );
	$GLOBALS['fake']['net_down'] = true; list( $st ) = $post( $body, $sign( $body, $SECRET ) ); $GLOBALS['fake']['net_down'] = false;
	$ok( 503 === $st && 'hold' === $wpdb->get_var( "SELECT status FROM $t WHERE name = 'wh-test-three'" ), 'provider outage -> 503 (Stripe retries), name still held' );
	list( $st, $d ) = $post( $body, $sign( $body, $SECRET ) );
	$ok( 200 === $st && 'active' === $d['result'], 'the retry then activates it' );

	/* amount mismatch -> permanent: 200 (no endless retries), recorded, not activated */
	$r4 = sml_sub_start_checkout( $U, 'group', 7, 'wh-test-four' ); $s4 = basename( $r4['url'] ); $pay( $s4 ); $GLOBALS['fake']['sessions'][ $s4 ]['amount_total'] = 100;
	$body = $evt( 'checkout.session.completed', array( 'id' => $s4, 'metadata' => array( 'sml_sub_id' => 1 ) ) );
	list( $st, $d ) = $post( $body, $sign( $body, $SECRET ) );
	$ok( 200 === $st && 0 === strpos( $d['result'], 'error:' ) && 'hold' === $wpdb->get_var( "SELECT status FROM $t WHERE name = 'wh-test-four'" ), 'a wrong-amount payment is not activated and does not retry forever (' . $d['result'] . ')' );

	/* the recent-events log records handled events but not ignored ones */
	$log = get_option( 'sml_sub_webhook_log', array() );
	$types = array_column( $log, 'result' );
	$ok( in_array( 'active', $types, true ) && in_array( 'refunded', $types, true ) && ! in_array( 'ignored:not-ours', $types, true ), 'the event log keeps handled events and skips ignored ones (' . count( $log ) . ' entries)' );
} catch ( Throwable $e ) { echo 'ERROR ' . $e->getMessage() . ' @' . $e->getLine() . "\n"; $bad++; }
$wpdb->query( 'ROLLBACK' );
/* The object cache is NOT transactional: options written inside the transaction leave phantom cache
   entries after the rollback (delete_option no-ops on a row that is not in the DB), so clear them. */
$wpdb->delete( $wpdb->options, array( 'option_name' => 'sml_sub_webhook_log' ) );
wp_cache_delete( 'sml_sub_webhook_log', 'options' ); wp_cache_delete( 'notoptions', 'options' ); wp_cache_delete( 'alloptions', 'options' );
$ok( 0 === (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t" ), 'rolled back: no subdomains left' );
$ok( $real_before === md5( (string) $wpdb->get_var( "SELECT option_value FROM {$wpdb->options} WHERE option_name = 'sml_sub_webhook_secret'" ) ), 'the real signing secret is untouched' );
$ok( false === get_option( 'sml_sub_webhook_log', false ), 'no phantom log entry left in the cache' );
echo $bad ? "FAILURES $bad\n" : "ALL PASS\n";
