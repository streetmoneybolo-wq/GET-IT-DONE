/**
 * SML Discord role -> website group access bridge.
 *
 * Install as a PHP snippet in WPCode (Auto Insert / Run Everywhere).
 * The Discord bot authenticates with the existing administrator-scoped WordPress
 * Application Password. No Discord token, browser session, or user password is
 * ever sent to the site.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

if ( ! function_exists( 'sml_drs_tables' ) ) {
    define( 'SML_DRS_VERSION', '1.0.0' );
    define( 'SML_DRS_CONNECT_PATH', 'connect-discord' );

    function sml_drs_tables() {
        global $wpdb;
        return array(
            'links'  => $wpdb->prefix . 'sml_discord_site_links',
            'codes'  => $wpdb->prefix . 'sml_discord_site_link_codes',
            'grants' => $wpdb->prefix . 'sml_discord_group_grants',
            'audit'  => $wpdb->prefix . 'sml_discord_role_audit',
        );
    }

    function sml_drs_group_members_table() {
        global $wpdb;
        return $wpdb->prefix . 'sml_group_members';
    }

    function sml_drs_install() {
        if ( get_option( 'sml_drs_version' ) === SML_DRS_VERSION ) {
            return;
        }
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $t       = sml_drs_tables();

        dbDelta( "CREATE TABLE {$t['links']} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            discord_user_id VARCHAR(32) NOT NULL,
            discord_tag VARCHAR(190) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY user_id (user_id),
            UNIQUE KEY discord_user_id (discord_user_id)
        ) $charset;" );

        dbDelta( "CREATE TABLE {$t['codes']} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            code_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY user_id (user_id),
            UNIQUE KEY code_hash (code_hash),
            KEY expires_at (expires_at)
        ) $charset;" );

        dbDelta( "CREATE TABLE {$t['grants']} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            group_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            discord_user_id VARCHAR(32) NOT NULL,
            applied_role VARCHAR(20) NOT NULL,
            source_role_ids LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY group_user (group_id,user_id),
            KEY discord_user_id (discord_user_id),
            KEY user_id (user_id)
        ) $charset;" );

        dbDelta( "CREATE TABLE {$t['audit']} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            event_type VARCHAR(64) NOT NULL,
            group_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            discord_user_id VARCHAR(32) NOT NULL DEFAULT '',
            detail LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY group_user (group_id,user_id),
            KEY discord_user_id (discord_user_id),
            KEY created_at (created_at)
        ) $charset;" );

        update_option( 'sml_drs_version', SML_DRS_VERSION, false );
    }

    /**
     * The approved, explicit mapping for Making Easy Money (website group #7).
     * The Discord role IDs, not mutable display names, are the authority.
     * Never add an owner mapping here: ownership remains a manual website action.
     */
    function sml_drs_role_mappings() {
        return array(
            array( 'guild_id' => '938894329076940820', 'role_id' => '939031140679970867',  'group_id' => 7, 'group_role' => 'premium' ), // Premium Member
            array( 'guild_id' => '938894329076940820', 'role_id' => '1192450618485395466', 'group_id' => 7, 'group_role' => 'premium' ), // Elite Member
            array( 'guild_id' => '938894329076940820', 'role_id' => '1260433215189946420', 'group_id' => 7, 'group_role' => 'premium' ), // Monarch
            array( 'guild_id' => '938894329076940820', 'role_id' => '943288727587934258',  'group_id' => 7, 'group_role' => 'mod' ),     // Moderator
            array( 'guild_id' => '938894329076940820', 'role_id' => '938895181585993800',  'group_id' => 7, 'group_role' => 'admin' ),   // MANAGER
            array( 'guild_id' => '938894329076940820', 'role_id' => '1004867374106816514', 'group_id' => 7, 'group_role' => 'admin' ),   // MEM Manager
            array( 'guild_id' => '938894329076940820', 'role_id' => '938964873331744769',  'group_id' => 7, 'group_role' => 'analyst' ), // In Analyst
            array( 'guild_id' => '938894329076940820', 'role_id' => '1177661163820036167', 'group_id' => 7, 'group_role' => 'analyst' ), // In Analyst - OBI
            array( 'guild_id' => '938894329076940820', 'role_id' => '1177658761159135383', 'group_id' => 7, 'group_role' => 'analyst' ), // In Analyst - WolfPack
        );
    }

    function sml_drs_role_weight( $role ) {
        $weights = array( 'member' => 10, 'premium' => 20, 'analyst' => 30, 'mod' => 40, 'admin' => 50 );
        return isset( $weights[ $role ] ) ? $weights[ $role ] : 0;
    }

    function sml_drs_now() {
        return current_time( 'mysql', true );
    }

    function sml_drs_audit( $event_type, $group_id = 0, $user_id = 0, $discord_user_id = '', $detail = array() ) {
        global $wpdb;
        $t = sml_drs_tables();
        $wpdb->insert(
            $t['audit'],
            array(
                'event_type'      => sanitize_key( $event_type ),
                'group_id'        => absint( $group_id ),
                'user_id'         => absint( $user_id ),
                'discord_user_id' => preg_replace( '/\D/', '', (string) $discord_user_id ),
                'detail'          => wp_json_encode( $detail, JSON_UNESCAPED_SLASHES ),
                'created_at'      => sml_drs_now(),
            ),
            array( '%s', '%d', '%d', '%s', '%s', '%s' )
        );
    }

    function sml_drs_clean_discord_id( $value ) {
        $value = preg_replace( '/\D/', '', (string) $value );
        return preg_match( '/^\d{15,24}$/', $value ) ? $value : '';
    }

    function sml_drs_clean_role_ids( $roles ) {
        $roles = is_array( $roles ) ? $roles : array();
        $clean = array();
        foreach ( $roles as $role ) {
            $role = sml_drs_clean_discord_id( $role );
            if ( $role !== '' ) {
                $clean[ $role ] = true;
            }
        }
        return array_keys( $clean );
    }

    function sml_drs_group_members_ready() {
        global $wpdb;
        $table = sml_drs_group_members_table();
        return (string) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) === $table;
    }

    function sml_drs_issue_link_code( $user_id ) {
        global $wpdb;
        $user_id = absint( $user_id );
        if ( ! $user_id ) {
            return new WP_Error( 'sml_drs_login_required', 'Sign in before connecting Discord.', array( 'status' => 401 ) );
        }
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $code     = '';
        for ( $i = 0; $i < 10; $i++ ) {
            $code .= $alphabet[ random_int( 0, strlen( $alphabet ) - 1 ) ];
        }
        $t   = sml_drs_tables();
        $now = sml_drs_now();
        $wpdb->delete( $t['codes'], array( 'user_id' => $user_id ), array( '%d' ) );
        $wpdb->insert(
            $t['codes'],
            array(
                'user_id'    => $user_id,
                'code_hash'  => hash( 'sha256', $code ),
                'expires_at' => gmdate( 'Y-m-d H:i:s', time() + ( 10 * MINUTE_IN_SECONDS ) ),
                'created_at' => $now,
            ),
            array( '%d', '%s', '%s', '%s' )
        );
        if ( ! $wpdb->insert_id ) {
            return new WP_Error( 'sml_drs_code_failed', 'Could not create a Discord link code. Please try again.', array( 'status' => 500 ) );
        }
        return array( 'code' => $code, 'expires_at' => gmdate( 'c', time() + ( 10 * MINUTE_IN_SECONDS ) ) );
    }

    function sml_drs_link_for_user( $user_id ) {
        global $wpdb;
        $t = sml_drs_tables();
        return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['links']} WHERE user_id=%d", absint( $user_id ) ), ARRAY_A );
    }

    function sml_drs_bot_permission() {
        // The configured bot WordPress Application Password belongs to an administrator.
        // This is intentionally stricter than edit_posts: role grants are authorization changes.
        return current_user_can( 'manage_options' );
    }

    function sml_drs_register_routes() {
        register_rest_route( 'sml-discord-site/v1', '/status', array(
            'methods'             => 'GET',
            'permission_callback' => 'is_user_logged_in',
            'callback'            => 'sml_drs_rest_status',
        ) );
        register_rest_route( 'sml-discord-site/v1', '/link-code', array(
            'methods'             => 'POST',
            'permission_callback' => 'is_user_logged_in',
            'callback'            => 'sml_drs_rest_link_code',
        ) );
        register_rest_route( 'sml-discord-site/v1', '/unlink', array(
            'methods'             => 'POST',
            'permission_callback' => 'is_user_logged_in',
            'callback'            => 'sml_drs_rest_unlink',
        ) );
        register_rest_route( 'sml-discord-site/v1', '/bot/link', array(
            'methods'             => 'POST',
            'permission_callback' => 'sml_drs_bot_permission',
            'callback'            => 'sml_drs_rest_bot_link',
        ) );
        register_rest_route( 'sml-discord-site/v1', '/bot/sync-roles', array(
            'methods'             => 'POST',
            'permission_callback' => 'sml_drs_bot_permission',
            'callback'            => 'sml_drs_rest_bot_sync_roles',
        ) );
    }

    function sml_drs_rest_status() {
        $link = sml_drs_link_for_user( get_current_user_id() );
        return array(
            'connected'        => ! empty( $link ),
            'discord_user_id'  => $link ? (string) $link['discord_user_id'] : '',
            'discord_tag'      => $link ? (string) $link['discord_tag'] : '',
            'connect_url'      => home_url( '/' . SML_DRS_CONNECT_PATH . '/' ),
        );
    }

    function sml_drs_rest_link_code() {
        $issued = sml_drs_issue_link_code( get_current_user_id() );
        return is_wp_error( $issued ) ? $issued : array_merge( $issued, array( 'instruction' => 'Use /link-sml code:' . $issued['code'] . ' in the Making Easy Money Discord.' ) );
    }

    function sml_drs_rest_bot_link( WP_REST_Request $request ) {
        global $wpdb;
        $code            = strtoupper( preg_replace( '/[^A-Z0-9]/', '', (string) $request->get_param( 'code' ) ) );
        $discord_user_id = sml_drs_clean_discord_id( $request->get_param( 'discord_user_id' ) );
        $discord_tag     = sanitize_text_field( (string) $request->get_param( 'discord_tag' ) );
        if ( strlen( $code ) !== 10 || $discord_user_id === '' ) {
            return new WP_Error( 'sml_drs_invalid_link', 'That Discord link code is invalid or expired.', array( 'status' => 400 ) );
        }
        $t   = sml_drs_tables();
        $now = sml_drs_now();
        $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['codes']} WHERE code_hash=%s AND expires_at >= %s", hash( 'sha256', $code ), $now ), ARRAY_A );
        if ( ! $row ) {
            return new WP_Error( 'sml_drs_invalid_link', 'That Discord link code is invalid or expired.', array( 'status' => 400 ) );
        }
        $existing = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['links']} WHERE discord_user_id=%s", $discord_user_id ), ARRAY_A );
        if ( $existing && (int) $existing['user_id'] !== (int) $row['user_id'] ) {
            return new WP_Error( 'sml_drs_discord_already_linked', 'This Discord account is already connected to a different StockMarketLoop account.', array( 'status' => 409 ) );
        }
        // Delete first so a code is single-use even if the next write is retried.
        $wpdb->delete( $t['codes'], array( 'id' => (int) $row['id'] ), array( '%d' ) );
        $user_link = sml_drs_link_for_user( (int) $row['user_id'] );
        if ( $user_link ) {
            $wpdb->update( $t['links'], array( 'discord_user_id' => $discord_user_id, 'discord_tag' => $discord_tag, 'updated_at' => $now ), array( 'user_id' => (int) $row['user_id'] ), array( '%s', '%s', '%s' ), array( '%d' ) );
        } else {
            $wpdb->insert( $t['links'], array( 'user_id' => (int) $row['user_id'], 'discord_user_id' => $discord_user_id, 'discord_tag' => $discord_tag, 'created_at' => $now, 'updated_at' => $now ), array( '%d', '%s', '%s', '%s', '%s' ) );
        }
        sml_drs_audit( 'identity_linked', 0, (int) $row['user_id'], $discord_user_id, array( 'discord_tag' => $discord_tag ) );
        return array( 'linked' => true, 'user_id' => (int) $row['user_id'] );
    }

    function sml_drs_desired_roles( $guild_id, $role_ids ) {
        $desired = array();
        $role_ids = array_flip( sml_drs_clean_role_ids( $role_ids ) );
        foreach ( sml_drs_role_mappings() as $mapping ) {
            if ( (string) $mapping['guild_id'] !== (string) $guild_id || ! isset( $role_ids[ (string) $mapping['role_id'] ] ) ) {
                continue;
            }
            $group_id = absint( $mapping['group_id'] );
            $role     = sanitize_key( $mapping['group_role'] );
            if ( ! isset( $desired[ $group_id ] ) || sml_drs_role_weight( $role ) > sml_drs_role_weight( $desired[ $group_id ] ) ) {
                $desired[ $group_id ] = $role;
            }
        }
        return $desired;
    }

    function sml_drs_mapped_group_ids( $guild_id ) {
        $ids = array();
        foreach ( sml_drs_role_mappings() as $mapping ) {
            if ( (string) $mapping['guild_id'] === (string) $guild_id ) {
                $ids[] = absint( $mapping['group_id'] );
            }
        }
        return array_values( array_unique( array_filter( $ids ) ) );
    }

    function sml_drs_sync_one_group( $group_id, $user_id, $discord_user_id, $desired_role, $source_role_ids ) {
        global $wpdb;
        $t           = sml_drs_tables();
        $members     = sml_drs_group_members_table();
        $group_id    = absint( $group_id );
        $user_id     = absint( $user_id );
        $desired_role = sanitize_key( (string) $desired_role );
        $now         = sml_drs_now();
        $membership  = $wpdb->get_row( $wpdb->prepare( "SELECT id,role FROM {$members} WHERE group_id=%d AND user_id=%d", $group_id, $user_id ), ARRAY_A );
        $grant       = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['grants']} WHERE group_id=%d AND user_id=%d", $group_id, $user_id ), ARRAY_A );

        if ( $desired_role === '' ) {
            if ( ! $grant ) {
                return array( 'group_id' => $group_id, 'action' => 'none' );
            }
            if ( $membership && (string) $membership['role'] === (string) $grant['applied_role'] ) {
                $wpdb->delete( $members, array( 'group_id' => $group_id, 'user_id' => $user_id ), array( '%d', '%d' ) );
                $action = 'revoked';
            } else {
                // A manager or paid-flow changed the membership after the bot granted it.
                // Do not delete a membership we can no longer prove that we own.
                $action = 'protected_manual_membership';
            }
            $wpdb->delete( $t['grants'], array( 'id' => (int) $grant['id'] ), array( '%d' ) );
            sml_drs_audit( 'role_' . $action, $group_id, $user_id, $discord_user_id, array( 'previous_role' => $grant['applied_role'] ) );
            return array( 'group_id' => $group_id, 'action' => $action );
        }

        if ( ! $membership ) {
            $wpdb->insert( $members, array( 'group_id' => $group_id, 'user_id' => $user_id, 'role' => $desired_role, 'joined_at' => $now ), array( '%d', '%d', '%s', '%s' ) );
            $action = 'granted';
        } elseif ( $grant && (string) $membership['role'] === (string) $grant['applied_role'] ) {
            if ( (string) $membership['role'] !== $desired_role ) {
                $wpdb->update( $members, array( 'role' => $desired_role ), array( 'group_id' => $group_id, 'user_id' => $user_id ), array( '%s' ), array( '%d', '%d' ) );
                $action = 'updated';
            } else {
                $action = 'unchanged';
            }
        } elseif ( $grant ) {
            // Never overwrite a membership which a human or a paid flow changed.
            return array( 'group_id' => $group_id, 'action' => 'protected_manual_membership' );
        } else {
            // Existing group memberships are not claimed by this integration.
            return array( 'group_id' => $group_id, 'action' => 'protected_existing_membership' );
        }

        if ( $grant ) {
            $wpdb->update( $t['grants'], array( 'discord_user_id' => $discord_user_id, 'applied_role' => $desired_role, 'source_role_ids' => wp_json_encode( array_values( $source_role_ids ) ), 'updated_at' => $now ), array( 'id' => (int) $grant['id'] ), array( '%s', '%s', '%s', '%s' ), array( '%d' ) );
        } else {
            $wpdb->insert( $t['grants'], array( 'group_id' => $group_id, 'user_id' => $user_id, 'discord_user_id' => $discord_user_id, 'applied_role' => $desired_role, 'source_role_ids' => wp_json_encode( array_values( $source_role_ids ) ), 'created_at' => $now, 'updated_at' => $now ), array( '%d', '%d', '%s', '%s', '%s', '%s', '%s' ) );
        }
        if ( $action !== 'unchanged' ) {
            sml_drs_audit( 'role_' . $action, $group_id, $user_id, $discord_user_id, array( 'role' => $desired_role, 'source_role_ids' => array_values( $source_role_ids ) ) );
        }
        return array( 'group_id' => $group_id, 'action' => $action, 'role' => $desired_role );
    }

    function sml_drs_rest_bot_sync_roles( WP_REST_Request $request ) {
        global $wpdb;
        if ( ! sml_drs_group_members_ready() ) {
            return new WP_Error( 'sml_drs_groups_unavailable', 'The Groups membership table is unavailable; no role changes were made.', array( 'status' => 503 ) );
        }
        $guild_id        = sml_drs_clean_discord_id( $request->get_param( 'guild_id' ) );
        $discord_user_id = sml_drs_clean_discord_id( $request->get_param( 'discord_user_id' ) );
        $role_ids        = sml_drs_clean_role_ids( $request->get_param( 'role_ids' ) );
        if ( $guild_id === '' || $discord_user_id === '' || ! sml_drs_mapped_group_ids( $guild_id ) ) {
            return new WP_Error( 'sml_drs_unmapped_guild', 'This Discord server is not configured for website group access.', array( 'status' => 404 ) );
        }
        $t    = sml_drs_tables();
        $link = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['links']} WHERE discord_user_id=%s", $discord_user_id ), ARRAY_A );
        if ( ! $link ) {
            return array( 'linked' => false, 'changed' => false, 'results' => array() );
        }
        $desired = sml_drs_desired_roles( $guild_id, $role_ids );
        $results = array();
        foreach ( sml_drs_mapped_group_ids( $guild_id ) as $group_id ) {
            $results[] = sml_drs_sync_one_group( $group_id, (int) $link['user_id'], $discord_user_id, $desired[ $group_id ] ?? '', $role_ids );
        }
        $changed = count( array_filter( $results, function( $result ) {
            return in_array( $result['action'] ?? '', array( 'granted', 'updated', 'revoked' ), true );
        } ) ) > 0;
        return array( 'linked' => true, 'changed' => $changed, 'results' => $results );
    }

    function sml_drs_revoke_user_grants( $user_id ) {
        global $wpdb;
        $t      = sml_drs_tables();
        $grants = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$t['grants']} WHERE user_id=%d", absint( $user_id ) ), ARRAY_A ) ?: array();
        foreach ( $grants as $grant ) {
            sml_drs_sync_one_group( (int) $grant['group_id'], absint( $user_id ), (string) $grant['discord_user_id'], '', array() );
        }
    }

    function sml_drs_rest_unlink() {
        global $wpdb;
        $user_id = get_current_user_id();
        $link    = sml_drs_link_for_user( $user_id );
        if ( ! $link ) {
            return array( 'unlinked' => false );
        }
        sml_drs_revoke_user_grants( $user_id );
        $t = sml_drs_tables();
        $wpdb->delete( $t['links'], array( 'user_id' => $user_id ), array( '%d' ) );
        $wpdb->delete( $t['codes'], array( 'user_id' => $user_id ), array( '%d' ) );
        sml_drs_audit( 'identity_unlinked', 0, $user_id, $link['discord_user_id'] );
        return array( 'unlinked' => true );
    }

    function sml_drs_register_rewrite() {
        add_rewrite_tag( '%sml_drs_connect%', '([0-9]+)' );
        add_rewrite_rule( '^' . SML_DRS_CONNECT_PATH . '/?$', 'index.php?sml_drs_connect=1', 'top' );
    }

    function sml_drs_query_vars( $vars ) {
        $vars[] = 'sml_drs_connect';
        return $vars;
    }

    function sml_drs_is_connect_request() {
        if ( get_query_var( 'sml_drs_connect' ) ) {
            return true;
        }
        $uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
        return (bool) preg_match( '#/' . preg_quote( SML_DRS_CONNECT_PATH, '#' ) . '/?(?:\?|$)#', $uri );
    }

    function sml_drs_connect_page() {
        if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ! sml_drs_is_connect_request() ) {
            return;
        }
        if ( ! is_user_logged_in() ) {
            auth_redirect();
        }
        $link   = sml_drs_link_for_user( get_current_user_id() );
        $issued = $link ? null : sml_drs_issue_link_code( get_current_user_id() );
        status_header( 200 );
        nocache_headers();
        get_header();
        echo '<main class="sml-drs-page"><style>.sml-drs-page{max-width:760px;margin:42px auto;padding:24px;color:#e8f1ff}.sml-drs-card{background:#08111d;border:1px solid #1d4262;border-radius:18px;padding:30px;box-shadow:0 18px 60px #0006}.sml-drs-page h1{margin:0 0 10px}.sml-drs-code{display:block;margin:24px 0;padding:18px;border-radius:12px;background:#020811;border:1px dashed #32d583;color:#67f0ae;font:700 30px/1.2 ui-monospace,monospace;letter-spacing:.12em;text-align:center}.sml-drs-page button{border:0;border-radius:10px;padding:12px 16px;font-weight:800;cursor:pointer;background:#20c977;color:#03110b}.sml-drs-page button.secondary{margin-left:8px;background:#26394b;color:#fff}.sml-drs-note{color:#a9bfd3;font-size:14px}.sml-drs-status{padding:12px;border-radius:10px;background:#102719;color:#a6f3c4}</style><section class="sml-drs-card"><h1>Connect Discord</h1>';
        if ( $link ) {
            echo '<p class="sml-drs-status">Connected to Discord account <strong>' . esc_html( $link['discord_tag'] ?: $link['discord_user_id'] ) . '</strong>.</p><p>Discord-managed access to Making Easy Money is now kept in sync with your Discord roles.</p><button id="sml-drs-unlink" class="secondary">Disconnect Discord</button><p id="sml-drs-message" class="sml-drs-note"></p>';
        } elseif ( is_wp_error( $issued ) ) {
            echo '<p>Could not create a link code. Please reload this page.</p>';
        } else {
            echo '<p>In the Making Easy Money Discord, run this command from any channel where the bot is available:</p><code class="sml-drs-code">/link-sml code:' . esc_html( $issued['code'] ) . '</code><button id="sml-drs-copy" data-code="/link-sml code:' . esc_attr( $issued['code'] ) . '">Copy command</button><p class="sml-drs-note">This one-time code expires in 10 minutes. Do not share it.</p>';
        }
        $nonce = wp_create_nonce( 'wp_rest' );
        echo '<script>(function(){const b=document.getElementById("sml-drs-copy");if(b){b.addEventListener("click",async()=>{await navigator.clipboard.writeText(b.dataset.code);b.textContent="Copied — paste it in Discord";});}const u=document.getElementById("sml-drs-unlink");if(u){u.addEventListener("click",async()=>{if(!confirm("Disconnect Discord? Discord-created group access will be removed, but paid/manual access is never changed."))return;const r=await fetch("' . esc_url( rest_url( 'sml-discord-site/v1/unlink' ) ) . '",{method:"POST",headers:{"X-WP-Nonce":"' . esc_js( $nonce ) . '"}});const j=await r.json();document.getElementById("sml-drs-message").textContent=j.unlinked?"Disconnected. Reloading…":(j.message||"Could not disconnect.");if(j.unlinked)setTimeout(()=>location.reload(),800);});}})();</script></section></main>';
        get_footer();
        exit;
    }

    add_action( 'init', 'sml_drs_install', 1 );
    add_action( 'init', 'sml_drs_register_rewrite', 6 );
    add_filter( 'query_vars', 'sml_drs_query_vars' );
    add_action( 'template_redirect', 'sml_drs_connect_page', 1 );
    add_action( 'rest_api_init', 'sml_drs_register_routes' );
}
