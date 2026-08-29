/**
 * SML Loop Letters — public page enhancement.
 *
 * The subscribe form works without this file: it is a real <form> with a real
 * method and action, and posting it hits the same REST route. All this does is
 * intercept the submit so the reader stays on the letter instead of being
 * bounced to a JSON response. If the script fails to load, subscribing still
 * works — it just navigates.
 */
(function () {
	'use strict';

	var CFG = window.SMLLetterPublic || {};

	function status(form, message, kind) {
		var note = form.querySelector('[data-ll-status]');
		if (!note) { return; }
		note.textContent = message;
		note.className = 'll-sub__note' + (kind ? ' is-' + kind : '');
	}

	function handle(form) {
		form.addEventListener('submit', function (ev) {
			ev.preventDefault();

			var btn = form.querySelector('.ll-sub__btn');
			var email = form.querySelector('.ll-sub__input');
			var idle = btn ? btn.textContent : 'Subscribe';

			if (!email || !email.value) { return; }

			if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
			status(form, 'Sending…');

			fetch(CFG.rest + '/subscribe', {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': CFG.nonce || ''
				},
				body: JSON.stringify({
					handle: CFG.handle,
					email: email.value,
					source: (form.querySelector('input[name="source"]') || {}).value || ''
				})
			})
				.then(function (r) {
					return r.json().then(function (data) {
						if (!r.ok) {
							var e = new Error((data && data.message) || 'Something went wrong.');
							throw e;
						}
						return data;
					});
				})
				.then(function (data) {
					// The form is replaced rather than reset. Leaving a filled
					// field next to "check your inbox" invites a second submit,
					// and the next thing that arrives is a duplicate email.
					status(form, data.message || 'Check your inbox to confirm.', 'ok');
					var row = form.querySelector('.ll-sub__row');
					if (row) { row.remove(); }
					var label = form.querySelector('.ll-sub__label');
					if (label) { label.remove(); }
				})
				.catch(function (e) {
					status(form, e.message, 'error');
					if (btn) { btn.disabled = false; btn.textContent = idle; }
				});
		});
	}

	Array.prototype.forEach.call(
		document.querySelectorAll('[data-ll-subscribe]'),
		handle
	);

	// Arriving back from a confirmation link. The redirect adds ?subscribed=1
	// rather than rendering a separate page, so the reader lands on the
	// publication itself with the confirmation as a note on top of it.
	if (/[?&]subscribed=1/.test(location.search)) {
		var head = document.querySelector('.ll-head');
		if (head) {
			var ok = document.createElement('p');
			ok.className = 'll-sub__note is-ok';
			ok.setAttribute('role', 'status');
			ok.textContent = 'You are subscribed. The next letter will land in your inbox.';
			head.appendChild(ok);
		}
		// Clean the URL so a refresh or a share does not carry the flag.
		if (window.history && history.replaceState) {
			history.replaceState(null, '', location.pathname);
		}
	}
}());
