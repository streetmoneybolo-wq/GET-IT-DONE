/**
 * Newsletter home — load more, and subscribe.
 *
 * Both behaviours degrade. The subscribe form is a real <form> with a real
 * action, so it works with this file absent; "Load more" is a plain button
 * that is only rendered when there is more to load, and if the script never
 * arrives the reader still has every issue the server printed. Nothing here
 * is required to read the page.
 */
(function () {
	'use strict';

	var CFG = window.SMLLetterHome || {};

	// ------------------------------------------------------------------
	// Load more
	// ------------------------------------------------------------------

	var btn = document.querySelector('[data-lh-more]');
	var list = document.querySelector('[data-lh-list]');

	if (btn && list) {
		btn.addEventListener('click', function () {
			var page = parseInt(btn.getAttribute('data-page'), 10) || 1;
			var idle = btn.textContent;

			btn.disabled = true;
			btn.textContent = 'Loading…';

			// The topic rides on the button, not on CFG: the same script serves
			// the filtered and unfiltered views, and reading it from the URL
			// would break the moment the URL is cleaned up after a redirect.
			var topic = btn.getAttribute('data-topic') || '';
			var base = btn.getAttribute('data-base') || '1';

			var url = CFG.rest + '/issues?handle=' + encodeURIComponent(CFG.handle) +
				'&page=' + page + '&base=' + encodeURIComponent(base) +
				(topic ? '&topic=' + encodeURIComponent(topic) : '');

			fetch(url, { credentials: 'same-origin' })
				.then(function (r) { return r.json(); })
				.then(function (data) {
					if (!data || !data.html) { throw new Error('Nothing came back.'); }

					// Remember where the new rows begin, so focus can be moved
					// there. Without this a keyboard or screen-reader user
					// presses the button and nothing announces that five more
					// issues just appeared below them.
					var first = list.children.length;
					list.insertAdjacentHTML('beforeend', data.html);

					var target = list.children[first];
					if (target) {
						var link = target.querySelector('a');
						if (link) {
							link.setAttribute('tabindex', '-1');
							link.focus({ preventScroll: true });
						}
					}

					btn.setAttribute('data-page', String(page + 1));

					if (data.hasMore) {
						btn.disabled = false;
						btn.textContent = idle;
					} else {
						btn.hidden = true;
					}
				})
				.catch(function () {
					btn.disabled = false;
					btn.textContent = 'Could not load more — try again';
				});
		});
	}

	// ------------------------------------------------------------------
	// Subscribe
	// ------------------------------------------------------------------

	function wireSubscribe(form) {
		form.addEventListener('submit', function (ev) {
			ev.preventDefault();

			var note = form.querySelector('[data-lh-status]');
			var row = form.querySelector('.lh-sub__row');
			var input = form.querySelector('.lh-sub__input');
			var button = form.querySelector('.lh-sub__btn');

			if (!input || !input.value) { return; }

			var idle = button ? button.textContent : 'Subscribe';
			if (button) { button.disabled = true; button.textContent = '…'; }

			function status(msg, kind) {
				if (!note) { return; }
				note.textContent = msg;
				note.className = 'lh-sub__note' + (kind ? ' is-' + kind : '');
			}

			status('Sending…');

			fetch(CFG.rest + '/subscribe', {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': CFG.nonce || ''
				},
				body: JSON.stringify({
					handle: CFG.handle,
					email: input.value,
					source: (form.querySelector('input[name="source"]') || {}).value || 'home'
				})
			})
				.then(function (r) {
					return r.json().then(function (d) {
						if (!r.ok) { throw new Error((d && d.message) || 'Something went wrong.'); }
						return d;
					});
				})
				.then(function (d) {
					// The field is removed rather than cleared. Leaving a
					// filled input beside "check your inbox" invites a second
					// submit, and the next thing that arrives is a duplicate.
					status(d.message || 'Check your inbox to confirm.', 'ok');
					if (row) { row.remove(); }
					if (note) { note.setAttribute('role', 'status'); }
				})
				.catch(function (e) {
					status(e.message, 'error');
					if (button) { button.disabled = false; button.textContent = idle; }
				});
		});
	}

	Array.prototype.forEach.call(
		document.querySelectorAll('[data-lh-subscribe]'),
		wireSubscribe
	);

	// Arriving back from a confirm or unsubscribe link.
	var flag = /[?&]subscribed=1/.test(location.search) ? 'subscribed'
		: (/[?&]unsubscribed=1/.test(location.search) ? 'unsubscribed' : '');

	if (flag) {
		var host = document.querySelector('.lh-side__block') || document.querySelector('.lh-wrap');
		if (host) {
			var p = document.createElement('p');
			p.className = 'lh-sub__note is-ok';
			p.setAttribute('role', 'status');
			p.textContent = (flag === 'subscribed')
				? 'You are subscribed. The next issue will land in your inbox.'
				: 'You have been unsubscribed. No further issues will be sent.';
			host.insertBefore(p, host.firstChild);
		}
		if (window.history && history.replaceState) {
			history.replaceState(null, '', location.pathname);
		}
	}

	// ------------------------------------------------------------------
	// Owner publication editor
	// ------------------------------------------------------------------

	var editButton = document.querySelector('[data-lh-edit]');
	var root = document.querySelector('.lh');
	if (!CFG.canEdit || !editButton || !root) { return; }

	var current = null;
	var drawer = null;

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) { node.className = className; }
		if (typeof text === 'string') { node.textContent = text; }
		return node;
	}

	function field(label, key, type, limit) {
		var wrap = el('label', 'lh-editor__field');
		wrap.appendChild(el('span', 'lh-editor__field-label', label));
		var input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
		input.className = 'lh-editor__input';
		input.setAttribute('data-lh-field', key);
		if (type !== 'textarea') { input.type = type || 'text'; }
		if (limit) { input.maxLength = limit; }
		wrap.appendChild(input);
		return wrap;
	}

	function group(title) {
		var section = el('section', 'lh-editor__group');
		section.appendChild(el('h3', 'lh-editor__group-title', title));
		return section;
	}

	function segmented(key, choices) {
		var box = el('div', 'lh-editor__segments');
		choices.forEach(function (choice) {
			var button = el('button', 'lh-editor__segment', choice[1]);
			button.type = 'button';
			button.setAttribute('data-lh-choice', key);
			button.setAttribute('data-value', choice[0]);
			box.appendChild(button);
		});
		return box;
	}

	function colorChoices() {
		var box = el('div', 'lh-editor__colors');
		['#00ff88', '#00ccff', '#ffb020', '#ff5c7a', '#b98cff'].forEach(function (color) {
			var button = el('button', 'lh-editor__color');
			button.type = 'button';
			button.style.backgroundColor = color;
			button.setAttribute('data-lh-choice', 'accent');
			button.setAttribute('data-value', color);
			button.setAttribute('aria-label', 'Use ' + color + ' accent');
			box.appendChild(button);
		});
		return box;
	}

	function toggle(label, key) {
		var row = el('label', 'lh-editor__toggle');
		row.appendChild(el('span', '', label));
		var input = document.createElement('input');
		input.type = 'checkbox';
		input.setAttribute('data-lh-section-toggle', key);
		row.appendChild(input);
		return row;
	}

	function setText(selector, value) {
		var node = root.querySelector(selector);
		if (node) { node.textContent = value; }
	}

	function applyPreview(data) {
		var accent = data.accent || '#00ff88';
		root.style.setProperty('--lh-accent', accent);
		if (drawer) { drawer.style.setProperty('--lh-accent', accent); }
		var rgb = accent.slice(1).match(/.{2}/g).map(function (part) { return parseInt(part, 16); });
		root.style.setProperty('--lh-accent-rgb', rgb.join(','));
		root.classList.remove('lh--font-grotesk', 'lh--font-serif', 'lh--font-archivo');
		root.classList.add('lh--font-' + (data.font || 'grotesk'));
		root.classList.remove('lh--layout-list', 'lh--layout-grid', 'lh--layout-magazine');
		root.classList.add('lh--layout-' + (data.layout || 'list'));
		setText('.lh-about__name', data.name || 'Untitled publication');
		setText('.lh-about__tagline', data.tagline || '');
		setText('.lh-about__logo', data.logo || (data.name || 'L').slice(0, 2).toUpperCase());
		setText('.lh-about__pitch', data.signup_copy || '');
		setText('.lh-sub__btn', data.signup_button || 'Subscribe');
		Object.keys(data.sections || {}).forEach(function (key) {
			var node = root.querySelector('[data-lh-section="' + key + '"]');
			if (node) { node.hidden = !data.sections[key]; }
		});
	}

	function readForm() {
		var next = JSON.parse(JSON.stringify(current || {}));
		drawer.querySelectorAll('[data-lh-field]').forEach(function (input) {
			next[input.getAttribute('data-lh-field')] = input.value.trim();
		});
		next.sections = next.sections || {};
		drawer.querySelectorAll('[data-lh-section-toggle]').forEach(function (input) {
			next.sections[input.getAttribute('data-lh-section-toggle')] = input.checked;
		});
		['accent', 'font', 'layout'].forEach(function (key) {
			var active = drawer.querySelector('[data-lh-choice="' + key + '"].is-active');
			if (active) { next[key] = active.getAttribute('data-value'); }
		});
		return next;
	}

	function syncControls(data) {
		drawer.querySelectorAll('[data-lh-field]').forEach(function (input) {
			input.value = data[input.getAttribute('data-lh-field')] || '';
		});
		drawer.querySelectorAll('[data-lh-section-toggle]').forEach(function (input) {
			input.checked = data.sections && data.sections[input.getAttribute('data-lh-section-toggle')] !== false;
		});
		drawer.querySelectorAll('[data-lh-choice]').forEach(function (button) {
			var key = button.getAttribute('data-lh-choice');
			button.classList.toggle('is-active', button.getAttribute('data-value') === data[key]);
		});
	}

	function buildDrawer(data) {
		drawer = el('aside', 'lh-editor');
		drawer.setAttribute('aria-label', 'Edit publication');
		var header = el('header', 'lh-editor__head');
		var titleWrap = el('div');
		titleWrap.appendChild(el('p', 'lh-editor__eyebrow', 'Loop Letters'));
		titleWrap.appendChild(el('h2', 'lh-editor__title', 'Edit publication'));
		header.appendChild(titleWrap);
		var close = el('button', 'lh-editor__close', 'Close');
		close.type = 'button';
		close.setAttribute('aria-label', 'Close publication editor');
		header.appendChild(close);
		drawer.appendChild(header);

		var body = el('div', 'lh-editor__body');
		var identity = group('Identity');
		identity.appendChild(field('Publication name', 'name', 'text', 60));
		identity.appendChild(field('Tagline', 'tagline', 'textarea', 160));
		identity.appendChild(field('Logo initials', 'logo', 'text', 2));
		body.appendChild(identity);

		var look = group('Theme and layout');
		look.appendChild(el('p', 'lh-editor__hint', 'Accent'));
		look.appendChild(colorChoices());
		look.appendChild(el('p', 'lh-editor__hint', 'Type'));
		look.appendChild(segmented('font', [['grotesk', 'Grotesk'], ['serif', 'Editorial'], ['archivo', 'Strong']]));
		look.appendChild(el('p', 'lh-editor__hint', 'Issue layout'));
		look.appendChild(segmented('layout', [['list', 'List'], ['grid', 'Grid'], ['magazine', 'Magazine']]));
		body.appendChild(look);

		var sections = group('Sections');
		[['Hero issue', 'hero'], ['About', 'about'], ['Social links', 'social'], ['Featured', 'featured'], ['Topics', 'topics']].forEach(function (item) {
			sections.appendChild(toggle(item[0], item[1]));
		});
		body.appendChild(sections);

		var signup = group('Signup and links');
		signup.appendChild(field('Signup message', 'signup_copy', 'textarea', 240));
		signup.appendChild(field('Button label', 'signup_button', 'text', 28));
		signup.appendChild(field('X / Twitter URL', 'social_x', 'url', 240));
		signup.appendChild(field('YouTube URL', 'social_youtube', 'url', 240));
		signup.appendChild(field('Discord URL', 'social_discord', 'url', 240));
		signup.appendChild(field('Footer label', 'footer_note', 'text', 80));
		body.appendChild(signup);
		drawer.appendChild(body);

		var footer = el('footer', 'lh-editor__foot');
		var status = el('p', 'lh-editor__status', 'Changes preview instantly.');
		status.setAttribute('data-lh-editor-status', '');
		footer.appendChild(status);
		var save = el('button', 'lh-editor__save', 'Publish changes');
		save.type = 'button';
		footer.appendChild(save);
		drawer.appendChild(footer);
		document.body.appendChild(drawer);
		document.body.classList.add('lh-editor-open');
		syncControls(data);
		applyPreview(data);

		drawer.addEventListener('input', function () { applyPreview(readForm()); });
		drawer.addEventListener('click', function (event) {
			var choice = event.target.closest('[data-lh-choice]');
			if (choice) {
				drawer.querySelectorAll('[data-lh-choice="' + choice.getAttribute('data-lh-choice') + '"]').forEach(function (button) {
					button.classList.toggle('is-active', button === choice);
				});
				applyPreview(readForm());
			}
		});
		close.addEventListener('click', closeDrawer);
		save.addEventListener('click', savePublication);
		close.focus();
	}

	function closeDrawer() {
		if (!drawer) { return; }
		drawer.remove();
		drawer = null;
		document.body.classList.remove('lh-editor-open');
		if (current) { applyPreview(current); }
		editButton.focus();
	}

	function savePublication() {
		var next = readForm();
		var status = drawer.querySelector('[data-lh-editor-status]');
		var button = drawer.querySelector('.lh-editor__save');
		button.disabled = true;
		status.textContent = 'Publishing changes...';
		fetch(CFG.rest + '/settings', {
			method: 'POST', credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': CFG.nonce || '' },
			body: JSON.stringify(next)
		}).then(function (response) {
			return response.json().then(function (json) {
				if (!response.ok) { throw new Error((json && json.message) || 'Could not save publication.'); }
				return json;
			});
		}).then(function (saved) {
			current = saved;
			syncControls(saved);
			applyPreview(saved);
			status.textContent = 'Published.';
			button.disabled = false;
		}).catch(function (error) {
			status.textContent = error.message;
			status.classList.add('is-error');
			button.disabled = false;
		});
	}

	editButton.addEventListener('click', function () {
		if (drawer) { return; }
		editButton.disabled = true;
		fetch(CFG.rest + '/settings', {
			credentials: 'same-origin', headers: { 'X-WP-Nonce': CFG.nonce || '' }
		}).then(function (response) {
			if (!response.ok) { throw new Error('Could not load publication settings.'); }
			return response.json();
		}).then(function (settings) {
			current = settings;
			buildDrawer(settings);
		}).catch(function () {
			editButton.textContent = 'Editor unavailable';
		}).finally(function () { editButton.disabled = false; });
	});

	document.addEventListener('keydown', function (event) {
		if (event.key === 'Escape' && drawer) { closeDrawer(); }
	});
}());
