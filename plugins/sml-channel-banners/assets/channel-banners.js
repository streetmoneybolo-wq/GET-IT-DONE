(function () {
  'use strict';
  if (window.__smlChannelBannersBooted) return;
  window.__smlChannelBannersBooted = true;

  var config = window.SMLChannelBanners || {};
  var root = document.getElementById('sml-group-shell');
  var shellConfig = {};
  var state = { banners: {}, canManage: false, channelId: 0, modal: null, queued: false };
  if (!root || !config.api) return;
  root.setAttribute('data-sml-cbanner-state', 'booting');
  try { shellConfig = JSON.parse(root.getAttribute('data-config') || '{}'); } catch (error) {}
  var groupId = parseInt(shellConfig.groupId, 10) || 0;
  if (!groupId) return;
  root.setAttribute('data-sml-cbanner-state', 'loading');

  function request(path, options) {
    options = options || {};
    options.credentials = 'same-origin';
    options.cache = 'no-store';
    options.headers = Object.assign({ 'X-WP-Nonce': config.nonce || '' }, options.headers || {});
    return fetch(config.api + path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) throw new Error(payload.message || 'The channel banner request failed.');
        return payload;
      });
    });
  }

  function activeChannelId() {
    var active = root.querySelector('.sml-gshell__channel[data-smlgs-channel].is-active');
    return active ? (parseInt(active.getAttribute('data-smlgs-channel'), 10) || 0) : 0;
  }

  function header() { return root.querySelector('.sml-gshell__main-head'); }

  function removeLegacyTitle() {
    var old = root.querySelector('#sml-ghx-title');
    if (old) old.remove();
  }

  function render() {
    var head = header();
    if (!head) return;
    var channelId = activeChannelId();
    var entry = channelId ? state.banners[String(channelId)] : null;
    var image = head.querySelector('.sml-cbanner-image');
    removeLegacyTitle();
    head.setAttribute('data-sml-cbanner-channel', channelId ? String(channelId) : 'portal');
    if (!entry || !entry.url) {
      if (image) image.remove();
      return;
    }
    if (!image) {
      image = document.createElement('img');
      image.className = 'sml-cbanner-image';
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      head.insertBefore(image, head.firstChild);
    }
    if (image.src !== entry.url) image.src = entry.url;
    image.style.objectPosition = entry.pos_x + '% ' + entry.pos_y + '%';
    image.style.transform = 'scale(' + (entry.zoom / 100) + ')';
  }

  function menu() {
    if (!state.canManage) return;
    var channelId = activeChannelId();
    var menuNode = root.querySelector('.sml-gshell__owner-menu') || root.querySelector('.sml-ghx-menu');
    if (!menuNode) return;
    if (!channelId) {
      Array.prototype.forEach.call(menuNode.querySelectorAll('[data-sml-cbanner-open]'), function (button) { button.remove(); });
      return;
    }
    Array.prototype.forEach.call(menuNode.querySelectorAll('button'), function (button) {
      if (/^channel title$/i.test(String(button.textContent || '').trim())) button.remove();
    });
    if (!menuNode.querySelector('[data-sml-cbanner-open]')) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-sml-cbanner-open', '1');
      button.textContent = 'Channel banner';
      menuNode.appendChild(button);
    }
  }

  function updatePreview(modal) {
    var form = modal.querySelector('form');
    var image = modal.querySelector('[data-sml-cbanner-preview-image]');
    var zoom = parseInt(form.elements.zoom.value, 10) || 100;
    var posX = parseInt(form.elements.pos_x.value, 10) || 0;
    var posY = parseInt(form.elements.pos_y.value, 10) || 0;
    image.style.objectPosition = posX + '% ' + posY + '%';
    image.style.transform = 'scale(' + (zoom / 100) + ')';
    modal.querySelector('[data-sml-cbanner-zoom-output]').textContent = zoom + '%';
    modal.querySelector('[data-sml-cbanner-x-output]').textContent = posX + '%';
    modal.querySelector('[data-sml-cbanner-y-output]').textContent = posY + '%';
  }

  function ensureModal() {
    if (state.modal) return state.modal;
    var modal = document.createElement('section');
    modal.className = 'sml-cbanner-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<form class="sml-cbanner-card">' +
      '<div class="sml-cbanner-head"><h2>Channel Banner</h2><button type="button" data-sml-cbanner-close aria-label="Close">×</button></div>' +
      '<div class="sml-cbanner-preview"><img data-sml-cbanner-preview-image alt="Banner preview"></div>' +
      '<label>Banner image<small>Animated GIF up to 50 MB · JPG, PNG, or WebP up to 5 MB</small><input type="file" name="banner" accept="image/jpeg,image/png,image/gif,image/webp"></label>' +
      '<label>Zoom<div class="sml-cbanner-range"><input type="range" name="zoom" min="100" max="300" value="100"><output data-sml-cbanner-zoom-output>100%</output></div></label>' +
      '<label>Horizontal position<div class="sml-cbanner-range"><input type="range" name="pos_x" min="0" max="100" value="50"><output data-sml-cbanner-x-output>50%</output></div></label>' +
      '<label>Vertical position<div class="sml-cbanner-range"><input type="range" name="pos_y" min="0" max="100" value="50"><output data-sml-cbanner-y-output>50%</output></div></label>' +
      '<p class="sml-cbanner-status" data-sml-cbanner-status role="status" aria-live="polite"></p>' +
      '<div class="sml-cbanner-actions"><button type="button" class="sml-cbanner-remove" data-sml-cbanner-remove>Remove banner</button><span><button type="button" data-sml-cbanner-close>Cancel</button> <button type="submit">Save Banner</button></span></div>' +
      '</form>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (event) {
      if (event.target === modal || event.target.closest('[data-sml-cbanner-close]')) modal.hidden = true;
      if (event.target.closest('[data-sml-cbanner-remove]')) save(modal, true);
    });
    modal.querySelectorAll('input[type="range"]').forEach(function (input) {
      input.addEventListener('input', function () { updatePreview(modal); });
    });
    modal.querySelector('input[type="file"]').addEventListener('change', function () {
      var file = this.files && this.files[0];
      var status = modal.querySelector('[data-sml-cbanner-status]');
      if (!file) return;
      var allowed = /^image\/(jpeg|png|gif|webp)$/i.test(file.type || '');
      var limit = (file.type === 'image/gif' ? 50 : 5) * 1024 * 1024;
      if (!allowed || file.size > limit) {
        status.textContent = !allowed ? 'Choose a JPG, PNG, GIF, or WebP image.' : (file.type === 'image/gif' ? 'GIF banners must be 50 MB or smaller.' : 'JPG, PNG, and WebP banners must be 5 MB or smaller.');
        status.classList.add('is-error');
        this.value = '';
        return;
      }
      status.textContent = '';
      status.classList.remove('is-error');
      modal.querySelector('[data-sml-cbanner-preview-image]').src = URL.createObjectURL(file);
    });
    modal.querySelector('form').addEventListener('submit', function (event) {
      event.preventDefault();
      save(modal, false);
    });
    state.modal = modal;
    return modal;
  }

  function openEditor() {
    var channelId = activeChannelId();
    if (!state.canManage || !channelId) return;
    state.channelId = channelId;
    var modal = ensureModal();
    var form = modal.querySelector('form');
    var entry = state.banners[String(channelId)] || { zoom: 100, pos_x: 50, pos_y: 50, url: '' };
    form.reset();
    form.elements.zoom.value = entry.zoom;
    form.elements.pos_x.value = entry.pos_x;
    form.elements.pos_y.value = entry.pos_y;
    modal.querySelector('[data-sml-cbanner-preview-image]').src = entry.url || '';
    modal.querySelector('[data-sml-cbanner-status]').textContent = '';
    modal.querySelector('[data-sml-cbanner-status]').classList.remove('is-error');
    updatePreview(modal);
    modal.hidden = false;
  }

  function save(modal, remove) {
    var form = modal.querySelector('form');
    var status = modal.querySelector('[data-sml-cbanner-status]');
    var submit = form.querySelector('button[type="submit"]');
    var data = new FormData();
    data.append('group_id', String(groupId));
    data.append('channel_id', String(state.channelId));
    data.append('zoom', form.elements.zoom.value);
    data.append('pos_x', form.elements.pos_x.value);
    data.append('pos_y', form.elements.pos_y.value);
    if (remove) data.append('remove', '1');
    if (!remove && form.elements.banner.files[0]) data.append('banner', form.elements.banner.files[0], form.elements.banner.files[0].name);
    status.textContent = remove ? 'Removing banner…' : 'Saving banner…';
    status.classList.remove('is-error');
    submit.disabled = true;
    request('visual', { method: 'POST', body: data }).then(function (payload) {
      if (payload.banner) state.banners[String(state.channelId)] = payload.banner;
      else delete state.banners[String(state.channelId)];
      render();
      status.textContent = remove ? 'Banner removed.' : 'Banner saved.';
      window.setTimeout(function () { modal.hidden = true; }, 450);
    }).catch(function (error) {
      status.textContent = error.message || 'The channel banner could not be saved.';
      status.classList.add('is-error');
    }).then(function () { submit.disabled = false; });
  }

  function sweep() {
    state.queued = false;
    render();
    menu();
  }

  document.addEventListener('click', function (event) {
    var conversationAction = event.target.closest('.sml-gshell__owner-menu button');
    if (conversationAction && /^channel background$/i.test(String(conversationAction.textContent || '').trim())) {
      [0, 60, 180].forEach(function (delay) {
        window.setTimeout(function () {
          var conversationModal = root.querySelector('.sml-gshell__channel-watermark-modal');
          if (conversationModal) conversationModal.hidden = false;
        }, delay);
      });
      return;
    }
    if (event.target.closest('[data-sml-cbanner-open]')) {
      event.preventDefault();
      openEditor();
      return;
    }
    if (event.target.closest('.sml-gshell__channel,.sml-gshell__portal-channel')) {
      window.setTimeout(sweep, 0);
    }
  }, true);

  new MutationObserver(function () {
    if (state.queued) return;
    state.queued = true;
    window.requestAnimationFrame(sweep);
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  request('groups/' + groupId + '/visuals').then(function (payload) {
    state.banners = payload.banners || {};
    state.canManage = !!payload.can_manage;
    root.setAttribute('data-sml-cbanner-state', state.canManage ? 'ready-owner' : 'ready-viewer');
    sweep();
  }).catch(function () {
    root.setAttribute('data-sml-cbanner-state', 'request-error');
    sweep();
  });
})();
