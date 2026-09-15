<?php
/**
 * REST surface for the Game Panel.
 *
 * Every route is deliberately small and stateless-ish so that swapping the
 * polling transport for a WebSocket server later means reimplementing the
 * push, not the rules. sml_game_public_table() is the single wire format both
 * transports emit.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_game_ns')) {
    function sml_game_ns() {
        return 'sml-games/v1';
    }
}

if (!function_exists('sml_game_routes')) {
    function sml_game_routes() {
        $ns = sml_game_ns();
        $open = '__return_true';
        $auth = function () {
            return is_user_logged_in();
        };

        register_rest_route($ns, '/lobby', array(
            'methods'  => 'GET',
            'permission_callback' => $open,
            'callback' => 'sml_game_rest_lobby',
        ));

        register_rest_route($ns, '/tables', array(
            'methods'  => 'POST',
            'permission_callback' => $auth,
            'callback' => 'sml_game_rest_create',
        ));

        register_rest_route($ns, '/tables/(?P<id>\d+)', array(
            'methods'  => 'GET',
            'permission_callback' => $open,
            'callback' => 'sml_game_rest_state',
        ));

        register_rest_route($ns, '/tables/(?P<id>\d+)/join', array(
            'methods'  => 'POST',
            'permission_callback' => $auth,
            'callback' => 'sml_game_rest_join',
        ));

        register_rest_route($ns, '/tables/(?P<id>\d+)/leave', array(
            'methods'  => 'POST',
            'permission_callback' => $auth,
            'callback' => 'sml_game_rest_leave',
        ));

        register_rest_route($ns, '/tables/(?P<id>\d+)/start', array(
            'methods'  => 'POST',
            'permission_callback' => $auth,
            'callback' => 'sml_game_rest_start',
        ));

        register_rest_route($ns, '/tables/(?P<id>\d+)/move', array(
            'methods'  => 'POST',
            'permission_callback' => $auth,
            'callback' => 'sml_game_rest_move',
        ));

        register_rest_route($ns, '/matchmake', array(
            'methods'  => 'POST',
            'permission_callback' => $auth,
            'callback' => 'sml_game_rest_matchmake',
        ));

        register_rest_route($ns, '/scores', array(
            'methods'  => 'GET',
            'permission_callback' => $open,
            'callback' => 'sml_game_rest_scores',
        ));
    }
}
add_action('rest_api_init', 'sml_game_routes');

/* ==================================================================
 * Wire format
 * ================================================================== */

if (!function_exists('sml_game_person')) {
    function sml_game_person($user_id) {
        $user_id = (int) $user_id;
        if ($user_id <= 0) {
            return null;
        }
        $user = get_userdata($user_id);
        if (!$user) {
            return null;
        }
        return array(
            'id'     => $user_id,
            'name'   => $user->display_name ?: $user->user_login,
            'handle' => $user->user_nicename,
            'avatar' => get_avatar_url($user_id, array('size' => 64)),
        );
    }
}

if (!function_exists('sml_game_seats')) {
    /** Seat number => user id. Falls back to the old two-column layout. */
    function sml_game_seats($row) {
        $seats = json_decode((string) ($row['seats'] ?? ''), true);
        if (!is_array($seats) || !$seats) {
            $seats = array(1 => (int) $row['host_id']);
            if ((int) $row['guest_id'] > 0) {
                $seats[2] = (int) $row['guest_id'];
            }
        }
        $out = array();
        foreach ($seats as $n => $uid) {
            if ((int) $uid > 0) {
                $out[(int) $n] = (int) $uid;
            }
        }
        return $out;
    }
}

if (!function_exists('sml_game_seat_of')) {
    function sml_game_seat_of($row, $user_id) {
        $user_id = (int) $user_id;
        if ($user_id <= 0) {
            return 0;
        }
        foreach (sml_game_seats($row) as $n => $uid) {
            if ($uid === $user_id) {
                return $n;
            }
        }
        return 0;
    }
}

if (!function_exists('sml_game_free_seat')) {
    function sml_game_free_seat($row) {
        $taken = sml_game_seats($row);
        $total = max(2, (int) ($row['seat_count'] ?: sml_game_seat_count($row['game'])));
        for ($n = 1; $n <= $total; $n++) {
            if (empty($taken[$n])) {
                return $n;
            }
        }
        return 0;
    }
}

if (!function_exists('sml_game_public_table')) {
    function sml_game_public_table($row, $viewer_id = 0) {
        $catalogue = sml_game_catalogue();
        $game = (string) $row['game'];
        $seat = sml_game_seat_of($row, $viewer_id);

        $taken = sml_game_seats($row);
        $total = max(2, (int) ($row['seat_count'] ?: sml_game_seat_count($game)));
        $players = array();
        for ($n = 1; $n <= $total; $n++) {
            $players[$n] = isset($taken[$n]) ? sml_game_person($taken[$n]) : null;
        }

        return array(
            'id'        => (int) $row['id'],
            'game'      => $game,
            'label'     => isset($catalogue[$game]) ? $catalogue[$game]['label'] : $game,
            'status'    => (string) $row['status'],
            'visibility' => (string) $row['visibility'],
            'players'   => $players,
            'seatCount' => $total,
            'state'     => sml_game_redact_state(
                $game,
                json_decode((string) $row['state'], true),
                json_decode((string) ($row['private_state'] ?? ''), true),
                $seat
            ),
            'turn'      => (int) $row['turn_seat'],
            'winner'    => (int) $row['winner_seat'],
            'moves'     => (int) $row['move_count'],
            'version'   => (int) $row['version'],
            'yourSeat'  => $seat,
            'yourTurn'  => $seat > 0 && $seat === (int) $row['turn_seat'] && $row['status'] === 'playing',
            'spectating' => $seat === 0,
            'joinCode'  => $seat === 1 ? (string) $row['join_code'] : '',
            'wager'     => function_exists('sml_wager_public')
                           ? sml_wager_public($row, $viewer_id) : null,
            'swing'     => json_decode((string) ($row['meta_swing'] ?? ''), true),
            'canStart'  => $seat === 1 && $row['status'] === 'waiting'
                           && sml_game_host_starts($game)
                           && count($taken) >= sml_game_min_seats($game),
            'updated'   => (string) $row['updated_at'],
        );
    }
}

if (!function_exists('sml_game_fetch')) {
    function sml_game_fetch($id) {
        global $wpdb;
        $t = sml_game_table('tables');
        return $wpdb->get_row($wpdb->prepare("SELECT * FROM $t WHERE id = %d", (int) $id), ARRAY_A);
    }
}

/* ==================================================================
 * Lobby
 * ================================================================== */

if (!function_exists('sml_game_rest_lobby')) {
    function sml_game_rest_lobby(WP_REST_Request $request) {
        global $wpdb;
        $t = sml_game_table('tables');
        $viewer = get_current_user_id();

        $context = sanitize_key((string) $request->get_param('context')) ?: 'video';
        $context_id = sanitize_text_field((string) $request->get_param('context_id'));

        // Sweep abandoned tables so the lobby does not silt up. Nobody has
        // touched these in 30 minutes; they are not coming back.
        //
        // Every timestamp this module writes is UTC, so the comparison must be
        // UTC_TIMESTAMP() and not NOW(). On a site whose WordPress timezone is
        // behind UTC, mixing the two sweeps rows the moment they are created.
        // Sweep one row at a time rather than in bulk: each dead table may be
        // holding real Loop Bucks in escrow that have to go home.
        $dead = $wpdb->get_results(
            "SELECT * FROM $t
              WHERE status IN ('waiting','playing')
                AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)
              LIMIT 50",
            ARRAY_A
        );
        foreach ((array) $dead as $dead_row) {
            sml_game_close_and_refund($dead_row, 'abandoned');
        }

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $t
              WHERE context = %s AND context_id = %s
                AND status IN ('waiting','playing')
                AND (visibility = 'open' OR host_id = %d OR guest_id = %d)
              ORDER BY (status = 'waiting') DESC, updated_at DESC
              LIMIT 40",
            $context, $context_id, $viewer, $viewer
        ), ARRAY_A);

        $tables = array();
        foreach ((array) $rows as $row) {
            $tables[] = sml_game_public_table($row, $viewer);
        }

        $catalogue = array();
        foreach (sml_game_catalogue() as $key => $meta) {
            if (!empty($meta['enabled'])) {
                $catalogue[] = array(
                    'key'   => $key,
                    'label' => $meta['label'],
                    'blurb' => $meta['blurb'],
                    'seats' => (int) $meta['seats'],
                );
            }
        }

        $rank = function_exists('sml_lb_rank') ? sml_lb_rank($viewer) : array('rank' => 0, 'balance' => 0);

        return array(
            'tables'    => $tables,
            'catalogue' => $catalogue,
            'scores'    => sml_game_score_for($viewer),
            'you'       => sml_game_person($viewer),
            'gate'      => function_exists('sml_lb_gate_status')
                           ? sml_lb_gate_status($viewer) : null,
            'earn'      => $viewer && function_exists('sml_lb_earn_progress')
                           ? sml_lb_earn_progress($viewer) : null,
            'bank'      => array(
                'balance'  => (int) $rank['balance'],
                'rank'     => (int) $rank['rank'],
                'badge'    => function_exists('sml_lb_badge_data')
                              ? sml_lb_badge_data($rank['rank']) : null,
                'vault'    => function_exists('sml_lb_vault_balance') ? sml_lb_vault_balance() : 0,
                'supply'   => defined('SML_LB_SUPPLY') ? SML_LB_SUPPLY : 0,
                'min'      => function_exists('sml_wager_min') ? sml_wager_min() : 0,
                'steps'    => function_exists('sml_wager_steps') ? sml_wager_steps() : array(),
                'wagering' => function_exists('sml_wager_enabled') && sml_wager_enabled('chess'),
                'cap'      => function_exists('sml_wager_daily_cap') && $viewer
                              ? sml_wager_daily_cap($viewer) : 0,
            ),
        );
    }
}

/* ==================================================================
 * Closing a table without a winner
 * ================================================================== */

if (!function_exists('sml_game_close_and_refund')) {
    /**
     * Mark a table dead and hand every stake back. Guarded by the settled
     * flag so a table swept twice does not refund twice -- though the ledger
     * would catch that anyway, this saves the round trip.
     */
    function sml_game_close_and_refund($row, $status = 'abandoned') {
        global $wpdb;
        $t = sml_game_table('tables');
        $id = (int) $row['id'];

        $claimed = $wpdb->query($wpdb->prepare(
            "UPDATE $t SET status = %s, settled = 1, version = version + 1, updated_at = %s
              WHERE id = %d AND settled = 0",
            $status, current_time('mysql', true), $id
        ));
        if (!$claimed) {
            return false;
        }
        if (function_exists('sml_wager_refund_all')) {
            sml_wager_refund_all($row, 'abandon');
        }
        return true;
    }
}

/* ==================================================================
 * Create / join / leave
 * ================================================================== */

if (!function_exists('sml_game_rest_create')) {
    function sml_game_rest_create(WP_REST_Request $request) {
        global $wpdb;
        $game = sanitize_key((string) $request->get_param('game'));
        if (!sml_game_is_valid($game)) {
            return new WP_Error('bad_game', 'That game is not available yet.', array('status' => 400));
        }

        $visibility = $request->get_param('visibility') === 'private' ? 'private' : 'open';
        $context = sanitize_key((string) $request->get_param('context')) ?: 'video';
        $context_id = sanitize_text_field((string) $request->get_param('context_id'));
        $host = get_current_user_id();

        $t = sml_game_table('tables');

        // One open table per person per context, or the lobby fills with
        // ghosts from people who clicked the button five times. Anything we
        // close here must give its stakes back first.
        $stale = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $t WHERE host_id = %d AND status = 'waiting'
                AND context = %s AND context_id = %s",
            $host, $context, $context_id
        ), ARRAY_A);
        foreach ((array) $stale as $old_row) {
            sml_game_close_and_refund($old_row, 'abandoned');
        }

        $gate = sml_lb_gate_check('games', $host);
        if (is_wp_error($gate)) {
            return $gate;
        }

        $stake = function_exists('sml_wager_normalise')
            ? sml_wager_normalise($game, $request->get_param('stake'))
            : 0;
        if ($stake > 0) {
            // Check before the row exists so a broke player never leaves a
            // half-created table behind.
            $ok = sml_wager_check($host, $game, $stake);
            if (is_wp_error($ok)) {
                return $ok;
            }
        }

        $wpdb->insert($t, array(
            'game'       => $game,
            'context'    => $context,
            'context_id' => $context_id,
            'host_id'    => $host,
            'stake'      => $stake,
            'visibility' => $visibility,
            'join_code'  => $visibility === 'private' ? strtoupper(wp_generate_password(6, false, false)) : '',
            'state'      => wp_json_encode(sml_game_new_state($game)),
            'private_state' => wp_json_encode(sml_game_new_private($game)),
            'seats'      => wp_json_encode(array(1 => $host)),
            'seat_count' => sml_game_seat_count($game),
            'turn_seat'  => 1,
            'status'     => 'waiting',
            'version'    => 1,
            'created_at' => current_time('mysql', true),
            'updated_at' => current_time('mysql', true),
        ));

        $id = (int) $wpdb->insert_id;
        // Per-round games ante when the hand is dealt, not when you sit down.
        if ($stake > 0 && !sml_wager_per_round($game)) {
            $anted = sml_wager_ante($id, 1, $host, $game, $stake);
            if (is_wp_error($anted)) {
                // Could not escrow -- bin the table rather than leave a stake
                // showing that nobody actually put up.
                $wpdb->delete($t, array('id' => $id));
                return $anted;
            }
        }
        $row = sml_game_fetch($id);
        return array('ok' => true, 'table' => sml_game_public_table($row, $host));
    }
}

if (!function_exists('sml_game_rest_join')) {
    function sml_game_rest_join(WP_REST_Request $request) {
        global $wpdb;
        $t = sml_game_table('tables');
        $id = (int) $request->get_param('id');
        $me = get_current_user_id();

        $row = sml_game_fetch($id);
        if (!$row) {
            return new WP_Error('no_table', 'That table is gone.', array('status' => 404));
        }
        if (sml_game_seat_of($row, $me)) {
            return array('ok' => true, 'table' => sml_game_public_table($row, $me));
        }
        $gate = sml_lb_gate_check('games', $me);
        if (is_wp_error($gate)) {
            return $gate;
        }
        if ($row['status'] !== 'waiting') {
            return new WP_Error('in_play', 'That match already started. You can spectate.', array('status' => 409));
        }
        if ($row['visibility'] === 'private') {
            $code = strtoupper(trim((string) $request->get_param('code')));
            if ($code !== strtoupper((string) $row['join_code'])) {
                return new WP_Error('bad_code', 'Wrong table code.', array('status' => 403));
            }
        }

        $free = sml_game_free_seat($row);
        if (!$free) {
            return new WP_Error('table_full', 'That table is full.', array('status' => 409));
        }

        $stake = (int) ($row['stake'] ?? 0);
        if ($stake > 0) {
            $ok = sml_wager_check($me, $row['game'], $stake);
            if (is_wp_error($ok)) {
                return $ok;
            }
        }

        $seats = sml_game_seats($row);
        $seats[$free] = $me;
        ksort($seats);
        $total = max(2, (int) ($row['seat_count'] ?: sml_game_seat_count($row['game'])));
        $full = count($seats) >= $total;
        $status = ($full && !sml_game_host_starts($row['game'])) ? 'playing' : 'waiting';

        // Guarded on the version we read, so two people clicking Join at the
        // same instant cannot both land in the same seat.
        $claimed = $wpdb->query($wpdb->prepare(
            "UPDATE $t SET seats = %s, guest_id = %d, status = %s,
                    version = version + 1, updated_at = %s
              WHERE id = %d AND version = %d AND status = 'waiting'",
            wp_json_encode($seats),
            isset($seats[2]) ? (int) $seats[2] : 0,
            $status,
            current_time('mysql', true),
            $id, (int) $row['version']
        ));
        if (!$claimed) {
            return new WP_Error('seat_taken', 'Someone grabbed that seat first.', array('status' => 409));
        }

        // Seat is ours; now put the money up. If escrow fails we hand the
        // seat straight back rather than let someone play for free.
        if ($stake > 0 && !sml_wager_per_round($row['game'])) {
            $anted = sml_wager_ante($id, $free, $me, $row['game'], $stake);
            if (is_wp_error($anted)) {
                unset($seats[$free]);
                $wpdb->update($t, array(
                    'seats' => wp_json_encode($seats),
                    'guest_id' => isset($seats[2]) ? (int) $seats[2] : 0,
                    'status' => 'waiting',
                    'version' => (int) $row['version'] + 2,
                    'updated_at' => current_time('mysql', true),
                ), array('id' => $id));
                return $anted;
            }
        }

        $fresh = sml_game_fetch($id);
        if ($status === 'playing') {
            sml_game_begin($fresh);
            $fresh = sml_game_fetch($id);
        }
        return array('ok' => true, 'table' => sml_game_public_table($fresh, $me));
    }
}

if (!function_exists('sml_game_rest_leave')) {
    function sml_game_rest_leave(WP_REST_Request $request) {
        global $wpdb;
        $t = sml_game_table('tables');
        $id = (int) $request->get_param('id');
        $me = get_current_user_id();

        $row = sml_game_fetch($id);
        if (!$row) {
            return array('ok' => true);
        }
        $seat = sml_game_seat_of($row, $me);
        if (!$seat) {
            return array('ok' => true);
        }

        if ($row['status'] === 'playing') {
            $seats = sml_game_seats($row);
            $total = max(2, (int) ($row['seat_count'] ?: sml_game_seat_count($row['game'])));

            // Two-handed games have an obvious beneficiary. At a four-handed
            // table one walkout ends the hand for everyone with no winner,
            // because awarding it to a partnership would reward collusion.
            if ($total === 2) {
                $winner = $seat === 1 ? 2 : 1;
                $winner_id = isset($seats[$winner]) ? (int) $seats[$winner] : 0;
                sml_game_record_result($row['game'], $winner_id, $me, false);
            } else {
                $winner = 0;
            }
            $claimed = $wpdb->query($wpdb->prepare(
                "UPDATE $t SET status = 'finished', winner_seat = %d, settled = 1,
                        version = version + 1, updated_at = %s
                  WHERE id = %d AND settled = 0",
                $winner, current_time('mysql', true), $id
            ));
            // Walking away from a staked table forfeits the pot. Blackjack has
            // no opponent to hand it to, so those stakes simply go back.
            if ($claimed && function_exists('sml_wager_settle')) {
                if ($row['game'] === 'blackjack') {
                    sml_wager_refund_all($row, 'walk');
                } else {
                    sml_wager_settle($row, $winner);
                }
            }
        } else {
            sml_game_close_and_refund($row, 'abandoned');
        }
        return array('ok' => true, 'table' => sml_game_public_table(sml_game_fetch($id), $me));
    }
}

/* ==================================================================
 * Dealing
 * ================================================================== */

if (!function_exists('sml_game_begin')) {
    /**
     * Called the moment a table flips to 'playing'. Card games deal here so
     * that the shuffle happens exactly once, server-side, after the seat list
     * is final.
     */
    function sml_game_begin($row) {
        global $wpdb;
        $game = (string) $row['game'];
        if (!function_exists('sml_game_deal')) {
            return;
        }
        $seats = array_keys(sml_game_seats($row));
        $dealt = sml_game_deal($game, $seats);
        if (!$dealt) {
            return;
        }
        $wpdb->update(sml_game_table('tables'), array(
            'state'         => wp_json_encode($dealt['state']),
            'private_state' => wp_json_encode($dealt['private']),
            'turn_seat'     => (int) $dealt['turn'],
            'version'       => (int) $row['version'] + 1,
            'updated_at'    => current_time('mysql', true),
        ), array('id' => (int) $row['id']));

        // Blackjack settles round by round against the vault, so each round
        // needs its own ante. The other games ante once, when you sit down.
        if ($game === 'blackjack' && (int) ($row['stake'] ?? 0) > 0) {
            sml_game_bj_ante($row, 1);
        }
    }
}

if (!function_exists('sml_game_bj_ante')) {
    /** One stake per seat per blackjack round, keyed so replays are free. */
    function sml_game_bj_ante($row, $round) {
        $stake = (int) ($row['stake'] ?? 0);
        if ($stake <= 0) {
            return;
        }
        foreach (sml_game_seats($row) as $seat => $uid) {
            $taken = sml_lb_take($uid, $stake,
                sml_wager_ref($row['id'], 'bjante' . (int) $round, $seat),
                array('table' => (int) $row['id'], 'round' => (int) $round));
            if (!is_wp_error($taken) && empty($taken['replayed'])) {
                sml_wager_hold($row['id'], $stake);
            }
        }
    }
}

if (!function_exists('sml_game_rest_start')) {
    function sml_game_rest_start(WP_REST_Request $request) {
        global $wpdb;
        $t = sml_game_table('tables');
        $id = (int) $request->get_param('id');
        $me = get_current_user_id();

        $row = sml_game_fetch($id);
        if (!$row) {
            return new WP_Error('no_table', 'That table is gone.', array('status' => 404));
        }
        if (sml_game_seat_of($row, $me) !== 1) {
            return new WP_Error('not_host', 'Only the host can start the round.', array('status' => 403));
        }
        if ($row['status'] !== 'waiting') {
            return new WP_Error('already', 'That round is already running.', array('status' => 409));
        }
        if (count(sml_game_seats($row)) < sml_game_min_seats($row['game'])) {
            return new WP_Error('too_few', 'Not enough players yet.', array('status' => 409));
        }

        $wpdb->query($wpdb->prepare(
            "UPDATE $t SET status = 'playing', version = version + 1, updated_at = %s
              WHERE id = %d AND status = 'waiting'",
            current_time('mysql', true), $id
        ));
        sml_game_begin(sml_game_fetch($id));
        return array('ok' => true, 'table' => sml_game_public_table(sml_game_fetch($id), $me));
    }
}

/* ==================================================================
 * State (polling cursor)
 * ================================================================== */

if (!function_exists('sml_game_rest_state')) {
    function sml_game_rest_state(WP_REST_Request $request) {
        $row = sml_game_fetch((int) $request->get_param('id'));
        if (!$row) {
            return new WP_Error('no_table', 'That table is gone.', array('status' => 404));
        }
        $since = (int) $request->get_param('since');
        $me = get_current_user_id();

        // Cheap cursor. The client sends the version it last painted; if
        // nothing moved we answer with 40 bytes instead of a whole board.
        if ($since > 0 && (int) $row['version'] === $since) {
            return array('unchanged' => true, 'version' => (int) $row['version']);
        }
        return array('table' => sml_game_public_table($row, $me));
    }
}

/* ==================================================================
 * Move
 * ================================================================== */

if (!function_exists('sml_game_log_move')) {
    function sml_game_log_move($table_id, $seat, $user_id, $move, $accepted, $reason = '') {
        global $wpdb;
        $wpdb->insert(sml_game_table('moves'), array(
            'table_id'  => (int) $table_id,
            'seat'      => (int) $seat,
            'user_id'   => (int) $user_id,
            'move_json' => substr((string) wp_json_encode($move), 0, 255),
            'accepted'  => $accepted ? 1 : 0,
            'reason'    => substr((string) $reason, 0, 60),
            'created_at' => current_time('mysql', true),
        ));
    }
}

if (!function_exists('sml_game_rest_move')) {
    function sml_game_rest_move(WP_REST_Request $request) {
        global $wpdb;
        $t = sml_game_table('tables');
        $id = (int) $request->get_param('id');
        $me = get_current_user_id();

        $row = sml_game_fetch($id);
        if (!$row) {
            return new WP_Error('no_table', 'That table is gone.', array('status' => 404));
        }

        $seat = sml_game_seat_of($row, $me);
        $move = (array) $request->get_param('move');

        if (!$seat) {
            sml_game_log_move($id, 0, $me, $move, false, 'not seated');
            return new WP_Error('spectator', 'You are spectating this table.', array('status' => 403));
        }
        if ($row['status'] !== 'playing') {
            sml_game_log_move($id, $seat, $me, $move, false, 'not playing');
            return new WP_Error('not_playing', 'This match is not in play.', array('status' => 409));
        }
        if ((int) $row['turn_seat'] !== $seat) {
            sml_game_log_move($id, $seat, $me, $move, false, 'out of turn');
            return new WP_Error('not_your_turn', 'Not your turn.', array('status' => 409));
        }

        $expect = (int) $request->get_param('version');
        if ($expect > 0 && $expect !== (int) $row['version']) {
            return new WP_Error('stale', 'The board moved on. Reloading.', array(
                'status' => 409,
                'table'  => sml_game_public_table($row, $me),
            ));
        }

        // Doubling or splitting would put more at risk than was escrowed, and
        // an unescrowed stake is one a loser can spend before settlement. On a
        // staked table it is hit or stand.
        if ($row['game'] === 'blackjack' && (int) ($row['stake'] ?? 0) > 0
            && in_array(strtolower((string) ($move['action'] ?? '')),
                        array('double', 'split'), true)) {
            return new WP_Error('bj_no_double',
                'Doubling and splitting are off on staked tables.', array('status' => 400));
        }

        $state = json_decode((string) $row['state'], true);
        if (!is_array($state)) {
            return new WP_Error('corrupt', 'That table is damaged.', array('status' => 500));
        }
        $private = json_decode((string) ($row['private_state'] ?? ''), true);
        if (!is_array($private)) {
            $private = array();
        }

        $result = sml_game_apply_move($row['game'], $state, $seat, $move, $private);
        if (isset($result['error'])) {
            sml_game_log_move($id, $seat, $me, $move, false, $result['error']);
            return new WP_Error('illegal', $result['error'], array('status' => 400));
        }

        $done = !empty($result['done']);
        $winner = isset($result['winner']) ? (int) $result['winner'] : 0;

        $update = array(
            'state'      => wp_json_encode($result['state']),
            'private'    => wp_json_encode(isset($result['private']) ? $result['private'] : $private),
            'turn_seat'  => $done ? (int) $row['turn_seat'] : (int) $result['next'],
            'move_count' => (int) $row['move_count'] + 1,
            'version'    => (int) $row['version'] + 1,
            'updated_at' => current_time('mysql', true),
        );
        if ($done) {
            $update['status'] = 'finished';
            $update['winner_seat'] = $winner;
        }

        // Guard the write on the version we read. If it changed underneath us
        // the move is rejected rather than applied to a board that moved.
        $wrote = $wpdb->query($wpdb->prepare(
            "UPDATE $t SET state = %s, private_state = %s, turn_seat = %d, move_count = %d,
                    version = %d, updated_at = %s, status = %s, winner_seat = %d
              WHERE id = %d AND version = %d",
            $update['state'], $update['private'], $update['turn_seat'], $update['move_count'],
            $update['version'], $update['updated_at'],
            $done ? 'finished' : 'playing',
            $done ? $winner : (int) $row['winner_seat'],
            $id, (int) $row['version']
        ));
        if (!$wrote) {
            return new WP_Error('stale', 'The board moved on. Reloading.', array(
                'status' => 409,
                'table'  => sml_game_public_table(sml_game_fetch($id), $me),
            ));
        }

        sml_game_log_move($id, $seat, $me, $move, true);

        // Blackjack pays out the instant a round settles, then re-antes if the
        // table deals again. Refs carry the round number so nothing replays.
        if ($row['game'] === 'blackjack' && (int) ($row['stake'] ?? 0) > 0) {
            $after = $result['state'];
            $before_round = (int) ($state['round'] ?? 1);
            $after_round = (int) ($after['round'] ?? 1);

            if (($after['phase'] ?? '') === 'settled') {
                $nets = array();
                foreach ((array) ($after['players'] ?? array()) as $s => $pl) {
                    $chips = 0;
                    foreach ((array) ($pl['hands'] ?? array()) as $h) {
                        $chips += (int) ($h['payout'] ?? 0);
                    }
                    // Engine chips are denominated in tens; scale to the stake.
                    $nets[(int) $s] = (int) round($chips * ((int) $row['stake']) / 10);
                }
                $fresh_row = sml_game_fetch($id);
                $swing = sml_wager_blackjack($fresh_row, $nets);
                $wpdb->update($t, array('meta_swing' => wp_json_encode($swing)),
                    array('id' => $id));
            } elseif ($after_round > $before_round) {
                sml_game_bj_ante(sml_game_fetch($id), $after_round);
            }
        }

        if ($done) {
            $seats = sml_game_seats($row);

            // Money first, vanity second. Guarded by the settled flag so two
            // racing final moves cannot both pay the pot out.
            if (function_exists('sml_wager_settle') && (int) ($row['stake'] ?? 0) > 0) {
                $claim = $wpdb->query($wpdb->prepare(
                    "UPDATE $t SET settled = 1 WHERE id = %d AND settled = 0", $id
                ));
                if ($claim) {
                    $swing = sml_wager_settle($row, $winner);
                    $wpdb->update($t, array('meta_swing' => wp_json_encode($swing)),
                        array('id' => $id));
                }
            }

            foreach ($seats as $uid) {
                if (function_exists('sml_lb_award')) {
                    sml_lb_award('game_played', $uid, 'tbl' . $id);
                }
            }

            if ($winner === 0) {
                foreach ($seats as $uid) {
                    sml_game_bump($row['game'], $uid, 'draws', 1);
                }
            } else {
                foreach ($seats as $n => $uid) {
                    // Spades pays the partnership: seats 1 and 3 play 2 and 4.
                    $won = count($seats) === 4
                        ? (($n % 2) === ($winner % 2))
                        : ($n === $winner);
                    sml_game_bump($row['game'], $uid, $won ? 'wins' : 'losses', $won ? 3 : 0);
                }
            }
        }

        $out = array('ok' => true, 'table' => sml_game_public_table(sml_game_fetch($id), $me));
        if (!empty($result['line'])) {
            $out['line'] = array_map('intval', (array) $result['line']);
        }
        if (!empty($result['chain'])) {
            $out['chain'] = true;
        }
        return $out;
    }
}

/* ==================================================================
 * Matchmaking
 * ================================================================== */

if (!function_exists('sml_game_rest_matchmake')) {
    function sml_game_rest_matchmake(WP_REST_Request $request) {
        global $wpdb;
        $t = sml_game_table('tables');
        $game = sanitize_key((string) $request->get_param('game'));
        if (!sml_game_is_valid($game)) {
            return new WP_Error('bad_game', 'That game is not available yet.', array('status' => 400));
        }
        $me = get_current_user_id();
        $gate = sml_lb_gate_check('games', $me);
        if (is_wp_error($gate)) {
            return $gate;
        }
        $context = sanitize_key((string) $request->get_param('context')) ?: 'video';
        $context_id = sanitize_text_field((string) $request->get_param('context_id'));

        // Prefer someone already waiting in this room before opening a table
        // of our own -- otherwise everyone sits in their own empty lobby.
        $waiting = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $t
              WHERE game = %s AND status = 'waiting' AND visibility = 'open'
                AND context = %s AND context_id = %s AND host_id <> %d
              ORDER BY created_at ASC LIMIT 1",
            $game, $context, $context_id, $me
        ), ARRAY_A);

        if ($waiting) {
            $claimed = $wpdb->query($wpdb->prepare(
                "UPDATE $t SET guest_id = %d, status = 'playing', version = version + 1, updated_at = %s
                  WHERE id = %d AND guest_id = 0 AND status = 'waiting'",
                $me, current_time('mysql', true), (int) $waiting['id']
            ));
            if ($claimed) {
                return array('ok' => true, 'matched' => true,
                    'table' => sml_game_public_table(sml_game_fetch($waiting['id']), $me));
            }
        }

        return sml_game_rest_create($request);
    }
}

/* ==================================================================
 * Scores
 * ================================================================== */

if (!function_exists('sml_game_rest_scores')) {
    function sml_game_rest_scores(WP_REST_Request $request) {
        global $wpdb;
        $game = sanitize_key((string) $request->get_param('game'));
        $t = sml_game_table('scores');

        $where = sml_game_is_valid($game) ? $wpdb->prepare('WHERE game = %s', $game) : '';
        $rows = $wpdb->get_results(
            "SELECT user_id, game, wins, losses, draws, points, streak, best_streak
               FROM $t $where ORDER BY points DESC, wins DESC LIMIT 20",
            ARRAY_A
        );

        $board = array();
        foreach ((array) $rows as $row) {
            $person = sml_game_person($row['user_id']);
            if (!$person) {
                continue;
            }
            $board[] = array(
                'player' => $person,
                'game'   => (string) $row['game'],
                'wins'   => (int) $row['wins'],
                'losses' => (int) $row['losses'],
                'draws'  => (int) $row['draws'],
                'points' => (int) $row['points'],
                'streak' => (int) $row['streak'],
                'best'   => (int) $row['best_streak'],
            );
        }

        return array('leaderboard' => $board, 'you' => sml_game_score_for(get_current_user_id()));
    }
}
