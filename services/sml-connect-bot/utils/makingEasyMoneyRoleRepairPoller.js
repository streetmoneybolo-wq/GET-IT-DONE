import { makingEasyMoneyRoleTargets } from './makingEasyMoneyRoleAutoGrant.js';

const defaultGuildId = '1547568823920623658';

async function discord(token, pathname, options = {}) {
  const response = await fetch(`https://discord.com/api/v10${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) return null;
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`Discord ${options.method || 'GET'} ${pathname} failed ${response.status}`);
    error.status = response.status;
    error.body = body.slice(0, 240);
    throw error;
  }
  try { return body ? JSON.parse(body) : null; } catch { return null; }
}

async function listGuildMembers(token, guildId, limit = 1000) {
  const members = [];
  let after = '0';
  while (members.length < limit) {
    const batch = await discord(token, `/guilds/${guildId}/members?limit=1000&after=${after}`).catch(() => []);
    if (!Array.isArray(batch) || !batch.length) break;
    members.push(...batch);
    after = batch[batch.length - 1].user?.id || after;
    if (batch.length < 1000) break;
  }
  return members.slice(0, limit);
}

async function runMakingEasyMoneyRoleRepairOnce(client, settings) {
  const cfg = settings?.makingEasyMoneyAutoRoles || {};
  if (cfg.enabled === false) return { skipped: true, reason: 'disabled' };
  const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
  const guildId = cfg.guildId || defaultGuildId;
  const targets = [...(await makingEasyMoneyRoleTargets()).values()];
  const targetByUser = new Map(targets.map((target) => [target.userId, target]));
  let checked = 0;
  let present = 0;
  let granted = 0;
  let failed = 0;

  const members = await listGuildMembers(token, guildId, Number(cfg.memberScanLimit || 5000));
  for (const member of members) {
    if (member.user?.bot) continue;
    const target = targetByUser.get(member.user?.id);
    if (!target) continue;
    checked += 1;
    present += 1;
    for (const grant of target.grants) {
      if ((member.roles || []).includes(grant.roleId)) continue;
      try {
        await discord(token, `/guilds/${guildId}/members/${target.userId}/roles/${grant.roleId}`, {
          method: 'PUT',
          headers: { 'X-Audit-Log-Reason': `Making Easy Money auto-role repair: ${grant.reason}` },
        });
        granted += 1;
      } catch {
        failed += 1;
      }
    }
  }

  return { checked, present, granted, failed, totalTargets: targets.length, scannedMembers: members.length };
}

export function startMakingEasyMoneyRoleRepairPoller(client, settings) {
  const cfg = settings?.makingEasyMoneyAutoRoles || {};
  if (cfg.enabled === false) return null;
  const intervalSeconds = Number(cfg.pollIntervalSeconds || 180);
  const run = async () => {
    const result = await runMakingEasyMoneyRoleRepairOnce(client, settings).catch((error) => ({ error }));
    if (result?.error) {
      console.error('Making Easy Money role repair poll failed safely:', result.error.message || result.error);
    } else if (result?.granted || result?.failed) {
      console.log(`Making Easy Money role repair: checked ${result.checked}/${result.totalTargets}, present ${result.present}, granted ${result.granted}, failed ${result.failed}.`);
    }
  };
  setTimeout(run, 10_000);
  return setInterval(run, Math.max(60, intervalSeconds) * 1000);
}
