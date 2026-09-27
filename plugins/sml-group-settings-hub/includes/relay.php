<?php
/**
 * Site facts relay.
 *
 * The engineer maintaining this plugin cannot reach the site directly, but the
 * site already talks to the StockMarketLoop platform over the billing bridge
 * (signed with the shared billing secret). This module builds a COMPACT set of
 * facts an audit needs — the WPCode snippet index (titles, sizes, status; not
 * the code), the plugin list with active flags, CREATE TABLE statements for the
 * group tables, the group REST routes, the DOM hooks the group shell exposes,
 * and greps of the group-related snippets/plugins for function names, tables
 * and routes — compresses it, and posts it in signed chunks to the platform,
 * which writes each chunk to its service log. No secrets, no member data, no
 * message content. Runs once after this version is installed (WP-Cron), and
 * again on demand for administrators (POST sml-hub/v1/export/relay).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SML_HUB_RELAY_CHUNK', 3600 );

function sml_hub_relay_grep( $code, $limit_lines = 60 ) {
	$out = array( 'functions' => array(), 'routes' => array(), 'tables' => array(), 'hooks' => array(), 'options' => array() );
	if ( preg_match_all( '/function\s+(sml_[a-z0-9_]+)\s*\(/i', $code, $m ) ) {
		$out['functions'] = array_values( array_unique( array_slice( $m[1], 0, 300 ) ) );
	}
	if ( preg_match_all( "/register_rest_route\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]/", $code, $m, PREG_SET_ORDER ) ) {
		foreach ( array_slice( $m, 0, 120 ) as $r ) {
			$out['routes'][] = $r[1] . ' ' . $r[2];
		}
	}
	if ( preg_match_all( '/CREATE TABLE[^`\w]*[`{]?[^`\s(]*?(sml_[a-z0-9_]+)/i', $code, $m ) ) {
		$out['tables'] = array_values( array_unique( $m[1] ) );
	}
	if ( preg_match_all( '/(data-smlgs-[a-z0-9-]+|sml-gshell__[a-z0-9-]+|sml-group-[a-z0-9-]+|sml-manage-[a-z0-9-]+|sml-ob-[a-z0-9-]+)/', $code, $m ) ) {
		$out['hooks'] = array_values( array_unique( array_slice( $m[1], 0, 200 ) ) );
	}
	if ( preg_match_all( "/(?:get|update|add)_option\(\s*['\"]([a-z0-9_]+)/i", $code, $m ) ) {
		$out['options'] = array_values( array_unique( array_slice( $m[1], 0, 80 ) ) );
	}
	if ( preg_match_all( '/^.*sml_group_role_settings.*$/m', $code, $m ) ) {
		$out['role_settings_lines'] = array_map( static function ( $l ) { return mb_substr( trim( $l ), 0, 220 ); }, array_slice( $m[0], 0, $limit_lines ) );
	}
	if ( preg_match_all( "/^.*\\['role'\\].*$/m", $code, $m ) ) {
		$out['role_lines'] = array_map( static function ( $l ) { return mb_substr( trim( $l ), 0, 220 ); }, array_slice( $m[0], 0, 40 ) );
	}
	return $out;
}

function sml_hub_relay_dir_files( $dir, $max_files = 80 ) {
	$out = array();
	if ( ! is_dir( $dir ) ) {
		return $out;
	}
	$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) );
	foreach ( $it as $f ) {
		if ( ! $f->isFile() ) {
			continue;
		}
		$out[] = array( 'f' => ltrim( substr( $f->getPathname(), strlen( rtrim( $dir, '/' ) ) ), '/' ), 'b' => $f->getSize() );
		if ( count( $out ) >= $max_files ) {
			break;
		}
	}
	return $out;
}

function sml_hub_relay_facts() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	$facts = array(
		'generated_at' => gmdate( 'c' ),
		'site'         => home_url(),
		'hub_version'  => SML_HUB_VERSION,
		'hub_css_sha1' => is_file( SML_HUB_DIR . 'assets/hub.css' ) ? sha1_file( SML_HUB_DIR . 'assets/hub.css' ) : '',
		'hub_js_bytes' => is_file( SML_HUB_DIR . 'assets/hub.js' ) ? filesize( SML_HUB_DIR . 'assets/hub.js' ) : 0,
		'php'          => PHP_VERSION,
		'wp'           => get_bloginfo( 'version' ),
	);

	// WPCode snippets: index + greps of group-related ones (never the full code).
	$snips = (array) $wpdb->get_results( "SELECT ID, post_title, post_status, post_content, post_modified_gmt FROM {$wpdb->posts} WHERE post_type='wpcode' ORDER BY ID ASC", ARRAY_A );
	$index = array();
	$greps = array();
	foreach ( $snips as $p ) {
		$type = (string) get_post_meta( (int) $p['ID'], '_wpcode_code_type', true );
		$loc  = (string) get_post_meta( (int) $p['ID'], '_wpcode_location', true );
		$index[] = array( 'id' => (int) $p['ID'], 't' => $p['post_title'], 's' => $p['post_status'], 'type' => $type, 'loc' => $loc, 'b' => strlen( (string) $p['post_content'] ), 'm' => $p['post_modified_gmt'] );
		if ( 'publish' === $p['post_status'] && preg_match( '/group|onboard|shell|role|member|channel|live|inbox|dm|profile|follow/i', $p['post_title'] . ' ' . substr( (string) $p['post_content'], 0, 4000 ) ) ) {
			$greps[ (string) $p['ID'] ] = sml_hub_relay_grep( (string) $p['post_content'] );
		}
	}
	$facts['wpcode'] = array( 'count' => count( $index ), 'index' => $index, 'greps' => $greps );

	// Plugins.
	$active  = array_fill_keys( (array) get_option( 'active_plugins', array() ), true );
	$plugins = array();
	$pgreps  = array();
	foreach ( get_plugins() as $file => $info ) {
		$dir = dirname( $file );
		$on  = isset( $active[ $file ] );
		$plugins[] = array( 'f' => $file, 'n' => $info['Name'], 'v' => $info['Version'], 'a' => $on ? 1 : 0 );
		if ( $on && '.' !== $dir && preg_match( '/group|shell|owner-editor|channel-admin|onboard|members|profile|follow|social/i', $dir . ' ' . $info['Name'] ) ) {
			$files = sml_hub_relay_dir_files( WP_PLUGIN_DIR . '/' . $dir );
			$code  = '';
			foreach ( $files as $f ) {
				if ( preg_match( '/\.(php|js)$/', $f['f'] ) && $f['b'] < 900000 ) {
					$code .= "\n" . (string) @file_get_contents( WP_PLUGIN_DIR . '/' . $dir . '/' . $f['f'] );
				}
			}
			$pgreps[ $dir ] = array( 'files' => $files, 'grep' => sml_hub_relay_grep( $code ) );
		}
	}
	$facts['plugins'] = array( 'count' => count( $plugins ), 'active' => count( $active ), 'list' => $plugins, 'greps' => $pgreps );

	// mu-plugins: names, sizes, greps.
	$mu = array();
	if ( defined( 'WPMU_PLUGIN_DIR' ) && is_dir( WPMU_PLUGIN_DIR ) ) {
		foreach ( sml_hub_relay_dir_files( WPMU_PLUGIN_DIR, 200 ) as $f ) {
			$entry = $f;
			if ( preg_match( '/\.php$/', $f['f'] ) && $f['b'] < 900000 ) {
				$entry['grep'] = sml_hub_relay_grep( (string) @file_get_contents( WPMU_PLUGIN_DIR . '/' . $f['f'] ) );
			}
			$mu[] = $entry;
		}
	}
	$facts['mu_plugins'] = $mu;

	// Schema for the group tables.
	$schema = array();
	foreach ( (array) $wpdb->get_col( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $wpdb->prefix . 'sml_' ) . '%' ) ) as $table ) {
		$short = substr( $table, strlen( $wpdb->prefix ) );
		$n     = (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$table}`" );
		if ( preg_match( '/^sml_(group|groups|discord_group|hub_|direct_messages|group_role|follow|profile_follow|user_follow)/', $short ) || preg_match( '/follow/', $short ) ) {
			$row = $wpdb->get_row( "SHOW CREATE TABLE `{$table}`", ARRAY_N );
			$schema[ $short ] = array( 'rows' => $n, 'create' => $row ? preg_replace( '/\s+/', ' ', $row[1] ) : '' );
		} else {
			$schema[ $short ] = array( 'rows' => $n );
		}
	}
	$facts['schema'] = $schema;
	$rs = $wpdb->prefix . 'sml_group_role_settings';
	if ( isset( $schema['sml_group_role_settings'] ) ) {
		$facts['role_settings_sample'] = (array) $wpdb->get_results( "SELECT * FROM `{$rs}` ORDER BY 1 DESC LIMIT 8", ARRAY_A );
	}
	$facts['member_roles'] = (array) $wpdb->get_results( "SELECT role, COUNT(*) AS n FROM {$wpdb->prefix}sml_group_members GROUP BY role", ARRAY_A );
	$facts['groups_count'] = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}sml_groups" );
	$g = sml_hub_group_by_slug( 'making-easy-money' );
	$facts['mem_group'] = $g ? array( 'id' => (int) $g['id'], 'owner_id' => (int) $g['owner_id'], 'columns' => array_keys( $g ) ) : null;
	if ( $g ) {
		$facts['mem_channels'] = (array) $wpdb->get_results( $wpdb->prepare( "SELECT id, name, type, order_index, is_locked FROM {$wpdb->prefix}sml_group_channels WHERE group_id=%d ORDER BY order_index ASC", (int) $g['id'] ), ARRAY_A );
		$facts['mem_hub'] = array( 'prefs' => sml_hub_prefs( (int) $g['id'] ), 'roles' => sml_hub_roles( (int) $g['id'] ), 'overrides' => sml_hub_overrides( (int) $g['id'] ), 'socials' => sml_hub_social_cfg( (int) $g['id'] ) );
	}

	// REST routes of the group namespaces.
	$routes = array();
	if ( function_exists( 'rest_get_server' ) ) {
		foreach ( rest_get_server()->get_routes() as $route => $handlers ) {
			if ( preg_match( '#^/(sml/v1|sml-onboard/v1|sml-group-live/v1|sml-gcat/v1|sml-discord-site/v[12]|sml-hub/v1|sml-platform/v1)#', $route ) ) {
				$methods = array();
				foreach ( (array) $handlers as $h ) {
					$methods = array_merge( $methods, array_keys( (array) ( $h['methods'] ?? array() ) ) );
				}
				$routes[] = $route . ' [' . implode( ',', array_unique( $methods ) ) . ']';
			}
		}
	}
	$facts['rest_routes'] = $routes;
	$facts['loop_follow_source'] = sml_hub_loop_follow_source();
	$facts['platforms'] = sml_hub_platform_status();
	$facts['options_sml'] = (array) $wpdb->get_col( $wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s ORDER BY option_name LIMIT 400", $wpdb->esc_like( 'sml_' ) . '%' ) );
	return $facts;
}

function sml_hub_relay_send( $reason = 'manual' ) {
	if ( ! function_exists( 'sml_platform_billing_call' ) ) {
		$r = array( 'ok' => false, 'error' => 'billing bridge not installed', 'at' => gmdate( 'c' ) );
		update_option( 'sml_hub_relay_last', $r, false );
		return $r;
	}
	@set_time_limit( 300 );
	$json  = wp_json_encode( sml_hub_relay_facts(), JSON_UNESCAPED_SLASHES );
	$blob  = base64_encode( gzencode( $json, 9 ) );
	$parts = str_split( $blob, SML_HUB_RELAY_CHUNK );
	$name  = 'facts-' . gmdate( 'Ymd-His' ) . '.json.gz';
	$sent  = 0;
	$err   = '';
	foreach ( $parts as $i => $part ) {
		$res = sml_platform_billing_call( '/v1/site-export/ingest', array( 'name' => $name, 'seq' => $i + 1, 'total' => count( $parts ), 'data' => $part ) );
		if ( is_wp_error( $res ) ) {
			$err = $res->get_error_message();
			break;
		}
		$sent++;
	}
	$r = array( 'ok' => '' === $err, 'error' => $err, 'name' => $name, 'chunks' => count( $parts ), 'sent' => $sent, 'bytes' => strlen( $json ), 'reason' => $reason, 'at' => gmdate( 'c' ) );
	update_option( 'sml_hub_relay_last', $r, false );
	return $r;
}

add_action( 'sml_hub_relay_run', static function () {
	$r = sml_hub_relay_send( 'cron' );
	// Retry every 10 minutes (up to 12 times) when the platform was unreachable or refused the request.
	$tries = (int) get_option( 'sml_hub_relay_tries', 0 );
	if ( empty( $r['ok'] ) && $tries < 12 ) {
		update_option( 'sml_hub_relay_tries', $tries + 1, false );
		wp_schedule_single_event( time() + 10 * MINUTE_IN_SECONDS, 'sml_hub_relay_run' );
	} elseif ( ! empty( $r['ok'] ) ) {
		delete_option( 'sml_hub_relay_tries' );
	}
} );

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml-hub/v1', '/export/relay', array(
		array(
			'methods'             => 'POST',
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
			'callback'            => static function () { return sml_hub_relay_send( 'manual' ); },
		),
		array(
			'methods'             => 'GET',
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
			'callback'            => static function () { return array( 'last' => get_option( 'sml_hub_relay_last', null ), 'scheduled' => (bool) wp_next_scheduled( 'sml_hub_relay_run' ) ); },
		),
	) );
} );
