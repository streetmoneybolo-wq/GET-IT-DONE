/**
 * Account menu behaviour.
 *
 * Small on purpose: this script runs on every page of the site, so it does no
 * network work, registers three listeners, and touches nothing it does not own.
 */
(function () {
	'use strict';

	// This script can be printed before the footer markup it controls, so it
	// must never read the DOM at parse time. Doing so is how the first build
	// shipped a button that rendered perfectly and did nothing when clicked.
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	function init() {

	var root = document.querySelector('[data-sml-acct]');
	if (!root) { return; }

	var btn = root.querySelector('.sml-acct__btn');
	var menu = root.querySelector('.sml-acct__menu');
	if (!btn || !menu) { return; }

	function open() {
		menu.classList.add('is-open');
		btn.setAttribute('aria-expanded', 'true');
		var first = menu.querySelector('.sml-acct__item');
		if (first) { first.focus(); }
	}

	function close(refocus) {
		menu.classList.remove('is-open');
		btn.setAttribute('aria-expanded', 'false');
		if (refocus) { btn.focus(); }
	}

	function isOpen() { return menu.classList.contains('is-open'); }

	btn.addEventListener('click', function (e) {
		e.stopPropagation();
		isOpen() ? close(false) : open();
	});

	// Click anywhere else closes it. Scoped to the document so it works over
	// the profile background, the photo wheel, and anything else on the page.
	document.addEventListener('click', function (e) {
		if (isOpen() && !root.contains(e.target)) { close(false); }
	});

	document.addEventListener('keydown', function (e) {
		if (!isOpen()) { return; }
		if (e.key === 'Escape') {
			close(true);
			return;
		}
		// Arrow keys and Tab cycle within the menu — a menu you can open with
		// the keyboard but not navigate is worse than no keyboard support.
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
			var items = Array.prototype.slice.call(menu.querySelectorAll('.sml-acct__item'));
			if (!items.length) { return; }
			var i = items.indexOf(document.activeElement);
			var forward = (e.key === 'ArrowDown') || (e.key === 'Tab' && !e.shiftKey);
			e.preventDefault();
			items[(i + (forward ? 1 : -1) + items.length) % items.length].focus();
		}
	});

	}
}());
