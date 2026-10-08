import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { PermissionFlagsBits } from 'discord.js';

const newGuildId = '1547568823920623658';
const tempRoleId = '1547628357519151144';

const roleMap = {
  'premium member': '1547569243825115227',
  premium: '1547569243825115227',
  'elite member': '1547569244714041345',
  elite: '1547569244714041345',
  'free trial': '1547569240788172840',
  trial: '1547569240788172840',
};

const activeMemberCsv = 'data/member-migration/paid-members.csv';
const upgradeChatCustomersCsv = 'data/member-migration/upgradechat-customers-20260910-064421.csv';
const tkVictimNoticeLog = 'data/tk-payment-dispute-notice-log.json';

let cache = null;
let cacheUntil = 0;

function cleanId(value) {
  const text = String(value || '').replace(/\D/g, '');
  return /^\d{15,25}$/.test(text) ? text : '';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quote = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') {
        quote = false;
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') quote = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') {
      cell += c;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = (rows.shift() || []).map((header) => String(header || '').trim());
  return rows
    .filter((values) => values.some((value) => String(value || '').trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function activeStatus(value) {
  const status = String(value || '').toLowerCase().replace(/\s+/g, '_');
  return ['active', 'trialing', 'paid', 'current', 'complete', 'completed'].includes(status);
}

function intValue(value) {
  const number = Number.parseInt(String(value || '0').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(number) ? number : 0;
}

function roleFor(row) {
  const roleId = cleanId(row.roleId || row.discordRoleId || row.discord_role_id);
  if (roleId) return roleId;
  const text = [
    row.role,
    row.roleName,
    row.discordRole,
    row.product,
    row.productName,
    row.plan,
    row.planName,
    row.membership,
    row.membershipName,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  for (const [needle, id] of Object.entries(roleMap)) {
    if (text.includes(needle)) return id;
  }
  return roleMap['premium member'];
}

async function loadAutoGrantData() {
  const now = Date.now();
  if (cache && cacheUntil > now) return cache;

  const activeMembers = new Map();
  const pastPaidMembers = new Map();

  if (existsSync(upgradeChatCustomersCsv)) {
    const rows = parseCsv(await readFile(upgradeChatCustomersCsv, 'utf8'));
    for (const row of rows) {
      const discordUserId = cleanId(row['Discord ID'] || row.discordUserId || row.discord_id || row.discordId || row.userId || row.user_id);
      if (!discordUserId) continue;

      const activeOrders = intValue(row['Active Orders'] || row.activeOrders);
      const pendingCancelledOrders = intValue(row['Pending Cancelled Orders'] || row.pendingCancelledOrders);
      const cancelledOrders = intValue(row['Cancelled Orders'] || row.cancelledOrders);
      const totalOrders = activeOrders + pendingCancelledOrders + cancelledOrders;
      if (totalOrders <= 0) continue;

      if (activeOrders > 0 || pendingCancelledOrders > 0) {
        activeMembers.set(discordUserId, {
          roleId: roleMap['premium member'],
          status: activeOrders > 0 ? 'active' : 'pending_cancelled_current',
          product: 'Premium Member',
          provider: 'Upgrade.Chat',
        });
      } else {
        pastPaidMembers.set(discordUserId, {
          cancelledOrders,
          firstPurchaseDate: row['First Purchase Date'] || '',
          provider: 'Upgrade.Chat',
        });
      }
    }
  }

  if (existsSync(activeMemberCsv)) {
    const rows = parseCsv(await readFile(activeMemberCsv, 'utf8'));
    for (const row of rows) {
      const discordUserId = cleanId(row.discordUserId || row.discord_id || row.discordId || row.userId || row.user_id);
      if (!discordUserId) continue;
      const status = row.status || row.subscriptionStatus || row.subscription_status || row.paymentStatus || row.payment_status;
      if (!activeStatus(status)) continue;
      activeMembers.set(discordUserId, {
        roleId: roleFor(row),
        status,
        product: row.product || row.productName || row.plan || row.membership || row.role || 'Premium Member',
        provider: row.provider || row.source || 'Upgrade.Chat',
      });
      pastPaidMembers.delete(discordUserId);
    }
  }

  const tkVictims = new Set();
  if (existsSync(tkVictimNoticeLog)) {
    const log = JSON.parse(await readFile(tkVictimNoticeLog, 'utf8'));
    for (const row of Object.values(log.sent || {})) {
      const userId = cleanId(row.userId);
      if (userId) tkVictims.add(userId);
    }
  }

  for (const userId of activeMembers.keys()) {
    pastPaidMembers.delete(userId);
  }

  cache = { activeMembers, pastPaidMembers, tkVictims, generatedAt: new Date().toISOString() };
  cacheUntil = now + 60_000;
  return cache;
}

export async function autoGrantMakingEasyMoneyAccess(member, reason = 'member_join', options = {}) {
  const apply = options.apply !== false;
  if (!member || member.guild.id !== newGuildId) return { skipped: true, reason: 'wrong_guild' };
  const permissions = member.guild.members.me?.permissions;
  if (!permissions?.has(PermissionFlagsBits.ManageRoles)) return { skipped: true, reason: 'missing_manage_roles' };

  const data = await loadAutoGrantData();
  const grants = [];
  const active = data.activeMembers.get(member.id);
  const pastPaid = data.pastPaidMembers.get(member.id);
  if (active?.roleId) {
    grants.push({
      roleId: active.roleId,
      reason: `${reason}: verified active/current ${active.provider} membership (${active.product})`,
    });
  }
  if (!active && pastPaid) {
    grants.push({
      roleId: tempRoleId,
      reason: `${reason}: past Upgrade.Chat buyer temporary review access`,
    });
  } else if (!active && data.tkVictims.has(member.id)) {
    grants.push({
      roleId: tempRoleId,
      reason: `${reason}: TK payment-victim temporary review access`,
    });
  }

  const uniqueGrants = [...new Map(grants.map((grant) => [grant.roleId, grant])).values()];
  const applied = [];
  const alreadyHad = [];
  const failed = [];

  for (const grant of uniqueGrants) {
    if (member.roles.cache.has(grant.roleId)) {
      alreadyHad.push(grant.roleId);
      continue;
    }
    if (!apply) {
      applied.push(`would:${grant.roleId}`);
      continue;
    }
    try {
      await member.roles.add(grant.roleId, grant.reason);
      applied.push(grant.roleId);
    } catch (error) {
      failed.push({ roleId: grant.roleId, error: error.message || String(error) });
    }
  }

  return {
    skipped: uniqueGrants.length === 0,
    activeMember: Boolean(active),
    pastPaidMember: Boolean(pastPaid),
    tkVictim: data.tkVictims.has(member.id),
    applied,
    alreadyHad,
    failed,
  };
}

export async function makingEasyMoneyRoleTargets() {
  const data = await loadAutoGrantData();
  const targets = new Map();

  for (const [userId, active] of data.activeMembers.entries()) {
    const existing = targets.get(userId) || { userId, grants: [], activeMember: false, tkVictim: false };
    existing.activeMember = true;
    if (active?.roleId) {
      existing.grants.push({
        roleId: active.roleId,
        reason: `verified active/current ${active.provider} membership (${active.product})`,
      });
    }
    targets.set(userId, existing);
  }

  for (const userId of data.pastPaidMembers.keys()) {
    const existing = targets.get(userId) || { userId, grants: [], activeMember: false, pastPaidMember: false, tkVictim: false };
    existing.pastPaidMember = true;
    existing.grants.push({
      roleId: tempRoleId,
      reason: 'past Upgrade.Chat buyer temporary review access',
    });
    targets.set(userId, existing);
  }

  for (const userId of data.tkVictims) {
    const existing = targets.get(userId) || { userId, grants: [], activeMember: false, pastPaidMember: false, tkVictim: false };
    existing.tkVictim = true;
    existing.grants.push({
      roleId: tempRoleId,
      reason: 'TK payment-victim temporary review access',
    });
    targets.set(userId, existing);
  }

  for (const target of targets.values()) {
    target.grants = [...new Map(target.grants.map((grant) => [grant.roleId, grant])).values()];
  }

  return targets;
}

export function makingEasyMoneyGuildId() {
  return newGuildId;
}
