<?php
/**
 * Subscriber lifecycle — confirm, unsubscribe, export.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS SEPARATELY FROM THE SUBSCRIBE ENDPOINT
 * ---------------------------------------------------------------------------
 * The public subscribe form already says "One click to unsubscribe." Nothing
 * implemented that. Shipping a capture form whose own copy promises an exit
 * that does not exist is the single worst state this feature could be in:
 *
 *   - It is a promise to a reader that the product does not keep.
 *   - Mailbox providers treat "no working unsubscribe" as a spam signal, and
 *     they attribute it to the sending DOMAIN. One publication with no exit
 *     route degrades delivery for every publication on stockmarketloop.com.
 *   - Under CAN-SPAM and GDPR the opt-out mechanism is not optional, and the
 *     obligation attaches the moment the first address is stored.
 *
 * The subscribers table has been filling since the plugin went live, so this
 * is due now rather than when a sender is built.
 *
 * ---------------------------------------------------------------------------
 * TOKENS
 * ---------------------------------------------------------------------------
 * Confirm and unsubscribe both arrive as plain GETs from an email client and
 * cannot carry a REST nonce. The token is the credential. Two properties keep
 * that safe: it is 32 bytes from random_bytes (not guessable), and it can only
 * ever move a row between subscription states — it exposes nothing and deletes
 * nothing.
 *
 * The unsubscribe token is deliberately PERSISTENT, unlike the confirm token
 * which is consumed on use. An unsubscribe link has to keep working in an
 * email a reader opens two years later; that is the whole point of it.
 *
 * @package SML\LoopLetters
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'SML_LoopLetters_Subscriptions_V031', false ) ) {

	final class SML_LoopLetters_Subscriptions_V031 {

		const DB_VERSION_OPT = 'smll_subs_db_version';
		const DB_VERSION     = 2;

		public static function table() {
			global $wpdb;
			return $wpdb->prefix . 'sml_letter_subscribers';
		}

		// ===================================================================
		// Schema
		// ===================================================================

		/**
		 * Adds the columns the original table lacked.
		 *
		 * dbDelta is additive, so this is safe to run against the live table
		 * that already has rows in it — existing data is untouched.
		 */
		public static function install() {
			global $wpdb;
			require_once ABSPATH . 'wp-admin/includes/upgrade.php';

			$table   = self::table();
			$charset = $wpdb->get_charset_collate();

			$sql = "CREATE TABLE {$table} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				publication_user_id BIGINT UNSIGNED NOT NULL,
				email VARCHAR(190) NOT NULL,
				status VARCHAR(20) NOT NULL DEFAULT 'pending',
				token CHAR(64) NULL,
				unsub_token CHAR(64) NULL,
				source VARCHAR(60) NULL,
				created_at DATETIME NOT NULL,
				confirmed_at DATETIME NULL,
				unsubscribed_at DATETIME NULL,
				PRIMARY KEY (id),
				UNIQUE KEY pub_email (publication_user_id, email),
				KEY pub_status (publication_user_id, status),
				KEY token (token),
				KEY unsub_token (unsub_token)
			) {$charset};";

			dbDelta( $sql );

			// Backfill unsubscribe tokens for rows created before this file
			// existed. Without it, everyone who subscribed on day one would
			// have no working exit link.
			$rows = $wpdb->get_col( "SELECT id FROM {$table} WHERE unsub_token IS NULL OR unsub_token = ''" );
			foreach ( (array) $rows as $id ) {
				$wpdb->update(
					$table,
					array( 'unsub_token' => self::new_token() ),
					array( 'id' => (int) $id ),
					array( '%s' ),
					array( '%d' )
				);
			}

			update_option( self::DB_VERSION_OPT, self::DB_VERSION );
		}

		/** Run the upgrade when the stored version is behind. */
		public static function maybe_upgrade() {
			if ( (int) get_option( self::DB_VERSION_OPT ) < self::DB_VERSION ) {
				self::install();
			}
		}

		public static function new_token() {
			return bin2hex( random_bytes( 32 ) );
		}

		// ===================================================================
		// Links
		// ===================================================================

		public static function unsubscribe_url( $unsub_token ) {
			return add_query_arg( 'smll_unsub', $unsub_token, home_url( '/' ) );
		}

		/**
		 * Headers that let a mail client unsubscribe without opening anything.
		 *
		 * Gmail and Outlook surface a native unsubscribe control when these
		 * are present, and a reader who uses it does NOT press "report spam" —
		 * which is the outcome that actually damages sending reputation. Any
		 * future sender should attach these to every letter.
		 *
		 * One-Click requires the List-Unsubscribe-Post header alongside a URL
		 * that accepts POST; self::handle_request() accepts both verbs.
		 */
		public static function mail_headers( $unsub_token, $reply_to = '' ) {
			$url = self::unsubscribe_url( $unsub_token );

			$headers = array(
				'List-Unsubscribe: <' . $url . '>',
				'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
			);
			if ( $reply_to ) {
				$headers[] = 'Reply-To: ' . $reply_to;
			}
			return $headers;
		}

		// ===================================================================
		// Request handling
		// ===================================================================

		/**
		 * Hooked early on template_redirect, before anything renders.
		 *
		 * Both actions land on the publication page with a flag rather than a
		 * dedicated screen, so the reader ends up somewhere useful instead of
		 * on a dead-end confirmation page.
		 */
		public static function handle_request() {
			if ( ! empty( $_GET['smll_unsub'] ) ) {
				self::do_unsubscribe( self::clean_token( wp_unslash( $_GET['smll_unsub'] ) ) );
				return;
			}
			if ( ! empty( $_GET['smll_confirm'] ) ) {
				self::do_confirm( self::clean_token( wp_unslash( $_GET['smll_confirm'] ) ) );
			}
		}

		private static function clean_token( $raw ) {
			$t = preg_replace( '/[^a-f0-9]/', '', (string) $raw );
			return ( 64 === strlen( $t ) ) ? $t : '';
		}

		private static function do_confirm( $token ) {
			if ( ! $token ) {
				return;
			}
			global $wpdb;
			$table = self::table();

			$row = $wpdb->get_row( $wpdb->prepare(
				"SELECT id, publication_user_id FROM {$table} WHERE token = %s",
				$token
			) );

			if ( $row ) {
				$wpdb->update(
					$table,
					array(
						'status'       => 'confirmed',
						'confirmed_at' => current_time( 'mysql', true ),
						'token'        => null,
						'unsub_token'  => self::new_token(),
					),
					array( 'id' => (int) $row->id ),
					array( '%s', '%s', '%s', '%s' ),
					array( '%d' )
				);
				do_action( 'smll_subscriber_confirmed', (int) $row->id, (int) $row->publication_user_id );
			}

			// Same destination whether or not the token matched. The usual
			// cause of a miss is a second click on the same link, and the
			// second click means the first one worked.
			self::bounce( array( 'subscribed' => '1' ) );
		}

		private static function do_unsubscribe( $token ) {
			if ( ! $token ) {
				return;
			}
			global $wpdb;
			$table = self::table();

			$row = $wpdb->get_row( $wpdb->prepare(
				"SELECT id, publication_user_id FROM {$table} WHERE unsub_token = %s",
				$token
			) );

			if ( $row ) {
				// The row is kept, not deleted. A suppression record is what
				// stops a later import or a re-subscribe bug from mailing
				// someone who explicitly asked not to be mailed — deleting the
				// row would throw that protection away.
				$wpdb->update(
					$table,
					array(
						'status'          => 'unsubscribed',
						'unsubscribed_at' => current_time( 'mysql', true ),
					),
					array( 'id' => (int) $row->id ),
					array( '%s', '%s' ),
					array( '%d' )
				);
				do_action( 'smll_subscriber_unsubscribed', (int) $row->id, (int) $row->publication_user_id );
			}

			// A One-Click POST from a mail client wants a bare 200, not a
			// redirect to a human page.
			if ( isset( $_SERVER['REQUEST_METHOD'] ) && 'POST' === strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) ) ) {
				status_header( 200 );
				header( 'Content-Type: text/plain; charset=utf-8' );
				echo 'Unsubscribed.';
				exit;
			}

			$pub_url = '';
			if ( $row ) {
				$handle = get_user_meta( (int) $row->publication_user_id, 'smll_handle', true );
				if ( $handle ) {
					$pub_url = home_url( '/n/' . $handle . '/' );
				}
			}

			self::bounce( array( 'unsubscribed' => '1' ), $pub_url );
		}

		private static function bounce( $args, $base = '' ) {
			$url = $base ? $base : remove_query_arg( array( 'smll_confirm', 'smll_unsub' ) );
			wp_safe_redirect( add_query_arg( $args, $url ), 302 );
			exit;
		}

		// ===================================================================
		// Queries a sender will need
		// ===================================================================

		/**
		 * Addresses that may actually be mailed for a publication.
		 *
		 * Confirmed only. Any future sender should call this rather than
		 * querying the table directly, so the pending and unsubscribed
		 * exclusions can never be forgotten at a call site.
		 */
		public static function mailable( $publication_user_id, $limit = 1000, $offset = 0 ) {
			global $wpdb;
			$table = self::table();

			return $wpdb->get_results( $wpdb->prepare(
				"SELECT id, email, unsub_token
				   FROM {$table}
				  WHERE publication_user_id = %d
				    AND status = 'confirmed'
			   ORDER BY id ASC
				  LIMIT %d OFFSET %d",
				(int) $publication_user_id,
				(int) $limit,
				(int) $offset
			), ARRAY_A );
		}

		public static function counts( $publication_user_id ) {
			global $wpdb;
			$table = self::table();

			$rows = $wpdb->get_results( $wpdb->prepare(
				"SELECT status, COUNT(*) AS n FROM {$table} WHERE publication_user_id = %d GROUP BY status",
				(int) $publication_user_id
			), ARRAY_A );

			$out = array( 'pending' => 0, 'confirmed' => 0, 'unsubscribed' => 0 );
			foreach ( (array) $rows as $r ) {
				$out[ $r['status'] ] = (int) $r['n'];
			}
			$out['total'] = array_sum( $out );
			return $out;
		}

		/**
		 * A creator's own list, as CSV.
		 *
		 * Portability is not a nicety here. A creator who cannot leave with
		 * their list is not really a creator on this platform, and the ability
		 * to walk is what makes it reasonable for them to invest in building
		 * an audience on it in the first place.
		 */
		public static function export_csv( $publication_user_id ) {
			global $wpdb;
			$table = self::table();

			$rows = $wpdb->get_results( $wpdb->prepare(
				"SELECT email, status, source, created_at, confirmed_at
				   FROM {$table} WHERE publication_user_id = %d ORDER BY id ASC",
				(int) $publication_user_id
			), ARRAY_A );

			$out = "email,status,source,created_at,confirmed_at\n";
			foreach ( (array) $rows as $r ) {
				$out .= implode( ',', array_map( static function ( $v ) {
					$v = (string) $v;
					return ( false !== strpbrk( $v, ",\"\n" ) )
						? '"' . str_replace( '"', '""', $v ) . '"'
						: $v;
				}, $r ) ) . "\n";
			}
			return $out;
		}

		// ===================================================================
		// REST
		// ===================================================================

		/**
		 * @param string $ns Namespace of the host plugin. Passed in rather
		 *                   than hard-coded because production renamed it from
		 *                   sml-letters/v1 to sml-loopletters/v1, and this file
		 *                   should not need editing if it moves again.
		 */
		public static function register_routes( $ns ) {
			register_rest_route( $ns, '/subscribers', array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'rest_list' ),
				'permission_callback' => static function () {
					return is_user_logged_in();
				},
			) );

			register_rest_route( $ns, '/subscribers/export', array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'rest_export' ),
				'permission_callback' => static function () {
					return is_user_logged_in();
				},
			) );

		}

		/** A creator only ever sees their own subscribers. */
		public static function rest_list() {
			$id = get_current_user_id();
			return rest_ensure_response( array(
				'counts' => self::counts( $id ),
			) );
		}

		public static function rest_export() {
			$id  = get_current_user_id();
			$csv = self::export_csv( $id );

			return new WP_REST_Response( $csv, 200, array(
				'Content-Type'        => 'text/csv; charset=utf-8',
				'Content-Disposition' => 'attachment; filename="subscribers.csv"',
			) );
		}
	}
}
