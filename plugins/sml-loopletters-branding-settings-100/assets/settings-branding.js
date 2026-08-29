(function () {
  'use strict';
  var cfg = window.SMLLetterBranding || {};
  var root = document.getElementById('le-root');
  if (!cfg.rest || !root) { return; }

  var state = { logoId: 0, logoUrl: '', backgroundId: 0, backgroundUrl: '', font: 'grotesk' };
  var loaded = false;
  var injecting = false;
  var fonts = [
    ['grotesk','Space Grotesk'], ['inter','Inter'], ['manrope','Manrope'], ['dm-sans','DM Sans'],
    ['poppins','Poppins'], ['montserrat','Montserrat'], ['archivo','Archivo'], ['serif','Classic Serif'],
    ['playfair','Playfair Display'], ['merriweather','Merriweather'], ['lora','Lora'], ['roboto-slab','Roboto Slab']
  ];

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function json(path, options) {
    options = options || {};
    var headers = {Accept:'application/json','X-WP-Nonce':cfg.nonce};
    if (options.body) { headers['Content-Type'] = 'application/json'; }
    return fetch(cfg.rest + path, { method: options.method || 'GET', credentials:'same-origin', cache:'no-store', headers:headers, body:options.body ? JSON.stringify(options.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { throw new Error(d.message || 'Request failed.'); } return d; }); });
  }
  function status(message, bad) { var n = document.getElementById('sml-lb-status'); if (n) { n.textContent = message || ''; n.classList.toggle('is-bad', !!bad); } }
  function preview(slot) {
    var box = document.querySelector('[data-lb-preview="' + slot + '"]');
    if (!box) { return; }
    var url = slot === 'logo' ? state.logoUrl : state.backgroundUrl;
    box.innerHTML = url ? '<img src="' + esc(url) + '" alt="">' : '<span>' + (slot === 'logo' ? 'Your publication logo' : 'Your publication background') + '</span>';
    box.classList.toggle('has-image', !!url);
    var remove = document.querySelector('[data-lb-remove="' + slot + '"]');
    if (remove) { remove.hidden = !url; }
  }
  function markup() {
    return '<section class="sml-lb-branding le-settings-field wide">'
      + '<div class="sml-lb-title"><div><b>Publication branding</b><span>Use real images instead of initials and style your public newsletter homepage.</span></div></div>'
      + '<div class="sml-lb-grid">'
      + mediaCard('logo','Newsletter logo / avatar','Square JPG, PNG, GIF, or WebP. Shown instead of initials like VM.')
      + mediaCard('background','Homepage background','Wide images work best. A contrast layer keeps every headline readable.')
      + '</div><label class="sml-lb-font"><span>Publication font</span><select id="sml-lb-font">'
      + fonts.map(function (f) { return '<option value="' + f[0] + '"' + (state.font === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('')
      + '</select><em id="sml-lb-font-preview">Making Easy Money — market insight that moves</em></label>'
      + '<p id="sml-lb-status" class="sml-lb-status" aria-live="polite"></p></section>';
  }
  function mediaCard(slot, title, hint) {
    return '<div class="sml-lb-media sml-lb-media--' + slot + '"><div class="sml-lb-preview" data-lb-preview="' + slot + '"></div>'
      + '<div class="sml-lb-media-copy"><b>' + title + '</b><span>' + hint + '</span><div class="sml-lb-actions">'
      + '<button type="button" class="cs-btn" data-lb-pick="' + slot + '">Upload / replace</button>'
      + '<button type="button" class="cs-btn sml-lb-remove" data-lb-remove="' + slot + '" hidden>Remove</button></div></div>'
      + '<input type="file" data-lb-file="' + slot + '" accept="image/jpeg,image/png,image/gif,image/webp" hidden></div>';
  }
  function inject() {
    if (injecting || !loaded || document.querySelector('.sml-lb-branding') || !root.querySelector('[data-settings-save]')) { return; }
    var grid = root.querySelector('.le-settings-grid');
    if (!grid) { return; }
    injecting = true;
    grid.insertAdjacentHTML('beforeend', markup());
    preview('logo'); preview('background');
    var select = document.getElementById('sml-lb-font');
    if (select) { select.addEventListener('change', function () { state.font = select.value; paintFont(); }); paintFont(); }
    injecting = false;
  }
  function paintFont() {
    var sample = document.getElementById('sml-lb-font-preview');
    if (!sample) { return; }
    var stacks = {'grotesk':'Space Grotesk','inter':'Inter','manrope':'Manrope','dm-sans':'DM Sans','poppins':'Poppins','montserrat':'Montserrat','archivo':'Archivo','serif':'Georgia','playfair':'Playfair Display','merriweather':'Merriweather','lora':'Lora','roboto-slab':'Roboto Slab'};
    sample.style.fontFamily = '"' + (stacks[state.font] || 'Space Grotesk') + '", system-ui, sans-serif';
  }
  function upload(slot, file) {
    if (!file) { return; }
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) { status('Use a JPG, PNG, GIF, or WebP image.', true); return; }
    if (file.size > 10485760) { status('Images must be 10 MB or smaller.', true); return; }
    var data = new FormData(); data.append('slot', slot); data.append('file', file, file.name);
    status('Uploading ' + (slot === 'logo' ? 'logo' : 'background') + '…');
    fetch(cfg.rest + '/media', {method:'POST',credentials:'same-origin',headers:{'X-WP-Nonce':cfg.nonce},body:data})
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { throw new Error(d.message || 'Upload failed.'); } return d; }); })
      .then(function (d) { state[slot + 'Id'] = Number(d.id || 0); state[slot + 'Url'] = d.url || ''; preview(slot); status('Image uploaded. Save newsletter settings to keep all changes together.'); })
      .catch(function (e) { status(e.message, true); });
  }
  function save() {
    status('Saving publication branding…');
    return json('/settings', {method:'POST', body:{logoId:state.logoId,backgroundId:state.backgroundId,font:state.font}})
      .then(function (d) { state = Object.assign(state, d || {}); status('Publication branding saved.'); })
      .catch(function (e) { status('Branding was not saved: ' + e.message, true); });
  }

  root.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-lb-pick]');
    if (pick) { var input = root.querySelector('[data-lb-file="' + pick.getAttribute('data-lb-pick') + '"]'); if (input) { input.click(); } return; }
    var remove = e.target.closest('[data-lb-remove]');
    if (remove) { var slot = remove.getAttribute('data-lb-remove'); state[slot + 'Id'] = 0; state[slot + 'Url'] = ''; preview(slot); status('Image removed. Click Save newsletter settings to apply.'); return; }
    if (e.target.closest('[data-settings-save]')) { save(); }
  }, true);
  root.addEventListener('change', function (e) { if (e.target.matches('[data-lb-file]')) { upload(e.target.getAttribute('data-lb-file'), e.target.files && e.target.files[0]); } });

  new MutationObserver(inject).observe(root, {childList:true,subtree:true});
  json('/settings').then(function (d) { state = Object.assign(state, d || {}); loaded = true; inject(); }).catch(function (e) { loaded = true; inject(); status(e.message, true); });
}());

