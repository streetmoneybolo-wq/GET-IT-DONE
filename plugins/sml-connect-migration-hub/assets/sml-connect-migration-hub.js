(function () {
  'use strict';

  const cfg = window.SMLConnectHub || {};

  function queryValue(...keys) {
    const params = new URLSearchParams(window.location.search);
    for (const key of keys) {
      const value = params.get(key);
      if (value) return value;
    }
    return '';
  }

  function fillHiddenContext(root) {
    const groupId = queryValue('group_id', 'groupId', 'sml_group_id');
    const guildId = queryValue('guild_id', 'guildId', 'discord_guild_id');
    const guildName = queryValue('guild_name', 'guildName', 'server_name');
    root.querySelectorAll('[data-smlcmh-hidden-group-id]').forEach((field) => {
      if (!field.value && groupId) field.value = groupId;
    });
    root.querySelectorAll('[data-smlcmh-hidden-guild-id]').forEach((field) => {
      if (!field.value && guildId) field.value = guildId;
    });
    root.querySelectorAll('input[name="guildName"]').forEach((field) => {
      if (!field.value && guildName) {
        field.value = guildName;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  function ensureContext(data) {
    const groupId = queryValue('group_id', 'groupId', 'sml_group_id');
    const guildId = queryValue('guild_id', 'guildId', 'discord_guild_id');
    if ((!data.groupId || data.groupId === '') && groupId) data.groupId = Number(groupId);
    if ((!data.guildId || data.guildId === '') && guildId) data.guildId = guildId;
    if ((!data.ownerUserId || data.ownerUserId === '') && cfg.currentId) data.ownerUserId = Number(cfg.currentId);
    return data;
  }

  function requireSetupContext(data, needsGuild) {
    if (!data.groupId) {
      throw new Error('Open this dashboard from the StockMarketLoop Connect Bot setup link so your group is loaded automatically.');
    }
    if (needsGuild && !data.guildId) {
      throw new Error('Open this dashboard from the Discord bot migration link so your Discord server is loaded automatically.');
    }
  }

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
    const data = ensureContext(Object.fromEntries(new FormData(form).entries()));
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

  function bindUploads(root) {
    root.querySelectorAll('[data-smlcmh-upload-field]').forEach((box) => {
      const button = box.querySelector('[data-smlcmh-upload]');
      const value = box.querySelector('[data-smlcmh-upload-value]');
      const preview = box.querySelector('[data-smlcmh-upload-preview]');
      if (!button || !value) return;

      button.addEventListener('click', () => {
        if (!window.wp || !wp.media) {
          const fallback = window.prompt('Choose an image from Media Library, then paste its URL here if the uploader is unavailable.');
          if (fallback) {
            value.value = fallback;
            if (preview) preview.innerHTML = `<img src="${fallback.replace(/"/g, '&quot;')}" alt="">`;
          }
          return;
        }
        const frame = wp.media({
          title: button.textContent || 'Choose image',
          button: { text: 'Use this image' },
          multiple: false,
          library: { type: 'image' }
        });
        frame.on('select', () => {
          const attachment = frame.state().get('selection').first().toJSON();
          if (!attachment || !attachment.url) return;
          value.value = attachment.url;
          if (preview) preview.innerHTML = `<img src="${attachment.url.replace(/"/g, '&quot;')}" alt="">`;
          button.textContent = 'Change image';
        });
        frame.open();
      });
    });
  }

  function bindTabs(root) {
    const buttons = [...root.querySelectorAll('[data-smlcmh-tab-button]')];
    const panels = [...root.querySelectorAll('[data-smlcmh-tab-panel]')];
    if (!buttons.length || !panels.length) return;
    function activate(name) {
      buttons.forEach((button) => button.classList.toggle('is-active', button.dataset.smlcmhTabButton === name));
      panels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.smlcmhTabPanel === name));
    }
    buttons.forEach((button) => {
      button.addEventListener('click', () => activate(button.dataset.smlcmhTabButton));
    });
  }

  function bindDisputeEmailActions(root) {
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-smlcmh-dispute-email]');
      if (!button) return;
      const email = button.getAttribute('data-smlcmh-email') || '';
      if (!email || email === 'email pending') {
        output(root, 'Customer email is not available for this dispute yet.');
        return;
      }
      const subject = button.getAttribute('data-smlcmh-subject') || 'Question about your StockMarketLoop membership dispute';
      const body = button.getAttribute('data-smlcmh-body') || '';
      window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      output(root, '48-hour reconsider email opened. Review it before sending.');
    });
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
        const data = formData(form);
        requireSetupContext(data, true);
        const result = await post('campaign', data);
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

  function dollarsToCents(value) {
    const normalized = String(value || '').replace(/[^0-9.]/g, '');
    if (!normalized) return 0;
    return Math.round(Number(normalized) * 100);
  }

  function roleRefs(value) {
    return String(value || '')
      .split(/[,\n]/)
      .map((entry) => entry.replace(/\D/g, '').trim())
      .filter((entry) => /^[0-9]{15,24}$/.test(entry));
  }

  function money(cents, currency = 'usd') {
    const amount = Number(cents || 0) / 100;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format(amount);
    } catch (_) {
      return `$${amount.toFixed(2)}`;
    }
  }

  function dateShort(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function table(headers, rows, emptyText) {
    if (!rows || !rows.length) return `<p class="smlcmh-muted">${esc(emptyText || 'No records yet.')}</p>`;
    return `<div class="smlcmh-data-table" style="--smlcmh-cols:${headers.length}">` +
      `<div class="smlcmh-data-head">${headers.map((h) => `<strong>${esc(h)}</strong>`).join('')}</div>` +
      rows.map((row) => `<div class="smlcmh-data-row">${row.map((cell) => `<span>${cell}</span>`).join('')}</div>`).join('') +
      '</div>';
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function overdueRecords(data) {
    const records = [
      ...asArray(data.overdueMemberships),
      ...asArray(data.overdueDms),
      ...asArray(data.premiumVerification && data.premiumVerification.overdueMemberships),
      ...asArray(data.premiumVerification && data.premiumVerification.notices),
      ...asArray(data.membershipVerification && data.membershipVerification.overdueMemberships),
      ...asArray(data.membershipVerification && data.membershipVerification.notices)
    ];
    const seen = new Set();
    return records.filter((row) => {
      const key = String(row.id || row.noticeId || row.userId || row.discordUserId || row.discordId || JSON.stringify(row));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function evidenceLink(row) {
    const url = row.evidenceUrl || row.evidenceImageUrl || row.screenshotUrl || row.attachmentUrl || '';
    if (!url) return '—';
    return `<a href="${esc(url)}" target="_blank" rel="noopener">View evidence</a>`;
  }

  function membershipQuickLink(row) {
    const url = row.membershipUrl || row.subscriptionUrl || row.portalUrl || row.manageUrl || row.invoiceUrl || '';
    if (!url) return '—';
    return `<a href="${esc(url)}" target="_blank" rel="noopener">Open membership</a>`;
  }

  function responseSummary(row) {
    const responses = asArray(row.responses || row.replies || row.memberResponses);
    if (responses.length) {
      const latest = responses[responses.length - 1] || {};
      return `${esc(latest.preview || latest.message || latest.text || 'Response received')}<small>${dateShort(latest.createdAt || latest.receivedAt || latest.timestamp)}</small>`;
    }
    if (row.responseStatus || row.replyStatus) return esc(row.responseStatus || row.replyStatus);
    if (row.submittedAt) return `Screenshot received<small>${dateShort(row.submittedAt)}</small>`;
    return 'No response yet';
  }

  function renderOverdue(root, data) {
    const box = root.querySelector('[data-smlcmh-overdue-memberships]');
    if (!box) return;
    const rows = overdueRecords(data);
    const sent = rows.filter((r) => ['sent', 'notified', 'delivered'].includes(String(r.status || r.dmStatus || '').toLowerCase())).length;
    const responded = rows.filter((r) => r.submittedAt || asArray(r.responses || r.replies || r.memberResponses).length || ['submitted', 'responded'].includes(String(r.status || '').toLowerCase())).length;
    const pending = rows.filter((r) => ['notified', 'sent', 'delivered', 'pending'].includes(String(r.status || r.dmStatus || '').toLowerCase()) && !r.submittedAt).length;
    box.innerHTML = `<div class="smlcmh-mini-stats">
      <div><strong>${rows.length}</strong><span>Overdue records</span></div>
      <div><strong>${sent}</strong><span>DMs sent</span></div>
      <div><strong>${responded}</strong><span>Responses</span></div>
      <div><strong>${pending}</strong><span>Pending</span></div>
    </div>` + table(
      ['Member', 'Membership', 'DM / deadline', 'Evidence', 'Quick link', 'Response', 'Role state'],
      rows.map((row) => [
        `${esc(row.memberName || row.discordName || row.username || row.globalName || 'Member')}<small>${esc(row.discordUserId || row.discordId || row.userId || '')}</small>`,
        `${esc(row.product || row.membership || row.planName || 'Premium Member')}<small>${esc(row.provider || row.source || 'billing source pending')} · ${money(row.amountCents || row.priceCents || 0, row.currency || 'usd')}</small>`,
        `${esc(row.dmStatus || row.status || 'pending')}<small>sent ${dateShort(row.sentAt || row.notifiedAt || row.dmSentAt)} · due ${dateShort(row.deadlineAt || row.responseDueAt)}</small>`,
        evidenceLink(row),
        membershipQuickLink(row),
        responseSummary(row),
        `${esc(row.roleState || row.accessState || row.roleStatus || 'protected until deadline')}<small>${esc(row.roleName || 'Premium Member')}</small>`
      ]),
      'No overdue membership DMs have been created for this server yet.'
    );
  }

  function publicMembershipUrl(campaign, plan) {
    const slug = campaign && campaign.publicSlug ? campaign.publicSlug : '';
    const base = slug ? `${cfg.publicUrl || '/connect/'}${slug}/` : (cfg.publicUrl || '/connect/');
    try {
      const parsed = new URL(base, window.location.origin);
      parsed.hash = 'memberships';
      return parsed.toString();
    } catch (_) {
      return `${base.replace(/#.*$/, '')}#memberships`;
    }
  }

  function storeCards(plans, campaign) {
    const visible = (Array.isArray(plans) ? plans : []).filter((p) => p.active !== false);
    if (!visible.length) return `<p class="smlcmh-muted">No memberships found yet.</p>`;
    return visible.map((p) => {
      const title = p.cardTitle || p.name || 'Premium Access';
      const interval = String(p.interval || 'monthly').replace(/ly$/, '').toUpperCase();
      const roles = Array.isArray(p.discordRoleRefs) ? p.discordRoleRefs.length : 0;
      const source = p.externalProductRef ? 'Imported from Upgrade.Chat' : 'StockMarketLoop native';
      const description = p.cardDescription || `Join ${title} and unlock premium Discord access, protected billing, automatic roles, and StockMarketLoop-powered creator tools.`;
      const shareUrl = publicMembershipUrl(campaign, p);
      const image = p.cardImageUrl || p.imageUrl || (campaign && campaign.discordBannerUrl) || '';
      return `<article class="smlcmh-store-card">
        ${image ? `<div class="smlcmh-store-image" style="background-image:url('${esc(image)}')"></div>` : ''}
        <h4>💎 ${esc(title)} 💎</h4>
        <div class="smlcmh-store-price">${money(p.priceCents, p.currency)} / ${esc(interval)}</div>
        <p class="smlcmh-store-desc">${esc(description)}</p>
        <div class="smlcmh-store-meta">
          <span>${esc(source)}</span>
          <span>${esc(roles)} mapped Discord role${roles === 1 ? '' : 's'}</span>
          <span>${esc(p.trialDays || 0)} trial day${Number(p.trialDays || 0) === 1 ? '' : 's'}</span>
        </div>
        <div class="smlcmh-share-box">
          <input readonly value="${esc(shareUrl)}" aria-label="Shareable membership link">
          <button class="smlcmh-btn smlcmh-btn-small smlcmh-store-copy" type="button" data-smlcmh-copy="${esc(shareUrl)}">Copy share link</button>
        </div>
        <p class="smlcmh-store-share-copy">Post this in Discord: ${esc(title)} is now inside the group Store — secure checkout, automatic roles, and protected access without losing the next billing date.</p>
        <a class="smlcmh-btn smlcmh-store-upgrade" href="${esc(shareUrl)}" target="_blank" rel="noopener">Open group store</a>
      </article>`;
    }).join('');
  }

  function renderDashboard(root, data) {
    const summary = data.subscriptionSummary || {};
    const analytics = data.analytics || {};
    const revenue = data.revenue || {};
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const migrations = data.migrations || {};
    const plans = Array.isArray(data.plans) ? data.plans : [];
    const roleLinks = Array.isArray(data.roleLinks) ? data.roleLinks : [];
    const disputes = Array.isArray(data.disputes) ? data.disputes : [];
    renderOverdue(root, data);

    const statCards = root.querySelectorAll('.smlcmh-stat-card strong');
    if (statCards[0]) statCards[0].textContent = money(revenue.sellerNetCents || analytics.migrated_revenue_cents || 0);
    if (statCards[1]) statCards[1].textContent = String(customers.filter((c) => ['active', 'trialing', 'grace'].includes(c.status)).length || summary.migrated_native || 0);
    if (statCards[2]) statCards[2].textContent = String(summary.at_risk || customers.filter((c) => ['past_due', 'grace', 'unpaid'].includes(c.status)).length || 0);

    const customerBox = root.querySelector('[data-smlcmh-customers]');
    if (customerBox) {
      customerBox.innerHTML = table(
        ['Customer', 'Membership', 'Status', 'Migration', 'Next bill/access', 'Roles'],
        customers.map((c) => [
          `User #${esc(c.userId)}`,
          `${esc(c.planName)}<small>${money(c.priceCents, c.currency)} / ${esc(c.interval || '—')}</small>`,
          `<em class="smlcmh-status smlcmh-status-${esc(c.status)}">${esc(c.status)}</em>`,
          `<em>${esc(c.migrationStatus)}</em>`,
          dateShort(c.currentPeriodEnd || c.accessUntil),
          `${esc(c.rolesGranted || 0)} granted / ${esc(c.rolesPending || 0)} pending`
        ]),
        'No customers or subscriptions have been imported yet.'
      );
    }

    const migrationBox = root.querySelector('[data-smlcmh-migrations]');
    if (migrationBox) {
      const pending = Array.isArray(migrations.pending) ? migrations.pending : [];
      const completed = Array.isArray(migrations.completed) ? migrations.completed : [];
      migrationBox.innerHTML =
        `<div class="smlcmh-mini-stats"><div><strong>${pending.length}</strong><span>Pending</span></div><div><strong>${completed.length}</strong><span>Migrated</span></div><div><strong>${summary.imported_active || 0}</strong><span>Imported active</span></div></div>` +
        table(
          ['Member', 'Current product', 'State', 'Renewal'],
          [...pending.slice(0, 8), ...completed.slice(0, 8)].map((c) => [
            `User #${esc(c.userId)}`,
            esc(c.planName),
            esc(c.migrationStatus),
            dateShort(c.currentPeriodEnd || c.accessUntil)
          ]),
          'No pending or completed migrations yet.'
        );
    }

    const disputeBox = root.querySelector('[data-smlcmh-disputes]');
    if (disputeBox) {
      disputeBox.innerHTML = `<div class="smlcmh-mini-stats">
        <div><strong>${disputes.length}</strong><span>Reported disputes</span></div>
        <div><strong>${disputes.filter((d) => ['open', 'evidence_building', 'ready_for_review'].includes(d.caseState)).length}</strong><span>Needs action</span></div>
        <div><strong>48h</strong><span>Reconsider notice</span></div>
      </div>` + table(
        ['Dispute', 'Member', 'Payment', 'Reason / status', 'Evidence', 'Action'],
        disputes.map((d) => [
          `${esc(d.provider || 'provider')}<small>${esc(d.providerDisputeId || d.caseId || '')}</small>`,
          `${esc(d.customerName || 'Member')}<small>${esc(d.customerEmail || 'email pending')} · ${esc(d.customerPhone || 'phone pending')}</small>`,
          `${money(d.amountCents || d.paymentAmountCents || 0, d.currency)}<small>${esc(d.paymentId || d.transactionRef || 'payment reference pending')}</small>`,
          `${esc(d.reason || 'unknown')}<small>${esc(d.caseState || d.providerStatus || 'open')} · due ${dateShort(d.dueBy)}</small>`,
          `${esc(d.evidenceCount || 0)} items<small>${esc(d.packetSha256 ? `packet ${d.packetSha256}` : 'packet pending')}</small>`,
          `<button class="smlcmh-btn smlcmh-btn-small" type="button" data-smlcmh-dispute-email="${esc(d.caseId || '')}" data-smlcmh-email="${esc(d.customerEmail || '')}" data-smlcmh-subject="${esc(`Please review your StockMarketLoop dispute ${d.providerDisputeId || d.caseId || ''}`)}" data-smlcmh-body="${esc(`Hi ${d.customerName || 'there'},\n\nWe received a dispute on your StockMarketLoop membership payment for ${money(d.amountCents || d.paymentAmountCents || 0, d.currency)}. If this was opened by mistake, please contact your bank/payment provider within 48 hours to withdraw or reconsider the dispute.\n\nIf the dispute remains open, StockMarketLoop may submit counter-evidence showing the subscription, product access, login/use history, delivered membership benefits, accepted terms, cancellation/refund policy, and payment record. If StockMarketLoop wins the dispute, a disclosed 13% dispute recovery fee may apply under the applicable terms.\n\nThank you,\nStockMarketLoop Connect`) }">Prepare 48h email</button>`
        ]),
        'No disputes have been reported for this Connect owner yet.'
      );
    }

    const productBox = root.querySelector('[data-smlcmh-products]');
    if (productBox) {
      productBox.innerHTML = `<h4>Products / memberships</h4>` + table(
        ['Plan', 'Price', 'Provider', 'Mapped roles'],
        plans.map((p) => [
          `${esc(p.name)}<small>${esc(p.slug || '')}</small>`,
          `${money(p.priceCents, p.currency)} / ${esc(p.interval)}`,
          esc(p.externalProductRef || 'SML native'),
          esc((p.discordRoleRefs || []).length)
        ]),
        'No membership products yet.'
      );
    }

    const storeBox = root.querySelector('[data-smlcmh-store]');
    if (storeBox) storeBox.innerHTML = storeCards(plans, data.campaign || {});

    const roleBox = root.querySelector('[data-smlcmh-role-links]');
    if (roleBox) {
      roleBox.innerHTML = `<h4>Role links</h4>` + table(
        ['Member', 'Plan', 'Role', 'State'],
        roleLinks.map((r) => [
          `User #${esc(r.userId)}`,
          esc(r.planName),
          esc(r.roleRef || '—'),
          esc(r.state)
        ]),
        'No Discord role links have synced yet.'
      );
    }

    const revenueBox = root.querySelector('[data-smlcmh-revenue]');
    if (revenueBox) {
      revenueBox.innerHTML = `<h4>Revenue</h4><div class="smlcmh-revenue-stack">
        <div><span>Gross processed</span><strong>${money(revenue.grossCents || 0)}</strong></div>
        <div><span>StockMarketLoop fees</span><strong>${money(revenue.platformFeeCents || 0)}</strong></div>
        <div><span>Owner net</span><strong>${money(revenue.sellerNetCents || 0)}</strong></div>
        <div><span>Last fee event</span><strong>${dateShort(revenue.lastFeeAt)}</strong></div>
      </div>`;
    }
  }

  function bindMemberships(form) {
    const root = form.closest('[data-smlcmh-dashboard]') || document;
    const rows = form.querySelector('[data-smlcmh-membership-rows]');
    const add = form.querySelector('[data-smlcmh-add-membership]');
    if (!rows) return;

    function rowData(row) {
      const get = (field) => {
        const el = row.querySelector(`[data-field="${field}"]`);
        return el ? el.value.trim() : '';
      };
      const name = get('name');
      return {
        name,
        slug: slugify(name),
        priceCents: dollarsToCents(get('priceDollars')),
        interval: get('interval') || 'monthly',
        currency: 'usd',
        trialDays: Number(get('trialDays') || 0),
        externalProductRef: get('externalProductRef'),
        discordRoleRefs: roleRefs(get('discordRoleRefs')),
        cardTitle: name,
        cardDescription: get('cardDescription') || `${name || 'Membership'} managed by StockMarketLoop Connect.`,
        cardImageUrl: get('cardImageUrl')
      };
    }

    function bindRow(row) {
      const remove = row.querySelector('[data-smlcmh-remove-membership]');
      if (remove) {
        remove.addEventListener('click', () => {
          if (rows.querySelectorAll('[data-smlcmh-membership-row]').length > 1) row.remove();
        });
      }
    }

    rows.querySelectorAll('[data-smlcmh-membership-row]').forEach(bindRow);
    if (add) {
      add.addEventListener('click', () => {
        const first = rows.querySelector('[data-smlcmh-membership-row]');
        if (!first) return;
        const clone = first.cloneNode(true);
        clone.querySelectorAll('input, textarea').forEach((el) => { el.value = ''; });
        clone.querySelectorAll('select').forEach((el) => { el.value = 'monthly'; });
        clone.querySelectorAll('[data-smlcmh-upload-preview]').forEach((el) => { el.innerHTML = ''; });
        clone.querySelectorAll('[data-smlcmh-upload]').forEach((el) => { el.textContent = 'Upload group / Discord image'; });
        rows.appendChild(clone);
        bindUploads(clone);
        bindRow(clone);
      });
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      output(root, 'Saving memberships, prices, intervals, products, and Discord roles…');
      try {
        const data = formData(form);
        requireSetupContext(data, false);
        data.memberships = [...rows.querySelectorAll('[data-smlcmh-membership-row]')]
          .map(rowData)
          .filter((row) => row.name && row.priceCents >= 0);
        if (!data.memberships.length) throw new Error('Add at least one membership.');
        const result = await post('memberships', data);
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
        const data = formData(form);
        requireSetupContext(data, false);
        const result = await post('dashboard', data);
        renderDashboard(root, result);
        output(root, 'Dashboard loaded.');
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
    fillHiddenContext(document);
    bindUploads(document);
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-smlcmh-copy]');
      if (!button) return;
      const text = button.getAttribute('data-smlcmh-copy') || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy share link'; }, 1400);
      } catch (_) {
        window.prompt('Copy this membership link:', text);
      }
    });
    document.querySelectorAll('[data-smlcmh-dashboard]').forEach((root) => {
      bindTabs(root);
      bindDisputeEmailActions(root);
    });
    document.querySelectorAll('[data-smlcmh-campaign-form]').forEach((form) => {
      bindCampaignDefaults(form);
      bindCampaign(form);
    });
    document.querySelectorAll('[data-smlcmh-mapping-form]').forEach(bindMappings);
    document.querySelectorAll('[data-smlcmh-membership-form]').forEach(bindMemberships);
    document.querySelectorAll('[data-smlcmh-dashboard-form]').forEach(bindDashboard);
    document.querySelectorAll('[data-smlcmh-migrate-form]').forEach(bindMigrate);
  });
})();
