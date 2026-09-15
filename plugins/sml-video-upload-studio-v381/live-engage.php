<?php
/**
 * Creator-authored polls and Q&A for live streams.
 *
 * The Engagement Tools card used to be on/off switches only. This gives the
 * Customize button something to open: the creator writes their own polls and
 * Q&A prompts ahead of time, then pushes them live mid-stream without leaving
 * the broadcast.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SML_ENGAGE_DB_VERSION', '1.0.0');

if (!function_exists('sml_engage_table')) {
    function sml_engage_table($name) {
        global $wpdb;
        return $wpdb->prefix . 'sml_engage_' . $name;
    }
}

if (!function_exists('sml_engage_install')) {
    function sml_engage_install() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();

        $polls = sml_engage_table('polls');
        $votes = sml_engage_table('votes');
        $qa    = sml_engage_table('qa');

        // choices is JSON. A separate choices table buys nothing until we need
        // per-choice queries, and costs a join on every render.
        dbDelta("CREATE TABLE $polls (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            question VARCHAR(255) NOT NULL,
            choices TEXT NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'draft',
            multi TINYINT(1) NOT NULL DEFAULT 0,
            seconds SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            opened_at DATETIME NULL,
            closed_at DATETIME NULL,
            sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY owner (user_id, status),
            KEY live (status, opened_at)
        ) $charset;");

        dbDelta("CREATE TABLE $votes (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            poll_id BIGINT UNSIGNED NOT NULL,
            choice_index TINYINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            session_key VARCHAR(64) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY one_vote (poll_id, session_key, choice_index),
            KEY tally (poll_id, choice_index)
        ) $charset;");

        dbDelta("CREATE TABLE $qa (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            body VARCHAR(500) NOT NULL,
            source VARCHAR(16) NOT NULL DEFAULT 'creator',
            asked_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
            asked_name VARCHAR(120) NULL,
            upvotes INT UNSIGNED NOT NULL DEFAULT 0,
            status VARCHAR(16) NOT NULL DEFAULT 'queued',
            pinned TINYINT(1) NOT NULL DEFAULT 0,
            answered_at DATETIME NULL,
            sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY owner (user_id, status),
            KEY ranked (user_id, status, upvotes)
        ) $charset;");

        update_option('sml_engage_db_version', SML_ENGAGE_DB_VERSION, false);
    }
}

if (!function_exists('sml_engage_maybe_upgrade')) {
    function sml_engage_maybe_upgrade() {
        if (get_option('sml_engage_db_version') === SML_ENGAGE_DB_VERSION) {
            return;
        }
        sml_engage_install();
    }
}
add_action('init', 'sml_engage_maybe_upgrade', 7);

/* ==================================================================
 * Shaping
 * ================================================================== */

if (!function_exists('sml_engage_poll_public')) {
    function sml_engage_poll_public($row, $with_results = true) {
        global $wpdb;
        $choices = json_decode((string) $row['choices'], true);
        $choices = is_array($choices) ? $choices : array();

        $counts = array_fill(0, count($choices), 0);
        $total = 0;

        if ($with_results) {
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT choice_index, COUNT(*) AS n FROM " . sml_engage_table('votes') . "
                  WHERE poll_id = %d GROUP BY choice_index", (int) $row['id']), ARRAY_A);
            foreach ((array) $rows as $r) {
                $i = (int) $r['choice_index'];
                if (isset($counts[$i])) {
                    $counts[$i] = (int) $r['n'];
                    $total += (int) $r['n'];
                }
            }
        }

        $out = array();
        foreach ($choices as $i => $label) {
            $out[] = array(
                'index' => $i,
                'label' => (string) $label,
                'votes' => $counts[$i],
                'pct'   => $total > 0 ? round(($counts[$i] / $total) * 100) : 0,
            );
        }

        return array(
            'id'        => (int) $row['id'],
            'question'  => $row['question'],
            'choices'   => $out,
            'total'     => $total,
            'status'    => $row['status'],
            'multi'     => (bool) $row['multi'],
            'seconds'   => (int) $row['seconds'],
            'opened_at' => $row['opened_at'],
            'closed_at' => $row['closed_at'],
        );
    }
}

if (!function_exists('sml_engage_qa_public')) {
    function sml_engage_qa_public($row) {
        return array(
            'id'      => (int) $row['id'],
            'body'    => $row['body'],
            'source'  => $row['source'],
            'from'    => $row['asked_name'],
            'upvotes' => (int) $row['upvotes'],
            'status'  => $row['status'],
            'pinned'  => (bool) $row['pinned'],
        );
    }
}

/* ==================================================================
 * REST
 * ================================================================== */

if (!function_exists('sml_engage_routes')) {
    function sml_engage_routes() {
        $ns = 'sml-engage/v1';
        $mine = function () { return is_user_logged_in(); };

        register_rest_route($ns, '/polls', array(
            array('methods' => 'GET',  'permission_callback' => $mine, 'callback' => 'sml_engage_rest_polls'),
            array('methods' => 'POST', 'permission_callback' => $mine, 'callback' => 'sml_engage_rest_poll_save'),
        ));
        register_rest_route($ns, '/polls/(?P<id>\d+)/(?P<action>open|close|delete)', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $mine,
            'callback' => 'sml_engage_rest_poll_action',
        ));
        register_rest_route($ns, '/polls/(?P<id>\d+)/vote', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => '__return_true',
            'callback' => 'sml_engage_rest_vote',
        ));

        register_rest_route($ns, '/qa', array(
            array('methods' => 'GET',  'permission_callback' => $mine, 'callback' => 'sml_engage_rest_qa'),
            array('methods' => 'POST', 'permission_callback' => $mine, 'callback' => 'sml_engage_rest_qa_save'),
        ));
        register_rest_route($ns, '/qa/(?P<id>\d+)/(?P<action>answer|pin|delete|queue)', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $mine,
            'callback' => 'sml_engage_rest_qa_action',
        ));

        // What viewers see on the live page.
        register_rest_route($ns, '/live/(?P<handle>[A-Za-z0-9\-_]+)', array(
            'methods' => 'GET', 'permission_callback' => '__return_true',
            'callback' => 'sml_engage_rest_live',
        ));
        register_rest_route($ns, '/ask/(?P<handle>[A-Za-z0-9\-_]+)', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_engage_rest_ask',
        ));
    }
}
add_action('rest_api_init', 'sml_engage_routes');

if (!function_exists('sml_engage_rest_polls')) {
    function sml_engage_rest_polls() {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . sml_engage_table('polls') . "
              WHERE user_id = %d AND status <> 'deleted'
              ORDER BY FIELD(status,'live','draft','closed'), sort_order ASC, id DESC LIMIT 60",
            get_current_user_id()), ARRAY_A);
        return array('polls' => array_map('sml_engage_poll_public', (array) $rows));
    }
}

if (!function_exists('sml_engage_rest_poll_save')) {
    function sml_engage_rest_poll_save(WP_REST_Request $request) {
        global $wpdb;
        $user_id = get_current_user_id();

        $question = trim(sanitize_text_field((string) $request->get_param('question')));
        $choices = array_values(array_filter(array_map(function ($c) {
            return trim(sanitize_text_field((string) $c));
        }, (array) $request->get_param('choices')), function ($c) { return $c !== ''; }));

        if ($question === '') {
            return new WP_Error('no_question', 'Give the poll a question.', array('status' => 400));
        }
        if (count($choices) < 2) {
            return new WP_Error('few_choices', 'A poll needs at least two answers.', array('status' => 400));
        }
        $choices = array_slice($choices, 0, 6);

        $data = array(
            'user_id'  => $user_id,
            'question' => $question,
            'choices'  => wp_json_encode($choices),
            'multi'    => $request->get_param('multi') ? 1 : 0,
            'seconds'  => max(0, min(600, (int) $request->get_param('seconds'))),
        );

        $id = (int) $request->get_param('id');
        if ($id && sml_engage_owns('polls', $id, $user_id)) {
            $wpdb->update(sml_engage_table('polls'), $data, array('id' => $id));
        } else {
            $wpdb->insert(sml_engage_table('polls'), $data);
            $id = (int) $wpdb->insert_id;
        }

        return array('ok' => true, 'id' => $id);
    }
}

if (!function_exists('sml_engage_owns')) {
    function sml_engage_owns($table, $id, $user_id) {
        global $wpdb;
        return (bool) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM " . sml_engage_table($table) . " WHERE id = %d AND user_id = %d",
            (int) $id, (int) $user_id));
    }
}

if (!function_exists('sml_engage_rest_poll_action')) {
    function sml_engage_rest_poll_action(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $action = sanitize_key((string) $request->get_param('action'));
        $user_id = get_current_user_id();
        $table = sml_engage_table('polls');

        if (!sml_engage_owns('polls', $id, $user_id)) {
            return new WP_Error('not_yours', 'Not your poll.', array('status' => 403));
        }

        if ($action === 'open') {
            // Only one poll on screen at a time - two live polls is just noise.
            $wpdb->query($wpdb->prepare(
                "UPDATE $table SET status = 'closed', closed_at = %s
                  WHERE user_id = %d AND status = 'live'", gmdate('Y-m-d H:i:s'), $user_id));
            $wpdb->update($table, array(
                'status' => 'live', 'opened_at' => gmdate('Y-m-d H:i:s'), 'closed_at' => null,
            ), array('id' => $id));
        } elseif ($action === 'close') {
            $wpdb->update($table, array('status' => 'closed', 'closed_at' => gmdate('Y-m-d H:i:s')),
                array('id' => $id));
        } else {
            $wpdb->update($table, array('status' => 'deleted'), array('id' => $id));
        }

        return array('ok' => true);
    }
}

if (!function_exists('sml_engage_rest_vote')) {
    function sml_engage_rest_vote(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $choice = (int) $request->get_param('choice');

        $poll = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_engage_table('polls') . " WHERE id = %d", $id), ARRAY_A);
        if (!$poll || $poll['status'] !== 'live') {
            return new WP_Error('closed', 'That poll is not open.', array('status' => 400));
        }

        $choices = json_decode((string) $poll['choices'], true);
        if (!is_array($choices) || !isset($choices[$choice])) {
            return new WP_Error('bad_choice', 'No such answer.', array('status' => 400));
        }

        $session = sml_dist_session_key();

        // Single-answer polls: replace any previous vote rather than rejecting,
        // so changing your mind works the way people expect.
        if (empty($poll['multi'])) {
            $wpdb->query($wpdb->prepare(
                "DELETE FROM " . sml_engage_table('votes') . "
                  WHERE poll_id = %d AND session_key = %s", $id, $session));
        }

        $wpdb->query($wpdb->prepare(
            "INSERT IGNORE INTO " . sml_engage_table('votes') . "
               (poll_id, choice_index, user_id, session_key)
             VALUES (%d, %d, %d, %s)",
            $id, $choice, get_current_user_id(), $session));

        return array('ok' => true, 'poll' => sml_engage_poll_public($poll));
    }
}

if (!function_exists('sml_engage_rest_qa')) {
    function sml_engage_rest_qa() {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . sml_engage_table('qa') . "
              WHERE user_id = %d AND status <> 'deleted'
              ORDER BY pinned DESC, FIELD(status,'queued','answered'), upvotes DESC, id ASC LIMIT 100",
            get_current_user_id()), ARRAY_A);
        return array('questions' => array_map('sml_engage_qa_public', (array) $rows));
    }
}

if (!function_exists('sml_engage_rest_qa_save')) {
    function sml_engage_rest_qa_save(WP_REST_Request $request) {
        global $wpdb;
        $body = trim(sanitize_text_field((string) $request->get_param('body')));
        if ($body === '') {
            return new WP_Error('empty', 'Write the question first.', array('status' => 400));
        }
        $wpdb->insert(sml_engage_table('qa'), array(
            'user_id' => get_current_user_id(),
            'body'    => substr($body, 0, 500),
            'source'  => 'creator',
        ));
        return array('ok' => true, 'id' => (int) $wpdb->insert_id);
    }
}

if (!function_exists('sml_engage_rest_qa_action')) {
    function sml_engage_rest_qa_action(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $action = sanitize_key((string) $request->get_param('action'));
        $user_id = get_current_user_id();

        if (!sml_engage_owns('qa', $id, $user_id)) {
            return new WP_Error('not_yours', 'Not your question.', array('status' => 403));
        }

        $table = sml_engage_table('qa');
        if ($action === 'answer') {
            $wpdb->update($table, array('status' => 'answered', 'answered_at' => gmdate('Y-m-d H:i:s'), 'pinned' => 0),
                array('id' => $id));
        } elseif ($action === 'queue') {
            $wpdb->update($table, array('status' => 'queued', 'answered_at' => null), array('id' => $id));
        } elseif ($action === 'pin') {
            $wpdb->query($wpdb->prepare("UPDATE $table SET pinned = 0 WHERE user_id = %d", $user_id));
            $wpdb->update($table, array('pinned' => 1, 'status' => 'queued'), array('id' => $id));
        } else {
            $wpdb->update($table, array('status' => 'deleted'), array('id' => $id));
        }

        return array('ok' => true);
    }
}

if (!function_exists('sml_engage_rest_live')) {
    function sml_engage_rest_live(WP_REST_Request $request) {
        global $wpdb;
        $user = get_user_by('slug', sanitize_title((string) $request->get_param('handle')));
        if (!$user) {
            return new WP_Error('no_user', 'No such creator.', array('status' => 404));
        }

        $poll = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_engage_table('polls') . "
              WHERE user_id = %d AND status = 'live' ORDER BY opened_at DESC LIMIT 1",
            $user->ID), ARRAY_A);

        $qa = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . sml_engage_table('qa') . "
              WHERE user_id = %d AND status = 'queued'
              ORDER BY pinned DESC, upvotes DESC, id ASC LIMIT 20",
            $user->ID), ARRAY_A);

        return array(
            'poll'      => $poll ? sml_engage_poll_public($poll) : null,
            'questions' => array_map('sml_engage_qa_public', (array) $qa),
        );
    }
}

if (!function_exists('sml_engage_rest_ask')) {
    function sml_engage_rest_ask(WP_REST_Request $request) {
        global $wpdb;
        $user = get_user_by('slug', sanitize_title((string) $request->get_param('handle')));
        if (!$user) {
            return new WP_Error('no_user', 'No such creator.', array('status' => 404));
        }
        // Live chat is gated on holding Loop Bucks, which is the cheapest
        // anti-spam measure available: a throwaway account has none.
        if (function_exists('sml_lb_gate_check')) {
            $gate = sml_lb_gate_check('live_comment');
            if (is_wp_error($gate)) {
                return $gate;
            }
        }

        $body = trim(sanitize_text_field((string) $request->get_param('body')));
        if ($body === '') {
            return new WP_Error('empty', 'Type a question.', array('status' => 400));
        }

        $me = wp_get_current_user();
        $wpdb->insert(sml_engage_table('qa'), array(
            'user_id'    => (int) $user->ID,
            'body'       => substr($body, 0, 500),
            'source'     => 'viewer',
            'asked_by'   => get_current_user_id(),
            'asked_name' => $me->display_name ?: $me->user_login,
        ));
        return array('ok' => true);
    }
}

/* ==================================================================
 * Creator UI, painted into the Engagement Tools card
 * ================================================================== */

if (!function_exists('sml_engage_print_studio')) {
    function sml_engage_print_studio() {
        if (!is_user_logged_in()) {
            return;
        }
        $config = array(
            'polls' => esc_url_raw(rest_url('sml-engage/v1/polls')),
            'qa'    => esc_url_raw(rest_url('sml-engage/v1/qa')),
            'base'  => esc_url_raw(rest_url('sml-engage/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
        );

        echo '<style>'
           . '.ge-wrap{margin-top:14px;padding-top:14px;border-top:1px solid #16202e}'
           . '.ge-tabs{display:flex;gap:6px;margin-bottom:13px}'
           . '.ge-tabs button{height:32px;padding:0 14px;border-radius:8px;border:1px solid #223146;'
           . 'background:#0d1622;color:#a9b8ca;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit}'
           . '.ge-tabs button.on{border-color:#2b6cff;background:#132238;color:#fff}'
           . '.ge-item{border:1px solid #1e2a3a;border-radius:11px;background:#0a1018;padding:13px 14px;margin-bottom:9px}'
           . '.ge-item.live{border-color:#22d97a;background:rgba(34,217,122,.05)}'
           . '.ge-q{font-size:14px;font-weight:700;margin-bottom:9px;line-height:1.45}'
           . '.ge-bar{position:relative;height:26px;border-radius:7px;background:#111c2b;margin-bottom:5px;overflow:hidden}'
           . '.ge-bar i{position:absolute;inset:0 auto 0 0;background:#1b3a6b;border-radius:7px}'
           . '.ge-bar span{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;'
           . 'padding:0 10px;font-size:12px;color:#dbe6f2}'
           . '.ge-bar b{font-variant-numeric:tabular-nums;color:#8fb4ff}'
           . '.ge-acts{display:flex;gap:7px;margin-top:10px;flex-wrap:wrap}'
           . '.ge-btn{height:30px;padding:0 12px;border-radius:7px;border:1px solid #223146;background:#0d1622;'
           . 'color:#c2cede;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}'
           . '.ge-btn:hover{border-color:#2b6cff;color:#fff}'
           . '.ge-btn.go{background:#22d97a;border-color:#22d97a;color:#04180c}'
           . '.ge-btn.stop{background:#2a1620;border-color:#3d1f2b;color:#ff8a9b}'
           . '.ge-btn.del{color:#ff8a9b}'
           . '.ge-in{width:100%;background:#0a1018;border:1px solid #1e2a3a;border-radius:8px;color:#e6edf5;'
           . 'padding:9px 11px;font-size:13px;font-family:inherit;margin-bottom:7px}'
           . '.ge-in:focus{outline:none;border-color:#2b6cff}'
           . '.ge-add{background:#0b131f;border:1px dashed #223146;border-radius:11px;padding:14px;margin-bottom:10px}'
           . '.ge-add h5{margin:0 0 10px;font-size:13px;font-weight:800;letter-spacing:.3px;color:#8798ac}'
           . '.ge-row{display:flex;gap:7px;align-items:center;margin-bottom:7px}'
           . '.ge-row .ge-in{margin-bottom:0}'
           . '.ge-x{width:30px;height:36px;border-radius:7px;border:1px solid #223146;background:#0d1622;'
           . 'color:#7b8ca1;cursor:pointer;font-family:inherit;flex:0 0 30px}'
           . '.ge-pill{font-size:10px;font-weight:800;letter-spacing:.5px;padding:2px 7px;border-radius:999px;'
           . 'background:#1a2534;color:#8798ac;margin-left:7px;vertical-align:middle}'
           . '.ge-pill.live{background:rgba(34,217,122,.16);color:#22d97a}'
           . '.ge-pill.viewer{background:rgba(43,108,255,.16);color:#63a4ff}'
           . '.ge-none{padding:18px;text-align:center;color:#41546b;font-size:12.5px;'
           . 'border:1px dashed #1e2a3a;border-radius:10px}'
           . '</style>';

        echo '<div id="ge-root-holder"></div>';
        echo '<script>window.smlEngageCfg=' . wp_json_encode($config) . ';</script>';
        echo '<script>' . sml_engage_script() . '</script>';
    }
}

if (!function_exists('sml_engage_script')) {
    function sml_engage_script() {
        return <<<'SMLENGJS'
(function () {
  var cfg = window.smlEngageCfg;
  if (!cfg) { return; }

  var state = { tab: 'polls', polls: [], qa: [], draft: ['', ''], loaded: false, open: false };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(url, body) {
    return fetch(url, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin', cache: 'no-store',
      headers: Object.assign({ 'Accept': 'application/json', 'X-WP-Nonce': cfg.nonce },
                             body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }

  function load() {
    return Promise.all([api(cfg.polls), api(cfg.qa)]).then(function (r) {
      state.polls = (r[0] && r[0].polls) || [];
      state.qa = (r[1] && r[1].questions) || [];
      state.loaded = true;
      paint();
    }).catch(function () {});
  }

  function pollMarkup(p) {
    var live = p.status === 'live';
    return '<div class="ge-item' + (live ? ' live' : '') + '">'
      + '<div class="ge-q">' + esc(p.question)
      + '<span class="ge-pill' + (live ? ' live' : '') + '">' + esc(p.status.toUpperCase()) + '</span></div>'
      + p.choices.map(function (c) {
          return '<div class="ge-bar"><i style="width:' + c.pct + '%"></i>'
            + '<span>' + esc(c.label) + '<b>' + c.pct + '% · ' + c.votes + '</b></span></div>';
        }).join('')
      + '<div class="ge-acts">'
      + (live
          ? '<button class="ge-btn stop" data-poll="close" data-id="' + p.id + '">Stop poll</button>'
          : '<button class="ge-btn go" data-poll="open" data-id="' + p.id + '">Push live</button>')
      + '<button class="ge-btn del" data-poll="delete" data-id="' + p.id + '">Delete</button>'
      + '<span style="margin-left:auto;font-size:11.5px;color:#5d7189;align-self:center">'
      + p.total + ' vote' + (p.total === 1 ? '' : 's') + '</span>'
      + '</div></div>';
  }

  function qaMarkup(q) {
    return '<div class="ge-item">'
      + '<div class="ge-q" style="margin-bottom:6px">' + esc(q.body)
      + (q.source === 'viewer' ? '<span class="ge-pill viewer">' + esc(q.from || 'VIEWER') + '</span>' : '')
      + (q.pinned ? '<span class="ge-pill live">ON SCREEN</span>' : '')
      + (q.status === 'answered' ? '<span class="ge-pill">ANSWERED</span>' : '')
      + '</div><div class="ge-acts">'
      + (q.status === 'answered'
          ? '<button class="ge-btn" data-qa="queue" data-id="' + q.id + '">Re-queue</button>'
          : '<button class="ge-btn go" data-qa="pin" data-id="' + q.id + '">Put on screen</button>'
            + '<button class="ge-btn" data-qa="answer" data-id="' + q.id + '">Mark answered</button>')
      + '<button class="ge-btn del" data-qa="delete" data-id="' + q.id + '">Delete</button>'
      + '</div></div>';
  }

  function builder() {
    return '<div class="ge-add"><h5>NEW POLL</h5>'
      + '<input class="ge-in" id="ge-question" placeholder="Ask something — e.g. Where does $NVDA close Friday?">'
      + state.draft.map(function (v, i) {
          return '<div class="ge-row"><input class="ge-in" data-choice="' + i + '" value="' + esc(v) + '" '
            + 'placeholder="Answer ' + (i + 1) + '">'
            + (state.draft.length > 2 ? '<button class="ge-x" data-drop="' + i + '">&times;</button>' : '')
            + '</div>';
        }).join('')
      + '<div class="ge-acts">'
      + (state.draft.length < 6 ? '<button class="ge-btn" data-addchoice>+ Answer</button>' : '')
      + '<button class="ge-btn go" data-savepoll>Save poll</button>'
      + '</div><div id="ge-err" style="color:#ff8a9b;font-size:12px;margin-top:7px"></div></div>';
  }

  function markup() {
    var html = '<div class="ge-wrap"><div class="ge-tabs">'
      + '<button data-tab="polls" class="' + (state.tab === 'polls' ? 'on' : '') + '">Polls</button>'
      + '<button data-tab="qa" class="' + (state.tab === 'qa' ? 'on' : '') + '">Q&amp;A</button>'
      + '</div>';

    if (state.tab === 'polls') {
      html += builder();
      html += state.polls.length
        ? state.polls.map(pollMarkup).join('')
        : '<div class="ge-none">No polls yet. Write one above and push it live mid-stream.</div>';
    } else {
      html += '<div class="ge-add"><h5>NEW QUESTION</h5>'
        + '<input class="ge-in" id="ge-qbody" placeholder="Seed a question for the session">'
        + '<div class="ge-acts"><button class="ge-btn go" data-saveqa>Add question</button></div></div>';
      html += state.qa.length
        ? state.qa.map(qaMarkup).join('')
        : '<div class="ge-none">Nothing queued. Add your own, or viewer questions land here during the stream.</div>';
    }

    return html + '</div>';
  }

  function paint() {
    var host = document.getElementById('ge-root');
    if (!host) { return; }
    host.innerHTML = state.open ? markup() : '';
  }

  // Customize Tools opens the builder in place.
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-engage-toggle]')) {
      e.preventDefault();
      state.open = !state.open;
      paint();
    }
  });

  // The Engagement card repaints when its data reloads, so refill on sight.
  window.setInterval(function () {
    var host = document.getElementById('ge-root');
    if (state.open && state.loaded && host && !host.firstChild) { paint(); }
  }, 500);

  function readDraft() {
    var host = document.getElementById('ge-root');
    if (!host) { return; }
    Array.prototype.forEach.call(host.querySelectorAll('[data-choice]'), function (el) {
      state.draft[Number(el.getAttribute('data-choice'))] = el.value;
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#ge-root')) { return; }

    var t = e.target.closest('[data-tab]');
    if (t) { state.tab = t.getAttribute('data-tab'); paint(); return; }

    if (e.target.closest('[data-addchoice]')) {
      readDraft(); state.draft.push(''); paint(); return;
    }
    var drop = e.target.closest('[data-drop]');
    if (drop) {
      readDraft(); state.draft.splice(Number(drop.getAttribute('data-drop')), 1); paint(); return;
    }

    if (e.target.closest('[data-savepoll]')) {
      readDraft();
      var q = (document.getElementById('ge-question') || {}).value || '';
      var err = document.getElementById('ge-err');
      api(cfg.polls, { question: q, choices: state.draft }).then(function (d) {
        if (d && d.ok) { state.draft = ['', '']; load(); }
        else if (err) { err.textContent = (d && d.message) || 'Could not save.'; }
      });
      return;
    }

    if (e.target.closest('[data-saveqa]')) {
      var b = (document.getElementById('ge-qbody') || {}).value || '';
      if (!b.trim()) { return; }
      api(cfg.qa, { body: b }).then(function () { load(); });
      return;
    }

    var pa = e.target.closest('[data-poll]');
    if (pa) {
      if (pa.getAttribute('data-poll') === 'delete'
          && !window.confirm('Delete this poll and its votes?')) { return; }
      api(cfg.base + '/polls/' + pa.getAttribute('data-id') + '/' + pa.getAttribute('data-poll'), {})
        .then(function () { load(); });
      return;
    }

    var qa = e.target.closest('[data-qa]');
    if (qa) {
      api(cfg.base + '/qa/' + qa.getAttribute('data-id') + '/' + qa.getAttribute('data-qa'), {})
        .then(function () { load(); });
    }
  });

  // Live vote counts while a poll is on screen.
  window.setInterval(function () {
    var anyLive = state.polls.some(function (p) { return p.status === 'live'; });
    if (anyLive && document.getElementById('ge-root')) { load(); }
  }, 6000);

  load();
})();
SMLENGJS;
    }
}
