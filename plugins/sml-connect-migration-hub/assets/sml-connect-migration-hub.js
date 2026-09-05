(function () {
  'use strict';

  const cfg = window.SMLConnectHub || {};

  function output(root, message) {
    const el = root.querySelector('[data-smlcmh-output]') || document.querySelector('[data-smlcmh-output]');
    if (!el) return;
    el.textContent = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
  }

  async function post(path, data) {
    const res = await fetch(String(cfg.restUrl || '') + path.replace(/^\//, ''), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-wp-nonce': cfg.nonce || ''
      },
      body: JSON.stringify(data)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.code || json.message && !json.ok) {
      throw new Error(json.message || json.error || `Request failed (${res.status})`);
    }
    return json;
  }

  function formData(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    for (const key of ['groupId', 'ownerUserId', 'planId']) {
      if (data[key] != null && data[key] !== '') data[key] = Number(data[key]);
    }
    if (form.elements.migratedPerksEnabled) data.migratedPerksEnabled = !!form.elements.migratedPerksEnabled.checked;
    if (data.guildName) {
      data.groupName = data.guildName;
      data.settings = Object.assign({}, data.settings || {}, { guildName: data.guildName });
    }
    return data;
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  function withParam(url, key, value) {
    try {
      const parsed = new URL(url, window.location.origin);
      if (value) parsed.searchParams.set(key, value);
      return parsed.toString();
    } catch (_) {
      return url;
    }
  }

  function signupWithRedirect(groupUrl) {
    try {
      const parsed = new URL(cfg.signupUrl || '/register/', window.location.origin);
      parsed.searchParams.set('redirect_to', groupUrl);
      parsed.searchParams.set('sml_connect', '1');
      return parsed.toString();
    } catch (_) {
      return cfg.signupUrl || '/register/';
    }
  }

  function bindOnboarding(root) {
    const guildInput = root.querySelector('[data-smlcmh-guild-name]');
    const upgradePanel = root.querySelector('[data-smlcmh-upgrade-panel]');
    const createLink = root.querySelector('[data-smlcmh-create-group]');

    root.querySelectorAll('[data-smlcmh-upgrade]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!upgradePanel) return;
        upgradePanel.hidden = button.getAttribute('data-smlcmh-upgrade') !== 'yes';
      });
    });

    function refreshCreateLink() {
      if (!createLink) return;
      const name = guildInput ? guildInput.value.trim() : '';
      const groupUrl = withParam(cfg.createGroupUrl || '/groups/create/', 'default_name', name);
      createLink.href = cfg.isLoggedIn ? groupUrl : signupWithRedirect(groupUrl);
      createLink.textContent = name ? `Yes — create "${name}" on StockMarketLoop` : 'Yes — create SML group';
    }

    if (guildInput) guildInput.addEventListener('input', refreshCreateLink);
    refreshCreateLink();
  }

  function bindCampaignDefaults(form) {
    const guildName = form.elements.guildName;
    const slug = form.elements.publicSlug;
    const headline = form.elements.headline;
    const seoTitle = form.elements.seoTitle;
    const seoDescription = form.elements.seoDescription;
    if (!guildName) return;

    guildName.addEventListener('input', () => {
      const name = guildName.value.trim();
      if (!name) return;
      if (slug && !slug.dataset.userEdited) slug.value = slugify(name);
      if (headline && !headline.dataset.userEdited) headline.value = `Join ${name} on StockMarketLoop Connect`;
      if (seoTitle && !seoTitle.dataset.userEdited) seoTitle.value = `${name} Discord Group | StockMarketLoop Connect`;
      if (seoDescription && !seoDescription.dataset.userEdited) seoDescription.value = `Join ${name} through StockMarketLoop Connect with premium Discord alerts, subscriptions, live market tools, and creator analytics.`;
    });

    [slug, headline, seoTitle, seoDescription].forEach((field) => {
      if (!field) return;
      field.addEventListener('input', () => { field.dataset.userEdited = '1'; });
    });
  }

  function bindCampaign(form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const root = form.closest('[data-smlcmh-dashboard]') || document;
      output(root, 'Saving Connect campaign…');
      try {
        const result = await post('campaign', formData(form));
        const slug = result.campaign && result.campaign.publicSlug;
        const url = slug ? `${cfg.publicUrl || '/connect/'}${slug}/` : '';
        output(root, Object.assign({ publicPage: url }, result));
      } catch (error) {
        output(root, `Error: ${error.message}`);
      }
    });
  }

  function bindMappings(form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const root = form.closest('[data-smlcmh-dashboard]') || document;
      output(root, 'Saving plan mappings…');
      try {
        const data = formData(form);
        data.mappings = JSON.parse(data.mappings || '[]');
        const result = await post('mappings', data);
        output(root, result);
      } catch (error) {
        output(root, `Error: ${error.message}`);
      }
    });
  }

  function bindDashboard(form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const root = form.closest('[data-smlcmh-dashboard]') || document;
      output(root, 'Loading Connect dashboard…');
      try {
        output(root, await post('dashboard', formData(form)));
      } catch (error) {
        output(root, `Error: ${error.message}`);
      }
    });
  }

  function bindMigrate(form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const root = form.closest('[data-smlcmh-migrate]') || document;
      output(root, 'Preparing migration checkout…');
      try {
        const result = await post('migrate/upgrade-chat', formData(form));
        if (result.checkoutUrl) {
          output(root, 'Redirecting to secure Stripe checkout…');
          window.location.assign(result.checkoutUrl);
          return;
        }
        output(root, result);
      } catch (error) {
        output(root, `Error: ${error.message}`);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-smlcmh-campaign-form]').forEach((form) => {
      bindCampaignDefaults(form);
      bindCampaign(form);
    });
    document.querySelectorAll('[data-smlcmh-mapping-form]').forEach(bindMappings);
    document.querySelectorAll('[data-smlcmh-dashboard-form]').forEach(bindDashboard);
    document.querySelectorAll('[data-smlcmh-migrate-form]').forEach(bindMigrate);
  });
})();
