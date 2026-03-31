function normalizeLevel(level) {
  const raw = typeof level === "string" ? level.trim().toLowerCase() : "";
  if (raw === "silent") return "silent";
  if (raw === "debug") return "debug";
  return "info";
}

function sanitizeValue(value) {
  if (value == null) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeValue(entry)).filter((entry) => entry !== undefined);
  }
  return undefined;
}

function sanitizeFields(fields) {
  if (!fields || typeof fields !== "object") return {};
  const blocked = /(secret|token|password|prompt|content|payload|patch)/i;
  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    if (blocked.test(key)) continue;
    const sanitized = sanitizeValue(value);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

export function createDecisionLogger({ level = process.env.OPENCODE_WORKTREE_LOG_LEVEL, write } = {}) {
  const resolvedLevel = normalizeLevel(level);
  const sink = typeof write === "function" ? write : (line) => process.stderr.write(`${line}\n`);

  function emit(logLevel, event, fields) {
    if (resolvedLevel === "silent") return;
    if (resolvedLevel === "info" && logLevel === "debug") return;
    if (typeof event !== "string" || !event) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level: logLevel, event, ...sanitizeFields(fields) }));
  }

  return {
    info(event, fields = {}) {
      emit("info", event, fields);
    },
    debug(event, fields = {}) {
      emit("debug", event, fields);
    },
  };
}
