<?php
/**
 * Plugin Name: SML Loop Channels
 * Description: The fast layer for Loop Channels (/channel/{handle}/). Serves a lean, cacheable page with the channel painted server-side (indexable, with ProfilePage and VideoObject schema and real link previews), preloads every API call the channel app makes, and gives the creator a Design studio: theme presets, any accent colour, fonts, a full-width channel banner (image, GIF or video), a page background, layout (sidebar side, section order, video grid), and the immersive motion layer from Loop Letters.
 * Version: 1.1.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_LC_VERSION', '1.1.0' );
define( 'SML_LC_FILE', __FILE__ );
define( 'SML_LC_DIR', __DIR__ );
define( 'SML_LC_NS', 'sml-channel-design/v1' );

function sml_lc_asset( $file ) { return plugins_url( 'assets/' . $file, SML_LC_FILE ) . '?v=' . rawurlencode( SML_LC_VERSION ); }

require_once SML_LC_DIR . '/includes/design.php';
require_once SML_LC_DIR . '/includes/page.php';
require_once SML_LC_DIR . '/includes/rest.php';

/*
 * One-time starter look for the owner's own channel (asked for in session: "use mine"), so the
 * design layer is exercised on a real channel. Applies only if that channel was never customised,
 * runs once, and every part of it can be changed or switched off in the Design studio.
 */
add_action( 'init', 'sml_lc_seed_owner_channel', 5 );
function sml_lc_seed_owner_channel() {
	if ( get_option( 'sml_lc_seed_v1' ) || ! function_exists( 'sml_channel_user_by_handle' ) ) { return; }
	$user = sml_channel_user_by_handle( 'grandmasterobi' );
	if ( ! $user ) { return; }
	$design = sml_lc_get( $user->ID );
	if ( empty( $design['updated_at'] ) ) {
		sml_lc_put( $user->ID, array(
			'preset'     => 'graphite',
			'radius'     => 'soft',
			'banner'     => array( 'mode' => 'gradient', 'height' => 'medium', 'overlay' => true, 'subtitle' => 'Live streams, market letters and the community, in one place' ),
			'background' => array( 'mode' => 'pattern', 'pattern' => 'grid', 'dim' => 70, 'fixed' => true ),
			'layout'     => array( 'videos' => 'grid' ),
			'effects'    => array( 'level' => 'calm', 'effects' => array( 'particles', 'orbs' ), 'pulse' => false ),
		) );
	}
	update_option( 'sml_lc_seed_v1', gmdate( 'c' ), false );
}
