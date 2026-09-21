/**
 * SML Group Onboarding — guided setup overlay for new group members.
 * Injected on /groups/{slug}/ pages. Fetches onboarding config from
 * sml-onboard/v1/flow; shows multi-step overlay if not completed.
 * Also provides owner config panel via sml-onboard/v1/config.
 */
(function () {
  'use strict';
  if (document.getElementById('sml-onboard-root')) return;

  var NONCE = window.SML_ONBOARD_NONCE || '';
  var API   = '/wp-json/sml-onboard/v1';

  function slug() {
    var m = location.pathname.match(/^\/groups\/([^/]+)/);
    return m ? m[1] : '';
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (NONCE) headers['X-WP-Nonce'] = NONCE;
    return fetch(API + path, Object.assign({ headers: headers, credentials: 'same-origin' }, opts))
      .then(function (r) { return r.json(); });
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ---- Member Onboarding Flow ----

  var state = { step: 1, selected: [], rulesAccepted: false };

  function renderOverlay(data) {
    var overlay = document.createElement('div');
    overlay.id = 'sml-onboard-root';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,6,8,0.92);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px);';

    var modal = document.createElement('div');
    modal.id = 'sml-onboard-modal';
    modal.style.cssText = 'background:#040608;border:1px solid #16202b;border-radius:16px;max-width:420px;width:100%;max-height:90vh;overflow-y:auto;display:flex;flex-direction:column;';

    state.selected = data.featured_channels.map(function (c) { return c.id; });

    function renderStep() {
      var html = '';

      // header (always visible)
      html += '<div style="padding:28px 24px 20px;background:linear-gradient(180deg,#0a1a2e 0%,#060e18 60%,#040608 100%);display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;">';
      html += '<div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#003d66,#005a99);border:2px solid rgba(0,204,255,0.25);display:flex;align-items:center;justify-content:center;">';
      html += '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="11" r="3.5" stroke="#00ccff" stroke-width="1.5"/><circle cx="18" cy="11" r="3.5" stroke="#00ccff" stroke-width="1.5"/><path d="M5 23C5 19.6863 7.68629 17 11 17H17C20.3137 17 23 19.6863 23 23V25H5V23Z" stroke="#00ccff" stroke-width="1.5"/></svg>';
      html += '</div>';
      html += '<div style="display:flex;flex-direction:column;gap:5px;">';
      html += '<div style="font:800 20px/1.2 Archivo,sans-serif;color:#e6edf3;">Welcome to<br><span style="color:#00ccff;">' + esc(data.group_name) + '</span></div>';
      if (data.welcome_message) {
        html += '<div style="font:400 11.5px/1.5 Archivo,sans-serif;color:#8fa3b5;max-width:300px;">' + esc(data.welcome_message) + '</div>';
      } else if (data.owner_name) {
        html += '<div style="font:400 11.5px/1.5 Archivo,sans-serif;color:#8fa3b5;max-width:300px;">Here\'s what ' + esc(data.owner_name) + ' set up for new members.</div>';
      }
      html += '</div></div>';

      // progress bar
      var totalSteps = data.rules.length > 0 ? 3 : 2;
      html += '<div style="padding:4px 20px 0;display:flex;align-items:center;gap:8px;">';
      for (var si = 1; si <= totalSteps; si++) {
        var barColor = si <= state.step ? '#00ccff' : '#16202b';
        html += '<div style="flex:1;height:3px;border-radius:2px;background:' + barColor + ';"></div>';
      }
      html += '</div>';

      var stepLabels = ['Choose channels'];
      if (data.rules.length > 0) stepLabels.push('Group rules');
      stepLabels.push('Notifications');
      html += '<div style="padding:6px 20px 14px;font:500 10px/1 \'IBM Plex Mono\',monospace;color:#5d7085;">Step ' + state.step + ' of ' + totalSteps + ' &middot; ' + stepLabels[state.step - 1] + '</div>';

      // step content
      if (state.step === 1) {
        html += renderChannelStep(data);
      } else if (state.step === 2 && data.rules.length > 0) {
        html += renderRulesStep(data);
      } else {
        html += renderNotifStep(data);
      }

      // footer buttons
      html += '<div style="padding:6px 20px 24px;display:flex;gap:10px;">';
      html += '<button id="sml-ob-skip" style="flex:1;padding:13px;border:1px solid #1d2b39;border-radius:10px;background:transparent;font:600 13px/1 Archivo,sans-serif;color:#8fa3b5;cursor:pointer;text-align:center;">Skip</button>';
      var nextText;
      if (state.step === 1) {
        nextText = 'Follow ' + state.selected.length + ' & Continue';
      } else if ((state.step === 2 && data.rules.length > 0) || state.step < totalSteps) {
        nextText = 'Continue';
      } else {
        nextText = 'Done';
      }
      html += '<button id="sml-ob-next" style="flex:2;padding:13px;border:none;border-radius:10px;background:#00ccff;font:600 13px/1 Archivo,sans-serif;color:#080c12;cursor:pointer;text-align:center;">' + nextText + '</button>';
      html += '</div>';

      modal.innerHTML = html;
      bindStepEvents(data, totalSteps);
    }

    function bindStepEvents(data, totalSteps) {
      // channel toggles
      modal.querySelectorAll('.sml-ob-ch').forEach(function (el) {
        el.addEventListener('click', function () {
          var cid = parseInt(el.getAttribute('data-cid'));
          var idx = state.selected.indexOf(cid);
          if (idx > -1) { state.selected.splice(idx, 1); } else { state.selected.push(cid); }
          renderStep();
        });
      });

      // rules accept
      var rulesCheck = modal.querySelector('#sml-ob-rules-accept');
      if (rulesCheck) {
        rulesCheck.addEventListener('change', function () {
          state.rulesAccepted = rulesCheck.checked;
        });
      }

      // skip
      modal.querySelector('#sml-ob-skip').addEventListener('click', function () {
        complete();
      });

      // next
      modal.querySelector('#sml-ob-next').addEventListener('click', function () {
        if (state.step < totalSteps) {
          state.step++;
          renderStep();
        } else {
          complete();
        }
      });
    }

    function complete() {
      api('/complete?slug=' + encodeURIComponent(slug()), { method: 'POST', body: '{}' })
        .then(function () { overlay.remove(); })
        .catch(function () { overlay.remove(); });
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    renderStep();
  }

  function renderChannelStep(data) {
    var html = '<div style="padding:0 20px;display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;max-height:400px;">';

    if (data.featured_channels.length > 0) {
      html += '<div style="font:600 11px/1 Archivo,sans-serif;color:#5d7085;text-transform:uppercase;letter-spacing:0.8px;padding-bottom:2px;">Featured by owner</div>';
      data.featured_channels.forEach(function (ch) {
        html += channelRow(ch, true);
      });
    }

    if (data.other_channels.length > 0) {
      html += '<div style="font:600 11px/1 Archivo,sans-serif;color:#5d7085;text-transform:uppercase;letter-spacing:0.8px;padding:8px 0 2px;">All channels</div>';
      data.other_channels.forEach(function (ch) {
        html += channelRow(ch, false);
      });
    }

    // notification bar
    if (data.auto_notifications) {
      html += '<div style="padding:14px 0;display:flex;align-items:center;gap:10px;border-top:1px solid #0e1620;margin-top:8px;">';
      html += '<div style="width:20px;height:20px;border-radius:6px;background:#22c55e;display:flex;align-items:center;justify-content:center;flex:none;">';
      html += '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      html += '</div>';
      html += '<div style="font:400 11px/1.4 Archivo,sans-serif;color:#8fa3b5;">Notifications on for channels you follow</div>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function channelRow(ch, featured) {
    var isSelected = state.selected.indexOf(ch.id) > -1;
    var borderStyle = featured
      ? 'border:1px solid rgba(0,204,255,0.2);background:rgba(0,204,255,0.03);'
      : 'border:1px solid #16202b;background:#080c12;';
    var iconBg = featured
      ? 'background:rgba(0,204,255,0.1);border:1px solid rgba(0,204,255,0.15);'
      : 'background:#0d141c;border:1px solid #1d2b39;';

    var html = '<div class="sml-ob-ch" data-cid="' + ch.id + '" style="' + borderStyle + 'border-radius:11px;padding:12px 14px;display:flex;align-items:center;gap:11px;cursor:pointer;">';
    html += '<div style="width:34px;height:34px;border-radius:9px;' + iconBg + 'display:flex;align-items:center;justify-content:center;flex:none;">';
    html += '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4H13M3 8H10M3 12H7" stroke="' + (featured ? '#00ccff' : '#5d7085') + '" stroke-width="1.3" stroke-linecap="round"/></svg>';
    html += '</div>';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="font:600 12px/1.3 Archivo,sans-serif;color:#e6edf3;">#' + esc(ch.name) + '</div>';
    if (ch.description) {
      html += '<div style="font:400 10px/1.3 Archivo,sans-serif;color:#5d7085;">' + esc(ch.description) + '</div>';
    }
    html += '</div>';

    if (isSelected) {
      html += '<div style="width:18px;height:18px;border-radius:5px;background:#00ccff;display:flex;align-items:center;justify-content:center;flex:none;">';
      html += '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4 7L8 3" stroke="#080c12" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      html += '</div>';
    } else {
      html += '<div style="width:18px;height:18px;border-radius:5px;border:1.5px solid #2a3a4a;flex:none;"></div>';
    }
    html += '</div>';
    return html;
  }

  function renderRulesStep(data) {
    var html = '<div style="padding:0 20px;display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;max-height:400px;">';
    html += '<div style="font:600 11px/1 Archivo,sans-serif;color:#5d7085;text-transform:uppercase;letter-spacing:0.8px;padding-bottom:2px;">Group Rules</div>';
    html += '<div style="border:1px solid #16202b;border-radius:12px;background:#080c12;padding:14px 18px;display:flex;flex-direction:column;gap:8px;">';

    data.rules.forEach(function (rule, i) {
      html += '<div style="display:flex;align-items:flex-start;gap:8px;' + (i < data.rules.length - 1 ? 'padding-bottom:8px;border-bottom:1px solid #0e1620;' : '') + '">';
      html += '<div style="font:600 11px/1 \'IBM Plex Mono\',monospace;color:#4c5d6d;width:16px;flex:none;padding-top:2px;">' + (i + 1) + '.</div>';
      html += '<div style="font:400 11px/1.5 Archivo,sans-serif;color:#c9d6e2;flex:1;">' + esc(rule) + '</div>';
      html += '</div>';
    });

    html += '</div>';
    html += '<label style="display:flex;align-items:center;gap:10px;padding:12px 0;cursor:pointer;">';
    html += '<input type="checkbox" id="sml-ob-rules-accept" ' + (state.rulesAccepted ? 'checked' : '') + ' style="width:16px;height:16px;accent-color:#00ccff;">';
    html += '<span style="font:400 12px/1.4 Archivo,sans-serif;color:#8fa3b5;">I agree to follow these rules</span>';
    html += '</label>';
    html += '</div>';
    return html;
  }

  function renderNotifStep(data) {
    var html = '<div style="padding:0 20px;display:flex;flex-direction:column;gap:16px;flex:1;align-items:center;justify-content:center;min-height:200px;text-align:center;">';
    html += '<div style="width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,#0a2a15,#155e2e);border:2px solid rgba(34,197,94,0.3);display:flex;align-items:center;justify-content:center;">';
    html += '<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M16 4C16 4 18 8 18 12C18 16 16 20 16 20M16 20C16 20 14 16 14 12C14 8 16 4 16 4" stroke="#22c55e" stroke-width="1.5"/><path d="M8 26H24L22 22H10L8 26Z" stroke="#22c55e" stroke-width="1.5" stroke-linejoin="round"/><circle cx="16" cy="26" r="2" fill="#22c55e"/></svg>';
    html += '</div>';
    html += '<div style="font:700 16px/1.2 Archivo,sans-serif;color:#e6edf3;">You\'re all set!</div>';
    html += '<div style="font:400 12px/1.5 Archivo,sans-serif;color:#8fa3b5;max-width:280px;">';
    if (data.auto_notifications) {
      html += 'Notifications are enabled for the channels you selected. You can change this anytime from group settings.';
    } else {
      html += 'You\'re following ' + state.selected.length + ' channel' + (state.selected.length !== 1 ? 's' : '') + '. Jump in and start exploring!';
    }
    html += '</div></div>';
    return html;
  }

  // ---- Owner Config Panel ----

  function renderOwnerConfig(cfgData) {
    var btn = document.createElement('button');
    btn.id = 'sml-ob-config-btn';
    btn.textContent = 'Onboarding Setup';
    btn.style.cssText = 'position:fixed;bottom:60px;right:20px;padding:10px 18px;border:1px solid #22c55e33;border-radius:10px;background:#080c12;color:#22c55e;font:600 12px/1 Archivo,sans-serif;cursor:pointer;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
    btn.addEventListener('click', function () { openOwnerPanel(); });
    document.body.appendChild(btn);
  }

  function openOwnerPanel() {
    if (document.getElementById('sml-ob-config-panel')) return;

    api('/config?slug=' + encodeURIComponent(slug()))
      .then(function (res) {
        var config = res.config || {};
        var channels = res.channels || [];

        var overlay = document.createElement('div');
        overlay.id = 'sml-ob-config-panel';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10002;display:flex;align-items:center;justify-content:center;padding:16px;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#040608;border:1px solid #16202b;border-radius:14px;max-width:460px;width:100%;max-height:85vh;overflow-y:auto;padding:24px 22px;display:flex;flex-direction:column;gap:18px;';

        var html = '';

        // header
        html += '<div style="display:flex;align-items:center;gap:10px;">';
        html += '<div style="font:700 16px/1.2 Archivo,sans-serif;color:#e6edf3;">Onboarding Setup</div>';
        html += '<div style="margin-left:auto;font:500 10px/1 \'IBM Plex Mono\',monospace;color:#5d7085;">OWNER ONLY</div>';
        html += '</div>';

        // enable toggle
        html += '<div style="border:1px solid #16202b;border-radius:12px;background:#080c12;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;">';
        html += '<div style="display:flex;flex-direction:column;gap:3px;">';
        html += '<div style="font:600 13px/1.3 Archivo,sans-serif;color:#e6edf3;">Enable Onboarding</div>';
        html += '<div style="font:400 10.5px/1.4 Archivo,sans-serif;color:#5d7085;">New members see a guided setup when they join.</div>';
        html += '</div>';
        html += '<label style="cursor:pointer;"><input type="checkbox" id="sml-ob-enabled" ' + (config.enabled ? 'checked' : '') + ' style="width:20px;height:20px;accent-color:#22c55e;"></label>';
        html += '</div>';

        // welcome message
        html += '<div style="border:1px solid #16202b;border-radius:12px;background:#080c12;overflow:hidden;">';
        html += '<div style="padding:14px 18px;border-bottom:1px solid #0e1620;">';
        html += '<div style="font:600 12px/1 Archivo,sans-serif;color:#e6edf3;margin-bottom:3px;">Welcome Message</div>';
        html += '<div style="font:400 10px/1.3 Archivo,sans-serif;color:#5d7085;">Shown at the top of the onboarding screen.</div>';
        html += '</div>';
        html += '<div style="padding:14px 18px;">';
        html += '<textarea id="sml-ob-welcome" maxlength="200" rows="3" style="width:100%;border:1px solid #1d2b39;border-radius:8px;background:#0a1018;padding:10px 12px;font:400 12px/1.5 Archivo,sans-serif;color:#c9d6e2;resize:vertical;box-sizing:border-box;">' + esc(config.welcome_message || '') + '</textarea>';
        html += '<div id="sml-ob-charcount" style="font:400 9px/1 \'IBM Plex Mono\',monospace;color:#4c5d6d;text-align:right;margin-top:6px;">' + (config.welcome_message || '').length + ' / 200</div>';
        html += '</div></div>';

        // featured channels
        html += '<div style="border:1px solid #16202b;border-radius:12px;background:#080c12;overflow:hidden;">';
        html += '<div style="padding:14px 18px;border-bottom:1px solid #0e1620;display:flex;align-items:center;justify-content:space-between;">';
        html += '<div><div style="font:600 12px/1 Archivo,sans-serif;color:#e6edf3;margin-bottom:3px;">Featured Channels</div>';
        html += '<div style="font:400 10px/1.3 Archivo,sans-serif;color:#5d7085;">Pre-selected for new members (max 5).</div></div>';
        html += '<div id="sml-ob-feat-count" style="font:500 10px/1 \'IBM Plex Mono\',monospace;color:#00ccff;">' + (config.featured_channels || []).length + ' / 5</div>';
        html += '</div>';
        html += '<div id="sml-ob-channels" style="padding:8px 18px 14px;display:flex;flex-direction:column;gap:4px;">';

        var featIds = config.featured_channels || [];
        channels.forEach(function (ch) {
          var isFeat = featIds.indexOf(ch.id) > -1;
          html += '<label style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer;">';
          html += '<input type="checkbox" class="sml-ob-feat-ch" data-cid="' + ch.id + '" ' + (isFeat ? 'checked' : '') + ' style="width:16px;height:16px;accent-color:#00ccff;">';
          html += '<span style="font:500 11px/1 Archivo,sans-serif;color:' + (isFeat ? '#00ccff' : '#e6edf3') + ';">#' + esc(ch.name) + '</span>';
          html += '</label>';
        });

        html += '</div></div>';

        // rules
        html += '<div style="border:1px solid #16202b;border-radius:12px;background:#080c12;overflow:hidden;">';
        html += '<div style="padding:14px 18px;border-bottom:1px solid #0e1620;">';
        html += '<div style="font:600 12px/1 Archivo,sans-serif;color:#e6edf3;margin-bottom:3px;">Group Rules</div>';
        html += '<div style="font:400 10px/1.3 Archivo,sans-serif;color:#5d7085;">Members must accept before they can post.</div>';
        html += '</div>';
        html += '<div id="sml-ob-rules" style="padding:10px 18px 14px;display:flex;flex-direction:column;gap:6px;">';

        (config.rules || []).forEach(function (rule, i) {
          html += '<div class="sml-ob-rule" style="display:flex;align-items:center;gap:8px;">';
          html += '<span style="font:600 11px/1 \'IBM Plex Mono\',monospace;color:#4c5d6d;width:16px;flex:none;">' + (i + 1) + '.</span>';
          html += '<input type="text" class="sml-ob-rule-input" value="' + esc(rule) + '" maxlength="200" style="flex:1;padding:6px 8px;border:1px solid #1d2b39;border-radius:6px;background:#0a1018;color:#c9d6e2;font:400 11px/1.4 Archivo,sans-serif;">';
          html += '<button class="sml-ob-rule-rm" style="padding:4px;border:none;background:transparent;color:#ff4444;cursor:pointer;font-size:14px;">&times;</button>';
          html += '</div>';
        });

        html += '<button id="sml-ob-add-rule" style="width:100%;padding:8px;border:1px dashed #1d2b39;border-radius:8px;background:transparent;font:500 11px/1 Archivo,sans-serif;color:#5d7085;cursor:pointer;margin-top:4px;">+ Add rule</button>';
        html += '</div></div>';

        // auto notifications
        html += '<div style="border:1px solid #16202b;border-radius:12px;background:#080c12;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;">';
        html += '<div style="display:flex;flex-direction:column;gap:3px;">';
        html += '<div style="font:600 12px/1 Archivo,sans-serif;color:#e6edf3;">Auto-enable Notifications</div>';
        html += '<div style="font:400 10px/1.3 Archivo,sans-serif;color:#5d7085;">Turn on notifications for featured channels by default.</div>';
        html += '</div>';
        html += '<label style="cursor:pointer;"><input type="checkbox" id="sml-ob-auto-notif" ' + (config.auto_notifications !== false ? 'checked' : '') + ' style="width:20px;height:20px;accent-color:#22c55e;"></label>';
        html += '</div>';

        // buttons
        html += '<div style="display:flex;gap:10px;">';
        html += '<button id="sml-ob-cfg-cancel" style="flex:1;padding:12px;border:1px solid rgba(0,204,255,0.2);border-radius:10px;background:transparent;font:600 12px/1 Archivo,sans-serif;color:#00ccff;cursor:pointer;">Cancel</button>';
        html += '<button id="sml-ob-cfg-save" style="flex:2;padding:12px;border:none;border-radius:10px;background:#00ccff;font:600 12px/1 Archivo,sans-serif;color:#080c12;cursor:pointer;">Save Changes</button>';
        html += '</div>';

        panel.innerHTML = html;
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        // events
        overlay.addEventListener('click', function (e) {
          if (e.target === overlay) overlay.remove();
        });

        panel.querySelector('#sml-ob-cfg-cancel').addEventListener('click', function () { overlay.remove(); });

        var welcomeEl = panel.querySelector('#sml-ob-welcome');
        welcomeEl.addEventListener('input', function () {
          panel.querySelector('#sml-ob-charcount').textContent = welcomeEl.value.length + ' / 200';
        });

        panel.addEventListener('click', function (e) {
          if (e.target.classList.contains('sml-ob-rule-rm')) {
            e.target.parentElement.remove();
            renumberRules();
          }
        });

        panel.querySelector('#sml-ob-add-rule').addEventListener('click', function () {
          var rulesDiv = panel.querySelector('#sml-ob-rules');
          var count = rulesDiv.querySelectorAll('.sml-ob-rule').length;
          if (count >= 10) return;
          var div = document.createElement('div');
          div.className = 'sml-ob-rule';
          div.style.cssText = 'display:flex;align-items:center;gap:8px;';
          div.innerHTML = '<span style="font:600 11px/1 \'IBM Plex Mono\',monospace;color:#4c5d6d;width:16px;flex:none;">' + (count + 1) + '.</span>' +
            '<input type="text" class="sml-ob-rule-input" maxlength="200" style="flex:1;padding:6px 8px;border:1px solid #1d2b39;border-radius:6px;background:#0a1018;color:#c9d6e2;font:400 11px/1.4 Archivo,sans-serif;">' +
            '<button class="sml-ob-rule-rm" style="padding:4px;border:none;background:transparent;color:#ff4444;cursor:pointer;font-size:14px;">&times;</button>';
          rulesDiv.querySelector('#sml-ob-add-rule').before(div);
        });

        function renumberRules() {
          var ruleEls = panel.querySelectorAll('.sml-ob-rule');
          ruleEls.forEach(function (el, i) {
            var num = el.querySelector('span');
            if (num) num.textContent = (i + 1) + '.';
          });
        }

        panel.querySelector('#sml-ob-cfg-save').addEventListener('click', function () {
          var featChecks = panel.querySelectorAll('.sml-ob-feat-ch:checked');
          var featured = [];
          featChecks.forEach(function (cb) { featured.push(parseInt(cb.getAttribute('data-cid'))); });

          var ruleInputs = panel.querySelectorAll('.sml-ob-rule-input');
          var rules = [];
          ruleInputs.forEach(function (inp) { if (inp.value.trim()) rules.push(inp.value.trim()); });

          var payload = {
            enabled: panel.querySelector('#sml-ob-enabled').checked,
            welcome_message: welcomeEl.value,
            featured_channels: featured,
            rules: rules,
            auto_notifications: panel.querySelector('#sml-ob-auto-notif').checked
          };

          api('/config?slug=' + encodeURIComponent(slug()), {
            method: 'POST',
            body: JSON.stringify(payload)
          }).then(function () { overlay.remove(); });
        });

        // enforce max 5 featured
        panel.addEventListener('change', function (e) {
          if (e.target.classList.contains('sml-ob-feat-ch')) {
            var checked = panel.querySelectorAll('.sml-ob-feat-ch:checked');
            if (checked.length > 5) { e.target.checked = false; }
            panel.querySelector('#sml-ob-feat-count').textContent = Math.min(checked.length, 5) + ' / 5';
          }
        });
      });
  }

  // ---- Init ----
  var s = slug();
  if (!s || !NONCE) return;

  api('/flow?slug=' + encodeURIComponent(s))
    .then(function (data) {
      if (data && data.show) {
        renderOverlay(data);
      }
    })
    .catch(function () {});

  // check if owner — show config button
  fetch('/wp-json/sml-onboard/v1/config?slug=' + encodeURIComponent(s), {
    headers: NONCE ? { 'X-WP-Nonce': NONCE } : {},
    credentials: 'same-origin'
  }).then(function (r) {
    if (r.ok) { renderOwnerConfig(); }
  }).catch(function () {});
})();
