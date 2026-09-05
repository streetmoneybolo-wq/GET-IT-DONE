<?php
/**
 * Plugin Name: SML Connect Migration Hub
 * Description: StockMarketLoop Connect owner dashboard, bot-first Discord onboarding, public indexed Discord group pages, and subscriber migration flow for replacing Upgrade.Chat-style memberships.
 * Version: 0.1.7
 * Author: Stock Market Loop
 */

defined( 'ABSPATH' ) || exit;

const SMLCMH_VERSION = '0.1.7';
const SMLCMH_OPTION  = 'sml_connect_migration_hub_options';

function smlcmh_defaults() {
	return array(
		'api_url'    => defined( 'SML_PLATFORM_API_URL' ) ? untrailingslashit( (string) SML_PLATFORM_API_URL ) : 'https://sml-platform-api.onrender.com',
		'api_secret' => defined( 'SML_PLATFORM_BILLING_API_SECRET' ) ? (string) SML_PLATFORM_BILLING_API_SECRET : '',
		'discord_app_id'    => defined( 'SML_DISCORD_CONNECT_APP_ID' ) ? (string) SML_DISCORD_CONNECT_APP_ID : '1537698927401377894',
		'discord_permissions' => '268504064',
		'create_group_url'  => home_url( '/groups/create/' ),
	);
}

function smlcmh_options() {
	return wp_parse_args( get_option( SMLCMH_OPTION, array() ), smlcmh_defaults() );
}

function smlcmh_api_url() {
	$options = smlcmh_options();
	$url     = isset( $options['api_url'] ) ? untrailingslashit( esc_url_raw( $options['api_url'] ) ) : '';
	return $url ? $url : 'https://sml-platform-api.onrender.com';
}

function smlcmh_api_secret() {
	$options = smlcmh_options();
	return isset( $options['api_secret'] ) ? trim( (string) $options['api_secret'] ) : '';
}

function smlcmh_signature( $timestamp, $body, $secret ) {
	return 'sha256=' . hash_hmac( 'sha256', $timestamp . '.' . $body, $secret );
}

function smlcmh_platform_post( $path, array $data ) {
	$secret = smlcmh_api_secret();
	if ( '' === $secret ) {
		return new WP_Error( 'smlcmh_unconfigured', 'SML Connect is missing the platform API secret.' );
	}
	$body      = wp_json_encode( $data );
	$timestamp = (string) time();
	$response  = wp_remote_post( smlcmh_api_url() . $path, array(
		'timeout' => 25,
		'headers' => array(
			'Content-Type'    => 'application/json',
			'X-SML-Timestamp' => $timestamp,
			'X-SML-Signature' => smlcmh_signature( $timestamp, $body, $secret ),
		),
		'body'    => $body,
	) );
	return smlcmh_decode_response( $response, 'SML Connect platform request failed.' );
}

function smlcmh_platform_get( $path ) {
	$response = wp_remote_get( smlcmh_api_url() . $path, array( 'timeout' => 20 ) );
	return smlcmh_decode_response( $response, 'SML Connect public page is unavailable.' );
}

function smlcmh_decode_response( $response, $fallback ) {
	if ( is_wp_error( $response ) ) return $response;
	$code = wp_remote_retrieve_response_code( $response );
	$body = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( $code >= 300 || ! is_array( $body ) || empty( $body['ok'] ) ) {
		$message = is_array( $body ) && isset( $body['message'] )
			? sanitize_text_field( $body['message'] )
			: ( is_array( $body ) && isset( $body['error'] ) ? sanitize_text_field( $body['error'] ) : $fallback );
		return new WP_Error( 'smlcmh_api_failed', $message, array( 'status' => $code ) );
	}
	return $body;
}

function smlcmh_can_manage_group( $group_id ) {
	if ( current_user_can( 'manage_options' ) ) return true;
	if ( function_exists( 'sml_dgc_can_manage' ) ) {
		try {
			if ( sml_dgc_can_manage( absint( $group_id ) ) ) return true;
		} catch ( Throwable $e ) {
			error_log( 'SML Connect manage check failed: sml_dgc_can_manage' );
		}
	}
	if ( function_exists( 'sml_platform_can_manage_group_billing' ) ) {
		try {
			if ( sml_platform_can_manage_group_billing( absint( $group_id ) ) ) return true;
		} catch ( Throwable $e ) {
			error_log( 'SML Connect manage check failed: sml_platform_can_manage_group_billing' );
		}
	}
	return false;
}

function smlcmh_clean_snowflake( $value ) {
	$value = preg_replace( '/\D/', '', (string) $value );
	return preg_match( '/^[0-9]{15,24}$/', $value ) ? $value : '';
}

function smlcmh_clean_url( $value ) {
	$value = esc_url_raw( trim( (string) $value ) );
	return $value && 0 === strpos( $value, 'https://' ) ? $value : '';
}

function smlcmh_current_owner_id( $input ) {
	$owner = isset( $input['ownerUserId'] ) ? absint( $input['ownerUserId'] ) : 0;
	return $owner ? $owner : get_current_user_id();
}

function smlcmh_group_slug_default( $group_id ) {
	$title = '';
	if ( function_exists( 'sml_dgc_tables' ) ) {
		global $wpdb;
		$tables = sml_dgc_tables();
		if ( isset( $tables['groups'] ) ) {
			$title = (string) $wpdb->get_var( $wpdb->prepare( "SELECT name FROM {$tables['groups']} WHERE id=%d", absint( $group_id ) ) );
		}
	}
	$slug = sanitize_title( $title );
	return $slug ? $slug : 'group-' . absint( $group_id );
}

function smlcmh_public_url( $slug = '' ) {
	$base = home_url( '/connect/' );
	return $slug ? trailingslashit( $base . sanitize_title( $slug ) ) : $base;
}

function smlcmh_discord_install_url() {
	$options     = smlcmh_options();
	$app_id      = preg_replace( '/\D/', '', (string) ( $options['discord_app_id'] ?? '' ) );
	$permissions = preg_replace( '/\D/', '', (string) ( $options['discord_permissions'] ?? '268504064' ) );
	if ( '' === $app_id ) return 'https://discord.com/developers/applications';
	return add_query_arg(
		array(
			'client_id'   => $app_id,
			'permissions' => '' === $permissions ? '268504064' : $permissions,
			'scope'       => 'bot applications.commands',
		),
		'https://discord.com/oauth2/authorize'
	);
}

function smlcmh_create_group_url( $guild_name = '' ) {
	$options = smlcmh_options();
	$base    = ! empty( $options['create_group_url'] ) ? esc_url_raw( $options['create_group_url'] ) : home_url( '/groups/create/' );
	$args    = array( 'sml_connect' => '1' );
	if ( '' !== trim( (string) $guild_name ) ) {
		$args['default_name'] = sanitize_text_field( $guild_name );
	}
	return add_query_arg( $args, $base );
}

function smlcmh_signup_url( $guild_name = '' ) {
	return add_query_arg(
		array(
			'sml_connect' => '1',
			'redirect_to' => smlcmh_create_group_url( $guild_name ),
		),
		home_url( '/register/' )
	);
}

/* -------------------------------------------------------------------------
 * Activation: create helpful pages but keep all rendering shortcode-driven.
 * ---------------------------------------------------------------------- */

function smlcmh_ensure_page( $slug, $title, $content ) {
	$existing = get_page_by_path( $slug );
	if ( $existing ) return (int) $existing->ID;
	return (int) wp_insert_post( array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_name'    => $slug,
		'post_title'   => $title,
		'post_content' => $content,
	) );
}

function smlcmh_activate() {
	update_option( SMLCMH_OPTION, smlcmh_options(), false );
	smlcmh_install_pages();
	smlcmh_rewrite_rules();
	flush_rewrite_rules();
	update_option( 'smlcmh_version', SMLCMH_VERSION, false );
}
register_activation_hook( __FILE__, 'smlcmh_activate' );

function smlcmh_install_pages() {
	smlcmh_ensure_page( 'connect', 'StockMarketLoop Connect', '[sml_connect_landing]' );
	smlcmh_ensure_page( 'connect-dashboard', 'StockMarketLoop Connect Dashboard', '[sml_connect_dashboard]' );
	smlcmh_ensure_page( 'connect-migrate', 'Move Your Discord Membership to StockMarketLoop', '[sml_connect_migrate]' );
}

function smlcmh_deactivate() {
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, 'smlcmh_deactivate' );

function smlcmh_rewrite_rules() {
	add_rewrite_tag( '%sml_connect_slug%', '([^&]+)' );
	add_rewrite_rule( '^connect/([^/]+)/?$', 'index.php?sml_connect_slug=$matches[1]', 'top' );
}
add_action( 'init', 'smlcmh_rewrite_rules' );

add_filter( 'query_vars', function ( $vars ) {
	$vars[] = 'sml_connect_slug';
	return $vars;
} );

/* -------------------------------------------------------------------------
 * Assets
 * ---------------------------------------------------------------------- */

function smlcmh_enqueue_assets() {
	wp_register_style(
		'sml-connect-migration-hub',
		plugins_url( 'assets/sml-connect-migration-hub.css', __FILE__ ),
		array(),
		SMLCMH_VERSION
	);
	wp_register_script(
		'sml-connect-migration-hub',
		plugins_url( 'assets/sml-connect-migration-hub.js', __FILE__ ),
		array(),
		SMLCMH_VERSION,
		true
	);
	wp_localize_script( 'sml-connect-migration-hub', 'SMLConnectHub', array(
		'restUrl'   => esc_url_raw( rest_url( 'sml-connect/v1/' ) ),
		'nonce'     => wp_create_nonce( 'wp_rest' ),
		'currentId' => get_current_user_id(),
		'publicUrl' => smlcmh_public_url(),
		'createGroupUrl' => esc_url_raw( smlcmh_create_group_url() ),
		'signupUrl' => esc_url_raw( smlcmh_signup_url() ),
		'isLoggedIn' => is_user_logged_in(),
	) );
}
add_action( 'wp_enqueue_scripts', 'smlcmh_enqueue_assets' );
add_action( 'admin_enqueue_scripts', 'smlcmh_enqueue_assets' );

function smlcmh_use_assets() {
	wp_enqueue_style( 'sml-connect-migration-hub' );
	wp_enqueue_script( 'sml-connect-migration-hub' );
}

/* -------------------------------------------------------------------------
 * Admin screen
 * ---------------------------------------------------------------------- */

add_action( 'admin_menu', function () {
	add_menu_page(
		'SML Connect',
		'SML Connect',
		'manage_options',
		'sml-connect-hub',
		'smlcmh_admin_page',
		'dashicons-networking',
		59
	);
} );

function smlcmh_admin_page() {
	if ( ! current_user_can( 'manage_options' ) ) wp_die( esc_html__( 'Insufficient permissions.', 'sml-connect' ) );
	smlcmh_use_assets();
	$options = smlcmh_options();
	?>
	<div class="wrap smlcmh-admin">
		<h1>StockMarketLoop Connect</h1>
		<p>Bot-first onboarding: install StockMarketLoop Connect into Discord, detect or ask about Upgrade.Chat, offer a no-double-billing migration, then create a StockMarketLoop group named exactly like the Discord server.</p>
		<form method="post" action="options.php" class="smlcmh-card smlcmh-settings">
			<?php settings_fields( 'smlcmh_settings' ); ?>
			<h2>Platform connection</h2>
			<p class="description">Uses the same Render platform API and billing secret. Do not expose this secret in browser JavaScript.</p>
			<label>Platform API URL
				<input class="regular-text" type="url" name="<?php echo esc_attr( SMLCMH_OPTION ); ?>[api_url]" value="<?php echo esc_attr( $options['api_url'] ); ?>" required>
			</label>
			<label>Billing API secret
				<input class="regular-text code" type="password" name="<?php echo esc_attr( SMLCMH_OPTION ); ?>[api_secret]" value="<?php echo esc_attr( $options['api_secret'] ); ?>">
			</label>
			<label>Discord Connect application ID
				<input class="regular-text code" type="text" name="<?php echo esc_attr( SMLCMH_OPTION ); ?>[discord_app_id]" value="<?php echo esc_attr( $options['discord_app_id'] ); ?>">
			</label>
			<label>Discord bot permissions integer
				<input class="regular-text code" type="text" name="<?php echo esc_attr( SMLCMH_OPTION ); ?>[discord_permissions]" value="<?php echo esc_attr( $options['discord_permissions'] ); ?>">
			</label>
			<label>StockMarketLoop group creation URL
				<input class="regular-text" type="url" name="<?php echo esc_attr( SMLCMH_OPTION ); ?>[create_group_url]" value="<?php echo esc_attr( $options['create_group_url'] ); ?>">
			</label>
			<?php submit_button( 'Save Connect settings' ); ?>
		</form>
		<?php echo do_shortcode( '[sml_connect_dashboard]' ); ?>
	</div>
	<?php
}

add_action( 'admin_init', function () {
	register_setting( 'smlcmh_settings', SMLCMH_OPTION, array(
		'type'              => 'array',
		'sanitize_callback' => 'smlcmh_sanitize_options',
	) );
} );

function smlcmh_sanitize_options( $input ) {
	$current = smlcmh_options();
	$output  = $current;
	if ( isset( $input['api_url'] ) ) $output['api_url'] = untrailingslashit( esc_url_raw( $input['api_url'] ) );
	if ( isset( $input['api_secret'] ) ) $output['api_secret'] = sanitize_text_field( wp_unslash( $input['api_secret'] ) );
	if ( isset( $input['discord_app_id'] ) ) $output['discord_app_id'] = preg_replace( '/\D/', '', (string) wp_unslash( $input['discord_app_id'] ) );
	if ( isset( $input['discord_permissions'] ) ) $output['discord_permissions'] = preg_replace( '/\D/', '', (string) wp_unslash( $input['discord_permissions'] ) );
	if ( isset( $input['create_group_url'] ) ) $output['create_group_url'] = esc_url_raw( wp_unslash( $input['create_group_url'] ) );
	return $output;
}

/* -------------------------------------------------------------------------
 * Shortcodes
 * ---------------------------------------------------------------------- */

add_shortcode( 'sml_connect_landing', function () {
	smlcmh_use_assets();
	$install_url = smlcmh_discord_install_url();
	$signup_url  = smlcmh_signup_url();
	$group_url   = smlcmh_create_group_url();
	ob_start();
	?>
	<section class="smlcmh-shell smlcmh-landing">
		<div class="smlcmh-hero">
			<p class="smlcmh-kicker">StockMarketLoop Connect</p>
			<h1>Install the StockMarketLoop Connect Bot first.</h1>
			<p>The Discord owner installs the bot first, runs <code>/connect-setup</code>, answers the yes/no buttons inside Discord, maps products/roles/plans on StockMarketLoop, then sends members their own migration checkout link.</p>
			<div class="smlcmh-actions">
				<a class="smlcmh-btn smlcmh-btn-gold" href="<?php echo esc_url( $install_url ); ?>" target="_blank" rel="noopener">1. Install StockMarketLoop Connect Bot</a>
				<a class="smlcmh-btn" href="<?php echo esc_url( home_url( '/connect-dashboard/' ) ); ?>">Owner dashboard</a>
			</div>
		</div>
		<div class="smlcmh-card smlcmh-flow-card">
			<p class="smlcmh-kicker">Owner setup flow</p>
			<h2>The migration starts with a button, but each member confirms their own billing.</h2>
			<div class="smlcmh-step">
				<strong>1. Run <code>/connect-setup</code> in the Discord server.</strong>
				<p>The bot detects the server ID and, when available from Discord, the server name.</p>
			</div>
			<div class="smlcmh-step">
				<strong>2. The bot asks: “Do you use Upgrade.Chat?”</strong>
				<p>If yes, it offers migration with no migration fee, no double billing, and the same verified next payment date. If no, it skips migration.</p>
			</div>
			<div class="smlcmh-step">
				<strong>3. Owner maps the migration on StockMarketLoop.</strong>
				<p class="smlcmh-muted">The owner connects/logs into StockMarketLoop, maps Upgrade.Chat products, Discord roles, and StockMarketLoop subscription plans, then publishes the migration link.</p>
			</div>
			<div class="smlcmh-step">
				<strong>4. Members opt in and keep access.</strong>
				<p class="smlcmh-muted">Each member clicks their migration link, confirms Discord, accepts StockMarketLoop billing, keeps their role active, and starts the SML subscription on the same verified next billing date.</p>
			</div>
			<div class="smlcmh-step">
				<strong>5. StockMarketLoop takes over after migration.</strong>
				<p class="smlcmh-muted">After migration, StockMarketLoop controls billing, Discord roles, analytics, dispute evidence, storefront, live pages, Loop Letters, and Retail Trader Spotlight.</p>
			</div>
		</div>
		<div class="smlcmh-grid">
			<div class="smlcmh-card"><h3>Bot first, migration second</h3><p>The Discord owner installs StockMarketLoop Connect before any migration, so role sync, security, and server detection can start from the actual Discord server.</p></div>
			<div class="smlcmh-card"><h3>Ask when detection is unclear</h3><p>If Upgrade.Chat cannot be detected, the bot asks the owner whether they use it, then shows the correct migration or non-migration path.</p></div>
			<div class="smlcmh-card"><h3>Exact Discord name by default</h3><p>When the owner creates a StockMarketLoop group, the default name is the Discord server name so branding stays stable.</p></div>
			<div class="smlcmh-card"><h3>Perks unlock with SML</h3><p>Connect can become the Upgrade.Chat alternative plus public homepage, live page, store, Loop Letter, analytics, roles, dispute defense, and Retail Trader Spotlight.</p></div>
		</div>
		<?php if ( is_user_logged_in() ) : ?>
			<div class="smlcmh-card">
				<p class="smlcmh-kicker">Logged-in owner tools</p>
				<h2>Set up memberships, prices, intervals, products, and roles here.</h2>
				<p class="smlcmh-muted">This is the no-code setup area: create the Discord homepage, build subscription products, and map Upgrade.Chat migration details without pasting developer JSON.</p>
			</div>
			<?php echo do_shortcode( '[sml_connect_dashboard]' ); ?>
		<?php else : ?>
			<div class="smlcmh-card">
				<h2>Ready to migrate your Discord memberships?</h2>
				<p class="smlcmh-muted">Sign in or create a StockMarketLoop account after installing the bot, then the owner dashboard appears here automatically.</p>
				<a class="smlcmh-btn smlcmh-btn-gold" href="<?php echo esc_url( $signup_url ); ?>">Create or sign in to StockMarketLoop</a>
			</div>
		<?php endif; ?>
	</section>
	<?php
	return ob_get_clean();
} );

add_shortcode( 'sml_connect_dashboard', function () {
	if ( ! is_user_logged_in() ) return '<p>Please sign in to manage StockMarketLoop Connect.</p>';
	smlcmh_use_assets();
	ob_start();
	?>
	<section class="smlcmh-shell" data-smlcmh-dashboard>
		<div class="smlcmh-hero smlcmh-hero-compact">
			<p class="smlcmh-kicker">Owner command center</p>
			<h2>StockMarketLoop Connect migration dashboard</h2>
			<p>Install the bot first, create the clickable Discord card, map Upgrade.Chat products to Discord roles and StockMarketLoop plans, then publish member migration links.</p>
			<div class="smlcmh-actions">
				<a class="smlcmh-btn smlcmh-btn-gold" href="<?php echo esc_url( smlcmh_discord_install_url() ); ?>" target="_blank" rel="noopener">Install StockMarketLoop Connect Bot</a>
			</div>
		</div>
		<div class="smlcmh-grid smlcmh-grid-2">
			<form class="smlcmh-card" data-smlcmh-campaign-form>
				<h3>1. Create the Discord group homepage</h3>
				<label>Discord server name <input name="guildName" maxlength="120" required placeholder="Making Easy Money"></label>
				<label>Group ID <input name="groupId" inputmode="numeric" required placeholder="7"></label>
				<label>Owner WordPress user ID <input name="ownerUserId" inputmode="numeric" value="<?php echo esc_attr( get_current_user_id() ); ?>" required></label>
				<label>Discord server ID <input name="guildId" required placeholder="938894329076940820"></label>
				<label>Public slug <input name="publicSlug" required placeholder="making-easy-money"></label>
				<label>Discord invite URL <input name="discordInviteUrl" type="url" placeholder="https://discord.gg/..."></label>
				<label>Discord avatar/logo URL <input name="discordAvatarUrl" type="url" placeholder="https://..."></label>
				<label>Discord banner URL <input name="discordBannerUrl" type="url" placeholder="https://..."></label>
				<label>Headline <input name="headline" maxlength="140" value="Join this StockMarketLoop-powered Discord community"></label>
				<label>Description <textarea name="description" maxlength="500">Click the link to Join the Underlying Discord Group, unlock premium alerts, and manage your membership through StockMarketLoop Connect.</textarea></label>
				<label>SEO title <input name="seoTitle" maxlength="160" placeholder="Making Easy Money Discord Group | StockMarketLoop Connect"></label>
				<label>SEO description <textarea name="seoDescription" maxlength="300" placeholder="Join this trading Discord through StockMarketLoop Connect with premium alerts, subscriptions, and live market tools."></textarea></label>
				<label class="smlcmh-check"><input type="checkbox" name="migratedPerksEnabled"> Billing migrated — unlock Connect perks</label>
				<label>Status
					<select name="status"><option value="draft">Draft</option><option value="live">Live / indexable</option><option value="paused">Paused</option></select>
				</label>
				<button class="smlcmh-btn smlcmh-btn-gold" type="submit">Save group page</button>
			</form>
			<div class="smlcmh-card">
				<h3>2. Build memberships like Upgrade.Chat — no code</h3>
				<p class="smlcmh-muted">Create subscription prices, choose billing intervals, attach the old Upgrade.Chat product, and link the Discord role the member should receive. Owners should select things — not paste code.</p>
				<form data-smlcmh-membership-form>
					<label>Group ID <input name="groupId" inputmode="numeric" required placeholder="7"></label>
					<label>Owner WordPress user ID <input name="ownerUserId" inputmode="numeric" value="<?php echo esc_attr( get_current_user_id() ); ?>" required></label>
					<div class="smlcmh-membership-rows" data-smlcmh-membership-rows>
						<div class="smlcmh-membership-row" data-smlcmh-membership-row>
							<label>Membership name <input data-field="name" placeholder="VIP Alerts"></label>
							<label>Price <input data-field="priceDollars" inputmode="decimal" placeholder="49.99"></label>
							<label>Billing interval
								<select data-field="interval">
									<option value="monthly">Monthly</option>
									<option value="weekly">Weekly</option>
									<option value="yearly">Yearly</option>
									<option value="daily">Daily</option>
									<option value="lifetime">Lifetime</option>
								</select>
							</label>
							<label>Free trial days <input data-field="trialDays" inputmode="numeric" placeholder="0"></label>
							<label>Imported Upgrade.Chat product <input data-field="externalProductRef" placeholder="Product name or imported product ID"></label>
							<label>Discord role to give <input data-field="discordRoleRefs" placeholder="Select role when imported, or paste role ID"></label>
							<label>Store card description <textarea data-field="cardDescription" placeholder="Premium Discord alerts powered by StockMarketLoop Connect."></textarea></label>
							<button class="smlcmh-btn smlcmh-btn-small" type="button" data-smlcmh-remove-membership>Remove membership</button>
						</div>
					</div>
					<div class="smlcmh-actions">
						<button class="smlcmh-btn" type="button" data-smlcmh-add-membership>Add membership</button>
						<button class="smlcmh-btn smlcmh-btn-gold" type="submit">Save memberships</button>
					</div>
				</form>
				<hr>
				<form data-smlcmh-dashboard-form>
					<h3>3. Load analytics</h3>
					<label>Group ID <input name="groupId" inputmode="numeric" required placeholder="7"></label>
					<label>Owner WordPress user ID <input name="ownerUserId" inputmode="numeric" value="<?php echo esc_attr( get_current_user_id() ); ?>" required></label>
					<button class="smlcmh-btn" type="submit">Load dashboard</button>
				</form>
				<pre class="smlcmh-output" data-smlcmh-output>Waiting for action…</pre>
			</div>
		</div>
	</section>
	<?php
	return ob_get_clean();
} );

add_shortcode( 'sml_connect_migrate', function () {
	if ( ! is_user_logged_in() ) return '<p>Please sign in before moving your Discord membership to StockMarketLoop.</p>';
	smlcmh_use_assets();
	ob_start();
	?>
	<section class="smlcmh-shell" data-smlcmh-migrate>
		<div class="smlcmh-hero smlcmh-hero-compact">
			<p class="smlcmh-kicker">Subscriber migration</p>
			<h2>Confirm your move to StockMarketLoop without changing your next payment date.</h2>
			<p>Each member confirms their own migration. StockMarketLoop verifies the existing Upgrade.Chat membership, keeps paid Discord access through the verified renewal date, then starts the SML subscription on that same billing day.</p>
		</div>
		<form class="smlcmh-card" data-smlcmh-migrate-form>
			<label>Group ID <input name="groupId" inputmode="numeric" required></label>
			<label>Plan ID <input name="planId" inputmode="numeric" required></label>
			<label>Group owner WordPress user ID <input name="ownerUserId" inputmode="numeric" required></label>
			<label>Discord server ID <input name="guildId" required></label>
			<label>Your Discord user ID <input name="discordUserId" required></label>
			<p class="smlcmh-muted">By continuing, you authorize StockMarketLoop to verify your existing provider membership and start the new SML subscription on the verified next renewal date. You are not charged twice.</p>
			<button class="smlcmh-btn smlcmh-btn-gold" type="submit">Start migration checkout</button>
		</form>
		<pre class="smlcmh-output" data-smlcmh-output></pre>
	</section>
	<?php
	return ob_get_clean();
} );

/* -------------------------------------------------------------------------
 * Pretty public page: /connect/{slug}/
 * ---------------------------------------------------------------------- */

add_action( 'template_redirect', function () {
	$slug = get_query_var( 'sml_connect_slug' );
	if ( ! $slug ) return;
	$page = smlcmh_platform_get( '/v1/connect/public/' . rawurlencode( sanitize_title( $slug ) ) );
	if ( is_wp_error( $page ) ) {
		status_header( 404 );
		get_header();
		echo '<main class="smlcmh-shell"><div class="smlcmh-card"><h1>Connect page not found</h1><p>' . esc_html( $page->get_error_message() ) . '</p></div></main>';
		get_footer();
		exit;
	}
	smlcmh_use_assets();
	add_filter( 'pre_get_document_title', function () use ( $page ) {
		return isset( $page['seo']['title'] ) ? sanitize_text_field( $page['seo']['title'] ) : 'StockMarketLoop Connect';
	} );
	add_action( 'wp_head', function () use ( $page ) {
		$seo = isset( $page['seo'] ) && is_array( $page['seo'] ) ? $page['seo'] : array();
		if ( ! empty( $seo['description'] ) ) echo '<meta name="description" content="' . esc_attr( $seo['description'] ) . '">' . "\n";
		if ( ! empty( $seo['canonical'] ) ) echo '<link rel="canonical" href="' . esc_url( $seo['canonical'] ) . '">' . "\n";
		echo '<meta name="robots" content="index,follow">' . "\n";
	}, 1 );
	get_header();
	echo smlcmh_render_public_page( $page ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	get_footer();
	exit;
} );

function smlcmh_render_public_page( array $page ) {
	$campaign = isset( $page['campaign'] ) && is_array( $page['campaign'] ) ? $page['campaign'] : array();
	$card     = isset( $page['joinCard'] ) && is_array( $page['joinCard'] ) ? $page['joinCard'] : array();
	$plans    = isset( $page['plans'] ) && is_array( $page['plans'] ) ? $page['plans'] : array();
	$messages = isset( $page['liveMessages'] ) && is_array( $page['liveMessages'] ) ? $page['liveMessages'] : array();
	ob_start();
	?>
	<main class="smlcmh-shell smlcmh-public">
		<section class="smlcmh-public-hero" style="<?php echo ! empty( $card['bannerUrl'] ) ? 'background-image:linear-gradient(90deg,rgba(2,8,14,.92),rgba(2,8,14,.54)),url(' . esc_url( $card['bannerUrl'] ) . ')' : ''; ?>">
			<div class="smlcmh-public-logo"><?php if ( ! empty( $card['avatarUrl'] ) ) : ?><img src="<?php echo esc_url( $card['avatarUrl'] ); ?>" alt="Discord group logo"><?php else : ?>SML<?php endif; ?></div>
			<div>
				<p class="smlcmh-kicker">Discord group powered by StockMarketLoop Connect</p>
				<h1><?php echo esc_html( smlcmh_array_text( $campaign, 'headline', 'Join this Discord group' ) ); ?></h1>
				<p><?php echo esc_html( smlcmh_array_text( $campaign, 'description', 'Click the link to join the underlying Discord group.' ) ); ?></p>
				<?php if ( ! empty( $card['url'] ) ) : ?>
					<a class="smlcmh-btn smlcmh-btn-gold" href="<?php echo esc_url( $card['url'] ); ?>" rel="nofollow noopener">Click the link to Join the Underlying Discord Group</a>
				<?php endif; ?>
			</div>
		</section>
		<?php if ( ! empty( $page['perkGate']['locked'] ) ) : ?>
			<div class="smlcmh-lock">Connect perks unlock when this Discord owner migrates billing to StockMarketLoop.</div>
		<?php endif; ?>
		<section class="smlcmh-grid">
			<div class="smlcmh-card smlcmh-span-2">
				<h2>Memberships</h2>
				<div class="smlcmh-plan-list">
					<?php foreach ( $plans as $plan ) : ?>
						<div class="smlcmh-plan">
							<strong><?php echo esc_html( smlcmh_array_text( $plan, 'name', 'Membership' ) ); ?></strong>
							<span><?php echo esc_html( smlcmh_money( $plan['priceCents'] ?? 0, $plan['currency'] ?? 'usd' ) . ' / ' . smlcmh_array_text( $plan, 'interval', 'month' ) ); ?></span>
							<p><?php echo esc_html( smlcmh_array_text( $plan, 'description', 'Premium Discord access managed by StockMarketLoop Connect.' ) ); ?></p>
						</div>
					<?php endforeach; ?>
					<?php if ( empty( $plans ) ) : ?><p>No public membership plans are published yet.</p><?php endif; ?>
				</div>
			</div>
			<div class="smlcmh-card">
				<h2>Live Discord stream</h2>
				<?php foreach ( array_slice( $messages, 0, 8 ) as $message ) : ?>
					<div class="smlcmh-message"><strong><?php echo esc_html( smlcmh_array_text( $message, 'author', 'Member' ) ); ?></strong><p><?php echo esc_html( smlcmh_array_text( $message, 'preview', '' ) ); ?></p></div>
				<?php endforeach; ?>
				<?php if ( empty( $messages ) ) : ?><p>Live message previews will appear after the owner enables Discord message streaming.</p><?php endif; ?>
			</div>
			<div class="smlcmh-card">
				<h2>Included after migration</h2>
				<ul class="smlcmh-perks">
					<li>Security management</li>
					<li>Dispute evidence defense</li>
					<li>Retail Trader Spotlight</li>
					<li>Storefront + live watch + Loop Letter bundle</li>
				</ul>
			</div>
		</section>
	</main>
	<?php
	return ob_get_clean();
}

function smlcmh_array_text( $row, $key, $fallback = '' ) {
	return is_array( $row ) && isset( $row[ $key ] ) && ! is_array( $row[ $key ] ) ? sanitize_text_field( (string) $row[ $key ] ) : $fallback;
}

function smlcmh_money( $cents, $currency ) {
	$cents = is_numeric( $cents ) ? (int) $cents : 0;
	return sprintf( '$%d.%02d %s', intdiv( $cents, 100 ), $cents % 100, strtoupper( sanitize_text_field( (string) $currency ) ) );
}

/* -------------------------------------------------------------------------
 * REST bridge
 * ---------------------------------------------------------------------- */

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-connect/v1', '/campaign', array(
		'methods'             => 'POST',
		'callback'            => 'smlcmh_rest_campaign',
		'permission_callback' => 'is_user_logged_in',
	) );
	register_rest_route( 'sml-connect/v1', '/mappings', array(
		'methods'             => 'POST',
		'callback'            => 'smlcmh_rest_mappings',
		'permission_callback' => 'is_user_logged_in',
	) );
	register_rest_route( 'sml-connect/v1', '/dashboard', array(
		'methods'             => 'POST',
		'callback'            => 'smlcmh_rest_dashboard',
		'permission_callback' => 'is_user_logged_in',
	) );
	register_rest_route( 'sml-connect/v1', '/memberships', array(
		'methods'             => 'POST',
		'callback'            => 'smlcmh_rest_memberships',
		'permission_callback' => 'is_user_logged_in',
	) );
	register_rest_route( 'sml-connect/v1', '/migrate/upgrade-chat', array(
		'methods'             => 'POST',
		'callback'            => 'smlcmh_rest_migrate_upgrade_chat',
		'permission_callback' => 'is_user_logged_in',
	) );
} );

function smlcmh_rest_payload( WP_REST_Request $request ) {
	$payload = $request->get_json_params();
	return is_array( $payload ) ? $payload : array();
}

function smlcmh_rest_campaign( WP_REST_Request $request ) {
	$data     = smlcmh_rest_payload( $request );
	$group_id = isset( $data['groupId'] ) ? absint( $data['groupId'] ) : 0;
	if ( ! $group_id || ! smlcmh_can_manage_group( $group_id ) ) {
		return new WP_Error( 'smlcmh_forbidden', 'Only the group owner or an administrator can manage this Connect campaign.', array( 'status' => 403 ) );
	}
	$data['ownerUserId'] = smlcmh_current_owner_id( $data );
	if ( empty( $data['publicSlug'] ) ) $data['publicSlug'] = smlcmh_group_slug_default( $group_id );
	if ( ! empty( $data['guildName'] ) ) {
		$data['guildName'] = sanitize_text_field( (string) $data['guildName'] );
		$data['groupName'] = $data['guildName'];
		$settings = isset( $data['settings'] ) && is_array( $data['settings'] ) ? $data['settings'] : array();
		$settings['guildName'] = $data['guildName'];
		$data['settings'] = $settings;
	}
	return rest_ensure_response( smlcmh_platform_post( '/v1/connect/migration/campaign', $data ) );
}

function smlcmh_rest_mappings( WP_REST_Request $request ) {
	$data     = smlcmh_rest_payload( $request );
	$group_id = isset( $data['groupId'] ) ? absint( $data['groupId'] ) : 0;
	if ( ! $group_id || ! smlcmh_can_manage_group( $group_id ) ) {
		return new WP_Error( 'smlcmh_forbidden', 'Only the group owner or an administrator can manage Connect mappings.', array( 'status' => 403 ) );
	}
	$data['ownerUserId'] = smlcmh_current_owner_id( $data );
	return rest_ensure_response( smlcmh_platform_post( '/v1/connect/migration/mappings', $data ) );
}

function smlcmh_rest_dashboard( WP_REST_Request $request ) {
	$data     = smlcmh_rest_payload( $request );
	$group_id = isset( $data['groupId'] ) ? absint( $data['groupId'] ) : 0;
	if ( ! $group_id || ! smlcmh_can_manage_group( $group_id ) ) {
		return new WP_Error( 'smlcmh_forbidden', 'Only the group owner or an administrator can view this Connect dashboard.', array( 'status' => 403 ) );
	}
	$data['ownerUserId'] = smlcmh_current_owner_id( $data );
	return rest_ensure_response( smlcmh_platform_post( '/v1/connect/migration/dashboard', $data ) );
}

function smlcmh_rest_memberships( WP_REST_Request $request ) {
	$data     = smlcmh_rest_payload( $request );
	$group_id = isset( $data['groupId'] ) ? absint( $data['groupId'] ) : 0;
	if ( ! $group_id || ! smlcmh_can_manage_group( $group_id ) ) {
		return new WP_Error( 'smlcmh_forbidden', 'Only the group owner or an administrator can manage Connect memberships.', array( 'status' => 403 ) );
	}
	$data['ownerUserId'] = smlcmh_current_owner_id( $data );
	return rest_ensure_response( smlcmh_platform_post( '/v1/connect/migration/memberships', $data ) );
}

function smlcmh_rest_migrate_upgrade_chat( WP_REST_Request $request ) {
	$data = smlcmh_rest_payload( $request );
	$data['userId'] = get_current_user_id();
	$data['successUrl'] = isset( $data['successUrl'] ) ? esc_url_raw( $data['successUrl'] ) : home_url( '/connect-migrate/?migrated=1' );
	$data['cancelUrl']  = isset( $data['cancelUrl'] ) ? esc_url_raw( $data['cancelUrl'] ) : home_url( '/connect-migrate/?cancelled=1' );
	foreach ( array( 'groupId', 'planId', 'ownerUserId' ) as $field ) {
		$data[ $field ] = isset( $data[ $field ] ) ? absint( $data[ $field ] ) : 0;
	}
	$data['guildId']       = isset( $data['guildId'] ) ? smlcmh_clean_snowflake( $data['guildId'] ) : '';
	$data['discordUserId'] = isset( $data['discordUserId'] ) ? smlcmh_clean_snowflake( $data['discordUserId'] ) : '';
	if ( ! $data['groupId'] || ! $data['planId'] || ! $data['ownerUserId'] || ! $data['guildId'] || ! $data['discordUserId'] ) {
		return new WP_Error( 'smlcmh_missing_migration_data', 'Group, plan, owner, Discord server, and Discord user are required.', array( 'status' => 400 ) );
	}
	$result = smlcmh_platform_post( '/v1/billing/migrations/upgrade-chat', $data );
	if ( is_wp_error( $result ) ) return $result;
	return rest_ensure_response( $result );
}
