/**
 * SML Loop Bucks — milestone program (streaks · referrals · social follows · shares)
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet. Paid bonuses stay in the real ledger
 * (they are real Loop Bucks); nothing here owns a balance of its own.
 *
 * This EXTENDS the site's real Loop Bucks economy (sml-lb/v1 — vault +
 * ledger inside the Video Upload Studio plugin: loopbucks-earn.php /
 * loopbucks-vault.php). It never keeps a second balance:
 *   - new repeatable earn rule via the `sml_lb_earn_rules` filter (share_link)
 *   - one-off bonuses paid with sml_lb_move( uid, amount, 'bonus', ref ) — a
 *     new ledger reason added via `sml_lb_reasons`, flow 'issue', so it shows
 *     as "Milestone bonus" in history and does NOT count against the daily
 *     earn ceiling (400) — a 2,500 LB year-streak bonus must not be clipped
 *     to 400 and then marked as paid.
 *   - every payout is idempotent by ledger ref (unique index): the same
 *     bonus can never be paid twice, no matter how often a hook fires.
 *   - streaks are computed FROM THE LEDGER (refs earn:daily_visit:{uid}:{Ymd}:…),
 *     so history before this snippet existed already counts.
 * If the plugin's functions are missing (plugin off), everything here is inert.
 *
 * Route base: /wp-json/sml-lbm/v1  (state · social-follow · share)
 */
if ( ! function_exists( 'sml_lbm_tiers' ) ) {

	/* ---------------- config (edit here) ---------------- */
	function sml_lbm_tiers() {
		return array(
			'streak'   => array( 5 => 25, 10 => 50, 30 => 150, 60 => 300, 180 => 1000, 365 => 2500 ),
			'referral' => array( 'per' => 25, 'per_cap_day' => 100, 'checkins_required' => 7, 'tiers' => array( 5 => 50, 10 => 150, 25 => 400, 50 => 1000 ) ),
			'social'   => array( 'each' => 50, 'all_bonus' => 1000 ),
			'share'    => array( 'amount' => 5, 'cap' => 30 ),
		);
	}
	/* Stock Market Loop's own social accounts. ONLY platforms with a real URL are
	   offered — leave a URL empty and that platform is hidden. Override with the
	   `sml_lbm_socials` filter or the `sml_lbm_socials` option (array key => url). */
	function sml_lbm_socials() {
		$defaults = array(
			'youtube'   => array( 'YouTube',     '' ),
			'x'         => array( 'X / Twitter', '' ),
			'tiktok'    => array( 'TikTok',      '' ),
			'instagram' => array( 'Instagram',   '' ),
			'facebook'  => array( 'Facebook',    '' ),
			'threads'   => array( 'Threads',     '' ),
			'reddit'    => array( 'Reddit',      '' ),
			'rumble'    => array( 'Rumble',      '' ),
			'twitch'    => array( 'Twitch',      '' ),
			'bluesky'   => array( 'Bluesky',     '' ),
			'medium'    => array( 'Medium',      '' ),
		);
		$opt = get_option( 'sml_lbm_socials', array() );
		if ( is_array( $opt ) ) { foreach ( $opt as $k => $url ) { if ( isset( $defaults[ $k ] ) && is_string( $url ) ) { $defaults[ $k ][1] = $url; } } }
		$list = apply_filters( 'sml_lbm_socials', $defaults );
		$out = array();
		foreach ( $list as $k => $row ) { if ( ! empty( $row[1] ) && preg_match( '#^https?://#i', $row[1] ) ) { $out[ $k ] = array( 'key' => $k, 'label' => $row[0], 'url' => esc_url_raw( $row[1] ) ); } }
		return $out;
	}

	function sml_lbm_ready() { return function_exists( 'sml_lb_move' ) && function_exists( 'sml_lb_table' ) && function_exists( 'sml_lb_balance' ); }

	/* ---------------- ledger helpers ---------------- */
	function sml_lbm_paid( $ref ) {
		global $wpdb; if ( ! sml_lbm_ready() ) { return true; }
		$ledger = sml_lb_table( 'ledger' );
		return (bool) $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $ledger WHERE ref = %s LIMIT 1", substr( $ref, 0, 96 ) ) );
	}
	function sml_lbm_bonus( $uid, $amount, $ref, $meta = array() ) {
		if ( ! sml_lbm_ready() || $amount <= 0 || ! $uid ) { return 0; }
		if ( sml_lbm_paid( $ref ) ) { return 0; }
		$moved = sml_lb_move( (int) $uid, (int) $amount, 'bonus', $ref, $meta );
		if ( is_wp_error( $moved ) || ! empty( $moved['replayed'] ) ) { return 0; }
		do_action( 'sml_lbm_bonus_paid', (int) $uid, $ref, (int) $amount );
		return (int) $amount;
	}
	/* distinct UTC days on which daily_visit was earned — from the ledger itself */
	function sml_lbm_visit_days( $uid ) {
		global $wpdb; if ( ! sml_lbm_ready() ) { return array(); }
		$ledger = sml_lb_table( 'ledger' );
		$refs = $wpdb->get_col( $wpdb->prepare( "SELECT ref FROM $ledger WHERE user_id = %d AND ref LIKE %s ORDER BY id DESC LIMIT 800", (int) $uid, 'earn:daily_visit:' . (int) $uid . ':%' ) );
		$days = array();
		foreach ( (array) $refs as $ref ) { $p = explode( ':', $ref ); if ( isset( $p[3] ) && preg_match( '/^\d{8}$/', $p[3] ) ) { $days[ $p[3] ] = true; } }
		return array_keys( $days );
	}
	function sml_lbm_streak( $uid ) {
		$days = sml_lbm_visit_days( $uid ); if ( ! $days ) { return 0; }
		$set = array_flip( $days );
		$cursor = gmdate( 'Ymd' );
		if ( ! isset( $set[ $cursor ] ) ) { $cursor = gmdate( 'Ymd', time() - 86400 ); if ( ! isset( $set[ $cursor ] ) ) { return 0; } }
		$n = 0; $t = strtotime( substr( $cursor, 0, 4 ) . '-' . substr( $cursor, 4, 2 ) . '-' . substr( $cursor, 6, 2 ) . ' 00:00:00 UTC' );
		while ( isset( $set[ gmdate( 'Ymd', $t ) ] ) ) { $n++; $t -= 86400; }
		return $n;
	}

	/* ---------------- ledger reason + earn rule ---------------- */
	add_filter( 'sml_lb_reasons', static function ( $r ) {
		if ( is_array( $r ) ) { $r['bonus'] = array( 'flow' => 'issue', 'label' => 'Milestone bonus' ); $r['referral'] = array( 'flow' => 'issue', 'label' => 'Referral' ); }
		return $r;
	} );
	add_filter( 'sml_lb_earn_rules', static function ( $rules ) {
		$c = sml_lbm_tiers();
		if ( is_array( $rules ) && ! isset( $rules['share_link'] ) ) { $rules['share_link'] = array( 'amount' => (int) $c['share']['amount'], 'cap' => (int) $c['share']['cap'], 'label' => 'Share a Stock Market Loop article' ); }
		return $rules;
	} );

	/* ---------------- streaks + referral credit: on every real daily_visit ---------------- */
	add_action( 'sml_lb_earned', static function ( $uid, $event, $amount ) {
		if ( 'daily_visit' !== $event || ! $uid ) { return; }
		$c = sml_lbm_tiers();
		sml_lbm_settle_streak( $uid );
		/* referral: credits the referrer once the referred member has N confirmed visits */
		$ref = (int) get_user_meta( $uid, 'sml_lbm_referred_by', true );
		if ( $ref && $ref !== (int) $uid && ! get_user_meta( $uid, 'sml_lbm_ref_credited', true ) ) {
			if ( count( sml_lbm_visit_days( $uid ) ) >= (int) $c['referral']['checkins_required'] ) {
				update_user_meta( $uid, 'sml_lbm_ref_credited', 1 );
				/* per-referral pay (own daily cap), keyed by the referred uid → idempotent */
				$today = 0; global $wpdb; $ledger = sml_lb_table( 'ledger' );
				$today = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(delta),0) FROM $ledger WHERE user_id = %d AND reason = 'referral' AND created_at >= UTC_DATE()", $ref ) );
				$pay = min( (int) $c['referral']['per'], max( 0, (int) $c['referral']['per_cap_day'] - $today ) );
				if ( $pay > 0 && ! sml_lbm_paid( 'referral:' . $uid ) ) {
					$moved = sml_lb_move( $ref, $pay, 'referral', 'referral:' . $uid, array( 'referred' => (int) $uid ) );
					if ( ! is_wp_error( $moved ) ) {
						$n = (int) get_user_meta( $ref, 'sml_lbm_referrals', true ) + 1; update_user_meta( $ref, 'sml_lbm_referrals', $n );
						foreach ( $c['referral']['tiers'] as $k => $bonus ) { if ( $n >= $k ) { sml_lbm_bonus( $ref, $bonus, 'bonus:referrals:' . $k . ':' . $ref, array( 'referrals' => $k ) ); } }
					}
				}
			}
		}
	}, 10, 3 );

	/* ---------------- referral capture: /?ref={nicename} → cookie → user_register ---------------- */
	add_action( 'init', static function () {
		if ( ! empty( $_GET['ref'] ) && ! is_user_logged_in() && ! headers_sent() ) {
			$slug = sanitize_title( wp_unslash( $_GET['ref'] ) );
			if ( $slug ) { setcookie( 'sml_lbm_ref', $slug, time() + 30 * DAY_IN_SECONDS, '/', '', is_ssl(), true ); }
		}
	}, 1 );
	add_action( 'user_register', static function ( $new_uid ) {
		if ( empty( $_COOKIE['sml_lbm_ref'] ) ) { return; }
		$slug = sanitize_title( wp_unslash( $_COOKIE['sml_lbm_ref'] ) );
		$ref = get_user_by( 'slug', $slug );
		if ( $ref && (int) $ref->ID !== (int) $new_uid ) { update_user_meta( $new_uid, 'sml_lbm_referred_by', (int) $ref->ID ); }
	} );

	/* ---------------- REST ---------------- */
	/* pay any streak tiers already reached — idempotent by ref, so calling this from
	   /state as well as the daily_visit hook is safe (a 22-day member sees the 5/10-day
	   bonuses the first time they open the panel, not tomorrow) */
	function sml_lbm_settle_streak( $uid ) {
		$c = sml_lbm_tiers(); $streak = sml_lbm_streak( $uid );
		foreach ( $c['streak'] as $len => $bonus ) { if ( $streak >= $len ) { sml_lbm_bonus( $uid, $bonus, 'bonus:streak:' . $len . ':' . $uid, array( 'streak' => $len ) ); } }
		return $streak;
	}
	function sml_lbm_state( $uid ) {
		$c = sml_lbm_tiers(); $streak = sml_lbm_settle_streak( $uid );
		$tiers = array(); foreach ( $c['streak'] as $len => $bonus ) { $tiers[] = array( 'len' => $len, 'amount' => $bonus, 'done' => sml_lbm_paid( 'bonus:streak:' . $len . ':' . $uid ) ); }
		$done_soc = get_user_meta( $uid, 'sml_lbm_socials', true ); $done_soc = is_array( $done_soc ) ? $done_soc : array();
		$socials = array(); foreach ( sml_lbm_socials() as $k => $row ) { $row['done'] = in_array( $k, $done_soc, true ); $socials[] = $row; }
		$refs = (int) get_user_meta( $uid, 'sml_lbm_referrals', true );
		$rtiers = array(); foreach ( $c['referral']['tiers'] as $k => $bonus ) { $rtiers[] = array( 'count' => $k, 'amount' => $bonus, 'done' => sml_lbm_paid( 'bonus:referrals:' . $k . ':' . $uid ) ); }
		$u = get_userdata( $uid );
		return array(
			'ready'    => sml_lbm_ready(),
			'streak'   => array( 'days' => $streak, 'tiers' => $tiers, 'checkedInToday' => in_array( gmdate( 'Ymd' ), sml_lbm_visit_days( $uid ), true ) ),
			'referral' => array( 'count' => $refs, 'per' => (int) $c['referral']['per'], 'checkinsRequired' => (int) $c['referral']['checkins_required'], 'tiers' => $rtiers, 'link' => home_url( '/?ref=' . rawurlencode( $u ? $u->user_nicename : '' ) ) ),
			'socials'  => array( 'each' => (int) $c['social']['each'], 'allBonus' => (int) $c['social']['all_bonus'], 'allDone' => sml_lbm_paid( 'bonus:social_all:' . $uid ), 'platforms' => $socials ),
			'share'    => array( 'amount' => (int) $c['share']['amount'], 'cap' => (int) $c['share']['cap'], 'today' => function_exists( 'sml_lb_earned_today' ) ? (int) sml_lb_earned_today( $uid, 'share_link' ) : 0 ),
		);
	}
	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-lbm/v1', '/state', array( 'methods' => 'GET', 'permission_callback' => 'is_user_logged_in', 'callback' => static function () { return rest_ensure_response( sml_lbm_state( get_current_user_id() ) ); } ) );
		register_rest_route( 'sml-lbm/v1', '/social-follow', array( 'methods' => 'POST', 'permission_callback' => 'is_user_logged_in', 'callback' => static function ( WP_REST_Request $r ) {
			$uid = get_current_user_id(); $c = sml_lbm_tiers();
			$p = sanitize_key( (string) $r->get_param( 'platform' ) ); $list = sml_lbm_socials();
			if ( ! isset( $list[ $p ] ) ) { return new WP_Error( 'sml_lbm_bad_platform', 'Unknown platform.', array( 'status' => 400 ) ); }
			$done = get_user_meta( $uid, 'sml_lbm_socials', true ); $done = is_array( $done ) ? $done : array();
			$paid = 0;
			if ( ! in_array( $p, $done, true ) ) {
				/* lifetime once per platform: reason 'earn' (small, counts toward the day), ref has no date */
				$moved = sml_lbm_ready() ? sml_lb_move( $uid, (int) $c['social']['each'], 'earn', 'earn:social_follow:' . $uid . ':' . $p, array( 'event' => 'social_follow', 'platform' => $p ) ) : null;
				if ( $moved && ! is_wp_error( $moved ) ) { $paid = (int) $c['social']['each']; }
				$done[] = $p; update_user_meta( $uid, 'sml_lbm_socials', array_values( array_unique( $done ) ) );
			}
			$all = true; foreach ( $list as $k => $row ) { if ( ! in_array( $k, $done, true ) ) { $all = false; break; } }
			if ( $all && count( $list ) >= 3 ) { $paid += sml_lbm_bonus( $uid, (int) $c['social']['all_bonus'], 'bonus:social_all:' . $uid ); }
			return rest_ensure_response( array( 'ok' => true, 'awarded' => $paid, 'balance' => sml_lbm_ready() ? sml_lb_balance( $uid ) : 0, 'state' => sml_lbm_state( $uid ) ) );
		} ) );
		register_rest_route( 'sml-lbm/v1', '/share', array( 'methods' => 'POST', 'permission_callback' => 'is_user_logged_in', 'callback' => static function ( WP_REST_Request $r ) {
			$uid = get_current_user_id(); $url = esc_url_raw( (string) $r->get_param( 'url' ) );
			$host = wp_parse_url( $url, PHP_URL_HOST ); $home = wp_parse_url( home_url( '/' ), PHP_URL_HOST );
			if ( ! $host || strtolower( $host ) !== strtolower( (string) $home ) ) { return new WP_Error( 'sml_lbm_bad_url', 'Share a Stock Market Loop link.', array( 'status' => 400 ) ); }
			$paid = function_exists( 'sml_lb_award' ) ? (int) sml_lb_award( 'share_link', $uid, substr( md5( $url ), 0, 12 ), array( 'url' => $url ) ) : 0;
			return rest_ensure_response( array( 'ok' => true, 'awarded' => $paid, 'balance' => sml_lbm_ready() ? sml_lb_balance( $uid ) : 0, 'state' => sml_lbm_state( $uid ) ) );
		} ) );
	} );
}
