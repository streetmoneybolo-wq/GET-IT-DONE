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
    installCreatorAnalyticsTab();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAll);
  else bootAll();

  function trackerUserMarkup() {
    return `
      <div class="sml-lit" data-sml-lit="user" data-lit-embedded="analytics">
        <div class="sml-lit-hero sml-lit-compact-hero">
          <p class="sml-lit-kicker">Smart Link Tracker</p>
          <h1>Track any link in real time</h1>
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
        <div class="sml-lit-hero sml-lit-compact-hero">
          <p class="sml-lit-kicker">Admin-only raw IP view</p>
          <h1>Live site-wide click intelligence</h1>
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

    function install() {
      const nav = root.querySelector('.ca-nav');
      const main = root.querySelector('.ca-main');
      if (!nav || !main) return false;

      if (!nav.querySelector('[data-ca-nav="link-tracker"]')) {
        const a = document.createElement('a');
        a.href = location.pathname + location.search;
        a.setAttribute('data-ca-nav', 'link-tracker');
        a.innerHTML = '<span></span>Link Tracker';
        a.addEventListener('click', function (e) {
          e.preventDefault();
          root.querySelectorAll('[data-ca-nav]').forEach(function (x) { x.classList.toggle('on', x === a); });
        });
        nav.appendChild(a);
      }

      let section = main.querySelector('#ca-link-tracker');
      if (!section) {
        section = document.createElement('section');
        section.className = 'ca-section ca-section-link-tracker';
        section.id = 'ca-link-tracker';
        section.innerHTML = `
          <div class="ca-section-head">
            <h2>Link Tracker</h2>
            <span>Real-time tracked links · Discord invite tracking · campaign intelligence</span>
          </div>
          ${trackerUserMarkup()}
          ${trackerAdminMarkup()}
        `;
        const foot = main.querySelector('.ca-foot');
        if (foot) main.insertBefore(section, foot);
        else main.appendChild(section);
      }
      bootEmbeddedTrackers(section);
      return true;
    }

    function fallback() {
      if (root.querySelector('#ca-link-tracker')) return true;
      if (root.querySelector('[data-sml-lit-fallback="analytics"]')) return true;
      const host = document.createElement('div');
      host.setAttribute('data-sml-lit-fallback', 'analytics');
      host.className = 'sml-lit-fallback-mount';
      host.innerHTML = `
        <section class="ca-section ca-section-link-tracker" id="ca-link-tracker">
          <div class="ca-section-head">
            <h2>Link Tracker</h2>
            <span>Real-time tracked links · Discord invite tracking · campaign intelligence</span>
          </div>
          ${trackerUserMarkup()}
          ${trackerAdminMarkup()}
        </section>
      `;
      root.appendChild(host);
      bootEmbeddedTrackers(host);
      return true;
    }

    if (install()) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (install()) clearInterval(timer);
      else if (tries > 40) {
        fallback();
        clearInterval(timer);
      }
    }, 250);
    const observer = new MutationObserver(() => install());
    observer.observe(root, { childList: true, subtree: true });
  }
})();
