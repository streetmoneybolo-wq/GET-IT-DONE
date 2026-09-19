<?php
/* Staged end-to-end test of paid subdomains with Stripe stubbed; everything rolled back. */
global $wpdb; $U = 258456581; $O = 258456545; $bad = 0; $t = sml_sub_t();
$ok = function ( $c, $l ) use ( &$bad ) { echo ( $c ? 'PASS ' : 'FAIL ' ) . $l . "\n"; if ( ! $c ) { $bad++; } };
/* fake Stripe: sessions keyed by id; tests flip them to paid/expired */
$GLOBALS['fake'] = array( 'sessions' => array(), 'refunds' => array(), 'n' => 0, 'creates' => array() );
add_filter( 'sml_sub_stripe_pre', function ( $pre, $method, $path, $body ) {
	$f = &$GLOBALS['fake'];
	if ( 'POST' === $method && '/v1/checkout/sessions' === $path ) {
		$id = 'cs_test_' . ( ++$f['n'] );
		$f['creates'][] = $body;
		$f['sessions'][ $id ] = array( 'id' => $id, 'url' => 'https://checkout.stripe.com/c/pay/' . $id, 'status' => 'open', 'payment_status' => 'unpaid', 'amount_total' => $body['line_items'][0]['price_data']['unit_amount'], 'currency' => 'usd', 'metadata' => $body['metadata'], 'payment_intent' => null );
		return $f['sessions'][ $id ];
	}
	if ( 'GET' === $method && 0 === strpos( $path, '/v1/checkout/sessions/' ) ) {
		$id = rawurldecode( substr( $path, strlen( '/v1/checkout/sessions/' ) ) );
		return $f['sessions'][ $id ] ?? new WP_Error( 'x', 'No such session' );
	}
	if ( 'POST' === $method && '/v1/refunds' === $path ) { $f['refunds'][] = $body['payment_intent']; return array( 'id' => 're_' . count( $f['refunds'] ), 'status' => 'succeeded' ); }
	return new WP_Error( 'x', 'unexpected ' . $method . ' ' . $path );
}, 10, 4 );
$pay = function ( $sid ) { $GLOBALS['fake']['sessions'][ $sid ]['status'] = 'complete'; $GLOBALS['fake']['sessions'][ $sid ]['payment_status'] = 'paid'; $GLOBALS['fake']['sessions'][ $sid ]['payment_intent'] = 'pi_' . $sid; };
$sid_of = function ( $r ) { return is_array( $r ) ? basename( $r['url'] ) : ''; };

$wpdb->query( 'START TRANSACTION' );
try {
	/* 1. checkout opens a hold + a $9.99 session */
	$r = sml_sub_start_checkout( $U, 'profile', $U, 'Ben-Test1' );
	$s1 = $sid_of( $r );
	$row = $wpdb->get_row( "SELECT * FROM $t WHERE name = 'ben-test1'", ARRAY_A );
	$c = $GLOBALS['fake']['creates'][0] ?? array();
	$ok( is_array( $r ) && $row && 'hold' === $row['status'] && $row['session_id'] === $s1, 'checkout: name held (lowercased), session attached' );
	$ok( 999 === (int) $c['line_items'][0]['price_data']['unit_amount'] && 'usd' === $c['line_items'][0]['price_data']['currency'] && 'payment' === $c['mode'] && (int) $c['metadata']['sml_sub_id'] === (int) $row['id'], 'Stripe session: one-time $9.99 USD with our hold id' );
	/* 2. nobody else can take it meanwhile */
	list( $avail ) = sml_sub_check( 'ben-test1', $O );
	$ok( ! $avail && is_wp_error( sml_sub_start_checkout( $O, 'profile', $O, 'ben-test1' ) ), 'another member cannot buy a held name' );
	/* 3. unpaid = pending */
	$ok( 'pending' === sml_sub_settle_session( $s1 ), 'unpaid checkout stays pending' );
	$ok( '' === sml_sub_resolve( 'ben-test1' ), 'a held name does not resolve yet' );
	/* 4. paid = active, once */
	$pay( $s1 );
	$ok( 'active' === sml_sub_settle_session( $s1 ) && 'active' === sml_sub_settle_session( $s1 ), 'paid checkout activates; settling again is harmless' );
	$row = $wpdb->get_row( "SELECT * FROM $t WHERE name = 'ben-test1'", ARRAY_A );
	$ok( 'active' === $row['status'] && 'pi_' . $s1 === $row['payment_intent'] && 999 === (int) $row['amount_cents'], 'stored as active with the payment intent and amount' );
	$ok( home_url( '/ben/' ) === sml_sub_resolve( 'ben-test1' ) && home_url( '/ben/' ) === sml_sub_resolve( 'BEN-TEST1' ), 'ben-test1.stockmarketloop.com resolves to the profile' );
	/* 5. permanent: no second subdomain for the same page, name cannot be reused */
	$e = sml_sub_start_checkout( $U, 'profile', $U, 'ben-test2' );
	$ok( is_wp_error( $e ) && 'sml_sub_done' === $e->get_error_code(), 'page already has its permanent subdomain -> refused' );
	list( $avail, $why ) = sml_sub_check( 'ben-test1', $U );
	$ok( ! $avail, 'an active name is taken for everyone (' . $why . ')' );
	/* 6. groups: owner only */
	$e = sml_sub_start_checkout( $O, 'group', 7, 'mem-test' );
	$ok( is_wp_error( $e ) && 'sml_sub_owner' === $e->get_error_code(), 'non-owner cannot buy a subdomain for a group' );
	$r = sml_sub_start_checkout( $U, 'group', 7, 'mem-test' );
	$ok( is_array( $r ), 'the group owner can' );
	/* 7. switching names: old hold released; paying the abandoned old session is refunded */
	$sA = $sid_of( sml_sub_start_checkout( $U, 'channel', $U, 'chan-a' ) );
	$sB = $sid_of( sml_sub_start_checkout( $U, 'channel', $U, 'chan-b' ) );
	$ok( ! $wpdb->get_var( "SELECT COUNT(*) FROM $t WHERE name = 'chan-a'" ), 'picking a different name releases the earlier hold for that page' );
	$pay( $sA );
	$ok( 'refunded' === sml_sub_settle_session( $sA ) && in_array( 'pi_' . $sA, $GLOBALS['fake']['refunds'], true ), 'paying the abandoned checkout is refunded automatically' );
	$pay( $sB );
	$ok( 'active' === sml_sub_settle_session( $sB ) && home_url( '/channel/making_easy_money/' ) === sml_sub_resolve( 'chan-b' ), 'the current checkout activates -> Loop Channel' );
	/* 8. a paid session for a page that already has one is refunded (e.g. two tabs) */
	$wpdb->insert( $t, array( 'name' => 'chan-c', 'surface' => 'channel', 'object_id' => $U, 'user_id' => $U, 'status' => 'hold', 'hold_until' => gmdate( 'Y-m-d H:i:s', time() + 600 ), 'created_at' => sml_sub_now() ) );
	$hid = (int) $wpdb->insert_id;
	$GLOBALS['fake']['sessions']['cs_twotabs'] = array( 'id' => 'cs_twotabs', 'status' => 'complete', 'payment_status' => 'paid', 'amount_total' => 999, 'currency' => 'usd', 'metadata' => array( 'sml_sub_id' => $hid ), 'payment_intent' => 'pi_twotabs' );
	$wpdb->update( $t, array( 'session_id' => 'cs_twotabs' ), array( 'id' => $hid ) );
	$ok( 'refunded' === sml_sub_settle_session( 'cs_twotabs' ) && ! $wpdb->get_var( "SELECT COUNT(*) FROM $t WHERE name = 'chan-c'" ), 'second paid subdomain for the same page -> refunded, name released' );
	/* 9. expired unpaid checkout releases the name */
	$sL = $sid_of( sml_sub_start_checkout( $U, 'letters', $U, 'letters-x' ) );
	$GLOBALS['fake']['sessions'][ $sL ]['status'] = 'expired';
	$ok( 'released' === sml_sub_settle_session( $sL ) && ! $wpdb->get_var( "SELECT COUNT(*) FROM $t WHERE name = 'letters-x'" ), 'expired checkout -> name released' );
	/* 10. wrong amount is never trusted */
	$sW = $sid_of( sml_sub_start_checkout( $U, 'letters', $U, 'letters-y' ) );
	$pay( $sW ); $GLOBALS['fake']['sessions'][ $sW ]['amount_total'] = 100;
	$ok( is_wp_error( sml_sub_settle_session( $sW ) ) && '' === sml_sub_resolve( 'letters-y' ), 'a session with the wrong amount does not activate' );
	/* 11. buyer never comes back: the cron finishes the job */
	$GLOBALS['fake']['sessions'][ $sW ]['amount_total'] = 999;
	$wpdb->query( $wpdb->prepare( "UPDATE $t SET hold_until = %s, created_at = %s WHERE session_id = %s", gmdate( 'Y-m-d H:i:s', time() - 120 ), gmdate( 'Y-m-d H:i:s', time() - 3600 ), $sW ) );
	sml_sub_reconcile();
	$ok( home_url( '/n/vaughn-mcnair/' ) === sml_sub_resolve( 'letters-y' ), 'reconcile cron activates a paid checkout whose buyer never returned -> Loop Letters' );
	/* 12. REST: confirm is owner-only, checkout requires the permanence confirmation */
	wp_set_current_user( $O );
	$q = new WP_REST_Request( 'POST', '/sml-sub/v1/confirm' ); $q->set_param( 'session_id', $s1 );
	$ok( 404 === rest_do_request( $q )->get_status(), "someone else cannot confirm another member's checkout" );
	wp_set_current_user( $U );
	$q = new WP_REST_Request( 'POST', '/sml-sub/v1/checkout' ); $q->set_header( 'content-type', 'application/json' ); $q->set_body( wp_json_encode( array( 'surface' => 'group', 'object_id' => 7, 'name' => 'grp-z' ) ) );
	$ok( 400 === rest_do_request( $q )->get_status(), 'checkout without "I understand it is permanent" is refused' );
	$q = new WP_REST_Request( 'GET', '/sml-sub/v1/resolve' ); $q->set_param( 'name', 'chan-b' ); $res = rest_do_request( $q );
	$ok( 200 === $res->get_status() && home_url( '/channel/making_easy_money/' ) === $res->get_data()['target'], 'public resolve endpoint' );
	$q = new WP_REST_Request( 'GET', '/sml-sub/v1/mine' ); $d = rest_do_request( $q )->get_data();
	$states = array(); foreach ( $d['pages'] as $p ) { $states[ $p['surface'] . $p['object_id'] ] = $p['subdomain']['status'] ?? 'none'; }
	$ok( 'active' === $states[ 'profile' . $U ] && 'active' === $states[ 'channel' . $U ] && 'active' === $states[ 'letters' . $U ] && 'hold' === $states['group7'] && true === $d['payments'], '/mine shows each page state (' . wp_json_encode( $states ) . ')' );
	list( $avail ) = sml_sub_check( 'fuckstocks', $U );
	$ok( ! $avail, 'offensive names blocked' );
} catch ( Throwable $e ) { echo 'ERROR ' . $e->getMessage() . ' @' . $e->getLine() . "\n"; $bad++; }
$wpdb->query( 'ROLLBACK' ); wp_set_current_user( 0 ); wp_cache_delete( $U, 'user_meta' );
$ok( 0 === (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t" ), 'rolled back: no subdomains exist' );
echo $bad ? "FAILURES $bad\n" : "ALL PASS\n";
