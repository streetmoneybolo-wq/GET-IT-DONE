<?php
/**
 * Plugin Name: SML Newsroom Author Provisioner
 * Description: Activation-only provisioning for 15 transparent StockMarketLoop specialist editorial desks.
 * Version: 1.1.0
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! class_exists( 'SML_Newsroom_Author_Provisioner' ) ) {
	final class SML_Newsroom_Author_Provisioner {
		const OPTION = 'sml_newsroom_author_ids';

		private static function desks() {
			return array(
				'options-flow'            => array( 'sml-options-flow', 'SML Options Flow', 'Unusual options volume, premium, repeated strikes, 0DTE and contract activity.' ),
				'gamma-volatility'        => array( 'sml-gamma-volatility', 'SML Gamma & Volatility', 'Gamma exposure, implied-volatility structure, max pain and volatility regimes.' ),
				'earnings'                => array( 'sml-earnings-desk', 'SML Earnings Desk', 'Earnings calendars, reported results, guidance and post-earnings price action.' ),
				'sec-corporate-actions'   => array( 'sml-filings-actions', 'SML Filings & Corporate Actions', 'SEC filings, offerings, dividends, buybacks, splits and mergers.' ),
				'analyst-valuation'       => array( 'sml-analyst-valuation', 'SML Analyst & Valuation', 'Ratings, price targets, consensus changes and relative valuation.' ),
				'institutional-ownership' => array( 'sml-institutional-ledger', 'SML Institutional Ledger', 'Institutional ownership, shareholder changes and fund positioning.' ),
				'insider-activity'        => array( 'sml-insider-activity', 'SML Insider Activity', 'Verified insider purchases, sales and ownership changes.' ),
				'short-interest'          => array( 'sml-short-interest-watch', 'SML Short Interest Watch', 'Short interest, borrow pressure, days to cover and squeeze conditions.' ),
				'macro-policy'            => array( 'sml-macro-policy', 'SML Macro & Policy', 'Economic releases, central banks, rates and market-wide breadth.' ),
				'semiconductors-ai'       => array( 'sml-semiconductors-ai', 'SML Semiconductors & AI', 'Semiconductors, AI infrastructure and computing supply chains.' ),
				'biotech-healthcare'      => array( 'sml-biotech-healthcare', 'SML Biotech & Healthcare', 'Biotechnology, pharmaceuticals, healthcare and FDA catalysts.' ),
				'energy-commodities'      => array( 'sml-energy-commodities', 'SML Energy & Commodities', 'Energy companies, oil, gas, metals and commodity-linked equities.' ),
				'financials-banks'        => array( 'sml-banks-financials', 'SML Banks & Financials', 'Banks, insurers, brokers, credit and financial-system risk.' ),
				'consumer-retail'         => array( 'sml-consumer-retail', 'SML Consumer & Retail', 'Retail, consumer demand, travel and discretionary spending.' ),
				'small-cap-risk'          => array( 'sml-small-cap-risk', 'SML Small-Cap Risk Desk', 'Small caps, low floats, dilution, reverse splits and high-risk catalysts.' ),
			);
		}

		public static function activate() {
			/* Preflight every username before creating anything, avoiding partial runs. */
			foreach ( self::desks() as $desk ) {
				$existing = get_user_by( 'login', $desk[0] );
				if ( $existing && '1' !== (string) get_user_meta( $existing->ID, 'sml_automated_editorial_desk', true ) ) {
					wp_die( esc_html( 'Provisioning stopped: the username ' . $desk[0] . ' already belongs to a non-newsroom account. Nothing was created or overwritten.' ) );
				}
			}
			$ids = array();
			foreach ( self::desks() as $key => $desk ) {
				list( $login, $name, $beat ) = $desk;
				$existing = get_user_by( 'login', $login );
				if ( $existing ) {
					$user_id = (int) $existing->ID;
				} else {
					$user_id = wp_insert_user( array(
						'user_login'   => $login,
						'user_pass'    => wp_generate_password( 64, true, true ),
						'display_name' => $name,
						'nickname'     => $name,
						'description'  => $beat . ' This is a transparent StockMarketLoop automated market-data editorial desk, not a human identity.',
						'role'         => 'author',
					) );
					if ( is_wp_error( $user_id ) ) { wp_die( esc_html( $user_id->get_error_message() ) ); }
				}
				update_user_meta( $user_id, 'sml_automated_editorial_desk', '1' );
				update_user_meta( $user_id, 'sml_editorial_desk_key', $key );
				update_user_meta( $user_id, 'sml_editorial_beat', $beat );
				update_user_meta( $user_id, 'show_admin_bar_front', 'false' );
				$ids[ $key ] = $user_id;
			}
			update_option( self::OPTION, $ids, false );
		}

		public static function notice() {
			if ( ! current_user_can( 'manage_options' ) ) { return; }
			$ids = get_option( self::OPTION, array() );
			if ( 15 !== count( $ids ) ) { return; }
			echo '<div class="notice notice-success"><p><strong>SML Newsroom:</strong> 15 specialist author desks are provisioned. Copy this server setting before deploying the newsroom worker:</p><p><code>SML_NEWSROOM_AUTHORS_JSON=' . esc_html( wp_json_encode( $ids ) ) . '</code></p></div>';
		}

		public static function register_meta() {
			register_post_meta( 'post', '_sml_editorial_desk', array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'sanitize_key',
				'auth_callback'     => static function () { return current_user_can( 'publish_posts' ); },
			) );
		}

		private static function avatar_user( $id_or_email ) {
			if ( $id_or_email instanceof WP_User ) { return $id_or_email; }
			if ( $id_or_email instanceof WP_Post ) { return get_user_by( 'id', $id_or_email->post_author ); }
			if ( $id_or_email instanceof WP_Comment && $id_or_email->user_id ) { return get_user_by( 'id', $id_or_email->user_id ); }
			if ( is_numeric( $id_or_email ) ) { return get_user_by( 'id', absint( $id_or_email ) ); }
			if ( is_string( $id_or_email ) && is_email( $id_or_email ) ) { return get_user_by( 'email', $id_or_email ); }
			return false;
		}

		public static function avatar( $args, $id_or_email ) {
			$user = self::avatar_user( $id_or_email );
			if ( ! $user ) { return $args; }
			$key = (string) get_user_meta( $user->ID, 'sml_editorial_desk_key', true );
			$desks = self::desks();
			if ( ! isset( $desks[ $key ] ) ) { return $args; }
			$file = $desks[ $key ][0] . '.png';
			$path = plugin_dir_path( __FILE__ ) . 'assets/authors/' . $file;
			if ( ! is_readable( $path ) ) { return $args; }
			$url = plugin_dir_url( __FILE__ ) . 'assets/authors/' . rawurlencode( $file );
			$args['url'] = $url;
			$args['found_avatar'] = true;
			return $args;
		}

		public static function register_routes() {
			register_rest_route( 'sml-newsroom/v1', '/publish', array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => array( __CLASS__, 'can_publish' ),
				'callback'            => array( __CLASS__, 'publish' ),
			) );
		}

		public static function can_publish() {
			$user = wp_get_current_user();
			$service_slug = (string) apply_filters( 'sml_newsroom_service_author_slug', 'stockmarketloop' );
			return $user->exists() && current_user_can( 'publish_posts' ) && $service_slug === (string) $user->user_nicename;
		}

		private static function sanitize_content( $content ) {
			$content = (string) $content;
			if ( preg_match_all( '/<iframe\b[^>]*\bsrc=["\']([^"\']+)["\']/i', $content, $matches ) ) {
				$allowed_base = untrailingslashit( home_url( '/stock-chart/' ) );
				foreach ( $matches[1] as $src ) {
					if ( 0 !== strpos( esc_url_raw( $src ), $allowed_base ) ) {
						return new WP_Error( 'sml_newsroom_iframe_invalid', 'Only the StockMarketLoop Ticker Terminal may be embedded.', array( 'status' => 422 ) );
					}
				}
			}
			$allowed = wp_kses_allowed_html( 'post' );
			$allowed['iframe'] = array( 'src' => true, 'title' => true, 'loading' => true );
			return wp_kses( $content, $allowed );
		}

		public static function publish( WP_REST_Request $request ) {
			$body = $request->get_json_params();
			$desk = sanitize_key( isset( $body['editorial_desk'] ) ? $body['editorial_desk'] : '' );
			$ids  = get_option( self::OPTION, array() );
			$author_id = isset( $ids[ $desk ] ) ? absint( $ids[ $desk ] ) : 0;
			if ( ! $author_id || $desk !== (string) get_user_meta( $author_id, 'sml_editorial_desk_key', true ) ) {
				return new WP_Error( 'sml_newsroom_author_invalid', 'The editorial desk author is not provisioned.', array( 'status' => 422 ) );
			}
			$slug = sanitize_title( isset( $body['slug'] ) ? $body['slug'] : '' );
			if ( '' === $slug ) { return new WP_Error( 'sml_newsroom_slug_invalid', 'A valid slug is required.', array( 'status' => 422 ) ); }
			$existing = get_page_by_path( $slug, OBJECT, 'post' );
			if ( $existing instanceof WP_Post ) {
				return new WP_Error( 'sml_duplicate_article', 'A post with this slug already exists.', array( 'status' => 409, 'post_id' => $existing->ID ) );
			}
			$content = self::sanitize_content( isset( $body['content'] ) ? $body['content'] : '' );
			if ( is_wp_error( $content ) ) { return $content; }
			$post_id = wp_insert_post( wp_slash( array(
				'post_type'      => 'post',
				'post_status'    => 'publish',
				'post_author'    => $author_id,
				'post_title'     => sanitize_text_field( isset( $body['title'] ) ? $body['title'] : '' ),
				'post_excerpt'   => sanitize_textarea_field( isset( $body['excerpt'] ) ? $body['excerpt'] : '' ),
				'post_name'      => $slug,
				'post_content'   => $content,
				'post_mime_type' => '',
			) ), true );
			if ( is_wp_error( $post_id ) ) { return $post_id; }
			if ( ! empty( $body['featured_media'] ) ) { set_post_thumbnail( $post_id, absint( $body['featured_media'] ) ); }
			$meta = isset( $body['meta'] ) && is_array( $body['meta'] ) ? $body['meta'] : array();
			$allowed_meta = array( '_sml_pipeline_version', '_sml_source_url_hash', '_sml_source_url', '_sml_subtitle', '_sml_editorial_desk', 'rank_math_title', 'rank_math_description', 'rank_math_focus_keyword' );
			foreach ( $allowed_meta as $key ) {
				if ( isset( $meta[ $key ] ) ) { update_post_meta( $post_id, $key, sanitize_text_field( $meta[ $key ] ) ); }
			}
			clean_post_cache( $post_id );
			return rest_ensure_response( array( 'id' => $post_id, 'link' => get_permalink( $post_id ), 'author' => $author_id, 'editorial_desk' => $desk ) );
		}
	}

	register_activation_hook( __FILE__, array( 'SML_Newsroom_Author_Provisioner', 'activate' ) );
	add_action( 'init', array( 'SML_Newsroom_Author_Provisioner', 'register_meta' ) );
	add_action( 'rest_api_init', array( 'SML_Newsroom_Author_Provisioner', 'register_routes' ) );
	add_filter( 'get_avatar_data', array( 'SML_Newsroom_Author_Provisioner', 'avatar' ), 20, 2 );
	add_action( 'admin_notices', array( 'SML_Newsroom_Author_Provisioner', 'notice' ) );
}
