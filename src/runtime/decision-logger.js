const LEVEL_PRIORITY = {
  silent: 0,
  info: 1,
  debug: 2,
};

const BLOCKED_KEY_PATTERN = /(prompt|content|secret|token|password|patch(text)?|payload|body)/i;
const MAX_STRING_LENGTH = 300;

function normalizeLevel(level) {
  if (typeof level !== "string") return "info";
  const normalized = level.trim().toLowerCase();
  return Object.hasOwn(LEVEL_PRIORITY, normalized) ? normalized : "info";
}

function sanitizeValue(value) {
  if (value == null) return value;
  if (typeof value === "string") return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item)).filter((item) => item !== undefined);
  if (typeof value === "object") {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      if (BLOCKED_KEY_PATTERN.test(key)) continue;
      const sanitized = sanitizeValue(child);
      if (sanitized !== undefined) next[key] = sanitized;
    }
    return next;
  }
  return undefined;
}

function sanitizeFields(fields) {
  if (!fields || typeof fields !== "object") return {};
  const next = {};
  for (const [key, value] of Object.entries(fields)) {
    if (BLOCKED_KEY_PATTERN.test(key)) continue;
    const sanitized = sanitizeValue(value);
    if (sanitized !== undefined) next[key] = sanitized;
  }
  return next;
}

export function createDecisionLogger({ level = process.env.OPENCODE_WORKTREE_LOG_LEVEL, write } = {}) {
  const configuredLevel = normalizeLevel(level);
  const writer = typeof write === "function" ? write : (line) => console.log(line);

  function shouldLog(logLevel) {
    return LEVEL_PRIORITY[configuredLevel] >= LEVEL_PRIORITY[logLevel];
  }

  function log(logLevel, event, fields) {
    if (!shouldLog(logLevel)) return;
    if (typeof event !== "string" || !event.trim()) return;
    writer(JSON.stringify({
      ts: new Date().toISOString(),
      level: logLevel,
      event: event.trim(),
      ...sanitizeFields(fields),
    }));
  }

  return {
    info(event, fields) {
      log("info", event, fields);
    },
    debug(event, fields) {
      log("debug", event, fields);
    },
  };
}
