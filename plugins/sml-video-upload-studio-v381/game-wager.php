<?php
/**
 * Staked tables: escrow in, pot out.
 *
 * The rule that keeps this honest is that a stake is *escrowed*, never merely
 * checked. The moment you sit down the Loop Bucks leave your balance. You
 * cannot stake the same 10 LB at four tables at once, and a player who loses
 * cannot have spent the stake before settlement lands.
 *
 * Every settlement reference is derived from the table id, so replaying a
 * settlement pays nobody twice -- the ledger's unique index eats it.
 *
 * No rake. Twenty in, twenty out.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_wager_min')) {
    function sml_wager_min() {
        return (int) apply_filters('sml_wager_min', 10);
    }
}

if (!function_exists('sml_wager_max')) {
    function sml_wager_max() {
        return (int) apply_filters('sml_wager_max', 10000);
    }
}

if (!function_exists('sml_wager_steps')) {
    /** Stake presets offered in the UI. */
    function sml_wager_steps() {
        return (array) apply_filters('sml_wager_steps', array(10, 25, 50, 100, 250, 500));
    }
}

if (!function_exists('sml_wager_enabled')) {
    /**
     * Per-game kill switch. Flip a game off here and its tables become free
     * play immediately, with no deploy and no effect on games in flight.
     */
    function sml_wager_enabled($game) {
        // Games flagged noWager are never stakeable. This is a property of the
        // game, not a setting, so it cannot be switched on by accident.
        $all = sml_game_catalogue();
        if (!empty($all[$game]['noWager'])) {
            return false;
        }
        $off = (array) get_option('sml_wager_disabled', array());
        if (in_array($game, $off, true)) {
            return false;
        }
        // Default off. Games are free to play; access is gated on holding
        // Loop Bucks, not on staking them. Flip sml_wager_master to 1 only
        // after taking legal advice on peer-to-peer stakes.
        if (!get_option('sml_wager_master', 0)) {
            return false;
        }
        return (bool) apply_filters('sml_wager_enabled', true, $game);
    }
}

if (!function_exists('sml_wager_normalise')) {
    function sml_wager_normalise($game, $stake) {
        $stake = (int) $stake;
        if (!sml_wager_enabled($game) || $stake <= 0) {
            return 0;
        }
        return max(sml_wager_min(), min(sml_wager_max(), $stake));
    }
}

/* ==================================================================
 * Guardrails
 * ================================================================== */

if (!function_exists('sml_wager_daily_loss')) {
    /** Net Loop Bucks lost at tables in the last 24 hours (positive number). */
    function sml_wager_daily_loss($user_id) {
        global $wpdb;
        $ledger = sml_lb_table('ledger');
        $net = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(delta), 0) FROM $ledger
              WHERE user_id = %d
                AND reason IN ('game_ante','game_win','game_refund','house_win','house_loss')
                AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)",
            (int) $user_id
        ));
        return $net < 0 ? -$net : 0;
    }
}

if (!function_exists('sml_wager_daily_cap')) {
    function sml_wager_daily_cap($user_id) {
        $cap = (int) get_user_meta((int) $user_id, 'sml_wager_daily_cap', true);
        if ($cap <= 0) {
            $cap = (int) get_option('sml_wager_default_cap', 5000);
        }
        return (int) apply_filters('sml_wager_daily_cap', $cap, $user_id);
    }
}

if (!function_exists('sml_wager_check')) {
    /**
     * Everything that must be true before a person may stake. Returns true or
     * a WP_Error the caller can hand straight back to the client.
     */
    function sml_wager_check($user_id, $game, $stake) {
        $user_id = (int) $user_id;
        $stake = (int) $stake;

        if ($stake <= 0) {
            return true;                       // free table, nothing to check
        }
        if (!sml_wager_enabled($game)) {
            return new WP_Error('wager_off', 'Staked play is switched off for this game.',
                array('status' => 409));
        }
        if ($stake < sml_wager_min()) {
            return new WP_Error('wager_low',
                'The minimum stake is ' . sml_wager_min() . ' Loop Bucks.', array('status' => 400));
        }
        if (get_user_meta($user_id, 'sml_wager_excluded', true)) {
            return new WP_Error('wager_excluded',
                'You have turned staked play off for your account.', array('status' => 403));
        }

        $balance = sml_lb_balance($user_id);
        // Deliberately 409 and not 402. WordPress.com's edge intercepts 402
        // Payment Required and replaces the body with its own "site disabled"
        // page, so a player who is simply short of Loop Bucks would be told
        // the whole site was down.
        if ($balance < $stake) {
            return new WP_Error('wager_broke',
                'You need ' . $stake . ' Loop Bucks to sit at this table. You have ' . $balance . '.',
                array('status' => 409, 'need' => $stake, 'have' => $balance));
        }

        $cap = sml_wager_daily_cap($user_id);
        $lost = sml_wager_daily_loss($user_id);
        if ($cap > 0 && ($lost + $stake) > $cap) {
            return new WP_Error('wager_cap',
                'That would pass your daily limit of ' . $cap . ' Loop Bucks. Try again tomorrow.',
                array('status' => 429, 'cap' => $cap, 'lost' => $lost));
        }

        return apply_filters('sml_wager_check', true, $user_id, $game, $stake);
    }
}

/* ==================================================================
 * Escrow
 * ================================================================== */

if (!function_exists('sml_wager_ref')) {
    function sml_wager_ref($table_id, $what, $seat = 0) {
        return 'tbl:' . (int) $table_id . ':' . $what . ($seat ? ':s' . (int) $seat : '');
    }
}

if (!function_exists('sml_wager_per_round')) {
    /**
     * Games that stake per round rather than per seat.
     *
     * Blackjack settles against the vault every hand and can be dealt again
     * at the same table, so its ante belongs to the round, not to sitting
     * down. Everything else antes once when you take a seat.
     */
    function sml_wager_per_round($game) {
        return in_array($game, (array) apply_filters('sml_wager_per_round_games',
            array('blackjack')), true);
    }
}

if (!function_exists('sml_wager_hold')) {
    /**
     * Per-table escrow counter.
     *
     * The global escrow total is not enough on its own. A table can pay out
     * mid-life -- blackjack settles every round -- and then be swept as
     * abandoned later. Without a per-table figure the sweep happily "refunds"
     * stakes that were already returned, which mints Loop Bucks out of thin
     * air. This counter is the answer to "what is this table still holding?"
     */
    function sml_wager_hold($table_id, $delta) {
        global $wpdb;
        $t = sml_game_table('tables');
        $delta = (int) $delta;
        if ($delta > 0) {
            $wpdb->query($wpdb->prepare(
                "UPDATE $t SET escrowed = escrowed + %d WHERE id = %d", $delta, (int) $table_id));
            return $delta;
        }
        return 0;
    }
}

if (!function_exists('sml_wager_release')) {
    /**
     * Atomically take up to $want out of the table's escrow. Returns what was
     * actually available. The conditional UPDATE is the lock, so two racing
     * payouts can never between them release more than was ever put in.
     */
    function sml_wager_release($table_id, $want) {
        global $wpdb;
        $t = sml_game_table('tables');
        $want = (int) $want;
        if ($want <= 0) {
            return 0;
        }
        $got = $wpdb->query($wpdb->prepare(
            "UPDATE $t SET escrowed = escrowed - %d WHERE id = %d AND escrowed >= %d",
            $want, (int) $table_id, $want
        ));
        if ($got) {
            return $want;
        }
        // Partial: take whatever is left.
        $left = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT escrowed FROM $t WHERE id = %d", (int) $table_id));
        if ($left <= 0) {
            return 0;
        }
        $wpdb->query($wpdb->prepare(
            "UPDATE $t SET escrowed = escrowed - %d WHERE id = %d AND escrowed >= %d",
            $left, (int) $table_id, $left));
        return $left;
    }
}

if (!function_exists('sml_wager_ante')) {
    /** Take one seat's stake into escrow. Idempotent per table+seat. */
    function sml_wager_ante($table_id, $seat, $user_id, $game, $stake) {
        $stake = (int) $stake;
        if ($stake <= 0) {
            return true;
        }
        $check = sml_wager_check($user_id, $game, $stake);
        if (is_wp_error($check)) {
            return $check;
        }
        $taken = sml_lb_take($user_id, $stake, sml_wager_ref($table_id, 'ante', $seat), array(
            'table' => (int) $table_id, 'seat' => (int) $seat, 'game' => $game,
        ));
        if (!is_wp_error($taken) && empty($taken['replayed'])) {
            sml_wager_hold($table_id, $stake);
        }
        return $taken;
    }
}

if (!function_exists('sml_wager_refund_all')) {
    /** Hand every staked seat its money back. Used on abandon and on draws. */
    function sml_wager_refund_all($row, $tag = 'refund') {
        $stake = (int) ($row['stake'] ?? 0);
        if ($stake <= 0) {
            return;
        }
        // Only ever hand back money this table is actually still holding.
        foreach (sml_game_seats($row) as $seat => $uid) {
            $available = sml_wager_release($row['id'], $stake);
            if ($available <= 0) {
                continue;
            }
            sml_lb_pay($uid, $available, sml_wager_ref($row['id'], $tag, $seat), true, array(
                'table' => (int) $row['id'], 'seat' => (int) $seat,
            ));
        }
    }
}

/* ==================================================================
 * Settlement
 * ================================================================== */

if (!function_exists('sml_wager_settle')) {
    /**
     * Pay out a finished table.
     *
     * $winner_seat 0 means a draw, in which case everyone gets their stake
     * back. For four-handed spades the winning partnership splits the pot,
     * which with equal antes is simply two stakes each.
     *
     * Returns a per-seat swing map for display.
     */
    function sml_wager_settle($row, $winner_seat) {
        $stake = (int) ($row['stake'] ?? 0);
        $table_id = (int) $row['id'];
        $seats = sml_game_seats($row);
        $swing = array();

        if ($stake <= 0 || !$seats) {
            return $swing;
        }

        // Draw, stalemate, or a table that ended with nobody ahead.
        if ((int) $winner_seat === 0) {
            sml_wager_refund_all($row, 'draw');
            foreach ($seats as $seat => $uid) {
                $swing[$seat] = 0;
            }
            return $swing;
        }

        $pot = $stake * count($seats);
        $winners = array();
        if (count($seats) === 4) {
            // Spades: seats 1+3 play 2+4, so the winner's partner shares.
            foreach ($seats as $seat => $uid) {
                if (($seat % 2) === ((int) $winner_seat % 2)) {
                    $winners[$seat] = $uid;
                }
            }
        } elseif (isset($seats[$winner_seat])) {
            $winners[$winner_seat] = $seats[$winner_seat];
        }

        if (!$winners) {
            sml_wager_refund_all($row, 'noclaim');
            return $swing;
        }

        // Integer division leaves a remainder at odd pot sizes; it goes to the
        // seat that actually won rather than evaporating.
        $share = intdiv($pot, count($winners));
        $remainder = $pot - ($share * count($winners));

        foreach ($seats as $seat => $uid) {
            $swing[$seat] = -$stake;
        }
        foreach ($winners as $seat => $uid) {
            $amount = $share + (($seat === (int) $winner_seat) ? $remainder : 0);
            $available = sml_wager_release($table_id, $amount);
            if ($available <= 0) {
                continue;
            }
            sml_lb_pay($uid, $available, sml_wager_ref($table_id, 'pot', $seat), false, array(
                'table' => $table_id, 'seat' => $seat, 'pot' => $pot,
            ));
            $swing[$seat] = $available - $stake;
        }
        return $swing;
    }
}

/* ==================================================================
 * Blackjack settles against the vault
 *
 * There is no opponent to take from, so a loss leaves circulation and
 * returns to the vault, and a win is issued out of it. The vault is the
 * counterparty, which is exactly the float model: Loop Bucks are never
 * created or destroyed, only moved in and out of the reserve.
 * ================================================================== */

if (!function_exists('sml_wager_blackjack')) {
    /**
     * $results is seat => net chips, as produced by the blackjack engine, in
     * units of the table stake. A 3:2 natural returns 1.5x, hence the halves.
     */
    function sml_wager_blackjack($row, $results) {
        $stake = (int) ($row['stake'] ?? 0);
        $table_id = (int) $row['id'];
        $seats = sml_game_seats($row);
        $swing = array();
        if ($stake <= 0) {
            return $swing;
        }

        $round = (int) ($row['move_count'] ?? 0);
        foreach ($seats as $seat => $uid) {
            $net = isset($results[$seat]) ? (int) $results[$seat] : 0;
            $swing[$seat] = $net;
            $ref = sml_wager_ref($table_id, 'bj' . $round, $seat);

            $held = sml_wager_release($table_id, $stake);
            if ($held <= 0) {
                continue;                      // this round was already settled
            }

            if ($net > 0) {
                // Stake comes back out of escrow; the winnings are issued by
                // the vault, which is the counterparty for blackjack.
                sml_lb_pay($uid, $held, $ref . ':back', true, array('table' => $table_id));
                sml_lb_move($uid, $net, 'house_loss', $ref . ':win', array(
                    'table' => $table_id, 'seat' => $seat,
                ));
            } elseif ($net < 0) {
                $lost = min($held, -$net);
                sml_lb_pay($uid, $held - $lost, $ref . ':back', true, array('table' => $table_id));
                sml_lb_escrow_to_vault($lost, $ref . ':house', array(
                    'table' => $table_id, 'seat' => $seat,
                ));
            } else {
                sml_lb_pay($uid, $held, $ref . ':push', true, array('table' => $table_id));
            }
        }
        return $swing;
    }
}

/* ==================================================================
 * Public shape for the client
 * ================================================================== */

if (!function_exists('sml_wager_public')) {
    function sml_wager_public($row, $viewer_id) {
        $stake = (int) ($row['stake'] ?? 0);
        $seats = sml_game_seats($row);
        return array(
            'stake'   => $stake,
            'pot'     => $stake * max(1, count($seats)),
            'min'     => sml_wager_min(),
            'steps'   => sml_wager_steps(),
            'enabled' => sml_wager_enabled((string) $row['game']),
            'balance' => $viewer_id ? sml_lb_balance($viewer_id) : 0,
        );
    }
}
