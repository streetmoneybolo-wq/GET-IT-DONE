'use strict';

function sanitize(value) {
  if (value == null) return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(password|secret|token|database_url|authorization)/i.test(key))
    .map(([key, item]) => [key, sanitize(item)]));
}

function log(level, event, fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitize(fields)
  });
  (level === 'error' ? console.error : console.log)(line);
}

module.exports = { log, sanitize };
