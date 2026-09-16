/**
 * SML Settings Dashboard (1.4.2).
 *
 * Renders entirely client-side from /me so a page cache can never serve one
 * member's settings to another — the HTML the server emits is identical for
 * everyone. Security tab talks to the SML Two-Step plugin (sml-2step/v1).
 */
(function () {
	'use strict';

	var CFG = window.SMLSettings || {};
	var root = document.getElementById('sml-settings-root');
	if (!root) { return; }

	var me = null;
	var tab = (location.hash || '#profile').replace('#', '');

	var TABS = [
		{ id: 'profile',       label: 'Profile' },
		{ id: 'account',       label: 'Account' },
		{ id: 'security',      label: 'Security' },
		{ id: 'privacy',       label: 'Privacy' },
		{ id: 'notifications', label: 'Notifications' },
		{ id: 'danger',        label: 'Delete account' }
	];

	// ------------------------------------------------------------------
	// Transport
	// ------------------------------------------------------------------

	function call(base, path, opts) {
		opts = opts || {};
		return fetch(base + path, {
			method: opts.method || 'GET',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': CFG.nonce },
			body: opts.body ? JSON.stringify(opts.body) : undefined
		}).then(function (r) {
			return r.json().catch(function () { return {}; }).then(function (data) {
				if (!r.ok) {
					var e = new Error((data && data.message) || 'Something went wrong.');
					e.code = data && data.code; e.status = r.status;
					throw e;
				}
				return data;
			});
		});
	}
	function api(path, opts) { return call(CFG.rest, path, opts); }
	function api2(path, opts) { return call(CFG.twoStepRest || (CFG.rest.replace(/sml-settings\/v1\/?$/, 'sml-2step/v1')), path, opts); }

	// ------------------------------------------------------------------
	// DOM helpers
	// ------------------------------------------------------------------

	function el(tag, cls, text) { var n = document.createElement(tag); if (cls) { n.className = cls; } if (text != null) { n.textContent = text; } return n; }
	function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
	function when(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? '' : new Date(t).toLocaleString(); }

	function field(label, id, opts) {
		opts = opts || {};
		return '<label class="sml-set__field">' +
			'<span class="sml-set__label">' + esc(label) + '</span>' +
			'<input class="sml-set__input" id="' + id + '" type="' + (opts.type || 'text') + '"' +
			(opts.value != null ? ' value="' + esc(opts.value) + '"' : '') +
			(opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
			(opts.autocomplete ? ' autocomplete="' + opts.autocomplete + '"' : '') +
			(opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') +
			(opts.readonly ? ' readonly' : '') +
			' />' +
			(opts.hint ? '<span class="sml-set__hint">' + esc(opts.hint) + '</span>' : '') +
			'</label>';
	}
	function toggle(label, id, checked, hint) {
		return '<label class="sml-set__toggle">' +
			'<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + ' />' +
			'<span class="sml-set__toggle-box" aria-hidden="true"></span>' +
			'<span><span class="sml-set__toggle-label">' + esc(label) + '</span>' +
			(hint ? '<span class="sml-set__hint">' + esc(hint) + '</span>' : '') + '</span>' +
			'</label>';
	}
	function pill(on, onText, offText) { return '<span class="sml-set__pill ' + (on ? 'is-on' : 'is-off') + '">' + esc(on ? onText : offText) + '</span>'; }
	function status(panel, message, kind) {
		var box = panel.querySelector('.sml-set__status');
		if (!box) { return; }
		box.textContent = message;
		box.className = 'sml-set__status' + (kind ? ' is-' + kind : '');
		if (kind === 'ok') { setTimeout(function () { if (box.textContent === message) { box.textContent = ''; box.className = 'sml-set__status'; } }, 4000); }
	}
	function busy(btn, on, idleLabel) { btn.disabled = on; btn.textContent = on ? 'Working…' : idleLabel; }

	/** Inline password confirmation. Resolves with the password, rejects on cancel. */
	function askPassword(host, why) {
		return new Promise(function (resolve, reject) {
			var box = el('div', 'sml-set__confirm');
			box.innerHTML = '<div class="sml-set__confirm-in"><span class="sml-set__label">Confirm your password ' + (why ? '<em>' + esc(why) + '</em>' : '') + '</span>' +
				'<div class="sml-set__row"><input class="sml-set__input" type="password" autocomplete="current-password" placeholder="Your password" />' +
				'<button class="sml-set__btn sml-set__btn--primary" data-ok>Continue</button><button class="sml-set__btn" data-cancel>Cancel</button></div></div>';
			host.appendChild(box);
			var input = box.querySelector('input'); input.focus();
			function done(v) { box.remove(); v == null ? reject(new Error('cancelled')) : resolve(v); }
			box.querySelector('[data-ok]').addEventListener('click', function () { if (input.value) { done(input.value); } });
			input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && input.value) { done(input.value); } });
			box.querySelector('[data-cancel]').addEventListener('click', function () { done(null); });
		});
	}

	function showBackupCodes(host, codes, intro) {
		var box = el('div', 'sml-set__codes');
		box.innerHTML = '<h4>Your backup codes</h4><p class="sml-set__hint">' + esc(intro || 'Each code signs you in once if you cannot use your other methods. Keep them somewhere safe — this is the only time they are shown.') + '</p>' +
			'<div class="sml-set__codes-grid">' + codes.map(function (c) { return '<code>' + esc(c) + '</code>'; }).join('') + '</div>' +
			'<div class="sml-set__row"><button class="sml-set__btn" data-copy>Copy codes</button><button class="sml-set__btn" data-done>I saved them</button></div>';
		host.prepend(box);
		box.querySelector('[data-copy]').addEventListener('click', function () {
			var b = this; try { navigator.clipboard.writeText(codes.join('\n')).then(function () { b.textContent = 'Copied'; }); } catch (e) { b.textContent = 'Select and copy'; }
		});
		box.querySelector('[data-done]').addEventListener('click', function () { box.remove(); });
	}

	// ------------------------------------------------------------------
	// Panels
	// ------------------------------------------------------------------

	var panels = {};

	panels.profile = function () {
		var p = el('div', 'sml-set__panel');
		p.innerHTML =
			'<h2>Profile</h2>' +
			'<p class="sml-set__lede">How you appear across StockMarketLoop.</p>' +
			'<div class="sml-set__idcard">' +
			'  <img src="' + esc(me.avatar) + '" alt="" class="sml-set__avatar" />' +
			'  <div><div class="sml-set__name">' + esc(me.displayName) + '</div>' +
			'  <a class="sml-set__muted" href="' + esc(me.profileUrl) + '">@' + esc(me.handle) + '</a></div>' +
			'  <a class="sml-set__btn sml-set__btn--small" href="' + esc(CFG.links && CFG.links.customize || '/customize-profile/') + '">Customize profile</a>' +
			'</div>' +
			field('Display name', 'set-name', { value: me.displayName, hint: 'Up to 60 characters.' }) +
			'<label class="sml-set__field"><span class="sml-set__label">Bio</span>' +
			'<textarea class="sml-set__input sml-set__textarea" id="set-bio" maxlength="500">' + esc(me.bio || '') + '</textarea>' +
			'<span class="sml-set__hint">Up to 500 characters.</span></label>' +
			'<div class="sml-set__row"><button class="sml-set__btn sml-set__btn--primary" id="set-save">Save changes</button><span class="sml-set__status"></span></div>';

		p.querySelector('#set-save').addEventListener('click', function () {
			var btn = this; busy(btn, true, 'Save changes');
			api('/profile', { method: 'POST', body: { displayName: p.querySelector('#set-name').value, bio: p.querySelector('#set-bio').value } })
				.then(function () { status(p, 'Saved.', 'ok'); me.displayName = p.querySelector('#set-name').value; })
				.catch(function (e) { status(p, e.message, 'error'); })
				.then(function () { busy(btn, false, 'Save changes'); });
		});
		return p;
	};

	panels.account = function () {
		var p = el('div', 'sml-set__panel');
		var pending = me.pendingEmail;
		var L = CFG.links || {};
		var ex = me.dataExport || {};

		p.innerHTML =
			'<h2>Account</h2>' +
			'<section class="sml-set__section">' +
			'  <h3>Email address</h3>' +
			'  <p class="sml-set__lede">Currently <strong>' + esc(me.email) + '</strong></p>' +
			(pending ? '<div class="sml-set__notice">Waiting for you to confirm <strong>' + esc(pending) + '</strong>. Check that inbox for a 6-digit code.</div>' : '') +
			field('New email address', 'set-email', { type: 'email', autocomplete: 'email' }) +
			'  <div class="sml-set__row"><button class="sml-set__btn" id="set-email-send">Send code</button></div>' +
			field('Verification code', 'set-code', { placeholder: '6 digits', autocomplete: 'one-time-code', inputmode: 'numeric' }) +
			'  <div class="sml-set__row"><button class="sml-set__btn sml-set__btn--primary" id="set-email-verify">Confirm new email</button></div>' +
			'</section>' +
			'<section class="sml-set__section">' +
			'  <h3>Password</h3>' +
			'  <p class="sml-set__lede">Changing your password signs out every other device.</p>' +
			field('Current password', 'set-pw-old', { type: 'password', autocomplete: 'current-password' }) +
			field('New password', 'set-pw-new', { type: 'password', autocomplete: 'new-password', hint: 'At least 10 characters. Use a phrase nobody could guess and that you use nowhere else.' }) +
			field('Confirm new password', 'set-pw-new2', { type: 'password', autocomplete: 'new-password' }) +
			'  <div class="sml-set__row"><button class="sml-set__btn sml-set__btn--primary" id="set-pw-save">Change password</button></div>' +
			'</section>' +
			'<section class="sml-set__section">' +
			'  <h3>Your handle</h3>' +
			'  <p class="sml-set__lede">Your public address is <strong>' + esc(me.profileUrl) + '</strong>. Handles are permanent so links to you never break. Member since ' + esc(when(me.registered).split(',')[0] || '') + '.</p>' +
			'</section>' +
			'<section class="sml-set__section">' +
			'  <h3>Billing, payouts &amp; Loop Bucks</h3>' +
			'  <ul class="sml-set__links">' +
			(L.customerDashboard ? '<li><a href="' + esc(L.customerDashboard) + '">Subscriptions &amp; billing</a><span class="sml-set__hint">Memberships, invoices and payment methods.</span></li>' : '') +
			(L.orders ? '<li><a href="' + esc(L.orders) + '">Orders</a><span class="sml-set__hint">Store purchases and receipts.</span></li>' : '') +
			(L.connect ? '<li><a href="' + esc(L.connect) + '">Creator payouts</a><span class="sml-set__hint">Your Stripe Connect payout account.</span></li>' : '') +
			'<li><span>Loop Bucks balance: <strong>' + Number(me.loopBucks || 0).toLocaleString() + ' LB</strong></span>' + (L.loopBucks ? ' <a href="' + esc(L.loopBucks) + '">Earn &amp; spend</a>' : '') + '</li>' +
			'  </ul>' +
			'</section>' +
			'<section class="sml-set__section">' +
			'  <h3>Your data</h3>' +
			'  <p class="sml-set__lede">Get a copy of the personal data StockMarketLoop holds about you. We email you a confirmation link first, then a download link when the file is ready.</p>' +
			(ex.state ? '<div class="sml-set__notice">' + esc(ex.state === 'request-completed' ? 'Your last export is ready — check your email for the download link.' : ex.state === 'request-confirmed' ? 'Your export is being prepared. You will get an email when it is ready.' : 'A request is waiting for you to confirm it from your email.') + '</div>' : '') +
			'  <div class="sml-set__row"><button class="sml-set__btn" id="set-export">Request a copy of my data</button></div>' +
			'</section>' +
			'<div class="sml-set__status"></div>';

		p.querySelector('#set-email-send').addEventListener('click', function () {
			var btn = this; busy(btn, true, 'Send code');
			api('/account/email/request', { method: 'POST', body: { email: p.querySelector('#set-email').value } })
				.then(function (r) { status(p, 'Code sent to ' + r.pendingEmail + '.', 'ok'); })
				.catch(function (e) { status(p, e.message, 'error'); })
				.then(function () { busy(btn, false, 'Send code'); });
		});
		p.querySelector('#set-email-verify').addEventListener('click', function () {
			var btn = this; busy(btn, true, 'Confirm new email');
			api('/account/email/verify', { method: 'POST', body: { code: p.querySelector('#set-code').value } })
				.then(function (r) { me.email = r.email; me.pendingEmail = null; render(); })
				.catch(function (e) { status(p, e.message, 'error'); })
				.then(function () { busy(btn, false, 'Confirm new email'); });
		});
		p.querySelector('#set-pw-save').addEventListener('click', function () {
			var btn = this;
			var a = p.querySelector('#set-pw-new').value, b = p.querySelector('#set-pw-new2').value;
			if (a !== b) { status(p, 'The two new passwords do not match.', 'error'); return; }
			busy(btn, true, 'Change password');
			api('/account/password', { method: 'POST', body: { currentPassword: p.querySelector('#set-pw-old').value, newPassword: a } })
				.then(function () {
					status(p, 'Password changed. Other devices have been signed out.', 'ok');
					p.querySelector('#set-pw-old').value = ''; p.querySelector('#set-pw-new').value = ''; p.querySelector('#set-pw-new2').value = '';
				})
				.catch(function (e) { status(p, e.message, 'error'); })
				.then(function () { busy(btn, false, 'Change password'); });
		});
		p.querySelector('#set-export').addEventListener('click', function () {
			var btn = this; busy(btn, true, 'Request a copy of my data');
			api('/account/export', { method: 'POST' })
				.then(function (r) { me.dataExport = r.dataExport || { state: 'request-pending' }; status(p, 'Check your email to confirm the request.', 'ok'); render(); })
				.catch(function (e) { status(p, e.message, 'error'); busy(btn, false, 'Request a copy of my data'); });
		});
		return p;
	};

	panels.security = function () {
		var p = el('div', 'sml-set__panel');
		var ts = me.twoStep || { enabled: false, totp: false, email: false, backupCodes: 0, trusted: [], loginAlerts: true };

		p.innerHTML =
			'<h2>Security</h2>' +
			'<section class="sml-set__section" id="sec-2s">' +
			'  <h3>Two-step verification ' + pill(ts.enabled, 'On', 'Off') + '</h3>' +
			'  <p class="sml-set__lede">A second check when you sign in from a device we have not seen. Your password alone is never enough.</p>' +
			'  <div class="sml-set__method">' +
			'    <div class="sml-set__method-h"><b>Authenticator app</b> ' + pill(ts.totp, 'On', 'Off') + '<span class="sml-set__hint">Google Authenticator, Authy, 1Password, Microsoft Authenticator or any TOTP app. Works offline.</span></div>' +
			'    <div class="sml-set__row">' + (ts.totp ? '<button class="sml-set__btn" id="sec-totp-off">Turn off</button>' : '<button class="sml-set__btn sml-set__btn--primary" id="sec-totp-on">Set up authenticator</button>') + '</div>' +
			'    <div id="sec-totp-setup"></div>' +
			'  </div>' +
			'  <div class="sml-set__method">' +
			'    <div class="sml-set__method-h"><b>Email codes</b> ' + pill(ts.email, 'On', 'Off') + '<span class="sml-set__hint">A 6-digit code is sent to ' + esc(me.email) + ' when you sign in on a new device.' + (ts.totp ? ' Also available as a fallback for your authenticator.' : '') + '</span></div>' +
			'    <div class="sml-set__row">' + (ts.email ? '<button class="sml-set__btn" id="sec-email-off">Turn off</button>' : '<button class="sml-set__btn sml-set__btn--primary" id="sec-email-on">Turn on email codes</button>') + '</div>' +
			'  </div>' +
			(ts.enabled ?
			'  <div class="sml-set__method">' +
			'    <div class="sml-set__method-h"><b>Backup codes</b> <span class="sml-set__pill is-off">' + ts.backupCodes + ' left</span><span class="sml-set__hint">One-time codes for when you cannot use your phone or email. Regenerating replaces the old set.</span></div>' +
			'    <div class="sml-set__row"><button class="sml-set__btn" id="sec-backup">Generate new backup codes</button></div>' +
			'  </div>' +
			'  <div class="sml-set__method">' +
			'    <div class="sml-set__method-h"><b>Trusted devices</b><span class="sml-set__hint">Devices you told us to trust for 30 days skip the second step.</span></div>' +
			(ts.trusted.length ? '<ul class="sml-set__devices">' + ts.trusted.map(function (d) { return '<li><span class="sml-set__dev-name">' + esc(d.device) + '</span><span class="sml-set__log-meta">' + esc(d.ip || '') + ' · trusted ' + esc(when(d.since)) + ' · until ' + esc(when(d.expires).split(',')[0]) + '</span></li>'; }).join('') + '</ul>' : '<p class="sml-set__muted">No trusted devices.</p>') +
			(ts.trusted.length ? '<div class="sml-set__row"><button class="sml-set__btn" id="sec-trust-forget">Forget all trusted devices</button></div>' : '') +
			'  </div>' : '') +
			'</section>' +
			'<section class="sml-set__section">' +
			'  <h3>Signed-in devices</h3>' +
			'  <p class="sml-set__lede">Everywhere your account is signed in right now. Sign out anything you do not recognise, then change your password.</p>' +
			'  <div id="sec-sessions"><p class="sml-set__muted">Loading…</p></div>' +
			'  <div class="sml-set__row"><button class="sml-set__btn" id="set-revoke">Sign out all other devices</button></div>' +
			'</section>' +
			'<section class="sml-set__section">' +
			toggle('Email me when a new device signs in', 'sec-alerts', ts.loginAlerts, 'Sent to ' + me.email + ' with the device, location and time.') +
			'</section>' +
			'<section class="sml-set__section">' +
			'  <h3>Recent activity</h3>' +
			'  <div id="set-activity"><p class="sml-set__muted">Loading…</p></div>' +
			'</section>' +
			'<div class="sml-set__status"></div>';

		function refresh(st) { me.twoStep = st || me.twoStep; render(); }

		var on = p.querySelector('#sec-totp-on');
		if (on) {
			on.addEventListener('click', function () {
				var btn = this; busy(btn, true, 'Set up authenticator');
				api2('/totp/begin', { method: 'POST' }).then(function (r) {
					var box = p.querySelector('#sec-totp-setup');
					box.innerHTML = '<div class="sml-set__setup">' +
						'<ol class="sml-set__steps"><li>Open your authenticator app and add an account.</li><li>Scan this code, or type the key below it.</li><li>Enter the 6-digit code the app shows to finish.</li></ol>' +
						'<div class="sml-set__qr" id="sec-qr"></div>' +
						'<div class="sml-set__secret"><span class="sml-set__label">Setup key</span><code>' + esc(r.secret.replace(/(.{4})/g, '$1 ').trim()) + '</code></div>' +
						field('Code from the app', 'sec-totp-code', { placeholder: '6 digits', inputmode: 'numeric', autocomplete: 'one-time-code' }) +
						'<div class="sml-set__row"><button class="sml-set__btn sml-set__btn--primary" id="sec-totp-confirm">Turn on</button><button class="sml-set__btn" id="sec-totp-cancel">Cancel</button></div></div>';
					function drawQr() { try { new window.QRCode(box.querySelector('#sec-qr'), { text: r.uri, width: 180, height: 180, colorDark: '#000000', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M }); } catch (e) { box.querySelector('#sec-qr').textContent = 'Type the setup key into your app.'; } }
					if (window.QRCode) { drawQr(); } else if (CFG.qr) { var s = document.createElement('script'); s.src = CFG.qr; s.onload = drawQr; s.onerror = drawQr; document.head.appendChild(s); } else { drawQr(); }
					box.querySelector('#sec-totp-code').focus();
					box.querySelector('#sec-totp-cancel').addEventListener('click', function () { box.innerHTML = ''; busy(btn, false, 'Set up authenticator'); });
					box.querySelector('#sec-totp-confirm').addEventListener('click', function () {
						var b2 = this; busy(b2, true, 'Turn on');
						api2('/totp/confirm', { method: 'POST', body: { code: box.querySelector('#sec-totp-code').value } }).then(function (r2) {
							me.twoStep = r2.status; render();
							var host = document.querySelector('#sec-2s'); if (host && r2.backupCodes) { showBackupCodes(host, r2.backupCodes, 'Authenticator is on. Save these backup codes now — each signs you in once if you lose your phone.'); }
						}).catch(function (e) { status(p, e.message, 'error'); busy(b2, false, 'Turn on'); });
					});
				}).catch(function (e) { status(p, e.message, 'error'); busy(btn, false, 'Set up authenticator'); });
			});
		}
		var off = p.querySelector('#sec-totp-off');
		if (off) {
			off.addEventListener('click', function () {
				askPassword(p.querySelector('#sec-2s'), 'to turn off the authenticator').then(function (pw) {
					return api2('/totp/disable', { method: 'POST', body: { password: pw } }).then(function (r) { refresh(r.status); });
				}).catch(function (e) { if (e.message !== 'cancelled') { status(p, e.message, 'error'); } });
			});
		}
		var eon = p.querySelector('#sec-email-on');
		if (eon) {
			eon.addEventListener('click', function () {
				var btn = this; busy(btn, true, 'Turn on email codes');
				api2('/email/set', { method: 'POST', body: { on: true } }).then(function (r) {
					me.twoStep = r.status; render();
					var host = document.querySelector('#sec-2s'); if (host && r.backupCodes) { showBackupCodes(host, r.backupCodes, 'Email codes are on. Save these backup codes — each signs you in once if you cannot get email.'); }
				}).catch(function (e) { status(p, e.message, 'error'); busy(btn, false, 'Turn on email codes'); });
			});
		}
		var eoff = p.querySelector('#sec-email-off');
		if (eoff) {
			eoff.addEventListener('click', function () {
				askPassword(p.querySelector('#sec-2s'), 'to turn off email codes').then(function (pw) {
					return api2('/email/set', { method: 'POST', body: { on: false, password: pw } }).then(function (r) { refresh(r.status); });
				}).catch(function (e) { if (e.message !== 'cancelled') { status(p, e.message, 'error'); } });
			});
		}
		var bk = p.querySelector('#sec-backup');
		if (bk) {
			bk.addEventListener('click', function () {
				askPassword(p.querySelector('#sec-2s'), 'to generate new backup codes').then(function (pw) {
					return api2('/backup/regenerate', { method: 'POST', body: { password: pw } }).then(function (r) {
						me.twoStep.backupCodes = r.backupCodes.length; render();
						var host = document.querySelector('#sec-2s'); if (host) { showBackupCodes(host, r.backupCodes); }
					});
				}).catch(function (e) { if (e.message !== 'cancelled') { status(p, e.message, 'error'); } });
			});
		}
		var tf = p.querySelector('#sec-trust-forget');
		if (tf) { tf.addEventListener('click', function () { var b = this; busy(b, true, 'Forget all trusted devices'); api2('/trusted/forget', { method: 'POST' }).then(function (r) { refresh(r.status); }).catch(function (e) { status(p, e.message, 'error'); busy(b, false, 'Forget all trusted devices'); }); }); }

		p.querySelector('#sec-alerts').addEventListener('change', function () {
			var on2 = this.checked;
			api2('/alerts', { method: 'POST', body: { on: on2 } }).then(function () { me.twoStep.loginAlerts = on2; status(p, on2 ? 'New-device alerts on.' : 'New-device alerts off.', 'ok'); }).catch(function (e) { status(p, e.message, 'error'); });
		});

		p.querySelector('#set-revoke').addEventListener('click', function () {
			var btn = this; busy(btn, true, 'Sign out all other devices');
			api('/security/sessions/revoke', { method: 'POST' })
				.then(function () { status(p, 'Other devices signed out.', 'ok'); loadSessions(); })
				.catch(function (e) { status(p, e.message, 'error'); })
				.then(function () { busy(btn, false, 'Sign out all other devices'); });
		});

		function loadSessions() {
			api2('/sessions').then(function (r) {
				var box = p.querySelector('#sec-sessions'); if (!box) { return; }
				if (!r.sessions.length) { box.innerHTML = '<p class="sml-set__muted">No active sessions.</p>'; return; }
				box.innerHTML = '<ul class="sml-set__devices">' + r.sessions.map(function (s) {
					return '<li' + (s.current ? ' class="is-current"' : '') + '><span class="sml-set__dev-name">' + esc(s.device) + (s.current ? ' <span class="sml-set__pill is-on">This device</span>' : '') + '</span>' +
						'<span class="sml-set__log-meta">' + esc(s.ip || 'unknown IP') + ' · signed in ' + esc(when(s.login)) + '</span>' +
						(s.current ? '' : '<button class="sml-set__btn sml-set__btn--small" data-revoke="' + esc(s.id) + '">Sign out</button>') + '</li>';
				}).join('') + '</ul>';
				Array.prototype.forEach.call(box.querySelectorAll('[data-revoke]'), function (b) {
					b.addEventListener('click', function () {
						busy(b, true, 'Sign out');
						api2('/sessions/revoke', { method: 'POST', body: { id: b.getAttribute('data-revoke') } }).then(function () { status(p, 'Device signed out.', 'ok'); loadSessions(); }).catch(function (e) { status(p, e.message, 'error'); busy(b, false, 'Sign out'); });
					});
				});
			}).catch(function () { var box = p.querySelector('#sec-sessions'); if (box) { box.innerHTML = '<p class="sml-set__muted">Could not load devices.</p>'; } });
		}
		loadSessions();

		var LABELS = {
			login: 'Signed in', login_failed: 'Failed sign-in', new_device_login: 'Signed in from a new device',
			password_changed: 'Password changed', password_change_failed: 'Failed password change',
			email_change_requested: 'Email change requested', email_changed: 'Email changed',
			sessions_revoked: 'Other devices signed out', session_revoked: 'A device was signed out', profile_updated: 'Profile updated',
			privacy_updated: 'Privacy updated', deletion_scheduled: 'Deletion scheduled',
			deletion_cancelled: 'Deletion cancelled', deletion_cancelled_by_login: 'Deletion cancelled by signing in',
			two_step_challenged: 'Two-step check requested', two_step_passed: 'Two-step check passed', two_step_failed: 'Wrong two-step code',
			two_step_totp_enabled: 'Authenticator app added', two_step_totp_disabled: 'Authenticator app removed',
			two_step_email_enabled: 'Email codes turned on', two_step_email_disabled: 'Email codes turned off',
			two_step_backup_regenerated: 'Backup codes regenerated', two_step_trusted_cleared: 'Trusted devices forgotten',
			data_export_requested: 'Data export requested', member_unblocked: 'Member unblocked'
		};
		api('/security/activity').then(function (r) {
			var box = p.querySelector('#set-activity'); if (!box) { return; }
			if (!r.items.length) { box.innerHTML = '<p class="sml-set__muted">Nothing recorded yet.</p>'; return; }
			box.innerHTML = '<ul class="sml-set__log">' + r.items.map(function (e) {
				var risky = /failed|deletion_scheduled|new_device/.test(e.event_type);
				return '<li class="sml-set__log-item' + (risky ? ' is-risky' : '') + '">' +
					'<span class="sml-set__log-type">' + esc(LABELS[e.event_type] || e.event_type) + '</span>' +
					'<span class="sml-set__log-meta">' + esc(e.ip_address || 'unknown IP') + ' · ' + esc(new Date(e.created_at.replace(' ', 'T') + 'Z').toLocaleString()) + '</span>' +
					(e.detail ? '<span class="sml-set__log-detail">' + esc(e.detail) + '</span>' : '') + '</li>';
			}).join('') + '</ul>';
		}).catch(function () { var box = p.querySelector('#set-activity'); if (box) { box.innerHTML = '<p class="sml-set__muted">Could not load activity.</p>'; } });

		return p;
	};

	// ------------------------------------------------------------------
	// Hidden in your feed (plugin sml-feed-signals, sml-feed/v1)
	// ------------------------------------------------------------------

	/* Owned by the feed-signals plugin, not this one: if that plugin is off
	   the route 404s and the section removes itself. */
	function feedApi(path, opts) { return call(CFG.feedRest || CFG.rest.replace(/sml-settings\/v1\/?$/, 'sml-feed/v1'), path, opts); }

	function sameSiteUrl(u) {
		try { var x = new URL(String(u || ''), location.origin); return x.origin === location.origin ? x.href : ''; } catch (e) { return ''; }
	}

	function hiddenRow(label, sub, hiddenAt, target, avatar) {
		return '<li>' +
			(avatar ? '<img class="sml-set__mini" src="' + esc(avatar) + '" alt="">' : '') +
			'<span class="sml-set__dev-name">' + label + (sub ? ' <span class="sml-set__muted">' + sub + '</span>' : '') + '</span>' +
			'<button class="sml-set__btn sml-set__btn--small" data-unhide="' + esc(target) + '">Unhide</button>' +
			'<span class="sml-set__log-meta">Hidden ' + esc(when(hiddenAt)) + '</span>' +
			'</li>';
	}

	function renderHidden(p, data) {
		var box = p.querySelector('#set-hidden');
		if (!box) { return; }
		var accounts = data.accounts || [], posts = data.posts || [];
		if (!accounts.length && !posts.length) {
			box.innerHTML = '<p class="sml-set__muted">You have not hidden anything. Use ⋯ on a post in your home feed to hide that post, or everything from its account.</p>';
			return;
		}
		var html = '<p class="sml-set__muted">These stay out of your home feed. Unhide one to start seeing it again.</p>';
		if (accounts.length) {
			html += '<div class="sml-set__hidden-group"><span class="sml-set__label">Accounts</span><ul class="sml-set__devices">' +
				accounts.map(function (a) {
					var url = sameSiteUrl(a.url);
					var name = url ? '<a href="' + esc(url) + '">' + esc(a.name) + '</a>' : esc(a.name);
					return hiddenRow(name, a.handle ? '@' + esc(a.handle) : '', a.hiddenAt, a.target, a.avatar);
				}).join('') + '</ul></div>';
		}
		if (posts.length) {
			html += '<div class="sml-set__hidden-group"><span class="sml-set__label">Posts</span><ul class="sml-set__devices">' +
				posts.map(function (h) {
					var url = sameSiteUrl(h.url);
					var title = h.title ? esc(h.title) : (h.gone ? 'A post that is no longer available' : 'A post');
					var label = url ? '<a href="' + esc(url) + '">' + title + '</a>' : title;
					var by = h.author && h.author.name ? 'by ' + esc(h.author.name) : '';
					return hiddenRow(label, by, h.hiddenAt, h.target, null);
				}).join('') + '</ul></div>';
		}
		box.innerHTML = html;

		Array.prototype.forEach.call(box.querySelectorAll('[data-unhide]'), function (b) {
			b.addEventListener('click', function () {
				var target = b.getAttribute('data-unhide');
				busy(b, true, 'Unhide');
				feedApi('/hide', { method: 'DELETE', body: { target: target } })
					.then(function () {
						data.accounts = accounts.filter(function (a) { return a.target !== target; });
						data.posts = posts.filter(function (h) { return h.target !== target; });
						/* the home feed caches hidden post ids in this browser to avoid a
						   flash; drop it so an unhidden account shows up immediately */
						try { localStorage.removeItem('sml_fs_hidden_' + me.id); } catch (e) { /* ignore */ }
						renderHidden(p, data);
						status(p, 'Unhidden. It will show in your feed again.', 'ok');
					})
					.catch(function (e) { status(p, e.message, 'error'); busy(b, false, 'Unhide'); });
			});
		});
	}

	function loadHidden(p) {
		feedApi('/hides')
			.then(function (data) { renderHidden(p, data || {}); })
			.catch(function (e) {
				if (!(e && e.status)) { window.console && console.error && console.error('[settings] hidden list', e); }
				var sec = p.querySelector('#set-hidden-sec');
				if (e && e.status === 404 && sec) { sec.remove(); return; }
				var box = p.querySelector('#set-hidden');
				if (box) { box.innerHTML = '<p class="sml-set__muted">Could not load what you have hidden. Please try again later.</p>'; }
			});
	}

	panels.privacy = function () {
		var p = el('div', 'sml-set__panel');
		var v = me.privacy || {};
		var dm = v.dm || { whoCanMessage: 'everyone', allowRequests: true, available: false };
		var blocked = v.blocked || [];
		p.innerHTML =
			'<h2>Privacy</h2>' +
			'<section class="sml-set__section"><h3>Profile</h3>' +
			'<label class="sml-set__field"><span class="sml-set__label">Who can see your profile page</span>' +
			'<select class="sml-set__input" id="set-vis">' +
			'<option value="public"' + (v.profileAccess === 'public' ? ' selected' : '') + '>Anyone on the internet</option>' +
			'<option value="members"' + (v.profileAccess === 'members' ? ' selected' : '') + '>Signed-in members only</option>' +
			'<option value="private"' + (v.profileAccess === 'private' ? ' selected' : '') + '>Only me</option>' +
			'</select><span class="sml-set__hint">Your posts inside groups and live chats stay visible to the people in those rooms.</span></label>' +
			toggle('Show my activity on my profile', 'set-activity-toggle', v.showActivity, 'Recent posts, charts and reactions.') +
			toggle('Let search engines index my profile', 'set-index', !v.noindex, 'Off asks Google and Bing not to list your profile page.') +
			toggle('Show me on leaderboards', 'set-lb', !v.hideLeaderboard, 'Loop Bucks and sentiment leaderboards. Off hides you from both.') +
			'</section>' +
			'<section class="sml-set__section"><h3>Messages</h3>' +
			(dm.available ?
			'<label class="sml-set__field"><span class="sml-set__label">Who can message you</span>' +
			'<select class="sml-set__input" id="set-dm">' +
			'<option value="everyone"' + (dm.whoCanMessage === 'everyone' ? ' selected' : '') + '>Everyone</option>' +
			'<option value="following"' + (dm.whoCanMessage === 'following' ? ' selected' : '') + '>Only people I follow</option>' +
			'<option value="nobody"' + (dm.whoCanMessage === 'nobody' ? ' selected' : '') + '>Nobody</option>' +
			'</select></label>' +
			toggle('Allow message requests from others', 'set-dm-req', dm.allowRequests, 'People outside your rule can send one request you can accept or ignore.')
			: '<p class="sml-set__muted">Messaging is not enabled on your account yet.</p>') +
			'</section>' +
			'<section class="sml-set__section"><h3>Blocked members</h3>' +
			(blocked.length ? '<ul class="sml-set__devices" id="set-blocked">' + blocked.map(function (b) { return '<li><img class="sml-set__mini" src="' + esc(b.avatar) + '" alt=""><span class="sml-set__dev-name">' + esc(b.name) + ' <span class="sml-set__muted">@' + esc(b.handle) + '</span></span><button class="sml-set__btn sml-set__btn--small" data-unblock="' + b.id + '">Unblock</button></li>'; }).join('') + '</ul>'
				: '<p class="sml-set__muted">You have not blocked anyone. Block someone from their profile or hover card and they can no longer message, follow or interact with you.</p>') +
			'</section>' +
			'<section class="sml-set__section" id="set-hidden-sec"><h3>Hidden in your feed</h3>' +
			'<div id="set-hidden" aria-live="polite"><p class="sml-set__muted">Loading…</p></div>' +
			'</section>' +
			'<div class="sml-set__row"><button class="sml-set__btn sml-set__btn--primary" id="set-privacy-save">Save changes</button><span class="sml-set__status"></span></div>';

		p.querySelector('#set-privacy-save').addEventListener('click', function () {
			var btn = this; busy(btn, true, 'Save changes');
			var body = {
				profileAccess: p.querySelector('#set-vis').value,
				showActivity: p.querySelector('#set-activity-toggle').checked,
				noindex: !p.querySelector('#set-index').checked,
				hideLeaderboard: !p.querySelector('#set-lb').checked
			};
			if (dm.available) { body.whoCanMessage = p.querySelector('#set-dm').value; body.allowRequests = p.querySelector('#set-dm-req').checked; }
			api('/privacy', { method: 'POST', body: body })
				.then(function (r) { if (r.privacy) { me.privacy = r.privacy; } status(p, 'Saved.', 'ok'); })
				.catch(function (e) { status(p, e.message, 'error'); })
				.then(function () { busy(btn, false, 'Save changes'); });
		});
		Array.prototype.forEach.call(p.querySelectorAll('[data-unblock]'), function (b) {
			b.addEventListener('click', function () {
				busy(b, true, 'Unblock');
				api('/privacy/unblock', { method: 'POST', body: { userId: +b.getAttribute('data-unblock') } })
					.then(function (r) { me.privacy.blocked = r.blocked || []; render(); })
					.catch(function (e) { status(p, e.message, 'error'); busy(b, false, 'Unblock'); });
			});
		});
		loadHidden(p);
		return p;
	};

	panels.notifications = function () {
		var p = el('div', 'sml-set__panel');
		var n = me.notifications || {};
		p.innerHTML =
			'<h2>Notifications</h2>' +
			'<section class="sml-set__section"><h3>Email</h3>' +
			toggle('Email notifications', 'set-n-email', n.email, 'The master switch for the emails below. Security emails (password, email and two-step changes) are always sent.') +
			toggle('New-device sign-in alerts', 'set-n-login', n.loginAlerts, 'When your account signs in from a device we have not seen.') +
			toggle('Q&A follow-ups', 'set-n-qa', n.qa, 'New answers on questions you asked or follow.') +
			'</section>' +
			'<section class="sml-set__section"><h3>In-app</h3>' +
			'<p class="sml-set__lede">Follows, replies, group alerts, live streams and Loop Letters reach you through the bell and LOOP-KICK.' + (CFG.links && CFG.links.alerts ? ' <a href="' + esc(CFG.links.alerts) + '">Manage your alerts</a>.' : '') + '</p>' +
			'</section>' +
			'<div class="sml-set__row"><button class="sml-set__btn sml-set__btn--primary" id="set-n-save">Save changes</button><span class="sml-set__status"></span></div>';

		p.querySelector('#set-n-save').addEventListener('click', function () {
			var btn = this; busy(btn, true, 'Save changes');
			api('/notifications', { method: 'POST', body: {
				email: p.querySelector('#set-n-email').checked,
				loginAlerts: p.querySelector('#set-n-login').checked,
				qa: p.querySelector('#set-n-qa').checked
			}})
				.then(function (r) { if (r.notifications) { me.notifications = r.notifications; if (me.twoStep) { me.twoStep.loginAlerts = r.notifications.loginAlerts; } } status(p, 'Saved.', 'ok'); })
				.catch(function (e) { status(p, e.message, 'error'); })
				.then(function () { busy(btn, false, 'Save changes'); });
		});
		return p;
	};

	panels.danger = function () {
		var p = el('div', 'sml-set__panel sml-set__panel--danger');

		if (me.deletion) {
			p.innerHTML =
				'<h2>Account deletion</h2>' +
				'<div class="sml-set__notice sml-set__notice--danger">Your account is scheduled for deletion in <strong>' + me.deletion.daysLeft + ' days</strong>. Signing in again cancels it automatically — or cancel now.</div>' +
				'<button class="sml-set__btn sml-set__btn--primary" id="set-del-cancel">Keep my account</button><div class="sml-set__status"></div>';
			p.querySelector('#set-del-cancel').addEventListener('click', function () {
				var btn = this; busy(btn, true, 'Keep my account');
				api('/danger/delete/cancel', { method: 'POST' }).then(function () { me.deletion = null; render(); }).catch(function (e) { status(p, e.message, 'error'); busy(btn, false, 'Keep my account'); });
			});
			return p;
		}

		p.innerHTML =
			'<h2>Delete account</h2>' +
			'<p class="sml-set__lede">Your account is scheduled for deletion in ' + (CFG.graceDays || 30) + ' days. You are signed out straight away, and signing back in before then cancels it.</p>' +
			'<ul class="sml-set__list">' +
			'<li>Your profile, posts, charts and uploads are removed permanently</li>' +
			'<li>Any active subscription is cancelled</li>' +
			'<li>Your handle <strong>@' + esc(me.handle) + '</strong> is released</li>' +
			'<li>This cannot be undone once the ' + (CFG.graceDays || 30) + ' days have passed</li>' +
			'</ul>' +
			field('Confirm your password', 'set-del-pw', { type: 'password', autocomplete: 'current-password' }) +
			field('Type DELETE to confirm', 'set-del-confirm', { placeholder: 'DELETE' }) +
			'<div class="sml-set__row"><button class="sml-set__btn sml-set__btn--danger" id="set-del-go">Delete my account</button><span class="sml-set__status"></span></div>';

		p.querySelector('#set-del-go').addEventListener('click', function () {
			var btn = this; busy(btn, true, 'Delete my account');
			api('/danger/delete/request', { method: 'POST', body: { password: p.querySelector('#set-del-pw').value, confirm: p.querySelector('#set-del-confirm').value } })
				.then(function (r) {
					root.innerHTML = '<div class="sml-set__panel"><h2>Your account is scheduled for deletion</h2><p class="sml-set__lede">It will be permanently removed on ' + esc(new Date(r.scheduledFor).toLocaleDateString()) + '. Sign in again before then and nothing will be lost.</p></div>';
					setTimeout(function () { location.href = CFG.logoutUrl || '/'; }, 6000);
				})
				.catch(function (e) { status(p, e.message, 'error'); busy(btn, false, 'Delete my account'); });
		});
		return p;
	};

	// ------------------------------------------------------------------
	// Shell
	// ------------------------------------------------------------------

	function render() {
		root.innerHTML = '';
		var wrap = el('div', 'sml-set__wrap');
		var nav = el('nav', 'sml-set__nav');
		TABS.forEach(function (t) {
			var b = el('button', 'sml-set__tab' + (t.id === tab ? ' is-active' : ''), t.label);
			b.type = 'button';
			if (t.id === 'danger') { b.classList.add('sml-set__tab--danger'); }
			if (t.id === 'security' && me.twoStep && !me.twoStep.enabled) { b.classList.add('has-dot'); b.title = 'Two-step verification is off'; }
			b.addEventListener('click', function () { tab = t.id; history.replaceState(null, '', '#' + t.id); render(); });
			nav.appendChild(b);
		});
		wrap.appendChild(nav);
		wrap.appendChild((panels[tab] || panels.profile)());
		root.appendChild(wrap);
	}

	function boot() {
		root.innerHTML = '<p class="sml-set__muted">Loading your settings…</p>';
		api('/me').then(function (data) { me = data; render(); })
			.catch(function (e) { root.innerHTML = '<div class="sml-set__panel"><p class="sml-set__status is-error">' + esc(e.message) + '</p></div>'; });
	}

	boot();
}());
