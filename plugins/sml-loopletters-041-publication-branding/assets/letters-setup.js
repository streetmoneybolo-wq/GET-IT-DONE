/**
 * Loop Letters — publication setup & settings
 * StockMarketLoop Creator Studio add-on
 *
 * Two entry points, one state model:
 *
 *   SMLLetterSetup.mountSetup(el)  — renders the onboarding wizard into `el`
 *                                    (used by the /loop-letters/ router when a
 *                                    logged-in user has no publication yet)
 *   SMLLetterSetup.openSettings()  — opens the settings modal
 *                                    (bound to the existing #le-settings button,
 *                                    which currently has no handler at all)
 *
 * Backend: GET / POST  /wp-json/sml-letters/v1/settings
 *
 * IMPORTANT — read-modify-write. The existing /settings payload shape is owned
 * by the plugin, not by this file. Every save re-reads the current object,
 * merges only the keys below into it, and POSTs the whole thing back, so
 * fields this file knows nothing about survive untouched.
 */

/* global window, document, fetch */
(function (w, d) {
    'use strict';

    /* ========================================================
       CONFIG
       `SMLLetters` is localized from PHP (wp_localize_script).
       The fallbacks let this file run in the preview harness.
       ======================================================== */
    var CFG = w.SMLLetters || {};
    var REST  = CFG.rest  || '/wp-json/sml-letters/v1/';
    var NONCE = CFG.nonce || '';
    var SITE  = CFG.site  || 'stockmarketloop.com';
    var BASE  = CFG.base  || '/n/';          // public publication path
    var STUDIO = CFG.studio || '/creator-studio/loop-letters/write/';

    /* ========================================================
       OPTIONS
       ======================================================== */
    var TOPICS = [
        'Earnings', 'Macro', 'Options Flow', 'Small Caps', 'ETFs', 'Crypto',
        'Dividends', 'Technical Analysis', 'IPOs', 'Energy', 'Biotech', 'AI & Semis'
    ];
    var MAX_TOPICS = 5;

    var CADENCE = [
        { v: 'daily',    t: 'Daily',          d: 'High effort, high habit. Best for market recaps.' },
        { v: 'weekly',   t: 'Weekly',         d: 'The sweet spot. Most Loop letters live here.' },
        { v: 'biweekly', t: 'Every 2 weeks',  d: 'Room to go deep without burning out.' },
        { v: 'monthly',  t: 'Monthly',        d: 'Long-form only. Harder to build a habit.' }
    ];

    /* Mirrors the "Visibility options" card already shown on the write page,
       so the wizard teaches the same three words the rest of the UI uses. */
    var VISIBILITY = [
        { v: 'public',    t: 'Public',       d: 'Anyone can read. Surfaces on ticker pages and the Loop feed.' },
        { v: 'members',   t: 'Members only', d: 'Signed-in Loop users only.' },
        { v: 'followers', t: 'Followers',    d: 'Only people who follow you.' }
    ];

    // Public letter pages use one accent, the LoopLetter green, so a reader
    // always knows they are on a reader page. Matches --accent in the site's
    // public stylesheet and the fallback in letter-public.css.
    var PUBLIC_ACCENT = '#00ff88';

    /* Handles the platform needs for its own routes. The server must enforce
       this too — this list is a courtesy so the user finds out before saving. */
    var RESERVED = [
        'admin', 'api', 'app', 'creator-studio', 'dashboard', 'feed', 'go-live',
        'groups', 'help', 'letters', 'login', 'loop', 'loop-letters', 'me',
        'new', 'news', 'settings', 'signup', 'stocks', 'support', 'ticker',
        'upload-video', 'watch', 'wp-admin', 'wp-json'
    ];

    /* ========================================================
       STATE
       ======================================================== */
    var pub = blank();
    var raw = {};            // untouched /settings payload, for read-modify-write
    var step = 0;
    var handleTouched = false;
    var busy = false;
    var mountEl = null;

    function blank() {
        return {
            name: '', handle: '', tagline: '',
            topics: [], cadence: 'weekly', visibility: 'public',
            welcome_subject: '', welcome_body: '',
            onboarded: false
        };
    }

    /* ========================================================
       HELPERS
       ======================================================== */
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function slug(s) {
        return String(s || '').toLowerCase()
            .replace(/['’]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 30);
    }

    function initials(name) {
        var words = String(name || '').trim().split(/\s+/)
            .filter(function (x) { return x && !/^(the|a|an|of|and|for)$/i.test(x); });
        if (!words.length) return 'LL';
        if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
        return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }

    /** Black or white text on a given background, by perceived luminance. */
    function ink(hex) {
        var h = String(hex).replace('#', '');
        if (h.length !== 6) return '#ffffff';
        var r = parseInt(h.slice(0, 2), 16),
            g = parseInt(h.slice(2, 4), 16),
            b = parseInt(h.slice(4, 6), 16);
        return ((r * 299 + g * 587 + b * 114) / 1000) > 150 ? '#0b131f' : '#ffffff';
    }

    function el(id) { return d.getElementById(id); }
    function qs(sel, root) { return (root || d).querySelector(sel); }
    function qsa(sel, root) {
        return Array.prototype.slice.call((root || d).querySelectorAll(sel));
    }

    function toast(msg, bad) {
        var t = el('ls-toast');
        if (!t) {
            t = d.createElement('div');
            t.id = 'ls-toast';
            d.body.appendChild(t);
        }
        t.className = 'ls-toast' + (bad ? ' is-bad' : '');
        t.textContent = msg;
        // force reflow so the transition runs when the node was just created
        void t.offsetWidth;
        t.classList.add('is-visible');
        clearTimeout(t._t);
        t._t = setTimeout(function () { t.classList.remove('is-visible'); }, 2800);
    }

    /* ========================================================
       API
       ======================================================== */
    function api(path, method, body) {
        var opts = {
            method: method || 'GET',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }
        };
        if (NONCE) opts.headers['X-WP-Nonce'] = NONCE;
        if (body) opts.body = JSON.stringify(body);

        return fetch(REST + path, opts).then(function (r) {
            return r.text().then(function (txt) {
                var data = null;
                try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
                if (!r.ok) {
                    var msg = (data && (data.message || data.code)) || ('HTTP ' + r.status);
                    var err = new Error(msg);
                    err.status = r.status;
                    throw err;
                }
                return data;
            });
        });
    }

    /**
     * Normalize whatever /settings returns into our shape.
     * Tolerates the fields living either at the top level or nested under
     * `publication`, since the server contract isn't ours to assume.
     */
    function readSettings() {
        return api('settings').then(function (data) {
            raw = (data && typeof data === 'object') ? data : {};
            var src = raw.publication && typeof raw.publication === 'object' ? raw.publication : raw;
            var p = blank();

            p.name       = src.name || src.title || '';
            p.handle     = src.handle || src.slug || '';
            p.tagline    = src.tagline || src.description || '';
            p.cadence    = src.cadence || 'weekly';
            p.visibility = src.visibility || src.default_visibility || 'public';
            p.topics     = Array.isArray(src.topics) ? src.topics.slice(0, MAX_TOPICS) : [];

            var wel = src.welcome || src.welcome_email || {};
            p.welcome_subject = src.welcome_subject || wel.subject || '';
            p.welcome_body    = src.welcome_body    || wel.body    || '';

            // "Set up" means there is something to route to: a name and a handle.
            p.onboarded = !!(src.onboarded || (p.name && p.handle));
            return p;
        });
    }

    function writeSettings(p) {
        // Re-read first so a save never clobbers a field another screen changed.
        return api('settings').then(function (current) {
            var merged = (current && typeof current === 'object')
                ? JSON.parse(JSON.stringify(current))
                : {};

            var patch = {
                name: p.name,
                handle: p.handle,
                tagline: p.tagline,
                topics: p.topics,
                cadence: p.cadence,
                visibility: p.visibility,
                welcome_subject: p.welcome_subject,
                welcome_body: p.welcome_body,
                onboarded: true
            };

            // Write into `publication` if the server already uses that shape,
            // otherwise flat. Either way, unknown sibling keys are preserved.
            if (merged.publication && typeof merged.publication === 'object') {
                Object.keys(patch).forEach(function (k) { merged.publication[k] = patch[k]; });
            } else {
                Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
            }
            return api('settings', 'POST', merged);
        });
    }

    /**
     * Handle availability.
     * Uses an optional endpoint if the server grows one; otherwise falls back
     * to the reserved list and lets the POST be the real arbiter.
     */
    function checkHandle(h) {
        if (!h) return Promise.resolve({ ok: false, msg: '' });
        if (h.length < 3) return Promise.resolve({ ok: false, msg: 'Too short — 3 characters minimum.' });
        if (RESERVED.indexOf(h) !== -1) {
            return Promise.resolve({ ok: false, msg: '/n/' + h + ' is reserved. Try another.' });
        }
        return api('handle-available?handle=' + encodeURIComponent(h))
            .then(function (r) {
                if (r && typeof r.available === 'boolean') {
                    return r.available
                        ? { ok: true, msg: BASE + h + ' is available' }
                        : { ok: false, msg: BASE + h + ' is taken. Try another.' };
                }
                return { ok: true, msg: BASE + h };
            })
            .catch(function () {
                // Endpoint not implemented yet — don't block the user on it.
                return { ok: true, msg: BASE + h };
            });
    }

    /* ========================================================
       WELCOME EMAIL DRAFT
       ======================================================== */
    function draftWelcome(p) {
        var when = p.cadence === 'daily' ? 'every weekday morning'
                 : p.cadence === 'weekly' ? 'once a week'
                 : p.cadence === 'biweekly' ? 'every other week'
                 : 'once a month';

        var topics = p.topics.length
            ? p.topics.slice(0, 3).join(', ').replace(/, ([^,]*)$/, ' and $1').toLowerCase()
            : 'the market';

        var sign = (p.name || 'Your host').replace(/^The\s+/i, '');

        return {
            subject: 'Welcome to ' + (p.name || 'my letter'),
            body:
                'Thanks for subscribing to ' + (p.name || 'my letter') + '.\n\n' +
                'Here\'s what you signed up for: one letter ' + when + ', covering ' + topics + '. ' +
                'No spam, no affiliate junk, no "secret watchlist" upsell.\n\n' +
                'Two quick things:\n\n' +
                '1. Move this email out of Promotions so the next one actually reaches you.\n' +
                '2. Hit reply and tell me what you\'re trading right now — I read every one, ' +
                'and it shapes what I write about.\n\n' +
                'First letter lands soon.\n\n' +
                '— ' + sign + '\n\n' +
                'P.S. Nothing here is financial advice. I\'m sharing how I think, not what you should do.'
        };
    }

    /* ========================================================
       SHARED FIELD RENDERERS
       ======================================================== */
    function fieldIdentity() {
        return '' +
        '<div class="ls-field">' +
            '<label class="ls-label" for="ls-name">Publication name</label>' +
            '<input class="ls-input" id="ls-name" type="text" maxlength="60" ' +
                   'placeholder="The Market Loop" value="' + esc(pub.name) + '">' +
            '<div class="ls-hint">Short beats clever. Two to four words works best.</div>' +
        '</div>' +
        '<div class="ls-field">' +
            '<label class="ls-label" for="ls-handle">Address on Loop</label>' +
            '<div class="ls-handle">' +
                '<span class="ls-handle-prefix">' + esc(SITE + BASE) + '</span>' +
                '<input id="ls-handle" type="text" maxlength="30" spellcheck="false" ' +
                       'autocapitalize="off" autocomplete="off" ' +
                       'placeholder="the-market-loop" value="' + esc(pub.handle) + '">' +
            '</div>' +
            '<div class="ls-avail" id="ls-avail"></div>' +
        '</div>' +
        '<div class="ls-field">' +
            '<label class="ls-label" for="ls-tagline">One-line pitch</label>' +
            '<textarea class="ls-textarea" id="ls-tagline" maxlength="180" ' +
                      'placeholder="Weekly breakdowns of what actually moved the tape.">' +
                      esc(pub.tagline) + '</textarea>' +
            '<div class="ls-hint"><b id="ls-tag-count">' + pub.tagline.length + '</b>/180 — ' +
                 'the single biggest driver of signups. Say who it\'s for.</div>' +
        '</div>';
    }

    function fieldTopics() {
        return '' +
        '<div class="ls-field">' +
            '<label class="ls-label">Topics <span style="color:#46586e">(up to ' + MAX_TOPICS + ')</span></label>' +
            '<div class="ls-pills" id="ls-topics">' +
                TOPICS.map(function (t) {
                    var on = pub.topics.indexOf(t) !== -1;
                    return '<button type="button" class="ls-pill' + (on ? ' is-active' : '') +
                           '" data-topic="' + esc(t) + '">' + esc(t) + '</button>';
                }).join('') +
            '</div>' +
            '<div class="ls-hint">Topics feed the Loop discovery page — this is how readers ' +
                 'who don\'t follow you yet find your letters.</div>' +
        '</div>';
    }

    function fieldCadence() {
        return '' +
        '<div class="ls-field">' +
            '<label class="ls-label">How often will you send?</label>' +
            '<div class="ls-choices" id="ls-cadence">' +
                CADENCE.map(function (c) {
                    return '<button type="button" class="ls-choice' +
                           (pub.cadence === c.v ? ' is-active' : '') + '" data-cadence="' + c.v + '">' +
                           '<b>' + esc(c.t) + '</b><span>' + esc(c.d) + '</span></button>';
                }).join('') +
            '</div>' +
        '</div>';
    }

    function fieldVisibility() {
        return '' +
        '<div class="ls-field">' +
            '<label class="ls-label">Default visibility</label>' +
            '<div id="ls-visibility">' +
                VISIBILITY.map(function (v) {
                    return '<div class="ls-radio-row' + (pub.visibility === v.v ? ' is-active' : '') +
                           '" data-vis="' + v.v + '" role="radio" tabindex="0" ' +
                           'aria-checked="' + (pub.visibility === v.v) + '">' +
                           '<span class="ls-radio-mark"></span>' +
                           '<span><b>' + esc(v.t) + '</b><span>' + esc(v.d) + '</span></span></div>';
                }).join('') +
            '</div>' +
            '<div class="ls-hint">You can override this on any individual letter.</div>' +
        '</div>';
    }

    function fieldWelcome() {
        return '' +
        '<div class="ls-field">' +
            '<label class="ls-label" for="ls-wsub">Welcome subject</label>' +
            '<input class="ls-input" id="ls-wsub" type="text" maxlength="90" value="' +
                   esc(pub.welcome_subject) + '">' +
        '</div>' +
        '<div class="ls-field">' +
            '<label class="ls-label" for="ls-wbody">Welcome message</label>' +
            '<textarea class="ls-textarea" id="ls-wbody" style="min-height:230px">' +
                  esc(pub.welcome_body) + '</textarea>' +
            '<div class="ls-hint">Sent the moment someone subscribes. Telling them exactly what ' +
                 'lands and when is the cheapest way to cut unsubscribes.</div>' +
        '</div>';
    }

    /* ========================================================
       LIVE PREVIEW
       ======================================================== */
    function previewHtml() {
        return '' +
        '<div class="ls-frame" id="ls-frame">' +
            '<div class="ls-frame-bar"><i></i><i></i><i></i>' +
                '<span class="ls-frame-url" id="ls-pv-url"></span></div>' +
            '<div class="ls-frame-body">' +
                '<div class="ls-pv-avatar" id="ls-pv-av">LL</div>' +
                '<h3 class="ls-pv-name" id="ls-pv-name"></h3>' +
                '<p class="ls-pv-tag" id="ls-pv-tag"></p>' +
                '<div class="ls-pv-signup">' +
                    '<div class="ls-pv-input">your@email.com</div>' +
                    '<div class="ls-pv-btn" id="ls-pv-btn">Subscribe</div>' +
                '</div>' +
                '<p class="ls-pv-note" id="ls-pv-note"></p>' +
                '<div class="ls-pv-rule"></div>' +
                '<div class="ls-pv-posts">' +
                    '<div class="ls-pv-post"><b>Your first letter lands here</b>' +
                        '<span>Draft &middot; <span class="ls-tick">$NVDA</span></span></div>' +
                    '<div class="ls-pv-post"><b>And the one after that</b>' +
                        '<span>Coming soon</span></div>' +
                '</div>' +
                '<div class="ls-pv-chips" id="ls-pv-chips"></div>' +
            '</div>' +
        '</div>';
    }

    function paintPreview() {
        var f = el('ls-frame');
        if (!f) return;

        var accentInk = ink(PUBLIC_ACCENT);
        var av = el('ls-pv-av');
        var btn = el('ls-pv-btn');
        if (av)  { av.style.background = PUBLIC_ACCENT; av.style.color = accentInk;
                   av.textContent = initials(pub.name || 'Loop Letter'); }
        if (btn) { btn.style.background = PUBLIC_ACCENT; btn.style.color = accentInk; }

        var setTxt = function (id, v) { var n = el(id); if (n) n.textContent = v; };
        setTxt('ls-pv-url',  SITE + BASE + (pub.handle || 'your-handle'));
        setTxt('ls-pv-name', pub.name || 'Your Letter');
        setTxt('ls-pv-tag',  pub.tagline || 'Your one-line pitch shows up here.');

        var cad = CADENCE.filter(function (c) { return c.v === pub.cadence; })[0];
        setTxt('ls-pv-note', 'Free. ' + (cad ? cad.t : 'Weekly') + '. Unsubscribe any time.');

        var chips = el('ls-pv-chips');
        if (chips) {
            chips.innerHTML = pub.topics.map(function (t) {
                return '<span class="ls-pv-chip">' + esc(t) + '</span>';
            }).join('');
        }
    }

    /* ========================================================
       SHARED BINDINGS
       ======================================================== */
    var availTimer = null;
    /* The availability check is async, so it finishes after the keystroke that
       triggered it. It has to re-run validation itself or the Continue button
       keeps whatever state it had before the answer came back. */
    var notifyChange = function () {};

    function bindCommon(root, onChange) {
        onChange = onChange || function () {};
        notifyChange = onChange;

        var name = qs('#ls-name', root);
        if (name) {
            name.addEventListener('input', function () {
                pub.name = name.value;
                var h = qs('#ls-handle', root);
                if (h && !handleTouched) {
                    pub.handle = slug(pub.name);
                    h.value = pub.handle;
                    runHandleCheck(root);
                }
                paintPreview(); onChange();
            });
        }

        var handle = qs('#ls-handle', root);
        if (handle) {
            handle.addEventListener('input', function () {
                handleTouched = true;
                pub.handle = slug(handle.value);
                handle.value = pub.handle;
                runHandleCheck(root);
                paintPreview(); onChange();
            });
        }

        var tag = qs('#ls-tagline', root);
        if (tag) {
            tag.addEventListener('input', function () {
                pub.tagline = tag.value;
                var c = qs('#ls-tag-count', root);
                if (c) c.textContent = tag.value.length;
                paintPreview(); onChange();
            });
        }

        var topics = qs('#ls-topics', root);
        if (topics) {
            topics.addEventListener('click', function (e) {
                var b = e.target.closest('[data-topic]');
                if (!b) return;
                var t = b.getAttribute('data-topic');
                var i = pub.topics.indexOf(t);
                if (i !== -1) { pub.topics.splice(i, 1); b.classList.remove('is-active'); }
                else {
                    if (pub.topics.length >= MAX_TOPICS) { toast('Up to ' + MAX_TOPICS + ' topics', true); return; }
                    pub.topics.push(t); b.classList.add('is-active');
                }
                qsa('[data-topic]', topics).forEach(function (p) {
                    var on = p.classList.contains('is-active');
                    p.disabled = !on && pub.topics.length >= MAX_TOPICS;
                });
                paintPreview(); onChange();
            });
        }

        var cad = qs('#ls-cadence', root);
        if (cad) {
            cad.addEventListener('click', function (e) {
                var b = e.target.closest('[data-cadence]');
                if (!b) return;
                pub.cadence = b.getAttribute('data-cadence');
                qsa('.ls-choice', cad).forEach(function (x) { x.classList.remove('is-active'); });
                b.classList.add('is-active');
                paintPreview(); onChange();
            });
        }

        var vis = qs('#ls-visibility', root);
        if (vis) {
            var pick = function (row) {
                pub.visibility = row.getAttribute('data-vis');
                qsa('.ls-radio-row', vis).forEach(function (x) {
                    var on = x === row;
                    x.classList.toggle('is-active', on);
                    x.setAttribute('aria-checked', on);
                });
                onChange();
            };
            vis.addEventListener('click', function (e) {
                var row = e.target.closest('[data-vis]');
                if (row) pick(row);
            });
            vis.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                var row = e.target.closest('[data-vis]');
                if (row) { e.preventDefault(); pick(row); }
            });
        }

        var wsub = qs('#ls-wsub', root);
        if (wsub) wsub.addEventListener('input', function () { pub.welcome_subject = wsub.value; onChange(); });

        var wbody = qs('#ls-wbody', root);
        if (wbody) wbody.addEventListener('input', function () { pub.welcome_body = wbody.value; onChange(); });
    }

    function runHandleCheck(root) {
        var out = qs('#ls-avail', root);
        if (!out) return;
        clearTimeout(availTimer);

        if (!pub.handle) {
            out.className = 'ls-avail';
            out.textContent = '';
            out.removeAttribute('data-ok');
            notifyChange();
            return;
        }

        // Treat "answer pending" as not-yet-valid so Continue can't be clicked
        // during the debounce window and skip the check entirely.
        out.className = 'ls-avail is-busy';
        out.textContent = 'Checking…';
        out.setAttribute('data-ok', 'pending');
        notifyChange();

        availTimer = setTimeout(function () {
            var asked = pub.handle;
            checkHandle(asked).then(function (r) {
                if (asked !== pub.handle) return;   // a newer keystroke won
                out.className = 'ls-avail ' + (r.ok ? 'is-ok' : 'is-bad');
                out.textContent = (r.ok && r.msg ? '✓ ' : '') + r.msg;
                out.setAttribute('data-ok', r.ok ? '1' : '0');
                notifyChange();
            });
        }, 320);
    }

    function identityValid(root) {
        var out = qs('#ls-avail', root);
        // Only a confirmed '1' passes. 'pending' and '0' both block, so a user
        // can't tab past a handle whose check hasn't answered yet.
        var handleOk = !out || out.getAttribute('data-ok') === '1';
        return pub.name.trim().length >= 2
            && pub.handle.length >= 3
            && handleOk
            && pub.tagline.trim().length >= 10;
    }

    /* ========================================================
       ONBOARDING WIZARD
       ======================================================== */
    var STEPS = ['Identity', 'Focus', 'Welcome'];
    var scrolledOnce = false;

    function railHtml() {
        return STEPS.map(function (name, i) {
            var cls = i < step ? 'is-done' : (i === step ? 'is-active' : '');
            var mark = i < step ? '✓' : (i + 1);
            var line = i < STEPS.length - 1
                ? '<div class="ls-rail-line' + (i < step ? ' is-done' : '') + '"></div>' : '';
            return '<div class="ls-step ' + cls + '"><div class="ls-dot">' + mark + '</div>' +
                   '<div class="ls-step-name">' + name + '</div></div>' + line;
        }).join('');
    }

    function setupHtml() {
        return '' +
        '<div class="ls-setup ls-scope">' +
          '<div class="ls-setup-main">' +
            '<div class="ls-rail" id="ls-rail"></div>' +
            '<div class="cs-card">' +
              '<div class="ls-screen is-active" data-s="0">' +
                '<h2>Name your letter</h2>' +
                '<p class="cs-sub">This is what readers see at the top of your page and in their inbox. Change it any time.</p>' +
                fieldIdentity() +
              '</div>' +
              '<div class="ls-screen" data-s="1">' +
                '<h2>What do you cover?</h2>' +
                '<p class="cs-sub">Topics and cadence decide where your letters surface and what readers expect.</p>' +
                fieldTopics() + fieldCadence() + fieldVisibility() +
              '</div>' +
              '<div class="ls-screen" data-s="2">' +
                '<h2>Your welcome email</h2>' +
                '<p class="cs-sub">Sent automatically when someone subscribes. We drafted one from your answers — edit it or keep it.</p>' +
                fieldWelcome() +
              '</div>' +
              '<div id="ls-err-slot"></div>' +
              '<div class="ls-nav">' +
                '<button type="button" class="cs-btn" id="ls-back">Back</button>' +
                '<div class="ls-nav-spacer"></div>' +
                '<button type="button" class="cs-btn cs-btn-primary" id="ls-next">Continue</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="ls-side">' +
            previewHtml() +
            '<div class="le-card"><h3>Why this matters</h3>' +
              '<p class="cs-hint">Your handle is permanent-ish — letters you publish link to it. ' +
              'Everything else here is editable later from Newsletter settings.</p></div>' +
          '</div>' +
        '</div>';
    }

    function showStep(n) {
        step = n;
        qsa('.ls-screen', mountEl).forEach(function (s) { s.classList.remove('is-active'); });
        var target = qs('.ls-screen[data-s="' + n + '"]', mountEl);
        if (target) target.classList.add('is-active');
        var rail = qs('#ls-rail', mountEl);
        if (rail) rail.innerHTML = railHtml();
        syncNav();

        // Don't scroll on first paint, and scroll the window rather than the
        // node — scrollIntoView parks the step rail under the sticky .cs-top.
        if (scrolledOnce && w.scrollTo) {
            w.scrollTo({ top: 0, behavior: 'smooth' });
        }
        scrolledOnce = true;
    }

    function syncNav() {
        var back = qs('#ls-back', mountEl);
        var next = qs('#ls-next', mountEl);
        if (back) back.style.visibility = step === 0 ? 'hidden' : 'visible';
        if (!next) return;
        next.textContent = step === STEPS.length - 1 ? 'Create my letter' : 'Continue';
        var ok = true;
        if (step === 0) ok = identityValid(mountEl);
        if (step === 1) ok = pub.topics.length >= 1;
        if (step === 3) ok = !!(pub.welcome_subject.trim() && pub.welcome_body.trim());
        next.disabled = busy || !ok;
    }

    function mountSetup(target) {
        mountEl = typeof target === 'string' ? el(target) : target;
        if (!mountEl) return;

        mountEl.innerHTML = '<div class="ls-setup ls-scope"><div class="ls-setup-main">' +
            '<div class="cs-card"><div class="ls-skel"></div><div class="ls-skel"></div>' +
            '<div class="ls-skel"></div></div></div></div>';

        var wantsEdit = /[?&]edit=1/.test(w.location.search);

        readSettings().then(function (p) {
            pub = p;
            handleTouched = !!p.handle;

            // Already set up: don't show onboarding again. The PHP shortcode
            // guards this too, but a stale cached page could still reach here.
            if (p.onboarded && !wantsEdit) {
                mountEl.innerHTML = '';
                d.dispatchEvent(new CustomEvent('sml:letters:already-onboarded', { detail: p }));
                return;
            }
            render();
        }).catch(function (e) {
            // A fresh account with no settings row yet is not an error.
            if (e.status === 404) { pub = blank(); render(); return; }
            mountEl.innerHTML = '<div class="ls-setup ls-scope"><div class="ls-setup-main">' +
                '<div class="cs-card"><h2>Couldn\'t load your settings</h2>' +
                '<div class="ls-err">' + esc(e.message) + '</div></div></div></div>';
        });

        function render() {
            mountEl.innerHTML = setupHtml();
            step = 0;
            showStep(0);
            paintPreview();
            bindCommon(mountEl, syncNav);

            qs('#ls-back', mountEl).addEventListener('click', function () {
                if (step > 0) showStep(step - 1);
            });

            qs('#ls-next', mountEl).addEventListener('click', function () {
                if (step === 1 && !pub.welcome_subject) {
                    // Draft from the answers the moment we have topics + cadence.
                    var w = draftWelcome(pub);
                    pub.welcome_subject = w.subject;
                    pub.welcome_body = w.body;
                    var s = qs('#ls-wsub', mountEl), b = qs('#ls-wbody', mountEl);
                    if (s) s.value = w.subject;
                    if (b) b.value = w.body;
                }
                if (step < STEPS.length - 1) { showStep(step + 1); return; }
                finish();
            });
        }

        function finish() {
            if (busy) return;
            busy = true; syncNav();
            var next = qs('#ls-next', mountEl);
            if (next) next.textContent = 'Creating…';

            writeSettings(pub).then(function () {
                toast('Your letter is set up');
                w.location.href = STUDIO;
            }).catch(function (e) {
                busy = false;
                if (next) next.textContent = 'Create my letter';
                syncNav();
                var slot = qs('#ls-err-slot', mountEl);
                if (slot) slot.innerHTML = '<div class="ls-err">Couldn\'t save: ' + esc(e.message) +
                    '</div>';
                toast('Save failed', true);
            });
        }
    }

    /* ========================================================
       SETTINGS MODAL
       ======================================================== */
    function settingsHtml() {
        return '' +
        '<div class="ls-modal-bg ls-scope" id="ls-modal-bg">' +
          '<div class="ls-modal" role="dialog" aria-modal="true" aria-labelledby="ls-modal-h">' +
            '<div class="ls-modal-head">' +
              '<div><h2 id="ls-modal-h">Newsletter settings</h2>' +
              '<p>Your publication identity, topics, and welcome email.</p></div>' +
              '<button type="button" class="ls-x" id="ls-modal-x" aria-label="Close">&times;</button>' +
            '</div>' +
            '<div class="ls-modal-body" id="ls-modal-body"></div>' +
            '<div class="ls-modal-foot">' +
              '<a class="cs-btn" id="ls-view" href="#" target="_blank" rel="noopener">View public page</a>' +
              '<div class="ls-nav-spacer"></div>' +
              '<button type="button" class="cs-btn" id="ls-cancel">Cancel</button>' +
              '<button type="button" class="cs-btn cs-btn-primary" id="ls-save">Save changes</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    function settingsBody() {
        return '' +
        '<div class="ls-sec"><h3 class="ls-sec-title">Identity</h3>' + fieldIdentity() + '</div>' +
        '<div class="ls-sec"><h3 class="ls-sec-title">Focus</h3>' + fieldTopics() + fieldCadence() + '</div>' +
        '<div class="ls-sec"><h3 class="ls-sec-title">Distribution</h3>' + fieldVisibility() + '</div>' +
        '<div class="ls-sec"><h3 class="ls-sec-title">Appearance</h3>' + fieldAccent() + '</div>' +
        '<div class="ls-sec"><h3 class="ls-sec-title">Welcome email</h3>' + fieldWelcome() + '</div>' +
        '<div id="ls-err-slot"></div>';
    }

    var modalBound = false;

    function openSettings() {
        var bg = el('ls-modal-bg');
        if (!bg) {
            var host = d.createElement('div');
            host.innerHTML = settingsHtml();
            d.body.appendChild(host.firstChild);
            bg = el('ls-modal-bg');
        }

        var body = el('ls-modal-body');
        body.innerHTML = '<div class="ls-skel"></div><div class="ls-skel"></div><div class="ls-skel"></div>';
        bg.classList.add('is-open');

        if (!modalBound) {
            modalBound = true;
            el('ls-modal-x').addEventListener('click', closeSettings);
            el('ls-cancel').addEventListener('click', closeSettings);
            bg.addEventListener('click', function (e) { if (e.target === bg) closeSettings(); });
            d.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && bg.classList.contains('is-open')) closeSettings();
            });
            el('ls-save').addEventListener('click', saveSettings);
        }

        readSettings().then(function (p) {
            pub = p;
            handleTouched = true;          // never auto-rewrite an existing handle
            body.innerHTML = settingsBody();
            bindCommon(body, function () {});
            runHandleCheck(body);
            var view = el('ls-view');
            if (view) {
                view.href = BASE + (pub.handle || '');
                view.style.display = pub.handle ? '' : 'none';
            }
        }).catch(function (e) {
            body.innerHTML = '<div class="ls-err">Couldn\'t load settings: ' + esc(e.message) + '</div>';
        });
    }

    function closeSettings() {
        var bg = el('ls-modal-bg');
        if (bg) bg.classList.remove('is-open');
    }

    function saveSettings() {
        if (busy) return;
        var btn = el('ls-save');
        var body = el('ls-modal-body');

        if (!identityValid(body)) {
            var slot = qs('#ls-err-slot', body);
            if (slot) slot.innerHTML = '<div class="ls-err">Add a name, a valid handle, ' +
                'and a pitch of at least 10 characters before saving.</div>';
            return;
        }

        busy = true;
        btn.disabled = true;
        btn.textContent = 'Saving…';

        writeSettings(pub).then(function () {
            busy = false;
            btn.disabled = false;
            btn.textContent = 'Save changes';
            toast('Settings saved');
            closeSettings();
            // Let the host page refresh anything that shows the publication name.
            d.dispatchEvent(new CustomEvent('sml:letters:settings-saved', { detail: pub }));
        }).catch(function (e) {
            busy = false;
            btn.disabled = false;
            btn.textContent = 'Save changes';
            var slot = qs('#ls-err-slot', body);
            if (slot) slot.innerHTML = '<div class="ls-err">Couldn\'t save: ' + esc(e.message) + '</div>';
            toast('Save failed', true);
        });
    }

    /* ========================================================
       BOOT
       Binds the existing #le-settings button, which currently
       has no click handler on the live site.
       ======================================================== */
    function boot() {
        var btn = el('le-settings');
        if (btn && !btn._lsBound) {
            btn._lsBound = true;
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                openSettings();
            });
        }

        var auto = el('ls-setup-root');
        if (auto) mountSetup(auto);
    }

    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
    else boot();

    /* Re-bind if the Studio re-renders its toolbar after a route change. */
    if (w.MutationObserver) {
        var mo = new MutationObserver(function () {
            var b = el('le-settings');
            if (b && !b._lsBound) boot();
        });
        mo.observe(d.documentElement, { childList: true, subtree: true });
    }

    /* ========================================================
       PUBLIC API
       ======================================================== */
    w.SMLLetterSetup = {
        mountSetup: mountSetup,
        openSettings: openSettings,
        closeSettings: closeSettings,
        readSettings: readSettings,
        writeSettings: writeSettings,
        draftWelcome: draftWelcome,
        getPublication: function () { return JSON.parse(JSON.stringify(pub)); },
        _internals: { slug: slug, ink: ink, initials: initials, RESERVED: RESERVED }
    };

})(window, document);
