(function () {
  'use strict';

  var C = window.SMLRetailSpotlight || {};
  var root = null;
  var groupId = '';
  var payload = null;
  var observer = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function api(path, options) {
    options = options || {};
    options.credentials = 'same-origin';
    options.headers = Object.assign({ 'X-WP-Nonce': C.nonce }, options.headers || {});
    if (options.body && !options.headers['Content-Type']) options.headers['Content-Type'] = 'application/json';
    return fetch(C.api + path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (json) {
        if (!response.ok) throw new Error(json.message || 'The Spotlight request failed.');
        return json;
      });
    });
  }

  function findRoot() {
    root = document.getElementById('sml-group-root') || document.getElementById('sml-group-shell');
    if (!root) return false;
    var idNode = root.matches('[data-group-id]') ? root : root.querySelector('[data-group-id]');
    groupId = String((idNode && idNode.dataset.groupId) || root.dataset.groupId || '').replace(/\D/g, '');
    return !!groupId;
  }

  function closeModal() {
    var old = document.querySelector('.sml-rts-modal');
    if (old) old.remove();
  }

  function statusLabel(status) {
    return ({ active: 'Active', paused: 'Paused', inactive: 'Ready to subscribe', not_configured: 'Not configured' })[status] || status;
  }

  function userRow(user) {
    user = user || {};
    return '<div class="sml-rts-user-row">' +
      '<input data-rts-user-id inputmode="numeric" maxlength="24" placeholder="Discord User ID" value="' + esc(user.id) + '">' +
      '<input data-rts-user-name maxlength="80" placeholder="Display name" value="' + esc(user.display_name) + '">' +
      '<button type="button" data-rts-remove-user aria-label="Remove monitored user">Remove</button>' +
      '</div>';
  }

  function channelControl(data) {
    var current = data.config && data.config.channel_id ? String(data.config.channel_id) : '';
    var channels = data.catalog && Array.isArray(data.catalog.channels) ? data.catalog.channels : [];
    if (!channels.length) {
      return '<label class="sml-rts-field"><span>Discord channel ID</span><input data-rts-channel inputmode="numeric" maxlength="24" placeholder="Run /sync-sml-channels in Discord, or paste the channel ID" value="' + esc(current) + '"></label>';
    }
    return '<label class="sml-rts-field"><span>Alert channel</span><select data-rts-channel>' +
      '<option value="">Choose a Discord channel</option>' + channels.map(function (channel) {
        return '<option value="' + esc(channel.id) + '" ' + (String(channel.id) === current ? 'selected' : '') + '># ' + esc(channel.name) + '</option>';
      }).join('') + '</select></label>';
  }

  function bindUserRows(modal) {
    var host = modal.querySelector('[data-rts-users]');
    host.querySelectorAll('[data-rts-remove-user]').forEach(function (button) {
      button.onclick = function () {
        var rows = host.querySelectorAll('.sml-rts-user-row');
        if (rows.length > 1) button.closest('.sml-rts-user-row').remove();
        else {
          button.closest('.sml-rts-user-row').querySelectorAll('input').forEach(function (input) { input.value = ''; });
        }
      };
    });
  }

  function collectUsers(modal) {
    var users = [];
    modal.querySelectorAll('.sml-rts-user-row').forEach(function (row) {
      var id = row.querySelector('[data-rts-user-id]').value.replace(/\D/g, '');
      var name = row.querySelector('[data-rts-user-name]').value.trim();
      if (id) users.push({ id: id, display_name: name });
    });
    return users;
  }

  function setMessage(modal, text, error) {
    var node = modal.querySelector('[data-rts-message]');
    node.className = error ? 'sml-rts-message is-error' : 'sml-rts-message is-success';
    node.textContent = text;
  }

  function diagnosticResult(modal, result) {
    var labels = {
      eligible_members: 'Group has at least 1,000 members',
      discord_connected: 'Discord server is connected',
      configuration_saved: 'Channel and monitored traders are saved',
      subscription_active: '2,000 Loop Bucks subscription is active',
      discord_bridge_ready: 'Discord polling bridge is available',
      polling_scheduled: 'One-minute polling job is scheduled',
      author_ready: 'Retail Trader Spotlight author is ready',
      test_alert_valid: 'Test alert payload is valid',
      ticker_cooldown_clear: 'Ticker is outside the 30-minute duplicate window'
    };
    var html = '<div class="sml-rts-diagnostic ' + (result.passed ? 'is-passed' : 'is-blocked') + '"><strong>' + (result.passed ? 'All checks passed' : 'Action needed') + '</strong>';
    Object.keys(labels).forEach(function (key) {
      html += '<div><span>' + (result.checks[key] ? '✓' : '×') + '</span> ' + esc(labels[key]) + '</div>';
    });
    html += '<p>' + esc(result.message) + '</p></div>';
    modal.querySelector('[data-rts-diagnostic-result]').innerHTML = html;
  }

  function openPanel() {
    closeModal();
    var users = payload.config && Array.isArray(payload.config.monitored_users) ? payload.config.monitored_users : [];
    if (!users.length) users = [{}];
    var connected = payload.connector_state === 'active';
    var eligible = !!payload.eligible;
    var configured = !!payload.configured;
    var active = payload.status === 'active';
    var wallet = payload.wallet_balance == null ? 'Unavailable' : Number(payload.wallet_balance).toLocaleString() + ' Loop Bucks';
    var modal = document.createElement('div');
    modal.className = 'sml-rts-modal';
    modal.innerHTML = '<section class="sml-rts-panel" role="dialog" aria-modal="true" aria-labelledby="sml-rts-title">' +
      '<button class="sml-rts-close" type="button" aria-label="Close Spotlight settings">×</button>' +
      '<header class="sml-rts-header"><img src="' + esc(C.avatar) + '" alt=""><div><span>GROUP CREATOR TOOL</span><h2 id="sml-rts-title">Retail Trader Spotlight</h2><p>Monitor selected Discord traders and turn verified alerts into timestamped StockMarketLoop coverage.</p></div></header>' +
      '<div class="sml-rts-stats"><div><small>Members</small><strong>' + Number(payload.member_count || 0).toLocaleString() + ' / 1,000</strong></div><div><small>Subscription</small><strong>' + esc(statusLabel(payload.status)) + '</strong></div><div><small>Wallet</small><strong>' + esc(wallet) + '</strong></div></div>' +
      (!eligible ? '<div class="sml-rts-callout is-warning">This tool unlocks at 1,000 group members. The regular price is 4,000 Loop Bucks; qualified groups pay 2,000 per month.</div>' : '') +
      (!connected ? '<div class="sml-rts-callout is-warning">Connect and verify this group’s Discord server through <strong>Discord Access</strong> before saving Spotlight settings.</div>' : '') +
      '<section class="sml-rts-section"><h3>1. Choose the source</h3>' + channelControl(payload) +
      '<div class="sml-rts-field"><span>Monitored traders <small>(1–25)</small></span><div data-rts-users>' + users.map(userRow).join('') + '</div><button class="sml-rts-secondary" type="button" data-rts-add-user>Add trader</button></div>' +
      '<button class="sml-rts-primary" type="button" data-rts-save ' + (!connected ? 'disabled' : '') + '>Save Spotlight configuration</button></section>' +
      '<section class="sml-rts-section"><h3>2. Activate monthly coverage</h3><p><del>4,000 Loop Bucks/month</del> <strong>2,000 Loop Bucks/month</strong> for groups with 1,000+ members.</p>' +
      '<button class="sml-rts-primary" type="button" data-rts-subscribe ' + (!eligible || !configured || active ? 'disabled' : '') + '>' + (active ? 'Subscription active through ' + esc(payload.paid_through || '') : 'Activate for 2,000 Loop Bucks') + '</button></section>' +
      '<section class="sml-rts-section"><h3>3. Run a safe system test</h3><p>This validates every live dependency without publishing an article or spending Loop Bucks.</p><div class="sml-rts-test-grid"><input data-rts-test-ticker maxlength="10" placeholder="$NVDA"><input data-rts-test-text maxlength="4000" placeholder="Example: $NVDA breakout alert above resistance"></div><button class="sml-rts-secondary" type="button" data-rts-test>Run complete test</button><div data-rts-diagnostic-result></div></section>' +
      '<div class="sml-rts-message" data-rts-message aria-live="polite"></div>' +
      '</section>';
    document.body.appendChild(modal);
    modal.querySelector('.sml-rts-close').onclick = closeModal;
    modal.onclick = function (event) { if (event.target === modal) closeModal(); };
    bindUserRows(modal);
    modal.querySelector('[data-rts-add-user]').onclick = function () {
      var host = modal.querySelector('[data-rts-users]');
      if (host.querySelectorAll('.sml-rts-user-row').length >= 25) return setMessage(modal, 'Use no more than 25 monitored traders.', true);
      host.insertAdjacentHTML('beforeend', userRow({}));
      bindUserRows(modal);
    };
    modal.querySelector('[data-rts-save]').onclick = function () {
      var button = this;
      var channel = modal.querySelector('[data-rts-channel]').value.replace(/\D/g, '');
      var monitored = collectUsers(modal);
      button.disabled = true;
      setMessage(modal, 'Saving…', false);
      api('group/' + groupId + '/config', { method: 'POST', body: JSON.stringify({ channel_id: channel, monitored_users: monitored }) }).then(function () {
        return load(true);
      }).then(function () {
        setMessage(modal, 'Configuration saved. Reopen Spotlight to review the updated subscription state.', false);
        setTimeout(closeModal, 1200);
      }).catch(function (error) {
        button.disabled = false;
        setMessage(modal, error.message, true);
      });
    };
    modal.querySelector('[data-rts-subscribe]').onclick = function () {
      var button = this;
      button.disabled = true;
      setMessage(modal, 'Activating subscription…', false);
      api('group/' + groupId + '/subscribe', { method: 'POST', body: '{}' }).then(function () {
        return load(true);
      }).then(function () {
        setMessage(modal, 'Retail Trader Spotlight is active.', false);
        setTimeout(closeModal, 1200);
      }).catch(function (error) {
        button.disabled = false;
        setMessage(modal, error.message, true);
      });
    };
    modal.querySelector('[data-rts-test]').onclick = function () {
      var button = this;
      button.disabled = true;
      var ticker = modal.querySelector('[data-rts-test-ticker]').value;
      var text = modal.querySelector('[data-rts-test-text]').value;
      api('group/' + groupId + '/diagnostic', { method: 'POST', body: JSON.stringify({ ticker: ticker, alert_text: text }) }).then(function (result) {
        diagnosticResult(modal, result);
      }).catch(function (error) {
        setMessage(modal, error.message, true);
      }).finally(function () { button.disabled = false; });
    };
  }

  function installButton() {
    if (!payload) return;
    var host = document.querySelector('.sml-manage-mini');
    if (!host) {
      var edit = document.querySelector('[data-smlgs-edit],.sml-gshell__edit');
      host = edit && edit.parentElement;
    }
    if (!host || host.querySelector('[data-sml-rts-open]')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sml-group-btn sml-rts-open';
    button.dataset.smlRtsOpen = '1';
    button.innerHTML = '<img src="' + esc(C.avatar) + '" alt=""> <span>Retail Trader Spotlight</span>';
    button.onclick = openPanel;
    host.appendChild(button);
  }

  function load(force) {
    if (!force && payload) return Promise.resolve(payload);
    return api('group/' + groupId + '/config').then(function (data) {
      payload = data;
      installButton();
      return data;
    });
  }

  function boot() {
    if (!findRoot()) return false;
    load(false).catch(function () { payload = null; });
    if (!observer) {
      observer = new MutationObserver(function () { installButton(); });
      observer.observe(root, { childList: true, subtree: true });
    }
    return true;
  }

  if (!boot()) [100, 400, 900, 1800, 3500].forEach(function (delay) { setTimeout(boot, delay); });
}());
