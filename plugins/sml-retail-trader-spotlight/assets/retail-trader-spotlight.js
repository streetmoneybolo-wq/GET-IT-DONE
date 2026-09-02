(function () {
  'use strict';

  var C = window.SMLRetailSpotlight || {};
  var root = null;
  var groupId = '';
  var payload = null;
  var dmPayload = null;
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
    var current = data.config && Array.isArray(data.config.channel_ids) ? data.config.channel_ids.map(String) : (data.config && data.config.channel_id ? [String(data.config.channel_id)] : []);
    var channels = data.catalog && Array.isArray(data.catalog.channels) ? data.catalog.channels : [];
    if (!channels.length) {
      return '<label class="sml-rts-field"><span>Discord channel IDs</span><input data-rts-channel-text inputmode="numeric" placeholder="Paste channel IDs separated by commas" value="' + esc(current.join(', ')) + '"></label>';
    }
    return '<label class="sml-rts-field"><span>Alert channels <small>(choose 1–25)</small></span><select data-rts-channels multiple size="' + Math.min(8, Math.max(3, channels.length)) + '">' + channels.map(function (channel) {
        return '<option value="' + esc(channel.id) + '" ' + (current.indexOf(String(channel.id)) !== -1 ? 'selected' : '') + '># ' + esc(channel.name) + '</option>';
      }).join('') + '</select><small>Hold Ctrl/Command to choose more than one channel.</small></label>';
  }

  function collectChannels(modal) {
    var select = modal.querySelector('[data-rts-channels]');
    if (select) return Array.prototype.slice.call(select.selectedOptions).map(function (option) { return option.value; });
    var input = modal.querySelector('[data-rts-channel-text]');
    return input ? input.value.split(/[\s,]+/).map(function (id) { return id.replace(/\D/g, ''); }).filter(Boolean) : [];
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
      pricing_resolved: 'Monthly price and automatic member discount are resolved',
      discord_connected: 'Discord server is connected',
      configuration_saved: 'Channel and monitored traders are saved',
      subscription_active: 'Monthly Spotlight subscription is active',
      discord_bridge_ready: 'Discord polling bridge is available',
      polling_scheduled: 'One-minute polling job is scheduled',
      polling_recent: 'Discord polling completed within the last five minutes',
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

  function traceResult(modal, result) {
    var event = result.event || null;
    var publication = result.publication || null;
    var html = '<div class="sml-rts-diagnostic ' + (event ? 'is-passed' : 'is-blocked') + '"><strong>' + (event ? 'Alert found' : 'Alert not recorded') + '</strong>';
    html += '<div><span>' + (result.configuration_active ? '✓' : '×') + '</span> Subscription and configuration active</div>';
    html += '<div><span>' + (event ? '✓' : '×') + '</span> Discord message stored as a Spotlight event</div>';
    html += '<div><span>' + (event && event.status === 'handed_off' ? '✓' : '×') + '</span> Event handed to the newsroom</div>';
    html += '<div><span>' + (publication ? '✓' : '×') + '</span> WordPress publication located</div>';
    if (event) html += '<p>$' + esc(event.ticker) + ' · ' + esc(event.status) + ' · ' + esc(event.alerted_at) + '</p>';
    if (publication && publication.url) html += '<p><a href="' + esc(publication.url) + '" target="_blank" rel="noopener">Open publication</a></p>';
    if (!event && result.cursors && result.cursors.some(function (row) { return row.message_at_or_before_cursor; })) html += '<p>The channel cursor passed this message without an event. Use Recover alert to safely re-read it.</p>';
    html += '</div>';
    modal.querySelector('[data-rts-trace-result]').innerHTML = html;
  }

  function openPanel() {
    closeModal();
    var users = payload.config && Array.isArray(payload.config.monitored_users) ? payload.config.monitored_users : [];
    if (!users.length) users = [{}];
    var connected = payload.connector_state === 'active';
    var eligible = !!payload.eligible;
    var configured = !!payload.configured;
    var active = payload.status === 'active';
    var discount = !!payload.discount_eligible;
    var price = Number(payload.monthly_price || 0);
    var wallet = payload.wallet_balance == null ? 'Unavailable' : Number(payload.wallet_balance).toLocaleString() + ' Loop Bucks';
    var modal = document.createElement('div');
    modal.className = 'sml-rts-modal';
    modal.innerHTML = '<section class="sml-rts-panel" role="dialog" aria-modal="true" aria-labelledby="sml-rts-title">' +
      '<button class="sml-rts-close" type="button" aria-label="Close Spotlight settings">×</button>' +
      '<header class="sml-rts-header"><img src="' + esc(C.avatar) + '" alt=""><div><span>GROUP CREATOR TOOL</span><h2 id="sml-rts-title">Retail Trader Spotlight</h2><p>Monitor selected Discord traders and turn verified alerts into timestamped StockMarketLoop coverage.</p></div></header>' +
      '<div class="sml-rts-stats"><div><small>Members</small><strong>' + Number(payload.member_count || 0).toLocaleString() + ' / 1,000</strong></div><div><small>Subscription</small><strong>' + esc(statusLabel(payload.status)) + '</strong></div><div><small>Wallet</small><strong>' + esc(wallet) + '</strong></div></div>' +
      (!discount ? '<div class="sml-rts-callout is-warning">Your group can use Spotlight now for ' + Number(payload.base_monthly_price || 0).toLocaleString() + ' Loop Bucks/month. At 1,000 verified members, the monthly price automatically drops 50% to ' + Math.floor(Number(payload.base_monthly_price || 0) / 2).toLocaleString() + ' Loop Bucks.</div>' : '<div class="sml-rts-callout is-success">1,000+ member discount active: your group receives 50% off every monthly renewal.</div>') +
      (!connected ? '<div class="sml-rts-callout is-warning">Connect and verify this group’s Discord server through <strong>Discord Access</strong> before saving Spotlight settings.</div>' : '') +
      '<section class="sml-rts-section"><h3>1. Choose the source</h3>' + channelControl(payload) +
      '<div class="sml-rts-field"><span>Monitored traders <small>(1–25)</small></span><div data-rts-users>' + users.map(userRow).join('') + '</div><button class="sml-rts-secondary" type="button" data-rts-add-user>Add trader</button></div>' +
      '<button class="sml-rts-primary" type="button" data-rts-save ' + (!connected ? 'disabled' : '') + '>Save Spotlight configuration</button></section>' +
      '<section class="sml-rts-section"><h3>2. Activate monthly coverage</h3><p><strong>' + price.toLocaleString() + ' Loop Bucks/month</strong>' + (discount ? ' — automatic 50% group-growth discount.' : ' — automatically becomes 50% off at 1,000 members.') + '</p>' +
      '<button class="sml-rts-primary" type="button" data-rts-subscribe ' + (!eligible || !configured || active ? 'disabled' : '') + '>' + (active ? 'Subscription active through ' + esc(payload.paid_through || '') : 'Activate for ' + price.toLocaleString() + ' Loop Bucks') + '</button></section>' +
      '<section class="sml-rts-section"><h3>3. Run a safe system test</h3><p>This validates every live dependency without publishing an article or spending Loop Bucks.</p><div class="sml-rts-test-grid"><input data-rts-test-ticker maxlength="10" placeholder="$NVDA"><input data-rts-test-text maxlength="4000" placeholder="Example: $NVDA breakout alert above resistance"></div><button class="sml-rts-secondary" type="button" data-rts-test>Run complete test</button><div data-rts-diagnostic-result></div></section>' +
      '<section class="sml-rts-section"><h3>4. Trace or recover a Discord alert</h3><p>Enter the Discord message ID to see exactly where it stopped. Recovery is idempotent and cannot create a duplicate event.</p><div class="sml-rts-test-grid"><input data-rts-message-id inputmode="numeric" maxlength="24" placeholder="Discord message ID"><button class="sml-rts-secondary" type="button" data-rts-trace>Trace alert</button></div><button class="sml-rts-primary" type="button" data-rts-recover>Recover missed alert</button><div data-rts-trace-result></div></section>' +
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
      var channels = collectChannels(modal);
      var monitored = collectUsers(modal);
      button.disabled = true;
      setMessage(modal, 'Saving…', false);
      api('group/' + groupId + '/config', { method: 'POST', body: JSON.stringify({ channel_ids: channels, monitored_users: monitored }) }).then(function () {
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
    modal.querySelector('[data-rts-trace]').onclick = function () {
      var button = this;
      var messageId = modal.querySelector('[data-rts-message-id]').value.replace(/\D/g, '');
      if (!messageId) return setMessage(modal, 'Enter a Discord message ID.', true);
      button.disabled = true;
      api('group/' + groupId + '/trace/' + encodeURIComponent(messageId)).then(function (result) {
        traceResult(modal, result);
      }).catch(function (error) {
        setMessage(modal, error.message, true);
      }).finally(function () { button.disabled = false; });
    };
    modal.querySelector('[data-rts-recover]').onclick = function () {
      var button = this;
      var messageId = modal.querySelector('[data-rts-message-id]').value.replace(/\D/g, '');
      if (!messageId) return setMessage(modal, 'Enter a Discord message ID.', true);
      if (!window.confirm('Re-read this exact Discord message and queue it if eligible? Existing events and ticker cooldowns remain protected.')) return;
      button.disabled = true;
      setMessage(modal, 'Recovering the alert…', false);
      api('group/' + groupId + '/recover', { method: 'POST', body: JSON.stringify({ message_id: messageId }) }).then(function () {
        return api('group/' + groupId + '/trace/' + encodeURIComponent(messageId));
      }).then(function (result) {
        traceResult(modal, result);
        setMessage(modal, 'Recovery completed. The newsroom worker will process an eligible queued event.', false);
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

  function installDmButton() {
    if (!dmPayload) return;
    var host = document.querySelector('.sml-group-actions,.sml-gshell__group-actions,[data-group-actions]');
    if (!host || host.querySelector('[data-sml-rts-dm]')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sml-group-btn sml-rts-dm';
    button.dataset.smlRtsDm = '1';
    button.textContent = dmPayload.active ? '🔔 Discord alerts: On' : '🔕 Get Discord alerts';
    button.disabled = !dmPayload.active && (!dmPayload.linked || !dmPayload.tool_active);
    button.title = !dmPayload.linked ? 'Connect your Discord account first.' : (!dmPayload.tool_active ? 'The group owner must activate Retail Trader Spotlight first.' : dmPayload.disclaimer);
    button.onclick = function () {
      var turningOn = !dmPayload.active;
      if (turningOn && !window.confirm('Opt in to direct messages from Stock Market Loop for this group’s Retail Trader Spotlight alerts? Discord and device notification settings control sound and vibration.')) return;
      button.disabled = true;
      api('group/' + groupId + '/dm-subscription', { method: turningOn ? 'POST' : 'DELETE', body: turningOn ? JSON.stringify({ consent: true }) : null }).then(function () {
        button.remove();
        dmPayload = null;
        return loadDm();
      }).catch(function (error) {
        button.disabled = false;
        window.alert(error.message);
      });
    };
    host.appendChild(button);
  }

  function loadDm() {
    return api('group/' + groupId + '/dm-subscription').then(function (data) {
      dmPayload = data;
      installDmButton();
      return data;
    });
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
    loadDm().catch(function () { dmPayload = null; });
    if (!observer) {
      observer = new MutationObserver(function () { installButton(); installDmButton(); });
      observer.observe(root, { childList: true, subtree: true });
    }
    return true;
  }

  if (!boot()) [100, 400, 900, 1800, 3500].forEach(function (delay) { setTimeout(boot, delay); });
}());
