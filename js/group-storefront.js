/**
 * SML Group Storefront — membership tier cards.
 * Renders on /groups/{slug}/ pages. Fetches plan data from
 * sml-storefront/v1/plans and renders cards matching the SML dark terminal
 * theme. Owner gets an "Edit Plans" button linking to config.
 */
(function () {
  'use strict';
  if (document.getElementById('sml-storefront-root')) return;

  var NONCE = window.SML_STOREFRONT_NONCE || '';
  var API   = '/wp-json/sml-storefront/v1';

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

  var ICONS = {
    free:    '<path d="M14 3L17.5 10L25 11L19.5 16.5L21 24L14 20L7 24L8.5 16.5L3 11L10.5 10L14 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/>',
    popular: '<path d="M14 3L17.5 10L25 11L19.5 16.5L21 24L14 20L7 24L8.5 16.5L3 11L10.5 10L14 3Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    vip:     '<path d="M5 21L14 4L23 21H5Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 14V17" stroke="#080c12" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="19" r="1" fill="#080c12"/>'
  };

  function iconFor(plan) {
    if (plan.badge && plan.badge.toLowerCase() === 'vip') return ICONS.vip;
    if (plan.color && plan.color !== '#5d7085') return ICONS.popular;
    return ICONS.free;
  }

  function gradientFor(color) {
    if (color === '#ff7a45') return 'linear-gradient(135deg, #1a0e05 0%, #3d1e0a 50%, #2b1507 100%)';
    if (color === '#00ccff') return 'linear-gradient(135deg, #021a2e 0%, #003352 50%, #00253d 100%)';
    return 'linear-gradient(135deg, #0a1a2e 0%, #0d2847 50%, #0a1628 100%)';
  }

  function iconBgFor(color) {
    if (color === '#ff7a45') return 'linear-gradient(135deg, #5c2d0e, #8b4513)';
    if (color === '#00ccff') return 'linear-gradient(135deg, #003d66, #005a99)';
    return 'linear-gradient(135deg, #16202b, #1d2d40)';
  }

  function glowFor(color) {
    if (color === '#5d7085' || !color) return 'none';
    return '0 0 30px ' + color + '0d, 0 0 1px ' + color + '4d';
  }

  function borderFor(color) {
    if (color === '#5d7085' || !color) return '1px solid #16202b';
    return '1px solid ' + color + '33';
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function renderCard(plan) {
    var c = plan.color || '#5d7085';
    var isFree = (c === '#5d7085');
    var interval = plan.interval || 'month';
    var intervalLabel = '/' + interval;
    if (interval === 'lifetime') intervalLabel = ' one-time';

    var html = '';
    html += '<div class="sml-sf-card" style="border:' + borderFor(c) + ';border-radius:14px;background:#080c12;overflow:hidden;position:relative;box-shadow:' + glowFor(c) + ';">';

    // header
    html += '<div style="width:100%;height:140px;background:' + gradientFor(c) + ';display:flex;align-items:center;justify-content:center;position:relative;">';
    if (plan.image_url) {
      html += '<img src="' + esc(plan.image_url) + '" alt="" style="width:56px;height:56px;border-radius:14px;object-fit:cover;border:1px solid ' + c + '40;">';
    } else {
      html += '<div style="width:56px;height:56px;border-radius:14px;background:' + iconBgFor(c) + ';border:1px solid ' + c + '40;display:flex;align-items:center;justify-content:center;">';
      html += '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:' + c + ';">' + iconFor(plan) + '</svg>';
      html += '</div>';
    }
    if (plan.badge) {
      var badgeBg = isFree ? 'rgba(93,112,133,0.15)' : (c + '1f');
      var badgeBorder = isFree ? 'rgba(93,112,133,0.2)' : (c + '40');
      html += '<div style="position:absolute;top:12px;right:12px;padding:4px 10px;border-radius:20px;background:' + badgeBg + ';border:1px solid ' + badgeBorder + ';font:600 9px/1 Archivo,sans-serif;color:' + c + ';text-transform:uppercase;letter-spacing:0.5px;">' + esc(plan.badge) + '</div>';
    }
    html += '</div>';

    // body
    html += '<div style="padding:16px 18px;display:flex;flex-direction:column;gap:10px;">';
    html += '<div style="font:700 15px/1.2 Archivo,sans-serif;color:#e6edf3;">' + esc(plan.name) + '</div>';
    if (plan.description) {
      html += '<div style="font:400 11.5px/1.5 Archivo,sans-serif;color:#8fa3b5;">' + esc(plan.description) + '</div>';
    }
    html += '<div style="display:flex;align-items:baseline;gap:4px;margin-top:2px;">';
    html += '<span style="font:700 22px/1 \'IBM Plex Mono\',monospace;color:' + (isFree ? '#e6edf3' : c) + ';">' + esc(plan.price_display) + '</span>';
    html += '<span style="font:400 11px/1 Archivo,sans-serif;color:#5d7085;">' + esc(intervalLabel) + '</span>';
    html += '</div>';

    var ctaText = plan.cta_text || 'Subscribe';
    var ctaBg = isFree ? '#0d141c' : c;
    var ctaColor = isFree ? '#8fa3b5' : '#080c12';
    var ctaBorder = isFree ? '1px solid #1d2b39' : 'none';
    html += '<button class="sml-sf-cta" data-slug="' + esc(plan.slug) + '" data-url="' + esc(plan.cta_url || '') + '" style="margin-top:4px;width:100%;padding:11px;border:' + ctaBorder + ';border-radius:10px;background:' + ctaBg + ';font:600 12px/1 Archivo,sans-serif;color:' + ctaColor + ';cursor:pointer;text-align:center;transition:opacity .15s;">' + esc(ctaText) + '</button>';
    html += '</div></div>';
    return html;
  }

  function render(data) {
    var root = document.createElement('div');
    root.id = 'sml-storefront-root';
    root.style.cssText = 'padding:24px 20px;display:flex;flex-direction:column;gap:20px;max-width:440px;margin:0 auto;';

    var header = '<div style="display:flex;flex-direction:column;gap:6px;">';
    header += '<div style="font:800 20px/1.2 Archivo,sans-serif;color:#e6edf3;">Memberships</div>';
    header += '<div style="font:400 12px/1.4 Archivo,sans-serif;color:#5d7085;">Choose a plan to unlock premium features and content.</div>';
    header += '</div>';

    var cards = '<div style="display:flex;flex-direction:column;gap:16px;">';
    for (var i = 0; i < data.plans.length; i++) {
      cards += renderCard(data.plans[i]);
    }
    cards += '</div>';

    root.innerHTML = header + cards;

    root.addEventListener('click', function (e) {
      var btn = e.target.closest('.sml-sf-cta');
      if (!btn) return;
      var url = btn.getAttribute('data-url');
      if (url) {
        window.location.href = url;
      }
    });

    // insert before the group's sidebar/channels area or at the end of main content
    var target = document.querySelector('.sml-group-sidebar, .sml-group-channels, [data-sml-group-body]');
    if (target) {
      target.parentNode.insertBefore(root, target);
    } else {
      var main = document.querySelector('#root, .site-content, main, .entry-content');
      if (main) {
        main.appendChild(root);
      } else {
        document.body.appendChild(root);
      }
    }

    // add owner edit button
    if (data.can_manage) {
      var editBtn = document.createElement('button');
      editBtn.textContent = 'Edit Plans';
      editBtn.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 18px;border:1px solid #00ccff33;border-radius:10px;background:#080c12;color:#00ccff;font:600 12px/1 Archivo,sans-serif;cursor:pointer;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
      editBtn.addEventListener('click', function () { openEditor(data); });
      document.body.appendChild(editBtn);
    }
  }

  function openEditor(data) {
    if (document.getElementById('sml-sf-editor')) return;

    var overlay = document.createElement('div');
    overlay.id = 'sml-sf-editor';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';

    var panel = document.createElement('div');
    panel.style.cssText = 'background:#080c12;border:1px solid #16202b;border-radius:14px;max-width:520px;width:100%;max-height:85vh;overflow-y:auto;padding:24px;';

    var plans = data.plans.slice();
    var html = '<div style="font:700 16px/1.2 Archivo,sans-serif;color:#e6edf3;margin-bottom:16px;">Edit Plans</div>';

    function planFields(p, idx) {
      var s = '';
      s += '<div class="sml-sf-plan-block" data-idx="' + idx + '" style="border:1px solid #16202b;border-radius:10px;padding:14px;margin-bottom:12px;background:#0a1018;">';
      s += '<input data-field="name" value="' + esc(p.name) + '" placeholder="Plan name" style="width:100%;padding:8px;border:1px solid #1d2b39;border-radius:6px;background:#040608;color:#e6edf3;font:400 12px/1.4 Archivo,sans-serif;margin-bottom:8px;box-sizing:border-box;">';
      s += '<textarea data-field="description" placeholder="Description" rows="2" style="width:100%;padding:8px;border:1px solid #1d2b39;border-radius:6px;background:#040608;color:#e6edf3;font:400 12px/1.4 Archivo,sans-serif;margin-bottom:8px;resize:vertical;box-sizing:border-box;">' + esc(p.description || '') + '</textarea>';
      s += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
      s += '<input data-field="price_display" value="' + esc(p.price_display) + '" placeholder="$9.99" style="flex:1;padding:8px;border:1px solid #1d2b39;border-radius:6px;background:#040608;color:#e6edf3;font:400 12px/1.4 Archivo,sans-serif;">';
      s += '<input data-field="badge" value="' + esc(p.badge || '') + '" placeholder="Badge" style="flex:1;padding:8px;border:1px solid #1d2b39;border-radius:6px;background:#040608;color:#e6edf3;font:400 12px/1.4 Archivo,sans-serif;">';
      s += '</div>';
      s += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
      s += '<input data-field="color" value="' + esc(p.color) + '" placeholder="#00ccff" style="flex:1;padding:8px;border:1px solid #1d2b39;border-radius:6px;background:#040608;color:#e6edf3;font:400 12px/1.4 Archivo,sans-serif;">';
      s += '<input data-field="cta_text" value="' + esc(p.cta_text || 'Subscribe') + '" placeholder="Button text" style="flex:1;padding:8px;border:1px solid #1d2b39;border-radius:6px;background:#040608;color:#e6edf3;font:400 12px/1.4 Archivo,sans-serif;">';
      s += '</div>';
      s += '<input data-field="cta_url" value="' + esc(p.cta_url || '') + '" placeholder="CTA URL (optional)" style="width:100%;padding:8px;border:1px solid #1d2b39;border-radius:6px;background:#040608;color:#e6edf3;font:400 12px/1.4 Archivo,sans-serif;margin-bottom:8px;box-sizing:border-box;">';
      s += '<input data-field="image_url" value="' + esc(p.image_url || '') + '" placeholder="Image URL (optional)" style="width:100%;padding:8px;border:1px solid #1d2b39;border-radius:6px;background:#040608;color:#e6edf3;font:400 12px/1.4 Archivo,sans-serif;box-sizing:border-box;">';
      s += '<div style="text-align:right;margin-top:8px;"><button class="sml-sf-remove" data-idx="' + idx + '" style="padding:6px 12px;border:1px solid #ff4444;border-radius:6px;background:transparent;color:#ff4444;font:500 11px/1 Archivo,sans-serif;cursor:pointer;">Remove</button></div>';
      s += '</div>';
      return s;
    }

    for (var i = 0; i < plans.length; i++) {
      html += planFields(plans[i], i);
    }

    html += '<button id="sml-sf-add" style="width:100%;padding:10px;border:1px dashed #1d2b39;border-radius:8px;background:transparent;color:#5d7085;font:500 12px/1 Archivo,sans-serif;cursor:pointer;margin-bottom:16px;">+ Add Plan</button>';
    html += '<div style="display:flex;gap:10px;">';
    html += '<button id="sml-sf-cancel" style="flex:1;padding:12px;border:1px solid #1d2b39;border-radius:10px;background:transparent;color:#8fa3b5;font:600 12px/1 Archivo,sans-serif;cursor:pointer;">Cancel</button>';
    html += '<button id="sml-sf-save" style="flex:2;padding:12px;border:none;border-radius:10px;background:#00ccff;color:#080c12;font:600 12px/1 Archivo,sans-serif;cursor:pointer;">Save Changes</button>';
    html += '</div>';

    panel.innerHTML = html;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) { overlay.remove(); }
    });

    panel.querySelector('#sml-sf-cancel').addEventListener('click', function () { overlay.remove(); });

    panel.querySelector('#sml-sf-save').addEventListener('click', function () {
      var blocks = panel.querySelectorAll('.sml-sf-plan-block');
      var out = [];
      blocks.forEach(function (bl) {
        var obj = {};
        obj.name = bl.querySelector('[data-field="name"]').value;
        obj.description = bl.querySelector('[data-field="description"]').value;
        obj.price_display = bl.querySelector('[data-field="price_display"]').value;
        obj.badge = bl.querySelector('[data-field="badge"]').value;
        obj.color = bl.querySelector('[data-field="color"]').value;
        obj.cta_text = bl.querySelector('[data-field="cta_text"]').value;
        obj.cta_url = bl.querySelector('[data-field="cta_url"]').value;
        obj.image_url = bl.querySelector('[data-field="image_url"]').value;
        obj.slug = (obj.name || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        obj.interval = 'month';
        obj.active = true;
        out.push(obj);
      });
      api('/meta?slug=' + encodeURIComponent(slug()), {
        method: 'POST',
        body: JSON.stringify({ plans: out })
      }).then(function () {
        overlay.remove();
        location.reload();
      });
    });

    panel.addEventListener('click', function (e) {
      if (e.target.classList.contains('sml-sf-remove')) {
        var block = e.target.closest('.sml-sf-plan-block');
        if (block) block.remove();
      }
    });

    panel.querySelector('#sml-sf-add').addEventListener('click', function () {
      var blocks = panel.querySelectorAll('.sml-sf-plan-block');
      var newIdx = blocks.length;
      var div = document.createElement('div');
      div.innerHTML = planFields({
        slug: '', name: '', description: '', price_display: '$0',
        interval: 'month', badge: '', color: '#5d7085', cta_text: 'Subscribe',
        cta_url: '', image_url: '', active: true
      }, newIdx);
      panel.querySelector('#sml-sf-add').before(div.firstChild);
    });
  }

  // init
  var s = slug();
  if (!s) return;

  api('/plans?slug=' + encodeURIComponent(s))
    .then(function (data) {
      if (data && data.plans && data.plans.length) {
        render(data);
      }
    })
    .catch(function () {});
})();
