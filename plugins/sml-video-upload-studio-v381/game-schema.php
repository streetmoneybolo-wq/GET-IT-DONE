<?php
/**
 * Turn-based mini-games: storage + server-authoritative rules.
 *
 * Design note: the client renders boards but never decides legality. Every
 * move goes through sml_game_apply_move(), which re-derives the whole position
 * from the stored state before accepting anything. A tampered client can send
 * whatever it likes; the worst it gets back is a 400.
 *
 * Concurrency: each table carries a version counter. A move must cite the
 * version it was composed against. Two players clicking at the same instant
 * means the loser is told to re-read state instead of silently overwriting.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SML_GAME_DB_VERSION', '1.3.0');

if (!function_exists('sml_game_table')) {
    function sml_game_table($name) {
        global $wpdb;
        return $wpdb->prefix . 'sml_game_' . $name;
    }
}

/* ==================================================================
 * Catalogue
 * ================================================================== */

if (!function_exists('sml_game_catalogue')) {
    function sml_game_catalogue() {
        return array(
            'tictactoe' => array(
                'label'   => 'Tic-Tac-Toe',
                'seats'   => 2,
                'blurb'   => 'Three in a row. Thirty seconds a match.',
                'enabled' => true,
            ),
            'connect4' => array(
                'label'   => 'Connect Four',
                'seats'   => 2,
                'blurb'   => 'Drop discs, four in a line wins.',
                'enabled' => true,
            ),
            'checkers' => array(
                'label'   => 'Checkers',
                'seats'   => 2,
                'blurb'   => 'Forced captures, kings, the works.',
                'enabled' => true,
            ),
            'chess' => array(
                'label'   => 'Chess',
                'seats'   => 2,
                'blurb'   => 'Full rules. Castling, en passant, the lot.',
                'enabled' => true,
            ),
            'spades' => array(
                'label'   => 'Spades',
                'seats'   => 4,
                'blurb'   => 'Partners across the table. Bid, then take your tricks.',
                'enabled' => true,
                'hidden'  => true,
            ),
            'blackjack' => array(
                'label'   => 'Blackjack',
                'seats'   => 4,
                'blurb'   => 'You against the house. Free play, no stakes.',
                'enabled' => true,
                'hidden'  => true,
                'hostStarts' => true,
                'minSeats'   => 1,
                // Free play only. Blackjack is banked by the house rather than
                // by an opponent, so staking it would make the platform the
                // counterparty on a game of pure chance. Everything else is
                // player against player.
                'noWager' => true,
            ),
        );
    }
}

if (!function_exists('sml_game_seat_count')) {
    function sml_game_seat_count($game) {
        $all = sml_game_catalogue();
        return isset($all[$game]) ? max(2, (int) $all[$game]['seats']) : 2;
    }
}

if (!function_exists('sml_game_min_seats')) {
    /** Seats that must be filled before play can begin. */
    function sml_game_min_seats($game) {
        $all = sml_game_catalogue();
        if (isset($all[$game]['minSeats'])) {
            return max(1, (int) $all[$game]['minSeats']);
        }
        return sml_game_seat_count($game);
    }
}

if (!function_exists('sml_game_host_starts')) {
    /** True when the host may deal before every seat is taken. */
    function sml_game_host_starts($game) {
        $all = sml_game_catalogue();
        return !empty($all[$game]['hostStarts']);
    }
}

if (!function_exists('sml_game_has_hidden')) {
    function sml_game_has_hidden($game) {
        $all = sml_game_catalogue();
        return !empty($all[$game]['hidden']);
    }
}

if (!function_exists('sml_game_is_valid')) {
    function sml_game_is_valid($game) {
        $all = sml_game_catalogue();
        return isset($all[$game]) && !empty($all[$game]['enabled']);
    }
}

/* ==================================================================
 * Schema
 * ================================================================== */

if (!function_exists('sml_game_install')) {
    function sml_game_install() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();

        $tables = sml_game_table('tables');
        $moves  = sml_game_table('moves');
        $scores = sml_game_table('scores');

        // "state" holds the board as JSON. Small, always read whole, never
        // queried by content -- a normalised board table would be all cost.
        dbDelta("CREATE TABLE $tables (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            game VARCHAR(24) NOT NULL,
            context VARCHAR(16) NOT NULL DEFAULT 'video',
            context_id VARCHAR(64) NOT NULL DEFAULT '',
            host_id BIGINT UNSIGNED NOT NULL,
            guest_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            visibility VARCHAR(16) NOT NULL DEFAULT 'open',
            join_code VARCHAR(12) NOT NULL DEFAULT '',
            state MEDIUMTEXT NOT NULL,
            turn_seat TINYINT UNSIGNED NOT NULL DEFAULT 1,
            status VARCHAR(16) NOT NULL DEFAULT 'waiting',
            winner_seat TINYINT NOT NULL DEFAULT 0,
            move_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            version INT UNSIGNED NOT NULL DEFAULT 1,
            spectators SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            seats MEDIUMTEXT NULL,
            seat_count TINYINT UNSIGNED NOT NULL DEFAULT 2,
            private_state MEDIUMTEXT NULL,
            stake INT UNSIGNED NOT NULL DEFAULT 0,
            settled TINYINT(1) NOT NULL DEFAULT 0,
            escrowed INT UNSIGNED NOT NULL DEFAULT 0,
            meta_swing VARCHAR(255) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY lobby (context, context_id, status),
            KEY seated (host_id, guest_id),
            KEY code (join_code),
            KEY fresh (status, updated_at)
        ) $charset;");

        // Audit log. Moderation asked for it and cheat forensics needs it.
        dbDelta("CREATE TABLE $moves (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            table_id BIGINT UNSIGNED NOT NULL,
            seat TINYINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            move_json VARCHAR(255) NOT NULL,
            accepted TINYINT(1) NOT NULL DEFAULT 1,
            reason VARCHAR(60) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY per_table (table_id, id),
            KEY suspicious (accepted, created_at)
        ) $charset;");

        dbDelta("CREATE TABLE $scores (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            game VARCHAR(24) NOT NULL,
            wins INT UNSIGNED NOT NULL DEFAULT 0,
            losses INT UNSIGNED NOT NULL DEFAULT 0,
            draws INT UNSIGNED NOT NULL DEFAULT 0,
            points INT UNSIGNED NOT NULL DEFAULT 0,
            streak SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            best_streak SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            last_played DATETIME NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY per_game (user_id, game),
            KEY leaderboard (game, points)
        ) $charset;");

        update_option('sml_game_db_version', SML_GAME_DB_VERSION);
    }
}

if (!function_exists('sml_game_maybe_install')) {
    function sml_game_maybe_install() {
        if (get_option('sml_game_db_version') !== SML_GAME_DB_VERSION) {
            sml_game_install();
        }
    }
}
add_action('init', 'sml_game_maybe_install', 5);

/* ==================================================================
 * Openings
 * ================================================================== */

if (!function_exists('sml_game_new_state')) {
    function sml_game_new_state($game) {
        if ($game === 'tictactoe') {
            return array('board' => array_fill(0, 9, 0));
        }
        if ($game === 'connect4') {
            // 6 rows x 7 columns, row 0 is the top.
            return array('board' => array_fill(0, 42, 0), 'rows' => 6, 'cols' => 7);
        }
        if ($game === 'checkers') {
            // 8x8, dark squares only. Seat 1 sits at the bottom and moves up.
            $board = array_fill(0, 64, 0);
            for ($i = 0; $i < 64; $i++) {
                $row = intdiv($i, 8);
                $col = $i % 8;
                if ((($row + $col) % 2) !== 1) {
                    continue;
                }
                if ($row < 3) {
                    $board[$i] = 2;   // seat 2, moving down
                } elseif ($row > 4) {
                    $board[$i] = 1;   // seat 1, moving up
                }
            }
            return array('board' => $board, 'kings' => array(), 'chain' => -1);
        }
        if ($game === 'chess' && function_exists('sml_chess_new_state')) {
            return sml_chess_new_state();
        }
        if ($game === 'spades' && function_exists('sml_spades_new_state')) {
            return sml_spades_new_state();
        }
        if ($game === 'blackjack' && function_exists('sml_bj_new_state')) {
            return sml_bj_new_state();
        }
        return array('board' => array());
    }
}

if (!function_exists('sml_game_new_private')) {
    /**
     * The half of the position no client may see in full: card hands, the
     * shoe, the dealer's hole card. Stored in its own column so that a
     * careless edit to the public path can never accidentally serialise it.
     */
    function sml_game_new_private($game) {
        if ($game === 'spades' && function_exists('sml_spades_new_private')) {
            return sml_spades_new_private();
        }
        if ($game === 'blackjack' && function_exists('sml_bj_new_private')) {
            return sml_bj_new_private();
        }
        return array();
    }
}

if (!function_exists('sml_game_redact_state')) {
    /**
     * Build the view of the position for one seat. Seat 0 is a spectator.
     *
     * This is the only function permitted to merge private state into
     * anything client-bound, and it never returns another seat's cards.
     */
    function sml_game_redact_state($game, $state, $private, $seat) {
        if ($game === 'spades' && function_exists('sml_spades_redact')) {
            return sml_spades_redact($state, $private, $seat);
        }
        if ($game === 'blackjack' && function_exists('sml_bj_redact')) {
            return sml_bj_redact($state, $private, $seat);
        }
        return $state;
    }
}

/* ==================================================================
 * Rules: tic-tac-toe
 * ================================================================== */

if (!function_exists('sml_game_ttt_lines')) {
    function sml_game_ttt_lines() {
        return array(
            array(0, 1, 2), array(3, 4, 5), array(6, 7, 8),
            array(0, 3, 6), array(1, 4, 7), array(2, 5, 8),
            array(0, 4, 8), array(2, 4, 6),
        );
    }
}

if (!function_exists('sml_game_ttt_move')) {
    function sml_game_ttt_move($state, $seat, $move) {
        $cell = isset($move['cell']) ? (int) $move['cell'] : -1;
        if ($cell < 0 || $cell > 8) {
            return array('error' => 'Off the board.');
        }
        if (!empty($state['board'][$cell])) {
            return array('error' => 'That square is taken.');
        }
        $state['board'][$cell] = $seat;

        foreach (sml_game_ttt_lines() as $line) {
            $a = $state['board'][$line[0]];
            if ($a && $a === $state['board'][$line[1]] && $a === $state['board'][$line[2]]) {
                return array('state' => $state, 'winner' => $a, 'done' => true, 'line' => $line);
            }
        }
        if (!in_array(0, $state['board'], true)) {
            return array('state' => $state, 'winner' => 0, 'done' => true);
        }
        return array('state' => $state, 'next' => $seat === 1 ? 2 : 1);
    }
}

/* ==================================================================
 * Rules: connect four
 * ================================================================== */

if (!function_exists('sml_game_c4_move')) {
    function sml_game_c4_move($state, $seat, $move) {
        $cols = 7;
        $rows = 6;
        $col = isset($move['col']) ? (int) $move['col'] : -1;
        if ($col < 0 || $col >= $cols) {
            return array('error' => 'No such column.');
        }

        $landed = -1;
        for ($row = $rows - 1; $row >= 0; $row--) {
            $idx = ($row * $cols) + $col;
            if (empty($state['board'][$idx])) {
                $state['board'][$idx] = $seat;
                $landed = $idx;
                break;
            }
        }
        if ($landed < 0) {
            return array('error' => 'That column is full.');
        }

        $line = sml_game_c4_win_line($state['board'], $landed, $seat, $rows, $cols);
        if ($line) {
            return array('state' => $state, 'winner' => $seat, 'done' => true, 'line' => $line);
        }
        if (!in_array(0, $state['board'], true)) {
            return array('state' => $state, 'winner' => 0, 'done' => true);
        }
        return array('state' => $state, 'next' => $seat === 1 ? 2 : 1);
    }
}

if (!function_exists('sml_game_c4_win_line')) {
    function sml_game_c4_win_line($board, $from, $seat, $rows, $cols) {
        $dirs = array(array(0, 1), array(1, 0), array(1, 1), array(1, -1));
        $r0 = intdiv($from, $cols);
        $c0 = $from % $cols;

        foreach ($dirs as $d) {
            $cells = array($from);
            foreach (array(1, -1) as $sign) {
                $step = 1;
                while (true) {
                    $r = $r0 + ($d[0] * $step * $sign);
                    $c = $c0 + ($d[1] * $step * $sign);
                    if ($r < 0 || $r >= $rows || $c < 0 || $c >= $cols) {
                        break;
                    }
                    $idx = ($r * $cols) + $c;
                    if ((int) $board[$idx] !== $seat) {
                        break;
                    }
                    $cells[] = $idx;
                    $step++;
                }
            }
            if (count($cells) >= 4) {
                sort($cells);
                return $cells;
            }
        }
        return null;
    }
}

/* ==================================================================
 * Rules: checkers
 * ================================================================== */

if (!function_exists('sml_game_ck_is_king')) {
    function sml_game_ck_is_king($state, $idx) {
        return in_array((int) $idx, array_map('intval', (array) ($state['kings'] ?? array())), true);
    }
}

if (!function_exists('sml_game_ck_dirs')) {
    function sml_game_ck_dirs($seat, $king) {
        if ($king) {
            return array(array(-1, -1), array(-1, 1), array(1, -1), array(1, 1));
        }
        // Seat 1 sits at the bottom (high row numbers) and advances upward.
        return $seat === 1
            ? array(array(-1, -1), array(-1, 1))
            : array(array(1, -1), array(1, 1));
    }
}

if (!function_exists('sml_game_ck_jumps_from')) {
    function sml_game_ck_jumps_from($state, $idx, $seat) {
        $board = $state['board'];
        $row = intdiv($idx, 8);
        $col = $idx % 8;
        $foe = $seat === 1 ? 2 : 1;
        $out = array();

        foreach (sml_game_ck_dirs($seat, sml_game_ck_is_king($state, $idx)) as $d) {
            $mr = $row + $d[0];
            $mc = $col + $d[1];
            $lr = $row + ($d[0] * 2);
            $lc = $col + ($d[1] * 2);
            if ($lr < 0 || $lr > 7 || $lc < 0 || $lc > 7) {
                continue;
            }
            $mid = ($mr * 8) + $mc;
            $land = ($lr * 8) + $lc;
            if ((int) $board[$mid] === $foe && (int) $board[$land] === 0) {
                $out[] = array('to' => $land, 'captured' => $mid);
            }
        }
        return $out;
    }
}

if (!function_exists('sml_game_ck_any_jump')) {
    function sml_game_ck_any_jump($state, $seat) {
        foreach ((array) $state['board'] as $idx => $piece) {
            if ((int) $piece === $seat && sml_game_ck_jumps_from($state, $idx, $seat)) {
                return true;
            }
        }
        return false;
    }
}

if (!function_exists('sml_game_ck_has_move')) {
    function sml_game_ck_has_move($state, $seat) {
        if (sml_game_ck_any_jump($state, $seat)) {
            return true;
        }
        foreach ((array) $state['board'] as $idx => $piece) {
            if ((int) $piece !== $seat) {
                continue;
            }
            $row = intdiv($idx, 8);
            $col = $idx % 8;
            foreach (sml_game_ck_dirs($seat, sml_game_ck_is_king($state, $idx)) as $d) {
                $r = $row + $d[0];
                $c = $col + $d[1];
                if ($r < 0 || $r > 7 || $c < 0 || $c > 7) {
                    continue;
                }
                if ((int) $state['board'][($r * 8) + $c] === 0) {
                    return true;
                }
            }
        }
        return false;
    }
}

if (!function_exists('sml_game_ck_move')) {
    function sml_game_ck_move($state, $seat, $move) {
        $from = isset($move['from']) ? (int) $move['from'] : -1;
        $to   = isset($move['to']) ? (int) $move['to'] : -1;
        if ($from < 0 || $from > 63 || $to < 0 || $to > 63) {
            return array('error' => 'Off the board.');
        }
        if ((int) $state['board'][$from] !== $seat) {
            return array('error' => 'Not your piece.');
        }
        if ((int) $state['board'][$to] !== 0) {
            return array('error' => 'That square is occupied.');
        }

        $chain = isset($state['chain']) ? (int) $state['chain'] : -1;
        if ($chain >= 0 && $chain !== $from) {
            return array('error' => 'Finish the capture chain with the same piece.');
        }

        $jumps = sml_game_ck_jumps_from($state, $from, $seat);
        $jump = null;
        foreach ($jumps as $candidate) {
            if ((int) $candidate['to'] === $to) {
                $jump = $candidate;
                break;
            }
        }

        // Forced capture. If a jump exists anywhere, a quiet move is illegal.
        if (!$jump && (sml_game_ck_any_jump($state, $seat) || $chain >= 0)) {
            return array('error' => 'A capture is available -- you must take it.');
        }

        if (!$jump) {
            $row = intdiv($from, 8);
            $col = $from % 8;
            $ok = false;
            foreach (sml_game_ck_dirs($seat, sml_game_ck_is_king($state, $from)) as $d) {
                if ((($row + $d[0]) * 8) + ($col + $d[1]) === $to
                    && ($col + $d[1]) >= 0 && ($col + $d[1]) <= 7) {
                    $ok = true;
                    break;
                }
            }
            if (!$ok) {
                return array('error' => 'Pieces move one diagonal square forward.');
            }
        }

        $king = sml_game_ck_is_king($state, $from);
        $state['board'][$from] = 0;
        $state['board'][$to] = $seat;
        if ($jump) {
            $state['board'][$jump['captured']] = 0;
        }

        $kings = array_values(array_diff(
            array_map('intval', (array) ($state['kings'] ?? array())),
            array($from, $jump ? (int) $jump['captured'] : -1)
        ));
        if ($king) {
            $kings[] = $to;
        }

        // Crowning ends the turn even mid-chain -- standard rule.
        $crowned = false;
        $toRow = intdiv($to, 8);
        if (!$king && (($seat === 1 && $toRow === 0) || ($seat === 2 && $toRow === 7))) {
            $kings[] = $to;
            $crowned = true;
        }
        $state['kings'] = array_values(array_unique($kings));

        if ($jump && !$crowned && sml_game_ck_jumps_from($state, $to, $seat)) {
            $state['chain'] = $to;
            return array('state' => $state, 'next' => $seat, 'chain' => true);
        }
        $state['chain'] = -1;

        $foe = $seat === 1 ? 2 : 1;
        $foeLeft = 0;
        foreach ((array) $state['board'] as $piece) {
            if ((int) $piece === $foe) {
                $foeLeft++;
            }
        }
        if ($foeLeft === 0 || !sml_game_ck_has_move($state, $foe)) {
            return array('state' => $state, 'winner' => $seat, 'done' => true);
        }
        return array('state' => $state, 'next' => $foe);
    }
}

/* ==================================================================
 * Dispatch
 * ================================================================== */

if (!function_exists('sml_game_apply_move')) {
    /**
     * The only place a board is ever mutated. Returns either
     * array('error' => string) or the new state plus outcome flags.
     */
    function sml_game_apply_move($game, $state, $seat, $move, $private = null) {
        if ($seat < 1 || $seat > sml_game_seat_count($game)) {
            return array('error' => 'You are spectating this table.');
        }
        if ($game === 'chess' && function_exists('sml_chess_move')) {
            return sml_chess_move($state, $seat, $move);
        }
        if ($game === 'spades' && function_exists('sml_spades_move')) {
            return sml_spades_move($state, $private, $seat, $move);
        }
        if ($game === 'blackjack' && function_exists('sml_bj_move')) {
            return sml_bj_move($state, $private, $seat, $move);
        }
        if ($game === 'tictactoe') {
            return sml_game_ttt_move($state, $seat, $move);
        }
        if ($game === 'connect4') {
            return sml_game_c4_move($state, $seat, $move);
        }
        if ($game === 'checkers') {
            return sml_game_ck_move($state, $seat, $move);
        }
        return array('error' => 'Unknown game.');
    }
}

/* ==================================================================
 * Scoring
 * ================================================================== */

if (!function_exists('sml_game_record_result')) {
    function sml_game_record_result($game, $winner_id, $loser_id, $draw) {
        if ($draw) {
            sml_game_bump($game, $winner_id, 'draws', 1);
            sml_game_bump($game, $loser_id, 'draws', 1);
            return;
        }
        sml_game_bump($game, $winner_id, 'wins', 3);
        sml_game_bump($game, $loser_id, 'losses', 0);
    }
}

if (!function_exists('sml_game_bump')) {
    function sml_game_bump($game, $user_id, $field, $points) {
        global $wpdb;
        $user_id = (int) $user_id;
        if ($user_id <= 0 || !in_array($field, array('wins', 'losses', 'draws'), true)) {
            return;
        }
        $t = sml_game_table('scores');
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $t WHERE user_id = %d AND game = %s",
            $user_id, $game
        ), ARRAY_A);

        if (!$row) {
            $wpdb->insert($t, array(
                'user_id' => $user_id,
                'game'    => $game,
                'wins'    => $field === 'wins' ? 1 : 0,
                'losses'  => $field === 'losses' ? 1 : 0,
                'draws'   => $field === 'draws' ? 1 : 0,
                'points'  => (int) $points,
                'streak'  => $field === 'wins' ? 1 : 0,
                'best_streak' => $field === 'wins' ? 1 : 0,
                'last_played' => current_time('mysql', true),
            ));
            return;
        }

        $streak = $field === 'wins' ? ((int) $row['streak'] + 1) : 0;
        $wpdb->update($t, array(
            $field  => (int) $row[$field] + 1,
            'points' => (int) $row['points'] + (int) $points,
            'streak' => $streak,
            'best_streak' => max((int) $row['best_streak'], $streak),
            'last_played' => current_time('mysql', true),
        ), array('id' => (int) $row['id']));
    }
}

if (!function_exists('sml_game_score_for')) {
    function sml_game_score_for($user_id) {
        global $wpdb;
        $user_id = (int) $user_id;
        if ($user_id <= 0) {
            return array();
        }
        $t = sml_game_table('scores');
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT game, wins, losses, draws, points, streak, best_streak FROM $t WHERE user_id = %d",
            $user_id
        ), ARRAY_A);
        $out = array();
        foreach ((array) $rows as $row) {
            $out[$row['game']] = array(
                'wins'   => (int) $row['wins'],
                'losses' => (int) $row['losses'],
                'draws'  => (int) $row['draws'],
                'points' => (int) $row['points'],
                'streak' => (int) $row['streak'],
                'best'   => (int) $row['best_streak'],
            );
        }
        return $out;
    }
}
