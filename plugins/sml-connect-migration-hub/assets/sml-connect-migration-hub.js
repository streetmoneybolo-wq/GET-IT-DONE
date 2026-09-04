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
    return data;
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
    document.querySelectorAll('[data-smlcmh-campaign-form]').forEach(bindCampaign);
    document.querySelectorAll('[data-smlcmh-mapping-form]').forEach(bindMappings);
    document.querySelectorAll('[data-smlcmh-dashboard-form]').forEach(bindDashboard);
    document.querySelectorAll('[data-smlcmh-migrate-form]').forEach(bindMigrate);
  });
})();
