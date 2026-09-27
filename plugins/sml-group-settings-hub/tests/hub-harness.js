'use strict';
/* Runs the Group Settings Hub (hub.js + hub.css) in Chromium against a fake group
   page and stubbed sml-hub/v1 REST. Owner flow: every section, role CRUD, member
   role changes, channel overrides, socials config + target, delegation clicks and
   legacy de-dup. Member flow: follow-to-unlock card → connect Bluesky → verify →
   granted. Screenshots at 1280×900 and 390×844. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const P = path.join(__dirname, '..');
const OUT = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const JS = fs.readFileSync(`${P}/assets/hub.js`, 'utf8');
const CSS = fs.readFileSync(`${P}/assets/hub.css`, 'utf8');
const ORIGIN = 'https://site.test';

const CATALOG = {
  view_channels: { label: 'View channels', group: 'General', help: 'See channels unless a channel override denies it.' },
  send_messages: { label: 'Send messages', group: 'General', help: 'Post in channels unless a channel override denies it.' },
  post_alerts: { label: 'Post in alert channels', group: 'General', help: 'Raises base to Analyst.' },
  manage_channels: { label: 'Manage channels', group: 'Management', help: 'Rename, reorder, overrides.' },
  manage_roles: { label: 'Manage roles', group: 'Management', help: 'Create and edit roles.' },
  manage_members: { label: 'Manage members', group: 'Management', help: 'Change member roles.' },
  manage_onboarding: { label: 'Manage onboarding', group: 'Management', help: 'Open onboarding editor.' },
  manage_memberships: { label: 'Manage memberships', group: 'Management', help: 'Products and Stripe.' },
  manage_discord: { label: 'Manage Discord', group: 'Management', help: 'Pairing and sync.' },
  manage_socials: { label: 'Manage socials', group: 'Management', help: 'Follow targets.' }
};
const BASE = { member: 'Member', premium: 'Premium', analyst: 'Analyst', mod: 'Moderator', admin: 'Admin' };

function freshState(role) {
  const manager = role === 'owner';
  const perms = {}; Object.keys(CATALOG).forEach((k) => { perms[k] = manager; });
  return {
    roles: [{ id: 1, group_id: 12, name: 'VIP', color: '#f5c84b', base_level: 'premium', permissions: { view_channels: true, send_messages: true }, position: 0, key: 'role:1' }],
    role_counts: { 1: 2 },
    members: [
      { user_id: 9, name: 'Owner Obi', avatar: '', engine_role: 'admin', is_owner: true, joined_at: '2025-01-01 00:00:00', roles: [] },
      { user_id: 20, name: 'Ana Analyst', avatar: '', engine_role: 'analyst', is_owner: false, joined_at: '2025-02-01 00:00:00', roles: [{ role_id: 1, source: 'manual' }] },
      { user_id: 21, name: 'Mem Ber', avatar: '', engine_role: 'member', is_owner: false, joined_at: '2025-03-01 00:00:00', roles: [] }
    ],
    channels: [{ id: 100, name: 'general', type: 'text', order_index: 0, is_locked: 0, category: 'Community' }, { id: 101, name: 'premium-alerts', type: 'alerts', order_index: 1, is_locked: 1, category: 'Premium' }],
    overrides: { 101: { everyone: { view: 'deny' }, 'base:premium': { view: 'allow' } } },
    discord: { state: 'active', guild_id: '938894329076940820', mappings: [{ role_id: '222', website_role: 'premium' }] },
    plans: [{ id: 1, name: 'Premium Alerts', priceCents: 2999, intervalKey: 'quarterly', intervalLabel: '3 months', grantsRole: 'premium', active: true }],
    prefs: { hide_legacy: true },
    socialsOwner: { available: true, config: { enabled: true, rule: 'any', grant_role_id: 1, grant_engine_role: 'premium', message: 'Follow me and unlock VIP for free.' }, targets: [{ id: 5, platform: 'bluesky', handle: 'obi.bsky.social', label: 'My Bluesky', url: 'https://bsky.app/profile/obi.bsky.social' }], grants: [{ user_id: 21, display_name: 'Mem Ber', applied_role_id: 1, applied_engine_role: 'premium', created_at: '2026-09-20 10:00:00', last_verified_at: '2026-09-26 03:00:00' }], platforms: { loop: 'unavailable', bluesky: 'ready', youtube: 'needs_setup', reddit: 'needs_setup', x: 'unavailable' } },
    socialsMember: { available: true, enabled: true, rule: 'any', message: 'Follow me and unlock VIP for free.', reward: 'VIP', targets: [{ id: 5, platform: 'bluesky', handle: 'obi.bsky.social', label: 'My Bluesky', url: 'https://bsky.app/profile/obi.bsky.social' }], links: {}, granted: false, satisfied: [], platforms: { loop: 'unavailable', bluesky: 'ready', youtube: 'needs_setup', reddit: 'needs_setup', x: 'unavailable' } },
    audit: [{ id: 1, actor_user_id: 9, subject_user_id: 21, action: 'custom_role_added', created_at: '2026-09-26 12:00:00', detail: {} }],
    viewerRole: role, perms, manager
  };
}

function bootstrap(st) {
  const manager = st.manager;
  const out = {
    group: { id: 12, name: 'Making Easy Money', slug: 'making-easy-money', owner_id: 9, owner_name: 'Owner Obi', members: 3, url: `${ORIGIN}/groups/making-easy-money/` },
    viewer: { user_id: manager ? 9 : 21, is_owner: manager, is_manager: manager, engine_role: manager ? 'admin' : 'member', role_ids: [], permissions: st.perms, can_open_hub: manager },
    features: { discord: true, billing: true, categories: true, onboarding: true, visuals: true, socials: true },
    prefs: st.prefs, base_levels: BASE, catalog: CATALOG, socials: manager ? st.socialsOwner : st.socialsMember
  };
  if (manager) Object.assign(out, { roles: st.roles, role_counts: st.role_counts, channels: st.channels, overrides: st.overrides, discord: st.discord, plans: st.plans });
  return out;
}

function pageHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#04070d;color:#dfe7f2;font-family:sans-serif}.sml-gshell__main-head{display:flex;gap:8px;padding:12px;border-bottom:1px solid #223}.sml-gshell__edit{padding:6px 10px}[data-smlgs-owner-menu]{display:flex;flex-direction:column;gap:4px;padding:12px;width:200px}.sml-gshell__main{padding:12px}${CSS}</style></head>
  <body><div id="sml-group-root" data-group-id="12"><div id="sml-group-shell" data-smlgs-stage="active">
  <div class="sml-gshell__main-head"><b>Making Easy Money</b><button class="sml-gshell__edit" data-smlgs-edit onclick="window.__clicks.push('edit')">Edit</button><button class="sml-gshell__edit sml-dgc-owner" data-sml-dgc-owner="1" onclick="window.__clicks.push('dgc-owner')">Discord Access</button></div>
  <div class="sml-gshell__owner-menu" data-smlgs-owner-menu><button class="sml-billing-setup" onclick="window.__clicks.push('stripe')">⚙ Membership Billing · 6%</button><button data-sml-products="1" onclick="window.__clicks.push('products')">🛍 Membership products</button><button data-sml-ob-open onclick="window.__clicks.push('onboarding')">Onboarding</button></div>
  <div class="sml-manage-mini"><button data-sml-dgc-channel-sync="1" onclick="window.__clicks.push('dgc-sync')">Discord Server Channel Sync</button><button id="sml-gcat-gear" onclick="window.__clicks.push('gear')">⚙</button></div>
  <div class="sml-gshell__main"><p>chat…</p></div></div></div>
  <script>window.__clicks=[];window.smlPlatformOpenProducts=function(){window.__clicks.push('openProducts');};window.SML_HUB={api:'${ORIGIN}/wp-json/sml-hub/v1/',nonce:'n',slug:'making-easy-money',groupId:12,version:'1.0.0'};</script>
  <script>${JS}</script></body></html>`;
}

function stub(page, st, log) {
  return page.route('**/wp-json/**', async (route) => {
    const req = route.request(); const u = new URL(req.url()); const p = u.pathname; const method = req.method();
    const body = ['POST', 'DELETE'].includes(method) && req.postData() ? JSON.parse(req.postData()) : {};
    log.push({ method, p, body });
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    const m = p.match(/\/sml-hub\/v1\/group\/12(\/.*)?$/); if (!m) return json({ message: 'unexpected ' + p }, 404);
    const rest = m[1] || '';
    if (rest === '' && method === 'GET') return json(bootstrap(st));
    if (rest === '/audit') return json({ audit: st.audit });
    if (rest === '/prefs') { st.prefs = { hide_legacy: !!body.hide_legacy }; return json({ prefs: st.prefs }); }
    if (rest === '/roles' && method === 'POST') { const id = Math.max(0, ...st.roles.map((r) => r.id)) + 1; st.roles.push({ id, group_id: 12, name: body.name, color: body.color, base_level: body.permissions.post_alerts && body.base_level === 'member' ? 'analyst' : body.base_level, permissions: body.permissions, position: st.roles.length, key: 'role:' + id }); return json({ role: st.roles[st.roles.length - 1], roles: st.roles }); }
    let mm;
    if ((mm = rest.match(/^\/roles\/(\d+)$/))) { const id = Number(mm[1]); const r = st.roles.find((x) => x.id === id); if (method === 'DELETE') { st.roles = st.roles.filter((x) => x.id !== id); Object.keys(st.overrides).forEach((c) => { delete st.overrides[c]['role:' + id]; }); return json({ deleted: true, roles: st.roles, overrides: st.overrides }); } Object.assign(r, { name: body.name, color: body.color, base_level: body.base_level, permissions: body.permissions }); return json({ role: r, roles: st.roles }); }
    if (rest.startsWith('/members') && method === 'GET') { const s = (u.searchParams.get('search') || '').toLowerCase(); const list = st.members.filter((x) => !s || x.name.toLowerCase().includes(s)); return json({ members: list, total: list.length, page: 1, per_page: 50 }); }
    if ((mm = rest.match(/^\/members\/(\d+)$/))) { const uid = Number(mm[1]); const me = st.members.find((x) => x.user_id === uid); if (body.remove) { st.members = st.members.filter((x) => x.user_id !== uid); return json({ removed: true }); } if (body.engine_role) me.engine_role = body.engine_role; if (body.add_role_id) { me.roles.push({ role_id: body.add_role_id, source: 'manual' }); const r = st.roles.find((x) => x.id === body.add_role_id); const order = ['member', 'premium', 'analyst', 'mod', 'admin']; if (order.indexOf(me.engine_role) < order.indexOf(r.base_level)) me.engine_role = r.base_level; } if (body.remove_role_id) me.roles = me.roles.filter((x) => x.role_id !== body.remove_role_id); return json({ member: me }); }
    if ((mm = rest.match(/^\/channels\/(\d+)\/overrides$/))) { const cid = mm[1]; if (Object.keys(body.overrides).length) st.overrides[cid] = body.overrides; else delete st.overrides[cid]; return json({ channel_id: Number(cid), overrides: body.overrides, all: st.overrides }); }
    if (rest === '/socials/config') { Object.assign(st.socialsOwner.config, body); return json({ socials: st.socialsOwner }); }
    if (rest === '/socials/targets' && method === 'POST') { if (body.platform !== 'bluesky') return json({ message: 'That platform needs its API app configured by the site admin first.' }, 400); st.socialsOwner.targets.push({ id: 6, platform: 'bluesky', handle: body.handle.replace(/^@/, ''), label: body.label, url: 'https://bsky.app/profile/' + body.handle }); return json({ socials: st.socialsOwner }); }
    if ((mm = rest.match(/^\/socials\/targets\/(\d+)$/))) { st.socialsOwner.targets = st.socialsOwner.targets.filter((t) => t.id !== Number(mm[1])); return json({ socials: st.socialsOwner }); }
    if (rest === '/socials/recheck') { st.socialsOwner.grants = []; return json({ checked: 1, revoked: 1, socials: st.socialsOwner }); }
    if (rest === '/socials/connect') { st.socialsMember.links.bluesky = { handle: body.handle.replace(/^@/, ''), proof_code: 'SML-ABC123', verified: false }; return json({ platform: 'bluesky', handle: body.handle, proof_code: 'SML-ABC123', verified: false, instructions: 'Add SML-ABC123 to your bio.' }); }
    if (rest === '/socials/verify') { const l = st.socialsMember.links.bluesky; if (l) { l.verified = true; st.socialsMember.satisfied = [5]; st.socialsMember.granted = true; } return json({ result: { eligible: !!l, granted: !!l, targets: { 5: !!l } }, socials: st.socialsMember }); }
    if (rest === '/socials/disconnect') { delete st.socialsMember.links.bluesky; st.socialsMember.granted = false; st.socialsMember.satisfied = []; return json({ result: { eligible: false, granted: false }, socials: st.socialsMember }); }
    return json({ message: 'unexpected ' + rest }, 404);
  });
}

async function open(browser, st, viewport, tag) {
  const page = await browser.newPage({ viewport, isMobile: viewport.width < 500 });
  const log = [], errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('dialog', (d) => { if (d.type() === 'prompt') d.accept('obi-fan.bsky.social'); else d.accept(); });
  await stub(page, st, log);
  await page.route(`${ORIGIN}/groups/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml() }));
  await page.goto(`${ORIGIN}/groups/making-easy-money/`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  return { page, log, errors, shot: (name) => page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) }) };
}

const SECTIONS = ['overview', 'roles', 'members', 'channels', 'memberships', 'discord', 'socials', 'onboarding'];

async function ownerFlow(browser, viewport, tag) {
  const st = freshState('owner');
  const { page, log, errors, shot } = await open(browser, st, viewport, tag);
  const r = { errors };
  r.settingsButton = await page.evaluate(() => !!document.querySelector('[data-sml-hub-open]'));
  r.menuItem = await page.evaluate(() => !!document.querySelector('[data-sml-hub-menu]'));
  r.dedupe = await page.evaluate(() => document.body.classList.contains('sml-hub-dedupe'));
  r.legacyHidden = await page.evaluate(() => ['[data-sml-dgc-owner]', '[data-sml-products]', '.sml-billing-setup', '[data-sml-dgc-channel-sync]', '[data-sml-ob-open]'].map((s) => { const el = document.querySelector(s); const cs = getComputedStyle(el); const b = el.getBoundingClientRect(); return cs.opacity === '0' && cs.pointerEvents === 'none' && b.width <= 2 && b.height <= 2; }));
  await shot('page');
  await page.click('[data-sml-hub-open]');
  await page.waitForTimeout(500);
  r.overflow = {};
  for (const s of SECTIONS) { await page.click(`[data-go="${s}"]`); await page.waitForTimeout(350); await shot(s); r.overflow[s] = await page.evaluate(() => { const w = document.querySelector('.sml-hub__win'), c = document.querySelector('.sml-hub__content'); return [document.documentElement.scrollWidth - document.documentElement.clientWidth, w.getBoundingClientRect().right - innerWidth, c.scrollWidth - c.clientWidth].map(Math.round).join('/'); }); }
  r.builtinChips = await page.evaluate(() => { document.querySelector('[data-go="roles"]').click(); return document.querySelectorAll('.sml-hub__chip.base').length; });

  // Roles: create, edit, delete
  await page.click('[data-go="roles"]'); await page.waitForTimeout(200);
  await page.fill('[data-role-form] [name=name]', 'Alert Poster');
  await page.check('[data-role-form] [name=perm_post_alerts]');
  await page.click('[data-role-form] [type=submit]'); await page.waitForTimeout(400);
  r.rolesAfterCreate = st.roles.map((x) => x.name + ':' + x.base_level);
  await page.click('[data-edit]'); await page.waitForTimeout(200);
  await page.fill('[data-role-form] [name=name]', 'VIP Gold');
  await page.click('[data-role-form] [type=submit]'); await page.waitForTimeout(400);
  r.rolesAfterEdit = st.roles.map((x) => x.name);
  await shot('roles-after-edit');
  const delBtns = await page.$$('[data-del]'); await delBtns[1].click(); await page.waitForTimeout(400);
  r.rolesAfterDelete = st.roles.map((x) => x.name);

  // Members
  await page.click('[data-go="members"]'); await page.waitForTimeout(500);
  r.memberRows = await page.evaluate(() => document.querySelectorAll('.sml-hub__item').length);
  const sel = (await page.$$('[data-engine]:not([disabled])'))[1];
  await sel.selectOption('premium'); await page.waitForTimeout(400);
  r.memBerRole = st.members.find((m) => m.user_id === 21).engine_role;
  const addSel = await page.$('.sml-hub__member-roles select');
  await addSel.selectOption('1'); await page.waitForTimeout(400);
  r.anaRolesAfterAdd = JSON.stringify(st.members.find((m) => m.user_id === 21).roles);
  await shot('members-after');
  const chipRemove = await page.$('.sml-hub__member-roles .sml-hub__chip button');
  await chipRemove.click(); await page.waitForTimeout(400);
  r.rolesAfterChipRemove = JSON.stringify(st.members.find((m) => m.user_id === 20).roles);

  // Channels
  await page.click('[data-go="channels"]'); await page.waitForTimeout(300);
  const dets = await page.$$('details.sml-hub__channel'); await dets[0].click(); await page.waitForTimeout(200);
  await page.selectOption('details.sml-hub__channel:first-of-type tr[data-key="role:1"] select[data-w="post"]', 'deny');
  await page.click('details.sml-hub__channel:first-of-type .sml-hub__btn--primary'); await page.waitForTimeout(400);
  r.overrides100 = JSON.stringify(st.overrides[100]);
  await shot('channels-after');

  // Socials owner: config + add target + recheck
  await page.click('[data-go="socials"]'); await page.waitForTimeout(300);
  await page.selectOption('[data-cfg] [name=rule]', 'all');
  await page.click('[data-cfg] [type=submit]'); await page.waitForTimeout(300);
  r.socialsRule = st.socialsOwner.config.rule;
  await page.fill('[data-add] [name=handle]', '@second.bsky.social');
  await page.fill('[data-add] [name=label]', 'Second');
  await page.click('[data-add] [type=submit]'); await page.waitForTimeout(400);
  r.targets = st.socialsOwner.targets.map((t) => t.handle);
  r.disabledPlatforms = await page.evaluate(() => Array.from(document.querySelectorAll('[data-add] [name=platform] option[disabled]')).map((o) => o.value));
  await page.click('[data-recheck]'); await page.waitForTimeout(400);
  r.recheckMsg = await page.evaluate(() => (document.querySelector('.sml-hub__ok') || {}).textContent);

  // Delegation
  const del = async (section, selector) => { await page.click(`[data-go="${section}"]`); await page.waitForTimeout(250); await page.click(selector); await page.waitForTimeout(200); const open = await page.evaluate(() => !!document.querySelector('.sml-hub')); if (open) await page.evaluate(() => window.smlHubOpen && document.querySelector('.sml-hub [data-close]').click()); await page.click('[data-sml-hub-open]'); await page.waitForTimeout(250); };
  await del('overview', '.sml-hub__card:nth-child(1) button');
  await del('overview', '.sml-hub__card:nth-child(2) button');
  await del('memberships', '[data-products]');
  await del('memberships', '[data-stripe]');
  await del('discord', '[data-sync]');
  await del('onboarding', '.sml-hub__btn--primary');
  r.clicks = await page.evaluate(() => window.__clicks);

  // Toggle dedupe off
  await page.click('[data-go="overview"]'); await page.waitForTimeout(300);
  await page.click('[data-hide]'); await page.waitForTimeout(300);
  r.dedupeAfterToggle = await page.evaluate(() => document.body.classList.contains('sml-hub-dedupe'));
  await page.close();
  return r;
}

async function memberFlow(browser, viewport, tag) {
  const st = freshState('member');
  const { page, log, errors, shot } = await open(browser, st, viewport, tag);
  const r = { errors };
  r.card = await page.evaluate(() => (document.querySelector('.sml-hub-card h3') || {}).textContent);
  r.noSettingsButton = await page.evaluate(() => !document.querySelector('[data-sml-hub-open]'));
  await shot('card');
  await page.click('.sml-hub-card button'); await page.waitForTimeout(400);
  r.navItems = await page.evaluate(() => Array.from(document.querySelectorAll('[data-go]')).map((b) => b.getAttribute('data-go')));
  await shot('socials');
  await page.click('.sml-hub__social-target .sml-hub__btn'); await page.waitForTimeout(500);
  r.proofChip = await page.evaluate(() => (document.querySelector('.sml-hub__social-target .sml-hub__chip') || {}).textContent);
  await shot('socials-connected');
  await page.click('.sml-hub .sml-hub__btn--primary'); await page.waitForTimeout(500);
  r.verifyMsg = await page.evaluate(() => (document.querySelector('.sml-hub__ok') || {}).textContent);
  r.granted = st.socialsMember.granted;
  await shot('socials-granted');
  await page.close();
  return r;
}

(async () => {
  const browser = await chromium.launch();
  console.log('OWNER-DESKTOP', JSON.stringify(await ownerFlow(browser, { width: 1280, height: 900 }, 'desktop'), null, 1));
  console.log('OWNER-PHONE', JSON.stringify(await ownerFlow(browser, { width: 390, height: 844 }, 'phone'), null, 1));
  console.log('MEMBER-PHONE', JSON.stringify(await memberFlow(browser, { width: 390, height: 844 }, 'member-phone'), null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
