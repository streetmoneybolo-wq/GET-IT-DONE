<?php
/**
 * Plugin Name: StockMarketLoop Store
 * Description: Loop Bucks wallet, digital storefront, entitlements, and WooCommerce fulfillment for StockMarketLoop.
 * Version: 0.5.0
 * Author: StockMarketLoop
 * Text Domain: sml-store
 */

defined( 'ABSPATH' ) || exit;

final class SML_Store {
	const VERSION = '0.5.0';
	const DB_VERSION = '3';
	const OPTION_DB_VERSION = 'sml_store_db_version';
	const NONCE_ACTION = 'sml_store_purchase';

	/* The resolved sml_lb_* debit contract. Absent until the self-test on the
	   Loop Store admin screen has proven how the ledger applies a debit. */
	const OPTION_LB_CONTRACT = 'sml_store_lb_contract';

	/* Marks a journal row that has claimed its reference but whose money has
	   not moved yet. A row still carrying this prefix is a crashed attempt and
	   may be retried; a row without it is a completed transaction. */
	const PENDING = '[pending] ';

	private static $instance;

	public static function instance() {
		if ( ! self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		register_activation_hook( __FILE__, array( __CLASS__, 'activate' ) );
		add_action( 'plugins_loaded', array( $this, 'maybe_upgrade' ) );
		add_action( 'init', array( $this, 'register_shortcodes' ) );
		add_action( 'bp_after_member_header', array( $this, 'buddypress_profile_wallet' ) );
		add_action( 'wp_footer', array( $this, 'custom_profile_wallet' ) );
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'register_assets' ) );
		add_filter( 'body_class', array( $this, 'store_body_class' ) );
		add_action( 'admin_menu', array( $this, 'admin_menu' ) );
		add_action( 'admin_post_sml_store_save_item', array( $this, 'admin_save_item' ) );
		add_action( 'admin_post_sml_store_adjust_wallet', array( $this, 'admin_adjust_wallet' ) );
		add_action( 'admin_post_sml_store_create_bucks_products', array( $this, 'admin_create_bucks_products' ) );
		add_action( 'admin_post_sml_store_lb_selftest', array( $this, 'admin_lb_selftest' ) );
		add_filter( 'sml_lb_reasons', array( $this, 'register_lb_reasons' ) );
		add_action( 'woocommerce_order_status_processing', array( $this, 'fulfill_woocommerce_order' ) );
		add_action( 'woocommerce_order_status_completed', array( $this, 'fulfill_woocommerce_order' ) );
		add_action( 'woocommerce_order_refunded', array( $this, 'reverse_woocommerce_refund' ), 10, 2 );
		add_filter( 'woocommerce_add_to_cart_validation', array( $this, 'require_account_for_bucks' ), 10, 3 );
		add_action( 'woocommerce_product_options_general_product_data', array( $this, 'woo_product_field' ) );
		add_action( 'woocommerce_admin_process_product_object', array( $this, 'woo_save_product_field' ) );
	}

	public static function table( $name ) {
		global $wpdb;
		return $wpdb->prefix . 'sml_' . $name;
	}

	public static function activate() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();

		dbDelta( 'CREATE TABLE ' . self::table( 'store_items' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			sku varchar(80) NOT NULL,
			name varchar(190) NOT NULL,
			description text NOT NULL,
			category varchar(40) NOT NULL,
			item_type varchar(40) NOT NULL,
			price_bucks bigint(20) unsigned NOT NULL DEFAULT 0,
			woo_product_id bigint(20) unsigned NULL,
			metadata longtext NULL,
			status varchar(20) NOT NULL DEFAULT 'active',
			sort_order int(11) NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY sku (sku),
			KEY category_status (category,status)
		) $charset;" );

		dbDelta( 'CREATE TABLE ' . self::table( 'wallet_transactions' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			amount bigint(20) NOT NULL,
			balance_after bigint(20) NOT NULL,
			tx_type varchar(40) NOT NULL,
			reference_type varchar(40) NOT NULL DEFAULT '',
			reference_id varchar(100) NOT NULL DEFAULT '',
			note varchar(255) NOT NULL DEFAULT '',
			created_by bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY reference (user_id,tx_type,reference_type,reference_id),
			KEY user_created (user_id,created_at)
		) $charset;" );

		dbDelta( 'CREATE TABLE ' . self::table( 'wallets' ) . " (
			user_id bigint(20) unsigned NOT NULL,
			balance bigint(20) NOT NULL DEFAULT 0,
			updated_at datetime NOT NULL,
			PRIMARY KEY (user_id)
		) $charset;" );

		dbDelta( 'CREATE TABLE ' . self::table( 'entitlements' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			item_id bigint(20) unsigned NOT NULL,
			owner_type varchar(20) NOT NULL DEFAULT 'profile',
			owner_id bigint(20) unsigned NOT NULL DEFAULT 0,
			status varchar(20) NOT NULL DEFAULT 'active',
			source_type varchar(40) NOT NULL,
			source_id varchar(100) NOT NULL,
			granted_at datetime NOT NULL,
			revoked_at datetime NULL,
			PRIMARY KEY (id),
			UNIQUE KEY entitlement (user_id,item_id,owner_type,owner_id),
			KEY owner (owner_type,owner_id,status)
		) $charset;" );

		update_option( self::OPTION_DB_VERSION, self::DB_VERSION );
		self::seed_catalog();
	}

	public function maybe_upgrade() {
		if ( self::DB_VERSION !== get_option( self::OPTION_DB_VERSION ) ) self::activate();
	}

	private static function seed_catalog() {
		global $wpdb;
		$items = array(
			array( 'live-stream-games', 'Live Stream Games unlocked', 'For viewers: play games while watching a live stream. Game sessions cost 10 LB and require the creator unlock.', 'streaming', 'one_time', 250, 10, array() ),
			array( 'in-stream-games', 'In-Stream Games for your audience', 'Let your Loop Channel audience play games in live chat during streams.', 'streaming', 'monthly', 2500, 20, array( 'monthly' => true ) ),
			array( 'motion-profile-banner', 'GIF / Motion profile banner', 'Add an animated banner across the top of your profile page.', 'profile', 'monthly', 350, 30, array( 'monthly' => true ) ),
			array( 'motion-profile-background', 'GIF / Motion profile background', 'Add a full-page animated background to your profile.', 'profile', 'monthly', 500, 40, array( 'monthly' => true ) ),
			array( 'immersive-profile', 'Immersive profile pages', 'Unlock a cinematic profile experience with layered motion.', 'profile', 'monthly', 500, 50, array( 'monthly' => true ) ),
			array( 'music-slots-1', 'Music slots for your profile · +1', 'Add one extra music slot to your profile.', 'profile', 'one_time', 100, 60, array( 'variation' => 'music', 'quantity' => 1 ) ),
			array( 'music-slots-2', 'Music slots for your profile · +2', 'Add two extra music slots to your profile.', 'profile', 'one_time', 200, 61, array( 'variation' => 'music', 'quantity' => 2 ) ),
			array( 'music-slots-3', 'Music slots for your profile · +3', 'Add three extra music slots to your profile.', 'profile', 'one_time', 300, 62, array( 'variation' => 'music', 'quantity' => 3 ) ),
			array( 'music-slots-4', 'Music slots for your profile · +4', 'Add four extra music slots to your profile.', 'profile', 'one_time', 400, 63, array( 'variation' => 'music', 'quantity' => 4 ) ),
			array( 'motion-video-thumbnails', 'GIF / Motion video thumbnails', 'Animated thumbnails for Loop Channel videos, charged per upload.', 'loop-channel', 'per_use', 100, 70, array( 'per_use' => true ) ),
			array( 'loop-kick-chirp', 'Chirp feature on the Loop Kick', 'Unlock Chirp to sound off on the Loop Kick.', 'loop-kick', 'one_time', 500, 80, array() ),
			array( 'triple-screen-streaming', 'Triple-screen streaming', 'Stream three screens at once on the same watch page.', 'streaming', 'one_time', 35000, 90, array() ),
			array( 'letter-2k-5k', 'Loop Letter subscriber count · 2k–5k', 'Grow your Loop Letter email list to the selected tier.', 'loop-letter', 'monthly', 800, 100, array( 'monthly' => true, 'variation' => 'letter' ) ),
			array( 'letter-5k-8k', 'Loop Letter subscriber count · 5k–8k', 'Grow your Loop Letter email list to the selected tier.', 'loop-letter', 'monthly', 1200, 101, array( 'monthly' => true, 'variation' => 'letter' ) ),
			array( 'letter-8k-10k', 'Loop Letter subscriber count · 8k–10k', 'Grow your Loop Letter email list to the selected tier.', 'loop-letter', 'monthly', 1500, 102, array( 'monthly' => true, 'variation' => 'letter' ) ),
			array( 'letter-10k-plus', 'Loop Letter subscriber count · 10k+', 'Grow your Loop Letter email list to the selected tier.', 'loop-letter', 'monthly', 2000, 103, array( 'monthly' => true, 'variation' => 'letter' ) ),
			array( 'start-group-free', 'Start a Group · Free group', 'Launch a free group and earn ad revenue.', 'groups', 'one_time', 150, 110, array( 'variation' => 'group', 'limit' => 3 ) ),
			array( 'start-group-premium', 'Start a Group · Premium group', 'Launch a premium group and earn ad revenue.', 'groups', 'one_time', 250, 111, array( 'variation' => 'group', 'limit' => 2 ) ),
			array( 'group-tools', 'Group Tools', 'Live Chart, Algo, Live Scanner, and Earnings Calendar bundled.', 'tools', 'one_time', 3500, 120, array() ),
			array( 'verification-badges', 'Verification Badges', 'Unlock all five verification badges and their reach-boosting activation options.', 'verification', 'monthly', 1000, 130, array( 'monthly' => true ) ),
		);
		$now = current_time( 'mysql', true );
		$wpdb->query( 'UPDATE ' . self::table( 'store_items' ) . " SET status='inactive'" );
		foreach ( $items as $item ) {
			$wpdb->query( $wpdb->prepare(
				'INSERT INTO ' . self::table( 'store_items' ) . ' (sku,name,description,category,item_type,price_bucks,metadata,status,sort_order,created_at,updated_at) VALUES (%s,%s,%s,%s,%s,%d,%s,%s,%d,%s,%s) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),category=VALUES(category),item_type=VALUES(item_type),price_bucks=VALUES(price_bucks),metadata=VALUES(metadata),status=VALUES(status),sort_order=VALUES(sort_order),updated_at=VALUES(updated_at)',
				$item[0], $item[1], $item[2], $item[3], $item[4], $item[5], wp_json_encode( $item[7] ), 'active', $item[6], $now, $now
			) );
		}
	}

	public function register_assets() {
		wp_register_style( 'sml-store', plugins_url( 'assets/store.css', __FILE__ ), array(), self::VERSION );
		wp_register_style( 'sml-wallet', plugins_url( 'assets/wallet.css', __FILE__ ), array(), self::VERSION );
		wp_register_style( 'sml-premium-gift-motion', plugins_url( 'assets/premium-gifts/premium-gift-motion.css', __FILE__ ), array(), self::VERSION );
		wp_register_style( 'sml-verification-badge-motion', plugins_url( 'assets/verify-badges/verification-badge-motion.css', __FILE__ ), array(), self::VERSION );
		wp_register_script( 'sml-store', plugins_url( 'assets/store.js', __FILE__ ), array(), self::VERSION, true );
		wp_register_script( 'sml-premium-gift-motion', plugins_url( 'assets/premium-gifts/premium-gift-motion.js', __FILE__ ), array(), self::VERSION, true );
		wp_register_script( 'sml-verification-badge-motion', plugins_url( 'assets/verify-badges/verification-badge-motion.js', __FILE__ ), array(), self::VERSION, true );
	}

	public function store_body_class( $classes ) {
		if ( is_page( 'store' ) ) $classes[] = 'sml-store-page';
		return $classes;
	}

	public function register_shortcodes() {
		add_shortcode( 'sml_store', array( $this, 'store_shortcode' ) );
		add_shortcode( 'sml_loop_bucks', array( $this, 'wallet_shortcode' ) );
		add_shortcode( 'sml_wallet', array( $this, 'wallet_dashboard_shortcode' ) );
	}

	public function store_shortcode( $atts ) {
		wp_enqueue_style( 'sml-store' );
		wp_enqueue_style( 'sml-wallet' );
		wp_enqueue_style( 'sml-premium-gift-motion' );
		wp_enqueue_style( 'sml-verification-badge-motion' );
		wp_enqueue_script( 'sml-store' );
		wp_enqueue_script( 'sml-premium-gift-motion' );
		wp_enqueue_script( 'sml-verification-badge-motion' );
		wp_localize_script( 'sml-store', 'smlStore', array(
			'endpoint' => esc_url_raw( rest_url( 'sml-store/v1/purchase' ) ),
			'nonce' => wp_create_nonce( 'wp_rest' ),
			'loginUrl' => wp_login_url( get_permalink() ),
			'feedUrl' => home_url( '/' ),
			'loggedIn' => is_user_logged_in(),
		) );
		$items = $this->get_catalog();
		$by_sku = array();
		foreach ( $items as $catalog_item ) $by_sku[ $catalog_item->sku ] = $catalog_item;
		$owned = array();
		if ( is_user_logged_in() && $items ) {
			global $wpdb;
			$owned_ids = $wpdb->get_col( $wpdb->prepare( 'SELECT item_id FROM ' . self::table( 'entitlements' ) . " WHERE user_id=%d AND status='active'", get_current_user_id() ) );
			$owned = array_fill_keys( array_map( 'intval', $owned_ids ), true );
		}
		$balance = is_user_logged_in() ? self::balance( get_current_user_id() ) : 0;
		$bucks_products = $this->get_bucks_products();
		$product_urls = array();
		foreach ( $bucks_products as $product ) {
			$amount = absint( $product->get_meta( '_sml_loop_bucks' ) );
			if ( $amount ) $product_urls[ $amount ] = is_user_logged_in() ? $product->add_to_cart_url() : wp_login_url( $product->add_to_cart_url() );
		}
		$packs = array(
			array( 500, 5, '', '', 44 ), array( 1200, 10, '+20%', '', 52 ), array( 2000, 15, '+33%', '', 60 ),
			array( 3000, 20, '+50%', '', 68 ), array( 5000, 25, '+100%', '', 76 ),
			array( 15000, 50, '+200%', 'Most popular', 84 ), array( 35000, 100, '+250%', 'Best value', 92 ),
		);
		$asset = plugins_url( 'assets/', __FILE__ );
		$premium_gifts = array(
			array( 'Cash Crown', 'cash-crown', '01-cash-crown.webp', 1000 ), array( 'Vault Burst', 'vault-burst', '02-vault-burst.webp', 2500 ),
			array( 'Money Bag Royale', 'money-bag-royale', '03-money-bag-royale.webp', 5000 ), array( 'Diamond Cash Stack', 'diamond-cash-stack', '04-diamond-cash-stack.webp', 10000 ),
			array( 'Cash Rain Cloud', 'cash-rain-cloud', '05-cash-rain-cloud.webp', 25000 ),
		);
		$standard_gifts = array(
			array( 'Market Mind', 25 ), array( 'Diamond Hold', 35 ), array( 'Alpha Crown', 35 ), array( 'Risk Shield', 50 ),
			array( 'Breakout Rocket', 50 ), array( 'Bull Charge', 100 ), array( 'Bear Claw', 100 ), array( 'Signal Amplifier', 250 ),
		);
		$badges = array(
			array( 'Social Verified', 'blue', '01-blue-social-verified.webp' ), array( 'Creator Verified', 'gold', '02-gold-creator-verified.webp' ),
			array( 'Community Leader', 'purple', '03-purple-community-leader.webp' ), array( 'Trader Verified', 'green', '04-green-trader-verified.webp' ),
			array( 'Alert Specialist', 'red', '05-red-alert-specialist.webp' ),
		);
		$perks = array(
			array( 'streaming', 'Live Stream Games unlocked', 'For viewers: play games while watching a live stream, plus 10 LB per game session. Only works on streams where the creator has In-Stream Games unlocked.', 'live-stream-games' ),
			array( 'streaming', 'In-Stream Games for your audience', 'For Loop Channel creators: while you stream, your audience can play games right in the live chat. Renews monthly.', 'in-stream-games', 'monthly' ),
			array( 'profile', 'GIF / Motion profile banner', 'Animated banner across the top of your profile page. Renews monthly.', 'motion-profile-banner', 'monthly' ),
			array( 'profile', 'GIF / Motion profile background', 'Full-page animated background for your profile. Renews monthly.', 'motion-profile-background', 'monthly' ),
			array( 'profile', 'Immersive profile pages', 'The full cinematic profile experience with layered motion. Renews monthly.', 'immersive-profile', 'monthly' ),
			array( 'profile', 'Music slots for your profile', 'Your first slot is free. Add extra slots for 100 LB each — up to 5 slots total.', 'music-slots-1', 'music' ),
			array( 'Loop Channel', 'GIF / Motion video thumbnails', 'Animated thumbnails for your Loop Channel videos — 100 LB per upload, charged from your balance each time.', 'motion-video-thumbnails', 'per-use' ),
			array( 'Loop Kick', 'Chirp feature on the Loop Kick', 'Unlock Chirp to sound off on the Loop Kick.', 'loop-kick-chirp' ),
			array( 'streaming', 'Triple-screen streaming', 'Stream 3 screens at once on the same watch page — viewers see all three live feeds side by side.', 'triple-screen-streaming', 'screens' ),
			array( 'Loop Letter', 'Loop Letter subscriber count', 'Grow your newsletter email list beyond the free tier — pick the list size you need. Renews monthly.', 'letter-2k-5k', 'letter' ),
			array( 'groups', 'Start a Group', 'Launch your own group and start earning ad revenue. Up to 3 free groups and 2 premium groups per user.', 'start-group-free', 'group' ),
			array( 'tools', 'Group Tools', 'The full pro toolkit for your groups: Live Chart, Algo, Live Scanner, and Earnings Calendar.', 'group-tools' ),
		);
		ob_start();
		?>
		<section class="sml-store" data-sml-store data-balance="<?php echo esc_attr( $balance ); ?>">
			<header class="sml-store__bar"><div class="sml-store__brand"><div class="sml-store__wordmark">LOOP <span>STORE</span></div><div class="sml-store__network">Stock Market Loop</div></div><a class="sml-store__balance" href="<?php echo esc_url( home_url( '/wallet/' ) ); ?>"><img src="<?php echo esc_url( $asset . 'loopbuck.png' ); ?>" alt=""><span class="sml-store__balance-copy"><small>Your balance</small><strong data-sml-balance><?php echo esc_html( number_format_i18n( $balance ) ); ?> LB</strong></span></a></header>
			<section class="sml-store__hero"><img class="sml-store__hero-art" src="<?php echo esc_url( $asset . 'loopbuck.png' ); ?>" alt="A stack of Loop Bucks"><h1>Load up on<br><span>Loop Bucks</span></h1><p>The currency of Stock Market Loop. Buy a pack, then unlock streams, immersive profiles, group tools, and more.</p></section>
			<div class="sml-store__notice" data-store-notice hidden></div>
			<section class="sml-store__section" data-packages><div class="sml-store__heading"><h2>Bucks Packs</h2><span>Bigger packs, bigger bonus per dollar</span></div><div class="sml-store__packs">
			<?php foreach ( $packs as $pack ) : ?>
				<article class="sml-store__pack"><?php if ( $pack[3] ) : ?><span class="sml-store__badge"><?php echo esc_html( $pack[3] ); ?></span><?php endif; ?><img src="<?php echo esc_url( $asset . 'loopbuck.png' ); ?>" alt="" style="width:<?php echo (int) $pack[4]; ?>px"><div class="sml-store__pack-amount"><?php echo esc_html( number_format_i18n( $pack[0] ) ); ?> <small>LB</small></div><?php if ( $pack[2] ) : ?><div class="sml-store__bonus"><?php echo esc_html( $pack[2] ); ?> bonus value</div><?php endif; ?><button data-pack data-amount="<?php echo (int) $pack[0]; ?>" data-price-label="$<?php echo esc_attr( number_format( $pack[1], 2 ) ); ?>" data-url="<?php echo esc_url( $product_urls[ $pack[0] ] ?? '' ); ?>">$<?php echo esc_html( number_format( $pack[1], 2 ) ); ?></button></article>
			<?php endforeach; ?></div></section>
			<section class="sml-store__section"><div class="sml-store__heading"><h2>Gifts</h2><span>Gift a post, video, or article — the creator gets your Loop Bucks and an algo boost</span></div><div class="sml-store__premium-label"><strong>★ Premium Cash Gifts</strong><span>Animated — the biggest flex on the Loop</span></div><div class="sml-store__gift-grid sml-store__gift-grid--premium">
			<?php foreach ( $premium_gifts as $gift ) : ?><article class="sml-store__gift sml-store__gift--premium"><div class="sml-store__gift-art sml-premium-gift" data-gift="<?php echo esc_attr( $gift[1] ); ?>"><img src="<?php echo esc_url( $asset . 'premium-gifts/' . $gift[2] ); ?>" alt="<?php echo esc_attr( $gift[0] ); ?>"></div><div class="sml-store__gift-name"><?php echo esc_html( $gift[0] ); ?></div><button data-gift-button data-gift-name="<?php echo esc_attr( $gift[0] ); ?>">Gift · <?php echo esc_html( number_format_i18n( $gift[3] ) ); ?> LB</button></article><?php endforeach; ?>
			</div><div class="sml-store__gift-grid"><?php foreach ( $standard_gifts as $gift ) : ?><article class="sml-store__gift"><div class="sml-store__gift-art"><img src="<?php echo esc_url( $asset . 'gifts/' . rawurlencode( $gift[0] ) . '.png' ); ?>" alt="<?php echo esc_attr( $gift[0] ); ?>"></div><div class="sml-store__gift-name"><?php echo esc_html( $gift[0] ); ?></div><button data-gift-button data-gift-name="<?php echo esc_attr( $gift[0] ); ?>">Gift · <?php echo esc_html( number_format_i18n( $gift[1] ) ); ?> LB</button></article><?php endforeach; ?></div></section>
			<?php $verify = $by_sku['verification-badges'] ?? null; $verify_owned = $verify && isset( $owned[ (int) $verify->id ] ); ?>
			<section class="sml-store__section"><div class="sml-store__verify"><div class="sml-store__heading"><h2>Verification Badges</h2><span>One subscription unlocks all five</span></div><div class="sml-store__verify-badges"><?php foreach ( $badges as $badge ) : ?><div class="sml-verify-badge" data-tier="<?php echo esc_attr( $badge[1] ); ?>" style="width:96px;height:96px"><img src="<?php echo esc_url( $asset . 'verify-badges/' . $badge[2] ); ?>" alt="<?php echo esc_attr( $badge[0] ); ?>"></div><?php endforeach; ?></div><div class="sml-store__verify-foot"><p>Every badge you activate boosts your impressions per post — your videos, live streams, and Loop Letters get pushed further in the algo. The more badges active, the bigger the boost.</p><?php if ( $verify ) : ?><button data-buy="<?php echo (int) $verify->id; ?>" data-price="1000" data-title="Unlock Verification Badges?" data-body="Unlock all five Verification Badges for 1,000 Loop Bucks per month? It renews automatically from your balance." data-active-label="Active" <?php disabled( $verify_owned ); ?>><?php echo $verify_owned ? 'Active' : 'Unlock all 5 · 1,000 LB / month'; ?></button><?php endif; ?></div></div></section>
			<section class="sml-store__section sml-store__section--perks"><div class="sml-store__heading"><h2>Perks &amp; Features</h2><span>Spend your Loop Bucks to unlock the good stuff</span></div><div class="sml-store__perks">
			<?php foreach ( $perks as $perk ) : $item = $by_sku[ $perk[3] ] ?? null; if ( ! $item ) continue; $kind = $perk[4] ?? ''; $is_owned = isset( $owned[ (int) $item->id ] ); ?>
				<article class="sml-store__perk"><div class="sml-store__perk-top"><span class="sml-store__perk-tag"><?php echo esc_html( $perk[0] ); ?></span><span class="sml-store__owned" data-owned <?php echo $is_owned ? '' : 'hidden'; ?>>OWNED ✓</span></div><h3><?php echo esc_html( $perk[1] ); ?></h3><p><?php echo esc_html( $perk[2] ); ?></p>
				<?php if ( 'screens' === $kind ) : ?><div class="sml-store__screens"><span class="sml-store__screen"><b>LIVE 1</b></span><span class="sml-store__screen"><b>LIVE 2</b></span><span class="sml-store__screen"><b>LIVE 3</b></span></div><?php endif; ?>
				<?php if ( 'music' === $kind ) : ?><div class="sml-store__options"><?php foreach ( array( 1,2,3,4 ) as $q ) : $option = $by_sku[ 'music-slots-' . $q ]; ?><button class="sml-store__option <?php echo 1 === $q ? 'is-active' : ''; ?>" data-option data-item="<?php echo (int) $option->id; ?>" data-price="<?php echo (int) $option->price_bucks; ?>" data-label="Add <?php echo $q; ?> slot<?php echo $q > 1 ? 's' : ''; ?> · <?php echo (int) $option->price_bucks; ?> LB">+<?php echo $q; ?></button><?php endforeach; ?></div><?php endif; ?>
				<?php if ( 'letter' === $kind ) : ?><div class="sml-store__options"><?php foreach ( array( array('2k–5k','letter-2k-5k'),array('5k–8k','letter-5k-8k'),array('8k–10k','letter-8k-10k'),array('10k+','letter-10k-plus') ) as $i => $opt ) : $option = $by_sku[ $opt[1] ]; ?><button class="sml-store__option <?php echo 0 === $i ? 'is-active' : ''; ?>" data-option data-item="<?php echo (int) $option->id; ?>" data-price="<?php echo (int) $option->price_bucks; ?>" data-label="Unlock · <?php echo (int) $option->price_bucks; ?> LB / month"><?php echo esc_html( $opt[0] ); ?></button><?php endforeach; ?></div><?php endif; ?>
				<?php if ( 'group' === $kind ) : ?><div class="sml-store__options"><?php foreach ( array( array('Free group · 0/3','start-group-free'),array('Premium group · 0/2','start-group-premium') ) as $i => $opt ) : $option = $by_sku[ $opt[1] ]; ?><button class="sml-store__option <?php echo 0 === $i ? 'is-active' : ''; ?>" data-option data-item="<?php echo (int) $option->id; ?>" data-price="<?php echo (int) $option->price_bucks; ?>" data-label="Start <?php echo 0 === $i ? 'free' : 'premium'; ?> group · <?php echo (int) $option->price_bucks; ?> LB"><?php echo esc_html( $opt[0] ); ?></button><?php endforeach; ?></div><?php endif; ?>
				<button class="sml-store__perk-buy" data-buy="<?php echo (int) $item->id; ?>" data-price="<?php echo (int) $item->price_bucks; ?>" data-title="<?php echo esc_attr( 'monthly' === $kind ? 'Unlock monthly perk?' : ( 'per-use' === $kind ? 'Pay per upload' : 'Unlock perk?' ) ); ?>" data-body="<?php echo esc_attr( 'monthly' === $kind ? 'This perk renews automatically from your Loop Bucks balance each month.' : ( 'per-use' === $kind ? 'Animated thumbnails cost 100 Loop Bucks each time you upload one. Nothing is charged from this information screen.' : 'Unlock this feature with Loop Bucks?' ) ); ?>" data-active-label="<?php echo 'monthly' === $kind ? 'Active' : 'Unlocked'; ?>" <?php echo 'per-use' === $kind ? 'data-per-use="1"' : ''; ?> <?php disabled( $is_owned ); ?>><?php echo $is_owned ? ( 'monthly' === $kind ? 'Active' : 'Unlocked' ) : ( 'music' === $kind ? 'Add 1 slot · 100 LB' : ( 'letter' === $kind ? 'Unlock · 800 LB / month' : ( 'group' === $kind ? 'Start free group · 150 LB' : ( 'monthly' === $kind ? 'Unlock · ' . number_format_i18n( $item->price_bucks ) . ' LB / month' : ( 'per-use' === $kind ? '100 LB per upload' : 'Unlock · ' . number_format_i18n( $item->price_bucks ) . ' LB' ) ) ) ) ); ?></button>
				</article>
			<?php endforeach; ?></div></section>
			<div class="sml-store__modal" data-store-modal hidden><div class="sml-store__dialog" role="dialog" aria-modal="true" aria-labelledby="sml-store-modal-title"><img src="<?php echo esc_url( $asset . 'loopbuck.png' ); ?>" alt=""><h2 id="sml-store-modal-title" data-modal-title></h2><p data-modal-body></p><div class="sml-store__detail" data-modal-detail hidden><span data-modal-detail-label></span><strong data-modal-detail-value></strong></div><div class="sml-store__modal-actions"><button class="sml-store__cancel" data-modal-close>Cancel</button><button class="sml-store__confirm" data-modal-confirm>Confirm</button></div></div></div>
			<footer class="sml-store__footer"><span>© 2026 Stock Market Loop — Loop Bucks are a virtual currency with no cash value.</span><span>Purchases are final. Questions? <a href="<?php echo esc_url( home_url( '/contact/' ) ); ?>">Contact support</a></span></footer>
		</section>
		<?php
		return ob_get_clean();
	}

	public function wallet_shortcode() {
		if ( ! is_user_logged_in() ) return '<a href="' . esc_url( wp_login_url( get_permalink() ) ) . '">Sign in to view Loop Bucks</a>';
		return '<a class="sml-loop-bucks" href="' . esc_url( home_url( '/wallet/' ) ) . '">' . esc_html( number_format_i18n( self::balance( get_current_user_id() ) ) ) . ' LB</a>';
	}

	public function wallet_dashboard_shortcode() {
		if ( ! is_user_logged_in() ) return '<a href="' . esc_url( wp_login_url( get_permalink() ) ) . '">Sign in to view your wallet</a>';
		wp_enqueue_style( 'sml-wallet' );
		global $wpdb;
		$user_id = get_current_user_id();
		$transactions = $wpdb->get_results( $wpdb->prepare( 'SELECT amount,tx_type,note,created_at FROM ' . self::table( 'wallet_transactions' ) . ' WHERE user_id=%d ORDER BY id DESC LIMIT 20', $user_id ) );
		ob_start(); ?>
		<section class="sml-wallet-panel">
			<div class="sml-wallet-panel__balance"><span>AVAILABLE BALANCE</span><strong><?php echo esc_html( number_format_i18n( self::balance( $user_id ) ) ); ?> <small>LB</small></strong><a href="<?php echo esc_url( home_url( '/store/' ) ); ?>">Get Loop Bucks</a></div>
			<h2>Wallet activity</h2>
			<?php if ( $transactions ) : ?><div class="sml-wallet-history"><?php foreach ( $transactions as $transaction ) : ?>
				<div><span><b><?php echo esc_html( $transaction->note ?: ucfirst( $transaction->tx_type ) ); ?></b><small><?php echo esc_html( get_date_from_gmt( $transaction->created_at, get_option( 'date_format' ) . ' · ' . get_option( 'time_format' ) ) ); ?></small></span><strong class="<?php echo $transaction->amount > 0 ? 'is-credit' : 'is-debit'; ?>"><?php echo $transaction->amount > 0 ? '+' : ''; ?><?php echo esc_html( number_format_i18n( $transaction->amount ) ); ?> LB</strong></div>
			<?php endforeach; ?></div><?php else : ?><p>No wallet activity yet.</p><?php endif; ?>
		</section>
		<?php return ob_get_clean();
	}

	public function buddypress_profile_wallet() {
		if ( ! is_user_logged_in() || ! function_exists( 'bp_displayed_user_id' ) || get_current_user_id() !== (int) bp_displayed_user_id() ) return;
		wp_enqueue_style( 'sml-wallet' );
		echo '<div class="sml-profile-wallet"><span>MY WALLET</span><a href="' . esc_url( home_url( '/wallet/' ) ) . '"><strong>' . esc_html( number_format_i18n( self::balance( get_current_user_id() ) ) ) . '</strong> LB</a><a class="sml-profile-wallet__fund" href="' . esc_url( home_url( '/store/' ) ) . '">Get Loop Bucks</a></div>';
	}

	public function custom_profile_wallet() {
		if ( ! is_user_logged_in() ) return;
		wp_enqueue_style( 'sml-wallet' );
		?>
		<div class="sml-profile-wallet" id="sml-custom-profile-wallet" hidden><span>MY WALLET</span><a href="<?php echo esc_url( home_url( '/wallet/' ) ); ?>"><strong><?php echo esc_html( number_format_i18n( self::balance( get_current_user_id() ) ) ); ?></strong> LB</a><a class="sml-profile-wallet__fund" href="<?php echo esc_url( home_url( '/store/' ) ); ?>">Get Loop Bucks</a></div>
		<script>(function(){var card=document.getElementById('sml-custom-profile-wallet');var edit=document.querySelector('a[href*="customize-profile"]');if(card&&edit){card.hidden=false;edit.insertAdjacentElement('afterend',card);}}());</script>
		<?php
	}

	private function get_catalog() {
		global $wpdb;
		return $wpdb->get_results( 'SELECT * FROM ' . self::table( 'store_items' ) . " WHERE status='active' ORDER BY category,sort_order,id" );
	}

	private function get_bucks_products() {
		if ( ! function_exists( 'wc_get_product' ) ) return array();
		$ids = get_posts( array(
			'post_type' => 'product', 'post_status' => 'publish', 'posts_per_page' => 20,
			'orderby' => 'menu_order', 'order' => 'ASC', 'fields' => 'ids',
			'meta_query' => array( array( 'key' => '_sml_loop_bucks', 'value' => 0, 'compare' => '>', 'type' => 'NUMERIC' ) ),
		) );
		return array_values( array_filter( array_map( 'wc_get_product', $ids ) ) );
	}

	/* =====================================================================
	 * Loop Bucks ledger bridge
	 *
	 * The site has one real currency ledger, sml_lb_*. It owns the vault, the
	 * escrow, the audit trail, the earn rules and the leaderboard. This plugin
	 * shipped with a SECOND, private wallet table, so a member could hold 715
	 * LB in the ledger and 0 LB here - and every purchase failed for everyone.
	 *
	 * This bridge makes the ledger authoritative for balances and mutations
	 * while KEEPING this plugin's journal, because that journal carries the
	 * UNIQUE(user_id,tx_type,reference_type,reference_id) constraint that stops
	 * a retried WooCommerce webhook from crediting an order twice.
	 *
	 * It stays OFF until the ledger's debit contract has been proven by the
	 * self-test on the Loop Store admin screen. Until then every call falls
	 * through to the original code, so installing this build changes nothing.
	 * ================================================================== */

	private static function lb_present() {
		return function_exists( 'sml_lb_balance' ) && function_exists( 'sml_lb_move' );
	}

	/* The store's own transaction types mapped to ledger reasons. Registered
	   with the ledger through its documented `sml_lb_reasons` filter. */
	private static function lb_reason_map() {
		return array(
			'store_topup'      => array( 'flow' => 'issue',  'label' => 'Loop Bucks purchase' ),
			'store_spend'      => array( 'flow' => 'absorb', 'label' => 'Store purchase' ),
			'store_refund'     => array( 'flow' => 'issue',  'label' => 'Store refund' ),
			'store_adjust'     => array( 'flow' => 'issue',  'label' => 'Admin adjustment' ),
			'store_reward'     => array( 'flow' => 'issue',  'label' => 'Store reward' ),
			'store_chargeback' => array( 'flow' => 'absorb', 'label' => 'Payment reversed' ),
		);
	}

	private static function lb_reason( $type ) {
		$map = array(
			'purchase'   => 'store_topup',
			'spend'      => 'store_spend',
			'refund'     => 'store_refund',
			'adjustment' => 'store_adjust',
			'reward'     => 'store_reward',
			'chargeback' => 'store_chargeback',
		);
		$slug = isset( $map[ $type ] ) ? $map[ $type ] : 'store_adjust';
		$contract = self::lb_contract();
		/* If the self-test found the ledger rejects custom reasons, fall back to
		   the reason it confirmed rather than failing every transaction. */
		if ( $contract && ! empty( $contract['reason_override'] ) ) return $contract['reason_override'];
		return $slug;
	}

	/* Additive and shape-agnostic: the ledger's reason registry may be a list,
	   a slug => label map, or a slug => flow/label definition map. */
	public function register_lb_reasons( $reasons ) {
		if ( ! is_array( $reasons ) ) return $reasons;
		$assoc = array_keys( $reasons ) !== range( 0, count( $reasons ) - 1 );
		$definitions = false;
		if ( $assoc ) {
			foreach ( $reasons as $existing ) {
				if ( is_array( $existing ) && isset( $existing['flow'] ) ) {
					$definitions = true;
					break;
				}
			}
		}
		foreach ( self::lb_reason_map() as $slug => $definition ) {
			if ( $assoc ) {
				if ( ! isset( $reasons[ $slug ] ) ) {
					$reasons[ $slug ] = $definitions ? $definition : $definition['label'];
				}
			} elseif ( ! in_array( $slug, $reasons, true ) ) {
				$reasons[] = $slug;
			}
		}
		return $reasons;
	}

	public static function lb_contract() {
		$c = get_option( self::OPTION_LB_CONTRACT );
		if ( ! is_array( $c ) || empty( $c['mode'] ) ) return null;
		if ( ! in_array( $c['mode'], array( 'move', 'take_pay' ), true ) ) return null;
		return $c;
	}

	public static function lb_enabled() {
		return self::lb_present() && null !== self::lb_contract();
	}

	/**
	 * Apply a signed delta to the real ledger, then VERIFY it landed.
	 *
	 * The return value of the ledger function is never trusted: the balance is
	 * read before and after and the difference must equal the intended amount
	 * exactly. A mismatch returns WP_Error and the caller grants nothing.
	 */
	private static function lb_apply( $user_id, $amount, $type, $ref, $note ) {
		$contract = self::lb_contract();
		if ( ! $contract ) return new WP_Error( 'lb_unverified', 'The Loop Bucks ledger contract has not been verified yet.' );

		$before = (int) sml_lb_balance( $user_id );
		if ( $amount < 0 && ( $before + $amount ) < 0 && 'chargeback' !== $type ) {
			return new WP_Error( 'insufficient_funds', 'Not enough Loop Bucks.' );
		}

		$reason = self::lb_reason( $type );
		$meta   = array( 'source' => 'sml_store', 'tx_type' => $type, 'note' => (string) $note );

		if ( 'take_pay' === $contract['mode'] && $amount < 0 && function_exists( 'sml_lb_take' ) ) {
			$result = sml_lb_take( $user_id, abs( $amount ), $reason, $ref, $meta );
		} elseif ( 'take_pay' === $contract['mode'] && $amount > 0 && function_exists( 'sml_lb_pay' ) ) {
			$result = sml_lb_pay( $user_id, $amount, $reason, $ref, $meta );
		} else {
			$result = sml_lb_move( $user_id, $amount, $reason, $ref, $meta );
		}
		if ( is_wp_error( $result ) ) return $result;

		$after    = (int) sml_lb_balance( $user_id );
		$expected = $before + $amount;
		if ( $after !== $expected ) {
			return new WP_Error(
				'ledger_mismatch',
				sprintf( 'Ledger moved %d Loop Bucks, expected %d. Nothing was granted.', $after - $before, $amount ),
				array( 'status' => 500 )
			);
		}
		return $after;
	}

	public static function balance( $user_id ) {
		$user_id = absint( $user_id );
		if ( ! $user_id ) return 0;
		if ( self::lb_enabled() ) return (int) sml_lb_balance( $user_id );
		global $wpdb;
		$value = $wpdb->get_var( $wpdb->prepare( 'SELECT balance FROM ' . self::table( 'wallets' ) . ' WHERE user_id=%d', $user_id ) );
		return null === $value ? 0 : (int) $value;
	}

	public static function transact( $user_id, $amount, $type, $reference_type, $reference_id, $note = '', $created_by = 0 ) {
		global $wpdb;
		$user_id = absint( $user_id );
		$amount  = (int) $amount;
		if ( ! $user_id || 0 === $amount || ! in_array( $type, array( 'purchase', 'spend', 'refund', 'adjustment', 'reward', 'chargeback' ), true ) ) return new WP_Error( 'invalid_transaction', 'Invalid wallet transaction.' );

		if ( ! self::lb_enabled() ) {
			return self::transact_legacy( $user_id, $amount, $type, $reference_type, $reference_id, $note, $created_by );
		}

		$ref_type = sanitize_key( $reference_type );
		$ref_id   = sanitize_text_field( (string) $reference_id );
		$note     = sanitize_text_field( $note );

		/* 1. Claim the reference, and COMMIT that claim before touching the
		      ledger. sml_lb_* runs its own transaction on this same $wpdb
		      connection, and MySQL implicitly commits an outer transaction when
		      an inner START TRANSACTION begins - holding ours open across the
		      ledger call would silently commit a half-finished write. */
		$wpdb->query( 'START TRANSACTION' );
		$existing = $wpdb->get_row( $wpdb->prepare( 'SELECT id,note FROM ' . self::table( 'wallet_transactions' ) . ' WHERE user_id=%d AND tx_type=%s AND reference_type=%s AND reference_id=%s FOR UPDATE', $user_id, $type, $ref_type, $ref_id ) );
		if ( $existing ) {
			/* A completed row means this reference is already spent. A row still
			   marked pending is a crashed attempt whose money never moved, so it
			   is released and retried rather than swallowed. */
			if ( 0 !== strpos( (string) $existing->note, self::PENDING ) ) {
				$wpdb->query( 'ROLLBACK' );
				return new WP_Error( 'duplicate_transaction', 'This transaction was already recorded.' );
			}
			$wpdb->delete( self::table( 'wallet_transactions' ), array( 'id' => $existing->id ), array( '%d' ) );
		}
		$claimed = $wpdb->insert( self::table( 'wallet_transactions' ), array(
			'user_id' => $user_id, 'amount' => $amount, 'balance_after' => 0, 'tx_type' => $type,
			'reference_type' => $ref_type, 'reference_id' => $ref_id,
			'note' => self::PENDING . $note, 'created_by' => absint( $created_by ), 'created_at' => current_time( 'mysql', true ),
		), array( '%d','%d','%d','%s','%s','%s','%s','%d','%s' ) );
		if ( ! $claimed ) { $wpdb->query( 'ROLLBACK' ); return new WP_Error( 'transaction_failed', 'Wallet update failed.' ); }
		$claim_id = (int) $wpdb->insert_id;
		$wpdb->query( 'COMMIT' );

		/* 2. Move the money in the real ledger, verified. */
		$new_balance = self::lb_apply( $user_id, $amount, $type, $ref_type . ':' . $ref_id, $note );
		if ( is_wp_error( $new_balance ) ) {
			$wpdb->delete( self::table( 'wallet_transactions' ), array( 'id' => $claim_id ), array( '%d' ) );
			return $new_balance;
		}

		/* 3. Finalise the journal, and mirror the balance so the legacy wallets
		      table stays readable for anything not yet routed through here. */
		$wpdb->update( self::table( 'wallet_transactions' ), array( 'balance_after' => $new_balance, 'note' => $note ), array( 'id' => $claim_id ), array( '%d','%s' ), array( '%d' ) );
		$wpdb->query( $wpdb->prepare( 'INSERT INTO ' . self::table( 'wallets' ) . ' (user_id,balance,updated_at) VALUES (%d,%d,%s) ON DUPLICATE KEY UPDATE balance=VALUES(balance),updated_at=VALUES(updated_at)', $user_id, $new_balance, current_time( 'mysql', true ) ) );
		return $new_balance;
	}

	/* The original private-table ledger, unchanged. Used until the bridge is
	   verified, and as the fallback if the sml_lb_* functions ever disappear. */
	private static function transact_legacy( $user_id, $amount, $type, $reference_type, $reference_id, $note = '', $created_by = 0 ) {
		global $wpdb;
		$wpdb->query( 'START TRANSACTION' );
		$wpdb->query( $wpdb->prepare( 'INSERT IGNORE INTO ' . self::table( 'wallets' ) . ' (user_id,balance,updated_at) VALUES (%d,0,%s)', $user_id, current_time( 'mysql', true ) ) );
		$existing = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::table( 'wallet_transactions' ) . ' WHERE user_id=%d AND tx_type=%s AND reference_type=%s AND reference_id=%s FOR UPDATE', $user_id, $type, $reference_type, (string) $reference_id ) );
		if ( $existing ) { $wpdb->query( 'ROLLBACK' ); return new WP_Error( 'duplicate_transaction', 'This transaction was already recorded.' ); }
		$current = $wpdb->get_var( $wpdb->prepare( 'SELECT balance FROM ' . self::table( 'wallets' ) . ' WHERE user_id=%d FOR UPDATE', $user_id ) );
		$current = null === $current ? 0 : (int) $current;
		$new_balance = $current + $amount;
		if ( $new_balance < 0 && 'chargeback' !== $type ) { $wpdb->query( 'ROLLBACK' ); return new WP_Error( 'insufficient_funds', 'Not enough Loop Bucks.' ); }
		$ok = $wpdb->insert( self::table( 'wallet_transactions' ), array(
			'user_id' => $user_id, 'amount' => $amount, 'balance_after' => $new_balance, 'tx_type' => $type,
			'reference_type' => sanitize_key( $reference_type ), 'reference_id' => sanitize_text_field( (string) $reference_id ),
			'note' => sanitize_text_field( $note ), 'created_by' => absint( $created_by ), 'created_at' => current_time( 'mysql', true ),
		), array( '%d','%d','%d','%s','%s','%s','%s','%d','%s' ) );
		if ( ! $ok ) { $wpdb->query( 'ROLLBACK' ); return new WP_Error( 'transaction_failed', 'Wallet update failed.' ); }
		$updated = $wpdb->update( self::table( 'wallets' ), array( 'balance' => $new_balance, 'updated_at' => current_time( 'mysql', true ) ), array( 'user_id' => $user_id ), array( '%d','%s' ), array( '%d' ) );
		if ( false === $updated ) { $wpdb->query( 'ROLLBACK' ); return new WP_Error( 'transaction_failed', 'Wallet balance update failed.' ); }
		$wpdb->query( 'COMMIT' );
		return $new_balance;
	}

	public function register_rest_routes() {
		register_rest_route( 'sml-store/v1', '/catalog', array( 'methods' => 'GET', 'callback' => array( $this, 'rest_catalog' ), 'permission_callback' => '__return_true' ) );
		register_rest_route( 'sml-store/v1', '/wallet', array( 'methods' => 'GET', 'callback' => array( $this, 'rest_wallet' ), 'permission_callback' => 'is_user_logged_in' ) );
		register_rest_route( 'sml-store/v1', '/purchase', array( 'methods' => 'POST', 'callback' => array( $this, 'rest_purchase' ), 'permission_callback' => 'is_user_logged_in', 'args' => array( 'item_id' => array( 'required' => true, 'sanitize_callback' => 'absint' ) ) ) );
	}

	public function rest_catalog() { return rest_ensure_response( $this->get_catalog() ); }
	public function rest_wallet() { return rest_ensure_response( array( 'balance' => self::balance( get_current_user_id() ) ) ); }

	public function rest_purchase( WP_REST_Request $request ) {
		global $wpdb;
		$user_id = get_current_user_id();
		$item = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table( 'store_items' ) . " WHERE id=%d AND status='active'", $request['item_id'] ) );
		if ( ! $item ) return new WP_Error( 'not_found', 'Store item not found.', array( 'status' => 404 ) );
		if ( 'promotion' === $item->item_type ) return new WP_Error( 'target_required', 'Promotion checkout will open after a post or group target is selected.', array( 'status' => 409 ) );
		$owned = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::table( 'entitlements' ) . " WHERE user_id=%d AND item_id=%d AND owner_type='profile' AND owner_id=0 AND status='active'", $user_id, $item->id ) );
		if ( $owned && 'promotion' !== $item->item_type ) return new WP_Error( 'already_owned', 'You already own this item.', array( 'status' => 409 ) );
		$purchase_id = wp_generate_uuid4();
		$result = self::transact( $user_id, -1 * (int) $item->price_bucks, 'spend', 'store_item', $purchase_id, $item->name, $user_id );
		if ( is_wp_error( $result ) ) return $result;
		$granted = $wpdb->insert( self::table( 'entitlements' ), array( 'user_id'=>$user_id, 'item_id'=>$item->id, 'owner_type'=>'profile', 'owner_id'=>0, 'status'=>'active', 'source_type'=>'loop_bucks', 'source_id'=>$purchase_id, 'granted_at'=>current_time( 'mysql', true ) ), array( '%d','%d','%s','%d','%s','%s','%s','%s' ) );
		if ( ! $granted ) {
			self::transact( $user_id, (int) $item->price_bucks, 'refund', 'store_item', $purchase_id, 'Automatic refund: entitlement failed', 0 );
			return new WP_Error( 'grant_failed', 'The item could not be granted; your Loop Bucks were restored.', array( 'status' => 500 ) );
		}
		return rest_ensure_response( array( 'success'=>true, 'balance'=>$result, 'item'=>array( 'id'=>$item->id, 'name'=>$item->name ) ) );
	}

	public function admin_menu() {
		add_menu_page( 'Loop Store', 'Loop Store', 'manage_options', 'sml-store', array( $this, 'admin_page' ), 'dashicons-cart', 58 );
	}

	public function admin_page() {
		if ( ! current_user_can( 'manage_options' ) ) return;
		$items = $this->get_catalog();
		?>
		<div class="wrap"><h1>StockMarketLoop Store</h1><p>Version <?php echo esc_html( self::VERSION ); ?> · Catalog, wallet adjustments, and fulfillment.</p>
		<h2>Payment services</h2>
		<?php $this->render_payment_status(); ?>
		<h2>Loop Bucks ledger</h2>
		<?php $this->render_ledger_status(); ?>
		<h2>Loop Bucks packages</h2>
		<?php if ( function_exists( 'wc_get_products' ) ) : ?>
		<p>Create the seven Loop Bucks packages from the approved Store design as WooCommerce drafts. Review them, then publish when checkout is ready.</p>
		<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><?php wp_nonce_field('sml_store_create_bucks_products'); ?><input type="hidden" name="action" value="sml_store_create_bucks_products"><?php submit_button('Create Loop Bucks package drafts', 'secondary'); ?></form>
		<?php else : ?><p><strong>WooCommerce is required</strong> to sell Loop Bucks for real money.</p><?php endif; ?>
		<h2>Catalog</h2><table class="widefat striped"><thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>Type</th><th>Price</th></tr></thead><tbody><?php foreach($items as $item): ?><tr><td><code><?php echo esc_html($item->sku); ?></code></td><td><?php echo esc_html($item->name); ?></td><td><?php echo esc_html($item->category); ?></td><td><?php echo esc_html($item->item_type); ?></td><td><?php echo esc_html(number_format_i18n($item->price_bucks)); ?> LB</td></tr><?php endforeach; ?></tbody></table>
		<h2>Wallet adjustment</h2><p>All adjustments are permanently recorded in the ledger.</p><form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><?php wp_nonce_field('sml_store_adjust_wallet'); ?><input type="hidden" name="action" value="sml_store_adjust_wallet"><table class="form-table"><tr><th>User ID</th><td><input name="user_id" type="number" min="1" required></td></tr><tr><th>Amount</th><td><input name="amount" type="number" required> <span>Use a negative value to debit.</span></td></tr><tr><th>Reason</th><td><input name="reason" class="regular-text" required></td></tr></table><?php submit_button('Record adjustment'); ?></form></div>
		<?php
	}

	private function render_payment_status() {
		if ( ! class_exists( 'WooCommerce' ) ) {
			echo '<div class="notice notice-warning inline"><p><strong>WooCommerce is not active.</strong> Install and activate WooCommerce before connecting a payment service.</p></div>';
			return;
		}
		$gateways = WC()->payment_gateways()->payment_gateways();
		$enabled = array_filter( $gateways, function( $gateway ) { return 'yes' === $gateway->enabled; } );
		echo '<p><strong>WooCommerce:</strong> Connected · <strong>Enabled gateways:</strong> ' . esc_html( $enabled ? implode( ', ', wp_list_pluck( $enabled, 'title' ) ) : 'None yet' ) . '</p>';
		echo '<p><a class="button button-primary" href="' . esc_url( admin_url( 'admin.php?page=wc-settings&tab=checkout' ) ) . '">Connect or manage payment services</a> <a class="button" href="' . esc_url( admin_url( 'plugin-install.php?s=woocommerce+stripe&tab=search&type=term' ) ) . '">Add Stripe / card payments</a></p>';
		echo '<p class="description">Use a WooCommerce gateway so cards, Apple Pay, Google Pay, PayPal, taxes, receipts, refunds, and payment webhooks stay in one order system. Loop Bucks are credited only when WooCommerce marks the order paid.</p>';
	}

	private function render_ledger_status() {
		$present  = self::lb_present();
		$contract = self::lb_contract();
		$result   = isset( $_GET['sml_lb'] ) ? sanitize_key( wp_unslash( $_GET['sml_lb'] ) ) : '';

		if ( $result ) {
			$start = isset( $_GET['sml_lb_start'] ) ? (int) $_GET['sml_lb_start'] : null;
			$end   = isset( $_GET['sml_lb_end'] ) ? (int) $_GET['sml_lb_end'] : null;
			$msg   = isset( $_GET['sml_lb_msg'] ) ? sanitize_text_field( rawurldecode( wp_unslash( $_GET['sml_lb_msg'] ) ) ) : '';
			$drift = ( null !== $start && null !== $end ) ? $end - $start : 0;
			$class = ( 'ok' === $result ) ? 'notice-success' : 'notice-error';
			echo '<div class="notice ' . esc_attr( $class ) . '"><p>';
			if ( 'ok' === $result ) {
				echo '<strong>Self-test passed.</strong> Debits apply through <code>' . esc_html( sanitize_key( wp_unslash( $_GET['sml_lb_mode'] ?? '' ) ) ) . '</code>. The store now uses the real Loop Bucks ledger.';
			} elseif ( 'absent' === $result ) {
				echo '<strong>The Loop Bucks ledger was not found.</strong> <code>sml_lb_balance</code> and <code>sml_lb_move</code> must both exist.';
			} elseif ( 'credit_failed' === $result ) {
				echo '<strong>The ledger would not accept a credit.</strong> ' . esc_html( $msg );
			} else {
				echo '<strong>The ledger would not accept a debit.</strong> ' . esc_html( $msg ) . ' Nothing was switched over.';
			}
			if ( null !== $start && null !== $end ) {
				echo ' Your balance went ' . (int) $start . ' to ' . (int) $end . '.';
				if ( 0 !== $drift ) echo ' <strong>It should have returned to ' . (int) $start . ' - the difference of ' . ( $drift > 0 ? '+' : '' ) . (int) $drift . ' LB needs correcting by hand.</strong>';
			}
			echo '</p></div>';
		}

		if ( ! $present ) {
			echo '<p>The <code>sml_lb_*</code> ledger functions are not loaded. The store is using its own private wallet.</p>';
			return;
		}
		if ( $contract ) {
			echo '<p><span style="color:#1a7f37">&#10003;</span> <strong>Connected to the real ledger.</strong> Debit mode <code>' . esc_html( $contract['mode'] ) . '</code>';
			if ( ! empty( $contract['reason_override'] ) ) echo ', logging as <code>' . esc_html( $contract['reason_override'] ) . '</code>';
			echo ', verified ' . esc_html( $contract['verified_at'] ) . '.</p>';
			echo '<p>Balances shown anywhere in the store are now the same Loop Bucks as the leaderboard, earn rules and vault.</p>';
			return;
		}

		echo '<p><strong>Not connected yet.</strong> The store is still reading its own private wallet, which is why members see 0 LB here while the leaderboard shows their real balance.</p>';
		echo '<p>The self-test credits 1 LB to your own account, checks it landed, then takes it back - a net-zero pair - to establish how this ledger applies a debit. Nothing switches over unless both halves verify.</p>';
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( 'sml_store_lb_selftest' );
		echo '<input type="hidden" name="action" value="sml_store_lb_selftest">';
		submit_button( 'Run ledger self-test', 'primary', 'submit', false );
		echo '</form>';
	}

	public function admin_save_item() { wp_die( 'Catalog editing UI is scheduled for v0.2.' ); }

	public function admin_adjust_wallet() {
		if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Not allowed.' );
		check_admin_referer( 'sml_store_adjust_wallet' );
		$result = self::transact( absint($_POST['user_id'] ?? 0), (int)($_POST['amount'] ?? 0), 'adjustment', 'admin', wp_generate_uuid4(), sanitize_text_field($_POST['reason'] ?? ''), get_current_user_id() );
		wp_safe_redirect( add_query_arg( 'sml_result', is_wp_error($result) ? 'error' : 'success', admin_url('admin.php?page=sml-store') ) ); exit;
	}

	/**
	 * Establish how the ledger applies a debit, empirically.
	 *
	 * The sml_lb_* engine could not be read from here, so the contract is
	 * proven rather than assumed: this credits 1 LB to the administrator's own
	 * account, verifies it landed, then debits 1 LB and verifies again - first
	 * with a signed sml_lb_move, and failing that with sml_lb_take. The pair is
	 * net zero. Start and end balances are reported either way, so any drift is
	 * visible instead of silent.
	 *
	 * Until this passes, lb_enabled() is false and the store keeps using its
	 * original private wallet exactly as before.
	 */
	public function admin_lb_selftest() {
		if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Not allowed.' );
		check_admin_referer( 'sml_store_lb_selftest' );
		$back = admin_url( 'admin.php?page=sml-store' );

		if ( ! self::lb_present() ) {
			wp_safe_redirect( add_query_arg( 'sml_lb', 'absent', $back ) ); exit;
		}

		$uid   = get_current_user_id();
		$start = (int) sml_lb_balance( $uid );
		$tag   = 'store_selftest:' . wp_generate_uuid4();

		/* Credit 1 LB. If the ledger validates reasons and rejects ours, retry
		   with one it already uses and remember that for live traffic. */
		$override = '';
		$credit   = self::lb_probe( $uid, 1, $tag . ':c1', 'store_topup' );
		if ( ! $credit['ok'] ) {
			$override = 'bonus';
			$credit   = self::lb_probe( $uid, 1, $tag . ':c2', $override );
		}
		if ( ! $credit['ok'] ) {
			wp_safe_redirect( add_query_arg( array(
				'sml_lb' => 'credit_failed', 'sml_lb_msg' => rawurlencode( $credit['msg'] ),
				'sml_lb_start' => $start, 'sml_lb_end' => (int) sml_lb_balance( $uid ),
			), $back ) ); exit;
		}

		$spend_reason = $override ? $override : 'store_spend';
		$mode         = '';

		$debit = self::lb_probe( $uid, -1, $tag . ':d1', $spend_reason );
		if ( $debit['ok'] ) {
			$mode = 'move';
		} elseif ( function_exists( 'sml_lb_take' ) ) {
			$before = (int) sml_lb_balance( $uid );
			$taken  = sml_lb_take( $uid, 1, $spend_reason, $tag . ':d2', array( 'source' => 'sml_store', 'selftest' => 1 ) );
			$after  = (int) sml_lb_balance( $uid );
			if ( ! is_wp_error( $taken ) && $after === $before - 1 ) $mode = 'take_pay';
		}

		$end = (int) sml_lb_balance( $uid );
		if ( ! $mode ) {
			wp_safe_redirect( add_query_arg( array(
				'sml_lb' => 'debit_failed', 'sml_lb_msg' => rawurlencode( $debit['msg'] ),
				'sml_lb_start' => $start, 'sml_lb_end' => $end,
			), $back ) ); exit;
		}

		update_option( self::OPTION_LB_CONTRACT, array(
			'mode' => $mode, 'reason_override' => $override,
			'verified_at' => current_time( 'mysql', true ), 'by' => $uid,
			'start_balance' => $start, 'end_balance' => $end,
		) );

		wp_safe_redirect( add_query_arg( array(
			'sml_lb' => 'ok', 'sml_lb_mode' => $mode,
			'sml_lb_start' => $start, 'sml_lb_end' => $end,
		), $back ) ); exit;
	}

	/* One movement, then read the balance back. The ledger's return value is
	   only half the answer; the balance delta is the other half. */
	private static function lb_probe( $uid, $delta, $ref, $reason ) {
		$before = (int) sml_lb_balance( $uid );
		$result = sml_lb_move( $uid, $delta, $reason, $ref, array( 'source' => 'sml_store', 'selftest' => 1 ) );
		$after  = (int) sml_lb_balance( $uid );
		return array(
			'ok'  => ! is_wp_error( $result ) && $after === $before + $delta,
			'msg' => is_wp_error( $result ) ? $result->get_error_message() : sprintf( 'balance went %d to %d', $before, $after ),
		);
	}

	public function admin_create_bucks_products() {
		if ( ! current_user_can( 'manage_woocommerce' ) && ! current_user_can( 'manage_options' ) ) wp_die( 'Not allowed.' );
		check_admin_referer( 'sml_store_create_bucks_products' );
		if ( ! class_exists( 'WC_Product_Simple' ) ) wp_die( 'WooCommerce must be active.' );
		$packs = array(
			array( 'Loop Bucks · 500', 500, '5.00' ), array( 'Loop Bucks · 1,200', 1200, '10.00' ),
			array( 'Loop Bucks · 2,000', 2000, '15.00' ), array( 'Loop Bucks · 3,000', 3000, '20.00' ),
			array( 'Loop Bucks · 5,000', 5000, '25.00' ), array( 'Loop Bucks · 15,000', 15000, '50.00' ),
			array( 'Loop Bucks · 35,000', 35000, '100.00' ),
		);
		foreach ( $packs as $index => $pack ) {
			$existing = wc_get_products( array( 'limit'=>1, 'status'=>array('draft','publish','private'), 'sku'=>'sml-lb-' . $pack[1] ) );
			if ( $existing ) continue;
			$product = new WC_Product_Simple();
			$product->set_name( $pack[0] ); $product->set_sku( 'sml-lb-' . $pack[1] ); $product->set_status( 'draft' );
			$product->set_regular_price( $pack[2] ); $product->set_virtual( true ); $product->set_sold_individually( true );
			$product->set_menu_order( $index + 1 );
			$product->set_short_description( number_format_i18n( $pack[1] ) . ' closed-loop credits for use on StockMarketLoop.' );
			$product->update_meta_data( '_sml_loop_bucks', $pack[1] ); $product->save();
		}
		wp_safe_redirect( admin_url( 'edit.php?post_type=product' ) ); exit;
	}

	public function fulfill_woocommerce_order( $order_id ) {
		if ( ! function_exists( 'wc_get_order' ) ) return;
		$order = wc_get_order( $order_id );
		if ( ! $order || ! $order->get_user_id() || $order->get_meta( '_sml_store_fulfilled' ) ) return;
		$credited = 0;
		foreach ( $order->get_items() as $line ) {
			$bucks = absint( get_post_meta( $line->get_product_id(), '_sml_loop_bucks', true ) );
			if ( $bucks ) $credited += $bucks * max( 1, $line->get_quantity() );
		}
		if ( $credited ) {
			$result = self::transact( $order->get_user_id(), $credited, 'purchase', 'woocommerce_order', $order_id, 'Loop Bucks purchase', 0 );
			if ( is_wp_error( $result ) && 'duplicate_transaction' !== $result->get_error_code() ) { $order->add_order_note( 'Loop Bucks fulfillment failed: ' . $result->get_error_message() ); return; }
		}
		$order->update_meta_data( '_sml_store_fulfilled', current_time( 'mysql', true ) );
		$order->update_meta_data( '_sml_store_bucks_credited', $credited );
		$order->save();
	}

	public function require_account_for_bucks( $passed, $product_id, $quantity ) {
		if ( $passed && ! is_user_logged_in() && absint( get_post_meta( $product_id, '_sml_loop_bucks', true ) ) ) {
			wc_add_notice( 'Please sign in or create an account before buying Loop Bucks so they can be delivered to your wallet.', 'error' );
			return false;
		}
		return $passed;
	}

	public function woo_product_field() {
		if ( ! function_exists( 'woocommerce_wp_text_input' ) ) return;
		woocommerce_wp_text_input( array(
			'id' => '_sml_loop_bucks',
			'label' => 'Loop Bucks credited',
			'description' => 'For Loop Bucks pack products only. Enter the whole number of Bucks granted after payment.',
			'desc_tip' => true,
			'type' => 'number',
			'custom_attributes' => array( 'min' => '0', 'step' => '1' ),
		) );
	}

	public function woo_save_product_field( $product ) {
		if ( ! isset( $_POST['_sml_loop_bucks'] ) ) return;
		$product->update_meta_data( '_sml_loop_bucks', absint( wp_unslash( $_POST['_sml_loop_bucks'] ) ) );
	}

	public function reverse_woocommerce_refund( $order_id, $refund_id ) {
		if ( ! function_exists( 'wc_get_order' ) ) return;
		$order = wc_get_order( $order_id );
		$refund = wc_get_order( $refund_id );
		if ( ! $order || ! $refund || ! $order->get_user_id() ) return;
		$reversed = 0;
		foreach ( $refund->get_items() as $line ) {
			$bucks = absint( get_post_meta( $line->get_product_id(), '_sml_loop_bucks', true ) );
			if ( $bucks ) $reversed += $bucks * absint( $line->get_quantity() );
		}
		if ( ! $reversed ) return;
		$result = self::transact( $order->get_user_id(), -$reversed, 'chargeback', 'woocommerce_refund', $refund_id, 'Refunded Loop Bucks order #' . $order_id, 0 );
		if ( is_wp_error( $result ) ) $order->add_order_note( 'Loop Bucks could not be reversed automatically: ' . $result->get_error_message() );
		else $order->add_order_note( number_format_i18n( $reversed ) . ' Loop Bucks reversed for refund #' . $refund_id . '.' );
	}
}

SML_Store::instance();
