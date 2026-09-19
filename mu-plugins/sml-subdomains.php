<?php
/**
 * Plugin Name: SML Creator Subdomains
 * Description: Paid vanity subdomains. A creator picks name.stockmarketloop.com for their Loop Channel, their Loop Letters homepage, their profile and each group they own; each costs $9.99 once (Stripe Checkout) and is permanent. Visiting the subdomain opens that page. Cloudflare sends every *.stockmarketloop.com request to /sub/{name}/ on this site, which resolves it. 2026-09-19.
 * Version: 1.0.2
 * Author: StockMarketLoop
 *
 * OWNER RULES (2026-09-19): one subdomain per page, picked once, permanent; paid per subdomain
 * ($9.99, real money via Stripe); groups only by their owner; opening the subdomain opens the page.
 *
 * HOW A NAME STAYS HONEST
 *  - A name is held for 30 minutes while its buyer is in Stripe Checkout; nobody else can start
 *    buying it during that time. Paid holds become permanent; unpaid ones are released.
 *  - A payment is only trusted after the Checkout Session is read back from Stripe (paid, $9.99
 *    USD, and our own hold id in its metadata). If a paid session cannot be honoured (the page
 *    already got a subdomain, or the hold was lost), the payment is refunded automatically.
 *  - A name that is someone else's profile handle, channel handle, publication handle or group
 *    slug can only be claimed by that owner (no impersonation).
 *  - Stripe calls carry idempotency keys; activation is a single conditional UPDATE, so a
 *    retry, a second tab or the reconcile cron can never activate or charge twice.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

const SML_SUB_VERSION  = '1.0.2';
const SML_SUB_DB       = 1;
const SML_SUB_PRICE    = 999;        /* cents, USD */
const SML_SUB_HOLD_MIN = 31;         /* Stripe Checkout sessions last at least 30 minutes */
const SML_SUB_BASE     = 'stockmarketloop.com';

function sml_sub_t() { global $wpdb; return $wpdb->prefix . 'sml_subdomains'; }

function sml_sub_install() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta( 'CREATE TABLE ' . sml_sub_t() . " (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		name varchar(40) NOT NULL,
		surface varchar(12) NOT NULL,
		object_id bigint(20) unsigned NOT NULL,
		user_id bigint(20) unsigned NOT NULL,
		status varchar(10) NOT NULL DEFAULT 'hold',
		session_id varchar(255) NOT NULL DEFAULT '',
		checkout_url text NULL,
		payment_intent varchar(255) NOT NULL DEFAULT '',
		amount_cents int(11) NOT NULL DEFAULT 0,
		hold_until datetime NULL,
		note varchar(255) NOT NULL DEFAULT '',
		created_at datetime NOT NULL,
		activated_at datetime NULL,
		PRIMARY KEY  (id),
		UNIQUE KEY name (name),
		KEY page (surface, object_id, status),
		KEY user_status (user_id, status),
		KEY status_hold (status, hold_until)
	) " . $wpdb->get_charset_collate() . ';' );
	update_option( 'sml_sub_db', SML_SUB_DB, false );
}
add_action( 'init', function () { if ( (int) get_option( 'sml_sub_db' ) < SML_SUB_DB ) { sml_sub_install(); } }, 5 );

function sml_sub_now() { return gmdate( 'Y-m-d H:i:s' ); }

/* ------------------------------------------------------------------ pages */

function sml_sub_surfaces() {
	return array(
		'channel' => 'Loop Channel',
		'letters' => 'Loop Letters homepage',
		'profile' => 'Profile page',
		'group'   => 'Group',
	);
}

/** Where a page lives right now (resolved at visit time, so a renamed handle keeps working). '' = the page does not exist. */
function sml_sub_target( $surface, $object_id ) {
	global $wpdb;
	$object_id = (int) $object_id;
	switch ( $surface ) {
		case 'channel':
			$h = function_exists( 'sml_channel_handle_for_user' ) ? (string) sml_channel_handle_for_user( $object_id ) : (string) get_user_meta( $object_id, 'sml_channel_handle', true );
			return '' !== $h ? home_url( '/channel/' . rawurlencode( $h ) . '/' ) : '';
		case 'letters':
			$h = (string) get_user_meta( $object_id, 'smll_handle', true );
			return '' !== $h ? home_url( '/n/' . rawurlencode( $h ) . '/' ) : '';
		case 'profile':
			$h = (string) get_user_meta( $object_id, 'sml_public_handle', true );
			if ( '' === $h ) { $u = get_userdata( $object_id ); $h = $u ? (string) $u->user_nicename : ''; }
			return '' !== $h ? home_url( '/' . rawurlencode( $h ) . '/' ) : '';
		case 'group':
			$slug = (string) $wpdb->get_var( $wpdb->prepare( "SELECT slug FROM {$wpdb->prefix}sml_groups WHERE id = %d", $object_id ) );
			return '' !== $slug ? home_url( '/groups/' . rawurlencode( $slug ) . '/' ) : '';
	}
	return '';
}

/** May this user buy a subdomain for this page? Groups: owner only. Others: their own. */
function sml_sub_can_own( $user_id, $surface, $object_id ) {
	global $wpdb;
	$user_id = (int) $user_id; $object_id = (int) $object_id;
	if ( ! $user_id || ! isset( sml_sub_surfaces()[ $surface ] ) ) { return false; }
	if ( 'group' === $surface ) {
		return $user_id === (int) $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$wpdb->prefix}sml_groups WHERE id = %d", $object_id ) );
	}
	return $object_id === $user_id;
}

/** The pages this user can put a subdomain on, each with its state. */
function sml_sub_pages_for( $user_id ) {
	global $wpdb;
	$user_id = (int) $user_id;
	$pages   = array();
	foreach ( array( 'channel', 'letters', 'profile' ) as $s ) {
		$pages[] = array( 'surface' => $s, 'object_id' => $user_id, 'label' => sml_sub_surfaces()[ $s ], 'name_hint' => '', 'target' => sml_sub_target( $s, $user_id ) );
	}
	foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT id, name, slug FROM {$wpdb->prefix}sml_groups WHERE owner_id = %d ORDER BY id", $user_id ), ARRAY_A ) as $g ) {
		$pages[] = array( 'surface' => 'group', 'object_id' => (int) $g['id'], 'label' => 'Group · ' . $g['name'], 'name_hint' => (string) $g['slug'], 'target' => sml_sub_target( 'group', (int) $g['id'] ) );
	}
	$t = sml_sub_t();
	foreach ( $pages as &$p ) {
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE surface = %s AND object_id = %d AND ( status = 'active' OR ( status = 'hold' AND hold_until > %s ) ) ORDER BY status = 'active' DESC, id DESC LIMIT 1", $p['surface'], $p['object_id'], sml_sub_now() ), ARRAY_A );
		$p['subdomain'] = $row ? array(
			'name' => $row['name'], 'host' => $row['name'] . '.' . SML_SUB_BASE, 'status' => $row['status'],
			'activated_at' => $row['activated_at'] ? mysql_to_rfc3339( $row['activated_at'] ) : '',
			'hold_until' => $row['hold_until'] ? mysql_to_rfc3339( $row['hold_until'] ) : '',
			'mine' => (int) $row['user_id'] === $user_id,
			'resume' => 'hold' === $row['status'] && (int) $row['user_id'] === $user_id ? (string) $row['checkout_url'] : '',
		) : null;
		if ( '' === $p['target'] ) {
			$p['unavailable'] = 'letters' === $p['surface'] ? 'Set up your Loop Letters publication first.' : ( 'channel' === $p['surface'] ? 'Create your Loop Channel first.' : 'This page is not set up yet.' );
		}
	}
	unset( $p );
	return $pages;
}

/* ------------------------------------------------------------------ names */

function sml_sub_reserved() {
	return array_flip( array(
		'www', 'www1', 'www2', 'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'ns', 'ns1', 'ns2', 'dns', 'ftp', 'sftp', 'ssh', 'vpn',
		'live', 'cdn', 'static', 'assets', 'img', 'images', 'media', 'files', 'upload', 'uploads', 'video', 'videos', 'stream', 'streams', 'rtmp', 'hls',
		'api', 'app', 'apps', 'admin', 'administrator', 'root', 'dashboard', 'studio', 'creator', 'creators', 'login', 'logout', 'signin', 'signup', 'register', 'account', 'accounts', 'auth', 'oauth', 'sso', 'secure', 'security',
		'pay', 'payment', 'payments', 'billing', 'checkout', 'invoice', 'invoices', 'wallet', 'bank', 'stripe', 'paypal', 'cashapp', 'venmo',
		'help', 'support', 'status', 'docs', 'doc', 'blog', 'news', 'press', 'about', 'contact', 'legal', 'terms', 'privacy', 'policy', 'abuse', 'report', 'trust', 'safety',
		'dev', 'develop', 'staging', 'stage', 'test', 'testing', 'demo', 'beta', 'alpha', 'preview', 'sandbox', 'local', 'localhost', 'internal', 'm', 'mobile', 'wap',
		'official', 'staff', 'team', 'mod', 'mods', 'moderator', 'moderators', 'owner', 'system', 'bot', 'bots', 'sml', 'smloop', 'stockmarketloop', 'stockmarket', 'loop', 'loops',
		'groups', 'group', 'channel', 'channels', 'letters', 'letter', 'profile', 'profiles', 'watch', 'shorts', 'q', 'qa', 'meet', 'market', 'markets', 'monitor', 'tradingfloor',
		'loopkick', 'loop-kick', 'kick', 'loopbucks', 'loop-bucks', 'distribute', 'sub', 'subdomain', 'subdomains', 'google', 'apple', 'microsoft', 'facebook', 'meta', 'youtube', 'twitter', 'discord', 'tiktok', 'moomoo', 'robinhood',
	) );
}

function sml_sub_offensive( $name ) {
	return (bool) preg_match( '/(fuck|shit|cunt|nigg|fagg|kike|spic|chink|rape|porn|nazi|hitler|cock|pussy|whore|slut|bitch|retard)/', str_replace( '-', '', $name ) );
}

function sml_sub_clean( $raw ) { return strtolower( trim( (string) $raw ) ); }

/** Whose name is this already? Returns list of user ids that own this word somewhere on the site. */
function sml_sub_name_owners( $name ) {
	global $wpdb;
	$owners = array();
	/* profile handle, Loop Letters publication handle, Loop Channel handle (underscores read as hyphens in DNS) */
	foreach ( (array) $wpdb->get_col( $wpdb->prepare( "SELECT user_id FROM {$wpdb->usermeta} WHERE meta_key IN ('sml_public_handle', 'smll_handle', 'sml_channel_handle') AND REPLACE(LOWER(meta_value), '_', '-') = %s", $name ) ) as $u ) { $owners[] = (int) $u; }
	foreach ( (array) $wpdb->get_col( $wpdb->prepare( "SELECT ID FROM {$wpdb->users} WHERE REPLACE(LOWER(user_nicename), '_', '-') = %s", $name ) ) as $u ) { $owners[] = (int) $u; }
	foreach ( (array) $wpdb->get_col( $wpdb->prepare( "SELECT owner_id FROM {$wpdb->prefix}sml_groups WHERE REPLACE(LOWER(slug), '_', '-') = %s", $name ) ) as $o ) { $owners[] = (int) $o; }
	return array_values( array_unique( array_filter( $owners ) ) );
}

/** Is this name valid and free for this user? Returns array( ok, reason ). */
function sml_sub_check( $raw, $user_id = 0 ) {
	global $wpdb;
	$name = sml_sub_clean( $raw );
	if ( ! preg_match( '/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/', $name ) ) {
		return array( false, 'Use 3–30 letters, numbers or hyphens, starting and ending with a letter or number.', $name );
	}
	if ( false !== strpos( $name, '--' ) ) { return array( false, 'Two hyphens in a row are not allowed.', $name ); }
	if ( isset( sml_sub_reserved()[ $name ] ) ) { return array( false, 'That name is reserved.', $name ); }
	if ( sml_sub_offensive( $name ) ) { return array( false, 'That name is not allowed.', $name ); }
	$owners = sml_sub_name_owners( $name );
	if ( $owners && ! in_array( (int) $user_id, $owners, true ) ) {
		return array( false, 'That name belongs to another member’s profile, channel, publication or group.', $name );
	}
	$row = $wpdb->get_row( $wpdb->prepare( 'SELECT status, hold_until, user_id FROM ' . sml_sub_t() . ' WHERE name = %s', $name ), ARRAY_A );
	if ( $row ) {
		if ( 'active' === $row['status'] || 'revoked' === $row['status'] ) { return array( false, 'That subdomain is taken.', $name ); }
		if ( 'hold' === $row['status'] && $row['hold_until'] > sml_sub_now() && (int) $row['user_id'] !== (int) $user_id ) {
			return array( false, 'Someone is checking out with that name right now. Try another, or check back in 30 minutes.', $name );
		}
	}
	return array( true, 'Available', $name );
}

/* ------------------------------------------------------------------ Stripe */

function sml_sub_stripe_key() {
	if ( defined( 'SML_STRIPE_SECRET_KEY' ) && SML_STRIPE_SECRET_KEY ) { return (string) SML_STRIPE_SECRET_KEY; }
	return (string) get_option( 'sml_stripe_secret_key', '' );
}

/** Minimal Stripe client with idempotency keys. Filter sml_sub_stripe_pre lets tests stub Stripe. */
function sml_sub_stripe( $method, $path, $body = array(), $idem = '' ) {
	$pre = apply_filters( 'sml_sub_stripe_pre', null, $method, $path, $body );
	if ( null !== $pre ) { return $pre; }
	$key = sml_sub_stripe_key();
	if ( '' === $key ) { return new WP_Error( 'sml_sub_stripe_off', 'Payments are not configured yet.', array( 'status' => 503 ) ); }
	$headers = array( 'Authorization' => 'Bearer ' . $key, 'Stripe-Version' => '2024-06-20' );
	if ( $idem ) { $headers['Idempotency-Key'] = $idem; }
	$args = array( 'method' => $method, 'timeout' => 20, 'headers' => $headers );
	if ( $body ) { $args['body'] = $body; }
	$r = wp_remote_request( 'https://api.stripe.com' . $path, $args );
	if ( is_wp_error( $r ) ) { return new WP_Error( 'sml_sub_stripe_net', 'Could not reach the payment service. Try again.', array( 'status' => 502 ) ); }
	$j = json_decode( (string) wp_remote_retrieve_body( $r ), true );
	if ( ! is_array( $j ) ) { return new WP_Error( 'sml_sub_stripe_bad', 'The payment service returned an unexpected answer.', array( 'status' => 502 ) ); }
	if ( ! empty( $j['error'] ) ) { return new WP_Error( 'sml_sub_stripe', (string) ( $j['error']['message'] ?? 'Payment error.' ), array( 'status' => 402 ) ); }
	return $j;
}

/* ------------------------------------------------------------------ buy */

/** Hold the name and open a Stripe Checkout Session. Returns array( url ) or WP_Error. */
function sml_sub_start_checkout( $user_id, $surface, $object_id, $raw_name ) {
	global $wpdb;
	$user_id = (int) $user_id; $object_id = (int) $object_id; $t = sml_sub_t();
	if ( ! sml_sub_can_own( $user_id, $surface, $object_id ) ) {
		return new WP_Error( 'sml_sub_owner', 'Only the owner of this page can give it a subdomain.', array( 'status' => 403 ) );
	}
	if ( '' === sml_sub_target( $surface, $object_id ) ) {
		return new WP_Error( 'sml_sub_page', 'Set this page up first, then give it a subdomain.', array( 'status' => 409 ) );
	}
	if ( ! $wpdb->get_var( 'SELECT GET_LOCK(' . $wpdb->prepare( '%s', 'sml_sub_' . $surface . '_' . $object_id ) . ', 5)' ) ) {
		return new WP_Error( 'sml_sub_busy', 'Busy, try again in a moment.', array( 'status' => 409 ) );
	}
	try {
		if ( $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t} WHERE surface = %s AND object_id = %d AND status = 'active'", $surface, $object_id ) ) ) {
			return new WP_Error( 'sml_sub_done', 'This page already has its permanent subdomain.', array( 'status' => 409 ) );
		}
		list( $ok, $why, $name ) = sml_sub_check( $raw_name, $user_id );
		if ( ! $ok ) { return new WP_Error( 'sml_sub_name', $why, array( 'status' => 409 ) ); }
		/* one open checkout per page: an older hold of mine for this page is released */
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$t} WHERE surface = %s AND object_id = %d AND status = 'hold' AND user_id = %d AND name <> %s", $surface, $object_id, $user_id, $name ) );
		$until = gmdate( 'Y-m-d H:i:s', time() + SML_SUB_HOLD_MIN * MINUTE_IN_SECONDS );
		$row   = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE name = %s", $name ), ARRAY_A );
		if ( $row ) {
			/* reuse my own hold, or take over an expired one; never someone else's live hold */
			$n = $wpdb->query( $wpdb->prepare(
				"UPDATE {$t} SET surface = %s, object_id = %d, user_id = %d, hold_until = %s, session_id = '', checkout_url = NULL, note = '' WHERE id = %d AND status = 'hold' AND ( user_id = %d OR hold_until <= %s )",
				$surface, $object_id, $user_id, $until, (int) $row['id'], $user_id, sml_sub_now()
			) );
			if ( ! $n ) { return new WP_Error( 'sml_sub_name', 'Someone is checking out with that name right now.', array( 'status' => 409 ) ); }
			$id = (int) $row['id'];
		} else {
			$n = $wpdb->insert( $t, array( 'name' => $name, 'surface' => $surface, 'object_id' => $object_id, 'user_id' => $user_id, 'status' => 'hold', 'hold_until' => $until, 'created_at' => sml_sub_now() ) );
			if ( ! $n ) { return new WP_Error( 'sml_sub_name', 'That subdomain was just taken.', array( 'status' => 409 ) ); }
			$id = (int) $wpdb->insert_id;
		}
	} finally {
		$wpdb->query( 'SELECT RELEASE_LOCK(' . $wpdb->prepare( '%s', 'sml_sub_' . $surface . '_' . $object_id ) . ')' );
	}

	$user = get_userdata( $user_id );
	$back = home_url( '/creator-studio/subdomains/' );
	$sess = sml_sub_stripe( 'POST', '/v1/checkout/sessions', array(
		'mode'                 => 'payment',
		'client_reference_id'  => 'sml_sub_' . $id,
		'customer_email'       => $user ? $user->user_email : null,
		'line_items'           => array( array(
			'quantity'   => 1,
			'price_data' => array(
				'currency'     => 'usd',
				'unit_amount'  => SML_SUB_PRICE,
				'product_data' => array(
					'name'        => $name . '.' . SML_SUB_BASE,
					'description' => 'Permanent StockMarketLoop subdomain for your ' . sml_sub_surfaces()[ $surface ] . ' (one-time).',
				),
			),
		) ),
		'metadata'             => array( 'sml_sub_id' => $id, 'name' => $name, 'surface' => $surface, 'object_id' => $object_id, 'user_id' => $user_id ),
		'payment_intent_data'  => array( 'metadata' => array( 'sml_sub_id' => $id, 'name' => $name ), 'description' => $name . '.' . SML_SUB_BASE . ' subdomain' ),
		'success_url'          => $back . '?paid={CHECKOUT_SESSION_ID}',
		'cancel_url'           => $back . '?cancelled=' . rawurlencode( $name ),
		'expires_at'           => time() + ( SML_SUB_HOLD_MIN - 1 ) * MINUTE_IN_SECONDS,
		'custom_text'          => array( 'submit' => array( 'message' => 'Permanent and non-refundable: ' . $name . '.' . SML_SUB_BASE . ' stays locked to your ' . sml_sub_surfaces()[ $surface ] . '. See Section 17 of our Terms: ' . home_url( '/terms/' ) ) ),
	), 'sml-sub-' . $id . '-' . md5( $until ) );
	if ( is_wp_error( $sess ) ) {
		$wpdb->delete( $t, array( 'id' => $id, 'status' => 'hold', 'session_id' => '' ) );
		return $sess;
	}
	$wpdb->update( $t, array( 'session_id' => (string) $sess['id'], 'checkout_url' => (string) $sess['url'] ), array( 'id' => $id ) );
	return array( 'url' => (string) $sess['url'], 'name' => $name, 'hold_until' => mysql_to_rfc3339( $until ) );
}

/**
 * Read a Checkout Session back from Stripe and settle its hold. Safe to call any number of times
 * (return page, second tab, reconcile cron): activation is one conditional UPDATE.
 * Returns 'active' | 'pending' | 'released' | 'refunded' | WP_Error.
 */
function sml_sub_settle_session( $session_id ) {
	global $wpdb;
	$t   = sml_sub_t();
	$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t} WHERE session_id = %s", (string) $session_id ), ARRAY_A );
	$s   = sml_sub_stripe( 'GET', '/v1/checkout/sessions/' . rawurlencode( (string) $session_id ) );
	if ( is_wp_error( $s ) ) { return $s; }
	$meta_id = (int) ( $s['metadata']['sml_sub_id'] ?? 0 );
	$paid    = 'paid' === ( $s['payment_status'] ?? '' ) && 'complete' === ( $s['status'] ?? '' );
	$right   = SML_SUB_PRICE === (int) ( $s['amount_total'] ?? 0 ) && 'usd' === strtolower( (string) ( $s['currency'] ?? '' ) );
	$pi      = (string) ( is_array( $s['payment_intent'] ?? null ) ? ( $s['payment_intent']['id'] ?? '' ) : ( $s['payment_intent'] ?? '' ) );

	if ( ! $paid ) {
		if ( 'expired' === ( $s['status'] ?? '' ) && $row && 'hold' === $row['status'] ) {
			$wpdb->delete( $t, array( 'id' => (int) $row['id'], 'status' => 'hold' ) );
			return 'released';
		}
		return 'pending';
	}
	if ( ! $right || ! $meta_id ) { return new WP_Error( 'sml_sub_mismatch', 'That payment does not match a subdomain purchase.', array( 'status' => 409 ) ); }
	if ( $row && 'active' === $row['status'] && $row['session_id'] === (string) $session_id ) { return 'active'; }

	/* activate only the hold this session was opened for, and only if the page has no subdomain yet */
	$ok = false;
	if ( $row && (int) $row['id'] === $meta_id && 'hold' === $row['status'] ) {
		$taken = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t} WHERE surface = %s AND object_id = %d AND status = 'active'", $row['surface'], (int) $row['object_id'] ) );
		if ( ! $taken ) {
			$ok = (bool) $wpdb->query( $wpdb->prepare(
				"UPDATE {$t} SET status = 'active', activated_at = %s, payment_intent = %s, amount_cents = %d, hold_until = NULL, checkout_url = NULL WHERE id = %d AND status = 'hold' AND session_id = %s",
				sml_sub_now(), $pi, SML_SUB_PRICE, $meta_id, (string) $session_id
			) );
		}
	}
	if ( $ok ) {
		do_action( 'sml_subdomain_activated', $meta_id, $row );
		if ( function_exists( 'sml_members_add_notification' ) ) {
			sml_members_add_notification( (int) $row['user_id'], 'subdomain', $row['name'] . '.' . SML_SUB_BASE . ' is live and points to your ' . sml_sub_surfaces()[ $row['surface'] ] . '.', 'https://' . $row['name'] . '.' . SML_SUB_BASE . '/', 0 );
		}
		return 'active';
	}
	/* paid but cannot be honoured: give the money back once (idempotent on the session) */
	if ( '' !== $pi ) {
		$ref = sml_sub_stripe( 'POST', '/v1/refunds', array( 'payment_intent' => $pi, 'metadata' => array( 'sml_sub_id' => $meta_id, 'reason' => 'subdomain_unavailable' ) ), 'sml-sub-refund-' . $session_id );
		if ( is_wp_error( $ref ) && false === stripos( $ref->get_error_message(), 'already been refunded' ) ) { return $ref; }
		if ( $row && 'hold' === $row['status'] && (int) $row['id'] === $meta_id ) {
			$wpdb->update( $t, array( 'note' => 'refunded: page already has a subdomain' ), array( 'id' => $meta_id ) );
			$wpdb->delete( $t, array( 'id' => $meta_id, 'status' => 'hold' ) );
		}
		return 'refunded';
	}
	return new WP_Error( 'sml_sub_settle', 'The payment could not be matched. Contact support.', array( 'status' => 409 ) );
}

/* Holds whose buyers never came back: ask Stripe, activate the paid ones, release the rest. */
function sml_sub_reconcile() {
	global $wpdb;
	$t = sml_sub_t();
	foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT id, session_id, hold_until FROM {$t} WHERE status = 'hold' AND ( hold_until <= %s OR created_at <= %s ) LIMIT 50", gmdate( 'Y-m-d H:i:s', time() - 60 ), gmdate( 'Y-m-d H:i:s', time() - 10 * MINUTE_IN_SECONDS ) ), ARRAY_A ) as $h ) {
		if ( '' === $h['session_id'] ) {
			if ( $h['hold_until'] <= sml_sub_now() ) { $wpdb->delete( $t, array( 'id' => (int) $h['id'], 'status' => 'hold' ) ); }
			continue;
		}
		sml_sub_settle_session( $h['session_id'] );
	}
}
add_filter( 'cron_schedules', function ( $s ) { $s['sml_sub_10min'] = array( 'interval' => 600, 'display' => 'Every 10 minutes (subdomains)' ); return $s; } );
add_action( 'init', function () { if ( ! wp_next_scheduled( 'sml_sub_reconcile' ) ) { wp_schedule_event( time() + 300, 'sml_sub_10min', 'sml_sub_reconcile' ); } } );
add_action( 'sml_sub_reconcile', 'sml_sub_reconcile' );

/* ------------------------------------------------------------------ resolve */

function sml_sub_resolve( $name ) {
	global $wpdb;
	$name = sml_sub_clean( $name );
	if ( ! preg_match( '/^[a-z0-9-]{1,40}$/', $name ) ) { return ''; }
	$row = $wpdb->get_row( $wpdb->prepare( "SELECT surface, object_id FROM " . sml_sub_t() . " WHERE name = %s AND status = 'active'", $name ), ARRAY_A );
	return $row ? sml_sub_target( $row['surface'], (int) $row['object_id'] ) : '';
}

/* Cloudflare sends https://NAME.stockmarketloop.com/anything to https://stockmarketloop.com/sub/NAME/ */
add_action( 'template_redirect', function () {
	$path = (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH );
	if ( ! preg_match( '#^/sub/([A-Za-z0-9-]{1,40})/?$#', $path, $m ) ) { return; }
	nocache_headers();
	header( 'X-Robots-Tag: noindex, nofollow' );
	$target = sml_sub_resolve( $m[1] );
	if ( '' === $target ) {
		/* unclaimed or mistyped: visitors land on the homepage (Creator Studio is sign-in only) */
		wp_safe_redirect( home_url( '/' ), 302 );
		exit;
	}
	$q = array_intersect_key( $_GET, array_flip( array( 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref' ) ) );
	wp_safe_redirect( $q ? add_query_arg( array_map( 'sanitize_text_field', wp_unslash( $q ) ), $target ) : $target, 302 );
	exit;
}, -1000 );

/* ------------------------------------------------------------------ REST */

add_action( 'rest_api_init', function () {
	$ns = 'sml-sub/v1';
	register_rest_route( $ns, '/mine', array( 'methods' => 'GET', 'permission_callback' => 'is_user_logged_in', 'callback' => function () {
		$res = rest_ensure_response( array( 'pages' => sml_sub_pages_for( get_current_user_id() ), 'price' => SML_SUB_PRICE, 'currency' => 'usd', 'base' => SML_SUB_BASE, 'payments' => '' !== sml_sub_stripe_key() ) );
		$res->header( 'Cache-Control', 'no-store' );
		return $res;
	} ) );
	register_rest_route( $ns, '/check', array( 'methods' => 'GET', 'permission_callback' => 'is_user_logged_in', 'callback' => function ( WP_REST_Request $r ) {
		list( $ok, $why, $name ) = sml_sub_check( $r->get_param( 'name' ), get_current_user_id() );
		return array( 'name' => $name, 'available' => $ok, 'reason' => $why, 'host' => $name . '.' . SML_SUB_BASE );
	} ) );
	register_rest_route( $ns, '/checkout', array( 'methods' => 'POST', 'permission_callback' => 'is_user_logged_in', 'callback' => function ( WP_REST_Request $r ) {
		$in = (array) $r->get_json_params() ?: (array) $r->get_body_params();
		if ( empty( $in['confirm_permanent'] ) ) { return new WP_Error( 'sml_sub_confirm', 'Confirm that the name is permanent before paying.', array( 'status' => 400 ) ); }
		return sml_sub_start_checkout( get_current_user_id(), sanitize_key( (string) ( $in['surface'] ?? '' ) ), absint( $in['object_id'] ?? 0 ), (string) ( $in['name'] ?? '' ) );
	} ) );
	register_rest_route( $ns, '/confirm', array( 'methods' => 'POST', 'permission_callback' => 'is_user_logged_in', 'callback' => function ( WP_REST_Request $r ) {
		global $wpdb;
		$sid = preg_replace( '/[^A-Za-z0-9_]/', '', (string) $r->get_param( 'session_id' ) );
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT user_id, name FROM ' . sml_sub_t() . ' WHERE session_id = %s', $sid ), ARRAY_A );
		if ( ! $row || (int) $row['user_id'] !== get_current_user_id() ) { return new WP_Error( 'sml_sub_session', 'That checkout is not yours.', array( 'status' => 404 ) ); }
		$state = sml_sub_settle_session( $sid );
		if ( is_wp_error( $state ) ) { return $state; }
		return array( 'state' => $state, 'name' => $row['name'], 'host' => $row['name'] . '.' . SML_SUB_BASE, 'pages' => sml_sub_pages_for( get_current_user_id() ) );
	} ) );
	register_rest_route( $ns, '/resolve', array( 'methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function ( WP_REST_Request $r ) {
		$target = sml_sub_resolve( (string) $r->get_param( 'name' ) );
		if ( '' === $target ) { return new WP_Error( 'sml_sub_unknown', 'No such subdomain.', array( 'status' => 404 ) ); }
		$res = rest_ensure_response( array( 'target' => $target ) );
		$res->header( 'Cache-Control', 'public, max-age=300' );
		return $res;
	} ) );
} );

/* ------------------------------------------------------------------ Creator Studio page */

/* Add "Subdomains" to the Creator Studio sidebar on every studio page (the sidebar has no filter). */
add_action( 'template_redirect', function () {
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	if ( 0 !== strpos( $path, 'creator-studio' ) || ! is_user_logged_in() ) { return; }
	ob_start( function ( $html ) use ( $path ) {
		if ( ! is_string( $html ) || false === strpos( $html, 'class="cs-nav"' ) || false !== strpos( $html, 'data-sml-sub-nav' ) ) { return $html; }
		$on   = 'creator-studio/subdomains' === $path ? ' class="cs-on"' : '';
		$icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="M3.6 12h16.8M12 3.4c2.4 2.5 3.6 5.4 3.6 8.6s-1.2 6.1-3.6 8.6c-2.4-2.5-3.6-5.4-3.6-8.6S9.6 5.9 12 3.4z"/></svg>';
		$link = '<a href="' . esc_url( home_url( '/creator-studio/subdomains/' ) ) . '"' . $on . ' data-sml-sub-nav>' . $icon . 'Subdomains</a>';
		$pos  = strpos( $html, '</nav><div class="cs-help">' );
		return false === $pos ? $html : substr_replace( $html, $link, $pos, 0 );
	} );
}, -1000 );

function sml_sub_styles() {
	return '.cs-sd{padding:26px;min-width:0;max-width:1080px}.cs-sd h1{margin:0;font-size:28px;letter-spacing:-.6px}.cs-sd-sub{margin:8px 0 18px;color:#8798ac;font-size:14px;max-width:760px;line-height:1.5}'
		. '.cs-sd-rules{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:0 0 20px}.cs-sd-rules div{background:#0b131f;border:1px solid #182130;border-radius:12px;padding:12px 14px;font-size:13px;color:#b9c8d8;line-height:1.45}.cs-sd-rules b{display:block;color:#e6edf5;font-size:15px;margin-bottom:2px}'
		. '.cs-sd-list{display:flex;flex-direction:column;gap:12px}.cs-sd-card{background:#0b131f;border:1px solid #182130;border-radius:14px;padding:16px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center}.cs-sd-card.is-on{border-color:#1f5a3c}'
		. '.cs-sd-kind{font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#8798ac}.cs-sd-card h3{margin:3px 0 4px;font-size:16px}.cs-sd-target{font-size:12.5px;color:#708399;word-break:break-all}.cs-sd-target a{color:#8cc9ff;text-decoration:none}'
		. '.cs-sd-host{font:800 18px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:#38f58a;word-break:break-all}.cs-sd-meta{font-size:12px;color:#8798ac;margin-top:3px}'
		. '.cs-sd-form{grid-column:1/-1;display:flex;flex-direction:column;gap:8px}.cs-sd-field{display:flex;align-items:stretch;border:1px solid #223146;border-radius:11px;background:#08111b;overflow:hidden;max-width:560px}.cs-sd-field:focus-within{border-color:#38f58a}'
		. '.cs-sd-field input{flex:1;min-width:0;border:0;background:transparent;color:#e6edf5;padding:10px 12px;font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace;outline:0}.cs-sd-field span{display:flex;align-items:center;padding:0 12px;color:#708399;font:600 14px ui-monospace,SFMono-Regular,Menlo,monospace;border-left:1px solid #182130;white-space:nowrap}'
		. '.cs-sd-avail{font-size:12.5px;min-height:18px}.cs-sd-avail.ok{color:#38f58a}.cs-sd-avail.no{color:#ff7a8a}.cs-sd-confirm{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:#b9c8d8;max-width:560px}.cs-sd-confirm input{margin-top:2px;accent-color:#38f58a}'
		. '.cs-sd-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border-radius:10px;border:1px solid #223146;background:#0e1826;color:#dbe6f2;font:inherit;font-size:13.5px;font-weight:800;cursor:pointer;text-decoration:none;white-space:nowrap}.cs-sd-btn:hover{border-color:#38f58a}.cs-sd-btn.primary{background:#38f58a;border-color:#38f58a;color:#06120c}.cs-sd-btn[disabled]{opacity:.45;cursor:not-allowed}.cs-sd-btn:focus-visible,.cs-sd-field input:focus-visible{outline:2px solid #38f58a;outline-offset:2px}'
		. '.cs-sd-acts{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.cs-sd-note{font-size:12.5px;color:#a9b8c8}.cs-sd-note.err{color:#ff7a8a}.cs-sd-off{font-size:13px;color:#8798ac}.cs-sd-off a{color:#8cc9ff}'
		. '.cs-sd-banner{border-radius:12px;padding:12px 14px;margin:0 0 16px;font-size:14px;border:1px solid #1f5a3c;background:#0d1d17;color:#c9f5dd}.cs-sd-banner.warn{border-color:#5a4a1f;background:#1d180d;color:#f5e3b0}.cs-sd-banner.err{border-color:#5a1f2a;background:#1d0d12;color:#ffc2cc}'
		. '.cs-sd-empty{padding:30px 12px;text-align:center;color:#708399;font-size:13.5px;border:1px dashed #26384c;border-radius:12px}'
		. '@media(max-width:720px){.cs-sd{padding:16px}.cs-sd-card{grid-template-columns:minmax(0,1fr)}.cs-sd-acts{justify-content:flex-start}.cs-sd-field span{font-size:12px;padding:0 8px}}';
}

function sml_sub_script() {
	return <<<'JS'
(function(){
  'use strict';
  var cfg=window.smlSubConfig||{},root=document.getElementById('cs-subdomains');if(!root)return;
  var list=root.querySelector('[data-sd-list]'),banner=root.querySelector('[data-sd-banner]');var data=null,timers={},checks={};
  function esc(v){var d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML;}
  function price(){return '$'+(cfg.price/100).toFixed(2);}
  function when(iso){var t=Date.parse(iso||'');return isNaN(t)?'':new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});}
  function api(path,opt){opt=opt||{};opt.credentials='same-origin';opt.headers=Object.assign({'X-WP-Nonce':cfg.nonce},opt.body?{'Content-Type':'application/json'}:{});return fetch(cfg.rest+path,opt).then(function(r){return r.json().then(function(j){if(!r.ok||j.code)throw new Error(j.message||'That did not work.');return j;});});}
  function show(kind,html){banner.className='cs-sd-banner'+(kind?' '+kind:'');banner.innerHTML=html;banner.hidden=!html;}
  function key(p){return p.surface+'-'+p.object_id;}
  function card(p){var k=key(p),sd=p.subdomain;
    var head='<div><div class="cs-sd-kind">'+esc(p.label)+'</div>'+(p.target?'<div class="cs-sd-target">Opens <a href="'+esc(p.target)+'" target="_blank" rel="noopener">'+esc(p.target.replace(/^https?:\/\//,''))+'</a></div>':'');
    if(sd&&sd.status==='active'){var url='https://'+sd.host+'/';
      return '<article class="cs-sd-card is-on">'+head+'<div class="cs-sd-host">'+esc(sd.host)+'</div><div class="cs-sd-meta">Permanent · claimed '+esc(when(sd.activated_at))+'</div></div>'
        +'<div class="cs-sd-acts"><a class="cs-sd-btn primary" href="'+esc(url)+'" target="_blank" rel="noopener">Visit ↗</a><button type="button" class="cs-sd-btn" data-copy="'+esc(url)+'">Copy link</button><span class="cs-sd-note" data-copied="'+esc(k)+'"></span></div></article>';}
    if(p.unavailable)return '<article class="cs-sd-card">'+head+'<p class="cs-sd-off">'+esc(p.unavailable)+' '+(p.surface==='letters'?'<a href="/loop-letters/">Open Loop Letters</a>':p.surface==='channel'?'<a href="/creator-studio/">Open Creator Studio</a>':'')+'</p></div></article>';
    if(sd&&sd.status==='hold'&&sd.mine){
      return '<article class="cs-sd-card">'+head+'<div class="cs-sd-host" style="color:#ffcf5c">'+esc(sd.host)+'</div><div class="cs-sd-meta">Held for you until '+esc(new Date(sd.hold_until).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))+' while you pay.</div></div>'
        +'<div class="cs-sd-acts">'+(sd.resume?'<a class="cs-sd-btn primary" href="'+esc(sd.resume)+'">Finish payment</a>':'')+'<button type="button" class="cs-sd-btn" data-other="'+esc(k)+'">Pick a different name</button></div></article>';}
    var v=(checks[k]&&checks[k].name)||p.name_hint||'';
    return '<article class="cs-sd-card">'+head+'</div><div class="cs-sd-acts"><b style="font-size:15px">'+price()+'</b><span class="cs-sd-note">one-time</span></div>'
      +'<form class="cs-sd-form" data-form="'+esc(k)+'"><label class="cs-sd-kind" for="sd-'+esc(k)+'">Choose your subdomain</label><div class="cs-sd-field"><input id="sd-'+esc(k)+'" name="name" value="'+esc(v)+'" maxlength="30" autocomplete="off" spellcheck="false" placeholder="yourname" aria-describedby="sda-'+esc(k)+'"><span>.'+esc(cfg.base)+'</span></div>'
      +'<div class="cs-sd-avail" id="sda-'+esc(k)+'" data-avail="'+esc(k)+'" aria-live="polite"></div>'
      +'<label class="cs-sd-confirm"><input type="checkbox" name="permanent"><span>I understand this subdomain is <b>permanent and non-refundable</b>: it can’t be changed or moved to another page after I pay (<a href="/terms/#paid-subdomains" target="_blank" rel="noopener" style="color:#8cc9ff">Terms, Section 17</a>).</span></label>'
      +'<div><button type="submit" class="cs-sd-btn primary" disabled>Claim for '+price()+'</button> <span class="cs-sd-note" data-msg="'+esc(k)+'"></span></div></form></article>';}
  function paint(){if(!data){list.innerHTML='<div class="cs-sd-empty">Loading your pages…</div>';return;}
    if(!data.payments)show('warn','Payments are being set up — subdomains can’t be claimed right now.');
    list.innerHTML=(data.pages||[]).map(card).join('')||'<div class="cs-sd-empty">No pages yet.</div>';
    Array.prototype.forEach.call(list.querySelectorAll('form[data-form]'),function(f){var i=f.querySelector('input[name=name]');if(i.value)check(f);});}
  function find(k){return (data.pages||[]).filter(function(p){return key(p)===k;})[0];}
  function ready(f){var k=f.getAttribute('data-form'),c=checks[k],i=f.querySelector('input[name=name]');f.querySelector('button[type=submit]').disabled=!(c&&c.available&&c.name===norm(i.value)&&f.querySelector('input[name=permanent]').checked&&data.payments);}
  function norm(v){return String(v||'').trim().toLowerCase();}
  function check(f){var k=f.getAttribute('data-form'),i=f.querySelector('input[name=name]'),out=f.querySelector('[data-avail]'),v=norm(i.value);
    if(i.value!==v)i.value=v;clearTimeout(timers[k]);checks[k]=null;ready(f);
    if(!v){out.textContent='';out.className='cs-sd-avail';return;}
    out.textContent='Checking…';out.className='cs-sd-avail';
    timers[k]=setTimeout(function(){api('check?name='+encodeURIComponent(v)).then(function(j){if(norm(i.value)!==j.name)return;checks[k]=j;
      out.textContent=j.available?'✓ '+j.host+' is available':'✕ '+j.reason;out.className='cs-sd-avail '+(j.available?'ok':'no');ready(f);}).catch(function(e){out.textContent=e.message;out.className='cs-sd-avail no';});},350);}
  list.addEventListener('input',function(e){var f=e.target.closest('form[data-form]');if(!f)return;if(e.target.name==='name')check(f);else ready(f);});
  list.addEventListener('change',function(e){var f=e.target.closest('form[data-form]');if(f)ready(f);});
  list.addEventListener('submit',function(e){var f=e.target.closest('form[data-form]');if(!f)return;e.preventDefault();var k=f.getAttribute('data-form'),p=find(k),b=f.querySelector('button[type=submit]'),msg=f.querySelector('[data-msg]');
    b.disabled=true;msg.className='cs-sd-note';msg.textContent='Opening secure checkout…';
    api('checkout',{method:'POST',body:JSON.stringify({surface:p.surface,object_id:p.object_id,name:norm(f.querySelector('input[name=name]').value),confirm_permanent:true})})
      .then(function(j){location.href=j.url;}).catch(function(err){msg.className='cs-sd-note err';msg.textContent=err.message;b.disabled=false;});});
  list.addEventListener('click',function(e){var c=e.target.closest('[data-copy]');if(c){var u=c.getAttribute('data-copy'),o=c.parentNode.querySelector('[data-copied]');(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){o.textContent='Copied.';}).catch(function(){o.textContent=u;});return;}
    var o2=e.target.closest('[data-other]');if(o2){var p=find(o2.getAttribute('data-other'));if(p){p.subdomain=null;paint();}}});
  function load(){api('mine').then(function(j){data=j;paint();}).catch(function(e){list.innerHTML='<div class="cs-sd-empty">'+esc(e.message)+'</div>';});}
  var qs=new URLSearchParams(location.search),paid=qs.get('paid'),cancelled=qs.get('cancelled'),want=qs.get('name');
  if(paid){show('','Confirming your payment…');
    api('confirm',{method:'POST',body:JSON.stringify({session_id:paid})}).then(function(j){
      if(j.state==='active')show('','🎉 <b>'+esc(j.host)+'</b> is yours for good. It can take a few minutes to start working everywhere.');
      else if(j.state==='refunded')show('err','That page already had a subdomain, so your payment for '+esc(j.host)+' was refunded in full.');
      else if(j.state==='pending')show('warn','Your payment for '+esc(j.host)+' is still processing. This page updates by itself once it clears.');
      else show('warn','That checkout expired without a payment, so '+esc(j.host)+' was released.');
      data=j;paint();try{history.replaceState(null,'',location.pathname)}catch(x){}
    }).catch(function(e){show('err',esc(e.message));load();});}
  else{if(cancelled)show('warn','Checkout cancelled. <b>'+esc(cancelled)+'</b> stays held for you for up to 30 minutes if you want to finish.');
    if(want)show('','<b>'+esc(want)+'.'+esc(cfg.base)+'</b> isn’t claimed yet. If it’s your name, claim it below.');
    load();}
  root.addEventListener('click',function(e){if(e.target.closest('[data-sd-refresh]')){e.preventDefault();data=null;paint();load();}});
})();
JS;
}

function sml_sub_render_page() {
	status_header( 200 ); nocache_headers();
	header( 'Content-Type: text/html; charset=' . get_bloginfo( 'charset' ) );
	$uid = get_current_user_id();
	echo '<!doctype html><html ' . get_language_attributes() . '><head><meta charset="' . esc_attr( get_bloginfo( 'charset' ) ) . '"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Subdomains - Creator Studio - ' . esc_html( get_bloginfo( 'name' ) ) . '</title><style>' . ( function_exists( 'sml_cs_styles' ) ? sml_cs_styles() : '' ) . sml_sub_styles() . '</style></head><body>';
	if ( ! $uid ) {
		echo '<div class="cs-gate"><h1>Sign in to Creator Studio</h1><p>Sign in to pick subdomains for your pages.</p><a class="cs-btn cs-btn-primary" href="' . esc_url( wp_login_url( home_url( '/creator-studio/subdomains/' . ( isset( $_GET['name'] ) ? '?name=' . rawurlencode( sanitize_text_field( wp_unslash( $_GET['name'] ) ) ) : '' ) ) ) ) . '">Sign in</a></div></body></html>';
		exit;
	}
	echo '<div class="cs-shell">';
	if ( function_exists( 'sml_cs_render_sidebar' ) ) { sml_cs_render_sidebar( 'subdomains', false ); }
	echo '<div class="cs-main"><header class="cs-top"><div class="cs-crumb">Creator Studio<span>/</span><b>Subdomains</b></div><div class="cs-autosave">Your own address on StockMarketLoop</div><a class="cs-top-btn" href="#" data-sd-refresh>Refresh</a></header>';
	echo '<section class="cs-sd" id="cs-subdomains" aria-label="Subdomains"><h1>Subdomains</h1><p class="cs-sd-sub">Give your pages a short address like <b>yourname.' . esc_html( SML_SUB_BASE ) . '</b>. Anyone who visits it goes straight to that page, so it’s easy to say on stream, print on a card or put in your bio.</p>';
	echo '<div class="cs-sd-rules"><div><b>$' . number_format( SML_SUB_PRICE / 100, 2 ) . ' each, once</b>Paid by card through Stripe. No renewals.</div><div><b>One per page</b>Your Loop Channel, Loop Letters homepage, profile and each group you own can each have one.</div><div><b>Permanent, non-refundable</b>Once paid, the name is locked to that page for good. Choose carefully. <a href="' . esc_url( home_url( '/terms/#paid-subdomains' ) ) . '" style="color:#8cc9ff">Terms, Section 17</a></div></div>';
	echo '<div class="cs-sd-banner" data-sd-banner hidden></div><div class="cs-sd-list" data-sd-list></div></section></div></div>';
	echo '<script>window.smlSubConfig=' . wp_json_encode( array( 'rest' => esc_url_raw( rest_url( 'sml-sub/v1/' ) ), 'nonce' => wp_create_nonce( 'wp_rest' ), 'price' => SML_SUB_PRICE, 'base' => SML_SUB_BASE ) ) . ';</script><script>' . sml_sub_script() . '</script></body></html>';
	exit;
}
add_action( 'template_redirect', function () {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return; }
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	if ( 'creator-studio/subdomains' !== $path ) { return; }
	sml_sub_render_page();
}, 0 );
