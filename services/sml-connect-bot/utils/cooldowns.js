const expirations = new Map();

export function consumeCooldown(scope, userId, seconds) {
  const key = `${scope}:${userId}`;
  const now = Date.now();
  const until = expirations.get(key) || 0;
  if (until > now) return Math.ceil((until - now) / 1000);
  expirations.set(key, now + Math.max(0, Number(seconds) || 0) * 1000);
  return 0;
}

export function clearCooldown(scope, userId) {
  expirations.delete(`${scope}:${userId}`);
}
