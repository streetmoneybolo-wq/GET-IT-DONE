(function () {
	'use strict';

	var cfg = window.smlLettersConfig || {};
	var root = document.getElementById('le-root');
	var side = document.getElementById('le-side');
	var main = document.querySelector('.cs-main');
	var originalTop = document.querySelector('.cs-top');
	var studioSettings = document.getElementById('le-settings');
	if (!root || !side || !main) { return; }
	document.body.classList.add('lh-writer-mode');

	var homeSettings = null;
	var homeLoading = false;
	var itemsCache = [];
	var drawerOpen = false;
	var rerendering = false;
	var requestedOpenId = new URLSearchParams(window.location.search).get('sml_llw_edit');
	var requestedNew = new URLSearchParams(window.location.search).get('sml_llw_new') === '1';
	var requestedOpenAttempts = 0;

	function refreshRefs() {
		root = document.getElementById('le-root') || root;
		side = document.getElementById('le-side') || side;
		main = document.querySelector('.cs-main') || main;
		originalTop = document.querySelector('.cs-top') || originalTop;
		studioSettings = document.getElementById('le-settings') || studioSettings;
	}

	function esc(value) {
		return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
		});
	}

	function request(path, options) {
		options = options || {};
		var headers = { Accept: 'application/json' };
		if (cfg.nonce) { headers['X-WP-Nonce'] = cfg.nonce; }
		if (options.json) { headers['Content-Type'] = 'application/json'; }
		return fetch('/wp-json/sml-loopletters/v1' + path, {
			method: options.method || 'GET',
			credentials: 'same-origin',
			cache: 'no-store',
			headers: headers,
			body: options.json ? JSON.stringify(options.json) : undefined
		}).then(function (response) {
			return response.json().catch(function () { return {}; }).then(function (payload) {
				if (!response.ok) {
					throw new Error(payload.message || 'Request failed.');
				}
				return payload;
			});
		});
	}

	function defaults() {
		var displayName = cfg.displayName || 'Stock Market Loop';
		var initials = displayName.split(/\s+/).map(function (part) { return part.charAt(0); }).join('').slice(0, 2).toUpperCase() || 'SL';
		return {
			name: displayName,
			handle: cfg.handle || 'publication',
			tagline: 'Market analysis, alerts, and ideas from ' + displayName + '.',
			topics: [],
			cadence: '',
			visibility: 'public',
			welcome_subject: '',
			welcome_body: '',
			accent: '#00ff88',
			font: 'grotesk',
			layout: 'list',
			logo: initials,
			logoImageId: 0,
			logoImageUrl: '',
			backgroundImageId: 0,
			backgroundImageUrl: '',
			sections: { hero: true, about: true, social: true, featured: true, topics: true },
			signup_copy: 'Sign up now to get access to the library of members-only issues.',
			signup_button: 'Subscribe',
			footer_note: 'Powered by Loop Hub',
			social_x: '',
			social_youtube: '',
			social_discord: '',
			publicUrl: ''
		};
	}

	function normalizeSettings(data) {
		var base = defaults();
		data = data || {};
		Object.keys(base).forEach(function (key) {
			if (data[key] !== undefined && data[key] !== null && data[key] !== '') { base[key] = data[key]; }
		});
		base.sections = Object.assign({}, defaults().sections, data.sections || {});
		base.handle = data.handle || cfg.handle || base.handle;
		base.publicUrl = data.publicUrl || (base.handle ? window.location.origin + '/n/' + encodeURIComponent(base.handle) + '/' : '');
		return base;
	}

	function loadHomeSettings() {
		if (homeLoading) { return; }
		homeLoading = true;
		request('/settings').then(function (data) {
			homeSettings = normalizeSettings(data);
			homeLoading = false;
			if (document.body.classList.contains('lh-dashboard-mode')) { renderDashboard(itemsCache); }
		}).catch(function () {
			homeSettings = normalizeSettings({});
			homeLoading = false;
		});
	}

	function collectItems() {
		var rows = Array.prototype.slice.call(root.querySelectorAll('.le-item'));
		return rows.map(function (row) {
			var title = row.querySelector('b');
			var meta = row.querySelector('small');
			var status = row.querySelector('.le-pill:not(.paid)');
			var openId = row.getAttribute('data-open') || '';
			var del = row.querySelector('[data-del]');
			var text = meta ? meta.textContent.trim() : '';
			var tickerMatch = text.match(/\$[A-Z]{1,6}/g) || [];
			return {
				id: openId,
				title: title ? title.textContent.trim() : 'Untitled letter',
				meta: text,
				status: status ? status.textContent.trim().toLowerCase() : 'draft',
				tickers: tickerMatch,
				deleteId: del ? del.getAttribute('data-del') : '',
				deleteStatus: del ? del.getAttribute('data-status') : 'draft',
				deleteLabel: del ? del.textContent.trim() : 'Delete'
			};
		});
	}

	function ensureTopbar() {
		refreshRefs();
		var bar = document.getElementById('lh-studio-topbar');
		if (bar) { return bar; }
		bar = document.createElement('header');
		bar.id = 'lh-studio-topbar';
		bar.className = 'lh-studio-topbar';
		bar.innerHTML = '<a class="lh-top-brand" href="/"><i></i><span>LOOP HUB</span></a>'
			+ '<nav class="lh-top-nav" aria-label="Loop Hub"><a href="/watch/">Watch</a><a href="/go-live/">Live</a>'
			+ '<a href="/loop-letters/" aria-current="page">Newsletters</a><a href="/stock-chart/">Markets</a></nav>'
			+ '<span class="lh-top-spacer"></span>'
			+ '<button class="lh-action" type="button" data-lh-studio-settings>Newsletter settings</button>'
			+ '<button class="lh-action" type="button" data-lh-edit>Edit publication</button>'
			+ '<button class="lh-action lh-action--primary" type="button" data-lh-new>Write letter</button>';
		main.insertBefore(bar, originalTop || main.firstChild);
		bar.addEventListener('click', function (event) {
			if (event.target.closest('[data-lh-new]')) {
				window.location.assign(window.location.pathname + '?sml_llw_new=1');
			}
			if (event.target.closest('[data-lh-edit]')) { openDrawer(); }
			if (event.target.closest('[data-lh-studio-settings]') && studioSettings) { studioSettings.click(); }
		});
		return bar;
	}

	function tickerTopics(items) {
		var tickers = [];
		items.forEach(function (item) {
			(item.tickers || []).forEach(function (ticker) {
				if (tickers.indexOf(ticker) === -1) { tickers.push(ticker); }
			});
		});
		return tickers.slice(0, 10);
	}

	function issueMarkup(item) {
		var status = item.status || 'draft';
		var tag = item.tickers.length ? item.tickers.join(' / ') : (status === 'published' ? 'PUBLISHED ISSUE' : 'WORK IN PROGRESS');
		return '<article class="lh-issue" data-open="' + esc(item.id) + '">'
			+ '<div><div class="lh-issue-tag">' + esc(tag) + '</div><h3>' + esc(item.title) + '</h3>'
			+ '<p>' + esc(item.meta || 'Continue writing and add ticker mentions before publishing.') + '</p></div>'
			+ '<div class="lh-issue-side"><span class="lh-status ' + esc(status) + '">' + esc(status.toUpperCase()) + '</span>'
			+ (item.deleteId ? '<button class="lh-delete" type="button" data-del="' + esc(item.deleteId) + '" data-status="' + esc(item.deleteStatus) + '">' + esc(item.deleteLabel) + '</button>' : '')
			+ '</div></article>';
	}

	function drawerMarkup(settings) {
		var accents = ['#00ff88', '#00ccff', '#ffb020', '#ff5c7a', '#b98cff'];
		var layouts = ['list', 'grid', 'magazine'];
		var fonts = [['grotesk', 'Space Grotesk'], ['inter', 'Inter'], ['manrope', 'Manrope'], ['dm-sans', 'DM Sans'], ['poppins', 'Poppins'], ['montserrat', 'Montserrat'], ['archivo', 'Archivo'], ['serif', 'Classic Serif'], ['playfair', 'Playfair Display'], ['merriweather', 'Merriweather'], ['lora', 'Lora'], ['roboto-slab', 'Roboto Slab']];
		var sectionLabels = { hero: 'Latest issue hero', about: 'About and signup', social: 'Social links', featured: 'Featured issues', topics: 'Topics list' };
		return '<div class="lh-editor-mask' + (drawerOpen ? ' is-open' : '') + '" data-lh-close></div>'
			+ '<aside class="lh-editor' + (drawerOpen ? ' is-open' : '') + '" aria-label="Edit publication">'
			+ '<div class="lh-editor-head"><b>EDIT PUBLICATION</b><button class="lh-editor-close" type="button" data-lh-close aria-label="Close">&times;</button></div>'
			+ '<div class="lh-editor-body">'
			+ '<div class="lh-fieldset"><label>IDENTITY</label><input class="lh-input" data-lh-field="name" value="' + esc(settings.name) + '" placeholder="Publication name">'
			+ '<input class="lh-input" data-lh-field="handle" value="' + esc(settings.handle) + '" placeholder="Handle">'
			+ '<input class="lh-input" data-lh-field="tagline" value="' + esc(settings.tagline) + '" placeholder="Tagline">'
			+ '<input class="lh-input" data-lh-field="logo" maxlength="2" value="' + esc(settings.logo) + '" placeholder="Logo initials"></div>'
			+ '<div class="lh-fieldset"><label>ACCENT</label><div class="lh-swatches">'
			+ accents.map(function (accent) { return '<button type="button" class="lh-swatch' + (accent === settings.accent ? ' is-on' : '') + '" style="--swatch:' + accent + '" data-lh-accent="' + accent + '" aria-label="' + accent + '"></button>'; }).join('')
			+ '</div></div><div class="lh-fieldset"><label>TYPE</label><div class="lh-segments">'
			+ fonts.map(function (font) { return '<button type="button" class="lh-segment' + (font[0] === settings.font ? ' is-on' : '') + '" data-lh-font="' + font[0] + '">' + font[1] + '</button>'; }).join('')
			+ '</div></div><div class="lh-fieldset"><label>LAYOUT</label><div class="lh-segments">'
			+ layouts.map(function (layout) { return '<button type="button" class="lh-segment' + (layout === settings.layout ? ' is-on' : '') + '" data-lh-layout="' + layout + '">' + layout.charAt(0).toUpperCase() + layout.slice(1) + '</button>'; }).join('')
			+ '</div></div><div class="lh-fieldset"><label>SECTIONS</label>'
			+ Object.keys(sectionLabels).map(function (key) { return '<label class="lh-toggle-row"><span>' + sectionLabels[key] + '</span><input type="checkbox" data-lh-section="' + key + '"' + (settings.sections[key] ? ' checked' : '') + '></label>'; }).join('')
			+ '</div><div class="lh-fieldset"><label>SIGNUP</label><textarea class="lh-textarea" data-lh-field="signup_copy">' + esc(settings.signup_copy) + '</textarea>'
			+ '<input class="lh-input" data-lh-field="signup_button" value="' + esc(settings.signup_button) + '" placeholder="Button label"></div>'
			+ '<div class="lh-fieldset"><label>SOCIAL LINKS</label><input class="lh-input" data-lh-field="social_x" value="' + esc(settings.social_x) + '" placeholder="X / Twitter URL">'
			+ '<input class="lh-input" data-lh-field="social_youtube" value="' + esc(settings.social_youtube) + '" placeholder="YouTube URL">'
			+ '<input class="lh-input" data-lh-field="social_discord" value="' + esc(settings.social_discord) + '" placeholder="Discord URL"></div>'
			+ '<div class="lh-fieldset"><label>FOOTER</label><input class="lh-input" data-lh-field="footer_note" value="' + esc(settings.footer_note) + '"></div>'
			+ '<button class="lh-action lh-action--primary" type="button" data-lh-save>Publish changes</button><div class="lh-save-state" data-lh-save-state></div>'
			+ '</div></aside>';
	}

	function logoMarkup(settings) {
		return '<div class="lh-logo">' + (settings.logoImageUrl
			? '<img src="' + esc(settings.logoImageUrl) + '" alt="' + esc(settings.name || 'Publication') + ' logo">'
			: esc(settings.logo)) + '</div>';
	}

	function renderDashboard(items) {
		if (rerendering) { return; }
		rerendering = true;
		itemsCache = items.slice();
		var settings = homeSettings || normalizeSettings({});
		document.documentElement.style.setProperty('--lh-accent', settings.accent);
		document.body.classList.remove('lh-returning-to-dashboard');
		document.body.classList.add('lh-dashboard-mode');
		ensureTopbar();

		var latest = items[0] || null;
		var remaining = latest && settings.sections.hero ? items.slice(1) : items;
		var topics = (settings.topics || []).filter(Boolean).concat(tickerTopics(items)).filter(function (value, index, all) { return all.indexOf(value) === index; }).slice(0, 12);
		var publishedCount = items.filter(function (item) { return item.status === 'published'; }).length;
		var publicUrl = settings.publicUrl || '#';

		var dashboardClass = 'lh-studio-dashboard lh-font-' + esc(settings.font || 'grotesk') + (settings.backgroundImageUrl ? ' lh-has-background' : '');
		var dashboardStyle = settings.backgroundImageUrl ? ' style="--lh-dashboard-bg:url(&quot;' + esc(settings.backgroundImageUrl) + '&quot;)"' : '';
		root.innerHTML = '<div class="' + dashboardClass + '"' + dashboardStyle + '>'
			+ '<section class="lh-masthead"><div class="lh-identity">' + logoMarkup(settings) + '<div>'
			+ '<div class="lh-kicker">PUBLICATION DASHBOARD</div><h1 class="lh-title">' + esc(settings.name) + '</h1><p class="lh-tagline">' + esc(settings.tagline) + '</p></div></div>'
			+ '<div class="lh-mast-actions"><button class="lh-action" type="button" data-lh-edit>Edit publication</button>'
			+ (settings.handle ? '<a class="lh-action" href="' + esc(publicUrl) + '" target="_blank" rel="noopener">View publication</a>' : '')
			+ '<button class="lh-action lh-action--primary" type="button" data-new>Write a letter</button></div></section>'
			+ '<div class="lh-content"><main class="lh-main">'
			+ (latest && settings.sections.hero ? '<section class="lh-hero"><div class="lh-issue-tag">LATEST · ' + esc(latest.status.toUpperCase()) + '</div><h2>' + esc(latest.title) + '</h2>'
				+ '<p>' + esc(latest.meta || 'Continue building your latest market letter.') + '</p><div class="lh-meta">Bound to your creator profile and ticker distribution</div>'
				+ '<div class="lh-hero-actions"><button class="lh-action lh-action--primary" type="button" data-open="' + esc(latest.id) + '">Continue editing</button>'
				+ (latest.deleteId ? '<button class="lh-action" type="button" data-del="' + esc(latest.deleteId) + '" data-status="' + esc(latest.deleteStatus) + '">' + esc(latest.deleteLabel) + '</button>' : '') + '</div></section>' : '')
			+ '<div class="lh-list-head"><h2>' + (latest && settings.sections.hero ? 'More issues' : 'Your issues') + '</h2><span class="lh-layout-label">' + esc(settings.layout) + ' view</span></div>'
			+ (remaining.length ? '<section class="lh-issues is-' + esc(settings.layout) + '">' + remaining.map(issueMarkup).join('') + '</section>' : '<div class="lh-empty">No additional issues yet. Start a new letter when you are ready.</div>')
			+ '</main><aside class="lh-rail">'
			+ (settings.sections.about ? '<section class="lh-rail-block"><div class="lh-section-label">ABOUT</div><div class="lh-about-head">' + logoMarkup(settings) + '<div><b>' + esc(settings.name) + '</b><span>@' + esc(settings.handle) + '</span></div></div><p class="lh-rail-copy">' + esc(settings.signup_copy) + '</p></section>' : '')
			+ '<section class="lh-rail-block"><div class="lh-section-label">PUBLICATION STATUS</div><div class="lh-stat-grid"><div class="lh-stat"><strong>' + items.length + '</strong><span>Total issues</span></div><div class="lh-stat"><strong>' + publishedCount + '</strong><span>Published</span></div></div></section>'
			+ (settings.sections.topics ? '<section class="lh-rail-block"><div class="lh-section-label">TOPICS</div><div class="lh-topics">' + (topics.length ? topics.map(function (topic) { return '<span class="lh-topic">' + esc(topic) + '</span>'; }).join('') : '<span class="lh-rail-copy">Ticker topics appear as you write.</span>') + '</div></section>' : '')
			+ '<section class="lh-rail-block"><div class="lh-section-label">DISTRIBUTION</div><p class="lh-rail-copy">Public letters publish to your profile and the ticker pages you mention. Drafts remain private until you publish.</p></section>'
			+ '</aside></div>' + drawerMarkup(settings) + '</div>';
		rerendering = false;
	}

	function openDrawer() {
		drawerOpen = true;
		if (!homeSettings) { homeSettings = normalizeSettings({}); }
		renderDashboard(itemsCache);
	}

	function closeDrawer() {
		drawerOpen = false;
		renderDashboard(itemsCache);
	}

	function collectDrawer() {
		var settings = normalizeSettings(homeSettings || {});
		Array.prototype.forEach.call(root.querySelectorAll('[data-lh-field]'), function (field) {
			settings[field.getAttribute('data-lh-field')] = field.value.trim();
		});
		settings.sections = Object.assign({}, settings.sections);
		Array.prototype.forEach.call(root.querySelectorAll('[data-lh-section]'), function (field) {
			settings.sections[field.getAttribute('data-lh-section')] = field.checked;
		});
		return settings;
	}

	function saveDrawer() {
		var button = root.querySelector('[data-lh-save]');
		var state = root.querySelector('[data-lh-save-state]');
		var settings = collectDrawer();
		if (button) { button.disabled = true; button.textContent = 'Publishing...'; }
		if (state) { state.textContent = ''; }
		var payload = {
			name: settings.name,
			handle: settings.handle,
			tagline: settings.tagline,
			topics: settings.topics || [],
			cadence: settings.cadence || '',
			visibility: settings.visibility || 'public',
			welcome_subject: settings.welcome_subject || '',
			welcome_body: settings.welcome_body || '',
			accent: settings.accent,
			font: settings.font,
			layout: settings.layout,
			logo: settings.logo,
			sections: settings.sections,
			signup_copy: settings.signup_copy,
			signup_button: settings.signup_button,
			footer_note: settings.footer_note,
			social_x: settings.social_x,
			social_youtube: settings.social_youtube,
			social_discord: settings.social_discord
		};
		request('/settings', { method: 'POST', json: payload }).then(function (data) {
			homeSettings = normalizeSettings(data);
			drawerOpen = false;
			renderDashboard(itemsCache);
		}).catch(function (error) {
			if (button) { button.disabled = false; button.textContent = 'Publish changes'; }
			if (state) { state.textContent = error.message; }
		});
	}

	function handleRootClick(event) {
		var target = event.target;
		var open = target.closest('[data-open]');
		if (open && root.querySelector('.lh-studio-dashboard')) {
			event.preventDefault();
			event.stopImmediatePropagation();
			var openId = String(open.getAttribute('data-open') || '').replace(/[^0-9]/g, '');
			if (openId) {
				window.location.assign(window.location.pathname + '?sml_llw_edit=' + encodeURIComponent(openId));
			}
			return;
		}
		if (target.closest('[data-new]') && root.querySelector('.lh-studio-dashboard')) {
			event.preventDefault();
			event.stopImmediatePropagation();
			window.location.assign(window.location.pathname + '?sml_llw_new=1');
			return;
		}
		if (target.closest('[data-lh-edit]')) { event.preventDefault(); event.stopPropagation(); openDrawer(); return; }
		if (target.closest('[data-lh-close]')) { event.preventDefault(); event.stopPropagation(); closeDrawer(); return; }
		if (target.closest('[data-lh-save]')) { event.preventDefault(); event.stopPropagation(); saveDrawer(); return; }
		var accent = target.closest('[data-lh-accent]');
		if (accent) { homeSettings.accent = accent.getAttribute('data-lh-accent'); renderDashboard(itemsCache); return; }
		var font = target.closest('[data-lh-font]');
		if (font) { homeSettings.font = font.getAttribute('data-lh-font'); renderDashboard(itemsCache); return; }
		var layout = target.closest('[data-lh-layout]');
		if (layout) { homeSettings.layout = layout.getAttribute('data-lh-layout'); renderDashboard(itemsCache); }
	}

	function bindRootEvents() {
		if (!root || root.getAttribute('data-lh-writer-bound') === '1') { return; }
		root.setAttribute('data-lh-writer-bound', '1');
		root.addEventListener('click', handleRootClick);
	}

	function leaveDashboard() {
		document.body.classList.remove('lh-dashboard-mode');
		drawerOpen = false;
	}

	function openRequestedLetter() {
		if (!requestedOpenId && !requestedNew) { return false; }
		leaveDashboard();
		ensureTopbar();
		if (root.querySelector('[data-title]')) {
			requestedOpenId = '';
			requestedNew = false;
			if (window.history && window.history.replaceState) {
				window.history.replaceState({}, '', window.location.pathname);
			}
			return true;
		}
		if (requestedNew) {
			var originalNew = root.querySelector('.le-list') ? root.querySelector('[data-new]') : null;
			if (originalNew && typeof originalNew.click === 'function') { originalNew.click(); }
		} else {
			var safeId = String(requestedOpenId).replace(/[^0-9]/g, '');
			var originalRow = safeId ? root.querySelector('.le-item[data-open="' + safeId + '"]') : null;
			if (originalRow && typeof originalRow.click === 'function') { originalRow.click(); }
		}
		requestedOpenAttempts += 1;
		if (requestedOpenAttempts < 20) { window.setTimeout(sync, 200); }
		return true;
	}

	function sync() {
		window.clearTimeout(sync.timer);
		sync.timer = window.setTimeout(function () {
			refreshRefs();
			bindRootEvents();
			if (openRequestedLetter()) { return; }
			if (rerendering || root.querySelector('.lh-studio-dashboard')) { return; }
			if (root.querySelector('.le-list') || root.querySelector('.le-empty')) {
				var items = collectItems();
				renderDashboard(items);
				if (!homeSettings) { loadHomeSettings(); }
			} else {
				leaveDashboard();
			}
		}, 30);
	}

	ensureTopbar();
	bindRootEvents();
	new MutationObserver(sync).observe(root, { childList: true, subtree: true });
	document.addEventListener('click', function (event) {
		if (event.target.closest('[data-back]')) {
			document.body.classList.add('lh-returning-to-dashboard');
			var backButton = event.target.closest('[data-back]');
			if (backButton) { backButton.textContent = 'Saving and returning...'; }
			window.setTimeout(sync, 750);
		}
	});
	sync();
}());
