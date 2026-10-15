<?php
/**
 * Plugin Name: SML Loop Arcade
 * Description: Retention games for the live and watch pages, on the real Loop Bucks ledger: Market Spin (free daily wheel, more spins while a stream is live and on streaks), Stream Jackpot (host-funded raffle drawn live, tickets for minutes watched), Tape Call (call the next minute on a ticker, points ladder with daily Loop Bucks for the top three). Also opens free tables to everyone, keeps CPU players off the public scoreboard, switches on staking for player-versus-player skill games, and restyles every existing board (chess, checkers, Connect Four, Tic-Tac-Toe, Spades, Blackjack) with real materials, motion and sound.
 * Version: 1.0.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_ARC_VERSION', '1.0.0' );
define( 'SML_ARC_FILE', __FILE__ );
define( 'SML_ARC_DIR', __DIR__ );
define( 'SML_ARC_NS', 'sml-arcade/v1' );

function sml_arc_asset( $file ) { return plugins_url( 'assets/' . $file, SML_ARC_FILE ) . '?v=' . rawurlencode( SML_ARC_VERSION ); }

require_once SML_ARC_DIR . '/includes/db.php';
require_once SML_ARC_DIR . '/includes/bank.php';
require_once SML_ARC_DIR . '/includes/spin.php';
require_once SML_ARC_DIR . '/includes/jackpot.php';
require_once SML_ARC_DIR . '/includes/tape.php';
require_once SML_ARC_DIR . '/includes/rest.php';
require_once SML_ARC_DIR . '/includes/page.php';

register_activation_hook( SML_ARC_FILE, 'sml_arc_install' );
add_action( 'init', function () { if ( get_option( 'sml_arc_db_version' ) !== SML_ARC_VERSION ) { sml_arc_install(); } }, 3 );
