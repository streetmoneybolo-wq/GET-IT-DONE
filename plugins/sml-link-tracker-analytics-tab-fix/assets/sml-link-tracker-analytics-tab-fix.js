(function () {
  const cfg = window.SML_LIT || {};
  const api = cfg.rest || '/wp-json/sml-intel/v1';
  const headers = {
    'Content-Type': 'application/json',
    'X-WP-Nonce': cfg.nonce || ''
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
  }

  async function request(path, options = {}) {
    const res = await fetch(api + path, {
      credentials: 'same-origin',
      ...options,
      headers: { ...headers, ...(options.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  }

  function presetLabel(value) {
    return String(value || 'custom').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function locationLabel(c) {
    const parts = [c.city, c.region, c.country || c.country_code].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Unknown location';
  }

  function hasCoords(c) {
    if (c.latitude === null || c.longitude === null || c.latitude === '' || c.longitude === '') return false;
    return Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude));
  }

  function renderAdminMap(clicks) {
    const mapped = clicks.filter(hasCoords).slice(0, 100);
    if (!mapped.length) {
      return '<div class="sml-lit-map-empty">No mappable coordinates yet. Coordinates come from the IP location database.</div>';
    }
    return `
      <div class="sml-lit-map">
        <div class="sml-lit-map-head">
          <strong>Live click map</strong>
          <span><b class="sml-lit-dot human"></b> Human click <b class="sml-lit-dot bot"></b> Bot / preview click</span>
        </div>
        <div class="sml-lit-map-world" aria-label="Recent tracked link click map">
          ${mapped.map((c) => {
            const x = Math.max(0, Math.min(100, ((Number(c.longitude) + 180) / 360) * 100));
            const y = Math.max(0, Math.min(100, ((90 - Number(c.latitude)) / 180) * 100));
            return `<a class="sml-lit-map-pin ${c.is_bot ? 'bot' : 'human'}" style="left:${x}%;top:${y}%;" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(c.latitude)}&mlon=${encodeURIComponent(c.longitude)}#map=10/${encodeURIComponent(c.latitude)}/${encodeURIComponent(c.longitude)}" target="_blank" rel="noopener" title="${esc(locationLabel(c))} · ${c.is_bot ? 'Bot / preview' : 'Human'}"></a>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  async function loadUserLinks(root) {
    const box = root.querySelector('[data-lit-links]');
    if (!box) return;
    box.innerHTML = '<div class="sml-lit-card">Loading trackers…</div>';
    const links = await request('/links?limit=50');
    if (!links.length) {
      box.innerHTML = '<div class="sml-lit-card"><h3>No tracked links yet</h3><p>Paste a link above to create your first real-time tracker.</p></div>';
      return;
    }
    box.innerHTML = links.map((link) => `
      <article class="sml-lit-card" data-link-id="${esc(link.id)}">
        <div class="sml-lit-row">
          <span class="sml-lit-pill">${esc(presetLabel(link.preset))}</span>
          ${link.ticker ? `<span class="sml-lit-pill sml-lit-green">$${esc(link.ticker)}</span>` : ''}
        </div>
        <h3>${esc(link.label || link.destination_url)}</h3>
        <p class="sml-lit-url">${esc(link.destination_url)}</p>
        <div class="sml-lit-copy">
          <input readonly value="${esc(link.tracked_url)}">
          <button data-copy="${esc(link.tracked_url)}">Copy</button>
        </div>
        <div class="sml-lit-stats">
          <strong>${esc(link.total_clicks)}</strong><span>Total clicks</span>
          <strong>${esc(link.last_click_at || '—')}</strong><span>Last click</span>
        </div>
        <button class="sml-lit-secondary" data-load-analytics="${esc(link.id)}">View analytics</button>
        <div class="sml-lit-clicks" data-clicks-for="${esc(link.id)}"></div>
      </article>
    `).join('');
  }

  async function loadLinkAnalytics(root, id) {
    const target = root.querySelector(`[data-clicks-for="${CSS.escape(String(id))}"]`);
    if (!target) return;
    target.innerHTML = '<p>Loading click data…</p>';
    const data = await request(`/links/${id}/analytics?limit=25`);
    const clicks = data.clicks || [];
    target.innerHTML = `
      <div class="sml-lit-mini">
        <span><b>${esc(data.summary.total_clicks)}</b> clicks</span>
        <span><b>${esc(data.summary.unique_visitors)}</b> unique visitors</span>
        <span><b>${esc(data.summary.unique_devices == null ? '—' : data.summary.unique_devices)}</b> unique devices</span>
        <span><b>${esc(data.summary.bot_clicks)}</b> bot/preview clicks</span>
      </div>
      ${clicks.length ? clicks.map((c) => `
        <div class="sml-lit-click">
          <b>${esc(c.created_at)}</b>
          <span>${esc(locationLabel(c))}${c.is_bot ? ' · ⚠️ Bot/preview' : ''}</span>
          <span>${esc(c.device)} · ${esc(c.browser)} · ${esc(c.platform)}${c.screen ? ' · ' + esc(c.screen) : ''}${c.timezone ? ' · ' + esc(c.timezone) : ''}</span>
          <span>${esc(c.referrer || 'Direct / unknown source')}</span>
          ${data.admin_ip_visible && c.raw_ip ? `<span class="sml-lit-ip">IP: ${esc(c.raw_ip)}</span>` : ''}
          ${data.admin_ip_visible && (c.client_fp || c.server_fp) ? `<span class="sml-lit-ip">Device ID: ${esc((c.client_fp || c.server_fp).slice(0, 16))}${c.client_fp ? '' : ' (browser-level)'}</span>` : ''}
        </div>
      `).join('') : '<p>No clicks recorded yet.</p>'}
    `;
  }

  async function loadAdmin(root) {
    const body = root.querySelector('[data-lit-admin-clicks]');
    const map = root.querySelector('[data-lit-admin-map]');
    if (!body) return;
    const filter = root.querySelector('[data-lit-user-filter]');
    const userId = filter && filter.value.trim() ? '&user_id=' + encodeURIComponent(filter.value.trim()) : '';
    body.innerHTML = '<tr><td colspan="12">Loading live clicks…</td></tr>';
    if (map) map.innerHTML = '<div class="sml-lit-map-empty">Loading click map…</div>';
    const data = await request('/admin/live?limit=150' + userId);
    const clicks = data.clicks || [];
    if (map) map.innerHTML = renderAdminMap(clicks);
    body.innerHTML = clicks.length ? clicks.map((c) => `
      <tr>
        <td>${esc(c.created_at)}</td>
        <td><code>${esc(c.raw_ip || '')}</code></td>
        <td>${esc(c.link_owner_id)}</td>
        <td><a href="${esc(c.tracked_url)}" target="_blank" rel="noopener">${esc(c.label || c.slug)}</a><small>${esc(c.destination_url)}</small></td>
        <td>${esc(presetLabel(c.preset))}</td>
        <td>${c.ticker ? '$' + esc(c.ticker) : ''}</td>
        <td>${esc(locationLabel(c))}</td>
        <td>${hasCoords(c) ? `<a href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(c.latitude)}&mlon=${encodeURIComponent(c.longitude)}#map=10/${encodeURIComponent(c.latitude)}/${encodeURIComponent(c.longitude)}" target="_blank" rel="noopener">Open map</a>` : '—'}</td>
        <td>${esc(c.device)}${c.screen ? '<small>' + esc(c.screen) + '</small>' : ''}${(c.client_fp || c.server_fp) ? '<small title="' + esc(c.client_fp || c.server_fp) + '">ID ' + esc((c.client_fp || c.server_fp).slice(0, 12)) + '</small>' : ''}</td>
        <td>${esc(c.browser)}<small>${esc(c.platform || '')}</small></td>
        <td>${esc(c.referrer || 'Direct')}</td>
        <td>${c.is_bot ? '⚠️ ' + esc(c.bot_reason || 'Bot') : 'No'}</td>
      </tr>
    `).join('') : '<tr><td colspan="12">No clicks yet.</td></tr>';
  }

  document.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      await navigator.clipboard.writeText(copy.getAttribute('data-copy'));
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
    }

    const analytics = e.target.closest('[data-load-analytics]');
    if (analytics) {
      const root = analytics.closest('[data-sml-lit]');
      try { await loadLinkAnalytics(root, analytics.getAttribute('data-load-analytics')); }
      catch (err) { alert(err.message); }
    }

    const openPulse = e.target.closest('[data-lit-open-pulse]');
    if (openPulse) {
      const root = openPulse.closest('[data-sml-lit]');
      const filter = root && root.querySelector('[data-lit-user-filter]');
      const ownerId = filter && filter.value.trim() ? Number(filter.value.trim()) : 0;
      const status = root && root.querySelector('[data-lit-pulse-status]');
      if (window.SMLPulse && typeof window.SMLPulse.openLiveClicks === 'function') {
        window.SMLPulse.openLiveClicks(ownerId > 0 ? ownerId : undefined);
        if (status) status.textContent = '';
      } else if (status) {
        status.textContent = 'The Pulse analytics panel is still loading. Try again in a moment.';
      }
    }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-lit-create]');
    if (!form) return;
    e.preventDefault();
    const root = form.closest('[data-sml-lit]');
    const status = root.querySelector('[data-lit-status]');
    const payload = Object.fromEntries(new FormData(form).entries());
    status.textContent = 'Creating tracked link…';
    try {
      const created = await request('/links', { method: 'POST', body: JSON.stringify(payload) });
      status.innerHTML = `Created: <a href="${esc(created.tracked_url)}" target="_blank" rel="noopener">${esc(created.tracked_url)}</a>`;
      form.reset();
      await loadUserLinks(root);
    } catch (err) {
      status.textContent = err.message;
    }
  });

  function bootAll() {
    document.querySelectorAll('[data-sml-lit="user"]').forEach((root) => loadUserLinks(root).catch((err) => {
      const box = root.querySelector('[data-lit-links]');
      if (box) box.innerHTML = `<div class="sml-lit-card">${esc(err.message)}</div>`;
    }));
    document.querySelectorAll('[data-sml-lit="admin"]').forEach((root) => {
      loadAdmin(root).catch((err) => {
        const body = root.querySelector('[data-lit-admin-clicks]');
        if (body) body.innerHTML = `<tr><td colspan="12">${esc(err.message)}</td></tr>`;
      });
    });
    installCreatorAnalyticsTab();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAll);
  else bootAll();

  function trackerUserMarkup() {
    return `
      <div class="sml-lit" data-sml-lit="user" data-lit-embedded="analytics">
        <div class="sml-lit-native-head">
          <p class="sml-lit-kicker">Smart Link Tracker</p>
          <h3>Track any link in real time</h3>
          <p>Paste a Discord invite, news link, SEC filing, video, checkout page, or campaign URL. StockMarketLoop creates a tracked redirect and feeds the click data into the analytics engine.</p>
        </div>
        <form class="sml-lit-form" data-lit-create>
          <input name="destination_url" type="url" placeholder="Paste any URL, including Discord invite links" required>
          <select name="preset">
            <option value="discord-invite">Discord Invite Link</option>
            <option value="stock-news">Stock News Link</option>
            <option value="social-campaign">Social Campaign Link</option>
            <option value="substack-blog">Substack / Blog Link</option>
            <option value="video">YouTube / Video Link</option>
            <option value="sec-filing">SEC Filing Link</option>
            <option value="earnings-report">Earnings Report Link</option>
            <option value="checkout">Product / Checkout Link</option>
            <option value="custom">Custom Link</option>
          </select>
          <input name="label" placeholder="Link label">
          <input name="ticker" placeholder="Ticker, optional">
          <input name="campaign" placeholder="Campaign, optional">
          <button type="submit">Create Tracker</button>
        </form>
        <div class="sml-lit-status" data-lit-status></div>
        <div class="sml-lit-grid" data-lit-links></div>
      </div>
    `;
  }

  function trackerAdminMarkup() {
    if (!cfg.isAdmin) return '';
    return `
      <div class="sml-lit sml-lit-admin sml-lit-admin-embedded" data-sml-lit="admin" data-lit-embedded="analytics">
        <div class="sml-lit-native-head">
          <p class="sml-lit-kicker">Admin-only raw IP view</p>
          <h3>Live site-wide click intelligence</h3>
          <p>The unified Pulse map owns live click locations, owner filtering, and the recent-click table.</p>
        </div>
        <div class="sml-lit-toolbar">
          <input data-lit-user-filter placeholder="Optional link owner user ID">
          <button data-lit-open-pulse>Open Live click map</button>
        </div>
        <div class="sml-lit-status" data-lit-pulse-status></div>
      </div>
    `;
  }

  function bootEmbeddedTrackers(section) {
    section.querySelectorAll('[data-sml-lit="user"]').forEach((root) => {
      if (root.dataset.litBooted === '1') return;
      root.dataset.litBooted = '1';
      loadUserLinks(root).catch((err) => {
        const box = root.querySelector('[data-lit-links]');
        if (box) box.innerHTML = `<div class="sml-lit-card">${esc(err.message)}</div>`;
      });
    });
    section.querySelectorAll('[data-sml-lit="admin"]').forEach((root) => {
      root.dataset.litBooted = '1';
    });
  }

  function installCreatorAnalyticsTab() {
    const root = document.getElementById('sml-ca-root');
    if (!root) return;

    /* The dashboard rebuilds root.innerHTML on timers (admin views every
       20–60s, creator view every 20s). The nav link and the section are
       therefore kept as two persistent nodes that get RE-ATTACHED after each
       wipe — never recreated — so typed form input, expanded analytics and
       already-loaded click data all survive a refresh. */
    const ACTIVE = 'sml-lit-active';
    const OTHER_NAV = '[data-ca-nav]:not([data-ca-nav="link-tracker"]),[data-adm-nav],#ca-back,[data-adm-user],[data-adm-sort],tr[data-content],tr[data-group]';
    let navLink = null, section = null, savedY = 0;

    function setActive(on) {
      root.classList.toggle(ACTIVE, on);
      // navLink may be detached mid-render, so it is handled directly rather
      // than through the query below.
      if (navLink) navLink.classList.toggle('on', on);
      root.querySelectorAll('[data-ca-nav], [data-adm-nav]').forEach((x) => {
        if (x !== navLink && on) x.classList.remove('on');
      });
      try {
        if (location.hash === '#ca-link-tracker') history.replaceState(null, '', location.pathname + location.search);
      } catch (e) {}
    }

    function activateTrackerTab() {
      const y = window.scrollY;
      setActive(true);
      requestAnimationFrame(() => {
        // Hiding the other panels shortens the page, so the browser may clamp
        // the scroll to the module's tail. Keep the reader's position unless
        // the module's heading is above the viewport — then land on it.
        // Never the page top, never a hash.
        const top = section ? section.getBoundingClientRect().top : 0;
        if (section && top < 0) {
          const header = document.getElementById('sml-global-header');
          const offset = (header ? header.getBoundingClientRect().height : 0) + 12;
          window.scrollTo({ top: Math.max(0, top + window.scrollY - offset), left: 0, behavior: 'auto' });
        } else {
          window.scrollTo({ top: y, left: 0, behavior: 'auto' });
        }
      });
    }

    if (root.dataset.smlLitLinkClickFixed !== '1') {
      root.dataset.smlLitLinkClickFixed = '1';
      root.addEventListener('click', function (event) {
        const link = event.target.closest('[data-ca-nav="link-tracker"]');
        if (link && root.contains(link)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          activateTrackerTab();
          return;
        }
        if (root.classList.contains(ACTIVE) && event.target.closest(OTHER_NAV)) setActive(false);
      }, true);
      // Enter in the admin user search navigates to the Users view.
      root.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && event.target.closest('[data-adm-q]')) setActive(false);
      }, true);

      // Lifecycle events emitted by creator-analytics.js around its own
      // re-renders: re-attach synchronously so the page never shrinks and the
      // browser never clamps the scroll position. Explicit navigation
      // (detail.navigate) is allowed to scroll to top; refreshes are not.
      root.addEventListener('sml-ca-before-render', () => { savedY = window.scrollY; });
      root.addEventListener('sml-ca-after-render', (e) => {
        const d = e.detail || {};
        install();
        const y = typeof d.scrollY === 'number' ? d.scrollY : savedY;
        if (!d.navigate) window.scrollTo({ top: y, left: 0, behavior: 'auto' });
      });
    }

    function ensureNavLink(nav) {
      if (!navLink) {
        navLink = document.createElement('a');
        navLink.setAttribute('data-ca-nav', 'link-tracker');
        navLink.setAttribute('role', 'button');
        navLink.setAttribute('title', 'Link Tracker');
        navLink.innerHTML = '<span></span>Link Tracker';
      }
      navLink.href = location.pathname + location.search;
      navLink.classList.toggle('on', root.classList.contains(ACTIVE));
      nav.querySelectorAll('[data-ca-nav="link-tracker"]').forEach((x) => { if (x !== navLink) x.remove(); });
      if (navLink.parentNode !== nav) nav.appendChild(navLink);
    }

    function ensureSection(main) {
      if (!section) {
        section = document.createElement('section');
        section.className = 'ca-section ca-section-link-tracker';
        section.id = 'ca-link-tracker';
        section.innerHTML = `
          <div class="ca-section-head">
            <h2>Link Tracker</h2>
            <span>Real-time tracked links · Discord invite tracking · campaign intelligence</span>
          </div>
          <div class="ca-card sml-lit-native-card">${trackerUserMarkup()}</div>
          ${cfg.isAdmin ? `<div class="ca-card sml-lit-native-card">${trackerAdminMarkup()}</div>` : ''}
        `;
      }
      main.querySelectorAll('#ca-link-tracker').forEach((x) => { if (x !== section) x.remove(); });
      if (section.parentNode !== main) {
        const foot = main.querySelector('.ca-foot');
        if (foot) main.insertBefore(section, foot);
        else main.appendChild(section);
      }
      bootEmbeddedTrackers(section);
    }

    function install() {
      const nav = root.querySelector('.ca-nav');
      const main = root.querySelector('.ca-main');
      if (!nav || !main) return false;
      ensureNavLink(nav);
      ensureSection(main);
      if (root.classList.contains(ACTIVE) || location.hash === '#ca-link-tracker') setActive(true);
      return true;
    }

    install();
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (install() || tries > 40) clearInterval(timer);
    }, 250);

    // Fallback for a dashboard build that does not emit the lifecycle events.
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        install();
      }, 120);
    });
    observer.observe(root, { childList: true, subtree: true });
  }
})();
