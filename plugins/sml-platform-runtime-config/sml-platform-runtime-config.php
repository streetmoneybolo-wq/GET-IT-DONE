<?php
/**
 * Plugin Name: SML Platform Runtime Config
 * Description: Secure runtime configuration for the StockMarketLoop billing bridge.
 * Version: 1.0.0
 * Author: Stock Market Loop
 */

defined( 'ABSPATH' ) || exit;

const SML_RUNTIME_CONFIG_OPTION = 'sml_platform_runtime_config';

function sml_runtime_config_defaults() {
	return array(
		'api_url'       => 'https://sml-platform-api.onrender.com',
		'api_secret'    => '',
		'bridge_secret' => '',
		'group_plan_map'=> '{}',
	);
}
function sml_runtime_config_generate_secret() {
	try {
		return bin2hex( random_bytes( 32 ) );
	} catch ( Exception $e ) {
		return wp_generate_password( 64, false, false );
	}
}

function sml_runtime_config_activate() {
	$config = wp_parse_args( get_option( SML_RUNTIME_CONFIG_OPTION, array() ), sml_runtime_config_defaults() );
	if ( empty( $config['api_secret'] ) ) $config['api_secret'] = sml_runtime_config_generate_secret();
	if ( empty( $config['bridge_secret'] ) ) $config['bridge_secret'] = sml_runtime_config_generate_secret();
	update_option( SML_RUNTIME_CONFIG_OPTION, $config, false );
}
register_activation_hook( __FILE__, 'sml_runtime_config_activate' );

function sml_runtime_config_get() {
	$config = wp_parse_args( get_option( SML_RUNTIME_CONFIG_OPTION, array() ), sml_runtime_config_defaults() );
	if ( empty( $config['api_secret'] ) || empty( $config['bridge_secret'] ) ) {
		sml_runtime_config_activate();
		$config = wp_parse_args( get_option( SML_RUNTIME_CONFIG_OPTION, array() ), sml_runtime_config_defaults() );
	}
	return $config;
}

$sml_runtime_config = sml_runtime_config_get();
if ( ! defined( 'SML_PLATFORM_API_URL' ) ) define( 'SML_PLATFORM_API_URL', esc_url_raw( $sml_runtime_config['api_url'] ) );
if ( ! defined( 'SML_PLATFORM_BILLING_API_SECRET' ) ) define( 'SML_PLATFORM_BILLING_API_SECRET', (string) $sml_runtime_config['api_secret'] );
if ( ! defined( 'SML_PLATFORM_BILLING_BRIDGE_SECRET' ) ) define( 'SML_PLATFORM_BILLING_BRIDGE_SECRET', (string) $sml_runtime_config['bridge_secret'] );
if ( ! defined( 'SML_PLATFORM_GROUP_PLAN_MAP' ) ) define( 'SML_PLATFORM_GROUP_PLAN_MAP', (string) $sml_runtime_config['group_plan_map'] );
unset( $sml_runtime_config );

function sml_runtime_config_sanitize( $input ) {
	$current = sml_runtime_config_get();
	$output = $current;
	if ( isset( $input['api_url'] ) ) $output['api_url'] = untrailingslashit( esc_url_raw( $input['api_url'] ) );
	if ( isset( $input['group_plan_map'] ) ) {
		$decoded = json_decode( wp_unslash( $input['group_plan_map'] ), true );
		if ( ! is_array( $decoded ) ) {
			add_settings_error( SML_RUNTIME_CONFIG_OPTION, 'invalid_map', 'Group/plan map must be valid JSON.' );
		} else {
			$clean = array();
			foreach ( $decoded as $group_id => $plan_id ) {
				$group_id = absint( $group_id );
				$plan_id  = absint( $plan_id );
				if ( $group_id && $plan_id ) $clean[ (string) $group_id ] = $plan_id;
			}
			$output['group_plan_map'] = wp_json_encode( $clean );
		}
	}
	return $output;
}

add_action( 'admin_init', function () {
	register_setting( 'sml_runtime_config', SML_RUNTIME_CONFIG_OPTION, array(
		'type' => 'array',
		'sanitize_callback' => 'sml_runtime_config_sanitize',
	) );
} );

add_action( 'admin_menu', function () {
	add_options_page(
		'SML Platform Runtime Config',
		'SML Platform Runtime',
		'manage_options',
		'sml-platform-runtime',
		'sml_runtime_config_page'
	);
} );

function sml_runtime_config_page() {
	if ( ! current_user_can( 'manage_options' ) ) return;
	$config = sml_runtime_config_get();
	?>
	<div class="wrap">
		<h1>SML Platform Runtime Config</h1>
		<p>These values connect WordPress to the private Render billing service. Never paste them into WPCode or share them publicly.</p>
		<form method="post" action="options.php">
			<?php settings_fields( 'sml_runtime_config' ); ?>
			<table class="form-table" role="presentation">
				<tr><th><label for="sml-api-url">Platform API URL</label></th><td><input class="regular-text" id="sml-api-url" name="<?php echo esc_attr( SML_RUNTIME_CONFIG_OPTION ); ?>[api_url]" value="<?php echo esc_attr( $config['api_url'] ); ?>" type="url" required></td></tr>
				<tr><th>Billing API secret</th><td><input class="regular-text code" value="<?php echo esc_attr( $config['api_secret'] ); ?>" type="password" readonly data-sml-secret><button class="button" type="button" data-sml-reveal>Reveal</button></td></tr>
				<tr><th>Billing bridge secret</th><td><input class="regular-text code" value="<?php echo esc_attr( $config['bridge_secret'] ); ?>" type="password" readonly data-sml-secret><button class="button" type="button" data-sml-reveal>Reveal</button></td></tr>
				<tr><th><label for="sml-group-map">Group → plan map</label></th><td><input class="regular-text code" id="sml-group-map" name="<?php echo esc_attr( SML_RUNTIME_CONFIG_OPTION ); ?>[group_plan_map]" value="<?php echo esc_attr( $config['group_plan_map'] ); ?>" type="text"><p class="description">Example: {"7":12}</p></td></tr>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<script>document.querySelectorAll('[data-sml-reveal]').forEach(function(b){b.addEventListener('click',function(){var i=b.previousElementSibling;i.type=i.type==='password'?'text':'password';b.textContent=i.type==='password'?'Reveal':'Hide';});});</script>
	<?php
}
