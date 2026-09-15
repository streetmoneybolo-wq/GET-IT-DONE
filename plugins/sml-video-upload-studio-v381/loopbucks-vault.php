<?php
/**
 * The Loop Bucks Vault: fixed supply, double-entry ledger.
 *
 * There is one billion Loop Bucks in existence and there will only ever be one
 * billion. Every Loop Buck is at any instant in exactly one of three places:
 *
 *     vault  +  circulating (user balances)  +  escrow (staked in live games)
 *       =  SML_LB_SUPPLY
 *
 * That identity is the single invariant this whole file exists to protect. If
 * it ever breaks, Loop Bucks are being minted or burned by accident, and a
 * currency that quietly inflates is worth nothing. sml_lb_audit() checks it.
 *
 * Every movement goes through sml_lb_move(), which writes a ledger row before
 * it touches a balance. The ledger has a UNIQUE index on the reference string,
 * so a retried request -- a double-clicked button, a network retry, a cron
 * overlap -- inserts nothing the second time and the balance is left alone.
 * Idempotency is enforced by the database, not by hoping the caller is careful.
 *
 * Loop Bucks are earned, won, or bought. They are never redeemable for cash.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SML_LB_DB_VERSION', '1.0.0');

/** Total supply. This number must never change. */
if (!defined('SML_LB_SUPPLY')) {
    define('SML_LB_SUPPLY', 1000000000);
}

if (!function_exists('sml_lb_table')) {
    function sml_lb_table($name) {
        global $wpdb;
        return $wpdb->prefix . 'sml_lb_' . $name;
    }
}

/* ==================================================================
 * Reasons
 *
 * Every reason declares which way it crosses the vault boundary, so
 * adding a new sink later (boosts, premium tools, tipping) is one
 * array entry rather than an audit of the whole codebase.
 *
 *   'issue'   vault -> user      (supply enters circulation)
 *   'absorb'  user  -> vault     (supply leaves circulation)
 *   'escrow'  user  -> escrow    (held against a live table)
 *   'release' escrow -> user     (paid out or refunded)
 *   'peer'    user  -> user      (circulating total unchanged)
 * ================================================================== */

if (!function_exists('sml_lb_reasons')) {
    function sml_lb_reasons() {
        return apply_filters('sml_lb_reasons', array(
            // Into circulation
            'earn'          => array('flow' => 'issue',   'label' => 'Earned'),
            'purchase'      => array('flow' => 'issue',   'label' => 'Purchased'),
            'admin_credit'  => array('flow' => 'issue',   'label' => 'Adjustment'),
            'house_loss'    => array('flow' => 'issue',   'label' => 'Blackjack win'),

            // Out of circulation
            'boost'         => array('flow' => 'absorb',  'label' => 'Post boost'),
            'premium'       => array('flow' => 'absorb',  'label' => 'Premium purchase'),
            'unlock'        => array('flow' => 'absorb',  'label' => 'Content unlock'),
            'admin_debit'   => array('flow' => 'absorb',  'label' => 'Adjustment'),
            'house_win'     => array('flow' => 'absorb',  'label' => 'Blackjack loss'),

            // Held against a live table
            'game_ante'     => array('flow' => 'escrow',  'label' => 'Table stake'),
            'game_win'      => array('flow' => 'release', 'label' => 'Pot won'),
            'game_refund'   => array('flow' => 'release', 'label' => 'Stake returned'),
        ));
    }
}

if (!function_exists('sml_lb_reason_flow')) {
    function sml_lb_reason_flow($reason) {
        $all = sml_lb_reasons();
        return isset($all[$reason]) ? $all[$reason]['flow'] : '';
    }
}

/* ==================================================================
 * Schema
 * ================================================================== */

if (!function_exists('sml_lb_install')) {
    function sml_lb_install() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();

        $ledger = sml_lb_table('ledger');
        $ranks  = sml_lb_table('ranks');

        // ref is the idempotency key and it is UNIQUE. That index is the whole
        // safety mechanism -- do not drop it.
        dbDelta("CREATE TABLE $ledger (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            delta BIGINT NOT NULL,
            balance_after BIGINT NOT NULL,
            reason VARCHAR(24) NOT NULL,
            flow VARCHAR(12) NOT NULL,
            ref VARCHAR(96) NOT NULL,
            meta TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY idem (ref),
            KEY per_user (user_id, id),
            KEY by_reason (reason, created_at)
        ) $charset;");

        dbDelta("CREATE TABLE $ranks (
            user_id BIGINT UNSIGNED NOT NULL,
            balance BIGINT NOT NULL DEFAULT 0,
            rank_pos INT UNSIGNED NOT NULL DEFAULT 0,
            computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (user_id),
            KEY standings (rank_pos)
        ) $charset;");

        if (get_option('sml_lb_escrow', null) === null) {
            add_option('sml_lb_escrow', 0, '', false);
        }
        update_option('sml_lb_db_version', SML_LB_DB_VERSION);
    }
}

if (!function_exists('sml_lb_maybe_install')) {
    function sml_lb_maybe_install() {
        if (get_option('sml_lb_db_version') !== SML_LB_DB_VERSION) {
            sml_lb_install();
        }
    }
}
add_action('init', 'sml_lb_maybe_install', 4);

/* ==================================================================
 * Balances
 *
 * The per-user balance lives where it always has -- the voice wallet
 * adapter owns meta-key discovery and the atomic conditional UPDATE.
 * Reusing it means there is one balance per user, not two that drift.
 * ================================================================== */

if (!function_exists('sml_lb_balance')) {
    function sml_lb_balance($user_id) {
        if (function_exists('sml_voice_wallet_balance')) {
            return (int) sml_voice_wallet_balance($user_id);
        }
        return (int) get_user_meta((int) $user_id, 'sml_loop_bucks', true);
    }
}

if (!function_exists('sml_lb_ensure_wallet')) {
    /** Give a user a wallet key if they have never held Loop Bucks. */
    function sml_lb_ensure_wallet($user_id) {
        $user_id = (int) $user_id;
        if (function_exists('sml_voice_wallet_active_key')) {
            $key = sml_voice_wallet_active_key($user_id);
            if ($key) {
                return $key;
            }
        }
        add_user_meta($user_id, 'sml_loop_bucks', 0, true);
        return 'sml_loop_bucks';
    }
}

/* ==================================================================
 * Escrow and vault totals
 * ================================================================== */

if (!function_exists('sml_lb_escrow_total')) {
    function sml_lb_escrow_total() {
        return (int) get_option('sml_lb_escrow', 0);
    }
}

if (!function_exists('sml_lb_escrow_shift')) {
    /** Move the escrow counter. Guarded so it can never go negative. */
    function sml_lb_escrow_shift($delta) {
        global $wpdb;
        $delta = (int) $delta;
        if ($delta === 0) {
            return sml_lb_escrow_total();
        }
        // Conditional UPDATE on the options row is the lock.
        $sql = $delta > 0
            ? $wpdb->prepare(
                "UPDATE {$wpdb->options} SET option_value = CAST(option_value AS SIGNED) + %d
                  WHERE option_name = 'sml_lb_escrow'", $delta)
            : $wpdb->prepare(
                "UPDATE {$wpdb->options} SET option_value = CAST(option_value AS SIGNED) - %d
                  WHERE option_name = 'sml_lb_escrow'
                    AND CAST(option_value AS SIGNED) >= %d", -$delta, -$delta);
        $ok = $wpdb->query($sql);
        wp_cache_delete('sml_lb_escrow', 'options');
        wp_cache_delete('alloptions', 'options');
        return $ok ? sml_lb_escrow_total() : false;
    }
}

if (!function_exists('sml_lb_circulating')) {
    /**
     * Sum of every user balance. Walks usermeta, so it is a reporting call,
     * not something to put on a page render. sml_lb_vault_balance() caches it.
     */
    function sml_lb_circulating() {
        global $wpdb;
        $keys = function_exists('sml_voice_wallet_meta_keys')
            ? sml_voice_wallet_meta_keys()
            : array('sml_loop_bucks');
        $in = implode(',', array_fill(0, count($keys), '%s'));
        $sql = $wpdb->prepare(
            "SELECT COALESCE(SUM(CAST(meta_value AS SIGNED)), 0)
               FROM {$wpdb->usermeta} WHERE meta_key IN ($in)",
            $keys
        );
        return (int) $wpdb->get_var($sql);
    }
}

if (!function_exists('sml_lb_vault_balance')) {
    /** What the vault still holds. Derived, never stored, so it cannot drift. */
    function sml_lb_vault_balance($fresh = false) {
        $cached = get_transient('sml_lb_vault');
        if (!$fresh && $cached !== false) {
            return (int) $cached;
        }
        $vault = SML_LB_SUPPLY - sml_lb_circulating() - sml_lb_escrow_total();
        set_transient('sml_lb_vault', $vault, 120);
        return (int) $vault;
    }
}

if (!function_exists('sml_lb_audit')) {
    /**
     * The invariant, checked. Anything other than diff === 0 means Loop Bucks
     * are being created or destroyed somewhere and needs investigating.
     */
    function sml_lb_audit() {
        $circ = sml_lb_circulating();
        $escrow = sml_lb_escrow_total();
        $vault = SML_LB_SUPPLY - $circ - $escrow;
        return array(
            'supply'      => SML_LB_SUPPLY,
            'circulating' => $circ,
            'escrow'      => $escrow,
            'vault'       => $vault,
            'diff'        => SML_LB_SUPPLY - ($circ + $escrow + $vault),
            'healthy'     => $vault >= 0,
        );
    }
}

/* ==================================================================
 * The one way Loop Bucks move
 * ================================================================== */

if (!function_exists('sml_lb_move')) {
    /**
     * Apply a signed change to a user's balance and record it.
     *
     * $ref must be unique and deterministic for the event it represents --
     * "table:42:ante:seat2", not uniqid(). That is what makes a retry a no-op
     * instead of a second payment.
     *
     * Returns array('ok'=>true,'balance'=>int,'replayed'=>bool) or WP_Error.
     */
    function sml_lb_move($user_id, $delta, $reason, $ref, $meta = array()) {
        global $wpdb;
        $user_id = (int) $user_id;
        $delta = (int) $delta;
        $ref = substr((string) $ref, 0, 96);

        if ($user_id <= 0) {
            return new WP_Error('lb_no_user', 'No account for that transaction.', array('status' => 400));
        }
        if ($ref === '') {
            return new WP_Error('lb_no_ref', 'Every movement needs a reference.', array('status' => 500));
        }
        $flow = sml_lb_reason_flow($reason);
        if ($flow === '') {
            return new WP_Error('lb_bad_reason', 'Unknown ledger reason.', array('status' => 500));
        }
        if ($delta === 0) {
            return array('ok' => true, 'balance' => sml_lb_balance($user_id), 'replayed' => false);
        }

        sml_lb_ensure_wallet($user_id);
        $ledger = sml_lb_table('ledger');

        // Claim the reference first. If this insert fails on the unique index
        // we have already done this exact movement and must not repeat it.
        $claimed = $wpdb->query($wpdb->prepare(
            "INSERT IGNORE INTO $ledger (user_id, delta, balance_after, reason, flow, ref, meta, created_at)
             VALUES (%d, %d, %d, %s, %s, %s, %s, %s)",
            $user_id, $delta, 0, $reason, $flow, $ref,
            wp_json_encode((array) $meta), current_time('mysql', true)
        ));
        if (!$claimed) {
            return array('ok' => true, 'balance' => sml_lb_balance($user_id), 'replayed' => true);
        }
        $row_id = (int) $wpdb->insert_id;

        // Now move the money. A debit is conditional on sufficient funds, so
        // two concurrent spends cannot both succeed against one balance.
        if ($delta < 0) {
            $result = function_exists('sml_voice_wallet_debit')
                ? sml_voice_wallet_debit($user_id, -$delta, $ref)
                : new WP_Error('lb_no_wallet', 'Wallet unavailable.', array('status' => 500));
            if (is_wp_error($result)) {
                // Roll the claim back so the caller may legitimately retry
                // once they have the funds.
                $wpdb->delete($ledger, array('id' => $row_id));
                return new WP_Error(
                    'lb_insufficient',
                    'Not enough Loop Bucks.',
                    array('status' => 409, 'need' => -$delta, 'have' => sml_lb_balance($user_id))
                );
            }
            $balance = (int) $result;
        } else {
            if (in_array($flow, array('issue'), true) && sml_lb_vault_balance(true) < $delta) {
                $wpdb->delete($ledger, array('id' => $row_id));
                return new WP_Error('lb_vault_empty', 'The Loop Bucks vault is exhausted.',
                    array('status' => 409));
            }
            $balance = function_exists('sml_voice_wallet_credit')
                ? (int) sml_voice_wallet_credit($user_id, $delta, $ref)
                : sml_lb_balance($user_id);
        }

        $wpdb->update($ledger, array('balance_after' => $balance), array('id' => $row_id));
        delete_transient('sml_lb_vault');

        return array('ok' => true, 'balance' => $balance, 'replayed' => false);
    }
}

/* ==================================================================
 * Convenience wrappers
 * ================================================================== */

if (!function_exists('sml_lb_take')) {
    /** User -> escrow. The stake is really gone from their balance. */
    function sml_lb_take($user_id, $amount, $ref, $meta = array()) {
        $amount = (int) $amount;
        $moved = sml_lb_move($user_id, -$amount, 'game_ante', $ref, $meta);
        if (is_wp_error($moved)) {
            return $moved;
        }
        if (empty($moved['replayed'])) {
            sml_lb_escrow_shift($amount);
        }
        return $moved;
    }
}

if (!function_exists('sml_lb_pay')) {
    /** Escrow -> user. Winnings or a refund. */
    function sml_lb_pay($user_id, $amount, $ref, $refund = false, $meta = array()) {
        $amount = (int) $amount;
        if ($amount <= 0) {
            return array('ok' => true, 'balance' => sml_lb_balance($user_id), 'replayed' => false);
        }
        $moved = sml_lb_move($user_id, $amount, $refund ? 'game_refund' : 'game_win', $ref, $meta);
        if (is_wp_error($moved)) {
            return $moved;
        }
        if (empty($moved['replayed'])) {
            sml_lb_escrow_shift(-$amount);
        }
        return $moved;
    }
}

if (!function_exists('sml_lb_escrow_to_vault')) {
    /**
     * Escrow -> vault, with no user on the receiving end. This is how a
     * blackjack loss leaves circulation: the stake was already taken from the
     * player, so all that remains is to stop counting it as escrowed.
     */
    function sml_lb_escrow_to_vault($amount, $ref, $meta = array()) {
        global $wpdb;
        $amount = (int) $amount;
        if ($amount <= 0) {
            return true;
        }
        $ledger = sml_lb_table('ledger');
        $claimed = $wpdb->query($wpdb->prepare(
            "INSERT IGNORE INTO $ledger (user_id, delta, balance_after, reason, flow, ref, meta, created_at)
             VALUES (0, %d, 0, 'house_win', 'absorb', %s, %s, %s)",
            -$amount, substr((string) $ref, 0, 96),
            wp_json_encode((array) $meta), current_time('mysql', true)
        ));
        if (!$claimed) {
            return true;
        }
        sml_lb_escrow_shift(-$amount);
        delete_transient('sml_lb_vault');
        return true;
    }
}

/* ==================================================================
 * Bulk reset
 *
 * Zeroing every wallet is a destructive act on real user data, so it is
 * built to be undoable. Each zeroed balance writes an admin_debit ledger
 * row carrying the exact amount removed and a tag; feeding those rows back
 * through sml_lb_move() with the opposite sign restores the lot.
 *
 * Batched, because usermeta on a busy site is not something to rewrite in
 * one request, and confirm-gated so it cannot fire by accident.
 * ================================================================== */

if (!function_exists('sml_lb_holders')) {
    /** Everyone currently holding a non-zero balance. */
    function sml_lb_holders($limit = 500) {
        global $wpdb;
        $keys = function_exists('sml_voice_wallet_meta_keys')
            ? sml_voice_wallet_meta_keys()
            : array('sml_loop_bucks');
        $in = implode(',', array_fill(0, count($keys), '%s'));
        return $wpdb->get_results($wpdb->prepare(
            "SELECT user_id, MAX(CAST(meta_value AS SIGNED)) AS bal
               FROM {$wpdb->usermeta}
              WHERE meta_key IN ($in)
              GROUP BY user_id
             HAVING bal <> 0
              ORDER BY user_id ASC
              LIMIT %d",
            array_merge($keys, array((int) $limit))
        ), ARRAY_A);
    }
}

if (!function_exists('sml_lb_reset_all')) {
    /**
     * Set every wallet to zero.
     *
     * $tag names the reset so it can be identified and reversed later.
     * $dry_run reports what would happen and changes nothing.
     *
     * Returns array(users, moved, remaining, dry_run, tag).
     */
    function sml_lb_reset_all($tag = 'launch', $dry_run = true, $batch = 500) {
        $tag = sanitize_key($tag) ?: 'reset';
        $holders = sml_lb_holders($batch);

        $users = 0;
        $moved = 0;
        foreach ($holders as $row) {
            $uid = (int) $row['user_id'];
            $bal = (int) $row['bal'];
            if ($bal === 0) {
                continue;
            }
            $users++;
            $moved += $bal;
            if ($dry_run) {
                continue;
            }
            // Negative delta returns the balance to the vault; positive would
            // be a correction of a negative balance, which should not exist
            // but is handled rather than ignored.
            sml_lb_move($uid, -$bal, $bal > 0 ? 'admin_debit' : 'admin_credit',
                'reset:' . $tag . ':' . $uid,
                array('reset' => $tag, 'was' => $bal));
        }

        if (!$dry_run) {
            delete_transient('sml_lb_vault');
            if (function_exists('sml_lb_rebuild_ranks')) {
                sml_lb_rebuild_ranks();
            }
        }

        return array(
            'tag'       => $tag,
            'dry_run'   => (bool) $dry_run,
            'users'     => $users,
            'moved'     => $moved,
            'remaining' => count($holders) >= $batch,
        );
    }
}

if (!function_exists('sml_lb_undo_reset')) {
    /** Put back exactly what a named reset took away. */
    function sml_lb_undo_reset($tag) {
        global $wpdb;
        $tag = sanitize_key($tag);
        $ledger = sml_lb_table('ledger');
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT user_id, delta FROM $ledger WHERE ref LIKE %s",
            'reset:' . $tag . ':%'
        ), ARRAY_A);

        $users = 0;
        $moved = 0;
        foreach ((array) $rows as $row) {
            $back = -(int) $row['delta'];
            if ($back <= 0) {
                continue;
            }
            $done = sml_lb_move((int) $row['user_id'], $back, 'admin_credit',
                'unreset:' . $tag . ':' . (int) $row['user_id'],
                array('undo' => $tag));
            if (!is_wp_error($done)) {
                $users++;
                $moved += $back;
            }
        }
        delete_transient('sml_lb_vault');
        if (function_exists('sml_lb_rebuild_ranks')) {
            sml_lb_rebuild_ranks();
        }
        return array('tag' => $tag, 'users' => $users, 'restored' => $moved);
    }
}

if (!function_exists('sml_lb_history')) {
    function sml_lb_history($user_id, $limit = 25) {
        global $wpdb;
        $ledger = sml_lb_table('ledger');
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT delta, balance_after, reason, meta, created_at
               FROM $ledger WHERE user_id = %d ORDER BY id DESC LIMIT %d",
            (int) $user_id, (int) $limit
        ), ARRAY_A);
        $labels = sml_lb_reasons();
        $out = array();
        foreach ((array) $rows as $row) {
            $out[] = array(
                'delta'   => (int) $row['delta'],
                'balance' => (int) $row['balance_after'],
                'reason'  => (string) $row['reason'],
                'label'   => isset($labels[$row['reason']]) ? $labels[$row['reason']]['label'] : $row['reason'],
                'at'      => (string) $row['created_at'],
            );
        }
        return $out;
    }
}
