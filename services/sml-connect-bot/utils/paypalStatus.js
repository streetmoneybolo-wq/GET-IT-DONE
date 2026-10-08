const requiredEnv = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'];

export function paypalPayoutStatus() {
  const missing = requiredEnv.filter((name) => !process.env[name]);
  const payoutsEnabled = process.env.PAYPAL_PAYOUTS_ENABLED === '1';
  const dryRun = process.env.PAYPAL_PAYOUT_DRY_RUN !== '0';
  const mode = String(process.env.PAYPAL_ENV || process.env.PAYPAL_MODE || 'live').toLowerCase() === 'sandbox'
    ? 'sandbox'
    : 'live';
  return {
    connected: missing.length === 0 && payoutsEnabled,
    readyForRealMoney: missing.length === 0 && payoutsEnabled && !dryRun,
    credentialsPresent: missing.length === 0,
    payoutsEnabled,
    dryRun,
    missing,
    mode,
  };
}

export function paypalSetupText(status = paypalPayoutStatus()) {
  if (status.connected) {
    return status.dryRun
      ? `PayPal payouts are connected in **${status.mode}** mode, but **dry-run mode is ON**. Admin payout actions will simulate payouts until \`PAYPAL_PAYOUT_DRY_RUN=0\` is set.`
      : `PayPal payouts are connected in **${status.mode}** mode. Approved payable balances can be processed by an admin payout action.`;
  }
  const needed = [
    ...status.missing.map((name) => `\`${name}\``),
    ...(!status.payoutsEnabled ? ['`PAYPAL_PAYOUTS_ENABLED=1`'] : []),
  ];
  return `PayPal payouts are **not connected yet**.\n\nMissing setup: ${needed.join(', ')}\n\nAdd those values to the bot environment on the server, restart the bot, then run this command again. Do not paste PayPal secrets in Discord.`;
}
